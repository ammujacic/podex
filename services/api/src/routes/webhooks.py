"""Stripe webhook handlers for payment and subscription events."""

from datetime import UTC, datetime, timedelta
from typing import Any

import stripe
import structlog
from fastapi import APIRouter, HTTPException, Request, Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import get_db
from src.database.models import (
    BillingEvent,
    CreditBalance,
    CreditTransaction,
    Invoice,
    SubscriptionPlan,
    UsageQuota,
    User,
    UserSubscription,
)
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter
from src.routes.billing import generate_invoice_number, sync_quotas_from_plan
from src.services.email import EmailTemplate, get_email_service

logger = structlog.get_logger()

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

# Initialize Stripe
if settings.STRIPE_SECRET_KEY:
    stripe.api_key = settings.STRIPE_SECRET_KEY


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


async def _log_billing_event(
    db: AsyncSession,
    user_id: str,
    event_type: str,
    event_data: dict[str, Any],
    stripe_event_id: str | None = None,
    subscription_id: str | None = None,
    invoice_id: str | None = None,
    transaction_id: str | None = None,
) -> None:
    """Log a billing event from Stripe webhook."""
    event = BillingEvent(
        user_id=user_id,
        event_type=event_type,
        event_data=event_data,
        stripe_event_id=stripe_event_id,  # Store in dedicated indexed column
        subscription_id=subscription_id,
        invoice_id=invoice_id,
        transaction_id=transaction_id,
    )
    db.add(event)


async def _get_user_by_stripe_customer(
    db: AsyncSession,
    customer_id: str,
) -> User | None:
    """Get user by Stripe customer ID."""
    result = await db.execute(select(User).where(User.stripe_customer_id == customer_id))
    return result.scalar_one_or_none()


async def _get_or_create_stripe_customer(
    db: AsyncSession,
    user: User,
) -> str:
    """Get or create Stripe customer for user."""
    if user.stripe_customer_id:
        return user.stripe_customer_id

    # Create new Stripe customer
    customer = stripe.Customer.create(
        email=user.email,
        name=user.name or "",
        metadata={"user_id": user.id},
    )

    user.stripe_customer_id = str(customer.id)
    await db.flush()

    return str(customer.id)


