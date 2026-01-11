"""Admin authentication and authorization middleware."""

from collections.abc import Callable
from functools import wraps
from typing import Any

import structlog
from fastapi import HTTPException, Request

from src.config import settings

logger = structlog.get_logger()

# Valid admin roles
ADMIN_ROLES = {"admin", "super_admin"}


def require_admin(func: Callable[..., Any]) -> Callable[..., Any]:
    """Decorator to require admin role for endpoint access.

    Checks:
    1. User is authenticated (has user_id in request.state)
    2. User role is 'admin' or 'super_admin'
    """

    @wraps(func)
    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        # Find the request object in args or kwargs
        request = kwargs.get("request")
        if request is None:
            for arg in args:
                if isinstance(arg, Request):
                    request = arg
                    break

        if request is None:
            raise HTTPException(status_code=500, detail="Request not found")

        # Check authentication
        user_id = getattr(request.state, "user_id", None)
        if not user_id:
            raise HTTPException(status_code=401, detail="Authentication required")

        # Check admin role
        user_role = getattr(request.state, "user_role", "member")
        user_email = getattr(request.state, "user_email", None)

        # Super user bypass (for bootstrap/emergencies)
        super_user_emails = getattr(settings, "ADMIN_SUPER_USER_EMAILS", [])
        if user_email and user_email in super_user_emails:
            logger.info("Admin access via super user bypass", user_id=user_id)
            return await func(*args, **kwargs)

        # Check role
        if user_role not in ADMIN_ROLES:
            logger.warning(
                "Admin access denied - insufficient role",
                user_id=user_id,
                role=user_role,
            )
            raise HTTPException(status_code=403, detail="Admin access required")

        return await func(*args, **kwargs)

    return wrapper


def require_super_admin(func: Callable[..., Any]) -> Callable[..., Any]:
    """Decorator to require super_admin role for sensitive operations."""

    @wraps(func)
    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        request = kwargs.get("request")
        if request is None:
            for arg in args:
                if isinstance(arg, Request):
                    request = arg
                    break

        if request is None:
            raise HTTPException(status_code=500, detail="Request not found")

        user_id = getattr(request.state, "user_id", None)
        if not user_id:
            raise HTTPException(status_code=401, detail="Authentication required")

        user_role = getattr(request.state, "user_role", "member")
        user_email = getattr(request.state, "user_email", None)

        # Super user bypass
        super_user_emails = getattr(settings, "ADMIN_SUPER_USER_EMAILS", [])
        if user_email and user_email in super_user_emails:
            return await func(*args, **kwargs)

        if user_role != "super_admin":
            raise HTTPException(status_code=403, detail="Super admin access required")

        return await func(*args, **kwargs)

    return wrapper


def get_admin_user_id(request: Request) -> str:
    """Get admin user ID from request, raising if not admin."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    user_role = getattr(request.state, "user_role", "member")
    user_email = getattr(request.state, "user_email", None)

    super_user_emails = getattr(settings, "ADMIN_SUPER_USER_EMAILS", [])
    if user_email and user_email in super_user_emails:
        return str(user_id)

    if user_role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")

    return str(user_id)


async def check_admin_access(request: Request) -> bool:
    """Check if current user has admin access (non-raising version)."""
    user_role = getattr(request.state, "user_role", "member")
    user_email = getattr(request.state, "user_email", None)

    super_user_emails = getattr(settings, "ADMIN_SUPER_USER_EMAILS", [])
    if user_email and user_email in super_user_emails:
        return True

    return user_role in ADMIN_ROLES
