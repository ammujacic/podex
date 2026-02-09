"""Admin waitlist management routes.

Allows admins to view waitlist entries and send invitations to waitlisted users.
"""

import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit_logger import AuditAction, AuditLogger
from src.config import settings
from src.database import get_db
from src.database.models import PlatformInvitation, SubscriptionPlan, User, WaitlistEntry
from src.middleware.admin import get_admin_user_id, require_admin
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter
from src.services.email import EmailTemplate, get_email_service

logger = structlog.get_logger()

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db)]


# ==================== Pydantic Models ====================


class WaitlistEntryResponse(BaseModel):
    """Waitlist entry response."""

    id: str
    email: str
    status: str
    source: str
    referral_code: str | None
    position: int | None
    created_at: datetime
    invited_at: datetime | None
    invitation_id: str | None

    model_config = ConfigDict(from_attributes=True)


class WaitlistListResponse(BaseModel):
    """Paginated list of waitlist entries."""

    items: list[WaitlistEntryResponse]
    total: int
    page: int
    page_size: int
    has_more: bool
    stats: dict[str, int]


class SendInviteRequest(BaseModel):
    """Request to send invitation to waitlist entry."""

    message: str | None = Field(None, max_length=500, description="Optional personal message")
    gift_plan_id: str | None = Field(None, description="Optional subscription plan to gift")
    gift_months: int | None = Field(None, ge=1, le=24, description="Months of subscription to gift")
    expires_in_days: int = Field(
        default=7, ge=1, le=30, description="Days until invitation expires"
    )


class SendInviteResponse(BaseModel):
    """Response after sending invitation."""

    success: bool
    message: str
    invitation_id: str
    waitlist_entry: WaitlistEntryResponse


# ==================== Helper Functions ====================


def _generate_token() -> str:
    """Generate a secure 64-character token."""
    return secrets.token_urlsafe(48)[:64]


def _build_entry_response(entry: WaitlistEntry) -> WaitlistEntryResponse:
    """Build waitlist entry response from model."""
    return WaitlistEntryResponse(
        id=entry.id,
        email=entry.email,
        status=entry.status,
        source=entry.source,
        referral_code=entry.referral_code,
        position=entry.position,
        created_at=entry.created_at,
        invited_at=entry.invited_at,
        invitation_id=entry.invitation_id,
    )


async def _send_invitation_email(
    invitation: PlatformInvitation,
    inviter: User | None,
) -> None:
    """Send invitation email to the recipient."""
    email_service = get_email_service()

    # Build invitation URL
    invite_url = f"{settings.FRONTEND_URL}/register?invitation={invitation.token}"

    context = {
        "name": invitation.email.split("@")[0],
        "inviter_name": inviter.name if inviter else "The Podex team",
        "invite_url": invite_url,
        "message": invitation.message,
        "gift_plan_name": invitation.gift_plan.name if invitation.gift_plan else None,
        "gift_months": invitation.gift_months,
        "expires_days": (invitation.expires_at - datetime.now(UTC)).days,
    }

    result = await email_service.send_email(
        to_email=invitation.email,
        template=EmailTemplate.PLATFORM_INVITE,
        context=context,
    )

    if not result.success:
        logger.warning(
            "Failed to send invitation email",
            email=invitation.email,
            error=result.error,
        )


# ==================== Endpoints ====================


