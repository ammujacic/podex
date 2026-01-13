"""Agent orchestrator for managing multi-agent workflows."""

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

import structlog

from src.agents.agent_builder import AgentBuilderAgent, AgentBuilderConfig
from src.agents.architect import ArchitectAgent
from src.agents.base import AgentConfig, BaseAgent
from src.agents.chat import ChatAgent
from src.agents.coder import CoderAgent
from src.agents.devops import DevOpsAgent
from src.agents.documentator import DocumentatorAgent
from src.agents.orchestrator_agent import OrchestratorAgent
from src.agents.reviewer import ReviewerAgent
from src.agents.security import SecurityAgent
from src.agents.tester import TesterAgent
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
TASK_TTL_SECONDS = 3600  # 1 hour - tasks older than this will be cleaned up
MAX_TASKS = 10000  # Maximum number of tasks before forced cleanup
CLEANUP_INTERVAL_SECONDS = 60  # Minimum time between cleanup runs

# Agent lifecycle settings
AGENT_IDLE_TTL_SECONDS = 1800  # 30 minutes - idle agents older than this will be cleaned up
MAX_AGENTS = 1000  # Maximum number of agents before forced cleanup
MCP_CONNECT_TIMEOUT_SECONDS = 30  # Maximum time to wait for MCP connection


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

        # Perform agent cleanup
        for agent_id in agents_to_remove:
            if agent_id in self.agents:
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

    def get_or_create_agent(
        self,
        params: AgentCreationParams,
        mcp_lifecycle: MCPLifecycleManager | None = None,
    ) -> BaseAgent:
        """Get or create an agent instance.

        Args:
            params: Parameters for creating the agent.
            mcp_lifecycle: Optional MCP lifecycle manager for this session.

        Returns:
            Agent instance.
        """
        # Get MCP registry from lifecycle manager if available
        mcp_registry = mcp_lifecycle.registry if mcp_lifecycle else None

        if params.agent_id not in self.agents:
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
                )
                init_config = CustomAgentInitConfig(
                    agent_id=params.agent_id,
                    model=params.template_config.model or params.model,
                    llm_provider=self.llm_provider,
                    template_config=params.template_config,
                    context=context,
                    mcp_registry=mcp_registry,
                )
                self.agents[params.agent_id] = CustomAgent(init_config)
                logger.info(
                    "Custom agent created",
                    agent_id=params.agent_id,
                    template_name=params.template_config.name,
                    model=params.template_config.model or params.model,
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
                # Built-in agent types
                agent_classes: dict[str, type[BaseAgent]] = {
                    "architect": ArchitectAgent,
                    "coder": CoderAgent,
                    "reviewer": ReviewerAgent,
                    "tester": TesterAgent,
                    "orchestrator": OrchestratorAgent,
                    "chat": ChatAgent,
                    "security": SecurityAgent,
                    "devops": DevOpsAgent,
                    "documentator": DocumentatorAgent,
                }
                agent_class = agent_classes.get(params.role, CoderAgent)

                agent_config = AgentConfig(
                    agent_id=params.agent_id,
                    model=params.model,
                    llm_provider=self.llm_provider,
                    workspace_path=workspace_path,
                    session_id=params.session_id,
                    mcp_registry=mcp_registry,
                    mode=params.mode,
                    command_allowlist=params.command_allowlist,
                    user_id=params.user_id,
                )
                self.agents[params.agent_id] = agent_class(agent_config)
                logger.info(
                    "Agent created",
                    agent_id=params.agent_id,
                    role=params.role,
                    model=params.model,
                    mode=params.mode,
                    workspace=str(workspace_path),
                    mcp_tools=mcp_lifecycle.get_tool_count() if mcp_lifecycle else 0,
                )

        # Update agent activity timestamp
        self._agent_last_activity[params.agent_id] = time.time()

        # Update mode and command_allowlist if they changed (agent may have been cached)
        agent = self.agents[params.agent_id]
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

        return agent

    async def submit_task(self, task: AgentTask) -> str:
        """Submit a task for execution."""
        # Run periodic cleanup to prevent memory leaks
        self._cleanup_old_tasks()
        await self._cleanup_idle_agents()

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
            model = task.context.get("model", "claude-sonnet-4-20250514")
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

            # Get mode and command_allowlist from context
            mode = task.context.get("mode", "ask")
            command_allowlist = task.context.get("command_allowlist")

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
            )
            agent = self.get_or_create_agent(agent_params, mcp_lifecycle)

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
                    "model": agent_config.get("model", "claude-sonnet-4-20250514"),
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
