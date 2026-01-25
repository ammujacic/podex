"""Integration tests for Agent Orchestrator.

Tests core orchestration flows with real database and Redis:
- Task lifecycle (submit → process → complete/fail)
- Agent creation and caching
- Agent cleanup (idle timeout, max agents)
- MCP connection management
- Task cleanup
"""

import asyncio
import time
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.orchestrator import (
    AGENT_IDLE_TTL_SECONDS,
    MAX_AGENTS,
    MAX_TASKS,
    TASK_TTL_SECONDS,
    AgentCreationParams,
    AgentOrchestrator,
    AgentTask,
    MCPConnectionStatus,
    TaskResult,
    TaskStatus,
)


class TestOrchestratorTaskLifecycle:
    """Test task lifecycle (unit tests - no external dependencies)."""

    @pytest.fixture
    async def orchestrator(self) -> AgentOrchestrator:
        """Create orchestrator instance."""
        orch = AgentOrchestrator()
        yield orch
        # Cleanup
        orch.tasks.clear()
        orch.results.clear()
        orch.agents.clear()

    @pytest.fixture
    def mock_agent(self) -> MagicMock:
        """Mock agent for task execution."""
        mock = MagicMock()
        mock.session_id = "session-123"
        mock.role = "architect"
        mock.execute = AsyncMock(return_value={
            "content": "Task completed successfully",
            "tool_calls": [],
        })
        return mock

    async def test_submit_task_creates_pending_task(
        self,
        orchestrator: AgentOrchestrator,
    ):
        """Test that submitting a task creates a pending task."""
        task = AgentTask(
            session_id="session-123",
            agent_id="agent-123",
            message="Test message",
        )

        task_id = await orchestrator.submit_task(task)

        assert task_id == task.task_id
        assert task_id in orchestrator.tasks
        assert orchestrator.tasks[task_id] == task
        assert task_id in orchestrator.results
        assert orchestrator.results[task_id].status == TaskStatus.PENDING

    async def test_task_cleanup_removes_old_completed_tasks(
        self,
        orchestrator: AgentOrchestrator,
    ):
        """Test that old completed tasks are cleaned up."""
        # Create old completed task
        old_task = AgentTask(
            session_id="session-123",
            agent_id="agent-123",
            message="Old task",
            created_at=time.time() - TASK_TTL_SECONDS - 100,
        )
        await orchestrator.submit_task(old_task)
        orchestrator.results[old_task.task_id].status = TaskStatus.COMPLETED

        # Create recent completed task
        recent_task = AgentTask(
            session_id="session-123",
            agent_id="agent-123",
            message="Recent task",
        )
        await orchestrator.submit_task(recent_task)
        orchestrator.results[recent_task.task_id].status = TaskStatus.COMPLETED

        # Run cleanup
        orchestrator._last_cleanup = 0  # Force cleanup
        orchestrator._cleanup_old_tasks()

        # Old task should be removed, recent task should remain
        assert old_task.task_id not in orchestrator.tasks
        assert recent_task.task_id in orchestrator.tasks

    async def test_task_cleanup_enforces_max_limit(
        self,
        orchestrator: AgentOrchestrator,
    ):
        """Test that task cleanup enforces MAX_TASKS limit."""
        # Use patch to reduce MAX_TASKS for testing efficiency
        with patch("src.orchestrator.MAX_TASKS", 100):
            test_count = 200  # Exceed the patched MAX_TASKS

            # Directly populate tasks and results to avoid slow submit_task loop
            for i in range(test_count):
                task = AgentTask(
                    session_id=f"session-{i}",
                    agent_id=f"agent-{i}",
                    message=f"Task {i}",
                    created_at=time.time() - 100 - i,  # Older tasks first
                )
                orchestrator.tasks[task.task_id] = task
                orchestrator.results[task.task_id] = TaskResult(status=TaskStatus.COMPLETED)

            initial_count = len(orchestrator.tasks)
            assert initial_count == test_count

            # Run force cleanup - use the patched MAX_TASKS value
            # excess = len(tasks) - MAX_TASKS + 100 = 200 - 100 + 100 = 200
            removed = orchestrator._force_cleanup_old_tasks()

            # Should remove oldest completed tasks
            assert removed > 0, "Should have cleaned up some tasks"
            assert len(orchestrator.tasks) < initial_count, "Task count should decrease after cleanup"


