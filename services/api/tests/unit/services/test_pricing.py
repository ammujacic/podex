"""Unit tests for pricing service.

Tests dynamic model pricing with database caching and cost calculations.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.services.pricing import (
    ModelPricing,
    UnknownModelError,
    _normalize_model_id,
    calculate_token_cost,
    calculate_token_cost_sync,
    get_all_model_pricing,
    get_all_pricing_from_cache,
    get_model_pricing,
    get_pricing_from_cache,
    refresh_pricing_cache,
)


@pytest.fixture
def mock_db():
    """Mock database session."""
    return AsyncMock()


@pytest.fixture
def sample_pricing():
    """Sample model pricing."""
    return ModelPricing(
        model_id="claude-sonnet-4",
        display_name="Claude Sonnet 4",
        provider="anthropic",
        input_price_per_million=Decimal("3.00"),
        output_price_per_million=Decimal("15.00"),
        cached_input_price_per_million=Decimal("0.30"),
        is_available=True,
    )


@pytest.fixture(autouse=True)
async def clear_pricing_cache():
    """Clear pricing cache before each test."""
    import src.services.pricing as pricing_module

    pricing_module._local_cache = {}
    pricing_module._local_cache_updated_at = None
    yield
    # Clear after test as well
    pricing_module._local_cache = {}
    pricing_module._local_cache_updated_at = None


@pytest.mark.unit
def test_model_pricing_dataclass():
    """Test ModelPricing dataclass creation."""
    pricing = ModelPricing(
        model_id="test-model",
        display_name="Test Model",
        provider="test-provider",
        input_price_per_million=Decimal("1.00"),
        output_price_per_million=Decimal("5.00"),
    )

    assert pricing.model_id == "test-model"
    assert pricing.display_name == "Test Model"
    assert pricing.provider == "test-provider"
    assert pricing.input_price_per_million == Decimal("1.00")
    assert pricing.output_price_per_million == Decimal("5.00")
    assert pricing.cached_input_price_per_million is None
    assert pricing.is_available is True


@pytest.mark.unit
def test_normalize_model_id_with_date():
    """Test normalizing model ID with date suffix."""
    assert _normalize_model_id("claude-opus-4.5-20251101") == "claude-opus-4.5"
    assert _normalize_model_id("claude-sonnet-4-20250514") == "claude-sonnet-4"
    assert _normalize_model_id("gpt-4-20241022") == "gpt-4"


@pytest.mark.unit
def test_normalize_model_id_with_at_symbol():
    """Test normalizing model ID with @ symbol."""
    assert _normalize_model_id("claude@opus-4") == "claude-opus-4"
    assert _normalize_model_id("test@model@name") == "test-model-name"


@pytest.mark.unit
def test_normalize_model_id_no_change_needed():
    """Test normalizing model ID that doesn't need changes."""
    assert _normalize_model_id("claude-opus-4") == "claude-opus-4"
    assert _normalize_model_id("gpt-4") == "gpt-4"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_model_pricing_cache_hit(mock_db, sample_pricing):
    """Test getting model pricing from cache."""
    # Mock Redis to return the cached data
    with patch(
        "src.services.pricing._get_cache_from_redis",
        return_value={"claude-sonnet-4": sample_pricing},
    ):
        result = await get_model_pricing(mock_db, "claude-sonnet-4")

    assert result == sample_pricing
    assert result.model_id == "claude-sonnet-4"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_model_pricing_cache_miss(mock_db):
    """Test getting model pricing not in cache."""
    # Mock Redis to return empty cache and DB to return nothing
    with patch("src.services.pricing._get_cache_from_redis", return_value={}):
        result = await get_model_pricing(mock_db, "nonexistent-model")

    assert result is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_model_pricing_stale_cache_refresh(mock_db):
    """Test pricing cache refresh when stale."""
    # Mock database query
    mock_model = MagicMock()
    mock_model.model_id = "test-model"
    mock_model.display_name = "Test Model"
    mock_model.provider = "test"
    mock_model.input_cost_per_million = 2.0
    mock_model.output_cost_per_million = 10.0
    mock_model.is_enabled = True

    mock_result = MagicMock()
    mock_result.scalars().all.return_value = [mock_model]
    mock_db.execute = AsyncMock(return_value=mock_result)

    expected_pricing = ModelPricing(
        model_id="test-model",
        display_name="Test Model",
        provider="test",
        input_price_per_million=Decimal("2.0"),
        output_price_per_million=Decimal("10.0"),
        cached_input_price_per_million=Decimal("0.2"),
        is_available=True,
    )

    # First call returns None (cache miss), second call after DB load returns data
    call_count = [0]

    async def mock_get_cache():
        call_count[0] += 1
        if call_count[0] == 1:
            return None  # Cache miss
        return {"test-model": expected_pricing}  # After DB load

    with patch("src.services.pricing._get_cache_from_redis", side_effect=mock_get_cache):
        with patch("src.services.pricing._set_cache_to_redis"):
            result = await get_model_pricing(mock_db, "test-model")

    assert result is not None
    assert result.model_id == "test-model"
    mock_db.execute.assert_called_once()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_all_model_pricing(mock_db, sample_pricing):
    """Test getting all model pricing."""
    cache = {
        "model1": sample_pricing,
        "model2": sample_pricing,
    }

    with patch("src.services.pricing._get_cache_from_redis", return_value=cache):
        result = await get_all_model_pricing(mock_db)

    assert len(result) == 2
    assert "model1" in result
    assert "model2" in result


