"""FastAPI dependency functions."""

from typing import Any

from fastapi import HTTPException, Request

from src.middleware.admin import get_admin_user_id


async def get_current_user(request: Request) -> dict[str, str | None]:
    """Get current user info from request state.

    This is a dependency for routes that need user information.

    Args:
        request: The FastAPI request object

    Returns:
        Dictionary with user_id and role

    Raises:
        HTTPException: If user is not authenticated
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    return {
        "id": str(user_id),
        "role": getattr(request.state, "user_role", "member"),
    }


async def get_admin_user(request: Request) -> dict[str, Any]:
    """Get admin user info from request as a dependency."""
    user_id = get_admin_user_id(request)
    return {
        "id": user_id,
        "email": getattr(request.state, "user_email", None),
        "role": getattr(request.state, "user_role", None),
    }
