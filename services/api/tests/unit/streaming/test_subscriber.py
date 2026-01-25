"""
Unit tests for streaming subscriber.

Tests Redis pub/sub token streaming functionality.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.streaming.subscriber import StreamSubscriber, get_stream_subscriber


@pytest.mark.unit
class TestStreamSubscriber:
    """Tests for StreamSubscriber class."""

    def test_init(self):
        """Test subscriber initialization."""
        subscriber = StreamSubscriber()
        assert subscriber._redis is None
        assert subscriber._pubsub is None
        assert subscriber._listen_task is None
        assert subscriber._running is False
        assert subscriber._subscribed_sessions == set()

    @pytest.mark.asyncio
    async def test_connect(self):
        """Test connecting to Redis."""
        subscriber = StreamSubscriber()

        with patch("src.streaming.subscriber.redis") as mock_redis:
            mock_client = AsyncMock()
            mock_redis.from_url.return_value = mock_client

            await subscriber.connect()

            mock_redis.from_url.assert_called_once()
            assert subscriber._redis is mock_client

    @pytest.mark.asyncio
    async def test_connect_already_connected(self):
        """Test connect when already connected does nothing."""
        subscriber = StreamSubscriber()
        mock_redis = AsyncMock()
        subscriber._redis = mock_redis

        with patch("src.streaming.subscriber.redis") as redis_module:
            await subscriber.connect()
            # Should not call from_url since already connected
            redis_module.from_url.assert_not_called()

    @pytest.mark.asyncio
    async def test_disconnect(self):
        """Test disconnecting from Redis."""
        subscriber = StreamSubscriber()
        mock_redis = AsyncMock()
        mock_pubsub = AsyncMock()
        subscriber._redis = mock_redis
        subscriber._pubsub = mock_pubsub
        subscriber._subscribed_sessions = {"session-1", "session-2"}

        await subscriber.disconnect()

        # Assert on captured mocks (subscriber._pubsub is None after disconnect)
        mock_pubsub.close.assert_called_once()
        mock_redis.close.assert_called_once()
        assert subscriber._redis is None
        assert subscriber._pubsub is None
        assert len(subscriber._subscribed_sessions) == 0

    @pytest.mark.asyncio
    async def test_subscribe_session(self):
        """Test subscribing to a session stream."""
        subscriber = StreamSubscriber()

        with patch.object(subscriber, "connect", new_callable=AsyncMock) as mock_connect:
            mock_pubsub = AsyncMock()
            subscriber._redis = AsyncMock()
            subscriber._pubsub = mock_pubsub

            await subscriber.subscribe_session("test-session-123")

            mock_connect.assert_called_once()
            mock_pubsub.psubscribe.assert_called_once_with("agent_stream:test-session-123:*")
            assert "test-session-123" in subscriber._subscribed_sessions

    @pytest.mark.asyncio
    async def test_subscribe_session_already_subscribed(self):
        """Test subscribing to already subscribed session does nothing."""
        subscriber = StreamSubscriber()
        subscriber._subscribed_sessions = {"test-session-123"}

        with patch.object(subscriber, "connect", new_callable=AsyncMock) as mock_connect:
            await subscriber.subscribe_session("test-session-123")
            # Should not call connect since already subscribed
            mock_connect.assert_not_called()

    @pytest.mark.asyncio
    async def test_unsubscribe_session(self):
        """Test unsubscribing from a session stream."""
        subscriber = StreamSubscriber()
        subscriber._subscribed_sessions = {"test-session-123"}
        subscriber._pubsub = AsyncMock()

        await subscriber.unsubscribe_session("test-session-123")

        subscriber._pubsub.punsubscribe.assert_called_once_with("agent_stream:test-session-123:*")
        assert "test-session-123" not in subscriber._subscribed_sessions

    @pytest.mark.asyncio
    async def test_unsubscribe_session_not_subscribed(self):
        """Test unsubscribing from non-subscribed session does nothing."""
        subscriber = StreamSubscriber()
        subscriber._subscribed_sessions = set()
        subscriber._pubsub = AsyncMock()

        await subscriber.unsubscribe_session("test-session-123")

        subscriber._pubsub.punsubscribe.assert_not_called()

    @pytest.mark.asyncio
    async def test_handle_message_start_event(self):
        """Test handling stream start event."""
        subscriber = StreamSubscriber()

        with patch(
            "src.streaming.subscriber.emit_agent_stream_start", new_callable=AsyncMock
        ) as mock_emit:
            data = {
                "event_type": "start",
                "session_id": "session-123",
                "agent_id": "agent-456",
                "message_id": "msg-789",
            }
            await subscriber._handle_message(data)

            mock_emit.assert_called_once_with(
                session_id="session-123",
                agent_id="agent-456",
                message_id="msg-789",
            )

    @pytest.mark.asyncio
    async def test_handle_message_token_event(self):
        """Test handling token event."""
        subscriber = StreamSubscriber()

        with patch(
            "src.streaming.subscriber.emit_agent_token", new_callable=AsyncMock
        ) as mock_emit:
            data = {
                "event_type": "token",
                "session_id": "session-123",
                "agent_id": "agent-456",
                "message_id": "msg-789",
                "content": "Hello ",
            }
            await subscriber._handle_message(data)

            mock_emit.assert_called_once_with(
                session_id="session-123",
                agent_id="agent-456",
                token="Hello ",
                message_id="msg-789",
            )

    @pytest.mark.asyncio
    async def test_handle_message_thinking_event(self):
        """Test handling thinking event."""
        subscriber = StreamSubscriber()

        with patch(
            "src.streaming.subscriber.emit_agent_thinking_token", new_callable=AsyncMock
        ) as mock_emit:
            data = {
                "event_type": "thinking",
                "session_id": "session-123",
                "agent_id": "agent-456",
                "message_id": "msg-789",
                "content": "I'm thinking about...",
            }
            await subscriber._handle_message(data)

            mock_emit.assert_called_once_with(
                session_id="session-123",
                agent_id="agent-456",
                thinking="I'm thinking about...",
                message_id="msg-789",
            )

    @pytest.mark.asyncio
    async def test_handle_message_tool_call_start_event(self):
        """Test handling tool call start event."""
        subscriber = StreamSubscriber()

        with patch(
            "src.streaming.subscriber.emit_tool_call_start", new_callable=AsyncMock
        ) as mock_emit:
            data = {
                "event_type": "tool_call_start",
                "session_id": "session-123",
                "agent_id": "agent-456",
                "tool_call_id": "tc-001",
                "tool_name": "read_file",
            }
            await subscriber._handle_message(data)

            mock_emit.assert_called_once_with(
                session_id="session-123",
                agent_id="agent-456",
                tool_call_id="tc-001",
                tool_name="read_file",
            )

    @pytest.mark.asyncio
    async def test_handle_message_tool_call_end_event(self):
        """Test handling tool call end event."""
        subscriber = StreamSubscriber()

        with patch(
            "src.streaming.subscriber.emit_tool_call_end", new_callable=AsyncMock
        ) as mock_emit:
            data = {
                "event_type": "tool_call_end",
                "session_id": "session-123",
                "agent_id": "agent-456",
                "tool_call_id": "tc-001",
                "tool_name": "read_file",
                "tool_input": {"path": "/test.txt"},
            }
            await subscriber._handle_message(data)

            mock_emit.assert_called_once_with(
                session_id="session-123",
                agent_id="agent-456",
                tool_call_id="tc-001",
                tool_name="read_file",
                result={"path": "/test.txt"},
            )

    @pytest.mark.asyncio
    async def test_handle_message_done_event(self):
        """Test handling stream done event."""
        subscriber = StreamSubscriber()

        with patch(
            "src.streaming.subscriber.emit_agent_stream_end", new_callable=AsyncMock
        ) as mock_emit:
            data = {
                "event_type": "done",
                "session_id": "session-123",
                "agent_id": "agent-456",
                "message_id": "msg-789",
                "content": "Full response content",
                "tool_calls": [{"id": "tc-001", "name": "read_file"}],
            }
            await subscriber._handle_message(data)

            mock_emit.assert_called_once_with(
                session_id="session-123",
                agent_id="agent-456",
                message_id="msg-789",
                full_content="Full response content",
                tool_calls=[{"id": "tc-001", "name": "read_file"}],
            )

    @pytest.mark.asyncio
    async def test_handle_message_error_event(self):
        """Test handling stream error event."""
        subscriber = StreamSubscriber()

        with patch(
            "src.streaming.subscriber.emit_agent_stream_end", new_callable=AsyncMock
        ) as mock_emit:
            data = {
                "event_type": "error",
                "session_id": "session-123",
                "agent_id": "agent-456",
                "message_id": "msg-789",
                "error": "Connection timeout",
            }
            await subscriber._handle_message(data)

            mock_emit.assert_called_once_with(
                session_id="session-123",
                agent_id="agent-456",
                message_id="msg-789",
                full_content="Error: Connection timeout",
            )

    @pytest.mark.asyncio
    async def test_handle_message_unknown_event(self):
        """Test handling unknown event type does nothing."""
        subscriber = StreamSubscriber()

        # No patches - should not raise
        data = {
            "event_type": "unknown_event",
            "session_id": "session-123",
        }
        # Should not raise
        await subscriber._handle_message(data)


@pytest.mark.unit
class TestGetStreamSubscriber:
    """Tests for get_stream_subscriber function."""

    def test_get_stream_subscriber_creates_singleton(self):
        """Test that get_stream_subscriber returns singleton instance."""
        # Reset the global singleton
        import src.streaming.subscriber as mod

        original = mod._subscriber
        mod._subscriber = None

        try:
            sub1 = get_stream_subscriber()
            sub2 = get_stream_subscriber()
            assert sub1 is sub2
            assert isinstance(sub1, StreamSubscriber)
        finally:
            mod._subscriber = original

    def test_get_stream_subscriber_returns_existing(self):
        """Test that get_stream_subscriber returns existing instance."""
        import src.streaming.subscriber as mod

        original = mod._subscriber

        try:
            existing = StreamSubscriber()
            mod._subscriber = existing

            result = get_stream_subscriber()
            assert result is existing
        finally:
            mod._subscriber = original
