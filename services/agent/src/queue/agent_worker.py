"""Agent task worker for processing main agent tasks from Redis queue.

This worker polls the Redis queue for pending agent tasks and dispatches them
to the AgentOrchestrator for execution. It also listens for control commands
(abort, pause, resume) via Redis pub/sub for distributed agent management.

Key features:
- Configurable worker pool for concurrent task processing (AGENT_WORKER_POOL_SIZE)
- Auto-discovers sessions with pending tasks by scanning Redis keys
- Handles control commands broadcast to all agent service instances
- Only acts on commands for tasks it is currently running
- Publishes streaming tokens and completion events via Redis pub/sub
"""

import asyncio
import contextlib
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

import structlog

if TYPE_CHECKING:
    from podex_shared.redis_client import RedisClient

logger = structlog.get_logger()


# Key structure (matches API service task_queue.py)
PENDING_KEY = "podex:agents:{session_id}:pending"
ACTIVE_KEY = "podex:agents:{session_id}:active"
TASK_KEY = "podex:agents:task:{task_id}"
UPDATES_CHANNEL = "podex:agents:updates"
CONTROL_CHANNEL = "podex:agents:control"

TASK_TTL = 86400  # 24 hours
COMPLETED_TTL = 3600  # 1 hour


class AgentTaskWorker:
    """Background worker that processes agent tasks from the Redis queue.

    Integrates with the AgentOrchestrator to execute tasks with full agent
    capabilities (streaming, tool calls, MCP, etc.).

    Control commands (abort, pause, resume) are distributed via Redis pub/sub.
    Each worker instance checks if it's running the target task/agent and
    acts accordingly.
    """

    def __init__(
        self,
        redis_client: "RedisClient",
        poll_interval: float = 0.5,
        pool_size: int = 4,
    ) -> None:
        """Initialize agent task worker.

        Args:
            redis_client: Redis client for queue operations
            poll_interval: Seconds between queue polls
            pool_size: Maximum number of concurrent tasks (default: 4)
        """
        self._redis = redis_client
        self._poll_interval = poll_interval
        self._pool_size = pool_size
        self._running = False
        self._paused = False
        self._worker_id = f"worker-{uuid.uuid4().hex[:8]}"

        # Semaphore for limiting concurrent task processing
        self._semaphore = asyncio.Semaphore(pool_size)

        # Background tasks
        self._task_processor: asyncio.Task[None] | None = None
        self._control_listener: asyncio.Task[None] | None = None

        # Track currently running asyncio tasks (task_id -> asyncio.Task)
        self._running_tasks: dict[str, asyncio.Task[None]] = {}
        # Track currently running tasks (task_id -> agent_id)
        self._active_tasks: dict[str, str] = {}
        # Track paused agents
        self._paused_agents: set[str] = set()
        # Track abort requests for agents
        self._abort_requested: set[str] = set()

        # Orchestrator reference (set during initialization)
        self._orchestrator: Any = None

    def set_orchestrator(self, orchestrator: Any) -> None:
        """Set the orchestrator instance for task execution."""
        self._orchestrator = orchestrator

    async def start(self) -> None:
        """Start the background worker and control listener."""
        if self._running:
            return

        self._running = True

        # Start task processor
        self._task_processor = asyncio.create_task(self._run_task_processor())

        # Start control command listener
        self._control_listener = asyncio.create_task(self._run_control_listener())

        logger.info(
            "Agent task worker started",
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
                logger.info("Cancelling running task", task_id=task_id)

        # Wait for all tasks to complete (with timeout)
        if self._running_tasks:
            await asyncio.gather(
                *self._running_tasks.values(),
                return_exceptions=True,
            )
            self._running_tasks.clear()

        if self._control_listener:
            self._control_listener.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._control_listener

        if self._task_processor:
            self._task_processor.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task_processor

        logger.info(
            "Agent task worker stopped",
            worker_id=self._worker_id,
        )

    async def _run_task_processor(self) -> None:
        """Main task processing loop."""
        while self._running:
            try:
                if not self._paused:
                    await self._process_pending_tasks()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Error in agent task worker loop")

            await asyncio.sleep(self._poll_interval)

    async def _run_control_listener(self) -> None:
        """Listen for control commands via Redis pub/sub."""
        pubsub = self._redis.client.pubsub()
        await pubsub.subscribe(CONTROL_CHANNEL)

        try:
            while self._running:
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True,
                    timeout=1.0,
                )
                if message and message["type"] == "message":
                    try:
                        import json

                        data = json.loads(message["data"])
                        await self._handle_control_command(data)
                    except Exception:
                        logger.exception("Error handling control command")
        except asyncio.CancelledError:
            pass
        finally:
            await pubsub.unsubscribe(CONTROL_CHANNEL)
            await pubsub.aclose()

    async def _handle_control_command(self, data: dict[str, Any]) -> None:
        """Handle a control command from Redis pub/sub.

        Commands are broadcast to all worker instances. Each worker checks
        if it's running the target task/agent and acts accordingly.

        Args:
            data: Command data with command, agent_id, session_id, task_id
        """
        command = data.get("command")
        agent_id = data.get("agent_id")
        task_id = data.get("task_id")

        logger.debug(
            "Received control command",
            command=command,
            agent_id=agent_id,
            task_id=task_id,
            worker_id=self._worker_id,
        )

        # Check if this worker is running the target
        is_running_target = False
        if task_id and task_id in self._active_tasks:
            is_running_target = True
        elif agent_id:
            is_running_target = agent_id in self._active_tasks.values()

        if not is_running_target:
            logger.debug(
                "Ignoring control command - not running target",
                command=command,
                agent_id=agent_id,
                worker_id=self._worker_id,
            )
            return

        if command == "abort":
            logger.info(
                "Aborting agent",
                agent_id=agent_id,
                worker_id=self._worker_id,
            )
            if agent_id:
                self._abort_requested.add(agent_id)
            # The orchestrator will check this flag during execution

            if self._orchestrator:
                try:
                    await self._orchestrator.abort_agent(agent_id)
                except Exception:
                    logger.exception("Failed to abort agent", agent_id=agent_id)

        elif command == "pause":
            logger.info(
                "Pausing agent",
                agent_id=agent_id,
                worker_id=self._worker_id,
            )
            if agent_id:
                self._paused_agents.add(agent_id)

            if self._orchestrator:
                try:
                    await self._orchestrator.pause_agent(agent_id)
                except Exception:
                    logger.exception("Failed to pause agent", agent_id=agent_id)

        elif command == "resume":
            logger.info(
                "Resuming agent",
                agent_id=agent_id,
                worker_id=self._worker_id,
            )
            if agent_id:
                self._paused_agents.discard(agent_id)

            if self._orchestrator:
                try:
                    await self._orchestrator.resume_agent(agent_id)
                except Exception:
                    logger.exception("Failed to resume agent", agent_id=agent_id)

        elif command == "cancel":
            if task_id:
                logger.info(
                    "Cancelling task",
                    task_id=task_id,
                    worker_id=self._worker_id,
                )
                # Mark task as cancelled
                await self._fail_task(
                    task_id,
                    self._active_tasks.get(task_id, ""),
                    "Task cancelled by user",
                )

    async def _process_pending_tasks(self) -> None:
        """Process pending agent tasks concurrently using the worker pool.

        Uses a semaphore to limit concurrent processing to pool_size.
        Discovers sessions with pending tasks by scanning Redis keys.
        """
        # Clean up completed tasks
        completed = [tid for tid, task in self._running_tasks.items() if task.done()]
        for tid in completed:
            self._running_tasks.pop(tid, None)

        # Check if we have capacity for more tasks
        available_slots = self._pool_size - len(self._running_tasks)
        if available_slots <= 0:
            return  # Pool is full, wait for tasks to complete

        # Scan for any session with pending tasks
        sessions_to_check: set[str] = set()

        cursor = 0
        while True:
            cursor, keys = await self._redis.client.scan(
                cursor,
                match="podex:agents:*:pending",
                count=100,
            )
            for key in keys:
                # Extract session_id from key (podex:agents:{session_id}:pending)
                parts = key.split(":")
                if len(parts) >= 3:
                    session_id = parts[2]
                    sessions_to_check.add(session_id)
            if cursor == 0:
                break

        # Dequeue and spawn tasks concurrently (up to available slots)
        tasks_spawned = 0
        for session_id in sessions_to_check:
            if tasks_spawned >= available_slots:
                break  # Pool is now full

            try:
                task_data = await self._dequeue_task(session_id)
                if task_data:
                    task_id = task_data["id"]
                    # Spawn task processing in background
                    asyncio_task = asyncio.create_task(self._process_task_with_semaphore(task_data))
                    self._running_tasks[task_id] = asyncio_task
                    tasks_spawned += 1

                    logger.debug(
                        "Spawned concurrent task",
                        task_id=task_id,
                        running_count=len(self._running_tasks),
                        pool_size=self._pool_size,
                    )
            except Exception:
                logger.exception(
                    "Error dequeuing agent task",
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
        data = await self._redis.get_json(task_key)

        if data and isinstance(data, dict):
            # Update status to running
            data["status"] = "running"
            data["started_at"] = datetime.now(UTC).isoformat()
            data["assigned_worker_id"] = self._worker_id
            await self._redis.set_json(task_key, data, ex=TASK_TTL)

            # Publish task started event
            await self._publish_event("agent_task_started", data)

            return data

        return None

    async def _process_task(self, task_data: dict[str, Any]) -> None:
        """Process a single agent task using the orchestrator."""
        task_id = task_data["id"]
        session_id = task_data["session_id"]
        agent_id = task_data["agent_id"]
        message = task_data["message"]
        message_id = task_data["message_id"]
        context = task_data.get("context", {})

        # Track this task as active
        self._active_tasks[task_id] = agent_id

        logger.info(
            "Processing agent task",
            task_id=task_id,
            agent_id=agent_id,
            session_id=session_id,
            message_id=message_id,
            worker_id=self._worker_id,
        )

        try:
            if not self._orchestrator:
                raise RuntimeError("Orchestrator not set")

            # Build AgentTask for orchestrator
            from src.orchestrator import AgentTask

            agent_task = AgentTask(
                session_id=session_id,
                agent_id=agent_id,
                message=message,
                context={
                    **context,
                    "message_id": message_id,
                    "stream": True,  # Always stream for real-time delivery
                },
                task_id=task_id,
            )

            # Submit to orchestrator
            await self._orchestrator.submit_task(agent_task)

            # Process the task
            result = await self._orchestrator.process_task(task_id)

            # Complete the task
            await self._complete_task(
                task_id,
                session_id,
                {
                    "response": result.response,
                    "tool_calls": result.tool_calls,
                    "tokens_used": result.tokens_used,
                },
            )

        except Exception as e:
            logger.exception(
                "Agent task failed",
                task_id=task_id,
                error=str(e),
            )
            await self._fail_task(task_id, session_id, str(e))

        finally:
            # Remove from active tracking
            self._active_tasks.pop(task_id, None)
            self._abort_requested.discard(agent_id)

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

        # Remove from active
        await self._redis.client.srem(active_key, task_id)

        # Update task data
        data["status"] = "completed"
        data["completed_at"] = datetime.now(UTC).isoformat()
        data["response"] = result.get("response") if result else None
        data["tool_calls"] = result.get("tool_calls") if result else None
        data["tokens_used"] = result.get("tokens_used", 0) if result else 0
        await self._redis.set_json(task_key, data, ex=COMPLETED_TTL)

        # Publish completion event
        await self._publish_event("agent_task_completed", data)

        logger.info(
            "Agent task completed",
            task_id=task_id,
            worker_id=self._worker_id,
        )

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
        await self._publish_event("agent_task_failed", data)

        logger.error(
            "Agent task failed",
            task_id=task_id,
            error=error,
            worker_id=self._worker_id,
        )

    async def _publish_event(self, event_type: str, task_data: dict[str, Any]) -> None:
        """Publish task event to pub/sub channel."""
        await self._redis.publish(
            UPDATES_CHANNEL,
            {
                "event": event_type,
                "task_id": task_data["id"],
                "session_id": task_data["session_id"],
                "agent_id": task_data["agent_id"],
                "message_id": task_data.get("message_id"),
                "status": task_data.get("status", "pending"),
                "response": task_data.get("response"),
                "tool_calls": task_data.get("tool_calls"),
                "tokens_used": task_data.get("tokens_used", 0),
                "error": task_data.get("error"),
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )

    def is_agent_paused(self, agent_id: str) -> bool:
        """Check if an agent is paused."""
        return agent_id in self._paused_agents

    def is_abort_requested(self, agent_id: str) -> bool:
        """Check if abort was requested for an agent."""
        return agent_id in self._abort_requested


# Global singleton
_agent_worker: AgentTaskWorker | None = None


def get_agent_task_worker() -> AgentTaskWorker | None:
    """Get the global agent task worker instance."""
    return _agent_worker


def set_agent_task_worker(worker: AgentTaskWorker) -> None:
    """Set the global agent task worker instance."""
    global _agent_worker
    _agent_worker = worker
