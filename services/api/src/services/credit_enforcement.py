"""Credit enforcement service for billing limits.

This module handles checking and enforcing credit limits for both tokens and compute:
- Token quota checks before agent message processing
- Compute quota checks before workspace operations
- Unified check that considers both plan quota and prepaid credits
"""

from dataclasses import dataclass
from typing import Any, Literal

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import (
    CreditBalance,
    SubscriptionPlan,
    UsageQuota,
    UserSubscription,
)

logger = structlog.get_logger()


# Error codes for frontend to show appropriate UI
class CreditErrorCode:
    QUOTA_EXCEEDED_NO_CREDITS = "QUOTA_EXCEEDED_NO_CREDITS"
    CREDITS_EXHAUSTED = "CREDITS_EXHAUSTED"
    SUBSCRIPTION_REQUIRED = "SUBSCRIPTION_REQUIRED"
    OVERAGE_NOT_ALLOWED = "OVERAGE_NOT_ALLOWED"


@dataclass
class CreditCheckResult:
    """Result of a credit availability check."""

    can_proceed: bool
    quota_remaining: int  # Remaining quota from plan (units)
    credits_remaining: int  # Prepaid credits balance (cents)
    overage_allowed: bool
    error_code: str | None = None
    error_message: str | None = None


async def _get_user_subscription_and_plan(
    db: AsyncSession,
    user_id: str,
) -> tuple[UserSubscription | None, SubscriptionPlan | None]:
    """Get user's active subscription and associated plan."""
    result = await db.execute(
        select(UserSubscription)
        .where(
            UserSubscription.user_id == user_id,
            UserSubscription.status.in_(["active", "trialing"]),
        )
        .order_by(UserSubscription.created_at.desc())
        .limit(1)
    )
    subscription = result.scalar_one_or_none()

    if not subscription:
        return None, None

    plan_result = await db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.id == subscription.plan_id)
    )
    plan = plan_result.scalar_one_or_none()

    return subscription, plan


async def _get_usage_quota(
    db: AsyncSession,
    user_id: str,
    quota_type: str,
) -> UsageQuota | None:
    """Get usage quota for a specific type."""
    result = await db.execute(
        select(UsageQuota).where(
            UsageQuota.user_id == user_id,
            UsageQuota.quota_type == quota_type,
        )
    )
    return result.scalar_one_or_none()


async def _get_credit_balance(
    db: AsyncSession,
    user_id: str,
) -> int:
    """Get user's prepaid credit balance in cents."""
    result = await db.execute(select(CreditBalance).where(CreditBalance.user_id == user_id))
    balance = result.scalar_one_or_none()
    return balance.balance_cents if balance else 0