@router.get("", response_model=WaitlistListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def list_waitlist(
    request: Request,
    response: Response,
    db: DbSession,
    page: Annotated[int, Query(ge=1, description="Page number")] = 1,
    page_size: Annotated[int, Query(ge=1, le=100, description="Items per page")] = 50,
    status_filter: Annotated[
        str | None, Query(alias="status", description="Filter by status")
    ] = None,
    search: Annotated[str | None, Query(description="Search by email")] = None,
    source: Annotated[str | None, Query(description="Filter by source")] = None,
) -> WaitlistListResponse:
    """List all waitlist entries with pagination and filtering."""
    # Build base query
    query = select(WaitlistEntry)

    # Apply filters
    if status_filter:
        query = query.where(WaitlistEntry.status == status_filter)
    if search:
        query = query.where(WaitlistEntry.email.ilike(f"%{search}%"))
    if source:
        query = query.where(WaitlistEntry.source == source)

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Apply pagination and ordering
    query = query.order_by(WaitlistEntry.created_at.asc())
    query = query.offset((page - 1) * page_size).limit(page_size)

    # Execute query
    result = await db.execute(query)
    entries = result.scalars().all()

    # Get stats
    stats_result = await db.execute(
        select(
            func.count(WaitlistEntry.id).label("total"),
            func.count(WaitlistEntry.id).filter(WaitlistEntry.status == "waiting").label("waiting"),
            func.count(WaitlistEntry.id).filter(WaitlistEntry.status == "invited").label("invited"),
            func.count(WaitlistEntry.id)
            .filter(WaitlistEntry.status == "registered")
            .label("registered"),
        )
    )
    stats_row = stats_result.one()

    return WaitlistListResponse(
        items=[_build_entry_response(e) for e in entries],
        total=total,
        page=page,
        page_size=page_size,
        has_more=(page * page_size) < total,
        stats={
            "total": stats_row.total,
            "waiting": stats_row.waiting,
            "invited": stats_row.invited,
            "registered": stats_row.registered,
        },
    )


@router.get("/{entry_id}", response_model=WaitlistEntryResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_waitlist_entry(
    entry_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> WaitlistEntryResponse:
    """Get a specific waitlist entry by ID."""
    result = await db.execute(select(WaitlistEntry).where(WaitlistEntry.id == entry_id))
    entry = result.scalar_one_or_none()

    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Waitlist entry not found",
        )

    return _build_entry_response(entry)


@router.post("/{entry_id}/invite", response_model=SendInviteResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def send_invitation(
    entry_id: str,
    data: SendInviteRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> SendInviteResponse:
    """Send a platform invitation to a waitlist entry."""
    admin_id = get_admin_user_id(request)

    # Get waitlist entry
    result = await db.execute(select(WaitlistEntry).where(WaitlistEntry.id == entry_id))
    entry = result.scalar_one_or_none()

    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Waitlist entry not found",
        )

    if entry.status == "invited":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User has already been invited",
        )

    if entry.status == "registered":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User has already registered",
        )

    # Check if user already exists
    existing_user = await db.execute(select(User).where(User.email == entry.email))
    if existing_user.scalar_one_or_none():
        # Update waitlist entry status
        entry.status = "registered"
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User already has an account",
        )

    # Get gift plan if specified
    gift_plan = None
    if data.gift_plan_id:
        plan_result = await db.execute(
            select(SubscriptionPlan).where(SubscriptionPlan.id == data.gift_plan_id)
        )
        gift_plan = plan_result.scalar_one_or_none()
        if not gift_plan:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Gift plan not found",
            )

    # Get admin user for email
    admin_result = await db.execute(select(User).where(User.id == admin_id))
    admin = admin_result.scalar_one_or_none()

    # Create invitation
    invitation = PlatformInvitation(
        email=entry.email,
        token=_generate_token(),
        invited_by_id=admin_id,
        status="pending",
        message=data.message,
        gift_plan_id=data.gift_plan_id,
        gift_months=data.gift_months if data.gift_plan_id else None,
        expires_at=datetime.now(UTC) + timedelta(days=data.expires_in_days),
    )
    db.add(invitation)

    # Update waitlist entry
    entry.status = "invited"
    entry.invited_at = datetime.now(UTC)
    entry.invitation_id = invitation.id

    # Log audit
    audit = AuditLogger(db).set_context(request=request, user_id=admin_id)
    await audit.log_admin_action(
        AuditAction.ADMIN_SETTINGS_CHANGED,
        resource_type="waitlist_entry",
        resource_id=entry.id,
        details={
            "action": "invited",
            "email": entry.email,
            "invitation_id": invitation.id,
            "gift_plan": gift_plan.name if gift_plan else None,
        },
    )

    await db.commit()
    await db.refresh(entry)
    await db.refresh(invitation)

    # Send invitation email
    await _send_invitation_email(invitation, admin)

    logger.info(
        "Waitlist user invited",
        waitlist_entry_id=entry.id,
        email=entry.email,
        invitation_id=invitation.id,
        admin_id=admin_id,
    )

    return SendInviteResponse(
        success=True,
        message=f"Invitation sent to {entry.email}",
        invitation_id=invitation.id,
        waitlist_entry=_build_entry_response(entry),
    )


