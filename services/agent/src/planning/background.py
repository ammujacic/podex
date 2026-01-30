"""Background planning that runs while conversation continues."""

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any

import structlog

from .parallel import GeneratedPlan, get_parallel_plan_generator

logger = structlog.get_logger()


class BackgroundPlanStatus(str, Enum):
    """Status of a background planning task."""

    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


@dataclass
class BackgroundPlanTask:
    """A background planning task."""

    id: str
    session_id: str
    agent_id: str
    task_description: str
    context: str | None
    num_plans: int
    models: list[str]
    status: BackgroundPlanStatus = BackgroundPlanStatus.QUEUED
    plan_ids: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "session_id": self.session_id,
            "agent_id": self.agent_id,
            "task_description": self.task_description,
            "num_plans": self.num_plans,
            "models": self.models,
            "status": self.status.value,
            "plan_ids": self.plan_ids,
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "error": self.error,
        }


# Type for notification callbacks
PlanNotificationCallback = Callable[[BackgroundPlanTask, list[GeneratedPlan]], Awaitable[None]]


class BackgroundPlanner:
    """
    Runs plan generation in the background while conversation continues.

    Features:
    - Queue planning tasks for background execution
    - Notify via callback when plans are ready
    - Allow cancellation of pending/running tasks
    - Priority queue for urgent planning requests
    """

    def __init__(self) -> None:
        self._tasks: dict[str, BackgroundPlanTask] = {}
        self._task_queue: asyncio.Queue[str] = asyncio.Queue()
        self._worker_task: asyncio.Task[None] | None = None
        self._notification_callbacks: list[PlanNotificationCallback] = []
        self._running = False

    async def start(self) -> None:
        """Start the background worker."""
        if self._running:
            return

        self._running = True
        self._worker_task = asyncio.create_task(self._worker_loop())
        logger.info("background_planner_started")

    async def stop(self) -> None:
        """Stop the background worker."""
        self._running = False
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
        logger.info("background_planner_stopped")

    def register_notification_callback(self, callback: PlanNotificationCallback) -> None:
        """Register a callback to be notified when plans are ready."""
        self._notification_callbacks.append(callback)

    async def queue_planning_task(
        self,
        session_id: str,
        agent_id: str,
        task_description: str,
        num_plans: int = 3,
        models: list[str] | None = None,
        context: str | None = None,
        priority: bool = False,
    ) -> BackgroundPlanTask:
        """
        Queue a planning task for background execution.

        Args:
            session_id: The session ID
            agent_id: The agent ID
            task_description: Description of the task to plan
            num_plans: Number of plans to generate
            models: Models to use for generation
            context: Additional context
            priority: If True, add to front of queue

        Returns:
            The queued task
        """
        if not models:
            raise ValueError(
                "models are required for background planning. "
                "Pass explicit planning models derived from DB/role defaults."
            )

        task = BackgroundPlanTask(
            id=str(uuid.uuid4()),
            session_id=session_id,
            agent_id=agent_id,
            task_description=task_description,
            context=context,
            num_plans=num_plans,
            models=models,
        )

        self._tasks[task.id] = task

        # Add to queue
        await self._task_queue.put(task.id)

        logger.info(
            "planning_task_queued",
            task_id=task.id,
            session_id=session_id,
            priority=priority,
        )

        # Start worker if not running
        if not self._running:
            await self.start()

        return task

    async def cancel_task(self, task_id: str) -> bool:
        """Cancel a queued or running planning task."""
        task = self._tasks.get(task_id)
        if not task:
            return False

        if task.status == BackgroundPlanStatus.QUEUED:
            task.status = BackgroundPlanStatus.CANCELLED
            logger.info("planning_task_cancelled", task_id=task_id)
            return True
        elif task.status == BackgroundPlanStatus.RUNNING:
            task.status = BackgroundPlanStatus.CANCELLED
            logger.info("planning_task_cancelled_while_running", task_id=task_id)
            return True

        return False

    def get_task(self, task_id: str) -> BackgroundPlanTask | None:
        """Get a task by ID."""
        return self._tasks.get(task_id)

    def get_session_tasks(
        self,
        session_id: str,
        include_completed: bool = True,
    ) -> list[BackgroundPlanTask]:
        """Get all tasks for a session."""
        tasks = [t for t in self._tasks.values() if t.session_id == session_id]
        if not include_completed:
            tasks = [
                t
                for t in tasks
                if t.status not in [BackgroundPlanStatus.COMPLETED, BackgroundPlanStatus.CANCELLED]
            ]
        return sorted(tasks, key=lambda t: t.created_at, reverse=True)

    async def _worker_loop(self) -> None:
        """Background worker that processes planning tasks."""
        generator = get_parallel_plan_generator()

        while self._running:
            try:
                # Wait for a task with timeout
                try:
                    task_id = await asyncio.wait_for(
                        self._task_queue.get(),
                        timeout=5.0,
                    )
                except TimeoutError:
                    continue

                task = self._tasks.get(task_id)
                if not task or task.status == BackgroundPlanStatus.CANCELLED:
                    continue

                # Execute the task
                task.status = BackgroundPlanStatus.RUNNING
                task.started_at = datetime.utcnow()

                try:
                    plans = await generator.generate_parallel_plans(
                        session_id=task.session_id,
                        agent_id=task.agent_id,
                        task_description=task.task_description,
                        num_plans=task.num_plans,
                        models=task.models,
                        context=task.context,
                    )

                    # Check if cancelled during generation
                    if task.status == BackgroundPlanStatus.CANCELLED:
                        continue

                    task.plan_ids = [p.id for p in plans]
                    task.status = BackgroundPlanStatus.COMPLETED
                    task.completed_at = datetime.utcnow()

                    # Notify callbacks
                    for callback in self._notification_callbacks:
                        try:
                            await callback(task, plans)
                        except Exception as e:
                            logger.error(
                                "notification_callback_failed",
                                task_id=task_id,
                                error=str(e),
                            )

                    logger.info(
                        "planning_task_completed",
                        task_id=task_id,
                        num_plans=len(plans),
                    )

                except Exception as e:
                    task.status = BackgroundPlanStatus.FAILED
                    task.error = str(e)
                    task.completed_at = datetime.utcnow()
                    logger.error(
                        "planning_task_failed",
                        task_id=task_id,
                        error=str(e),
                    )

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("background_worker_error", error=str(e))
                await asyncio.sleep(1)

    def get_queue_status(self) -> dict[str, Any]:
        """Get status of the background planner."""
        queued = sum(1 for t in self._tasks.values() if t.status == BackgroundPlanStatus.QUEUED)
        running = sum(1 for t in self._tasks.values() if t.status == BackgroundPlanStatus.RUNNING)

        return {
            "running": self._running,
            "queued_tasks": queued,
            "running_tasks": running,
            "total_tasks": len(self._tasks),
        }


# Global instance
_planner: BackgroundPlanner | None = None


def get_background_planner() -> BackgroundPlanner:
    """Get or create the global background planner."""
    global _planner
    if _planner is None:
        _planner = BackgroundPlanner()
    return _planner


async def start_background_planner() -> None:
    """Start the global background planner."""
    planner = get_background_planner()
    await planner.start()


async def stop_background_planner() -> None:
    """Stop the global background planner."""
    planner = get_background_planner()
    await planner.stop()
