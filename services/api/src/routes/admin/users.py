"""Admin user management routes."""

from datetime import datetime
from typing import Annotated, Any, cast

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import (
    CreditBalance,
    Session,
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

    # Build response with aggregated data
    items = []
    for user in users:
        # Get session count
        session_count_result = await db.execute(
            select(func.count()).select_from(Session).where(Session.owner_id == user.id)
        )
        session_count = session_count_result.scalar() or 0

        # Get subscription info
        sub_result = await db.execute(
            select(UserSubscription)
            .where(UserSubscription.user_id == user.id)
            .where(UserSubscription.status.in_(["active", "trialing"]))
        )
        subscription = sub_result.scalar_one_or_none()

        # Get credit balance
        balance_result = await db.execute(
            select(CreditBalance).where(CreditBalance.user_id == user.id)
        )
        credit_balance = balance_result.scalar_one_or_none()

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
