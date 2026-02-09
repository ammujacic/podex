"""Subagent management with context isolation.

This module enables spawning isolated subagents that:
- Have their own context windows (separate from parent)
- Return only summaries to the parent (not full context)
- Can run in the background (non-blocking)
- Support @ syntax invocation

Subagent roles are defined in the database and synced to Redis.
The ConfigReader is used to fetch role definitions including system prompts.
"""

import asyncio
import re
import uuid
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from typing import Any

import structlog

from src.config_reader import get_config_reader

logger = structlog.get_logger()


class SubagentStatus(str, Enum):
    """Status of a subagent."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class SubagentContext:
    """Isolated context for a subagent."""

    messages: list[dict[str, Any]] = field(default_factory=list)
    tokens_used: int = 0
    max_tokens: int = 50000  # Smaller context than parent
    system_prompt: str | None = None

    def add_message(self, role: str, content: str) -> None:
        """Add a message to the context."""
        self.messages.append(
            {
                "role": role,
                "content": content,
                "timestamp": datetime.now(UTC).isoformat(),
            }
        )
        # Estimate token count (rough approximation)
        self.tokens_used += len(content) // 4

    def get_messages_for_llm(self) -> list[dict[str, str]]:
        """Get messages formatted for LLM call."""
        result = []
        if self.system_prompt:
            result.append({"role": "system", "content": self.system_prompt})
        for msg in self.messages:
            result.append({"role": msg["role"], "content": msg["content"]})
        return result

    def summarize(self) -> str:
        """Generate a summary of the context for the parent."""
        if not self.messages:
            return "No actions taken."

        # Find assistant messages
        assistant_messages = [m["content"] for m in self.messages if m["role"] == "assistant"]

        if not assistant_messages:
            return "Task acknowledged but no response generated."

        # Return the last assistant message as summary (simplified)
        # In production, would use LLM to generate a proper summary
        last_response: str = str(assistant_messages[-1])
        if len(last_response) > 500:
            return last_response[:497] + "..."
        return last_response


@dataclass
class Subagent:
    """A subagent with isolated context."""

    id: str
    parent_agent_id: str
    session_id: str
    name: str
    role: str  # Role name from database (loaded via ConfigReader)
    task: str
    context: SubagentContext
    status: SubagentStatus = SubagentStatus.PENDING
    background: bool = False
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    completed_at: datetime | None = None
    result_summary: str | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "parent_agent_id": self.parent_agent_id,
            "session_id": self.session_id,
            "name": self.name,
            "role": self.role,
            "task": self.task,
            "status": self.status.value,
            "background": self.background,
            "created_at": self.created_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "result_summary": self.result_summary,
            "error": self.error,
            "context_tokens": self.context.tokens_used,
        }


# @ syntax pattern for invoking subagents
# Matches: @researcher search for X, @coder implement Y, etc.
# Role names are validated against Redis when spawning, not in the pattern.
SUBAGENT_PATTERN = re.compile(
    r"@([\w]+)\s+(.+?)(?=@[\w]+\s|$)",
    re.IGNORECASE | re.DOTALL,
)


def parse_subagent_invocations(text: str) -> list[tuple[str, str]]:
    """
    Parse @ syntax invocations from text.

    Returns list of (role, task) tuples.
    Role validation happens when spawning via ConfigReader.
    """
    matches = SUBAGENT_PATTERN.findall(text)
    return [(m[0].lower(), m[1].strip()) for m in matches]


class SubagentManager:
    """
    Manages subagent lifecycle and context isolation.

    Features:
    - Spawn subagents with isolated contexts
    - @ syntax parsing for inline invocation
    - Background execution support
    - Max 5 concurrent subagents per parent
    - Summary-only returns to parent context
    """

    MAX_CONCURRENT_SUBAGENTS = 5

    def __init__(self) -> None:
        # parent_agent_id -> list of subagents
        self._subagents: dict[str, list[Subagent]] = {}
        # subagent_id -> subagent
        self._subagent_by_id: dict[str, Subagent] = {}
        # Running background tasks
        self._background_tasks: dict[str, asyncio.Task[None]] = {}
        # Execution callback (set by agent service)
        self._executor: Callable[[Subagent], Coroutine[Any, Any, str]] | None = None

    def set_executor(self, executor: Callable[[Subagent], Coroutine[Any, Any, str]]) -> None:
        """Set the executor function for running subagent tasks."""
        self._executor = executor

    async def spawn_subagent(
        self,
        parent_agent_id: str,
        session_id: str,
        role: str,
        task: str,
        background: bool = False,
        system_prompt: str | None = None,
    ) -> Subagent:
        """
        Spawn a new subagent with isolated context.

        Args:
            parent_agent_id: ID of the parent agent
            session_id: Current session ID
            role: Role name (must exist in database/Redis)
            task: The task to perform
            background: If True, run asynchronously
            system_prompt: Optional custom system prompt (overrides role's prompt)

        Returns:
            The created Subagent instance

        Raises:
            ValueError: If max concurrent subagents exceeded or role not found
        """
        # Check concurrent limit
        active = self.get_active_subagents(parent_agent_id)
        if len(active) >= self.MAX_CONCURRENT_SUBAGENTS:
            raise ValueError(
                f"Maximum {self.MAX_CONCURRENT_SUBAGENTS} concurrent subagents exceeded"
            )

        # Validate role and get definition from Redis
        config = get_config_reader()
        role_name = role.lower()

        if not await config.is_delegatable_role(role_name):
            delegatable = await config.get_delegatable_roles()
            valid_roles = [r["role"] for r in delegatable]
            raise ValueError(
                f"Role '{role_name}' is not valid for delegation. Available roles: {valid_roles}"
            )

        role_def = await config.get_role(role_name)
        if not role_def:
            raise ValueError(
                f"Role '{role_name}' not found in configuration. Ensure config is synced to Redis."
            )

        # Create isolated context with role's system prompt
        context = SubagentContext(
            system_prompt=system_prompt or role_def.system_prompt,
        )

        # Create subagent
        subagent = Subagent(
            id=str(uuid.uuid4()),
            parent_agent_id=parent_agent_id,
            session_id=session_id,
            name=role_def.name,
            role=role_name,
            task=task,
            context=context,
            background=background,
        )

        # Register
        if parent_agent_id not in self._subagents:
            self._subagents[parent_agent_id] = []
        self._subagents[parent_agent_id].append(subagent)
        self._subagent_by_id[subagent.id] = subagent

        logger.info(
            "subagent_spawned",
            subagent_id=subagent.id,
            parent_agent_id=parent_agent_id,
            role=role_name,
            background=background,
        )

        # Execute
        if background:
            task_coro = self._run_subagent(subagent)
            self._background_tasks[subagent.id] = asyncio.create_task(task_coro)
        else:
            await self._run_subagent(subagent)

        return subagent

    async def _run_subagent(self, subagent: Subagent) -> None:
        """Execute the subagent's task."""
        subagent.status = SubagentStatus.RUNNING

        try:
            # Add the task to the context
            subagent.context.add_message("user", subagent.task)

            if self._executor:
                # Use the provided executor
                result = await self._executor(subagent)
                subagent.context.add_message("assistant", result)
            else:
                # No executor set - just acknowledge
                logger.warning("no_executor_set", subagent_id=subagent.id)
                subagent.context.add_message(
                    "assistant", f"[Subagent {subagent.name}] Task acknowledged: {subagent.task}"
                )

            # Complete and generate summary
            subagent.status = SubagentStatus.COMPLETED
            subagent.completed_at = datetime.now(UTC)
            subagent.result_summary = subagent.context.summarize()

            logger.info(
                "subagent_completed",
                subagent_id=subagent.id,
                tokens_used=subagent.context.tokens_used,
            )

        except Exception as e:
            logger.error("subagent_failed", subagent_id=subagent.id, error=str(e))
            subagent.status = SubagentStatus.FAILED
            subagent.error = str(e)
            subagent.completed_at = datetime.now(UTC)

        finally:
            # Clean up background task reference
            if subagent.id in self._background_tasks:
                del self._background_tasks[subagent.id]

    def get_subagent(self, subagent_id: str) -> Subagent | None:
        """Get a subagent by ID."""
        return self._subagent_by_id.get(subagent_id)

    def get_subagents(self, parent_agent_id: str) -> list[Subagent]:
        """Get all subagents for a parent agent."""
        return self._subagents.get(parent_agent_id, [])

    def get_active_subagents(self, parent_agent_id: str) -> list[Subagent]:
        """Get currently running subagents for a parent."""
        return [
            s
            for s in self.get_subagents(parent_agent_id)
            if s.status in (SubagentStatus.PENDING, SubagentStatus.RUNNING)
        ]

    async def wait_for_subagent(self, subagent_id: str, timeout: float = 60.0) -> Subagent | None:
        """Wait for a background subagent to complete."""
        subagent = self.get_subagent(subagent_id)
        if not subagent:
            return None

        if subagent_id in self._background_tasks:
            try:
                await asyncio.wait_for(self._background_tasks[subagent_id], timeout=timeout)
            except TimeoutError:
                logger.warning("subagent_wait_timeout", subagent_id=subagent_id)

        return self.get_subagent(subagent_id)

    async def cancel_subagent(self, subagent_id: str) -> bool:
        """Cancel a running subagent."""
        subagent = self.get_subagent(subagent_id)
        if not subagent:
            return False

        if subagent_id in self._background_tasks:
            self._background_tasks[subagent_id].cancel()
            del self._background_tasks[subagent_id]

        subagent.status = SubagentStatus.CANCELLED
        subagent.completed_at = datetime.now(UTC)

        logger.info("subagent_cancelled", subagent_id=subagent_id)
        return True

    def get_summary_for_parent(self, subagent_id: str) -> str | None:
        """
        Get the summary to inject into parent context.

        This is the key isolation mechanism - only the summary
        is returned, not the full context.
        """
        subagent = self.get_subagent(subagent_id)
        if not subagent:
            return None

        if subagent.status == SubagentStatus.COMPLETED:
            return f"[{subagent.name} completed] {subagent.result_summary}"
        elif subagent.status == SubagentStatus.FAILED:
            return f"[{subagent.name} failed] Error: {subagent.error}"
        elif subagent.status == SubagentStatus.RUNNING:
            return f"[{subagent.name} running] Task in progress..."
        else:
            return f"[{subagent.name}] Status: {subagent.status.value}"

    def cleanup_parent(self, parent_agent_id: str) -> None:
        """Clean up all subagents for a parent agent."""
        subagents = self._subagents.pop(parent_agent_id, [])
        for subagent in subagents:
            if subagent.id in self._background_tasks:
                self._background_tasks[subagent.id].cancel()
                del self._background_tasks[subagent.id]
            if subagent.id in self._subagent_by_id:
                del self._subagent_by_id[subagent.id]

        logger.info("subagents_cleaned_up", parent_agent_id=parent_agent_id, count=len(subagents))


# Global instance
_manager: SubagentManager | None = None


def get_subagent_manager() -> SubagentManager:
    """Get or create the global subagent manager instance."""
    global _manager
    if _manager is None:
        _manager = SubagentManager()
    return _manager
