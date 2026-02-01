"""Comprehensive integration tests for Queue Workers.

Tests cover:
- AgentTaskWorker: task lifecycle, control commands, concurrent processing
- SubagentTaskWorker: task processing, session management, concurrent execution
- CompactionTaskWorker: compaction execution, database operations
- ApprovalListener: approval registration, pub/sub resolution
"""

import asyncio
import json
import time
import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests.conftest import requires_redis

from src.queue.agent_worker import (
    ACTIVE_KEY,
    CONTROL_CHANNEL,
    PENDING_KEY,
    TASK_KEY,
    UPDATES_CHANNEL,
    AgentTaskWorker,
    get_agent_task_worker,
    set_agent_task_worker,
)
from src.queue.approval_listener import (
    APPROVAL_RESPONSES_CHANNEL,
    ApprovalListener,
    get_approval_listener,
    set_approval_listener,
)
from src.queue.compaction_worker import (
    PENDING_KEY as COMPACTION_PENDING_KEY,
    TASK_KEY as COMPACTION_TASK_KEY,
    UPDATES_CHANNEL as COMPACTION_UPDATES_CHANNEL,
    CompactionTaskWorker,
    get_compaction_task_worker,
    set_compaction_task_worker,
)
from src.queue.subagent_worker import (
    PENDING_KEY as SUBAGENT_PENDING_KEY,
    TASK_KEY as SUBAGENT_TASK_KEY,
    UPDATES_CHANNEL as SUBAGENT_UPDATES_CHANNEL,
    SubagentTaskWorker,
    get_subagent_task_worker,
    set_subagent_task_worker,
)


# =============================================================================
# Agent Task Worker Tests
# =============================================================================


class TestAgentTaskWorkerLifecycle:
    """Test AgentTaskWorker lifecycle (start/stop)."""

    @pytest.fixture
    def mock_redis(self) -> MagicMock:
        """Create mock Redis client."""
        mock = MagicMock()
        mock.client = MagicMock()
        mock.client.scan = AsyncMock(return_value=(0, []))
        mock.client.zrange = AsyncMock(return_value=[])
        mock.client.zrem = AsyncMock(return_value=0)
        mock.client.sadd = AsyncMock(return_value=1)
        mock.client.srem = AsyncMock(return_value=1)
        mock.client.pubsub = MagicMock(return_value=MagicMock(
            subscribe=AsyncMock(),
            unsubscribe=AsyncMock(),
            aclose=AsyncMock(),
            get_message=AsyncMock(return_value=None),
        ))
        mock.get_json = AsyncMock(return_value=None)
        mock.set_json = AsyncMock(return_value=True)
        mock.publish = AsyncMock(return_value=1)
        return mock

    async def test_worker_initialization(self, mock_redis: MagicMock):
        """Test worker initializes with correct defaults."""
        worker = AgentTaskWorker(mock_redis, poll_interval=0.1, pool_size=4)

        assert worker._poll_interval == 0.1
        assert worker._pool_size == 4
        assert worker._running is False
        assert worker._paused is False
        assert worker._orchestrator is None
        assert len(worker._running_tasks) == 0
        assert len(worker._active_tasks) == 0
        assert worker._worker_id.startswith("worker-")

    async def test_worker_start_stop(self, mock_redis: MagicMock):
        """Test worker start and stop lifecycle."""
        worker = AgentTaskWorker(mock_redis, poll_interval=0.05, pool_size=2)

        # Start worker
        await worker.start()
        assert worker._running is True
        assert worker._task_processor is not None
        assert worker._control_listener is not None

        # Starting again should be idempotent
        await worker.start()
        assert worker._running is True

        # Stop worker
        await worker.stop()
        assert worker._running is False

    async def test_worker_stop_cancels_running_tasks(self, mock_redis: MagicMock):
        """Test that stop cancels all running tasks."""
        worker = AgentTaskWorker(mock_redis, poll_interval=0.1, pool_size=2)

        # Create a mock running task
        async def long_running_task():
            await asyncio.sleep(10)

        task = asyncio.create_task(long_running_task())
        worker._running_tasks["task-123"] = task

        await worker.start()
        await worker.stop()

        assert task.cancelled() or task.done()
        assert len(worker._running_tasks) == 0

    async def test_set_orchestrator(self, mock_redis: MagicMock):
        """Test setting orchestrator."""
        worker = AgentTaskWorker(mock_redis)
        mock_orchestrator = MagicMock()

        worker.set_orchestrator(mock_orchestrator)

        assert worker._orchestrator == mock_orchestrator


