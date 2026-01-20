"""Organization management routes.

This module provides endpoints for:
- Organization CRUD operations
- Member management (invite, remove, update limits)
- Invite links management
- Organization billing and usage
- Joining organizations (via invitation, link, or domain)
"""

import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.config import settings
from src.database.connection import get_db
from src.database.models import (
    Organization,
    OrganizationInvitation,
    OrganizationInviteLink,
    OrganizationMember,
    OrganizationSubscription,
    OrganizationUsageRecord,
    User,
)
from src.middleware.organization import (
    OrgContext,
    get_user_org_context,
    is_business_email,
    require_org_admin,
    require_org_member,
    require_org_owner,
    require_org_permission,
    validate_invite_email,
)
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter
from src.services.email import EmailTemplate, get_email_service
from src.services.org_limits import OrgLimitsService

logger = structlog.get_logger()

router = APIRouter()

# Type alias for database session dependency
DbSession = Annotated[AsyncSession, Depends(get_db)]


# ============================================================================
# Request/Response Models
# ============================================================================


class CreateOrganizationRequest(BaseModel):
    """Request to create a new organization."""

    name: str = Field(..., min_length=1, max_length=255)
    slug: str | None = Field(None, pattern=r"^[a-z0-9-]+$", min_length=1, max_length=100)
    credit_model: str = Field(default="pooled", pattern=r"^(pooled|allocated|usage_based)$")
    logo_url: str | None = None
    website: str | None = Field(None, max_length=500)


class UpdateOrganizationRequest(BaseModel):
    """Request to update organization settings."""

    name: str | None = Field(None, min_length=1, max_length=255)
    logo_url: str | None = None
    website: str | None = Field(None, max_length=500)
    credit_model: str | None = Field(None, pattern=r"^(pooled|allocated|usage_based)$")
    auto_join_enabled: bool | None = None
    auto_join_domains: list[str] | None = None
    auto_join_default_role: str | None = Field(None, pattern=r"^(admin|member)$")
    default_spending_limit_cents: int | None = Field(None, ge=0)
    default_allowed_models: list[str] | None = None
    default_allowed_instance_types: list[str] | None = None
    default_storage_limit_gb: int | None = Field(None, ge=0)
    default_feature_access: dict[str, bool] | None = None


class OrganizationResponse(BaseModel):
    """Organization response."""

    id: str
    name: str
    slug: str
    credit_model: str
    credit_pool_cents: int
    auto_join_enabled: bool
    auto_join_domains: list[str] | None
    is_active: bool
    logo_url: str | None
    website: str | None
    onboarding_completed: bool
    member_count: int | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class MemberResponse(BaseModel):
    """Organization member response."""

    id: str
    user_id: str
    email: str
    name: str | None
    avatar_url: str | None
    role: str
    spending_limit_cents: int | None
    current_spending_cents: int
    allocated_credits_cents: int
    used_credits_cents: int
    is_blocked: bool
    blocked_reason: str | None
    joined_at: datetime

    class Config:
        from_attributes = True


class InviteMemberRequest(BaseModel):
    """Request to invite a member via email."""

    email: EmailStr
    role: str = Field(default="member", pattern=r"^(admin|member)$")
    message: str | None = Field(None, max_length=500)
    spending_limit_cents: int | None = Field(None, ge=0)
    allocated_credits_cents: int | None = Field(None, ge=0)
    allowed_models: list[str] | None = None
    allowed_instance_types: list[str] | None = None


class UpdateMemberRequest(BaseModel):
    """Request to update a member's settings."""

    role: str | None = Field(None, pattern=r"^(admin|member)$")  # Can't set to owner
    spending_limit_cents: int | None = Field(None, ge=0)
    allocated_credits_cents: int | None = Field(None, ge=0)
    allowed_models: list[str] | None = None
    allowed_instance_types: list[str] | None = None
    storage_limit_gb: int | None = Field(None, ge=0)
    feature_access: dict[str, bool] | None = None


class InvitationResponse(BaseModel):
    """Invitation response."""

    id: str
    email: str
    role: str
    status: str
    invited_by_email: str | None
    message: str | None
    expires_at: datetime
    created_at: datetime

    class Config:
        from_attributes = True


class CreateInviteLinkRequest(BaseModel):
    """Request to create an invite link."""

    name: str | None = Field(None, max_length=255)
    role: str = Field(default="member", pattern=r"^(admin|member)$")
    max_uses: int | None = Field(None, ge=1)
    expires_in_days: int | None = Field(None, ge=1, le=365)
    spending_limit_cents: int | None = Field(None, ge=0)
    allocated_credits_cents: int | None = Field(None, ge=0)


class InviteLinkResponse(BaseModel):
    """Invite link response."""

    id: str
    code: str
    url: str
    name: str | None
    role: str
    max_uses: int | None
    current_uses: int
    is_active: bool
    expires_at: datetime | None
    created_at: datetime

    class Config:
        from_attributes = True


class JoinOrganizationResponse(BaseModel):
    """Response after joining an organization."""

    organization: OrganizationResponse
    role: str
    message: str


class UserOrgContextResponse(BaseModel):
    """Current user's organization context."""

    organization: OrganizationResponse
    role: str
    is_blocked: bool
    limits: dict[str, Any]


class UsageSummaryResponse(BaseModel):
    """Organization usage summary."""

    total_spending_cents: int
    member_count: int
    credit_pool_cents: int
    credit_model: str
    period_start: datetime | None
    period_end: datetime | None
    top_users: list[dict[str, Any]]
    by_type: dict[str, int]


class AllocateCreditsRequest(BaseModel):
    """Request to allocate credits to a member."""

    amount_cents: int = Field(...)
    description: str | None = Field(None, max_length=500)

    @field_validator("amount_cents")
    @classmethod
    def validate_amount(cls, v: int) -> int:
        """Validate that amount is not zero."""
        if v == 0:

            class ZeroAmountError(ValueError):
                def __init__(self) -> None:
                    super().__init__("Amount cannot be zero")

            raise ZeroAmountError
        return v


