"""Admin agent role configuration management routes."""

from datetime import UTC, datetime
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import AgentRoleConfig
from src.middleware.admin import get_admin_user_id, require_admin
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

logger = structlog.get_logger()

router = APIRouter()
public_router = APIRouter()  # For unauthenticated endpoints
DbSession = Annotated[AsyncSession, Depends(get_db)]


# ==================== Pydantic Models ====================


class AgentRoleConfigResponse(BaseModel):
    """Agent role configuration response."""

    id: str
    role: str
    name: str
    color: str
    icon: str | None
    description: str | None
    system_prompt: str
    tools: list[str]
    default_model: str | None
    default_temperature: float | None
    default_max_tokens: int | None
    sort_order: int
    is_enabled: bool
    is_system: bool
    usage_count: int = 0
    last_used_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class UpdateAgentRoleConfigRequest(BaseModel):
    """Update agent role configuration request."""

    name: str | None = Field(None, min_length=1, max_length=100)
    color: str | None = Field(None, max_length=50)
    icon: str | None = Field(None, max_length=50)
    description: str | None = None
    system_prompt: str | None = Field(None, min_length=10)
    tools: list[str] | None = None
    default_model: str | None = Field(None, max_length=100)
    default_temperature: float | None = Field(None, ge=0, le=2)
    default_max_tokens: int | None = Field(None, ge=1, le=100000)
    sort_order: int | None = Field(None, ge=0)
    is_enabled: bool | None = None


class CreateAgentRoleConfigRequest(BaseModel):
    """Create custom agent role configuration request."""

    role: str = Field(..., min_length=1, max_length=50, pattern=r"^[a-z0-9_]+$")
    name: str = Field(..., min_length=1, max_length=100)
    color: str = Field(..., max_length=50)
    icon: str | None = Field(None, max_length=50)
    description: str | None = None
    system_prompt: str = Field(..., min_length=10)
    tools: list[str] = Field(default_factory=list)
    default_model: str | None = Field(None, max_length=100)
    default_temperature: float | None = Field(None, ge=0, le=2)
    default_max_tokens: int | None = Field(None, ge=1, le=100000)
    sort_order: int = Field(default=500, ge=0)


class AgentRoleConfigListResponse(BaseModel):
    """List of agent role configurations."""

    roles: list[AgentRoleConfigResponse]
    total: int


# ==================== Public Endpoints ====================


