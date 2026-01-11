"""Comprehensive tests for Redis caching utilities."""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import BaseModel

from src.cache import (
    MAX_CACHE_KEY_LENGTH,
    _make_cache_key,
    cache_delete,
    cache_get,
    cache_set,
    cached,
    invalidate_cache,
    invalidate_pattern,
    session_key,
    template_key,
    templates_list_key,
    user_config_key,
    user_sessions_key,
)


class SampleModel(BaseModel):
    """Sample Pydantic model for testing."""

    id: str
    name: str
    value: int


class TestMakeCacheKey:
    """Tests for cache key generation."""

    def test_simple_key(self) -> None:
        """Test simple cache key generation."""
        key = _make_cache_key("prefix")
        assert "prefix" in key
        assert "podex:cache:" in key

    def test_key_with_string_args(self) -> None:
        """Test cache key with string arguments."""
        key = _make_cache_key("prefix", "arg1", "arg2")
        assert "arg1" in key
        assert "arg2" in key

    def test_key_with_dict_arg(self) -> None:
        """Test cache key with dict argument."""
        key = _make_cache_key("prefix", {"key": "value"})
        assert "key" in key
        assert "value" in key

    def test_key_with_pydantic_model(self) -> None:
        """Test cache key with Pydantic model argument."""
        model = SampleModel(id="123", name="test", value=42)
        key = _make_cache_key("prefix", model)
        assert "123" in key
        assert "test" in key

    def test_key_with_kwargs(self) -> None:
        """Test cache key with keyword arguments."""
        key = _make_cache_key("prefix", user_id="user-123", page=1)
        assert "user_id=user-123" in key
        assert "page=1" in key

    def test_key_with_mixed_args(self) -> None:
        """Test cache key with mixed arguments."""
        key = _make_cache_key("prefix", "arg1", user_id="user-123")
        assert "arg1" in key
        assert "user_id=user-123" in key

    def test_long_key_is_hashed(self) -> None:
        """Test that long keys are hashed."""
        long_arg = "x" * 300
        key = _make_cache_key("prefix", long_arg)
        # Key should be hashed and shorter than MAX_CACHE_KEY_LENGTH
        assert len(key) <= MAX_CACHE_KEY_LENGTH + 50  # Allow for prefix

    def test_kwargs_are_sorted(self) -> None:
        """Test that kwargs are sorted for consistent keys."""
        key1 = _make_cache_key("prefix", a=1, b=2, c=3)
        key2 = _make_cache_key("prefix", c=3, a=1, b=2)
        assert key1 == key2


class TestCacheKeyBuilders:
    """Tests for convenience cache key builders."""

    def test_templates_list_key_public(self) -> None:
        """Test templates list key for public templates."""
        key = templates_list_key()
        assert "templates:list:public" in key

    def test_templates_list_key_private(self) -> None:
        """Test templates list key for private templates."""
        key = templates_list_key(include_private=True, user_id="user-123")
        assert "templates:list:user:user-123" in key

    def test_templates_list_key_private_no_user(self) -> None:
        """Test templates list key for private without user."""
        key = templates_list_key(include_private=True, user_id=None)
        assert "templates:list:public" in key

    def test_template_key(self) -> None:
        """Test single template key."""
        key = template_key("template-123")
        assert "templates:item:template-123" in key

    def test_session_key(self) -> None:
        """Test session key."""
        key = session_key("session-123")
        assert "sessions:item:session-123" in key

    def test_user_sessions_key(self) -> None:
        """Test user sessions list key."""
        key = user_sessions_key("user-123", page=2)
        assert "sessions:user:user-123:page:2" in key

    def test_user_sessions_key_default_page(self) -> None:
        """Test user sessions list key with default page."""
        key = user_sessions_key("user-123")
        assert "sessions:user:user-123:page:1" in key

    def test_user_config_key(self) -> None:
        """Test user config key."""
        key = user_config_key("user-123")
        assert "user_config:user-123" in key


