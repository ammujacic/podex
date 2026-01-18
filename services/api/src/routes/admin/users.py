"""Admin user management routes."""

from datetime import UTC, datetime
from typing import Annotated, Any, cast
from uuid import uuid4

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import (
    CreditBalance,
    CreditTransaction,
    Session,
    SubscriptionPlan,
    UsageQuota,
    User,
    UserSubscription,
)
from src.middleware.admin import get_admin_user_id, require_admin
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

logger = structlog.get_logger()

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db)]


# ==================== Pydantic Models ====================


class AdminUserResponse(BaseModel):
    """Admin user response with full details."""

    id: str
    email: str
    name: str | None
    avatar_url: str | None
    oauth_provider: str | None
    role: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    # Aggregated data
    session_count: int = 0
    subscription_status: str | None = None
    subscription_plan: str | None = None
    credit_balance_cents: int = 0

    # Sponsorship data
    is_sponsored: bool = False
    sponsored_by_name: str | None = None

    class Config:
        from_attributes = True


class UserListResponse(BaseModel):
    """Paginated user list response."""

    items: list[AdminUserResponse]
    total: int
    page: int
    page_size: int
    has_more: bool


class UpdateUserRequest(BaseModel):
    """Update user request for admins."""

    name: str | None = None
    role: str | None = None  # member, admin, super_admin
    is_active: bool | None = None


class BulkUpdateUsersRequest(BaseModel):
    """Bulk update users request."""

    user_ids: list[str]
    is_active: bool | None = None
    role: str | None = None


class BulkUpdateResponse(BaseModel):
    """Bulk operation response."""

    updated: int
    failed: int
    errors: list[str] = []


class SponsorSubscriptionRequest(BaseModel):
    """Request to sponsor a user's subscription."""

    plan_id: str
    reason: str | None = None


class SponsorSubscriptionResponse(BaseModel):
    """Response after sponsoring a subscription."""

    message: str
    subscription_id: str
    plan_name: str
    is_sponsored: bool


class AwardCreditsRequest(BaseModel):
    """Request to award credits to a user."""

    amount_cents: int = Field(ge=1, le=10000000)  # $0.01 to $100k
    reason: str = Field(min_length=1, max_length=500)
    expires_at: datetime | None = None


class AwardCreditsResponse(BaseModel):
    """Response after awarding credits."""

    transaction_id: str
    amount_cents: int
    new_balance_cents: int
    expires_at: datetime | None


class QuotaInfo(BaseModel):
    """Individual quota information."""

    quota_type: str
    current_usage: float
    limit_value: float
    usage_percent: float
    warning_sent: bool
    overage_allowed: bool


class UserUsageResponse(BaseModel):
    """User usage and quotas response."""

    user_id: str
    tokens_used: int = 0
    tokens_limit: int = 0
    compute_cents_used: int = 0
    compute_cents_limit: int = 0
    storage_gb_used: float = 0
    storage_gb_limit: float = 0
    quotas: list[QuotaInfo] = []
    credit_balance_cents: int = 0
    total_bonus_cents: int = 0


# ==================== Endpoints ====================