@pytest.mark.integration
class TestOrchestratorAgentManagement:
    """Test agent creation, caching, and cleanup."""

    @pytest.fixture
    async def orchestrator(self) -> AgentOrchestrator:
        """Create orchestrator instance."""
        orch = AgentOrchestrator()
        yield orch
        # Cleanup
        orch.tasks.clear()
        orch.results.clear()
        orch.agents.clear()
        orch._agent_last_activity.clear()

    async def test_get_or_create_agent_caches_agent(
        self,
        orchestrator: AgentOrchestrator,
    ):
        """Test that get_or_create_agent caches agents."""
        params = AgentCreationParams(
            agent_id="agent-123",
            role="architect",
            model="claude-3-5-sonnet-20241022",
            session_id="session-123",
            mode="ask",
        )

        with patch("src.orchestrator.create_database_agent", new_callable=AsyncMock) as mock_create:
            mock_agent = MagicMock()
            mock_agent.session_id = "session-123"
            mock_agent.role = "architect"
            mock_create.return_value = mock_agent

            # First call should create agent
            agent1 = await orchestrator.get_or_create_agent(params)
            assert agent1 == mock_agent
            assert mock_create.call_count == 1

            # Second call should return cached agent
            agent2 = await orchestrator.get_or_create_agent(params)
            assert agent2 == mock_agent
            assert mock_create.call_count == 1  # Not called again

    async def test_agent_cleanup_removes_idle_agents(
        self,
        orchestrator: AgentOrchestrator,
    ):
        """Test that idle agents are cleaned up."""
        # Create idle agent
        mock_agent = MagicMock()
        mock_agent.session_id = "session-123"
        mock_agent.tool_executor = None

        orchestrator.agents["agent-123"] = mock_agent
        orchestrator._agent_last_activity["agent-123"] = time.time() - AGENT_IDLE_TTL_SECONDS - 100

        # Create active agent
        mock_agent2 = MagicMock()
        mock_agent2.session_id = "session-456"
        mock_agent2.tool_executor = None

        orchestrator.agents["agent-456"] = mock_agent2
        orchestrator._agent_last_activity["agent-456"] = time.time()

        # Run cleanup
        orchestrator._last_agent_cleanup = 0  # Force cleanup
        await orchestrator._cleanup_idle_agents()

        # Idle agent should be removed, active agent should remain
        assert "agent-123" not in orchestrator.agents
        assert "agent-456" in orchestrator.agents

    async def test_agent_cleanup_enforces_max_limit(
        self,
        orchestrator: AgentOrchestrator,
    ):
        """Test that agent cleanup enforces MAX_AGENTS limit."""
        # Create more than MAX_AGENTS
        for i in range(MAX_AGENTS + 50):
            mock_agent = MagicMock()
            mock_agent.session_id = f"session-{i}"
            mock_agent.tool_executor = None

            orchestrator.agents[f"agent-{i}"] = mock_agent
            orchestrator._agent_last_activity[f"agent-{i}"] = time.time() - 100 - i

        # Run cleanup
        orchestrator._last_agent_cleanup = 0  # Force cleanup
        await orchestrator._cleanup_idle_agents()

        # Should be under MAX_AGENTS
        assert len(orchestrator.agents) <= MAX_AGENTS

    async def test_agent_mode_update_on_cached_agent(
        self,
        orchestrator: AgentOrchestrator,
    ):
        """Test that mode is updated when getting cached agent with different mode."""
        params_ask = AgentCreationParams(
            agent_id="agent-123",
            role="architect",
            model="claude-3-5-sonnet-20241022",
            session_id="session-123",
            mode="ask",
        )

        with patch("src.orchestrator.create_database_agent", new_callable=AsyncMock) as mock_create:
            mock_agent = MagicMock()
            mock_agent.session_id = "session-123"
            mock_agent.role = "architect"
            mock_agent.mode = "ask"
            mock_agent.update_mode = MagicMock()
            mock_create.return_value = mock_agent

            # Create agent with ask mode
            agent1 = await orchestrator.get_or_create_agent(params_ask)
            assert agent1.mode == "ask"

            # Get same agent with auto mode
            params_auto = AgentCreationParams(
                agent_id="agent-123",
                role="architect",
                model="claude-3-5-sonnet-20241022",
                session_id="session-123",
                mode="auto",
            )

            agent2 = await orchestrator.get_or_create_agent(params_auto)
            # Should update mode on cached agent
            assert agent2 == agent1
            # Orchestrator directly sets agent.mode (not update_mode method)
            assert agent2.mode == "auto"


