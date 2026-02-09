"""Real-time cost tracking for LLM usage.

Multi-Worker Architecture:
- All session cost data is stored in Redis for cross-worker visibility
- Usage records are stored as Redis lists with TTL-based expiration
- Cleanup is coordinated via distributed lock to prevent duplicate work
"""

import asyncio
import contextlib
import json
import os
import uuid
from collections import defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from enum import Enum
from typing import Any

import redis.asyncio as aioredis
import structlog

from src.config import settings
from src.services.pricing import (
    UnknownModelError,
    get_all_pricing_from_cache,
    get_pricing_from_cache,
)

logger = structlog.get_logger(__name__)

# Memory management configuration
MAX_USAGE_RECORDS_PER_SESSION = 1000  # Maximum usage records to keep per session
SESSION_RETENTION_DAYS = 7  # Days to keep session data before cleanup
CLEANUP_INTERVAL_SECONDS = 3600  # Run cleanup every hour

# Redis keys for cost tracking
COST_SESSION_USAGE_KEY = "podex:cost:session:{session_id}:usage"  # List of usage records
COST_SESSION_ACTIVITY_KEY = "podex:cost:session:{session_id}:activity"  # Last activity timestamp
COST_USER_SESSIONS_KEY = "podex:cost:user:{user_id}:sessions"  # Set of session IDs
COST_CLEANUP_LOCK_KEY = "podex:cost:cleanup_lock"
COST_SESSION_TTL = SESSION_RETENTION_DAYS * 24 * 3600  # 7 days in seconds

# Worker ID for distributed lock
WORKER_ID = f"worker-{os.getpid()}-{uuid.uuid4().hex[:8]}"

# Redis client singleton
_redis: aioredis.Redis | None = None  # type: ignore[type-arg]


async def _get_redis() -> aioredis.Redis:  # type: ignore[type-arg]
    """Get or create Redis client."""
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis


# Token divisor for cost calculation (cost per million tokens)
TOKENS_PER_MILLION = 1000000


class ModelProvider(str, Enum):
    """Supported model providers."""

    ANTHROPIC = "anthropic"
    OPENAI = "openai"
    GOOGLE = "google"


@dataclass
class ModelPricingRT:
    """Pricing per million tokens for a model (realtime tracker internal)."""

    input_per_million: Decimal
    output_per_million: Decimal
    cached_input_per_million: Decimal | None = None  # For models with caching


@dataclass
class TokenUsage:
    """Token usage for a single LLM call."""

    input_tokens: int
    output_tokens: int
    cached_input_tokens: int = 0
    model: str = ""
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))
    agent_id: str | None = None
    call_id: str = field(default_factory=lambda: str(uuid.uuid4()))

    def to_dict(self) -> dict[str, Any]:
        """Convert to JSON-serializable dict."""
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cached_input_tokens": self.cached_input_tokens,
            "model": self.model,
            "timestamp": self.timestamp.isoformat(),
            "agent_id": self.agent_id,
            "call_id": self.call_id,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TokenUsage":
        """Create from dict."""
        return cls(
            input_tokens=data["input_tokens"],
            output_tokens=data["output_tokens"],
            cached_input_tokens=data.get("cached_input_tokens", 0),
            model=data.get("model", ""),
            timestamp=datetime.fromisoformat(data["timestamp"]),
            agent_id=data.get("agent_id"),
            call_id=data.get("call_id", str(uuid.uuid4())),
        )


@dataclass
class CostBreakdown:
    """Cost breakdown for a session or agent."""

    input_cost: Decimal = Decimal(0)
    output_cost: Decimal = Decimal(0)
    cached_input_cost: Decimal = Decimal(0)
    total_cost: Decimal = Decimal(0)
    input_tokens: int = 0
    output_tokens: int = 0
    cached_input_tokens: int = 0
    total_tokens: int = 0
    call_count: int = 0
    by_model: dict[str, "CostBreakdown"] = field(default_factory=dict)
    by_agent: dict[str, "CostBreakdown"] = field(default_factory=dict)

    def add(self, other: "CostBreakdown") -> None:
        """Add another cost breakdown to this one."""
        self.input_cost += other.input_cost
        self.output_cost += other.output_cost
        self.cached_input_cost += other.cached_input_cost
        self.total_cost += other.total_cost
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.cached_input_tokens += other.cached_input_tokens
        self.total_tokens += other.total_tokens
        self.call_count += other.call_count

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "input_cost": float(self.input_cost),
            "output_cost": float(self.output_cost),
            "cached_input_cost": float(self.cached_input_cost),
            "total_cost": float(self.total_cost),
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cached_input_tokens": self.cached_input_tokens,
            "total_tokens": self.total_tokens,
            "call_count": self.call_count,
            "by_model": {k: v.to_dict() for k, v in self.by_model.items()},
            "by_agent": {k: v.to_dict() for k, v in self.by_agent.items()},
        }


