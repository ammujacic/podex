"""Background task worker for processing queued tasks."""

import asyncio
import contextlib
from collections.abc import Callable, Coroutine
from typing import TYPE_CHECKING, Any

import structlog

from src.queue.task_queue import TaskData, TaskQueue, TaskStatus

if TYPE_CHECKING:
    from podex_shared.redis_client import RedisClient

logger = structlog.get_logger()


class TaskWorker:
    """Background worker that processes tasks from the queue.

    Continuously polls the task queue for pending tasks and
    dispatches them to the appropriate handler.
    """

    def __init__(
        self,
        task_queue: TaskQueue,
        redis_client: "RedisClient",
        poll_interval: float = 1.0,
    ) -> None:
        """Initialize task worker.

        Args:
            task_queue: Task queue instance
            redis_client: Redis client for pub/sub
            poll_interval: Seconds between queue polls
        """
        self._queue = task_queue
        self._redis = redis_client
        self._poll_interval = poll_interval
        self._running = False
        self._task: asyncio.Task[None] | None = None
        self._handlers: dict[
            str,
            Callable[[TaskData], Coroutine[Any, Any, dict[str, Any] | None]],
        ] = {}
        self._active_sessions: set[str] = set()

    def register_handler(
        self,
        agent_role: str,
        handler: Callable[[TaskData], Coroutine[Any, Any, dict[str, Any] | None]],
    ) -> None:
        """Register a handler for an agent role.

        Args:
            agent_role: Agent role to handle (coder, reviewer, tester)
            handler: Async function that processes tasks and returns result
        """
        self._handlers[agent_role] = handler
        logger.info("Handler registered", agent_role=agent_role)

    def add_session(self, session_id: str) -> None:
        """Add a session to process tasks for.

        Args:
            session_id: Session ID to monitor
        """
        self._active_sessions.add(session_id)
        logger.debug("Session added to worker", session_id=session_id)

    def remove_session(self, session_id: str) -> None:
        """Remove a session from processing.

        Args:
            session_id: Session ID to stop monitoring
        """
        self._active_sessions.discard(session_id)
        logger.debug("Session removed from worker", session_id=session_id)

    async def start(self) -> None:
        """Start the background worker."""
        if self._running:
            return

        self._running = True
        self._task = asyncio.create_task(self._run())
        logger.info("Task worker started")

    async def stop(self) -> None:
        """Stop the background worker."""
        self._running = False
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        logger.info("Task worker stopped")

    async def _run(self) -> None:
        """Main worker loop."""
        while self._running:
            try:
                await self._process_pending_tasks()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Error in task worker loop")

            await asyncio.sleep(self._poll_interval)

    async def _process_pending_tasks(self) -> None:
        """Process one round of pending tasks from all sessions."""
        for session_id in list(self._active_sessions):
            for agent_role in self._handlers:
                try:
                    task = await self._queue.dequeue(
                        session_id=session_id,
                        agent_role=agent_role,
                    )

                    if task:
                        await self._process_task(task)

                except Exception:
                    logger.exception(
                        "Error processing task",
                        session_id=session_id,
                        agent_role=agent_role,
                    )

    async def _process_task(self, task: TaskData) -> None:
        """Process a single task.

        Args:
            task: Task to process
        """
        handler = self._handlers.get(task.agent_role)
        if not handler:
            logger.warning(
                "No handler for agent role",
                agent_role=task.agent_role,
                task_id=task.id,
            )
            await self._queue.fail_task(
                task.id,
                error=f"No handler registered for role: {task.agent_role}",
                retry=False,
            )
            return

        logger.info(
            "Processing task",
            task_id=task.id,
            agent_role=task.agent_role,
            session_id=task.session_id,
        )

        try:
            result = await handler(task)
            await self._queue.complete_task(task.id, result=result)

        except Exception as e:
            logger.exception(
                "Task handler failed",
                task_id=task.id,
                error=str(e),
            )
            await self._queue.fail_task(task.id, error=str(e))

    async def process_task_immediately(self, task_id: str) -> TaskData | None:
        """Process a specific task immediately (bypass queue).

        Useful for high-priority tasks that shouldn't wait.

        Args:
            task_id: Task ID to process

        Returns:
            Updated task data after processing
        """
        task = await self._queue.get_task(task_id)
        if not task:
            return None

        if task.status != TaskStatus.PENDING:
            logger.warning(
                "Task not pending",
                task_id=task_id,
                status=task.status.value,
            )
            return task

        # Claim the task
        claimed = await self._queue._claim_task(
            task.session_id,
            task_id,
            agent_id="immediate",
        )

        if not claimed:
            return await self._queue.get_task(task_id)

        await self._process_task(task)
        return await self._queue.get_task(task_id)


class TaskWorkerHolder:
    """Singleton holder for the global task worker instance."""

    _instance: TaskWorker | None = None

    @classmethod
    def get(cls) -> TaskWorker | None:
        """Get the global task worker instance."""
        return cls._instance

    @classmethod
    def set(cls, worker: TaskWorker) -> None:
        """Set the global task worker instance."""
        cls._instance = worker


def get_task_worker() -> TaskWorker | None:
    """Get the global task worker instance."""
    return TaskWorkerHolder.get()


def set_task_worker(worker: TaskWorker) -> None:
    """Set the global task worker instance."""
    TaskWorkerHolder.set(worker)