@router.delete("/{entry_id}", status_code=status.HTTP_200_OK)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def delete_waitlist_entry(
    entry_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, str]:
    """Delete a waitlist entry."""
    admin_id = get_admin_user_id(request)

    result = await db.execute(select(WaitlistEntry).where(WaitlistEntry.id == entry_id))
    entry = result.scalar_one_or_none()

    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Waitlist entry not found",
        )

    email = entry.email

    # Log audit before deletion
    audit = AuditLogger(db).set_context(request=request, user_id=admin_id)
    await audit.log_admin_action(
        AuditAction.ADMIN_SETTINGS_CHANGED,
        resource_type="waitlist_entry",
        resource_id=entry.id,
        details={
            "action": "deleted",
            "email": email,
        },
    )

    await db.delete(entry)
    await db.commit()

    logger.info(
        "Waitlist entry deleted",
        waitlist_entry_id=entry_id,
        email=email,
        admin_id=admin_id,
    )

    return {"message": f"Waitlist entry for {email} deleted"}


@router.post("/bulk-invite", status_code=status.HTTP_200_OK)
@limiter.limit("5/minute")
@require_admin
async def bulk_invite(
    request: Request,
    response: Response,
    db: DbSession,
    count: Annotated[int, Query(ge=1, le=50, description="Number of users to invite")] = 10,
    message: Annotated[
        str | None, Query(description="Optional message for all invitations")
    ] = None,
    gift_plan_id: Annotated[str | None, Query(description="Optional gift plan")] = None,
    gift_months: Annotated[int | None, Query(ge=1, le=24, description="Gift months")] = None,
) -> dict[str, str | int]:
    """Bulk invite the next N users on the waitlist."""
    admin_id = get_admin_user_id(request)

    # Get waiting entries ordered by position/created_at
    result = await db.execute(
        select(WaitlistEntry)
        .where(WaitlistEntry.status == "waiting")
        .order_by(WaitlistEntry.position.asc().nullslast(), WaitlistEntry.created_at.asc())
        .limit(count)
    )
    entries = result.scalars().all()

    if not entries:
        return {"message": "No waiting entries found", "invited": 0}

    # Get gift plan if specified
    gift_plan = None
    if gift_plan_id:
        plan_result = await db.execute(
            select(SubscriptionPlan).where(SubscriptionPlan.id == gift_plan_id)
        )
        gift_plan = plan_result.scalar_one_or_none()

    # Get admin user
    admin_result = await db.execute(select(User).where(User.id == admin_id))
    admin = admin_result.scalar_one_or_none()

    invited_count = 0
    skipped_count = 0

    for entry in entries:
        # Check if user already exists
        existing_user = await db.execute(select(User).where(User.email == entry.email))
        if existing_user.scalar_one_or_none():
            entry.status = "registered"
            skipped_count += 1
            continue

        # Create invitation
        invitation = PlatformInvitation(
            email=entry.email,
            token=_generate_token(),
            invited_by_id=admin_id,
            status="pending",
            message=message,
            gift_plan_id=gift_plan_id,
            gift_months=gift_months if gift_plan_id else None,
            expires_at=datetime.now(UTC) + timedelta(days=7),
        )
        db.add(invitation)

        # Update entry
        entry.status = "invited"
        entry.invited_at = datetime.now(UTC)
        entry.invitation_id = invitation.id

        # Send email (don't await to speed up bulk operation)
        await _send_invitation_email(invitation, admin)

        invited_count += 1

    # Log audit
    audit = AuditLogger(db).set_context(request=request, user_id=admin_id)
    await audit.log_admin_action(
        AuditAction.ADMIN_SETTINGS_CHANGED,
        resource_type="waitlist",
        resource_id="bulk",
        details={
            "action": "bulk_invite",
            "invited_count": invited_count,
            "skipped_count": skipped_count,
            "gift_plan": gift_plan.name if gift_plan else None,
        },
    )

    await db.commit()

    logger.info(
        "Bulk waitlist invite completed",
        invited_count=invited_count,
        skipped_count=skipped_count,
        admin_id=admin_id,
    )

    return {
        "message": f"Invited {invited_count} users from the waitlist",
        "invited": invited_count,
        "skipped": skipped_count,
    }
