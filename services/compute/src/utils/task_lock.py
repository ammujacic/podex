"""Distributed task locking for background tasks.

Uses Redis SET NX EX for atomic lock acquisition. Lock auto-expires
after TTL to handle crashes. Only one instance can hold the lock.

For horizontal scaling: each background task cycle tries to acquire the lock.
If another instance has it, this instance skips this cycle.
"""

import structlog

from podex_shared.redis_client import RedisClient, get_redis_client
from src.config import settings

logger = structlog.get_logger()

# Module-level Redis client for locking
_lock_client: RedisClient | None = None


async def _get_lock_client() -> RedisClient:
    """Get or create the Redis client for locking."""
    global _lock_client
    if _lock_client is None:
        _lock_client = get_redis_client(settings.redis_url)
    await _lock_client.connect()
    return _lock_client


async def try_acquire_task_lock(
    task_name: str,
    ttl_seconds: int = 300,
    fail_closed: bool = True,
) -> bool:
    """Try to acquire a distributed lock for a background task.

    Args:
        task_name: Unique identifier for the task (e.g., "heartbeat", "server_sync")
        ttl_seconds: Lock expiration time. Should be > max expected execution time.
        fail_closed: If True, return False on Redis errors (skip task).
                     If False, return True on Redis errors (proceed anyway).
                     Default is True for safety in horizontal scaling.

    Returns:
        True if lock acquired (proceed with task), False if another instance has it
        or if Redis fails and fail_closed=True.
    """
    try:
        client = await _get_lock_client()
        redis = client.client
        # SET NX = only if not exists, EX = expire after ttl_seconds
        result = await redis.set(
            f"podex:compute:task:lock:{task_name}",
            "1",
            nx=True,
            ex=ttl_seconds,
        )
        return result is True
    except Exception as e:
        if fail_closed:
            logger.warning(
                "Failed to acquire task lock, skipping task (fail-closed)",
                task=task_name,
                error=str(e),
            )
            return False
        else:
            logger.warning(
                "Failed to acquire task lock, proceeding anyway (fail-open)",
                task=task_name,
                error=str(e),
            )
            return True


async def release_task_lock(task_name: str) -> None:
    """Release a distributed task lock.

    Should be called after task completion. Lock also auto-expires via TTL.

    Args:
        task_name: The task lock to release.
    """
    try:
        client = await _get_lock_client()
        redis = client.client
        await redis.delete(f"podex:compute:task:lock:{task_name}")
    except Exception as e:
        # Non-critical - lock will expire via TTL
        logger.debug("Failed to release task lock", task=task_name, error=str(e))
