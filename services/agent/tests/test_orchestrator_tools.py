"""Tests for orchestrator tools module.

Tests cover:
- create_execution_plan
- delegate_task
- create_custom_agent
- delegate_to_custom_agent
- get_task_status
- wait_for_tasks
- get_all_pending_tasks
- synthesize_results
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestOrchestratorToolsModule:
    """Test orchestrator tools module exists and imports."""

    def test_module_exists(self):
        """Test module can be imported."""
        from src.tools import orchestrator_tools
        assert orchestrator_tools is not None

    def test_create_execution_plan_exists(self):
        """Test create_execution_plan function exists."""
        from src.tools.orchestrator_tools import create_execution_plan
        assert callable(create_execution_plan)

    def test_delegate_task_exists(self):
        """Test delegate_task function exists."""
        from src.tools.orchestrator_tools import delegate_task
        assert callable(delegate_task)

    def test_create_custom_agent_exists(self):
        """Test create_custom_agent function exists."""
        from src.tools.orchestrator_tools import create_custom_agent
        assert callable(create_custom_agent)

    def test_delegate_to_custom_agent_exists(self):
        """Test delegate_to_custom_agent function exists."""
        from src.tools.orchestrator_tools import delegate_to_custom_agent
        assert callable(delegate_to_custom_agent)

    def test_get_task_status_exists(self):
        """Test get_task_status function exists."""
        from src.tools.orchestrator_tools import get_task_status
        assert callable(get_task_status)

    def test_wait_for_tasks_exists(self):
        """Test wait_for_tasks function exists."""
        from src.tools.orchestrator_tools import wait_for_tasks
        assert callable(wait_for_tasks)

    def test_get_all_pending_tasks_exists(self):
        """Test get_all_pending_tasks function exists."""
        from src.tools.orchestrator_tools import get_all_pending_tasks
        assert callable(get_all_pending_tasks)

    def test_synthesize_results_exists(self):
        """Test synthesize_results function exists."""
        from src.tools.orchestrator_tools import synthesize_results
        assert callable(synthesize_results)


class TestGetOrchestrator:
    """Test _get_orchestrator singleton function."""

    def test_get_orchestrator_function(self):
        """Test _get_orchestrator function."""
        from src.tools.orchestrator_tools import _get_orchestrator
        assert callable(_get_orchestrator)


class TestDelegateTask:
    """Test delegate_task function."""

    @pytest.mark.asyncio
    async def test_delegate_task_invalid_role(self):
        """Test delegate_task with invalid role."""
        from src.tools.orchestrator_tools import delegate_task

        result = await delegate_task(
            session_id="session-123",
            agent_role="invalid_role",
            description="Test task",
        )

        assert result["success"] is False
        assert "Invalid agent role" in result["error"]

    @pytest.mark.asyncio
    async def test_delegate_task_valid_roles(self):
        """Test delegate_task accepts valid roles."""
        from src.tools.orchestrator_tools import delegate_task

        valid_roles = {"coder", "reviewer", "tester", "architect", "agent_builder", "orchestrator"}

        for role in valid_roles:
            with patch("src.tools.orchestrator_tools.get_task_queue") as mock_get_queue:
                mock_queue = AsyncMock()
                mock_queue.enqueue = AsyncMock(return_value="task-123")
                mock_get_queue.return_value = mock_queue

                result = await delegate_task(
                    session_id="session-123",
                    agent_role=role,
                    description="Test task",
                )

                assert result["success"] is True
                assert result["agent_role"] == role

    @pytest.mark.asyncio
    async def test_delegate_task_invalid_priority_defaults(self):
        """Test delegate_task defaults invalid priority to medium."""
        from src.tools.orchestrator_tools import delegate_task

        with patch("src.tools.orchestrator_tools.get_task_queue") as mock_get_queue:
            mock_queue = AsyncMock()
            mock_queue.enqueue = AsyncMock(return_value="task-123")
            mock_get_queue.return_value = mock_queue

            result = await delegate_task(
                session_id="session-123",
                agent_role="coder",
                description="Test task",
                priority="invalid",
            )

            assert result["success"] is True
            assert result["priority"] == "medium"

    @pytest.mark.asyncio
    async def test_delegate_task_with_context(self):
        """Test delegate_task with context."""
        from src.tools.orchestrator_tools import delegate_task

        with patch("src.tools.orchestrator_tools.get_task_queue") as mock_get_queue:
            mock_queue = AsyncMock()
            mock_queue.enqueue = AsyncMock(return_value="task-123")
            mock_get_queue.return_value = mock_queue

            result = await delegate_task(
                session_id="session-123",
                agent_role="coder",
                description="Test task",
                context={"key": "value"},
            )

            assert result["success"] is True
            assert result["task_id"] == "task-123"

    @pytest.mark.asyncio
    async def test_delegate_task_exception(self):
        """Test delegate_task handles exceptions."""
        from src.tools.orchestrator_tools import delegate_task

        with patch("src.tools.orchestrator_tools.get_task_queue") as mock_get_queue:
            mock_get_queue.side_effect = Exception("Queue error")

            result = await delegate_task(
                session_id="session-123",
                agent_role="coder",
                description="Test task",
            )

            assert result["success"] is False
            assert "Queue error" in result["error"]


class TestCreateCustomAgent:
    """Test create_custom_agent function."""

    @pytest.mark.asyncio
    async def test_create_custom_agent_invalid_tools(self):
        """Test create_custom_agent with invalid tools."""
        from src.tools.orchestrator_tools import create_custom_agent

        result = await create_custom_agent(
            session_id="session-123",
            name="Test Agent",
            system_prompt="You are a test agent",
            tools=["invalid_tool"],
        )

        assert result["success"] is False
        assert "Invalid tools" in result["error"]

    @pytest.mark.asyncio
    async def test_create_custom_agent_valid_tools(self):
        """Test create_custom_agent with valid tools."""
        from src.tools.orchestrator_tools import create_custom_agent

        with patch("src.tools.orchestrator_tools.get_redis_client") as mock_get_redis:
            mock_redis = AsyncMock()
            mock_redis.connect = AsyncMock()
            mock_redis.set_json = AsyncMock()
            mock_get_redis.return_value = mock_redis

            result = await create_custom_agent(
                session_id="session-123",
                name="Test Agent",
                system_prompt="You are a test agent",
                tools=["read_file", "write_file"],
            )

            assert result["success"] is True
            assert "agent_id" in result
            assert result["name"] == "Test Agent"
            assert result["tools"] == ["read_file", "write_file"]

    @pytest.mark.asyncio
    async def test_create_custom_agent_redis_connection_error(self):
        """Test create_custom_agent handles Redis connection error."""
        from src.tools.orchestrator_tools import create_custom_agent

        with patch("src.tools.orchestrator_tools.get_redis_client") as mock_get_redis:
            mock_redis = AsyncMock()
            mock_redis.connect = AsyncMock(side_effect=Exception("Connection failed"))
            mock_get_redis.return_value = mock_redis

            result = await create_custom_agent(
                session_id="session-123",
                name="Test Agent",
                system_prompt="You are a test agent",
                tools=["read_file"],
            )

            assert result["success"] is False
            assert "Redis connection failed" in result["error"]

    @pytest.mark.asyncio
    async def test_create_custom_agent_all_valid_tools(self):
        """Test create_custom_agent accepts all valid tools."""
        from src.tools.orchestrator_tools import create_custom_agent

        valid_tools = [
            "read_file", "write_file", "search_code", "run_command", "list_directory",
            "create_task", "delegate_task", "get_task_status", "wait_for_tasks",
            "get_all_pending_tasks", "git_status", "git_diff", "git_commit",
            "git_push", "git_branch", "git_log",
        ]

        with patch("src.tools.orchestrator_tools.get_redis_client") as mock_get_redis:
            mock_redis = AsyncMock()
            mock_redis.connect = AsyncMock()
            mock_redis.set_json = AsyncMock()
            mock_get_redis.return_value = mock_redis

            result = await create_custom_agent(
                session_id="session-123",
                name="Test Agent",
                system_prompt="You are a test agent",
                tools=valid_tools,
            )

            assert result["success"] is True


class TestGetTaskStatus:
    """Test get_task_status function."""

    @pytest.mark.asyncio
    async def test_get_task_status_found(self):
        """Test get_task_status when task is found."""
        from src.tools.orchestrator_tools import get_task_status
        from src.queue.task_queue import TaskStatus

        with patch("src.tools.orchestrator_tools.get_task_queue") as mock_get_queue:
            mock_task = MagicMock()
            mock_task.id = "task-123"
            mock_task.status = TaskStatus.COMPLETED
            mock_task.agent_role = "coder"
            mock_task.description = "Test task"
            mock_task.result = "Task completed"
            mock_task.error = None
            mock_task.assigned_agent_id = "agent-456"

            mock_queue = AsyncMock()
            mock_queue.get_task = AsyncMock(return_value=mock_task)
            mock_get_queue.return_value = mock_queue

            result = await get_task_status("task-123")

            assert result["success"] is True
            assert result["task_id"] == "task-123"
            assert result["status"] == "completed"

    @pytest.mark.asyncio
    async def test_get_task_status_not_found(self):
        """Test get_task_status when task is not found."""
        from src.tools.orchestrator_tools import get_task_status

        with patch("src.tools.orchestrator_tools.get_task_queue") as mock_get_queue:
            mock_queue = AsyncMock()
            mock_queue.get_task = AsyncMock(return_value=None)
            mock_get_queue.return_value = mock_queue

            result = await get_task_status("task-123")

            assert result["success"] is False
            assert "not found" in result["error"]

    @pytest.mark.asyncio
    async def test_get_task_status_exception(self):
        """Test get_task_status handles exceptions."""
        from src.tools.orchestrator_tools import get_task_status

        with patch("src.tools.orchestrator_tools.get_task_queue") as mock_get_queue:
            mock_get_queue.side_effect = Exception("Queue error")

            result = await get_task_status("task-123")

            assert result["success"] is False
            assert "Queue error" in result["error"]


class TestWaitForTasks:
    """Test wait_for_tasks function."""

    @pytest.mark.asyncio
    async def test_wait_for_tasks_all_complete(self):
        """Test wait_for_tasks when all tasks complete."""
        from src.tools.orchestrator_tools import wait_for_tasks
        from src.queue.task_queue import TaskStatus

        with patch("src.tools.orchestrator_tools.get_task_queue") as mock_get_queue:
            mock_task = MagicMock()
            mock_task.status = TaskStatus.COMPLETED
            mock_task.result = "Done"
            mock_task.error = None
            mock_task.agent_role = "coder"

            mock_queue = AsyncMock()
            mock_queue.get_task = AsyncMock(return_value=mock_task)
            mock_get_queue.return_value = mock_queue

            result = await wait_for_tasks(
                session_id="session-123",
                task_ids=["task-1", "task-2"],
                timeout_seconds=1,
            )

            assert result["success"] is True
            assert result["completed"] == 2
            assert result["total"] == 2
            assert len(result["timed_out"]) == 0

    @pytest.mark.asyncio
    async def test_wait_for_tasks_timeout(self):
        """Test wait_for_tasks with timeout."""
        from src.tools.orchestrator_tools import wait_for_tasks
        from src.queue.task_queue import TaskStatus

        with patch("src.tools.orchestrator_tools.get_task_queue") as mock_get_queue:
            mock_task = MagicMock()
            mock_task.status = TaskStatus.PENDING  # Never completes

            mock_queue = AsyncMock()
            mock_queue.get_task = AsyncMock(return_value=mock_task)
            mock_get_queue.return_value = mock_queue

            result = await wait_for_tasks(
                session_id="session-123",
                task_ids=["task-1"],
                timeout_seconds=0.1,  # Very short timeout
            )

            assert result["success"] is False
            assert len(result["timed_out"]) == 1

    @pytest.mark.asyncio
    async def test_wait_for_tasks_exception(self):
        """Test wait_for_tasks handles exceptions."""
        from src.tools.orchestrator_tools import wait_for_tasks

        with patch("src.tools.orchestrator_tools.get_task_queue") as mock_get_queue:
            mock_get_queue.side_effect = Exception("Queue error")

            result = await wait_for_tasks(
                session_id="session-123",
                task_ids=["task-1"],
            )

            assert result["success"] is False
            assert "Queue error" in result["error"]


class TestGetAllPendingTasks:
    """Test get_all_pending_tasks function."""

    @pytest.mark.asyncio
    async def test_get_all_pending_tasks_success(self):
        """Test get_all_pending_tasks success."""
        from src.tools.orchestrator_tools import get_all_pending_tasks
        from src.queue.task_queue import TaskStatus, TaskPriority

        with patch("src.tools.orchestrator_tools.get_task_queue") as mock_get_queue:
            with patch("src.tools.orchestrator_tools.get_session_task_stats") as mock_stats:
                mock_task = MagicMock()
                mock_task.id = "task-123"
                mock_task.agent_role = "coder"
                mock_task.description = "Test task"
                mock_task.priority = TaskPriority.MEDIUM
                mock_task.status = TaskStatus.PENDING

                mock_queue = AsyncMock()
                mock_queue.get_pending_tasks = AsyncMock(return_value=[mock_task])
                mock_get_queue.return_value = mock_queue

                mock_stats.return_value = {"pending": 1, "completed": 0}

                result = await get_all_pending_tasks("session-123")

                assert result["success"] is True
                assert len(result["pending_tasks"]) == 1
                assert result["pending_tasks"][0]["task_id"] == "task-123"

    @pytest.mark.asyncio
    async def test_get_all_pending_tasks_exception(self):
        """Test get_all_pending_tasks handles exceptions."""
        from src.tools.orchestrator_tools import get_all_pending_tasks

        with patch("src.tools.orchestrator_tools.get_task_queue") as mock_get_queue:
            mock_get_queue.side_effect = Exception("Queue error")

            result = await get_all_pending_tasks("session-123")

            assert result["success"] is False
            assert "Queue error" in result["error"]


class TestSynthesizeResults:
    """Test synthesize_results function."""

    @pytest.mark.asyncio
    async def test_synthesize_results_success(self):
        """Test synthesize_results success."""
        from src.tools.orchestrator_tools import synthesize_results
        from src.queue.task_queue import TaskStatus

        with patch("src.tools.orchestrator_tools.get_task_queue") as mock_get_queue:
            mock_task = MagicMock()
            mock_task.id = "task-123"
            mock_task.agent_role = "coder"
            mock_task.description = "Test task"
            mock_task.status = TaskStatus.COMPLETED
            mock_task.result = "Task result"
            mock_task.error = None

            mock_queue = AsyncMock()
            mock_queue.get_task = AsyncMock(return_value=mock_task)
            mock_get_queue.return_value = mock_queue

            result = await synthesize_results(
                session_id="session-123",
                task_ids=["task-123"],
                synthesis_instructions="Summarize the results",
            )

            assert result["success"] is True
            assert result["task_count"] == 1
            assert len(result["results"]) == 1
            assert result["synthesis_instructions"] == "Summarize the results"

    @pytest.mark.asyncio
    async def test_synthesize_results_missing_task(self):
        """Test synthesize_results with missing task."""
        from src.tools.orchestrator_tools import synthesize_results

        with patch("src.tools.orchestrator_tools.get_task_queue") as mock_get_queue:
            mock_queue = AsyncMock()
            mock_queue.get_task = AsyncMock(return_value=None)
            mock_get_queue.return_value = mock_queue

            result = await synthesize_results(
                session_id="session-123",
                task_ids=["task-123"],
            )

            assert result["success"] is True
            assert result["task_count"] == 0

    @pytest.mark.asyncio
    async def test_synthesize_results_exception(self):
        """Test synthesize_results handles exceptions."""
        from src.tools.orchestrator_tools import synthesize_results

        with patch("src.tools.orchestrator_tools.get_task_queue") as mock_get_queue:
            mock_get_queue.side_effect = Exception("Queue error")

            result = await synthesize_results(
                session_id="session-123",
                task_ids=["task-123"],
            )

            assert result["success"] is False
            assert "Queue error" in result["error"]


class TestCreateExecutionPlan:
    """Test create_execution_plan function."""

    @pytest.mark.asyncio
    async def test_create_execution_plan_redis_error(self):
        """Test create_execution_plan handles Redis connection error."""
        from src.tools.orchestrator_tools import create_execution_plan

        with patch("src.tools.orchestrator_tools.get_redis_client") as mock_get_redis:
            mock_redis = AsyncMock()
            mock_redis.connect = AsyncMock(side_effect=Exception("Connection failed"))
            mock_get_redis.return_value = mock_redis

            result = await create_execution_plan(
                session_id="session-123",
                agent_id="agent-456",
                task_description="Test task",
            )

            assert result["success"] is False
            assert "Redis connection failed" in result["error"]

    @pytest.mark.asyncio
    async def test_create_execution_plan_exception(self):
        """Test create_execution_plan handles general exceptions."""
        from src.tools.orchestrator_tools import create_execution_plan

        with patch("src.tools.orchestrator_tools.get_redis_client") as mock_get_redis:
            mock_get_redis.side_effect = Exception("General error")

            result = await create_execution_plan(
                session_id="session-123",
                agent_id="agent-456",
                task_description="Test task",
            )

            assert result["success"] is False
            assert "General error" in result["error"]


class TestDelegateToCustomAgent:
    """Test delegate_to_custom_agent function."""

    @pytest.mark.asyncio
    async def test_delegate_to_custom_agent_redis_error(self):
        """Test delegate_to_custom_agent handles Redis connection error."""
        from src.tools.orchestrator_tools import delegate_to_custom_agent

        with patch("src.tools.orchestrator_tools.get_redis_client") as mock_get_redis:
            mock_redis = AsyncMock()
            mock_redis.connect = AsyncMock(side_effect=Exception("Connection failed"))
            mock_get_redis.return_value = mock_redis

            result = await delegate_to_custom_agent(
                session_id="session-123",
                agent_id="agent-456",
                message="Test message",
            )

            assert result["success"] is False
            assert "Redis connection failed" in result["error"]

    @pytest.mark.asyncio
    async def test_delegate_to_custom_agent_not_found(self):
        """Test delegate_to_custom_agent when agent not found."""
        from src.tools.orchestrator_tools import delegate_to_custom_agent

        with patch("src.tools.orchestrator_tools.get_redis_client") as mock_get_redis:
            mock_redis = AsyncMock()
            mock_redis.connect = AsyncMock()
            mock_redis.get_json = AsyncMock(return_value=None)
            mock_get_redis.return_value = mock_redis

            result = await delegate_to_custom_agent(
                session_id="session-123",
                agent_id="agent-456",
                message="Test message",
            )

            assert result["success"] is False
            assert "not found" in result["error"]

    @pytest.mark.asyncio
    async def test_delegate_to_custom_agent_exception(self):
        """Test delegate_to_custom_agent handles general exceptions."""
        from src.tools.orchestrator_tools import delegate_to_custom_agent

        with patch("src.tools.orchestrator_tools.get_redis_client") as mock_get_redis:
            mock_get_redis.side_effect = Exception("General error")

            result = await delegate_to_custom_agent(
                session_id="session-123",
                agent_id="agent-456",
                message="Test message",
            )

            assert result["success"] is False
            assert "General error" in result["error"]
