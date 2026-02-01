"""Admin organization management routes."""

from datetime import datetime
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.database.connection import get_db
from src.database.models import (
    Organization,
    OrganizationCreditTransaction,
    OrganizationMember,
    OrganizationUsageRecord,
    User,
)
from src.middleware.admin import require_admin, require_super_admin
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

logger = structlog.get_logger()

router = APIRouter()

DbSession = Annotated[AsyncSession, Depends(get_db)]


# ============================================================================
# Request/Response Models
# ============================================================================


class AdminOrganizationResponse(BaseModel):
    """Admin view of an organization."""

    id: str
    name: str
    slug: str
    credit_model: str
    credit_pool_cents: int
    auto_join_enabled: bool
    auto_join_domains: list[str] | None
    is_active: bool
    logo_url: str | None
    website: str | None
    onboarding_completed: bool
    member_count: int
    total_spending_cents: int
    owner_email: str | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminUpdateOrganizationRequest(BaseModel):
    """Admin request to update an organization."""

    name: str | None = Field(None, min_length=1, max_length=255)
    credit_model: str | None = Field(None, pattern=r"^(pooled|allocated|usage_based)$")
    credit_pool_cents: int | None = Field(None, ge=0)
    is_active: bool | None = None
    auto_join_enabled: bool | None = None
    auto_join_domains: list[str] | None = None


class AdminOrganizationListResponse(BaseModel):
    """Paginated list of organizations."""

    items: list[AdminOrganizationResponse]
    total: int
    limit: int
    offset: int


# ============================================================================
# Request/Response Models for Pricing Defaults
# ============================================================================


class PricingDefaultsResponse(BaseModel):
    """Default pricing settings for new organizations."""

    default_credit_model: str = "pooled"
    default_credit_pool_cents: int = 0
    default_spending_limit_cents: int = 0


class PricingDefaultsUpdateRequest(BaseModel):
    """Request to update pricing defaults."""

    default_credit_model: str | None = Field(None, pattern=r"^(pooled|allocated|usage_based)$")
    default_credit_pool_cents: int | None = Field(None, ge=0)
    default_spending_limit_cents: int | None = Field(None, ge=0)


# In-memory storage for pricing defaults (in production, use a config table)
_pricing_defaults = PricingDefaultsResponse()


# ============================================================================
# Routes
# ============================================================================


# IMPORTANT: Static routes must be defined BEFORE dynamic /{org_id} routes
# to prevent FastAPI from matching 'pricing-defaults' as an org_id


