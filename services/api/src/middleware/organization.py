"""Organization authorization middleware and utilities."""

from collections.abc import Callable
from functools import wraps
from typing import Annotated, Any, cast

import structlog
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.database.connection import get_db
from src.database.models import Organization, OrganizationMember
from src.database.models.organization import DEFAULT_BLOCKED_EMAIL_DOMAINS

logger = structlog.get_logger()

# Role hierarchy: owner > admin > member
ROLE_HIERARCHY = {
    "owner": 3,
    "admin": 2,
    "member": 1,
}

# Organization roles
ORG_ROLES = {"owner", "admin", "member"}

# Permission definitions - maps permission to allowed roles
PERMISSIONS = {
    # Billing permissions (owner only)
    "billing:view": {"owner"},
    "billing:manage": {"owner"},
    "billing:purchase": {"owner"},
    # Member management
    "members:view": {"owner", "admin", "member"},
    "members:invite": {"owner", "admin"},
    "members:remove": {"owner", "admin"},
    "members:set_limits": {"owner", "admin"},
    "members:change_role": {"owner"},  # Only owner can change roles
    "members:block": {"owner", "admin"},
    # Organization settings
    "org:view": {"owner", "admin", "member"},
    "org:edit": {"owner", "admin"},
    "org:delete": {"owner"},
    # Invite links
    "invite_links:view": {"owner", "admin"},
    "invite_links:manage": {"owner", "admin"},
    # Usage viewing
    "usage:view_own": {"owner", "admin", "member"},
    "usage:view_all": {"owner", "admin"},
}


def has_permission(role: str, permission: str) -> bool:
    """Check if a role has a specific permission."""
    allowed_roles = PERMISSIONS.get(permission, set())
    return role in allowed_roles


def has_role_or_higher(user_role: str, required_role: str) -> bool:
    """Check if user role is equal to or higher than required role."""
    user_level = ROLE_HIERARCHY.get(user_role, 0)
    required_level = ROLE_HIERARCHY.get(required_role, 999)
    return user_level >= required_level


class OrgContext:
    """Organization context containing membership info."""

    def __init__(
        self,
        organization: Organization,
        member: OrganizationMember,
    ) -> None:
        self.organization = organization
        self.member = member
        self.org_id = organization.id
        self.user_id = member.user_id
        self.role = member.role

    def has_permission(self, permission: str) -> bool:
        """Check if member has a specific permission."""
        return has_permission(self.role, permission)

    def is_owner(self) -> bool:
        """Check if member is organization owner."""
        return self.role == "owner"

    def is_admin(self) -> bool:
        """Check if member is admin or higher."""
        return self.role in {"owner", "admin"}

    def can_manage_members(self) -> bool:
        """Check if member can manage other members."""
        return self.is_admin()

    def can_access_billing(self) -> bool:
        """Check if member can access billing."""
        return self.is_owner()


async def get_user_org_context(
    request: Request,
    db: AsyncSession,
) -> OrgContext | None:
    """Get organization context for current user if they belong to one.

    Returns None if user is not in an organization.
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        return None

    result = await db.execute(
        select(OrganizationMember)
        .options(selectinload(OrganizationMember.organization))
        .where(OrganizationMember.user_id == user_id)
    )
    member = result.scalar_one_or_none()

    if not member:
        return None

    return OrgContext(organization=member.organization, member=member)


async def get_org_context_for_org(
    request: Request,
    db: AsyncSession,
    org_id: str,
) -> OrgContext:
    """Get organization context for a specific organization.

    Raises HTTPException if user is not a member or is blocked.
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    result = await db.execute(
        select(OrganizationMember)
        .options(selectinload(OrganizationMember.organization))
        .where(OrganizationMember.organization_id == org_id)
        .where(OrganizationMember.user_id == user_id)
    )
    member = result.scalar_one_or_none()

    if not member:
        raise HTTPException(status_code=403, detail="Not a member of this organization")

    if member.is_blocked:
        raise HTTPException(
            status_code=403,
            detail="Your access to this organization has been blocked",
        )

    if not member.organization.is_active:
        raise HTTPException(
            status_code=403,
            detail="This organization has been deactivated",
        )

    return OrgContext(organization=member.organization, member=member)