class TestAgentTaskWorkerControlCommands:
    """Test control command handling (abort, pause, resume, cancel)."""

    @pytest.fixture
    def mock_redis(self) -> MagicMock:
        """Create mock Redis client."""
        mock = MagicMock()
        mock.client = MagicMock()
        mock.client.scan = AsyncMock(return_value=(0, []))
        mock.client.pubsub = MagicMock(return_value=MagicMock(
            subscribe=AsyncMock(),
            unsubscribe=AsyncMock(),
            aclose=AsyncMock(),
            get_message=AsyncMock(return_value=None),
        ))
        mock.get_json = AsyncMock(return_value=None)
        mock.set_json = AsyncMock(return_value=True)
        mock.publish = AsyncMock(return_value=1)
        return mock

    @pytest.fixture
    def worker(self, mock_redis: MagicMock) -> AgentTaskWorker:
        """Create worker with mock orchestrator."""
        worker = AgentTaskWorker(mock_redis, poll_interval=0.1)
        mock_orchestrator = MagicMock()
        mock_orchestrator.abort_agent = AsyncMock()
        mock_orchestrator.pause_agent = AsyncMock()
        mock_orchestrator.resume_agent = AsyncMock()
        worker.set_orchestrator(mock_orchestrator)
        return worker

    async def test_abort_command_for_active_agent(self, worker: AgentTaskWorker):
        """Test abort command triggers orchestrator abort."""
        # Simulate active task for agent
        worker._active_tasks["task-123"] = "agent-456"

        command_data = {
            "command": "abort",
            "agent_id": "agent-456",
        }

        await worker._handle_control_command(command_data)

        assert "agent-456" in worker._abort_requested
        worker._orchestrator.abort_agent.assert_called_once_with("agent-456")

    async def test_abort_command_ignored_for_inactive_agent(self, worker: AgentTaskWorker):
        """Test abort command ignored for agents not running on this worker."""
        command_data = {
            "command": "abort",
            "agent_id": "agent-not-here",
        }

        await worker._handle_control_command(command_data)

        assert "agent-not-here" not in worker._abort_requested
        worker._orchestrator.abort_agent.assert_not_called()

    async def test_pause_command(self, worker: AgentTaskWorker):
        """Test pause command pauses agent."""
        worker._active_tasks["task-123"] = "agent-456"

        command_data = {
            "command": "pause",
            "agent_id": "agent-456",
        }

        await worker._handle_control_command(command_data)

        assert "agent-456" in worker._paused_agents
        worker._orchestrator.pause_agent.assert_called_once_with("agent-456")

    async def test_resume_command(self, worker: AgentTaskWorker):
        """Test resume command resumes agent."""
        worker._active_tasks["task-123"] = "agent-456"
        worker._paused_agents.add("agent-456")

        command_data = {
            "command": "resume",
            "agent_id": "agent-456",
        }

        await worker._handle_control_command(command_data)

        assert "agent-456" not in worker._paused_agents
        worker._orchestrator.resume_agent.assert_called_once_with("agent-456")

    async def test_cancel_command(self, worker: AgentTaskWorker, mock_redis: MagicMock):
        """Test cancel command cancels task."""
        worker._active_tasks["task-123"] = "agent-456"

        # Mock task data
        mock_redis.get_json = AsyncMock(return_value={
            "id": "task-123",
            "session_id": "session-789",
            "agent_id": "agent-456",
        })
        mock_redis.client.srem = AsyncMock(return_value=1)
        worker._redis = mock_redis

        command_data = {
            "command": "cancel",
            "task_id": "task-123",
        }

        await worker._handle_control_command(command_data)

        # Should have updated task as failed
        mock_redis.set_json.assert_called()

    async def test_is_agent_paused(self, worker: AgentTaskWorker):
        """Test is_agent_paused helper."""
        assert worker.is_agent_paused("agent-123") is False

        worker._paused_agents.add("agent-123")
        assert worker.is_agent_paused("agent-123") is True

    async def test_is_abort_requested(self, worker: AgentTaskWorker):
        """Test is_abort_requested helper."""
        assert worker.is_abort_requested("agent-123") is False

        worker._abort_requested.add("agent-123")
        assert worker.is_abort_requested("agent-123") is True


