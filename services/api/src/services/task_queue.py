"""Task queue service for agent and subagent task execution.

This module provides Redis-backed task queue functionality for:
1. Main agent tasks - user messages processed by agents
2. Subagent tasks - delegated tasks spawned by parent agents

All agent services poll these queues and process tasks. Control commands
(abort, pause, resume) are distributed via Redis pub/sub to all instances.
"""

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from typing import Any

import structlog

from src.cache import get_cache_client

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
class SubagentTaskData:
    """Task data structure for subagent tasks."""

    id: str
    session_id: str
    parent_agent_id: str
    subagent_type: str
    task_description: str
    system_prompt: str | None = None
    priority: TaskPriority = TaskPriority.MEDIUM
    status: TaskStatus = TaskStatus.PENDING
    background: bool = False
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    started_at: datetime | None = None
    completed_at: datetime | None = None
    result: dict[str, Any] | None = None
    error: str | None = None
    assigned_worker_id: str | None = None
    progress: int = 0
    progress_message: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "id": self.id,
            "session_id": self.session_id,
            "parent_agent_id": self.parent_agent_id,
            "subagent_type": self.subagent_type,
            "task_description": self.task_description,
            "system_prompt": self.system_prompt,
            "priority": self.priority.value
            if isinstance(self.priority, TaskPriority)
            else self.priority,
            "status": self.status.value if isinstance(self.status, TaskStatus) else self.status,
            "background": self.background,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "result": self.result,
            "error": self.error,
            "assigned_worker_id": self.assigned_worker_id,
            "progress": self.progress,
            "progress_message": self.progress_message,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SubagentTaskData":
        """Create from dictionary."""
        return cls(
            id=data["id"],
            session_id=data["session_id"],
            parent_agent_id=data["parent_agent_id"],
            subagent_type=data["subagent_type"],
            task_description=data["task_description"],
            system_prompt=data.get("system_prompt"),
            priority=TaskPriority(data.get("priority", "medium")),
            status=TaskStatus(data.get("status", "pending")),
            background=data.get("background", False),
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
            assigned_worker_id=data.get("assigned_worker_id"),
            progress=data.get("progress", 0),
            progress_message=data.get("progress_message"),
        )