@pytest.mark.integration
class TestOrchestratorMCPIntegration:
    """Test MCP connection management."""

    @pytest.fixture
    async def orchestrator(self) -> AgentOrchestrator:
        """Create orchestrator instance."""
        orch = AgentOrchestrator()
        yield orch
        # Cleanup
        orch.agents.clear()

    async def test_mcp_connection_established_for_session(
        self,
        orchestrator: AgentOrchestrator,
    ):
        """Test that MCP connections are established via _ensure_mcp_connected."""
        from src.mcp.integration import UserMCPConfig, UserMCPServerConfig

        mcp_config = UserMCPConfig(
            user_id="user-123",
            servers=[
                UserMCPServerConfig(
                    id="server-1",
                    name="test-server",
                    transport="stdio",
                    command="test",
                    args=[],
                )
            ],
        )

        with patch("src.orchestrator.get_lifecycle_manager", new_callable=AsyncMock) as mock_get_manager:
            mock_manager = MagicMock()
            mock_manager.ensure_connected = AsyncMock()
            mock_manager.get_connected_server_count = MagicMock(return_value=1)
            mock_manager.get_tool_count = MagicMock(return_value=5)
            mock_manager.get_failed_servers = MagicMock(return_value=[])
            mock_manager.registry = MagicMock()
            mock_get_manager.return_value = mock_manager

            lifecycle, status = await orchestrator._ensure_mcp_connected(
                "session-123", mcp_config
            )

            mock_get_manager.assert_called_once_with("session-123")
            mock_manager.ensure_connected.assert_called_once_with(mcp_config)
            assert status is not None
            assert status.connected is True
            assert status.servers_connected == 1
            assert status.tools_available == 5

    async def test_mcp_timeout_handled_gracefully(
        self,
        orchestrator: AgentOrchestrator,
    ):
        """Test that MCP connection timeouts are handled gracefully."""
        from src.mcp.integration import UserMCPConfig, UserMCPServerConfig

        mcp_config = UserMCPConfig(
            user_id="user-123",
            servers=[
                UserMCPServerConfig(
                    id="server-1",
                    name="slow-server",
                    transport="stdio",
                    command="test",
                    args=[],
                )
            ],
        )

        with patch("src.orchestrator.get_lifecycle_manager", new_callable=AsyncMock) as mock_get_manager:
            mock_manager = MagicMock()
            # Simulate timeout
            mock_manager.ensure_connected = AsyncMock(side_effect=TimeoutError())
            mock_manager.disconnect_all = AsyncMock()
            mock_get_manager.return_value = mock_manager

            lifecycle, status = await orchestrator._ensure_mcp_connected(
                "session-123", mcp_config
            )

            # Should return None lifecycle but valid status with error info
            assert lifecycle is None
            assert status is not None
            assert status.connected is False
            assert status.servers_connected == 0
            assert "slow-server" in status.failed_servers
            assert "timed out" in status.error.lower()
            # Should attempt cleanup after timeout
            mock_manager.disconnect_all.assert_called_once()

    async def test_mcp_cleanup_when_session_ends(
        self,
        orchestrator: AgentOrchestrator,
    ):
        """Test that MCP connections are cleaned up when all session agents are removed."""
        mock_agent = MagicMock()
        mock_agent.session_id = "session-123"
        mock_agent.tool_executor = None

        orchestrator.agents["agent-123"] = mock_agent
        orchestrator._agent_last_activity["agent-123"] = time.time() - AGENT_IDLE_TTL_SECONDS - 100

        with patch("src.orchestrator.cleanup_session_mcp", new_callable=AsyncMock) as mock_cleanup:
            # Run cleanup
            orchestrator._last_agent_cleanup = 0
            await orchestrator._cleanup_idle_agents()

            # MCP cleanup should be called for the session
            mock_cleanup.assert_called_once_with("session-123")


@pytest.mark.integration
class TestOrchestratorApprovalWorkflow:
    """Test approval request workflow."""

    @pytest.fixture
    async def orchestrator(self) -> AgentOrchestrator:
        """Create orchestrator instance."""
        return AgentOrchestrator()

    async def test_approval_request_sent_to_api(
        self,
        orchestrator: AgentOrchestrator,
    ):
        """Test that approval requests are sent to the API service."""
        approval_data = {
            "approval_id": "approval-123",
            "agent_id": "agent-123",
            "session_id": "session-123",
            "tool_name": "run_command",
            "action_type": "command",
            "arguments": {"command": "ls -la"},
            "can_add_to_allowlist": True,
        }

        with patch("httpx.AsyncClient") as mock_client:
            mock_response = MagicMock()
            mock_response.raise_for_status = MagicMock()
            mock_post = AsyncMock(return_value=mock_response)

            mock_client.return_value.__aenter__.return_value.post = mock_post

            await orchestrator._notify_approval_request(approval_data)

            # Should call API service
            mock_post.assert_called_once()
            args, kwargs = mock_post.call_args
            assert "json" in kwargs
            assert kwargs["json"] == approval_data

    async def test_approval_timeout_handled_gracefully(
        self,
        orchestrator: AgentOrchestrator,
    ):
        """Test that approval request timeouts are handled gracefully."""
        approval_data = {
            "approval_id": "approval-123",
            "agent_id": "agent-123",
            "session_id": "session-123",
            "tool_name": "run_command",
        }

        with patch("httpx.AsyncClient") as mock_client:
            import httpx
            mock_client.return_value.__aenter__.return_value.post = AsyncMock(
                side_effect=httpx.TimeoutException("Timeout")
            )

            # Should not raise exception
            await orchestrator._notify_approval_request(approval_data)


@pytest.mark.integration
class TestOrchestratorErrorHandling:
    """Test error handling in orchestrator."""

    @pytest.fixture
    async def orchestrator(self) -> AgentOrchestrator:
        """Create orchestrator instance."""
        orch = AgentOrchestrator()
        yield orch
        orch.tasks.clear()
        orch.results.clear()

    async def test_task_limit_exceeded_cleanup(
        self,
        orchestrator: AgentOrchestrator,
    ):
        """Test that tasks are cleaned up when limit is exceeded."""
        # Fill up with completed tasks
        for i in range(MAX_TASKS + 50):
            task = AgentTask(
                session_id=f"session-{i}",
                agent_id=f"agent-{i}",
                message=f"Task {i}",
                created_at=time.time() - 1000,
            )
            await orchestrator.submit_task(task)
            orchestrator.results[task.task_id].status = TaskStatus.COMPLETED

        # Force cleanup
        orchestrator._last_cleanup = 0
        orchestrator._cleanup_old_tasks()

        # Should enforce limit
        assert len(orchestrator.tasks) <= MAX_TASKS


