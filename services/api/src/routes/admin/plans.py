"""Admin subscription plan management routes."""

from datetime import datetime
from typing import Annotated, Any, cast

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import SubscriptionPlan, UserSubscription
from src.middleware.admin import get_admin_user_id, require_admin
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

logger = structlog.get_logger()

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db)]


# ==================== Pydantic Models ====================


class PlanFeaturesInput(BaseModel):
    """Plan features input."""

    private_projects: bool = False
    git_integration: bool = False
    agent_memory: bool = False
    planning_mode: bool = False
    vision_analysis: bool = False
    team_collaboration: bool = False
    gpu_access: bool = False
    advanced_analytics: bool = False
    audit_logs: bool = False
    custom_agents: bool = False
    sso_saml: bool = False
    self_hosted_option: bool = False
    sla: bool = False
    community_support: bool = False
    email_support: bool = False
    priority_support: bool = False
    dedicated_support: bool = False


class CreatePlanRequest(BaseModel):
    """Create subscription plan request."""

    name: str = Field(..., min_length=1, max_length=100)
    slug: str = Field(..., pattern=r"^[a-z0-9-]+$", min_length=1, max_length=50)
    description: str | None = None

    # Pricing (in cents)
    price_monthly_cents: int = Field(ge=0)
    price_yearly_cents: int = Field(ge=0)
    currency: str = "USD"

    # Included allowances
    tokens_included: int = Field(ge=0)
    compute_credits_cents_included: int = Field(ge=0, default=0)
    storage_gb_included: int = Field(ge=0)

    # Limits
    max_agents: int = Field(ge=1)
    max_sessions: int = Field(ge=1)
    max_team_members: int = Field(ge=1)

    # Overage rates (in cents)
    overage_token_rate_cents: int = Field(ge=0, default=0)
    overage_compute_rate_cents: int = Field(ge=0, default=0)
    overage_storage_rate_cents: int = Field(ge=0, default=0)
    overage_allowed: bool = False

    # Internal margins (percentages)
    llm_margin_percent: int = Field(ge=0, le=100, default=0)
    compute_margin_percent: int = Field(ge=0, le=100, default=0)

    # Features
    features: PlanFeaturesInput = Field(default_factory=PlanFeaturesInput)

    # Display
    is_active: bool = True
    is_popular: bool = False
    is_enterprise: bool = False
    sort_order: int = 0

    # Stripe IDs (optional)
    stripe_price_id_monthly: str | None = None
    stripe_price_id_yearly: str | None = None
    stripe_product_id: str | None = None


class UpdatePlanRequest(BaseModel):
    """Update subscription plan request."""

    name: str | None = None
    description: str | None = None
    price_monthly_cents: int | None = Field(ge=0, default=None)
    price_yearly_cents: int | None = Field(ge=0, default=None)
    tokens_included: int | None = Field(ge=0, default=None)
    compute_credits_cents_included: int | None = Field(ge=0, default=None)
    storage_gb_included: int | None = Field(ge=0, default=None)
    max_agents: int | None = Field(ge=1, default=None)
    max_sessions: int | None = Field(ge=1, default=None)
    max_team_members: int | None = Field(ge=1, default=None)
    overage_token_rate_cents: int | None = Field(ge=0, default=None)
    overage_compute_rate_cents: int | None = Field(ge=0, default=None)
    overage_storage_rate_cents: int | None = Field(ge=0, default=None)
    overage_allowed: bool | None = None
    llm_margin_percent: int | None = Field(ge=0, le=100, default=None)
    compute_margin_percent: int | None = Field(ge=0, le=100, default=None)
    features: dict[str, bool] | None = None
    is_active: bool | None = None
    is_popular: bool | None = None
    is_enterprise: bool | None = None
    sort_order: int | None = None
    stripe_price_id_monthly: str | None = None
    stripe_price_id_yearly: str | None = None
    stripe_product_id: str | None = None


class AdminPlanResponse(BaseModel):
    """Admin plan response with subscriber count."""

    id: str
    name: str
    slug: str
    description: str | None
    price_monthly_cents: int
    price_yearly_cents: int
    currency: str
    tokens_included: int
    compute_credits_cents_included: int
    storage_gb_included: int
    max_agents: int
    max_sessions: int
    max_team_members: int
    overage_token_rate_cents: int | None
    overage_compute_rate_cents: int | None
    overage_storage_rate_cents: int | None
    overage_allowed: bool
    llm_margin_percent: int
    compute_margin_percent: int
    features: dict[str, Any]
    is_active: bool
    is_popular: bool
    is_enterprise: bool
    sort_order: int
    stripe_price_id_monthly: str | None
    stripe_price_id_yearly: str | None
    stripe_product_id: str | None
    created_at: datetime
    updated_at: datetime

    # Aggregated
    subscriber_count: int = 0

    class Config:
        from_attributes = True


