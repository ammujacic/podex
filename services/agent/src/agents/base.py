"""Base agent class for all specialized agents."""

import json
import re
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

import structlog

from src.database.connection import get_db_context
from src.database.conversation import (
    MessageData,
    load_conversation_history,
    save_message,
    update_agent_status,
)
from src.mcp.integration import get_mcp_tools_as_agent_tools
from src.mcp.registry import MCPToolRegistry
from src.mode_detection import IntentDetector
from src.providers.llm import CompletionRequest
from src.streaming import get_stream_publisher
from src.tools.executor import ToolExecutor

if TYPE_CHECKING:
    from src.providers.llm import LLMProvider

logger = structlog.get_logger()


def _find_json_objects(content: str) -> list[tuple[int, int, dict[str, Any]]]:
    """Find all valid JSON objects in content string.

    Args:
        content: String that may contain JSON objects.

    Returns:
        List of tuples (start_pos, end_pos, parsed_object).
    """
    results = []
    i = 0

    while i < len(content):
        if content[i] == "{":
            # Try to find a matching closing brace
            depth = 0
            start = i
            in_string = False
            escape_next = False
            end_pos = i

            for j in range(i, len(content)):
                char = content[j]
                end_pos = j

                if escape_next:
                    escape_next = False
                    continue

                if char == "\\":
                    escape_next = True
                    continue

                if char == '"' and not escape_next:
                    in_string = not in_string
                    continue

                if in_string:
                    continue

                if char == "{":
                    depth += 1
                elif char == "}":
                    depth -= 1
                    if depth == 0:
                        # Found complete JSON object
                        json_str = content[start : j + 1]
                        try:
                            parsed = json.loads(json_str)
                            if isinstance(parsed, dict):
                                results.append((start, j + 1, parsed))
                        except json.JSONDecodeError:
                            pass
                        break
            i = end_pos + 1 if depth == 0 else i + 1
        else:
            i += 1

    return results


def _extract_json_tool_calls(content: str) -> tuple[list[dict[str, Any]], str]:
    """Extract JSON tool calls from content that local models may output.

    Some models (like Ollama) don't support native tool calling and instead
    output JSON in the content field. This function detects and extracts those.
    Handles both raw JSON and JSON inside markdown code blocks.

    Args:
        content: The response content to parse.

    Returns:
        Tuple of (extracted_tool_calls, remaining_content).
    """
    tool_calls: list[dict[str, Any]] = []
    remaining_content = content

    # First, extract JSON from markdown code blocks (```json ... ``` or ``` ... ```)
    code_block_pattern = r"```(?:json)?\s*(\{[\s\S]*?\})\s*```"
    code_block_matches = list(re.finditer(code_block_pattern, remaining_content))

    # Process code blocks in reverse order to maintain correct positions
    for match in reversed(code_block_matches):
        json_str = match.group(1)
        try:
            parsed = json.loads(json_str)
            if isinstance(parsed, dict) and "name" in parsed:
                tool_call = {
                    "id": f"extracted-{len(tool_calls)}",
                    "name": parsed.get("name"),
                    "arguments": parsed.get("arguments", parsed.get("input", {})),
                }
                tool_calls.append(tool_call)
                # Remove the entire code block from content
                remaining_content = (
                    remaining_content[: match.start()] + remaining_content[match.end() :]
                )
        except json.JSONDecodeError:
            pass

    # Reverse to maintain original order
    tool_calls.reverse()

    # Then find any raw JSON objects (not in code blocks)
    json_objects = _find_json_objects(remaining_content)

    # Sort by position (reverse order for safe removal)
    json_objects.sort(key=lambda x: x[0], reverse=True)

    for start, end, parsed in json_objects:
        # Check if it looks like a tool call (has "name" field)
        if "name" in parsed:
            tool_call = {
                "id": f"extracted-{len(tool_calls)}",
                "name": parsed.get("name"),
                "arguments": parsed.get("arguments", parsed.get("input", {})),
            }
            tool_calls.append(tool_call)
            # Remove this JSON from the content
            remaining_content = remaining_content[:start] + remaining_content[end:]

    # Clean up remaining content
    remaining_content = remaining_content.strip()
    # Remove any leftover artifacts like empty code blocks
    remaining_content = re.sub(r"```json\s*```", "", remaining_content)
    remaining_content = re.sub(r"```\s*```", "", remaining_content)
    remaining_content = remaining_content.strip()

    return tool_calls, remaining_content