class TestTaskStatusDataclass:
    """Test TaskStatus enum and related dataclasses."""

    def test_task_status_enum_values(self):
        """Test TaskStatus enum has expected values."""
        assert TaskStatus.PENDING.value == "pending"
        assert TaskStatus.RUNNING.value == "running"
        assert TaskStatus.COMPLETED.value == "completed"
        assert TaskStatus.FAILED.value == "failed"

    def test_task_status_is_string_enum(self):
        """Test TaskStatus is a string enum."""
        assert str(TaskStatus.PENDING) == "TaskStatus.PENDING"
        assert TaskStatus.COMPLETED == "completed"

    def test_agent_task_creation(self):
        """Test AgentTask dataclass creation."""
        task = AgentTask(
            session_id="session-123",
            agent_id="agent-456",
            message="Test message",
            context={"key": "value"},
        )

        assert task.session_id == "session-123"
        assert task.agent_id == "agent-456"
        assert task.message == "Test message"
        assert task.context == {"key": "value"}
        assert task.task_id is not None
        assert task.created_at > 0

    def test_agent_task_default_context(self):
        """Test AgentTask default context is empty dict."""
        task = AgentTask(
            session_id="session-123",
            agent_id="agent-456",
            message="Test",
        )
        assert task.context == {}

    def test_mcp_connection_status_creation(self):
        """Test MCPConnectionStatus dataclass creation."""
        status = MCPConnectionStatus(
            connected=True,
            servers_attempted=3,
            servers_connected=2,
            tools_available=10,
            failed_servers=["server-3"],
            error="Server 3 failed",
        )

        assert status.connected is True
        assert status.servers_attempted == 3
        assert status.servers_connected == 2
        assert status.tools_available == 10
        assert status.failed_servers == ["server-3"]
        assert status.error == "Server 3 failed"

    def test_mcp_connection_status_defaults(self):
        """Test MCPConnectionStatus default values."""
        status = MCPConnectionStatus(connected=False)

        assert status.servers_attempted == 0
        assert status.servers_connected == 0
        assert status.tools_available == 0
        assert status.failed_servers == []
        assert status.error is None

    def test_task_result_creation(self):
        """Test TaskResult dataclass creation."""
        result = TaskResult(
            status=TaskStatus.COMPLETED,
            response="Success!",
            tool_calls=[{"name": "tool1", "args": {}}],
            error=None,
            tokens_used=150,
        )

        assert result.status == TaskStatus.COMPLETED
        assert result.response == "Success!"
        assert result.tool_calls == [{"name": "tool1", "args": {}}]
        assert result.error is None
        assert result.tokens_used == 150

    def test_task_result_defaults(self):
        """Test TaskResult default values."""
        result = TaskResult(status=TaskStatus.PENDING)

        assert result.response is None
        assert result.tool_calls == []
        assert result.error is None
        assert result.mcp_status is None
        assert result.tokens_used == 0

    def test_agent_creation_params_defaults(self):
        """Test AgentCreationParams default values."""
        params = AgentCreationParams(
            agent_id="agent-123",
            role="coder",
            model="claude-3-5-sonnet",
            session_id="session-123",
        )

        assert params.template_config is None
        assert params.user_id is None
        assert params.mcp_config is None
        assert params.mode == "ask"
        assert params.command_allowlist is None
        assert params.workspace_id is None


class TestOrchestratorGetTaskStatus:
    """Test get_task_status method."""

    @pytest.fixture
    async def orchestrator(self) -> AgentOrchestrator:
        """Create orchestrator instance."""
        orch = AgentOrchestrator()
        yield orch
        orch.tasks.clear()
        orch.results.clear()

    async def test_get_task_status_not_found(self, orchestrator: AgentOrchestrator):
        """Test get_task_status with non-existent task."""
        status = await orchestrator.get_task_status("non-existent-task")
        assert status == {"status": "not_found"}

    async def test_get_task_status_pending(self, orchestrator: AgentOrchestrator):
        """Test get_task_status for pending task."""
        task = AgentTask(
            session_id="session-123",
            agent_id="agent-123",
            message="Test",
        )
        await orchestrator.submit_task(task)

        status = await orchestrator.get_task_status(task.task_id)

        assert status["status"] == "pending"
        assert status["response"] is None
        assert status["tool_calls"] == []
        assert status["error"] is None

    async def test_get_task_status_completed_with_mcp(self, orchestrator: AgentOrchestrator):
        """Test get_task_status with MCP status."""
        task = AgentTask(
            session_id="session-123",
            agent_id="agent-123",
            message="Test",
        )
        await orchestrator.submit_task(task)

        # Update result with MCP status
        mcp_status = MCPConnectionStatus(
            connected=True,
            servers_attempted=2,
            servers_connected=2,
            tools_available=5,
        )
        orchestrator.results[task.task_id] = TaskResult(
            status=TaskStatus.COMPLETED,
            response="Done",
            tokens_used=100,
            mcp_status=mcp_status,
        )

        status = await orchestrator.get_task_status(task.task_id)

        assert status["status"] == "completed"
        assert status["response"] == "Done"
        assert status["tokens_used"] == 100
        assert "mcp_status" in status
        assert status["mcp_status"]["connected"] is True
        assert status["mcp_status"]["tools_available"] == 5