# ============================================================================
# Helper Functions
# ============================================================================


def generate_slug(name: str) -> str:
    """Generate a URL-safe slug from organization name."""
    # Convert to lowercase and replace spaces/special chars with hyphens
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower())
    # Remove leading/trailing hyphens
    slug = slug.strip("-")
    # Add random suffix to ensure uniqueness
    suffix = secrets.token_hex(4)
    return f"{slug}-{suffix}"


def generate_invite_token() -> str:
    """Generate a secure invitation token."""
    return secrets.token_urlsafe(32)


def generate_invite_code() -> str:
    """Generate a short invite link code."""
    return secrets.token_urlsafe(16)


# ============================================================================
# Organization CRUD
# ============================================================================


@router.post("/", response_model=OrganizationResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def create_organization(
    request: Request,
    response: Response,  # noqa: ARG001
    data: CreateOrganizationRequest,
    db: DbSession,
) -> OrganizationResponse:
    """Create a new organization.

    The creating user becomes the organization owner.
    Their personal billing is suspended upon org creation.
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    # Check user is not already in an organization
    existing_membership = await db.execute(
        select(OrganizationMember).where(OrganizationMember.user_id == user_id)
    )
    if existing_membership.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="You are already a member of an organization. "
            "Leave your current organization first.",
        )

    # Generate slug if not provided
    slug = data.slug or generate_slug(data.name)

    # Check slug is unique
    existing_slug = await db.execute(select(Organization).where(Organization.slug == slug))
    if existing_slug.scalar_one_or_none():
        slug = generate_slug(data.name)  # Regenerate with random suffix

    # Create organization
    org = Organization(
        name=data.name,
        slug=slug,
        credit_model=data.credit_model,
        logo_url=data.logo_url,
        website=data.website,
        onboarding_step="details",
    )
    db.add(org)
    await db.flush()  # Get org.id

    # Create owner membership
    member = OrganizationMember(
        organization_id=org.id,
        user_id=user_id,
        role="owner",
        billing_period_start=datetime.now(UTC),
    )
    db.add(member)

    # Suspend user's personal billing
    user = await db.get(User, user_id)
    if user:
        user.personal_billing_suspended = True
        user.personal_billing_suspended_at = datetime.now(UTC)
        user.account_type = "organization"

    await db.commit()
    await db.refresh(org)

    logger.info("Organization created", org_id=org.id, owner_id=user_id)

    return OrganizationResponse(
        id=org.id,
        name=org.name,
        slug=org.slug,
        credit_model=org.credit_model,
        credit_pool_cents=org.credit_pool_cents,
        auto_join_enabled=org.auto_join_enabled,
        auto_join_domains=org.auto_join_domains,
        is_active=org.is_active,
        logo_url=org.logo_url,
        website=org.website,
        onboarding_completed=org.onboarding_completed,
        member_count=1,
        created_at=org.created_at,
        updated_at=org.updated_at,
    )


@router.get("/", response_model=OrganizationResponse | None)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_my_organization(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> OrganizationResponse | None:
    """Get the current user's organization (if any)."""
    ctx = await get_user_org_context(request, db)
    if ctx is None:
        return None

    # Get member count
    member_count_result = await db.execute(
        select(func.count(OrganizationMember.id)).where(
            OrganizationMember.organization_id == ctx.org_id
        )
    )
    member_count = member_count_result.scalar() or 0

    org = ctx.organization
    return OrganizationResponse(
        id=org.id,
        name=org.name,
        slug=org.slug,
        credit_model=org.credit_model,
        credit_pool_cents=org.credit_pool_cents,
        auto_join_enabled=org.auto_join_enabled,
        auto_join_domains=org.auto_join_domains,
        is_active=org.is_active,
        logo_url=org.logo_url,
        website=org.website,
        onboarding_completed=org.onboarding_completed,
        member_count=member_count,
        created_at=org.created_at,
        updated_at=org.updated_at,
    )


# ============================================================================
# User Context (must be before /{org_id} routes for proper route matching)
# ============================================================================


@router.get("/me", response_model=UserOrgContextResponse | None)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_my_org_context(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> UserOrgContextResponse | None:
    """Get current user's organization context and limits."""
    ctx = await get_user_org_context(request, db)
    if ctx is None:
        return None

    # Get limit status
    limits_service = OrgLimitsService(db)
    limit_status = await limits_service.get_limit_status(ctx.member, ctx.organization)

    org = ctx.organization
    return UserOrgContextResponse(
        organization=OrganizationResponse(
            id=org.id,
            name=org.name,
            slug=org.slug,
            credit_model=org.credit_model,
            credit_pool_cents=org.credit_pool_cents,
            auto_join_enabled=org.auto_join_enabled,
            auto_join_domains=org.auto_join_domains,
            is_active=org.is_active,
            logo_url=org.logo_url,
            website=org.website,
            onboarding_completed=org.onboarding_completed,
            created_at=org.created_at,
            updated_at=org.updated_at,
        ),
        role=ctx.role,
        is_blocked=ctx.member.is_blocked,
        limits={
            "spending_limit_cents": limit_status.spending_limit_cents,
            "current_spending_cents": limit_status.current_spending_cents,
            "remaining_spending_cents": limit_status.remaining_spending_cents,
            "allocated_credits_cents": limit_status.allocated_credits_cents,
            "used_credits_cents": limit_status.used_credits_cents,
            "remaining_allocated_cents": limit_status.remaining_allocated_cents,
            "allowed_models": limit_status.allowed_models,
            "allowed_instance_types": limit_status.allowed_instance_types,
            "storage_limit_gb": limit_status.storage_limit_gb,
            "is_at_limit": limit_status.is_at_limit,
        },
    )


@router.get("/me/limits", response_model=dict[str, Any])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_my_limits(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, Any]:
    """Get current user's resource limits and usage."""
    ctx = await get_user_org_context(request, db)
    if ctx is None:
        raise HTTPException(
            status_code=400,
            detail="You are not a member of an organization",
        )

    limits_service = OrgLimitsService(db)
    status = await limits_service.get_limit_status(ctx.member, ctx.organization)

    return {
        "credit_model": status.credit_model,
        "spending": {
            "limit_cents": status.spending_limit_cents,
            "current_cents": status.current_spending_cents,
            "remaining_cents": status.remaining_spending_cents,
        },
        "allocated": {
            "total_cents": status.allocated_credits_cents,
            "used_cents": status.used_credits_cents,
            "remaining_cents": status.remaining_allocated_cents,
        },
        "billing_period": {
            "spending_cents": status.billing_period_spending_cents,
        },
        "resources": {
            "allowed_models": status.allowed_models,
            "allowed_instance_types": status.allowed_instance_types,
            "storage_limit_gb": status.storage_limit_gb,
            "feature_access": status.feature_access,
        },
        "status": {
            "is_blocked": status.is_blocked,
            "blocked_reason": status.blocked_reason,
            "is_at_limit": status.is_at_limit,
        },
    }


@router.delete("/me")
@limiter.limit(RATE_LIMIT_STANDARD)
async def leave_organization(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, str]:
    """Leave the current organization.

    Owners cannot leave - they must delete the org or transfer ownership.
    """
    ctx = await get_user_org_context(request, db)
    if ctx is None:
        raise HTTPException(
            status_code=400,
            detail="You are not a member of an organization",
        )

    if ctx.role == "owner":
        raise HTTPException(
            status_code=400,
            detail="Organization owners cannot leave. "
            "Transfer ownership or delete the organization.",
        )

    # Reactivate personal billing
    user = await db.get(User, ctx.user_id)
    if user:
        user.personal_billing_suspended = False
        user.personal_billing_suspended_at = None
        user.account_type = "personal"

    await db.delete(ctx.member)
    await db.commit()

    logger.info(
        "User left organization",
        org_id=ctx.org_id,
        user_id=ctx.user_id,
    )

    return {"message": "You have left the organization"}


# ============================================================================
# Organization by ID (/{org_id} routes - must come after /me routes)
# ============================================================================


@router.get("/{org_id}", response_model=OrganizationResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_org_member
async def get_organization(
    request: Request,
    response: Response,  # noqa: ARG001
    org_id: str,
    db: DbSession,
) -> OrganizationResponse:
    """Get organization details."""
    ctx: OrgContext = request.state.org_context

    # Get member count
    member_count_result = await db.execute(
        select(func.count(OrganizationMember.id)).where(
            OrganizationMember.organization_id == org_id
        )
    )
    member_count = member_count_result.scalar() or 0

    org = ctx.organization
    return OrganizationResponse(
        id=org.id,
        name=org.name,
        slug=org.slug,
        credit_model=org.credit_model,
        credit_pool_cents=org.credit_pool_cents,
        auto_join_enabled=org.auto_join_enabled,
        auto_join_domains=org.auto_join_domains,
        is_active=org.is_active,
        logo_url=org.logo_url,
        website=org.website,
        onboarding_completed=org.onboarding_completed,
        member_count=member_count,
        created_at=org.created_at,
        updated_at=org.updated_at,
    )


@router.patch("/{org_id}", response_model=OrganizationResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_org_admin
async def update_organization(
    request: Request,
    response: Response,  # noqa: ARG001
    org_id: str,
    data: UpdateOrganizationRequest,
    db: DbSession,
) -> OrganizationResponse:
    """Update organization settings."""
    ctx: OrgContext = request.state.org_context
    org = ctx.organization

    # Update fields if provided
    if data.name is not None:
        org.name = data.name
    if data.logo_url is not None:
        org.logo_url = data.logo_url
    if data.website is not None:
        org.website = data.website
    if data.credit_model is not None:
        org.credit_model = data.credit_model
    if data.auto_join_enabled is not None:
        org.auto_join_enabled = data.auto_join_enabled
    if data.auto_join_domains is not None:
        org.auto_join_domains = data.auto_join_domains
    if data.auto_join_default_role is not None:
        org.auto_join_default_role = data.auto_join_default_role
    if data.default_spending_limit_cents is not None:
        org.default_spending_limit_cents = data.default_spending_limit_cents
    if data.default_allowed_models is not None:
        org.default_allowed_models = data.default_allowed_models
    if data.default_allowed_instance_types is not None:
        org.default_allowed_instance_types = data.default_allowed_instance_types
    if data.default_storage_limit_gb is not None:
        org.default_storage_limit_gb = data.default_storage_limit_gb
    if data.default_feature_access is not None:
        org.default_feature_access = data.default_feature_access

    await db.commit()
    await db.refresh(org)

    logger.info("Organization updated", org_id=org.id, updated_by=ctx.user_id)

    # Get member count
    member_count_result = await db.execute(
        select(func.count(OrganizationMember.id)).where(
            OrganizationMember.organization_id == org_id
        )
    )
    member_count = member_count_result.scalar() or 0

    return OrganizationResponse(
        id=org.id,
        name=org.name,
        slug=org.slug,
        credit_model=org.credit_model,
        credit_pool_cents=org.credit_pool_cents,
        auto_join_enabled=org.auto_join_enabled,
        auto_join_domains=org.auto_join_domains,
        is_active=org.is_active,
        logo_url=org.logo_url,
        website=org.website,
        onboarding_completed=org.onboarding_completed,
        member_count=member_count,
        created_at=org.created_at,
        updated_at=org.updated_at,
    )


@router.delete("/{org_id}")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_org_owner
async def delete_organization(
    request: Request,
    response: Response,  # noqa: ARG001
    org_id: str,
    db: DbSession,
) -> dict[str, str]:
    """Delete an organization.

    Only the owner can delete. All members will be removed and
    their personal billing reactivated.
    """
    ctx: OrgContext = request.state.org_context
    org = ctx.organization

    # Get all members to reactivate their personal billing
    members_result = await db.execute(
        select(OrganizationMember)
        .options(selectinload(OrganizationMember.user))
        .where(OrganizationMember.organization_id == org_id)
    )
    members = members_result.scalars().all()

    for member in members:
        if member.user:
            member.user.personal_billing_suspended = False
            member.user.personal_billing_suspended_at = None
            member.user.account_type = "personal"

    # Delete organization (cascade deletes members, invitations, etc.)
    await db.delete(org)
    await db.commit()

    logger.info("Organization deleted", org_id=org_id, deleted_by=ctx.user_id)

    return {"message": "Organization deleted successfully"}


# ============================================================================
# Member Management
# ============================================================================


@router.get("/{org_id}/members", response_model=list[MemberResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
@require_org_member
async def list_members(
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
    org_id: str,
    db: DbSession,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[MemberResponse]:
    """List organization members."""
    result = await db.execute(
        select(OrganizationMember)
        .options(selectinload(OrganizationMember.user))
        .where(OrganizationMember.organization_id == org_id)
        .order_by(OrganizationMember.joined_at.desc())
        .limit(limit)
        .offset(offset)
    )
    members = result.scalars().all()

    return [
        MemberResponse(
            id=m.id,
            user_id=m.user_id,
            email=m.user.email if m.user else "",
            name=m.user.name if m.user else None,
            avatar_url=m.user.avatar_url if m.user else None,
            role=m.role,
            spending_limit_cents=m.spending_limit_cents,
            current_spending_cents=m.current_spending_cents,
            allocated_credits_cents=m.allocated_credits_cents,
            used_credits_cents=m.used_credits_cents,
            is_blocked=m.is_blocked,
            blocked_reason=m.blocked_reason,
            joined_at=m.joined_at,
        )
        for m in members
    ]


@router.get("/{org_id}/members/{user_id}", response_model=MemberResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_org_member
async def get_member(
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
    org_id: str,
    user_id: str,
    db: DbSession,
) -> MemberResponse:
    """Get a specific member's details."""
    result = await db.execute(
        select(OrganizationMember)
        .options(selectinload(OrganizationMember.user))
        .where(OrganizationMember.organization_id == org_id)
        .where(OrganizationMember.user_id == user_id)
    )
    member = result.scalar_one_or_none()

    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    return MemberResponse(
        id=member.id,
        user_id=member.user_id,
        email=member.user.email if member.user else "",
        name=member.user.name if member.user else None,
        avatar_url=member.user.avatar_url if member.user else None,
        role=member.role,
        spending_limit_cents=member.spending_limit_cents,
        current_spending_cents=member.current_spending_cents,
        allocated_credits_cents=member.allocated_credits_cents,
        used_credits_cents=member.used_credits_cents,
        is_blocked=member.is_blocked,
        blocked_reason=member.blocked_reason,
        joined_at=member.joined_at,
    )


@router.patch("/{org_id}/members/{user_id}", response_model=MemberResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_org_admin
async def update_member(
    request: Request,
    response: Response,  # noqa: ARG001
    org_id: str,
    user_id: str,
    data: UpdateMemberRequest,
    db: DbSession,
) -> MemberResponse:
    """Update a member's settings (role, limits)."""
    ctx: OrgContext = request.state.org_context

    result = await db.execute(
        select(OrganizationMember)
        .options(selectinload(OrganizationMember.user))
        .where(OrganizationMember.organization_id == org_id)
        .where(OrganizationMember.user_id == user_id)
    )
    member = result.scalar_one_or_none()

    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    # Can't modify owner
    if member.role == "owner":
        raise HTTPException(status_code=400, detail="Cannot modify organization owner")

    # Only owner can change roles
    if data.role is not None and ctx.role != "owner":
        raise HTTPException(status_code=403, detail="Only owner can change member roles")

    # Update fields
    if data.role is not None:
        member.role = data.role
    if data.spending_limit_cents is not None:
        member.spending_limit_cents = data.spending_limit_cents
    if data.allocated_credits_cents is not None:
        member.allocated_credits_cents = data.allocated_credits_cents
    if data.allowed_models is not None:
        member.allowed_models = data.allowed_models
    if data.allowed_instance_types is not None:
        member.allowed_instance_types = data.allowed_instance_types
    if data.storage_limit_gb is not None:
        member.storage_limit_gb = data.storage_limit_gb
    if data.feature_access is not None:
        member.feature_access = data.feature_access

    await db.commit()
    await db.refresh(member)

    logger.info(
        "Member updated",
        org_id=org_id,
        target_user_id=user_id,
        updated_by=ctx.user_id,
    )

    return MemberResponse(
        id=member.id,
        user_id=member.user_id,
        email=member.user.email if member.user else "",
        name=member.user.name if member.user else None,
        avatar_url=member.user.avatar_url if member.user else None,
        role=member.role,
        spending_limit_cents=member.spending_limit_cents,
        current_spending_cents=member.current_spending_cents,
        allocated_credits_cents=member.allocated_credits_cents,
        used_credits_cents=member.used_credits_cents,
        is_blocked=member.is_blocked,
        blocked_reason=member.blocked_reason,
        joined_at=member.joined_at,
    )


@router.delete("/{org_id}/members/{user_id}")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_org_admin
async def remove_member(
    request: Request,
    response: Response,  # noqa: ARG001
    org_id: str,
    user_id: str,
    db: DbSession,
) -> dict[str, str]:
    """Remove a member from the organization."""
    ctx: OrgContext = request.state.org_context

    result = await db.execute(
        select(OrganizationMember)
        .options(selectinload(OrganizationMember.user))
        .where(OrganizationMember.organization_id == org_id)
        .where(OrganizationMember.user_id == user_id)
    )
    member = result.scalar_one_or_none()

    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    if member.role == "owner":
        raise HTTPException(status_code=400, detail="Cannot remove organization owner")

    # Reactivate user's personal billing
    if member.user:
        member.user.personal_billing_suspended = False
        member.user.personal_billing_suspended_at = None
        member.user.account_type = "personal"

    await db.delete(member)
    await db.commit()

    logger.info(
        "Member removed",
        org_id=org_id,
        removed_user_id=user_id,
        removed_by=ctx.user_id,
    )

    return {"message": "Member removed successfully"}


@router.post("/{org_id}/members/{user_id}/block")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_org_admin
async def block_member(
    request: Request,
    response: Response,  # noqa: ARG001
    org_id: str,
    user_id: str,
    db: DbSession,
    reason: str | None = Query(None, max_length=500),
) -> dict[str, str]:
    """Block a member from using the organization's resources."""
    ctx: OrgContext = request.state.org_context

    result = await db.execute(
        select(OrganizationMember)
        .where(OrganizationMember.organization_id == org_id)
        .where(OrganizationMember.user_id == user_id)
    )
    member = result.scalar_one_or_none()

    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    if member.role == "owner":
        raise HTTPException(status_code=400, detail="Cannot block organization owner")

    member.is_blocked = True
    member.blocked_reason = reason or "Blocked by admin"
    member.blocked_at = datetime.now(UTC)

    await db.commit()

    logger.info(
        "Member blocked",
        org_id=org_id,
        blocked_user_id=user_id,
        blocked_by=ctx.user_id,
        reason=reason,
    )

    return {"message": "Member blocked successfully"}


@router.post("/{org_id}/members/{user_id}/unblock")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_org_admin
async def unblock_member(
    request: Request,
    response: Response,  # noqa: ARG001
    org_id: str,
    user_id: str,
    db: DbSession,
) -> dict[str, str]:
    """Unblock a member."""
    ctx: OrgContext = request.state.org_context

    result = await db.execute(
        select(OrganizationMember)
        .where(OrganizationMember.organization_id == org_id)
        .where(OrganizationMember.user_id == user_id)
    )
    member = result.scalar_one_or_none()

    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    member.is_blocked = False
    member.blocked_reason = None
    member.blocked_at = None

    await db.commit()

    logger.info(
        "Member unblocked",
        org_id=org_id,
        unblocked_user_id=user_id,
        unblocked_by=ctx.user_id,
    )

    return {"message": "Member unblocked successfully"}


# ============================================================================
# Invitations
# ============================================================================


@router.get("/{org_id}/invitations", response_model=list[InvitationResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
@require_org_admin
async def list_invitations(
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
    org_id: str,
    db: DbSession,
    status: str | None = Query(None, pattern=r"^(pending|accepted|expired|revoked)$"),
) -> list[InvitationResponse]:
    """List organization invitations."""
    query = (
        select(OrganizationInvitation)
        .options(selectinload(OrganizationInvitation.invited_by))
        .where(OrganizationInvitation.organization_id == org_id)
    )

    if status:
        query = query.where(OrganizationInvitation.status == status)

    result = await db.execute(query.order_by(OrganizationInvitation.created_at.desc()))
    invitations = result.scalars().all()

    return [
        InvitationResponse(
            id=inv.id,
            email=inv.email,
            role=inv.role,
            status=inv.status,
            invited_by_email=inv.invited_by.email if inv.invited_by else None,
            message=inv.message,
            expires_at=inv.expires_at,
            created_at=inv.created_at,
        )
        for inv in invitations
    ]


@router.post("/{org_id}/invitations", response_model=InvitationResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_org_admin
async def send_invitation(
    request: Request,
    response: Response,  # noqa: ARG001
    org_id: str,
    data: InviteMemberRequest,
    db: DbSession,
) -> InvitationResponse:
    """Send an email invitation to join the organization."""
    ctx: OrgContext = request.state.org_context
    org = ctx.organization

    # Validate business email
    validate_invite_email(data.email, org.blocked_email_domains)

    # Check user isn't already a member
    existing_user = await db.execute(select(User).where(User.email == data.email))
    user = existing_user.scalar_one_or_none()

    if user:
        existing_member = await db.execute(
            select(OrganizationMember).where(OrganizationMember.user_id == user.id)
        )
        if existing_member.scalar_one_or_none():
            raise HTTPException(
                status_code=400,
                detail="This user is already a member of an organization",
            )

    # Check for existing pending invitation
    existing_inv = await db.execute(
        select(OrganizationInvitation)
        .where(OrganizationInvitation.organization_id == org_id)
        .where(OrganizationInvitation.email == data.email)
        .where(OrganizationInvitation.status == "pending")
    )
    if existing_inv.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="An invitation for this email is already pending",
        )

    # Create invitation
    invitation = OrganizationInvitation(
        organization_id=org_id,
        email=data.email,
        role=data.role,
        token=generate_invite_token(),
        invited_by_id=ctx.user_id,
        message=data.message,
        spending_limit_cents=data.spending_limit_cents,
        allocated_credits_cents=data.allocated_credits_cents,
        allowed_models=data.allowed_models,
        allowed_instance_types=data.allowed_instance_types,
        expires_at=datetime.now(UTC) + timedelta(days=7),
    )
    db.add(invitation)
    await db.commit()
    await db.refresh(invitation)

    # Get inviter information for email
    inviter = await db.get(User, ctx.user_id)

    # Send invitation email via email service
    try:
        email_service = get_email_service()
        await email_service.send_email(
            to_email=invitation.email,
            template=EmailTemplate.TEAM_INVITE,
            context={
                "inviter_name": inviter.name if inviter else "Someone",
                "team_name": org.name,
                "invite_url": f"{settings.FRONTEND_URL}/invitations/{invitation.id}/accept",
            },
        )
        logger.info(
            "Invitation email sent",
            org_id=org_id,
            email=data.email,
            invitation_id=invitation.id,
        )
    except Exception as e:
        logger.warning(
            "Failed to send invitation email",
            org_id=org_id,
            email=data.email,
            invitation_id=invitation.id,
            error=str(e),
        )
        # Don't fail the invitation creation if email fails

    logger.info(
        "Invitation sent",
        org_id=org_id,
        email=data.email,
        invited_by=ctx.user_id,
    )

    return InvitationResponse(
        id=invitation.id,
        email=invitation.email,
        role=invitation.role,
        status=invitation.status,
        invited_by_email=ctx.member.user.email if hasattr(ctx.member, "user") else None,
        message=invitation.message,
        expires_at=invitation.expires_at,
        created_at=invitation.created_at,
    )


@router.delete("/{org_id}/invitations/{invitation_id}")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_org_admin
async def revoke_invitation(
    request: Request,
    response: Response,  # noqa: ARG001
    org_id: str,
    invitation_id: str,
    db: DbSession,
) -> dict[str, str]:
    """Revoke a pending invitation."""
    ctx: OrgContext = request.state.org_context

    result = await db.execute(
        select(OrganizationInvitation)
        .where(OrganizationInvitation.organization_id == org_id)
        .where(OrganizationInvitation.id == invitation_id)
    )
    invitation = result.scalar_one_or_none()

    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")

    if invitation.status != "pending":
        raise HTTPException(status_code=400, detail="Can only revoke pending invitations")

    invitation.status = "revoked"

    await db.commit()

    logger.info(
        "Invitation revoked",
        org_id=org_id,
        invitation_id=invitation_id,
        revoked_by=ctx.user_id,
    )

    return {"message": "Invitation revoked successfully"}


# ============================================================================
# Invite Links
# ============================================================================


@router.get("/{org_id}/invite-links", response_model=list[InviteLinkResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
@require_org_admin
async def list_invite_links(
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
    org_id: str,
    db: DbSession,
) -> list[InviteLinkResponse]:
    """List organization invite links."""
    result = await db.execute(
        select(OrganizationInviteLink)
        .where(OrganizationInviteLink.organization_id == org_id)
        .order_by(OrganizationInviteLink.created_at.desc())
    )
    links = result.scalars().all()

    base_url = settings.FRONTEND_URL

    return [
        InviteLinkResponse(
            id=link.id,
            code=link.code,
            url=f"{base_url}/join/{link.code}",
            name=link.name,
            role=link.role,
            max_uses=link.max_uses,
            current_uses=link.current_uses,
            is_active=link.is_active,
            expires_at=link.expires_at,
            created_at=link.created_at,
        )
        for link in links
    ]


@router.post("/{org_id}/invite-links", response_model=InviteLinkResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_org_admin
async def create_invite_link(
    request: Request,
    response: Response,  # noqa: ARG001
    org_id: str,
    data: CreateInviteLinkRequest,
    db: DbSession,
) -> InviteLinkResponse:
    """Create a shareable invite link."""
    ctx: OrgContext = request.state.org_context

    expires_at = None
    if data.expires_in_days:
        expires_at = datetime.now(UTC) + timedelta(days=data.expires_in_days)

    link = OrganizationInviteLink(
        organization_id=org_id,
        code=generate_invite_code(),
        name=data.name,
        role=data.role,
        max_uses=data.max_uses,
        spending_limit_cents=data.spending_limit_cents,
        allocated_credits_cents=data.allocated_credits_cents,
        created_by_id=ctx.user_id,
        expires_at=expires_at,
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)

    base_url = settings.FRONTEND_URL

    logger.info(
        "Invite link created",
        org_id=org_id,
        link_id=link.id,
        created_by=ctx.user_id,
    )

    return InviteLinkResponse(
        id=link.id,
        code=link.code,
        url=f"{base_url}/join/{link.code}",
        name=link.name,
        role=link.role,
        max_uses=link.max_uses,
        current_uses=link.current_uses,
        is_active=link.is_active,
        expires_at=link.expires_at,
        created_at=link.created_at,
    )


@router.delete("/{org_id}/invite-links/{link_id}")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_org_admin
async def deactivate_invite_link(
    request: Request,
    response: Response,  # noqa: ARG001
    org_id: str,
    link_id: str,
    db: DbSession,
) -> dict[str, str]:
    """Deactivate an invite link."""
    ctx: OrgContext = request.state.org_context

    result = await db.execute(
        select(OrganizationInviteLink)
        .where(OrganizationInviteLink.organization_id == org_id)
        .where(OrganizationInviteLink.id == link_id)
    )
    link = result.scalar_one_or_none()

    if not link:
        raise HTTPException(status_code=404, detail="Invite link not found")

    link.is_active = False

    await db.commit()

    logger.info(
        "Invite link deactivated",
        org_id=org_id,
        link_id=link_id,
        deactivated_by=ctx.user_id,
    )

    return {"message": "Invite link deactivated successfully"}


# ============================================================================
# Join Organization
# ============================================================================


@router.post("/join/invitation/{token}", response_model=JoinOrganizationResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def join_via_invitation(
    request: Request,
    response: Response,  # noqa: ARG001
    token: str,
    db: DbSession,
) -> JoinOrganizationResponse:
    """Accept an email invitation to join an organization."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    # Get invitation
    result = await db.execute(
        select(OrganizationInvitation)
        .options(selectinload(OrganizationInvitation.organization))
        .where(OrganizationInvitation.token == token)
    )
    invitation = result.scalar_one_or_none()

    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")

    if invitation.status != "pending":
        raise HTTPException(status_code=400, detail="Invitation is no longer valid")

    if datetime.now(UTC) > invitation.expires_at:
        invitation.status = "expired"
        await db.commit()
        raise HTTPException(status_code=400, detail="Invitation has expired")

    # Check user email matches invitation
    user = await db.get(User, user_id)
    if not user or user.email.lower() != invitation.email.lower():
        raise HTTPException(
            status_code=400,
            detail="This invitation was sent to a different email address",
        )

    # Check user isn't already in an org
    existing_member = await db.execute(
        select(OrganizationMember).where(OrganizationMember.user_id == user_id)
    )
    if existing_member.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="You are already a member of an organization",
        )

    # Create membership
    member = OrganizationMember(
        organization_id=invitation.organization_id,
        user_id=user_id,
        role=invitation.role,
        spending_limit_cents=invitation.spending_limit_cents,
        allocated_credits_cents=invitation.allocated_credits_cents or 0,
        allowed_models=invitation.allowed_models,
        allowed_instance_types=invitation.allowed_instance_types,
        billing_period_start=datetime.now(UTC),
    )
    db.add(member)

    # Mark invitation as accepted
    invitation.status = "accepted"
    invitation.accepted_at = datetime.now(UTC)

    # Suspend user's personal billing
    user.personal_billing_suspended = True
    user.personal_billing_suspended_at = datetime.now(UTC)
    user.account_type = "organization"

    await db.commit()

    org = invitation.organization

    logger.info(
        "User joined via invitation",
        org_id=org.id,
        user_id=user_id,
        role=invitation.role,
    )

    return JoinOrganizationResponse(
        organization=OrganizationResponse(
            id=org.id,
            name=org.name,
            slug=org.slug,
            credit_model=org.credit_model,
            credit_pool_cents=org.credit_pool_cents,
            auto_join_enabled=org.auto_join_enabled,
            auto_join_domains=org.auto_join_domains,
            is_active=org.is_active,
            logo_url=org.logo_url,
            website=org.website,
            onboarding_completed=org.onboarding_completed,
            created_at=org.created_at,
            updated_at=org.updated_at,
        ),
        role=invitation.role,
        message=f"Welcome to {org.name}!",
    )


@router.post("/join/link/{code}", response_model=JoinOrganizationResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def join_via_link(
    request: Request,
    response: Response,  # noqa: ARG001
    code: str,
    db: DbSession,
) -> JoinOrganizationResponse:
    """Join an organization via invite link."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    # Get invite link
    result = await db.execute(
        select(OrganizationInviteLink)
        .options(selectinload(OrganizationInviteLink.organization))
        .where(OrganizationInviteLink.code == code)
    )
    link = result.scalar_one_or_none()

    if not link:
        raise HTTPException(status_code=404, detail="Invite link not found")

    if not link.is_active:
        raise HTTPException(status_code=400, detail="Invite link is no longer active")

    if link.expires_at and datetime.now(UTC) > link.expires_at:
        link.is_active = False
        await db.commit()
        raise HTTPException(status_code=400, detail="Invite link has expired")

    if link.max_uses and link.current_uses >= link.max_uses:
        link.is_active = False
        await db.commit()
        raise HTTPException(status_code=400, detail="Invite link has reached maximum uses")

    org = link.organization

    # Validate business email
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not is_business_email(user.email, org.blocked_email_domains):
        raise HTTPException(
            status_code=400,
            detail="Personal email addresses are not allowed. Please use a business email.",
        )

    # Check user isn't already in an org
    existing_member = await db.execute(
        select(OrganizationMember).where(OrganizationMember.user_id == user_id)
    )
    if existing_member.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="You are already a member of an organization",
        )

    # Create membership
    member = OrganizationMember(
        organization_id=org.id,
        user_id=user_id,
        role=link.role,
        spending_limit_cents=link.spending_limit_cents or org.default_spending_limit_cents,
        allocated_credits_cents=link.allocated_credits_cents or 0,
        billing_period_start=datetime.now(UTC),
    )
    db.add(member)

    # Increment link usage
    link.current_uses += 1

    # Suspend user's personal billing
    user.personal_billing_suspended = True
    user.personal_billing_suspended_at = datetime.now(UTC)
    user.account_type = "organization"

    await db.commit()

    logger.info(
        "User joined via invite link",
        org_id=org.id,
        user_id=user_id,
        link_id=link.id,
        role=link.role,
    )

    return JoinOrganizationResponse(
        organization=OrganizationResponse(
            id=org.id,
            name=org.name,
            slug=org.slug,
            credit_model=org.credit_model,
            credit_pool_cents=org.credit_pool_cents,
            auto_join_enabled=org.auto_join_enabled,
            auto_join_domains=org.auto_join_domains,
            is_active=org.is_active,
            logo_url=org.logo_url,
            website=org.website,
            onboarding_completed=org.onboarding_completed,
            created_at=org.created_at,
            updated_at=org.updated_at,
        ),
        role=link.role,
        message=f"Welcome to {org.name}!",
    )


@router.get("/join/domain-check")
@limiter.limit(RATE_LIMIT_STANDARD)
async def check_domain_auto_join(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, Any]:
    """Check if user's email domain has auto-join enabled for any organization."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    domain = user.email.lower().split("@")[-1]

    # Find organization with this domain in auto_join_domains
    result = await db.execute(
        select(Organization)
        .where(Organization.auto_join_enabled == True)
        .where(Organization.is_active == True)
    )
    orgs = result.scalars().all()

    for org in orgs:
        if org.auto_join_domains and domain in [d.lower() for d in org.auto_join_domains]:
            return {
                "can_auto_join": True,
                "organization": {
                    "id": org.id,
                    "name": org.name,
                    "slug": org.slug,
                    "logo_url": org.logo_url,
                },
                "role": org.auto_join_default_role,
            }

    return {"can_auto_join": False}


@router.post("/join/domain", response_model=JoinOrganizationResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def join_via_domain(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> JoinOrganizationResponse:
    """Join an organization via domain-based auto-join."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    domain = user.email.lower().split("@")[-1]

    # Find organization with this domain
    result = await db.execute(
        select(Organization)
        .where(Organization.auto_join_enabled == True)
        .where(Organization.is_active == True)
    )
    orgs = result.scalars().all()

    org = None
    for o in orgs:
        if o.auto_join_domains and domain in [d.lower() for d in o.auto_join_domains]:
            org = o
            break

    if not org:
        raise HTTPException(
            status_code=400,
            detail="No organization found with auto-join enabled for your email domain",
        )

    # Check user isn't already in an org
    existing_member = await db.execute(
        select(OrganizationMember).where(OrganizationMember.user_id == user_id)
    )
    if existing_member.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="You are already a member of an organization",
        )

    # Create membership
    member = OrganizationMember(
        organization_id=org.id,
        user_id=user_id,
        role=org.auto_join_default_role,
        spending_limit_cents=org.default_spending_limit_cents,
        billing_period_start=datetime.now(UTC),
    )
    db.add(member)

    # Suspend user's personal billing
    user.personal_billing_suspended = True
    user.personal_billing_suspended_at = datetime.now(UTC)
    user.account_type = "organization"

    await db.commit()

    logger.info(
        "User joined via domain auto-join",
        org_id=org.id,
        user_id=user_id,
        domain=domain,
    )

    return JoinOrganizationResponse(
        organization=OrganizationResponse(
            id=org.id,
            name=org.name,
            slug=org.slug,
            credit_model=org.credit_model,
            credit_pool_cents=org.credit_pool_cents,
            auto_join_enabled=org.auto_join_enabled,
            auto_join_domains=org.auto_join_domains,
            is_active=org.is_active,
            logo_url=org.logo_url,
            website=org.website,
            onboarding_completed=org.onboarding_completed,
            created_at=org.created_at,
            updated_at=org.updated_at,
        ),
        role=org.auto_join_default_role,
        message=f"Welcome to {org.name}!",
    )


# ============================================================================
# Organization Billing (Owner Only)
# ============================================================================


@router.get("/{org_id}/billing/summary", response_model=UsageSummaryResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_org_permission("billing:view")
async def get_billing_summary(
    request: Request,
    response: Response,  # noqa: ARG001
    org_id: str,
    db: DbSession,
) -> UsageSummaryResponse:
    """Get organization billing summary (owner only)."""
    ctx: OrgContext = request.state.org_context
    org = ctx.organization

    # Get member count
    member_count_result = await db.execute(
        select(func.count(OrganizationMember.id)).where(
            OrganizationMember.organization_id == org_id
        )
    )
    member_count = member_count_result.scalar() or 0

    # Get total spending
    total_spending_result = await db.execute(
        select(func.sum(OrganizationUsageRecord.total_cost_cents)).where(
            OrganizationUsageRecord.organization_id == org_id
        )
    )
    total_spending = total_spending_result.scalar() or 0

    # Get spending by type
    by_type_result = await db.execute(
        select(
            OrganizationUsageRecord.usage_type,
            func.sum(OrganizationUsageRecord.total_cost_cents),
        )
        .where(OrganizationUsageRecord.organization_id == org_id)
        .group_by(OrganizationUsageRecord.usage_type)
    )
    by_type = {row[0]: row[1] or 0 for row in by_type_result.fetchall()}

    # Get top users by spending
    top_users_result = await db.execute(
        select(
            OrganizationMember.user_id,
            User.email,
            User.name,
            OrganizationMember.current_spending_cents,
        )
        .join(User, User.id == OrganizationMember.user_id)
        .where(OrganizationMember.organization_id == org_id)
        .order_by(OrganizationMember.current_spending_cents.desc())
        .limit(10)
    )
    top_users = [
        {
            "user_id": row[0],
            "email": row[1],
            "name": row[2],
            "spending_cents": row[3],
        }
        for row in top_users_result.fetchall()
    ]

    # Get current subscription period
    subscription_result = await db.execute(
        select(OrganizationSubscription)
        .where(OrganizationSubscription.organization_id == org_id)
        .where(OrganizationSubscription.status == "active")
        .order_by(OrganizationSubscription.created_at.desc())
        .limit(1)
    )
    subscription = subscription_result.scalar_one_or_none()

    return UsageSummaryResponse(
        total_spending_cents=total_spending,
        member_count=member_count,
        credit_pool_cents=org.credit_pool_cents,
        credit_model=org.credit_model,
        period_start=subscription.current_period_start if subscription else None,
        period_end=subscription.current_period_end if subscription else None,
        top_users=top_users,
        by_type=by_type,
    )


@router.post("/{org_id}/billing/credits/allocate", response_model=dict[str, Any])
@limiter.limit(RATE_LIMIT_STANDARD)
@require_org_admin
async def allocate_credits_to_member(
    request: Request,
    response: Response,  # noqa: ARG001
    org_id: str,
    user_id: str,
    data: AllocateCreditsRequest,
    db: DbSession,
) -> dict[str, Any]:
    """Allocate credits to a member (for allocated credit model)."""
    ctx: OrgContext = request.state.org_context
    org = ctx.organization

    if org.credit_model != "allocated":
        raise HTTPException(
            status_code=400,
            detail="Credit allocation is only available for organizations using "
            "the 'allocated' credit model",
        )

    # Get member
    result = await db.execute(
        select(OrganizationMember)
        .where(OrganizationMember.organization_id == org_id)
        .where(OrganizationMember.user_id == user_id)
    )
    member = result.scalar_one_or_none()

    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    limits_service = OrgLimitsService(db)
    transaction = await limits_service.allocate_credits(
        member,
        org,
        data.amount_cents,
        data.description,
    )

    return {
        "transaction_id": transaction.id,
        "allocated_credits_cents": member.allocated_credits_cents,
        "used_credits_cents": member.used_credits_cents,
        "remaining_cents": member.allocated_credits_cents - member.used_credits_cents,
    }
