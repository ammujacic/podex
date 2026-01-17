"""Token stream subscriber for receiving LLM tokens from Redis Pub/Sub."""

import asyncio
import contextlib
import json
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


class StreamSubscriber:
    """Subscribes to agent token streams via Redis Pub/Sub.

    Receives streaming events from the agent service and forwards them
    to WebSocket clients via the existing emit functions.

    Channel pattern: agent_stream:{session_id}:*
    """

    def __init__(self) -> None:
        """Initialize subscriber."""
        self._redis: redis.Redis[Any] | None = None
        self._pubsub: redis.client.PubSub | None = None
        self._listen_task: asyncio.Task[None] | None = None
        self._running = False
        self._subscribed_sessions: set[str] = set()
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
        logger.info("Stream subscriber disconnected from Redis")

    async def subscribe_session(self, session_id: str) -> None:
        """Subscribe to streaming events for a session.

        Args:
            session_id: The session to subscribe to.
        """
        async with self._lock:
            if session_id in self._subscribed_sessions:
                return

            await self.connect()

            # Create pubsub if it doesn't exist
            if self._pubsub is None and self._redis is not None:
                self._pubsub = self._redis.pubsub()

            # Subscribe to pattern for all agents in this session
            # Redis pubsub supports subscribing while listening, no need to stop/restart
            pattern = f"agent_stream:{session_id}:*"
            if self._pubsub is not None:
                await self._pubsub.psubscribe(pattern)
            self._subscribed_sessions.add(session_id)

            logger.info("Subscribed to session stream", session_id=session_id, pattern=pattern)

            # Start listener if not already running
            if not self._running:
                self._start_listener()

    async def unsubscribe_session(self, session_id: str) -> None:
        """Unsubscribe from streaming events for a session.

        Args:
            session_id: The session to unsubscribe from.
        """
        async with self._lock:
            if session_id not in self._subscribed_sessions:
                return

            # Unsubscribe from pattern
            # Redis pubsub supports unsubscribing while listening
            if self._pubsub:
                pattern = f"agent_stream:{session_id}:*"
                await self._pubsub.punsubscribe(pattern)

            self._subscribed_sessions.discard(session_id)
            logger.info("Unsubscribed from session stream", session_id=session_id)

            # Stop listener if no more subscriptions
            if not self._subscribed_sessions:
                await self._stop_listener()

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
