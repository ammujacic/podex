"""Redis caching utilities for the API service."""

import functools
import hashlib
import json
from collections.abc import Callable, Coroutine
from typing import Any, ParamSpec, TypeVar, cast

import structlog
from pydantic import BaseModel

from podex_shared.redis_client import RedisClient, get_redis_client
from src.config import settings

logger = structlog.get_logger()

P = ParamSpec("P")
T = TypeVar("T")

# Maximum length for cache key before hashing
MAX_CACHE_KEY_LENGTH = 200


class _CacheClientManager:
    """Manager for shared Redis client with lazy initialization."""

    _instance: RedisClient | None = None

    @classmethod
    async def get(cls) -> RedisClient:
        """Get or create the Redis cache client."""
        if cls._instance is None:
            cls._instance = get_redis_client(settings.REDIS_URL)
            await cls._instance.connect()
        return cls._instance


async def get_cache_client() -> RedisClient:
    """Get the Redis cache client, initializing if needed."""
    return await _CacheClientManager.get()


def _make_cache_key(prefix: str, *args: object, **kwargs: object) -> str:
    """Generate a cache key from prefix and arguments."""
    key_parts = [settings.CACHE_PREFIX, prefix]

    # Add positional args
    for arg in args:
        if isinstance(arg, BaseModel):
            key_parts.append(arg.model_dump_json())
        elif isinstance(arg, dict):
            key_parts.append(json.dumps(arg, sort_keys=True))
        else:
            key_parts.append(str(arg))

    # Add keyword args (sorted for consistency)
    for key in sorted(kwargs.keys()):
        value = kwargs[key]
        if isinstance(value, BaseModel):
            key_parts.append(f"{key}={value.model_dump_json()}")
        elif isinstance(value, dict):
            key_parts.append(f"{key}={json.dumps(value, sort_keys=True)}")
        else:
            key_parts.append(f"{key}={value}")

    combined = ":".join(key_parts)

    # Hash if too long
    if len(combined) > MAX_CACHE_KEY_LENGTH:
        hash_suffix = hashlib.sha256(combined.encode()).hexdigest()[:16]
        return f"{settings.CACHE_PREFIX}{prefix}:{hash_suffix}"

    return combined


def cached(
    prefix: str,
    ttl: int | None = None,
    key_builder: Callable[..., str] | None = None,
) -> Callable[
    [Callable[P, Coroutine[Any, Any, T]]],
    Callable[P, Coroutine[Any, Any, T]],
]:
    """Decorator to cache async function results in Redis.

    Args:
        prefix: Cache key prefix (e.g., "templates", "sessions")
        ttl: Time-to-live in seconds (defaults to 300)
        key_builder: Optional custom key builder function

    Example:
        @cached("templates", ttl=3600)
        async def get_templates():
            return await db.query(...)
    """

    def decorator(
        func: Callable[P, Coroutine[Any, Any, T]],
    ) -> Callable[P, Coroutine[Any, Any, T]]:
        @functools.wraps(func)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
            # Build cache key
            if key_builder:
                cache_key = key_builder(*args, **kwargs)
            else:
                cache_key = _make_cache_key(prefix, *args, **kwargs)

            try:
                client = await get_cache_client()

                # Try to get from cache
                # get_json returns dict|list|None, cast to T for cached data
                cached_data = await client.get_json(cache_key)
                cached_value: T | None = cast("T", cached_data) if cached_data else None
                if cached_value is not None:
                    logger.debug("Cache hit", key=cache_key)
                    return cached_value

                logger.debug("Cache miss", key=cache_key)
            except Exception as e:
                logger.warning("Cache read error, falling back to source", error=str(e))

            # Call the actual function
            result = await func(*args, **kwargs)

            # Store in cache
            try:
                client = await get_cache_client()
                cache_ttl = ttl or 300

                # Convert Pydantic models to dict for JSON serialization
                cache_data: Any
                if isinstance(result, BaseModel):
                    cache_data = result.model_dump(mode="json")
                elif isinstance(result, list) and result and isinstance(result[0], BaseModel):
                    cache_data = [item.model_dump(mode="json") for item in result]
                else:
                    cache_data = result

                await client.set_json(cache_key, cache_data, ex=cache_ttl)
                logger.debug("Cached result", key=cache_key, ttl=cache_ttl)
            except Exception as e:
                logger.warning("Cache write error", error=str(e))

            return result

        return wrapper

    return decorator


async def invalidate_cache(prefix: str, *args: object, **kwargs: object) -> bool:
    """Invalidate a specific cache key.

    Args:
        prefix: Cache key prefix
        *args: Arguments used to build the key
        **kwargs: Keyword arguments used to build the key

    Returns:
        True if key was deleted, False otherwise
    """
    cache_key = _make_cache_key(prefix, *args, **kwargs)
    result = False
    try:
        client = await get_cache_client()
        deleted = await client.delete(cache_key)
        if deleted:
            logger.debug("Cache invalidated", key=cache_key)
        result = deleted > 0
    except Exception as e:
        logger.warning("Cache invalidation error", error=str(e))
    return result