@router.get("/pricing-defaults", response_model=PricingDefaultsResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_pricing_defaults(
    request: Request,
    response: Response,
) -> PricingDefaultsResponse:
    """Get default pricing settings for new organizations."""
    return _pricing_defaults


@router.patch("/pricing-defaults", response_model=PricingDefaultsResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def update_pricing_defaults(
    request: Request,
    response: Response,
    data: PricingDefaultsUpdateRequest,
) -> PricingDefaultsResponse:
    """Update default pricing settings for new organizations."""
    if data.default_credit_model is not None:
        _pricing_defaults.default_credit_model = data.default_credit_model
    if data.default_credit_pool_cents is not None:
        _pricing_defaults.default_credit_pool_cents = data.default_credit_pool_cents
    if data.default_spending_limit_cents is not None:
        _pricing_defaults.default_spending_limit_cents = data.default_spending_limit_cents

    logger.info(
        "Pricing defaults updated by admin",
        admin_id=getattr(request.state, "user_id", None),
        defaults=_pricing_defaults.model_dump(),
    )

    return _pricing_defaults


@router.get("/", response_model=AdminOrganizationListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def list_organizations(
    request: Request,
    response: Response,
    db: DbSession,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(None, max_length=255),
    is_active: bool | None = Query(None),
) -> AdminOrganizationListResponse:
    """List all organizations (admin only)."""
    # PERFORMANCE: Use subqueries to avoid N+1 query problem
    # Previously: 3 queries per org (member count, spending, owner email)
    # Now: Single query with correlated subqueries

    # Subquery for member count
    member_count_subq = (
        select(func.count(OrganizationMember.id))
        .where(OrganizationMember.organization_id == Organization.id)
        .correlate(Organization)
        .scalar_subquery()
        .label("member_count")
    )

    # Subquery for total spending
    spending_subq = (
        select(func.coalesce(func.sum(OrganizationUsageRecord.total_cost_cents), 0))
        .where(OrganizationUsageRecord.organization_id == Organization.id)
        .correlate(Organization)
        .scalar_subquery()
        .label("total_spending_cents")
    )

    # Subquery for owner email
    owner_email_subq = (
        select(User.email)
        .join(OrganizationMember, OrganizationMember.user_id == User.id)
        .where(OrganizationMember.organization_id == Organization.id)
        .where(OrganizationMember.role == "owner")
        .correlate(Organization)
        .limit(1)
        .scalar_subquery()
        .label("owner_email")
    )

    # Base query with all subqueries
    query = select(
        Organization,
        member_count_subq,
        spending_subq,
        owner_email_subq,
    )

    if search:
        query = query.where(
            Organization.name.ilike(f"%{search}%") | Organization.slug.ilike(f"%{search}%")
        )

    if is_active is not None:
        query = query.where(Organization.is_active == is_active)

    # Get total count (use simpler query for count)
    count_base = select(Organization)
    if search:
        count_base = count_base.where(
            Organization.name.ilike(f"%{search}%") | Organization.slug.ilike(f"%{search}%")
        )
    if is_active is not None:
        count_base = count_base.where(Organization.is_active == is_active)
    count_query = select(func.count()).select_from(count_base.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Get paginated results with all data in single query
    result = await db.execute(
        query.order_by(Organization.created_at.desc()).limit(limit).offset(offset)
    )
    rows = result.all()

    # Build response from query results
    items = []
    for row in rows:
        org = row[0]
        member_count = row[1] or 0
        total_spending = row[2] or 0
        owner_email = row[3]

        items.append(
            AdminOrganizationResponse(
                id=org.id,
                name=org.name,
                slug=org.slug,
                credit_model=org.credit_model,
                credit_pool_cents=org.credit_pool_cents,
                auto_join_enabled=org.auto_join_enabled,
                auto_join_domains=org.auto_join_domains,
                is_active=org.is_active,
                logo_url=org.logo_url,
                website=org.website,
                onboarding_completed=org.onboarding_completed,
                member_count=member_count,
                total_spending_cents=total_spending,
                owner_email=owner_email,
                created_at=org.created_at,
                updated_at=org.updated_at,
            )
        )

    return AdminOrganizationListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{org_id}", response_model=AdminOrganizationResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_organization(
    request: Request,
    response: Response,
    org_id: str,
    db: DbSession,
) -> AdminOrganizationResponse:
    """Get organization details (admin only)."""
    org = await db.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Member count
    member_count_result = await db.execute(
        select(func.count(OrganizationMember.id)).where(
            OrganizationMember.organization_id == org.id
        )
    )
    member_count = member_count_result.scalar() or 0

    # Total spending
    spending_result = await db.execute(
        select(func.sum(OrganizationUsageRecord.total_cost_cents)).where(
            OrganizationUsageRecord.organization_id == org.id
        )
    )
    total_spending = spending_result.scalar() or 0

    # Owner email
    owner_result = await db.execute(
        select(User.email)
        .join(OrganizationMember, OrganizationMember.user_id == User.id)
        .where(OrganizationMember.organization_id == org.id)
        .where(OrganizationMember.role == "owner")
    )
    owner_email = owner_result.scalar()

    return AdminOrganizationResponse(
        id=org.id,
        name=org.name,
        slug=org.slug,
        credit_model=org.credit_model,
        credit_pool_cents=org.credit_pool_cents,
        auto_join_enabled=org.auto_join_enabled,
        auto_join_domains=org.auto_join_domains,
        is_active=org.is_active,
        logo_url=org.logo_url,
        website=org.website,
        onboarding_completed=org.onboarding_completed,
        member_count=member_count,
        total_spending_cents=total_spending,
        owner_email=owner_email,
        created_at=org.created_at,
        updated_at=org.updated_at,
    )


@router.patch("/{org_id}", response_model=AdminOrganizationResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def update_organization(
    request: Request,
    response: Response,
    org_id: str,
    data: AdminUpdateOrganizationRequest,
    db: DbSession,
) -> AdminOrganizationResponse:
    """Update an organization (admin only)."""
    admin_id = getattr(request.state, "user_id", None)

    org = await db.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    if data.name is not None:
        org.name = data.name
    if data.credit_model is not None:
        org.credit_model = data.credit_model
    if data.credit_pool_cents is not None:
        org.credit_pool_cents = data.credit_pool_cents
    if data.is_active is not None:
        org.is_active = data.is_active
    if data.auto_join_enabled is not None:
        org.auto_join_enabled = data.auto_join_enabled
    if data.auto_join_domains is not None:
        org.auto_join_domains = data.auto_join_domains

    await db.commit()
    await db.refresh(org)

    logger.info(
        "Organization updated by admin",
        org_id=org_id,
        admin_id=admin_id,
    )

    # Fetch additional data
    member_count_result = await db.execute(
        select(func.count(OrganizationMember.id)).where(
            OrganizationMember.organization_id == org.id
        )
    )
    member_count = member_count_result.scalar() or 0

    spending_result = await db.execute(
        select(func.sum(OrganizationUsageRecord.total_cost_cents)).where(
            OrganizationUsageRecord.organization_id == org.id
        )
    )
    total_spending = spending_result.scalar() or 0

    owner_result = await db.execute(
        select(User.email)
        .join(OrganizationMember, OrganizationMember.user_id == User.id)
        .where(OrganizationMember.organization_id == org.id)
        .where(OrganizationMember.role == "owner")
    )
    owner_email = owner_result.scalar()

    return AdminOrganizationResponse(
        id=org.id,
        name=org.name,
        slug=org.slug,
        credit_model=org.credit_model,
        credit_pool_cents=org.credit_pool_cents,
        auto_join_enabled=org.auto_join_enabled,
        auto_join_domains=org.auto_join_domains,
        is_active=org.is_active,
        logo_url=org.logo_url,
        website=org.website,
        onboarding_completed=org.onboarding_completed,
        member_count=member_count,
        total_spending_cents=total_spending,
        owner_email=owner_email,
        created_at=org.created_at,
        updated_at=org.updated_at,
    )


@router.post("/{org_id}/suspend")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def suspend_organization(
    request: Request,
    response: Response,
    org_id: str,
    db: DbSession,
    reason: str | None = Query(None, max_length=500),
) -> dict[str, str]:
    """Suspend an organization (admin only)."""
    admin_id = getattr(request.state, "user_id", None)

    org = await db.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    if not org.is_active:
        raise HTTPException(status_code=400, detail="Organization is already suspended")

    org.is_active = False

    await db.commit()

    logger.warning(
        "Organization suspended by admin",
        org_id=org_id,
        admin_id=admin_id,
        reason=reason,
    )

    return {"message": "Organization suspended successfully"}


@router.post("/{org_id}/activate")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def activate_organization(
    request: Request,
    response: Response,
    org_id: str,
    db: DbSession,
) -> dict[str, str]:
    """Activate a suspended organization (admin only)."""
    admin_id = getattr(request.state, "user_id", None)

    org = await db.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    if org.is_active:
        raise HTTPException(status_code=400, detail="Organization is already active")

    org.is_active = True

    await db.commit()

    logger.info(
        "Organization activated by admin",
        org_id=org_id,
        admin_id=admin_id,
    )

    return {"message": "Organization activated successfully"}


@router.get("/{org_id}/members")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def list_organization_members(
    request: Request,
    response: Response,
    org_id: str,
    db: DbSession,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """List organization members (admin only)."""
    org = await db.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    result = await db.execute(
        select(OrganizationMember)
        .options(selectinload(OrganizationMember.user))
        .where(OrganizationMember.organization_id == org_id)
        .order_by(OrganizationMember.joined_at.desc())
        .limit(limit)
        .offset(offset)
    )
    members = result.scalars().all()

    count_result = await db.execute(
        select(func.count(OrganizationMember.id)).where(
            OrganizationMember.organization_id == org_id
        )
    )
    total = count_result.scalar() or 0

    return {
        "items": [
            {
                "id": m.id,
                "user_id": m.user_id,
                "email": m.user.email if m.user else None,
                "name": m.user.name if m.user else None,
                "role": m.role,
                "spending_limit_cents": m.spending_limit_cents,
                "current_spending_cents": m.current_spending_cents,
                "allocated_credits_cents": m.allocated_credits_cents,
                "used_credits_cents": m.used_credits_cents,
                "is_blocked": m.is_blocked,
                "blocked_reason": m.blocked_reason,
                "joined_at": m.joined_at.isoformat(),
            }
            for m in members
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/{org_id}/usage")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_organization_usage(
    request: Request,
    response: Response,
    org_id: str,
    db: DbSession,
) -> dict[str, Any]:
    """Get organization usage statistics (admin only)."""
    org = await db.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Total spending
    total_result = await db.execute(
        select(func.sum(OrganizationUsageRecord.total_cost_cents)).where(
            OrganizationUsageRecord.organization_id == org_id
        )
    )
    total_spending = total_result.scalar() or 0

    # By type
    by_type_result = await db.execute(
        select(
            OrganizationUsageRecord.usage_type,
            func.sum(OrganizationUsageRecord.total_cost_cents),
            func.count(OrganizationUsageRecord.id),
        )
        .where(OrganizationUsageRecord.organization_id == org_id)
        .group_by(OrganizationUsageRecord.usage_type)
    )
    by_type = [
        {"type": row[0], "total_cents": row[1] or 0, "count": row[2]}
        for row in by_type_result.fetchall()
    ]

    # By model
    by_model_result = await db.execute(
        select(
            OrganizationUsageRecord.model,
            func.sum(OrganizationUsageRecord.total_cost_cents),
            func.count(OrganizationUsageRecord.id),
        )
        .where(OrganizationUsageRecord.organization_id == org_id)
        .where(OrganizationUsageRecord.model.isnot(None))
        .group_by(OrganizationUsageRecord.model)
    )
    by_model = [
        {"model": row[0], "total_cents": row[1] or 0, "count": row[2]}
        for row in by_model_result.fetchall()
    ]

    return {
        "total_spending_cents": total_spending,
        "credit_pool_cents": org.credit_pool_cents,
        "credit_model": org.credit_model,
        "by_type": by_type,
        "by_model": by_model,
    }


@router.post("/{org_id}/add-credits")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_super_admin
async def add_credits_to_organization(
    request: Request,
    response: Response,
    org_id: str,
    db: DbSession,
    amount_cents: int = Query(..., ge=1),
    reason: str = Query(..., max_length=500),
) -> dict[str, Any]:
    """Add credits to an organization's pool (super admin only)."""
    admin_id = getattr(request.state, "user_id", None)

    org = await db.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    org.credit_pool_cents += amount_cents

    # Create transaction record
    transaction = OrganizationCreditTransaction(
        organization_id=org_id,
        amount_cents=amount_cents,
        transaction_type="adjustment",
        description=f"Admin credit adjustment: {reason}",
        pool_balance_after_cents=org.credit_pool_cents,
    )
    db.add(transaction)

    await db.commit()

    logger.info(
        "Credits added to organization by admin",
        org_id=org_id,
        admin_id=admin_id,
        amount_cents=amount_cents,
        reason=reason,
    )

    return {
        "message": "Credits added successfully",
        "new_balance_cents": org.credit_pool_cents,
        "transaction_id": transaction.id,
    }
