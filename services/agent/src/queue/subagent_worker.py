"""Background worker for processing subagent tasks from the queue.

This worker polls the subagent task queue and dispatches tasks to the
SubagentManager for execution. It bridges the API service (which enqueues tasks)
with the agent service (which executes them).

Supports concurrent processing with configurable pool size.
"""

import asyncio
import contextlib
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

import structlog

from src.subagent.manager import SubagentManager, get_subagent_manager

if TYPE_CHECKING:
    from podex_shared.redis_client import RedisClient

logger = structlog.get_logger()


# Key structure (matches API service task_queue.py)
PENDING_KEY = "podex:subagents:{session_id}:pending"
ACTIVE_KEY = "podex:subagents:{session_id}:active"
COMPLETED_KEY = "podex:subagents:{session_id}:completed"
TASK_KEY = "podex:subagent:{task_id}"
UPDATES_CHANNEL = "podex:subagents:updates"

TASK_TTL = 86400  # 24 hours
COMPLETED_TTL = 3600  # 1 hour


class SubagentTaskWorker:
    """Background worker that processes subagent tasks from the Redis queue.

    Integrates with the SubagentManager to execute tasks with context isolation.
    Publishes progress updates via Redis pub/sub for real-time tracking.

    Supports concurrent processing with configurable pool size.
    """

    def __init__(
        self,
        redis_client: "RedisClient",
        subagent_manager: SubagentManager | None = None,
        poll_interval: float = 0.5,
        pool_size: int = 4,
    ) -> None:
        """Initialize subagent task worker.

        Args:
            redis_client: Redis client for queue operations
            subagent_manager: SubagentManager instance (uses global if not provided)
            poll_interval: Seconds between queue polls
            pool_size: Maximum concurrent subagent tasks (default: 4)
        """
        self._redis = redis_client
        self._manager = subagent_manager or get_subagent_manager()
        self._poll_interval = poll_interval
        self._pool_size = pool_size
        self._running = False
        self._worker_id = f"subagent-{uuid.uuid4().hex[:8]}"
        self._task: asyncio.Task[None] | None = None
        self._active_sessions: set[str] = set()

        # Semaphore for limiting concurrent task processing
        self._semaphore = asyncio.Semaphore(pool_size)
        # Track running tasks
        self._running_tasks: dict[str, asyncio.Task[None]] = {}

    def add_session(self, session_id: str) -> None:
        """Add a session to process subagent tasks for."""
        self._active_sessions.add(session_id)
        logger.debug("Session added to subagent worker", session_id=session_id)

    def remove_session(self, session_id: str) -> None:
        """Remove a session from processing."""
        self._active_sessions.discard(session_id)
        logger.debug("Session removed from subagent worker", session_id=session_id)

    async def start(self) -> None:
        """Start the background worker."""
        if self._running:
            return

        self._running = True
        self._task = asyncio.create_task(self._run())
        logger.info(
            "Subagent task worker started",
            worker_id=self._worker_id,
            pool_size=self._pool_size,
        )

    async def stop(self) -> None:
        """Stop the background worker and wait for running tasks."""
        self._running = False

        # Cancel all running tasks
        for task_id, task in list(self._running_tasks.items()):
            if not task.done():
                task.cancel()
                logger.info("Cancelling subagent task", task_id=task_id)

        # Wait for all tasks to complete
        if self._running_tasks:
            await asyncio.gather(
                *self._running_tasks.values(),
                return_exceptions=True,
            )
            self._running_tasks.clear()

        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        logger.info("Subagent task worker stopped", worker_id=self._worker_id)

    async def _run(self) -> None:
        """Main worker loop."""
        while self._running:
            try:
                await self._process_pending_tasks()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Error in subagent task worker loop")

            await asyncio.sleep(self._poll_interval)

    async def _process_pending_tasks(self) -> None:
        """Process pending subagent tasks concurrently.

        Discovers sessions with pending tasks by scanning Redis keys.
        Spawns tasks up to pool_size limit for concurrent processing.
        """
        # Clean up completed tasks
        completed = [tid for tid, task in self._running_tasks.items() if task.done()]
        for tid in completed:
            self._running_tasks.pop(tid, None)

        # Check available capacity
        available_slots = self._pool_size - len(self._running_tasks)
        if available_slots <= 0:
            return

        # First check explicitly registered sessions
        sessions_to_check = set(self._active_sessions)

        # Also scan for any session with pending tasks
        # Pattern: podex:subagents:*:pending
        cursor = 0
        while True:
            cursor, keys = await self._redis.client.scan(
                cursor,
                match="podex:subagents:*:pending",
                count=100,
            )
            for key in keys:
                # Extract session_id from key (podex:subagents:{session_id}:pending)
                parts = key.split(":")
                if len(parts) >= 3:
                    session_id = parts[2]
                    sessions_to_check.add(session_id)
            if cursor == 0:
                break

        # Dequeue and spawn tasks up to available slots
        tasks_spawned = 0
        for session_id in sessions_to_check:
            if tasks_spawned >= available_slots:
                break

            try:
                task_data = await self._dequeue_task(session_id)
                if task_data:
                    task_id = task_data["id"]
                    asyncio_task = asyncio.create_task(self._process_task_with_semaphore(task_data))
                    self._running_tasks[task_id] = asyncio_task
                    tasks_spawned += 1
            except Exception:
                logger.exception(
                    "Error dequeuing subagent task",
                    session_id=session_id,
                )

    async def _process_task_with_semaphore(self, task_data: dict[str, Any]) -> None:
        """Process a task with semaphore-based concurrency control."""
        async with self._semaphore:
            await self._process_task(task_data)

    async def _dequeue_task(self, session_id: str) -> dict[str, Any] | None:
        """Dequeue the highest priority pending task for a session."""
        pending_key = PENDING_KEY.format(session_id=session_id)

        # Get pending task IDs
        task_ids = await self._redis.client.zrange(pending_key, 0, 0)
        if not task_ids:
            return None

        task_id = task_ids[0]

        # Try to claim the task atomically
        removed = await self._redis.client.zrem(pending_key, task_id)
        if removed == 0:
            return None  # Already claimed by another worker

        # Add to active set
        active_key = ACTIVE_KEY.format(session_id=session_id)
        await self._redis.client.sadd(active_key, task_id)

        # Get task data
        task_key = TASK_KEY.format(task_id=task_id)
        raw_data = await self._redis.get_json(task_key)

        if raw_data and isinstance(raw_data, dict):
            task_data: dict[str, Any] = raw_data
            # Update status to running
            task_data["status"] = "running"
            task_data["started_at"] = datetime.now(UTC).isoformat()
            await self._redis.set_json(task_key, task_data, ex=TASK_TTL)

            # Publish task started event
            await self._publish_event("subagent_task_started", task_data)

            return task_data

        return None

    async def _process_task(self, task_data: dict[str, Any]) -> None:
        """Process a single subagent task."""
        task_id = task_data["id"]
        session_id = task_data["session_id"]
        parent_agent_id = task_data["parent_agent_id"]
        subagent_type = task_data["subagent_type"]
        task_description = task_data["task_description"]
        system_prompt = task_data.get("system_prompt")
        _background = task_data.get("background", False)  # Reserved for future use

        logger.info(
            "Processing subagent task",
            task_id=task_id,
            subagent_type=subagent_type,
            session_id=session_id,
        )

        try:
            # Use SubagentManager to spawn and execute the subagent
            subagent = await self._manager.spawn_subagent(
                parent_agent_id=parent_agent_id,
                session_id=session_id,
                role=subagent_type,
                task=task_description,
                background=False,  # We're already in a worker, execute synchronously
                system_prompt=system_prompt,
            )

            # Get the result
            result = {
                "summary": subagent.result_summary or "",
                "output": subagent.result_summary or "",
                "tokens_used": subagent.context.tokens_used,
                "subagent_id": subagent.id,
            }

            # Mark task as completed
            await self._complete_task(task_id, session_id, result)

        except Exception as e:
            logger.exception(
                "Subagent task failed",
                task_id=task_id,
                error=str(e),
            )
            await self._fail_task(task_id, session_id, str(e))

    async def _complete_task(
        self,
        task_id: str,
        session_id: str,
        result: dict[str, Any] | None = None,
    ) -> None:
        """Mark a task as completed."""
        task_key = TASK_KEY.format(task_id=task_id)
        raw_data = await self._redis.get_json(task_key)

        if not raw_data or not isinstance(raw_data, dict):
            return

        data: dict[str, Any] = raw_data

        active_key = ACTIVE_KEY.format(session_id=session_id)
        completed_key = COMPLETED_KEY.format(session_id=session_id)

        # Remove from active
        await self._redis.client.srem(active_key, task_id)

        # Add to completed list
        await self._redis.client.lpush(completed_key, task_id)
        await self._redis.client.ltrim(completed_key, 0, 99)

        # Update task data
        data["status"] = "completed"
        data["completed_at"] = datetime.now(UTC).isoformat()
        data["result"] = result
        data["progress"] = 100
        await self._redis.set_json(task_key, data, ex=COMPLETED_TTL)

        # Publish completion event
        await self._publish_event("subagent_task_completed", data)

        logger.info("Subagent task completed", task_id=task_id)

    async def _fail_task(
        self,
        task_id: str,
        session_id: str,
        error: str,
    ) -> None:
        """Mark a task as failed."""
        task_key = TASK_KEY.format(task_id=task_id)
        raw_data = await self._redis.get_json(task_key)

        if not raw_data or not isinstance(raw_data, dict):
            return

        data: dict[str, Any] = raw_data

        active_key = ACTIVE_KEY.format(session_id=session_id)

        # Remove from active
        await self._redis.client.srem(active_key, task_id)

        # Update task data
        data["status"] = "failed"
        data["completed_at"] = datetime.now(UTC).isoformat()
        data["error"] = error
        await self._redis.set_json(task_key, data, ex=COMPLETED_TTL)

        # Publish failure event
        await self._publish_event("subagent_task_failed", data)

        logger.error("Subagent task failed", task_id=task_id, error=error)

    async def _publish_event(self, event_type: str, task_data: dict[str, Any]) -> None:
        """Publish task event to pub/sub channel."""
        await self._redis.publish(
            UPDATES_CHANNEL,
            {
                "event": event_type,
                "task_id": task_data["id"],
                "session_id": task_data["session_id"],
                "parent_agent_id": task_data["parent_agent_id"],
                "subagent_type": task_data["subagent_type"],
                "status": task_data.get("status", "pending"),
                "progress": task_data.get("progress", 0),
                "progress_message": task_data.get("progress_message"),
                "result": task_data.get("result"),
                "error": task_data.get("error"),
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )

    async def update_progress(
        self,
        task_id: str,
        progress: int,
        message: str | None = None,
    ) -> None:
        """Update task progress (called during execution).

        Args:
            task_id: Task ID
            progress: Progress percentage (0-100)
            message: Optional progress message
        """
        task_key = TASK_KEY.format(task_id=task_id)
        raw_data = await self._redis.get_json(task_key)

        if not raw_data or not isinstance(raw_data, dict):
            return

        data: dict[str, Any] = raw_data
        data["progress"] = progress
        data["progress_message"] = message
        await self._redis.set_json(task_key, data, ex=TASK_TTL)

        # Publish progress event
        await self._publish_event("subagent_task_progress", data)


# Global singleton
_worker: SubagentTaskWorker | None = None


def get_subagent_task_worker() -> SubagentTaskWorker | None:
    """Get the global subagent task worker instance."""
    return _worker


def set_subagent_task_worker(worker: SubagentTaskWorker) -> None:
    """Set the global subagent task worker instance."""
    global _worker
    _worker = worker
