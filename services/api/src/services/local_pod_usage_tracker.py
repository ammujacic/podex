"""Local pod compute usage tracking service.

Tracks compute usage for workspaces running on local pods.
Unlike cloud compute (tracked by the compute service), local pod usage
is tracked here in the API service since local pods connect directly to API.

Multi-Worker Architecture:
- Last tracked time is stored in Redis to ensure consistency across workers
- Only one worker should run the tracking loop (coordinated via Redis lock)
"""

import asyncio
import contextlib
from datetime import UTC, datetime
from typing import Any

import redis.asyncio as aioredis
import structlog
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from src.config import settings
from src.database.connection import async_session_factory
from src.database.models import PlatformSetting, Workspace
from src.websocket.local_pod_hub import is_pod_online

logger = structlog.get_logger()

# Tracking interval in seconds (same as cloud compute)
TRACKING_INTERVAL_SECONDS = 60

# Redis key patterns
LAST_TRACKED_KEY = "podex:local_pod:last_tracked:{workspace_id}"
TRACKER_LOCK_KEY = "podex:local_pod:tracker_lock"
LAST_TRACKED_TTL = 3600  # 1 hour TTL

# Redis client
_redis: aioredis.Redis | None = None  # type: ignore[type-arg]


async def _get_redis() -> aioredis.Redis:  # type: ignore[type-arg]
    """Get or create Redis client."""
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis


async def _get_last_tracked(workspace_id: str) -> datetime | None:
    """Get last tracked time from Redis."""
    try:
        redis = await _get_redis()
        key = LAST_TRACKED_KEY.format(workspace_id=workspace_id)
        value = await redis.get(key)
        if value:
            return datetime.fromisoformat(value)
    except Exception as e:
        logger.warning("Failed to get last tracked time from Redis", error=str(e))
    return None


async def _set_last_tracked(workspace_id: str, timestamp: datetime) -> None:
    """Set last tracked time in Redis."""
    try:
        redis = await _get_redis()
        key = LAST_TRACKED_KEY.format(workspace_id=workspace_id)
        await redis.setex(key, LAST_TRACKED_TTL, timestamp.isoformat())
    except Exception as e:
        logger.warning("Failed to set last tracked time in Redis", error=str(e))


async def _delete_last_tracked(workspace_id: str) -> None:
    """Delete last tracked time from Redis."""
    try:
        redis = await _get_redis()
        key = LAST_TRACKED_KEY.format(workspace_id=workspace_id)
        await redis.delete(key)
    except Exception as e:
        logger.warning("Failed to delete last tracked time from Redis", error=str(e))


async def get_local_pod_pricing() -> dict[str, Any]:
    """Get local pod pricing configuration from platform settings."""
    async with async_session_factory() as db:
        result = await db.execute(
            select(PlatformSetting).where(PlatformSetting.key == "local_pod_pricing")
        )
        setting = result.scalar_one_or_none()

        if setting and setting.value and isinstance(setting.value, dict):
            return setting.value

    # Default pricing (free)
    return {
        "hourly_rate_cents": 0,
        "description": "Your local machine",
        "billing_enabled": False,
    }


async def track_local_pod_workspaces() -> None:
    """Track compute usage for all running local pod workspaces.

    This function should be called periodically (every TRACKING_INTERVAL_SECONDS).
    It finds all running workspaces on local pods and records their usage.
    """
    try:
        pricing = await get_local_pod_pricing()

        # Skip if billing is disabled for local pods
        if not pricing.get("billing_enabled", False):
            return

        hourly_rate_cents = pricing.get("hourly_rate_cents", 0)

        # Find all running workspaces on local pods
        async with async_session_factory() as db:
            result = await db.execute(
                select(Workspace)
                .options(selectinload(Workspace.session))
                .where(
                    Workspace.local_pod_id.isnot(None),
                    Workspace.status == "running",
                )
            )
            workspaces = result.scalars().all()

            now = datetime.now(UTC)

            for workspace in workspaces:
                try:
                    # Skip if pod is offline or local_pod_id is None
                    if not workspace.local_pod_id or not is_pod_online(workspace.local_pod_id):
                        logger.debug(
                            "Skipping usage tracking for workspace on offline pod",
                            workspace_id=workspace.id,
                            local_pod_id=workspace.local_pod_id,
                        )
                        continue

                    # Calculate duration since last track (from Redis)
                    last_time = await _get_last_tracked(workspace.id)
                    if last_time is None:
                        # First time tracking this workspace, use 1 interval
                        duration_seconds = TRACKING_INTERVAL_SECONDS
                    else:
                        duration_seconds = int((now - last_time).total_seconds())

                    # Update last tracked time in Redis
                    await _set_last_tracked(workspace.id, now)

                    # Skip if duration is too small (likely duplicate tracking)
                    if duration_seconds < 30:
                        continue

                    # Skip if no session (shouldn't happen but be safe)
                    if not workspace.session:
                        continue

                    # At this point we know local_pod_id is not None (checked earlier)
                    assert workspace.local_pod_id is not None  # noqa: S101

                    # Record usage
                    await _record_local_pod_usage(
                        user_id=workspace.session.owner_id,
                        workspace_id=workspace.id,
                        session_id=workspace.session.id,
                        duration_seconds=duration_seconds,
                        hourly_rate_cents=hourly_rate_cents,
                        local_pod_id=workspace.local_pod_id,
                    )

                    # Update workspace last_usage_recorded timestamp
                    await db.execute(
                        update(Workspace)
                        .where(Workspace.id == workspace.id)
                        .values(last_usage_recorded=now, updated_at=now)
                    )

                except Exception:
                    logger.exception(
                        "Failed to track usage for local pod workspace",
                        workspace_id=workspace.id,
                        local_pod_id=workspace.local_pod_id,
                    )

            await db.commit()

    except Exception:
        logger.exception("Failed to track local pod workspaces usage")


