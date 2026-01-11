"""Admin hardware specification management routes."""

from datetime import datetime
from typing import Annotated, cast

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
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
    architecture: str = Field(default="x86_64", pattern=r"^(x86_64|arm64)$")
    vcpu: int = Field(ge=1, le=128)
    memory_mb: int = Field(ge=512, le=524288)  # Max 512GB

    # GPU specs
    gpu_type: str | None = None
    gpu_memory_gb: int | None = Field(default=None, ge=1, le=80)
    gpu_count: int = Field(default=0, ge=0, le=8)

    # Storage
    storage_gb_default: int = Field(default=20, ge=5, le=1000)
    storage_gb_max: int = Field(default=100, ge=10, le=10000)

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
    storage_gb_default: int | None = Field(default=None, ge=5, le=1000)
    storage_gb_max: int | None = Field(default=None, ge=10, le=10000)
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
    storage_gb_default: int
    storage_gb_max: int
    hourly_rate_cents: int
    is_available: bool
    requires_subscription: str | None
    created_at: datetime
    updated_at: datetime

    # Aggregated
    active_session_count: int = 0
    total_usage_hours: float = 0

    class Config:
        from_attributes = True


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
        query = query.where(HardwareSpec.is_available == True)  # noqa: E712

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
                storage_gb_default=spec.storage_gb_default,
                storage_gb_max=spec.storage_gb_max,
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
        storage_gb_default=data.storage_gb_default,
        storage_gb_max=data.storage_gb_max,
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
        storage_gb_default=spec.storage_gb_default,
        storage_gb_max=spec.storage_gb_max,
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
        storage_gb_default=spec.storage_gb_default,
        storage_gb_max=spec.storage_gb_max,
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


# ==================== Seed Default Hardware Specs ====================

