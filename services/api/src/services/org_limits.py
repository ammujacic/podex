"""Organization limit enforcement service.

This module handles checking and enforcing resource limits for organization members:
- Spending limits (per-user caps on spending)
- Model access (which AI models a user can access)
- Instance type access (which compute tiers a user can use)
- Storage limits
- Feature access

Supports three credit models:
- Pooled: Shared org credit pool with per-user spending caps
- Allocated: Pre-allocated credits per user from org pool
- Usage-based: No pre-allocation, track usage and bill with per-user caps
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import (
    Agent,
    Organization,
    OrganizationCreditTransaction,
    OrganizationInvoice,
    OrganizationMember,
    OrganizationSubscription,
    OrganizationUsageRecord,
    Session,
    SubscriptionPlan,
    User,
)

logger = structlog.get_logger()


class LimitExceededError(Exception):
    """Raised when a user exceeds their limit."""

    def __init__(
        self,
        limit_type: str,
        current: int,
        limit: int,
        message: str | None = None,
    ) -> None:
        self.limit_type = limit_type
        self.current = current
        self.limit = limit
        self.message = message or f"{limit_type} limit exceeded: {current}/{limit}"
        super().__init__(self.message)


class ModelAccessDeniedError(Exception):
    """Raised when a user tries to access a restricted model."""

    def __init__(self, model: str, allowed_models: list[str] | None = None) -> None:
        self.model = model
        self.allowed_models = allowed_models
        message = f"Access to model '{model}' is not allowed"
        if allowed_models:
            message += f". Allowed models: {', '.join(allowed_models)}"
        super().__init__(message)


class InstanceTypeAccessDeniedError(Exception):
    """Raised when a user tries to use a restricted instance type."""

    def __init__(self, instance_type: str, allowed_types: list[str] | None = None) -> None:
        self.instance_type = instance_type
        self.allowed_types = allowed_types
        message = f"Access to instance type '{instance_type}' is not allowed"
        if allowed_types:
            message += f". Allowed types: {', '.join(allowed_types)}"
        super().__init__(message)


class FeatureAccessDeniedError(Exception):
    """Raised when a user tries to access a restricted feature."""

    def __init__(self, feature: str) -> None:
        self.feature = feature
        super().__init__(f"Access to feature '{feature}' is not allowed")


class SessionLimitExceededError(Exception):
    """Raised when user exceeds concurrent session limit."""

    def __init__(self, current: int, limit: int) -> None:
        self.current = current
        self.limit = limit
        super().__init__(f"Session limit exceeded: {current}/{limit} concurrent sessions")


class AgentLimitExceededError(Exception):
    """Raised when user exceeds agent count limit."""

    def __init__(self, current: int, limit: int) -> None:
        self.current = current
        self.limit = limit
        super().__init__(f"Agent limit exceeded: {current}/{limit} agents")


class SeatLimitExceededError(Exception):
    """Raised when organization has no available seats."""

    def __init__(self, current_members: int, max_seats: int) -> None:
        self.current_members = current_members
        self.max_seats = max_seats
        super().__init__(
            f"No seats available: {current_members}/{max_seats} seats used. "
            "Contact your organization admin to purchase additional seats."
        )


@dataclass
class LimitStatus:
    """Status of a user's limits within an organization."""

    # Spending
    spending_limit_cents: int | None
    current_spending_cents: int
    remaining_spending_cents: int | None

    # For allocated model
    allocated_credits_cents: int
    used_credits_cents: int
    remaining_allocated_cents: int

    # For usage-based model (billing period)
    billing_period_spending_cents: int

    # Resource access
    allowed_models: list[str] | None
    allowed_instance_types: list[str] | None
    storage_limit_gb: int | None
    feature_access: dict[str, bool] | None

    # Status
    is_blocked: bool
    blocked_reason: str | None
    credit_model: str

    @property
    def is_at_limit(self) -> bool:
        """Check if user is at their spending limit."""
        if self.is_blocked:
            return True

        if self.credit_model == "allocated":
            return self.remaining_allocated_cents <= 0

        if self.spending_limit_cents is not None:
            return self.remaining_spending_cents is not None and self.remaining_spending_cents <= 0

        return False