async def _sync_subscription_from_stripe(
    db: AsyncSession,
    user: User,
    stripe_subscription: stripe.Subscription,
    stripe_event_id: str | None = None,
) -> UserSubscription:
    """Create or update subscription from Stripe subscription object."""
    # Get or create subscription record
    result = await db.execute(
        select(UserSubscription).where(
            UserSubscription.stripe_subscription_id == stripe_subscription.id
        )
    )
    subscription = result.scalar_one_or_none()

    # Get plan from Stripe price
    price_id = stripe_subscription["items"]["data"][0]["price"]["id"]
    plan_result = await db.execute(
        select(SubscriptionPlan).where(
            (SubscriptionPlan.stripe_price_id_monthly == price_id)
            | (SubscriptionPlan.stripe_price_id_yearly == price_id)
        )
    )
    plan = plan_result.scalar_one_or_none()

    if not plan:
        logger.warning(
            "Plan not found for Stripe price",
            price_id=price_id,
        )
        raise HTTPException(status_code=400, detail="Plan not found for Stripe price")

    # Determine billing cycle
    billing_cycle = "monthly"
    if price_id == plan.stripe_price_id_yearly:
        billing_cycle = "yearly"

    # Map Stripe status to our status
    status_map = {
        "active": "active",
        "trialing": "trialing",
        "past_due": "past_due",
        "canceled": "canceled",
        "unpaid": "past_due",
        "incomplete": "incomplete",
        "incomplete_expired": "canceled",
        "paused": "paused",
    }
    status = status_map.get(stripe_subscription.status, stripe_subscription.status)

    is_new_subscription = False

    now = datetime.now(UTC)
    old_period_start = subscription.current_period_start if subscription else None

    if subscription:
        # Update existing subscription
        subscription.plan_id = plan.id
        subscription.status = status
        subscription.billing_cycle = billing_cycle
        subscription.current_period_start = datetime.fromtimestamp(
            stripe_subscription["current_period_start"],
            tz=UTC,
        )
        subscription.current_period_end = datetime.fromtimestamp(
            stripe_subscription["current_period_end"],
            tz=UTC,
        )
        subscription.cancel_at_period_end = stripe_subscription.cancel_at_period_end
        if stripe_subscription.canceled_at:
            subscription.canceled_at = datetime.fromtimestamp(
                stripe_subscription.canceled_at, tz=UTC
            )
        if stripe_subscription.trial_end:
            subscription.trial_end = datetime.fromtimestamp(stripe_subscription.trial_end, tz=UTC)

        # Check if period has renewed (new billing cycle started)
        new_period_start = subscription.current_period_start
        if old_period_start and new_period_start > old_period_start:
            # Period renewed - grant monthly credits
            subscription.last_credit_grant = now
            await sync_quotas_from_plan(db, user.id, plan, subscription)
    else:
        # Create new subscription
        period_start = datetime.fromtimestamp(stripe_subscription.current_period_start, tz=UTC)
        period_end = datetime.fromtimestamp(stripe_subscription.current_period_end, tz=UTC)

        subscription = UserSubscription(
            user_id=user.id,
            plan_id=plan.id,
            status=status,
            billing_cycle=billing_cycle,
            current_period_start=period_start,
            current_period_end=period_end,
            cancel_at_period_end=stripe_subscription.cancel_at_period_end,
            stripe_subscription_id=stripe_subscription.id,
            stripe_customer_id=stripe_subscription.customer,
            last_credit_grant=now,  # Mark credits as granted for initial period
        )
        db.add(subscription)
        await db.flush()

        # Create quotas using centralized function (single source of truth)
        await sync_quotas_from_plan(db, user.id, plan, subscription)

        is_new_subscription = True

    await db.flush()

    # Log event
    await _log_billing_event(
        db,
        user_id=user.id,
        event_type="subscription_synced",
        event_data={
            "plan_slug": plan.slug,
            "status": status,
            "billing_cycle": billing_cycle,
        },
        stripe_event_id=stripe_event_id,
        subscription_id=subscription.id,
    )

    # Send subscription created email for new subscriptions
    if is_new_subscription and user.email:
        try:
            email_service = get_email_service()
            await email_service.send_email(
                user.email,
                EmailTemplate.SUBSCRIPTION_CREATED,
                {
                    "name": user.name or "there",
                    "plan_name": plan.name,
                    "tokens_included": plan.tokens_included,
                    "compute_credits": plan.compute_credits_cents_included / 100,
                    "max_sessions": plan.max_sessions,
                    "storage_gb": plan.storage_gb_included,
                },
            )
            logger.info("Sent subscription created email", user_id=user.id, plan=plan.slug)
        except Exception as e:
            logger.warning("Failed to send subscription email", user_id=user.id, error=str(e))

    return subscription


# =============================================================================
# WEBHOOK ENDPOINT
# =============================================================================


