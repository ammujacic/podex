"""Billing and subscription routes."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Any

import stripe
import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.cost import Budget, get_alert_manager, get_cost_tracker
from src.database import get_db
from src.database.models import (
    BillingEvent,
    CreditBalance,
    CreditTransaction,
    HardwareSpec,
    Invoice,
    SubscriptionPlan,
    UsageQuota,
    UsageRecord,
    User,
    UserSubscription,
)
from src.middleware.auth import get_current_user_id
from src.middleware.rate_limit import RATE_LIMIT_SENSITIVE, RATE_LIMIT_STANDARD, limiter
from src.services.email import EmailTemplate, get_email_service

# Initialize Stripe
if settings.STRIPE_SECRET_KEY:
    stripe.api_key = settings.STRIPE_SECRET_KEY

logger = structlog.get_logger()

# Usage alert thresholds (percentage of quota)
USAGE_WARNING_THRESHOLD = 80

router = APIRouter(prefix="/billing", tags=["billing"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@dataclass
class BillingEventContext:
    """Context for logging a billing event."""

    user_id: str
    event_type: str
    event_data: dict[str, Any]
    request: Request | None = None
    subscription_id: str | None = None
    invoice_id: str | None = None
    transaction_id: str | None = None


@dataclass
class UsageHistoryParams:
    """Parameters for usage history query."""

    page: int = 1
    page_size: int = 50
    usage_type: str | None = None
    session_id: str | None = None


# =============================================================================
# PYDANTIC MODELS
# =============================================================================


class PlanFeatures(BaseModel):
    """Plan features model."""

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


class SubscriptionPlanResponse(BaseModel):
    """Subscription plan response."""

    id: str
    name: str
    slug: str
    description: str | None
    price_monthly: float
    price_yearly: float
    currency: str
    tokens_included: int
    compute_hours_included: int  # Legacy - for backward compat
    compute_credits_included: float  # Compute credits in dollars
    storage_gb_included: int
    max_agents: int
    max_sessions: int
    max_team_members: int
    overage_allowed: bool
    overage_token_rate: float
    overage_compute_rate: float
    overage_storage_rate: float
    features: dict[str, Any]
    is_popular: bool
    is_enterprise: bool

    model_config = {"from_attributes": True}


class SubscriptionResponse(BaseModel):
    """User subscription response."""

    id: str
    user_id: str
    plan: SubscriptionPlanResponse
    status: str
    billing_cycle: str
    current_period_start: datetime
    current_period_end: datetime
    cancel_at_period_end: bool
    canceled_at: datetime | None
    trial_end: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateSubscriptionRequest(BaseModel):
    """Create subscription request."""

    plan_slug: str
    billing_cycle: str = "monthly"  # monthly or yearly


class UpdateSubscriptionRequest(BaseModel):
    """Update subscription request."""

    plan_slug: str | None = None
    cancel_at_period_end: bool | None = None
    cancellation_reason: str | None = None


class UsageSummaryResponse(BaseModel):
    """Usage summary response."""

    period_start: datetime
    period_end: datetime
    tokens_input: int
    tokens_output: int
    tokens_total: int
    tokens_cost: float
    compute_seconds: int
    compute_hours: float  # Legacy display
    compute_credits_used: float  # Compute cost in dollars
    compute_credits_included: float  # Plan's included compute in dollars
    compute_cost: float  # Same as compute_credits_used for clarity
    storage_gb: float
    storage_cost: float
    api_calls: int
    total_cost: float
    usage_by_model: dict[str, dict[str, Any]] = Field(default_factory=dict)
    usage_by_agent: dict[str, dict[str, Any]] = Field(default_factory=dict)
    usage_by_tier: dict[str, dict[str, Any]] = Field(default_factory=dict)  # Compute by tier


class UsageRecordResponse(BaseModel):
    """Usage record response."""

    id: str
    usage_type: str
    quantity: int
    unit: str
    cost: float
    model: str | None
    tier: str | None
    session_id: str | None
    agent_id: str | None
    is_overage: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class QuotaResponse(BaseModel):
    """Quota response."""

    id: str
    quota_type: str
    limit_value: int
    current_usage: int
    usage_percentage: float
    reset_at: datetime | None
    overage_allowed: bool
    is_exceeded: bool
    is_warning: bool

    model_config = {"from_attributes": True}


class CreditBalanceResponse(BaseModel):
    """Credit balance response."""

    balance: float
    pending: float
    expiring_soon: float
    total_purchased: float
    total_used: float
    total_bonus: float
    last_updated: datetime


class CreditTransactionResponse(BaseModel):
    """Credit transaction response."""

    id: str
    amount: float
    currency: str
    transaction_type: str
    description: str
    expires_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class PurchaseCreditsRequest(BaseModel):
    """Purchase credits request."""

    amount_cents: int = Field(ge=500, le=100000)  # $5 - $1000


# =============================================================================
# STRIPE CHECKOUT & PORTAL MODELS
# =============================================================================


class CheckoutSubscriptionRequest(BaseModel):
    """Request for creating a subscription checkout session."""

    plan_slug: str
    billing_cycle: str = "monthly"  # monthly or yearly
    promotion_code: str | None = None


class CheckoutCreditsRequest(BaseModel):
    """Request for creating a credits purchase checkout session."""

    amount_cents: int = Field(ge=500, le=100000)  # $5 - $1000


class CheckoutResponse(BaseModel):
    """Response containing checkout session URL."""

    checkout_url: str
    session_id: str


class PortalResponse(BaseModel):
    """Response containing customer portal URL."""

    portal_url: str


class RefundRequest(BaseModel):
    """Request for processing a refund."""

    invoice_id: str
    amount_cents: int | None = None  # None = full refund
    reason: str | None = None


class RefundResponse(BaseModel):
    """Response from processing a refund."""

    refund_id: str
    status: str
    amount: float
    currency: str


class ProrationPreviewResponse(BaseModel):
    """Response for plan change proration preview."""

    proration_amount: float
    credit_amount: float
    charge_amount: float
    currency: str


class InvoiceResponse(BaseModel):
    """Invoice response."""

    id: str
    invoice_number: str
    subtotal: float
    discount: float
    tax: float
    total: float
    currency: str
    status: str
    line_items: list[dict[str, Any]]
    period_start: datetime
    period_end: datetime
    due_date: datetime
    paid_at: datetime | None
    pdf_url: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class HardwareSpecResponse(BaseModel):
    """Hardware spec response."""

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
    hourly_rate: float
    is_available: bool
    requires_subscription: str | None
    region_availability: list[str]

    model_config = {"from_attributes": True}


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


def cents_to_dollars(cents: int) -> float:
    """Convert cents to dollars."""
    return cents / 100.0


async def log_billing_event(db: AsyncSession, ctx: BillingEventContext) -> None:
    """Log a billing event for audit."""
    event = BillingEvent(
        user_id=ctx.user_id,
        event_type=ctx.event_type,
        event_data=ctx.event_data,
        ip_address=ctx.request.client.host if ctx.request and ctx.request.client else None,
        user_agent=ctx.request.headers.get("user-agent") if ctx.request else None,
        request_id=ctx.request.headers.get("x-request-id") if ctx.request else None,
        subscription_id=ctx.subscription_id,
        invoice_id=ctx.invoice_id,
        transaction_id=ctx.transaction_id,
    )
    db.add(event)


async def get_or_create_credit_balance(db: AsyncSession, user_id: str) -> CreditBalance:
    """Get or create credit balance for user."""
    result = await db.execute(select(CreditBalance).where(CreditBalance.user_id == user_id))
    balance = result.scalar_one_or_none()

    if not balance:
        balance = CreditBalance(user_id=user_id)
        db.add(balance)
        await db.flush()

    return balance


async def get_or_create_stripe_customer(db: AsyncSession, user: User) -> str:
    """Get existing Stripe customer ID or create a new customer.

    Args:
        db: Database session
        user: User object

    Returns:
        Stripe customer ID
    """
    if user.stripe_customer_id:
        return user.stripe_customer_id

    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    # Create new Stripe customer
    customer = stripe.Customer.create(
        email=user.email,
        name=user.name or "",
        metadata={"user_id": user.id},
    )

    user.stripe_customer_id = str(customer.id)
    await db.flush()

    return str(customer.id)


async def get_user_by_id(db: AsyncSession, user_id: str) -> User:
    """Get user by ID."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


async def reset_expired_quotas(db: AsyncSession) -> int:
    """Reset quotas where reset_at <= now and update to next period.

    This should be called periodically by a background task.

    Returns:
        Number of quotas reset
    """
    now = datetime.now(UTC)

    # Find quotas that need reset
    result = await db.execute(
        select(UsageQuota).where(
            UsageQuota.reset_at.isnot(None),
            UsageQuota.reset_at <= now,
        )
    )
    quotas = result.scalars().all()

    reset_count = 0
    for quota in quotas:
        # Get user's active subscription for new period end
        sub_result = await db.execute(
            select(UserSubscription)
            .where(UserSubscription.user_id == quota.user_id)
            .where(UserSubscription.status.in_(["active", "trialing"]))
        )
        subscription = sub_result.scalar_one_or_none()

        if subscription:
            quota.current_usage = 0
            quota.last_reset_at = now
            quota.reset_at = subscription.current_period_end
            quota.warning_sent_at = None  # Reset warning flag for next period
            reset_count += 1

            logger.info(
                "Reset quota",
                user_id=quota.user_id,
                quota_type=quota.quota_type,
                new_reset_at=subscription.current_period_end.isoformat(),
            )

    return reset_count


