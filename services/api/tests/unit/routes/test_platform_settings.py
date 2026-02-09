"""Unit tests for platform_settings route helpers and Pydantic models."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from starlette.requests import Request
from starlette.responses import Response

from src.routes import platform_settings as platform_settings_module


def _make_setting_mock(key: str = "test_key", value: str = "test_value", category: str = "workspace") -> MagicMock:
    """Build a PlatformSetting-like mock."""
    s = MagicMock()
    s.key = key
    s.value = value
    s.description = "A setting"
    s.category = category
    return s


def _make_provider_mock(slug: str = "openai", name: str = "OpenAI") -> MagicMock:
    """Build an LLMProvider-like mock."""
    p = MagicMock()
    p.slug = slug
    p.name = name
    p.description = None
    p.icon = None
    p.color = None
    p.logo_url = None
    p.is_local = False
    p.default_url = None
    p.docs_url = None
    p.setup_guide_url = None
    p.requires_api_key = True
    p.supports_streaming = True
    p.supports_tools = True
    p.supports_vision = False
    return p


class TestPlatformSettingsPydanticModels:
    """Pydantic model validation and serialization."""

    def test_platform_setting_response(self) -> None:
        """PlatformSettingResponse holds key, value, description, category."""
        s = _make_setting_mock(key="editor.font_size", value=14, category="editor")
        resp = platform_settings_module.PlatformSettingResponse(
            key=s.key,
            value=s.value,
            description=s.description,
            category=s.category,
        )
        assert resp.key == "editor.font_size"
        assert resp.value == 14
        assert resp.model_dump()["category"] == "editor"

    def test_llm_provider_response(self) -> None:
        """LLMProviderResponse holds slug, name, capabilities."""
        p = _make_provider_mock(slug="anthropic", name="Anthropic")
        resp = platform_settings_module.LLMProviderResponse(
            slug=p.slug,
            name=p.name,
            description=p.description,
            icon=p.icon,
            color=p.color,
            logo_url=p.logo_url,
            is_local=p.is_local,
            default_url=p.default_url,
            docs_url=p.docs_url,
            setup_guide_url=p.setup_guide_url,
            requires_api_key=p.requires_api_key,
            supports_streaming=p.supports_streaming,
            supports_tools=p.supports_tools,
            supports_vision=p.supports_vision,
        )
        assert resp.slug == "anthropic"
        assert resp.supports_tools is True

    def test_platform_config_response(self) -> None:
        """PlatformConfigResponse combines settings dict and providers list."""
        resp = platform_settings_module.PlatformConfigResponse(
            settings={"theme": "dark", "locale": "en"},
            providers=[],
        )
        assert resp.settings["theme"] == "dark"
        assert len(resp.providers) == 0


@pytest.mark.asyncio
async def test_get_platform_settings_returns_list(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_platform_settings returns list of PlatformSettingResponse."""
    monkeypatch.setattr(platform_settings_module.limiter, "enabled", False, raising=False)
    s1 = _make_setting_mock("key1", "val1")
    s2 = _make_setting_mock("key2", "val2")
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalars.return_value.all.return_value = [s1, s2]
    db.execute.return_value = execute_result

    result = await platform_settings_module.get_platform_settings(
        request=Request({"type": "http", "method": "GET", "path": "/platform/settings", "headers": []}),
        response=Response(),
        db=db,
        category=None,
    )
    assert len(result) == 2
    assert result[0].key == "key1"
    assert result[1].key == "key2"


@pytest.mark.asyncio
async def test_get_platform_setting_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_platform_setting returns error dict when key not found."""
    monkeypatch.setattr(platform_settings_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute.return_value = execute_result

    result = await platform_settings_module.get_platform_setting(
        key="missing",
        request=Request({"type": "http", "method": "GET", "path": "/platform/settings/missing", "headers": []}),
        response=Response(),
        db=db,
    )
    assert result["error"] == "Setting not found"
    assert result["key"] == "missing"


@pytest.mark.asyncio
async def test_get_platform_setting_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_platform_setting returns key and value when found."""
    monkeypatch.setattr(platform_settings_module.limiter, "enabled", False, raising=False)
    s = _make_setting_mock(key="theme", value="dark")
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = s
    db.execute.return_value = execute_result

    result = await platform_settings_module.get_platform_setting(
        key="theme",
        request=Request({"type": "http", "method": "GET", "path": "/platform/settings/theme", "headers": []}),
        response=Response(),
        db=db,
    )
    assert result["key"] == "theme"
    assert result["value"] == "dark"


@pytest.mark.asyncio
async def test_get_providers_returns_list(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_providers returns list of LLMProviderResponse."""
    monkeypatch.setattr(platform_settings_module.limiter, "enabled", False, raising=False)
    p = _make_provider_mock(slug="openai", name="OpenAI")
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalars.return_value.all.return_value = [p]
    db.execute.return_value = execute_result

    result = await platform_settings_module.get_providers(
        request=Request({"type": "http", "method": "GET", "path": "/platform/providers", "headers": []}),
        response=Response(),
        db=db,
    )
    assert len(result) == 1
    assert result[0].slug == "openai"
    assert result[0].name == "OpenAI"


@pytest.mark.asyncio
async def test_get_provider_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_provider returns error dict when slug not found."""
    monkeypatch.setattr(platform_settings_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute.return_value = execute_result

    result = await platform_settings_module.get_provider(
        slug="nonexistent",
        request=Request({"type": "http", "method": "GET", "path": "/platform/providers/nonexistent", "headers": []}),
        response=Response(),
        db=db,
    )
    assert isinstance(result, dict)
    assert result["error"] == "Provider not found"
    assert result["slug"] == "nonexistent"


@pytest.mark.asyncio
async def test_get_platform_config_combined(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_platform_config returns settings dict and providers list."""
    monkeypatch.setattr(platform_settings_module.limiter, "enabled", False, raising=False)
    s = _make_setting_mock(key="locale", value="en")
    p = _make_provider_mock(slug="ollama", name="Ollama")
    db = AsyncMock()
    settings_result = MagicMock()
    settings_result.scalars.return_value.all.return_value = [s]
    providers_result = MagicMock()
    providers_result.scalars.return_value.all.return_value = [p]
    db.execute.side_effect = [settings_result, providers_result]

    result = await platform_settings_module.get_platform_config(
        request=Request({"type": "http", "method": "GET", "path": "/platform/config", "headers": []}),
        response=Response(),
        db=db,
    )
    assert "locale" in result.settings
    assert result.settings["locale"] == "en"
    assert len(result.providers) == 1
    assert result.providers[0].slug == "ollama"
