"""Admin platform invitations management routes."""

import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit_logger import AuditAction, AuditLogger
from src.config import settings
from src.database import get_db
from src.database.models import PlatformInvitation, PlatformSetting, SubscriptionPlan, User
from src.middleware.admin import get_admin_user_id, require_admin
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter
from src.services.email import EmailTemplate, get_email_service

logger = structlog.get_logger()

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db)]


# ==================== Pydantic Models ====================


class CreateInvitationRequest(BaseModel):
    """Create platform invitation request."""

    email: EmailStr
    message: str | None = Field(None, max_length=500)
    gift_plan_id: str | None = None
    gift_months: int | None = Field(None, ge=1, le=24)
    expires_in_days: int | None = Field(default=None, ge=1, le=30)


class InvitationResponse(BaseModel):
    """Platform invitation response."""

    id: str
    email: str
    status: str
    message: str | None
    gift_plan_id: str | None
    gift_plan_name: str | None
    gift_months: int | None
    expires_at: datetime
    invited_by_id: str | None
    invited_by_name: str | None
    invited_by_email: str | None
    accepted_at: datetime | None
    accepted_by_id: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InvitationListResponse(BaseModel):
    """Paginated list of invitations."""

    items: list[InvitationResponse]
    total: int
    page: int
    page_size: int
    has_more: bool


# ==================== Helper Functions ====================


def _generate_token() -> str:
    """Generate a secure 64-character token."""
    return secrets.token_urlsafe(48)[:64]


def _build_invitation_response(invitation: PlatformInvitation) -> InvitationResponse:
    """Build invitation response from model."""
    return InvitationResponse(
        id=invitation.id,
        email=invitation.email,
        status=invitation.status,
        message=invitation.message,
        gift_plan_id=invitation.gift_plan_id,
        gift_plan_name=invitation.gift_plan.name if invitation.gift_plan else None,
        gift_months=invitation.gift_months,
        expires_at=invitation.expires_at,
        invited_by_id=invitation.invited_by_id,
        invited_by_name=invitation.invited_by.name if invitation.invited_by else None,
        invited_by_email=invitation.invited_by.email if invitation.invited_by else None,
        accepted_at=invitation.accepted_at,
        accepted_by_id=invitation.accepted_by_id,
        created_at=invitation.created_at,
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
        "name": invitation.email.split("@")[0],  # Use email prefix as name
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


@router.post("", response_model=InvitationResponse, status_code=201)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def create_invitation(
    request: Request,
    response: Response,
    data: CreateInvitationRequest,
    db: DbSession,
) -> InvitationResponse:
    """Create and send a platform invitation."""
    admin_id = get_admin_user_id(request)

    # Check if user already exists
    existing_user = await db.execute(select(User).where(User.email == data.email))
    if existing_user.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="A user with this email already exists",
        )

    # Check for pending invitation to same email
    pending_result = await db.execute(
        select(PlatformInvitation)
        .where(PlatformInvitation.email == data.email)
        .where(PlatformInvitation.status == "pending")
        .where(PlatformInvitation.expires_at > datetime.now(UTC))
    )
    existing_pending = pending_result.scalar_one_or_none()
    if existing_pending:
        raise HTTPException(
            status_code=400,
            detail="A pending invitation already exists for this email. Use resend to send again.",
        )

    # Validate gift plan if provided
    gift_plan = None
    if data.gift_plan_id:
        plan_result = await db.execute(
            select(SubscriptionPlan)
            .where(SubscriptionPlan.id == data.gift_plan_id)
            .where(SubscriptionPlan.is_active == True)
        )
        gift_plan = plan_result.scalar_one_or_none()
        if not gift_plan:
            raise HTTPException(
                status_code=400,
                detail="Invalid or inactive subscription plan",
            )

    # Get admin user for email
    admin_result = await db.execute(select(User).where(User.id == admin_id))
    admin_user = admin_result.scalar_one_or_none()

    # Get expiration days from request or platform settings
    expires_in_days = data.expires_in_days
    if expires_in_days is None:
        invitation_settings_result = await db.execute(
            select(PlatformSetting).where(PlatformSetting.key == "invitation_defaults")
        )
        invitation_settings = invitation_settings_result.scalar_one_or_none()
        if invitation_settings and isinstance(invitation_settings.value, dict):
            expires_in_days = invitation_settings.value.get("platform_expiration_days", 7)
        else:
            expires_in_days = 7  # Fallback default

    # Create invitation
    invitation = PlatformInvitation(
        email=data.email,
        token=_generate_token(),
        invited_by_id=admin_id,
        status="pending",
        message=data.message,
        gift_plan_id=data.gift_plan_id if gift_plan else None,
        gift_months=data.gift_months if gift_plan and data.gift_months else None,
        expires_at=datetime.now(UTC) + timedelta(days=expires_in_days),
    )

    db.add(invitation)
    await db.flush()

    # Reload with relationships
    await db.refresh(invitation, ["invited_by", "gift_plan"])

    # Send invitation email
    await _send_invitation_email(invitation, admin_user)

    # Audit log
    audit = AuditLogger(db).set_context(request=request, user_id=admin_id)
    await audit.log_admin_action(
        AuditAction.ADMIN_SETTINGS_CHANGED,
        resource_type="platform_invitation",
        resource_id=invitation.id,
        details={
            "action": "created",
            "email": data.email,
            "gift_plan": gift_plan.name if gift_plan else None,
            "gift_months": data.gift_months,
        },
    )

    await db.commit()

    logger.info(
        "Platform invitation created",
        invitation_id=invitation.id,
        email=data.email,
        admin_id=admin_id,
    )

    return _build_invitation_response(invitation)