class TestCacheGet:
    """Tests for cache_get function."""

    @pytest.mark.asyncio
    async def test_cache_get_success(self) -> None:
        """Test successful cache get."""
        mock_client = MagicMock()
        mock_client.get_json = AsyncMock(return_value={"key": "value"})

        with patch("src.cache.get_cache_client", return_value=mock_client):
            result = await cache_get("test-key")
            assert result == {"key": "value"}
            mock_client.get_json.assert_called_once_with("test-key")

    @pytest.mark.asyncio
    async def test_cache_get_miss(self) -> None:
        """Test cache miss returns None."""
        mock_client = MagicMock()
        mock_client.get_json = AsyncMock(return_value=None)

        with patch("src.cache.get_cache_client", return_value=mock_client):
            result = await cache_get("nonexistent-key")
            assert result is None

    @pytest.mark.asyncio
    async def test_cache_get_error(self) -> None:
        """Test cache get error returns None."""
        with patch("src.cache.get_cache_client", side_effect=Exception("Connection error")):
            result = await cache_get("test-key")
            assert result is None


class TestCacheSet:
    """Tests for cache_set function."""

    @pytest.mark.asyncio
    async def test_cache_set_success(self) -> None:
        """Test successful cache set."""
        mock_client = MagicMock()
        mock_client.set_json = AsyncMock()

        with patch("src.cache.get_cache_client", return_value=mock_client):
            result = await cache_set("test-key", {"key": "value"}, ttl=600)
            assert result is True
            mock_client.set_json.assert_called_once_with("test-key", {"key": "value"}, ex=600)

    @pytest.mark.asyncio
    async def test_cache_set_default_ttl(self) -> None:
        """Test cache set with default TTL."""
        mock_client = MagicMock()
        mock_client.set_json = AsyncMock()

        with patch("src.cache.get_cache_client", return_value=mock_client):
            await cache_set("test-key", {"key": "value"})
            mock_client.set_json.assert_called_once_with("test-key", {"key": "value"}, ex=300)

    @pytest.mark.asyncio
    async def test_cache_set_pydantic_model(self) -> None:
        """Test cache set with Pydantic model."""
        mock_client = MagicMock()
        mock_client.set_json = AsyncMock()

        model = SampleModel(id="123", name="test", value=42)

        with patch("src.cache.get_cache_client", return_value=mock_client):
            result = await cache_set("test-key", model)
            assert result is True
            call_args = mock_client.set_json.call_args
            assert call_args[0][1]["id"] == "123"
            assert call_args[0][1]["name"] == "test"

    @pytest.mark.asyncio
    async def test_cache_set_list_of_models(self) -> None:
        """Test cache set with list of Pydantic models."""
        mock_client = MagicMock()
        mock_client.set_json = AsyncMock()

        models = [
            SampleModel(id="1", name="first", value=1),
            SampleModel(id="2", name="second", value=2),
        ]

        with patch("src.cache.get_cache_client", return_value=mock_client):
            result = await cache_set("test-key", models)
            assert result is True
            call_args = mock_client.set_json.call_args
            assert len(call_args[0][1]) == 2

    @pytest.mark.asyncio
    async def test_cache_set_error(self) -> None:
        """Test cache set error returns False."""
        with patch("src.cache.get_cache_client", side_effect=Exception("Connection error")):
            result = await cache_set("test-key", {"key": "value"})
            assert result is False


class TestCacheDelete:
    """Tests for cache_delete function."""

    @pytest.mark.asyncio
    async def test_cache_delete_success(self) -> None:
        """Test successful cache delete."""
        mock_client = MagicMock()
        mock_client.delete = AsyncMock(return_value=1)

        with patch("src.cache.get_cache_client", return_value=mock_client):
            result = await cache_delete("test-key")
            assert result is True

    @pytest.mark.asyncio
    async def test_cache_delete_not_found(self) -> None:
        """Test cache delete for non-existent key."""
        mock_client = MagicMock()
        mock_client.delete = AsyncMock(return_value=0)

        with patch("src.cache.get_cache_client", return_value=mock_client):
            result = await cache_delete("nonexistent-key")
            assert result is False

    @pytest.mark.asyncio
    async def test_cache_delete_error(self) -> None:
        """Test cache delete error returns False."""
        with patch("src.cache.get_cache_client", side_effect=Exception("Connection error")):
            result = await cache_delete("test-key")
            assert result is False


