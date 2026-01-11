"""Redis-backed persistent task queue for agent task management."""

import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from typing import Any

import structlog

from podex_shared.redis_client import RedisClient

logger = structlog.get_logger()


class TaskStatus(str, Enum):
    """Task execution status."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskPriority(str, Enum):
    """Task priority levels."""

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


# Priority scores for sorted set (lower = higher priority)
PRIORITY_SCORES = {
    TaskPriority.HIGH: 0,
    TaskPriority.MEDIUM: 50,
    TaskPriority.LOW: 100,
}


@dataclass
class TaskData:
    """Task data structure."""

    id: str
    session_id: str
    agent_role: str
    description: str
    priority: TaskPriority = TaskPriority.MEDIUM
    status: TaskStatus = TaskStatus.PENDING
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    started_at: datetime | None = None
    completed_at: datetime | None = None
    result: dict[str, Any] | None = None
    error: str | None = None
    assigned_agent_id: str | None = None
    callback_event: str | None = None
    context: dict[str, Any] = field(default_factory=dict)
    retry_count: int = 0
    max_retries: int = 3

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "id": self.id,
            "session_id": self.session_id,
            "agent_role": self.agent_role,
            "description": self.description,
            "priority": self.priority.value
            if isinstance(self.priority, TaskPriority)
            else self.priority,
            "status": self.status.value if isinstance(self.status, TaskStatus) else self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "result": self.result,
            "error": self.error,
            "assigned_agent_id": self.assigned_agent_id,
            "callback_event": self.callback_event,
            "context": self.context,
            "retry_count": self.retry_count,
            "max_retries": self.max_retries,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TaskData":
        """Create from dictionary."""
        return cls(
            id=data["id"],
            session_id=data["session_id"],
            agent_role=data["agent_role"],
            description=data["description"],
            priority=TaskPriority(data.get("priority", "medium")),
            status=TaskStatus(data.get("status", "pending")),
            created_at=datetime.fromisoformat(data["created_at"])
            if data.get("created_at")
            else datetime.now(UTC),
            started_at=datetime.fromisoformat(data["started_at"])
            if data.get("started_at")
            else None,
            completed_at=datetime.fromisoformat(data["completed_at"])
            if data.get("completed_at")
            else None,
            result=data.get("result"),
            error=data.get("error"),
            assigned_agent_id=data.get("assigned_agent_id"),
            callback_event=data.get("callback_event"),
            context=data.get("context", {}),
            retry_count=data.get("retry_count", 0),
            max_retries=data.get("max_retries", 3),
        )


@dataclass
class EnqueueParams:
    """Parameters for enqueuing a task."""

    session_id: str
    agent_role: str
    description: str
    priority: str | TaskPriority = TaskPriority.MEDIUM
    context: dict[str, Any] | None = None
    callback_event: str | None = None


class TaskQueue:
    """Redis-backed persistent task queue with priority support.

    Uses Redis sorted sets for priority-based task ordering and
    hashes for task data storage.

    Key structure:
        podex:tasks:{session_id}:pending  - Sorted set of pending task IDs
        podex:tasks:{session_id}:active   - Set of active task IDs
        podex:task:{task_id}              - Task data (JSON)
        podex:tasks:updates               - Pub/sub channel for task events
    """

    # Key prefixes
    PENDING_KEY = "podex:tasks:{session_id}:pending"
    ACTIVE_KEY = "podex:tasks:{session_id}:active"
    COMPLETED_KEY = "podex:tasks:{session_id}:completed"
    TASK_KEY = "podex:task:{task_id}"
    UPDATES_CHANNEL = "podex:tasks:updates"

    # TTLs
    TASK_TTL = 86400  # 24 hours
    COMPLETED_TTL = 3600  # 1 hour for completed tasks
    TASK_TIMEOUT = 300  # 5 minutes - max time a task can be in RUNNING state

    def __init__(self, redis_client: RedisClient) -> None:
        """Initialize task queue.

        Args:
            redis_client: Redis client instance
        """
        self._redis = redis_client

    async def enqueue(self, params: EnqueueParams) -> str:
        """Add a task to the queue.

        Args:
            params: Parameters for enqueuing the task

        Returns:
            Task ID
        """
        task_id = str(uuid.uuid4())

        # Normalize priority
        priority = params.priority
        if isinstance(priority, str):
            try:
                priority = TaskPriority(priority)
            except ValueError:
                priority = TaskPriority.MEDIUM

        task = TaskData(
            id=task_id,
            session_id=params.session_id,
            agent_role=params.agent_role,
            description=params.description,
            priority=priority,
            context=params.context or {},
            callback_event=params.callback_event,
        )

        # Calculate priority score (lower = higher priority)
        # Add timestamp fraction to maintain FIFO order within same priority
        priority_score = PRIORITY_SCORES[priority] + (time.time() % 100) / 100

        # Store task data
        task_key = self.TASK_KEY.format(task_id=task_id)
        await self._redis.set_json(task_key, task.to_dict(), ex=self.TASK_TTL)

        # Add to pending queue sorted by priority
        pending_key = self.PENDING_KEY.format(session_id=params.session_id)
        await self._redis.client.zadd(pending_key, {task_id: priority_score})

        # Publish task created event
        await self._publish_event("task_created", task)

        logger.info(
            "Task enqueued",
            task_id=task_id,
            session_id=params.session_id,
            agent_role=params.agent_role,
            priority=priority.value,
        )

        return task_id

    async def dequeue(
        self,
        session_id: str,
        agent_role: str | None = None,
        agent_id: str | None = None,
    ) -> TaskData | None:
        """Get the highest priority pending task.

        Args:
            session_id: Session ID to get tasks for
            agent_role: Optional filter by agent role
            agent_id: Agent ID claiming the task

        Returns:
            TaskData if a task is available, None otherwise
        """
        pending_key = self.PENDING_KEY.format(session_id=session_id)

        # Get all pending tasks ordered by priority
        task_ids = await self._redis.client.zrange(pending_key, 0, -1)

        for task_id in task_ids:
            task = await self.get_task(task_id)
            if not task:
                # Clean up stale reference and the orphaned task key
                await self._redis.client.zrem(pending_key, task_id)
                task_key = self.TASK_KEY.format(task_id=task_id)
                await self._redis.delete(task_key)
                continue

            # Filter by role if specified
            if agent_role and task.agent_role != agent_role:
                continue

            # Try to claim the task atomically
            claimed = await self._claim_task(session_id, task_id, agent_id)
            if claimed:
                return await self.get_task(task_id)

        return None

    async def _claim_task(
        self,
        session_id: str,
        task_id: str,
        agent_id: str | None = None,
    ) -> bool:
        """Atomically claim a task from pending to active.

        Args:
            session_id: Session ID
            task_id: Task ID to claim
            agent_id: Agent ID claiming the task

        Returns:
            True if claimed successfully
        """
        pending_key = self.PENDING_KEY.format(session_id=session_id)
        active_key = self.ACTIVE_KEY.format(session_id=session_id)

        # Remove from pending (returns count removed)
        removed = await self._redis.client.zrem(pending_key, task_id)
        if removed == 0:
            return False  # Already claimed by another worker

        # Add to active set
        await self._redis.client.sadd(active_key, task_id)

        # Update task status
        task = await self.get_task(task_id)
        if task:
            task.status = TaskStatus.RUNNING
            task.started_at = datetime.now(UTC)
            task.assigned_agent_id = agent_id
            await self._save_task(task)
            await self._publish_event("task_started", task)

        return True

    async def complete_task(
        self,
        task_id: str,
        result: dict[str, Any] | None = None,
    ) -> bool:
        """Mark a task as completed.

        This method is idempotent - calling it multiple times with the same
        task_id will return True but only process the completion once.

        Args:
            task_id: Task ID to complete
            result: Optional result data

        Returns:
            True if task was found and completed (or already completed)
        """
        task = await self.get_task(task_id)
        if not task:
            return False

        # Idempotency check - if already completed, return success
        if task.status == TaskStatus.COMPLETED:
            logger.debug("Task already completed", task_id=task_id)
            return True

        active_key = self.ACTIVE_KEY.format(session_id=task.session_id)
        completed_key = self.COMPLETED_KEY.format(session_id=task.session_id)

        # Remove from active
        await self._redis.client.srem(active_key, task_id)

        # Add to completed list (capped)
        await self._redis.client.lpush(completed_key, task_id)
        await self._redis.client.ltrim(completed_key, 0, 99)  # Keep last 100

        # Update task
        task.status = TaskStatus.COMPLETED
        task.completed_at = datetime.now(UTC)
        task.result = result
        await self._save_task(task, ttl=self.COMPLETED_TTL)

        # Publish completion event
        await self._publish_event("task_completed", task)

        logger.info("Task completed", task_id=task_id, session_id=task.session_id)
        return True

    async def fail_task(
        self,
        task_id: str,
        error: str,
        retry: bool = True,
    ) -> bool:
        """Mark a task as failed, optionally requeuing for retry.

        Args:
            task_id: Task ID that failed
            error: Error message
            retry: Whether to requeue for retry

        Returns:
            True if task was found and updated
        """
        task = await self.get_task(task_id)
        if not task:
            return False

        active_key = self.ACTIVE_KEY.format(session_id=task.session_id)
        await self._redis.client.srem(active_key, task_id)

        task.error = error
        task.retry_count += 1

        if retry and task.retry_count < task.max_retries:
            # Requeue with lower priority
            task.status = TaskStatus.PENDING
            task.started_at = None
            task.assigned_agent_id = None
            await self._save_task(task)

            # Re-add to pending queue with slightly lower priority
            pending_key = self.PENDING_KEY.format(session_id=task.session_id)
            retry_score = PRIORITY_SCORES[task.priority] + 10 * task.retry_count
            await self._redis.client.zadd(pending_key, {task_id: retry_score})

            logger.warning(
                "Task requeued for retry",
                task_id=task_id,
                retry_count=task.retry_count,
                error=error,
            )
            await self._publish_event("task_retry", task)
        else:
            # Mark as failed
            task.status = TaskStatus.FAILED
            task.completed_at = datetime.now(UTC)
            await self._save_task(task, ttl=self.COMPLETED_TTL)

            logger.error(
                "Task failed permanently",
                task_id=task_id,
                retry_count=task.retry_count,
                error=error,
            )
            await self._publish_event("task_failed", task)

        return True

    async def cancel_task(self, task_id: str) -> bool:
        """Cancel a pending or active task.

        Args:
            task_id: Task ID to cancel

        Returns:
            True if task was found and cancelled
        """
        task = await self.get_task(task_id)
        if not task:
            return False

        if task.status not in (TaskStatus.PENDING, TaskStatus.RUNNING):
            return False  # Can't cancel completed/failed tasks

        pending_key = self.PENDING_KEY.format(session_id=task.session_id)
        active_key = self.ACTIVE_KEY.format(session_id=task.session_id)

        # Remove from both queues
        await self._redis.client.zrem(pending_key, task_id)
        await self._redis.client.srem(active_key, task_id)

        # Update status
        task.status = TaskStatus.CANCELLED
        task.completed_at = datetime.now(UTC)
        await self._save_task(task, ttl=self.COMPLETED_TTL)

        await self._publish_event("task_cancelled", task)

        logger.info("Task cancelled", task_id=task_id)
        return True

    async def get_task(self, task_id: str) -> TaskData | None:
        """Get task by ID.

        Args:
            task_id: Task ID

        Returns:
            TaskData if found, None otherwise
        """
        task_key = self.TASK_KEY.format(task_id=task_id)
        data = await self._redis.get_json(task_key)
        if data and isinstance(data, dict):
            return TaskData.from_dict(data)
        return None

    async def get_pending_tasks(
        self,
        session_id: str,
        agent_role: str | None = None,
        limit: int = 50,
    ) -> list[TaskData]:
        """Get pending tasks for a session.

        Args:
            session_id: Session ID
            agent_role: Optional filter by agent role
            limit: Maximum tasks to return

        Returns:
            List of pending tasks ordered by priority
        """
        pending_key = self.PENDING_KEY.format(session_id=session_id)
        task_ids = await self._redis.client.zrange(pending_key, 0, limit - 1)

        tasks = []
        for task_id in task_ids:
            task = await self.get_task(task_id)
            if task and (agent_role is None or task.agent_role == agent_role):
                tasks.append(task)

        return tasks

    async def get_active_tasks(self, session_id: str) -> list[TaskData]:
        """Get currently active tasks for a session.

        Args:
            session_id: Session ID

        Returns:
            List of active tasks
        """
        active_key = self.ACTIVE_KEY.format(session_id=session_id)
        task_ids = await self._redis.client.smembers(active_key)

        tasks = []
        for task_id in task_ids:
            task = await self.get_task(task_id)
            if task:
                tasks.append(task)

        return tasks

    async def get_session_stats(self, session_id: str) -> dict[str, int]:
        """Get task statistics for a session.

        Args:
            session_id: Session ID

        Returns:
            Dictionary with counts by status
        """
        pending_key = self.PENDING_KEY.format(session_id=session_id)
        active_key = self.ACTIVE_KEY.format(session_id=session_id)
        completed_key = self.COMPLETED_KEY.format(session_id=session_id)

        pending_count = await self._redis.client.zcard(pending_key)
        active_count = await self._redis.client.scard(active_key)
        completed_count = await self._redis.client.llen(completed_key)

        return {
            "pending": pending_count,
            "active": active_count,
            "completed": completed_count,
        }

    async def clear_session_tasks(self, session_id: str) -> int:
        """Clear all tasks for a session.

        Args:
            session_id: Session ID

        Returns:
            Number of tasks cleared
        """
        pending_key = self.PENDING_KEY.format(session_id=session_id)
        active_key = self.ACTIVE_KEY.format(session_id=session_id)
        completed_key = self.COMPLETED_KEY.format(session_id=session_id)

        # Get all task IDs
        pending_ids = await self._redis.client.zrange(pending_key, 0, -1)
        active_ids = await self._redis.client.smembers(active_key)
        completed_ids = await self._redis.client.lrange(completed_key, 0, -1)

        all_ids = set(pending_ids) | set(active_ids) | set(completed_ids)

        # Delete task data
        for task_id in all_ids:
            task_key = self.TASK_KEY.format(task_id=task_id)
            await self._redis.delete(task_key)

        # Delete queue keys
        await self._redis.delete(pending_key, active_key, completed_key)

        logger.info("Session tasks cleared", session_id=session_id, count=len(all_ids))
        return len(all_ids)

    async def check_timed_out_tasks(self, session_id: str) -> list[str]:
        """Check for and handle tasks that have exceeded the timeout.

        Tasks in RUNNING state for longer than TASK_TIMEOUT will be failed
        and requeued for retry if retries remain.

        Args:
            session_id: Session ID to check

        Returns:
            List of task IDs that were timed out
        """
        active_key = self.ACTIVE_KEY.format(session_id=session_id)
        task_ids = await self._redis.client.smembers(active_key)

        timed_out = []
        now = datetime.now(UTC)

        for task_id in task_ids:
            task = await self.get_task(task_id)
            if not task:
                # Clean up orphaned reference
                await self._redis.client.srem(active_key, task_id)
                task_key = self.TASK_KEY.format(task_id=task_id)
                await self._redis.delete(task_key)
                continue

            if task.status != TaskStatus.RUNNING:
                continue

            if task.started_at:
                elapsed = (now - task.started_at).total_seconds()
                if elapsed > self.TASK_TIMEOUT:
                    logger.warning(
                        "Task timed out",
                        task_id=task_id,
                        elapsed_seconds=elapsed,
                        timeout=self.TASK_TIMEOUT,
                    )
                    await self.fail_task(
                        task_id,
                        f"Task timed out after {elapsed:.1f} seconds",
                        retry=True,
                    )
                    timed_out.append(task_id)

        return timed_out

    async def cleanup_orphaned_tasks(self, session_id: str) -> int:
        """Clean up orphaned task data that's no longer in any queue.

        This removes task data keys that aren't referenced by pending,
        active, or completed queues.

        Args:
            session_id: Session ID to clean up

        Returns:
            Number of orphaned tasks cleaned up
        """
        pending_key = self.PENDING_KEY.format(session_id=session_id)
        active_key = self.ACTIVE_KEY.format(session_id=session_id)
        completed_key = self.COMPLETED_KEY.format(session_id=session_id)

        # Get all referenced task IDs
        pending_ids = set(await self._redis.client.zrange(pending_key, 0, -1))
        active_ids = set(await self._redis.client.smembers(active_key))
        completed_ids = set(await self._redis.client.lrange(completed_key, 0, -1))
        referenced_ids = pending_ids | active_ids | completed_ids

        # Scan for task keys matching this session
        cleaned = 0
        cursor = 0
        pattern = "podex:task:*"

        while True:
            cursor, keys = await self._redis.client.scan(cursor, match=pattern, count=100)
            for key in keys:
                task_id = key.split(":")[-1] if ":" in key else key
                task = await self.get_task(task_id)
                if task and task.session_id == session_id and task_id not in referenced_ids:
                    await self._redis.delete(key)
                    cleaned += 1

            if cursor == 0:
                break

        if cleaned > 0:
            logger.info("Cleaned up orphaned tasks", session_id=session_id, count=cleaned)

        return cleaned

    async def _save_task(self, task: TaskData, ttl: int | None = None) -> None:
        """Save task data to Redis.

        Args:
            task: Task data to save
            ttl: Optional TTL override
        """
        task_key = self.TASK_KEY.format(task_id=task.id)
        await self._redis.set_json(task_key, task.to_dict(), ex=ttl or self.TASK_TTL)

    async def _publish_event(self, event_type: str, task: TaskData) -> None:
        """Publish task event to pub/sub channel.

        Args:
            event_type: Event type name
            task: Task data
        """
        await self._redis.publish(
            self.UPDATES_CHANNEL,
            {
                "event": event_type,
                "task_id": task.id,
                "session_id": task.session_id,
                "agent_role": task.agent_role,
                "status": task.status.value,
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )
