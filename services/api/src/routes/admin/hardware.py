"""Admin hardware specification management routes."""

from datetime import datetime
from typing import Annotated, cast

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import HardwareSpec
from src.middleware.admin import get_admin_user_id, require_admin
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

logger = structlog.get_logger()

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db)]


# ==================== Pydantic Models ====================


class CreateHardwareSpecRequest(BaseModel):
    """Create hardware specification request."""

    tier: str = Field(..., min_length=1, max_length=50, pattern=r"^[a-z0-9-]+$")
    display_name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None

    # Hardware specs
    architecture: str = Field(default="x86_64", pattern=r"^x86_64$")
    vcpu: int = Field(ge=1, le=128)
    memory_mb: int = Field(ge=512, le=524288)  # Max 512GB

    # GPU specs
    gpu_type: str | None = None
    gpu_memory_gb: int | None = Field(default=None, ge=1, le=80)
    gpu_count: int = Field(default=0, ge=0, le=8)

    # Compute routing flags
    is_gpu: bool = Field(
        default=False, description="Whether this tier has GPU/accelerator hardware"
    )
    requires_gke: bool = Field(
        default=False, description="Whether this tier requires GKE (Cloud Run doesn't support GPUs)"
    )

    # Storage
    storage_gb: int = Field(default=20, ge=5, le=1000)

    # Network bandwidth (Mbps)
    bandwidth_mbps: int | None = Field(default=None, ge=0, le=10000)

    # Pricing
    hourly_rate_cents: int = Field(ge=0)

    # Availability
    is_available: bool = True
    requires_subscription: str | None = None  # Plan slug or None for free tier


class UpdateHardwareSpecRequest(BaseModel):
    """Update hardware specification request."""

    display_name: str | None = None
    description: str | None = None
    vcpu: int | None = Field(default=None, ge=1, le=128)
    memory_mb: int | None = Field(default=None, ge=512, le=524288)
    gpu_type: str | None = None
    gpu_memory_gb: int | None = Field(default=None, ge=1, le=80)
    gpu_count: int | None = Field(default=None, ge=0, le=8)
    is_gpu: bool | None = None
    requires_gke: bool | None = None
    storage_gb: int | None = Field(default=None, ge=5, le=1000)
    bandwidth_mbps: int | None = Field(default=None, ge=0, le=10000)
    hourly_rate_cents: int | None = Field(default=None, ge=0)
    is_available: bool | None = None
    requires_subscription: str | None = None


class AdminHardwareSpecResponse(BaseModel):
    """Admin hardware specification response with usage stats."""

    id: str
    tier: str
    display_name: str
    description: str | None
    architecture: str
    vcpu: int
    memory_mb: int
    gpu_type: str | None
    gpu_memory_gb: int | None
    gpu_count: int
    is_gpu: bool
    requires_gke: bool
    storage_gb: int
    bandwidth_mbps: int | None
    hourly_rate_cents: int
    is_available: bool
    requires_subscription: str | None
    created_at: datetime
    updated_at: datetime

    # Aggregated
    active_session_count: int = 0
    total_usage_hours: float = 0

    model_config = ConfigDict(from_attributes=True)


# ==================== Endpoints ====================


