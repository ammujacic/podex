"""Base agent class for all specialized agents."""

import json
import re
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

import structlog

from podex_shared import TokenUsageParams, get_usage_tracker
from src.context.manager import get_context_manager
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
from src.tools.memory_tools import get_knowledge_base, get_retriever

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
    # Workspace container ID for remote execution
    # When set, file/command/git tools execute on the workspace container
    workspace_id: str | None = None
    # User-provided LLM API keys (e.g., {"anthropic": "sk-ant-...", "openai": "sk-..."})
    # These are used when the user wants to use their own API keys instead of platform keys
    llm_api_keys: dict[str, str] | None = None
    # Model's registered provider from database (e.g., "anthropic", "openai")
    # This takes precedence over guessing from model name
    model_provider: str | None = None


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
        # LLM API keys and model provider for routing to correct provider
        self.llm_api_keys = config.llm_api_keys
        self.model_provider = config.model_provider
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
        self.workspace_id = config.workspace_id
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
                workspace_id=config.workspace_id,
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

        # Update tool executor mode (convert string to AgentMode enum)
        if self.tool_executor:
            from src.tools.executor import AgentMode

            self.tool_executor.agent_mode = AgentMode(self.mode.lower())

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
        and the agent should revert to the previous mode. Uses regex patterns
        anchored to sentence boundaries to reduce false positives.

        Args:
            response_content: The assistant's response content.

        Returns:
            True if mode should revert.
        """
        if not self.previous_mode:
            return False

        content_lower = response_content.lower()

        # Plan mode: revert after presenting a plan
        # Use regex to match at sentence boundaries (start of line or after punctuation)
        if self.mode == "plan":
            plan_patterns = [
                # Plan presentation phrases at sentence start
                r"(?:^|[.!?]\s*)here(?:'s| is) (?:my |the )?plan\b",
                r"(?:^|[.!?]\s*)(?:implementation|proposed) plan\b",
                r"(?:^|[.!?]\s*)i propose the following\b",
                r"(?:^|[.!?]\s*)my recommended approach\b",
                r"(?:^|[.!?]\s*)proposed solution\b",
                # Numbered steps (strong indicator of plan)
                r"(?:^|[.!?\n]\s*)(?:step|phase) 1[.:]\s",
                # Markdown headers indicating plan
                r"(?:^|\n)#{1,3}\s*plan\b",
                r"(?:^|\n)#{1,3}\s*implementation plan\b",
            ]
            for pattern in plan_patterns:
                if re.search(pattern, content_lower, re.MULTILINE | re.IGNORECASE):
                    return True

        # Auto mode: revert after implementation complete
        # Be more conservative - look for explicit completion statements
        if self.mode == "auto":
            completion_patterns = [
                # Explicit completion statements at sentence start
                r"(?:^|[.!?]\s*)(?:the )?changes have been (?:made|applied|committed)\b",
                r"(?:^|[.!?]\s*)implementation (?:is )?complete\b",
                r"(?:^|[.!?]\s*)successfully (?:implemented|completed|applied)\b",
                r"(?:^|[.!?]\s*)(?:all done|all changes (?:are )?complete)\b",
                r"(?:^|[.!?]\s*)i(?:'ve| have) (?:made|completed|finished|applied) "
                r"(?:the |all )?changes\b",
                r"(?:^|[.!?]\s*)finished implementing\b",
                # Strong completion signals
                r"(?:^|[.!?]\s*)everything (?:is )?(?:set up|configured|ready|complete)\b",
            ]
            for pattern in completion_patterns:
                if re.search(pattern, content_lower, re.MULTILINE | re.IGNORECASE):
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

You are in AUTO mode. You can automatically edit files and call tools without approval.

IMPORTANT - ACT, DON'T ANNOUNCE:
- DO NOT say "I will use X tool" - just use it directly
- DO NOT announce your intentions before acting - just act
- Call tools immediately when needed instead of describing what you plan to do
- Be efficient: tool calls execute automatically, so use them without preamble

COMMAND EXECUTION:
- Some commands are pre-approved and will execute automatically
- New or unrecognized commands will require user approval
- When a command needs approval, the user may choose to add it to your allowlist

Work efficiently and take action directly. The user chose Auto mode because they
want things done, not described.
""",
            "sovereign": """
## Operating Mode: Sovereign (Full Autonomy)

You are in SOVEREIGN mode with full autonomy. You can:
- Read and modify any files
- Execute any commands without approval
- Make decisions and take action independently

IMPORTANT - ACT, DON'T ANNOUNCE:
- DO NOT say "I will use X tool" - just use it directly
- Call tools immediately when needed instead of describing intentions
- Be efficient: all tools execute automatically, so use them without preamble

Use this power responsibly:
- Be careful with destructive operations
- After completing actions, briefly summarize what was done
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

    async def _get_memory_context(self, current_message: str) -> str | None:
        """Retrieve relevant memories and format them as context.

        Args:
            current_message: The current user message for relevance matching

        Returns:
            Formatted memory context string, or None if no memories found
        """
        if not self.session_id or not self.user_id:
            return None

        try:
            kb = get_knowledge_base()
            memories = await kb.get_relevant_context(
                session_id=self.session_id,
                user_id=self.user_id,
                current_message=current_message,
                limit=5,
            )

            if not memories:
                return None

            # Format memories into context
            memory_lines = []
            for mem in memories:
                mem_type = (
                    mem.memory_type.value if hasattr(mem.memory_type, "value") else mem.memory_type
                )
                memory_lines.append(f"- [{mem_type}] {mem.content}")

            context = "\n".join(memory_lines)
            logger.debug(
                "Retrieved memory context",
                agent_id=self.agent_id,
                memory_count=len(memories),
            )

            return f"""
