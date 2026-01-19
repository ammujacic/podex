"""Admin audit log routes."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import AuditLog
from src.dependencies import get_admin_user

router = APIRouter()


# ============================================================================
# Response Models
# ============================================================================


class AuditLogResponse(BaseModel):
    """Audit log entry response."""

    id: str
    user_id: str | None
    user_email: str | None
    session_id: str | None
    action: str
    category: str
    resource_type: str | None
    resource_id: str | None
    status: str
    details: dict[str, Any] | None
    changes: dict[str, Any] | None
    ip_address: str | None
    user_agent: str | None
    request_id: str | None
    request_path: str | None
    request_method: str | None
    created_at: datetime

    class Config:
        from_attributes = True


class AuditLogListResponse(BaseModel):
    """Paginated audit log list."""

    logs: list[AuditLogResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class AuditStatsResponse(BaseModel):
    """Audit log statistics."""

    total_logs: int
    by_category: dict[str, int]
    by_action: dict[str, int]
    by_status: dict[str, int]
    recent_failures: int
    unique_users: int
    date_range: dict[str, str | None]


# ============================================================================
# Routes
# ============================================================================


@router.get("", response_model=AuditLogListResponse)
async def list_audit_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    category: str | None = Query(None),
    action: str | None = Query(None),
    user_id: str | None = Query(None),
    session_id: str | None = Query(None),
    status: str | None = Query(None),
    resource_type: str | None = Query(None),
    start_date: datetime | None = Query(None),
    end_date: datetime | None = Query(None),
    search: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    admin: dict = Depends(get_admin_user),
) -> AuditLogListResponse:
    """List audit logs with filtering and pagination."""
    # Build query
    conditions = []

    if category:
        conditions.append(AuditLog.category == category)
    if action:
        conditions.append(AuditLog.action == action)
    if user_id:
        conditions.append(AuditLog.user_id == user_id)
    if session_id:
        conditions.append(AuditLog.session_id == session_id)
    if status:
        conditions.append(AuditLog.status == status)
    if resource_type:
        conditions.append(AuditLog.resource_type == resource_type)
    if start_date:
        conditions.append(AuditLog.created_at >= start_date)
    if end_date:
        conditions.append(AuditLog.created_at <= end_date)
    if search:
        search_pattern = f"%{search}%"
        conditions.append(
            (AuditLog.action.ilike(search_pattern))
            | (AuditLog.user_email.ilike(search_pattern))
            | (AuditLog.resource_id.ilike(search_pattern))
            | (AuditLog.ip_address.ilike(search_pattern))
        )

    # Get total count
    count_query = select(func.count(AuditLog.id))
    if conditions:
        count_query = count_query.where(*conditions)
    total = (await db.execute(count_query)).scalar() or 0

    # Get paginated results
    query = select(AuditLog).order_by(AuditLog.created_at.desc())
    if conditions:
        query = query.where(*conditions)
    query = query.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(query)
    logs = result.scalars().all()

    return AuditLogListResponse(
        logs=[AuditLogResponse.model_validate(log) for log in logs],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size if total > 0 else 1,
    )


@router.get("/stats", response_model=AuditStatsResponse)
async def get_audit_stats(
    start_date: datetime | None = Query(None),
    end_date: datetime | None = Query(None),
    db: AsyncSession = Depends(get_db),
    admin: dict = Depends(get_admin_user),
) -> AuditStatsResponse:
    """Get audit log statistics."""
    conditions = []
    if start_date:
        conditions.append(AuditLog.created_at >= start_date)
    if end_date:
        conditions.append(AuditLog.created_at <= end_date)

    # Total logs
    total_query = select(func.count(AuditLog.id))
    if conditions:
        total_query = total_query.where(*conditions)
    total_logs = (await db.execute(total_query)).scalar() or 0

    # Group by category
    category_query = select(AuditLog.category, func.count(AuditLog.id)).group_by(AuditLog.category)
    if conditions:
        category_query = category_query.where(*conditions)
    category_result = await db.execute(category_query)
    by_category = {row[0]: row[1] for row in category_result.all()}

    # Group by action (top 10)
    action_query = (
        select(AuditLog.action, func.count(AuditLog.id))
        .group_by(AuditLog.action)
        .order_by(func.count(AuditLog.id).desc())
        .limit(10)
    )
    if conditions:
        action_query = action_query.where(*conditions)
    action_result = await db.execute(action_query)
    by_action = {row[0]: row[1] for row in action_result.all()}

    # Group by status
    status_query = select(AuditLog.status, func.count(AuditLog.id)).group_by(AuditLog.status)
    if conditions:
        status_query = status_query.where(*conditions)
    status_result = await db.execute(status_query)
    by_status = {row[0]: row[1] for row in status_result.all()}

    # Recent failures (last 24 hours)
    from datetime import timedelta, UTC

    recent_cutoff = datetime.now(UTC) - timedelta(hours=24)
    failure_query = select(func.count(AuditLog.id)).where(
        AuditLog.status == "failure",
        AuditLog.created_at >= recent_cutoff,
    )
    recent_failures = (await db.execute(failure_query)).scalar() or 0

    # Unique users
    users_query = select(func.count(func.distinct(AuditLog.user_id)))
    if conditions:
        users_query = users_query.where(*conditions)
    unique_users = (await db.execute(users_query)).scalar() or 0

    # Date range
    oldest_query = select(func.min(AuditLog.created_at))
    newest_query = select(func.max(AuditLog.created_at))
    if conditions:
        oldest_query = oldest_query.where(*conditions)
        newest_query = newest_query.where(*conditions)

    oldest = (await db.execute(oldest_query)).scalar()
    newest = (await db.execute(newest_query)).scalar()

    return AuditStatsResponse(
        total_logs=total_logs,
        by_category=by_category,
        by_action=by_action,
        by_status=by_status,
        recent_failures=recent_failures,
        unique_users=unique_users,
        date_range={
            "oldest": oldest.isoformat() if oldest else None,
            "newest": newest.isoformat() if newest else None,
        },
    )


@router.get("/{log_id}", response_model=AuditLogResponse)
async def get_audit_log(
    log_id: str,
    db: AsyncSession = Depends(get_db),
    admin: dict = Depends(get_admin_user),
) -> AuditLogResponse:
    """Get a specific audit log entry."""
    from fastapi import HTTPException, status

    query = select(AuditLog).where(AuditLog.id == log_id)
    result = await db.execute(query)
    log = result.scalar_one_or_none()

    if not log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audit log entry not found",
        )

    return AuditLogResponse.model_validate(log)


@router.get("/user/{user_id}", response_model=AuditLogListResponse)
async def list_user_audit_logs(
    user_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    admin: dict = Depends(get_admin_user),
) -> AuditLogListResponse:
    """List audit logs for a specific user."""
    # Get total count
    count_query = select(func.count(AuditLog.id)).where(AuditLog.user_id == user_id)
    total = (await db.execute(count_query)).scalar() or 0

    # Get paginated results
    query = (
        select(AuditLog)
        .where(AuditLog.user_id == user_id)
        .order_by(AuditLog.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    result = await db.execute(query)
    logs = result.scalars().all()

    return AuditLogListResponse(
        logs=[AuditLogResponse.model_validate(log) for log in logs],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size if total > 0 else 1,
    )


@router.get("/categories", response_model=list[str])
async def list_categories(
    db: AsyncSession = Depends(get_db),
    admin: dict = Depends(get_admin_user),
) -> list[str]:
    """List all unique audit log categories."""
    query = select(func.distinct(AuditLog.category)).order_by(AuditLog.category)
    result = await db.execute(query)
    return [row[0] for row in result.all() if row[0]]


@router.get("/actions", response_model=list[str])
async def list_actions(
    category: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    admin: dict = Depends(get_admin_user),
) -> list[str]:
    """List all unique audit log actions, optionally filtered by category."""
    query = select(func.distinct(AuditLog.action)).order_by(AuditLog.action)
    if category:
        query = query.where(AuditLog.category == category)
    result = await db.execute(query)
    return [row[0] for row in result.all() if row[0]]
