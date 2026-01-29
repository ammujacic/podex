"""API routes for custom LLM provider management."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, HttpUrl
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import CustomLLMProvider
from src.middleware.auth import get_current_user

router = APIRouter(prefix="/llm-providers", tags=["llm-providers"])


# ============================================================================
# Request/Response Models
# ============================================================================


class LLMProviderCreate(BaseModel):
    """Create a new custom LLM provider."""

    name: str = Field(..., min_length=1, max_length=100)
    provider_type: str = Field(..., pattern="^(openai_compatible|anthropic_compatible|custom)$")
    base_url: HttpUrl
    api_key: str | None = None
    auth_header: str = "Authorization"
    auth_scheme: str = "Bearer"
    default_model: str = Field(..., min_length=1, max_length=100)
    available_models: list[str] = Field(default_factory=list)
    context_window: int = Field(4096, ge=1)
    max_output_tokens: int = Field(2048, ge=1)
    supports_streaming: bool = True
    supports_tools: bool = False
    supports_vision: bool = False
    request_timeout_seconds: int = Field(120, ge=1, le=600)
    extra_headers: dict[str, str] | None = None
    extra_body_params: dict[str, Any] | None = None


class LLMProviderUpdate(BaseModel):
    """Update a custom LLM provider."""

    name: str | None = Field(None, min_length=1, max_length=100)
    api_key: str | None = None
    auth_header: str | None = None
    auth_scheme: str | None = None
    default_model: str | None = Field(None, min_length=1, max_length=100)
    available_models: list[str] | None = None
    context_window: int | None = Field(None, ge=1)
    max_output_tokens: int | None = Field(None, ge=1)
    supports_streaming: bool | None = None
    supports_tools: bool | None = None
    supports_vision: bool | None = None
    request_timeout_seconds: int | None = Field(None, ge=1, le=600)
    extra_headers: dict[str, str] | None = None
    extra_body_params: dict[str, Any] | None = None
    is_enabled: bool | None = None


class LLMProviderResponse(BaseModel):
    """LLM provider response (without API key)."""

    id: str
    user_id: str
    name: str
    provider_type: str
    base_url: str
    auth_header: str
    auth_scheme: str
    default_model: str
    available_models: list[str]
    context_window: int
    max_output_tokens: int
    supports_streaming: bool
    supports_tools: bool
    supports_vision: bool
    request_timeout_seconds: int
    extra_headers: dict[str, str] | None
    extra_body_params: dict[str, Any] | None
    is_enabled: bool
    last_tested_at: datetime | None
    last_test_status: str | None
    last_test_error: str | None
    created_at: datetime
    updated_at: datetime
    has_api_key: bool = False

    model_config = ConfigDict(from_attributes=True)


class TestConnectionRequest(BaseModel):
    """Request to test a provider connection."""

    prompt: str = "Hello, please respond with 'OK' to confirm the connection is working."


class TestConnectionResponse(BaseModel):
    """Response from connection test."""

    success: bool
    response: str | None = None
    error: str | None = None
    latency_ms: int | None = None


# ============================================================================
# Helper Functions
# ============================================================================


def provider_to_response(provider: CustomLLMProvider) -> LLMProviderResponse:
    """Convert provider model to response, masking sensitive data."""
    return LLMProviderResponse(
        id=provider.id,
        user_id=provider.user_id,
        name=provider.name,
        provider_type=provider.provider_type,
        base_url=provider.base_url,
        auth_header=provider.auth_header,
        auth_scheme=provider.auth_scheme,
        default_model=provider.default_model,
        available_models=provider.available_models or [],
        context_window=provider.context_window,
        max_output_tokens=provider.max_output_tokens,
        supports_streaming=provider.supports_streaming,
        supports_tools=provider.supports_tools,
        supports_vision=provider.supports_vision,
        request_timeout_seconds=provider.request_timeout_seconds,
        extra_headers=provider.extra_headers,
        extra_body_params=provider.extra_body_params,
        is_enabled=provider.is_enabled,
        last_tested_at=provider.last_tested_at,
        last_test_status=provider.last_test_status,
        last_test_error=provider.last_test_error,
        created_at=provider.created_at,
        updated_at=provider.updated_at,
        has_api_key=bool(provider.api_key),
    )


async def test_provider_connection(
    provider: CustomLLMProvider,
    prompt: str = "Hello",
) -> TestConnectionResponse:
    """Test connection to a custom LLM provider."""
    import time

    start_time = time.time()

    try:
        headers = {}
        if provider.api_key:
            headers[provider.auth_header] = f"{provider.auth_scheme} {provider.api_key}"
        if provider.extra_headers:
            headers.update(provider.extra_headers)

        # Build request body based on provider type
        body: dict[str, Any] = {
            "model": provider.default_model,
            "max_tokens": 50,
        }

        if provider.provider_type == "openai_compatible":
            body["messages"] = [{"role": "user", "content": prompt}]
            endpoint = f"{provider.base_url.rstrip('/')}/chat/completions"
        elif provider.provider_type == "anthropic_compatible":
            body["messages"] = [{"role": "user", "content": prompt}]
            headers["anthropic-version"] = "2023-06-01"
            endpoint = f"{provider.base_url.rstrip('/')}/messages"
        else:
            # Custom - assume OpenAI-compatible by default
            body["messages"] = [{"role": "user", "content": prompt}]
            endpoint = f"{provider.base_url.rstrip('/')}/chat/completions"

        if provider.extra_body_params:
            body.update(provider.extra_body_params)

        async with httpx.AsyncClient(timeout=provider.request_timeout_seconds) as client:
            response = await client.post(endpoint, json=body, headers=headers)
            response.raise_for_status()
            data = response.json()

        latency_ms = int((time.time() - start_time) * 1000)

        # Extract response text based on provider type
        if provider.provider_type == "anthropic_compatible":
            content = data.get("content", [{}])[0].get("text", "")
        else:
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

        return TestConnectionResponse(
            success=True,
            response=content,
            latency_ms=latency_ms,
        )

    except httpx.HTTPStatusError as e:
        return TestConnectionResponse(
            success=False,
            error=f"HTTP {e.response.status_code}: {e.response.text[:200]}",
            latency_ms=int((time.time() - start_time) * 1000),
        )
    except httpx.RequestError as e:
        return TestConnectionResponse(
            success=False,
            error=f"Connection error: {e!s}",
            latency_ms=int((time.time() - start_time) * 1000),
        )
    except Exception as e:
        return TestConnectionResponse(
            success=False,
            error=f"Error: {e!s}",
            latency_ms=int((time.time() - start_time) * 1000),
        )


# ============================================================================
# Routes
# ============================================================================


@router.get("", response_model=list[LLMProviderResponse])
async def list_providers(
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> list[LLMProviderResponse]:
    """List all custom LLM providers for the current user."""
    user_id = user["id"]

    query = (
        select(CustomLLMProvider)
        .where(CustomLLMProvider.user_id == user_id)
        .order_by(CustomLLMProvider.name)
    )

    result = await db.execute(query)
    providers = result.scalars().all()

    return [provider_to_response(p) for p in providers]


@router.get("/{provider_id}", response_model=LLMProviderResponse)
async def get_provider(
    provider_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> LLMProviderResponse:
    """Get a specific custom LLM provider."""
    user_id = user["id"]

    query = select(CustomLLMProvider).where(
        CustomLLMProvider.id == provider_id,
        CustomLLMProvider.user_id == user_id,
    )
    result = await db.execute(query)
    provider = result.scalar_one_or_none()

    if not provider:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Provider not found",
        )

    return provider_to_response(provider)


@router.post("", response_model=LLMProviderResponse, status_code=status.HTTP_201_CREATED)
async def create_provider(
    request: LLMProviderCreate,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> LLMProviderResponse:
    """Create a new custom LLM provider."""
    user_id = user["id"]

    # Ensure available_models includes default_model
    available_models = list(request.available_models)
    if request.default_model not in available_models:
        available_models.insert(0, request.default_model)

    provider = CustomLLMProvider(
        id=str(uuid4()),
        user_id=user_id,
        name=request.name,
        provider_type=request.provider_type,
        base_url=str(request.base_url),
        api_key=request.api_key,
        auth_header=request.auth_header,
        auth_scheme=request.auth_scheme,
        default_model=request.default_model,
        available_models=available_models,
        context_window=request.context_window,
        max_output_tokens=request.max_output_tokens,
        supports_streaming=request.supports_streaming,
        supports_tools=request.supports_tools,
        supports_vision=request.supports_vision,
        request_timeout_seconds=request.request_timeout_seconds,
        extra_headers=request.extra_headers,
        extra_body_params=request.extra_body_params,
        is_enabled=True,
    )

    db.add(provider)
    await db.commit()
    await db.refresh(provider)

    return provider_to_response(provider)


@router.patch("/{provider_id}", response_model=LLMProviderResponse)
async def update_provider(
    provider_id: str,
    request: LLMProviderUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> LLMProviderResponse:
    """Update a custom LLM provider."""
    user_id = user["id"]

    query = select(CustomLLMProvider).where(
        CustomLLMProvider.id == provider_id,
        CustomLLMProvider.user_id == user_id,
    )
    result = await db.execute(query)
    provider = result.scalar_one_or_none()

    if not provider:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Provider not found",
        )

    update_data = request.model_dump(exclude_unset=True)
    if update_data:
        await db.execute(
            update(CustomLLMProvider)
            .where(CustomLLMProvider.id == provider_id)
            .values(**update_data)
        )
        await db.commit()
        await db.refresh(provider)

    return provider_to_response(provider)


@router.delete("/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_provider(
    provider_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> None:
    """Delete a custom LLM provider."""
    user_id = user["id"]

    query = select(CustomLLMProvider).where(
        CustomLLMProvider.id == provider_id,
        CustomLLMProvider.user_id == user_id,
    )
    result = await db.execute(query)
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Provider not found",
        )

    await db.execute(delete(CustomLLMProvider).where(CustomLLMProvider.id == provider_id))
    await db.commit()


@router.post("/{provider_id}/test", response_model=TestConnectionResponse)
async def test_connection(
    provider_id: str,
    request: TestConnectionRequest | None = None,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> TestConnectionResponse:
    """Test connection to a custom LLM provider."""
    user_id = user["id"]

    query = select(CustomLLMProvider).where(
        CustomLLMProvider.id == provider_id,
        CustomLLMProvider.user_id == user_id,
    )
    result = await db.execute(query)
    provider = result.scalar_one_or_none()

    if not provider:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Provider not found",
        )

    prompt = request.prompt if request else "Hello, please respond with 'OK'."
    test_result = await test_provider_connection(provider, prompt)

    # Update provider with test results
    await db.execute(
        update(CustomLLMProvider)
        .where(CustomLLMProvider.id == provider_id)
        .values(
            last_tested_at=datetime.now(UTC),
            last_test_status="success" if test_result.success else "failure",
            last_test_error=test_result.error,
        )
    )
    await db.commit()

    return test_result


@router.get("/{provider_id}/models", response_model=list[str])
async def list_available_models(
    provider_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> list[str]:
    """List available models for a provider.

    Attempts to fetch from the provider's /models endpoint if supported.
    """
    user_id = user["id"]

    query = select(CustomLLMProvider).where(
        CustomLLMProvider.id == provider_id,
        CustomLLMProvider.user_id == user_id,
    )
    result = await db.execute(query)
    provider = result.scalar_one_or_none()

    if not provider:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Provider not found",
        )

    # Try to fetch models from the provider
    try:
        headers = {}
        if provider.api_key:
            headers[provider.auth_header] = f"{provider.auth_scheme} {provider.api_key}"
        if provider.extra_headers:
            headers.update(provider.extra_headers)

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                f"{provider.base_url.rstrip('/')}/models",
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()

        # Extract model IDs (OpenAI format)
        models = [m.get("id", m.get("name", "")) for m in data.get("data", [])]
        return [m for m in models if m]

    except Exception:
        # Fall back to configured models
        return provider.available_models or [provider.default_model]