async def _record_local_pod_usage(
    user_id: str,
    workspace_id: str,
    session_id: str | None,
    duration_seconds: int,
    hourly_rate_cents: int,
    local_pod_id: str,
) -> None:
    """Record compute usage for a local pod workspace.

    Uses the billing API to record usage with source='local'.
    """
    # Calculate cost based on duration and hourly rate
    from decimal import ROUND_HALF_UP, Decimal  # noqa: PLC0415

    from src.database.connection import get_db_context  # noqa: PLC0415
    from src.database.models import UsageRecord  # noqa: PLC0415

    hours = Decimal(duration_seconds) / Decimal(3600)
    total_cost_decimal = hours * Decimal(hourly_rate_cents)
    total_cost_cents = int(total_cost_decimal.quantize(Decimal(1), rounding=ROUND_HALF_UP))

    # Price per second
    unit_price_cents = hourly_rate_cents // 3600 if hourly_rate_cents > 0 else 0

    # Create usage record directly in database
    async with get_db_context() as db:
        record = UsageRecord(
            user_id=user_id,
            session_id=session_id,
            workspace_id=workspace_id,
            usage_type="compute_seconds",
            quantity=duration_seconds,
            unit="seconds",
            unit_price_cents=unit_price_cents,
            total_cost_cents=total_cost_cents,
            tier="local_pod",
            usage_source="local",  # Mark as local usage
            record_metadata={
                "local_pod_id": local_pod_id,
                "hourly_rate_cents": hourly_rate_cents,
            },
        )
        db.add(record)
        await db.commit()

        logger.debug(
            "Recorded local pod compute usage",
            user_id=user_id,
            workspace_id=workspace_id,
            duration_seconds=duration_seconds,
            cost_cents=total_cost_cents,
            local_pod_id=local_pod_id,
        )


async def cleanup_tracking_state(workspace_id: str) -> None:
    """Clean up tracking state when a workspace is stopped/deleted."""
    await _delete_last_tracked(workspace_id)


class LocalPodUsageTracker:
    """Background task manager for local pod usage tracking.

    Multi-Worker Architecture:
    - Uses Redis distributed lock to ensure only one worker runs tracking at a time
    - Other workers will skip if lock is held
    - Lock auto-expires to handle worker crashes
    """

    def __init__(self) -> None:
        self._running = False
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Start the background usage tracking task."""
        if self._running:
            return

        self._running = True
        self._task = asyncio.create_task(self._run_tracking_loop())
        logger.info("Local pod usage tracker started")

    async def stop(self) -> None:
        """Stop the background usage tracking task."""
        self._running = False

        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

        logger.info("Local pod usage tracker stopped")

    async def _acquire_tracking_lock(self) -> bool:
        """Try to acquire distributed lock for tracking.

        Returns True if lock acquired, False if another worker has it.
        """
        try:
            redis = await _get_redis()
            # Try to set lock with NX (only if not exists) and EX (expiry)
            # Lock expires after 2x tracking interval to handle crashes
            acquired = await redis.set(
                TRACKER_LOCK_KEY,
                "locked",
                nx=True,
                ex=TRACKING_INTERVAL_SECONDS * 2,
            )
            return bool(acquired)
        except Exception as e:
            logger.warning("Failed to acquire tracking lock", error=str(e))
            return False

    async def _extend_tracking_lock(self) -> None:
        """Extend the tracking lock TTL."""
        try:
            redis = await _get_redis()
            await redis.expire(TRACKER_LOCK_KEY, TRACKING_INTERVAL_SECONDS * 2)
        except Exception as e:
            logger.warning("Failed to extend tracking lock", error=str(e))

    async def _release_tracking_lock(self) -> None:
        """Release the tracking lock."""
        try:
            redis = await _get_redis()
            await redis.delete(TRACKER_LOCK_KEY)
        except Exception as e:
            logger.warning("Failed to release tracking lock", error=str(e))

    async def _run_tracking_loop(self) -> None:
        """Run the tracking loop with distributed locking."""
        while self._running:
            try:
                await asyncio.sleep(TRACKING_INTERVAL_SECONDS)

                # Try to acquire lock - only one worker will succeed
                if await self._acquire_tracking_lock():
                    try:
                        await track_local_pod_workspaces()
                        # Extend lock while we hold it
                        await self._extend_tracking_lock()
                    finally:
                        await self._release_tracking_lock()
                else:
                    logger.debug("Skipping tracking - another worker has the lock")

            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Error in local pod usage tracking loop")


# Singleton instance
local_pod_usage_tracker = LocalPodUsageTracker()