@router.post("/stripe")
@limiter.limit(RATE_LIMIT_STANDARD)
async def handle_stripe_webhook(request: Request, response: Response) -> dict[str, str]:
    """Handle incoming Stripe webhook events.

    Stripe sends various events for payment and subscription lifecycle.
    This handler processes the most important ones for billing sync.
    """
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    # Get raw body for signature verification
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    if not sig_header:
        raise HTTPException(status_code=400, detail="Missing Stripe signature")

    # Verify webhook signature - REQUIRED in all environments for security
    try:
        if not settings.STRIPE_WEBHOOK_SECRET:
            logger.error(
                "STRIPE_WEBHOOK_SECRET not configured - webhook signature verification is required"
            )
            raise HTTPException(
                status_code=503,
                detail="Webhook verification not configured",
            )
        event = stripe.Webhook.construct_event(payload, sig_header, settings.STRIPE_WEBHOOK_SECRET)
    except ValueError as e:
        logger.warning("Invalid webhook payload", error=str(e))
        raise HTTPException(status_code=400, detail="Invalid payload") from e
    except stripe.error.SignatureVerificationError as e:
        logger.warning("Invalid webhook signature", error=str(e))
        raise HTTPException(status_code=400, detail="Invalid signature") from e

    logger.info(
        "Received Stripe webhook",
        event_type=event.type,
        event_id=event.id,
    )

    # Get database session
    async for db in get_db():
        try:
            # Idempotency check - prevent duplicate event processing
            # Use dedicated indexed column for fast lookup
            existing_event = await db.execute(
                select(BillingEvent).where(BillingEvent.stripe_event_id == event.id)
            )
            if existing_event.scalar_one_or_none():
                logger.info(
                    "Skipping duplicate webhook event",
                    event_type=event.type,
                    event_id=event.id,
                )
                return {"status": "ok", "message": "Event already processed"}

            # Route to appropriate handler
            handler = WEBHOOK_HANDLERS.get(event.type)
            if handler:
                await handler(db, event)
                await db.commit()
            else:
                logger.debug("Unhandled webhook event", event_type=event.type)
        except Exception as e:
            logger.exception(
                "Webhook handler failed",
                event_type=event.type,
                event_id=event.id,
            )
            await db.rollback()
            raise HTTPException(status_code=500, detail="Webhook processing failed") from e

    return {"status": "ok"}


# =============================================================================
# EVENT HANDLERS
# =============================================================================


async def handle_checkout_session_completed(
    db: AsyncSession,
    event: stripe.Event,
) -> None:
    """Handle successful checkout session completion.

    This is fired when a customer completes a checkout session,
    either for a new subscription or a one-time purchase.
    """
    session = event.data.object

    # Get customer
    customer_id = session.customer
    if not customer_id:
        logger.warning("Checkout session without customer", session_id=session.id)
        return

    user = await _get_user_by_stripe_customer(db, customer_id)
    if not user:
        logger.warning("User not found for customer", customer_id=customer_id)
        return

    # Handle subscription checkout
    if session.mode == "subscription" and session.subscription:
        stripe_subscription = stripe.Subscription.retrieve(session.subscription)
        await _sync_subscription_from_stripe(db, user, stripe_subscription, event.id)

    # Handle one-time payment (credits purchase)
    elif session.mode == "payment":
        amount_total = session.amount_total  # in cents
        if amount_total and amount_total > 0:
            # Add credits to user balance
            result = await db.execute(select(CreditBalance).where(CreditBalance.user_id == user.id))
            balance = result.scalar_one_or_none()

            if not balance:
                balance = CreditBalance(user_id=user.id)
                db.add(balance)
                await db.flush()

            balance.balance_cents += amount_total
            balance.total_purchased_cents += amount_total

            # Credits expire 1 year from purchase
            expires_at = datetime.now(UTC) + timedelta(days=365)

            # Create transaction record with expiration
            transaction = CreditTransaction(
                user_id=user.id,
                amount_cents=amount_total,
                transaction_type="purchase",
                description=f"Stripe checkout: {session.id}",
                stripe_payment_intent_id=session.payment_intent,
                balance_after_cents=balance.balance_cents,
                expires_at=expires_at,
            )
            db.add(transaction)

            await _log_billing_event(
                db,
                user_id=user.id,
                event_type="credits_purchased",
                event_data={
                    "amount_cents": amount_total,
                    "session_id": session.id,
                    "payment_intent_id": session.payment_intent,
                },
                stripe_event_id=event.id,
                transaction_id=transaction.id,
            )

            # Send credits added email
            if user.email:
                try:
                    email_service = get_email_service()
                    await email_service.send_email(
                        user.email,
                        EmailTemplate.CREDITS_ADDED,
                        {
                            "name": user.name or "there",
                            "amount": amount_total / 100,
                            "new_balance": balance.balance_cents / 100,
                        },
                    )
                    logger.info("Sent credits added email", user_id=user.id)
                except Exception as e:
                    logger.warning("Failed to send credits email", user_id=user.id, error=str(e))