class OrgLimitsService:
    """Service for checking and enforcing organization limits."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_limit_status(
        self,
        member: OrganizationMember,
        org: Organization,
    ) -> LimitStatus:
        """Get current limit status for a member."""
        # Calculate remaining spending based on credit model
        remaining_spending = None
        if member.spending_limit_cents is not None:
            if org.credit_model == "pooled":
                remaining_spending = member.spending_limit_cents - member.current_spending_cents
            elif org.credit_model == "usage_based":
                remaining_spending = (
                    member.spending_limit_cents - member.billing_period_spending_cents
                )

        # Get effective resource limits (member override or org defaults)
        allowed_models = member.allowed_models or org.default_allowed_models
        allowed_instance_types = member.allowed_instance_types or org.default_allowed_instance_types
        storage_limit = member.storage_limit_gb or org.default_storage_limit_gb
        feature_access = member.feature_access or org.default_feature_access

        return LimitStatus(
            spending_limit_cents=member.spending_limit_cents,
            current_spending_cents=member.current_spending_cents,
            remaining_spending_cents=remaining_spending,
            allocated_credits_cents=member.allocated_credits_cents,
            used_credits_cents=member.used_credits_cents,
            remaining_allocated_cents=member.allocated_credits_cents - member.used_credits_cents,
            billing_period_spending_cents=member.billing_period_spending_cents,
            allowed_models=allowed_models,
            allowed_instance_types=allowed_instance_types,
            storage_limit_gb=storage_limit,
            feature_access=feature_access,
            is_blocked=member.is_blocked,
            blocked_reason=member.blocked_reason,
            credit_model=org.credit_model,
        )

    async def check_spending_limit(
        self,
        member: OrganizationMember,
        org: Organization,
        additional_cents: int,
    ) -> bool:
        """Check if user can spend additional credits.

        Args:
            member: Organization member
            org: Organization
            additional_cents: Amount to be spent (in cents)

        Returns:
            True if spending is allowed

        Raises:
            LimitExceededError: If spending would exceed limit
        """
        # Check org subscription status - block if unpaid/canceled
        sub_result = await self.db.execute(
            select(OrganizationSubscription)
            .where(OrganizationSubscription.organization_id == org.id)
            .order_by(OrganizationSubscription.created_at.desc())
            .limit(1)
        )
        subscription = sub_result.scalar_one_or_none()

        if subscription and subscription.status in ("unpaid", "canceled"):
            raise LimitExceededError(
                "subscription_inactive",
                0,
                0,
                "Organization subscription is inactive due to unpaid invoice. "
                "Please contact your organization admin to update payment method.",
            )

        if member.is_blocked:
            raise LimitExceededError(
                "blocked",
                0,
                0,
                f"Your access has been blocked: "
                f"{member.blocked_reason or 'Contact your organization admin'}",
            )

        if org.credit_model == "pooled":
            # Check individual spending cap
            if member.spending_limit_cents is not None:
                new_total = member.current_spending_cents + additional_cents
                if new_total > member.spending_limit_cents:
                    raise LimitExceededError(
                        "spending",
                        member.current_spending_cents,
                        member.spending_limit_cents,
                        "Individual spending limit reached",
                    )

            # Check org pool has enough credits
            if org.credit_pool_cents < additional_cents:
                raise LimitExceededError(
                    "organization_pool",
                    org.credit_pool_cents,
                    additional_cents,
                    "Organization credit pool exhausted",
                )

        elif org.credit_model == "allocated":
            # Check allocated credits
            remaining = member.allocated_credits_cents - member.used_credits_cents
            if remaining < additional_cents:
                raise LimitExceededError(
                    "allocated_credits",
                    member.used_credits_cents,
                    member.allocated_credits_cents,
                    "Allocated credits exhausted. Contact your admin for more credits.",
                )

        elif org.credit_model == "usage_based":
            # Check spending cap for current billing period
            if member.spending_limit_cents is not None:
                new_total = member.billing_period_spending_cents + additional_cents
                if new_total > member.spending_limit_cents:
                    raise LimitExceededError(
                        "spending",
                        member.billing_period_spending_cents,
                        member.spending_limit_cents,
                        "Billing period spending limit reached",
                    )

        return True

    async def check_model_access(
        self,
        member: OrganizationMember,
        org: Organization,
        model: str,
    ) -> bool:
        """Check if user can access a specific AI model.

        Args:
            member: Organization member
            org: Organization
            model: Model identifier (e.g., "gpt-4", "claude-3-opus")

        Returns:
            True if access is allowed

        Raises:
            ModelAccessDeniedError: If model is not allowed
        """
        # Get effective allowed models (member override or org default)
        allowed_models = member.allowed_models or org.default_allowed_models

        # If no restrictions, allow all
        if allowed_models is None:
            return True

        if model not in allowed_models:
            raise ModelAccessDeniedError(model, allowed_models)

        return True

    async def check_instance_type_access(
        self,
        member: OrganizationMember,
        org: Organization,
        instance_type: str,
    ) -> bool:
        """Check if user can use a specific compute instance type.

        Args:
            member: Organization member
            org: Organization
            instance_type: Instance tier (e.g., "cpu-small", "gpu-t4")

        Returns:
            True if access is allowed

        Raises:
            InstanceTypeAccessDeniedError: If instance type is not allowed
        """
        allowed_types = member.allowed_instance_types or org.default_allowed_instance_types

        if allowed_types is None:
            return True

        if instance_type not in allowed_types:
            raise InstanceTypeAccessDeniedError(instance_type, allowed_types)

        return True

    async def check_feature_access(
        self,
        member: OrganizationMember,
        org: Organization,
        feature: str,
    ) -> bool:
        """Check if user can access a specific feature.

        Args:
            member: Organization member
            org: Organization
            feature: Feature identifier (e.g., "mcp_servers", "custom_agents")

        Returns:
            True if access is allowed

        Raises:
            FeatureAccessDeniedError: If feature is not allowed
        """
        feature_access = member.feature_access or org.default_feature_access

        if feature_access is None:
            return True

        if not feature_access.get(feature, True):
            raise FeatureAccessDeniedError(feature)

        return True

    async def check_session_concurrency(
        self,
        member: OrganizationMember,
        org: Organization,
    ) -> bool:
        """Check if user can create a new session (concurrent session limit).

        Args:
            member: Organization member
            org: Organization

        Returns:
            True if session creation is allowed

        Raises:
            SessionLimitExceededError: If session limit would be exceeded
        """
        from sqlalchemy import func as sqlfunc  # noqa: PLC0415

        # Get org subscription and plan limits
        sub_result = await self.db.execute(
            select(OrganizationSubscription)
            .where(OrganizationSubscription.organization_id == org.id)
            .where(OrganizationSubscription.status.in_(["active", "trialing"]))
        )
        subscription = sub_result.scalar_one_or_none()

        if not subscription:
            # No subscription, allow default 3 sessions
            max_sessions = 3
        else:
            plan_result = await self.db.execute(
                select(SubscriptionPlan).where(SubscriptionPlan.id == subscription.plan_id)
            )
            plan = plan_result.scalar_one_or_none()
            max_sessions = plan.max_sessions if plan else 3

        # Count active sessions for this user
        active_sessions = await self.db.execute(
            select(sqlfunc.count(Session.id))
            .where(Session.owner_id == member.user_id)
            .where(Session.status.in_(["running", "starting", "provisioning"]))
        )
        current_count = active_sessions.scalar() or 0

        if current_count >= max_sessions:
            raise SessionLimitExceededError(current_count, max_sessions)

        return True

    async def check_agent_count(
        self,
        member: OrganizationMember,
        org: Organization,
    ) -> bool:
        """Check if user can create a new agent (agent count limit).

        Args:
            member: Organization member
            org: Organization

        Returns:
            True if agent creation is allowed

        Raises:
            AgentLimitExceededError: If agent limit would be exceeded
        """
        from sqlalchemy import func as sqlfunc  # noqa: PLC0415

        # Get org subscription and plan limits
        sub_result = await self.db.execute(
            select(OrganizationSubscription)
            .where(OrganizationSubscription.organization_id == org.id)
            .where(OrganizationSubscription.status.in_(["active", "trialing"]))
        )
        subscription = sub_result.scalar_one_or_none()

        if not subscription:
            # No subscription, allow default 2 agents
            max_agents = 2
        else:
            plan_result = await self.db.execute(
                select(SubscriptionPlan).where(SubscriptionPlan.id == subscription.plan_id)
            )
            plan = plan_result.scalar_one_or_none()
            max_agents = plan.max_agents if plan else 2

        # Count agents for this user (agents belong to sessions owned by the user)
        agent_count = await self.db.execute(
            select(sqlfunc.count(Agent.id))
            .join(Session, Agent.session_id == Session.id)
            .where(Session.owner_id == member.user_id)
            .where(Agent.status.notin_(["terminated", "failed"]))
        )
        current_count = agent_count.scalar() or 0

        if current_count >= max_agents:
            raise AgentLimitExceededError(current_count, max_agents)

        return True

    async def check_seat_availability(
        self,
        org: Organization,
    ) -> tuple[bool, int, int]:
        """Check if organization has available seats for new members.

        Args:
            org: Organization

        Returns:
            Tuple of (has_availability, current_members, max_seats)

        Raises:
            SeatLimitExceededError: If no seats available
        """
        from sqlalchemy import func as sqlfunc  # noqa: PLC0415

        # Get org subscription for seat count
        sub_result = await self.db.execute(
            select(OrganizationSubscription)
            .where(OrganizationSubscription.organization_id == org.id)
            .where(OrganizationSubscription.status.in_(["active", "trialing"]))
        )
        subscription = sub_result.scalar_one_or_none()

        if not subscription:
            # No subscription - allow unlimited members (free tier or legacy)
            return (True, 0, 999999)

        max_seats = subscription.seat_count

        # Count current members (excluding pending invitations)
        member_count_result = await self.db.execute(
            select(sqlfunc.count(OrganizationMember.id)).where(
                OrganizationMember.organization_id == org.id
            )
        )
        current_members = member_count_result.scalar() or 0

        if current_members >= max_seats:
            raise SeatLimitExceededError(current_members, max_seats)

        return (True, current_members, max_seats)

    async def record_usage_and_deduct(
        self,
        member: OrganizationMember,
        org: Organization,
        cost_cents: int,
        usage_type: str,
        quantity: int,
        unit: str,
        model: str | None = None,
        tier: str | None = None,
        session_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> OrganizationUsageRecord:
        """Record usage and deduct from appropriate balance.

        This should be called AFTER check_spending_limit passes.

        Args:
            member: Organization member
            org: Organization
            cost_cents: Cost of this usage
            usage_type: Type of usage (tokens_input, tokens_output, compute_seconds, etc.)
            quantity: Amount in base units
            unit: Unit of measurement
            model: AI model used (if applicable)
            tier: Compute tier used (if applicable)
            session_id: Session ID (if applicable)
            metadata: Additional metadata

        Returns:
            The created usage record
        """
        # Fetch entity names for snapshot fields (preserves names even after deletion)
        user_name = None
        user_email = None
        session_name = None

        if member.user_id:
            user_result = await self.db.execute(
                select(User.name, User.email).where(User.id == member.user_id)
            )
            user_row = user_result.one_or_none()
            if user_row:
                user_name = user_row.name
                user_email = user_row.email

        if session_id:
            session_result = await self.db.execute(
                select(Session.name).where(Session.id == session_id)
            )
            session_name = session_result.scalar_one_or_none()

        # Create usage record
        record = OrganizationUsageRecord(
            organization_id=org.id,
            user_id=member.user_id,
            user_name=user_name,
            user_email=user_email,
            usage_type=usage_type,
            quantity=quantity,
            unit=unit,
            total_cost_cents=cost_cents,
            model=model,
            tier=tier,
            session_id=session_id,
            session_name=session_name,
            billing_period_start=member.billing_period_start,
            record_metadata=metadata,
        )
        self.db.add(record)

        # Deduct based on credit model
        if org.credit_model == "pooled":
            org.credit_pool_cents -= cost_cents
            member.current_spending_cents += cost_cents

            # Create credit transaction for the deduction
            transaction = OrganizationCreditTransaction(
                organization_id=org.id,
                user_id=member.user_id,
                amount_cents=-cost_cents,
                transaction_type="usage",
                description=f"Usage: {usage_type} ({quantity} {unit})",
                pool_balance_after_cents=org.credit_pool_cents,
                reference_type="usage_record",
                reference_id=record.id,
            )
            self.db.add(transaction)

        elif org.credit_model == "allocated":
            member.used_credits_cents += cost_cents

            # Create credit transaction
            transaction = OrganizationCreditTransaction(
                organization_id=org.id,
                user_id=member.user_id,
                amount_cents=-cost_cents,
                transaction_type="usage",
                description=f"Usage: {usage_type} ({quantity} {unit})",
                pool_balance_after_cents=org.credit_pool_cents,
                user_balance_after_cents=member.allocated_credits_cents - member.used_credits_cents,
                reference_type="usage_record",
                reference_id=record.id,
            )
            self.db.add(transaction)

        elif org.credit_model == "usage_based":
            member.billing_period_spending_cents += cost_cents

        # Check if user should be blocked after this usage
        await self._check_and_block_if_needed(member, org)

        await self.db.commit()
        await self.db.refresh(record)

        logger.info(
            "Recorded organization usage",
            org_id=org.id,
            user_id=member.user_id,
            usage_type=usage_type,
            cost_cents=cost_cents,
            credit_model=org.credit_model,
        )

        return record

    async def _check_and_block_if_needed(
        self,
        member: OrganizationMember,
        org: Organization,
    ) -> None:
        """Check if user should be blocked due to limit reached."""
        should_block = False
        reason = None

        if (
            org.credit_model == "pooled"
            and member.spending_limit_cents is not None
            and member.current_spending_cents >= member.spending_limit_cents
        ):
            should_block = True
            reason = "Spending limit reached"

        elif org.credit_model == "allocated":
            if member.used_credits_cents >= member.allocated_credits_cents:
                should_block = True
                reason = "Allocated credits exhausted"

        elif (
            org.credit_model == "usage_based"
            and member.spending_limit_cents is not None
            and member.billing_period_spending_cents >= member.spending_limit_cents
        ):
            should_block = True
            reason = "Billing period spending limit reached"

        if should_block and not member.is_blocked:
            member.is_blocked = True
            member.blocked_reason = reason
            member.blocked_at = datetime.now(UTC)

            logger.warning(
                "Member auto-blocked due to limit",
                org_id=org.id,
                user_id=member.user_id,
                reason=reason,
            )

    async def allocate_credits(
        self,
        member: OrganizationMember,
        org: Organization,
        amount_cents: int,
        description: str | None = None,
    ) -> OrganizationCreditTransaction:
        """Allocate credits to a member (for allocated credit model).

        Args:
            member: Organization member
            org: Organization
            amount_cents: Amount to allocate (positive = add, negative = remove)
            description: Optional description for the transaction

        Returns:
            The created credit transaction
        """

        class InvalidCreditModelError(ValueError):
            def __init__(self) -> None:
                super().__init__("Credit allocation requires 'allocated' model")

        if org.credit_model != "allocated":
            raise InvalidCreditModelError

        # Update member's allocated credits
        member.allocated_credits_cents += amount_cents

        # Create transaction record
        transaction = OrganizationCreditTransaction(
            organization_id=org.id,
            user_id=member.user_id,
            amount_cents=amount_cents,
            transaction_type="allocation",
            description=description or f"Credit allocation: {amount_cents} cents",
            pool_balance_after_cents=org.credit_pool_cents,
            user_balance_after_cents=member.allocated_credits_cents - member.used_credits_cents,
        )
        self.db.add(transaction)

        # Unblock if they now have credits
        if member.is_blocked and member.allocated_credits_cents > member.used_credits_cents:
            member.is_blocked = False
            member.blocked_reason = None
            member.blocked_at = None

        await self.db.commit()
        await self.db.refresh(transaction)

        logger.info(
            "Allocated credits to member",
            org_id=org.id,
            user_id=member.user_id,
            amount_cents=amount_cents,
        )

        return transaction

    async def reset_billing_period(
        self,
        member: OrganizationMember,
        org: Organization,
    ) -> None:
        """Reset a member's billing period (for usage-based model).

        Called at the start of a new billing period.
        """
        member.billing_period_start = datetime.now(UTC)
        member.billing_period_spending_cents = 0

        # Unblock if they were blocked due to spending limit
        if member.is_blocked and member.blocked_reason == "Billing period spending limit reached":
            member.is_blocked = False
            member.blocked_reason = None
            member.blocked_at = None

        await self.db.commit()

        logger.info(
            "Reset member billing period",
            org_id=org.id,
            user_id=member.user_id,
        )

    async def sync_all_members_to_new_period(
        self,
        org: Organization,
        new_period_start: datetime,
        new_period_end: datetime,
    ) -> int:
        """Sync all organization members to a new billing period.

        Called when org subscription renews. Resets all member spending
        counters and updates their billing period.

        Args:
            org: Organization
            new_period_start: Start of new billing period
            new_period_end: End of new billing period

        Returns:
            Number of members updated
        """
        from sqlalchemy import update  # noqa: PLC0415

        # Reset all members' billing period and spending
        result = await self.db.execute(
            update(OrganizationMember)
            .where(OrganizationMember.organization_id == org.id)
            .values(
                billing_period_start=new_period_start,
                billing_period_spending_cents=0,
            )
            .returning(OrganizationMember.id)
        )
        updated_ids = result.scalars().all()
        updated_count = len(updated_ids)

        # Unblock members who were blocked due to spending limit
        await self.db.execute(
            update(OrganizationMember)
            .where(OrganizationMember.organization_id == org.id)
            .where(OrganizationMember.is_blocked == True)
            .where(OrganizationMember.blocked_reason == "Billing period spending limit reached")
            .values(
                is_blocked=False,
                blocked_reason=None,
                blocked_at=None,
            )
        )

        await self.db.commit()

        logger.info(
            "Synced all members to new billing period",
            org_id=org.id,
            new_period_start=new_period_start.isoformat(),
            new_period_end=new_period_end.isoformat(),
            updated_count=updated_count,
        )

        return updated_count

    async def unblock_member(
        self,
        member: OrganizationMember,
        reason: str | None = None,
    ) -> None:
        """Manually unblock a member.

        Args:
            member: Organization member to unblock
            reason: Optional reason for unblocking (for audit)
        """
        member.is_blocked = False
        member.blocked_reason = None
        member.blocked_at = None

        await self.db.commit()

        logger.info(
            "Member unblocked",
            org_id=member.organization_id,
            user_id=member.user_id,
            reason=reason,
        )

    async def generate_usage_invoice(
        self,
        org: Organization,
        subscription: OrganizationSubscription,
    ) -> "OrganizationInvoice | None":
        """Generate an invoice for usage-based billing at billing period end.

        This is called for organizations with credit_model='usage_based' when
        their billing period ends. It aggregates all member spending and creates
        an invoice.

        Args:
            org: Organization
            subscription: Active org subscription with period info

        Returns:
            OrganizationInvoice if created, None if no charges
        """
        from sqlalchemy import func as sqlfunc  # noqa: PLC0415

        # Aggregate total spending for all members in this billing period
        spending_result = await self.db.execute(
            select(sqlfunc.sum(OrganizationMember.billing_period_spending_cents)).where(
                OrganizationMember.organization_id == org.id
            )
        )
        total_spending_cents = spending_result.scalar() or 0

        if total_spending_cents <= 0:
            logger.info(
                "No usage to invoice for organization",
                org_id=org.id,
            )
            return None

        # Generate invoice number
        invoice_number = await self._generate_invoice_number(org.id)

        # Create invoice record
        invoice = OrganizationInvoice(
            organization_id=org.id,
            invoice_number=invoice_number,
            period_start=subscription.current_period_start,
            period_end=subscription.current_period_end,
            subtotal_cents=total_spending_cents,
            total_cents=total_spending_cents,  # No tax for now
            status="pending",
            due_date=datetime.now(UTC),  # Due immediately
        )
        self.db.add(invoice)
        await self.db.flush()

        # Create Stripe invoice if org has a Stripe customer
        if org.stripe_customer_id:
            try:
                import stripe  # noqa: PLC0415

                from src.config import settings  # noqa: PLC0415

                if settings.STRIPE_SECRET_KEY:
                    stripe.api_key = settings.STRIPE_SECRET_KEY

                    # Create invoice item
                    period = subscription.current_period_start.strftime("%B %Y")
                    stripe.InvoiceItem.create(
                        customer=org.stripe_customer_id,
                        amount=total_spending_cents,
                        currency="usd",
                        description=f"Usage charges for {period}",
                    )

                    # Create and finalize invoice
                    stripe_invoice = stripe.Invoice.create(
                        customer=org.stripe_customer_id,
                        auto_advance=True,  # Automatically finalize and attempt payment
                        metadata={
                            "organization_id": str(org.id),
                            "invoice_id": str(invoice.id),
                            "type": "usage_based_billing",
                        },
                    )

                    invoice.stripe_invoice_id = stripe_invoice.id
                    invoice.status = "processing"

                    logger.info(
                        "Created Stripe invoice for org usage",
                        org_id=org.id,
                        invoice_id=invoice.id,
                        stripe_invoice_id=stripe_invoice.id,
                        amount_cents=total_spending_cents,
                    )

            except Exception as e:
                logger.exception(
                    "Failed to create Stripe invoice",
                    org_id=org.id,
                    error=str(e),
                )
                invoice.status = "failed"
                invoice.notes = f"Stripe invoice creation failed: {e!s}"

        await self.db.commit()
        await self.db.refresh(invoice)

        return invoice

    async def _generate_invoice_number(self, org_id: str) -> str:
        """Generate a unique invoice number for an organization."""
        from sqlalchemy import func as sqlfunc  # noqa: PLC0415

        # Count existing invoices for this org
        count_result = await self.db.execute(
            select(sqlfunc.count(OrganizationInvoice.id)).where(
                OrganizationInvoice.organization_id == org_id
            )
        )
        count = (count_result.scalar() or 0) + 1

        # Format: INV-YYYYMM-XXXX where XXXX is zero-padded count
        now = datetime.now(UTC)
        return f"INV-{now.strftime('%Y%m')}-{count:04d}"


async def process_org_billing_period_ends(db: AsyncSession) -> list[str]:
    """Process all organizations whose billing period has ended.

    This should be called periodically (e.g., hourly) from a background task.
    It finds orgs with usage_based credit model whose current_period_end has passed,
    generates invoices, and syncs member billing periods.

    Args:
        db: Database session

    Returns:
        List of processed organization IDs
    """
    now = datetime.now(UTC)

    # Find orgs with expired billing periods
    result = await db.execute(
        select(Organization, OrganizationSubscription)
        .join(
            OrganizationSubscription,
            OrganizationSubscription.organization_id == Organization.id,
        )
        .where(Organization.credit_model == "usage_based")
        .where(OrganizationSubscription.status.in_(["active", "trialing"]))
        .where(OrganizationSubscription.current_period_end <= now)
    )
    rows = result.all()

    processed_ids: list[str] = []
    org_limits = OrgLimitsService(db)

    for org, subscription in rows:
        try:
            # Generate invoice for the ending period
            invoice = await org_limits.generate_usage_invoice(org, subscription)

            if invoice:
                logger.info(
                    "Generated usage invoice for org",
                    org_id=org.id,
                    invoice_id=invoice.id,
                    total_cents=invoice.total_cents,
                )

            # Calculate new billing period (30 days from now)
            # Note: This is typically handled by Stripe webhook, but we do it here
            # as a fallback for orgs without Stripe subscriptions
            if not subscription.stripe_subscription_id:
                new_period_start = subscription.current_period_end
                new_period_end = new_period_start + timedelta(days=30)
                subscription.current_period_start = new_period_start
                subscription.current_period_end = new_period_end

                # Sync all members to new period
                await org_limits.sync_all_members_to_new_period(
                    org, new_period_start, new_period_end
                )

            processed_ids.append(str(org.id))

        except Exception as e:
            logger.exception(
                "Failed to process org billing period end",
                org_id=org.id,
                error=str(e),
            )

    await db.commit()

    logger.info(
        "Processed org billing period ends",
        processed_count=len(processed_ids),
    )

    return processed_ids
