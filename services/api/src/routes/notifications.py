"""Notifications routes."""

from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.connection import get_db
from src.database.models import Notification
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

logger = structlog.get_logger()

router = APIRouter()

# Type alias for database session dependency
DbSession = Annotated[AsyncSession, Depends(get_db)]


# ============================================================================
# Response Models
# ============================================================================


class NotificationResponse(BaseModel):
    """Notification response."""

    id: str
    type: str  # info, warning, error, success
    title: str
    message: str
    action_url: str | None = None
    action_label: str | None = None
    read: bool
    created_at: str


class NotificationsListResponse(BaseModel):
    """Notifications list response."""

    items: list[NotificationResponse]
    unread_count: int


# ============================================================================
# Routes
# ============================================================================


@router.get("", response_model=NotificationsListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_notifications(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> NotificationsListResponse:
    """Get all notifications for the current user."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Get all notifications for user, ordered by created_at descending
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
        .limit(50)
    )
    notifications = result.scalars().all()

    # Count unread
    unread_count = sum(1 for n in notifications if not n.read)

    return NotificationsListResponse(
        items=[
            NotificationResponse(
                id=n.id,
                type=n.type,
                title=n.title,
                message=n.message,
                action_url=n.action_url,
                action_label=n.action_label,
                read=n.read,
                created_at=n.created_at.isoformat(),
            )
            for n in notifications
        ],
        unread_count=unread_count,
    )


@router.post("/{notification_id}/read")
@limiter.limit(RATE_LIMIT_STANDARD)
async def mark_notification_read(
    notification_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, str]:
    """Mark a notification as read."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Update the notification
    result = await db.execute(
        update(Notification)
        .where(
            Notification.id == notification_id,
            Notification.user_id == user_id,
        )
        .values(read=True)
    )
    await db.commit()

    if getattr(result, "rowcount", 0) == 0:
        raise HTTPException(status_code=404, detail="Notification not found")

    return {"status": "ok"}


@router.post("/read-all")
@limiter.limit(RATE_LIMIT_STANDARD)
async def mark_all_notifications_read(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, str]:
    """Mark all notifications as read for the current user."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    await db.execute(update(Notification).where(Notification.user_id == user_id).values(read=True))
    await db.commit()

    return {"status": "ok"}


@router.delete("/{notification_id}")
@limiter.limit(RATE_LIMIT_STANDARD)
async def delete_notification(
    notification_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, str]:
    """Delete a notification."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await db.execute(
        delete(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == user_id,
        )
    )
    await db.commit()

    if getattr(result, "rowcount", 0) == 0:
        raise HTTPException(status_code=404, detail="Notification not found")

    return {"status": "ok"}