@router.get("", response_model=InvitationListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def list_invitations(
    request: Request,
    response: Response,
    db: DbSession,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
    status: Annotated[str | None, Query()] = None,
    search: Annotated[str | None, Query()] = None,
) -> InvitationListResponse:
    """List all platform invitations with filtering and pagination."""
    query = select(PlatformInvitation).order_by(PlatformInvitation.created_at.desc())

    # Filter by status
    if status:
        query = query.where(PlatformInvitation.status == status)

    # Search by email
    if search:
        query = query.where(PlatformInvitation.email.ilike(f"%{search}%"))

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Paginate
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    result = await db.execute(query)
    invitations = result.scalars().all()

    return InvitationListResponse(
        items=[_build_invitation_response(inv) for inv in invitations],
        total=total,
        page=page,
        page_size=page_size,
        has_more=offset + len(invitations) < total,
    )


@router.get("/{invitation_id}", response_model=InvitationResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_invitation(
    request: Request,
    response: Response,
    invitation_id: str,
    db: DbSession,
) -> InvitationResponse:
    """Get invitation details by ID."""
    result = await db.execute(
        select(PlatformInvitation).where(PlatformInvitation.id == invitation_id)
    )
    invitation = result.scalar_one_or_none()

    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")

    return _build_invitation_response(invitation)


@router.post("/{invitation_id}/resend", response_model=dict)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def resend_invitation(
    request: Request,
    response: Response,
    invitation_id: str,
    db: DbSession,
    extend_days: Annotated[int, Query(ge=1, le=30)] = 7,
) -> dict[str, str]:
    """Resend invitation email and extend expiry."""
    admin_id = get_admin_user_id(request)

    result = await db.execute(
        select(PlatformInvitation).where(PlatformInvitation.id == invitation_id)
    )
    invitation = result.scalar_one_or_none()

    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")

    if invitation.status != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot resend invitation with status '{invitation.status}'",
        )

    # Extend expiry
    invitation.expires_at = datetime.now(UTC) + timedelta(days=extend_days)

    # Get admin user for email
    admin_result = await db.execute(select(User).where(User.id == admin_id))
    admin_user = admin_result.scalar_one_or_none()

    # Resend email
    await _send_invitation_email(invitation, admin_user)

    # Audit log
    audit = AuditLogger(db).set_context(request=request, user_id=admin_id)
    await audit.log_admin_action(
        AuditAction.ADMIN_SETTINGS_CHANGED,
        resource_type="platform_invitation",
        resource_id=invitation.id,
        details={"action": "resent", "email": invitation.email},
    )

    await db.commit()

    logger.info(
        "Platform invitation resent",
        invitation_id=invitation_id,
        email=invitation.email,
    )

    return {"message": "Invitation resent successfully"}


@router.post("/{invitation_id}/revoke", response_model=dict)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def revoke_invitation(
    request: Request,
    response: Response,
    invitation_id: str,
    db: DbSession,
) -> dict[str, str]:
    """Revoke a pending invitation."""
    admin_id = get_admin_user_id(request)

    result = await db.execute(
        select(PlatformInvitation).where(PlatformInvitation.id == invitation_id)
    )
    invitation = result.scalar_one_or_none()

    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")

    if invitation.status != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot revoke invitation with status '{invitation.status}'",
        )

    invitation.status = "revoked"

    # Audit log
    audit = AuditLogger(db).set_context(request=request, user_id=admin_id)
    await audit.log_admin_action(
        AuditAction.ADMIN_SETTINGS_CHANGED,
        resource_type="platform_invitation",
        resource_id=invitation.id,
        details={"action": "revoked", "email": invitation.email},
    )

    await db.commit()

    logger.info(
        "Platform invitation revoked",
        invitation_id=invitation_id,
        email=invitation.email,
    )

    return {"message": "Invitation revoked successfully"}


@router.delete("/{invitation_id}", response_model=dict)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def delete_invitation(
    request: Request,
    response: Response,
    invitation_id: str,
    db: DbSession,
) -> dict[str, str]:
    """Delete an invitation (admin cleanup)."""
    admin_id = get_admin_user_id(request)

    result = await db.execute(
        select(PlatformInvitation).where(PlatformInvitation.id == invitation_id)
    )
    invitation = result.scalar_one_or_none()

    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")

    email = invitation.email

    await db.delete(invitation)

    # Audit log
    audit = AuditLogger(db).set_context(request=request, user_id=admin_id)
    await audit.log_admin_action(
        AuditAction.ADMIN_SETTINGS_CHANGED,
        resource_type="platform_invitation",
        resource_id=invitation_id,
        details={"action": "deleted", "email": email},
    )

    await db.commit()

    logger.info(
        "Platform invitation deleted",
        invitation_id=invitation_id,
        email=email,
    )

    return {"message": "Invitation deleted successfully"}