@dataclass
class AgentResponse:
    """Agent response structure."""

    content: str
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    tokens_used: int = 0
    message_id: str | None = None


@dataclass
class Tool:
    """Tool definition for agents."""

    name: str
    description: str
    parameters: dict[str, Any]


@dataclass
class ModeSwitchEvent:
    """Event data for mode switch notifications."""

    agent_id: str
    session_id: str | None
    old_mode: str
    new_mode: str
    trigger_phrase: str | None
    reason: str
    auto_revert: bool  # Whether this switch will auto-revert


@dataclass
class AgentConfig:
    """Configuration for initializing an agent."""

    agent_id: str
    model: str
    llm_provider: "LLMProvider"
    workspace_path: str | Path | None = None
    session_id: str | None = None
    mcp_registry: MCPToolRegistry | None = None
    # Agent mode: plan, ask, auto, sovereign
    mode: str = "ask"
    # Previous mode for auto-revert (set when mode was auto-switched)
    previous_mode: str | None = None
    # Allowed command patterns for Auto mode
    command_allowlist: list[str] | None = None
    # User ID for user-scoped operations
    user_id: str | None = None


class BaseAgent(ABC):
    """Base class for all agents."""

    def __init__(self, config: AgentConfig) -> None:
        """Initialize base agent.

        Args:
            config: Agent configuration containing all initialization parameters.
        """
        self.agent_id = config.agent_id
        self.model = config.model
        self.llm_provider = config.llm_provider
        self.session_id = config.session_id
        self.conversation_history: list[dict[str, str]] = []
        self._mcp_registry = config.mcp_registry
        self.mode = config.mode
        self.previous_mode = config.previous_mode  # For auto-revert tracking
        self.command_allowlist = config.command_allowlist or []
        self.user_id = config.user_id
        self.tools = self._get_all_tools()
        # Build system prompt with mode-specific instructions
        base_prompt = self._get_system_prompt()
        mode_instructions = self._get_mode_instructions()
        self.system_prompt = (
            f"{base_prompt}\n\n{mode_instructions}" if mode_instructions else base_prompt
        )

        # Approval callback for Ask/Auto modes - can be set externally
        self._approval_callback: Callable[[dict[str, Any]], Awaitable[None]] | None = None

        # Mode switch callback - can be set externally to notify about auto mode changes
        self._mode_switch_callback: Callable[[ModeSwitchEvent], Awaitable[None]] | None = None

        # Intent detector for automatic mode switching
        self._intent_detector = IntentDetector()

        # Initialize tool executor if workspace is provided
        self.tool_executor: ToolExecutor | None = None
        if config.workspace_path:
            self.tool_executor = ToolExecutor(
                workspace_path=config.workspace_path,
                session_id=config.session_id or config.agent_id,
                mcp_registry=config.mcp_registry,
                agent_id=config.agent_id,
                agent_mode=config.mode,
                command_allowlist=config.command_allowlist,
                approval_callback=self._handle_approval_request,
                user_id=config.user_id,
            )

    def set_approval_callback(self, callback: Callable[[dict[str, Any]], Awaitable[None]]) -> None:
        """Set the approval callback for Ask/Auto modes.

        Args:
            callback: Async callback function to handle approval requests.
        """
        self._approval_callback = callback

    def set_mode_switch_callback(
        self, callback: Callable[[ModeSwitchEvent], Awaitable[None]]
    ) -> None:
        """Set the callback for mode switch notifications.

        Args:
            callback: Async callback function to handle mode switch events.
        """
        self._mode_switch_callback = callback

    async def _check_and_switch_mode(self, message: str) -> tuple[bool, str | None]:
        """Check if mode should switch based on user message.

        Analyzes the user message for intent to switch modes and performs
        the switch if detected. Never auto-switches to sovereign mode.

        Args:
            message: The user message to analyze.

        Returns:
            Tuple of (mode_switched, announcement_message).
        """
        should_switch, result = self._intent_detector.should_switch(message, self.mode)

        if not should_switch:
            return False, None

        target_mode = result.intended_mode.value

        # Safety: Never auto-switch to sovereign (double-check)
        if target_mode == "sovereign":
            logger.warning(
                "Blocked auto-switch to sovereign mode",
                agent_id=self.agent_id,
            )
            return False, None

        # Store previous mode for auto-revert
        old_mode = self.mode
        self.previous_mode = old_mode
        self.mode = target_mode

        # Rebuild system prompt with new mode instructions
        self._update_mode_context()

        # Generate announcement
        announcement = self._generate_mode_switch_announcement(
            old_mode, target_mode, result.trigger_phrase
        )

        logger.info(
            "Auto-switched agent mode",
            agent_id=self.agent_id,
            old_mode=old_mode,
            new_mode=target_mode,
            trigger=result.trigger_phrase,
        )

        # Notify via callback if set
        if self._mode_switch_callback:
            event = ModeSwitchEvent(
                agent_id=self.agent_id,
                session_id=self.session_id,
                old_mode=old_mode,
                new_mode=target_mode,
                trigger_phrase=result.trigger_phrase,
                reason=result.reason or "Intent detected",
                auto_revert=True,  # Auto-switched modes will auto-revert
            )
            try:
                await self._mode_switch_callback(event)
            except Exception as e:
                logger.warning(
                    "Mode switch callback failed",
                    agent_id=self.agent_id,
                    error=str(e),
                )

        return True, announcement

    def _update_mode_context(self) -> None:
        """Update agent context after mode change.

        Rebuilds system prompt with new mode instructions and updates
        tool executor mode if present.
        """
        base_prompt = self._get_system_prompt()
        mode_instructions = self._get_mode_instructions()
        self.system_prompt = (
            f"{base_prompt}\n\n{mode_instructions}" if mode_instructions else base_prompt
        )

        # Refresh tools based on new mode
        self.tools = self._get_all_tools()

        # Update tool executor mode
        if self.tool_executor:
            self.tool_executor.agent_mode = self.mode  # type: ignore[assignment]

    def _generate_mode_switch_announcement(
        self,
        _old_mode: str,
        new_mode: str,
        _trigger_phrase: str | None = None,
    ) -> str:
        """Generate user-friendly mode switch announcement.

        Args:
            old_mode: The previous mode.
            new_mode: The new mode.
            trigger_phrase: The phrase that triggered the switch.

        Returns:
            Announcement message to prepend to response.
        """
        announcements = {
            "plan": "**Switching to Plan mode** to analyze and design this request...",
            "ask": "**Switching to Ask mode** - I'll confirm each action with you...",
            "auto": "**Switching to Auto mode** to implement the changes...",
        }
        return announcements.get(new_mode, f"**Switching to {new_mode.title()} mode...**")

    def _should_revert_mode(self, response_content: str) -> bool:
        """Determine if mode should revert based on task completion.

        Checks if the response indicates the mode-specific task is complete
        and the agent should revert to the previous mode.

        Args:
            response_content: The assistant's response content.

        Returns:
            True if mode should revert.
        """
        if not self.previous_mode:
            return False

        content_lower = response_content.lower()

        # Plan mode: revert after presenting a plan
        if self.mode == "plan":
            plan_indicators = [
                "here's my plan",
                "here is my plan",
                "implementation plan",
                "here's the plan",
                "here is the plan",
                "i propose the following",
                "my recommended approach",
                "step 1:",
                "## plan",
                "# plan",
                "proposed solution",
            ]
            if any(ind in content_lower for ind in plan_indicators):
                return True

        # Auto mode: revert after implementation complete
        if self.mode == "auto":
            completion_indicators = [
                "changes have been made",
                "implementation complete",
                "successfully implemented",
                "all done",
                "changes are complete",
                "i've made the changes",
                "i have made the changes",
                "finished implementing",
                "implementation is complete",
            ]
            if any(ind in content_lower for ind in completion_indicators):
                return True

        return False

    async def _maybe_revert_mode(self, response_content: str) -> tuple[bool, str | None]:
        """Check and perform mode revert if task is complete.

        Args:
            response_content: The assistant's response content.

        Returns:
            Tuple of (reverted, announcement_message).
        """
        if not self._should_revert_mode(response_content):
            return False, None

        old_mode = self.mode
        self.mode = self.previous_mode or self.mode  # Fallback to current mode if None
        self.previous_mode = None

        # Rebuild context for reverted mode
        self._update_mode_context()

        announcement = f"\n\n*Returning to {self.mode.title()} mode.*"

        logger.info(
            "Auto-reverted agent mode",
            agent_id=self.agent_id,
            from_mode=old_mode,
            to_mode=self.mode,
        )

        # Notify via callback if set
        if self._mode_switch_callback:
            event = ModeSwitchEvent(
                agent_id=self.agent_id,
                session_id=self.session_id,
                old_mode=old_mode,
                new_mode=self.mode,
                trigger_phrase=None,
                reason="Task completed, reverting to previous mode",
                auto_revert=False,  # This IS the revert, no further revert expected
            )
            try:
                await self._mode_switch_callback(event)
            except Exception as e:
                logger.warning(
                    "Mode revert callback failed",
                    agent_id=self.agent_id,
                    error=str(e),
                )

        return True, announcement

    async def _handle_approval_request(self, approval_data: dict[str, Any]) -> None:
        """Handle approval request from tool executor.

        Args:
            approval_data: Data about the action requiring approval.
        """
        if self._approval_callback:
            await self._approval_callback(approval_data)
        else:
            logger.warning(
                "No approval callback set for agent",
                agent_id=self.agent_id,
                mode=self.mode,
            )

    @abstractmethod
    def _get_system_prompt(self) -> str:
        """Get the system prompt for this agent type."""
        pass

    @abstractmethod
    def _get_tools(self) -> list[Tool]:
        """Get built-in tools for this agent type."""
        pass

    def _get_mode_instructions(self) -> str:
        """Get mode-specific instructions to append to the system prompt.

        Returns instructions based on the agent's operating mode to help
        the agent behave appropriately.

        Returns:
            Mode-specific instruction string.
        """
        mode_instructions = {
            "plan": """
## Operating Mode: Plan (Read-Only)

You are in PLAN mode. Your role is to analyze, understand, and create detailed plans.

IMPORTANT CONSTRAINTS:
- You CANNOT modify any files
- You CANNOT execute any commands
- You CAN read files to understand the codebase

YOUR TASK:
1. Analyze the user's request thoroughly
2. Explore the codebase to understand relevant code, patterns, and dependencies
3. Create a detailed, step-by-step implementation plan
4. Explain what changes would be needed and why
5. Identify potential risks or considerations
6. Wait for user approval before any changes can be made

When presenting your plan:
- Be specific about which files need to be modified
- Explain the reasoning behind each change
- Consider edge cases and potential issues
- Provide alternatives if applicable

The user will review your plan and either approve it (switching to a mode that allows
edits) or ask for refinements.
""",
            "ask": """
## Operating Mode: Ask (Approval Required)

You are in ASK mode. You have full capabilities, but every file edit and command
execution requires explicit user approval.

IMPORTANT:
- Before each file modification, explain what you want to change and why
- Before each command execution, explain what the command does
- Wait for user approval before proceeding
- If approval is denied, respect the decision and suggest alternatives

Be thorough in your explanations so users can make informed decisions about approving your actions.
""",
            "auto": """
## Operating Mode: Auto (Autonomous with Limits)

You are in AUTO mode. You can automatically edit files without approval.

COMMAND EXECUTION:
- Some commands are pre-approved and will execute automatically
- New or unrecognized commands will require user approval
- When a command needs approval, the user may choose to add it to your allowlist for future use

Work efficiently but be mindful that unexpected commands will pause for user review.
""",
            "sovereign": """
## Operating Mode: Sovereign (Full Autonomy)

You are in SOVEREIGN mode with full autonomy. You can:
- Read and modify any files
- Execute any commands
- Make decisions independently

Use this power responsibly:
- Still explain your reasoning to the user
- Be careful with destructive operations
- Consider the consequences of your actions
- Keep the user informed of significant changes
""",
        }

        return mode_instructions.get(self.mode, "")

    def _get_all_tools(self) -> list[Tool]:
        """Get all tools including MCP tools, filtered by mode.

        Combines built-in tools from _get_tools() with MCP tools from the registry.
        MCP tools use qualified naming: "mcp:{server}:{tool}" to prevent conflicts.

        In Plan mode, write and command tools are filtered out so the agent
        cannot attempt to use them.

        Returns:
            Combined list of built-in and MCP tools (filtered by mode).
        """
        tools = self._get_tools()

        if self._mcp_registry:
            mcp_tools = get_mcp_tools_as_agent_tools(self._mcp_registry)
            tools = tools + mcp_tools
            logger.debug(
                "Added MCP tools to agent",
                agent_id=self.agent_id,
                builtin_tools=len(self._get_tools()),
                mcp_tools=len(mcp_tools),
                total_tools=len(tools),
            )

        # In Plan mode, filter out write and command tools
        if self.mode == "plan":
            # Tools that modify files or execute commands
            blocked_patterns = [
                "write",
                "create",
                "delete",
                "move",
                "rename",
                "command",
                "execute",
                "run",
                "terminal",
                "git_commit",
                "git_push",
                "git_checkout",
            ]
            original_count = len(tools)
            tools = [
                tool
                for tool in tools
                if not any(pattern in tool.name.lower() for pattern in blocked_patterns)
            ]
            if len(tools) < original_count:
                logger.info(
                    "Filtered tools for Plan mode",
                    agent_id=self.agent_id,
                    original_count=original_count,
                    filtered_count=len(tools),
                    mode=self.mode,
                )

        return tools

    async def load_conversation_history(self, limit: int = 50) -> None:
        """Load conversation history from the database.

        Args:
            limit: Maximum number of messages to load.
        """
        try:
            async with get_db_context() as db:
                self.conversation_history = await load_conversation_history(
                    db,
                    self.agent_id,
                    limit,
                )
                logger.info(
                    "Loaded conversation history",
                    agent_id=self.agent_id,
                    message_count=len(self.conversation_history),
                )
        except Exception as e:
            logger.error(
                "Failed to load conversation history",
                agent_id=self.agent_id,
                error=str(e),
            )
            # Continue with empty history on error
            self.conversation_history = []

    async def save_message(
        self,
        role: str,
        content: str,
        tool_calls: dict[str, Any] | None = None,
        tokens_used: int | None = None,
    ) -> str | None:
        """Save a message to the database.

        Args:
            role: Message role ('user', 'assistant', 'system')
            content: Message content
            tool_calls: Optional tool calls
            tokens_used: Optional token count

        Returns:
            Message ID if saved successfully, None otherwise
        """
        try:
            async with get_db_context() as db:
                message_data = MessageData(
                    role=role,
                    content=content,
                    tool_calls=tool_calls,
                    tokens_used=tokens_used,
                )
                message = await save_message(db, self.agent_id, message_data)
                return message.id
        except Exception as e:
            logger.error(
                "Failed to save message",
                agent_id=self.agent_id,
                role=role,
                error=str(e),
            )
            return None

    async def update_status(self, status: str) -> None:
        """Update agent status in the database.

        Args:
            status: New status ('idle', 'active', 'error')
        """
        try:
            async with get_db_context() as db:
                await update_agent_status(db, self.agent_id, status)
        except Exception as e:
            logger.error(
                "Failed to update agent status",
                agent_id=self.agent_id,
                status=status,
                error=str(e),
            )

    async def execute(
        self,
        message: str,
        _context: dict[str, Any] | None = None,
        persist: bool = True,
    ) -> AgentResponse:
        """Execute agent with a message.

        Args:
            message: User message to process
            context: Optional context dictionary
            persist: Whether to persist messages to database

        Returns:
            AgentResponse with content, tool calls, and token usage
        """
        # Check for automatic mode switching based on user message intent
        mode_switched, switch_announcement = await self._check_and_switch_mode(message)

        # Update status to active
        if persist:
            await self.update_status("active")

        # Save user message to database
        if persist:
            await self.save_message("user", message)

        # Add user message to history
        self.conversation_history.append({"role": "user", "content": message})

        # Build messages for LLM (system prompt may have changed after mode switch)
        messages = [
            {"role": "system", "content": self.system_prompt},
            *self.conversation_history,
        ]

        # Convert tools to API format
        tools_api = [
            {
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.parameters,
            }
            for tool in self.tools
        ]

        try:
            # Call LLM
            request = CompletionRequest(
                model=self.model,
                messages=messages,
                tools=tools_api if tools_api else None,
            )
            response = await self.llm_provider.complete(request)

            content = response.get("content", "")
            tool_calls = response.get("tool_calls", [])
            tokens_used = response.get("usage", {}).get("total_tokens", 0)

            # Check for JSON tool calls in content (some models like Ollama
            # output JSON directly instead of using proper tool_calls)
            if not tool_calls and content:
                extracted_calls, remaining_content = _extract_json_tool_calls(content)
                if extracted_calls:
                    tool_calls = extracted_calls
                    logger.info(
                        "Extracted JSON tool calls from content",
                        agent_id=self.agent_id,
                        tool_count=len(extracted_calls),
                    )
                    # Keep any remaining non-JSON content
                    content = remaining_content

            # Process tool calls if any
            processed_tool_calls = []
            for tool_call in tool_calls:
                result = await self._execute_tool(tool_call)
                processed_tool_calls.append(
                    {
                        "name": tool_call.get("name"),
                        "arguments": tool_call.get("arguments"),
                        "result": result,
                    },
                )

            # Generate user-friendly response if we only have tool calls
            if processed_tool_calls and not content:
                content = self._generate_tool_response(processed_tool_calls)

            # Check for auto-revert after task completion
            reverted, revert_announcement = await self._maybe_revert_mode(content)

            # Build final content with announcements
            final_content = content
            if mode_switched and switch_announcement:
                final_content = f"{switch_announcement}\n\n{final_content}"
            if reverted and revert_announcement:
                final_content = f"{final_content}{revert_announcement}"

            # Add assistant response to history
            self.conversation_history.append({"role": "assistant", "content": final_content})

            # Save assistant message to database
            assistant_message_id = None
            if persist:
                tool_calls_dict = {"calls": processed_tool_calls} if processed_tool_calls else None
                assistant_message_id = await self.save_message(
                    "assistant",
                    final_content,
                    tool_calls_dict,
                    tokens_used,
                )
                await self.update_status("idle")

            return AgentResponse(
                content=final_content,
                tool_calls=processed_tool_calls,
                tokens_used=tokens_used,
                message_id=assistant_message_id,
            )

        except Exception as e:
            logger.error("Agent execution failed", agent_id=self.agent_id, error=str(e))
            if persist:
                await self.update_status("error")
            raise

    async def execute_streaming(
        self,
        message: str,
        message_id: str,
        _context: dict[str, Any] | None = None,
        persist: bool = True,
    ) -> AgentResponse:
        """Execute agent with streaming token output via Redis Pub/Sub.

        This method streams LLM tokens to Redis as they are generated,
        allowing real-time display in the frontend.

        Args:
            message: User message to process
            message_id: Pre-generated message ID for tracking the stream
            context: Optional context dictionary
            persist: Whether to persist messages to database

        Returns:
            AgentResponse with complete content, tool calls, and token usage
        """
        # Get stream publisher
        publisher = get_stream_publisher()
        await publisher.connect()

        # Check for automatic mode switching based on user message intent
        mode_switched, switch_announcement = await self._check_and_switch_mode(message)

        # Update status to active
        if persist:
            await self.update_status("active")

        # Save user message to database
        if persist:
            await self.save_message("user", message)

        # Add user message to history
        self.conversation_history.append({"role": "user", "content": message})

        # Build messages for LLM (system prompt may have changed after mode switch)
        messages = [
            {"role": "system", "content": self.system_prompt},
            *self.conversation_history,
        ]

        # Convert tools to API format
        tools_api = [
            {
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.parameters,
            }
            for tool in self.tools
        ]

        try:
            # Create completion request
            request = CompletionRequest(
                model=self.model,
                messages=messages,
                tools=tools_api if tools_api else None,
            )

            # Emit stream start
            await publisher.publish_start(
                session_id=self.session_id or "",
                agent_id=self.agent_id,
                message_id=message_id,
            )

            # Accumulate content and tool calls during streaming
            content_parts: list[str] = []
            tool_calls: list[dict[str, Any]] = []
            tokens_used = 0
            current_tool_calls: dict[str, dict[str, Any]] = {}  # Track in-progress tool calls

            # Stream from LLM
            async for event in self.llm_provider.complete_stream(request):
                if event.type == "token":
                    # Emit token to Redis
                    await publisher.publish_stream_event(
                        session_id=self.session_id or "",
                        agent_id=self.agent_id,
                        message_id=message_id,
                        event=event,
                    )
                    content_parts.append(event.content or "")

                elif event.type == "tool_call_start":
                    # Track tool call and emit start event
                    if event.tool_call_id:
                        current_tool_calls[event.tool_call_id] = {
                            "id": event.tool_call_id,
                            "name": event.tool_name,
                            "arguments": {},
                        }
                    await publisher.publish_stream_event(
                        session_id=self.session_id or "",
                        agent_id=self.agent_id,
                        message_id=message_id,
                        event=event,
                    )

                elif event.type == "tool_call_end":
                    # Complete tool call tracking and emit end event
                    if event.tool_call_id and event.tool_call_id in current_tool_calls:
                        current_tool_calls[event.tool_call_id]["arguments"] = event.tool_input
                        tool_calls.append(current_tool_calls[event.tool_call_id])
                    await publisher.publish_stream_event(
                        session_id=self.session_id or "",
                        agent_id=self.agent_id,
                        message_id=message_id,
                        event=event,
                    )

                elif event.type == "done":
                    # Capture usage stats
                    if event.usage:
                        tokens_used = event.usage.get("total_tokens", 0)

                elif event.type == "error":
                    # Emit error and raise
                    await publisher.publish_error(
                        session_id=self.session_id or "",
                        agent_id=self.agent_id,
                        message_id=message_id,
                        error=event.error or "Unknown streaming error",
                    )
                    raise RuntimeError(event.error or "Unknown streaming error")

            # Combine content
            content = "".join(content_parts)

            # Check for JSON tool calls in content (some models like Ollama
            # output JSON directly instead of using proper tool_calls)
            if not tool_calls and content:
                extracted_calls, remaining_content = _extract_json_tool_calls(content)
                if extracted_calls:
                    tool_calls = extracted_calls
                    logger.info(
                        "Extracted JSON tool calls from streaming content",
                        agent_id=self.agent_id,
                        tool_count=len(extracted_calls),
                    )
                    content = remaining_content

            # Process tool calls if any
            processed_tool_calls = []
            for tool_call in tool_calls:
                result = await self._execute_tool(tool_call)
                processed_tool_calls.append(
                    {
                        "name": tool_call.get("name"),
                        "arguments": tool_call.get("arguments"),
                        "result": result,
                    },
                )

            # Generate user-friendly response if we only have tool calls
            if processed_tool_calls and not content:
                content = self._generate_tool_response(processed_tool_calls)

            # Check for auto-revert after task completion
            reverted, revert_announcement = await self._maybe_revert_mode(content)

            # Build final content with announcements
            final_content = content
            if mode_switched and switch_announcement:
                final_content = f"{switch_announcement}\n\n{final_content}"
            if reverted and revert_announcement:
                final_content = f"{final_content}{revert_announcement}"

            # Emit stream done with full content
            await publisher.publish_done(
                session_id=self.session_id or "",
                agent_id=self.agent_id,
                message_id=message_id,
                full_content=final_content,
                usage={"total_tokens": tokens_used},
            )

            # Add assistant response to history
            self.conversation_history.append({"role": "assistant", "content": final_content})

            # Save assistant message to database
            if persist:
                tool_calls_dict = {"calls": processed_tool_calls} if processed_tool_calls else None
                await self.save_message(
                    "assistant",
                    final_content,
                    tool_calls_dict,
                    tokens_used,
                )
                await self.update_status("idle")

            return AgentResponse(
                content=final_content,
                tool_calls=processed_tool_calls,
                tokens_used=tokens_used,
                message_id=message_id,
            )

        except Exception as e:
            logger.error(
                "Agent streaming execution failed",
                agent_id=self.agent_id,
                error=str(e),
            )
            # Emit error event
            await publisher.publish_error(
                session_id=self.session_id or "",
                agent_id=self.agent_id,
                message_id=message_id,
                error=str(e),
            )
            if persist:
                await self.update_status("error")
            raise

    async def _execute_tool(self, tool_call: dict[str, Any]) -> str:
        """Execute a tool call.

        Args:
            tool_call: Tool call dictionary with name and arguments.

        Returns:
            Tool execution result as a string.
        """
        tool_name = tool_call.get("name", "")
        arguments = tool_call.get("arguments", {})

        logger.info("Executing tool", tool_name=tool_name, agent_id=self.agent_id)

        if self.tool_executor:
            return await self.tool_executor.execute(tool_name, arguments)

        # Fallback if no tool executor configured
        logger.warning(
            "No tool executor configured",
            tool_name=tool_name,
            agent_id=self.agent_id,
        )
        return '{"success": false, "error": "Tool executor not configured"}'

    def _generate_tool_response(self, tool_calls: list[dict[str, Any]]) -> str:
        """Generate a user-friendly response describing tool execution.

        This is used when the model outputs only tool calls without any
        natural language explanation.

        Args:
            tool_calls: List of processed tool calls with results.

        Returns:
            Human-readable description of what was done.
        """
        if not tool_calls:
            return "I've processed your request."

        # Build a friendly response based on the tool calls
        responses = []
        for call in tool_calls:
            tool_name = call.get("name", "unknown")
            result = call.get("result", "")

            # Try to parse the result for more context
            try:
                result_data = json.loads(result) if isinstance(result, str) else result
                success = result_data.get("success", True)
                error = result_data.get("error")

                if error:
                    responses.append(
                        f"Attempted to use {tool_name} but encountered an error: {error}"
                    )
                elif success:
                    # Generate tool-specific friendly messages
                    if "read_file" in tool_name:
                        file_path = call.get("arguments", {}).get("path", "file")
                        responses.append(f"Read the contents of {file_path}")
                    elif "write_file" in tool_name:
                        file_path = call.get("arguments", {}).get("path", "file")
                        responses.append(f"Wrote to {file_path}")
                    elif "execute_command" in tool_name or "run_command" in tool_name:
                        cmd = call.get("arguments", {}).get("command", "command")
                        responses.append(f"Executed: {cmd}")
                    elif "search" in tool_name:
                        query = call.get("arguments", {}).get("query", "")
                        responses.append(f"Searched for: {query}")
                    elif "create" in tool_name.lower():
                        responses.append(f"Created using {tool_name}")
                    elif "plan" in tool_name.lower():
                        responses.append("Created an execution plan for the task")
                    else:
                        responses.append(f"Executed {tool_name}")
            except (json.JSONDecodeError, TypeError, AttributeError):
                responses.append(f"Executed {tool_name}")

        if len(responses) == 1:
            return responses[0] + "."
        else:
            return "I've completed the following:\n• " + "\n• ".join(responses)

    def reset_conversation(self) -> None:
        """Reset conversation history."""
        self.conversation_history = []