class TestOrchestratorCancelTask:
    """Test cancel_task method."""

    @pytest.fixture
    async def orchestrator(self) -> AgentOrchestrator:
        """Create orchestrator instance."""
        orch = AgentOrchestrator()
        yield orch
        orch.tasks.clear()
        orch.results.clear()

    async def test_cancel_task_not_found(self, orchestrator: AgentOrchestrator):
        """Test cancelling non-existent task."""
        result = await orchestrator.cancel_task("non-existent")
        assert result["success"] is False
        assert "not found" in result["error"].lower()

    async def test_cancel_task_already_completed(self, orchestrator: AgentOrchestrator):
        """Test cancelling already completed task."""
        task = AgentTask(
            session_id="session-123",
            agent_id="agent-123",
            message="Test",
        )
        await orchestrator.submit_task(task)
        orchestrator.results[task.task_id].status = TaskStatus.COMPLETED

        result = await orchestrator.cancel_task(task.task_id)

        assert result["success"] is False
        assert "already completed" in result["error"].lower()

    async def test_cancel_task_already_failed(self, orchestrator: AgentOrchestrator):
        """Test cancelling already failed task."""
        task = AgentTask(
            session_id="session-123",
            agent_id="agent-123",
            message="Test",
        )
        await orchestrator.submit_task(task)
        orchestrator.results[task.task_id].status = TaskStatus.FAILED

        result = await orchestrator.cancel_task(task.task_id)

        assert result["success"] is False
        assert "already failed" in result["error"].lower()

    async def test_cancel_pending_task_success(self, orchestrator: AgentOrchestrator):
        """Test cancelling pending task."""
        task = AgentTask(
            session_id="session-123",
            agent_id="agent-123",
            message="Test",
        )
        await orchestrator.submit_task(task)

        result = await orchestrator.cancel_task(task.task_id)

        assert result["success"] is True
        assert orchestrator.results[task.task_id].status == TaskStatus.FAILED
        assert "cancelled" in orchestrator.results[task.task_id].error.lower()


class TestOrchestratorCancelAgentTasks:
    """Test cancel_agent_tasks method."""

    @pytest.fixture
    async def orchestrator(self) -> AgentOrchestrator:
        """Create orchestrator instance."""
        orch = AgentOrchestrator()
        yield orch
        orch.tasks.clear()
        orch.results.clear()

    async def test_cancel_agent_tasks_no_tasks(self, orchestrator: AgentOrchestrator):
        """Test cancelling tasks for agent with no tasks."""
        result = await orchestrator.cancel_agent_tasks("agent-123")
        assert result["success"] is True
        assert result["cancelled_count"] == 0

    async def test_cancel_agent_tasks_success(self, orchestrator: AgentOrchestrator):
        """Test cancelling all tasks for an agent."""
        # Create multiple tasks for same agent
        for i in range(3):
            task = AgentTask(
                session_id="session-123",
                agent_id="agent-123",
                message=f"Task {i}",
            )
            await orchestrator.submit_task(task)

        # Create task for different agent
        other_task = AgentTask(
            session_id="session-456",
            agent_id="agent-456",
            message="Other task",
        )
        await orchestrator.submit_task(other_task)

        result = await orchestrator.cancel_agent_tasks("agent-123")

        assert result["success"] is True
        assert result["cancelled_count"] == 3

        # Other agent's task should not be affected
        assert orchestrator.results[other_task.task_id].status == TaskStatus.PENDING

    async def test_cancel_agent_tasks_skips_completed(self, orchestrator: AgentOrchestrator):
        """Test that completed tasks are skipped when cancelling."""
        task1 = AgentTask(
            session_id="session-123",
            agent_id="agent-123",
            message="Task 1",
        )
        await orchestrator.submit_task(task1)
        orchestrator.results[task1.task_id].status = TaskStatus.COMPLETED

        task2 = AgentTask(
            session_id="session-123",
            agent_id="agent-123",
            message="Task 2",
        )
        await orchestrator.submit_task(task2)

        result = await orchestrator.cancel_agent_tasks("agent-123")

        assert result["cancelled_count"] == 1
        # Completed task should remain completed
        assert orchestrator.results[task1.task_id].status == TaskStatus.COMPLETED


class TestOrchestratorDelegateToAgents:
    """Test delegate_to_agents method."""

    @pytest.fixture
    async def orchestrator(self) -> AgentOrchestrator:
        """Create orchestrator instance."""
        orch = AgentOrchestrator()
        yield orch
        orch.tasks.clear()
        orch.results.clear()

    async def test_delegate_to_agents_creates_tasks(self, orchestrator: AgentOrchestrator):
        """Test delegating task to multiple agents."""
        agents = [
            {"id": "agent-1", "role": "architect", "model": "claude-3-5-sonnet"},
            {"id": "agent-2", "role": "coder", "model": "claude-3-5-sonnet"},
            {"id": "agent-3", "role": "reviewer"},
        ]

        task_ids = await orchestrator.delegate_to_agents(
            session_id="session-123",
            task_description="Build a feature",
            agents=agents,
        )

        assert len(task_ids) == 3

        # Verify all tasks were created
        for task_id in task_ids:
            assert task_id in orchestrator.tasks
            assert orchestrator.results[task_id].status == TaskStatus.PENDING

        # Verify task properties
        task1 = orchestrator.tasks[task_ids[0]]
        assert task1.agent_id == "agent-1"
        assert task1.message == "Build a feature"
        assert task1.context["role"] == "architect"

    async def test_delegate_to_agents_default_values(self, orchestrator: AgentOrchestrator):
        """Test delegation with default role and model."""
        agents = [{"id": "agent-1"}]

        task_ids = await orchestrator.delegate_to_agents(
            session_id="session-123",
            task_description="Test task",
            agents=agents,
        )

        task = orchestrator.tasks[task_ids[0]]
        assert task.context["role"] == "coder"  # Default role
        assert "claude" in task.context["model"].lower()  # Default model


