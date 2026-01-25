"""Comprehensive tests for Redis client utilities."""

import asyncio
import json
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from podex_shared.redis_client import (
    RedisClient,
    clear_redis_clients,
    get_redis_client,
)

# Use same REDIS_URL as conftest.py
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")


class TestRedisClientInit:
    """Tests for RedisClient initialization."""

    def test_init_with_defaults(self) -> None:
        """Test initialization with default parameters."""
        client = RedisClient("redis://localhost:6379")
        assert client._url == "redis://localhost:6379"
        assert client._decode_responses is True
        assert client._client is None
        assert client._pubsub is None
        assert client._running is False
        assert client._listen_task is None

    def test_init_with_decode_responses_false(self) -> None:
        """Test initialization with decode_responses=False."""
        client = RedisClient("redis://localhost:6379", decode_responses=False)
        assert client._decode_responses is False


class TestRedisClientConnect:
    """Tests for RedisClient connect/disconnect."""

    @pytest.mark.asyncio
    async def test_connect_creates_client(self) -> None:
        """Test that connect creates the Redis client."""
        with patch("podex_shared.redis_client.redis.from_url") as mock_from_url:
            mock_client = MagicMock()
            mock_from_url.return_value = mock_client

            client = RedisClient("redis://localhost:6379")
            await client.connect()

            mock_from_url.assert_called_once_with(
                "redis://localhost:6379",
                decode_responses=True,
            )
            assert client._client is mock_client

    @pytest.mark.asyncio
    async def test_connect_idempotent(self) -> None:
        """Test that multiple connect calls are idempotent."""
        with patch("podex_shared.redis_client.redis.from_url") as mock_from_url:
            mock_client = MagicMock()
            mock_from_url.return_value = mock_client

            client = RedisClient("redis://localhost:6379")
            await client.connect()
            await client.connect()  # Second call should be no-op

            # Should only be called once
            assert mock_from_url.call_count == 1

    @pytest.mark.asyncio
    async def test_disconnect_cleans_up(self) -> None:
        """Test that disconnect cleans up resources."""
        mock_redis_client = MagicMock()
        mock_redis_client.aclose = AsyncMock()

        client = RedisClient("redis://localhost:6379")
        client._client = mock_redis_client

        await client.disconnect()

        mock_redis_client.aclose.assert_called_once()
        assert client._client is None

    @pytest.mark.asyncio
    async def test_disconnect_cancels_listen_task(self) -> None:
        """Test that disconnect cancels active listen task."""
        client = RedisClient("redis://localhost:6379")
        client._running = True
        client._client = MagicMock()
        client._client.aclose = AsyncMock()

        # Create a mock task
        async def dummy_task() -> None:
            await asyncio.sleep(10)

        task = asyncio.create_task(dummy_task())
        client._listen_task = task

        await client.disconnect()

        assert client._running is False
        assert task.cancelled()


class TestRedisClientProperty:
    """Tests for client property."""

    def test_client_property_raises_when_not_connected(self) -> None:
        """Test that client property raises when not connected."""
        client = RedisClient("redis://localhost:6379")
        with pytest.raises(RuntimeError, match="Redis client not connected"):
            _ = client.client

    def test_client_property_returns_client(self) -> None:
        """Test that client property returns the underlying client."""
        mock_redis_client = MagicMock()
        client = RedisClient("redis://localhost:6379")
        client._client = mock_redis_client

        assert client.client is mock_redis_client