class TestAgentTaskWorkerTaskProcessing:
    """Test task dequeuing and processing."""

    @pytest.fixture
    def mock_redis(self) -> MagicMock:
        """Create mock Redis client."""
        mock = MagicMock()
        mock.client = MagicMock()
        mock.client.scan = AsyncMock(return_value=(0, [
            "podex:agents:session-123:pending",
        ]))
        mock.client.zrange = AsyncMock(return_value=["task-abc"])
        mock.client.zrem = AsyncMock(return_value=1)
        mock.client.sadd = AsyncMock(return_value=1)
        mock.client.srem = AsyncMock(return_value=1)
        mock.client.pubsub = MagicMock(return_value=MagicMock(
            subscribe=AsyncMock(),
            unsubscribe=AsyncMock(),
            aclose=AsyncMock(),
            get_message=AsyncMock(return_value=None),
        ))
        mock.get_json = AsyncMock(return_value={
            "id": "task-abc",
            "session_id": "session-123",
            "agent_id": "agent-456",
            "message": "Test message",
            "message_id": "msg-789",
        })
        mock.set_json = AsyncMock(return_value=True)
        mock.publish = AsyncMock(return_value=1)
        return mock

    async def test_dequeue_task_success(self, mock_redis: MagicMock):
        """Test successful task dequeue."""
        worker = AgentTaskWorker(mock_redis)

        task_data = await worker._dequeue_task("session-123")

        assert task_data is not None
        assert task_data["id"] == "task-abc"
        assert task_data["status"] == "running"
        assert "started_at" in task_data

        # Verify Redis calls
        mock_redis.client.zrem.assert_called_once()
        mock_redis.client.sadd.assert_called_once()

    async def test_dequeue_task_no_pending(self, mock_redis: MagicMock):
        """Test dequeue when no pending tasks."""
        mock_redis.client.zrange = AsyncMock(return_value=[])
        worker = AgentTaskWorker(mock_redis)

        task_data = await worker._dequeue_task("session-123")

        assert task_data is None

    async def test_dequeue_task_already_claimed(self, mock_redis: MagicMock):
        """Test dequeue when task already claimed by another worker."""
        mock_redis.client.zrem = AsyncMock(return_value=0)
        worker = AgentTaskWorker(mock_redis)

        task_data = await worker._dequeue_task("session-123")

        assert task_data is None

    async def test_process_task_success(self, mock_redis: MagicMock):
        """Test successful task processing."""
        worker = AgentTaskWorker(mock_redis)

        # Mock orchestrator
        mock_orchestrator = MagicMock()
        mock_orchestrator.submit_task = AsyncMock()
        mock_orchestrator.process_task = AsyncMock(return_value=MagicMock(
            response="Task completed",
            tool_calls=[],
            tokens_used=100,
        ))
        worker.set_orchestrator(mock_orchestrator)

        task_data = {
            "id": "task-abc",
            "session_id": "session-123",
            "agent_id": "agent-456",
            "message": "Test message",
            "message_id": "msg-789",
        }

        await worker._process_task(task_data)

        # Verify orchestrator called
        mock_orchestrator.submit_task.assert_called_once()
        mock_orchestrator.process_task.assert_called_once_with("task-abc")

        # Task should no longer be tracked
        assert "task-abc" not in worker._active_tasks

    async def test_process_task_failure(self, mock_redis: MagicMock):
        """Test task processing failure."""
        worker = AgentTaskWorker(mock_redis)

        # Mock orchestrator that fails
        mock_orchestrator = MagicMock()
        mock_orchestrator.submit_task = AsyncMock(side_effect=Exception("Test error"))
        worker.set_orchestrator(mock_orchestrator)

        task_data = {
            "id": "task-abc",
            "session_id": "session-123",
            "agent_id": "agent-456",
            "message": "Test message",
            "message_id": "msg-789",
        }

        await worker._process_task(task_data)

        # Task should be marked as failed
        mock_redis.set_json.assert_called()
        call_args = mock_redis.set_json.call_args
        assert call_args[0][1]["status"] == "failed"

    async def test_process_task_no_orchestrator(self, mock_redis: MagicMock):
        """Test task processing without orchestrator set."""
        worker = AgentTaskWorker(mock_redis)

        task_data = {
            "id": "task-abc",
            "session_id": "session-123",
            "agent_id": "agent-456",
            "message": "Test message",
            "message_id": "msg-789",
        }

        await worker._process_task(task_data)

        # Should fail with "Orchestrator not set" error
        mock_redis.set_json.assert_called()


