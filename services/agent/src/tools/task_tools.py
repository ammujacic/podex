"""Task management tools for agents.

This module provides Redis-backed persistent task management.
Tasks are stored in Redis sorted sets for priority-based ordering.
"""

from dataclasses import dataclass, field
from typing import Any

import structlog

from podex_shared.redis_client import get_redis_client
from src.config import settings
from src.queue.task_queue import EnqueueParams, TaskQueue

logger = structlog.get_logger()


@dataclass
class TaskConfig:
    """Configuration for creating a task."""

    session_id: str
    agent_role: str
    description: str
    priority: str = "medium"
    context: dict[str, Any] | None = field(default=None)
    callback_event: str | None = None


class TaskQueueHolder:
    """Singleton holder for the task queue instance."""

    _instance: TaskQueue | None = None

    @classmethod
    def get(cls) -> TaskQueue:
        """Get or create the global task queue instance."""
        if cls._instance is None:
            redis_client = get_redis_client(settings.REDIS_URL)
            cls._instance = TaskQueue(redis_client)
        return cls._instance


def get_task_queue() -> TaskQueue:
    """Get or create the global task queue instance."""
    return TaskQueueHolder.get()


async def create_task(config: TaskConfig) -> dict[str, Any]:
    """Create a task for another agent.

    This tool is primarily used by the Architect agent to delegate
    work to other specialized agents. Tasks are stored persistently
    in Redis and survive service restarts.

    Args:
        config: Task configuration containing session_id, agent_role,
                description, priority, context, and callback_event.

    Returns:
        Dictionary with task info or error.
    """
    try:
        # Validate agent role
        valid_roles = {"coder", "reviewer", "tester", "architect", "orchestrator", "agent_builder"}
        if config.agent_role not in valid_roles:
            return {
                "success": False,
                "error": f"Invalid agent role: {config.agent_role}. Must be one of: {valid_roles}",
            }

        # Validate and normalize priority
        valid_priorities = {"high", "medium", "low"}
        priority = config.priority if config.priority in valid_priorities else "medium"

        # Enqueue task in Redis
        queue = get_task_queue()
        enqueue_params = EnqueueParams(
            session_id=config.session_id,
            agent_role=config.agent_role,
            description=config.description,
            priority=priority,
            context=config.context,
            callback_event=config.callback_event,
        )
        task_id = await queue.enqueue(enqueue_params)

        logger.info(
            "Task created",
            task_id=task_id,
            agent_role=config.agent_role,
            priority=priority,
            session_id=config.session_id,
        )

        return {
            "success": True,
            "task_id": task_id,
            "agent_role": config.agent_role,
            "priority": priority,
            "message": f"Task created for {config.agent_role} agent with priority {priority}",
        }

    except Exception as e:
        logger.error("Failed to create task", error=str(e))
        return {"success": False, "error": str(e)}


async def get_pending_tasks(
    session_id: str,
    agent_role: str | None = None,
) -> list[dict[str, Any]]:
    """Get pending tasks for a session.

    Args:
        session_id: The session to get tasks for.
        agent_role: Optional filter by agent role.

    Returns:
        List of pending tasks.
    """
    queue = get_task_queue()
    tasks = await queue.get_pending_tasks(session_id, agent_role)
    return [task.to_dict() for task in tasks]


async def get_task(task_id: str) -> dict[str, Any] | None:
    """Get a task by ID.

    Args:
        task_id: The task ID to retrieve.

    Returns:
        Task data or None if not found.
    """
    queue = get_task_queue()
    task = await queue.get_task(task_id)
    return task.to_dict() if task else None


async def complete_task(
    task_id: str,
    result: dict[str, Any] | None = None,
) -> bool:
    """Mark a task as completed.

    Args:
        task_id: The task ID to complete.
        result: Optional result data.

    Returns:
        True if task was found and completed.
    """
    queue = get_task_queue()
    return await queue.complete_task(task_id, result)


async def fail_task(
    task_id: str,
    error: str,
    retry: bool = True,
) -> bool:
    """Mark a task as failed.

    Args:
        task_id: The task ID that failed.
        error: Error message.
        retry: Whether to requeue for retry.

    Returns:
        True if task was found and updated.
    """
    queue = get_task_queue()
    return await queue.fail_task(task_id, error, retry)


async def cancel_task(task_id: str) -> bool:
    """Cancel a pending or active task.

    Args:
        task_id: The task ID to cancel.

    Returns:
        True if task was found and cancelled.
    """
    queue = get_task_queue()
    return await queue.cancel_task(task_id)


async def clear_session_tasks(session_id: str) -> int:
    """Clear all tasks for a session.

    Args:
        session_id: The session to clear tasks for.

    Returns:
        Number of tasks cleared.
    """
    queue = get_task_queue()
    return await queue.clear_session_tasks(session_id)


async def get_session_task_stats(session_id: str) -> dict[str, int]:
    """Get task statistics for a session.

    Args:
        session_id: The session to get stats for.

    Returns:
        Dictionary with counts by status.
    """
    queue = get_task_queue()
    return await queue.get_session_stats(session_id)


async def dequeue_task(
    session_id: str,
    agent_role: str | None = None,
    agent_id: str | None = None,
) -> dict[str, Any] | None:
    """Dequeue the next task for processing.

    Args:
        session_id: Session to get task from.
        agent_role: Optional filter by agent role.
        agent_id: Agent ID claiming the task.

    Returns:
        Task data or None if no tasks available.
    """
    queue = get_task_queue()
    task = await queue.dequeue(session_id, agent_role, agent_id)
    return task.to_dict() if task else None