class TestOrchestratorCleanupSession:
    """Test cleanup_session method."""

    @pytest.fixture
    async def orchestrator(self) -> AgentOrchestrator:
        """Create orchestrator instance."""
        orch = AgentOrchestrator()
        yield orch
        orch.tasks.clear()
        orch.results.clear()
        orch.agents.clear()
        orch._agent_last_activity.clear()

    async def test_cleanup_session_removes_agents(self, orchestrator: AgentOrchestrator):
        """Test that cleanup_session removes agents for that session."""
        # Add agents for different sessions
        mock_agent1 = MagicMock()
        mock_agent1.session_id = "session-123"
        orchestrator.agents["agent-1"] = mock_agent1
        orchestrator._agent_last_activity["agent-1"] = time.time()

        mock_agent2 = MagicMock()
        mock_agent2.session_id = "session-456"
        orchestrator.agents["agent-2"] = mock_agent2
        orchestrator._agent_last_activity["agent-2"] = time.time()

        with patch("src.orchestrator.cleanup_session_mcp", new_callable=AsyncMock):
            await orchestrator.cleanup_session("session-123")

        assert "agent-1" not in orchestrator.agents
        assert "agent-1" not in orchestrator._agent_last_activity
        assert "agent-2" in orchestrator.agents

    async def test_cleanup_session_removes_tasks(self, orchestrator: AgentOrchestrator):
        """Test that cleanup_session removes tasks for that session."""
        task1 = AgentTask(
            session_id="session-123",
            agent_id="agent-1",
            message="Task 1",
        )
        await orchestrator.submit_task(task1)

        task2 = AgentTask(
            session_id="session-456",
            agent_id="agent-2",
            message="Task 2",
        )
        await orchestrator.submit_task(task2)

        with patch("src.orchestrator.cleanup_session_mcp", new_callable=AsyncMock):
            await orchestrator.cleanup_session("session-123")

        assert task1.task_id not in orchestrator.tasks
        assert task1.task_id not in orchestrator.results
        assert task2.task_id in orchestrator.tasks

    async def test_cleanup_session_calls_mcp_cleanup(self, orchestrator: AgentOrchestrator):
        """Test that cleanup_session calls MCP cleanup."""
        with patch("src.orchestrator.cleanup_session_mcp", new_callable=AsyncMock) as mock_mcp:
            await orchestrator.cleanup_session("session-123")
            mock_mcp.assert_called_once_with("session-123")


