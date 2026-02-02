"""Organization billing routes - Stripe checkout and portal for organizations."""

from datetime import UTC, datetime
from typing import Annotated, Any

import stripe
import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import get_db
from src.database.models import (
    Organization,
    OrganizationCreditTransaction,
    OrganizationMember,
    OrganizationSubscription,
    OrganizationUsageRecord,
    SubscriptionPlan,
    User,
)
from src.middleware.rate_limit import RATE_LIMIT_SENSITIVE, RATE_LIMIT_STANDARD, limiter

# Initialize Stripe
if settings.STRIPE_SECRET_KEY:
    stripe.api_key = settings.STRIPE_SECRET_KEY

logger = structlog.get_logger()

router = APIRouter(prefix="/organizations", tags=["organization-billing"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


# =============================================================================
# PYDANTIC MODELS
# =============================================================================


class OrgCheckoutSubscriptionRequest(BaseModel):
    """Request to create a subscription checkout for organization."""

    plan_slug: str
    billing_cycle: str = "monthly"  # monthly or yearly
    seat_count: int = Field(default=1, ge=1)
    success_url: str | None = None
    cancel_url: str | None = None


class OrgCheckoutCreditsRequest(BaseModel):
    """Request to create a credits checkout for organization."""

    amount_cents: int = Field(..., ge=100, description="Amount in cents (minimum $1)")
    success_url: str | None = None
    cancel_url: str | None = None


class OrgPortalRequest(BaseModel):
    """Request to create a portal session for organization."""

    return_url: str | None = None


class OrgUpdateSeatsRequest(BaseModel):
    """Request to update seat count for organization subscription."""

    seat_count: int = Field(..., ge=1, description="New seat count (minimum 1)")


class CheckoutResponse(BaseModel):
    """Response containing checkout session URL."""

    url: str
    session_id: str


class PortalResponse(BaseModel):
    """Response containing customer portal URL."""

    url: str


class OrgSubscriptionResponse(BaseModel):
    """Organization subscription details."""

    id: str
    plan_name: str
    plan_slug: str
    status: str
    billing_cycle: str
    seat_count: int
    current_period_start: datetime
    current_period_end: datetime
    cancel_at_period_end: bool
    canceled_at: datetime | None = None
    price_monthly_cents: int
    price_yearly_cents: int


class OrgPaymentMethodResponse(BaseModel):
    """Response containing a payment method."""

    id: str
    type: str  # 'card', 'bank_account', etc.
    brand: str | None = None  # 'visa', 'mastercard', etc.
    last4: str | None = None
    exp_month: int | None = None
    exp_year: int | None = None
    is_default: bool = False


class OrgPaymentMethodsListResponse(BaseModel):
    """Response containing list of payment methods."""

    payment_methods: list[OrgPaymentMethodResponse]
    default_payment_method_id: str | None = None


class ModelUsage(BaseModel):
    """Usage breakdown by model."""

    model: str
    total_tokens: int
    total_cost_cents: int
    record_count: int


class MemberUsage(BaseModel):
    """Usage breakdown by member."""

    user_id: str
    user_name: str | None
    user_email: str | None
    total_tokens: int
    total_compute_cents: int
    total_cost_cents: int


class SessionUsage(BaseModel):
    """Usage breakdown by session."""

    session_id: str
    session_name: str | None
    total_tokens: int
    total_cost_cents: int


class OrgUsageResponse(BaseModel):
    """Organization usage breakdown response."""

    period_start: datetime
    period_end: datetime
    total_tokens: int
    total_compute_cents: int
    total_cost_cents: int
    by_model: list[ModelUsage]
    by_member: list[MemberUsage]
    by_session: list[SessionUsage]


class PlanChangeRequest(BaseModel):
    """Request to change subscription plan."""

    plan_slug: str
    billing_cycle: str = "monthly"  # monthly or yearly
    success_url: str | None = None
    cancel_url: str | None = None


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


async def get_org_and_verify_owner(
    db: AsyncSession, org_id: str, user_id: str
) -> tuple[Organization, OrganizationMember]:
    """Get organization and verify user is owner."""
    # Get organization
    org_result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = org_result.scalar_one_or_none()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Get membership and verify owner role
    member_result = await db.execute(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.user_id == user_id,
        )
    )
    member = member_result.scalar_one_or_none()

    if not member:
        raise HTTPException(status_code=403, detail="Not a member of this organization")

    if member.role != "owner":
        raise HTTPException(status_code=403, detail="Only organization owners can manage billing")

    return org, member


async def get_or_create_org_stripe_customer(db: AsyncSession, org: Organization, user: User) -> str:
    """Get or create a Stripe customer for the organization."""
    if org.stripe_customer_id:
        return org.stripe_customer_id

    # Create new Stripe customer for organization
    try:
        customer = stripe.Customer.create(
            email=user.email,
            name=org.name,
            metadata={
                "organization_id": str(org.id),
                "organization_slug": org.slug,
                "type": "organization",
            },
        )
        org.stripe_customer_id = customer.id
        await db.flush()
        logger.info(
            "Created Stripe customer for organization",
            org_id=str(org.id),
            customer_id=customer.id,
        )
        return customer.id  # noqa: TRY300
    except stripe.error.StripeError as e:
        logger.exception("Failed to create Stripe customer", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to create billing account") from e


async def get_user_from_request(request: Request, db: AsyncSession) -> User:
    """Get current user from request."""
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return user


# =============================================================================
# SUBSCRIPTION ROUTES
# =============================================================================


@router.get("/{org_id}/billing/subscription", response_model=OrgSubscriptionResponse | None)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_org_subscription(
    org_id: str,
    request: Request,
    _response: Response,
    db: DbSession,
) -> OrgSubscriptionResponse | None:
    """Get the organization's active subscription."""
    user = await get_user_from_request(request, db)
    _org, _ = await get_org_and_verify_owner(db, org_id, str(user.id))

    # Get active subscription
    sub_result = await db.execute(
        select(OrganizationSubscription)
        .where(
            OrganizationSubscription.organization_id == org_id,
            OrganizationSubscription.status.in_(["active", "trialing"]),
        )
        .order_by(OrganizationSubscription.created_at.desc())
    )
    subscription = sub_result.scalar_one_or_none()

    if not subscription:
        return None

    # Get plan details
    plan_result = await db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.id == subscription.plan_id)
    )
    plan = plan_result.scalar_one_or_none()

    if not plan:
        return None

    return OrgSubscriptionResponse(
        id=str(subscription.id),
        plan_name=plan.name,
        plan_slug=plan.slug,
        status=subscription.status,
        billing_cycle=subscription.billing_cycle,
        seat_count=subscription.seat_count,
        current_period_start=subscription.current_period_start,
        current_period_end=subscription.current_period_end,
        cancel_at_period_end=subscription.cancel_at_period_end,
        canceled_at=subscription.canceled_at,
        price_monthly_cents=plan.price_monthly_cents,
        price_yearly_cents=plan.price_yearly_cents,
    )


