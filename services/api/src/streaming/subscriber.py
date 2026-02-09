"""Token stream subscriber for receiving LLM tokens from Redis Pub/Sub.

Multi-Worker Architecture Notes:
- Each Gunicorn worker has its own StreamSubscriber instance (per-process singleton)
- Multiple workers can subscribe to the same session - that's OK, Redis pub/sub broadcasts to all
- Socket.IO Redis adapter handles deduplication when multiple workers emit the same event
- Subscription count tracked in Redis to avoid premature unsubscribe across workers
"""

import asyncio
import contextlib
import json
import os
from typing import Any

import redis.asyncio as redis
import structlog

from src.config import settings
from src.websocket.hub import (
    emit_agent_stream_end,
    emit_agent_stream_start,
    emit_agent_thinking_token,
    emit_agent_token,
    emit_tool_call_end,
    emit_tool_call_start,
)

logger = structlog.get_logger()

# Redis key for tracking subscription count across workers
SUBSCRIPTION_COUNT_KEY = "podex:streaming:subscription_count:{session_id}"
SUBSCRIPTION_TTL = 3600  # 1 hour TTL for cleanup


class StreamSubscriber:
    """Subscribes to agent token streams via Redis Pub/Sub.

    Receives streaming events from the agent service and forwards them
    to WebSocket clients via the existing emit functions.

    Channel pattern: agent_stream:{session_id}:*

    Multi-worker tracking:
    - _subscribed_sessions: set of sessions this worker has pub/sub subscriptions for
    - _local_session_counts: dict of session_id -> count of LOCAL clients on this worker
    - Redis SUBSCRIPTION_COUNT_KEY: GLOBAL count across all workers
    """

    def __init__(self) -> None:
        """Initialize subscriber."""
        # Use Any type since this class creates its own Redis client with decode_responses=True
        self._redis: redis.Redis[Any] | None = None
        self._pubsub: redis.client.PubSub | None = None
        self._listen_task: asyncio.Task[None] | None = None
        self._running = False
        # Sessions this worker has active pub/sub subscriptions for
        self._subscribed_sessions: set[str] = set()
        # Local client count per session (on THIS worker only)
        self._local_session_counts: dict[str, int] = {}
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        """Connect to Redis."""
        if self._redis is not None:
            return

        self._redis = redis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
        )
        logger.info("Stream subscriber connected to Redis")

    async def disconnect(self) -> None:
        """Disconnect from Redis and stop listening."""
        await self._stop_listener()

        if self._pubsub:
            await self._pubsub.close()
            self._pubsub = None

        if self._redis:
            await self._redis.close()
            self._redis = None

        self._subscribed_sessions.clear()
        self._local_session_counts.clear()
        logger.info("Stream subscriber disconnected from Redis")

    async def subscribe_session(self, session_id: str) -> None:
        """Subscribe to streaming events for a session.

        Multi-worker safe: tracks both local count (per worker) and global count (Redis).

        Args:
            session_id: The session to subscribe to.
        """
        async with self._lock:
            # Always increment local count
            self._local_session_counts[session_id] = (
                self._local_session_counts.get(session_id, 0) + 1
            )
            local_count = self._local_session_counts[session_id]

            # Always increment global Redis count
            await self.connect()
            global_count = 0
            if self._redis:
                key = SUBSCRIPTION_COUNT_KEY.format(session_id=session_id)
                global_count = await self._redis.incr(key)
                await self._redis.expire(key, SUBSCRIPTION_TTL)

            # Only subscribe to pub/sub if this is the first client on THIS worker
            if session_id not in self._subscribed_sessions:
                # Create pubsub if it doesn't exist
                if self._pubsub is None and self._redis is not None:
                    self._pubsub = self._redis.pubsub()

                # Subscribe to pattern for all agents in this session
                pattern = f"agent_stream:{session_id}:*"
                if self._pubsub is not None:
                    await self._pubsub.psubscribe(pattern)
                self._subscribed_sessions.add(session_id)

                logger.info(
                    "Subscribed to session stream (new pub/sub)",
                    session_id=session_id,
                    pattern=pattern,
                    local_count=local_count,
                    global_count=global_count,
                    worker_pid=os.getpid(),
                )

                # Start listener if not already running
                if not self._running:
                    self._start_listener()
            else:
                logger.debug(
                    "Session already subscribed on this worker, incremented counts",
                    session_id=session_id,
                    local_count=local_count,
                    global_count=global_count,
                    worker_pid=os.getpid(),
                )

    async def unsubscribe_session(self, session_id: str) -> None:
        """Unsubscribe from streaming events for a session.

        Multi-worker safe:
        - Decrements local count (per worker)
        - Decrements global count (Redis)
        - Only unsubscribes from pub/sub when local count reaches 0
        - Redis count cleanup happens independently via TTL

        Args:
            session_id: The session to unsubscribe from.
        """
        async with self._lock:
            # Decrement local count
            local_count = self._local_session_counts.get(session_id, 0)
            if local_count <= 0:
                # No local clients for this session, nothing to do
                return

            local_count -= 1
            self._local_session_counts[session_id] = local_count

            # Decrement global Redis count
            global_remaining = 0
            if self._redis:
                key = SUBSCRIPTION_COUNT_KEY.format(session_id=session_id)
                global_remaining = await self._redis.decr(key)
                if global_remaining <= 0:
                    await self._redis.delete(key)

            # Only unsubscribe from pub/sub if NO more local clients on this worker
            if local_count <= 0:
                del self._local_session_counts[session_id]

                if self._pubsub and session_id in self._subscribed_sessions:
                    pattern = f"agent_stream:{session_id}:*"
                    await self._pubsub.punsubscribe(pattern)
                    self._subscribed_sessions.discard(session_id)

                logger.info(
                    "Unsubscribed from session stream (last local client)",
                    session_id=session_id,
                    global_remaining=global_remaining,
                    worker_pid=os.getpid(),
                )

                # Stop listener if no more subscriptions on this worker
                if not self._subscribed_sessions:
                    await self._stop_listener()
            else:
                logger.debug(
                    "Decremented local count (other local clients remain)",
                    session_id=session_id,
                    local_count=local_count,
                    global_remaining=global_remaining,
                    worker_pid=os.getpid(),
                )

    async def _stop_listener(self) -> None:
        """Stop the listener task if running."""
        if self._listen_task and not self._listen_task.done():
            self._running = False
            self._listen_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._listen_task
            self._listen_task = None

    def _start_listener(self) -> None:
        """Start the listener task if not already running."""
        if not self._running and self._subscribed_sessions:
            self._running = True
            self._listen_task = asyncio.create_task(self._listen())

    async def _listen(self) -> None:
        """Listen for Redis messages and forward to WebSocket."""
        if not self._pubsub:
            return

        try:
            async for message in self._pubsub.listen():
                if not self._running:
                    break

                if message["type"] != "pmessage":
                    continue

                try:
                    data = json.loads(message["data"])
                    await self._handle_message(data)
                except json.JSONDecodeError:
                    logger.warning(
                        "Invalid JSON in stream message",
                        channel=message.get("channel"),
                    )
                except Exception:
                    logger.exception(
                        "Error handling stream message",
                        channel=message.get("channel"),
                    )

        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("Stream listener error")

    async def _handle_message(self, data: dict[str, Any]) -> None:
        """Handle a stream message from Redis.

        Args:
            data: The parsed message data.
        """
        event_type = data.get("event_type")
        session_id = data.get("session_id", "")
        agent_id = data.get("agent_id", "")
        message_id = data.get("message_id", "")

        logger.info(
            "Stream subscriber received Redis message",
            event_type=event_type,
            session_id=session_id[-8:] if session_id else "None",
            agent_id=agent_id[-8:] if agent_id else "None",
            message_id=message_id[-8:] if message_id else "None",
        )

        if event_type == "start":
            await emit_agent_stream_start(
                session_id=session_id,
                agent_id=agent_id,
                message_id=message_id,
            )

        elif event_type == "token":
            await emit_agent_token(
                session_id=session_id,
                agent_id=agent_id,
                token=data.get("content", ""),
                message_id=message_id,
            )

        elif event_type == "thinking":
            await emit_agent_thinking_token(
                session_id=session_id,
                agent_id=agent_id,
                thinking=data.get("content", ""),
                message_id=message_id,
            )

        elif event_type == "tool_call_start":
            await emit_tool_call_start(
                session_id=session_id,
                agent_id=agent_id,
                tool_call_id=data.get("tool_call_id", ""),
                tool_name=data.get("tool_name", ""),
            )

        elif event_type == "tool_call_end":
            await emit_tool_call_end(
                session_id=session_id,
                agent_id=agent_id,
                tool_call_id=data.get("tool_call_id", ""),
                tool_name=data.get("tool_name", ""),
                result=data.get("tool_input"),  # Tool input is what was requested
            )

        elif event_type == "done":
            await emit_agent_stream_end(
                session_id=session_id,
                agent_id=agent_id,
                message_id=message_id,
                full_content=data.get("content"),
                tool_calls=data.get("tool_calls"),
            )

        elif event_type == "error":
            # Emit stream end with error info
            await emit_agent_stream_end(
                session_id=session_id,
                agent_id=agent_id,
                message_id=message_id,
                full_content=f"Error: {data.get('error', 'Unknown error')}",
            )


# Singleton instance
_subscriber: StreamSubscriber | None = None


def get_stream_subscriber() -> StreamSubscriber:
    """Get or create the singleton StreamSubscriber instance."""
    global _subscriber
    if _subscriber is None:
        _subscriber = StreamSubscriber()
    return _subscriber
