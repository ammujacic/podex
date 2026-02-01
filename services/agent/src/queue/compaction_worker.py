"""Compaction task worker for processing context compaction tasks from Redis queue.

This worker polls the Redis queue for pending compaction tasks and executes
context compaction (LLM summarization of old messages) for agents.
"""

import asyncio
import contextlib
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

import structlog
from sqlalchemy import delete, select
from sqlalchemy.orm import selectinload

from src.context.summarizer import ConversationSummarizer
from src.context.tokenizer import Tokenizer
from src.database.connection import get_db_context
from src.database.models import Agent, ConversationMessage
from src.providers.llm import LLMProvider

if TYPE_CHECKING:
    from podex_shared.redis_client import RedisClient

logger = structlog.get_logger()


# Key structure (matches API service task_queue.py)
PENDING_KEY = "podex:compaction:pending"
TASK_KEY = "podex:compaction:task:{task_id}"
UPDATES_CHANNEL = "podex:compaction:updates"

TASK_TTL = 3600  # 1 hour
COMPLETED_TTL = 300  # 5 minutes


class CompactionTaskWorker:
    """Background worker that processes compaction tasks from the Redis queue.

    Supports concurrent processing with configurable pool size.
    """

    def __init__(
        self,
        redis_client: "RedisClient",
        poll_interval: float = 1.0,
        pool_size: int = 2,
    ) -> None:
        """Initialize compaction task worker.

        Args:
            redis_client: Redis client for queue operations
            poll_interval: Seconds between queue polls
            pool_size: Maximum concurrent compaction tasks (default: 2)
        """
        self._redis = redis_client
        self._poll_interval = poll_interval
        self._pool_size = pool_size
        self._running = False
        self._worker_id = f"compaction-{uuid.uuid4().hex[:8]}"
        self._task: asyncio.Task[None] | None = None

        # Semaphore for limiting concurrent task processing
        self._semaphore = asyncio.Semaphore(pool_size)
        # Track running tasks
        self._running_tasks: dict[str, asyncio.Task[None]] = {}

    async def start(self) -> None:
        """Start the background worker."""
        if self._running:
            return

        self._running = True
        self._task = asyncio.create_task(self._run())
        logger.info(
            "Compaction task worker started",
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
                logger.info("Cancelling compaction task", task_id=task_id)

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
        logger.info("Compaction task worker stopped", worker_id=self._worker_id)

    async def _run(self) -> None:
        """Main worker loop."""
        while self._running:
            try:
                await self._process_pending_tasks()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Error in compaction task worker loop")

            await asyncio.sleep(self._poll_interval)

    async def _process_pending_tasks(self) -> None:
        """Process pending compaction tasks concurrently."""
        # Clean up completed tasks
        completed = [tid for tid, task in self._running_tasks.items() if task.done()]
        for tid in completed:
            self._running_tasks.pop(tid, None)

        # Check available capacity
        available_slots = self._pool_size - len(self._running_tasks)
        if available_slots <= 0:
            return

        # Dequeue and spawn tasks up to available slots
        for _ in range(available_slots):
            task_data = await self._dequeue_task()
            if task_data:
                task_id = task_data["id"]
                asyncio_task = asyncio.create_task(self._process_task_with_semaphore(task_data))
                self._running_tasks[task_id] = asyncio_task
            else:
                break  # No more pending tasks

    async def _process_task_with_semaphore(self, task_data: dict[str, Any]) -> None:
        """Process a task with semaphore-based concurrency control."""
        async with self._semaphore:
            await self._process_task(task_data)

    async def _dequeue_task(self) -> dict[str, Any] | None:
        """Dequeue the next pending compaction task."""
        # Get pending task IDs (FIFO order)
        task_ids = await self._redis.client.zrange(PENDING_KEY, 0, 0)
        if not task_ids:
            return None

        task_id = task_ids[0]

        # Try to claim the task atomically
        removed = await self._redis.client.zrem(PENDING_KEY, task_id)
        if removed == 0:
            return None  # Already claimed by another worker

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
            await self._publish_event("compaction_task_started", data)

            return data

        return None

    async def _process_task(self, task_data: dict[str, Any]) -> None:
        """Process a single compaction task."""
        task_id = task_data["id"]
        agent_id = task_data["agent_id"]
        session_id = task_data["session_id"]
        custom_instructions = task_data.get("custom_instructions")
        preserve_recent_messages = task_data.get("preserve_recent_messages", 15)

        logger.info(
            "Processing compaction task",
            task_id=task_id,
            agent_id=agent_id,
            worker_id=self._worker_id,
        )

        try:
            result = await self._execute_compaction(
                agent_id=agent_id,
                custom_instructions=custom_instructions,
                preserve_recent_messages=preserve_recent_messages,
            )

            await self._complete_task(task_id, session_id, result)

        except Exception as e:
            logger.exception(
                "Compaction task failed",
                task_id=task_id,
                error=str(e),
            )
            await self._fail_task(task_id, session_id, str(e))

    async def _execute_compaction(
        self,
        agent_id: str,
        custom_instructions: str | None,
        preserve_recent_messages: int,
    ) -> dict[str, Any]:
        """Execute context compaction for an agent.

        Returns:
            Dict with compaction results (tokens_before, tokens_after, etc.)
        """
        async with get_db_context() as db:
            # Load agent with conversation session
            result = await db.execute(
                select(Agent)
                .options(selectinload(Agent.attached_conversation))
                .where(Agent.id == agent_id)
            )
            agent = result.scalar_one_or_none()

            if not agent:
                raise ValueError(f"Agent {agent_id} not found")

            # Check if agent has a conversation session
            if not agent.attached_conversation:
                return {
                    "tokens_before": 0,
                    "tokens_after": 0,
                    "messages_removed": 0,
                    "messages_preserved": 0,
                    "summary": None,
                }

            # Load all messages for this agent's conversation session
            messages_result = await db.execute(
                select(ConversationMessage)
                .where(
                    ConversationMessage.conversation_session_id == agent.attached_conversation.id
                )
                .order_by(ConversationMessage.created_at.asc())
            )
            messages = list(messages_result.scalars().all())

            if not messages:
                return {
                    "tokens_before": 0,
                    "tokens_after": 0,
                    "messages_removed": 0,
                    "messages_preserved": 0,
                    "summary": None,
                }

            # Calculate tokens before compaction
            tokenizer = Tokenizer(agent.model)
            messages_as_dicts = [
                {"role": msg.role, "content": msg.content, "id": msg.id} for msg in messages
            ]
            tokens_before = tokenizer.count_messages(messages_as_dicts)

            # Determine how many messages to preserve
            if len(messages) <= preserve_recent_messages:
                # Nothing to compact
                return {
                    "tokens_before": tokens_before,
                    "tokens_after": tokens_before,
                    "messages_removed": 0,
                    "messages_preserved": len(messages),
                    "summary": None,
                }

            # Split messages into those to summarize and those to keep
            messages_to_summarize = messages[:-preserve_recent_messages]
            messages_to_keep = messages[-preserve_recent_messages:]

            # Create summary of old messages
            summary_text = None
            if messages_to_summarize:
                llm_provider = LLMProvider()
                summarizer = ConversationSummarizer(llm_provider, agent.model)

                messages_to_summarize_dicts = [
                    {"role": msg.role, "content": msg.content} for msg in messages_to_summarize
                ]

                if custom_instructions:
                    logger.info(
                        "Using custom compaction instructions",
                        agent_id=agent_id,
                        instructions=custom_instructions[:100],
                    )

                summary = await summarizer.create_summary(
                    agent_id=agent_id,
                    messages=messages_to_summarize_dicts,
                )
                summary_text = summary.summary

                # Delete old messages from database
                message_ids_to_delete = [msg.id for msg in messages_to_summarize]
                await db.execute(
                    delete(ConversationMessage).where(
                        ConversationMessage.id.in_(message_ids_to_delete)
                    )
                )

                # Insert summary as a system message at the beginning
                summary_message = ConversationMessage(
                    conversation_session_id=agent.attached_conversation.id,
                    role="system",
                    content=f"[Previous conversation summary]\n{summary_text}",
                )
                db.add(summary_message)

                await db.commit()

                logger.info(
                    "Compaction completed",
                    agent_id=agent_id,
                    messages_removed=len(messages_to_summarize),
                    messages_preserved=len(messages_to_keep) + 1,
                )

            # Calculate tokens after compaction
            preserved_messages_dicts = [
                {"role": msg.role, "content": msg.content} for msg in messages_to_keep
            ]
            if summary_text:
                preserved_messages_dicts.insert(
                    0,
                    {
                        "role": "system",
                        "content": f"[Previous conversation summary]\n{summary_text}",
                    },
                )
            tokens_after = tokenizer.count_messages(preserved_messages_dicts)

            return {
                "tokens_before": tokens_before,
                "tokens_after": tokens_after,
                "messages_removed": len(messages_to_summarize),
                "messages_preserved": len(messages_to_keep) + (1 if summary_text else 0),
                "summary": summary_text,
            }

    async def _complete_task(
        self,
        task_id: str,
        _session_id: str,
        result: dict[str, Any],
    ) -> None:
        """Mark a task as completed."""
        task_key = TASK_KEY.format(task_id=task_id)
        raw_data = await self._redis.get_json(task_key)

        if not raw_data or not isinstance(raw_data, dict):
            return

        data: dict[str, Any] = raw_data

        # Update task data with results
        data["status"] = "completed"
        data["completed_at"] = datetime.now(UTC).isoformat()
        data["tokens_before"] = result.get("tokens_before", 0)
        data["tokens_after"] = result.get("tokens_after", 0)
        data["messages_removed"] = result.get("messages_removed", 0)
        data["messages_preserved"] = result.get("messages_preserved", 0)
        data["summary"] = result.get("summary")
        await self._redis.set_json(task_key, data, ex=COMPLETED_TTL)

        # Publish completion event
        await self._publish_event("compaction_task_completed", data)

        logger.info(
            "Compaction task completed",
            task_id=task_id,
            tokens_before=result.get("tokens_before"),
            tokens_after=result.get("tokens_after"),
        )

    async def _fail_task(
        self,
        task_id: str,
        _session_id: str,
        error: str,
    ) -> None:
        """Mark a task as failed."""
        task_key = TASK_KEY.format(task_id=task_id)
        raw_data = await self._redis.get_json(task_key)

        if not raw_data or not isinstance(raw_data, dict):
            return

        data: dict[str, Any] = raw_data

        data["status"] = "failed"
        data["completed_at"] = datetime.now(UTC).isoformat()
        data["error"] = error
        await self._redis.set_json(task_key, data, ex=COMPLETED_TTL)

        # Publish failure event
        await self._publish_event("compaction_task_failed", data)

        logger.error(
            "Compaction task failed",
            task_id=task_id,
            error=error,
        )

    async def _publish_event(self, event_type: str, task_data: dict[str, Any]) -> None:
        """Publish task event to pub/sub channel."""
        await self._redis.publish(
            UPDATES_CHANNEL,
            {
                "event": event_type,
                "task_id": task_data["id"],
                "agent_id": task_data["agent_id"],
                "session_id": task_data["session_id"],
                "status": task_data.get("status", "pending"),
                "tokens_before": task_data.get("tokens_before", 0),
                "tokens_after": task_data.get("tokens_after", 0),
                "messages_removed": task_data.get("messages_removed", 0),
                "messages_preserved": task_data.get("messages_preserved", 0),
                "summary": task_data.get("summary"),
                "error": task_data.get("error"),
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )


# Global singleton
_compaction_worker: CompactionTaskWorker | None = None


def get_compaction_task_worker() -> CompactionTaskWorker | None:
    """Get the global compaction task worker instance."""
    return _compaction_worker


def set_compaction_task_worker(worker: CompactionTaskWorker) -> None:
    """Set the global compaction task worker instance."""
    global _compaction_worker
    _compaction_worker = worker