class TestRedisClientKeyValue:
    """Tests for key-value operations."""

    @pytest.mark.asyncio
    async def test_get(self) -> None:
        """Test get operation."""
        mock_redis_client = MagicMock()
        mock_redis_client.get = AsyncMock(return_value="value")

        client = RedisClient("redis://localhost:6379")
        client._client = mock_redis_client

        result = await client.get("key")
        assert result == "value"
        mock_redis_client.get.assert_called_once_with("key")

    @pytest.mark.asyncio
    async def test_set_basic(self) -> None:
        """Test basic set operation."""
        mock_redis_client = MagicMock()
        mock_redis_client.set = AsyncMock(return_value=True)

        client = RedisClient("redis://localhost:6379")
        client._client = mock_redis_client

        result = await client.set("key", "value")
        assert result is True
        mock_redis_client.set.assert_called_once_with("key", "value", ex=None, px=None)

    @pytest.mark.asyncio
    async def test_set_with_expiration(self) -> None:
        """Test set with expiration in seconds."""
        mock_redis_client = MagicMock()
        mock_redis_client.set = AsyncMock(return_value=True)

        client = RedisClient("redis://localhost:6379")
        client._client = mock_redis_client

        await client.set("key", "value", ex=3600)
        mock_redis_client.set.assert_called_once_with("key", "value", ex=3600, px=None)

    @pytest.mark.asyncio
    async def test_set_with_millisecond_expiration(self) -> None:
        """Test set with expiration in milliseconds."""
        mock_redis_client = MagicMock()
        mock_redis_client.set = AsyncMock(return_value=True)

        client = RedisClient("redis://localhost:6379")
        client._client = mock_redis_client

        await client.set("key", "value", px=5000)
        mock_redis_client.set.assert_called_once_with("key", "value", ex=None, px=5000)

    @pytest.mark.asyncio
    async def test_delete(self) -> None:
        """Test delete operation."""
        mock_redis_client = MagicMock()
        mock_redis_client.delete = AsyncMock(return_value=2)

        client = RedisClient("redis://localhost:6379")
        client._client = mock_redis_client

        result = await client.delete("key1", "key2")
        assert result == 2
        mock_redis_client.delete.assert_called_once_with("key1", "key2")

    @pytest.mark.asyncio
    async def test_exists(self) -> None:
        """Test exists operation."""
        mock_redis_client = MagicMock()
        mock_redis_client.exists = AsyncMock(return_value=1)

        client = RedisClient("redis://localhost:6379")
        client._client = mock_redis_client

        result = await client.exists("key1", "key2")
        assert result == 1
        mock_redis_client.exists.assert_called_once_with("key1", "key2")

    @pytest.mark.asyncio
    async def test_expire(self) -> None:
        """Test expire operation."""
        mock_redis_client = MagicMock()
        mock_redis_client.expire = AsyncMock(return_value=True)

        client = RedisClient("redis://localhost:6379")
        client._client = mock_redis_client

        result = await client.expire("key", 3600)
        assert result is True
        mock_redis_client.expire.assert_called_once_with("key", 3600)


class TestRedisClientJSON:
    """Tests for JSON operations."""

    @pytest.mark.asyncio
    async def test_get_json_dict(self) -> None:
        """Test get_json returns parsed dict."""
        mock_redis_client = MagicMock()
        mock_redis_client.get = AsyncMock(return_value='{"foo": "bar"}')

        client = RedisClient("redis://localhost:6379")
        client._client = mock_redis_client

        result = await client.get_json("key")
        assert result == {"foo": "bar"}

    @pytest.mark.asyncio
    async def test_get_json_list(self) -> None:
        """Test get_json returns parsed list."""
        mock_redis_client = MagicMock()
        mock_redis_client.get = AsyncMock(return_value="[1, 2, 3]")

        client = RedisClient("redis://localhost:6379")
        client._client = mock_redis_client

        result = await client.get_json("key")
        assert result == [1, 2, 3]

    @pytest.mark.asyncio
    async def test_get_json_none(self) -> None:
        """Test get_json returns None for missing key."""
        mock_redis_client = MagicMock()
        mock_redis_client.get = AsyncMock(return_value=None)

        client = RedisClient("redis://localhost:6379")
        client._client = mock_redis_client

        result = await client.get_json("key")
        assert result is None

    @pytest.mark.asyncio
    async def test_set_json(self) -> None:
        """Test set_json serializes and stores."""
        mock_redis_client = MagicMock()
        mock_redis_client.set = AsyncMock(return_value=True)

        client = RedisClient("redis://localhost:6379")
        client._client = mock_redis_client

        await client.set_json("key", {"foo": "bar"}, ex=3600)
        mock_redis_client.set.assert_called_once_with(
            "key",
            '{"foo": "bar"}',
            ex=3600,
            px=None,
        )


