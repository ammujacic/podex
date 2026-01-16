"""Tool executor for agents."""

from __future__ import annotations

import asyncio
import fnmatch
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import TYPE_CHECKING, Any, cast

import structlog

from src.config import settings
from src.mcp.integration import extract_mcp_qualified_name, is_mcp_tool_name

if TYPE_CHECKING:
    from src.mcp.registry import MCPToolRegistry


class AgentMode(str, Enum):
    """Agent operation modes with different permission levels."""

    PLAN = "plan"  # Read-only: no file edits, no commands
    ASK = "ask"  # Requires approval for file edits and commands
    AUTO = "auto"  # Auto file edits, commands require allowlist or approval
    SOVEREIGN = "sovereign"  # Full access: all operations allowed


# Tool categories for permission checking
WRITE_TOOLS = {
    "write_file",
    "create_file",
    "delete_file",
    "apply_patch",
    "git_commit",
    "git_push",
    "create_pr",
}
COMMAND_TOOLS = {"run_command"}
READ_TOOLS = {
    "read_file",
    "list_directory",
    "search_code",
    "glob_files",
    "grep",
    "fetch_url",
    "git_status",
    "git_diff",
    "git_log",
    "git_branch",
}


@dataclass
class PermissionResult:
    """Result of a permission check."""

    allowed: bool
    error: str | None = None
    requires_approval: bool = False
    can_add_to_allowlist: bool = False  # For Auto mode command approval


from src.tools.agent_builder_tools import (  # noqa: E402
    AgentTemplateConfig,
    AgentTemplatePreviewConfig,
    create_agent_template,
    list_available_tools,
    preview_agent_template,
)
from src.tools.command_tools import run_command  # noqa: E402
from src.tools.deploy_tools import (  # noqa: E402
    DeployPreviewConfig,
    E2ETestConfig,
    deploy_preview,
    get_preview_status,
    run_e2e_tests,
    stop_preview,
)
from src.tools.file_tools import (  # noqa: E402
    apply_patch,
    glob_files,
    grep,
    list_directory,
    read_file,
    search_code,
    write_file,
)
from src.tools.file_tools import (  # noqa: E402
    fetch_url as file_fetch_url,
)
from src.tools.git_tools import (  # noqa: E402
    create_pr,
    git_branch,
    git_commit,
    git_diff,
    git_log,
    git_push,
    git_status,
)
from src.tools.memory_tools import (  # noqa: E402
    RecallMemoryParams,
    StoreMemoryParams,
    delete_memory,
    get_session_memories,
    recall_memory,
    store_memory,
    update_memory,
)
from src.tools.orchestrator_tools import (  # noqa: E402
    create_custom_agent,
    create_execution_plan,
    delegate_task,
    delegate_to_custom_agent,
    get_all_pending_tasks,
    get_task_status,
    synthesize_results,
    wait_for_tasks,
)
from src.tools.task_tools import TaskConfig, create_task  # noqa: E402
from src.tools.vision_tools import analyze_screenshot, design_to_code  # noqa: E402
from src.tools.web_tools import (  # noqa: E402
    extract_page_data,
    fetch_url,
    interact_with_page,
    screenshot_page,
    search_web,
)

logger = structlog.get_logger()

# Type alias for tool handlers
ToolHandler = Callable[[Path, str, str | None, dict[str, Any]], Awaitable[dict[str, Any]]]