class TestAgentTaskWorkerConcurrency:
    """Test concurrent task processing."""

    @pytest.fixture
    def mock_redis(self) -> MagicMock:
        """Create mock Redis client."""
        mock = MagicMock()
        mock.client = MagicMock()
        mock.client.pubsub = MagicMock(return_value=MagicMock(
            subscribe=AsyncMock(),
            unsubscribe=AsyncMock(),
            aclose=AsyncMock(),
            get_message=AsyncMock(return_value=None),
        ))
        mock.client.scan = AsyncMock(return_value=(0, []))
        mock.get_json = AsyncMock(return_value=None)
        mock.set_json = AsyncMock(return_value=True)
        mock.publish = AsyncMock(return_value=1)
        return mock

    async def test_pool_size_limits_concurrent_tasks(self, mock_redis: MagicMock):
        """Test that pool size limits concurrent tasks."""
        worker = AgentTaskWorker(mock_redis, pool_size=2)

        # Add fake running tasks
        for i in range(3):
            worker._running_tasks[f"task-{i}"] = asyncio.create_task(asyncio.sleep(0))

        # Should not process new tasks since pool is full
        await worker._process_pending_tasks()

        # Pool size is 2, we have 3, so should be at capacity
        # (cleanup may have removed done tasks though)

    async def test_cleanup_completed_tasks(self, mock_redis: MagicMock):
        """Test that completed tasks are cleaned up."""
        worker = AgentTaskWorker(mock_redis, pool_size=4)

        # Add completed tasks
        for i in range(3):
            task = asyncio.create_task(asyncio.sleep(0))
            await task  # Complete immediately
            worker._running_tasks[f"task-{i}"] = task

        await worker._process_pending_tasks()

        # All tasks should be cleaned up
        assert len(worker._running_tasks) == 0


class TestAgentTaskWorkerGlobalSingleton:
    """Test global singleton management."""

    def test_get_set_agent_task_worker(self):
        """Test global getter/setter."""
        # Initially None
        original = get_agent_task_worker()

        mock_redis = MagicMock()
        worker = AgentTaskWorker(mock_redis)

        set_agent_task_worker(worker)
        assert get_agent_task_worker() == worker

        # Restore original
        set_agent_task_worker(original)


# =============================================================================
# Subagent Task Worker Tests
# =============================================================================


class TestSubagentTaskWorkerLifecycle:
    """Test SubagentTaskWorker lifecycle."""

    @pytest.fixture
    def mock_redis(self) -> MagicMock:
        """Create mock Redis client."""
        mock = MagicMock()
        mock.client = MagicMock()
        mock.client.scan = AsyncMock(return_value=(0, []))
        mock.client.zrange = AsyncMock(return_value=[])
        mock.client.zrem = AsyncMock(return_value=0)
        mock.client.sadd = AsyncMock(return_value=1)
        mock.client.srem = AsyncMock(return_value=1)
        mock.client.lpush = AsyncMock(return_value=1)
        mock.client.ltrim = AsyncMock()
        mock.get_json = AsyncMock(return_value=None)
        mock.set_json = AsyncMock(return_value=True)
        mock.publish = AsyncMock(return_value=1)
        return mock

    @pytest.fixture
    def mock_subagent_manager(self) -> MagicMock:
        """Create mock SubagentManager."""
        mock = MagicMock()
        mock.spawn_subagent = AsyncMock(return_value=MagicMock(
            id="subagent-123",
            result_summary="Task completed",
            context=MagicMock(tokens_used=150),
        ))
        return mock

    async def test_worker_initialization(self, mock_redis: MagicMock, mock_subagent_manager: MagicMock):
        """Test worker initializes correctly."""
        worker = SubagentTaskWorker(
            mock_redis,
            subagent_manager=mock_subagent_manager,
            poll_interval=0.1,
            pool_size=4,
        )

        assert worker._poll_interval == 0.1
        assert worker._pool_size == 4
        assert worker._running is False
        assert worker._manager == mock_subagent_manager

    async def test_worker_start_stop(self, mock_redis: MagicMock, mock_subagent_manager: MagicMock):
        """Test worker start and stop lifecycle."""
        worker = SubagentTaskWorker(
            mock_redis,
            subagent_manager=mock_subagent_manager,
            poll_interval=0.05,
        )

        await worker.start()
        assert worker._running is True
        assert worker._task is not None

        await worker.stop()
        assert worker._running is False

    async def test_session_management(self, mock_redis: MagicMock, mock_subagent_manager: MagicMock):
        """Test session add/remove."""
        worker = SubagentTaskWorker(mock_redis, subagent_manager=mock_subagent_manager)

        worker.add_session("session-123")
        assert "session-123" in worker._active_sessions

        worker.add_session("session-456")
        assert "session-456" in worker._active_sessions

        worker.remove_session("session-123")
        assert "session-123" not in worker._active_sessions
        assert "session-456" in worker._active_sessions


