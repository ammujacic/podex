"""Unit tests for Agent Orchestrator.

Tests cover:
- TaskStatus enum
- AgentTask dataclass
- AgentCreationParams dataclass
- MCPConnectionStatus dataclass
- TaskResult dataclass
- AgentOrchestrator initialization
- Task submission and management
"""

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


class TestTaskStatusEnum:
    """Test TaskStatus enum."""

    def test_all_statuses_defined(self):
        """Test all task statuses are defined."""
        assert TaskStatus.PENDING.value == "pending"
        assert TaskStatus.RUNNING.value == "running"
        assert TaskStatus.COMPLETED.value == "completed"
        assert TaskStatus.FAILED.value == "failed"

    def test_status_is_string_enum(self):
        """Test TaskStatus is a string enum."""
        assert isinstance(TaskStatus.PENDING.value, str)
        assert str(TaskStatus.PENDING) == "TaskStatus.PENDING"


class TestAgentTaskDataclass:
    """Test AgentTask dataclass."""

    def test_basic_creation(self):
        """Test basic AgentTask creation."""
        task = AgentTask(
            session_id="session-123",
            agent_id="agent-456",
            message="Test message",
        )

        assert task.session_id == "session-123"
        assert task.agent_id == "agent-456"
        assert task.message == "Test message"
        assert task.context == {}  # default
        assert task.task_id is not None  # auto-generated
        assert task.created_at > 0  # auto-generated timestamp

    def test_with_context(self):
        """Test AgentTask with context."""
        context = {"file": "/main.py", "workspace": "/workspace"}
        task = AgentTask(
            session_id="session-123",
            agent_id="agent-456",
            message="Analyze file",
            context=context,
        )

        assert task.context == context

    def test_custom_task_id(self):
        """Test AgentTask with custom task_id."""
        task = AgentTask(
            session_id="session-123",
            agent_id="agent-456",
            message="Test",
            task_id="custom-task-id",
        )

        assert task.task_id == "custom-task-id"


class TestAgentCreationParamsDataclass:
    """Test AgentCreationParams dataclass."""

    def test_basic_creation(self):
        """Test basic AgentCreationParams creation."""
        params = AgentCreationParams(
            agent_id="agent-123",
            role="architect",
            model="claude-3-5-sonnet-20241022",
            session_id="session-456",
        )

        assert params.agent_id == "agent-123"
        assert params.role == "architect"
        assert params.model == "claude-3-5-sonnet-20241022"
        assert params.session_id == "session-456"
        assert params.mode == "ask"  # default

    def test_with_all_optional_fields(self):
        """Test AgentCreationParams with all optional fields."""
        params = AgentCreationParams(
            agent_id="agent-123",
            role="developer",
            model="gpt-4",
            session_id="session-456",
            user_id="user-789",
            mode="auto",
            command_allowlist=["npm install", "pytest"],
            workspace_id="workspace-101",
        )

        assert params.user_id == "user-789"
        assert params.mode == "auto"
        assert params.command_allowlist == ["npm install", "pytest"]
        assert params.workspace_id == "workspace-101"


class TestMCPConnectionStatusDataclass:
    """Test MCPConnectionStatus dataclass."""

    def test_basic_creation(self):
        """Test basic MCPConnectionStatus creation."""
        status = MCPConnectionStatus(connected=True)

        assert status.connected is True
        assert status.servers_attempted == 0
        assert status.servers_connected == 0
        assert status.tools_available == 0
        assert status.failed_servers == []
        assert status.error is None

    def test_with_all_fields(self):
        """Test MCPConnectionStatus with all fields."""
        status = MCPConnectionStatus(
            connected=True,
            servers_attempted=3,
            servers_connected=2,
            tools_available=10,
            failed_servers=["server-3"],
            error=None,
        )

        assert status.servers_attempted == 3
        assert status.servers_connected == 2
        assert status.tools_available == 10
        assert status.failed_servers == ["server-3"]

    def test_with_error(self):
        """Test MCPConnectionStatus with error."""
        status = MCPConnectionStatus(
            connected=False,
            error="Connection timeout",
        )

        assert status.connected is False
        assert status.error == "Connection timeout"


