"""Redis client dependency for FastAPI routes."""

from typing import TYPE_CHECKING, Any

import redis.asyncio as redis
from fastapi import Depends

from src.config import settings

# Type alias for Redis client - use Any as the type parameter since different
# callers have different expectations (some expect bytes, some work with strings)
# Export this for use in other modules that need to type-annotate Redis clients
# Use TYPE_CHECKING to avoid runtime generic subscription error
if TYPE_CHECKING:
    RedisClient = redis.Redis[Any]
else:
    RedisClient = redis.Redis

_redis_client: RedisClient | None = None


async def get_redis() -> RedisClient:
    """Get Redis client instance."""
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=False,  # Keep as bytes for compatibility
        )
    return _redis_client


def get_redis_dependency() -> Any:
    """FastAPI dependency for Redis client."""
    return Depends(get_redis)