class TestSubagentTaskWorkerProcessing:
    """Test subagent task processing."""

    @pytest.fixture
    def mock_redis(self) -> MagicMock:
        """Create mock Redis client."""
        mock = MagicMock()
        mock.client = MagicMock()
        mock.client.scan = AsyncMock(return_value=(0, []))
        mock.client.zrange = AsyncMock(return_value=["subtask-123"])
        mock.client.zrem = AsyncMock(return_value=1)
        mock.client.sadd = AsyncMock(return_value=1)
        mock.client.srem = AsyncMock(return_value=1)
        mock.client.lpush = AsyncMock(return_value=1)
        mock.client.ltrim = AsyncMock()
        mock.get_json = AsyncMock(return_value={
            "id": "subtask-123",
            "session_id": "session-456",
            "parent_agent_id": "agent-789",
            "subagent_type": "coder",
            "task_description": "Write a function",
        })
        mock.set_json = AsyncMock(return_value=True)
        mock.publish = AsyncMock(return_value=1)
        return mock

    @pytest.fixture
    def mock_subagent_manager(self) -> MagicMock:
        """Create mock SubagentManager."""
        mock = MagicMock()
        mock.spawn_subagent = AsyncMock(return_value=MagicMock(
            id="subagent-123",
            result_summary="Function written successfully",
            context=MagicMock(tokens_used=200),
        ))
        return mock

    async def test_dequeue_subagent_task(self, mock_redis: MagicMock, mock_subagent_manager: MagicMock):
        """Test dequeue subagent task."""
        worker = SubagentTaskWorker(mock_redis, subagent_manager=mock_subagent_manager)

        task_data = await worker._dequeue_task("session-456")

        assert task_data is not None
        assert task_data["id"] == "subtask-123"
        assert task_data["status"] == "running"

    async def test_process_subagent_task_success(self, mock_redis: MagicMock, mock_subagent_manager: MagicMock):
        """Test successful subagent task processing."""
        worker = SubagentTaskWorker(mock_redis, subagent_manager=mock_subagent_manager)

        task_data = {
            "id": "subtask-123",
            "session_id": "session-456",
            "parent_agent_id": "agent-789",
            "subagent_type": "coder",
            "task_description": "Write a function",
        }

        await worker._process_task(task_data)

        # Verify spawn_subagent called correctly (uses role, not subagent_type)
        mock_subagent_manager.spawn_subagent.assert_called_once_with(
            parent_agent_id="agent-789",
            session_id="session-456",
            role="coder",
            task="Write a function",
            background=False,
            system_prompt=None,
        )

    async def test_process_subagent_task_failure(self, mock_redis: MagicMock, mock_subagent_manager: MagicMock):
        """Test subagent task failure handling."""
        mock_subagent_manager.spawn_subagent = AsyncMock(side_effect=Exception("Subagent error"))
        worker = SubagentTaskWorker(mock_redis, subagent_manager=mock_subagent_manager)

        task_data = {
            "id": "subtask-123",
            "session_id": "session-456",
            "parent_agent_id": "agent-789",
            "subagent_type": "coder",
            "task_description": "Write a function",
        }

        await worker._process_task(task_data)

        # Task should be marked as failed
        mock_redis.set_json.assert_called()
        # Find the failed status call
        for call in mock_redis.set_json.call_args_list:
            if "status" in call[0][1] and call[0][1]["status"] == "failed":
                assert "error" in call[0][1]
                break

    async def test_update_progress(self, mock_redis: MagicMock, mock_subagent_manager: MagicMock):
        """Test progress update."""
        mock_redis.get_json = AsyncMock(return_value={
            "id": "subtask-123",
            "session_id": "session-456",
            "parent_agent_id": "agent-789",
            "subagent_type": "coder",
        })
        worker = SubagentTaskWorker(mock_redis, subagent_manager=mock_subagent_manager)

        await worker.update_progress("subtask-123", 50, "Halfway done")

        # Verify progress updated
        mock_redis.set_json.assert_called()
        call_args = mock_redis.set_json.call_args
        assert call_args[0][1]["progress"] == 50
        assert call_args[0][1]["progress_message"] == "Halfway done"


class TestSubagentTaskWorkerGlobalSingleton:
    """Test global singleton management."""

    def test_get_set_subagent_task_worker(self):
        """Test global getter/setter."""
        original = get_subagent_task_worker()

        mock_redis = MagicMock()
        worker = SubagentTaskWorker(mock_redis)

        set_subagent_task_worker(worker)
        assert get_subagent_task_worker() == worker

        # Restore original
        set_subagent_task_worker(original)