class SubagentTaskQueue:
    """Redis-backed task queue for subagent tasks.

    Compatible with the agent service task queue format.

    Key structure:
        podex:subagents:{session_id}:pending  - Sorted set of pending task IDs
        podex:subagents:{session_id}:active   - Set of active task IDs
        podex:subagent:{task_id}              - Task data (JSON)
        podex:subagents:updates               - Pub/sub channel for task events
    """

    # Key prefixes (uses subagents namespace to avoid collision with session tasks)
    PENDING_KEY = "podex:subagents:{session_id}:pending"
    ACTIVE_KEY = "podex:subagents:{session_id}:active"
    COMPLETED_KEY = "podex:subagents:{session_id}:completed"
    TASK_KEY = "podex:subagent:{task_id}"
    UPDATES_CHANNEL = "podex:subagents:updates"

    # TTLs
    TASK_TTL = 86400  # 24 hours
    COMPLETED_TTL = 3600  # 1 hour for completed tasks

    def __init__(self) -> None:
        """Initialize task queue (lazy connection)."""
        self._redis: Any = None

    async def _get_redis(self) -> Any:
        """Get Redis client (using existing API cache client)."""
        if self._redis is None:
            self._redis = await get_cache_client()
        return self._redis

    async def enqueue(
        self,
        session_id: str,
        parent_agent_id: str,
        subagent_type: str,
        task_description: str,
        system_prompt: str | None = None,
        background: bool = False,
        priority: TaskPriority = TaskPriority.MEDIUM,
    ) -> SubagentTaskData:
        """Enqueue a subagent task.

        Args:
            session_id: Session ID
            parent_agent_id: ID of the parent agent spawning the subagent
            subagent_type: Type of subagent (e.g., "explore", "bash")
            task_description: Description of the task to perform
            system_prompt: Optional system prompt for the subagent
            background: Whether this is a background task
            priority: Task priority

        Returns:
            SubagentTaskData with assigned task ID
        """
        redis = await self._get_redis()
        task_id = str(uuid.uuid4())

        task = SubagentTaskData(
            id=task_id,
            session_id=session_id,
            parent_agent_id=parent_agent_id,
            subagent_type=subagent_type,
            task_description=task_description,
            system_prompt=system_prompt,
            background=background,
            priority=priority,
        )

        # Calculate priority score
        priority_score = PRIORITY_SCORES[priority] + (time.time() % 100) / 100

        # Store task data
        task_key = self.TASK_KEY.format(task_id=task_id)
        await redis.set_json(task_key, task.to_dict(), ex=self.TASK_TTL)

        # Add to pending queue
        pending_key = self.PENDING_KEY.format(session_id=session_id)
        await redis.client.zadd(pending_key, {task_id: priority_score})

        # Publish task created event
        await self._publish_event("subagent_task_created", task)

        logger.info(
            "Subagent task enqueued",
            task_id=task_id,
            session_id=session_id,
            parent_agent_id=parent_agent_id,
            subagent_type=subagent_type,
            background=background,
        )

        return task

    async def get_task(self, task_id: str) -> SubagentTaskData | None:
        """Get task by ID."""
        redis = await self._get_redis()
        task_key = self.TASK_KEY.format(task_id=task_id)
        data = await redis.get_json(task_key)
        if data and isinstance(data, dict):
            return SubagentTaskData.from_dict(data)
        return None

    async def cancel_task(self, task_id: str) -> bool:
        """Cancel a pending or running task."""
        task = await self.get_task(task_id)
        if not task:
            return False

        if task.status not in (TaskStatus.PENDING, TaskStatus.RUNNING):
            return False

        redis = await self._get_redis()
        pending_key = self.PENDING_KEY.format(session_id=task.session_id)
        active_key = self.ACTIVE_KEY.format(session_id=task.session_id)

        # Remove from both queues
        await redis.client.zrem(pending_key, task_id)
        await redis.client.srem(active_key, task_id)

        # Update status
        task.status = TaskStatus.CANCELLED
        task.completed_at = datetime.now(UTC)
        await self._save_task(task, ttl=self.COMPLETED_TTL)

        await self._publish_event("subagent_task_cancelled", task)

        logger.info("Subagent task cancelled", task_id=task_id)
        return True

    async def get_pending_tasks(self, session_id: str, limit: int = 50) -> list[SubagentTaskData]:
        """Get pending tasks for a session."""
        redis = await self._get_redis()
        pending_key = self.PENDING_KEY.format(session_id=session_id)
        task_ids = await redis.client.zrange(pending_key, 0, limit - 1)

        tasks = []
        for task_id in task_ids:
            task = await self.get_task(task_id)
            if task:
                tasks.append(task)

        return tasks

    async def get_active_tasks(self, session_id: str) -> list[SubagentTaskData]:
        """Get active tasks for a session."""
        redis = await self._get_redis()
        active_key = self.ACTIVE_KEY.format(session_id=session_id)
        task_ids = await redis.client.smembers(active_key)

        tasks = []
        for task_id in task_ids:
            task = await self.get_task(task_id)
            if task:
                tasks.append(task)

        return tasks

    async def wait_for_completion(
        self,
        task_id: str,
        timeout: float = 300.0,  # noqa: ASYNC109 - timeout parameter is valid API
        poll_interval: float = 0.5,
    ) -> SubagentTaskData | None:
        """Wait for a task to complete.

        Args:
            task_id: Task ID to wait for
            timeout: Maximum time to wait in seconds
            poll_interval: How often to poll for status

        Returns:
            Completed task data or None if timeout/not found
        """
        start_time = datetime.now(UTC)

        while True:
            task = await self.get_task(task_id)
            if not task:
                return None

            if task.status in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED):
                return task

            # Check timeout
            elapsed = (datetime.now(UTC) - start_time).total_seconds()
            if elapsed >= timeout:
                logger.warning("Task wait timeout", task_id=task_id, elapsed=elapsed)
                return task

            await asyncio.sleep(poll_interval)

    async def _save_task(self, task: SubagentTaskData, ttl: int | None = None) -> None:
        """Save task data to Redis."""
        redis = await self._get_redis()
        task_key = self.TASK_KEY.format(task_id=task.id)
        await redis.set_json(task_key, task.to_dict(), ex=ttl or self.TASK_TTL)

    async def _publish_event(self, event_type: str, task: SubagentTaskData) -> None:
        """Publish task event to pub/sub channel."""
        redis = await self._get_redis()
        await redis.publish(
            self.UPDATES_CHANNEL,
            {
                "event": event_type,
                "task_id": task.id,
                "session_id": task.session_id,
                "parent_agent_id": task.parent_agent_id,
                "subagent_type": task.subagent_type,
                "status": task.status.value if isinstance(task.status, TaskStatus) else task.status,
                "progress": task.progress,
                "progress_message": task.progress_message,
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )


# ============================================================================
# Agent Task Queue (for main agent execution)
# ============================================================================


class ControlCommand(str, Enum):
    """Control commands for distributed agent management."""

    ABORT = "abort"
    PAUSE = "pause"
    RESUME = "resume"
    CANCEL = "cancel"


@dataclass
class AgentTaskData:
    """Task data structure for main agent tasks."""

    id: str
    session_id: str
    agent_id: str
    message: str
    message_id: str
    context: dict[str, Any] = field(default_factory=dict)
    priority: TaskPriority = TaskPriority.MEDIUM
    status: TaskStatus = TaskStatus.PENDING
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    started_at: datetime | None = None
    completed_at: datetime | None = None
    response: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    tokens_used: int = 0
    error: str | None = None
    assigned_worker_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "id": self.id,
            "session_id": self.session_id,
            "agent_id": self.agent_id,
            "message": self.message,
            "message_id": self.message_id,
            "context": self.context,
            "priority": self.priority.value
            if isinstance(self.priority, TaskPriority)
            else self.priority,
            "status": self.status.value if isinstance(self.status, TaskStatus) else self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "response": self.response,
            "tool_calls": self.tool_calls,
            "tokens_used": self.tokens_used,
            "error": self.error,
            "assigned_worker_id": self.assigned_worker_id,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AgentTaskData":
        """Create from dictionary."""
        return cls(
            id=data["id"],
            session_id=data["session_id"],
            agent_id=data["agent_id"],
            message=data["message"],
            message_id=data["message_id"],
            context=data.get("context", {}),
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
            response=data.get("response"),
            tool_calls=data.get("tool_calls"),
            tokens_used=data.get("tokens_used", 0),
            error=data.get("error"),
            assigned_worker_id=data.get("assigned_worker_id"),
        )


class AgentTaskQueue:
    """Redis-backed task queue for main agent tasks.

    Key structure:
        podex:agents:{session_id}:pending    - Sorted set of pending task IDs
        podex:agents:{session_id}:active     - Set of active task IDs
        podex:agents:task:{task_id}          - Task data (JSON)
        podex:agents:updates                 - Pub/sub channel for task events
        podex:agents:control                 - Pub/sub channel for control commands
    """

    PENDING_KEY = "podex:agents:{session_id}:pending"
    ACTIVE_KEY = "podex:agents:{session_id}:active"
    TASK_KEY = "podex:agents:task:{task_id}"
    UPDATES_CHANNEL = "podex:agents:updates"
    CONTROL_CHANNEL = "podex:agents:control"

    TASK_TTL = 86400  # 24 hours
    COMPLETED_TTL = 3600  # 1 hour

    def __init__(self) -> None:
        """Initialize task queue (lazy connection)."""
        self._redis: Any = None

    async def _get_redis(self) -> Any:
        """Get Redis client."""
        if self._redis is None:
            self._redis = await get_cache_client()
        return self._redis

    async def enqueue(
        self,
        session_id: str,
        agent_id: str,
        message: str,
        message_id: str,
        context: dict[str, Any] | None = None,
        priority: TaskPriority = TaskPriority.MEDIUM,
    ) -> AgentTaskData:
        """Enqueue an agent task for processing.

        Args:
            session_id: Session ID
            agent_id: Agent ID
            message: User message to process
            message_id: Unique message ID for streaming
            context: Optional context (role, model, template_config, etc.)
            priority: Task priority

        Returns:
            AgentTaskData with assigned task ID
        """
        redis = await self._get_redis()
        task_id = str(uuid.uuid4())

        task = AgentTaskData(
            id=task_id,
            session_id=session_id,
            agent_id=agent_id,
            message=message,
            message_id=message_id,
            context=context or {},
            priority=priority,
        )

        # Calculate priority score (lower = higher priority, add timestamp fraction for FIFO)
        priority_score = PRIORITY_SCORES[priority] + (time.time() % 100) / 100

        # Store task data
        task_key = self.TASK_KEY.format(task_id=task_id)
        await redis.set_json(task_key, task.to_dict(), ex=self.TASK_TTL)

        # Add to pending queue
        pending_key = self.PENDING_KEY.format(session_id=session_id)
        await redis.client.zadd(pending_key, {task_id: priority_score})

        # Publish task created event
        await self._publish_event("agent_task_created", task)

        logger.info(
            "Agent task enqueued",
            task_id=task_id,
            session_id=session_id,
            agent_id=agent_id,
            message_id=message_id,
        )

        return task

    async def get_task(self, task_id: str) -> AgentTaskData | None:
        """Get task by ID."""
        redis = await self._get_redis()
        task_key = self.TASK_KEY.format(task_id=task_id)
        data = await redis.get_json(task_key)
        if data and isinstance(data, dict):
            return AgentTaskData.from_dict(data)
        return None

    async def get_pending_tasks(self, session_id: str, limit: int = 50) -> list[AgentTaskData]:
        """Get pending tasks for a session."""
        redis = await self._get_redis()
        pending_key = self.PENDING_KEY.format(session_id=session_id)
        task_ids = await redis.client.zrange(pending_key, 0, limit - 1)

        tasks = []
        for task_id in task_ids:
            task = await self.get_task(task_id)
            if task:
                tasks.append(task)
        return tasks

    async def get_active_tasks(self, session_id: str) -> list[AgentTaskData]:
        """Get active tasks for a session."""
        redis = await self._get_redis()
        active_key = self.ACTIVE_KEY.format(session_id=session_id)
        task_ids = await redis.client.smembers(active_key)

        tasks = []
        for task_id in task_ids:
            task = await self.get_task(task_id)
            if task:
                tasks.append(task)
        return tasks

    async def wait_for_completion(
        self,
        task_id: str,
        timeout: float = 300.0,  # noqa: ASYNC109 - timeout parameter is valid API
        poll_interval: float = 0.5,
    ) -> AgentTaskData | None:
        """Wait for a task to complete."""
        start_time = datetime.now(UTC)

        while True:
            task = await self.get_task(task_id)
            if not task:
                return None

            if task.status in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED):
                return task

            elapsed = (datetime.now(UTC) - start_time).total_seconds()
            if elapsed >= timeout:
                logger.warning("Agent task wait timeout", task_id=task_id, elapsed=elapsed)
                return task

            await asyncio.sleep(poll_interval)

    async def send_control_command(
        self,
        command: ControlCommand,
        agent_id: str,
        session_id: str | None = None,
        task_id: str | None = None,
    ) -> None:
        """Send a control command to all agent service instances.

        The command is broadcast via Redis pub/sub. Each agent service instance
        checks if it's running the target task/agent and acts accordingly.

        Args:
            command: The control command to send
            agent_id: Target agent ID
            session_id: Optional session ID for context
            task_id: Optional specific task ID to target
        """
        redis = await self._get_redis()

        await redis.publish(
            self.CONTROL_CHANNEL,
            {
                "command": command.value,
                "agent_id": agent_id,
                "session_id": session_id,
                "task_id": task_id,
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )

        logger.info(
            "Control command sent",
            command=command.value,
            agent_id=agent_id,
            session_id=session_id,
            task_id=task_id,
        )

    async def abort_agent(self, agent_id: str, session_id: str | None = None) -> None:
        """Abort all tasks for an agent."""
        await self.send_control_command(ControlCommand.ABORT, agent_id, session_id)

    async def pause_agent(self, agent_id: str, session_id: str | None = None) -> None:
        """Pause an agent (preserves state for resumption)."""
        await self.send_control_command(ControlCommand.PAUSE, agent_id, session_id)

    async def resume_agent(self, agent_id: str, session_id: str | None = None) -> None:
        """Resume a paused agent."""
        await self.send_control_command(ControlCommand.RESUME, agent_id, session_id)

    async def cancel_task(self, task_id: str) -> bool:
        """Cancel a specific task."""
        task = await self.get_task(task_id)
        if not task:
            return False

        await self.send_control_command(
            ControlCommand.CANCEL,
            task.agent_id,
            task.session_id,
            task_id,
        )
        return True

    async def _save_task(self, task: AgentTaskData, ttl: int | None = None) -> None:
        """Save task data to Redis."""
        redis = await self._get_redis()
        task_key = self.TASK_KEY.format(task_id=task.id)
        await redis.set_json(task_key, task.to_dict(), ex=ttl or self.TASK_TTL)

    async def _publish_event(self, event_type: str, task: AgentTaskData) -> None:
        """Publish task event to pub/sub channel."""
        redis = await self._get_redis()
        await redis.publish(
            self.UPDATES_CHANNEL,
            {
                "event": event_type,
                "task_id": task.id,
                "session_id": task.session_id,
                "agent_id": task.agent_id,
                "message_id": task.message_id,
                "status": task.status.value if isinstance(task.status, TaskStatus) else task.status,
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )


# ============================================================================
# Compaction Task Queue (for context window management)
# ============================================================================


@dataclass
class CompactionTaskData:
    """Task data structure for context compaction tasks."""

    id: str
    agent_id: str
    session_id: str
    custom_instructions: str | None = None
    preserve_recent_messages: int = 15
    status: TaskStatus = TaskStatus.PENDING
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    started_at: datetime | None = None
    completed_at: datetime | None = None
    # Result fields
    tokens_before: int = 0
    tokens_after: int = 0
    messages_removed: int = 0
    messages_preserved: int = 0
    summary: str | None = None
    error: str | None = None
    assigned_worker_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "id": self.id,
            "agent_id": self.agent_id,
            "session_id": self.session_id,
            "custom_instructions": self.custom_instructions,
            "preserve_recent_messages": self.preserve_recent_messages,
            "status": self.status.value if isinstance(self.status, TaskStatus) else self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "tokens_before": self.tokens_before,
            "tokens_after": self.tokens_after,
            "messages_removed": self.messages_removed,
            "messages_preserved": self.messages_preserved,
            "summary": self.summary,
            "error": self.error,
            "assigned_worker_id": self.assigned_worker_id,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "CompactionTaskData":
        """Create from dictionary."""
        return cls(
            id=data["id"],
            agent_id=data["agent_id"],
            session_id=data["session_id"],
            custom_instructions=data.get("custom_instructions"),
            preserve_recent_messages=data.get("preserve_recent_messages", 15),
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
            tokens_before=data.get("tokens_before", 0),
            tokens_after=data.get("tokens_after", 0),
            messages_removed=data.get("messages_removed", 0),
            messages_preserved=data.get("messages_preserved", 0),
            summary=data.get("summary"),
            error=data.get("error"),
            assigned_worker_id=data.get("assigned_worker_id"),
        )


class CompactionTaskQueue:
    """Redis-backed task queue for context compaction tasks.

    Key structure:
        podex:compaction:pending           - Sorted set of pending task IDs
        podex:compaction:task:{task_id}    - Task data (JSON)
        podex:compaction:updates           - Pub/sub channel for task events
    """

    PENDING_KEY = "podex:compaction:pending"
    TASK_KEY = "podex:compaction:task:{task_id}"
    UPDATES_CHANNEL = "podex:compaction:updates"

    TASK_TTL = 3600  # 1 hour (compaction tasks are short-lived)
    COMPLETED_TTL = 300  # 5 minutes

    def __init__(self) -> None:
        """Initialize task queue (lazy connection)."""
        self._redis: Any = None

    async def _get_redis(self) -> Any:
        """Get Redis client."""
        if self._redis is None:
            self._redis = await get_cache_client()
        return self._redis

    async def enqueue(
        self,
        agent_id: str,
        session_id: str,
        custom_instructions: str | None = None,
        preserve_recent_messages: int = 15,
    ) -> CompactionTaskData:
        """Enqueue a compaction task for processing.

        Args:
            agent_id: Agent ID to compact
            session_id: Session ID for context
            custom_instructions: Optional custom compaction instructions
            preserve_recent_messages: Number of recent messages to preserve

        Returns:
            CompactionTaskData with assigned task ID
        """
        redis = await self._get_redis()
        task_id = str(uuid.uuid4())

        task = CompactionTaskData(
            id=task_id,
            agent_id=agent_id,
            session_id=session_id,
            custom_instructions=custom_instructions,
            preserve_recent_messages=preserve_recent_messages,
        )

        # Use timestamp for FIFO ordering
        priority_score = time.time()

        # Store task data
        task_key = self.TASK_KEY.format(task_id=task_id)
        await redis.set_json(task_key, task.to_dict(), ex=self.TASK_TTL)

        # Add to pending queue
        await redis.client.zadd(self.PENDING_KEY, {task_id: priority_score})

        # Publish task created event
        await self._publish_event("compaction_task_created", task)

        logger.info(
            "Compaction task enqueued",
            task_id=task_id,
            agent_id=agent_id,
            session_id=session_id,
        )

        return task

    async def get_task(self, task_id: str) -> CompactionTaskData | None:
        """Get task by ID."""
        redis = await self._get_redis()
        task_key = self.TASK_KEY.format(task_id=task_id)
        data = await redis.get_json(task_key)
        if data and isinstance(data, dict):
            return CompactionTaskData.from_dict(data)
        return None

    async def wait_for_completion(
        self,
        task_id: str,
        timeout: float = 120.0,  # noqa: ASYNC109 - timeout parameter is valid API
        poll_interval: float = 0.5,
    ) -> CompactionTaskData | None:
        """Wait for a compaction task to complete."""
        start_time = datetime.now(UTC)

        while True:
            task = await self.get_task(task_id)
            if not task:
                return None

            if task.status in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED):
                return task

            elapsed = (datetime.now(UTC) - start_time).total_seconds()
            if elapsed >= timeout:
                logger.warning("Compaction task wait timeout", task_id=task_id, elapsed=elapsed)
                return task

            await asyncio.sleep(poll_interval)

    async def _publish_event(self, event_type: str, task: CompactionTaskData) -> None:
        """Publish task event to pub/sub channel."""
        redis = await self._get_redis()
        await redis.publish(
            self.UPDATES_CHANNEL,
            {
                "event": event_type,
                "task_id": task.id,
                "agent_id": task.agent_id,
                "session_id": task.session_id,
                "status": task.status.value if isinstance(task.status, TaskStatus) else task.status,
                "tokens_before": task.tokens_before,
                "tokens_after": task.tokens_after,
                "messages_removed": task.messages_removed,
                "messages_preserved": task.messages_preserved,
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )


# ============================================================================
# Approval Queue (for distributed approval resolution)
# ============================================================================


@dataclass
class ApprovalRequestData:
    """Data structure for approval requests."""

    approval_id: str
    agent_id: str
    session_id: str
    tool_name: str
    action_type: str  # "file_write", "command_execute", "other"
    arguments: dict[str, Any]
    can_add_to_allowlist: bool = False
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "approval_id": self.approval_id,
            "agent_id": self.agent_id,
            "session_id": self.session_id,
            "tool_name": self.tool_name,
            "action_type": self.action_type,
            "arguments": self.arguments,
            "can_add_to_allowlist": self.can_add_to_allowlist,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ApprovalRequestData":
        """Create from dictionary."""
        return cls(
            approval_id=data["approval_id"],
            agent_id=data["agent_id"],
            session_id=data["session_id"],
            tool_name=data["tool_name"],
            action_type=data["action_type"],
            arguments=data.get("arguments", {}),
            can_add_to_allowlist=data.get("can_add_to_allowlist", False),
            created_at=datetime.fromisoformat(data["created_at"])
            if data.get("created_at")
            else datetime.now(UTC),
        )


class ApprovalQueue:
    """Redis-backed approval system for distributed agent instances.

    This enables horizontal scaling of agent services by using Redis pub/sub
    for approval responses instead of direct HTTP calls to specific instances.

    Key structure:
        podex:approvals:request:{approval_id}  - Approval request data (JSON)
        podex:approvals:responses              - Pub/sub channel for responses

    Flow:
        1. Agent needs approval → stores request in Redis, subscribes to channel
        2. API notifies frontend via WebSocket (unchanged)
        3. User approves/rejects → API publishes response to Redis channel
        4. Agent instance receives message, resolves its asyncio.Future
    """

    REQUEST_KEY = "podex:approvals:request:{approval_id}"
    RESPONSES_CHANNEL = "podex:approvals:responses"

    REQUEST_TTL = 300  # 5 minutes (approval timeout)

    def __init__(self) -> None:
        """Initialize approval queue (lazy connection)."""
        self._redis: Any = None

    async def _get_redis(self) -> Any:
        """Get Redis client."""
        if self._redis is None:
            self._redis = await get_cache_client()
        return self._redis

    async def store_request(
        self,
        approval_id: str,
        agent_id: str,
        session_id: str,
        tool_name: str,
        action_type: str,
        arguments: dict[str, Any],
        can_add_to_allowlist: bool = False,
    ) -> ApprovalRequestData:
        """Store an approval request in Redis.

        Args:
            approval_id: Unique approval request ID
            agent_id: Agent requesting approval
            session_id: Session ID for context
            tool_name: Name of the tool requiring approval
            action_type: Type of action (file_write, command_execute, other)
            arguments: Tool arguments being approved
            can_add_to_allowlist: Whether user can add to allowlist

        Returns:
            ApprovalRequestData with the stored request
        """
        redis = await self._get_redis()

        request = ApprovalRequestData(
            approval_id=approval_id,
            agent_id=agent_id,
            session_id=session_id,
            tool_name=tool_name,
            action_type=action_type,
            arguments=arguments,
            can_add_to_allowlist=can_add_to_allowlist,
        )

        # Store request data
        request_key = self.REQUEST_KEY.format(approval_id=approval_id)
        await redis.set_json(request_key, request.to_dict(), ex=self.REQUEST_TTL)

        logger.info(
            "Approval request stored",
            approval_id=approval_id,
            agent_id=agent_id,
            tool_name=tool_name,
        )

        return request

    async def get_request(self, approval_id: str) -> ApprovalRequestData | None:
        """Get an approval request by ID."""
        redis = await self._get_redis()
        request_key = self.REQUEST_KEY.format(approval_id=approval_id)
        data = await redis.get_json(request_key)
        if data and isinstance(data, dict):
            return ApprovalRequestData.from_dict(data)
        return None

    async def publish_response(
        self,
        approval_id: str,
        approved: bool,
        add_to_allowlist: bool = False,
    ) -> None:
        """Publish an approval response to all agent service instances.

        The response is broadcast via Redis pub/sub. The agent instance
        that is waiting for this specific approval_id will receive it
        and resolve its pending asyncio.Future.

        Args:
            approval_id: The approval request ID being resolved
            approved: Whether the action was approved
            add_to_allowlist: Whether to add command to allowlist
        """
        redis = await self._get_redis()

        await redis.publish(
            self.RESPONSES_CHANNEL,
            {
                "approval_id": approval_id,
                "approved": approved,
                "add_to_allowlist": add_to_allowlist,
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )

        logger.info(
            "Approval response published",
            approval_id=approval_id,
            approved=approved,
            add_to_allowlist=add_to_allowlist,
        )

        # Clean up the request data
        request_key = self.REQUEST_KEY.format(approval_id=approval_id)
        await redis.client.delete(request_key)


# ============================================================================
# Global singletons
# ============================================================================

_task_queue: SubagentTaskQueue | None = None
_agent_task_queue: AgentTaskQueue | None = None
_compaction_task_queue: CompactionTaskQueue | None = None
_approval_queue: ApprovalQueue | None = None


def get_subagent_task_queue() -> SubagentTaskQueue:
    """Get the global subagent task queue instance."""
    global _task_queue
    if _task_queue is None:
        _task_queue = SubagentTaskQueue()
    return _task_queue


def get_agent_task_queue() -> AgentTaskQueue:
    """Get the global agent task queue instance."""
    global _agent_task_queue
    if _agent_task_queue is None:
        _agent_task_queue = AgentTaskQueue()
    return _agent_task_queue


def get_compaction_task_queue() -> CompactionTaskQueue:
    """Get the global compaction task queue instance."""
    global _compaction_task_queue
    if _compaction_task_queue is None:
        _compaction_task_queue = CompactionTaskQueue()
    return _compaction_task_queue


def get_approval_queue() -> ApprovalQueue:
    """Get the global approval queue instance."""
    global _approval_queue
    if _approval_queue is None:
        _approval_queue = ApprovalQueue()
    return _approval_queue
