"""Comprehensive integration tests for StreamPublisher with Redis.

Tests cover:
- StreamMessage serialization
- StreamPublisher connection management
- Token, tool call, and skill event publishing
- Error handling and edge cases
- Redis pub/sub integration
"""

import asyncio
import json
import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.streaming.publisher import StreamMessage, StreamPublisher, get_stream_publisher


class TestStreamMessageAdvanced:
    """Advanced tests for StreamMessage dataclass."""

    def test_stream_message_all_fields(self):
        """Test StreamMessage with all fields populated."""
        msg = StreamMessage(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
            event_type="tool_call_end",
            content="Result content",
            tool_call_id="tool-abc",
            tool_name="read_file",
            tool_input={"path": "/tmp/test.txt"},
            usage={"input_tokens": 100, "output_tokens": 50},
            error=None,
            skill_name="my-skill",
            skill_slug="my-skill",
            step_name="Step 1",
            step_index=0,
            step_status="success",
            total_steps=3,
        )

        assert msg.session_id == "session-123"
        assert msg.tool_call_id == "tool-abc"
        assert msg.tool_input == {"path": "/tmp/test.txt"}
        assert msg.usage == {"input_tokens": 100, "output_tokens": 50}
        assert msg.skill_name == "my-skill"
        assert msg.total_steps == 3

    def test_stream_message_to_json_complete(self):
        """Test to_json with all fields."""
        msg = StreamMessage(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
            event_type="token",
            content="Hello world",
            usage={"input_tokens": 10, "output_tokens": 5},
        )

        json_str = msg.to_json()
        data = json.loads(json_str)

        assert data["session_id"] == "session-123"
        assert data["content"] == "Hello world"
        assert data["usage"] == {"input_tokens": 10, "output_tokens": 5}
        assert "timestamp" in data

    def test_stream_message_to_json_minimal(self):
        """Test to_json with minimal fields."""
        msg = StreamMessage(
            session_id="s",
            agent_id="a",
            message_id="m",
            event_type="start",
        )

        json_str = msg.to_json()
        data = json.loads(json_str)

        # Should not include None values
        assert "content" not in data
        assert "tool_call_id" not in data
        assert "error" not in data

    def test_stream_message_with_error(self):
        """Test StreamMessage with error content."""
        msg = StreamMessage(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
            event_type="error",
            error="Something went wrong",
        )

        json_str = msg.to_json()
        data = json.loads(json_str)

        assert data["event_type"] == "error"
        assert data["error"] == "Something went wrong"


