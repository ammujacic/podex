"""Pricing service for dynamic model pricing from database.

This module handles fetching and caching model pricing from the LLMModel table:
- Fetches pricing from database with TTL-based caching in Redis
- Provides calculate_token_cost function for cost calculation
- Supports both sync and async contexts via caching

Multi-Worker Architecture:
- Pricing cache is stored in Redis to ensure consistency across workers
- Each worker can refresh the cache, but Redis ensures all workers see the same data
- Local fallback cache used only for sync functions when Redis is unavailable
"""

import asyncio
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import redis.asyncio as aioredis
import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import LLMModel

logger = structlog.get_logger()

# Redis key for pricing cache
PRICING_CACHE_KEY = "podex:pricing:cache"
PRICING_CACHE_TTL_SECONDS = 300  # 5 minutes


class UnknownModelError(ValueError):
    """Raised when pricing is requested for an unknown model."""

    def __init__(self, model_id: str) -> None:
        self.model_id = model_id
        super().__init__(f"Unknown model: {model_id}. Model must be configured in LLMModel table.")


@dataclass
class ModelPricing:
    """Pricing information for a model."""

    model_id: str
    display_name: str
    provider: str
    input_price_per_million: Decimal
    output_price_per_million: Decimal
    cached_input_price_per_million: Decimal | None = None
    is_available: bool = True

    def to_dict(self) -> dict[str, Any]:
        """Convert to JSON-serializable dict."""
        return {
            "model_id": self.model_id,
            "display_name": self.display_name,
            "provider": self.provider,
            "input_price_per_million": str(self.input_price_per_million),
            "output_price_per_million": str(self.output_price_per_million),
            "cached_input_price_per_million": str(self.cached_input_price_per_million)
            if self.cached_input_price_per_million
            else None,
            "is_available": self.is_available,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ModelPricing":
        """Create from dict."""
        return cls(
            model_id=data["model_id"],
            display_name=data["display_name"],
            provider=data["provider"],
            input_price_per_million=Decimal(data["input_price_per_million"]),
            output_price_per_million=Decimal(data["output_price_per_million"]),
            cached_input_price_per_million=Decimal(data["cached_input_price_per_million"])
            if data.get("cached_input_price_per_million")
            else None,
            is_available=data.get("is_available", True),
        )


# Redis client for pricing cache
_redis: aioredis.Redis | None = None  # type: ignore[type-arg]
_redis_lock = asyncio.Lock()

# Local fallback cache for sync functions (populated from Redis)
_local_cache: dict[str, ModelPricing] = {}
_local_cache_updated_at: datetime | None = None


async def _get_redis() -> aioredis.Redis:  # type: ignore[type-arg]
    """Get or create Redis client."""
    global _redis
    if _redis is None:
        async with _redis_lock:
            if _redis is None:
                _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis


async def _get_cache_from_redis() -> dict[str, ModelPricing] | None:
    """Get pricing cache from Redis."""
    try:
        redis = await _get_redis()
        data = await redis.get(PRICING_CACHE_KEY)
        if data:
            cache_data = json.loads(data)
            return {k: ModelPricing.from_dict(v) for k, v in cache_data.items()}
    except Exception as e:
        logger.warning("Failed to get pricing cache from Redis", error=str(e))
    return None


async def _set_cache_to_redis(cache: dict[str, ModelPricing]) -> None:
    """Set pricing cache in Redis."""
    global _local_cache, _local_cache_updated_at
    try:
        redis = await _get_redis()
        cache_data = {k: v.to_dict() for k, v in cache.items()}
        await redis.setex(PRICING_CACHE_KEY, PRICING_CACHE_TTL_SECONDS, json.dumps(cache_data))
        # Also update local cache for sync functions
        _local_cache = cache.copy()
        _local_cache_updated_at = datetime.now(UTC)
    except Exception as e:
        logger.warning("Failed to set pricing cache in Redis", error=str(e))


async def get_model_pricing(
    db: AsyncSession,
    model_id: str,
) -> ModelPricing | None:
    """Get pricing for a specific model.

    Args:
        db: Database session
        model_id: The model identifier to look up

    Returns:
        ModelPricing if found, None otherwise
    """
    cache = await _ensure_cache_fresh(db)
    return cache.get(model_id)


async def get_all_model_pricing(db: AsyncSession) -> dict[str, ModelPricing]:
    """Get pricing for all models.

    Args:
        db: Database session

    Returns:
        Dictionary mapping model_id to ModelPricing
    """
    cache = await _ensure_cache_fresh(db)
    return cache.copy()


async def calculate_token_cost(
    db: AsyncSession,
    model_id: str,
    input_tokens: int,
    output_tokens: int,
    cached_input_tokens: int = 0,
) -> Decimal:
    """Calculate the cost for token usage.

    Args:
        db: Database session
        model_id: The model used
        input_tokens: Number of input tokens
        output_tokens: Number of output tokens
        cached_input_tokens: Number of cached input tokens (optional)

    Returns:
        Total cost in dollars as Decimal
    """
    pricing = await get_model_pricing(db, model_id)

    if not pricing:
        # Try to find a matching model by normalizing the ID
        normalized_id = _normalize_model_id(model_id)
        pricing = await get_model_pricing(db, normalized_id)

    if not pricing:
        # Raise error for unknown models - all models must be configured
        raise UnknownModelError(model_id)

    # Calculate costs
    input_cost = (Decimal(input_tokens) / 1000000) * pricing.input_price_per_million

    output_cost = (Decimal(output_tokens) / 1000000) * pricing.output_price_per_million

    cached_cost = Decimal(0)
    if cached_input_tokens and pricing.cached_input_price_per_million:
        cached_cost = (
            Decimal(cached_input_tokens) / 1000000
        ) * pricing.cached_input_price_per_million

    return input_cost + output_cost + cached_cost


def calculate_token_cost_sync(
    model_id: str,
    input_tokens: int,
    output_tokens: int,
    pricing_cache: dict[str, ModelPricing] | None = None,
) -> Decimal:
    """Synchronous version of calculate_token_cost using cached pricing.

    This is useful for contexts where async is not available but pricing
    has already been loaded into memory.

    Note: Uses local fallback cache which is populated when async cache is refreshed.

    Args:
        model_id: The model used
        input_tokens: Number of input tokens
        output_tokens: Number of output tokens
        pricing_cache: Optional pricing cache (uses local fallback cache if not provided)

    Returns:
        Total cost in dollars as Decimal
    """
    cache = pricing_cache or _local_cache
    pricing = cache.get(model_id)

    if not pricing:
        # Try normalized ID
        normalized_id = _normalize_model_id(model_id)
        pricing = cache.get(normalized_id)

    if not pricing:
        # Raise error for unknown models - all models must be configured
        raise UnknownModelError(model_id)

    input_cost = (Decimal(input_tokens) / 1000000) * pricing.input_price_per_million
    output_cost = (Decimal(output_tokens) / 1000000) * pricing.output_price_per_million

    return input_cost + output_cost


def get_pricing_from_cache(model_id: str) -> ModelPricing | None:
    """Get pricing from the local fallback cache without database access.

    Useful for real-time tracking where database access is not desired.
    Note: Returns data from local fallback cache, which may be slightly stale.

    Args:
        model_id: The model identifier

    Returns:
        ModelPricing if cached, None otherwise
    """
    pricing = _local_cache.get(model_id)
    if not pricing:
        normalized_id = _normalize_model_id(model_id)
        pricing = _local_cache.get(normalized_id)
    return pricing


def get_all_pricing_from_cache() -> dict[str, ModelPricing]:
    """Get all pricing from the local fallback cache.

    Note: Returns data from local fallback cache, which may be slightly stale.

    Returns:
        Dictionary of model_id to ModelPricing
    """
    return _local_cache.copy()


async def refresh_pricing_cache(db: AsyncSession) -> None:
    """Force refresh the pricing cache from database to Redis.

    Args:
        db: Database session
    """
    await _load_pricing_from_db(db)


async def _ensure_cache_fresh(db: AsyncSession) -> dict[str, ModelPricing]:
    """Ensure the pricing cache is fresh, refreshing if needed.

    Returns the current cache contents.
    """
    # Try to get from Redis first
    cache = await _get_cache_from_redis()
    if cache is not None:
        # Update local cache for sync functions
        global _local_cache, _local_cache_updated_at
        _local_cache = cache.copy()
        _local_cache_updated_at = datetime.now(UTC)
        return cache

    # Cache miss or expired - refresh from database
    await _load_pricing_from_db(db)

    # Return the freshly loaded cache
    cache = await _get_cache_from_redis()
    return cache or {}


async def _load_pricing_from_db(db: AsyncSession) -> None:
    """Load all model pricing from database into Redis cache."""
    global _local_cache, _local_cache_updated_at

    try:
        result = await db.execute(select(LLMModel).where(LLMModel.is_enabled == True))
        models = result.scalars().all()

        new_cache: dict[str, ModelPricing] = {}

        for model in models:
            # Calculate cached input price (typically 10% of regular input)
            cached_input_price = None
            if model.input_cost_per_million:
                cached_input_price = Decimal(str(model.input_cost_per_million)) * Decimal("0.1")

            pricing = ModelPricing(
                model_id=model.model_id,
                display_name=model.display_name,
                provider=model.provider,
                input_price_per_million=Decimal(str(model.input_cost_per_million or 0)),
                output_price_per_million=Decimal(str(model.output_cost_per_million or 0)),
                cached_input_price_per_million=cached_input_price,
                is_available=model.is_enabled,
            )
            new_cache[model.model_id] = pricing

            # Also add normalized versions for lookup
            normalized_id = _normalize_model_id(model.model_id)
            if normalized_id != model.model_id:
                new_cache[normalized_id] = pricing

        # Save to Redis
        await _set_cache_to_redis(new_cache)

        logger.info(
            "Refreshed model pricing cache in Redis",
            model_count=len(models),
        )

    except Exception as e:
        logger.exception("Failed to load model pricing from database", error=str(e))
        # Keep existing local cache if refresh fails
        if not _local_cache:
            # Initialize with empty cache if first load fails
            _local_cache = {}
            _local_cache_updated_at = datetime.now(UTC)


def _normalize_model_id(model_id: str) -> str:
    """Normalize model ID for lookup.

    Handles common variations like:
    - claude-opus-4.5-20251101 -> claude-opus-4.5
    - claude-sonnet-4-20250514 -> claude-sonnet-4

    Args:
        model_id: The original model ID

    Returns:
        Normalized model ID
    """
    # Replace @ with - (sometimes used in model IDs)
    normalized = model_id.replace("@", "-")

    # Common model ID mappings for Anthropic models with dates
    # Strip date suffix if present (e.g., -20251101)
    # Match patterns like -20251101, -20250514, -20241022
    date_pattern = r"-\d{8}$"
    return re.sub(date_pattern, "", normalized)


# Export for convenience
__all__ = [
    "ModelPricing",
    "UnknownModelError",
    "calculate_token_cost",
    "calculate_token_cost_sync",
    "get_all_model_pricing",
    "get_all_pricing_from_cache",
    "get_model_pricing",
    "get_pricing_from_cache",
    "refresh_pricing_cache",
]