async def deduct_credits_for_overage(
    db: AsyncSession,
    user_id: str,
    cost_cents: int,
    usage_type: str,
    description: str,
) -> bool:
    """Deduct credits from user balance for overage usage.

    Args:
        db: Database session
        user_id: User ID
        cost_cents: Cost in cents to deduct
        usage_type: Type of usage (tokens, compute, etc.)
        description: Description for the transaction

    Returns:
        True if credits were successfully deducted, False if insufficient balance
    """
    balance = await get_or_create_credit_balance(db, user_id)

    if balance.balance_cents < cost_cents:
        return False

    # Deduct from balance
    balance.balance_cents -= cost_cents
    balance.total_used_cents += cost_cents

    # Create transaction record
    transaction = CreditTransaction(
        user_id=user_id,
        amount_cents=-cost_cents,  # Negative for usage
        transaction_type="usage",
        description=description,
        balance_after_cents=balance.balance_cents,
    )
    db.add(transaction)

    logger.info(
        "Deducted credits for overage",
        user_id=user_id,
        usage_type=usage_type,
        cost_cents=cost_cents,
        remaining_balance=balance.balance_cents,
    )

    return True


async def check_and_send_usage_warning(
    db: AsyncSession,
    user_id: str,
    quota: UsageQuota,
    usage_percent: float,
) -> None:
    """Check if usage warning should be sent and send it.

    Args:
        db: Database session
        user_id: User ID
        quota: The quota to check
        usage_percent: Current usage percentage
    """
    # Only send warning at threshold and if not already sent this period
    if usage_percent < USAGE_WARNING_THRESHOLD or quota.warning_sent_at:
        return

    # Get user for email
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()

    if not user or not user.email:
        return

    email_service = get_email_service()
    try:
        await email_service.send_email(
            user.email,
            EmailTemplate.USAGE_WARNING,
            {
                "name": user.name or "there",
                "percent": int(usage_percent),
                "quota_type": quota.quota_type,
                "current_usage": quota.current_usage,
                "limit": quota.limit_value,
                "unit": "tokens" if quota.quota_type == "tokens" else "credits",
            },
        )
        quota.warning_sent_at = datetime.now(UTC)
        logger.info(
            "Sent usage warning email",
            user_id=user_id,
            quota_type=quota.quota_type,
            usage_percent=usage_percent,
        )
    except Exception as e:
        logger.warning(
            "Failed to send usage warning email",
            user_id=user_id,
            error=str(e),
        )


async def check_and_send_limit_reached(
    db: AsyncSession,
    user_id: str,
    quota: UsageQuota,
) -> None:
    """Send limit reached notification if quota is exceeded.

    Args:
        db: Database session
        user_id: User ID
        quota: The quota that was exceeded
    """
    # Get user for email
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()

    if not user or not user.email:
        return

    email_service = get_email_service()
    try:
        await email_service.send_email(
            user.email,
            EmailTemplate.USAGE_LIMIT_REACHED,
            {
                "name": user.name or "there",
                "quota_type": quota.quota_type,
                "limit": quota.limit_value,
                "unit": "tokens" if quota.quota_type == "tokens" else "credits",
            },
        )
        logger.info(
            "Sent limit reached email",
            user_id=user_id,
            quota_type=quota.quota_type,
        )
    except Exception as e:
        logger.warning(
            "Failed to send limit reached email",
            user_id=user_id,
            error=str(e),
        )


# =============================================================================
# SUBSCRIPTION PLANS ROUTES
# =============================================================================


@router.get("/plans", response_model=list[SubscriptionPlanResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_subscription_plans(
    request: Request,
    response: Response,
    db: DbSession,
) -> list[SubscriptionPlanResponse]:
    """List all active subscription plans."""
    result = await db.execute(
        select(SubscriptionPlan)
        .where(SubscriptionPlan.is_active == True)  # noqa: E712
        .order_by(SubscriptionPlan.sort_order),
    )
    plans = result.scalars().all()

    return [
        SubscriptionPlanResponse(
            id=plan.id,
            name=plan.name,
            slug=plan.slug,
            description=plan.description,
            price_monthly=cents_to_dollars(plan.price_monthly_cents),
            price_yearly=cents_to_dollars(plan.price_yearly_cents),
            currency=plan.currency,
            tokens_included=plan.tokens_included,
            compute_hours_included=plan.compute_hours_included,
            compute_credits_included=cents_to_dollars(plan.compute_credits_cents_included),
            storage_gb_included=plan.storage_gb_included,
            max_agents=plan.max_agents,
            max_sessions=plan.max_sessions,
            max_team_members=plan.max_team_members,
            overage_allowed=plan.overage_allowed,
            overage_token_rate=cents_to_dollars(plan.overage_token_rate_cents or 0),
            overage_compute_rate=cents_to_dollars(plan.overage_compute_rate_cents or 0),
            overage_storage_rate=cents_to_dollars(plan.overage_storage_rate_cents or 0),
            features=plan.features or {},
            is_popular=plan.is_popular,
            is_enterprise=plan.is_enterprise,
        )
        for plan in plans
    ]


@router.get("/plans/{slug}", response_model=SubscriptionPlanResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_subscription_plan(
    request: Request,
    response: Response,
    slug: str,
    db: DbSession,
) -> SubscriptionPlanResponse:
    """Get a specific subscription plan by slug."""
    result = await db.execute(select(SubscriptionPlan).where(SubscriptionPlan.slug == slug))
    plan = result.scalar_one_or_none()

    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    return SubscriptionPlanResponse(
        id=plan.id,
        name=plan.name,
        slug=plan.slug,
        description=plan.description,
        price_monthly=cents_to_dollars(plan.price_monthly_cents),
        price_yearly=cents_to_dollars(plan.price_yearly_cents),
        currency=plan.currency,
        tokens_included=plan.tokens_included,
        compute_hours_included=plan.compute_hours_included,
        compute_credits_included=cents_to_dollars(plan.compute_credits_cents_included),
        storage_gb_included=plan.storage_gb_included,
        max_agents=plan.max_agents,
        max_sessions=plan.max_sessions,
        max_team_members=plan.max_team_members,
        overage_allowed=plan.overage_allowed,
        overage_token_rate=cents_to_dollars(plan.overage_token_rate_cents or 0),
        overage_compute_rate=cents_to_dollars(plan.overage_compute_rate_cents or 0),
        overage_storage_rate=cents_to_dollars(plan.overage_storage_rate_cents or 0),
        features=plan.features or {},
        is_popular=plan.is_popular,
        is_enterprise=plan.is_enterprise,
    )


def _build_plan_response(plan: SubscriptionPlan) -> SubscriptionPlanResponse:
    """Helper to build SubscriptionPlanResponse from a plan."""
    return SubscriptionPlanResponse(
        id=plan.id,
        name=plan.name,
        slug=plan.slug,
        description=plan.description,
        price_monthly=cents_to_dollars(plan.price_monthly_cents),
        price_yearly=cents_to_dollars(plan.price_yearly_cents),
        currency=plan.currency,
        tokens_included=plan.tokens_included,
        compute_hours_included=plan.compute_hours_included,
        compute_credits_included=cents_to_dollars(plan.compute_credits_cents_included),
        storage_gb_included=plan.storage_gb_included,
        max_agents=plan.max_agents,
        max_sessions=plan.max_sessions,
        max_team_members=plan.max_team_members,
        overage_allowed=plan.overage_allowed,
        overage_token_rate=cents_to_dollars(plan.overage_token_rate_cents or 0),
        overage_compute_rate=cents_to_dollars(plan.overage_compute_rate_cents or 0),
        overage_storage_rate=cents_to_dollars(plan.overage_storage_rate_cents or 0),
        features=plan.features or {},
        is_popular=plan.is_popular,
        is_enterprise=plan.is_enterprise,
    )


# =============================================================================
# USER SUBSCRIPTION ROUTES
# =============================================================================


@router.get("/subscription", response_model=SubscriptionResponse | None)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_user_subscription(
    request: Request,
    response: Response,
    db: DbSession,
) -> SubscriptionResponse | None:
    """Get current user's subscription."""
    user_id = get_current_user_id(request)

    result = await db.execute(
        select(UserSubscription)
        .where(UserSubscription.user_id == user_id)
        .where(UserSubscription.status.in_(["active", "trialing", "past_due"]))
        .order_by(UserSubscription.created_at.desc())
        .limit(1),
    )
    subscription = result.scalar_one_or_none()

    if not subscription:
        return None

    # Get plan details
    plan_result = await db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.id == subscription.plan_id),
    )
    plan = plan_result.scalar_one()

    plan_response = _build_plan_response(plan)

    return SubscriptionResponse(
        id=subscription.id,
        user_id=subscription.user_id,
        plan=plan_response,
        status=subscription.status,
        billing_cycle=subscription.billing_cycle,
        current_period_start=subscription.current_period_start,
        current_period_end=subscription.current_period_end,
        cancel_at_period_end=subscription.cancel_at_period_end,
        canceled_at=subscription.canceled_at,
        trial_end=subscription.trial_end,
        created_at=subscription.created_at,
    )


@router.post("/subscription", response_model=SubscriptionResponse)
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def create_subscription(
    request: Request,
    response: Response,
    data: CreateSubscriptionRequest,
    db: DbSession,
) -> SubscriptionResponse:
    """Create a new subscription for the user."""
    user_id = get_current_user_id(request)

    # Check for existing active subscription
    existing = await db.execute(
        select(UserSubscription)
        .where(UserSubscription.user_id == user_id)
        .where(UserSubscription.status.in_(["active", "trialing"])),
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="User already has an active subscription")

    # Get the plan
    plan_result = await db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.slug == data.plan_slug),
    )
    plan = plan_result.scalar_one_or_none()

    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    if not plan.is_active:
        raise HTTPException(status_code=400, detail="Plan is not available")

    # Calculate period
    now = datetime.now(UTC)
    if data.billing_cycle == "yearly":
        period_end = now + timedelta(days=365)
    else:
        period_end = now + timedelta(days=30)

    # Create subscription
    subscription = UserSubscription(
        user_id=user_id,
        plan_id=plan.id,
        status="active",
        billing_cycle=data.billing_cycle,
        current_period_start=now,
        current_period_end=period_end,
    )
    db.add(subscription)

    # Create quotas for the user
    # Note: compute_credits is stored in cents for precision
    quota_types = [
        ("tokens", plan.tokens_included),
        ("compute_credits", plan.compute_credits_cents_included),  # In cents
        ("storage_gb", plan.storage_gb_included),
        ("sessions", plan.max_sessions),
        ("agents", plan.max_agents),
    ]

    for quota_type, limit in quota_types:
        quota = UsageQuota(
            user_id=user_id,
            quota_type=quota_type,
            limit_value=limit,
            current_usage=0,
            reset_at=period_end if quota_type in ["tokens", "compute_credits"] else None,
            overage_allowed=plan.overage_allowed,
        )
        db.add(quota)

    # Log event
    event_ctx = BillingEventContext(
        user_id=user_id,
        event_type="subscription_created",
        event_data={
            "plan_slug": plan.slug,
            "billing_cycle": data.billing_cycle,
            "period_start": now.isoformat(),
            "period_end": period_end.isoformat(),
        },
        request=request,
        subscription_id=subscription.id,
    )
    await log_billing_event(db, event_ctx)

    await db.flush()

    # Return response
    plan_response = _build_plan_response(plan)

    return SubscriptionResponse(
        id=subscription.id,
        user_id=subscription.user_id,
        plan=plan_response,
        status=subscription.status,
        billing_cycle=subscription.billing_cycle,
        current_period_start=subscription.current_period_start,
        current_period_end=subscription.current_period_end,
        cancel_at_period_end=subscription.cancel_at_period_end,
        canceled_at=subscription.canceled_at,
        trial_end=subscription.trial_end,
        created_at=subscription.created_at,
    )


