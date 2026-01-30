"""Agent orchestrator for managing multi-agent workflows."""

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

import httpx
import structlog

from src.agents.agent_builder import AgentBuilderAgent, AgentBuilderConfig
from src.agents.base import BaseAgent
from src.agents.database_agent import create_database_agent
from src.config import settings
from src.mcp.integration import UserMCPConfig, UserMCPServerConfig
from src.mcp.lifecycle import (
    MCPLifecycleManager,
    cleanup_session_mcp,
    get_lifecycle_manager,
)
from src.providers.llm import LLMProvider

logger = structlog.get_logger()

# Workspace base path from settings
WORKSPACE_BASE_PATH = Path(settings.WORKSPACE_BASE_PATH)

# Task retention settings
TASK_TTL_SECONDS = (
    1800  # 30 minutes - tasks older than this will be cleaned up (reduced from 1 hour)
)
MAX_TASKS = 5000  # Maximum number of tasks before forced cleanup (reduced from 10000)
CLEANUP_INTERVAL_SECONDS = 30  # Minimum time between cleanup runs (reduced from 60)

# Agent lifecycle settings
AGENT_IDLE_TTL_SECONDS = (
    900  # 15 minutes - idle agents older than this will be cleaned up (reduced from 30 min)
)
MAX_AGENTS = 500  # Maximum number of agents before forced cleanup (reduced from 1000)
MCP_CONNECT_TIMEOUT_SECONDS = 30  # Maximum time to wait for MCP connection

# Memory warning thresholds
TASK_WARNING_THRESHOLD = 3000  # Log warning when tasks exceed this
AGENT_WARNING_THRESHOLD = 300  # Log warning when agents exceed this