class RealtimeCostTracker:
    """
    Track costs in real-time for sessions and agents.

    Multi-Worker: All state is stored in Redis for cross-worker consistency.

    Features:
    - Real-time cost calculation per LLM call
    - Session and agent-level aggregation
    - Model-specific pricing
    - WebSocket update notifications
    """

    def __init__(self) -> None:
        # Callback for cost updates
        self._update_callback: Callable[[str, CostBreakdown], Awaitable[None]] | None = None
        # Background cleanup task
        self._cleanup_task: asyncio.Task[None] | None = None

    async def start_cleanup_task(self) -> None:
        """Start the background cleanup task for memory management.

        Call this during application startup.
        """
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())
            logger.info("Cost tracker cleanup task started", worker_id=WORKER_ID)

    async def stop_cleanup_task(self) -> None:
        """Stop the background cleanup task.

        Call this during application shutdown.
        """
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._cleanup_task
            logger.info("Cost tracker cleanup task stopped", worker_id=WORKER_ID)

    async def _cleanup_loop(self) -> None:
        """Background loop that periodically cleans up old data.

        Uses distributed lock to ensure only one worker runs cleanup at a time.
        """
        while True:
            try:
                await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
                await self._cleanup_old_sessions()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Error in cost tracker cleanup loop")

    async def _acquire_cleanup_lock(self) -> bool:
        """Try to acquire distributed lock for cleanup."""
        try:
            redis = await _get_redis()
            acquired = await redis.set(
                COST_CLEANUP_LOCK_KEY,
                WORKER_ID,
                nx=True,
                ex=CLEANUP_INTERVAL_SECONDS * 2,  # Lock expires after 2x cleanup interval
            )
            return bool(acquired)
        except Exception as e:
            logger.warning("Failed to acquire cleanup lock", error=str(e))
            return False

    async def _release_cleanup_lock(self) -> None:
        """Release the cleanup lock if we own it."""
        try:
            redis = await _get_redis()
            # Only delete if we own the lock
            current = await redis.get(COST_CLEANUP_LOCK_KEY)
            if current == WORKER_ID:
                await redis.delete(COST_CLEANUP_LOCK_KEY)
        except Exception as e:
            logger.warning("Failed to release cleanup lock", error=str(e))

    async def _cleanup_old_sessions(self) -> None:
        """Clean up sessions that haven't had activity in a while.

        Multi-Worker: Uses distributed lock to prevent duplicate cleanup.
        Note: Redis TTL handles most cleanup automatically. This is for
        cleaning up user->session mappings.
        """
        if not await self._acquire_cleanup_lock():
            logger.debug("Cleanup lock held by another worker, skipping")
            return

        try:
            redis = await _get_redis()
            now = datetime.now(UTC)
            cutoff = now - timedelta(days=SESSION_RETENTION_DAYS)
            cleaned_count = 0

            # Scan for user session keys to clean up stale references
            cursor = 0
            while True:
                cursor, keys = await redis.scan(
                    cursor, match="podex:cost:user:*:sessions", count=100
                )

                for user_key in keys:
                    # Get all sessions for this user
                    session_ids = await redis.smembers(user_key)
                    stale_sessions = []

                    for session_id in session_ids:
                        # Check if session still has activity data
                        activity_key = COST_SESSION_ACTIVITY_KEY.format(session_id=session_id)
                        activity_ts = await redis.get(activity_key)

                        if not activity_ts:
                            # No activity key = session expired via TTL
                            stale_sessions.append(session_id)
                        else:
                            try:
                                last_activity = datetime.fromisoformat(activity_ts)
                                if last_activity < cutoff:
                                    stale_sessions.append(session_id)
                            except (ValueError, TypeError):
                                stale_sessions.append(session_id)

                    # Remove stale sessions from user set
                    if stale_sessions:
                        await redis.srem(user_key, *stale_sessions)
                        cleaned_count += len(stale_sessions)

                    # Remove empty user sets
                    if await redis.scard(user_key) == 0:
                        await redis.delete(user_key)

                if cursor == 0:
                    break

            if cleaned_count > 0:
                logger.info(
                    "Cost tracker cleanup completed",
                    removed_sessions=cleaned_count,
                    worker_id=WORKER_ID,
                )
        finally:
            await self._release_cleanup_lock()

    async def _add_usage_to_redis(self, session_id: str, usage: TokenUsage) -> None:
        """Add a usage record to Redis list for session."""
        try:
            redis = await _get_redis()
            usage_key = COST_SESSION_USAGE_KEY.format(session_id=session_id)
            activity_key = COST_SESSION_ACTIVITY_KEY.format(session_id=session_id)

            # Add usage record to list
            await redis.rpush(usage_key, json.dumps(usage.to_dict()))

            # Trim to max records
            await redis.ltrim(usage_key, -MAX_USAGE_RECORDS_PER_SESSION, -1)

            # Update activity timestamp
            await redis.set(activity_key, datetime.now(UTC).isoformat())

            # Set/refresh TTL on both keys
            await redis.expire(usage_key, COST_SESSION_TTL)
            await redis.expire(activity_key, COST_SESSION_TTL)
        except Exception as e:
            logger.warning("Failed to add usage to Redis", session_id=session_id, error=str(e))

    async def _get_usage_from_redis(self, session_id: str) -> list[TokenUsage]:
        """Get all usage records for a session from Redis."""
        try:
            redis = await _get_redis()
            usage_key = COST_SESSION_USAGE_KEY.format(session_id=session_id)
            records = await redis.lrange(usage_key, 0, -1)
            return [TokenUsage.from_dict(json.loads(r)) for r in records]
        except Exception as e:
            logger.warning("Failed to get usage from Redis", session_id=session_id, error=str(e))
            return []

    async def _add_user_session(self, user_id: str, session_id: str) -> None:
        """Track user -> session mapping in Redis."""
        try:
            redis = await _get_redis()
            user_key = COST_USER_SESSIONS_KEY.format(user_id=user_id)
            await redis.sadd(user_key, session_id)
            # Set long TTL for user session sets
            await redis.expire(user_key, COST_SESSION_TTL * 2)
        except Exception as e:
            logger.warning("Failed to add user session", user_id=user_id, error=str(e))

    async def _get_user_sessions(self, user_id: str) -> list[str]:
        """Get all session IDs for a user from Redis."""
        try:
            redis = await _get_redis()
            user_key = COST_USER_SESSIONS_KEY.format(user_id=user_id)
            return list(await redis.smembers(user_key))
        except Exception as e:
            logger.warning("Failed to get user sessions", user_id=user_id, error=str(e))
            return []

    def set_update_callback(
        self, callback: Callable[[str, CostBreakdown], Awaitable[None]]
    ) -> None:
        """Set callback for cost update notifications."""
        self._update_callback = callback

    def get_pricing(self, model: str) -> ModelPricingRT:
        """Get pricing for a model from the database.

        Uses pricing from the database via the pricing service cache.
        Raises ValueError if no pricing is configured for the model.
        """
        # Try exact match from pricing service cache
        cached_pricing = get_pricing_from_cache(model)
        if cached_pricing:
            return ModelPricingRT(
                input_per_million=cached_pricing.input_price_per_million,
                output_per_million=cached_pricing.output_price_per_million,
                cached_input_per_million=cached_pricing.cached_input_price_per_million,
            )

        # Try partial match
        model_lower = model.lower()
        all_pricing = get_all_pricing_from_cache()
        for known_model, pricing in all_pricing.items():
            if known_model.lower() in model_lower or model_lower in known_model.lower():
                return ModelPricingRT(
                    input_per_million=pricing.input_price_per_million,
                    output_per_million=pricing.output_price_per_million,
                    cached_input_per_million=pricing.cached_input_price_per_million,
                )

        raise UnknownModelError(model)

    def calculate_cost(self, usage: TokenUsage) -> CostBreakdown:
        """Calculate cost for a single usage record."""
        pricing = self.get_pricing(usage.model)

        input_cost = (
            Decimal(usage.input_tokens) / Decimal(TOKENS_PER_MILLION)
        ) * pricing.input_per_million
        output_cost = (
            Decimal(usage.output_tokens) / Decimal(TOKENS_PER_MILLION)
        ) * pricing.output_per_million

        cached_input_cost = Decimal(0)
        if usage.cached_input_tokens and pricing.cached_input_per_million:
            cached_input_cost = (
                Decimal(usage.cached_input_tokens) / Decimal(TOKENS_PER_MILLION)
            ) * pricing.cached_input_per_million

        total_cost = input_cost + output_cost + cached_input_cost

        return CostBreakdown(
            input_cost=input_cost,
            output_cost=output_cost,
            cached_input_cost=cached_input_cost,
            total_cost=total_cost,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cached_input_tokens=usage.cached_input_tokens,
            total_tokens=usage.input_tokens + usage.output_tokens + usage.cached_input_tokens,
            call_count=1,
        )

    async def track_usage(
        self,
        session_id: str,
        usage: TokenUsage,
        user_id: str | None = None,
    ) -> CostBreakdown:
        """
        Track token usage for a session.

        Multi-Worker: Stores usage in Redis for cross-worker visibility.

        Returns the cost breakdown for this usage.
        """
        # Store usage in Redis
        await self._add_usage_to_redis(session_id, usage)

        # Track user -> session mapping
        if user_id:
            await self._add_user_session(user_id, session_id)

        # Calculate cost for this usage
        cost = self.calculate_cost(usage)

        # Get updated session cost
        session_cost = await self._calculate_session_cost(session_id)

        # Notify via callback
        if self._update_callback:
            try:
                await self._update_callback(session_id, session_cost)
            except Exception:
                logger.exception("Cost update callback failed")

        return cost

    async def _calculate_session_cost(self, session_id: str) -> CostBreakdown:
        """Calculate total cost for a session from Redis data."""
        breakdown = CostBreakdown()

        usages = await self._get_usage_from_redis(session_id)
        for usage in usages:
            cost = self.calculate_cost(usage)
            breakdown.add(cost)

            # Track by model
            if usage.model not in breakdown.by_model:
                breakdown.by_model[usage.model] = CostBreakdown()
            breakdown.by_model[usage.model].add(cost)

            # Track by agent
            if usage.agent_id:
                if usage.agent_id not in breakdown.by_agent:
                    breakdown.by_agent[usage.agent_id] = CostBreakdown()
                breakdown.by_agent[usage.agent_id].add(cost)

        return breakdown

    async def get_session_cost(self, session_id: str) -> CostBreakdown:
        """Get current cost for a session."""
        return await self._calculate_session_cost(session_id)

    async def get_agent_cost(self, session_id: str, agent_id: str) -> CostBreakdown:
        """Get cost for a specific agent in a session."""
        session_cost = await self._calculate_session_cost(session_id)
        return session_cost.by_agent.get(agent_id, CostBreakdown())

    async def get_user_cost(
        self,
        user_id: str,
        since: datetime | None = None,
    ) -> CostBreakdown:
        """Get total cost for a user across all sessions."""
        breakdown = CostBreakdown()

        session_ids = await self._get_user_sessions(user_id)
        for session_id in session_ids:
            usages = await self._get_usage_from_redis(session_id)
            for usage in usages:
                if since and usage.timestamp < since:
                    continue
                cost = self.calculate_cost(usage)
                breakdown.add(cost)

                if usage.model not in breakdown.by_model:
                    breakdown.by_model[usage.model] = CostBreakdown()
                breakdown.by_model[usage.model].add(cost)

        return breakdown

    async def get_usage_history(
        self,
        session_id: str,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Get recent usage history for a session."""
        usages = await self._get_usage_from_redis(session_id)
        usages = usages[-limit:]  # Get last N records
        return [
            {
                "call_id": u.call_id,
                "model": u.model,
                "input_tokens": u.input_tokens,
                "output_tokens": u.output_tokens,
                "cached_input_tokens": u.cached_input_tokens,
                "cost": float(self.calculate_cost(u).total_cost),
                "timestamp": u.timestamp.isoformat(),
                "agent_id": u.agent_id,
            }
            for u in usages
        ]

    async def get_daily_usage(
        self,
        user_id: str,
        days: int = 30,
    ) -> list[dict[str, Any]]:
        """Get daily usage aggregates for a user."""
        cutoff = datetime.now(UTC) - timedelta(days=days)
        daily: dict[str, CostBreakdown] = defaultdict(CostBreakdown)

        session_ids = await self._get_user_sessions(user_id)
        for session_id in session_ids:
            usages = await self._get_usage_from_redis(session_id)
            for usage in usages:
                if usage.timestamp < cutoff:
                    continue
                day = usage.timestamp.strftime("%Y-%m-%d")
                cost = self.calculate_cost(usage)
                daily[day].add(cost)

        return [
            {
                "date": date,
                **breakdown.to_dict(),
            }
            for date, breakdown in sorted(daily.items())
        ]

    async def reset_session(self, session_id: str) -> None:
        """Reset tracking for a session."""
        try:
            redis = await _get_redis()
            usage_key = COST_SESSION_USAGE_KEY.format(session_id=session_id)
            activity_key = COST_SESSION_ACTIVITY_KEY.format(session_id=session_id)
            await redis.delete(usage_key, activity_key)
        except Exception as e:
            logger.warning("Failed to reset session in Redis", session_id=session_id, error=str(e))

    def estimate_cost(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int,
        cached_input_tokens: int = 0,
    ) -> Decimal:
        """Estimate cost before making a call."""
        usage = TokenUsage(
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cached_input_tokens=cached_input_tokens,
        )
        return self.calculate_cost(usage).total_cost


# Global instance
_tracker: RealtimeCostTracker | None = None


def get_cost_tracker() -> RealtimeCostTracker:
    """Get the global cost tracker instance."""
    global _tracker
    if _tracker is None:
        _tracker = RealtimeCostTracker()
    return _tracker
