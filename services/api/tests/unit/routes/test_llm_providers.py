"""Unit tests for llm_providers route helpers and Pydantic models."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from starlette.requests import Request
from starlette.responses import Response

from src.routes import llm_providers as llm_providers_module


def _make_provider_mock(
    provider_id: str = "prov-1",
    user_id: str = "u1",
    name: str = "My Provider",
    base_url: str = "https://api.example.com",
) -> MagicMock:
    p = MagicMock()
    p.id = provider_id
    p.user_id = user_id
    p.name = name
    p.provider_type = "openai_compatible"
    p.base_url = base_url
    p.auth_header = "Authorization"
    p.auth_scheme = "Bearer"
    p.default_model = "gpt-4"
    p.available_models = ["gpt-4", "gpt-3.5"]
    p.context_window = 4096
    p.max_output_tokens = 2048
    p.supports_streaming = True
    p.supports_tools = False
    p.supports_vision = False
    p.request_timeout_seconds = 120
    p.extra_headers = None
    p.extra_body_params = None
    p.is_enabled = True
    p.last_tested_at = None
    p.last_test_status = None
    p.last_test_error = None
    p.created_at = datetime.now(UTC)
    p.updated_at = datetime.now(UTC)
    p.api_key = "sk-secret"
    return p


class TestLLMProvidersPydanticModels:
    """Pydantic model validation and defaults."""

    def test_llm_provider_create_defaults(self) -> None:
        """LLMProviderCreate has expected defaults."""
        body = llm_providers_module.LLMProviderCreate(
            name="Test",
            provider_type="openai_compatible",
            base_url="https://api.example.com",
            default_model="gpt-4",
        )
        assert body.context_window == 4096
        assert body.max_output_tokens == 2048
        assert body.supports_streaming is True
        assert body.available_models == []
        assert body.request_timeout_seconds == 120

    def test_llm_provider_create_invalid_type(self) -> None:
        """LLMProviderCreate rejects invalid provider_type."""
        with pytest.raises(ValidationError):
            llm_providers_module.LLMProviderCreate(
                name="Test",
                provider_type="invalid",
                base_url="https://api.example.com",
                default_model="gpt-4",
            )

    def test_llm_provider_update_optional(self) -> None:
        """LLMProviderUpdate allows partial updates."""
        body = llm_providers_module.LLMProviderUpdate(name="New Name", is_enabled=False)
        dumped = body.model_dump(exclude_unset=True)
        assert "name" in dumped
        assert "is_enabled" in dumped

    def test_test_connection_request_default(self) -> None:
        """TestConnectionRequest has default prompt."""
        req = llm_providers_module.TestConnectionRequest()
        assert "OK" in req.prompt or "ok" in req.prompt.lower()

    def test_test_connection_response(self) -> None:
        """TestConnectionResponse holds success, response, error, latency_ms."""
        resp = llm_providers_module.TestConnectionResponse(
            success=True,
            response="OK",
            latency_ms=100,
        )
        assert resp.success is True
        assert resp.error is None
        assert resp.latency_ms == 100

    def test_provider_to_response_maps_fields(self) -> None:
        """provider_to_response converts provider to LLMProviderResponse and masks API key."""
        provider = _make_provider_mock(provider_id="p1", name="OpenAI")
        resp = llm_providers_module.provider_to_response(provider)
        assert resp.id == "p1"
        assert resp.name == "OpenAI"
        assert resp.has_api_key is True
        assert resp.base_url == "https://api.example.com"


def _req(path: str = "/llm-providers") -> Request:
    return Request({"type": "http", "method": "GET", "path": path, "headers": []})


@pytest.mark.asyncio
async def test_list_providers_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """list_providers returns list of LLMProviderResponse."""
    monkeypatch.setattr(llm_providers_module.limiter, "enabled", False, raising=False)
    provider = _make_provider_mock()
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalars.return_value.all.return_value = [provider]
    db.execute = AsyncMock(return_value=execute_result)
    user = {"id": "u1"}

    result = await llm_providers_module.list_providers(
        request=_req(),
        response=Response(),
        db=db,
        user=user,
    )
    assert len(result) == 1
    assert result[0].id == provider.id
    assert result[0].name == provider.name


@pytest.mark.asyncio
async def test_get_provider_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_provider raises 404 when provider not found."""
    monkeypatch.setattr(llm_providers_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=execute_result)
    user = {"id": "u1"}

    with pytest.raises(HTTPException) as exc:
        await llm_providers_module.get_provider(
            provider_id="nonexistent",
            request=_req("/llm-providers/nonexistent"),
            response=Response(),
            db=db,
            user=user,
        )
    assert exc.value.status_code == 404
    assert "not found" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_get_provider_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_provider returns LLMProviderResponse when found."""
    monkeypatch.setattr(llm_providers_module.limiter, "enabled", False, raising=False)
    provider = _make_provider_mock(provider_id="p1", name="Anthropic")
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = provider
    db.execute = AsyncMock(return_value=execute_result)
    user = {"id": "u1"}

    result = await llm_providers_module.get_provider(
        provider_id="p1",
        request=_req("/llm-providers/p1"),
        response=Response(),
        db=db,
        user=user,
    )
    assert result.id == "p1"
    assert result.name == "Anthropic"


@pytest.mark.asyncio
async def test_update_provider_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """update_provider raises 404 when provider not found."""
    monkeypatch.setattr(llm_providers_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=execute_result)
    user = {"id": "u1"}
    body = llm_providers_module.LLMProviderUpdate(name="New Name")

    with pytest.raises(HTTPException) as exc:
        await llm_providers_module.update_provider(
            provider_id="nonexistent",
            request=_req("/llm-providers/nonexistent"),
            response=Response(),
            body=body,
            db=db,
            user=user,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_create_provider_201(monkeypatch: pytest.MonkeyPatch) -> None:
    """create_provider returns LLMProviderResponse and commits."""
    monkeypatch.setattr(llm_providers_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    async def refresh_provider(instance: object) -> None:
        setattr(instance, "created_at", datetime.now(UTC))
        setattr(instance, "updated_at", datetime.now(UTC))
    db.refresh = AsyncMock(side_effect=refresh_provider)
    user = {"id": "u1"}
    body = llm_providers_module.LLMProviderCreate(
        name="New Provider",
        provider_type="openai_compatible",
        base_url="https://api.example.com",
        default_model="gpt-4",
    )

    result = await llm_providers_module.create_provider(
        request=_req(),
        response=Response(),
        body=body,
        db=db,
        user=user,
    )
    assert result.name == "New Provider"
    assert result.base_url in ("https://api.example.com", "https://api.example.com/")
    db.add.assert_called_once()
    db.commit.assert_awaited()
    db.refresh.assert_awaited()


@pytest.mark.asyncio
async def test_delete_provider_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """delete_provider raises 404 when provider not found."""
    monkeypatch.setattr(llm_providers_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=execute_result)
    user = {"id": "u1"}

    with pytest.raises(HTTPException) as exc:
        await llm_providers_module.delete_provider(
            provider_id="nonexistent",
            request=_req("/llm-providers/nonexistent"),
            response=Response(),
            db=db,
            user=user,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_provider_204(monkeypatch: pytest.MonkeyPatch) -> None:
    """delete_provider returns 204 and deletes provider."""
    monkeypatch.setattr(llm_providers_module.limiter, "enabled", False, raising=False)
    provider = _make_provider_mock(provider_id="p1")
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = provider
    db.execute = AsyncMock(return_value=execute_result)
    user = {"id": "u1"}

    result = await llm_providers_module.delete_provider(
        provider_id="p1",
        request=_req("/llm-providers/p1"),
        response=Response(),
        db=db,
        user=user,
    )
    assert result is None
    db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_test_connection_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """test_connection raises 404 when provider not found."""
    monkeypatch.setattr(llm_providers_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=execute_result)
    user = {"id": "u1"}

    with pytest.raises(HTTPException) as exc:
        await llm_providers_module.test_connection(
            provider_id="nonexistent",
            request=_req("/llm-providers/nonexistent/test"),
            response=Response(),
            body=None,
            db=db,
            user=user,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_test_connection_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """test_connection returns TestConnectionResponse when provider found."""
    monkeypatch.setattr(llm_providers_module.limiter, "enabled", False, raising=False)
    provider = _make_provider_mock(provider_id="p1")
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = provider
    db.execute = AsyncMock(return_value=execute_result)
    user = {"id": "u1"}
    test_resp = llm_providers_module.TestConnectionResponse(
        success=True, response="OK", latency_ms=50
    )
    monkeypatch.setattr(
        llm_providers_module,
        "test_provider_connection",
        AsyncMock(return_value=test_resp),
    )

    result = await llm_providers_module.test_connection(
        provider_id="p1",
        request=_req("/llm-providers/p1/test"),
        response=Response(),
        body=llm_providers_module.TestConnectionRequest(prompt="Hi"),
        db=db,
        user=user,
    )
    assert result.success is True
    assert result.latency_ms == 50
    db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_list_available_models_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """list_available_models raises 404 when provider not found."""
    monkeypatch.setattr(llm_providers_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=execute_result)
    user = {"id": "u1"}

    with pytest.raises(HTTPException) as exc:
        await llm_providers_module.list_available_models(
            provider_id="nonexistent",
            request=_req("/llm-providers/nonexistent/models"),
            response=Response(),
            db=db,
            user=user,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_list_available_models_200_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    """list_available_models returns configured models when API call fails."""
    monkeypatch.setattr(llm_providers_module.limiter, "enabled", False, raising=False)
    provider = _make_provider_mock(provider_id="p1")
    provider.available_models = ["gpt-4", "gpt-3.5"]
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = provider
    db.execute = AsyncMock(return_value=execute_result)
    user = {"id": "u1"}
    client = MagicMock()
    client.get = AsyncMock(side_effect=Exception("network error"))
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    mock_httpx = MagicMock()
    mock_httpx.AsyncClient = MagicMock(return_value=client)
    monkeypatch.setattr(llm_providers_module, "httpx", mock_httpx)

    result = await llm_providers_module.list_available_models(
        provider_id="p1",
        request=_req("/llm-providers/p1/models"),
        response=Response(),
        db=db,
        user=user,
    )
    assert result == ["gpt-4", "gpt-3.5"]


@pytest.mark.asyncio
async def test_list_available_models_200_from_api(monkeypatch: pytest.MonkeyPatch) -> None:
    """list_available_models returns model list from provider /models endpoint."""
    monkeypatch.setattr(llm_providers_module.limiter, "enabled", False, raising=False)
    provider = _make_provider_mock(provider_id="p1")
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = provider
    db.execute = AsyncMock(return_value=execute_result)
    user = {"id": "u1"}
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json = MagicMock(return_value={"data": [{"id": "gpt-4"}, {"id": "gpt-3.5"}]})
    client = MagicMock()
    client.get = AsyncMock(return_value=resp)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    mock_httpx = MagicMock()
    mock_httpx.AsyncClient = MagicMock(return_value=client)
    monkeypatch.setattr(llm_providers_module, "httpx", mock_httpx)

    result = await llm_providers_module.list_available_models(
        provider_id="p1",
        request=_req("/llm-providers/p1/models"),
        response=Response(),
        db=db,
        user=user,
    )
    assert result == ["gpt-4", "gpt-3.5"]
