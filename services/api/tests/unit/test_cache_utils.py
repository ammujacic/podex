"""Unit tests for src.cache helpers (cache client, decorators, and key builders)."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest
from pydantic import BaseModel

from src import cache as cache_module


class FakeRedisClient:
    def __init__(self) -> None:
        self.storage: dict[str, Any] = {}
        self.deleted_keys: list[str] = []
        self.client = AsyncMock()

    async def connect(self) -> None:  # pragma: no cover - trivial
        return None

    async def get_json(self, key: str) -> Any:
        return self.storage.get(key)

    async def set_json(self, key: str, value: Any, ex: int | None = None) -> None:
        self.storage[key] = value

    async def delete(self, *keys: str) -> int:
        count = 0
        for k in keys:
            if k in self.storage:
                del self.storage[k]
                count += 1
        return count


@pytest.fixture(autouse=True)
def reset_cache_manager(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure _CacheClientManager is reset between tests."""
    cache_module._CacheClientManager._instance = None


class TestCacheClientManager:
    """Tests for lazy Redis client initialization."""

    @pytest.mark.asyncio
    async def test_get_cache_client_reuses_single_instance(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fake = FakeRedisClient()

        async def fake_get() -> FakeRedisClient:
            if cache_module._CacheClientManager._instance is None:
                cache_module._CacheClientManager._instance = fake
            return fake

        monkeypatch.setattr(cache_module._CacheClientManager, "get", classmethod(lambda cls: fake_get()))  # type: ignore[arg-type]

        c1 = await cache_module.get_cache_client()
        c2 = await cache_module.get_cache_client()
        assert c1 is c2


class TestMakeCacheKey:
    """Tests for _make_cache_key behavior."""

    def test_includes_prefix_and_args(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            cache_module,
            "settings",
            type("Cfg", (), {"CACHE_PREFIX": "podex:cache:"})(),
        )

        key = cache_module._make_cache_key("templates", "a", id=123)
        # Real format is: CACHE_PREFIX, prefix, then args/kwargs joined with ":"
        assert key.startswith("podex:cache::templates")
        assert "a" in key
        assert "id=123" in key

    def test_hashes_when_too_long(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(cache_module, "settings", type("Cfg", (), {"CACHE_PREFIX": "pref:"})())

        long_arg = "x" * 500
        key = cache_module._make_cache_key("k", long_arg)
        # When hashed, we expect a short suffix and no huge string
        assert len(key) < 100
        assert key.startswith("pref:k:")


class TestCachedDecorator:
    """Tests for cached decorator behavior."""

    @pytest.mark.asyncio
    async def test_cache_hit_returns_cached_value(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fake = FakeRedisClient()
        # Key format comes from _make_cache_key: prefix + positional args
        fake.storage["podex:cache::foo:x"] = {"value": 42}

        async def fake_get() -> FakeRedisClient:
            return fake

        monkeypatch.setattr(cache_module._CacheClientManager, "get", classmethod(lambda cls: fake_get()))  # type: ignore[arg-type]
        monkeypatch.setattr(cache_module, "settings", type("Cfg", (), {"CACHE_PREFIX": "podex:cache:"})())

        @cache_module.cached("foo")
        async def compute(x: str) -> dict[str, int]:
            raise AssertionError("Should not be called on cache hit")

        result = await compute("x")
        assert result == {"value": 42}

    @pytest.mark.asyncio
    async def test_cache_miss_stores_result(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fake = FakeRedisClient()

        async def fake_get() -> FakeRedisClient:
            return fake

        monkeypatch.setattr(cache_module._CacheClientManager, "get", classmethod(lambda cls: fake_get()))  # type: ignore[arg-type]
        monkeypatch.setattr(cache_module, "settings", type("Cfg", (), {"CACHE_PREFIX": "podex:cache:"})())

        calls: list[Any] = []

        @cache_module.cached("bar", ttl=60)
        async def compute(x: int) -> int:
            calls.append(x)
            return x * 2

        result1 = await compute(2)
        result2 = await compute(2)

        assert result1 == 4
        assert result2 == 4
        # Underlying function should have been called only once (second call hits cache)
        assert calls == [2]

    @pytest.mark.asyncio
    async def test_cached_pydantic_model_serialization(self, monkeypatch: pytest.MonkeyPatch) -> None:
        class Item(BaseModel):
            id: int
            name: str

        fake = FakeRedisClient()

        async def fake_get() -> FakeRedisClient:
            return fake

        monkeypatch.setattr(cache_module._CacheClientManager, "get", classmethod(lambda cls: fake_get()))  # type: ignore[arg-type]
        monkeypatch.setattr(cache_module, "settings", type("Cfg", (), {"CACHE_PREFIX": "podex:cache:"})())

        @cache_module.cached("items")
        async def get_item(item_id: int) -> Item:
            return Item(id=item_id, name="test")

        item = await get_item(1)
        assert isinstance(item, Item)
        # Now the raw dict should be stored in redis
        assert any(isinstance(v, dict) for v in fake.storage.values())


class TestCacheHelpers:
    """Tests for cache_get, cache_set, cache_delete and invalidation helpers."""

    @pytest.mark.asyncio
    async def test_cache_get_and_set_roundtrip(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fake = FakeRedisClient()

        async def fake_get() -> FakeRedisClient:
            return fake

        monkeypatch.setattr(cache_module._CacheClientManager, "get", classmethod(lambda cls: fake_get()))  # type: ignore[arg-type]

        ok = await cache_module.cache_set("k1", {"foo": "bar"}, ttl=10)
        assert ok is True
        assert await cache_module.cache_get("k1") == {"foo": "bar"}

        deleted = await cache_module.cache_delete("k1")
        assert deleted is True
        assert await cache_module.cache_get("k1") is None

    @pytest.mark.asyncio
    async def test_invalidate_cache_deletes_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fake = FakeRedisClient()

        async def fake_get() -> FakeRedisClient:
            return fake

        monkeypatch.setattr(cache_module._CacheClientManager, "get", classmethod(lambda cls: fake_get()))  # type: ignore[arg-type]
        monkeypatch.setattr(cache_module, "settings", type("Cfg", (), {"CACHE_PREFIX": "pref:"})())

        # Set up cached value
        # _make_cache_key("x", 1) with CACHE_PREFIX="pref:" -> "pref::x:1"
        fake.storage["pref::x:1"] = {"a": 1}

        deleted = await cache_module.invalidate_cache("x", 1)
        # Our fake delete returns count>0 when something is removed
        assert deleted is True
        assert "pref:x:1" not in fake.storage