class TestOrchestratorGetMCPStatus:
    """Test get_mcp_status method."""

    @pytest.fixture
    async def orchestrator(self) -> AgentOrchestrator:
        """Create orchestrator instance."""
        return AgentOrchestrator()

    async def test_get_mcp_status_success(self, orchestrator: AgentOrchestrator):
        """Test get_mcp_status returns status from lifecycle manager."""
        with patch("src.orchestrator.get_lifecycle_manager", new_callable=AsyncMock) as mock_get:
            mock_manager = MagicMock()
            mock_manager.get_server_status = MagicMock(return_value={
                "session_id": "session-123",
                "connected": True,
                "servers": [{"name": "server1", "status": "connected"}],
                "total_tools": 5,
            })
            mock_get.return_value = mock_manager

            status = await orchestrator.get_mcp_status("session-123")

            assert status["connected"] is True
            assert status["total_tools"] == 5

    async def test_get_mcp_status_error(self, orchestrator: AgentOrchestrator):
        """Test get_mcp_status handles errors."""
        with patch("src.orchestrator.get_lifecycle_manager", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = Exception("Connection failed")

            status = await orchestrator.get_mcp_status("session-123")

            assert status["connected"] is False
            assert status["servers"] == []
            assert "Connection failed" in status["error"]


class TestOrchestratorResolveApproval:
    """Test resolve_approval method."""

    @pytest.fixture
    async def orchestrator(self) -> AgentOrchestrator:
        """Create orchestrator instance."""
        orch = AgentOrchestrator()
        yield orch
        orch.agents.clear()

    def test_resolve_approval_agent_not_found(self, orchestrator: AgentOrchestrator):
        """Test resolve_approval when agent not found."""
        result = orchestrator.resolve_approval(
            agent_id="non-existent",
            approval_id="approval-123",
            approved=True,
        )

        assert result["success"] is False
        assert "not found" in result["error"].lower()

    def test_resolve_approval_no_tool_executor(self, orchestrator: AgentOrchestrator):
        """Test resolve_approval when agent has no tool executor."""
        mock_agent = MagicMock()
        mock_agent.tool_executor = None
        orchestrator.agents["agent-123"] = mock_agent

        result = orchestrator.resolve_approval(
            agent_id="agent-123",
            approval_id="approval-123",
            approved=True,
        )

        assert result["success"] is False
        assert "no tool executor" in result["error"].lower()

    def test_resolve_approval_success(self, orchestrator: AgentOrchestrator):
        """Test resolve_approval success."""
        mock_executor = MagicMock()
        mock_executor.resolve_approval = MagicMock(return_value=True)

        mock_agent = MagicMock()
        mock_agent.tool_executor = mock_executor
        orchestrator.agents["agent-123"] = mock_agent

        result = orchestrator.resolve_approval(
            agent_id="agent-123",
            approval_id="approval-123",
            approved=True,
            add_to_allowlist=True,
        )

        assert result["success"] is True
        mock_executor.resolve_approval.assert_called_once_with(
            approval_id="approval-123",
            approved=True,
            add_to_allowlist=True,
        )

    def test_resolve_approval_not_found_or_already_resolved(self, orchestrator: AgentOrchestrator):
        """Test resolve_approval when approval not found."""
        mock_executor = MagicMock()
        mock_executor.resolve_approval = MagicMock(return_value=False)

        mock_agent = MagicMock()
        mock_agent.tool_executor = mock_executor
        orchestrator.agents["agent-123"] = mock_agent

        result = orchestrator.resolve_approval(
            agent_id="agent-123",
            approval_id="approval-123",
            approved=True,
        )

        assert result["success"] is False
        assert "already resolved" in result["error"].lower()


class TestOrchestratorApprovalCallback:
    """Test approval callback creation."""

    @pytest.fixture
    async def orchestrator(self) -> AgentOrchestrator:
        """Create orchestrator instance."""
        return AgentOrchestrator()

    async def test_create_approval_callback(self, orchestrator: AgentOrchestrator):
        """Test _create_approval_callback returns working callback."""
        callback = orchestrator._create_approval_callback()
        assert callable(callback)

        approval_data = {
            "approval_id": "test-123",
            "agent_id": "agent-1",
        }

        with patch.object(orchestrator, "_notify_approval_request", new_callable=AsyncMock) as mock_notify:
            await callback(approval_data)
            mock_notify.assert_called_once_with(approval_data)


class TestOrchestratorNotifyApprovalRequest:
    """Test _notify_approval_request method."""

    @pytest.fixture
    async def orchestrator(self) -> AgentOrchestrator:
        """Create orchestrator instance."""
        return AgentOrchestrator()

    async def test_notify_approval_http_error(self, orchestrator: AgentOrchestrator):
        """Test handling of HTTP errors during approval notification."""
        import httpx

        approval_data = {"approval_id": "test-123"}

        with patch("httpx.AsyncClient") as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 500
            mock_response.raise_for_status = MagicMock(
                side_effect=httpx.HTTPStatusError("Error", request=MagicMock(), response=mock_response)
            )
            mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)

            # Should not raise exception
            await orchestrator._notify_approval_request(approval_data)

    async def test_notify_approval_generic_error(self, orchestrator: AgentOrchestrator):
        """Test handling of generic errors during approval notification."""
        approval_data = {"approval_id": "test-123"}

        with patch("httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.post = AsyncMock(
                side_effect=Exception("Network error")
            )

            # Should not raise exception
            await orchestrator._notify_approval_request(approval_data)