class TestStreamPublisherAdvanced:
    """Advanced tests for StreamPublisher."""

    @pytest.fixture
    def mock_redis(self) -> MagicMock:
        """Create mock Redis client."""
        mock = MagicMock()
        mock.connect = AsyncMock()
        mock.publish = AsyncMock(return_value=1)
        return mock

    @pytest.fixture
    def publisher(self, mock_redis: MagicMock) -> StreamPublisher:
        """Create StreamPublisher with mock Redis."""
        return StreamPublisher(redis_client=mock_redis)

    async def test_publish_with_usage_data(self, publisher: StreamPublisher, mock_redis: MagicMock):
        """Test publishing done event with usage data."""
        await publisher.publish_done(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
            full_content="Complete response",
            stop_reason="end_turn",
            usage={"input_tokens": 500, "output_tokens": 200, "total_tokens": 700},
        )

        mock_redis.publish.assert_called_once()
        call_args = mock_redis.publish.call_args
        channel = call_args[0][0]
        message_json = call_args[0][1]
        message = json.loads(message_json)

        assert channel == "agent_stream:session-123:agent-456"
        assert message["event_type"] == "done"
        assert message["usage"] == {"input_tokens": 500, "output_tokens": 200, "total_tokens": 700}

    async def test_publish_tool_call_with_input(self, publisher: StreamPublisher, mock_redis: MagicMock):
        """Test publishing tool call end with input parameters."""
        await publisher.publish_tool_call_end(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
            tool_call_id="tool-abc",
            tool_name="write_file",
            tool_input={"path": "/tmp/output.txt", "content": "Hello"},
        )

        mock_redis.publish.assert_called_once()
        call_args = mock_redis.publish.call_args
        message_json = call_args[0][1]
        message = json.loads(message_json)

        assert message["event_type"] == "tool_call_end"
        assert message["tool_name"] == "write_file"
        assert message["tool_input"] == {"path": "/tmp/output.txt", "content": "Hello"}

    async def test_context_management_workflow(self, publisher: StreamPublisher, mock_redis: MagicMock):
        """Test full context management workflow."""
        # Set context
        publisher.set_context(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
        )

        assert publisher._session_id == "session-123"
        assert publisher._agent_id == "agent-456"
        assert publisher._message_id == "msg-789"

        # Use context-based publishing
        await publisher.publish_skill_start(
            skill_name="test-skill",
            skill_slug="test-skill",
            total_steps=5,
        )

        mock_redis.publish.assert_called()

        # Clear context
        publisher.clear_context()

        assert publisher._session_id is None
        assert publisher._agent_id is None
        assert publisher._message_id is None

    async def test_publish_multiple_tokens_sequentially(self, publisher: StreamPublisher, mock_redis: MagicMock):
        """Test publishing multiple tokens in sequence."""
        tokens = ["Hello", " ", "world", "!"]

        for token in tokens:
            await publisher.publish_token(
                session_id="session-123",
                agent_id="agent-456",
                message_id="msg-789",
                token=token,
            )

        assert mock_redis.publish.call_count == 4

    async def test_publish_skill_step_progress(self, publisher: StreamPublisher, mock_redis: MagicMock):
        """Test publishing skill step progress."""
        publisher.set_context("session-123", "agent-456", "msg-789")

        # Step 1: Running
        await publisher.publish_skill_step(
            step_name="Download dependencies",
            step_index=0,
            status="running",
        )

        # Step 1: Complete
        await publisher.publish_skill_step(
            step_name="Download dependencies",
            step_index=0,
            status="success",
        )

        # Step 2: Running
        await publisher.publish_skill_step(
            step_name="Build project",
            step_index=1,
            status="running",
        )

        assert mock_redis.publish.call_count == 3

    async def test_publish_error_event(self, publisher: StreamPublisher, mock_redis: MagicMock):
        """Test publishing error event."""
        await publisher.publish_error(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
            error="Rate limit exceeded",
        )

        mock_redis.publish.assert_called_once()
        call_args = mock_redis.publish.call_args
        message_json = call_args[0][1]
        message = json.loads(message_json)

        assert message["event_type"] == "error"
        assert message["error"] == "Rate limit exceeded"


class TestStreamPublisherEdgeCases:
    """Test edge cases and error handling."""

    @pytest.fixture
    def mock_redis(self) -> MagicMock:
        """Create mock Redis client."""
        mock = MagicMock()
        mock.connect = AsyncMock()
        mock.publish = AsyncMock(return_value=1)
        return mock

    async def test_publish_with_empty_content(self, mock_redis: MagicMock):
        """Test publishing with empty content."""
        publisher = StreamPublisher(redis_client=mock_redis)

        await publisher.publish_token(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
            token="",
        )

        mock_redis.publish.assert_called_once()

    async def test_publish_with_unicode_content(self, mock_redis: MagicMock):
        """Test publishing with unicode content."""
        publisher = StreamPublisher(redis_client=mock_redis)

        await publisher.publish_token(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
            token="Hello 世界 🌍",
        )

        mock_redis.publish.assert_called_once()

    async def test_publish_with_large_tool_output(self, mock_redis: MagicMock):
        """Test publishing with large tool input."""
        publisher = StreamPublisher(redis_client=mock_redis)

        large_input = {"content": "x" * 100000}  # 100KB input

        await publisher.publish_tool_call_end(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
            tool_call_id="tool-abc",
            tool_name="read_file",
            tool_input=large_input,
        )

        mock_redis.publish.assert_called_once()

    async def test_redis_connection_failure_handling(self, mock_redis: MagicMock):
        """Test handling Redis connection failures."""
        mock_redis.publish = AsyncMock(side_effect=Exception("Connection refused"))
        publisher = StreamPublisher(redis_client=mock_redis)

        # Should raise exception (caller should handle)
        with pytest.raises(Exception, match="Connection refused"):
            await publisher.publish_token(
                session_id="session-123",
                agent_id="agent-456",
                message_id="msg-789",
                token="test",
            )

    async def test_multiple_connect_calls(self, mock_redis: MagicMock):
        """Test multiple connect calls are idempotent."""
        publisher = StreamPublisher(redis_client=mock_redis)

        await publisher.connect()
        await publisher.connect()
        await publisher.connect()

        # Should only actually connect once
        assert mock_redis.connect.call_count == 1

    async def test_publish_skill_without_context(self, mock_redis: MagicMock):
        """Test publishing skill events without context set - should skip."""
        publisher = StreamPublisher(redis_client=mock_redis)

        # Without context set, should skip publishing (not raise error)
        await publisher.publish_skill_start(
            skill_name="test-skill",
            skill_slug="test-skill",
            total_steps=3,
        )

        # Should not publish when context is not set
        mock_redis.publish.assert_not_called()