class TestRedisClientHash:
    """Tests for hash operations."""

    @pytest.mark.asyncio
    async def test_hget(self) -> None:
        """Test hget operation."""
        mock_redis_client = MagicMock()
        mock_redis_client.hget = AsyncMock(return_value="value")

        client = RedisClient("redis://localhost:6379")
        client._client = mock_redis_client

        result = await client.hget("hash", "field")
        assert result == "value"
        mock_redis_client.hget.assert_called_once_with("hash", "field")

    @pytest.mark.asyncio
    async def test_hset(self) -> None:
        """Test hset operation."""
        mock_redis_client = MagicMock()
        mock_redis_client.hset = AsyncMock(return_value=1)

        client = RedisClient("redis://localhost:6379")
        client._client = mock_redis_client

        result = await client.hset("hash", "field", "value")
        assert result == 1
        mock_redis_client.hset.assert_called_once_with("hash", "field", "value")

    @pytest.mark.asyncio
    async def test_hgetall(self) -> None:
        """Test hgetall operation."""
        mock_redis_client = MagicMock()
        mock_redis_client.hgetall = AsyncMock(return_value={"f1": "v1", "f2": "v2"})

        client = RedisClient("redis://localhost:6379")
        client._client = mock_redis_client

        result = await client.hgetall("hash")
        assert result == {"f1": "v1", "f2": "v2"}

    @pytest.mark.asyncio
    async def test_hdel(self) -> None:
        """Test hdel operation."""
        mock_redis_client = MagicMock()
        mock_redis_client.hdel = AsyncMock(return_value=2)

        client = RedisClient("redis://localhost:6379")
        client._client = mock_redis_client

        result = await client.hdel("hash", "f1", "f2")
        assert result == 2
        mock_redis_client.hdel.assert_called_once_with("hash", "f1", "f2")


class TestRedisClientPubSub:
    """Tests for pub/sub operations."""

    @pytest.mark.asyncio
    async def test_publish_string(self) -> None:
        """Test publish with string message."""
        mock_redis_client = MagicMock()
        mock_redis_client.publish = AsyncMock(return_value=1)

        client = RedisClient("redis://localhost:6379")
        client._client = mock_redis_client

        result = await client.publish("channel", "message")
        assert result == 1
        mock_redis_client.publish.assert_called_once_with("channel", "message")

    @pytest.mark.asyncio
    async def test_publish_dict(self) -> None:
        """Test publish with dict message (JSON encoded)."""
        mock_redis_client = MagicMock()
        mock_redis_client.publish = AsyncMock(return_value=1)

        client = RedisClient("redis://localhost:6379")
        client._client = mock_redis_client

        await client.publish("channel", {"foo": "bar"})
        mock_redis_client.publish.assert_called_once_with(
            "channel",
            json.dumps({"foo": "bar"}),
        )

    @pytest.mark.asyncio
    async def test_unsubscribe(self) -> None:
        """Test unsubscribe from channel."""
        mock_pubsub = MagicMock()
        mock_pubsub.unsubscribe = AsyncMock()

        client = RedisClient("redis://localhost:6379")
        client._pubsub = mock_pubsub

        await client.unsubscribe("channel")
        mock_pubsub.unsubscribe.assert_called_once_with("channel")

    @pytest.mark.asyncio
    async def test_unsubscribe_no_pubsub(self) -> None:
        """Test unsubscribe when no pubsub exists."""
        client = RedisClient("redis://localhost:6379")
        client._pubsub = None

        # Should not raise
        await client.unsubscribe("channel")


