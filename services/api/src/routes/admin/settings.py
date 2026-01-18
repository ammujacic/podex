"""Admin platform settings management routes."""

from datetime import datetime
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit_logger import AuditAction, AuditLogger
from src.database import get_db
from src.database.models import LLMProvider, PlatformSetting
from src.middleware.admin import get_admin_user_id, require_admin, require_super_admin
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

logger = structlog.get_logger()

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db)]


# ==================== Pydantic Models ====================


class CreateSettingRequest(BaseModel):
    """Create platform setting request."""

    key: str = Field(..., min_length=1, max_length=100, pattern=r"^[a-z0-9_]+$")
    value: dict[str, Any] | list[Any]
    description: str | None = None
    category: str = Field(default="general", max_length=50)
    is_public: bool = False


class UpdateSettingRequest(BaseModel):
    """Update platform setting request."""

    value: dict[str, Any] | list[Any] | None = None
    description: str | None = None
    category: str | None = None
    is_public: bool | None = None


class AdminSettingResponse(BaseModel):
    """Admin setting response."""

    key: str
    value: dict[str, Any] | list[Any]
    description: str | None
    category: str
    is_public: bool
    updated_at: datetime
    updated_by: str | None

    class Config:
        from_attributes = True


class PublicSettingResponse(BaseModel):
    """Public setting response (limited fields)."""

    key: str
    value: dict[str, Any] | list[Any]
    category: str


class SettingsByCategoryResponse(BaseModel):
    """Settings grouped by category."""

    category: str
    settings: list[AdminSettingResponse]


# ==================== Public Endpoint ====================