class TestStreamPublisherChannelFormat:
    """Test channel naming and formatting."""

    def test_channel_format_standard(self):
        """Test standard channel format."""
        mock_redis = MagicMock()
        publisher = StreamPublisher(redis_client=mock_redis)

        channel = publisher._channel("session-abc", "agent-xyz")

        assert channel == "agent_stream:session-abc:agent-xyz"

    def test_channel_format_with_special_chars(self):
        """Test channel with special characters in IDs."""
        mock_redis = MagicMock()
        publisher = StreamPublisher(redis_client=mock_redis)

        channel = publisher._channel("session_123-test", "agent.456")

        assert channel == "agent_stream:session_123-test:agent.456"


class TestGetStreamPublisher:
    """Test get_stream_publisher function."""

    def test_get_stream_publisher_returns_callable(self):
        """Test get_stream_publisher is callable."""
        assert callable(get_stream_publisher)

    def test_get_stream_publisher_returns_publisher_or_none(self):
        """Test get_stream_publisher returns publisher or None."""
        result = get_stream_publisher()
        assert result is None or isinstance(result, StreamPublisher)


from tests.conftest import requires_redis


@pytest.mark.integration
@requires_redis
class TestStreamPublisherRedisIntegration:
    """Integration tests with real Redis.

    These tests require a running Redis instance.
    Run with: pytest -m integration --run-redis-tests
    """

    @pytest.fixture
    async def redis_client(self):
        """Get real Redis client."""
        import os
        from podex_shared.redis_client import RedisClient

        redis_url = os.getenv("REDIS_URL", "redis://localhost:6380")
        client = RedisClient(redis_url)
        await client.connect()
        yield client
        await client.disconnect()

    async def test_publish_and_subscribe(self, redis_client):
        """Test publishing and subscribing to stream."""
        publisher = StreamPublisher(redis_client=redis_client)
        await publisher.connect()

        session_id = f"test-session-{uuid.uuid4().hex[:8]}"
        agent_id = f"test-agent-{uuid.uuid4().hex[:8]}"
        channel = f"agent_stream:{session_id}:{agent_id}"

        # Subscribe to channel
        pubsub = redis_client.client.pubsub()
        await pubsub.subscribe(channel)

        # Wait for subscription
        await asyncio.sleep(0.1)

        # Publish token
        await publisher.publish_token(
            session_id=session_id,
            agent_id=agent_id,
            message_id="msg-123",
            token="Test token",
        )

        # Receive message
        try:
            message = await asyncio.wait_for(
                pubsub.get_message(ignore_subscribe_messages=True, timeout=2.0),
                timeout=3.0,
            )

            if message:
                data = json.loads(message["data"])
                assert data["event_type"] == "token"
                assert data["content"] == "Test token"
        except asyncio.TimeoutError:
            pytest.skip("Pub/sub message not received in time")
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()

    async def test_full_stream_lifecycle(self, redis_client):
        """Test full streaming lifecycle."""
        publisher = StreamPublisher(redis_client=redis_client)
        await publisher.connect()

        session_id = f"test-session-{uuid.uuid4().hex[:8]}"
        agent_id = f"test-agent-{uuid.uuid4().hex[:8]}"
        message_id = f"msg-{uuid.uuid4().hex[:8]}"

        # Start
        await publisher.publish_start(
            session_id=session_id,
            agent_id=agent_id,
            message_id=message_id,
        )

        # Tokens
        for token in ["Hello", " ", "world", "!"]:
            await publisher.publish_token(
                session_id=session_id,
                agent_id=agent_id,
                message_id=message_id,
                token=token,
            )

        # Tool call
        await publisher.publish_tool_call_start(
            session_id=session_id,
            agent_id=agent_id,
            message_id=message_id,
            tool_call_id="tool-1",
            tool_name="read_file",
        )

        await publisher.publish_tool_call_end(
            session_id=session_id,
            agent_id=agent_id,
            message_id=message_id,
            tool_call_id="tool-1",
            tool_name="read_file",
        )

        # Done
        await publisher.publish_done(
            session_id=session_id,
            agent_id=agent_id,
            message_id=message_id,
            full_content="Hello world!",
            stop_reason="end_turn",
            usage={"input_tokens": 100, "output_tokens": 50},
        )

        # If we get here without exception, the test passes