@router.patch("/subscription", response_model=SubscriptionResponse)
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def update_subscription(
    request: Request,
    response: Response,
    data: UpdateSubscriptionRequest,
    db: DbSession,
) -> SubscriptionResponse:
    """Update user's subscription (upgrade/downgrade or cancel)."""
    user_id = get_current_user_id(request)

    # Get current subscription
    result = await db.execute(
        select(UserSubscription)
        .where(UserSubscription.user_id == user_id)
        .where(UserSubscription.status.in_(["active", "trialing"])),
    )
    subscription = result.scalar_one_or_none()

    if not subscription:
        raise HTTPException(status_code=404, detail="No active subscription found")

    # Handle cancellation
    if data.cancel_at_period_end is not None:
        subscription.cancel_at_period_end = data.cancel_at_period_end
        if data.cancel_at_period_end:
            subscription.canceled_at = datetime.now(UTC)
            subscription.cancellation_reason = data.cancellation_reason

            cancel_ctx = BillingEventContext(
                user_id=user_id,
                event_type="subscription_canceled",
                event_data={
                    "cancel_at_period_end": True,
                    "reason": data.cancellation_reason,
                },
                request=request,
                subscription_id=subscription.id,
            )
            await log_billing_event(db, cancel_ctx)
        else:
            subscription.canceled_at = None
            subscription.cancellation_reason = None

    # Handle plan change
    if data.plan_slug:
        plan_result = await db.execute(
            select(SubscriptionPlan).where(SubscriptionPlan.slug == data.plan_slug),
        )
        new_plan = plan_result.scalar_one_or_none()

        if not new_plan:
            raise HTTPException(status_code=404, detail="Plan not found")

        old_plan_id = subscription.plan_id
        subscription.plan_id = new_plan.id

        # Update quotas
        await db.execute(
            update(UsageQuota)
            .where(UsageQuota.user_id == user_id)
            .where(UsageQuota.quota_type == "tokens")
            .values(
                limit_value=new_plan.tokens_included,
                overage_allowed=new_plan.overage_allowed,
            ),
        )
        await db.execute(
            update(UsageQuota)
            .where(UsageQuota.user_id == user_id)
            .where(UsageQuota.quota_type == "compute_credits")
            .values(
                limit_value=new_plan.compute_credits_cents_included,
                overage_allowed=new_plan.overage_allowed,
            ),
        )
        await db.execute(
            update(UsageQuota)
            .where(UsageQuota.user_id == user_id)
            .where(UsageQuota.quota_type == "sessions")
            .values(limit_value=new_plan.max_sessions),
        )
        await db.execute(
            update(UsageQuota)
            .where(UsageQuota.user_id == user_id)
            .where(UsageQuota.quota_type == "agents")
            .values(limit_value=new_plan.max_agents),
        )

        change_ctx = BillingEventContext(
            user_id=user_id,
            event_type="plan_changed",
            event_data={
                "old_plan_id": old_plan_id,
                "new_plan_slug": data.plan_slug,
            },
            request=request,
            subscription_id=subscription.id,
        )
        await log_billing_event(db, change_ctx)

    await db.flush()

    # Get updated plan
    plan_result = await db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.id == subscription.plan_id),
    )
    plan = plan_result.scalar_one()

    plan_response = _build_plan_response(plan)

    return SubscriptionResponse(
        id=subscription.id,
        user_id=subscription.user_id,
        plan=plan_response,
        status=subscription.status,
        billing_cycle=subscription.billing_cycle,
        current_period_start=subscription.current_period_start,
        current_period_end=subscription.current_period_end,
        cancel_at_period_end=subscription.cancel_at_period_end,
        canceled_at=subscription.canceled_at,
        trial_end=subscription.trial_end,
        created_at=subscription.created_at,
    )


# =============================================================================
# STRIPE CHECKOUT & PORTAL ROUTES
# =============================================================================