async def handle_customer_subscription_created(
    db: AsyncSession,
    event: stripe.Event,
) -> None:
    """Handle new subscription creation."""
    stripe_subscription = event.data.object
    customer_id = stripe_subscription.customer

    user = await _get_user_by_stripe_customer(db, customer_id)
    if not user:
        logger.warning("User not found for customer", customer_id=customer_id)
        return

    await _sync_subscription_from_stripe(db, user, stripe_subscription, event.id)


async def handle_customer_subscription_updated(
    db: AsyncSession,
    event: stripe.Event,
) -> None:
    """Handle subscription updates (plan changes, status changes, etc.)."""
    stripe_subscription = event.data.object
    customer_id = stripe_subscription.customer

    user = await _get_user_by_stripe_customer(db, customer_id)
    if not user:
        logger.warning("User not found for customer", customer_id=customer_id)
        return

    subscription = await _sync_subscription_from_stripe(db, user, stripe_subscription, event.id)

    previous_attributes = event.data.get("previous_attributes", {})

    # Check for billing period change (renewal) - reset quotas
    if "current_period_start" in previous_attributes:
        # Billing period has changed - this is a renewal, reset usage quotas
        new_period_end = subscription.current_period_end

        await db.execute(
            update(UsageQuota)
            .where(UsageQuota.user_id == user.id)
            .where(UsageQuota.quota_type.in_(["tokens", "compute_credits"]))
            .values(
                current_usage=0,
                reset_at=new_period_end,
                warning_sent_at=None,
            )
        )

        logger.info(
            "Reset quotas on subscription renewal",
            user_id=user.id,
            new_period_end=new_period_end.isoformat(),
        )

        await _log_billing_event(
            db,
            user_id=user.id,
            event_type="quotas_reset_renewal",
            event_data={
                "new_period_end": new_period_end.isoformat(),
            },
            stripe_event_id=event.id,
            subscription_id=subscription.id,
        )

    # Check for plan changes and update quotas
    if "items" in previous_attributes:
        # Plan changed - update quotas
        plan_result = await db.execute(
            select(SubscriptionPlan).where(SubscriptionPlan.id == subscription.plan_id)
        )
        plan = plan_result.scalar_one()

        await db.execute(
            update(UsageQuota)
            .where(UsageQuota.user_id == user.id)
            .where(UsageQuota.quota_type == "tokens")
            .values(
                limit_value=plan.tokens_included,
                overage_allowed=plan.overage_allowed,
            )
        )
        await db.execute(
            update(UsageQuota)
            .where(UsageQuota.user_id == user.id)
            .where(UsageQuota.quota_type == "compute_credits")
            .values(
                limit_value=plan.compute_credits_cents_included,
                overage_allowed=plan.overage_allowed,
            )
        )