@pytest.mark.unit
@pytest.mark.asyncio
async def test_calculate_token_cost_with_known_model(mock_db, sample_pricing):
    """Test calculating token cost for known model."""
    with patch(
        "src.services.pricing._get_cache_from_redis",
        return_value={"claude-sonnet-4": sample_pricing},
    ):
        # 1M input tokens = $3.00, 1M output tokens = $15.00
        cost = await calculate_token_cost(mock_db, "claude-sonnet-4", 1000000, 1000000)

    assert cost == Decimal("18.00")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_calculate_token_cost_with_cached_tokens(mock_db, sample_pricing):
    """Test calculating token cost with cached input tokens."""
    with patch(
        "src.services.pricing._get_cache_from_redis",
        return_value={"claude-sonnet-4": sample_pricing},
    ):
        # 1M input = $3, 1M output = $15, 1M cached = $0.30
        cost = await calculate_token_cost(
            mock_db, "claude-sonnet-4", 1000000, 1000000, cached_input_tokens=1000000
        )

    assert cost == Decimal("18.30")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_calculate_token_cost_unknown_model_raises_error(mock_db):
    """Test calculating token cost for unknown model raises error."""
    import src.services.pricing as pricing_module

    pricing_module._local_cache = {}
    pricing_module._local_cache_updated_at = datetime.now(UTC)

    # Mock Redis to return None (cache miss) and DB to return empty
    with patch("src.services.pricing._get_cache_from_redis", return_value=None):
        with patch("src.services.pricing._load_pricing_from_db"):
            with pytest.raises(UnknownModelError) as exc_info:
                await calculate_token_cost(mock_db, "unknown-model", 1000000, 1000000)

    assert exc_info.value.model_id == "unknown-model"
    assert "Unknown model" in str(exc_info.value)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_calculate_token_cost_normalized_model_id(mock_db, sample_pricing):
    """Test calculating cost with model ID that needs normalization."""
    # Cache uses normalized ID
    with patch(
        "src.services.pricing._get_cache_from_redis",
        return_value={"claude-sonnet-4": sample_pricing},
    ):
        # Request with dated version - should normalize and find it
        cost = await calculate_token_cost(mock_db, "claude-sonnet-4-20250514", 1000000, 1000000)

    assert cost == Decimal("18.00")