@router.get("/public", response_model=list[PublicSettingResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_public_settings(
    request: Request,
    response: Response,
    db: DbSession,
) -> list[PublicSettingResponse]:
    """Get all public platform settings (no auth required)."""
    _ = request  # Required for rate limiter
    result = await db.execute(
        select(PlatformSetting)
        .where(PlatformSetting.is_public == True)
        .order_by(PlatformSetting.category, PlatformSetting.key)
    )
    settings = result.scalars().all()

    return [
        PublicSettingResponse(
            key=s.key,
            value=s.value,
            category=s.category,
        )
        for s in settings
    ]


@router.get("/public/{key}", response_model=PublicSettingResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_public_setting(
    request: Request,
    response: Response,
    key: str,
    db: DbSession,
) -> PublicSettingResponse:
    """Get a specific public setting by key."""
    result = await db.execute(
        select(PlatformSetting)
        .where(PlatformSetting.key == key)
        .where(PlatformSetting.is_public == True)
    )
    setting = result.scalar_one_or_none()

    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found or not public")

    return PublicSettingResponse(
        key=setting.key,
        value=setting.value,
        category=setting.category,
    )


# ==================== Admin Endpoints ====================


@router.get("", response_model=list[AdminSettingResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def list_settings(
    request: Request,
    response: Response,
    db: DbSession,
    category: Annotated[str | None, Query()] = None,
) -> list[AdminSettingResponse]:
    """List all platform settings."""
    query = select(PlatformSetting).order_by(PlatformSetting.category, PlatformSetting.key)

    if category:
        query = query.where(PlatformSetting.category == category)

    result = await db.execute(query)
    settings = result.scalars().all()

    return [
        AdminSettingResponse(
            key=s.key,
            value=s.value,
            description=s.description,
            category=s.category,
            is_public=s.is_public,
            updated_at=s.updated_at,
            updated_by=str(s.updated_by) if s.updated_by else None,
        )
        for s in settings
    ]


# ==================== LLM Provider Models ====================


class LLMProviderResponse(BaseModel):
    """Admin LLM provider response."""

    id: str
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
    is_enabled: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CreateLLMProviderRequest(BaseModel):
    """Create a new LLM provider."""

    slug: str = Field(..., min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9-]*$")
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    icon: str | None = None
    color: str | None = None
    logo_url: str | None = None
    is_local: bool = False
    default_url: str | None = None
    docs_url: str | None = None
    setup_guide_url: str | None = None
    requires_api_key: bool = True
    supports_streaming: bool = True
    supports_tools: bool = True
    supports_vision: bool = False
    is_enabled: bool = True
    sort_order: int = 100


class UpdateLLMProviderRequest(BaseModel):
    """Update an LLM provider."""

    name: str | None = None
    description: str | None = None
    icon: str | None = None
    color: str | None = None
    logo_url: str | None = None
    is_local: bool | None = None
    default_url: str | None = None
    docs_url: str | None = None
    setup_guide_url: str | None = None
    requires_api_key: bool | None = None
    supports_streaming: bool | None = None
    supports_tools: bool | None = None
    supports_vision: bool | None = None
    is_enabled: bool | None = None
    sort_order: int | None = None


# ==================== LLM Provider Endpoints ====================
# NOTE: These must be defined BEFORE the /{key} catch-all route


def _provider_to_response(provider: LLMProvider) -> LLMProviderResponse:
    """Convert LLMProvider model to response."""
    return LLMProviderResponse(
        id=provider.id,
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
        is_enabled=provider.is_enabled,
        sort_order=provider.sort_order,
        created_at=provider.created_at,
        updated_at=provider.updated_at,
    )


@router.get("/providers", response_model=list[LLMProviderResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def list_providers(
    request: Request,
    response: Response,
    db: DbSession,
    include_disabled: Annotated[bool, Query()] = True,
) -> list[LLMProviderResponse]:
    """List all LLM providers (admin view includes disabled)."""
    query = select(LLMProvider).order_by(LLMProvider.sort_order)

    if not include_disabled:
        query = query.where(LLMProvider.is_enabled == True)

    result = await db.execute(query)
    providers = result.scalars().all()

    return [_provider_to_response(p) for p in providers]


@router.get("/providers/{slug}", response_model=LLMProviderResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_provider(
    slug: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> LLMProviderResponse:
    """Get a specific LLM provider."""
    result = await db.execute(select(LLMProvider).where(LLMProvider.slug == slug))
    provider = result.scalar_one_or_none()

    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    return _provider_to_response(provider)


@router.post("/providers", response_model=LLMProviderResponse, status_code=201)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def create_provider(
    data: CreateLLMProviderRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> LLMProviderResponse:
    """Create a new LLM provider."""
    admin_id = get_admin_user_id(request)

    # Check if provider already exists
    existing = await db.execute(select(LLMProvider).where(LLMProvider.slug == data.slug))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Provider already exists")

    provider = LLMProvider(
        slug=data.slug,
        name=data.name,
        description=data.description,
        icon=data.icon,
        color=data.color,
        logo_url=data.logo_url,
        is_local=data.is_local,
        default_url=data.default_url,
        docs_url=data.docs_url,
        setup_guide_url=data.setup_guide_url,
        requires_api_key=data.requires_api_key,
        supports_streaming=data.supports_streaming,
        supports_tools=data.supports_tools,
        supports_vision=data.supports_vision,
        is_enabled=data.is_enabled,
        sort_order=data.sort_order,
    )

    db.add(provider)
    await db.commit()
    await db.refresh(provider)

    logger.info("Admin created LLM provider", admin_id=admin_id, slug=data.slug)

    return _provider_to_response(provider)


@router.patch("/providers/{slug}", response_model=LLMProviderResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def update_provider(
    slug: str,
    data: UpdateLLMProviderRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> LLMProviderResponse:
    """Update an LLM provider."""
    admin_id = get_admin_user_id(request)

    result = await db.execute(select(LLMProvider).where(LLMProvider.slug == slug))
    provider = result.scalar_one_or_none()

    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    # Update only provided fields
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(provider, field, value)

    await db.commit()
    await db.refresh(provider)

    logger.info("Admin updated LLM provider", admin_id=admin_id, slug=slug)

    return _provider_to_response(provider)


@router.delete("/providers/{slug}")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_super_admin
async def delete_provider(
    slug: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, str]:
    """Delete an LLM provider (super admin only)."""
    admin_id = get_admin_user_id(request)

    result = await db.execute(select(LLMProvider).where(LLMProvider.slug == slug))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Provider not found")

    await db.execute(delete(LLMProvider).where(LLMProvider.slug == slug))
    await db.commit()

    logger.info("Admin deleted LLM provider", admin_id=admin_id, slug=slug)

    return {"message": "Provider deleted", "slug": slug}


@router.get("/by-category", response_model=list[SettingsByCategoryResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def list_settings_by_category(
    request: Request,
    response: Response,
    db: DbSession,
) -> list[SettingsByCategoryResponse]:
    """List all settings grouped by category."""
    result = await db.execute(
        select(PlatformSetting).order_by(PlatformSetting.category, PlatformSetting.key)
    )
    settings = result.scalars().all()

    # Group by category
    categories: dict[str, list[AdminSettingResponse]] = {}
    for s in settings:
        if s.category not in categories:
            categories[s.category] = []
        categories[s.category].append(
            AdminSettingResponse(
                key=s.key,
                value=s.value,
                description=s.description,
                category=s.category,
                is_public=s.is_public,
                updated_at=s.updated_at,
                updated_by=str(s.updated_by) if s.updated_by else None,
            )
        )

    return [
        SettingsByCategoryResponse(category=cat, settings=items)
        for cat, items in sorted(categories.items())
    ]


@router.post("", response_model=AdminSettingResponse, status_code=201)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_super_admin
async def create_setting(
    request: Request,
    response: Response,
    data: CreateSettingRequest,
    db: DbSession,
) -> AdminSettingResponse:
    """Create a new platform setting (super admin only)."""
    admin_id = get_admin_user_id(request)

    # Check key uniqueness
    existing = await db.execute(select(PlatformSetting).where(PlatformSetting.key == data.key))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Setting key already exists")

    setting = PlatformSetting(
        key=data.key,
        value=data.value,
        description=data.description,
        category=data.category,
        is_public=data.is_public,
        updated_by=admin_id,
    )

    db.add(setting)
    await db.commit()
    await db.refresh(setting)

    # Audit log: setting created
    audit = AuditLogger(db).set_context(request=request, user_id=admin_id)
    await audit.log_admin_action(
        AuditAction.ADMIN_SETTINGS_CHANGED,
        resource_type="platform_setting",
        resource_id=setting.key,
        details={"action": "created", "category": setting.category},
    )

    logger.info("Admin created platform setting", admin_id=admin_id, key=setting.key)

    return AdminSettingResponse(
        key=setting.key,
        value=setting.value,
        description=setting.description,
        category=setting.category,
        is_public=setting.is_public,
        updated_at=setting.updated_at,
        updated_by=str(setting.updated_by) if setting.updated_by else None,
    )


@router.get("/{key}", response_model=AdminSettingResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_setting(
    key: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> AdminSettingResponse:
    """Get a platform setting by key."""
    result = await db.execute(select(PlatformSetting).where(PlatformSetting.key == key))
    setting = result.scalar_one_or_none()

    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")

    return AdminSettingResponse(
        key=setting.key,
        value=setting.value,
        description=setting.description,
        category=setting.category,
        is_public=setting.is_public,
        updated_at=setting.updated_at,
        updated_by=str(setting.updated_by) if setting.updated_by else None,
    )


@router.patch("/{key}", response_model=AdminSettingResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def update_setting(
    key: str,
    request: Request,
    response: Response,
    data: UpdateSettingRequest,
    db: DbSession,
) -> AdminSettingResponse:
    """Update a platform setting."""
    admin_id = get_admin_user_id(request)

    result = await db.execute(select(PlatformSetting).where(PlatformSetting.key == key))
    setting = result.scalar_one_or_none()

    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")

    update_data = data.model_dump(exclude_unset=True)

    # Capture old values for audit log
    old_values = {field: getattr(setting, field) for field in update_data}

    for field, value in update_data.items():
        setattr(setting, field, value)

    setting.updated_by = admin_id

    await db.commit()
    await db.refresh(setting)

    # Audit log: setting updated
    audit = AuditLogger(db).set_context(request=request, user_id=admin_id)
    await audit.log_admin_action(
        AuditAction.ADMIN_SETTINGS_CHANGED,
        resource_type="platform_setting",
        resource_id=key,
        details={"action": "updated"},
        changes={"before": old_values, "after": update_data},
    )

    logger.info(
        "Admin updated platform setting",
        admin_id=admin_id,
        key=key,
        changes=list(update_data.keys()),
    )

    return AdminSettingResponse(
        key=setting.key,
        value=setting.value,
        description=setting.description,
        category=setting.category,
        is_public=setting.is_public,
        updated_at=setting.updated_at,
        updated_by=str(setting.updated_by) if setting.updated_by else None,
    )


@router.delete("/{key}")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_super_admin
async def delete_setting(
    key: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, str]:
    """Delete a platform setting (super admin only)."""
    admin_id = get_admin_user_id(request)

    result = await db.execute(select(PlatformSetting).where(PlatformSetting.key == key))
    setting = result.scalar_one_or_none()

    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")

    # Audit log: setting deleted
    audit = AuditLogger(db).set_context(request=request, user_id=admin_id)
    await audit.log_admin_action(
        AuditAction.ADMIN_SETTINGS_CHANGED,
        resource_type="platform_setting",
        resource_id=key,
        details={"action": "deleted", "category": setting.category},
    )

    await db.delete(setting)
    await db.commit()

    logger.info("Admin deleted platform setting", admin_id=admin_id, key=key)

    return {"message": "Setting deleted"}


# ==================== Bulk Operations ====================


class BulkUpdateSettingsRequest(BaseModel):
    """Bulk update settings request."""

    settings: dict[str, dict[str, Any] | list[Any]]  # key -> value


@router.post("/bulk", response_model=list[AdminSettingResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def bulk_update_settings(
    request: Request,
    response: Response,
    data: BulkUpdateSettingsRequest,
    db: DbSession,
) -> list[AdminSettingResponse]:
    """Bulk update multiple settings at once."""
    admin_id = get_admin_user_id(request)

    updated_settings = []

    for key, new_value in data.settings.items():
        result = await db.execute(select(PlatformSetting).where(PlatformSetting.key == key))
        setting = result.scalar_one_or_none()

        if setting:
            setting.value = new_value
            setting.updated_by = admin_id
            updated_settings.append(setting)

    await db.commit()

    # Refresh all updated settings
    for setting in updated_settings:
        await db.refresh(setting)

    logger.info(
        "Admin bulk updated settings",
        admin_id=admin_id,
        keys=list(data.settings.keys()),
    )

    return [
        AdminSettingResponse(
            key=s.key,
            value=s.value,
            description=s.description,
            category=s.category,
            is_public=s.is_public,
            updated_at=s.updated_at,
            updated_by=str(s.updated_by) if s.updated_by else None,
        )
        for s in updated_settings
    ]


# ==================== Default Settings Templates ====================


@router.post("/reset/{key}")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_super_admin
async def reset_setting_to_default(
    key: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> AdminSettingResponse:
    """Reset a setting to its default value (super admin only)."""
    admin_id = get_admin_user_id(request)

    # Default values for known settings
    defaults: dict[str, dict[str, Any]] = {
        "agent_defaults": {
            "architect": {"model": "claude-3-opus", "temperature": 0.7, "max_tokens": 8192},
            "coder": {"model": "claude-3-sonnet", "temperature": 0.3, "max_tokens": 4096},
            "reviewer": {"model": "claude-3-sonnet", "temperature": 0.5, "max_tokens": 4096},
            "tester": {"model": "claude-3-haiku", "temperature": 0.3, "max_tokens": 2048},
        },
        "model_providers": {
            "providers": [
                {
                    "id": "anthropic",
                    "name": "Anthropic",
                    "models": ["claude-3-opus", "claude-3-sonnet", "claude-3-haiku"],
                },
                {
                    "id": "openai",
                    "name": "OpenAI",
                    "models": ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
                },
                {
                    "id": "google",
                    "name": "Google",
                    "models": ["gemini-1.5-pro", "gemini-1.5-flash"],
                },
                {
                    "id": "ollama",
                    "name": "Ollama (Local)",
                    "models": ["llama3", "codellama", "mistral"],
                },
            ]
        },
        "voice_defaults": {
            "tts_enabled": False,
            "auto_play": False,
            "voice_id": None,
            "speed": 1.0,
            "language": "en-US",
        },
        "editor_defaults": {
            "key_mode": "default",
            "font_size": 13,
            "tab_size": 2,
            "word_wrap": "off",
            "minimap": False,
            "line_numbers": True,
            "bracket_pair_colorization": True,
        },
        "feature_flags": {
            "voice_enabled": True,
            "collaboration_enabled": True,
            "custom_agents_enabled": True,
            "git_integration_enabled": True,
            "planning_mode_enabled": True,
            "vision_enabled": True,
        },
        "platform_limits": {
            "max_concurrent_agents": 3,
            "max_sessions_per_user": 10,
            "max_file_size_mb": 50,
            "max_upload_size_mb": 100,
        },
    }

    if key not in defaults:
        raise HTTPException(status_code=400, detail=f"No default value defined for key: {key}")

    result = await db.execute(select(PlatformSetting).where(PlatformSetting.key == key))
    setting = result.scalar_one_or_none()

    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")

    setting.value = defaults[key]
    setting.updated_by = admin_id

    await db.commit()
    await db.refresh(setting)

    logger.info("Admin reset setting to default", admin_id=admin_id, key=key)

    return AdminSettingResponse(
        key=setting.key,
        value=setting.value,
        description=setting.description,
        category=setting.category,
        is_public=setting.is_public,
        updated_at=setting.updated_at,
        updated_by=str(setting.updated_by) if setting.updated_by else None,
    )