# ==================== Endpoints ====================


@router.get("", response_model=list[AdminPlanResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def list_plans(
    request: Request,
    response: Response,
    db: DbSession,
    include_inactive: Annotated[bool, Query()] = True,
) -> list[AdminPlanResponse]:
    """List all subscription plans with subscriber counts."""
    query = select(SubscriptionPlan).order_by(SubscriptionPlan.sort_order)

    if not include_inactive:
        query = query.where(SubscriptionPlan.is_active == True)  # noqa: E712

    result = await db.execute(query)
    plans = result.scalars().all()

    items = []
    for plan in plans:
        # Get subscriber count
        sub_count_result = await db.execute(
            select(func.count())
            .select_from(UserSubscription)
            .where(UserSubscription.plan_id == plan.id)
            .where(UserSubscription.status.in_(["active", "trialing"]))
        )
        subscriber_count = sub_count_result.scalar() or 0

        items.append(
            AdminPlanResponse(
                id=str(plan.id),
                name=plan.name,
                slug=plan.slug,
                description=plan.description,
                price_monthly_cents=plan.price_monthly_cents,
                price_yearly_cents=plan.price_yearly_cents,
                currency=plan.currency,
                tokens_included=plan.tokens_included,
                compute_credits_cents_included=plan.compute_credits_cents_included,
                storage_gb_included=plan.storage_gb_included,
                max_agents=plan.max_agents,
                max_sessions=plan.max_sessions,
                max_team_members=plan.max_team_members,
                overage_token_rate_cents=plan.overage_token_rate_cents,
                overage_compute_rate_cents=plan.overage_compute_rate_cents,
                overage_storage_rate_cents=plan.overage_storage_rate_cents,
                overage_allowed=plan.overage_allowed,
                llm_margin_percent=plan.llm_margin_percent,
                compute_margin_percent=plan.compute_margin_percent,
                features=plan.features or {},
                is_active=plan.is_active,
                is_popular=plan.is_popular,
                is_enterprise=plan.is_enterprise,
                sort_order=plan.sort_order,
                stripe_price_id_monthly=plan.stripe_price_id_monthly,
                stripe_price_id_yearly=plan.stripe_price_id_yearly,
                stripe_product_id=plan.stripe_product_id,
                created_at=plan.created_at,
                updated_at=plan.updated_at,
                subscriber_count=subscriber_count,
            )
        )

    return items


@router.post("", response_model=AdminPlanResponse, status_code=201)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def create_plan(
    request: Request,
    response: Response,
    data: CreatePlanRequest,
    db: DbSession,
) -> AdminPlanResponse:
    """Create a new subscription plan."""
    admin_id = get_admin_user_id(request)

    # Check slug uniqueness
    existing = await db.execute(select(SubscriptionPlan).where(SubscriptionPlan.slug == data.slug))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Plan slug already exists")

    plan = SubscriptionPlan(
        name=data.name,
        slug=data.slug,
        description=data.description,
        price_monthly_cents=data.price_monthly_cents,
        price_yearly_cents=data.price_yearly_cents,
        currency=data.currency,
        tokens_included=data.tokens_included,
        compute_credits_cents_included=data.compute_credits_cents_included,
        storage_gb_included=data.storage_gb_included,
        max_agents=data.max_agents,
        max_sessions=data.max_sessions,
        max_team_members=data.max_team_members,
        overage_token_rate_cents=data.overage_token_rate_cents,
        overage_compute_rate_cents=data.overage_compute_rate_cents,
        overage_storage_rate_cents=data.overage_storage_rate_cents,
        overage_allowed=data.overage_allowed,
        llm_margin_percent=data.llm_margin_percent,
        compute_margin_percent=data.compute_margin_percent,
        features=data.features.model_dump(),
        is_active=data.is_active,
        is_popular=data.is_popular,
        is_enterprise=data.is_enterprise,
        sort_order=data.sort_order,
        stripe_price_id_monthly=data.stripe_price_id_monthly,
        stripe_price_id_yearly=data.stripe_price_id_yearly,
        stripe_product_id=data.stripe_product_id,
    )

    db.add(plan)
    await db.commit()
    await db.refresh(plan)

    logger.info("Admin created plan", admin_id=admin_id, plan_slug=plan.slug)

    return AdminPlanResponse(
        id=str(plan.id),
        name=plan.name,
        slug=plan.slug,
        description=plan.description,
        price_monthly_cents=plan.price_monthly_cents,
        price_yearly_cents=plan.price_yearly_cents,
        currency=plan.currency,
        tokens_included=plan.tokens_included,
        compute_credits_cents_included=plan.compute_credits_cents_included,
        storage_gb_included=plan.storage_gb_included,
        max_agents=plan.max_agents,
        max_sessions=plan.max_sessions,
        max_team_members=plan.max_team_members,
        overage_token_rate_cents=plan.overage_token_rate_cents,
        overage_compute_rate_cents=plan.overage_compute_rate_cents,
        overage_storage_rate_cents=plan.overage_storage_rate_cents,
        overage_allowed=plan.overage_allowed,
        llm_margin_percent=plan.llm_margin_percent,
        compute_margin_percent=plan.compute_margin_percent,
        features=plan.features or {},
        is_active=plan.is_active,
        is_popular=plan.is_popular,
        is_enterprise=plan.is_enterprise,
        sort_order=plan.sort_order,
        stripe_price_id_monthly=plan.stripe_price_id_monthly,
        stripe_price_id_yearly=plan.stripe_price_id_yearly,
        stripe_product_id=plan.stripe_product_id,
        created_at=plan.created_at,
        updated_at=plan.updated_at,
        subscriber_count=0,
    )


@router.get("/{plan_id}", response_model=AdminPlanResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_plan(
    plan_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> AdminPlanResponse:
    """Get subscription plan by ID or slug."""
    result = await db.execute(
        select(SubscriptionPlan).where(
            or_(SubscriptionPlan.id == plan_id, SubscriptionPlan.slug == plan_id)
        )
    )
    plan = result.scalar_one_or_none()

    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    sub_count_result = await db.execute(
        select(func.count())
        .select_from(UserSubscription)
        .where(UserSubscription.plan_id == plan.id)
        .where(UserSubscription.status.in_(["active", "trialing"]))
    )
    subscriber_count = sub_count_result.scalar() or 0

    return AdminPlanResponse(
        id=str(plan.id),
        name=plan.name,
        slug=plan.slug,
        description=plan.description,
        price_monthly_cents=plan.price_monthly_cents,
        price_yearly_cents=plan.price_yearly_cents,
        currency=plan.currency,
        tokens_included=plan.tokens_included,
        compute_credits_cents_included=plan.compute_credits_cents_included,
        storage_gb_included=plan.storage_gb_included,
        max_agents=plan.max_agents,
        max_sessions=plan.max_sessions,
        max_team_members=plan.max_team_members,
        overage_token_rate_cents=plan.overage_token_rate_cents,
        overage_compute_rate_cents=plan.overage_compute_rate_cents,
        overage_storage_rate_cents=plan.overage_storage_rate_cents,
        overage_allowed=plan.overage_allowed,
        llm_margin_percent=plan.llm_margin_percent,
        compute_margin_percent=plan.compute_margin_percent,
        features=plan.features or {},
        is_active=plan.is_active,
        is_popular=plan.is_popular,
        is_enterprise=plan.is_enterprise,
        sort_order=plan.sort_order,
        stripe_price_id_monthly=plan.stripe_price_id_monthly,
        stripe_price_id_yearly=plan.stripe_price_id_yearly,
        stripe_product_id=plan.stripe_product_id,
        created_at=plan.created_at,
        updated_at=plan.updated_at,
        subscriber_count=subscriber_count,
    )


@router.patch("/{plan_id}", response_model=AdminPlanResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def update_plan(
    plan_id: str,
    request: Request,
    response: Response,
    data: UpdatePlanRequest,
    db: DbSession,
) -> AdminPlanResponse:
    """Update subscription plan."""
    admin_id = get_admin_user_id(request)

    result = await db.execute(select(SubscriptionPlan).where(SubscriptionPlan.id == plan_id))
    plan = result.scalar_one_or_none()

    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    # Update fields
    update_data = data.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        setattr(plan, field, value)

    await db.commit()
    await db.refresh(plan)

    logger.info(
        "Admin updated plan",
        admin_id=admin_id,
        plan_id=plan_id,
        changes=list(update_data.keys()),
    )

    return cast("AdminPlanResponse", await get_plan(plan_id, request, db))


@router.delete("/{plan_id}")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def delete_plan(
    plan_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, str]:
    """Delete subscription plan (soft delete by deactivating)."""
    admin_id = get_admin_user_id(request)

    result = await db.execute(select(SubscriptionPlan).where(SubscriptionPlan.id == plan_id))
    plan = result.scalar_one_or_none()

    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    # Check for active subscribers
    sub_count_result = await db.execute(
        select(func.count())
        .select_from(UserSubscription)
        .where(UserSubscription.plan_id == plan.id)
        .where(UserSubscription.status.in_(["active", "trialing"]))
    )
    subscriber_count = sub_count_result.scalar() or 0

    if subscriber_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete plan with {subscriber_count} active subscribers. "
            "Deactivate instead.",
        )

    # Soft delete
    plan.is_active = False
    await db.commit()

    logger.info("Admin deleted plan", admin_id=admin_id, plan_slug=plan.slug)

    return {"message": "Plan deactivated"}


# ==================== Seed Default Plans ====================

DEFAULT_PLANS = [
    {
        "name": "Free",
        "slug": "free",
        "description": "Get started with Podex for free",
        "price_monthly_cents": 0,
        "price_yearly_cents": 0,
        "currency": "USD",
        "tokens_included": 100000,
        "compute_credits_cents_included": 500,
        "storage_gb_included": 5,
        "max_agents": 1,
        "max_sessions": 3,
        "max_team_members": 1,
        "overage_allowed": False,
        "llm_margin_percent": 0,
        "compute_margin_percent": 20,
        "features": {
            "private_projects": False,
            "git_integration": True,
            "agent_memory": False,
            "planning_mode": False,
            "vision_analysis": False,
            "team_collaboration": False,
            "gpu_access": False,
            "community_support": True,
        },
        "is_active": True,
        "is_popular": False,
        "is_enterprise": False,
        "sort_order": 0,
    },
    {
        "name": "Pro",
        "slug": "pro",
        "description": "For professional developers and small teams",
        "price_monthly_cents": 2900,
        "price_yearly_cents": 29000,
        "currency": "USD",
        "tokens_included": 1000000,
        "compute_credits_cents_included": 2000,
        "storage_gb_included": 50,
        "max_agents": 5,
        "max_sessions": 10,
        "max_team_members": 5,
        "overage_allowed": True,
        "llm_margin_percent": 20,
        "compute_margin_percent": 20,
        "features": {
            "private_projects": True,
            "git_integration": True,
            "agent_memory": True,
            "planning_mode": True,
            "vision_analysis": True,
            "team_collaboration": True,
            "gpu_access": False,
            "advanced_analytics": True,
            "custom_agents": True,
            "email_support": True,
        },
        "is_active": True,
        "is_popular": True,
        "is_enterprise": False,
        "sort_order": 1,
    },
    {
        "name": "Max",
        "slug": "max",
        "description": "For growing teams with advanced needs",
        "price_monthly_cents": 9900,
        "price_yearly_cents": 99000,
        "currency": "USD",
        "tokens_included": 5000000,
        "compute_credits_cents_included": 5000,
        "storage_gb_included": 200,
        "max_agents": 20,
        "max_sessions": 50,
        "max_team_members": 20,
        "overage_allowed": True,
        "llm_margin_percent": 25,
        "compute_margin_percent": 20,
        "features": {
            "private_projects": True,
            "git_integration": True,
            "agent_memory": True,
            "planning_mode": True,
            "vision_analysis": True,
            "team_collaboration": True,
            "gpu_access": True,
            "advanced_analytics": True,
            "audit_logs": True,
            "custom_agents": True,
            "priority_support": False,
        },
        "is_active": True,
        "is_popular": False,
        "is_enterprise": False,
        "sort_order": 2,
    },
    {
        "name": "Enterprise",
        "slug": "enterprise",
        "description": "Custom solutions for large organizations",
        "price_monthly_cents": 0,
        "price_yearly_cents": 0,
        "currency": "USD",
        "tokens_included": 100000000,
        "compute_credits_cents_included": 100000,
        "storage_gb_included": 1000,
        "max_agents": 100,
        "max_sessions": 200,
        "max_team_members": 100,
        "overage_allowed": True,
        "llm_margin_percent": 30,
        "compute_margin_percent": 20,
        "features": {
            "private_projects": True,
            "git_integration": True,
            "agent_memory": True,
            "planning_mode": True,
            "vision_analysis": True,
            "team_collaboration": True,
            "gpu_access": True,
            "advanced_analytics": True,
            "audit_logs": True,
            "custom_agents": True,
            "priority_support": True,
            "sso_saml": True,
            "self_hosted_option": True,
            "sla": True,
            "dedicated_support": True,
        },
        "is_active": True,
        "is_popular": False,
        "is_enterprise": True,
        "sort_order": 3,
    },
]


@router.post("/seed")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def seed_default_plans(
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, int]:
    """Seed default subscription plans (admin only)."""
    admin_id = get_admin_user_id(request)
    created = 0

    for plan_data in DEFAULT_PLANS:
        result = await db.execute(
            select(SubscriptionPlan).where(SubscriptionPlan.slug == plan_data["slug"])
        )
        if result.scalar_one_or_none():
            continue

        plan = SubscriptionPlan(**plan_data)
        db.add(plan)
        created += 1

    await db.commit()
    logger.info("Admin seeded plans", admin_id=admin_id, created=created)

    return {"created": created, "total": len(DEFAULT_PLANS)}