@router.post("/{org_id}/billing/checkout/subscription", response_model=CheckoutResponse)
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def create_org_subscription_checkout(
    org_id: str,
    request: Request,
    _response: Response,
    data: OrgCheckoutSubscriptionRequest,
    db: DbSession,
) -> CheckoutResponse:
    """Create a Stripe Checkout session for organization subscription.

    Only organization owners can create checkout sessions.
    After successful payment, Stripe webhooks handle subscription creation.
    """
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    user = await get_user_from_request(request, db)
    org, _ = await get_org_and_verify_owner(db, org_id, str(user.id))

    # Check for existing active subscription
    existing = await db.execute(
        select(OrganizationSubscription).where(
            OrganizationSubscription.organization_id == org_id,
            OrganizationSubscription.status.in_(["active", "trialing"]),
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="Organization already has an active subscription. Use the portal to manage it.",
        )

    # Get the plan
    plan_result = await db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.slug == data.plan_slug)
    )
    plan = plan_result.scalar_one_or_none()

    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    if not plan.is_active:
        raise HTTPException(status_code=400, detail="Plan is not available")

    # Get or create Stripe customer for organization
    customer_id = await get_or_create_org_stripe_customer(db, org, user)

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

    # Build success/cancel URLs
    success_url = (
        data.success_url or f"{settings.FRONTEND_URL}/settings/organization/billing?success=true"
    )
    cancel_url = data.cancel_url or f"{settings.FRONTEND_URL}/settings/organization/billing"

    # Build checkout session parameters
    session_params: dict[str, Any] = {
        "mode": "subscription",
        "customer": customer_id,
        "line_items": [{"price": price_id, "quantity": data.seat_count}],
        "success_url": success_url,
        "cancel_url": cancel_url,
        "allow_promotion_codes": True,
        "metadata": {
            "organization_id": str(org.id),
            "plan_slug": data.plan_slug,
            "billing_cycle": data.billing_cycle,
            "seat_count": str(data.seat_count),
            "type": "organization_subscription",
        },
        "subscription_data": {
            "metadata": {
                "organization_id": str(org.id),
                "plan_slug": data.plan_slug,
                "seat_count": str(data.seat_count),
            }
        },
    }

    # Create checkout session
    try:
        session = stripe.checkout.Session.create(**session_params)
    except stripe.error.StripeError as e:
        logger.exception("Failed to create org checkout session", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to create checkout session") from e

    logger.info(
        "Created organization subscription checkout",
        org_id=str(org.id),
        plan_slug=data.plan_slug,
        session_id=session.id,
    )

    return CheckoutResponse(
        url=session.url or "",
        session_id=session.id,
    )


@router.post("/{org_id}/billing/checkout/credits", response_model=CheckoutResponse)
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def create_org_credits_checkout(
    org_id: str,
    request: Request,
    _response: Response,
    data: OrgCheckoutCreditsRequest,
    db: DbSession,
) -> CheckoutResponse:
    """Create a Stripe Checkout session for organization credits purchase.

    Credits are added to the organization's credit pool.
    """
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    user = await get_user_from_request(request, db)
    org, _ = await get_org_and_verify_owner(db, org_id, str(user.id))

    # Get or create Stripe customer for organization
    customer_id = await get_or_create_org_stripe_customer(db, org, user)

    # Build success/cancel URLs
    success_url = (
        data.success_url
        or f"{settings.FRONTEND_URL}/settings/organization/billing?credits_success=true"
    )
    cancel_url = data.cancel_url or f"{settings.FRONTEND_URL}/settings/organization/billing"

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
                            "name": "Podex Organization Credits",
                            "description": (
                                f"${data.amount_cents / 100:.2f} in prepaid credits "
                                "for your organization"
                            ),
                        },
                    },
                    "quantity": 1,
                }
            ],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                "organization_id": str(org.id),
                "type": "organization_credit_purchase",
                "amount_cents": str(data.amount_cents),
            },
        )
    except stripe.error.StripeError as e:
        logger.exception("Failed to create org credits checkout session", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to create checkout session") from e

    logger.info(
        "Created organization credits checkout",
        org_id=str(org.id),
        amount_cents=data.amount_cents,
        session_id=session.id,
    )

    return CheckoutResponse(
        url=session.url or "",
        session_id=session.id,
    )


@router.post("/{org_id}/billing/portal", response_model=PortalResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def create_org_portal_session(
    org_id: str,
    request: Request,
    _response: Response,
    data: OrgPortalRequest,
    db: DbSession,
) -> PortalResponse:
    """Create a Stripe Customer Portal session for the organization.

    The portal allows organization owners to:
    - View and download invoices
    - Update payment methods
    - View subscription details
    - Cancel subscription
    """
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    user = await get_user_from_request(request, db)
    org, _ = await get_org_and_verify_owner(db, org_id, str(user.id))

    # Create Stripe customer if org doesn't have one yet
    # (allows adding payment method before subscribing)
    customer_id = await get_or_create_org_stripe_customer(db, org, user)

    return_url = data.return_url or f"{settings.FRONTEND_URL}/settings/organization/billing"

    try:
        portal_session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=return_url,
        )
    except stripe.error.StripeError as e:
        logger.exception("Failed to create org portal session", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to create portal session") from e

    return PortalResponse(url=portal_session.url)


@router.get("/{org_id}/billing/payment-methods", response_model=OrgPaymentMethodsListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_org_payment_methods(
    org_id: str,
    request: Request,
    _response: Response,
    db: DbSession,
) -> OrgPaymentMethodsListResponse:
    """List organization's saved payment methods from Stripe.

    Returns all payment methods attached to the organization's Stripe account,
    including cards and bank accounts.
    """
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    user = await get_user_from_request(request, db)
    org, _ = await get_org_and_verify_owner(db, org_id, str(user.id))

    if not org.stripe_customer_id:
        # Organization has no Stripe customer yet, return empty list
        return OrgPaymentMethodsListResponse(payment_methods=[], default_payment_method_id=None)

    try:
        # Get customer to find default payment method
        customer = stripe.Customer.retrieve(org.stripe_customer_id)
        default_pm_id = customer.get("invoice_settings", {}).get("default_payment_method")

        # List all payment methods for the customer
        payment_methods_response = stripe.PaymentMethod.list(
            customer=org.stripe_customer_id,
            type="card",
        )

        payment_methods: list[OrgPaymentMethodResponse] = []
        for pm in payment_methods_response.data:
            card = pm.get("card", {})
            payment_methods.append(
                OrgPaymentMethodResponse(
                    id=pm.id,
                    type=pm.type,
                    brand=card.get("brand"),
                    last4=card.get("last4"),
                    exp_month=card.get("exp_month"),
                    exp_year=card.get("exp_year"),
                    is_default=pm.id == default_pm_id,
                )
            )

        return OrgPaymentMethodsListResponse(
            payment_methods=payment_methods,
            default_payment_method_id=default_pm_id,
        )
    except stripe.error.StripeError as e:
        logger.exception("Failed to list org payment methods", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to list payment methods") from e


@router.post("/{org_id}/billing/cancel-subscription")
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def cancel_org_subscription(
    org_id: str,
    request: Request,
    _response: Response,
    db: DbSession,
) -> dict[str, str]:
    """Cancel the organization's subscription at period end.

    The subscription will remain active until the current billing period ends.
    """
    user = await get_user_from_request(request, db)
    org, _ = await get_org_and_verify_owner(db, org_id, str(user.id))

    # Get active subscription
    sub_result = await db.execute(
        select(OrganizationSubscription).where(
            OrganizationSubscription.organization_id == org_id,
            OrganizationSubscription.status.in_(["active", "trialing"]),
        )
    )
    subscription = sub_result.scalar_one_or_none()

    if not subscription:
        raise HTTPException(status_code=404, detail="No active subscription found")

    # Cancel in Stripe if we have a Stripe subscription
    if subscription.stripe_subscription_id:
        try:
            stripe.Subscription.modify(
                subscription.stripe_subscription_id,
                cancel_at_period_end=True,
            )
        except stripe.error.StripeError as e:
            logger.exception("Failed to cancel Stripe subscription", error=str(e))
            raise HTTPException(status_code=500, detail="Failed to cancel subscription") from e

    # Update local record
    subscription.cancel_at_period_end = True
    subscription.canceled_at = datetime.now(UTC)
    await db.commit()

    logger.info(
        "Organization subscription canceled",
        org_id=str(org.id),
        subscription_id=str(subscription.id),
    )

    return {"message": "Subscription will be canceled at the end of the billing period"}


@router.post("/{org_id}/billing/update-seats")
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def update_org_seats(
    org_id: str,
    request: Request,
    _response: Response,
    data: OrgUpdateSeatsRequest,
    db: DbSession,
) -> dict[str, Any]:
    """Update the number of seats in the organization's subscription.

    Changes are prorated by Stripe. If adding seats, you'll be charged
    the prorated amount immediately. If removing seats, you'll receive
    a credit applied to your next invoice.
    """
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    user = await get_user_from_request(request, db)
    org, _ = await get_org_and_verify_owner(db, org_id, str(user.id))

    # Get active subscription
    sub_result = await db.execute(
        select(OrganizationSubscription).where(
            OrganizationSubscription.organization_id == org_id,
            OrganizationSubscription.status.in_(["active", "trialing"]),
        )
    )
    subscription = sub_result.scalar_one_or_none()

    if not subscription:
        raise HTTPException(status_code=404, detail="No active subscription found")

    # Count current members to ensure we have enough seats
    from sqlalchemy import func as sqlfunc  # noqa: PLC0415

    member_count_result = await db.execute(
        select(sqlfunc.count(OrganizationMember.id)).where(
            OrganizationMember.organization_id == org_id
        )
    )
    current_members = member_count_result.scalar() or 0

    if data.seat_count < current_members:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot reduce seats below current member count ({current_members}). "
            "Remove members first, then reduce seats.",
        )

    old_seat_count = subscription.seat_count

    # Update in Stripe if we have a Stripe subscription
    if subscription.stripe_subscription_id:
        try:
            # Get the subscription to find the subscription item
            stripe_sub = stripe.Subscription.retrieve(subscription.stripe_subscription_id)

            if stripe_sub.items and stripe_sub.items.data:
                # Update the quantity of the first item (seats)
                stripe.SubscriptionItem.modify(
                    stripe_sub.items.data[0].id,
                    quantity=data.seat_count,
                    proration_behavior="create_prorations",
                )
            else:
                raise HTTPException(status_code=500, detail="Subscription has no items to update")

        except stripe.error.StripeError as e:
            logger.exception("Failed to update Stripe subscription seats", error=str(e))
            raise HTTPException(status_code=500, detail="Failed to update seats") from e

    # Update local record
    subscription.seat_count = data.seat_count
    await db.commit()

    logger.info(
        "Organization seats updated",
        org_id=str(org.id),
        subscription_id=str(subscription.id),
        old_seat_count=old_seat_count,
        new_seat_count=data.seat_count,
    )

    return {
        "message": f"Seats updated from {old_seat_count} to {data.seat_count}",
        "old_seat_count": old_seat_count,
        "new_seat_count": data.seat_count,
        "current_members": current_members,
    }


@router.get("/{org_id}/billing/invoices")
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_org_invoices(
    org_id: str,
    request: Request,
    _response: Response,
    db: DbSession,
) -> list[dict[str, Any]]:
    """List invoices for the organization from Stripe."""
    user = await get_user_from_request(request, db)
    org, _ = await get_org_and_verify_owner(db, org_id, str(user.id))

    if not org.stripe_customer_id:
        return []

    try:
        invoices = stripe.Invoice.list(customer=org.stripe_customer_id, limit=20)
        return [
            {
                "id": inv.id,
                "number": inv.number,
                "amount_due": inv.amount_due,
                "amount_paid": inv.amount_paid,
                "currency": inv.currency,
                "status": inv.status,
                "created": datetime.fromtimestamp(inv.created, tz=UTC).isoformat(),
                "period_start": datetime.fromtimestamp(inv.period_start, tz=UTC).isoformat()
                if inv.period_start
                else None,
                "period_end": datetime.fromtimestamp(inv.period_end, tz=UTC).isoformat()
                if inv.period_end
                else None,
                "invoice_pdf": inv.invoice_pdf,
                "hosted_invoice_url": inv.hosted_invoice_url,
            }
            for inv in invoices.data
        ]
    except stripe.error.StripeError as e:
        logger.exception("Failed to list org invoices", error=str(e))
        return []


@router.get("/{org_id}/billing/transactions")
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_org_transactions(
    org_id: str,
    request: Request,
    _response: Response,
    db: DbSession,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """List recent credit transactions for the organization."""
    user = await get_user_from_request(request, db)
    _org, _ = await get_org_and_verify_owner(db, org_id, str(user.id))

    result = await db.execute(
        select(OrganizationCreditTransaction)
        .where(OrganizationCreditTransaction.organization_id == org_id)
        .order_by(OrganizationCreditTransaction.created_at.desc())
        .limit(limit)
    )
    transactions = result.scalars().all()

    return [
        {
            "id": str(t.id),
            "amount_cents": t.amount_cents,
            "transaction_type": t.transaction_type,
            "description": t.description,
            "pool_balance_after_cents": t.pool_balance_after_cents,
            "created_at": t.created_at.isoformat(),
        }
        for t in transactions
    ]


@router.get("/{org_id}/billing/usage", response_model=OrgUsageResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_org_usage_breakdown(
    org_id: str,
    request: Request,
    _response: Response,
    db: DbSession,
) -> OrgUsageResponse:
    """Get detailed usage breakdown for the organization.

    Aggregates usage by model, member, and session for the current billing period.
    """
    from sqlalchemy import func as sqlfunc  # noqa: PLC0415

    user = await get_user_from_request(request, db)
    _org, _ = await get_org_and_verify_owner(db, org_id, str(user.id))

    # Get current billing period from subscription
    sub_result = await db.execute(
        select(OrganizationSubscription)
        .where(
            OrganizationSubscription.organization_id == org_id,
            OrganizationSubscription.status.in_(["active", "trialing", "past_due"]),
        )
        .order_by(OrganizationSubscription.created_at.desc())
    )
    subscription = sub_result.scalar_one_or_none()

    # Default period if no subscription (last 30 days)
    if subscription:
        period_start = subscription.current_period_start
        period_end = subscription.current_period_end
    else:
        from datetime import timedelta  # noqa: PLC0415

        period_end = datetime.now(UTC)
        period_start = period_end - timedelta(days=30)

    # Get total usage
    total_result = await db.execute(
        select(
            sqlfunc.coalesce(sqlfunc.sum(OrganizationUsageRecord.quantity), 0).label(
                "total_tokens"
            ),
            sqlfunc.coalesce(sqlfunc.sum(OrganizationUsageRecord.total_cost_cents), 0).label(
                "total_cost"
            ),
        )
        .where(OrganizationUsageRecord.organization_id == org_id)
        .where(OrganizationUsageRecord.created_at >= period_start)
        .where(OrganizationUsageRecord.created_at < period_end)
    )
    total_row = total_result.one()

    # Get compute usage separately (usage_type = 'compute')
    compute_result = await db.execute(
        select(
            sqlfunc.coalesce(sqlfunc.sum(OrganizationUsageRecord.total_cost_cents), 0).label(
                "compute_cents"
            ),
        )
        .where(OrganizationUsageRecord.organization_id == org_id)
        .where(OrganizationUsageRecord.usage_type == "compute")
        .where(OrganizationUsageRecord.created_at >= period_start)
        .where(OrganizationUsageRecord.created_at < period_end)
    )
    compute_row = compute_result.one()

    # Aggregate by model
    model_result = await db.execute(
        select(
            OrganizationUsageRecord.model,
            sqlfunc.sum(OrganizationUsageRecord.quantity).label("total_tokens"),
            sqlfunc.sum(OrganizationUsageRecord.total_cost_cents).label("total_cost"),
            sqlfunc.count(OrganizationUsageRecord.id).label("record_count"),
        )
        .where(OrganizationUsageRecord.organization_id == org_id)
        .where(OrganizationUsageRecord.created_at >= period_start)
        .where(OrganizationUsageRecord.created_at < period_end)
        .where(OrganizationUsageRecord.model.isnot(None))
        .group_by(OrganizationUsageRecord.model)
        .order_by(sqlfunc.sum(OrganizationUsageRecord.total_cost_cents).desc())
    )
    by_model = [
        ModelUsage(
            model=row.model or "unknown",
            total_tokens=int(row.total_tokens or 0),
            total_cost_cents=int(row.total_cost or 0),
            record_count=int(row.record_count or 0),
        )
        for row in model_result.all()
    ]

    # Aggregate by member
    member_result = await db.execute(
        select(
            OrganizationUsageRecord.user_id,
            User.name,
            User.email,
            sqlfunc.sum(
                sqlfunc.case(
                    (
                        OrganizationUsageRecord.usage_type == "tokens",
                        OrganizationUsageRecord.quantity,
                    ),
                    else_=0,
                )
            ).label("total_tokens"),
            sqlfunc.sum(
                sqlfunc.case(
                    (
                        OrganizationUsageRecord.usage_type == "compute",
                        OrganizationUsageRecord.total_cost_cents,
                    ),
                    else_=0,
                )
            ).label("total_compute_cents"),
            sqlfunc.sum(OrganizationUsageRecord.total_cost_cents).label("total_cost"),
        )
        .outerjoin(User, OrganizationUsageRecord.user_id == User.id)
        .where(OrganizationUsageRecord.organization_id == org_id)
        .where(OrganizationUsageRecord.created_at >= period_start)
        .where(OrganizationUsageRecord.created_at < period_end)
        .group_by(OrganizationUsageRecord.user_id, User.name, User.email)
        .order_by(sqlfunc.sum(OrganizationUsageRecord.total_cost_cents).desc())
        .limit(50)
    )
    by_member = [
        MemberUsage(
            user_id=row.user_id or "unknown",
            user_name=row.name,
            user_email=row.email,
            total_tokens=int(row.total_tokens or 0),
            total_compute_cents=int(row.total_compute_cents or 0),
            total_cost_cents=int(row.total_cost or 0),
        )
        for row in member_result.all()
    ]

    # Aggregate by session (top 20)
    session_result = await db.execute(
        select(
            OrganizationUsageRecord.session_id,
            OrganizationUsageRecord.session_name,
            sqlfunc.sum(OrganizationUsageRecord.quantity).label("total_tokens"),
            sqlfunc.sum(OrganizationUsageRecord.total_cost_cents).label("total_cost"),
        )
        .where(OrganizationUsageRecord.organization_id == org_id)
        .where(OrganizationUsageRecord.created_at >= period_start)
        .where(OrganizationUsageRecord.created_at < period_end)
        .where(OrganizationUsageRecord.session_id.isnot(None))
        .group_by(OrganizationUsageRecord.session_id, OrganizationUsageRecord.session_name)
        .order_by(sqlfunc.sum(OrganizationUsageRecord.total_cost_cents).desc())
        .limit(20)
    )
    by_session = [
        SessionUsage(
            session_id=row.session_id or "unknown",
            session_name=row.session_name_snapshot,
            total_tokens=int(row.total_tokens or 0),
            total_cost_cents=int(row.total_cost or 0),
        )
        for row in session_result.all()
    ]

    return OrgUsageResponse(
        period_start=period_start,
        period_end=period_end,
        total_tokens=int(total_row.total_tokens or 0),
        total_compute_cents=int(compute_row.compute_cents or 0),
        total_cost_cents=int(total_row.total_cost or 0),
        by_model=by_model,
        by_member=by_member,
        by_session=by_session,
    )


@router.post("/{org_id}/billing/checkout/change-plan", response_model=CheckoutResponse)
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def create_plan_change_checkout(
    org_id: str,
    request: Request,
    _response: Response,
    data: PlanChangeRequest,
    db: DbSession,
) -> CheckoutResponse:
    """Create a Stripe Checkout session to change the organization's subscription plan.

    Proration is handled automatically by Stripe. The checkout will:
    - Cancel the current subscription at the checkout completion
    - Create a new subscription with the new plan
    - Prorate charges/credits based on remaining time
    """
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    user = await get_user_from_request(request, db)
    org, _ = await get_org_and_verify_owner(db, org_id, str(user.id))

    # Get current subscription
    sub_result = await db.execute(
        select(OrganizationSubscription).where(
            OrganizationSubscription.organization_id == org_id,
            OrganizationSubscription.status.in_(["active", "trialing"]),
        )
    )
    current_subscription = sub_result.scalar_one_or_none()

    if not current_subscription:
        raise HTTPException(
            status_code=400,
            detail="No active subscription. Use the subscription checkout to start a new one.",
        )

    # Get the new plan
    plan_result = await db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.slug == data.plan_slug)
    )
    new_plan = plan_result.scalar_one_or_none()

    if not new_plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    if not new_plan.is_active:
        raise HTTPException(status_code=400, detail="Plan is not available")

    # Get the current plan to check if it's the same
    current_plan_result = await db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.id == current_subscription.plan_id)
    )
    current_plan = current_plan_result.scalar_one_or_none()

    if current_plan and current_plan.slug == data.plan_slug:
        raise HTTPException(status_code=400, detail="Already subscribed to this plan")

    # Get or create Stripe customer
    customer_id = await get_or_create_org_stripe_customer(db, org, user)

    # Determine price ID based on billing cycle
    if data.billing_cycle == "yearly":
        price_id = new_plan.stripe_price_id_yearly
    else:
        price_id = new_plan.stripe_price_id_monthly

    if not price_id:
        raise HTTPException(
            status_code=400,
            detail=f"Plan does not have a Stripe price configured for {data.billing_cycle} billing",
        )

    # Build success/cancel URLs
    success_url = (
        data.success_url
        or f"{settings.FRONTEND_URL}/settings/organization/billing?plan_changed=true"
    )
    cancel_url = data.cancel_url or f"{settings.FRONTEND_URL}/settings/organization/plans"

    # Create checkout session with subscription update
    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            customer=customer_id,
            line_items=[{"price": price_id, "quantity": current_subscription.seat_count}],
            success_url=success_url,
            cancel_url=cancel_url,
            allow_promotion_codes=True,
            metadata={
                "organization_id": str(org.id),
                "plan_slug": data.plan_slug,
                "billing_cycle": data.billing_cycle,
                "seat_count": str(current_subscription.seat_count),
                "type": "organization_plan_change",
                "previous_plan_id": str(current_subscription.plan_id),
            },
            subscription_data={
                "metadata": {
                    "organization_id": str(org.id),
                    "plan_slug": data.plan_slug,
                    "seat_count": str(current_subscription.seat_count),
                },
                # Prorate immediately
                "proration_behavior": "create_prorations",
            },
        )
    except stripe.error.StripeError as e:
        logger.exception("Failed to create plan change checkout", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to create checkout session") from e

    # Schedule cancellation of current subscription at checkout completion
    # This is handled via webhook when the new subscription is created

    logger.info(
        "Created organization plan change checkout",
        org_id=str(org.id),
        from_plan=current_plan.slug if current_plan else "unknown",
        to_plan=data.plan_slug,
        session_id=session.id,
    )

    return CheckoutResponse(
        url=session.url or "",
        session_id=session.id,
    )