def require_org_role(*allowed_roles: str) -> Callable[..., Any]:
    """Decorator to require specific organization role(s) for endpoint access.

    Usage:
        @require_org_role("owner", "admin")
        async def endpoint(request: Request, org_id: str, db: DbSession):
            ...
    """

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            # Find request, org_id, and db in kwargs
            request = kwargs.get("request")
            org_id = kwargs.get("org_id")
            db = kwargs.get("db")

            if request is None:
                for arg in args:
                    if isinstance(arg, Request):
                        request = arg
                        break

            if request is None:
                raise HTTPException(status_code=500, detail="Request not found")

            if org_id is None:
                raise HTTPException(status_code=400, detail="Organization ID required")

            if db is None:
                raise HTTPException(status_code=500, detail="Database session not found")

            # Get org context
            ctx = await get_org_context_for_org(request, db, org_id)

            # Check role
            if ctx.role not in allowed_roles:
                logger.warning(
                    "Organization access denied - insufficient role",
                    user_id=ctx.user_id,
                    org_id=org_id,
                    role=ctx.role,
                    required_roles=allowed_roles,
                )
                raise HTTPException(
                    status_code=403,
                    detail=f"Requires one of: {', '.join(allowed_roles)}",
                )

            # Add org context to request state for use in endpoint
            request.state.org_context = ctx

            return await func(*args, **kwargs)

        return wrapper

    return decorator


def require_org_permission(permission: str) -> Callable[..., Any]:
    """Decorator to require a specific permission for endpoint access.

    Usage:
        @require_org_permission("billing:view")
        async def endpoint(request: Request, org_id: str, db: DbSession):
            ...
    """

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            request = kwargs.get("request")
            org_id = kwargs.get("org_id")
            db = kwargs.get("db")

            if request is None:
                for arg in args:
                    if isinstance(arg, Request):
                        request = arg
                        break

            if request is None:
                raise HTTPException(status_code=500, detail="Request not found")

            if org_id is None:
                raise HTTPException(status_code=400, detail="Organization ID required")

            if db is None:
                raise HTTPException(status_code=500, detail="Database session not found")

            ctx = await get_org_context_for_org(request, db, org_id)

            if not ctx.has_permission(permission):
                logger.warning(
                    "Organization permission denied",
                    user_id=ctx.user_id,
                    org_id=org_id,
                    role=ctx.role,
                    permission=permission,
                )
                raise HTTPException(
                    status_code=403,
                    detail=f"Permission denied: {permission}",
                )

            request.state.org_context = ctx

            return await func(*args, **kwargs)

        return wrapper

    return decorator


def require_org_member(func: Callable[..., Any]) -> Callable[..., Any]:
    """Decorator to require user to be a member of the organization.

    This is the minimum requirement - any role is allowed.
    """
    return cast("Callable[..., Any]", require_org_role("owner", "admin", "member")(func))


def require_org_admin(func: Callable[..., Any]) -> Callable[..., Any]:
    """Decorator to require admin or owner role."""
    return cast("Callable[..., Any]", require_org_role("owner", "admin")(func))


def require_org_owner(func: Callable[..., Any]) -> Callable[..., Any]:
    """Decorator to require owner role."""
    return cast("Callable[..., Any]", require_org_role("owner")(func))


# Dependency for FastAPI
async def get_org_context_dependency(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> OrgContext | None:
    """FastAPI dependency to get organization context.

    Returns None if user is not in an organization.
    Can be used with Depends() in route parameters.
    """
    return await get_user_org_context(request, db)


async def require_org_context_dependency(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> OrgContext:
    """FastAPI dependency that requires user to be in an organization.

    Raises HTTPException if user is not in an organization.
    """
    ctx = await get_user_org_context(request, db)
    if ctx is None:
        raise HTTPException(
            status_code=400,
            detail="You must be a member of an organization to access this resource",
        )
    return ctx


def is_business_email(email: str, blocked_domains: list[str] | None = None) -> bool:
    """Check if email is a business email (not a personal email provider).

    Args:
        email: Email address to check
        blocked_domains: List of blocked domains. If None, uses default list.

    Returns:
        True if email is a business email, False if it's a personal email provider.
    """
    if blocked_domains is None:
        blocked_domains = DEFAULT_BLOCKED_EMAIL_DOMAINS

    domain = email.lower().split("@")[-1]
    return domain not in [d.lower() for d in blocked_domains]


def validate_invite_email(
    email: str,
    blocked_domains: list[str] | None = None,
) -> None:
    """Validate that an email can be invited to an organization.

    Raises HTTPException if email is from a blocked domain.
    """
    if not is_business_email(email, blocked_domains):
        raise HTTPException(
            status_code=400,
            detail="Personal email addresses are not allowed. Please use a business email.",
        )