@router.post("/checkout/subscription", response_model=CheckoutResponse)
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def create_subscription_checkout(
    request: Request,
    response: Response,
    data: CheckoutSubscriptionRequest,
    db: DbSession,
) -> CheckoutResponse:
    """Create a Stripe Checkout session for subscription purchase.

    This redirects the user to Stripe's hosted checkout page to complete payment.
    After successful payment, Stripe webhooks handle subscription creation.
    """
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    user_id = get_current_user_id(request)
    user = await get_user_by_id(db, user_id)

    # Check for existing active subscription
    existing = await db.execute(
        select(UserSubscription)
        .where(UserSubscription.user_id == user_id)
        .where(UserSubscription.status.in_(["active", "trialing"])),
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="User already has an active subscription. Use the portal to manage it.",
        )

    # Get the plan
    plan_result = await db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.slug == data.plan_slug),
    )
    plan = plan_result.scalar_one_or_none()

    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    if not plan.is_active:
        raise HTTPException(status_code=400, detail="Plan is not available")

    # Get or create Stripe customer
    customer_id = await get_or_create_stripe_customer(db, user)

    # Determine price ID based on billing cycle
    if data.billing_cycle == "yearly":
        price_id = plan.stripe_price_id_yearly
    else:
        price_id = plan.stripe_price_id_monthly

    if not price_id:
        raise HTTPException(
            status_code=400,
            detail=f"Plan does not have a Stripe price configured for {data.billing_cycle} billing",
        )

    # Build checkout session parameters
    session_params: dict[str, Any] = {
        "mode": "subscription",
        "customer": customer_id,
        "line_items": [{"price": price_id, "quantity": 1}],
        "success_url": f"{settings.FRONTEND_URL}/billing/success?session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{settings.FRONTEND_URL}/billing/cancel",
        "metadata": {
            "user_id": user_id,
            "plan_slug": data.plan_slug,
            "billing_cycle": data.billing_cycle,
        },
        "subscription_data": {
            "metadata": {
                "user_id": user_id,
                "plan_slug": data.plan_slug,
            }
        },
    }

    # Handle promotion codes
    if data.promotion_code:
        # Look up promotion code in Stripe
        try:
            promo_list = stripe.PromotionCode.list(
                code=data.promotion_code,
                active=True,
                limit=1,
            )
            if promo_list.data:
                session_params["discounts"] = [{"promotion_code": promo_list.data[0].id}]
            else:
                raise HTTPException(status_code=400, detail="Invalid promotion code")
        except stripe.error.StripeError as e:
            logger.warning("Promotion code lookup failed", code=data.promotion_code, error=str(e))
            raise HTTPException(status_code=400, detail="Invalid promotion code") from e
    else:
        # Allow customer to enter promo code at checkout
        session_params["allow_promotion_codes"] = True

    # Create checkout session
    try:
        session = stripe.checkout.Session.create(**session_params)
    except stripe.error.StripeError as e:
        logger.exception("Failed to create checkout session", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to create checkout session") from e

    # Log event
    await log_billing_event(
        db,
        BillingEventContext(
            user_id=user_id,
            event_type="checkout_started",
            event_data={
                "plan_slug": data.plan_slug,
                "billing_cycle": data.billing_cycle,
                "session_id": session.id,
            },
            request=request,
        ),
    )
    await db.flush()

    return CheckoutResponse(
        checkout_url=session.url or "",
        session_id=session.id,
    )


@router.post("/checkout/credits", response_model=CheckoutResponse)
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def create_credits_checkout(
    request: Request,
    response: Response,
    data: CheckoutCreditsRequest,
    db: DbSession,
) -> CheckoutResponse:
    """Create a Stripe Checkout session for credit (PAYG) purchase.

    Credits can be used for:
    - Overage usage when plan quotas are exceeded
    - Pay-as-you-go compute and token usage
    """
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    user_id = get_current_user_id(request)
    user = await get_user_by_id(db, user_id)

    # Get or create Stripe customer
    customer_id = await get_or_create_stripe_customer(db, user)

    # Create checkout session for one-time payment
    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            customer=customer_id,
            line_items=[
                {
                    "price_data": {
                        "currency": "usd",
                        "unit_amount": data.amount_cents,
                        "product_data": {
                            "name": "Podex Credits",
                            "description": f"${cents_to_dollars(data.amount_cents):.2f} in prepaid credits for compute and API usage",
                        },
                    },
                    "quantity": 1,
                }
            ],
            success_url=f"{settings.FRONTEND_URL}/billing/credits/success?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{settings.FRONTEND_URL}/billing/credits/cancel",
            metadata={
                "user_id": user_id,
                "type": "credit_purchase",
                "amount_cents": str(data.amount_cents),
            },
        )
    except stripe.error.StripeError as e:
        logger.exception("Failed to create credits checkout session", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to create checkout session") from e

    # Log event
    await log_billing_event(
        db,
        BillingEventContext(
            user_id=user_id,
            event_type="credits_checkout_started",
            event_data={
                "amount_cents": data.amount_cents,
                "session_id": session.id,
            },
            request=request,
        ),
    )
    await db.flush()

    return CheckoutResponse(
        checkout_url=session.url or "",
        session_id=session.id,
    )


@router.post("/portal", response_model=PortalResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def create_customer_portal_session(
    request: Request,
    response: Response,
    db: DbSession,
) -> PortalResponse:
    """Create a Stripe Customer Portal session.

    The customer portal allows users to:
    - View and download invoices
    - Update payment methods
    - View subscription details
    - Cancel subscription
    """
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    user_id = get_current_user_id(request)
    user = await get_user_by_id(db, user_id)

    if not user.stripe_customer_id:
        raise HTTPException(
            status_code=400,
            detail="No billing account found. Please make a purchase first.",
        )

    try:
        portal_session = stripe.billing_portal.Session.create(
            customer=user.stripe_customer_id,
            return_url=f"{settings.FRONTEND_URL}/settings/billing",
        )
    except stripe.error.StripeError as e:
        logger.exception("Failed to create portal session", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to create portal session") from e

    return PortalResponse(portal_url=portal_session.url)


@router.post("/refunds", response_model=RefundResponse)
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def process_refund(
    request: Request,
    response: Response,
    data: RefundRequest,
    db: DbSession,
) -> RefundResponse:
    """Process a refund for a paid invoice.

    Refunds can be:
    - Full refund (when amount_cents is None)
    - Partial refund (when amount_cents is specified)
    """
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    user_id = get_current_user_id(request)

    # Get invoice and verify ownership
    result = await db.execute(
        select(Invoice).where(Invoice.id == data.invoice_id).where(Invoice.user_id == user_id),
    )
    invoice = result.scalar_one_or_none()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    if invoice.status != "paid":
        raise HTTPException(status_code=400, detail="Invoice is not paid")

    if not invoice.stripe_invoice_id:
        raise HTTPException(status_code=400, detail="Invoice has no Stripe reference")

    # Get Stripe invoice to find payment intent
    try:
        stripe_invoice = stripe.Invoice.retrieve(invoice.stripe_invoice_id)
        payment_intent_id = stripe_invoice["payment_intent"]

        if not payment_intent_id:
            raise HTTPException(status_code=400, detail="No payment found for this invoice")

        # Process refund
        refund_params: dict[str, Any] = {"payment_intent": payment_intent_id}

        if data.amount_cents:
            refund_params["amount"] = data.amount_cents

        if data.reason:
            # Stripe accepts: duplicate, fraudulent, requested_by_customer
            refund_params["reason"] = "requested_by_customer"
            refund_params["metadata"] = {"reason_detail": data.reason}

        refund = stripe.Refund.create(**refund_params)

    except stripe.error.StripeError as e:
        logger.exception("Failed to process refund", error=str(e))
        raise HTTPException(status_code=500, detail=f"Refund failed: {e!s}") from e

    # Update invoice status
    if data.amount_cents and data.amount_cents < invoice.total_cents:
        invoice.status = "partially_refunded"
    else:
        invoice.status = "refunded"

    # Get user for credit balance update
    user = await get_user_by_id(db, user_id)
    balance = await get_or_create_credit_balance(db, user_id)

    # Create refund transaction record
    refund_amount = data.amount_cents or invoice.total_cents
    transaction = CreditTransaction(
        user_id=user_id,
        amount_cents=-refund_amount,  # Negative since it's a refund
        transaction_type="refund",
        description=f"Refund for invoice {invoice.invoice_number}",
        stripe_charge_id=refund.id,
        balance_after_cents=balance.balance_cents,
    )
    db.add(transaction)

    # Log event
    await log_billing_event(
        db,
        BillingEventContext(
            user_id=user_id,
            event_type="refund_processed",
            event_data={
                "invoice_id": invoice.id,
                "refund_id": refund.id,
                "amount_cents": refund.amount,
                "reason": data.reason,
            },
            request=request,
            invoice_id=invoice.id,
            transaction_id=transaction.id,
        ),
    )
    await db.commit()

    return RefundResponse(
        refund_id=refund.id,
        status=refund.status or "pending",
        amount=cents_to_dollars(refund.amount),
        currency=refund.currency.upper(),
    )


@router.get("/subscription/proration-preview", response_model=ProrationPreviewResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def preview_plan_change_proration(
    request: Request,
    response: Response,
    db: DbSession,
    new_plan_slug: str = Query(..., description="The slug of the plan to switch to"),
) -> ProrationPreviewResponse:
    """Preview the proration for changing subscription plans.

    Shows how much will be credited (for downgrades) or charged (for upgrades)
    when switching plans mid-billing-cycle.
    """
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    user_id = get_current_user_id(request)

    # Get current subscription
    result = await db.execute(
        select(UserSubscription)
        .where(UserSubscription.user_id == user_id)
        .where(UserSubscription.status.in_(["active", "trialing"])),
    )
    subscription = result.scalar_one_or_none()

    if (
        not subscription
        or not subscription.stripe_subscription_id
        or not subscription.stripe_customer_id
    ):
        raise HTTPException(status_code=404, detail="No active Stripe subscription found")

    # Get new plan
    plan_result = await db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.slug == new_plan_slug),
    )
    new_plan = plan_result.scalar_one_or_none()

    if not new_plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    # Get new price ID based on current billing cycle
    if subscription.billing_cycle == "yearly":
        new_price_id = new_plan.stripe_price_id_yearly
    else:
        new_price_id = new_plan.stripe_price_id_monthly

    if not new_price_id:
        raise HTTPException(
            status_code=400,
            detail=f"Plan does not have a Stripe price configured for {subscription.billing_cycle} billing",
        )

    try:
        # Get the Stripe subscription
        stripe_sub = stripe.Subscription.retrieve(subscription.stripe_subscription_id)
        subscription_item_id = stripe_sub["items"]["data"][0]["id"]

        # Preview the upcoming invoice with the new price
        upcoming = stripe.Invoice.create_preview(  # type: ignore[attr-defined]
            customer=subscription.stripe_customer_id,
            subscription=subscription.stripe_subscription_id,
            subscription_details={
                "items": [
                    {
                        "id": subscription_item_id,
                        "price": new_price_id,
                    }
                ],
                "proration_behavior": "create_prorations",
            },
        )

        # Calculate proration amounts
        proration_amount = 0
        credit_amount = 0
        charge_amount = 0

        for line in upcoming.lines.data:
            if getattr(line, "proration", False):
                if line.amount < 0:
                    credit_amount += abs(line.amount)
                else:
                    charge_amount += line.amount
                proration_amount += line.amount

    except stripe.error.StripeError as e:
        logger.exception("Failed to preview proration", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to calculate proration") from e

    return ProrationPreviewResponse(
        proration_amount=cents_to_dollars(proration_amount),
        credit_amount=cents_to_dollars(credit_amount),
        charge_amount=cents_to_dollars(charge_amount),
        currency="USD",
    )


# =============================================================================
# USAGE ROUTES
# =============================================================================


@dataclass
class UsageAggregation:
    """Aggregated usage data."""

    tokens_input: int = 0
    tokens_output: int = 0
    tokens_cost: float = 0.0
    compute_seconds: int = 0
    compute_cost: float = 0.0
    storage_gb: float = 0.0
    storage_cost: float = 0.0
    api_calls: int = 0
    usage_by_model: dict[str, dict[str, Any]] | None = None
    usage_by_agent: dict[str, dict[str, Any]] | None = None
    usage_by_tier: dict[str, dict[str, Any]] | None = None


def _aggregate_token_usage(
    agg: UsageAggregation,
    record: UsageRecord,
    cost_dollars: float,
) -> None:
    """Aggregate token usage from a record."""
    if agg.usage_by_model is None:
        agg.usage_by_model = {}

    if record.usage_type == "tokens_input":
        agg.tokens_input += record.quantity
        agg.tokens_cost += cost_dollars
        if record.model:
            if record.model not in agg.usage_by_model:
                agg.usage_by_model[record.model] = {"input": 0, "output": 0, "cost": 0}
            agg.usage_by_model[record.model]["input"] += record.quantity
            agg.usage_by_model[record.model]["cost"] += cost_dollars
    elif record.usage_type == "tokens_output":
        agg.tokens_output += record.quantity
        agg.tokens_cost += cost_dollars
        if record.model:
            if record.model not in agg.usage_by_model:
                agg.usage_by_model[record.model] = {"input": 0, "output": 0, "cost": 0}
            agg.usage_by_model[record.model]["output"] += record.quantity
            agg.usage_by_model[record.model]["cost"] += cost_dollars


def _aggregate_other_usage(
    agg: UsageAggregation,
    record: UsageRecord,
    cost_dollars: float,
) -> None:
    """Aggregate non-token usage from a record."""
    if record.usage_type == "compute_seconds":
        agg.compute_seconds += record.quantity
        agg.compute_cost += cost_dollars
        # Aggregate by tier
        if agg.usage_by_tier is None:
            agg.usage_by_tier = {}
        tier = record.tier or "unknown"
        if tier not in agg.usage_by_tier:
            agg.usage_by_tier[tier] = {"seconds": 0, "minutes": 0.0, "cost": 0.0}
        agg.usage_by_tier[tier]["seconds"] += record.quantity
        agg.usage_by_tier[tier]["minutes"] = round(agg.usage_by_tier[tier]["seconds"] / 60, 1)
        agg.usage_by_tier[tier]["cost"] += cost_dollars
    elif record.usage_type == "storage_gb":
        agg.storage_gb = max(agg.storage_gb, record.quantity / 1024)  # Convert MB to GB
        agg.storage_cost += cost_dollars
    elif record.usage_type == "api_calls":
        agg.api_calls += record.quantity


def _aggregate_agent_usage(
    agg: UsageAggregation,
    record: UsageRecord,
    cost_dollars: float,
) -> None:
    """Aggregate per-agent usage from a record."""
    if agg.usage_by_agent is None:
        agg.usage_by_agent = {}

    if record.agent_id and record.usage_type in ["tokens_input", "tokens_output"]:
        if record.agent_id not in agg.usage_by_agent:
            agg.usage_by_agent[record.agent_id] = {"tokens": 0, "cost": 0}
        agg.usage_by_agent[record.agent_id]["tokens"] += record.quantity
        agg.usage_by_agent[record.agent_id]["cost"] += cost_dollars


def _aggregate_usage_records(records: list[UsageRecord]) -> UsageAggregation:
    """Aggregate a list of usage records."""
    agg = UsageAggregation(usage_by_model={}, usage_by_agent={}, usage_by_tier={})

    for record in records:
        cost_dollars = cents_to_dollars(record.total_cost_cents)
        _aggregate_token_usage(agg, record, cost_dollars)
        _aggregate_other_usage(agg, record, cost_dollars)
        _aggregate_agent_usage(agg, record, cost_dollars)

    return agg


async def _get_usage_period(
    db: AsyncSession,
    user_id: str,
    period: str,
) -> tuple[datetime, datetime]:
    """Calculate the start and end dates for a usage period."""
    now = datetime.now(UTC)

    if period == "current":
        # Get current subscription period
        sub_result = await db.execute(
            select(UserSubscription)
            .where(UserSubscription.user_id == user_id)
            .where(UserSubscription.status.in_(["active", "trialing"])),
        )
        subscription = sub_result.scalar_one_or_none()
        if subscription:
            return subscription.current_period_start, subscription.current_period_end
        # Default to current month
        period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        period_end = (period_start + timedelta(days=32)).replace(day=1)
        return period_start, period_end

    if period == "last_month":
        period_end = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        period_start = (period_end - timedelta(days=1)).replace(day=1)
        return period_start, period_end

    # all_time
    return datetime(2020, 1, 1, tzinfo=UTC), now


@router.get("/usage", response_model=UsageSummaryResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_usage_summary(
    request: Request,
    response: Response,
    db: DbSession,
    period: Annotated[str, Query()] = "current",  # current, last_month, all_time
) -> UsageSummaryResponse:
    """Get usage summary for the current billing period."""
    user_id = get_current_user_id(request)

    # Determine period
    period_start, period_end = await _get_usage_period(db, user_id, period)

    # Get user's subscription plan for compute credits included
    compute_credits_included = 0.0
    sub_result = await db.execute(
        select(UserSubscription)
        .where(UserSubscription.user_id == user_id)
        .where(UserSubscription.status.in_(["active", "trialing"]))
        .order_by(UserSubscription.created_at.desc())
        .limit(1),
    )
    subscription = sub_result.scalar_one_or_none()
    if subscription:
        plan_result = await db.execute(
            select(SubscriptionPlan).where(SubscriptionPlan.id == subscription.plan_id)
        )
        plan = plan_result.scalar_one_or_none()
        if plan:
            # Convert from cents to dollars
            compute_credits_included = float(plan.compute_credits_cents_included) / 100.0

    # Query usage records
    result = await db.execute(
        select(UsageRecord)
        .where(UsageRecord.user_id == user_id)
        .where(UsageRecord.created_at >= period_start)
        .where(UsageRecord.created_at < period_end),
    )
    records = list(result.scalars().all())

    # Aggregate using helper function
    agg = _aggregate_usage_records(records)

    return UsageSummaryResponse(
        period_start=period_start,
        period_end=period_end,
        tokens_input=agg.tokens_input,
        tokens_output=agg.tokens_output,
        tokens_total=agg.tokens_input + agg.tokens_output,
        tokens_cost=agg.tokens_cost,
        compute_seconds=agg.compute_seconds,
        compute_hours=agg.compute_seconds / 3600,
        compute_credits_used=agg.compute_cost,
        compute_credits_included=compute_credits_included,
        compute_cost=agg.compute_cost,
        storage_gb=agg.storage_gb,
        storage_cost=agg.storage_cost,
        api_calls=agg.api_calls,
        total_cost=agg.tokens_cost + agg.compute_cost + agg.storage_cost,
        usage_by_model=agg.usage_by_model or {},
        usage_by_agent=agg.usage_by_agent or {},
        usage_by_tier=agg.usage_by_tier or {},
    )


def _usage_history_params(
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
    usage_type: Annotated[str | None, Query()] = None,
    session_id: Annotated[str | None, Query()] = None,
) -> UsageHistoryParams:
    """Factory for UsageHistoryParams from query parameters."""
    return UsageHistoryParams(
        page=page,
        page_size=page_size,
        usage_type=usage_type,
        session_id=session_id,
    )


@router.get("/usage/history", response_model=list[UsageRecordResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_usage_history(
    request: Request,
    response: Response,
    db: DbSession,
    params: Annotated[UsageHistoryParams, Depends(_usage_history_params)],
) -> list[UsageRecordResponse]:
    """Get detailed usage history."""
    user_id = get_current_user_id(request)

    query = select(UsageRecord).where(UsageRecord.user_id == user_id)

    if params.usage_type:
        query = query.where(UsageRecord.usage_type == params.usage_type)
    if params.session_id:
        query = query.where(UsageRecord.session_id == params.session_id)

    offset = (params.page - 1) * params.page_size
    query = query.order_by(UsageRecord.created_at.desc()).offset(offset).limit(params.page_size)

    result = await db.execute(query)
    records = result.scalars().all()

    return [
        UsageRecordResponse(
            id=record.id,
            usage_type=record.usage_type,
            quantity=record.quantity,
            unit=record.unit,
            cost=cents_to_dollars(record.total_cost_cents),
            model=record.model,
            tier=record.tier,
            session_id=record.session_id,
            agent_id=record.agent_id,
            is_overage=record.is_overage,
            created_at=record.created_at,
        )
        for record in records
    ]


# =============================================================================
# QUOTA ROUTES
# =============================================================================


def _calculate_usage_percentage(current_usage: int, limit_value: int) -> float:
    """Calculate usage as a percentage of the limit."""
    if limit_value <= 0:
        return 0.0
    return current_usage / limit_value * 100


@router.get("/quotas", response_model=list[QuotaResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_quotas(
    request: Request,
    response: Response,
    db: DbSession,
) -> list[QuotaResponse]:
    """Get current usage quotas and limits."""
    user_id = get_current_user_id(request)

    result = await db.execute(select(UsageQuota).where(UsageQuota.user_id == user_id))
    quotas = result.scalars().all()

    return [
        QuotaResponse(
            id=quota.id,
            quota_type=quota.quota_type,
            limit_value=quota.limit_value,
            current_usage=quota.current_usage,
            usage_percentage=_calculate_usage_percentage(
                quota.current_usage,
                quota.limit_value,
            ),
            reset_at=quota.reset_at,
            overage_allowed=quota.overage_allowed,
            is_exceeded=quota.current_usage >= quota.limit_value,
            is_warning=quota.current_usage >= quota.limit_value * 0.8,
        )
        for quota in quotas
    ]


# =============================================================================
# CREDIT ROUTES
# =============================================================================


@router.get("/credits", response_model=CreditBalanceResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_credit_balance(
    request: Request,
    response: Response,
    db: DbSession,
) -> CreditBalanceResponse:
    """Get user's credit balance."""
    user_id = get_current_user_id(request)

    balance = await get_or_create_credit_balance(db, user_id)

    return CreditBalanceResponse(
        balance=cents_to_dollars(balance.balance_cents),
        pending=cents_to_dollars(balance.pending_cents),
        expiring_soon=cents_to_dollars(balance.expiring_soon_cents),
        total_purchased=cents_to_dollars(balance.total_purchased_cents),
        total_used=cents_to_dollars(balance.total_used_cents),
        total_bonus=cents_to_dollars(balance.total_bonus_cents),
        last_updated=balance.last_updated,
    )


@router.post("/credits/purchase", response_model=CreditTransactionResponse)
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def purchase_credits(
    request: Request,
    response: Response,
    data: PurchaseCreditsRequest,
    db: DbSession,
) -> CreditTransactionResponse:
    """Purchase credits (placeholder for Stripe integration)."""
    user_id = get_current_user_id(request)

    # Get current balance
    balance = await get_or_create_credit_balance(db, user_id)
    new_balance = balance.balance_cents + data.amount_cents

    # Create transaction
    transaction = CreditTransaction(
        user_id=user_id,
        amount_cents=data.amount_cents,
        transaction_type="purchase",
        description=f"Purchased ${cents_to_dollars(data.amount_cents):.2f} in credits",
        balance_after_cents=new_balance,
    )
    db.add(transaction)

    # Update balance
    balance.balance_cents = new_balance
    balance.total_purchased_cents += data.amount_cents

    # Log event
    purchase_ctx = BillingEventContext(
        user_id=user_id,
        event_type="credits_purchased",
        event_data={"amount_cents": data.amount_cents},
        request=request,
        transaction_id=transaction.id,
    )
    await log_billing_event(db, purchase_ctx)

    await db.flush()

    return CreditTransactionResponse(
        id=transaction.id,
        amount=cents_to_dollars(transaction.amount_cents),
        currency=transaction.currency,
        transaction_type=transaction.transaction_type,
        description=transaction.description,
        expires_at=transaction.expires_at,
        created_at=transaction.created_at,
    )


@router.get("/credits/history", response_model=list[CreditTransactionResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_credit_history(
    request: Request,
    response: Response,
    db: DbSession,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[CreditTransactionResponse]:
    """Get credit transaction history."""
    user_id = get_current_user_id(request)

    result = await db.execute(
        select(CreditTransaction)
        .where(CreditTransaction.user_id == user_id)
        .order_by(CreditTransaction.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size),
    )
    transactions = result.scalars().all()

    return [
        CreditTransactionResponse(
            id=tx.id,
            amount=cents_to_dollars(tx.amount_cents),
            currency=tx.currency,
            transaction_type=tx.transaction_type,
            description=tx.description,
            expires_at=tx.expires_at,
            created_at=tx.created_at,
        )
        for tx in transactions
    ]


# =============================================================================
# INVOICE ROUTES
# =============================================================================


@router.get("/invoices", response_model=list[InvoiceResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_invoices(
    request: Request,
    response: Response,
    db: DbSession,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[InvoiceResponse]:
    """List user's invoices."""
    user_id = get_current_user_id(request)

    result = await db.execute(
        select(Invoice)
        .where(Invoice.user_id == user_id)
        .order_by(Invoice.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size),
    )
    invoices = result.scalars().all()

    return [
        InvoiceResponse(
            id=inv.id,
            invoice_number=inv.invoice_number,
            subtotal=cents_to_dollars(inv.subtotal_cents),
            discount=cents_to_dollars(inv.discount_cents),
            tax=cents_to_dollars(inv.tax_cents),
            total=cents_to_dollars(inv.total_cents),
            currency=inv.currency,
            status=inv.status,
            line_items=inv.line_items,
            period_start=inv.period_start,
            period_end=inv.period_end,
            due_date=inv.due_date,
            paid_at=inv.paid_at,
            pdf_url=inv.pdf_url,
            created_at=inv.created_at,
        )
        for inv in invoices
    ]


@router.get("/invoices/{invoice_id}", response_model=InvoiceResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_invoice(
    request: Request,
    response: Response,
    invoice_id: str,
    db: DbSession,
) -> InvoiceResponse:
    """Get a specific invoice."""
    user_id = get_current_user_id(request)

    result = await db.execute(
        select(Invoice).where(Invoice.id == invoice_id).where(Invoice.user_id == user_id),
    )
    invoice = result.scalar_one_or_none()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    return InvoiceResponse(
        id=invoice.id,
        invoice_number=invoice.invoice_number,
        subtotal=cents_to_dollars(invoice.subtotal_cents),
        discount=cents_to_dollars(invoice.discount_cents),
        tax=cents_to_dollars(invoice.tax_cents),
        total=cents_to_dollars(invoice.total_cents),
        currency=invoice.currency,
        status=invoice.status,
        line_items=invoice.line_items,
        period_start=invoice.period_start,
        period_end=invoice.period_end,
        due_date=invoice.due_date,
        paid_at=invoice.paid_at,
        pdf_url=invoice.pdf_url,
        created_at=invoice.created_at,
    )


# =============================================================================
# HARDWARE SPECS ROUTES
# =============================================================================


@router.get("/hardware-specs", response_model=list[HardwareSpecResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_hardware_specs(
    request: Request,
    response: Response,
    db: DbSession,
) -> list[HardwareSpecResponse]:
    """List available hardware specifications."""
    result = await db.execute(
        select(HardwareSpec)
        .where(HardwareSpec.is_available == True)  # noqa: E712
        .order_by(HardwareSpec.sort_order),
    )
    specs = result.scalars().all()

    return [
        HardwareSpecResponse(
            id=spec.id,
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
            hourly_rate=cents_to_dollars(spec.hourly_rate_cents),
            is_available=spec.is_available,
            requires_subscription=spec.requires_subscription,
            region_availability=spec.region_availability,
        )
        for spec in specs
    ]


@router.get("/hardware-specs/{tier}", response_model=HardwareSpecResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_hardware_spec(
    request: Request,
    response: Response,
    tier: str,
    db: DbSession,
) -> HardwareSpecResponse:
    """Get a specific hardware specification."""
    result = await db.execute(select(HardwareSpec).where(HardwareSpec.tier == tier))
    spec = result.scalar_one_or_none()

    if not spec:
        raise HTTPException(status_code=404, detail="Hardware spec not found")

    return HardwareSpecResponse(
        id=spec.id,
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
        hourly_rate=cents_to_dollars(spec.hourly_rate_cents),
        is_available=spec.is_available,
        requires_subscription=spec.requires_subscription,
        region_availability=spec.region_availability,
    )


# =============================================================================
# BILLING EVENTS ROUTES (Admin/Debug)
# =============================================================================


@router.get("/events", response_model=list[dict[str, Any]])
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_billing_events(
    request: Request,
    response: Response,
    db: DbSession,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[dict[str, Any]]:
    """List billing events for audit (user's own events only)."""
    user_id = get_current_user_id(request)

    result = await db.execute(
        select(BillingEvent)
        .where(BillingEvent.user_id == user_id)
        .order_by(BillingEvent.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size),
    )
    events = result.scalars().all()

    return [
        {
            "id": event.id,
            "event_type": event.event_type,
            "event_data": event.event_data,
            "created_at": event.created_at.isoformat(),
        }
        for event in events
    ]


# =============================================================================
# INTERNAL USAGE RECORDING ROUTES (Service-to-Service)
# =============================================================================


class UsageEventInput(BaseModel):
    """Input for a single usage event."""

    id: str
    user_id: str
    session_id: str | None = None
    workspace_id: str | None = None
    agent_id: str | None = None
    usage_type: str  # tokens, compute, storage, api_calls
    quantity: int
    unit: str
    unit_price_cents: int
    total_cost_cents: int
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    tier: str | None = None
    duration_seconds: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None


class RecordUsageRequest(BaseModel):
    """Request to record usage events from other services."""

    events: list[UsageEventInput]


class RecordUsageResponse(BaseModel):
    """Response from recording usage events."""

    recorded: int
    failed: int
    errors: list[str] = Field(default_factory=list)


def _verify_service_token(authorization: str | None) -> bool:
    """Verify the internal service token."""
    if not authorization:
        return False

    if not authorization.startswith("Bearer "):
        return False

    token = authorization[7:]

    # Check against configured service token
    expected_token = getattr(settings, "INTERNAL_SERVICE_TOKEN", None)
    if expected_token and token == expected_token:
        return True

    # Also allow API key for development
    return settings.ENVIRONMENT == "development"


def _apply_margin(base_cost_cents: int, margin_percent: int) -> int:
    """Apply margin percentage to base cost.

    Args:
        base_cost_cents: The base provider cost in cents
        margin_percent: The margin percentage (e.g., 15 for 15%)

    Returns:
        Total cost in cents (base + margin)
    """
    if margin_percent <= 0:
        return base_cost_cents
    margin_amount = (base_cost_cents * margin_percent) // 100
    return base_cost_cents + margin_amount


async def _get_user_margin(
    db: AsyncSession,
    user_id: str,
    usage_type: str,
) -> int:
    """Get the margin percentage for a user based on their subscription plan.

    Args:
        db: Database session
        user_id: The user ID
        usage_type: Either 'tokens' (for LLM) or 'compute'

    Returns:
        Margin percentage (0 if no subscription or free plan)
    """
    # Get user's active subscription
    sub_result = await db.execute(
        select(UserSubscription)
        .where(UserSubscription.user_id == user_id)
        .where(UserSubscription.status.in_(["active", "trialing"])),
    )
    subscription = sub_result.scalar_one_or_none()

    if not subscription:
        return 0  # No subscription = no margin (free tier)

    # Get the plan
    plan_result = await db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.id == subscription.plan_id),
    )
    plan = plan_result.scalar_one_or_none()

    if not plan:
        return 0

    # Return appropriate margin based on usage type
    if usage_type in ["tokens", "tokens_input", "tokens_output"]:
        return plan.llm_margin_percent
    if usage_type in ["compute", "compute_seconds"]:
        return plan.compute_margin_percent

    return 0


async def _record_single_event(
    db: AsyncSession,
    event: UsageEventInput,
) -> tuple[bool, str | None]:
    """Record a single usage event and update quotas.

    Base cost from provider is stored for internal tracking.
    Total cost (with margin) is what the user is charged.

    PAYG (Pay-as-you-go) Logic:
    - If usage is within quota, record it normally
    - If usage exceeds quota and overage is allowed:
      - Check if user has prepaid credits
      - Deduct from credits for overage
      - Mark record as overage
    - If no credits available and quota exceeded, reject the usage
    """
    try:
        # Get margin for this user and usage type
        margin_percent = await _get_user_margin(db, event.user_id, event.usage_type)

        # Apply margin to get final user cost
        base_cost = event.total_cost_cents  # Provider cost
        total_cost = _apply_margin(base_cost, margin_percent)

        is_overage = False

        # Determine usage type for database
        if event.usage_type in (
            "tokens",
            "tokens_input",
            "tokens_output",
        ) or event.usage_type.startswith("tokens"):
            # Check token quota first
            quota_result = await db.execute(
                select(UsageQuota)
                .where(UsageQuota.user_id == event.user_id)
                .where(UsageQuota.quota_type == "tokens")
            )
            quota = quota_result.scalar_one_or_none()

            if quota:
                new_usage = quota.current_usage + event.quantity
                if new_usage > quota.limit_value:
                    # Quota exceeded - check overage handling
                    overage_amount = new_usage - quota.limit_value
                    overage_cost = (
                        (total_cost * overage_amount) // event.quantity if event.quantity > 0 else 0
                    )

                    if quota.overage_allowed:
                        # Try to deduct from prepaid credits
                        credit_deducted = await deduct_credits_for_overage(
                            db,
                            event.user_id,
                            overage_cost,
                            "tokens",
                            f"Token overage: {overage_amount} tokens",
                        )
                        if not credit_deducted:
                            # No credits - check if we should block or allow with warning
                            balance = await get_or_create_credit_balance(db, event.user_id)
                            if balance.balance_cents <= 0:
                                await check_and_send_limit_reached(db, event.user_id, quota)
                                return (
                                    False,
                                    "Token quota exceeded and no prepaid credits available",
                                )

                        is_overage = True
                    else:
                        await check_and_send_limit_reached(db, event.user_id, quota)
                        return False, "Token quota exceeded and overage not allowed"

                # Check for usage warning (80% threshold)
                usage_percent = (
                    (new_usage / quota.limit_value * 100) if quota.limit_value > 0 else 0
                )
                await check_and_send_usage_warning(db, event.user_id, quota, usage_percent)

            # Record input and output separately
            if event.input_tokens:
                # Split cost if both input and output tokens exist
                input_base = base_cost // 2 if event.output_tokens else base_cost
                input_total = total_cost // 2 if event.output_tokens else total_cost
                input_record = UsageRecord(
                    user_id=event.user_id,
                    session_id=event.session_id,
                    workspace_id=event.workspace_id,
                    agent_id=event.agent_id,
                    usage_type="tokens_input",
                    quantity=event.input_tokens,
                    unit="tokens",
                    unit_price_cents=event.unit_price_cents,
                    base_cost_cents=input_base,
                    total_cost_cents=input_total,
                    model=event.model,
                    is_overage=is_overage,
                    record_metadata=event.metadata,
                )
                db.add(input_record)

            if event.output_tokens:
                # Split cost if both input and output tokens exist
                output_base = base_cost // 2 if event.input_tokens else base_cost
                output_total = total_cost // 2 if event.input_tokens else total_cost
                output_record = UsageRecord(
                    user_id=event.user_id,
                    session_id=event.session_id,
                    workspace_id=event.workspace_id,
                    agent_id=event.agent_id,
                    usage_type="tokens_output",
                    quantity=event.output_tokens,
                    unit="tokens",
                    unit_price_cents=event.unit_price_cents,
                    base_cost_cents=output_base,
                    total_cost_cents=output_total,
                    model=event.model,
                    is_overage=is_overage,
                    record_metadata=event.metadata,
                )
                db.add(output_record)

            # Update token quota (using total tokens consumed, not cost)
            await db.execute(
                update(UsageQuota)
                .where(UsageQuota.user_id == event.user_id)
                .where(UsageQuota.quota_type == "tokens")
                .values(current_usage=UsageQuota.current_usage + event.quantity),
            )

        elif event.usage_type in ("compute", "compute_seconds"):
            # Check compute quota first
            quota_result = await db.execute(
                select(UsageQuota)
                .where(UsageQuota.user_id == event.user_id)
                .where(UsageQuota.quota_type == "compute_credits")
            )
            quota = quota_result.scalar_one_or_none()

            if quota:
                new_usage = quota.current_usage + total_cost
                if new_usage > quota.limit_value:
                    # Quota exceeded - check overage handling
                    overage_cost = new_usage - quota.limit_value

                    if quota.overage_allowed:
                        # Try to deduct from prepaid credits
                        credit_deducted = await deduct_credits_for_overage(
                            db,
                            event.user_id,
                            overage_cost,
                            "compute",
                            f"Compute overage: {cents_to_dollars(overage_cost):.4f} credits",
                        )
                        if not credit_deducted:
                            balance = await get_or_create_credit_balance(db, event.user_id)
                            if balance.balance_cents <= 0:
                                await check_and_send_limit_reached(db, event.user_id, quota)
                                return (
                                    False,
                                    "Compute quota exceeded and no prepaid credits available",
                                )

                        is_overage = True
                    else:
                        await check_and_send_limit_reached(db, event.user_id, quota)
                        return False, "Compute quota exceeded and overage not allowed"

                # Check for usage warning
                usage_percent = (
                    (new_usage / quota.limit_value * 100) if quota.limit_value > 0 else 0
                )
                await check_and_send_usage_warning(db, event.user_id, quota, usage_percent)

            record = UsageRecord(
                user_id=event.user_id,
                session_id=event.session_id,
                workspace_id=event.workspace_id,
                usage_type="compute_seconds",
                quantity=event.duration_seconds or event.quantity,
                unit="seconds",
                unit_price_cents=event.unit_price_cents,
                base_cost_cents=base_cost,
                total_cost_cents=total_cost,
                tier=event.tier,
                is_overage=is_overage,
                record_metadata=event.metadata,
            )
            db.add(record)

            # Update compute quota using total cost with margin (in cents)
            # This properly accounts for different tier costs + margin
            await db.execute(
                update(UsageQuota)
                .where(UsageQuota.user_id == event.user_id)
                .where(UsageQuota.quota_type == "compute_credits")
                .values(current_usage=UsageQuota.current_usage + total_cost),
            )

        elif event.usage_type == "storage":
            record = UsageRecord(
                user_id=event.user_id,
                session_id=event.session_id,
                workspace_id=event.workspace_id,
                usage_type="storage_gb",
                quantity=event.quantity,
                unit="bytes",
                unit_price_cents=event.unit_price_cents,
                base_cost_cents=base_cost,
                total_cost_cents=total_cost,
                record_metadata=event.metadata,
            )
            db.add(record)

        elif event.usage_type == "api_calls":
            record = UsageRecord(
                user_id=event.user_id,
                session_id=event.session_id,
                usage_type="api_calls",
                quantity=event.quantity,
                unit="calls",
                unit_price_cents=0,
                base_cost_cents=0,
                total_cost_cents=0,
                record_metadata=event.metadata,
            )
            db.add(record)

    except Exception as e:
        logger.exception("Failed to record usage event", event_id=event.id)
        return False, str(e)
    else:
        return True, None


@router.post("/usage/record", response_model=RecordUsageResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def record_usage_events(
    request: Request,
    response: Response,
    data: RecordUsageRequest,
    db: DbSession,
    authorization: Annotated[str | None, Header()] = None,
) -> RecordUsageResponse:
    """
    Record usage events from other services (internal API).

    This endpoint is used by the agent and compute services to record
    usage events for billing purposes. It requires internal service authentication.
    """
    # Verify service authentication
    if not _verify_service_token(authorization):
        raise HTTPException(status_code=401, detail="Invalid service token")

    recorded = 0
    failed = 0
    errors: list[str] = []

    for event in data.events:
        success, error = await _record_single_event(db, event)
        if success:
            recorded += 1
        else:
            failed += 1
            if error:
                errors.append(f"Event {event.id}: {error}")

    await db.commit()

    logger.info(
        "Recorded usage events",
        recorded=recorded,
        failed=failed,
    )

    return RecordUsageResponse(
        recorded=recorded,
        failed=failed,
        errors=errors,
    )


# =============================================================================
# REAL-TIME COST TRACKING ROUTES
# =============================================================================


class RealtimeCostResponse(BaseModel):
    """Real-time cost response for a session."""

    session_id: str
    total_cost: float
    input_cost: float
    output_cost: float
    cached_input_cost: float
    total_tokens: int
    input_tokens: int
    output_tokens: int
    cached_input_tokens: int
    call_count: int
    by_model: dict[str, dict[str, Any]] = Field(default_factory=dict)
    by_agent: dict[str, dict[str, Any]] = Field(default_factory=dict)


class SessionBudgetRequest(BaseModel):
    """Request to set a session budget."""

    amount: float = Field(ge=0.01, le=10000)
    warning_threshold: float = Field(ge=0.1, le=1.0, default=0.8)
    hard_limit: bool = False


class UserBudgetRequest(BaseModel):
    """Request to set a user budget."""

    amount: float = Field(ge=0.01, le=100000)
    period: str = "monthly"  # daily, weekly, monthly
    warning_threshold: float = Field(ge=0.1, le=1.0, default=0.8)
    hard_limit: bool = False


class BudgetResponse(BaseModel):
    """Budget response."""

    id: str
    user_id: str
    session_id: str | None
    amount: float
    period: str
    warning_threshold: float
    hard_limit: bool
    created_at: datetime
    expires_at: datetime | None


class BudgetStatusResponse(BaseModel):
    """Budget status with current spending."""

    budget: BudgetResponse
    spent: float
    remaining: float
    percentage_used: float
    period_start: datetime | None = None


class AlertResponse(BaseModel):
    """Budget alert response."""

    id: str
    alert_type: str
    severity: str
    message: str
    current_spent: float
    budget_amount: float
    percentage_used: float
    created_at: datetime
    acknowledged: bool


class UsageHistoryEntry(BaseModel):
    """Single usage history entry."""

    call_id: str
    model: str
    input_tokens: int
    output_tokens: int
    cached_input_tokens: int
    cost: float
    timestamp: datetime
    agent_id: str | None


class DailyUsageEntry(BaseModel):
    """Daily usage aggregate."""

    date: str
    total_cost: float
    total_tokens: int
    call_count: int


@router.get("/realtime/session/{session_id}", response_model=RealtimeCostResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_session_realtime_cost(
    request: Request,
    response: Response,
    session_id: str,
    db: DbSession,
) -> RealtimeCostResponse:
    """Get real-time cost for a session."""
    user_id = get_current_user_id(request)

    # TODO: Verify session belongs to user

    tracker = get_cost_tracker()
    cost = await tracker.get_session_cost(session_id)

    return RealtimeCostResponse(
        session_id=session_id,
        total_cost=float(cost.total_cost),
        input_cost=float(cost.input_cost),
        output_cost=float(cost.output_cost),
        cached_input_cost=float(cost.cached_input_cost),
        total_tokens=cost.total_tokens,
        input_tokens=cost.input_tokens,
        output_tokens=cost.output_tokens,
        cached_input_tokens=cost.cached_input_tokens,
        call_count=cost.call_count,
        by_model=cost.to_dict()["by_model"],
        by_agent=cost.to_dict()["by_agent"],
    )


@router.get("/realtime/agent/{session_id}/{agent_id}", response_model=RealtimeCostResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_agent_realtime_cost(
    request: Request,
    response: Response,
    session_id: str,
    agent_id: str,
    db: DbSession,
) -> RealtimeCostResponse:
    """Get real-time cost for a specific agent."""
    user_id = get_current_user_id(request)

    tracker = get_cost_tracker()
    cost = await tracker.get_agent_cost(session_id, agent_id)

    return RealtimeCostResponse(
        session_id=session_id,
        total_cost=float(cost.total_cost),
        input_cost=float(cost.input_cost),
        output_cost=float(cost.output_cost),
        cached_input_cost=float(cost.cached_input_cost),
        total_tokens=cost.total_tokens,
        input_tokens=cost.input_tokens,
        output_tokens=cost.output_tokens,
        cached_input_tokens=cost.cached_input_tokens,
        call_count=cost.call_count,
        by_model=cost.to_dict()["by_model"],
        by_agent=cost.to_dict()["by_agent"],
    )


@router.get("/realtime/usage-history/{session_id}", response_model=list[UsageHistoryEntry])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_session_usage_history(
    request: Request,
    response: Response,
    session_id: str,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[UsageHistoryEntry]:
    """Get detailed usage history for a session."""
    user_id = get_current_user_id(request)

    tracker = get_cost_tracker()
    history = await tracker.get_usage_history(session_id, limit=limit)

    return [
        UsageHistoryEntry(
            call_id=entry["call_id"],
            model=entry["model"],
            input_tokens=entry["input_tokens"],
            output_tokens=entry["output_tokens"],
            cached_input_tokens=entry["cached_input_tokens"],
            cost=entry["cost"],
            timestamp=datetime.fromisoformat(entry["timestamp"]),
            agent_id=entry["agent_id"],
        )
        for entry in history
    ]


@router.get("/realtime/daily-usage", response_model=list[DailyUsageEntry])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_daily_usage(
    request: Request,
    response: Response,
    db: DbSession,
    days: Annotated[int, Query(ge=1, le=90)] = 30,
) -> list[DailyUsageEntry]:
    """Get daily usage aggregates for the current user."""
    user_id = get_current_user_id(request)

    tracker = get_cost_tracker()
    daily = await tracker.get_daily_usage(user_id, days=days)

    return [
        DailyUsageEntry(
            date=entry["date"],
            total_cost=entry["total_cost"],
            total_tokens=entry["total_tokens"],
            call_count=entry["call_count"],
        )
        for entry in daily
    ]


# =============================================================================
# BUDGET MANAGEMENT ROUTES
# =============================================================================


@router.post("/budgets/session/{session_id}", response_model=BudgetResponse)
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def set_session_budget(
    request: Request,
    response: Response,
    session_id: str,
    data: SessionBudgetRequest,
    db: DbSession,
) -> BudgetResponse:
    """Set a budget for a session."""
    user_id = get_current_user_id(request)

    budget = Budget(
        user_id=user_id,
        session_id=session_id,
        amount=Decimal(str(data.amount)),
        period="session",
        warning_threshold=data.warning_threshold,
        hard_limit=data.hard_limit,
    )

    manager = get_alert_manager()
    result = await manager.set_session_budget(budget)

    return BudgetResponse(
        id=result.id,
        user_id=result.user_id,
        session_id=result.session_id,
        amount=float(result.amount),
        period=result.period,
        warning_threshold=result.warning_threshold,
        hard_limit=result.hard_limit,
        created_at=result.created_at,
        expires_at=result.expires_at,
    )


@router.post("/budgets/user", response_model=BudgetResponse)
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def set_user_budget(
    request: Request,
    response: Response,
    data: UserBudgetRequest,
    db: DbSession,
) -> BudgetResponse:
    """Set a budget for the current user."""
    user_id = get_current_user_id(request)

    budget = Budget(
        user_id=user_id,
        amount=Decimal(str(data.amount)),
        period=data.period,
        warning_threshold=data.warning_threshold,
        hard_limit=data.hard_limit,
    )

    manager = get_alert_manager()
    result = await manager.set_user_budget(budget)

    return BudgetResponse(
        id=result.id,
        user_id=result.user_id,
        session_id=result.session_id,
        amount=float(result.amount),
        period=result.period,
        warning_threshold=result.warning_threshold,
        hard_limit=result.hard_limit,
        created_at=result.created_at,
        expires_at=result.expires_at,
    )


@router.get("/budgets", response_model=list[BudgetResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_user_budgets(
    request: Request,
    response: Response,
    db: DbSession,
) -> list[BudgetResponse]:
    """Get all budgets for the current user."""
    user_id = get_current_user_id(request)

    manager = get_alert_manager()
    budgets = await manager.get_user_budgets(user_id)

    return [
        BudgetResponse(
            id=b.id,
            user_id=b.user_id,
            session_id=b.session_id,
            amount=float(b.amount),
            period=b.period,
            warning_threshold=b.warning_threshold,
            hard_limit=b.hard_limit,
            created_at=b.created_at,
            expires_at=b.expires_at,
        )
        for b in budgets
    ]


@router.get("/budgets/status", response_model=list[BudgetStatusResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_budget_status(
    request: Request,
    response: Response,
    db: DbSession,
    session_id: str | None = None,
) -> list[BudgetStatusResponse]:
    """Get current budget status with spending."""
    user_id = get_current_user_id(request)

    manager = get_alert_manager()
    statuses = await manager.get_budget_status(user_id, session_id)

    return [
        BudgetStatusResponse(
            budget=BudgetResponse(
                id=s["budget"]["id"],
                user_id=s["budget"]["user_id"],
                session_id=s["budget"]["session_id"],
                amount=s["budget"]["amount"],
                period=s["budget"]["period"],
                warning_threshold=s["budget"]["warning_threshold"],
                hard_limit=s["budget"]["hard_limit"],
                created_at=datetime.fromisoformat(s["budget"]["created_at"]),
                expires_at=datetime.fromisoformat(s["budget"]["expires_at"])
                if s["budget"]["expires_at"]
                else None,
            ),
            spent=s["spent"],
            remaining=s["remaining"],
            percentage_used=s["percentage_used"],
            period_start=datetime.fromisoformat(s["period_start"])
            if s.get("period_start")
            else None,
        )
        for s in statuses
    ]


@router.delete("/budgets/{budget_id}")
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def delete_budget(
    request: Request,
    response: Response,
    budget_id: str,
    db: DbSession,
) -> dict[str, bool]:
    """Delete a budget."""
    user_id = get_current_user_id(request)

    manager = get_alert_manager()
    success = await manager.delete_budget(budget_id)

    if not success:
        raise HTTPException(status_code=404, detail="Budget not found")

    return {"success": True}


# =============================================================================
# ALERT ROUTES
# =============================================================================


@router.get("/alerts", response_model=list[AlertResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_alerts(
    request: Request,
    response: Response,
    db: DbSession,
    *,
    include_acknowledged: bool = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[AlertResponse]:
    """Get budget alerts for the current user."""
    user_id = get_current_user_id(request)

    manager = get_alert_manager()
    alerts = await manager.get_alerts(
        user_id,
        include_acknowledged=include_acknowledged,
        limit=limit,
    )

    return [
        AlertResponse(
            id=a.id,
            alert_type=a.alert_type.value,
            severity=a.severity.value,
            message=a.message,
            current_spent=float(a.current_spent),
            budget_amount=float(a.budget_amount),
            percentage_used=a.percentage_used,
            created_at=a.created_at,
            acknowledged=a.acknowledged,
        )
        for a in alerts
    ]


@router.post("/alerts/{alert_id}/acknowledge")
@limiter.limit(RATE_LIMIT_STANDARD)
async def acknowledge_alert(
    request: Request,
    response: Response,
    alert_id: str,
    db: DbSession,
) -> dict[str, bool]:
    """Acknowledge a budget alert."""
    user_id = get_current_user_id(request)

    manager = get_alert_manager()
    success = await manager.acknowledge_alert(alert_id)

    if not success:
        raise HTTPException(status_code=404, detail="Alert not found")

    return {"success": True}
