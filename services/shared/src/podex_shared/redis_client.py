"""Shared Redis client utilities."""

import asyncio
import contextlib
import json
import uuid
from collections.abc import AsyncIterator, Callable, Coroutine
from datetime import datetime
from typing import Any, cast

import redis.asyncio as redis
import structlog

logger = structlog.get_logger()


class DateTimeEncoder(json.JSONEncoder):
    """JSON encoder that handles datetime objects."""

    def default(self, obj: Any) -> Any:
        """Convert datetime to ISO format string."""
        if isinstance(obj, datetime):
            return obj.isoformat()
        return super().default(obj)


class RedisClient:
    """Async Redis client wrapper with pub/sub support.

    Provides a consistent interface for Redis operations across services.
    """

    def __init__(self, url: str, decode_responses: bool = True) -> None:
        """Initialize Redis client.

        Args:
            url: Redis connection URL (e.g., redis://localhost:6379)
            decode_responses: Whether to decode responses as strings
        """
        self._url = url
        self._decode_responses = decode_responses
        self._client: Any = None
        self._pubsub: Any = None
        self._running = False
        self._listen_task: asyncio.Task[None] | None = None

    async def connect(self) -> None:
        """Connect to Redis."""
        if self._client is not None:
            return

        self._client = redis.from_url(  # type: ignore[no-untyped-call]
            self._url,
            decode_responses=self._decode_responses,
        )
        logger.info("Connected to Redis", url=self._url)

    async def disconnect(self) -> None:
        """Disconnect from Redis."""
        if self._listen_task:
            self._running = False
            self._listen_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._listen_task

        if self._pubsub:
            await self._pubsub.close()
            self._pubsub = None

        if self._client:
            await self._client.close()
            self._client = None

        logger.info("Disconnected from Redis")

    @property
    def client(self) -> Any:
        """Get the underlying Redis client."""
        if self._client is None:
            raise RuntimeError("Redis client not connected. Call connect() first.")
        return self._client

    # Key-value operations

    async def get(self, key: str) -> str | None:
        """Get a value by key."""
        result = await self.client.get(key)
        return cast("str | None", result)

    async def set(
        self,
        key: str,
        value: str,
        ex: int | None = None,
        px: int | None = None,
    ) -> bool:
        """Set a value with optional expiration.

        Args:
            key: The key to set
            value: The value to set
            ex: Expiration in seconds
            px: Expiration in milliseconds
        """
        result = await self.client.set(key, value, ex=ex, px=px)
        return bool(result)

    async def delete(self, *keys: str) -> int:
        """Delete one or more keys."""
        result = await self.client.delete(*keys)
        return cast("int", result)

    async def exists(self, *keys: str) -> int:
        """Check if keys exist. Returns count of existing keys."""
        result = await self.client.exists(*keys)
        return cast("int", result)

    async def expire(self, key: str, seconds: int) -> bool:
        """Set expiration on a key."""
        result = await self.client.expire(key, seconds)
        return bool(result)

    # JSON helpers

    async def get_json(self, key: str) -> dict[str, Any] | list[Any] | None:
        """Get a JSON value by key."""
        data = await self.get(key)
        if data:
            result: dict[str, Any] | list[Any] = json.loads(data)
            return result
        return None

    async def set_json(
        self,
        key: str,
        value: dict[str, Any] | list[Any],
        ex: int | None = None,
    ) -> bool:
        """Set a JSON value."""
        return await self.set(key, json.dumps(value, cls=DateTimeEncoder), ex=ex)

    # Hash operations

    async def hget(self, name: str, key: str) -> str | None:
        """Get a hash field."""
        result = await self.client.hget(name, key)
        return cast("str | None", result)

    async def hset(self, name: str, key: str, value: str) -> int:
        """Set a hash field."""
        result = await self.client.hset(name, key, value)
        return cast("int", result)

    async def hgetall(self, name: str) -> dict[str, str]:
        """Get all fields in a hash."""
        result = await self.client.hgetall(name)
        return cast("dict[str, str]", result)

    async def hdel(self, name: str, *keys: str) -> int:
        """Delete hash fields."""
        result = await self.client.hdel(name, *keys)
        return cast("int", result)

    # Pub/Sub operations

    async def publish(self, channel: str, message: str | dict[str, Any]) -> int:
        """Publish a message to a channel.

        Args:
            channel: The channel name
            message: The message (dict will be JSON-encoded)

        Returns:
            Number of subscribers that received the message
        """
        if isinstance(message, dict):
            message = json.dumps(message)
        result = await self.client.publish(channel, message)
        return cast("int", result)

    async def subscribe(
        self,
        channel: str,
        callback: Callable[[dict[str, Any]], Coroutine[Any, Any, None]],
    ) -> None:
        """Subscribe to a channel and process messages with a callback.

        Args:
            channel: The channel name to subscribe to
            callback: Async function to call with each message (parsed as JSON)
        """
        if self._pubsub is None:
            self._pubsub = self.client.pubsub()

        await self._pubsub.subscribe(channel)
        self._running = True

        async def listen() -> None:
            if not self._pubsub:
                return

            try:
                async for message in self._pubsub.listen():
                    if not self._running:
                        break

                    if message["type"] != "message":
                        continue

                    try:
                        data = json.loads(message["data"])
                        await callback(data)
                    except json.JSONDecodeError:
                        logger.warning("Invalid JSON in pubsub message", channel=channel)
                    except Exception:
                        logger.exception("Error processing pubsub message", channel=channel)

            except asyncio.CancelledError:
                pass
            except Exception:
                logger.exception("Pubsub listener error", channel=channel)

        self._listen_task = asyncio.create_task(listen())
        logger.info("Subscribed to Redis channel", channel=channel)

    async def unsubscribe(self, channel: str) -> None:
        """Unsubscribe from a channel."""
        if self._pubsub:
            await self._pubsub.unsubscribe(channel)
            logger.info("Unsubscribed from Redis channel", channel=channel)

    # Distributed locking

    async def acquire_lock(
        self,
        key: str,
        timeout: int = 10,
        retry_interval: float = 0.1,
        max_retries: int = 50,
    ) -> str | None:
        """Acquire a distributed lock.

        Args:
            key: Lock key
            timeout: Lock expiration in seconds
            retry_interval: Seconds between retry attempts
            max_retries: Maximum number of retry attempts

        Returns:
            Lock token if acquired, None if failed
        """
        lock_key = f"lock:{key}"
        token = str(uuid.uuid4())

        for _ in range(max_retries):
            # Try to acquire lock with SET NX EX
            acquired = await self.client.set(lock_key, token, nx=True, ex=timeout)
            if acquired:
                return token
            await asyncio.sleep(retry_interval)

        logger.warning("Failed to acquire lock", key=key, max_retries=max_retries)
        return None

    async def release_lock(self, key: str, token: str) -> bool:
        """Release a distributed lock.

        Args:
            key: Lock key
            token: Lock token from acquire_lock

        Returns:
            True if lock was released, False if token didn't match
        """
        lock_key = f"lock:{key}"
        # Use Lua script for atomic check-and-delete
        script = """
        if redis.call('get', KEYS[1]) == ARGV[1] then
            return redis.call('del', KEYS[1])
        else
            return 0
        end
        """
        result = await self.client.eval(script, 1, lock_key, token)
        return bool(result)

    @contextlib.asynccontextmanager
    async def lock(
        self,
        key: str,
        timeout: int = 10,
        retry_interval: float = 0.1,
        max_retries: int = 50,
    ) -> AsyncIterator[str]:
        """Context manager for distributed locking.

        Args:
            key: Lock key
            timeout: Lock expiration in seconds
            retry_interval: Seconds between retry attempts
            max_retries: Maximum number of retry attempts

        Yields:
            Lock token

        Raises:
            RuntimeError: If lock cannot be acquired
        """
        token = await self.acquire_lock(key, timeout, retry_interval, max_retries)
        if token is None:
            raise RuntimeError(f"Failed to acquire lock: {key}")
        try:
            yield token
        finally:
            await self.release_lock(key, token)


# Global instance cache - use dict for mutable singleton pattern
_redis_clients: dict[str, RedisClient] = {}


def get_redis_client(url: str = "redis://localhost:6379") -> RedisClient:
    """Get or create a Redis client for the given URL.

    This provides a singleton pattern per URL for reusing connections.
    Note: The client must be connected before use by calling `await client.connect()`.

    Args:
        url: Redis connection URL

    Returns:
        RedisClient instance
    """
    if url not in _redis_clients:
        _redis_clients[url] = RedisClient(url)
    return _redis_clients[url]


def clear_redis_clients() -> None:
    """Clear all cached Redis clients. Useful for testing."""
    _redis_clients.clear()