async def handle_customer_subscription_deleted(
    db: AsyncSession,
    event: stripe.Event,
) -> None:
    """Handle subscription cancellation/deletion.

    When a paid subscription ends (period expires after cancel_at_period_end),
    Stripe fires this event. We need to:
    1. Mark the old subscription as canceled
    2. Downgrade user to the free plan
    3. Update quotas to free plan limits
    """
    stripe_subscription = event.data.object
    subscription_id = stripe_subscription.id

    # Update subscription status
    result = await db.execute(
        select(UserSubscription).where(UserSubscription.stripe_subscription_id == subscription_id)
    )
    subscription = result.scalar_one_or_none()

    if subscription:
        user_id = subscription.user_id
        subscription.status = "canceled"
        subscription.canceled_at = datetime.now(UTC)

        await _log_billing_event(
            db,
            user_id=user_id,
            event_type="subscription_canceled",
            event_data={
                "reason": "Stripe subscription deleted",
            },
            stripe_event_id=event.id,
            subscription_id=subscription.id,
        )

        # Get user and free plan to downgrade
        user_result = await db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()

        free_plan_result = await db.execute(
            select(SubscriptionPlan).where(SubscriptionPlan.slug == "free")
        )
        free_plan = free_plan_result.scalar_one_or_none()

        # Create a new free plan subscription
        if user and free_plan:
            now = datetime.now(UTC)
            # Free plans have 30-day periods that auto-renew
            period_end = now + timedelta(days=30)

            free_subscription = UserSubscription(
                user_id=user_id,
                plan_id=free_plan.id,
                status="active",
                billing_cycle="monthly",
                current_period_start=now,
                current_period_end=period_end,
                cancel_at_period_end=False,
                last_credit_grant=now,
            )
            db.add(free_subscription)
            await db.flush()

            # Update quotas to free plan limits
            await sync_quotas_from_plan(db, user_id, free_plan, free_subscription)

            await _log_billing_event(
                db,
                user_id=user_id,
                event_type="downgraded_to_free",
                event_data={
                    "previous_subscription_id": subscription.id,
                    "new_subscription_id": free_subscription.id,
                },
                stripe_event_id=event.id,
                subscription_id=free_subscription.id,
            )

            logger.info(
                "Downgraded user to free plan",
                user_id=user_id,
                previous_plan_id=subscription.plan_id,
            )

        # Send subscription canceled email
        if user and user.email:
            try:
                email_service = get_email_service()
                await email_service.send_email(
                    user.email,
                    EmailTemplate.SUBSCRIPTION_CANCELED,
                    {
                        "name": user.name or "there",
                    },
                )
                logger.info("Sent subscription canceled email", user_id=user.id)
            except Exception as e:
                logger.warning("Failed to send cancellation email", user_id=user.id, error=str(e))


async def handle_invoice_paid(
    db: AsyncSession,
    event: stripe.Event,
) -> None:
    """Handle successful invoice payment."""
    stripe_invoice = event.data.object
    customer_id = stripe_invoice.customer

    user = await _get_user_by_stripe_customer(db, customer_id)
    if not user:
        logger.warning("User not found for customer", customer_id=customer_id)
        return

    # Create or update invoice record
    result = await db.execute(select(Invoice).where(Invoice.stripe_invoice_id == stripe_invoice.id))
    invoice = result.scalar_one_or_none()

    if not invoice:
        # Generate invoice number atomically
        invoice_number = await generate_invoice_number(db, user.id)

        invoice = Invoice(
            user_id=user.id,
            invoice_number=invoice_number,
            subtotal_cents=stripe_invoice.subtotal or 0,
            discount_cents=stripe_invoice.discount or 0
            if isinstance(stripe_invoice.discount, int)
            else 0,
            tax_cents=stripe_invoice.tax or 0,
            total_cents=stripe_invoice.total or 0,
            currency=stripe_invoice.currency.upper(),
            status="paid",
            stripe_invoice_id=stripe_invoice.id,
            period_start=datetime.fromtimestamp(stripe_invoice.period_start, tz=UTC)
            if stripe_invoice.period_start
            else datetime.now(UTC),
            period_end=datetime.fromtimestamp(stripe_invoice.period_end, tz=UTC)
            if stripe_invoice.period_end
            else datetime.now(UTC) + timedelta(days=30),
            due_date=datetime.fromtimestamp(stripe_invoice.due_date, tz=UTC)
            if stripe_invoice.due_date
            else datetime.now(UTC),
            paid_at=datetime.now(UTC),
            line_items=[
                {
                    "description": line.description,
                    "quantity": line.quantity,
                    "unit_amount_cents": line.unit_amount,
                    "amount_cents": line.amount,
                }
                for line in stripe_invoice.lines.data
            ],
            pdf_url=stripe_invoice.invoice_pdf,
        )
        db.add(invoice)
    else:
        invoice.status = "paid"
        invoice.paid_at = datetime.now(UTC)
        invoice.pdf_url = stripe_invoice.invoice_pdf

    await db.flush()

    await _log_billing_event(
        db,
        user_id=user.id,
        event_type="invoice_paid",
        event_data={
            "invoice_id": stripe_invoice.id,
            "amount_cents": stripe_invoice.total,
        },
        stripe_event_id=event.id,
        invoice_id=invoice.id,
    )

    # Send payment confirmation email
    if user.email:
        try:
            email_service = get_email_service()
            await email_service.send_email(
                user.email,
                EmailTemplate.PAYMENT_RECEIVED,
                {
                    "name": user.name or "there",
                    "amount": (stripe_invoice.total or 0) / 100,
                    "date": datetime.now(UTC).strftime("%B %d, %Y"),
                    "invoice_number": invoice.invoice_number,
                    "invoice_url": f"{settings.FRONTEND_URL}/settings/billing/invoices/{invoice.id}",
                },
            )
            logger.info("Sent payment confirmation email", user_id=user.id)
        except Exception as e:
            logger.warning("Failed to send payment email", user_id=user.id, error=str(e))


