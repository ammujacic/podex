"""Push notification subscription routes."""

from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.connection import get_db
from src.database.models import PushSubscription
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

logger = structlog.get_logger()

router = APIRouter()

# Type alias for database session dependency
DbSession = Annotated[AsyncSession, Depends(get_db)]


# ============================================================================
# Request/Response Models
# ============================================================================


class PushSubscriptionKeys(BaseModel):
    """Push subscription keys from browser."""

    p256dh: str
    auth: str


class PushSubscriptionPayload(BaseModel):
    """Push subscription payload from browser."""

    endpoint: str
    keys: PushSubscriptionKeys
    expiration_time: int | None = Field(default=None, alias="expirationTime")


class SubscribeRequest(BaseModel):
    """Subscribe to push notifications request."""

    subscription: PushSubscriptionPayload


class UnsubscribeRequest(BaseModel):
    """Unsubscribe from push notifications request."""

    endpoint: str


class PushSubscriptionResponse(BaseModel):
    """Push subscription response."""

    id: str
    endpoint: str
    is_active: bool
    created_at: str
    user_agent: str | None = None


# ============================================================================
# Routes
# ============================================================================


@router.post("/subscribe", response_model=PushSubscriptionResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def subscribe_to_push(
    request: Request,
    response: Response,  # noqa: ARG001
    payload: SubscribeRequest,
    db: DbSession,
) -> PushSubscriptionResponse:
    """Subscribe to push notifications."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    sub = payload.subscription
    user_agent = request.headers.get("User-Agent")

    # Check if subscription already exists (by endpoint)
    result = await db.execute(
        select(PushSubscription).where(PushSubscription.endpoint == sub.endpoint)
    )
    existing = result.scalar_one_or_none()

    if existing:
        # Update existing subscription
        existing.user_id = user_id
        existing.p256dh_key = sub.keys.p256dh
        existing.auth_key = sub.keys.auth
        existing.is_active = True
        existing.user_agent = user_agent
        subscription = existing
        logger.info(
            "Updated push subscription",
            user_id=user_id,
            subscription_id=existing.id,
        )
    else:
        # Create new subscription
        subscription = PushSubscription(
            user_id=user_id,
            endpoint=sub.endpoint,
            p256dh_key=sub.keys.p256dh,
            auth_key=sub.keys.auth,
            user_agent=user_agent,
        )
        db.add(subscription)
        logger.info(
            "Created push subscription",
            user_id=user_id,
        )

    await db.commit()
    await db.refresh(subscription)

    return PushSubscriptionResponse(
        id=subscription.id,
        endpoint=subscription.endpoint,
        is_active=subscription.is_active,
        created_at=subscription.created_at.isoformat(),
        user_agent=subscription.user_agent,
    )


@router.post("/unsubscribe")
@limiter.limit(RATE_LIMIT_STANDARD)
async def unsubscribe_from_push(
    request: Request,
    response: Response,  # noqa: ARG001
    payload: UnsubscribeRequest,
    db: DbSession,
) -> dict[str, str]:
    """Unsubscribe from push notifications."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Deactivate subscription (soft delete)
    result = await db.execute(
        update(PushSubscription)
        .where(
            PushSubscription.endpoint == payload.endpoint,
            PushSubscription.user_id == user_id,
        )
        .values(is_active=False)
    )
    await db.commit()

    if getattr(result, "rowcount", 0) == 0:
        logger.warning(
            "Push subscription not found for unsubscribe",
            user_id=user_id,
            endpoint=payload.endpoint[:50],
        )
        # Return success anyway - subscription might already be removed
        return {"status": "ok"}

    logger.info(
        "Unsubscribed from push notifications",
        user_id=user_id,
    )

    return {"status": "ok"}


@router.get("/subscriptions", response_model=list[PushSubscriptionResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_push_subscriptions(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> list[PushSubscriptionResponse]:
    """Get all active push subscriptions for the current user."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await db.execute(
        select(PushSubscription)
        .where(
            PushSubscription.user_id == user_id,
            PushSubscription.is_active == True,
        )
        .order_by(PushSubscription.created_at.desc())
    )
    subscriptions = result.scalars().all()

    return [
        PushSubscriptionResponse(
            id=sub.id,
            endpoint=sub.endpoint,
            is_active=sub.is_active,
            created_at=sub.created_at.isoformat(),
            user_agent=sub.user_agent,
        )
        for sub in subscriptions
    ]
