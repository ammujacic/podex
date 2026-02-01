"""Tool executor for agents."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, cast

import structlog

from podex_shared.sentry import track_file_operation
from src.config import settings
from src.mcp.integration import extract_mcp_qualified_name, is_mcp_tool_name

if TYPE_CHECKING:
    from src.compute_client import ComputeClient
    from src.mcp.registry import MCPToolRegistry


# Agent mode string constants - used for permission checking logic.
# The valid modes are defined in the database and synced to Redis.
# API service validates mode before sending to agent service.
# These constants are for the permission logic implementation, not configuration.
AGENT_MODE_PLAN = "plan"  # Read-only: no file edits, no commands
AGENT_MODE_ASK = "ask"  # Requires approval for file edits and commands
AGENT_MODE_AUTO = "auto"  # Auto file edits, commands require allowlist or approval
AGENT_MODE_SOVEREIGN = "sovereign"  # Full access: all operations allowed


# Tool categories are loaded dynamically from Redis via config_reader
# These module-level caches avoid repeated Redis lookups during tool execution
_tool_categories_cache: dict[str, set[str]] | None = None
_tool_categories_lock = asyncio.Lock()


async def _load_tool_categories() -> dict[str, set[str]]:
    """Load tool categories from Redis configuration.

    Returns:
        Dict mapping category names to sets of tool names.
    """
    global _tool_categories_cache
    async with _tool_categories_lock:
        if _tool_categories_cache is not None:
            return _tool_categories_cache

        from src.config_reader import get_config_reader

        config_reader = get_config_reader()
        categories = await config_reader.get_tool_categories()

        # Convert lists to sets for efficient lookup
        _tool_categories_cache = {category: set(tools) for category, tools in categories.items()}

        logger.info(
            "Tool categories loaded from Redis",
            categories={k: len(v) for k, v in _tool_categories_cache.items()},
        )
        return _tool_categories_cache


async def _get_write_tools() -> set[str]:
    """Get write tools from cached categories."""
    categories = await _load_tool_categories()
    return categories.get("write_tools", set())


async def _get_command_tools() -> set[str]:
    """Get command tools from cached categories."""
    categories = await _load_tool_categories()
    return categories.get("command_tools", set())


async def _get_read_tools() -> set[str]:
    """Get read tools from cached categories."""
    categories = await _load_tool_categories()
    return categories.get("read_tools", set())


async def _get_deploy_tools() -> set[str]:
    """Get deploy tools from cached categories."""
    categories = await _load_tool_categories()
    return categories.get("deploy_tools", set())


@dataclass
class PermissionResult:
    """Result of a permission check."""

    allowed: bool
    error: str | None = None
    requires_approval: bool = False
    can_add_to_allowlist: bool = False  # For Auto mode command approval


# Remote tools for workspace container operations
from src.tools import remote_tools  # noqa: E402
from src.tools.agent_builder_tools import (  # noqa: E402
    AgentTemplateConfig,
    AgentTemplatePreviewConfig,
    create_agent_template,
    list_available_tools,
    preview_agent_template,
)
from src.tools.deploy_tools import (  # noqa: E402
    DeployPreviewConfig,
    E2ETestConfig,
    check_deployment_health,
    deploy_preview,
    get_preview_logs,
    get_preview_status,
    list_previews,
    rollback_deploy,
    run_e2e_tests,
    stop_preview,
    wait_for_deployment,
)
from src.tools.health_tools import (  # noqa: E402
    HealthAnalysisConfig,
    analyze_project_health,
    apply_health_fix,
    get_health_score,
    list_health_checks,
)

# NOTE: Local file_tools, command_tools, git_tools removed.
# All file/command/git operations now use remote_tools via ComputeClient
# to execute on the workspace container instead of the agent's local filesystem.
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
    get_active_subagents,
    get_subagent_status,
    synthesize_results,
    wait_for_subagents,
)
from src.tools.skill_tools import (  # noqa: E402
    CreateSkillConfig,
    create_skill,
    delete_skill,
    execute_skill,
    get_skill,
    get_skill_stats,
    list_skills,
    match_skills,
    recommend_skills,
)
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
    """Executes tools for agents within a workspace context.

    Workspace tools (file operations, commands, git) execute remotely on the workspace
    container via the compute service. Requires workspace_id to be configured.
    Local tools (memory, skills, tasks, web, vision) run on the agent service directly.
    """

    def __init__(
        self,
        workspace_path: str | Path,
        session_id: str,
        user_id: str | None = None,
        mcp_registry: MCPToolRegistry | None = None,
        agent_id: str | None = None,
        agent_mode: str = AGENT_MODE_ASK,
        command_allowlist: list[str] | None = None,
        approval_callback: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
        workspace_id: str | None = None,
        agent_model: str | None = None,
    ) -> None:
        """Initialize tool executor.

        Args:
            workspace_path: Path to the workspace directory (used for local fallback).
            session_id: Session ID for task management.
            user_id: Optional user ID for user-scoped operations (e.g., agent templates).
            mcp_registry: Optional MCP tool registry for external tools.
            agent_id: Optional agent ID for approval requests.
            agent_mode: Agent operation mode (plan, ask, auto, sovereign).
            command_allowlist: List of allowed command patterns for Auto mode.
            approval_callback: Async callback to request user approval.
            workspace_id: Optional workspace container ID for remote execution.
                         When provided, file/command/git tools execute on the
                         workspace container via the compute service.
            agent_model: Optional model used by the agent. Used as default for
                        agent builder tools when creating new templates.
        """
        self.workspace_path = Path(workspace_path).resolve()
        self.session_id = session_id
        self.user_id = user_id
        self._mcp_registry = mcp_registry
        self.agent_id = agent_id
        self.workspace_id = workspace_id
        self.agent_model = agent_model

        # Mode-based permissions - normalize to lowercase string
        # Mode is validated by the API service against the database before reaching here.
        # If an invalid mode somehow slips through, permission checks will fail safely.
        self.agent_mode = agent_mode.lower() if isinstance(agent_mode, str) else str(agent_mode)
        self.command_allowlist = command_allowlist or []
        self.approval_callback = approval_callback

        # Pending approvals tracking
        self._pending_approvals: dict[str, asyncio.Future[tuple[bool, bool]]] = {}

        # Compute client is lazily initialized on first use
        # This allows async database lookup of the compute service URL
        self._compute_client: ComputeClient | None = None
        self._compute_client_initialized = False

        if not workspace_id or not user_id:
            # Local mode - ensure workspace exists
            self.workspace_path.mkdir(parents=True, exist_ok=True)
            logger.info(
                "ToolExecutor using local workspace",
                workspace_path=str(self.workspace_path),
            )

    async def _get_compute_client(self) -> ComputeClient | None:
        """Get the compute client, initializing it lazily if needed.

        The compute service URL is looked up from the database based on the
        workspace's assigned server, enabling multi-region deployments.

        Returns:
            ComputeClient instance if workspace_id and user_id are set, None otherwise.

        Raises:
            ComputeServiceURLNotFoundError: If compute URL cannot be resolved from database.
        """
        if self._compute_client_initialized:
            return self._compute_client

        if self.workspace_id and self.user_id:
            from src.compute_client import ComputeServiceURLNotFoundError, get_compute_client

            try:
                self._compute_client = await get_compute_client(
                    workspace_id=self.workspace_id,
                    user_id=self.user_id,
                )
                logger.info(
                    "ToolExecutor initialized remote workspace client",
                    workspace_id=self.workspace_id,
                    user_id=self.user_id,
                )
            except ComputeServiceURLNotFoundError as e:
                logger.error(
                    "Failed to resolve compute service URL",
                    workspace_id=self.workspace_id,
                    error=str(e),
                )
                raise

        self._compute_client_initialized = True
        return self._compute_client

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
            mode=self.agent_mode,
        )

        # Check permissions based on agent mode
        permission = await self._check_permission(tool_name, arguments)
        if not permission.allowed:
            logger.warning(
                "Tool blocked by mode permissions",
                tool=tool_name,
                mode=self.agent_mode,
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
            command_tools = await _get_command_tools()
            if add_to_allowlist and tool_name in command_tools:
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

    async def _check_permission(
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
        # Load tool categories from Redis
        write_tools = await _get_write_tools()
        command_tools = await _get_command_tools()
        deploy_tools = await _get_deploy_tools()

        # Plan mode: only read tools allowed
        if self.agent_mode == AGENT_MODE_PLAN:
            if tool_name in write_tools or tool_name in command_tools or tool_name in deploy_tools:
                return PermissionResult(
                    allowed=False,
                    error=f"Tool '{tool_name}' not allowed in Plan mode (read-only)",
                )
            return PermissionResult(allowed=True)

        # Ask mode: everything needs approval for writes/commands/deploys
        if self.agent_mode == AGENT_MODE_ASK:
            if tool_name in write_tools or tool_name in command_tools or tool_name in deploy_tools:
                return PermissionResult(
                    allowed=True,
                    requires_approval=True,
                    can_add_to_allowlist=tool_name in command_tools,
                )
            return PermissionResult(allowed=True)

        # Auto mode: writes allowed, commands need allowlist or approval, deploys need approval
        if self.agent_mode == AGENT_MODE_AUTO:
            if tool_name in command_tools:
                command = arguments.get("command", "")
                if self._is_command_allowed(command):
                    return PermissionResult(allowed=True)
                # Command not in allowlist, needs approval with option to add
                return PermissionResult(
                    allowed=True,
                    requires_approval=True,
                    can_add_to_allowlist=True,
                )
            # Deploy tools always need approval in Auto mode (they execute shell commands)
            if tool_name in deploy_tools:
                return PermissionResult(
                    allowed=True,
                    requires_approval=True,
                    can_add_to_allowlist=False,
                )
            return PermissionResult(allowed=True)

        # Sovereign mode: everything allowed
        if self.agent_mode == AGENT_MODE_SOVEREIGN:
            return PermissionResult(allowed=True)

        # Default: allow (ERA001 false positive)
        return PermissionResult(allowed=True)

    def _is_command_allowed(self, command: str) -> bool:
        """Check if command matches any pattern in the allowlist.

        SECURITY: Uses strict matching to prevent command injection via pattern abuse.
        - Exact matches only for full commands
        - Base command matching with strict prefix validation
        - NO fnmatch glob patterns to prevent "npm*" matching "npm rm -rf /"

        Args:
            command: The command to check.

        Returns:
            True if command is allowed.
        """
        if not command:
            return False
        if not self.command_allowlist:
            return False

        # Normalize command - strip whitespace
        command = command.strip()
        if not command:
            return False

        # Get base command (first word) for matching
        parts = command.split()
        base_cmd = parts[0] if parts else ""

        for pattern in self.command_allowlist:
            pattern = pattern.strip()
            if not pattern:
                continue

            # SECURITY: Reject glob patterns entirely - they're too dangerous
            # Patterns like "npm*" or "*" could match malicious commands
            if any(c in pattern for c in "*?[]"):
                logger.warning(
                    "Glob pattern in allowlist rejected for security",
                    pattern=pattern,
                    command=command,
                )
                continue

            # Exact match of full command
            if command == pattern:
                return True

            # Exact match of base command only
            # This allows "npm" to match "npm install" but NOT "npm && rm -rf /"
            if base_cmd == pattern:
                # Additional safety: ensure no shell metacharacters in the command
                dangerous_chars = {"&&", "||", ";", "|", "`", "$(", "${", "<(", ">("}
                if any(dc in command for dc in dangerous_chars):
                    logger.warning(
                        "Command with shell metacharacters blocked despite base match",
                        pattern=pattern,
                        command=command,
                    )
                    return False
                return True

            # Allow "npm install" pattern to match "npm install lodash"
            # but require exact prefix match (no partial word matching)
            if command.startswith(pattern + " ") or command == pattern:
                # Additional safety: ensure no shell metacharacters
                dangerous_chars = {"&&", "||", ";", "|", "`", "$(", "${", "<(", ">("}
                if any(dc in command for dc in dangerous_chars):
                    logger.warning(
                        "Command with shell metacharacters blocked despite prefix match",
                        pattern=pattern,
                        command=command,
                    )
                    return False
                return True

        return False

    async def _request_approval(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        can_add_to_allowlist: bool,
    ) -> tuple[bool, bool]:
        """Request user approval for an action.

        Uses Redis pub/sub via ApprovalListener for distributed approval resolution.
        This enables horizontal scaling of agent services - any instance can receive
        the approval response, not just the one that requested it.

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

        from src.queue.approval_listener import get_approval_listener

        approval_id = str(uuid.uuid4())

        # Determine action type (load tool categories from config)
        write_tools = await _get_write_tools()
        command_tools = await _get_command_tools()
        if tool_name in write_tools:
            action_type = "file_write"
        elif tool_name in command_tools:
            action_type = "command_execute"
        else:
            action_type = "other"

        # Get the approval listener for distributed approval handling
        approval_listener = get_approval_listener()

        try:
            # Register approval with listener (for Redis pub/sub resolution)
            # or fall back to local Future if listener not available (e.g., in tests)
            if approval_listener:
                future = await approval_listener.register_approval(approval_id)
            else:
                # Fallback for testing or when listener isn't initialized
                future = asyncio.Future()
                self._pending_approvals[approval_id] = future
                logger.debug(
                    "Approval listener not available, using local Future",
                    approval_id=approval_id,
                )

            # Send approval request via callback (notifies API → frontend via WebSocket)
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
            # The Future will be resolved by:
            # - ApprovalListener receiving Redis pub/sub message, OR
            # - Local resolve_approval() call (fallback/testing)
            result = await asyncio.wait_for(future, timeout=300)
            return result
        except TimeoutError:
            logger.warning("Approval request timed out", approval_id=approval_id)
            return (False, False)
        except Exception as e:
            logger.error("Approval request failed", error=str(e))
            return (False, False)
        finally:
            # Cleanup: unregister from listener or remove from local dict
            if approval_listener:
                await approval_listener.unregister_approval(approval_id)
            else:
                self._pending_approvals.pop(approval_id, None)

    def resolve_approval(
        self,
        approval_id: str,
        approved: bool,
        add_to_allowlist: bool = False,
    ) -> bool:
        """Resolve a pending approval request (fallback/testing only).

        NOTE: In production, approvals are resolved via Redis pub/sub through
        the ApprovalListener. This method is kept for backward compatibility
        and testing scenarios where the listener isn't available.

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
            # Agent builder tools
            "create_agent_template": self._handle_agent_builder_tools,
            "list_available_tools": self._handle_agent_builder_tools,
            "preview_agent_template": self._handle_agent_builder_tools,
            # Orchestrator and subagent delegation tools
            "create_execution_plan": self._handle_orchestrator_tools,
            "delegate_task": self._handle_orchestrator_tools,
            "create_custom_agent": self._handle_orchestrator_tools,
            "delegate_to_custom_agent": self._handle_orchestrator_tools,
            "get_subagent_status": self._handle_orchestrator_tools,
            "wait_for_subagents": self._handle_orchestrator_tools,
            "get_active_subagents": self._handle_orchestrator_tools,
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
            "rollback_deploy": self._handle_deploy_tools,
            "check_deployment_health": self._handle_deploy_tools,
            "wait_for_deployment": self._handle_deploy_tools,
            "list_previews": self._handle_deploy_tools,
            "get_preview_logs": self._handle_deploy_tools,
            # Skill tools
            "list_skills": self._handle_skill_tools,
            "get_skill": self._handle_skill_tools,
            "match_skills": self._handle_skill_tools,
            "execute_skill": self._handle_skill_tools,
            "create_skill": self._handle_skill_tools,
            "delete_skill": self._handle_skill_tools,
            "get_skill_stats": self._handle_skill_tools,
            "recommend_skills": self._handle_skill_tools,
            # Health tools
            "analyze_project_health": self._handle_health_tools,
            "get_health_score": self._handle_health_tools,
            "apply_health_fix": self._handle_health_tools,
            "list_health_checks": self._handle_health_tools,
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
        """Handle file and command tools via remote workspace container.

        All file operations execute on the workspace container via the compute service.
        Requires workspace_id to be configured.
        """
        compute_client = await self._get_compute_client()
        if not compute_client:
            return {
                "success": False,
                "error": "Workspace not configured. File operations require a workspace container. "
                "Ensure workspace_id is provided when creating the agent.",
            }

        if tool_name == "read_file":
            start_time = time.perf_counter()
            result = await remote_tools.read_file(
                client=compute_client,
                path=arguments.get("path", ""),
            )
            duration_ms = (time.perf_counter() - start_time) * 1000
            content_size = len(result.get("content", "")) if result.get("success") else 0
            track_file_operation("read", duration_ms, content_size, result.get("success", False))
            return result
        if tool_name == "write_file":
            content = arguments.get("content", "")
            start_time = time.perf_counter()
            result = await remote_tools.write_file(
                client=compute_client,
                path=arguments.get("path", ""),
                content=content,
            )
            duration_ms = (time.perf_counter() - start_time) * 1000
            track_file_operation("write", duration_ms, len(content), result.get("success", False))
            return result
        if tool_name == "list_directory":
            return await remote_tools.list_directory(
                client=compute_client,
                path=arguments.get("path", "."),
            )
        if tool_name == "search_code":
            return await remote_tools.search_code(
                client=compute_client,
                query=arguments.get("query", ""),
                file_pattern=arguments.get("file_pattern"),
            )
        if tool_name == "run_command":
            return await remote_tools.run_command(
                client=compute_client,
                command=arguments.get("command", ""),
                cwd=arguments.get("cwd"),
                timeout=arguments.get("timeout", 60),
            )
        if tool_name == "glob_files":
            return await remote_tools.glob_files(
                client=compute_client,
                pattern=arguments.get("pattern", ""),
                path=arguments.get("path", "."),
                include_hidden=arguments.get("include_hidden", False),
            )
        if tool_name == "grep":
            return await remote_tools.grep(
                client=compute_client,
                pattern=arguments.get("pattern", ""),
                path=arguments.get("path", "."),
                file_pattern=arguments.get("file_pattern"),
                ignore_case=arguments.get("ignore_case", False),
                context_lines=arguments.get("context_lines", 2),
            )
        if tool_name == "apply_patch":
            patch = arguments.get("patch", "")
            start_time = time.perf_counter()
            result = await remote_tools.apply_patch(
                client=compute_client,
                path=arguments.get("path", ""),
                patch=patch,
                reverse=arguments.get("reverse", False),
            )
            duration_ms = (time.perf_counter() - start_time) * 1000
            track_file_operation("patch", duration_ms, len(patch), result.get("success", False))
            return result
        if tool_name == "file_fetch_url":
            # fetch_url doesn't need remote execution - it fetches external URLs
            return await remote_tools.fetch_url(
                url=arguments.get("url", ""),
                extract_text=arguments.get("extract_text", True),
                max_length=arguments.get("max_length", 50000),
            )
        return {"success": False, "error": f"Unknown file tool: {tool_name}"}

    async def _handle_agent_builder_tools(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle agent builder tools."""
        if tool_name == "create_agent_template":
            if not self.user_id:
                return {"success": False, "error": "User ID not available"}
            # Use explicit model from arguments, or fall back to the agent's own model
            model = arguments.get("model") or self.agent_model
            if not model:
                return {
                    "success": False,
                    "error": "Model is required to create an agent template. "
                    "Pass an explicit model or configure role defaults in the platform settings.",
                }
            config = AgentTemplateConfig(
                user_id=self.user_id,
                name=arguments.get("name", ""),
                slug=arguments.get("slug", ""),
                system_prompt=arguments.get("system_prompt", ""),
                allowed_tools=arguments.get("allowed_tools", []),
                description=arguments.get("description"),
                model=model,
                temperature=arguments.get("temperature"),
                icon=arguments.get("icon"),
            )
            return await create_agent_template(config)
        if tool_name == "list_available_tools":
            return await list_available_tools()
        if tool_name == "preview_agent_template":
            # Use explicit model from arguments, or fall back to the agent's own model
            model = arguments.get("model") or self.agent_model
            if not model:
                return {
                    "success": False,
                    "error": "Model is required to preview an agent template. "
                    "Pass an explicit model or configure role defaults in the platform settings.",
                }
            preview_config = AgentTemplatePreviewConfig(
                name=arguments.get("name", ""),
                system_prompt=arguments.get("system_prompt", ""),
                allowed_tools=arguments.get("allowed_tools", []),
                description=arguments.get("description"),
                model=model,
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
        """Handle orchestrator and subagent delegation tools using dispatch table."""
        handlers: dict[str, Callable[[], Awaitable[dict[str, Any]]]] = {
            "create_execution_plan": lambda: create_execution_plan(
                session_id=self.session_id,
                agent_id=arguments.get("agent_id", "orchestrator"),
                task_description=arguments.get("task_description", ""),
                context=arguments.get("context", ""),
                agent_mode=self.agent_mode,
            ),
            "delegate_task": lambda: delegate_task(
                session_id=self.session_id,
                parent_agent_id=self.agent_id or "unknown",
                agent_role=arguments.get("agent_role", "coder"),
                description=arguments.get("description", ""),
                background=arguments.get("background", False),
                system_prompt=arguments.get("system_prompt"),
            ),
            "create_custom_agent": lambda: create_custom_agent(
                session_id=self.session_id,
                name=arguments.get("name", ""),
                system_prompt=arguments.get("system_prompt", ""),
                tools=arguments.get("tools", []),
                model=arguments.get("model") or "",
            ),
            "delegate_to_custom_agent": lambda: delegate_to_custom_agent(
                session_id=self.session_id,
                agent_id=arguments.get("agent_id", ""),
                message=arguments.get("message", ""),
            ),
            "get_subagent_status": lambda: get_subagent_status(
                subagent_id=arguments.get("subagent_id", ""),
            ),
            "wait_for_subagents": lambda: wait_for_subagents(
                subagent_ids=arguments.get("subagent_ids", []),
                timeout_seconds=arguments.get("timeout_seconds", 300),
            ),
            "get_active_subagents": lambda: get_active_subagents(
                parent_agent_id=self.agent_id or "unknown",
            ),
            "synthesize_results": lambda: synthesize_results(
                subagent_ids=arguments.get("subagent_ids", []),
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
        """Handle git tools via remote workspace container.

        All git operations execute on the workspace container via the compute service.
        Requires workspace_id to be configured.
        """
        compute_client = await self._get_compute_client()
        if not compute_client:
            return {
                "success": False,
                "error": "Workspace not configured. Git operations require a workspace container. "
                "Ensure workspace_id is provided when creating the agent.",
            }

        if tool_name == "git_status":
            return await remote_tools.git_status(client=compute_client)
        if tool_name == "git_commit":
            return await remote_tools.git_commit(
                client=compute_client,
                message=arguments.get("message", ""),
                files=arguments.get("files"),
                all_changes=arguments.get("all_changes", False),
            )
        if tool_name == "git_push":
            return await remote_tools.git_push(
                client=compute_client,
                remote=arguments.get("remote", "origin"),
                branch=arguments.get("branch"),
                force=arguments.get("force", False),
                set_upstream=arguments.get("set_upstream", False),
            )
        if tool_name == "git_branch":
            return await remote_tools.git_branch(
                client=compute_client,
                action=arguments.get("action", "list"),
                name=arguments.get("name"),
            )
        if tool_name == "git_diff":
            return await remote_tools.git_diff(
                client=compute_client,
                staged=arguments.get("staged", False),
                file=arguments.get("file"),
            )
        if tool_name == "git_log":
            return await remote_tools.git_log(
                client=compute_client,
                limit=arguments.get("limit", 10),
                oneline=arguments.get("oneline", True),
            )
        if tool_name == "create_pr":
            return await remote_tools.create_pr(
                client=compute_client,
                title=arguments.get("title", ""),
                body=arguments.get("body", ""),
                base=arguments.get("base", "main"),
                draft=arguments.get("draft", False),
            )
        return {"success": False, "error": f"Unknown git tool: {tool_name}"}

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
        if tool_name == "rollback_deploy":
            result = await rollback_deploy(
                preview_id=arguments.get("preview_id", ""),
                to_commit=arguments.get("to_commit", ""),
            )
            return cast("dict[str, Any]", json.loads(result))
        if tool_name == "check_deployment_health":
            result = await check_deployment_health(
                url=arguments.get("url", ""),
                endpoints=arguments.get("endpoints"),
                timeout=arguments.get("timeout", 10),
            )
            return cast("dict[str, Any]", json.loads(result))
        if tool_name == "wait_for_deployment":
            result = await wait_for_deployment(
                url=arguments.get("url", ""),
                endpoint=arguments.get("endpoint", "/health"),
                timeout=arguments.get("timeout", 120),
                interval=arguments.get("interval", 5),
            )
            return cast("dict[str, Any]", json.loads(result))
        if tool_name == "list_previews":
            result = await list_previews(session_id=self.session_id)
            return cast("dict[str, Any]", json.loads(result))
        if tool_name == "get_preview_logs":
            result = await get_preview_logs(
                preview_id=arguments.get("preview_id", ""),
                lines=arguments.get("lines", 100),
            )
            return cast("dict[str, Any]", json.loads(result))
        return {"success": False, "error": f"Unknown deploy tool: {tool_name}"}

    async def _handle_skill_tools(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle skill management tools."""
        if tool_name == "list_skills":
            result = await list_skills(
                tags=arguments.get("tags"),
                author=arguments.get("author"),
            )
            return cast("dict[str, Any]", json.loads(result))
        if tool_name == "get_skill":
            result = await get_skill(name=arguments.get("name", ""))
            return cast("dict[str, Any]", json.loads(result))
        if tool_name == "match_skills":
            result = await match_skills(
                task=arguments.get("task", ""),
                min_score=arguments.get("min_score", 0.3),
                limit=arguments.get("limit", 5),
            )
            return cast("dict[str, Any]", json.loads(result))
        if tool_name == "execute_skill":
            result = await execute_skill(
                skill_name=arguments.get("skill_name", ""),
                context=arguments.get("context"),
                stop_on_failure=arguments.get("stop_on_failure", True),
            )
            return cast("dict[str, Any]", json.loads(result))
        if tool_name == "create_skill":
            config = CreateSkillConfig(
                name=arguments.get("name", ""),
                description=arguments.get("description", ""),
                steps=arguments.get("steps", []),
                tags=arguments.get("tags", []),
                triggers=arguments.get("triggers", []),
                save=arguments.get("save", True),
            )
            result = await create_skill(config)
            return cast("dict[str, Any]", json.loads(result))
        if tool_name == "delete_skill":
            result = await delete_skill(name=arguments.get("name", ""))
            return cast("dict[str, Any]", json.loads(result))
        if tool_name == "get_skill_stats":
            result = await get_skill_stats(name=str(arguments.get("name", "")))
            return cast("dict[str, Any]", json.loads(result))
        if tool_name == "recommend_skills":
            result = await recommend_skills(
                agent_role=str(arguments.get("agent_role", "")),
                recent_tasks=arguments.get("recent_tasks"),
                limit=arguments.get("limit", 3),
            )
            return cast("dict[str, Any]", json.loads(result))
        return {"success": False, "error": f"Unknown skill tool: {tool_name}"}

    async def _handle_health_tools(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle health analysis tools."""
        if not self.user_id:
            return {"success": False, "error": "User ID required for health tools"}

        if tool_name == "analyze_project_health":
            config = HealthAnalysisConfig(
                session_id=self.session_id,
                user_id=self.user_id,
                workspace_id=self.workspace_id,
                working_directory=arguments.get("working_directory"),
            )
            return await analyze_project_health(config)
        if tool_name == "get_health_score":
            return await get_health_score(
                session_id=self.session_id,
                user_id=self.user_id,
            )
        if tool_name == "apply_health_fix":
            return await apply_health_fix(
                session_id=self.session_id,
                user_id=self.user_id,
                recommendation_id=arguments.get("recommendation_id", ""),
                workspace_id=self.workspace_id,
            )
        if tool_name == "list_health_checks":
            return await list_health_checks(
                session_id=self.session_id,
                user_id=self.user_id,
                category=arguments.get("category"),
            )
        return {"success": False, "error": f"Unknown health tool: {tool_name}"}

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