class TestTaskResultDataclass:
    """Test TaskResult dataclass."""

    def test_pending_result(self):
        """Test TaskResult with pending status."""
        result = TaskResult(status=TaskStatus.PENDING)

        assert result.status == TaskStatus.PENDING
        assert result.response is None
        assert result.tool_calls == []
        assert result.error is None
        assert result.mcp_status is None
        assert result.tokens_used == 0

    def test_completed_result(self):
        """Test TaskResult with completed status."""
        result = TaskResult(
            status=TaskStatus.COMPLETED,
            response="Task completed successfully",
            tool_calls=[{"id": "tc-1", "name": "read_file"}],
            tokens_used=150,
        )

        assert result.status == TaskStatus.COMPLETED
        assert result.response == "Task completed successfully"
        assert len(result.tool_calls) == 1
        assert result.tokens_used == 150

    def test_failed_result(self):
        """Test TaskResult with failed status."""
        result = TaskResult(
            status=TaskStatus.FAILED,
            error="API rate limit exceeded",
        )

        assert result.status == TaskStatus.FAILED
        assert result.error == "API rate limit exceeded"

    def test_result_with_mcp_status(self):
        """Test TaskResult with MCP status."""
        mcp_status = MCPConnectionStatus(connected=True, tools_available=5)
        result = TaskResult(
            status=TaskStatus.COMPLETED,
            response="Done",
            mcp_status=mcp_status,
        )

        assert result.mcp_status.connected is True
        assert result.mcp_status.tools_available == 5


class TestAgentOrchestratorInit:
    """Test AgentOrchestrator initialization."""

    def test_basic_initialization(self):
        """Test basic orchestrator initialization."""
        orchestrator = AgentOrchestrator()

        assert orchestrator.tasks == {}
        assert orchestrator.results == {}
        assert orchestrator.agents == {}
        assert orchestrator.llm_provider is not None

    def test_lock_initialization(self):
        """Test orchestrator initializes locks."""
        import asyncio

        orchestrator = AgentOrchestrator()

        assert orchestrator._task_lock is not None
        assert isinstance(orchestrator._task_lock, asyncio.Lock)
        assert orchestrator._agent_lock is not None
        assert isinstance(orchestrator._agent_lock, asyncio.Lock)


class TestAgentOrchestratorTaskManagement:
    """Test AgentOrchestrator task management."""

    @pytest.fixture
    def orchestrator(self) -> AgentOrchestrator:
        """Create orchestrator instance."""
        orch = AgentOrchestrator()
        yield orch
        # Cleanup
        orch.tasks.clear()
        orch.results.clear()
        orch.agents.clear()

    async def test_submit_task(self, orchestrator: AgentOrchestrator):
        """Test submitting a task."""
        task = AgentTask(
            session_id="session-123",
            agent_id="agent-456",
            message="Test message",
        )

        task_id = await orchestrator.submit_task(task)

        assert task_id == task.task_id
        assert task_id in orchestrator.tasks
        assert task_id in orchestrator.results
        assert orchestrator.results[task_id].status == TaskStatus.PENDING

    async def test_get_task_status(self, orchestrator: AgentOrchestrator):
        """Test getting task status."""
        task = AgentTask(
            session_id="session-123",
            agent_id="agent-456",
            message="Test",
        )

        task_id = await orchestrator.submit_task(task)
        status = await orchestrator.get_task_status(task_id)

        assert status is not None
        assert status["status"] == "pending"

    async def test_get_nonexistent_task_status(self, orchestrator: AgentOrchestrator):
        """Test getting status for nonexistent task."""
        status = await orchestrator.get_task_status("nonexistent-task")
        assert status["status"] == "not_found"

    async def test_multiple_tasks_submission(self, orchestrator: AgentOrchestrator):
        """Test submitting multiple tasks."""
        task_ids = []
        for i in range(5):
            task = AgentTask(
                session_id=f"session-{i}",
                agent_id=f"agent-{i}",
                message=f"Task {i}",
            )
            task_ids.append(await orchestrator.submit_task(task))

        assert len(orchestrator.tasks) == 5
        assert len(orchestrator.results) == 5
        for task_id in task_ids:
            assert task_id in orchestrator.tasks
            assert task_id in orchestrator.results