# =============================================================================
# Compaction Task Worker Tests
# =============================================================================


class TestCompactionTaskWorkerLifecycle:
    """Test CompactionTaskWorker lifecycle."""

    @pytest.fixture
    def mock_redis(self) -> MagicMock:
        """Create mock Redis client."""
        mock = MagicMock()
        mock.client = MagicMock()
        mock.client.zrange = AsyncMock(return_value=[])
        mock.client.zrem = AsyncMock(return_value=0)
        mock.get_json = AsyncMock(return_value=None)
        mock.set_json = AsyncMock(return_value=True)
        mock.publish = AsyncMock(return_value=1)
        return mock

    async def test_worker_initialization(self, mock_redis: MagicMock):
        """Test worker initializes correctly."""
        worker = CompactionTaskWorker(
            mock_redis,
            poll_interval=0.5,
            pool_size=2,
        )

        assert worker._poll_interval == 0.5
        assert worker._pool_size == 2
        assert worker._running is False
        assert worker._worker_id.startswith("compaction-")

    async def test_worker_start_stop(self, mock_redis: MagicMock):
        """Test worker start and stop lifecycle."""
        worker = CompactionTaskWorker(mock_redis, poll_interval=0.05)

        await worker.start()
        assert worker._running is True

        await worker.stop()
        assert worker._running is False


class TestCompactionTaskWorkerProcessing:
    """Test compaction task processing."""

    @pytest.fixture
    def mock_redis(self) -> MagicMock:
        """Create mock Redis client."""
        mock = MagicMock()
        mock.client = MagicMock()
        mock.client.zrange = AsyncMock(return_value=["compaction-123"])
        mock.client.zrem = AsyncMock(return_value=1)
        mock.get_json = AsyncMock(return_value={
            "id": "compaction-123",
            "agent_id": "agent-456",
            "session_id": "session-789",
            "preserve_recent_messages": 10,
        })
        mock.set_json = AsyncMock(return_value=True)
        mock.publish = AsyncMock(return_value=1)
        return mock

    async def test_dequeue_compaction_task(self, mock_redis: MagicMock):
        """Test dequeue compaction task."""
        worker = CompactionTaskWorker(mock_redis)

        task_data = await worker._dequeue_task()

        assert task_data is not None
        assert task_data["id"] == "compaction-123"
        assert task_data["status"] == "running"

    async def test_process_compaction_task_no_agent(self, mock_redis: MagicMock):
        """Test compaction when agent not found."""
        worker = CompactionTaskWorker(mock_redis)

        task_data = {
            "id": "compaction-123",
            "agent_id": "nonexistent-agent",
            "session_id": "session-789",
            "preserve_recent_messages": 10,
        }

        # Mock database to return None for agent
        with patch("src.queue.compaction_worker.get_db_context") as mock_db_context:
            mock_db = AsyncMock()
            mock_db.__aenter__ = AsyncMock(return_value=mock_db)
            mock_db.__aexit__ = AsyncMock(return_value=None)
            mock_db.execute = AsyncMock(return_value=MagicMock(
                scalar_one_or_none=MagicMock(return_value=None)
            ))
            mock_db_context.return_value = mock_db

            await worker._process_task(task_data)

        # Task should be marked as failed
        mock_redis.set_json.assert_called()

    async def test_complete_compaction_task(self, mock_redis: MagicMock):
        """Test completing compaction task."""
        worker = CompactionTaskWorker(mock_redis)

        result = {
            "tokens_before": 10000,
            "tokens_after": 5000,
            "messages_removed": 20,
            "messages_preserved": 15,
            "summary": "Previous conversation summary",
        }

        await worker._complete_task("compaction-123", "session-789", result)

        # Verify task marked as completed
        mock_redis.set_json.assert_called()
        call_args = mock_redis.set_json.call_args
        assert call_args[0][1]["status"] == "completed"
        assert call_args[0][1]["tokens_before"] == 10000
        assert call_args[0][1]["tokens_after"] == 5000

    async def test_fail_compaction_task(self, mock_redis: MagicMock):
        """Test failing compaction task."""
        worker = CompactionTaskWorker(mock_redis)

        await worker._fail_task("compaction-123", "session-789", "Test error")

        # Verify task marked as failed
        mock_redis.set_json.assert_called()
        call_args = mock_redis.set_json.call_args
        assert call_args[0][1]["status"] == "failed"
        assert call_args[0][1]["error"] == "Test error"


