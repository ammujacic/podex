"""Token stream publisher for real-time LLM response delivery via Redis Pub/Sub."""

import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any

import structlog

from podex_shared import RedisClient, get_redis_client
from src.config import settings
from src.providers.llm import StreamEvent

logger = structlog.get_logger()


@dataclass
class StreamMessage:
    """Message published to Redis for stream events."""

    session_id: str
    agent_id: str
    message_id: str
    event_type: (
        str  # "start", "token", "thinking", "tool_call_start", "tool_call_end", "done", "error"
    )
    content: str | None = None
    tool_call_id: str | None = None
    tool_name: str | None = None
    tool_input: dict[str, Any] | None = None
    tool_calls: list[dict[str, Any]] | None = None  # For done event - complete tool calls
    usage: dict[str, int] | None = None
    stop_reason: str | None = None
    error: str | None = None
    timestamp: str | None = None

    def to_json(self) -> str:
        """Serialize to JSON string."""
        data = asdict(self)
        if data["timestamp"] is None:
            data["timestamp"] = datetime.now(UTC).isoformat()
        # Remove None values for cleaner payloads
        return json.dumps({k: v for k, v in data.items() if v is not None})


class StreamPublisher:
    """Publishes streaming tokens to Redis Pub/Sub channels.

    Channel format: agent_stream:{session_id}:{agent_id}

    This allows the API service to subscribe to specific session/agent
    combinations and forward tokens to the appropriate WebSocket clients.
    """

    def __init__(self, redis_client: RedisClient) -> None:
        """Initialize publisher with Redis client."""
        self._redis = redis_client
        self._connected = False

    async def connect(self) -> None:
        """Ensure Redis connection is established."""
        if not self._connected:
            await self._redis.connect()
            self._connected = True
            logger.info("Stream publisher connected to Redis")

    def _channel(self, session_id: str, agent_id: str) -> str:
        """Get the Redis channel name for a session/agent."""
        return f"agent_stream:{session_id}:{agent_id}"

    async def _publish(self, message: StreamMessage) -> None:
        """Publish a message to Redis."""
        channel = self._channel(message.session_id, message.agent_id)
        await self._redis.publish(channel, message.to_json())

    async def publish_start(
        self,
        session_id: str,
        agent_id: str,
        message_id: str,
    ) -> None:
        """Publish stream start event."""
        await self._publish(
            StreamMessage(
                session_id=session_id,
                agent_id=agent_id,
                message_id=message_id,
                event_type="start",
            )
        )
        logger.debug(
            "Published stream start",
            session_id=session_id,
            agent_id=agent_id,
            message_id=message_id,
        )

    async def publish_token(
        self,
        session_id: str,
        agent_id: str,
        message_id: str,
        token: str,
    ) -> None:
        """Publish a single token."""
        await self._publish(
            StreamMessage(
                session_id=session_id,
                agent_id=agent_id,
                message_id=message_id,
                event_type="token",
                content=token,
            )
        )

    async def publish_thinking_token(
        self,
        session_id: str,
        agent_id: str,
        message_id: str,
        thinking: str,
    ) -> None:
        """Publish a thinking token (for extended thinking/reasoning)."""
        await self._publish(
            StreamMessage(
                session_id=session_id,
                agent_id=agent_id,
                message_id=message_id,
                event_type="thinking",
                content=thinking,
            )
        )

    async def publish_tool_call_start(
        self,
        session_id: str,
        agent_id: str,
        message_id: str,
        tool_call_id: str,
        tool_name: str,
    ) -> None:
        """Publish tool call start event."""
        await self._publish(
            StreamMessage(
                session_id=session_id,
                agent_id=agent_id,
                message_id=message_id,
                event_type="tool_call_start",
                tool_call_id=tool_call_id,
                tool_name=tool_name,
            )
        )
        logger.debug(
            "Published tool call start",
            session_id=session_id,
            tool_call_id=tool_call_id,
            tool_name=tool_name,
        )

    async def publish_tool_call_end(
        self,
        session_id: str,
        agent_id: str,
        message_id: str,
        tool_call_id: str,
        tool_name: str,
        tool_input: dict[str, Any] | None = None,
    ) -> None:
        """Publish tool call end event."""
        await self._publish(
            StreamMessage(
                session_id=session_id,
                agent_id=agent_id,
                message_id=message_id,
                event_type="tool_call_end",
                tool_call_id=tool_call_id,
                tool_name=tool_name,
                tool_input=tool_input,
            )
        )
        logger.debug(
            "Published tool call end",
            session_id=session_id,
            tool_call_id=tool_call_id,
            tool_name=tool_name,
        )

    async def publish_done(
        self,
        session_id: str,
        agent_id: str,
        message_id: str,
        full_content: str,
        usage: dict[str, int] | None = None,
        stop_reason: str | None = None,
        tool_calls: list[dict[str, Any]] | None = None,
    ) -> None:
        """Publish stream completion event."""
        await self._publish(
            StreamMessage(
                session_id=session_id,
                agent_id=agent_id,
                message_id=message_id,
                event_type="done",
                content=full_content,
                usage=usage,
                stop_reason=stop_reason,
                tool_calls=tool_calls,
            )
        )
        logger.debug(
            "Published stream done",
            session_id=session_id,
            agent_id=agent_id,
            message_id=message_id,
            content_length=len(full_content),
            tool_calls_count=len(tool_calls) if tool_calls else 0,
        )

    async def publish_error(
        self,
        session_id: str,
        agent_id: str,
        message_id: str,
        error: str,
    ) -> None:
        """Publish stream error event."""
        await self._publish(
            StreamMessage(
                session_id=session_id,
                agent_id=agent_id,
                message_id=message_id,
                event_type="error",
                error=error,
            )
        )
        logger.warning(
            "Published stream error",
            session_id=session_id,
            agent_id=agent_id,
            error=error,
        )

    async def publish_stream_event(
        self,
        session_id: str,
        agent_id: str,
        message_id: str,
        event: StreamEvent,
    ) -> None:
        """Publish a StreamEvent from the LLM provider.

        This is a convenience method that maps StreamEvent types
        to the appropriate publish_* methods.
        """
        if event.type == "token":
            await self.publish_token(
                session_id=session_id,
                agent_id=agent_id,
                message_id=message_id,
                token=event.content or "",
            )
        elif event.type == "thinking":
            await self.publish_thinking_token(
                session_id=session_id,
                agent_id=agent_id,
                message_id=message_id,
                thinking=event.content or "",
            )
        elif event.type == "tool_call_start":
            await self.publish_tool_call_start(
                session_id=session_id,
                agent_id=agent_id,
                message_id=message_id,
                tool_call_id=event.tool_call_id or "",
                tool_name=event.tool_name or "",
            )
        elif event.type == "tool_call_end":
            await self.publish_tool_call_end(
                session_id=session_id,
                agent_id=agent_id,
                message_id=message_id,
                tool_call_id=event.tool_call_id or "",
                tool_name=event.tool_name or "",
                tool_input=event.tool_input,
            )
        elif event.type == "error":
            await self.publish_error(
                session_id=session_id,
                agent_id=agent_id,
                message_id=message_id,
                error=event.error or "Unknown error",
            )
        # Note: "done" events are handled separately since they need full_content


# Singleton instance
_publisher: StreamPublisher | None = None


def get_stream_publisher() -> StreamPublisher:
    """Get or create the singleton StreamPublisher instance."""
    global _publisher
    if _publisher is None:
        redis_client = get_redis_client(settings.REDIS_URL)
        _publisher = StreamPublisher(redis_client)
    return _publisher
