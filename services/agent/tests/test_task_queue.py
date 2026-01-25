"""Tests for task queue module.

Tests cover:
- TaskStatus and TaskPriority enums
- TaskData dataclass
- EnqueueParams dataclass
- TaskQueue class
"""

from datetime import datetime, UTC
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestTaskQueueEnums:
    """Test task queue enums."""

    def test_task_status_enum(self):
        """Test TaskStatus enum."""
        from src.queue.task_queue import TaskStatus

        assert TaskStatus.PENDING.value == "pending"
        assert TaskStatus.RUNNING.value == "running"
        assert TaskStatus.COMPLETED.value == "completed"
        assert TaskStatus.FAILED.value == "failed"
        assert TaskStatus.CANCELLED.value == "cancelled"

    def test_task_priority_enum(self):
        """Test TaskPriority enum."""
        from src.queue.task_queue import TaskPriority

        assert TaskPriority.HIGH.value == "high"
        assert TaskPriority.MEDIUM.value == "medium"
        assert TaskPriority.LOW.value == "low"

    def test_priority_scores(self):
        """Test priority scores for sorting."""
        from src.queue.task_queue import PRIORITY_SCORES, TaskPriority

        assert PRIORITY_SCORES[TaskPriority.HIGH] < PRIORITY_SCORES[TaskPriority.MEDIUM]
        assert PRIORITY_SCORES[TaskPriority.MEDIUM] < PRIORITY_SCORES[TaskPriority.LOW]


class TestTaskData:
    """Test TaskData dataclass."""

    def test_task_data_creation(self):
        """Test creating TaskData."""
        from src.queue.task_queue import TaskData, TaskStatus, TaskPriority

        task = TaskData(
            id="task-123",
            session_id="session-456",
            agent_role="coder",
            description="Write a function",
        )

        assert task.id == "task-123"
        assert task.session_id == "session-456"
        assert task.agent_role == "coder"
        assert task.status == TaskStatus.PENDING
        assert task.priority == TaskPriority.MEDIUM

    def test_task_data_to_dict(self):
        """Test TaskData to_dict method."""
        from src.queue.task_queue import TaskData

        task = TaskData(
            id="task-123",
            session_id="session-456",
            agent_role="coder",
            description="Write a function",
        )

        data = task.to_dict()

        assert data["id"] == "task-123"
        assert data["session_id"] == "session-456"
        assert data["status"] == "pending"
        assert data["priority"] == "medium"

    def test_task_data_from_dict(self):
        """Test TaskData from_dict method."""
        from src.queue.task_queue import TaskData, TaskStatus, TaskPriority

        data = {
            "id": "task-789",
            "session_id": "session-456",
            "agent_role": "reviewer",
            "description": "Review code",
            "status": "completed",
            "priority": "high",
            "created_at": "2024-01-01T00:00:00+00:00",
        }

        task = TaskData.from_dict(data)

        assert task.id == "task-789"
        assert task.status == TaskStatus.COMPLETED
        assert task.priority == TaskPriority.HIGH

    def test_task_data_with_all_fields(self):
        """Test TaskData with all fields."""
        from src.queue.task_queue import TaskData, TaskStatus

        now = datetime.now(UTC)
        task = TaskData(
            id="task-123",
            session_id="session-456",
            agent_role="coder",
            description="Write code",
            result={"output": "done"},
            error=None,
            assigned_agent_id="agent-789",
            callback_event="task_done",
            context={"key": "value"},
            retry_count=1,
            max_retries=3,
        )

        data = task.to_dict()
        assert data["result"] == {"output": "done"}
        assert data["assigned_agent_id"] == "agent-789"
        assert data["context"] == {"key": "value"}


class TestEnqueueParams:
    """Test EnqueueParams dataclass."""

    def test_enqueue_params_creation(self):
        """Test creating EnqueueParams."""
        from src.queue.task_queue import EnqueueParams, TaskPriority

        params = EnqueueParams(
            session_id="session-123",
            agent_role="coder",
            description="Write code",
        )

        assert params.session_id == "session-123"
        assert params.agent_role == "coder"
        assert params.priority == TaskPriority.MEDIUM

    def test_enqueue_params_with_priority(self):
        """Test EnqueueParams with priority."""
        from src.queue.task_queue import EnqueueParams, TaskPriority

        params = EnqueueParams(
            session_id="session-123",
            agent_role="coder",
            description="Urgent task",
            priority=TaskPriority.HIGH,
        )

        assert params.priority == TaskPriority.HIGH

    def test_enqueue_params_with_context(self):
        """Test EnqueueParams with context."""
        from src.queue.task_queue import EnqueueParams

        params = EnqueueParams(
            session_id="session-123",
            agent_role="coder",
            description="Write code",
            context={"file": "test.py"},
            callback_event="task_complete",
        )

        assert params.context == {"file": "test.py"}
        assert params.callback_event == "task_complete"