class TestRedisClientSingleton:
    """Tests for singleton/caching functions."""

    def test_get_redis_client_creates_new(self) -> None:
        """Test get_redis_client creates new client."""
        clear_redis_clients()
        client1 = get_redis_client("redis://host1:6379")
        client2 = get_redis_client("redis://host2:6379")

        assert client1 is not client2

    def test_get_redis_client_reuses_same_url(self) -> None:
        """Test get_redis_client reuses client for same URL."""
        clear_redis_clients()
        client1 = get_redis_client("redis://localhost:6379")
        client2 = get_redis_client("redis://localhost:6379")

        assert client1 is client2

    def test_get_redis_client_default_url(self) -> None:
        """Test get_redis_client uses default URL."""
        clear_redis_clients()
        client = get_redis_client()
        assert client._url == "redis://localhost:6379"

    def test_clear_redis_clients(self) -> None:
        """Test clear_redis_clients removes all cached clients."""
        clear_redis_clients()
        client1 = get_redis_client("redis://localhost:6379")

        clear_redis_clients()
        client2 = get_redis_client("redis://localhost:6379")

        # After clearing, should get a new instance
        assert client1 is not client2


@pytest.mark.integration
class TestRedisClientSubscribeIntegration:
    """Integration tests for pub/sub functionality with real Redis."""

    @pytest.mark.asyncio
    async def test_subscribe_and_receive_messages(
        self,
        real_redis_client: "redis.Redis",  # type: ignore[name-defined]
    ) -> None:
        """Test subscribing to a channel and receiving messages."""
        client = RedisClient(REDIS_URL)
        await client.connect()

        messages = []

        async def handler(message: dict) -> None:  # type: ignore[type-arg]
            messages.append(message)

        try:
            # Subscribe to test channel
            await client.subscribe("test:channel", handler)

            # Give subscription time to establish
            await asyncio.sleep(0.1)

            # Publish messages from real Redis client
            await real_redis_client.publish("test:channel", json.dumps({"data": "message1"}))
            await real_redis_client.publish("test:channel", json.dumps({"data": "message2"}))

            # Wait for messages to be processed
            await asyncio.sleep(0.2)

            # Check messages received
            assert len(messages) == 2
            assert messages[0]["data"] == "message1"
            assert messages[1]["data"] == "message2"

        finally:
            await client.disconnect()

    @pytest.mark.asyncio
    async def test_subscribe_multiple_channels(
        self,
        real_redis_client: "redis.Redis",  # type: ignore[name-defined]
    ) -> None:
        """Test subscribing to multiple channels."""
        client1 = RedisClient(REDIS_URL)
        client2 = RedisClient(REDIS_URL)
        await client1.connect()
        await client2.connect()

        channel1_messages = []
        channel2_messages = []

        async def handler1(message: dict) -> None:  # type: ignore[type-arg]
            channel1_messages.append(message)

        async def handler2(message: dict) -> None:  # type: ignore[type-arg]
            channel2_messages.append(message)

        try:
            # Subscribe to different channels with different clients
            await client1.subscribe("test:channel1", handler1)
            await client2.subscribe("test:channel2", handler2)

            await asyncio.sleep(0.1)

            # Publish to different channels
            await real_redis_client.publish("test:channel1", json.dumps({"ch": 1}))
            await real_redis_client.publish("test:channel2", json.dumps({"ch": 2}))

            await asyncio.sleep(0.2)

            # Each handler should receive its channel's messages
            assert len(channel1_messages) == 1
            assert channel1_messages[0]["ch"] == 1

            assert len(channel2_messages) == 1
            assert channel2_messages[0]["ch"] == 2

        finally:
            await client1.disconnect()
            await client2.disconnect()

    @pytest.mark.asyncio
    async def test_unsubscribe_stops_receiving(
        self,
        real_redis_client: "redis.Redis",  # type: ignore[name-defined]
    ) -> None:
        """Test unsubscribing stops message reception."""
        client = RedisClient(REDIS_URL)
        await client.connect()

        messages = []

        async def handler(message: dict) -> None:  # type: ignore[type-arg]
            messages.append(message)

        try:
            # Subscribe
            await client.subscribe("test:unsub", handler)
            await asyncio.sleep(0.1)

            # Send first message
            await real_redis_client.publish("test:unsub", json.dumps({"msg": 1}))
            await asyncio.sleep(0.1)

            # Unsubscribe
            await client.unsubscribe("test:unsub")
            await asyncio.sleep(0.1)

            # Send second message (should not be received)
            await real_redis_client.publish("test:unsub", json.dumps({"msg": 2}))
            await asyncio.sleep(0.1)

            # Only first message should be received
            assert len(messages) == 1
            assert messages[0]["msg"] == 1

        finally:
            await client.disconnect()

    @pytest.mark.asyncio
    async def test_publish_and_subscribe_integration(
        self,
        real_redis_client: "redis.Redis",  # type: ignore[name-defined]
    ) -> None:
        """Test publishing and subscribing work together."""
        client1 = RedisClient(REDIS_URL)
        client2 = RedisClient(REDIS_URL)

        await client1.connect()
        await client2.connect()

        messages = []

        async def handler(message: dict) -> None:  # type: ignore[type-arg]
            messages.append(message)

        try:
            # client2 subscribes
            await client2.subscribe("test:pubsub", handler)
            await asyncio.sleep(0.1)

            # client1 publishes
            await client1.publish("test:pubsub", {"from": "client1"})
            await asyncio.sleep(0.1)

            # client2 should receive
            assert len(messages) == 1
            assert messages[0]["from"] == "client1"

        finally:
            await client1.disconnect()
            await client2.disconnect()

    @pytest.mark.asyncio
    async def test_subscribe_with_invalid_json_gracefully_handled(
        self,
        real_redis_client: "redis.Redis",  # type: ignore[name-defined]
    ) -> None:
        """Test that invalid JSON messages don't crash the subscriber."""
        client = RedisClient(REDIS_URL)
        await client.connect()

        messages = []

        async def handler(message: dict) -> None:  # type: ignore[type-arg]
            messages.append(message)

        try:
            await client.subscribe("test:invalid", handler)
            await asyncio.sleep(0.1)

            # Publish valid JSON
            await real_redis_client.publish("test:invalid", json.dumps({"valid": True}))
            await asyncio.sleep(0.05)

            # Publish invalid JSON (raw string - should be logged as warning)
            await real_redis_client.publish("test:invalid", "not-json")
            await asyncio.sleep(0.05)

            # Publish another valid JSON
            await real_redis_client.publish("test:invalid", json.dumps({"valid": True}))
            await asyncio.sleep(0.1)

            # Should receive both valid messages, invalid one is skipped
            assert len(messages) == 2

        finally:
            await client.disconnect()

    @pytest.mark.asyncio
    async def test_reconnect_after_disconnect(
        self,
        real_redis_client: "redis.Redis",  # type: ignore[name-defined]
    ) -> None:
        """Test client can reconnect after disconnect."""
        client = RedisClient(REDIS_URL)

        # First connection
        await client.connect()
        messages1 = []

        async def handler1(message: dict) -> None:  # type: ignore[type-arg]
            messages1.append(message)

        await client.subscribe("test:reconnect", handler1)
        await asyncio.sleep(0.1)

        await real_redis_client.publish("test:reconnect", json.dumps({"phase": 1}))
        await asyncio.sleep(0.1)

        assert len(messages1) == 1

        # Disconnect
        await client.disconnect()

        # Reconnect
        await client.connect()
        messages2 = []

        async def handler2(message: dict) -> None:  # type: ignore[type-arg]
            messages2.append(message)

        await client.subscribe("test:reconnect", handler2)
        await asyncio.sleep(0.1)

        await real_redis_client.publish("test:reconnect", json.dumps({"phase": 2}))
        await asyncio.sleep(0.1)

        assert len(messages2) == 1
        assert messages2[0]["phase"] == 2

        await client.disconnect()