async def handle_invoice_payment_failed(
    db: AsyncSession,
    event: stripe.Event,
) -> None:
    """Handle failed invoice payment."""
    stripe_invoice = event.data.object
    customer_id = stripe_invoice.customer

    user = await _get_user_by_stripe_customer(db, customer_id)
    if not user:
        return

    # Update invoice status
    result = await db.execute(select(Invoice).where(Invoice.stripe_invoice_id == stripe_invoice.id))
    invoice = result.scalar_one_or_none()

    if invoice:
        invoice.status = "payment_failed"

    # Update subscription status to past_due if subscription invoice
    if stripe_invoice.subscription:
        sub_result = await db.execute(
            select(UserSubscription).where(
                UserSubscription.stripe_subscription_id == stripe_invoice.subscription
            )
        )
        subscription = sub_result.scalar_one_or_none()
        if subscription:
            subscription.status = "past_due"

    await _log_billing_event(
        db,
        user_id=user.id,
        event_type="payment_failed",
        event_data={
            "invoice_id": stripe_invoice.id,
            "amount_cents": stripe_invoice.total,
            "attempt_count": stripe_invoice.attempt_count,
        },
        stripe_event_id=event.id,
        invoice_id=invoice.id if invoice else None,
    )

    # Send payment failure email
    if user.email:
        try:
            email_service = get_email_service()
            await email_service.send_email(
                user.email,
                EmailTemplate.PAYMENT_FAILED,
                {
                    "name": user.name or "there",
                    "amount": (stripe_invoice.total or 0) / 100,
                },
            )
            logger.info("Sent payment failure email", user_id=user.id)
        except Exception as e:
            logger.warning("Failed to send payment failure email", user_id=user.id, error=str(e))


async def handle_payment_intent_succeeded(
    db: AsyncSession,
    event: stripe.Event,
) -> None:
    """Handle successful payment intent (for one-time payments)."""
    payment_intent = event.data.object
    customer_id = payment_intent.customer

    if not customer_id:
        return

    user = await _get_user_by_stripe_customer(db, customer_id)
    if not user:
        return

    await _log_billing_event(
        db,
        user_id=user.id,
        event_type="payment_succeeded",
        event_data={
            "payment_intent_id": payment_intent.id,
            "amount_cents": payment_intent.amount,
        },
        stripe_event_id=event.id,
    )


async def handle_customer_created(
    db: AsyncSession,
    event: stripe.Event,
) -> None:
    """Handle new Stripe customer creation.

    Link the Stripe customer to our user if metadata contains user_id.
    """
    customer = event.data.object
    user_id = customer.metadata.get("user_id")

    if user_id:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()

        if user and not user.stripe_customer_id:
            user.stripe_customer_id = customer.id


async def handle_customer_subscription_paused(
    db: AsyncSession,
    event: stripe.Event,
) -> None:
    """Handle subscription pause event."""
    stripe_subscription = event.data.object
    subscription_id = stripe_subscription.id

    result = await db.execute(
        select(UserSubscription).where(UserSubscription.stripe_subscription_id == subscription_id)
    )
    subscription = result.scalar_one_or_none()

    if subscription:
        subscription.status = "paused"

        await _log_billing_event(
            db,
            user_id=subscription.user_id,
            event_type="subscription_paused",
            event_data={
                "reason": "Stripe subscription paused",
            },
            stripe_event_id=event.id,
            subscription_id=subscription.id,
        )

        logger.info(
            "Subscription paused",
            subscription_id=subscription.id,
            user_id=subscription.user_id,
        )