class TaskStatus(str, Enum):
    """Task status enum."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class AgentTask:
    """Agent task definition."""

    session_id: str
    agent_id: str
    message: str
    context: dict[str, Any] = field(default_factory=dict)
    task_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: float = field(default_factory=time.time)


@dataclass
class AgentCreationParams:
    """Parameters for creating an agent."""

    agent_id: str
    role: str
    model: str
    session_id: str
    template_config: Any = None  # AgentTemplateConfig | None (avoiding circular import)
    user_id: str | None = None
    mcp_config: UserMCPConfig | None = None
    # Agent mode: plan, ask, auto, sovereign
    mode: str = "ask"
    # Allowed command patterns for Auto mode
    command_allowlist: list[str] | None = None
    # Workspace container ID for remote tool execution
    workspace_id: str | None = None
    # User-provided LLM API keys for external providers
    llm_api_keys: dict[str, str] | None = None
    # Model's registered provider from database
    model_provider: str | None = None


@dataclass
class MCPConnectionStatus:
    """Status of MCP server connections."""

    connected: bool
    servers_attempted: int = 0
    servers_connected: int = 0
    tools_available: int = 0
    failed_servers: list[str] = field(default_factory=list)
    error: str | None = None


@dataclass
class TaskResult:
    """Task execution result."""

    status: TaskStatus
    response: str | None = None
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None
    mcp_status: MCPConnectionStatus | None = None
    tokens_used: int = 0


class AgentOrchestrator:
    """Orchestrates multi-agent workflows."""

    def __init__(self) -> None:
        """Initialize orchestrator."""
        self.llm_provider = LLMProvider()
        self.tasks: dict[str, AgentTask] = {}
        self.results: dict[str, TaskResult] = {}
        self.agents: dict[str, BaseAgent] = {}
        self._agent_last_activity: dict[str, float] = {}  # Track agent last activity time
        self._last_cleanup = time.time()
        self._last_agent_cleanup = time.time()
        # Lock for task operations to prevent race conditions
        self._task_lock = asyncio.Lock()
        # Lock for agent operations
        self._agent_lock = asyncio.Lock()
        # HTTP client for calling API service (approvals, etc.)
        self._http_timeout = httpx.Timeout(30.0, connect=5.0)

    async def _notify_approval_request(self, approval_data: dict[str, Any]) -> None:
        """Notify the API service about a pending approval request.

        This is called when a native agent needs user approval for an action.
        The API service will store the approval in the database and emit a
        websocket event to notify the frontend.

        Args:
            approval_data: Dict containing approval_id, agent_id, session_id,
                          tool_name, action_type, arguments, can_add_to_allowlist.
        """
        api_url = f"{settings.API_BASE_URL}/api/agents/approvals/request"
        headers: dict[str, str] = {}
        if settings.INTERNAL_SERVICE_TOKEN:
            headers["Authorization"] = f"Bearer {settings.INTERNAL_SERVICE_TOKEN}"

        try:
            async with httpx.AsyncClient(timeout=self._http_timeout) as client:
                response = await client.post(api_url, json=approval_data, headers=headers)
                response.raise_for_status()
                logger.info(
                    "Approval request sent to API service",
                    approval_id=approval_data.get("approval_id"),
                    agent_id=approval_data.get("agent_id"),
                )
        except httpx.TimeoutException as e:
            logger.error(
                "Timeout sending approval request to API service",
                approval_id=approval_data.get("approval_id"),
                error=str(e),
            )
        except httpx.HTTPStatusError as e:
            logger.error(
                "HTTP error sending approval request to API service",
                approval_id=approval_data.get("approval_id"),
                status=e.response.status_code,
                error=str(e),
            )
        except Exception as e:
            logger.error(
                "Failed to send approval request to API service",
                approval_id=approval_data.get("approval_id"),
                error=str(e),
            )

    def _create_approval_callback(
        self,
    ) -> Any:  # Returns Callable[[dict[str, Any]], Awaitable[None]]
        """Create an approval callback for a native agent.

        Returns:
            An async callback function that notifies the API service
            when the agent needs user approval.
        """

        async def callback(approval_data: dict[str, Any]) -> None:
            await self._notify_approval_request(approval_data)

        return callback

    def _cleanup_old_tasks(self) -> None:
        """Remove old completed/failed tasks to prevent memory leaks.

        Tasks are cleaned up if:
        - They are older than TASK_TTL_SECONDS, OR
        - Total tasks exceed MAX_TASKS (in which case oldest are removed)
        """
        current_time = time.time()

        # Skip cleanup if we ran it recently
        if current_time - self._last_cleanup < CLEANUP_INTERVAL_SECONDS:
            return

        self._last_cleanup = current_time

        # Log warning if approaching memory limits
        task_count = len(self.tasks)
        if task_count > TASK_WARNING_THRESHOLD:
            logger.warning(
                "Task count approaching limit - consider scaling or increasing cleanup frequency",
                task_count=task_count,
                warning_threshold=TASK_WARNING_THRESHOLD,
                max_tasks=MAX_TASKS,
            )

        # Find tasks that are completed/failed and older than TTL
        tasks_to_remove = []
        for task_id, task in self.tasks.items():
            result = self.results.get(task_id)
            age = current_time - task.created_at

            # Only remove completed/failed tasks (not pending/running)
            if (
                result
                and result.status in (TaskStatus.COMPLETED, TaskStatus.FAILED)
                and age > TASK_TTL_SECONDS
            ):
                tasks_to_remove.append(task_id)

        # If still over limit, remove oldest completed tasks
        if len(self.tasks) - len(tasks_to_remove) > MAX_TASKS:
            completed_tasks = [
                (tid, self.tasks[tid].created_at)
                for tid in self.tasks
                if tid not in tasks_to_remove
                and self.results.get(tid)
                and self.results[tid].status in (TaskStatus.COMPLETED, TaskStatus.FAILED)
            ]
            completed_tasks.sort(key=lambda x: x[1])  # Sort by created_at

            # Remove oldest until under limit
            excess = len(self.tasks) - len(tasks_to_remove) - MAX_TASKS
            for task_id, _ in completed_tasks[:excess]:
                tasks_to_remove.append(task_id)

        # Perform cleanup
        for task_id in tasks_to_remove:
            del self.tasks[task_id]
            if task_id in self.results:
                del self.results[task_id]

        if tasks_to_remove:
            logger.info(
                "Cleaned up old tasks",
                removed_count=len(tasks_to_remove),
                remaining_count=len(self.tasks),
            )

    async def _cleanup_idle_agents(self) -> None:
        """Remove idle agents and their MCP connections to prevent memory leaks.

        Agents are cleaned up if:
        - They have been idle longer than AGENT_IDLE_TTL_SECONDS, OR
        - Total agents exceed MAX_AGENTS (in which case oldest idle are removed)
        """
        current_time = time.time()

        # Skip cleanup if we ran it recently
        if current_time - self._last_agent_cleanup < CLEANUP_INTERVAL_SECONDS:
            return

        self._last_agent_cleanup = current_time

        # Log warning if approaching memory limits
        agent_count = len(self.agents)
        if agent_count > AGENT_WARNING_THRESHOLD:
            logger.warning(
                "Agent count approaching limit - consider scaling or increasing cleanup frequency",
                agent_count=agent_count,
                warning_threshold=AGENT_WARNING_THRESHOLD,
                max_agents=MAX_AGENTS,
            )

        # Find agents that are idle for too long
        agents_to_remove: list[str] = []
        sessions_to_cleanup: set[str] = set()

        for agent_id, agent in self.agents.items():
            last_activity = self._agent_last_activity.get(agent_id, 0)
            idle_time = current_time - last_activity

            if idle_time > AGENT_IDLE_TTL_SECONDS:
                agents_to_remove.append(agent_id)
                if agent.session_id:
                    sessions_to_cleanup.add(agent.session_id)

        # If still over limit, remove oldest idle agents
        if len(self.agents) - len(agents_to_remove) > MAX_AGENTS:
            # Sort by activity time (oldest first)
            agent_activity = [
                (aid, self._agent_last_activity.get(aid, 0))
                for aid in self.agents
                if aid not in agents_to_remove
            ]
            sorted_agents = sorted(agent_activity, key=lambda x: x[1])
            excess = len(self.agents) - len(agents_to_remove) - MAX_AGENTS
            for agent_id, _ in sorted_agents[:excess]:
                agents_to_remove.append(agent_id)
                session_id = self.agents[agent_id].session_id
                if session_id:
                    sessions_to_cleanup.add(session_id)

        # Perform agent cleanup with resource cleanup
        for agent_id in agents_to_remove:
            if agent_id in self.agents:
                agent = self.agents[agent_id]
                # Cleanup tool executor resources if present
                if agent.tool_executor:
                    try:
                        # Close any open connections/resources in tool executor
                        if hasattr(agent.tool_executor, "cleanup"):
                            await agent.tool_executor.cleanup()
                        elif hasattr(agent.tool_executor, "close"):
                            await agent.tool_executor.close()
                    except Exception as cleanup_error:
                        logger.warning(
                            "Failed to cleanup tool executor for agent",
                            agent_id=agent_id,
                            error=str(cleanup_error),
                        )
                del self.agents[agent_id]
            if agent_id in self._agent_last_activity:
                del self._agent_last_activity[agent_id]

        # Cleanup MCP for sessions that no longer have agents
        for session_id in sessions_to_cleanup:
            # Check if session still has any agents
            has_agents = any(a.session_id == session_id for a in self.agents.values())
            if not has_agents:
                try:
                    await cleanup_session_mcp(session_id)
                except Exception as e:
                    logger.warning(
                        "Failed to cleanup MCP for session",
                        session_id=session_id,
                        error=str(e),
                    )

        if agents_to_remove:
            logger.info(
                "Cleaned up idle agents",
                removed_count=len(agents_to_remove),
                remaining_count=len(self.agents),
                sessions_cleaned=len(sessions_to_cleanup),
            )

    async def _ensure_mcp_connected(
        self,
        session_id: str,
        mcp_config: UserMCPConfig | None,
    ) -> tuple[MCPLifecycleManager | None, MCPConnectionStatus | None]:
        """Ensure MCP servers are connected for a session.

        Args:
            session_id: The session ID.
            mcp_config: User's MCP configuration (from API service).

        Returns:
            Tuple of (lifecycle_manager, mcp_status).
            If no MCP config, returns (None, None).
        """
        if not mcp_config or not mcp_config.servers:
            return None, None

        server_names = [s.name for s in mcp_config.servers]
        server_count = len(mcp_config.servers)

        try:
            lifecycle_manager = await get_lifecycle_manager(session_id)

            # Apply timeout to prevent hanging on slow/unresponsive MCP servers
            try:
                await asyncio.wait_for(
                    lifecycle_manager.ensure_connected(mcp_config),
                    timeout=MCP_CONNECT_TIMEOUT_SECONDS,
                )
            except TimeoutError:
                logger.error(
                    "MCP connection timed out",
                    session_id=session_id,
                    timeout_seconds=MCP_CONNECT_TIMEOUT_SECONDS,
                    server_count=server_count,
                )
                # Clean up any partial connections that may have been established
                # before the timeout to prevent resource leaks
                try:
                    await lifecycle_manager.disconnect_all()
                    logger.info(
                        "Cleaned up partial MCP connections after timeout",
                        session_id=session_id,
                    )
                except Exception as cleanup_error:
                    logger.warning(
                        "Failed to cleanup partial MCP connections after timeout",
                        session_id=session_id,
                        error=str(cleanup_error),
                    )
                mcp_status = MCPConnectionStatus(
                    connected=False,
                    servers_attempted=server_count,
                    servers_connected=0,
                    tools_available=0,
                    failed_servers=server_names,
                    error=f"Connection timed out after {MCP_CONNECT_TIMEOUT_SECONDS}s",
                )
                return None, mcp_status

            # Get connection details from lifecycle manager
            connected_count = lifecycle_manager.get_connected_server_count()
            tool_count = lifecycle_manager.get_tool_count()
            failed_servers = lifecycle_manager.get_failed_servers()

            logger.info(
                "MCP servers connected for session",
                session_id=session_id,
                server_count=server_count,
                connected_count=connected_count,
                tool_count=tool_count,
            )

            mcp_status = MCPConnectionStatus(
                connected=connected_count > 0,
                servers_attempted=server_count,
                servers_connected=connected_count,
                tools_available=tool_count,
                failed_servers=failed_servers,
                error=None
                if connected_count == server_count
                else f"{len(failed_servers)} server(s) failed to connect",
            )
            return lifecycle_manager, mcp_status

        except Exception as e:
            logger.error(
                "Failed to connect MCP servers",
                session_id=session_id,
                error=str(e),
            )
            mcp_status = MCPConnectionStatus(
                connected=False,
                servers_attempted=server_count,
                servers_connected=0,
                tools_available=0,
                failed_servers=server_names,
                error=str(e),
            )
            return None, mcp_status

    def _force_cleanup_idle_agents_sync(self) -> int:
        """Synchronously force cleanup of idle agents.

        Returns:
            Number of agents removed.
        """
        current_time = time.time()
        agents_to_remove: list[str] = []

        # Sort agents by activity time (oldest first)
        agent_activity = [(aid, self._agent_last_activity.get(aid, 0)) for aid in self.agents]
        sorted_agents = sorted(agent_activity, key=lambda x: x[1])

        # Remove oldest idle agents until under limit
        excess = len(self.agents) - MAX_AGENTS + 50  # Leave headroom
        for agent_id, last_activity in sorted_agents[: max(0, excess)]:
            idle_time = current_time - last_activity
            # Only remove if idle for at least 60 seconds
            if idle_time > 60:
                agents_to_remove.append(agent_id)

        # Perform cleanup (without async MCP cleanup to keep it sync)
        for agent_id in agents_to_remove:
            if agent_id in self.agents:
                del self.agents[agent_id]
            if agent_id in self._agent_last_activity:
                del self._agent_last_activity[agent_id]

        if agents_to_remove:
            logger.info(
                "Force cleaned up idle agents (sync)",
                removed_count=len(agents_to_remove),
                remaining_count=len(self.agents),
            )

        return len(agents_to_remove)

    async def get_or_create_agent(
        self,
        params: AgentCreationParams,
        mcp_lifecycle: MCPLifecycleManager | None = None,
    ) -> BaseAgent:
        """Get or create an agent instance.

        Uses DatabaseAgent to load configuration from the database when available.
        Falls back to hardcoded agent classes if database config is not found.

        Args:
            params: Parameters for creating the agent.
            mcp_lifecycle: Optional MCP lifecycle manager for this session.

        Returns:
            Agent instance.

        Raises:
            RuntimeError: If agent limit is exceeded and cleanup cannot free space.
        """
        # Get MCP registry from lifecycle manager if available
        mcp_registry = mcp_lifecycle.registry if mcp_lifecycle else None

        if params.agent_id not in self.agents:
            # Check agent limit before creating new agent
            if len(self.agents) >= MAX_AGENTS:
                removed = self._force_cleanup_idle_agents_sync()
                if removed == 0 or len(self.agents) >= MAX_AGENTS:
                    logger.error(
                        "Agent limit exceeded and cleanup could not free space",
                        current_count=len(self.agents),
                        max_agents=MAX_AGENTS,
                    )
                    raise RuntimeError(
                        f"Agent limit exceeded ({MAX_AGENTS}). Too many concurrent agents."
                    )
            # Create workspace path for this session
            workspace_path = WORKSPACE_BASE_PATH / params.session_id
            workspace_path.mkdir(parents=True, exist_ok=True)

            if params.template_config:
                # Custom agent from template (late import to avoid circular dependency)
                from src.agents.custom import (
                    CustomAgent,
                    CustomAgentContext,
                    CustomAgentInitConfig,
                )

                context = CustomAgentContext(
                    workspace_path=workspace_path,
                    session_id=params.session_id,
                    user_id=params.user_id,
                )
                init_config = CustomAgentInitConfig(
                    agent_id=params.agent_id,
                    model=params.template_config.model or params.model,
                    llm_provider=self.llm_provider,
                    template_config=params.template_config,
                    context=context,
                    mcp_registry=mcp_registry,
                    user_id=params.user_id,
                )
                self.agents[params.agent_id] = CustomAgent(init_config)
                logger.info(
                    "Custom agent created",
                    agent_id=params.agent_id,
                    template_name=params.template_config.name,
                    model=params.template_config.model or params.model,
                    user_id=params.user_id,
                    workspace=str(workspace_path),
                    mcp_tools=mcp_lifecycle.get_tool_count() if mcp_lifecycle else 0,
                )
            elif params.role == "agent_builder":
                # Special Agent Builder agent
                builder_config = AgentBuilderConfig(
                    agent_id=params.agent_id,
                    model=params.model,
                    workspace_path=workspace_path,
                    session_id=params.session_id,
                    user_id=params.user_id,
                )
                self.agents[params.agent_id] = AgentBuilderAgent(
                    config=builder_config,
                    llm_provider=self.llm_provider,
                    mcp_registry=mcp_registry,
                )
                logger.info(
                    "Agent Builder created",
                    agent_id=params.agent_id,
                    model=params.model,
                    user_id=params.user_id,
                    workspace=str(workspace_path),
                    mcp_tools=mcp_lifecycle.get_tool_count() if mcp_lifecycle else 0,
                )
            else:
                # Try to create database-driven agent first
                db_agent = await create_database_agent(
                    agent_id=params.agent_id,
                    role=params.role,
                    model=params.model,
                    llm_provider=self.llm_provider,
                    workspace_path=workspace_path,
                    session_id=params.session_id,
                    mcp_registry=mcp_registry,
                    mode=params.mode,
                    command_allowlist=params.command_allowlist,
                    user_id=params.user_id,
                    workspace_id=params.workspace_id,
                    llm_api_keys=params.llm_api_keys,
                    model_provider=params.model_provider,
                )

                if db_agent:
                    self.agents[params.agent_id] = db_agent
                    logger.info(
                        "Database agent created",
                        agent_id=params.agent_id,
                        role=params.role,
                        model=params.model,
                        mode=params.mode,
                        workspace=str(workspace_path),
                        mcp_tools=mcp_lifecycle.get_tool_count() if mcp_lifecycle else 0,
                        model_provider=params.model_provider,
                        has_llm_keys=bool(params.llm_api_keys),
                    )
                else:
                    # Database agent creation failed - role config not available
                    logger.error(
                        "Failed to create database agent - role config not found",
                        role=params.role,
                        agent_id=params.agent_id,
                    )
                    raise RuntimeError(
                        f"Agent role '{params.role}' not found in database. "
                        "Ensure the API is running and role configurations are seeded."
                    )

        # Update agent activity timestamp
        self._agent_last_activity[params.agent_id] = time.time()

        # Update agent properties that may have changed (agent may have been cached)
        agent = self.agents[params.agent_id]

        # Update model, llm_api_keys, and model_provider if they changed
        # This is critical when user switches models mid-session
        model_changed = agent.model != params.model
        keys_changed = agent.llm_api_keys != params.llm_api_keys
        provider_changed = agent.model_provider != params.model_provider

        if model_changed or keys_changed or provider_changed:
            logger.info(
                "Updating agent LLM settings",
                agent_id=params.agent_id,
                old_model=agent.model,
                new_model=params.model,
                old_provider=agent.model_provider,
                new_provider=params.model_provider,
                has_new_keys=bool(params.llm_api_keys),
            )
            agent.model = params.model
            agent.llm_api_keys = params.llm_api_keys
            agent.model_provider = params.model_provider
            # Also update tool executor's model if present
            if agent.tool_executor:
                agent.tool_executor.agent_model = params.model

        # Update mode if changed
        if agent.mode != params.mode:
            logger.info(
                "Updating agent mode",
                agent_id=params.agent_id,
                old_mode=agent.mode,
                new_mode=params.mode,
            )
            agent.mode = params.mode
            agent._update_mode_context()
        if params.command_allowlist and agent.command_allowlist != params.command_allowlist:
            agent.command_allowlist = params.command_allowlist
            if agent.tool_executor:
                agent.tool_executor.command_allowlist = params.command_allowlist

        # Set up approval callback for Ask/Auto modes
        # This allows the agent to request user approval for restricted actions
        agent.set_approval_callback(self._create_approval_callback())

        return agent

    def _force_cleanup_old_tasks(self) -> int:
        """Force immediate cleanup of old tasks, ignoring time interval.

        Returns:
            Number of tasks removed.
        """
        current_time = time.time()
        tasks_to_remove = []

        # Find completed/failed tasks, prioritizing oldest
        completed_tasks = [
            (tid, self.tasks[tid].created_at)
            for tid in self.tasks
            if self.results.get(tid)
            and self.results[tid].status in (TaskStatus.COMPLETED, TaskStatus.FAILED)
        ]
        completed_tasks.sort(key=lambda x: x[1])  # Sort by created_at (oldest first)

        # Remove oldest tasks until we're under the limit
        excess = len(self.tasks) - MAX_TASKS + 100  # Leave some headroom
        for task_id, _ in completed_tasks[: max(0, excess)]:
            tasks_to_remove.append(task_id)

        # Also remove tasks older than TTL
        for task_id, task in self.tasks.items():
            if task_id in tasks_to_remove:
                continue
            result = self.results.get(task_id)
            age = current_time - task.created_at
            if (
                result
                and result.status in (TaskStatus.COMPLETED, TaskStatus.FAILED)
                and age > TASK_TTL_SECONDS
            ):
                tasks_to_remove.append(task_id)

        # Perform cleanup
        for task_id in tasks_to_remove:
            del self.tasks[task_id]
            if task_id in self.results:
                del self.results[task_id]

        if tasks_to_remove:
            logger.info(
                "Force cleaned up old tasks",
                removed_count=len(tasks_to_remove),
                remaining_count=len(self.tasks),
            )

        return len(tasks_to_remove)

    async def submit_task(self, task: AgentTask) -> str:
        """Submit a task for execution.

        Raises:
            RuntimeError: If task limit is exceeded and cleanup cannot free space.
        """
        async with self._task_lock:
            # Run periodic cleanup to prevent memory leaks
            self._cleanup_old_tasks()
            await self._cleanup_idle_agents()

            # Hard limit enforcement - if at limit, force cleanup
            if len(self.tasks) >= MAX_TASKS:
                removed = self._force_cleanup_old_tasks()
                if removed == 0 or len(self.tasks) >= MAX_TASKS:
                    # Still at limit after cleanup - all tasks are pending/running
                    logger.error(
                        "Task limit exceeded and cleanup could not free space",
                        current_count=len(self.tasks),
                        max_tasks=MAX_TASKS,
                    )
                    raise RuntimeError(
                        f"Task limit exceeded ({MAX_TASKS}). Too many concurrent tasks."
                    )

            self.tasks[task.task_id] = task
            self.results[task.task_id] = TaskResult(status=TaskStatus.PENDING)
            logger.info("Task submitted", task_id=task.task_id, agent_id=task.agent_id)
            return task.task_id

    async def process_task(self, task_id: str) -> TaskResult:
        """Process a submitted task."""
        task = self.tasks.get(task_id)
        if not task:
            return TaskResult(status=TaskStatus.FAILED, error="Task not found")

        self.results[task_id] = TaskResult(status=TaskStatus.RUNNING)
        logger.info("Processing task", task_id=task_id)

        try:
            # Get agent configuration from context
            role = task.context.get("role", "coder")
            model = task.context.get("model")
            if not model:
                raise RuntimeError(
                    "Model is required in task context. "
                    "API must resolve a model from agent/role settings "
                    "before calling agent service."
                )
            user_id = task.context.get("user_id")
            template_config_data = task.context.get("template_config")

            # Build template config if provided
            template_config = None
            if template_config_data:
                # Late import to avoid circular dependency
                from src.agents.custom import AgentTemplateConfig

                template_config = AgentTemplateConfig(
                    name=template_config_data.get("name", ""),
                    system_prompt=template_config_data.get("system_prompt", ""),
                    allowed_tools=template_config_data.get("allowed_tools", []),
                    model=template_config_data.get("model"),
                    temperature=template_config_data.get("temperature"),
                    max_tokens=template_config_data.get("max_tokens"),
                    config=template_config_data.get("config"),
                )

            # Parse MCP config from context if provided
            mcp_config = None
            mcp_config_data = task.context.get("mcp_config")
            if mcp_config_data:
                servers = [
                    UserMCPServerConfig(
                        id=s.get("id", ""),
                        name=s.get("name", ""),
                        transport=s.get("transport", "stdio"),
                        command=s.get("command"),
                        args=s.get("args"),
                        url=s.get("url"),
                        env_vars=s.get("env_vars"),
                    )
                    for s in mcp_config_data.get("servers", [])
                ]
                mcp_config = UserMCPConfig(
                    user_id=mcp_config_data.get("user_id", ""),
                    servers=servers,
                )

            # Ensure MCP servers are connected (if configured)
            mcp_lifecycle, mcp_status = await self._ensure_mcp_connected(
                task.session_id,
                mcp_config,
            )

            # Get mode, command_allowlist, and workspace_id from context
            mode = task.context.get("mode", "ask")
            command_allowlist = task.context.get("command_allowlist")
            workspace_id = task.context.get("workspace_id")  # Workspace container ID
            # Get user's LLM API keys and model provider from database
            llm_api_keys = task.context.get("llm_api_keys")
            model_provider = task.context.get("model_provider")

            logger.debug(
                "Context received from API",
                has_llm_api_keys=bool(llm_api_keys),
                llm_providers=list(llm_api_keys.keys()) if llm_api_keys else [],
                model_provider=model_provider,
                model=str(model),
            )

            # Get or create agent
            agent_params = AgentCreationParams(
                agent_id=task.agent_id,
                role=str(role),
                model=str(model),
                session_id=task.session_id,
                template_config=template_config,
                user_id=user_id,
                mcp_config=mcp_config,
                mode=mode,
                command_allowlist=command_allowlist,
                workspace_id=workspace_id,
                llm_api_keys=llm_api_keys,
                model_provider=model_provider,
            )
            agent = await self.get_or_create_agent(agent_params, mcp_lifecycle)

            # Load conversation history from database to ensure context is preserved
            await agent.load_conversation_history()

            # Execute agent - use streaming if message_id is provided
            stream_enabled = task.context.get("stream", False)
            message_id = task.context.get("message_id")

            if stream_enabled and message_id:
                # Stream tokens to Redis for real-time delivery
                logger.info(
                    "Executing agent with streaming",
                    agent_id=task.agent_id,
                    message_id=message_id,
                )
                response = await agent.execute_streaming(
                    message=task.message,
                    message_id=message_id,
                    _context=task.context,
                )
            else:
                # Non-streaming execution
                response = await agent.execute(
                    message=task.message,
                    _context=task.context,
                )

            # Update agent activity timestamp after execution completes
            self._agent_last_activity[task.agent_id] = time.time()

            result = TaskResult(
                status=TaskStatus.COMPLETED,
                response=response.content,
                tool_calls=response.tool_calls,
                mcp_status=mcp_status,
                tokens_used=response.tokens_used,
            )

        except Exception as e:
            # Update activity even on failure to prevent cleanup during error handling
            self._agent_last_activity[task.agent_id] = time.time()
            logger.error("Task execution failed", task_id=task_id, error=str(e))
            result = TaskResult(status=TaskStatus.FAILED, error=str(e))

        self.results[task_id] = result
        return result

    async def get_task_status(self, task_id: str) -> dict[str, Any]:
        """Get task status and result."""
        result = self.results.get(task_id)
        if not result:
            return {"status": "not_found"}

        response: dict[str, Any] = {
            "status": result.status.value,
            "response": result.response,
            "tool_calls": result.tool_calls,
            "error": result.error,
            "tokens_used": result.tokens_used,
        }

        # Include MCP status if available
        if result.mcp_status:
            response["mcp_status"] = {
                "connected": result.mcp_status.connected,
                "servers_attempted": result.mcp_status.servers_attempted,
                "servers_connected": result.mcp_status.servers_connected,
                "tools_available": result.mcp_status.tools_available,
                "failed_servers": result.mcp_status.failed_servers,
                "error": result.mcp_status.error,
            }

        return response

    async def cancel_task(self, task_id: str) -> dict[str, Any]:
        """Cancel a running or pending task.

        Args:
            task_id: The task ID to cancel.

        Returns:
            Dict with status and message.
        """
        task = self.tasks.get(task_id)
        result = self.results.get(task_id)

        if not task:
            return {"success": False, "error": "Task not found"}

        if result and result.status in (TaskStatus.COMPLETED, TaskStatus.FAILED):
            return {"success": False, "error": f"Task already {result.status.value}"}

        # Mark task as failed with cancellation message
        self.results[task_id] = TaskResult(
            status=TaskStatus.FAILED,
            error="Task cancelled by user",
        )

        logger.info("Task cancelled", task_id=task_id, agent_id=task.agent_id)

        return {"success": True, "message": "Task cancelled"}

    async def cancel_agent_tasks(self, agent_id: str) -> dict[str, Any]:
        """Cancel all running or pending tasks for an agent.

        Args:
            agent_id: The agent ID whose tasks should be cancelled.

        Returns:
            Dict with success status and count of cancelled tasks.
        """
        cancelled_count = 0

        for task_id, task in list(self.tasks.items()):
            if task.agent_id != agent_id:
                continue

            result = self.results.get(task_id)
            if result and result.status in (TaskStatus.COMPLETED, TaskStatus.FAILED):
                continue

            # Mark task as failed with cancellation message
            self.results[task_id] = TaskResult(
                status=TaskStatus.FAILED,
                error="Task cancelled by user",
            )
            cancelled_count += 1
            logger.info("Task cancelled for agent", task_id=task_id, agent_id=agent_id)

        return {
            "success": True,
            "cancelled_count": cancelled_count,
            "message": f"Cancelled {cancelled_count} task(s)",
        }

    async def delegate_to_agents(
        self,
        session_id: str,
        task_description: str,
        agents: list[dict[str, str]],
    ) -> list[str]:
        """Delegate a complex task to multiple agents."""
        task_ids = []

        for agent_config in agents:
            task = AgentTask(
                session_id=session_id,
                agent_id=agent_config["id"],
                message=task_description,
                context={
                    "role": agent_config.get("role", "coder"),
                    "model": agent_config["model"],
                },
            )
            task_id = await self.submit_task(task)
            task_ids.append(task_id)

        return task_ids

    async def cleanup_session(self, session_id: str) -> None:
        """Cleanup resources for a session.

        This should be called when a session ends to:
        - Disconnect MCP servers
        - Remove cached agents
        - Clear pending tasks

        Args:
            session_id: The session ID to cleanup.
        """
        # Cleanup MCP connections for this session
        await cleanup_session_mcp(session_id)

        # Remove agents for this session
        agents_to_remove = [
            agent_id for agent_id, agent in self.agents.items() if agent.session_id == session_id
        ]
        for agent_id in agents_to_remove:
            del self.agents[agent_id]
            # Also remove activity tracking
            if agent_id in self._agent_last_activity:
                del self._agent_last_activity[agent_id]

        # Remove pending/running tasks for this session
        tasks_to_remove = [
            task_id for task_id, task in self.tasks.items() if task.session_id == session_id
        ]
        for task_id in tasks_to_remove:
            if task_id in self.tasks:
                del self.tasks[task_id]
            if task_id in self.results:
                del self.results[task_id]

        logger.info(
            "Session cleanup completed",
            session_id=session_id,
            agents_removed=len(agents_to_remove),
            tasks_removed=len(tasks_to_remove),
        )

    async def get_mcp_status(self, session_id: str) -> dict[str, Any]:
        """Get MCP status for a session.

        Args:
            session_id: The session ID.

        Returns:
            MCP status dict with server info.
        """
        try:
            lifecycle_manager = await get_lifecycle_manager(session_id)
            return lifecycle_manager.get_server_status()
        except Exception as e:
            logger.error(
                "Failed to get MCP status",
                session_id=session_id,
                error=str(e),
            )
            return {
                "session_id": session_id,
                "connected": False,
                "servers": [],
                "total_tools": 0,
                "error": str(e),
            }

    def resolve_approval(
        self,
        agent_id: str,
        approval_id: str,
        approved: bool,
        add_to_allowlist: bool = False,
    ) -> dict[str, Any]:
        """Resolve a pending approval request for an agent.

        This is called when a user approves or rejects an action in the frontend.

        Args:
            agent_id: The agent ID.
            approval_id: The approval request ID.
            approved: Whether the action was approved.
            add_to_allowlist: Whether to add the command to the agent's allowlist.

        Returns:
            Dict with success status and message.
        """
        agent = self.agents.get(agent_id)
        if not agent:
            logger.warning(
                "Agent not found for approval resolution",
                agent_id=agent_id,
                approval_id=approval_id,
            )
            return {
                "success": False,
                "error": f"Agent {agent_id} not found in memory",
            }

        # Agent must have a tool executor
        if not agent.tool_executor:
            logger.warning(
                "Agent has no tool executor",
                agent_id=agent_id,
                approval_id=approval_id,
            )
            return {
                "success": False,
                "error": "Agent has no tool executor",
            }

        # Resolve the approval
        resolved = agent.tool_executor.resolve_approval(
            approval_id=approval_id,
            approved=approved,
            add_to_allowlist=add_to_allowlist,
        )

        if resolved:
            logger.info(
                "Approval resolved",
                agent_id=agent_id,
                approval_id=approval_id,
                approved=approved,
                add_to_allowlist=add_to_allowlist,
            )
            return {"success": True, "message": "Approval resolved"}
        else:
            logger.warning(
                "Approval not found or already resolved",
                agent_id=agent_id,
                approval_id=approval_id,
            )
            return {
                "success": False,
                "error": "Approval not found or already resolved",
            }
