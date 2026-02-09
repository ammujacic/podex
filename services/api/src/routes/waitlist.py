"""Public API routes for waitlist signup.

These routes handle the coming soon page waitlist functionality.
"""

from __future__ import annotations

from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import WaitlistEntry
from src.middleware.rate_limit import limiter
from src.services.email import EmailService, EmailTemplate

logger = structlog.get_logger()

router = APIRouter(prefix="/waitlist", tags=["waitlist"])


# ============================================================================
# Request/Response Models
# ============================================================================


class WaitlistJoinRequest(BaseModel):
    """Request to join the waitlist."""

    email: EmailStr = Field(..., description="Email address to add to waitlist")
    source: str = Field(default="coming_soon", description="Source of signup")
    referral_code: str | None = Field(default=None, description="Optional referral code")


class WaitlistJoinResponse(BaseModel):
    """Response after joining the waitlist."""

    success: bool
    message: str
    position: int | None = None
    already_registered: bool = False

    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# Routes
# ============================================================================


# Stricter rate limit for waitlist signup (10 per minute per IP)
WAITLIST_RATE_LIMIT = "10/minute"


@router.post("", response_model=WaitlistJoinResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit(WAITLIST_RATE_LIMIT)
async def join_waitlist(
    data: WaitlistJoinRequest,
    request: Request,  # noqa: ARG001
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> WaitlistJoinResponse:
    """Join the waitlist for early access.

    This is a public endpoint that allows anyone to sign up for the waitlist.
    A confirmation email is sent upon successful signup.
    """
    email_lower = data.email.lower()

    # Check if email already exists in waitlist
    result = await db.execute(select(WaitlistEntry).where(WaitlistEntry.email == email_lower))
    existing = result.scalar_one_or_none()

    if existing:
        # Return success but indicate they're already registered
        response.status_code = status.HTTP_200_OK
        return WaitlistJoinResponse(
            success=True,
            message="You're already on the waitlist! We'll notify you when it's your turn.",
            position=existing.position,
            already_registered=True,
        )

    # Get current count to calculate position
    count_result = await db.execute(select(func.count(WaitlistEntry.id)))
    current_count = count_result.scalar() or 0
    position = current_count + 1

    # Create new waitlist entry
    entry = WaitlistEntry(
        email=email_lower,
        source=data.source,
        referral_code=data.referral_code,
        position=position,
        status="waiting",
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)

    logger.info(
        "Waitlist signup",
        email=email_lower,
        position=position,
        source=data.source,
    )

    # Send confirmation email
    try:
        email_service = EmailService()
        await email_service.send_email(
            to_email=email_lower,
            template=EmailTemplate.WAITLIST_CONFIRMATION,
            context={
                "name": email_lower.split("@")[0],
                "position": position,
            },
        )
    except Exception as e:
        # Don't fail the signup if email fails
        logger.warning(
            "Failed to send waitlist confirmation email", email=email_lower, error=str(e)
        )

    return WaitlistJoinResponse(
        success=True,
        message="You're on the list! Check your email for confirmation.",
        position=position,
        already_registered=False,
    )


@router.get("/position/{email}")
@limiter.limit("20/minute")
async def check_position(
    email: str,
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, str | int | None]:
    """Check waitlist position for an email.

    Returns position if found, otherwise indicates not on waitlist.
    """
    email_lower = email.lower()

    result = await db.execute(select(WaitlistEntry).where(WaitlistEntry.email == email_lower))
    entry = result.scalar_one_or_none()

    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Email not found on waitlist",
        )

    return {
        "email": email_lower,
        "position": entry.position,
        "status": entry.status,
        "joined_at": entry.created_at.isoformat() if entry.created_at else None,
    }