class TestOrchestratorEnsureMCPConnected:
    """Test _ensure_mcp_connected method edge cases."""

    @pytest.fixture
    async def orchestrator(self) -> AgentOrchestrator:
        """Create orchestrator instance."""
        return AgentOrchestrator()

    async def test_ensure_mcp_connected_no_config(self, orchestrator: AgentOrchestrator):
        """Test _ensure_mcp_connected with no config."""
        lifecycle, status = await orchestrator._ensure_mcp_connected(
            "session-123", None
        )
        assert lifecycle is None
        assert status is None

    async def test_ensure_mcp_connected_empty_servers(self, orchestrator: AgentOrchestrator):
        """Test _ensure_mcp_connected with empty servers list."""
        from src.mcp.integration import UserMCPConfig

        mcp_config = UserMCPConfig(user_id="user-123", servers=[])

        lifecycle, status = await orchestrator._ensure_mcp_connected(
            "session-123", mcp_config
        )
        assert lifecycle is None
        assert status is None

    async def test_ensure_mcp_connected_general_exception(self, orchestrator: AgentOrchestrator):
        """Test _ensure_mcp_connected handles general exceptions."""
        from src.mcp.integration import UserMCPConfig, UserMCPServerConfig

        mcp_config = UserMCPConfig(
            user_id="user-123",
            servers=[
                UserMCPServerConfig(
                    id="server-1",
                    name="test-server",
                    transport="stdio",
                    command="test",
                )
            ],
        )

        with patch("src.orchestrator.get_lifecycle_manager", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = Exception("Connection error")

            lifecycle, status = await orchestrator._ensure_mcp_connected(
                "session-123", mcp_config
            )

            assert lifecycle is None
            assert status is not None
            assert status.connected is False
            assert "Connection error" in status.error


class TestOrchestratorAgentCreationParams:
    """Test get_or_create_agent with various params."""

    @pytest.fixture
    async def orchestrator(self) -> AgentOrchestrator:
        """Create orchestrator instance."""
        orch = AgentOrchestrator()
        yield orch
        orch.agents.clear()
        orch._agent_last_activity.clear()

    async def test_get_or_create_agent_limit_exceeded(self, orchestrator: AgentOrchestrator):
        """Test get_or_create_agent raises when limit exceeded."""
        # Fill up with agents (mocking _force_cleanup_idle_agents_sync to return 0)
        with patch("src.orchestrator.MAX_AGENTS", 5):
            for i in range(5):
                mock_agent = MagicMock()
                mock_agent.session_id = f"session-{i}"
                mock_agent.mode = "ask"
                mock_agent.command_allowlist = None
                mock_agent.tool_executor = None
                orchestrator.agents[f"agent-{i}"] = mock_agent
                orchestrator._agent_last_activity[f"agent-{i}"] = time.time()  # Active

            params = AgentCreationParams(
                agent_id="agent-new",
                role="coder",
                model="claude-3-5-sonnet",
                session_id="session-new",
            )

            with pytest.raises(RuntimeError, match="Agent limit exceeded"):
                await orchestrator.get_or_create_agent(params)

    async def test_get_or_create_agent_updates_command_allowlist(self, orchestrator: AgentOrchestrator):
        """Test that get_or_create_agent updates command allowlist on cached agent."""
        with patch("src.orchestrator.create_database_agent", new_callable=AsyncMock) as mock_create:
            mock_executor = MagicMock()
            mock_agent = MagicMock()
            mock_agent.session_id = "session-123"
            mock_agent.mode = "auto"
            mock_agent.command_allowlist = []
            mock_agent.tool_executor = mock_executor
            mock_create.return_value = mock_agent

            # First call to create agent
            params1 = AgentCreationParams(
                agent_id="agent-123",
                role="coder",
                model="claude-3-5-sonnet",
                session_id="session-123",
                mode="auto",
                command_allowlist=[],
            )
            await orchestrator.get_or_create_agent(params1)

            # Second call with different allowlist
            params2 = AgentCreationParams(
                agent_id="agent-123",
                role="coder",
                model="claude-3-5-sonnet",
                session_id="session-123",
                mode="auto",
                command_allowlist=["ls", "cat"],
            )
            agent = await orchestrator.get_or_create_agent(params2)

            # Should update command allowlist
            assert agent.command_allowlist == ["ls", "cat"]
            assert mock_executor.command_allowlist == ["ls", "cat"]


class TestOrchestratorForceCleanup:
    """Test force cleanup methods."""

    @pytest.fixture
    async def orchestrator(self) -> AgentOrchestrator:
        """Create orchestrator instance."""
        orch = AgentOrchestrator()
        yield orch
        orch.tasks.clear()
        orch.results.clear()
        orch.agents.clear()
        orch._agent_last_activity.clear()

    def test_force_cleanup_idle_agents_sync(self, orchestrator: AgentOrchestrator):
        """Test _force_cleanup_idle_agents_sync removes idle agents."""
        # Add agents with different activity times
        for i in range(10):
            mock_agent = MagicMock()
            mock_agent.session_id = f"session-{i}"
            orchestrator.agents[f"agent-{i}"] = mock_agent
            # Older agents have older activity time
            orchestrator._agent_last_activity[f"agent-{i}"] = time.time() - 120 - i * 10

        # Patch MAX_AGENTS to force cleanup
        with patch("src.orchestrator.MAX_AGENTS", 5):
            removed = orchestrator._force_cleanup_idle_agents_sync()

            # Should remove oldest idle agents
            assert removed > 0
            assert len(orchestrator.agents) <= 5

    def test_force_cleanup_tasks_removes_old_tasks(self, orchestrator: AgentOrchestrator):
        """Test _force_cleanup_old_tasks removes old completed tasks."""
        for i in range(10):
            task = AgentTask(
                session_id=f"session-{i}",
                agent_id=f"agent-{i}",
                message=f"Task {i}",
                created_at=time.time() - TASK_TTL_SECONDS - 100 - i * 10,
            )
            orchestrator.tasks[task.task_id] = task
            orchestrator.results[task.task_id] = TaskResult(status=TaskStatus.COMPLETED)

        removed = orchestrator._force_cleanup_old_tasks()

        assert removed > 0

    def test_force_cleanup_tasks_keeps_pending(self, orchestrator: AgentOrchestrator):
        """Test _force_cleanup_old_tasks keeps pending/running tasks."""
        # Add old pending task
        pending_task = AgentTask(
            session_id="session-1",
            agent_id="agent-1",
            message="Pending task",
            created_at=time.time() - TASK_TTL_SECONDS - 1000,
        )
        orchestrator.tasks[pending_task.task_id] = pending_task
        orchestrator.results[pending_task.task_id] = TaskResult(status=TaskStatus.PENDING)

        # Add old running task
        running_task = AgentTask(
            session_id="session-2",
            agent_id="agent-2",
            message="Running task",
            created_at=time.time() - TASK_TTL_SECONDS - 1000,
        )
        orchestrator.tasks[running_task.task_id] = running_task
        orchestrator.results[running_task.task_id] = TaskResult(status=TaskStatus.RUNNING)

        # Add old completed task
        completed_task = AgentTask(
            session_id="session-3",
            agent_id="agent-3",
            message="Completed task",
            created_at=time.time() - TASK_TTL_SECONDS - 1000,
        )
        orchestrator.tasks[completed_task.task_id] = completed_task
        orchestrator.results[completed_task.task_id] = TaskResult(status=TaskStatus.COMPLETED)

        removed = orchestrator._force_cleanup_old_tasks()

        # Only completed task should be removed
        assert pending_task.task_id in orchestrator.tasks
        assert running_task.task_id in orchestrator.tasks
        assert completed_task.task_id not in orchestrator.tasks
        assert removed == 1