class ToolExecutor:
    """Executes tools for agents within a workspace context."""

    def __init__(
        self,
        workspace_path: str | Path,
        session_id: str,
        user_id: str | None = None,
        mcp_registry: MCPToolRegistry | None = None,
        agent_id: str | None = None,
        agent_mode: AgentMode | str = AgentMode.ASK,
        command_allowlist: list[str] | None = None,
        approval_callback: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ) -> None:
        """Initialize tool executor.

        Args:
            workspace_path: Path to the workspace directory.
            session_id: Session ID for task management.
            user_id: Optional user ID for user-scoped operations (e.g., agent templates).
            mcp_registry: Optional MCP tool registry for external tools.
            agent_id: Optional agent ID for approval requests.
            agent_mode: Agent operation mode (plan, ask, auto, sovereign).
            command_allowlist: List of allowed command patterns for Auto mode.
            approval_callback: Async callback to request user approval.
        """
        self.workspace_path = Path(workspace_path).resolve()
        self.session_id = session_id
        self.user_id = user_id
        self._mcp_registry = mcp_registry
        self.agent_id = agent_id

        # Mode-based permissions
        if isinstance(agent_mode, str):
            self.agent_mode = AgentMode(agent_mode.lower())
        else:
            self.agent_mode = agent_mode
        self.command_allowlist = command_allowlist or []
        self.approval_callback = approval_callback

        # Pending approvals tracking
        self._pending_approvals: dict[str, asyncio.Future[tuple[bool, bool]]] = {}

        # Ensure workspace exists
        self.workspace_path.mkdir(parents=True, exist_ok=True)

    async def execute(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> str:
        """Execute a tool with the given arguments.

        Args:
            tool_name: Name of the tool to execute.
            arguments: Tool arguments.

        Returns:
            JSON string of the result.
        """
        logger.info(
            "Executing tool",
            tool=tool_name,
            workspace=str(self.workspace_path),
            mode=self.agent_mode.value,
        )

        # Check permissions based on agent mode
        permission = self._check_permission(tool_name, arguments)
        if not permission.allowed:
            logger.warning(
                "Tool blocked by mode permissions",
                tool=tool_name,
                mode=self.agent_mode.value,
                error=permission.error,
            )
            return json.dumps(
                {
                    "success": False,
                    "error": permission.error,
                    "blocked_by_mode": True,
                },
                indent=2,
            )

        # If requires approval, request it
        if permission.requires_approval:
            approved, add_to_allowlist = await self._request_approval(
                tool_name, arguments, permission.can_add_to_allowlist
            )
            if not approved:
                return json.dumps(
                    {
                        "success": False,
                        "error": "Action was not approved by user",
                        "requires_approval": True,
                    },
                    indent=2,
                )
            # If user chose to add to allowlist, update it
            if add_to_allowlist and tool_name in COMMAND_TOOLS:
                command = arguments.get("command", "")
                if command and command not in self.command_allowlist:
                    self.command_allowlist.append(command)
                    logger.info(
                        "Command added to allowlist",
                        command=command,
                        agent_id=self.agent_id,
                    )

        try:
            result = await self._dispatch_tool(tool_name, arguments)
        except Exception as e:
            logger.error("Tool execution failed", tool=tool_name, error=str(e))
            result = {"success": False, "error": str(e)}

        return json.dumps(result, indent=2)

    def _check_permission(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> PermissionResult:
        """Check if tool execution is allowed based on agent mode.

        Args:
            tool_name: Name of the tool.
            arguments: Tool arguments.

        Returns:
            PermissionResult indicating if action is allowed.
        """
        # Plan mode: only read tools allowed
        if self.agent_mode == AgentMode.PLAN:
            if tool_name in WRITE_TOOLS or tool_name in COMMAND_TOOLS:
                return PermissionResult(
                    allowed=False,
                    error=f"Tool '{tool_name}' not allowed in Plan mode (read-only)",
                )
            return PermissionResult(allowed=True)

        # Ask mode: everything needs approval for writes/commands
        if self.agent_mode == AgentMode.ASK:
            if tool_name in WRITE_TOOLS or tool_name in COMMAND_TOOLS:
                return PermissionResult(
                    allowed=True,
                    requires_approval=True,
                    can_add_to_allowlist=tool_name in COMMAND_TOOLS,
                )
            return PermissionResult(allowed=True)

        # Auto mode: writes allowed, commands need allowlist or approval
        if self.agent_mode == AgentMode.AUTO:
            if tool_name in COMMAND_TOOLS:
                command = arguments.get("command", "")
                if self._is_command_allowed(command):
                    return PermissionResult(allowed=True)
                # Command not in allowlist, needs approval with option to add
                return PermissionResult(
                    allowed=True,
                    requires_approval=True,
                    can_add_to_allowlist=True,
                )
            return PermissionResult(allowed=True)

        # Sovereign mode: everything allowed
        if self.agent_mode == AgentMode.SOVEREIGN:
            return PermissionResult(allowed=True)

        # Default: allow (ERA001 false positive)
        return PermissionResult(allowed=True)

    def _is_command_allowed(self, command: str) -> bool:
        """Check if command matches any pattern in the allowlist.

        Args:
            command: The command to check.

        Returns:
            True if command is allowed.
        """
        if not command:
            return False
        if not self.command_allowlist:
            return False

        # Get base command (first word)
        base_cmd = command.split()[0] if command else ""

        for pattern in self.command_allowlist:
            # Check full command match
            if fnmatch.fnmatch(command, pattern):
                return True
            # Check base command match
            if fnmatch.fnmatch(base_cmd, pattern):
                return True
            # Exact match
            if pattern in (command, base_cmd):
                return True

        return False

    async def _request_approval(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        can_add_to_allowlist: bool,
    ) -> tuple[bool, bool]:
        """Request user approval for an action.

        Args:
            tool_name: Name of the tool requesting approval.
            arguments: Tool arguments.
            can_add_to_allowlist: Whether user can add to allowlist.

        Returns:
            Tuple of (approved, add_to_allowlist).
        """
        if not self.approval_callback:
            logger.warning("No approval callback configured, denying action")
            return (False, False)

        import uuid

        approval_id = str(uuid.uuid4())
        future: asyncio.Future[tuple[bool, bool]] = asyncio.Future()
        self._pending_approvals[approval_id] = future

        # Determine action type
        if tool_name in WRITE_TOOLS:
            action_type = "file_write"
        elif tool_name in COMMAND_TOOLS:
            action_type = "command_execute"
        else:
            action_type = "other"

        try:
            # Send approval request via callback
            await self.approval_callback(
                {
                    "approval_id": approval_id,
                    "agent_id": self.agent_id,
                    "session_id": self.session_id,
                    "tool_name": tool_name,
                    "action_type": action_type,
                    "arguments": arguments,
                    "can_add_to_allowlist": can_add_to_allowlist,
                }
            )

            # Wait for approval with timeout (5 minutes)
            result = await asyncio.wait_for(future, timeout=300)
            return result
        except TimeoutError:
            logger.warning("Approval request timed out", approval_id=approval_id)
            return (False, False)
        except Exception as e:
            logger.error("Approval request failed", error=str(e))
            return (False, False)
        finally:
            self._pending_approvals.pop(approval_id, None)

    def resolve_approval(
        self,
        approval_id: str,
        approved: bool,
        add_to_allowlist: bool = False,
    ) -> bool:
        """Resolve a pending approval request.

        Args:
            approval_id: The approval request ID.
            approved: Whether the action was approved.
            add_to_allowlist: Whether to add command to allowlist.

        Returns:
            True if approval was resolved, False if not found.
        """
        future = self._pending_approvals.get(approval_id)
        if future and not future.done():
            future.set_result((approved, add_to_allowlist))
            return True
        return False

    async def _dispatch_tool(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Dispatch tool execution to appropriate handler.

        Args:
            tool_name: Name of the tool.
            arguments: Tool arguments.

        Returns:
            Tool execution result.
        """
        # Check for MCP tool first (mcp:server:tool format)
        if is_mcp_tool_name(tool_name):
            return await self._handle_mcp_tool(tool_name, arguments)

        # Group tools by category for cleaner dispatch
        handlers = {
            # File tools
            "read_file": self._handle_file_tools,
            "write_file": self._handle_file_tools,
            "list_directory": self._handle_file_tools,
            "search_code": self._handle_file_tools,
            "run_command": self._handle_file_tools,
            "glob_files": self._handle_file_tools,
            "grep": self._handle_file_tools,
            "apply_patch": self._handle_file_tools,
            "file_fetch_url": self._handle_file_tools,
            # Task and agent builder tools
            "create_task": self._handle_task_tools,
            "create_agent_template": self._handle_agent_builder_tools,
            "list_available_tools": self._handle_agent_builder_tools,
            "preview_agent_template": self._handle_agent_builder_tools,
            # Orchestrator tools
            "create_execution_plan": self._handle_orchestrator_tools,
            "delegate_task": self._handle_orchestrator_tools,
            "create_custom_agent": self._handle_orchestrator_tools,
            "delegate_to_custom_agent": self._handle_orchestrator_tools,
            "get_task_status": self._handle_orchestrator_tools,
            "wait_for_tasks": self._handle_orchestrator_tools,
            "get_all_pending_tasks": self._handle_orchestrator_tools,
            "synthesize_results": self._handle_orchestrator_tools,
            # Git tools
            "git_status": self._handle_git_tools,
            "git_commit": self._handle_git_tools,
            "git_push": self._handle_git_tools,
            "git_branch": self._handle_git_tools,
            "git_diff": self._handle_git_tools,
            "git_log": self._handle_git_tools,
            "create_pr": self._handle_git_tools,
            # Web tools
            "fetch_url": self._handle_web_tools,
            "screenshot_page": self._handle_web_tools,
            "search_web": self._handle_web_tools,
            "interact_with_page": self._handle_web_tools,
            "extract_page_data": self._handle_web_tools,
            # Memory tools
            "store_memory": self._handle_memory_tools,
            "recall_memory": self._handle_memory_tools,
            "update_memory": self._handle_memory_tools,
            "delete_memory": self._handle_memory_tools,
            "get_session_memories": self._handle_memory_tools,
            # Vision tools
            "analyze_screenshot": self._handle_vision_tools,
            "design_to_code": self._handle_vision_tools,
            # Deploy tools
            "deploy_preview": self._handle_deploy_tools,
            "get_preview_status": self._handle_deploy_tools,
            "stop_preview": self._handle_deploy_tools,
            "run_e2e_tests": self._handle_deploy_tools,
        }

        handler = handlers.get(tool_name)
        if handler is None:
            return {"success": False, "error": f"Unknown tool: {tool_name}"}

        return await handler(tool_name, arguments)

    async def _handle_file_tools(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle file and command tools."""
        if tool_name == "read_file":
            return await read_file(
                workspace_path=self.workspace_path,
                path=arguments.get("path", ""),
            )
        if tool_name == "write_file":
            return await write_file(
                workspace_path=self.workspace_path,
                path=arguments.get("path", ""),
                content=arguments.get("content", ""),
            )
        if tool_name == "list_directory":
            return await list_directory(
                workspace_path=self.workspace_path,
                path=arguments.get("path", "."),
            )
        if tool_name == "search_code":
            return await search_code(
                workspace_path=self.workspace_path,
                query=arguments.get("query", ""),
                file_pattern=arguments.get("file_pattern"),
            )
        if tool_name == "run_command":
            return await run_command(
                workspace_path=self.workspace_path,
                command=arguments.get("command", ""),
                cwd=arguments.get("cwd"),
            )
        if tool_name == "glob_files":
            return await glob_files(
                workspace_path=self.workspace_path,
                pattern=arguments.get("pattern", ""),
                path=arguments.get("path", "."),
                include_hidden=arguments.get("include_hidden", False),
            )
        if tool_name == "grep":
            return await grep(
                workspace_path=self.workspace_path,
                pattern=arguments.get("pattern", ""),
                path=arguments.get("path", "."),
                file_pattern=arguments.get("file_pattern"),
                ignore_case=arguments.get("ignore_case", False),
                context_lines=arguments.get("context_lines", 2),
            )
        if tool_name == "apply_patch":
            return await apply_patch(
                workspace_path=self.workspace_path,
                path=arguments.get("path", ""),
                patch=arguments.get("patch", ""),
                reverse=arguments.get("reverse", False),
            )
        if tool_name == "file_fetch_url":
            return await file_fetch_url(
                url=arguments.get("url", ""),
                extract_text=arguments.get("extract_text", True),
                max_length=arguments.get("max_length", 50000),
            )
        return {"success": False, "error": f"Unknown file tool: {tool_name}"}

    async def _handle_task_tools(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle task tools."""
        if tool_name == "create_task":
            config = TaskConfig(
                session_id=self.session_id,
                agent_role=arguments.get("agent_role", "coder"),
                description=arguments.get("description", ""),
                priority=arguments.get("priority", "medium"),
            )
            return await create_task(config)
        return {"success": False, "error": f"Unknown task tool: {tool_name}"}

    async def _handle_agent_builder_tools(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle agent builder tools."""
        if tool_name == "create_agent_template":
            if not self.user_id:
                return {"success": False, "error": "User ID not available"}
            config = AgentTemplateConfig(
                user_id=self.user_id,
                name=arguments.get("name", ""),
                slug=arguments.get("slug", ""),
                system_prompt=arguments.get("system_prompt", ""),
                allowed_tools=arguments.get("allowed_tools", []),
                description=arguments.get("description"),
                model=arguments.get("model", "claude-sonnet-4-20250514"),
                temperature=arguments.get("temperature"),
                icon=arguments.get("icon"),
            )
            return await create_agent_template(config)
        if tool_name == "list_available_tools":
            return await list_available_tools()
        if tool_name == "preview_agent_template":
            preview_config = AgentTemplatePreviewConfig(
                name=arguments.get("name", ""),
                system_prompt=arguments.get("system_prompt", ""),
                allowed_tools=arguments.get("allowed_tools", []),
                description=arguments.get("description"),
                model=arguments.get("model", "claude-sonnet-4-20250514"),
                temperature=arguments.get("temperature"),
                icon=arguments.get("icon"),
            )
            return await preview_agent_template(preview_config)
        return {"success": False, "error": f"Unknown agent builder tool: {tool_name}"}

    async def _handle_orchestrator_tools(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle orchestrator tools using dispatch table."""
        handlers: dict[str, Callable[[], Awaitable[dict[str, Any]]]] = {
            "create_execution_plan": lambda: create_execution_plan(
                session_id=self.session_id,
                agent_id=arguments.get("agent_id", "orchestrator"),
                task_description=arguments.get("task_description", ""),
                context=arguments.get("context", ""),
                agent_mode=self.agent_mode.value,
            ),
            "delegate_task": lambda: delegate_task(
                session_id=self.session_id,
                agent_role=arguments.get("agent_role", "coder"),
                description=arguments.get("description", ""),
                priority=arguments.get("priority", "medium"),
                context=arguments.get("context"),
            ),
            "create_custom_agent": lambda: create_custom_agent(
                session_id=self.session_id,
                name=arguments.get("name", ""),
                system_prompt=arguments.get("system_prompt", ""),
                tools=arguments.get("tools", []),
                model=arguments.get("model", "claude-sonnet-4-20250514"),
            ),
            "delegate_to_custom_agent": lambda: delegate_to_custom_agent(
                session_id=self.session_id,
                agent_id=arguments.get("agent_id", ""),
                message=arguments.get("message", ""),
            ),
            "get_task_status": lambda: get_task_status(task_id=arguments.get("task_id", "")),
            "wait_for_tasks": lambda: wait_for_tasks(
                session_id=self.session_id,
                task_ids=arguments.get("task_ids", []),
                timeout_seconds=arguments.get("timeout_seconds", 300),
            ),
            "get_all_pending_tasks": lambda: get_all_pending_tasks(session_id=self.session_id),
            "synthesize_results": lambda: synthesize_results(
                session_id=self.session_id,
                task_ids=arguments.get("task_ids", []),
                synthesis_instructions=arguments.get("synthesis_instructions", ""),
            ),
        }

        handler = handlers.get(tool_name)
        if handler is None:
            return {"success": False, "error": f"Unknown orchestrator tool: {tool_name}"}
        return await handler()

    async def _handle_git_tools(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle git tools using dispatch table."""
        handlers: dict[str, Callable[[], Awaitable[dict[str, Any]]]] = {
            "git_status": lambda: git_status(workspace_path=self.workspace_path),
            "git_commit": lambda: git_commit(
                workspace_path=self.workspace_path,
                message=arguments.get("message", ""),
                files=arguments.get("files"),
                all_changes=arguments.get("all_changes", False),
            ),
            "git_push": lambda: git_push(
                workspace_path=self.workspace_path,
                remote=arguments.get("remote", "origin"),
                branch=arguments.get("branch"),
                force=arguments.get("force", False),
                set_upstream=arguments.get("set_upstream", False),
            ),
            "git_branch": lambda: git_branch(
                workspace_path=self.workspace_path,
                action=arguments.get("action", "list"),
                name=arguments.get("name"),
            ),
            "git_diff": lambda: git_diff(
                workspace_path=self.workspace_path,
                staged=arguments.get("staged", False),
                file=arguments.get("file"),
            ),
            "git_log": lambda: git_log(
                workspace_path=self.workspace_path,
                limit=arguments.get("limit", 10),
                oneline=arguments.get("oneline", True),
            ),
            "create_pr": lambda: create_pr(
                workspace_path=self.workspace_path,
                title=arguments.get("title", ""),
                body=arguments.get("body", ""),
                base=arguments.get("base", "main"),
                draft=arguments.get("draft", False),
            ),
        }

        handler = handlers.get(tool_name)
        if handler is None:
            return {"success": False, "error": f"Unknown git tool: {tool_name}"}
        return await handler()

    async def _handle_web_tools(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle web tools."""
        if tool_name == "fetch_url":
            result = await fetch_url(
                url=arguments.get("url", ""),
                extract_content=arguments.get("extract_content", True),
                include_html=arguments.get("include_html", False),
                wait_for=arguments.get("wait_for", "load"),
            )
            return cast("dict[str, Any]", json.loads(result))
        if tool_name == "screenshot_page":
            result = await screenshot_page(
                url=arguments.get("url", ""),
                full_page=arguments.get("full_page", False),
                output_path=arguments.get("output_path"),
            )
            return cast("dict[str, Any]", json.loads(result))
        if tool_name == "search_web":
            result = await search_web(
                query=arguments.get("query", ""),
                num_results=arguments.get("num_results", 10),
                fetch_content=arguments.get("fetch_content", False),
            )
            return cast("dict[str, Any]", json.loads(result))
        if tool_name == "interact_with_page":
            result = await interact_with_page(
                url=arguments.get("url", ""),
                actions=arguments.get("actions", []),
            )
            return cast("dict[str, Any]", json.loads(result))
        if tool_name == "extract_page_data":
            result = await extract_page_data(
                url=arguments.get("url", ""),
                selectors=arguments.get("selectors", {}),
            )
            return cast("dict[str, Any]", json.loads(result))
        return {"success": False, "error": f"Unknown web tool: {tool_name}"}

    async def _handle_memory_tools(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle memory tools using dispatch table."""
        # Tools that require user_id
        user_required_tools = {"store_memory", "recall_memory"}
        if tool_name in user_required_tools and not self.user_id:
            return {"success": False, "error": "User ID required"}

        handlers: dict[str, Callable[[], Awaitable[dict[str, Any]]]] = {
            "store_memory": lambda: store_memory(
                StoreMemoryParams(
                    session_id=self.session_id,
                    user_id=self.user_id or "",
                    content=arguments.get("content", ""),
                    memory_type=arguments.get("memory_type", "fact"),
                    tags=arguments.get("tags"),
                    importance=arguments.get("importance", 0.5),
                ),
            ),
            "recall_memory": lambda: recall_memory(
                RecallMemoryParams(
                    session_id=self.session_id,
                    user_id=self.user_id or "",
                    query=arguments.get("query", ""),
                    memory_type=arguments.get("memory_type"),
                    tags=arguments.get("tags"),
                    limit=arguments.get("limit", 5),
                ),
            ),
            "update_memory": lambda: update_memory(
                memory_id=arguments.get("memory_id", ""),
                content=arguments.get("content"),
                tags=arguments.get("tags"),
                importance=arguments.get("importance"),
            ),
            "delete_memory": lambda: delete_memory(memory_id=arguments.get("memory_id", "")),
            "get_session_memories": lambda: get_session_memories(
                session_id=self.session_id,
                limit=arguments.get("limit", 20),
            ),
        }

        handler = handlers.get(tool_name)
        if handler is None:
            return {"success": False, "error": f"Unknown memory tool: {tool_name}"}
        return await handler()

    async def _handle_vision_tools(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle vision tools."""
        if tool_name == "analyze_screenshot":
            result = await analyze_screenshot(
                image_path=arguments.get("image_path"),
                image_base64=arguments.get("image_base64"),
                context=arguments.get("context"),
            )
            return cast("dict[str, Any]", json.loads(result))
        if tool_name == "design_to_code":
            result = await design_to_code(
                image_path=arguments.get("image_path"),
                image_base64=arguments.get("image_base64"),
                framework=arguments.get("framework", "react"),
                styling=arguments.get("styling", "tailwind"),
                include_responsive=arguments.get("include_responsive", True),
            )
            return cast("dict[str, Any]", json.loads(result))
        return {"success": False, "error": f"Unknown vision tool: {tool_name}"}

    async def _handle_deploy_tools(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle deploy tools."""
        if tool_name == "deploy_preview":
            deploy_config = DeployPreviewConfig(
                workspace_path=str(self.workspace_path),
                session_id=self.session_id,
                branch=arguments.get("branch", "main"),
                build_command=arguments.get("build_command"),
                start_command=arguments.get("start_command"),
                env_vars=arguments.get("env_vars"),
            )
            result = await deploy_preview(deploy_config)
            return cast("dict[str, Any]", json.loads(result))
        if tool_name == "get_preview_status":
            result = await get_preview_status(preview_id=arguments.get("preview_id", ""))
            return cast("dict[str, Any]", json.loads(result))
        if tool_name == "stop_preview":
            result = await stop_preview(preview_id=arguments.get("preview_id", ""))
            return cast("dict[str, Any]", json.loads(result))
        if tool_name == "run_e2e_tests":
            e2e_config = E2ETestConfig(
                workspace_path=arguments.get("workspace_path", str(self.workspace_path)),
                base_url=arguments.get("base_url"),
                test_pattern=arguments.get("test_pattern"),
                parallel=arguments.get("parallel", True),
                retries=arguments.get("retries", 1),
                framework=arguments.get("framework", "auto"),
            )
            result = await run_e2e_tests(e2e_config)
            return cast("dict[str, Any]", json.loads(result))
        return {"success": False, "error": f"Unknown deploy tool: {tool_name}"}

    def _make_mcp_error(self, error_type: str, message: str) -> dict[str, Any]:
        """Create a standardized MCP error response.

        Args:
            error_type: Type of error (configuration, invalid_format, not_found, etc.)
            message: Error message

        Returns:
            Error response dictionary
        """
        return {"success": False, "error": message, "error_type": error_type}

    async def _handle_mcp_tool(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle MCP tool execution.

        Routes MCP tool calls (mcp:server:tool format) to the MCP registry.

        Args:
            tool_name: Full MCP tool name with prefix (e.g., "mcp:github:create_issue")
            arguments: Tool arguments

        Returns:
            Tool execution result
        """
        # Validate prerequisites
        validation_error = await self._validate_mcp_prerequisites(tool_name)
        if validation_error:
            return validation_error

        qualified_name = extract_mcp_qualified_name(tool_name)
        # After validation, qualified_name and _mcp_registry are guaranteed non-None
        if not qualified_name or not self._mcp_registry:
            return self._make_mcp_error(
                "invalid_format", f"Invalid MCP tool name format: {tool_name}"
            )

        tool = self._mcp_registry.get_tool(qualified_name)

        # Ensure connection
        connection_error = await self._ensure_mcp_connection(tool)
        if connection_error:
            return connection_error

        # Execute the tool with timeout
        return await self._execute_mcp_tool_with_timeout(tool, tool_name, qualified_name, arguments)

    async def _validate_mcp_prerequisites(self, tool_name: str) -> dict[str, Any] | None:
        """Validate MCP prerequisites before tool execution.

        Args:
            tool_name: Full MCP tool name

        Returns:
            Error dict if validation fails, None if valid
        """
        if not self._mcp_registry:
            return self._make_mcp_error("configuration", "MCP not configured for this session")

        qualified_name = extract_mcp_qualified_name(tool_name)
        if not qualified_name:
            return self._make_mcp_error(
                "invalid_format", f"Invalid MCP tool name format: {tool_name}"
            )

        tool = self._mcp_registry.get_tool(qualified_name)
        if not tool:
            return self._make_mcp_error("not_found", f"MCP tool not found: {qualified_name}")

        return None

    async def _ensure_mcp_connection(self, tool: Any) -> dict[str, Any] | None:
        """Ensure MCP server is connected, attempting reconnection if needed.

        Args:
            tool: The MCP tool instance

        Returns:
            Error dict if connection fails, None if connected
        """
        if tool.client.is_connected:
            return None

        logger.warning(
            "MCP server disconnected, attempting reconnection",
            server=tool.definition.server_id,
            tool=tool.name,
        )
        reconnected = await tool.client.connect()
        if not reconnected:
            return self._make_mcp_error(
                "connection",
                f"MCP server '{tool.definition.server_id}' is not connected",
            )

        return None

    async def _execute_mcp_tool_with_timeout(
        self,
        tool: Any,
        tool_name: str,
        qualified_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Execute MCP tool with timeout handling.

        Args:
            tool: The MCP tool instance
            tool_name: Full MCP tool name
            qualified_name: Qualified name without mcp: prefix
            arguments: Tool arguments

        Returns:
            Tool execution result or error
        """
        try:
            result: dict[str, Any] = await asyncio.wait_for(
                tool.execute(arguments),
                timeout=settings.MCP_TOOL_TIMEOUT,
            )
            logger.info(
                "MCP tool executed",
                tool=qualified_name,
                success=result.get("success", True),
            )
            return result
        except TimeoutError:
            logger.error("MCP tool execution timed out", tool=qualified_name)
            return self._make_mcp_error("timeout", f"MCP tool execution timed out: {tool_name}")
        except Exception as e:
            logger.exception("MCP tool execution failed", tool=qualified_name)
            return self._make_mcp_error("execution", f"MCP tool error: {e!s}")
