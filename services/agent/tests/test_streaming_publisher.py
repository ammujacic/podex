"""Tests for streaming publisher module.

Tests cover:
- StreamMessage dataclass
- StreamPublisher initialization
- Stream publish methods
- Skill event methods
"""

from datetime import datetime, UTC
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
import json

import pytest


class TestStreamMessageDataclass:
    """Test StreamMessage dataclass."""

    def test_stream_message_exists(self):
        """Test StreamMessage exists."""
        from src.streaming.publisher import StreamMessage
        assert StreamMessage is not None

    def test_stream_message_creation(self):
        """Test creating StreamMessage."""
        from src.streaming.publisher import StreamMessage

        msg = StreamMessage(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
            event_type="token",
            content="Hello",
        )

        assert msg.session_id == "session-123"
        assert msg.agent_id == "agent-456"
        assert msg.message_id == "msg-789"
        assert msg.event_type == "token"
        assert msg.content == "Hello"

    def test_stream_message_defaults(self):
        """Test StreamMessage default values."""
        from src.streaming.publisher import StreamMessage

        msg = StreamMessage(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
            event_type="start",
        )

        assert msg.content is None
        assert msg.tool_call_id is None
        assert msg.tool_name is None
        assert msg.tool_input is None
        assert msg.usage is None
        assert msg.error is None

    def test_stream_message_to_json(self):
        """Test StreamMessage to_json method."""
        from src.streaming.publisher import StreamMessage

        msg = StreamMessage(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
            event_type="token",
            content="Hello",
        )

        json_str = msg.to_json()
        data = json.loads(json_str)

        assert data["session_id"] == "session-123"
        assert data["agent_id"] == "agent-456"
        assert data["event_type"] == "token"
        assert data["content"] == "Hello"
        assert "timestamp" in data  # Should add timestamp

    def test_stream_message_to_json_excludes_none(self):
        """Test to_json excludes None values."""
        from src.streaming.publisher import StreamMessage

        msg = StreamMessage(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
            event_type="start",
        )

        json_str = msg.to_json()
        data = json.loads(json_str)

        # None values should not be in the JSON
        assert "content" not in data
        assert "tool_call_id" not in data
        assert "error" not in data

    def test_stream_message_with_tool_call(self):
        """Test StreamMessage with tool call data."""
        from src.streaming.publisher import StreamMessage

        msg = StreamMessage(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
            event_type="tool_call_start",
            tool_call_id="tool-1",
            tool_name="read_file",
            tool_input={"path": "/tmp/test.txt"},
        )

        assert msg.tool_call_id == "tool-1"
        assert msg.tool_name == "read_file"
        assert msg.tool_input == {"path": "/tmp/test.txt"}

    def test_stream_message_with_skill_data(self):
        """Test StreamMessage with skill event data."""
        from src.streaming.publisher import StreamMessage

        msg = StreamMessage(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
            event_type="skill_step",
            skill_name="my-skill",
            skill_slug="my-skill",
            step_name="Step 1",
            step_index=0,
            step_status="success",
            total_steps=3,
        )

        assert msg.skill_name == "my-skill"
        assert msg.step_index == 0
        assert msg.step_status == "success"
        assert msg.total_steps == 3


class TestStreamPublisherInit:
    """Test StreamPublisher initialization."""

    def test_stream_publisher_exists(self):
        """Test StreamPublisher exists."""
        from src.streaming.publisher import StreamPublisher
        assert StreamPublisher is not None

    def test_stream_publisher_initialization(self):
        """Test StreamPublisher initialization."""
        from src.streaming.publisher import StreamPublisher

        mock_redis = MagicMock()
        publisher = StreamPublisher(redis_client=mock_redis)

        assert publisher._redis == mock_redis
        assert publisher._connected is False

    def test_stream_publisher_default_context(self):
        """Test StreamPublisher default context."""
        from src.streaming.publisher import StreamPublisher

        mock_redis = MagicMock()
        publisher = StreamPublisher(redis_client=mock_redis)

        assert publisher._session_id is None
        assert publisher._agent_id is None
        assert publisher._message_id is None


class TestStreamPublisherChannel:
    """Test StreamPublisher channel methods."""

    def test_channel_format(self):
        """Test channel name format."""
        from src.streaming.publisher import StreamPublisher

        mock_redis = MagicMock()
        publisher = StreamPublisher(redis_client=mock_redis)

        channel = publisher._channel("session-123", "agent-456")

        assert channel == "agent_stream:session-123:agent-456"


class TestStreamPublisherContext:
    """Test StreamPublisher context methods."""

    def test_set_context(self):
        """Test set_context method."""
        from src.streaming.publisher import StreamPublisher

        mock_redis = MagicMock()
        publisher = StreamPublisher(redis_client=mock_redis)

        publisher.set_context(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
        )

        assert publisher._session_id == "session-123"
        assert publisher._agent_id == "agent-456"
        assert publisher._message_id == "msg-789"

    def test_clear_context(self):
        """Test clear_context method."""
        from src.streaming.publisher import StreamPublisher

        mock_redis = MagicMock()
        publisher = StreamPublisher(redis_client=mock_redis)

        publisher.set_context(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
        )
        publisher.clear_context()

        assert publisher._session_id is None
        assert publisher._agent_id is None
        assert publisher._message_id is None