async def check_credits_available(
    db: AsyncSession,
    user_id: str,
    resource_type: Literal["tokens", "compute"],
) -> CreditCheckResult:
    """Check if user can use resources (tokens or compute).

    Logic:
    1. Get user's subscription and plan
    2. If no active subscription, check if they have prepaid credits
    3. Get usage quota for the resource type
    4. If current_usage < limit_value: can_proceed (within plan quota)
    5. Else if overage_allowed AND prepaid credits > 0: can_proceed (using credits)
    6. Else: cannot proceed

    Args:
        db: Database session
        user_id: User ID
        resource_type: "tokens" or "compute"

    Returns:
        CreditCheckResult with can_proceed flag and details
    """
    # Get subscription and plan
    subscription, plan = await _get_user_subscription_and_plan(db, user_id)

    # Get prepaid credits
    credits_balance = await _get_credit_balance(db, user_id)

    # Map resource type to quota type
    quota_type = "tokens" if resource_type == "tokens" else "compute_hours"

    # Get usage quota
    quota = await _get_usage_quota(db, user_id, quota_type)

    # No subscription - check if they have credits
    if not subscription or not plan:
        # If user has prepaid credits, they can proceed (pay-as-you-go)
        if credits_balance > 0:
            return CreditCheckResult(
                can_proceed=True,
                quota_remaining=0,
                credits_remaining=credits_balance,
                overage_allowed=True,
            )

        return CreditCheckResult(
            can_proceed=False,
            quota_remaining=0,
            credits_remaining=0,
            overage_allowed=False,
            error_code=CreditErrorCode.SUBSCRIPTION_REQUIRED,
            error_message=("No active subscription. Please subscribe or add credits to continue."),
        )

    # No quota record - create one or allow (first-time user)
    if not quota:
        # User has subscription but no quota record yet - they should have allowance
        # This is normal for new users, quota gets created on first usage
        return CreditCheckResult(
            can_proceed=True,
            quota_remaining=(
                plan.tokens_included
                if resource_type == "tokens"
                else plan.compute_credits_cents_included
            ),
            credits_remaining=credits_balance,
            overage_allowed=plan.overage_allowed,
        )

    # Calculate remaining quota
    quota_remaining = max(0, quota.limit_value - quota.current_usage)

    # Within plan quota - can proceed
    if quota.current_usage < quota.limit_value:
        return CreditCheckResult(
            can_proceed=True,
            quota_remaining=quota_remaining,
            credits_remaining=credits_balance,
            overage_allowed=quota.overage_allowed,
        )

    # Quota exceeded - check if overage is allowed with credits
    if quota.overage_allowed or plan.overage_allowed:
        if credits_balance > 0:
            # Has credits for overage
            return CreditCheckResult(
                can_proceed=True,
                quota_remaining=0,
                credits_remaining=credits_balance,
                overage_allowed=True,
            )

        # Overage allowed but no credits
        return CreditCheckResult(
            can_proceed=False,
            quota_remaining=0,
            credits_remaining=0,
            overage_allowed=True,
            error_code=CreditErrorCode.QUOTA_EXCEEDED_NO_CREDITS,
            error_message=(
                f"Your {resource_type} quota has been exceeded and you have no "
                "additional credits. Please upgrade your plan or add credits."
            ),
        )

    # Overage not allowed
    return CreditCheckResult(
        can_proceed=False,
        quota_remaining=0,
        credits_remaining=credits_balance,
        overage_allowed=False,
        error_code=CreditErrorCode.OVERAGE_NOT_ALLOWED,
        error_message=(
            f"Your {resource_type} quota has been exceeded and your plan does not "
            "allow overage. Please upgrade your plan."
        ),
    )


async def get_users_with_exhausted_credits(
    db: AsyncSession,
    resource_type: Literal["tokens", "compute"],
) -> list[str]:
    """Get list of user IDs who are out of credits for a resource type.

    A user is considered "exhausted" if:
    1. Their quota current_usage >= limit_value
    2. AND they have no prepaid credits (balance_cents <= 0)
    3. AND overage is allowed (meaning they were using credits before)

    Args:
        db: Database session
        resource_type: "tokens" or "compute"

    Returns:
        List of user IDs with exhausted credits
    """
    quota_type = "tokens" if resource_type == "tokens" else "compute_hours"

    # Find users with exceeded quotas where overage was allowed
    # but who now have no credits
    result = await db.execute(
        select(UsageQuota.user_id)
        .outerjoin(CreditBalance, CreditBalance.user_id == UsageQuota.user_id)
        .where(
            UsageQuota.quota_type == quota_type,
            UsageQuota.current_usage >= UsageQuota.limit_value,
            UsageQuota.overage_allowed == True,
            # No credits or zero balance
            (CreditBalance.balance_cents == None) | (CreditBalance.balance_cents <= 0),
        )
    )

    return [row[0] for row in result.fetchall()]


def create_billing_error_detail(
    result: CreditCheckResult,
    resource_type: str,
    custom_message: str | None = None,
) -> dict[str, Any]:
    """Create a standardized error detail dict for 402 responses.

    Args:
        result: The credit check result
        resource_type: "tokens" or "compute"
        custom_message: Optional custom message to override default

    Returns:
        Dict suitable for HTTPException detail
    """
    return {
        "error_code": result.error_code,
        "message": custom_message or result.error_message,
        "quota_remaining": result.quota_remaining,
        "credits_remaining": result.credits_remaining,
        "resource_type": resource_type,
        "upgrade_url": "/settings/plans",
        "add_credits_url": "/settings/billing",
    }