@pytest.mark.unit
def test_calculate_token_cost_sync_with_cache(sample_pricing):
    """Test synchronous token cost calculation with cache."""
    cache = {"claude-sonnet-4": sample_pricing}

    cost = calculate_token_cost_sync("claude-sonnet-4", 1000000, 1000000, pricing_cache=cache)

    assert cost == Decimal("18.00")


@pytest.mark.unit
def test_calculate_token_cost_sync_unknown_model_raises_error():
    """Test synchronous token cost calculation for unknown model raises error."""
    with pytest.raises(UnknownModelError) as exc_info:
        calculate_token_cost_sync("unknown-model", 1000000, 1000000, pricing_cache={})

    assert exc_info.value.model_id == "unknown-model"
    assert "Unknown model" in str(exc_info.value)


@pytest.mark.unit
def test_calculate_token_cost_sync_global_cache(sample_pricing):
    """Test synchronous calculation using global cache."""
    import src.services.pricing as pricing_module

    pricing_module._local_cache = {"test-model": sample_pricing}

    cost = calculate_token_cost_sync("test-model", 500000, 500000)

    # 0.5M input = $1.50, 0.5M output = $7.50
    assert cost == Decimal("9.00")


@pytest.mark.unit
def test_calculate_token_cost_sync_normalized_id(sample_pricing):
    """Test synchronous calculation with normalized model ID."""
    cache = {"claude-sonnet-4": sample_pricing}

    cost = calculate_token_cost_sync("claude-sonnet-4-20250514", 1000000, 1000000, cache)

    assert cost == Decimal("18.00")


@pytest.mark.unit
def test_get_pricing_from_cache(sample_pricing):
    """Test getting pricing from cache without DB."""
    import src.services.pricing as pricing_module

    pricing_module._local_cache = {"test-model": sample_pricing}

    result = get_pricing_from_cache("test-model")

    assert result == sample_pricing


@pytest.mark.unit
def test_get_pricing_from_cache_not_found():
    """Test getting pricing from cache when not found."""
    import src.services.pricing as pricing_module

    pricing_module._local_cache = {}

    result = get_pricing_from_cache("nonexistent")

    assert result is None


@pytest.mark.unit
def test_get_pricing_from_cache_normalized():
    """Test getting pricing from cache with normalization."""
    import src.services.pricing as pricing_module

    sample = ModelPricing(
        model_id="claude-opus-4",
        display_name="Claude Opus 4",
        provider="anthropic",
        input_price_per_million=Decimal("10.00"),
        output_price_per_million=Decimal("50.00"),
    )
    pricing_module._local_cache = {"claude-opus-4": sample}

    result = get_pricing_from_cache("claude-opus-4-20251101")

    assert result == sample


@pytest.mark.unit
def test_get_all_pricing_from_cache(sample_pricing):
    """Test getting all pricing from cache."""
    import src.services.pricing as pricing_module

    pricing_module._local_cache = {
        "model1": sample_pricing,
        "model2": sample_pricing,
    }

    result = get_all_pricing_from_cache()

    assert len(result) == 2
    assert "model1" in result
    assert "model2" in result