class TestTaskQueue:
    """Test TaskQueue class."""

    def test_task_queue_class_exists(self):
        """Test TaskQueue class exists."""
        from src.queue.task_queue import TaskQueue
        assert TaskQueue is not None

    def test_task_queue_initialization(self):
        """Test TaskQueue initialization."""
        from src.queue.task_queue import TaskQueue

        mock_redis = MagicMock()
        queue = TaskQueue(redis_client=mock_redis)

        assert queue._redis == mock_redis

    def test_task_queue_key_patterns(self):
        """Test TaskQueue key patterns."""
        from src.queue.task_queue import TaskQueue

        assert "podex:tasks" in TaskQueue.PENDING_KEY
        assert "podex:tasks" in TaskQueue.ACTIVE_KEY
        assert "podex:task" in TaskQueue.TASK_KEY


class TestTaskQueueAsync:
    """Test TaskQueue async methods."""

    @pytest.mark.asyncio
    async def test_enqueue_task(self):
        """Test enqueueing a task."""
        from src.queue.task_queue import TaskQueue, EnqueueParams

        # Mock the Redis client structure (redis_client.client.zadd)
        mock_client = AsyncMock()
        mock_client.zadd = AsyncMock()

        mock_redis = AsyncMock()
        mock_redis.client = mock_client
        mock_redis.set_json = AsyncMock()
        mock_redis.publish = AsyncMock()

        queue = TaskQueue(redis_client=mock_redis)
        params = EnqueueParams(
            session_id="session-123",
            agent_role="coder",
            description="Write code",
        )

        task_id = await queue.enqueue(params)

        assert task_id is not None
        mock_redis.set_json.assert_called_once()
        mock_client.zadd.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_task(self):
        """Test getting a task."""
        from src.queue.task_queue import TaskQueue

        mock_client = AsyncMock()
        mock_redis = AsyncMock()
        mock_redis.client = mock_client
        mock_redis.get_json = AsyncMock(return_value={
            "id": "task-123",
            "session_id": "session-456",
            "agent_role": "coder",
            "description": "Write code",
            "status": "pending",
            "priority": "medium",
        })

        queue = TaskQueue(redis_client=mock_redis)
        task = await queue.get_task("task-123")

        assert task is not None
        assert task.id == "task-123"

    @pytest.mark.asyncio
    async def test_get_task_not_found(self):
        """Test getting a task that doesn't exist."""
        from src.queue.task_queue import TaskQueue

        mock_client = AsyncMock()
        mock_redis = AsyncMock()
        mock_redis.client = mock_client
        mock_redis.get_json = AsyncMock(return_value=None)

        queue = TaskQueue(redis_client=mock_redis)
        task = await queue.get_task("nonexistent")

        assert task is None

    @pytest.mark.asyncio
    async def test_get_pending_tasks(self):
        """Test getting pending tasks."""
        from src.queue.task_queue import TaskQueue

        mock_client = AsyncMock()
        mock_client.zrange = AsyncMock(return_value=["task-1", "task-2"])

        mock_redis = AsyncMock()
        mock_redis.client = mock_client
        mock_redis.get_json = AsyncMock(side_effect=[
            {
                "id": "task-1",
                "session_id": "session-123",
                "agent_role": "coder",
                "description": "Task 1",
                "status": "pending",
                "priority": "high",
            },
            {
                "id": "task-2",
                "session_id": "session-123",
                "agent_role": "reviewer",
                "description": "Task 2",
                "status": "pending",
                "priority": "medium",
            },
        ])

        queue = TaskQueue(redis_client=mock_redis)
        tasks = await queue.get_pending_tasks("session-123")

        assert len(tasks) == 2
        assert tasks[0].id == "task-1"
        assert tasks[1].id == "task-2"
