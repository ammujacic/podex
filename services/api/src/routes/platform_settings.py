"""Public API routes for platform settings.

These routes serve configuration data that the frontend needs to render UI
without hardcoding values (workspace defaults, thinking presets, voice languages, etc.)
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import LLMProvider, PlatformSetting
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

router = APIRouter(prefix="/platform", tags=["platform"])


# ============================================================================
# Response Models
# ============================================================================


class PlatformSettingResponse(BaseModel):
    """Public platform setting response."""

    key: str
    value: Any
    description: str | None
    category: str

    model_config = ConfigDict(from_attributes=True)


class LLMProviderResponse(BaseModel):
    """Public LLM provider metadata response."""

    slug: str
    name: str
    description: str | None
    icon: str | None
    color: str | None
    logo_url: str | None
    is_local: bool
    default_url: str | None
    docs_url: str | None
    setup_guide_url: str | None
    requires_api_key: bool
    supports_streaming: bool
    supports_tools: bool
    supports_vision: bool

    model_config = ConfigDict(from_attributes=True)


class PlatformConfigResponse(BaseModel):
    """Combined platform configuration response."""

    settings: dict[str, Any]  # Keyed by setting key
    providers: list[LLMProviderResponse]


# ============================================================================
# Routes
# ============================================================================


@router.get("/settings", response_model=list[PlatformSettingResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_platform_settings(
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
    db: Annotated[AsyncSession, Depends(get_db)],
    category: Annotated[str | None, Query(description="Filter by category")] = None,
) -> list[PlatformSettingResponse]:
    """Get public platform settings.

    Returns only settings marked as is_public=True.
    Can be filtered by category (workspace, agents, voice, editor, etc.)
    """
    query = select(PlatformSetting).where(PlatformSetting.is_public == True)

    if category:
        query = query.where(PlatformSetting.category == category)

    result = await db.execute(query)
    settings = result.scalars().all()

    return [
        PlatformSettingResponse(
            key=s.key,
            value=s.value,
            description=s.description,
            category=s.category,
        )
        for s in settings
    ]


@router.get("/settings/{key}")
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_platform_setting(
    key: str,
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """Get a specific platform setting by key.

    Returns 404 if setting doesn't exist or is not public.
    """
    result = await db.execute(
        select(PlatformSetting).where(
            PlatformSetting.key == key,
            PlatformSetting.is_public == True,
        )
    )
    setting = result.scalar_one_or_none()

    if not setting:
        return {"error": "Setting not found", "key": key}

    return {"key": setting.key, "value": setting.value}


@router.get("/providers", response_model=list[LLMProviderResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_providers(
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[LLMProviderResponse]:
    """Get all enabled LLM provider metadata.

    Returns metadata about supported LLM providers including
    branding, documentation URLs, and capabilities.
    """
    result = await db.execute(
        select(LLMProvider).where(LLMProvider.is_enabled == True).order_by(LLMProvider.sort_order)
    )
    providers = result.scalars().all()

    return [
        LLMProviderResponse(
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
        for p in providers
    ]


@router.get("/providers/{slug}", response_model=LLMProviderResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_provider(
    slug: str,
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LLMProviderResponse | dict[str, str]:
    """Get a specific LLM provider by slug."""
    result = await db.execute(
        select(LLMProvider).where(
            LLMProvider.slug == slug,
            LLMProvider.is_enabled == True,
        )
    )
    provider = result.scalar_one_or_none()

    if not provider:
        return {"error": "Provider not found", "slug": slug}

    return LLMProviderResponse(
        slug=provider.slug,
        name=provider.name,
        description=provider.description,
        icon=provider.icon,
        color=provider.color,
        logo_url=provider.logo_url,
        is_local=provider.is_local,
        default_url=provider.default_url,
        docs_url=provider.docs_url,
        setup_guide_url=provider.setup_guide_url,
        requires_api_key=provider.requires_api_key,
        supports_streaming=provider.supports_streaming,
        supports_tools=provider.supports_tools,
        supports_vision=provider.supports_vision,
    )


@router.get("/config", response_model=PlatformConfigResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_platform_config(
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PlatformConfigResponse:
    """Get combined platform configuration.

    Returns all public settings and enabled providers in a single request.
    Useful for initial app bootstrap to minimize API calls.
    """
    # Fetch settings
    settings_result = await db.execute(
        select(PlatformSetting).where(PlatformSetting.is_public == True)
    )
    settings = settings_result.scalars().all()

    # Fetch providers
    providers_result = await db.execute(
        select(LLMProvider).where(LLMProvider.is_enabled == True).order_by(LLMProvider.sort_order)
    )
    providers = providers_result.scalars().all()

    return PlatformConfigResponse(
        settings={s.key: s.value for s in settings},
        providers=[
            LLMProviderResponse(
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
            for p in providers
        ],
    )