class TestInvalidateCache:
    """Tests for invalidate_cache function."""

    @pytest.mark.asyncio
    async def test_invalidate_cache_success(self) -> None:
        """Test successful cache invalidation."""
        mock_client = MagicMock()
        mock_client.delete = AsyncMock(return_value=1)

        with patch("src.cache.get_cache_client", return_value=mock_client):
            result = await invalidate_cache("prefix", "arg1", user_id="user-123")
            assert result is True

    @pytest.mark.asyncio
    async def test_invalidate_cache_not_found(self) -> None:
        """Test cache invalidation for non-existent key."""
        mock_client = MagicMock()
        mock_client.delete = AsyncMock(return_value=0)

        with patch("src.cache.get_cache_client", return_value=mock_client):
            result = await invalidate_cache("prefix", "arg1")
            assert result is False

    @pytest.mark.asyncio
    async def test_invalidate_cache_error(self) -> None:
        """Test cache invalidation error."""
        with patch("src.cache.get_cache_client", side_effect=Exception("Connection error")):
            result = await invalidate_cache("prefix", "arg1")
            assert result is False


class TestInvalidatePattern:
    """Tests for invalidate_pattern function."""

    @pytest.mark.asyncio
    async def test_invalidate_pattern_success(self) -> None:
        """Test successful pattern invalidation."""
        mock_client = MagicMock()
        # Simulate scanning finding keys and then deleting them
        mock_client.client = MagicMock()
        mock_client.client.scan = AsyncMock(
            side_effect=[(0, ["key1", "key2", "key3"])],
        )
        mock_client.delete = AsyncMock(return_value=3)

        with patch("src.cache.get_cache_client", return_value=mock_client):
            result = await invalidate_pattern("templates:*")
            assert result == 3

    @pytest.mark.asyncio
    async def test_invalidate_pattern_no_matches(self) -> None:
        """Test pattern invalidation with no matching keys."""
        mock_client = MagicMock()
        mock_client.client = MagicMock()
        mock_client.client.scan = AsyncMock(return_value=(0, []))

        with patch("src.cache.get_cache_client", return_value=mock_client):
            result = await invalidate_pattern("nonexistent:*")
            assert result == 0

    @pytest.mark.asyncio
    async def test_invalidate_pattern_error(self) -> None:
        """Test pattern invalidation error."""
        with patch("src.cache.get_cache_client", side_effect=Exception("Connection error")):
            result = await invalidate_pattern("templates:*")
            assert result == 0


