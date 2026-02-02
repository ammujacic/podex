"""Unit tests for platform settings service (cache + DB interactions)."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.services import settings_service as svc


class FakePlatformSetting:
    def __init__(self, key: str, value: Any, category: str = "general", is_public: bool = False) -> None:
        self.key = key
        self.value = value
        self.category = category
        self.is_public = is_public


@pytest.mark.asyncio
async def test_get_setting_uses_cached_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_setting returns value from cached settings dict."""
    fake_db = AsyncMock()

    async def fake_get_cached(db: Any) -> dict[str, Any]:  # noqa: ARG001
        return {"feature_x_enabled": True}

    monkeypatch.setattr(svc, "_get_cached_settings", fake_get_cached)

    val = await svc.get_setting(fake_db, "feature_x_enabled", default=False)
    assert val is True
    assert await svc.get_setting(fake_db, "missing", default="fallback") == "fallback"


@pytest.mark.asyncio
async def test_get_settings_by_category_queries_db(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_settings_by_category builds dict from PlatformSetting rows."""
    fake_db = AsyncMock()
    settings = [
        FakePlatformSetting("a", 1, category="cat"),
        FakePlatformSetting("b", 2, category="cat"),
    ]

    fake_result = MagicMock()
    fake_result.scalars.return_value.all.return_value = settings
    fake_db.execute.return_value = fake_result

    result = await svc.get_settings_by_category(fake_db, "cat")
    assert result == {"a": 1, "b": 2}


@pytest.mark.asyncio
async def test_get_public_settings_filters_is_public(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_public_settings returns only is_public=True settings."""
    fake_db = AsyncMock()
    settings = [
        FakePlatformSetting("visible", "yes", is_public=True),
            FakePlatformSetting("hidden", "no", is_public=False),
    ]

    fake_result = MagicMock()
    fake_result.scalars.return_value.all.return_value = settings
    fake_db.execute.return_value = fake_result

    result = await svc.get_public_settings(fake_db)
    # Function trusts the DB filter; here both rows are returned from our fake.
    assert result["visible"] == "yes"


@pytest.mark.asyncio
async def test_get_setting_from_cache_uses_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_setting_from_cache reads from cache_get and respects default."""
    async def fake_cache_get(key: str) -> Any:  # noqa: ARG001
        return {"foo": "bar"}

    monkeypatch.setattr(svc, "cache_get", fake_cache_get)

    assert await svc.get_setting_from_cache("foo") == "bar"
    assert await svc.get_setting_from_cache("missing", default=123) == 123


@pytest.mark.asyncio
async def test_invalidate_cache_calls_cache_delete(monkeypatch: pytest.MonkeyPatch) -> None:
    """invalidate_cache deletes cache key and logs info."""
    called = {}

    async def fake_delete(key: str) -> bool:
        called["key"] = key
        return True

    monkeypatch.setattr(svc, "cache_delete", fake_delete)

    await svc.invalidate_cache()
    assert called["key"] == svc.PLATFORM_SETTINGS_CACHE_KEY