## Relevant Memories

The following information has been remembered from previous interactions:

{context}

Use this context to provide more personalized and consistent responses.
"""
        except Exception as e:
            logger.warning(
                "Failed to retrieve memory context",
                agent_id=self.agent_id,
                error=str(e),
            )
            return None

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

        # Retrieve relevant memories and build enhanced system prompt
        memory_context = await self._get_memory_context(message)
        enhanced_prompt = self.system_prompt
        if memory_context:
            enhanced_prompt = f"{self.system_prompt}\n{memory_context}"

        # Build messages for LLM (system prompt may have changed after mode switch)
        messages = [
            {"role": "system", "content": enhanced_prompt},
            *self.conversation_history,
        ]

        # Use context manager to prepare messages (handle trimming/summarization)
        context_manager = get_context_manager()
        if context_manager:
            try:
                messages, _total_tokens = await context_manager.prepare_context(
                    agent_id=self.agent_id,
                    messages=self.conversation_history,
                    system_prompt=enhanced_prompt,
                )
                # Re-add system prompt as first message (prepare_context returns just conversation)
                messages = [
                    {"role": "system", "content": enhanced_prompt},
                    *messages,
                ]
            except Exception as ctx_err:
                logger.warning(
                    "Context preparation failed, using full history",
                    agent_id=self.agent_id,
                    error=str(ctx_err),
                )

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
                llm_api_keys=self.llm_api_keys,
                model_provider=self.model_provider,
            )
            response = await self.llm_provider.complete(request)

            content = response.get("content", "")
            tool_calls = response.get("tool_calls", [])
            usage = response.get("usage", {})
            tokens_used = usage.get("total_tokens", 0)
            input_tokens = usage.get("input_tokens", 0)
            output_tokens = usage.get("output_tokens", 0)

            # Track usage for billing (works for all providers including local)
            if self.user_id and (input_tokens > 0 or output_tokens > 0):
                tracker = get_usage_tracker()
                if tracker:
                    try:
                        # Use resolved provider (model_provider from API) not config default.
                        # Config default (llm_provider.provider) is e.g. ollama; when using
                        # Anthropic OAuth we resolve to anthropic and must report external.
                        # vertex = included, ollama/lmstudio = local, anthropic/openai = external
                        provider = self.model_provider or self.llm_provider.provider
                        if provider in ("ollama", "lmstudio"):
                            usage_source = "local"
                        elif provider == "vertex":
                            usage_source = "included"
                        else:
                            usage_source = "external"

                        params = TokenUsageParams(
                            user_id=self.user_id,
                            model=self.model,
                            input_tokens=input_tokens,
                            output_tokens=output_tokens,
                            session_id=self.session_id,
                            agent_id=self.agent_id,
                            metadata={"streaming": False},
                            usage_source=usage_source,
                        )
                        await tracker.record_token_usage(params)
                    except Exception:
                        logger.exception("Failed to track non-streaming usage")

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
                    # Keep non-JSON content, or empty string if entirely JSON tool calls
                    content = remaining_content if remaining_content.strip() else ""

            # Process tool calls if any
            processed_tool_calls = []
            for i, tool_call in enumerate(tool_calls):
                result = await self._execute_tool(tool_call)
                processed_tool_calls.append(
                    {
                        "id": tool_call.get("id", f"tc-{i}"),
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

            # Auto-extract memories from the conversation turn
            if self.session_id and self.user_id:
                try:
                    retriever = get_retriever()
                    extracted = await retriever.auto_extract_memories(
                        session_id=self.session_id,
                        user_id=self.user_id,
                        message=message,
                        response=final_content,
                    )
                    if extracted:
                        logger.info(
                            "Auto-extracted memories from conversation",
                            agent_id=self.agent_id,
                            session_id=self.session_id,
                            memories_extracted=len(extracted),
                        )
                except Exception as mem_err:
                    # Don't fail execution if memory extraction fails
                    logger.warning(
                        "Failed to auto-extract memories",
                        agent_id=self.agent_id,
                        error=str(mem_err),
                    )

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

        # Retrieve relevant memories and build enhanced system prompt
        memory_context = await self._get_memory_context(message)
        enhanced_prompt = self.system_prompt
        if memory_context:
            enhanced_prompt = f"{self.system_prompt}\n{memory_context}"

        # Build messages for LLM (system prompt may have changed after mode switch)
        messages = [
            {"role": "system", "content": enhanced_prompt},
            *self.conversation_history,
        ]

        # Use context manager to prepare messages (handle trimming/summarization)
        context_manager = get_context_manager()
        if context_manager:
            try:
                messages, _total_tokens = await context_manager.prepare_context(
                    agent_id=self.agent_id,
                    messages=self.conversation_history,
                    system_prompt=enhanced_prompt,
                )
                # Re-add system prompt as first message (prepare_context returns just conversation)
                messages = [
                    {"role": "system", "content": enhanced_prompt},
                    *messages,
                ]
            except Exception as ctx_err:
                logger.warning(
                    "Context preparation failed, using full history",
                    agent_id=self.agent_id,
                    error=str(ctx_err),
                )

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
                llm_api_keys=self.llm_api_keys,
                model_provider=self.model_provider,
            )

            # Emit stream start
            await publisher.publish_start(
                session_id=self.session_id or "",
                agent_id=self.agent_id,
                message_id=message_id,
            )

            # Accumulate content and tool calls during streaming
            content_parts: list[str] = []
            thinking_parts: list[str] = []  # Accumulate thinking tokens separately
            tool_calls: list[dict[str, Any]] = []
            tokens_used = 0
            input_tokens = 0
            output_tokens = 0
            current_tool_calls: dict[str, dict[str, Any]] = {}  # Track in-progress tool calls

            # Stream from LLM with resilient Redis publishing
            # Redis failures should not crash the entire streaming operation
            async def _safe_publish(event_data: dict[str, Any]) -> None:
                """Publish to Redis, logging errors but not failing the stream."""
                try:
                    await publisher.publish_stream_event(**event_data)
                except Exception as publish_error:
                    event_obj = event_data.get("event")
                    event_type = getattr(event_obj, "type", "unknown") if event_obj else "unknown"
                    logger.warning(
                        "Failed to publish stream event to Redis, continuing",
                        agent_id=self.agent_id,
                        message_id=message_id,
                        event_type=event_type,
                        error=str(publish_error),
                    )

            async for event in self.llm_provider.complete_stream(request):
                if event.type == "token":
                    # Emit token to Redis (best-effort, don't fail on Redis errors)
                    await _safe_publish(
                        {
                            "session_id": self.session_id or "",
                            "agent_id": self.agent_id,
                            "message_id": message_id,
                            "event": event,
                        }
                    )
                    content_parts.append(event.content or "")

                elif event.type == "thinking":
                    # Emit thinking token to Redis (best-effort)
                    await _safe_publish(
                        {
                            "session_id": self.session_id or "",
                            "agent_id": self.agent_id,
                            "message_id": message_id,
                            "event": event,
                        }
                    )
                    thinking_parts.append(event.content or "")

                elif event.type == "tool_call_start":
                    # Track tool call and emit start event
                    if event.tool_call_id:
                        current_tool_calls[event.tool_call_id] = {
                            "id": event.tool_call_id,
                            "name": event.tool_name,
                            "arguments": {},
                        }
                    await _safe_publish(
                        {
                            "session_id": self.session_id or "",
                            "agent_id": self.agent_id,
                            "message_id": message_id,
                            "event": event,
                        }
                    )

                elif event.type == "tool_call_end":
                    # Complete tool call tracking and emit end event
                    if event.tool_call_id and event.tool_call_id in current_tool_calls:
                        current_tool_calls[event.tool_call_id]["arguments"] = event.tool_input
                        tool_calls.append(current_tool_calls[event.tool_call_id])
                    await _safe_publish(
                        {
                            "session_id": self.session_id or "",
                            "agent_id": self.agent_id,
                            "message_id": message_id,
                            "event": event,
                        }
                    )

                elif event.type == "done":
                    # Capture usage stats
                    if event.usage:
                        tokens_used = event.usage.get("total_tokens", 0)
                        input_tokens = event.usage.get("input_tokens", 0)
                        output_tokens = event.usage.get("output_tokens", 0)

                    # Track usage for billing (works for all providers including local)
                    if self.user_id and (input_tokens > 0 or output_tokens > 0):
                        tracker = get_usage_tracker()
                        if tracker:
                            try:
                                # Use resolved provider (model_provider from API),
                                # not config default. vertex = included, ollama/lmstudio = local,
                                # anthropic/openai = external
                                provider = self.model_provider or self.llm_provider.provider
                                if provider in ("ollama", "lmstudio"):
                                    usage_source = "local"
                                elif provider == "vertex":
                                    usage_source = "included"
                                else:
                                    usage_source = "external"

                                params = TokenUsageParams(
                                    user_id=self.user_id,
                                    model=self.model,
                                    input_tokens=input_tokens,
                                    output_tokens=output_tokens,
                                    session_id=self.session_id,
                                    agent_id=self.agent_id,
                                    metadata={"streaming": True},
                                    usage_source=usage_source,
                                )
                                await tracker.record_token_usage(params)
                            except Exception:
                                logger.exception("Failed to track streaming usage")

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
                    # Keep non-JSON content, or empty string if entirely JSON tool calls
                    content = remaining_content if remaining_content.strip() else ""

            # Process tool calls if any
            processed_tool_calls = []
            for i, tool_call in enumerate(tool_calls):
                result = await self._execute_tool(tool_call)
                processed_tool_calls.append(
                    {
                        "id": tool_call.get("id", f"tc-{i}"),
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

            # Emit stream done with full content and tool calls
            await publisher.publish_done(
                session_id=self.session_id or "",
                agent_id=self.agent_id,
                message_id=message_id,
                full_content=final_content,
                usage={"total_tokens": tokens_used},
                tool_calls=processed_tool_calls if processed_tool_calls else None,
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

            # Auto-extract memories from the conversation turn
            if self.session_id and self.user_id:
                try:
                    retriever = get_retriever()
                    extracted = await retriever.auto_extract_memories(
                        session_id=self.session_id,
                        user_id=self.user_id,
                        message=message,
                        response=final_content,
                    )
                    if extracted:
                        logger.info(
                            "Auto-extracted memories from streaming conversation",
                            agent_id=self.agent_id,
                            session_id=self.session_id,
                            memories_extracted=len(extracted),
                        )
                except Exception as mem_err:
                    # Don't fail execution if memory extraction fails
                    logger.warning(
                        "Failed to auto-extract memories from streaming",
                        agent_id=self.agent_id,
                        error=str(mem_err),
                    )

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
