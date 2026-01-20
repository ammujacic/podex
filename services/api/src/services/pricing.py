"""Pricing service for dynamic model pricing from database.

This module handles fetching and caching model pricing from the LLMModel table:
- Fetches pricing from database with TTL-based caching
- Provides calculate_token_cost function for cost calculation
- Supports both sync and async contexts via caching
"""

import asyncio
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import LLMModel

logger = structlog.get_logger()

# Cache TTL - pricing is refreshed every 5 minutes
PRICING_CACHE_TTL = timedelta(minutes=5)

# Default pricing for unknown models (fallback to mid-tier pricing)
DEFAULT_INPUT_PRICE_PER_MILLION = Decimal("3.00")
DEFAULT_OUTPUT_PRICE_PER_MILLION = Decimal("15.00")


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


# In-memory cache for pricing data
_pricing_cache: dict[str, ModelPricing] = {}
_cache_updated_at: datetime | None = None
_cache_lock = asyncio.Lock()


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
    await _ensure_cache_fresh(db)
    return _pricing_cache.get(model_id)


async def get_all_model_pricing(db: AsyncSession) -> dict[str, ModelPricing]:
    """Get pricing for all models.

    Args:
        db: Database session

    Returns:
        Dictionary mapping model_id to ModelPricing
    """
    await _ensure_cache_fresh(db)
    return _pricing_cache.copy()


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
        # Use default pricing for unknown models
        logger.warning(
            "Using default pricing for unknown model",
            model_id=model_id,
        )
        pricing = ModelPricing(
            model_id=model_id,
            display_name=model_id,
            provider="unknown",
            input_price_per_million=DEFAULT_INPUT_PRICE_PER_MILLION,
            output_price_per_million=DEFAULT_OUTPUT_PRICE_PER_MILLION,
        )

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

    Args:
        model_id: The model used
        input_tokens: Number of input tokens
        output_tokens: Number of output tokens
        pricing_cache: Optional pricing cache (uses global cache if not provided)

    Returns:
        Total cost in dollars as Decimal
    """
    cache = pricing_cache or _pricing_cache
    pricing = cache.get(model_id)

    if not pricing:
        # Try normalized ID
        normalized_id = _normalize_model_id(model_id)
        pricing = cache.get(normalized_id)

    if not pricing:
        # Use default pricing
        input_price = DEFAULT_INPUT_PRICE_PER_MILLION
        output_price = DEFAULT_OUTPUT_PRICE_PER_MILLION
    else:
        input_price = pricing.input_price_per_million
        output_price = pricing.output_price_per_million

    input_cost = (Decimal(input_tokens) / 1000000) * input_price
    output_cost = (Decimal(output_tokens) / 1000000) * output_price

    return input_cost + output_cost


def get_pricing_from_cache(model_id: str) -> ModelPricing | None:
    """Get pricing from the in-memory cache without database access.

    Useful for real-time tracking where database access is not desired.

    Args:
        model_id: The model identifier

    Returns:
        ModelPricing if cached, None otherwise
    """
    pricing = _pricing_cache.get(model_id)
    if not pricing:
        normalized_id = _normalize_model_id(model_id)
        pricing = _pricing_cache.get(normalized_id)
    return pricing


def get_all_pricing_from_cache() -> dict[str, ModelPricing]:
    """Get all pricing from the in-memory cache.

    Returns:
        Dictionary of model_id to ModelPricing
    """
    return _pricing_cache.copy()


async def refresh_pricing_cache(db: AsyncSession) -> None:
    """Force refresh the pricing cache from database.

    Args:
        db: Database session
    """
    async with _cache_lock:
        await _load_pricing_from_db(db)


async def _ensure_cache_fresh(db: AsyncSession) -> None:
    """Ensure the pricing cache is fresh, refreshing if needed."""
    now = datetime.now(UTC)

    # Check if cache needs refresh
    if _cache_updated_at is None or (now - _cache_updated_at) > PRICING_CACHE_TTL:
        async with _cache_lock:
            # Double-check after acquiring lock
            if _cache_updated_at is None or (now - _cache_updated_at) > PRICING_CACHE_TTL:
                await _load_pricing_from_db(db)


async def _load_pricing_from_db(db: AsyncSession) -> None:
    """Load all model pricing from database into cache."""
    global _pricing_cache, _cache_updated_at

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

        _pricing_cache = new_cache
        _cache_updated_at = datetime.now(UTC)

        logger.info(
            "Refreshed model pricing cache",
            model_count=len(models),
        )

    except Exception as e:
        logger.exception("Failed to load model pricing from database", error=str(e))
        # Keep existing cache if refresh fails
        if not _pricing_cache:
            # Initialize with empty cache if first load fails
            _pricing_cache = {}
            _cache_updated_at = datetime.now(UTC)


def _normalize_model_id(model_id: str) -> str:
    """Normalize model ID for lookup.

    Handles common variations like:
    - claude-opus-4-5-20251101 -> claude-opus-4-5
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
    "calculate_token_cost",
    "calculate_token_cost_sync",
    "get_all_model_pricing",
    "get_all_pricing_from_cache",
    "get_model_pricing",
    "get_pricing_from_cache",
    "refresh_pricing_cache",
]