@router.get("", response_model=UserListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def list_users(
    request: Request,
    response: Response,
    db: DbSession,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
    search: Annotated[str | None, Query()] = None,
    role: Annotated[str | None, Query()] = None,
    is_active: Annotated[bool | None, Query()] = None,
) -> UserListResponse:
    """List all users with filtering and pagination."""
    query = select(User)
    count_query = select(func.count()).select_from(User)

    # Apply filters
    conditions = []

    if search:
        search_pattern = f"%{search}%"
        conditions.append(
            or_(
                User.email.ilike(search_pattern),
                User.name.ilike(search_pattern),
            )
        )

    if role:
        conditions.append(User.role == role)

    if is_active is not None:
        conditions.append(User.is_active == is_active)

    if conditions:
        for cond in conditions:
            query = query.where(cond)
            count_query = count_query.where(cond)

    # Get total count
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Apply pagination
    offset = (page - 1) * page_size
    query = query.order_by(User.created_at.desc()).offset(offset).limit(page_size)

    result = await db.execute(query)
    users = result.scalars().all()

    if not users:
        return UserListResponse(
            items=[],
            total=total,
            page=page,
            page_size=page_size,
            has_more=False,
        )

    # Get all user IDs for batch queries
    user_ids = [user.id for user in users]

    # Batch query: Get session counts for all users in one query
    session_counts_query = (
        select(Session.owner_id, func.count(Session.id).label("session_count"))
        .where(Session.owner_id.in_(user_ids))
        .group_by(Session.owner_id)
    )
    session_counts_result = await db.execute(session_counts_query)
    session_counts: dict[str, int] = {
        row.owner_id: int(row.session_count) for row in session_counts_result
    }

    # Batch query: Get active subscriptions for all users in one query
    subscriptions_query = (
        select(UserSubscription)
        .where(UserSubscription.user_id.in_(user_ids))
        .where(UserSubscription.status.in_(["active", "trialing"]))
    )
    subscriptions_result = await db.execute(subscriptions_query)
    subscriptions = {sub.user_id: sub for sub in subscriptions_result.scalars()}

    # Batch query: Get credit balances for all users in one query
    balances_query = select(CreditBalance).where(CreditBalance.user_id.in_(user_ids))
    balances_result = await db.execute(balances_query)
    balances = {bal.user_id: bal for bal in balances_result.scalars()}

    # Batch query: Get sponsor names for sponsored subscriptions
    sponsor_ids = [
        sub.sponsored_by_id
        for sub in subscriptions.values()
        if sub.is_sponsored and sub.sponsored_by_id
    ]
    sponsor_names: dict[str, str] = {}
    if sponsor_ids:
        sponsors_query = select(User.id, User.name, User.email).where(User.id.in_(sponsor_ids))
        sponsors_result = await db.execute(sponsors_query)
        sponsor_names = {row.id: row.name or row.email for row in sponsors_result}

    # Build response with aggregated data (no N+1 queries)
    items = []
    for user in users:
        session_count = session_counts.get(user.id, 0)
        subscription = subscriptions.get(user.id)
        credit_balance = balances.get(user.id)

        # Get sponsor name if subscription is sponsored
        sponsored_by_name = None
        if subscription and subscription.is_sponsored and subscription.sponsored_by_id:
            sponsored_by_name = sponsor_names.get(subscription.sponsored_by_id)

        items.append(
            AdminUserResponse(
                id=str(user.id),
                email=user.email,
                name=user.name,
                avatar_url=user.avatar_url,
                oauth_provider=user.oauth_provider,
                role=getattr(user, "role", "member"),
                is_active=user.is_active,
                created_at=user.created_at,
                updated_at=user.updated_at,
                session_count=session_count,
                subscription_status=subscription.status if subscription else None,
                subscription_plan=str(subscription.plan_id) if subscription else None,
                credit_balance_cents=credit_balance.balance_cents if credit_balance else 0,
                is_sponsored=subscription.is_sponsored if subscription else False,
                sponsored_by_name=sponsored_by_name,
            )
        )

    return UserListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        has_more=(offset + page_size) < total,
    )