async def handle_customer_subscription_resumed(
    db: AsyncSession,
    event: stripe.Event,
) -> None:
    """Handle subscription resume event."""
    stripe_subscription = event.data.object
    customer_id = stripe_subscription.customer

    user = await _get_user_by_stripe_customer(db, customer_id)
    if not user:
        logger.warning("User not found for customer", customer_id=customer_id)
        return

    # Re-sync subscription from Stripe (will update status to active)
    await _sync_subscription_from_stripe(db, user, stripe_subscription, event.id)

    logger.info(
        "Subscription resumed",
        stripe_subscription_id=stripe_subscription.id,
        user_id=user.id,
    )


async def handle_charge_dispute_created(
    db: AsyncSession,
    event: stripe.Event,
) -> None:
    """Handle dispute/chargeback creation."""
    dispute = event.data.object
    charge_id = dispute.charge

    # Get the charge to find the customer
    try:
        charge = stripe.Charge.retrieve(charge_id)
        customer_id = charge.customer
    except Exception as e:
        logger.warning("Failed to retrieve charge for dispute", charge_id=charge_id, error=str(e))
        return

    if not customer_id:
        return

    user = await _get_user_by_stripe_customer(db, customer_id)
    if not user:
        return

    await _log_billing_event(
        db,
        user_id=user.id,
        event_type="charge_dispute_created",
        event_data={
            "dispute_id": dispute.id,
            "charge_id": charge_id,
            "amount": dispute.amount,
            "reason": dispute.reason,
            "status": dispute.status,
        },
        stripe_event_id=event.id,
    )

    logger.warning(
        "Charge dispute created",
        user_id=user.id,
        dispute_id=dispute.id,
        amount=dispute.amount,
        reason=dispute.reason,
    )

    # Send notification email about the dispute
    if user.email:
        try:
            email_service = get_email_service()
            await email_service.send_email(
                user.email,
                EmailTemplate.PAYMENT_FAILED,  # Reuse payment failed template
                {
                    "name": user.name or "there",
                    "amount": dispute.amount / 100,
                },
            )
        except Exception as e:
            logger.warning("Failed to send dispute email", user_id=user.id, error=str(e))


async def handle_invoice_upcoming(
    db: AsyncSession,
    event: stripe.Event,
) -> None:
    """Handle upcoming invoice notification.

    Stripe sends this ~3 days before the invoice is finalized.
    Useful for notifying users about upcoming charges.
    """
    stripe_invoice = event.data.object
    customer_id = stripe_invoice.customer

    if not customer_id:
        return

    user = await _get_user_by_stripe_customer(db, customer_id)
    if not user:
        return

    await _log_billing_event(
        db,
        user_id=user.id,
        event_type="invoice_upcoming",
        event_data={
            "amount_due": stripe_invoice.amount_due,
            "next_payment_attempt": stripe_invoice.next_payment_attempt,
        },
        stripe_event_id=event.id,
    )

    logger.info(
        "Upcoming invoice notification",
        user_id=user.id,
        amount_due=stripe_invoice.amount_due,
    )


# =============================================================================
# WEBHOOK HANDLER REGISTRY
# =============================================================================

WEBHOOK_HANDLERS = {
    "checkout.session.completed": handle_checkout_session_completed,
    "customer.subscription.created": handle_customer_subscription_created,
    "customer.subscription.updated": handle_customer_subscription_updated,
    "customer.subscription.deleted": handle_customer_subscription_deleted,
    "customer.subscription.paused": handle_customer_subscription_paused,
    "customer.subscription.resumed": handle_customer_subscription_resumed,
    "invoice.paid": handle_invoice_paid,
    "invoice.payment_failed": handle_invoice_payment_failed,
    "invoice.upcoming": handle_invoice_upcoming,
    "payment_intent.succeeded": handle_payment_intent_succeeded,
    "customer.created": handle_customer_created,
    "charge.dispute.created": handle_charge_dispute_created,
}