DEFAULT_HARDWARE_SPECS = [
    # ==================== x86_64 CPU Tiers ====================
    {
        "tier": "x86-micro",
        "display_name": "Micro (x86)",
        "description": "Lightweight x86 environment for simple tasks",
        "architecture": "x86_64",
        "vcpu": 1,
        "memory_mb": 1024,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "storage_gb_default": 10,
        "storage_gb_max": 20,
        "hourly_rate_cents": 0,
        "is_available": True,
        "requires_subscription": None,
        "sort_order": 0,
    },
    {
        "tier": "x86-small",
        "display_name": "Small (x86)",
        "description": "Basic x86 development environment",
        "architecture": "x86_64",
        "vcpu": 2,
        "memory_mb": 4096,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "storage_gb_default": 20,
        "storage_gb_max": 50,
        "hourly_rate_cents": 5,
        "is_available": True,
        "requires_subscription": None,
        "sort_order": 1,
    },
    {
        "tier": "x86-medium",
        "display_name": "Medium (x86)",
        "description": "Standard x86 development environment",
        "architecture": "x86_64",
        "vcpu": 4,
        "memory_mb": 8192,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "storage_gb_default": 50,
        "storage_gb_max": 100,
        "hourly_rate_cents": 15,
        "is_available": True,
        "requires_subscription": "pro",
        "sort_order": 2,
    },
    {
        "tier": "x86-large",
        "display_name": "Large (x86)",
        "description": "High-performance x86 environment",
        "architecture": "x86_64",
        "vcpu": 8,
        "memory_mb": 16384,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "storage_gb_default": 100,
        "storage_gb_max": 200,
        "hourly_rate_cents": 35,
        "is_available": True,
        "requires_subscription": "team",
        "sort_order": 3,
    },
    {
        "tier": "x86-xlarge",
        "display_name": "X-Large (x86)",
        "description": "Maximum performance x86 environment",
        "architecture": "x86_64",
        "vcpu": 16,
        "memory_mb": 32768,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "storage_gb_default": 200,
        "storage_gb_max": 500,
        "hourly_rate_cents": 75,
        "is_available": True,
        "requires_subscription": "team",
        "sort_order": 4,
    },
    # ==================== ARM64 CPU Tiers ====================
    {
        "tier": "arm-micro",
        "display_name": "Micro (ARM)",
        "description": "Lightweight ARM environment - cost effective",
        "architecture": "arm64",
        "vcpu": 1,
        "memory_mb": 1024,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "storage_gb_default": 10,
        "storage_gb_max": 20,
        "hourly_rate_cents": 0,
        "is_available": True,
        "requires_subscription": None,
        "sort_order": 10,
    },
    {
        "tier": "arm-small",
        "display_name": "Small (ARM)",
        "description": "Basic ARM development - great price/performance",
        "architecture": "arm64",
        "vcpu": 2,
        "memory_mb": 4096,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "storage_gb_default": 20,
        "storage_gb_max": 50,
        "hourly_rate_cents": 4,
        "is_available": True,
        "requires_subscription": None,
        "sort_order": 11,
    },
    {
        "tier": "arm-medium",
        "display_name": "Medium (ARM)",
        "description": "Standard ARM development - efficient compute",
        "architecture": "arm64",
        "vcpu": 4,
        "memory_mb": 8192,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "storage_gb_default": 50,
        "storage_gb_max": 100,
        "hourly_rate_cents": 12,
        "is_available": True,
        "requires_subscription": "pro",
        "sort_order": 12,
    },
    {
        "tier": "arm-large",
        "display_name": "Large (ARM)",
        "description": "High-performance ARM environment",
        "architecture": "arm64",
        "vcpu": 8,
        "memory_mb": 16384,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "storage_gb_default": 100,
        "storage_gb_max": 200,
        "hourly_rate_cents": 28,
        "is_available": True,
        "requires_subscription": "team",
        "sort_order": 13,
    },
    {
        "tier": "arm-xlarge",
        "display_name": "X-Large (ARM)",
        "description": "Maximum performance ARM environment",
        "architecture": "arm64",
        "vcpu": 16,
        "memory_mb": 32768,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "storage_gb_default": 200,
        "storage_gb_max": 500,
        "hourly_rate_cents": 60,
        "is_available": True,
        "requires_subscription": "team",
        "sort_order": 14,
    },
    # ==================== GPU Tiers (x86 only) ====================
    {
        "tier": "gpu-t4",
        "display_name": "GPU T4",
        "description": "NVIDIA T4 - inference and light training",
        "architecture": "x86_64",
        "vcpu": 4,
        "memory_mb": 16384,
        "gpu_type": "NVIDIA T4",
        "gpu_memory_gb": 16,
        "gpu_count": 1,
        "storage_gb_default": 100,
        "storage_gb_max": 200,
        "hourly_rate_cents": 80,
        "is_available": True,
        "requires_subscription": "pro",
        "sort_order": 20,
    },
    {
        "tier": "gpu-l4",
        "display_name": "GPU L4",
        "description": "NVIDIA L4 - efficient AI/ML workloads",
        "architecture": "x86_64",
        "vcpu": 8,
        "memory_mb": 32768,
        "gpu_type": "NVIDIA L4",
        "gpu_memory_gb": 24,
        "gpu_count": 1,
        "storage_gb_default": 150,
        "storage_gb_max": 300,
        "hourly_rate_cents": 120,
        "is_available": True,
        "requires_subscription": "team",
        "sort_order": 21,
    },
    {
        "tier": "gpu-a10g",
        "display_name": "GPU A10G",
        "description": "NVIDIA A10G - balanced ML training/inference",
        "architecture": "x86_64",
        "vcpu": 8,
        "memory_mb": 32768,
        "gpu_type": "NVIDIA A10G",
        "gpu_memory_gb": 24,
        "gpu_count": 1,
        "storage_gb_default": 200,
        "storage_gb_max": 500,
        "hourly_rate_cents": 150,
        "is_available": True,
        "requires_subscription": "team",
        "sort_order": 22,
    },
    {
        "tier": "gpu-a100-40",
        "display_name": "GPU A100 40GB",
        "description": "NVIDIA A100 40GB - serious ML training",
        "architecture": "x86_64",
        "vcpu": 12,
        "memory_mb": 98304,
        "gpu_type": "NVIDIA A100",
        "gpu_memory_gb": 40,
        "gpu_count": 1,
        "storage_gb_default": 500,
        "storage_gb_max": 1000,
        "hourly_rate_cents": 350,
        "is_available": True,
        "requires_subscription": "enterprise",
        "sort_order": 23,
    },
    {
        "tier": "gpu-a100-80",
        "display_name": "GPU A100 80GB",
        "description": "NVIDIA A100 80GB - large model training",
        "architecture": "x86_64",
        "vcpu": 12,
        "memory_mb": 131072,
        "gpu_type": "NVIDIA A100",
        "gpu_memory_gb": 80,
        "gpu_count": 1,
        "storage_gb_default": 500,
        "storage_gb_max": 2000,
        "hourly_rate_cents": 500,
        "is_available": True,
        "requires_subscription": "enterprise",
        "sort_order": 24,
    },
    {
        "tier": "gpu-h100",
        "display_name": "GPU H100",
        "description": "NVIDIA H100 - cutting-edge AI/ML performance",
        "architecture": "x86_64",
        "vcpu": 16,
        "memory_mb": 196608,
        "gpu_type": "NVIDIA H100",
        "gpu_memory_gb": 80,
        "gpu_count": 1,
        "storage_gb_default": 1000,
        "storage_gb_max": 4000,
        "hourly_rate_cents": 800,
        "is_available": True,
        "requires_subscription": "enterprise",
        "sort_order": 25,
    },
    # ==================== Multi-GPU Tiers ====================
    {
        "tier": "gpu-2xa100-40",
        "display_name": "2x GPU A100 40GB",
        "description": "Dual NVIDIA A100 40GB - distributed training",
        "architecture": "x86_64",
        "vcpu": 24,
        "memory_mb": 196608,
        "gpu_type": "NVIDIA A100",
        "gpu_memory_gb": 40,
        "gpu_count": 2,
        "storage_gb_default": 1000,
        "storage_gb_max": 2000,
        "hourly_rate_cents": 700,
        "is_available": True,
        "requires_subscription": "enterprise",
        "sort_order": 30,
    },
    {
        "tier": "gpu-4xa100-40",
        "display_name": "4x GPU A100 40GB",
        "description": "Quad NVIDIA A100 40GB - large scale training",
        "architecture": "x86_64",
        "vcpu": 48,
        "memory_mb": 393216,
        "gpu_type": "NVIDIA A100",
        "gpu_memory_gb": 40,
        "gpu_count": 4,
        "storage_gb_default": 2000,
        "storage_gb_max": 4000,
        "hourly_rate_cents": 1400,
        "is_available": True,
        "requires_subscription": "enterprise",
        "sort_order": 31,
    },
    {
        "tier": "gpu-8xa100-80",
        "display_name": "8x GPU A100 80GB",
        "description": "8x NVIDIA A100 80GB - massive model training",
        "architecture": "x86_64",
        "vcpu": 96,
        "memory_mb": 786432,
        "gpu_type": "NVIDIA A100",
        "gpu_memory_gb": 80,
        "gpu_count": 8,
        "storage_gb_default": 4000,
        "storage_gb_max": 10000,
        "hourly_rate_cents": 4000,
        "is_available": True,
        "requires_subscription": "enterprise",
        "sort_order": 32,
    },
]


@router.post("/seed")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def seed_default_hardware_specs(
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, int]:
    """Seed default hardware specifications (admin only)."""
    admin_id = get_admin_user_id(request)
    created = 0

    for spec_data in DEFAULT_HARDWARE_SPECS:
        result = await db.execute(
            select(HardwareSpec).where(HardwareSpec.tier == spec_data["tier"])
        )
        if result.scalar_one_or_none():
            continue

        spec = HardwareSpec(**spec_data)
        db.add(spec)
        created += 1

    await db.commit()
    logger.info("Admin seeded hardware specs", admin_id=admin_id, created=created)

    return {"created": created, "total": len(DEFAULT_HARDWARE_SPECS)}