class TestCachedDecorator:
    """Tests for the @cached decorator."""

    @pytest.mark.asyncio
    async def test_cached_cache_hit(self) -> None:
        """Test cached decorator with cache hit."""
        mock_client = MagicMock()
        mock_client.get_json = AsyncMock(return_value={"cached": True})

        call_count = 0

        @cached("test")
        async def my_function() -> dict[str, Any]:
            nonlocal call_count
            call_count += 1
            return {"cached": False}

        with patch("src.cache.get_cache_client", return_value=mock_client):
            result = await my_function()
            assert result == {"cached": True}
            # Function should not be called on cache hit
            assert call_count == 0

    @pytest.mark.asyncio
    async def test_cached_cache_miss(self) -> None:
        """Test cached decorator with cache miss."""
        mock_client = MagicMock()
        mock_client.get_json = AsyncMock(return_value=None)
        mock_client.set_json = AsyncMock()

        call_count = 0

        @cached("test", ttl=600)
        async def my_function() -> dict[str, Any]:
            nonlocal call_count
            call_count += 1
            return {"result": "fresh"}

        with patch("src.cache.get_cache_client", return_value=mock_client):
            result = await my_function()
            assert result == {"result": "fresh"}
            assert call_count == 1
            # Result should be cached
            mock_client.set_json.assert_called_once()

    @pytest.mark.asyncio
    async def test_cached_with_custom_key_builder(self) -> None:
        """Test cached decorator with custom key builder."""
        mock_client = MagicMock()
        mock_client.get_json = AsyncMock(return_value=None)
        mock_client.set_json = AsyncMock()

        def custom_key(arg1: str, arg2: int) -> str:
            return f"custom:{arg1}:{arg2}"

        @cached("test", key_builder=custom_key)
        async def my_function(arg1: str, arg2: int) -> dict[str, Any]:
            return {"arg1": arg1, "arg2": arg2}

        with patch("src.cache.get_cache_client", return_value=mock_client):
            await my_function("hello", 42)
            mock_client.get_json.assert_called_once_with("custom:hello:42")

    @pytest.mark.asyncio
    async def test_cached_read_error_falls_back(self) -> None:
        """Test cached decorator falls back on read error."""
        mock_client = MagicMock()
        mock_client.get_json = AsyncMock(side_effect=Exception("Read error"))
        mock_client.set_json = AsyncMock()

        @cached("test")
        async def my_function() -> dict[str, Any]:
            return {"fresh": True}

        with patch("src.cache.get_cache_client", return_value=mock_client):
            result = await my_function()
            assert result == {"fresh": True}

    @pytest.mark.asyncio
    async def test_cached_write_error_still_returns(self) -> None:
        """Test cached decorator returns result even on write error."""
        mock_client = MagicMock()
        mock_client.get_json = AsyncMock(return_value=None)
        mock_client.set_json = AsyncMock(side_effect=Exception("Write error"))

        @cached("test")
        async def my_function() -> dict[str, Any]:
            return {"result": "value"}

        with patch("src.cache.get_cache_client", return_value=mock_client):
            result = await my_function()
            assert result == {"result": "value"}

    @pytest.mark.asyncio
    async def test_cached_with_pydantic_model_result(self) -> None:
        """Test cached decorator with Pydantic model result."""
        mock_client = MagicMock()
        mock_client.get_json = AsyncMock(return_value=None)
        mock_client.set_json = AsyncMock()

        @cached("test")
        async def my_function() -> SampleModel:
            return SampleModel(id="123", name="test", value=42)

        with patch("src.cache.get_cache_client", return_value=mock_client):
            result = await my_function()
            assert result.id == "123"
            # Verify the model was serialized for caching
            call_args = mock_client.set_json.call_args
            assert call_args[0][1]["id"] == "123"

    @pytest.mark.asyncio
    async def test_cached_default_ttl(self) -> None:
        """Test cached decorator uses default TTL."""
        mock_client = MagicMock()
        mock_client.get_json = AsyncMock(return_value=None)
        mock_client.set_json = AsyncMock()

        @cached("test")
        async def my_function() -> dict[str, Any]:
            return {"result": "value"}

        with patch("src.cache.get_cache_client", return_value=mock_client):
            await my_function()
            call_args = mock_client.set_json.call_args
            assert call_args[1]["ex"] == 300  # Default TTL


class TestCacheClientManager:
    """Tests for cache client manager."""

    @pytest.mark.asyncio
    async def test_get_cache_client_creates_client(self) -> None:
        """Test that get_cache_client creates and connects client."""
        from src.cache import _CacheClientManager

        # Reset the singleton
        _CacheClientManager._instance = None

        mock_redis_client = MagicMock()
        mock_redis_client.connect = AsyncMock()

        with patch("src.cache.get_redis_client", return_value=mock_redis_client):
            from src.cache import get_cache_client

            client = await get_cache_client()
            assert client == mock_redis_client
            mock_redis_client.connect.assert_called_once()

        # Reset for other tests
        _CacheClientManager._instance = None

    @pytest.mark.asyncio
    async def test_get_cache_client_reuses_client(self) -> None:
        """Test that get_cache_client reuses existing client."""
        from src.cache import _CacheClientManager

        mock_client = MagicMock()
        _CacheClientManager._instance = mock_client

        from src.cache import get_cache_client

        client = await get_cache_client()
        assert client == mock_client

        # Reset for other tests
        _CacheClientManager._instance = None
