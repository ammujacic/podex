"""Tests for queue module.

Tests cover:
- TaskQueue dataclasses and enums
- TaskWorker class
- Task lifecycle
- Session management
"""

import asyncio
import pytest
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

from src.queue.task_queue import (
    TaskData,
    TaskQueue,
    TaskStatus,
    TaskPriority,
    EnqueueParams,
)
from src.queue.worker import (
    TaskWorker,
    TaskWorkerHolder,
    get_task_worker,
    set_task_worker,
)


class TestQueueModuleImports:
    """Test queue module imports."""

    def test_queue_module_exists(self):
        """Test queue module can be imported."""
        from src import queue
        assert queue is not None

    def test_task_queue_module_exists(self):
        """Test task_queue module can be imported."""
        from src.queue import task_queue
        assert task_queue is not None

    def test_worker_module_exists(self):
        """Test worker module can be imported."""
        from src.queue import worker
        assert worker is not None


class TestTaskStatus:
    """Test TaskStatus enum."""

    def test_task_status_values(self):
        """Test TaskStatus enum values."""
        assert TaskStatus.PENDING.value == "pending"
        assert TaskStatus.RUNNING.value == "running"
        assert TaskStatus.COMPLETED.value == "completed"
        assert TaskStatus.FAILED.value == "failed"
        assert TaskStatus.CANCELLED.value == "cancelled"


class TestTaskPriority:
    """Test TaskPriority enum."""

    def test_task_priority_values(self):
        """Test TaskPriority enum values."""
        assert TaskPriority.LOW.value == "low"
        assert TaskPriority.MEDIUM.value == "medium"
        assert TaskPriority.HIGH.value == "high"


class TestEnqueueParams:
    """Test EnqueueParams dataclass."""

    def test_enqueue_params_creation(self):
        """Test EnqueueParams creation."""
        params = EnqueueParams(
            session_id="session-123",
            agent_role="coder",
            description="Write a test",
        )

        assert params.session_id == "session-123"
        assert params.agent_role == "coder"
        assert params.description == "Write a test"

    def test_enqueue_params_with_priority(self):
        """Test EnqueueParams with priority."""
        params = EnqueueParams(
            session_id="session-123",
            agent_role="coder",
            description="Urgent task",
            priority=TaskPriority.HIGH,
        )

        assert params.priority == TaskPriority.HIGH


class TestTaskData:
    """Test TaskData dataclass."""

    def test_task_data_creation(self):
        """Test TaskData creation."""
        task = TaskData(
            id="task-123",
            session_id="session-456",
            agent_role="coder",
            description="Write a function",
            status=TaskStatus.PENDING,
        )

        assert task.id == "task-123"
        assert task.session_id == "session-456"
        assert task.agent_role == "coder"
        assert task.description == "Write a function"
        assert task.status == TaskStatus.PENDING


class TestTaskQueue:
    """Test TaskQueue class."""

    def test_task_queue_class_exists(self):
        """Test TaskQueue class exists."""
        assert TaskQueue is not None