class TestAgentOrchestratorTaskCleanup:
    """Test AgentOrchestrator task cleanup functionality."""

    @pytest.fixture
    def orchestrator(self) -> AgentOrchestrator:
        """Create orchestrator instance."""
        orch = AgentOrchestrator()
        yield orch
        # Cleanup
        orch.tasks.clear()
        orch.results.clear()
        orch.agents.clear()

    async def test_cleanup_removes_old_completed_tasks(self, orchestrator: AgentOrchestrator):
        """Test that cleanup removes old completed tasks."""
        # Create old completed task
        old_task = AgentTask(
            session_id="session-old",
            agent_id="agent-old",
            message="Old task",
            created_at=time.time() - TASK_TTL_SECONDS - 100,
        )
        await orchestrator.submit_task(old_task)
        orchestrator.results[old_task.task_id].status = TaskStatus.COMPLETED

        # Create recent task
        recent_task = AgentTask(
            session_id="session-new",
            agent_id="agent-new",
            message="New task",
        )
        await orchestrator.submit_task(recent_task)

        # Run cleanup
        orchestrator._last_cleanup = 0  # Force cleanup
        orchestrator._cleanup_old_tasks()

        # Old task should be removed
        assert old_task.task_id not in orchestrator.tasks
        # Recent task should remain
        assert recent_task.task_id in orchestrator.tasks

    async def test_cleanup_preserves_pending_tasks(self, orchestrator: AgentOrchestrator):
        """Test that cleanup preserves pending (not completed) tasks."""
        # Create old but pending task
        old_pending = AgentTask(
            session_id="session-pending",
            agent_id="agent-pending",
            message="Pending task",
            created_at=time.time() - TASK_TTL_SECONDS - 100,
        )
        await orchestrator.submit_task(old_pending)
        # Leave as PENDING

        # Run cleanup
        orchestrator._last_cleanup = 0
        orchestrator._cleanup_old_tasks()

        # Pending task should remain (not completed)
        assert old_pending.task_id in orchestrator.tasks


class TestAgentOrchestratorAgentManagement:
    """Test AgentOrchestrator agent management."""

    @pytest.fixture
    def orchestrator(self) -> AgentOrchestrator:
        """Create orchestrator instance."""
        orch = AgentOrchestrator()
        yield orch
        # Cleanup
        orch.tasks.clear()
        orch.results.clear()
        orch.agents.clear()
        orch._agent_last_activity.clear()

    def test_agent_cache_empty_initially(self, orchestrator: AgentOrchestrator):
        """Test agent cache is empty initially."""
        assert orchestrator.agents == {}
        assert orchestrator._agent_last_activity == {}

    async def test_get_or_create_agent_caches_agent(self, orchestrator: AgentOrchestrator):
        """Test that get_or_create_agent caches the agent."""
        params = AgentCreationParams(
            agent_id="agent-123",
            role="architect",
            model="claude-3-5-sonnet-20241022",
            session_id="session-456",
            mode="ask",
        )

        with patch("src.orchestrator.create_database_agent", new_callable=AsyncMock) as mock_create:
            mock_agent = MagicMock()
            mock_agent.session_id = "session-456"
            mock_create.return_value = mock_agent

            # First call creates agent
            agent1 = await orchestrator.get_or_create_agent(params)
            assert mock_create.call_count == 1

            # Second call returns cached agent
            agent2 = await orchestrator.get_or_create_agent(params)
            assert mock_create.call_count == 1  # Not called again
            assert agent1 is agent2

    async def test_agent_added_to_cache_after_creation(self, orchestrator: AgentOrchestrator):
        """Test agent is added to cache after creation."""
        params = AgentCreationParams(
            agent_id="agent-new",
            role="developer",
            model="claude-3-5-sonnet-20241022",
            session_id="session-new",
        )

        with patch("src.orchestrator.create_database_agent", new_callable=AsyncMock) as mock_create:
            mock_agent = MagicMock()
            mock_agent.session_id = "session-new"
            mock_create.return_value = mock_agent

            await orchestrator.get_or_create_agent(params)

            assert "agent-new" in orchestrator.agents
            assert "agent-new" in orchestrator._agent_last_activity


class TestOrchestratorConstants:
    """Test orchestrator constants."""

    def test_task_ttl_is_positive(self):
        """Test TASK_TTL_SECONDS is positive."""
        assert TASK_TTL_SECONDS > 0

    def test_max_tasks_is_positive(self):
        """Test MAX_TASKS is positive."""
        assert MAX_TASKS > 0

    def test_agent_idle_ttl_is_positive(self):
        """Test AGENT_IDLE_TTL_SECONDS is positive."""
        assert AGENT_IDLE_TTL_SECONDS > 0

    def test_max_agents_is_positive(self):
        """Test MAX_AGENTS is positive."""
        assert MAX_AGENTS > 0
