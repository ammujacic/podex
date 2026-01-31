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

    if not org.stripe_customer_id:
        raise HTTPException(
            status_code=400,
            detail="No billing account found. Please make a purchase first.",
        )

    return_url = data.return_url or f"{settings.FRONTEND_URL}/settings/organization/billing"

    try:
        portal_session = stripe.billing_portal.Session.create(
            customer=org.stripe_customer_id,
            return_url=return_url,
        )
    except stripe.error.StripeError as e:
        logger.exception("Failed to create org portal session", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to create portal session") from e

    return PortalResponse(url=portal_session.url)


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