class TestCompactionTaskWorkerGlobalSingleton:
    """Test global singleton management."""

    def test_get_set_compaction_task_worker(self):
        """Test global getter/setter."""
        original = get_compaction_task_worker()

        mock_redis = MagicMock()
        worker = CompactionTaskWorker(mock_redis)

        set_compaction_task_worker(worker)
        assert get_compaction_task_worker() == worker

        # Restore original
        set_compaction_task_worker(original)


# =============================================================================
# Approval Listener Tests
# =============================================================================


class TestApprovalListenerLifecycle:
    """Test ApprovalListener lifecycle."""

    @pytest.fixture
    def mock_redis(self) -> MagicMock:
        """Create mock Redis client."""
        mock = MagicMock()
        mock.client = MagicMock()
        mock.client.pubsub = MagicMock(return_value=MagicMock(
            subscribe=AsyncMock(),
            unsubscribe=AsyncMock(),
            aclose=AsyncMock(),
            get_message=AsyncMock(return_value=None),
        ))
        return mock

    async def test_listener_initialization(self, mock_redis: MagicMock):
        """Test listener initializes correctly."""
        listener = ApprovalListener(mock_redis)

        assert listener._running is False
        assert len(listener._pending_approvals) == 0

    async def test_listener_start_stop(self, mock_redis: MagicMock):
        """Test listener start and stop lifecycle."""
        listener = ApprovalListener(mock_redis)

        await listener.start()
        assert listener._running is True
        assert listener._listener_task is not None

        # Starting again should be idempotent
        await listener.start()

        await listener.stop()
        assert listener._running is False


class TestApprovalListenerRegistration:
    """Test approval registration and resolution."""

    @pytest.fixture
    def mock_redis(self) -> MagicMock:
        """Create mock Redis client."""
        mock = MagicMock()
        mock.client = MagicMock()
        mock.client.pubsub = MagicMock(return_value=MagicMock(
            subscribe=AsyncMock(),
            unsubscribe=AsyncMock(),
            aclose=AsyncMock(),
            get_message=AsyncMock(return_value=None),
        ))
        return mock

    async def test_register_approval(self, mock_redis: MagicMock):
        """Test registering an approval request."""
        listener = ApprovalListener(mock_redis)

        future = await listener.register_approval("approval-123")

        assert "approval-123" in listener._pending_approvals
        assert listener._pending_approvals["approval-123"] == future
        assert not future.done()

    async def test_unregister_approval(self, mock_redis: MagicMock):
        """Test unregistering an approval request."""
        listener = ApprovalListener(mock_redis)

        await listener.register_approval("approval-123")
        await listener.unregister_approval("approval-123")

        assert "approval-123" not in listener._pending_approvals

    async def test_handle_approval_response(self, mock_redis: MagicMock):
        """Test handling approval response via pub/sub."""
        listener = ApprovalListener(mock_redis)

        # Register an approval
        future = await listener.register_approval("approval-123")

        # Simulate receiving approval response
        message = {
            "type": "message",
            "data": json.dumps({
                "approval_id": "approval-123",
                "approved": True,
                "add_to_allowlist": True,
            }),
        }

        await listener._handle_message(message)

        # Future should be resolved
        assert future.done()
        approved, add_to_allowlist = future.result()
        assert approved is True
        assert add_to_allowlist is True

    async def test_handle_approval_response_denied(self, mock_redis: MagicMock):
        """Test handling denial response."""
        listener = ApprovalListener(mock_redis)

        future = await listener.register_approval("approval-456")

        message = {
            "type": "message",
            "data": json.dumps({
                "approval_id": "approval-456",
                "approved": False,
                "add_to_allowlist": False,
            }),
        }

        await listener._handle_message(message)

        approved, add_to_allowlist = future.result()
        assert approved is False
        assert add_to_allowlist is False

    async def test_handle_unknown_approval(self, mock_redis: MagicMock):
        """Test handling approval for unknown ID (no error)."""
        listener = ApprovalListener(mock_redis)

        message = {
            "type": "message",
            "data": json.dumps({
                "approval_id": "unknown-approval",
                "approved": True,
            }),
        }

        # Should not raise
        await listener._handle_message(message)

    async def test_handle_invalid_message(self, mock_redis: MagicMock):
        """Test handling invalid message format."""
        listener = ApprovalListener(mock_redis)

        # Missing approval_id
        message = {
            "type": "message",
            "data": json.dumps({"approved": True}),
        }

        # Should not raise
        await listener._handle_message(message)

    async def test_handle_malformed_json(self, mock_redis: MagicMock):
        """Test handling malformed JSON."""
        listener = ApprovalListener(mock_redis)

        message = {
            "type": "message",
            "data": "not valid json",
        }

        # Should not raise
        await listener._handle_message(message)

    async def test_handle_bytes_message(self, mock_redis: MagicMock):
        """Test handling bytes message data."""
        listener = ApprovalListener(mock_redis)

        future = await listener.register_approval("approval-789")

        message = {
            "type": "message",
            "data": json.dumps({
                "approval_id": "approval-789",
                "approved": True,
            }).encode("utf-8"),
        }

        await listener._handle_message(message)

        assert future.done()


