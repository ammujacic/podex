"""Google integration API routes for status and management."""

from __future__ import annotations

from typing import Any

import structlog
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import GoogleIntegration
from src.dependencies import get_current_user
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

router = APIRouter(prefix="/google", tags=["google"])

logger = structlog.get_logger()


class GoogleConnectionStatus(BaseModel):
    """Google connection status."""

    connected: bool
    email: str | None = None
    name: str | None = None
    avatar_url: str | None = None


@router.get("/status", response_model=GoogleConnectionStatus)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_connection_status(
    _request: Request,
    _response: Response,
    db: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> GoogleConnectionStatus:
    """Get Google connection status."""
    query = select(GoogleIntegration).where(GoogleIntegration.user_id == user["id"])
    result = await db.execute(query)
    integration = result.scalar_one_or_none()

    if not integration or not integration.is_active:
        return GoogleConnectionStatus(connected=False)

    return GoogleConnectionStatus(
        connected=True,
        email=integration.google_email,
        name=integration.google_name,
        avatar_url=integration.google_avatar_url,
    )


@router.delete("/disconnect")
@limiter.limit(RATE_LIMIT_STANDARD)
async def disconnect_google(
    _request: Request,
    _response: Response,
    db: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, bool]:
    """Disconnect Google integration."""
    query = select(GoogleIntegration).where(GoogleIntegration.user_id == user["id"])
    result = await db.execute(query)
    integration = result.scalar_one_or_none()

    if integration:
        await db.delete(integration)
        await db.commit()
        logger.info(
            "Google integration disconnected",
            user_id=user["id"],
            google_email=integration.google_email,
        )

    return {"success": True}