class TestStreamPublisherConnect:
    """Test StreamPublisher connect methods."""

    @pytest.mark.asyncio
    async def test_connect(self):
        """Test connect method."""
        from src.streaming.publisher import StreamPublisher

        mock_redis = AsyncMock()
        publisher = StreamPublisher(redis_client=mock_redis)

        await publisher.connect()

        mock_redis.connect.assert_called_once()
        assert publisher._connected is True

    @pytest.mark.asyncio
    async def test_connect_idempotent(self):
        """Test connect is idempotent."""
        from src.streaming.publisher import StreamPublisher

        mock_redis = AsyncMock()
        publisher = StreamPublisher(redis_client=mock_redis)

        await publisher.connect()
        await publisher.connect()

        # Should only connect once
        mock_redis.connect.assert_called_once()


class TestStreamPublisherPublish:
    """Test StreamPublisher publish methods."""

    @pytest.mark.asyncio
    async def test_publish_start(self):
        """Test publish_start method."""
        from src.streaming.publisher import StreamPublisher

        mock_redis = AsyncMock()
        publisher = StreamPublisher(redis_client=mock_redis)

        await publisher.publish_start(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
        )

        mock_redis.publish.assert_called_once()
        call_args = mock_redis.publish.call_args
        assert call_args[0][0] == "agent_stream:session-123:agent-456"

    @pytest.mark.asyncio
    async def test_publish_token(self):
        """Test publish_token method."""
        from src.streaming.publisher import StreamPublisher

        mock_redis = AsyncMock()
        publisher = StreamPublisher(redis_client=mock_redis)

        await publisher.publish_token(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
            token="Hello",
        )

        mock_redis.publish.assert_called_once()

    @pytest.mark.asyncio
    async def test_publish_thinking_token(self):
        """Test publish_thinking_token method."""
        from src.streaming.publisher import StreamPublisher

        mock_redis = AsyncMock()
        publisher = StreamPublisher(redis_client=mock_redis)

        await publisher.publish_thinking_token(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
            thinking="Let me think...",
        )

        mock_redis.publish.assert_called_once()

    @pytest.mark.asyncio
    async def test_publish_tool_call_start(self):
        """Test publish_tool_call_start method."""
        from src.streaming.publisher import StreamPublisher

        mock_redis = AsyncMock()
        publisher = StreamPublisher(redis_client=mock_redis)

        await publisher.publish_tool_call_start(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
            tool_call_id="tool-1",
            tool_name="read_file",
        )

        mock_redis.publish.assert_called_once()

    @pytest.mark.asyncio
    async def test_publish_tool_call_end(self):
        """Test publish_tool_call_end method."""
        from src.streaming.publisher import StreamPublisher

        mock_redis = AsyncMock()
        publisher = StreamPublisher(redis_client=mock_redis)

        await publisher.publish_tool_call_end(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
            tool_call_id="tool-1",
            tool_name="read_file",
        )

        mock_redis.publish.assert_called_once()

    @pytest.mark.asyncio
    async def test_publish_done(self):
        """Test publish_done method."""
        from src.streaming.publisher import StreamPublisher

        mock_redis = AsyncMock()
        publisher = StreamPublisher(redis_client=mock_redis)

        await publisher.publish_done(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
            full_content="This is the complete response.",
            stop_reason="end_turn",
            usage={"input_tokens": 100, "output_tokens": 50},
        )

        mock_redis.publish.assert_called_once()

    @pytest.mark.asyncio
    async def test_publish_error(self):
        """Test publish_error method."""
        from src.streaming.publisher import StreamPublisher

        mock_redis = AsyncMock()
        publisher = StreamPublisher(redis_client=mock_redis)

        await publisher.publish_error(
            session_id="session-123",
            agent_id="agent-456",
            message_id="msg-789",
            error="Something went wrong",
        )

        mock_redis.publish.assert_called_once()


class TestStreamPublisherSkillEvents:
    """Test StreamPublisher skill event methods."""

    @pytest.mark.asyncio
    async def test_publish_skill_start(self):
        """Test publish_skill_start method."""
        from src.streaming.publisher import StreamPublisher

        mock_redis = AsyncMock()
        publisher = StreamPublisher(redis_client=mock_redis)
        publisher.set_context("session-123", "agent-456", "msg-789")

        await publisher.publish_skill_start(
            skill_name="my-skill",
            skill_slug="my-skill",
            total_steps=3,
        )

        mock_redis.publish.assert_called_once()

    @pytest.mark.asyncio
    async def test_publish_skill_step(self):
        """Test publish_skill_step method."""
        from src.streaming.publisher import StreamPublisher

        mock_redis = AsyncMock()
        publisher = StreamPublisher(redis_client=mock_redis)
        publisher.set_context("session-123", "agent-456", "msg-789")

        await publisher.publish_skill_step(
            step_name="Step 1",
            step_index=0,
            status="running",
        )

        mock_redis.publish.assert_called_once()

    @pytest.mark.asyncio
    async def test_publish_skill_complete(self):
        """Test publish_skill_complete method."""
        from src.streaming.publisher import StreamPublisher

        mock_redis = AsyncMock()
        publisher = StreamPublisher(redis_client=mock_redis)
        publisher.set_context("session-123", "agent-456", "msg-789")

        await publisher.publish_skill_complete(
            skill_name="my-skill",
            skill_slug="my-skill",
            success=True,
            duration_ms=1500,
        )

        mock_redis.publish.assert_called_once()


class TestGetStreamPublisher:
    """Test get_stream_publisher function."""

    def test_get_stream_publisher_exists(self):
        """Test get_stream_publisher function exists."""
        from src.streaming.publisher import get_stream_publisher
        assert callable(get_stream_publisher)