@router.get("", response_model=list[AdminHardwareSpecResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def list_hardware_specs(
    request: Request,
    response: Response,
    db: DbSession,
    include_unavailable: Annotated[bool, Query()] = True,
) -> list[AdminHardwareSpecResponse]:
    """List all hardware specifications with usage stats."""
    query = select(HardwareSpec).order_by(HardwareSpec.hourly_rate_cents)

    if not include_unavailable:
        query = query.where(HardwareSpec.is_available == True)

    result = await db.execute(query)
    specs = result.scalars().all()

    items = []
    for spec in specs:
        # Note: Session model doesn't have hardware_tier field yet
        # Active session count would need to be tracked via UsageRecord or added field
        active_session_count = 0

        # Calculate total usage hours (estimate from sessions)
        # In production, this would come from a usage tracking table
        total_usage_hours = 0.0

        items.append(
            AdminHardwareSpecResponse(
                id=str(spec.id),
                tier=spec.tier,
                display_name=spec.display_name,
                description=spec.description,
                architecture=spec.architecture,
                vcpu=spec.vcpu,
                memory_mb=spec.memory_mb,
                gpu_type=spec.gpu_type,
                gpu_memory_gb=spec.gpu_memory_gb,
                gpu_count=spec.gpu_count,
                is_gpu=spec.is_gpu,
                requires_gke=spec.requires_gke,
                storage_gb=spec.storage_gb,
                bandwidth_mbps=spec.bandwidth_mbps,
                hourly_rate_cents=spec.hourly_rate_cents,
                is_available=spec.is_available,
                requires_subscription=spec.requires_subscription,
                created_at=spec.created_at,
                updated_at=spec.updated_at,
                active_session_count=active_session_count,
                total_usage_hours=total_usage_hours,
            )
        )

    return items


@router.post("", response_model=AdminHardwareSpecResponse, status_code=201)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def create_hardware_spec(
    request: Request,
    response: Response,
    data: CreateHardwareSpecRequest,
    db: DbSession,
) -> AdminHardwareSpecResponse:
    """Create a new hardware specification."""
    admin_id = get_admin_user_id(request)

    # Check tier uniqueness
    existing = await db.execute(select(HardwareSpec).where(HardwareSpec.tier == data.tier))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Hardware tier already exists")

    spec = HardwareSpec(
        tier=data.tier,
        display_name=data.display_name,
        description=data.description,
        architecture=data.architecture,
        vcpu=data.vcpu,
        memory_mb=data.memory_mb,
        gpu_type=data.gpu_type,
        gpu_memory_gb=data.gpu_memory_gb,
        gpu_count=data.gpu_count,
        is_gpu=data.is_gpu,
        requires_gke=data.requires_gke,
        storage_gb=data.storage_gb,
        bandwidth_mbps=data.bandwidth_mbps,
        hourly_rate_cents=data.hourly_rate_cents,
        is_available=data.is_available,
        requires_subscription=data.requires_subscription,
    )

    db.add(spec)
    await db.commit()
    await db.refresh(spec)

    logger.info("Admin created hardware spec", admin_id=admin_id, tier=spec.tier)

    return AdminHardwareSpecResponse(
        id=str(spec.id),
        tier=spec.tier,
        display_name=spec.display_name,
        description=spec.description,
        architecture=spec.architecture,
        vcpu=spec.vcpu,
        memory_mb=spec.memory_mb,
        gpu_type=spec.gpu_type,
        gpu_memory_gb=spec.gpu_memory_gb,
        gpu_count=spec.gpu_count,
        is_gpu=spec.is_gpu,
        requires_gke=spec.requires_gke,
        storage_gb=spec.storage_gb,
        bandwidth_mbps=spec.bandwidth_mbps,
        hourly_rate_cents=spec.hourly_rate_cents,
        is_available=spec.is_available,
        requires_subscription=spec.requires_subscription,
        created_at=spec.created_at,
        updated_at=spec.updated_at,
        active_session_count=0,
        total_usage_hours=0,
    )


@router.get("/{spec_id}", response_model=AdminHardwareSpecResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_hardware_spec(
    spec_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> AdminHardwareSpecResponse:
    """Get hardware specification by ID or tier."""
    result = await db.execute(
        select(HardwareSpec).where(or_(HardwareSpec.id == spec_id, HardwareSpec.tier == spec_id))
    )
    spec = result.scalar_one_or_none()

    if not spec:
        raise HTTPException(status_code=404, detail="Hardware spec not found")

    # Note: Session model doesn't have hardware_tier field yet
    active_session_count = 0

    return AdminHardwareSpecResponse(
        id=str(spec.id),
        tier=spec.tier,
        display_name=spec.display_name,
        description=spec.description,
        architecture=spec.architecture,
        vcpu=spec.vcpu,
        memory_mb=spec.memory_mb,
        gpu_type=spec.gpu_type,
        gpu_memory_gb=spec.gpu_memory_gb,
        gpu_count=spec.gpu_count,
        is_gpu=spec.is_gpu,
        requires_gke=spec.requires_gke,
        storage_gb=spec.storage_gb,
        bandwidth_mbps=spec.bandwidth_mbps,
        hourly_rate_cents=spec.hourly_rate_cents,
        is_available=spec.is_available,
        requires_subscription=spec.requires_subscription,
        created_at=spec.created_at,
        updated_at=spec.updated_at,
        active_session_count=active_session_count,
        total_usage_hours=0,
    )


@router.patch("/{spec_id}", response_model=AdminHardwareSpecResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def update_hardware_spec(
    spec_id: str,
    request: Request,
    response: Response,
    data: UpdateHardwareSpecRequest,
    db: DbSession,
) -> AdminHardwareSpecResponse:
    """Update hardware specification."""
    admin_id = get_admin_user_id(request)

    result = await db.execute(select(HardwareSpec).where(HardwareSpec.id == spec_id))
    spec = result.scalar_one_or_none()

    if not spec:
        raise HTTPException(status_code=404, detail="Hardware spec not found")

    update_data = data.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        setattr(spec, field, value)

    await db.commit()
    await db.refresh(spec)

    logger.info(
        "Admin updated hardware spec",
        admin_id=admin_id,
        spec_id=spec_id,
        changes=list(update_data.keys()),
    )

    return cast("AdminHardwareSpecResponse", await get_hardware_spec(spec_id, request, db))


@router.delete("/{spec_id}")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def delete_hardware_spec(
    spec_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, str]:
    """Delete hardware specification (soft delete by marking unavailable)."""
    admin_id = get_admin_user_id(request)

    result = await db.execute(select(HardwareSpec).where(HardwareSpec.id == spec_id))
    spec = result.scalar_one_or_none()

    if not spec:
        raise HTTPException(status_code=404, detail="Hardware spec not found")

    # Note: Session model doesn't have hardware_tier field yet
    # Would need to check UsageRecord for active usage or add field to Session
    active_count = 0

    if active_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete hardware spec with {active_count} active sessions. "
            "Mark as unavailable instead.",
        )

    # Soft delete
    spec.is_available = False
    await db.commit()

    logger.info("Admin deleted hardware spec", admin_id=admin_id, tier=spec.tier)

    return {"message": "Hardware spec marked as unavailable"}