@pytest.mark.unit
@pytest.mark.asyncio
async def test_refresh_pricing_cache(mock_db):
    """Test forcing pricing cache refresh."""
    import src.services.pricing as pricing_module

    mock_model = MagicMock()
    mock_model.model_id = "test-model"
    mock_model.display_name = "Test"
    mock_model.provider = "test"
    mock_model.input_cost_per_million = 5.0
    mock_model.output_cost_per_million = 25.0
    mock_model.is_enabled = True

    mock_result = MagicMock()
    mock_result.scalars().all.return_value = [mock_model]
    mock_db.execute = AsyncMock(return_value=mock_result)

    # Capture what gets set to Redis
    captured_cache = {}

    async def capture_set_cache(cache):
        captured_cache.update(cache)
        # Also update local cache as the real function does
        pricing_module._local_cache = cache.copy()

    with patch("src.services.pricing._set_cache_to_redis", side_effect=capture_set_cache):
        await refresh_pricing_cache(mock_db)

    # Check cache was populated (via local cache which is set by _set_cache_to_redis)
    result = get_pricing_from_cache("test-model")
    assert result is not None
    assert result.model_id == "test-model"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_load_pricing_with_cached_input_price(mock_db):
    """Test loading pricing calculates cached input price."""
    import src.services.pricing as pricing_module

    mock_model = MagicMock()
    mock_model.model_id = "test-model"
    mock_model.display_name = "Test"
    mock_model.provider = "test"
    mock_model.input_cost_per_million = 10.0
    mock_model.output_cost_per_million = 50.0
    mock_model.is_enabled = True

    mock_result = MagicMock()
    mock_result.scalars().all.return_value = [mock_model]
    mock_db.execute = AsyncMock(return_value=mock_result)

    # Capture what gets set to Redis
    async def capture_set_cache(cache):
        pricing_module._local_cache = cache.copy()

    with patch("src.services.pricing._set_cache_to_redis", side_effect=capture_set_cache):
        await refresh_pricing_cache(mock_db)

    pricing = get_pricing_from_cache("test-model")
    # Cached price should be 10% of input price
    assert pricing.cached_input_price_per_million == Decimal("1.0")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_load_pricing_with_normalized_ids(mock_db):
    """Test loading pricing stores both original and normalized IDs."""
    import src.services.pricing as pricing_module

    mock_model = MagicMock()
    mock_model.model_id = "claude-opus-4-20251101"
    mock_model.display_name = "Claude Opus 4"
    mock_model.provider = "anthropic"
    mock_model.input_cost_per_million = 10.0
    mock_model.output_cost_per_million = 50.0
    mock_model.is_enabled = True

    mock_result = MagicMock()
    mock_result.scalars().all.return_value = [mock_model]
    mock_db.execute = AsyncMock(return_value=mock_result)

    # Capture what gets set to Redis
    async def capture_set_cache(cache):
        pricing_module._local_cache = cache.copy()

    with patch("src.services.pricing._set_cache_to_redis", side_effect=capture_set_cache):
        await refresh_pricing_cache(mock_db)

    # Both original and normalized should be in cache
    original = get_pricing_from_cache("claude-opus-4-20251101")
    normalized = get_pricing_from_cache("claude-opus-4")

    assert original is not None
    assert normalized is not None
    assert original == normalized


@pytest.mark.unit
@pytest.mark.asyncio
async def test_load_pricing_handles_database_error(mock_db):
    """Test pricing cache initialization on database error."""
    mock_db.execute = AsyncMock(side_effect=Exception("DB error"))

    await refresh_pricing_cache(mock_db)

    # Cache should be initialized to empty dict
    cache = get_all_pricing_from_cache()
    assert cache == {}


@pytest.mark.unit
@pytest.mark.asyncio
async def test_calculate_cost_partial_tokens(mock_db, sample_pricing):
    """Test calculating cost with partial million tokens."""
    with patch(
        "src.services.pricing._get_cache_from_redis",
        return_value={"test-model": sample_pricing},
    ):
        # 100k input = $0.30, 200k output = $3.00
        cost = await calculate_token_cost(mock_db, "test-model", 100000, 200000)

    assert cost == Decimal("3.30")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_calculate_cost_zero_tokens(mock_db, sample_pricing):
    """Test calculating cost with zero tokens."""
    with patch(
        "src.services.pricing._get_cache_from_redis",
        return_value={"test-model": sample_pricing},
    ):
        cost = await calculate_token_cost(mock_db, "test-model", 0, 0)

    assert cost == Decimal("0.00")