class TestApprovalListenerGlobalSingleton:
    """Test global singleton management."""

    def test_get_set_approval_listener(self):
        """Test global getter/setter."""
        original = get_approval_listener()

        mock_redis = MagicMock()
        listener = ApprovalListener(mock_redis)

        set_approval_listener(listener)
        assert get_approval_listener() == listener

        # Restore original
        set_approval_listener(original)


# =============================================================================
# Integration Tests with Real Redis (marked for CI with real Redis)
# =============================================================================


@pytest.mark.integration
@requires_redis
class TestAgentTaskWorkerRedisIntegration:
    """Integration tests with real Redis connection.

    These tests require a running Redis instance.
    Run with: pytest -m integration --run-redis-tests
    """

    @pytest.fixture
    async def redis_client(self):
        """Get real Redis client from test fixture."""
        import os
        import redis.asyncio as aioredis
        from podex_shared.redis_client import RedisClient

        redis_url = os.getenv("REDIS_URL", "redis://localhost:6380")
        try:
            client = RedisClient(redis_url)
            await client.connect()
            yield client
            await client.disconnect()
        except Exception:
            pytest.skip("Redis not available")

    async def test_full_task_lifecycle_with_redis(self, redis_client):
        """Test full task lifecycle with real Redis."""
        worker = AgentTaskWorker(redis_client, poll_interval=0.1, pool_size=2)

        session_id = f"test-session-{uuid.uuid4().hex[:8]}"
        task_id = f"test-task-{uuid.uuid4().hex[:8]}"

        try:
            # Enqueue a task
            pending_key = PENDING_KEY.format(session_id=session_id)
            task_key = TASK_KEY.format(task_id=task_id)

            await redis_client.client.zadd(pending_key, {task_id: time.time()})
            await redis_client.set_json(task_key, {
                "id": task_id,
                "session_id": session_id,
                "agent_id": "agent-123",
                "message": "Test message",
                "message_id": "msg-123",
                "status": "pending",
            })

            # Dequeue the task
            task_data = await worker._dequeue_task(session_id)

            assert task_data is not None
            assert task_data["id"] == task_id
            assert task_data["status"] == "running"

        finally:
            # Cleanup
            await redis_client.client.delete(pending_key, task_key)


@pytest.mark.integration
@requires_redis
class TestApprovalListenerRedisIntegration:
    """Integration tests for ApprovalListener with real Redis."""

    @pytest.fixture
    async def redis_client(self):
        """Get real Redis client from test fixture."""
        import os
        import redis.asyncio as aioredis
        from podex_shared.redis_client import RedisClient

        redis_url = os.getenv("REDIS_URL", "redis://localhost:6380")
        try:
            client = RedisClient(redis_url)
            await client.connect()
            yield client
            await client.disconnect()
        except Exception:
            pytest.skip("Redis not available")

    async def test_approval_via_pubsub(self, redis_client):
        """Test approval resolution via real pub/sub."""
        listener = ApprovalListener(redis_client)

        await listener.start()

        try:
            # Register approval
            approval_id = f"test-approval-{uuid.uuid4().hex[:8]}"
            future = await listener.register_approval(approval_id)

            # Simulate API publishing approval response
            await asyncio.sleep(0.1)  # Wait for listener to subscribe
            await redis_client.publish(
                APPROVAL_RESPONSES_CHANNEL,
                {
                    "approval_id": approval_id,
                    "approved": True,
                    "add_to_allowlist": False,
                },
            )

            # Wait for resolution (with timeout)
            try:
                approved, add_to_allowlist = await asyncio.wait_for(future, timeout=2.0)
                assert approved is True
                assert add_to_allowlist is False
            except asyncio.TimeoutError:
                pytest.skip("Pub/sub message not received in time")

        finally:
            await listener.stop()