async def invalidate_pattern(pattern: str) -> int:
    """Invalidate all cache keys matching a pattern.

    Args:
        pattern: Redis pattern (e.g., "podex:cache:templates:*")

    Returns:
        Number of keys deleted
    """
    deleted_count = 0
    try:
        client = await get_cache_client()
        full_pattern = f"{settings.CACHE_PREFIX}{pattern}"

        # Use SCAN to find matching keys (safer than KEYS for large datasets)
        cursor = 0
        while True:
            cursor, keys = await client.client.scan(cursor, match=full_pattern, count=100)
            if keys:
                deleted_count += await client.delete(*keys)
            if cursor == 0:
                break

        if deleted_count:
            logger.info("Cache pattern invalidated", pattern=full_pattern, count=deleted_count)
    except Exception as e:
        logger.warning("Cache pattern invalidation error", error=str(e))
    return deleted_count


# Convenience functions for common cache operations


async def cache_get(key: str) -> Any | None:
    """Get a value from cache by full key."""
    try:
        client = await get_cache_client()
        result = await client.get_json(key)
    except Exception as e:
        logger.warning("Cache get error", key=key, error=str(e))
        return None
    else:
        return result


async def cache_set(key: str, value: Any, ttl: int = 300) -> bool:
    """Set a value in cache.

    Args:
        key: Cache key
        value: Value to cache (will be JSON serialized)
        ttl: Time-to-live in seconds

    Returns:
        True if successful
    """
    result = False
    try:
        client = await get_cache_client()

        cache_data: Any
        if isinstance(value, BaseModel):
            cache_data = value.model_dump(mode="json")
        elif isinstance(value, list) and value and isinstance(value[0], BaseModel):
            cache_data = [item.model_dump(mode="json") for item in value]
        else:
            cache_data = value

        await client.set_json(key, cache_data, ex=ttl)
        result = True
    except Exception as e:
        logger.warning("Cache set error", key=key, error=str(e))
    return result


async def cache_delete(key: str) -> bool:
    """Delete a value from cache."""
    result = False
    try:
        client = await get_cache_client()
        deleted = await client.delete(key)
        result = deleted > 0
    except Exception as e:
        logger.warning("Cache delete error", key=key, error=str(e))
    return result


# Cache key builders for specific entities


def templates_list_key(*, include_private: bool = False, user_id: str | None = None) -> str:
    """Build cache key for templates list."""
    if include_private and user_id:
        return f"{settings.CACHE_PREFIX}templates:list:user:{user_id}"
    return f"{settings.CACHE_PREFIX}templates:list:public"


def template_key(template_id: str) -> str:
    """Build cache key for a single template."""
    return f"{settings.CACHE_PREFIX}templates:item:{template_id}"


def session_key(session_id: str) -> str:
    """Build cache key for a session."""
    return f"{settings.CACHE_PREFIX}sessions:item:{session_id}"


def user_sessions_key(user_id: str, page: int = 1) -> str:
    """Build cache key for user's sessions list."""
    return f"{settings.CACHE_PREFIX}sessions:user:{user_id}:page:{page}"


def user_sessions_version_key(user_id: str) -> str:
    """Build cache key for user's sessions cache version.

    This version is incremented when sessions change, invalidating all cached pages
    without needing pattern-based deletion.
    """
    return f"{settings.CACHE_PREFIX}sessions:user:{user_id}:version"


async def get_user_sessions_version(user_id: str) -> int:
    """Get the current cache version for a user's sessions.

    Returns 0 if no version exists (first access).
    """
    try:
        client = await get_cache_client()
        version = await client.client.get(user_sessions_version_key(user_id))
        return int(version) if version else 0
    except Exception as e:
        logger.warning("Failed to get sessions version", user_id=user_id, error=str(e))
        return 0


async def invalidate_user_sessions(user_id: str) -> None:
    """Invalidate user's sessions cache by incrementing version.

    This is O(1) compared to pattern-based invalidation which is O(n).
    Old cache entries will naturally expire and won't be found due to
    version mismatch.
    """
    try:
        client = await get_cache_client()
        version_key = user_sessions_version_key(user_id)
        new_version = await client.client.incr(version_key)
        # Set expiry on version key (7 days) to eventually clean up
        await client.client.expire(version_key, 7 * 24 * 60 * 60)
        logger.debug(
            "Sessions cache version incremented",
            user_id=user_id,
            new_version=new_version,
        )
    except Exception as e:
        logger.warning("Failed to invalidate sessions version", user_id=user_id, error=str(e))


def user_sessions_key_versioned(user_id: str, page: int, version: int) -> str:
    """Build versioned cache key for user's sessions list.

    Includes version number so cache is automatically invalidated when
    version increments.
    """
    return f"{settings.CACHE_PREFIX}sessions:user:{user_id}:v{version}:page:{page}"


def user_config_key(user_id: str) -> str:
    """Build cache key for user configuration."""
    return f"{settings.CACHE_PREFIX}user_config:{user_id}"