class TestTaskWorker:
    """Test TaskWorker class."""

    def test_task_worker_class_exists(self):
        """Test TaskWorker class exists."""
        assert TaskWorker is not None

    def test_task_worker_initialization(self):
        """Test TaskWorker initialization."""
        mock_queue = MagicMock()
        mock_redis = MagicMock()

        worker = TaskWorker(
            task_queue=mock_queue,
            redis_client=mock_redis,
            poll_interval=2.0,
        )

        assert worker._queue == mock_queue
        assert worker._redis == mock_redis
        assert worker._poll_interval == 2.0
        assert worker._running is False
        assert worker._handlers == {}
        assert worker._active_sessions == set()

    def test_register_handler(self):
        """Test registering a handler."""
        mock_queue = MagicMock()
        mock_redis = MagicMock()
        worker = TaskWorker(mock_queue, mock_redis)

        async def coder_handler(task):
            return {"result": "done"}

        worker.register_handler("coder", coder_handler)

        assert "coder" in worker._handlers
        assert worker._handlers["coder"] == coder_handler

    def test_add_session(self):
        """Test adding a session."""
        mock_queue = MagicMock()
        mock_redis = MagicMock()
        worker = TaskWorker(mock_queue, mock_redis)

        worker.add_session("session-123")

        assert "session-123" in worker._active_sessions

    def test_remove_session(self):
        """Test removing a session."""
        mock_queue = MagicMock()
        mock_redis = MagicMock()
        worker = TaskWorker(mock_queue, mock_redis)
        worker.add_session("session-123")

        worker.remove_session("session-123")

        assert "session-123" not in worker._active_sessions

    def test_remove_nonexistent_session(self):
        """Test removing a non-existent session."""
        mock_queue = MagicMock()
        mock_redis = MagicMock()
        worker = TaskWorker(mock_queue, mock_redis)

        # Should not raise
        worker.remove_session("nonexistent")

        assert "nonexistent" not in worker._active_sessions

    async def test_start_worker(self):
        """Test starting the worker."""
        mock_queue = MagicMock()
        mock_redis = MagicMock()
        worker = TaskWorker(mock_queue, mock_redis, poll_interval=0.1)

        # Start and immediately stop
        await worker.start()
        assert worker._running is True
        assert worker._task is not None

        await worker.stop()
        assert worker._running is False

    async def test_start_worker_already_running(self):
        """Test starting worker when already running."""
        mock_queue = MagicMock()
        mock_redis = MagicMock()
        worker = TaskWorker(mock_queue, mock_redis, poll_interval=0.1)

        await worker.start()
        task1 = worker._task

        await worker.start()  # Second start should be no-op
        task2 = worker._task

        assert task1 is task2

        await worker.stop()

    async def test_stop_worker(self):
        """Test stopping the worker."""
        mock_queue = MagicMock()
        mock_redis = MagicMock()
        worker = TaskWorker(mock_queue, mock_redis, poll_interval=0.1)

        await worker.start()
        await worker.stop()

        assert worker._running is False

    async def test_stop_worker_not_running(self):
        """Test stopping worker when not running."""
        mock_queue = MagicMock()
        mock_redis = MagicMock()
        worker = TaskWorker(mock_queue, mock_redis)

        # Should not raise
        await worker.stop()

        assert worker._running is False

    async def test_process_task_no_handler(self):
        """Test processing task with no handler."""
        mock_queue = MagicMock()
        mock_queue.fail_task = AsyncMock()
        mock_redis = MagicMock()
        worker = TaskWorker(mock_queue, mock_redis)

        task = TaskData(
            id="task-123",
            session_id="session-456",
            agent_role="unknown_role",
            description="Test task",
            status=TaskStatus.PENDING,
        )

        await worker._process_task(task)

        mock_queue.fail_task.assert_called_once()
        call_args = mock_queue.fail_task.call_args
        assert "task-123" in call_args.args
        assert "No handler" in call_args.kwargs.get("error", "")

    async def test_process_task_success(self):
        """Test processing task successfully."""
        mock_queue = MagicMock()
        mock_queue.complete_task = AsyncMock()
        mock_redis = MagicMock()
        worker = TaskWorker(mock_queue, mock_redis)

        async def handler(task):
            return {"result": "success"}

        worker.register_handler("coder", handler)

        task = TaskData(
            id="task-123",
            session_id="session-456",
            agent_role="coder",
            description="Test task",
            status=TaskStatus.PENDING,
        )

        await worker._process_task(task)

        mock_queue.complete_task.assert_called_once_with(
            "task-123", result={"result": "success"}
        )

    async def test_process_task_handler_failure(self):
        """Test processing task when handler fails."""
        mock_queue = MagicMock()
        mock_queue.fail_task = AsyncMock()
        mock_redis = MagicMock()
        worker = TaskWorker(mock_queue, mock_redis)

        async def handler(task):
            raise Exception("Handler error")

        worker.register_handler("coder", handler)

        task = TaskData(
            id="task-123",
            session_id="session-456",
            agent_role="coder",
            description="Test task",
            status=TaskStatus.PENDING,
        )

        await worker._process_task(task)

        mock_queue.fail_task.assert_called_once()
        assert "Handler error" in mock_queue.fail_task.call_args.kwargs.get("error", "")

    async def test_process_pending_tasks(self):
        """Test processing pending tasks."""
        mock_queue = MagicMock()
        mock_queue.dequeue = AsyncMock(return_value=None)
        mock_redis = MagicMock()
        worker = TaskWorker(mock_queue, mock_redis)

        async def handler(task):
            return {"result": "done"}

        worker.register_handler("coder", handler)
        worker.add_session("session-123")

        await worker._process_pending_tasks()

        mock_queue.dequeue.assert_called()


class TestTaskWorkerHolder:
    """Test TaskWorkerHolder class."""

    def test_task_worker_holder_class_exists(self):
        """Test TaskWorkerHolder class exists."""
        assert TaskWorkerHolder is not None

    def test_holder_get_returns_none_initially(self):
        """Test get returns None when no worker set."""
        # Reset the holder
        TaskWorkerHolder._instance = None

        result = TaskWorkerHolder.get()
        assert result is None

    def test_holder_set_and_get(self):
        """Test set and get worker."""
        mock_queue = MagicMock()
        mock_redis = MagicMock()
        worker = TaskWorker(mock_queue, mock_redis)

        TaskWorkerHolder.set(worker)

        result = TaskWorkerHolder.get()
        assert result is worker

        # Cleanup
        TaskWorkerHolder._instance = None


class TestGlobalWorkerFunctions:
    """Test global worker functions."""

    def test_get_task_worker(self):
        """Test get_task_worker function."""
        TaskWorkerHolder._instance = None
        result = get_task_worker()
        assert result is None

    def test_set_task_worker(self):
        """Test set_task_worker function."""
        mock_queue = MagicMock()
        mock_redis = MagicMock()
        worker = TaskWorker(mock_queue, mock_redis)

        set_task_worker(worker)

        result = get_task_worker()
        assert result is worker

        # Cleanup
        TaskWorkerHolder._instance = None