@public_router.get("", response_model=AgentRoleConfigListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_public_role_configs(
    request: Request,
    response: Response,
    db: DbSession,
) -> AgentRoleConfigListResponse:
    """Get all enabled agent role configurations (public).

    This is the single source of truth for agent role defaults.
    Frontend should use this instead of hardcoded constants.
    """
    _ = request  # Required for rate limiter
    result = await db.execute(
        select(AgentRoleConfig)
        .where(AgentRoleConfig.is_enabled == True)
        .order_by(AgentRoleConfig.sort_order, AgentRoleConfig.name)
    )
    roles = result.scalars().all()

    return AgentRoleConfigListResponse(
        roles=[AgentRoleConfigResponse.model_validate(r) for r in roles],
        total=len(roles),
    )


@public_router.get("/{role}", response_model=AgentRoleConfigResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_public_role_config(
    role: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> AgentRoleConfigResponse:
    """Get a specific agent role configuration by role name (public)."""
    _ = request  # Required for rate limiter
    result = await db.execute(
        select(AgentRoleConfig).where(
            AgentRoleConfig.role == role,
            AgentRoleConfig.is_enabled == True,
        )
    )
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(status_code=404, detail=f"Role '{role}' not found")

    return AgentRoleConfigResponse.model_validate(config)


# ==================== Admin Endpoints ====================


@router.get("", response_model=AgentRoleConfigListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def list_role_configs(
    request: Request,
    response: Response,
    db: DbSession,
) -> AgentRoleConfigListResponse:
    """List all agent role configurations (admin).

    Includes disabled roles that are hidden from public endpoint.
    """
    result = await db.execute(
        select(AgentRoleConfig).order_by(AgentRoleConfig.sort_order, AgentRoleConfig.name)
    )
    roles = result.scalars().all()

    return AgentRoleConfigListResponse(
        roles=[AgentRoleConfigResponse.model_validate(r) for r in roles],
        total=len(roles),
    )


@router.get("/{role_id}", response_model=AgentRoleConfigResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_role_config(
    role_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> AgentRoleConfigResponse:
    """Get a specific agent role configuration by ID (admin)."""
    result = await db.execute(select(AgentRoleConfig).where(AgentRoleConfig.id == role_id))
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(status_code=404, detail="Role configuration not found")

    return AgentRoleConfigResponse.model_validate(config)


@router.put("/{role_id}", response_model=AgentRoleConfigResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def update_role_config(
    role_id: str,
    data: UpdateAgentRoleConfigRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> AgentRoleConfigResponse:
    """Update an agent role configuration (admin).

    Only non-None fields in the request will be updated.
    """
    result = await db.execute(select(AgentRoleConfig).where(AgentRoleConfig.id == role_id))
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(status_code=404, detail="Role configuration not found")

    # Update only provided fields
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(config, field, value)

    await db.commit()
    await db.refresh(config)

    logger.info(
        "Agent role config updated",
        role_id=role_id,
        role=config.role,
        admin_id=get_admin_user_id(request),
        updated_fields=list(update_data.keys()),
    )

    return AgentRoleConfigResponse.model_validate(config)


@router.post("", response_model=AgentRoleConfigResponse, status_code=201)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def create_role_config(
    data: CreateAgentRoleConfigRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> AgentRoleConfigResponse:
    """Create a new custom agent role configuration (admin).

    System roles are created via database seeds.
    Custom roles created here can be deleted.
    """
    # Check if role already exists
    result = await db.execute(select(AgentRoleConfig).where(AgentRoleConfig.role == data.role))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Role '{data.role}' already exists")

    admin_id = get_admin_user_id(request)
    config = AgentRoleConfig(
        role=data.role,
        name=data.name,
        color=data.color,
        icon=data.icon,
        description=data.description,
        system_prompt=data.system_prompt,
        tools=data.tools,
        default_model=data.default_model,
        default_temperature=data.default_temperature,
        default_max_tokens=data.default_max_tokens,
        sort_order=data.sort_order,
        is_enabled=True,
        is_system=False,  # Custom roles can be deleted
        created_by_admin_id=admin_id,
    )

    db.add(config)
    await db.commit()
    await db.refresh(config)

    logger.info(
        "Agent role config created",
        role_id=config.id,
        role=config.role,
        admin_id=admin_id,
    )

    return AgentRoleConfigResponse.model_validate(config)


@router.delete("/{role_id}", status_code=204)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def delete_role_config(
    role_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> None:
    """Delete a custom agent role configuration (admin).

    System roles cannot be deleted - disable them instead.
    """
    result = await db.execute(select(AgentRoleConfig).where(AgentRoleConfig.id == role_id))
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(status_code=404, detail="Role configuration not found")

    if config.is_system:
        raise HTTPException(
            status_code=403,
            detail="System roles cannot be deleted. Disable them instead.",
        )

    await db.delete(config)
    await db.commit()

    logger.info(
        "Agent role config deleted",
        role_id=role_id,
        role=config.role,
        admin_id=get_admin_user_id(request),
    )


# ==================== Usage Tracking Endpoints ====================


class UsageStatsResponse(BaseModel):
    """Usage statistics for agent roles."""

    roles: list[AgentRoleConfigResponse]
    total_usage: int


@router.get("/stats/usage", response_model=UsageStatsResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_usage_stats(
    request: Request,
    response: Response,
    db: DbSession,
    limit: int = 10,
) -> UsageStatsResponse:
    """Get agent role usage statistics (admin).

    Returns roles sorted by usage count (most used first).
    """
    result = await db.execute(
        select(AgentRoleConfig)
        .where(AgentRoleConfig.is_enabled == True)
        .order_by(AgentRoleConfig.usage_count.desc())
        .limit(limit)
    )
    roles = result.scalars().all()

    total_usage = sum(r.usage_count for r in roles)

    return UsageStatsResponse(
        roles=[AgentRoleConfigResponse.model_validate(r) for r in roles],
        total_usage=total_usage,
    )


class TrackUsageRequest(BaseModel):
    """Request to track agent role usage."""

    role: str


class TrackUsageResponse(BaseModel):
    """Response after tracking usage."""

    success: bool
    usage_count: int


@public_router.post("/track-usage", response_model=TrackUsageResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def track_role_usage(
    data: TrackUsageRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> TrackUsageResponse:
    """Track usage of an agent role (called by agent service).

    This endpoint is public but rate-limited. The agent service calls this
    when an agent of a specific role is used.
    """
    _ = request  # Required for rate limiter
    result = await db.execute(select(AgentRoleConfig).where(AgentRoleConfig.role == data.role))
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(status_code=404, detail=f"Role '{data.role}' not found")

    # Increment usage count
    config.usage_count = (config.usage_count or 0) + 1
    config.last_used_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(config)

    logger.debug(
        "Agent role usage tracked",
        role=data.role,
        usage_count=config.usage_count,
    )

    return TrackUsageResponse(
        success=True,
        usage_count=config.usage_count,
    )