@router.get("/{user_id}", response_model=AdminUserResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_user(
    user_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> AdminUserResponse:
    """Get detailed user information."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Aggregate data
    session_count_result = await db.execute(
        select(func.count()).select_from(Session).where(Session.owner_id == user.id)
    )
    session_count = session_count_result.scalar() or 0

    sub_result = await db.execute(
        select(UserSubscription)
        .where(UserSubscription.user_id == user.id)
        .where(UserSubscription.status.in_(["active", "trialing"]))
    )
    subscription = sub_result.scalar_one_or_none()

    balance_result = await db.execute(select(CreditBalance).where(CreditBalance.user_id == user.id))
    credit_balance = balance_result.scalar_one_or_none()

    # Get sponsor name if subscription is sponsored
    sponsored_by_name = None
    if subscription and subscription.is_sponsored and subscription.sponsored_by_id:
        sponsor_result = await db.execute(
            select(User.name, User.email).where(User.id == subscription.sponsored_by_id)
        )
        sponsor_row = sponsor_result.one_or_none()
        if sponsor_row:
            sponsored_by_name = sponsor_row.name or sponsor_row.email

    return AdminUserResponse(
        id=str(user.id),
        email=user.email,
        name=user.name,
        avatar_url=user.avatar_url,
        oauth_provider=user.oauth_provider,
        role=getattr(user, "role", "member"),
        is_active=user.is_active,
        created_at=user.created_at,
        updated_at=user.updated_at,
        session_count=session_count,
        subscription_status=subscription.status if subscription else None,
        subscription_plan=str(subscription.plan_id) if subscription else None,
        credit_balance_cents=credit_balance.balance_cents if credit_balance else 0,
        is_sponsored=subscription.is_sponsored if subscription else False,
        sponsored_by_name=sponsored_by_name,
    )


@router.patch("/{user_id}", response_model=AdminUserResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def update_user(
    user_id: str,
    request: Request,
    response: Response,
    data: UpdateUserRequest,
    db: DbSession,
) -> AdminUserResponse:
    """Update user details."""
    admin_id = get_admin_user_id(request)
    admin_role = getattr(request.state, "user_role", "member")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Role change requires super_admin or admin changing to non-admin roles
    if data.role is not None:
        if data.role == "super_admin" and admin_role != "super_admin":
            raise HTTPException(status_code=403, detail="Only super admins can create super admins")
        if data.role not in {"member", "admin", "super_admin"}:
            raise HTTPException(status_code=400, detail="Invalid role")
        user.role = data.role

    if data.name is not None:
        user.name = data.name

    if data.is_active is not None:
        user.is_active = data.is_active

    await db.commit()
    await db.refresh(user)

    logger.info(
        "Admin updated user",
        admin_id=admin_id,
        user_id=user_id,
        changes=data.model_dump(exclude_unset=True),
    )

    # Re-fetch user with updated data
    return cast("AdminUserResponse", await get_user(user_id, request, db))


@router.post("/{user_id}/activate")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def activate_user(
    user_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, str]:
    """Activate a deactivated user."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_active = True
    await db.commit()

    admin_id = get_admin_user_id(request)
    logger.info("Admin activated user", admin_id=admin_id, user_id=user_id)

    return {"message": "User activated"}


@router.post("/{user_id}/deactivate")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def deactivate_user(
    user_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, str]:
    """Deactivate a user (soft delete)."""
    admin_id = get_admin_user_id(request)

    # Prevent self-deactivation
    if user_id == admin_id:
        raise HTTPException(status_code=400, detail="Cannot deactivate yourself")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_active = False
    await db.commit()

    logger.info("Admin deactivated user", admin_id=admin_id, user_id=user_id)

    return {"message": "User deactivated"}


@router.post("/bulk/update", response_model=BulkUpdateResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def bulk_update_users(
    request: Request,
    response: Response,
    data: BulkUpdateUsersRequest,
    db: DbSession,
) -> BulkUpdateResponse:
    """Bulk update multiple users."""
    admin_id = get_admin_user_id(request)
    admin_role = getattr(request.state, "user_role", "member")

    if not data.user_ids:
        raise HTTPException(status_code=400, detail="No user IDs provided")

    if len(data.user_ids) > 100:
        raise HTTPException(status_code=400, detail="Maximum 100 users per bulk operation")

    # Prevent bulk role change to super_admin for non-super-admins
    if data.role == "super_admin" and admin_role != "super_admin":
        raise HTTPException(
            status_code=403, detail="Only super admins can bulk assign super admin role"
        )

    updated = 0
    failed = 0
    errors: list[str] = []

    # Prevent self-deactivation in bulk
    if data.is_active is False and admin_id in data.user_ids:
        data.user_ids = [uid for uid in data.user_ids if uid != admin_id]
        errors.append(f"Skipped self-deactivation for {admin_id}")

    update_values: dict[str, Any] = {}
    if data.is_active is not None:
        update_values["is_active"] = data.is_active
    if data.role is not None:
        update_values["role"] = data.role

    if update_values:
        try:
            await db.execute(update(User).where(User.id.in_(data.user_ids)).values(**update_values))
            updated = len(data.user_ids)
            await db.commit()
        except Exception as e:
            failed = len(data.user_ids)
            errors.append(str(e))
            await db.rollback()

    logger.info(
        "Admin bulk updated users",
        admin_id=admin_id,
        updated=updated,
        failed=failed,
    )

    return BulkUpdateResponse(updated=updated, failed=failed, errors=errors)


# ==================== Sponsorship Endpoints ====================


@router.post("/{user_id}/sponsor-subscription", response_model=SponsorSubscriptionResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def sponsor_subscription(
    user_id: str,
    request: Request,
    response: Response,
    data: SponsorSubscriptionRequest,
    db: DbSession,
) -> SponsorSubscriptionResponse:
    """Sponsor a user's subscription - gives them full plan access at $0."""
    admin_id = get_admin_user_id(request)

    # Verify user exists
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Verify plan exists
    plan_result = await db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.id == data.plan_id)
    )
    plan = plan_result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    # Check if user already has an active subscription
    existing_sub_result = await db.execute(
        select(UserSubscription)
        .where(UserSubscription.user_id == user_id)
        .where(UserSubscription.status.in_(["active", "trialing"]))
    )
    existing_sub = existing_sub_result.scalar_one_or_none()

    now = datetime.now(UTC)

    if existing_sub:
        # Update existing subscription to be sponsored
        existing_sub.plan_id = data.plan_id
        existing_sub.is_sponsored = True
        existing_sub.sponsored_by_id = admin_id
        existing_sub.sponsored_at = now
        existing_sub.sponsor_reason = data.reason
        existing_sub.status = "active"
        subscription = existing_sub
    else:
        # Create new sponsored subscription
        subscription = UserSubscription(
            id=str(uuid4()),
            user_id=user_id,
            plan_id=data.plan_id,
            status="active",
            billing_cycle="monthly",
            current_period_start=now,
            current_period_end=now.replace(year=now.year + 10),  # Long expiry for sponsored
            is_sponsored=True,
            sponsored_by_id=admin_id,
            sponsored_at=now,
            sponsor_reason=data.reason,
        )
        db.add(subscription)

    await db.commit()
    await db.refresh(subscription)

    logger.info(
        "Admin sponsored user subscription",
        admin_id=admin_id,
        user_id=user_id,
        plan_id=data.plan_id,
        reason=data.reason,
    )

    return SponsorSubscriptionResponse(
        message="Subscription sponsored successfully",
        subscription_id=str(subscription.id),
        plan_name=plan.name,
        is_sponsored=True,
    )


@router.delete("/{user_id}/sponsor-subscription")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def remove_sponsorship(
    user_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, str]:
    """Remove sponsorship from a user's subscription."""
    admin_id = get_admin_user_id(request)

    # Get sponsored subscription
    sub_result = await db.execute(
        select(UserSubscription)
        .where(UserSubscription.user_id == user_id)
        .where(UserSubscription.is_sponsored == True)
    )
    subscription = sub_result.scalar_one_or_none()

    if not subscription:
        raise HTTPException(status_code=404, detail="No sponsored subscription found")

    # Remove sponsorship (keep subscription but mark as not sponsored)
    subscription.is_sponsored = False
    subscription.sponsored_by_id = None
    subscription.sponsored_at = None
    subscription.sponsor_reason = None

    await db.commit()

    logger.info(
        "Admin removed sponsorship",
        admin_id=admin_id,
        user_id=user_id,
    )

    return {"message": "Sponsorship removed"}


# ==================== Usage & Credits Endpoints ====================


@router.get("/{user_id}/usage", response_model=UserUsageResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_user_usage(
    user_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> UserUsageResponse:
    """Get a user's usage and quota information."""
    # Verify user exists
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Get all quotas for user
    quotas_result = await db.execute(select(UsageQuota).where(UsageQuota.user_id == user_id))
    quotas = quotas_result.scalars().all()

    # Get credit balance
    balance_result = await db.execute(select(CreditBalance).where(CreditBalance.user_id == user_id))
    credit_balance = balance_result.scalar_one_or_none()

    # Build quota info list
    quota_infos = []
    tokens_used = 0
    tokens_limit = 0
    compute_cents_used = 0
    compute_cents_limit = 0
    storage_gb_used = 0.0
    storage_gb_limit = 0.0

    for quota in quotas:
        usage_percent = (
            (quota.current_usage / quota.limit_value * 100) if quota.limit_value > 0 else 0
        )
        quota_infos.append(
            QuotaInfo(
                quota_type=quota.quota_type,
                current_usage=float(quota.current_usage),
                limit_value=float(quota.limit_value),
                usage_percent=usage_percent,
                warning_sent=quota.warning_sent_at is not None,
                overage_allowed=quota.overage_allowed,
            )
        )

        # Aggregate by type
        if quota.quota_type == "tokens":
            tokens_used = int(quota.current_usage)
            tokens_limit = int(quota.limit_value)
        elif quota.quota_type == "compute_hours":
            compute_cents_used = int(quota.current_usage * 100)  # Convert to cents
            compute_cents_limit = int(quota.limit_value * 100)
        elif quota.quota_type == "storage_gb":
            storage_gb_used = float(quota.current_usage)
            storage_gb_limit = float(quota.limit_value)

    return UserUsageResponse(
        user_id=user_id,
        tokens_used=tokens_used,
        tokens_limit=tokens_limit,
        compute_cents_used=compute_cents_used,
        compute_cents_limit=compute_cents_limit,
        storage_gb_used=storage_gb_used,
        storage_gb_limit=storage_gb_limit,
        quotas=quota_infos,
        credit_balance_cents=credit_balance.balance_cents if credit_balance else 0,
        total_bonus_cents=credit_balance.total_bonus_cents if credit_balance else 0,
    )


@router.post("/{user_id}/credits", response_model=AwardCreditsResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def award_credits(
    user_id: str,
    request: Request,
    response: Response,
    data: AwardCreditsRequest,
    db: DbSession,
) -> AwardCreditsResponse:
    """Award bonus credits to a user."""
    admin_id = get_admin_user_id(request)

    # Verify user exists
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Get or create credit balance with locking to prevent race conditions
    balance_result = await db.execute(
        select(CreditBalance).where(CreditBalance.user_id == user_id).with_for_update()
    )
    credit_balance = balance_result.scalar_one_or_none()

    if not credit_balance:
        # Create new credit balance
        credit_balance = CreditBalance(
            id=str(uuid4()),
            user_id=user_id,
            balance_cents=0,
            total_bonus_cents=0,
        )
        db.add(credit_balance)
        await db.flush()

    # Update balance
    new_balance = credit_balance.balance_cents + data.amount_cents
    credit_balance.balance_cents = new_balance
    credit_balance.total_bonus_cents += data.amount_cents

    # Create transaction record
    transaction = CreditTransaction(
        id=str(uuid4()),
        user_id=user_id,
        amount_cents=data.amount_cents,
        currency="USD",
        transaction_type="bonus",
        description=f"Admin bonus: {data.reason}",
        awarded_by_id=admin_id,
        expires_at=data.expires_at,
        balance_after_cents=new_balance,
    )
    db.add(transaction)

    await db.commit()

    logger.info(
        "Admin awarded credits",
        admin_id=admin_id,
        user_id=user_id,
        amount_cents=data.amount_cents,
        reason=data.reason,
    )

    return AwardCreditsResponse(
        transaction_id=str(transaction.id),
        amount_cents=data.amount_cents,
        new_balance_cents=new_balance,
        expires_at=data.expires_at,
    )
