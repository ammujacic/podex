"""Admin platform settings management routes."""

from datetime import datetime
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import PlatformSetting
from src.middleware.admin import get_admin_user_id, require_admin, require_super_admin
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

logger = structlog.get_logger()

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db)]


# ==================== Pydantic Models ====================


class CreateSettingRequest(BaseModel):
    """Create platform setting request."""

    key: str = Field(..., min_length=1, max_length=100, pattern=r"^[a-z0-9_]+$")
    value: dict[str, Any]
    description: str | None = None
    category: str = Field(default="general", max_length=50)
    is_public: bool = False


class UpdateSettingRequest(BaseModel):
    """Update platform setting request."""

    value: dict[str, Any] | None = None
    description: str | None = None
    category: str | None = None
    is_public: bool | None = None


class AdminSettingResponse(BaseModel):
    """Admin setting response."""

    key: str
    value: dict[str, Any]
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
    value: dict[str, Any]
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
        .where(PlatformSetting.is_public == True)  # noqa: E712
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
        .where(PlatformSetting.is_public == True)  # noqa: E712
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

    for field, value in update_data.items():
        setattr(setting, field, value)

    setting.updated_by = admin_id

    await db.commit()
    await db.refresh(setting)

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

    await db.delete(setting)
    await db.commit()

    logger.info("Admin deleted platform setting", admin_id=admin_id, key=key)

    return {"message": "Setting deleted"}


# ==================== Bulk Operations ====================


class BulkUpdateSettingsRequest(BaseModel):
    """Bulk update settings request."""

    settings: dict[str, dict[str, Any]]  # key -> value


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


# ==================== Seed Default Settings ====================

DEFAULT_SETTINGS = [
    {
        "key": "agent_defaults",
        "value": {
            "architect": {"model": "claude-3-opus", "temperature": 0.7, "max_tokens": 8192},
            "coder": {"model": "claude-3-sonnet", "temperature": 0.3, "max_tokens": 4096},
            "reviewer": {"model": "claude-3-sonnet", "temperature": 0.5, "max_tokens": 4096},
            "tester": {"model": "claude-3-haiku", "temperature": 0.3, "max_tokens": 2048},
        },
        "description": "Default AI agent model configurations",
        "category": "agents",
        "is_public": False,
    },
    {
        "key": "model_providers",
        "value": {
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
        "description": "Available LLM providers and their models",
        "category": "agents",
        "is_public": True,
    },
    {
        "key": "voice_defaults",
        "value": {
            "tts_enabled": False,
            "auto_play": False,
            "voice_id": None,
            "speed": 1.0,
            "language": "en-US",
        },
        "description": "Default text-to-speech settings",
        "category": "voice",
        "is_public": True,
    },
    {
        "key": "editor_defaults",
        "value": {
            "key_mode": "default",
            "font_size": 13,
            "tab_size": 2,
            "word_wrap": "off",
            "minimap": False,
            "line_numbers": True,
            "bracket_pair_colorization": True,
        },
        "description": "Default code editor settings",
        "category": "editor",
        "is_public": True,
    },
    {
        "key": "feature_flags",
        "value": {
            "voice_enabled": True,
            "collaboration_enabled": True,
            "custom_agents_enabled": True,
            "git_integration_enabled": True,
            "planning_mode_enabled": True,
            "vision_enabled": True,
        },
        "description": "Platform-wide feature toggles",
        "category": "features",
        "is_public": True,
    },
    {
        "key": "platform_limits",
        "value": {
            "max_concurrent_agents": 3,
            "max_sessions_per_user": 10,
            "max_file_size_mb": 50,
            "max_upload_size_mb": 100,
        },
        "description": "Global platform constraints and limits",
        "category": "limits",
        "is_public": True,
    },
]


@router.post("/seed")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def seed_default_settings(
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, int]:
    """Seed default platform settings (admin only)."""
    admin_id = get_admin_user_id(request)
    created = 0

    for setting_data in DEFAULT_SETTINGS:
        result = await db.execute(
            select(PlatformSetting).where(PlatformSetting.key == setting_data["key"])
        )
        if result.scalar_one_or_none():
            continue

        setting = PlatformSetting(
            key=setting_data["key"],
            value=setting_data["value"],
            description=setting_data["description"],
            category=setting_data["category"],
            is_public=setting_data["is_public"],
            updated_by=admin_id,
        )
        db.add(setting)
        created += 1

    await db.commit()
    logger.info("Admin seeded platform settings", admin_id=admin_id, created=created)

    return {"created": created, "total": len(DEFAULT_SETTINGS)}
