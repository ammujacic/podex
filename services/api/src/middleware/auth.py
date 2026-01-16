"""Authentication middleware for JWT validation."""

from collections.abc import Awaitable, Callable

import structlog
from fastapi import HTTPException, Request, Response
from jose import JWTError, jwt
from sqlalchemy import select
from starlette.middleware.base import BaseHTTPMiddleware

from src.config import settings
from src.database.connection import get_db
from src.database.models import User
from src.routes.auth import COOKIE_ACCESS_TOKEN

logger = structlog.get_logger()

# Paths that don't require authentication
# Use tuples: (path, is_prefix) where is_prefix=True allows subpaths
PUBLIC_PATHS: list[tuple[str, bool]] = [
    ("/health", False),
    ("/api/docs", False),
    ("/api/redoc", False),
    ("/api/openapi.json", False),
    ("/api/auth/login", False),
    ("/api/auth/register", False),
    ("/api/auth/refresh", False),
    ("/api/auth/logout", False),  # Allow logout without valid token
    ("/api/auth/password/check", False),  # Public password strength check
    ("/api/oauth/github", True),  # OAuth callbacks have query params
    ("/api/oauth/google", True),
    ("/api/preview", True),  # Preview endpoints have subpaths
    ("/api/templates", True),  # Template listing
    ("/api/webhooks", True),  # Stripe webhooks (has own auth)
    ("/api/billing/usage/record", False),  # Internal service endpoint (has own auth)
    ("/api/admin/settings/public", True),  # Public platform settings
    ("/socket.io", True),  # Socket.IO has subpaths
]


def _is_public_path(request_path: str) -> bool:
    """Check if the request path is public.

    Uses exact matching or prefix matching with proper boundary checks
    to prevent path traversal bypasses.
    """
    for path, is_prefix in PUBLIC_PATHS:
        if is_prefix:
            # For prefix paths, ensure proper boundary (exact match, trailing /, or query)
            if request_path == path or request_path.startswith((path + "/", path + "?")):
                return True
        # Exact match only
        elif request_path == path:
            return True
    return False


class AuthMiddleware(BaseHTTPMiddleware):
    """JWT authentication middleware."""

    async def dispatch(  # noqa: PLR0911
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        """Process request and validate JWT token."""
        # Skip auth for CORS preflight requests
        if request.method == "OPTIONS":
            return await call_next(request)

        # Skip auth for public paths
        if _is_public_path(request.url.path):
            return await call_next(request)

        # Extract token: prefer httpOnly cookie, fall back to Authorization header
        # Cookie-based auth is more secure (XSS protection)
        token = request.cookies.get(COOKIE_ACCESS_TOKEN)

        if not token:
            # Fall back to Authorization header for backward compatibility
            auth_header = request.headers.get("Authorization")
            if auth_header and auth_header.startswith("Bearer "):
                parts = auth_header.split(" ")
                if len(parts) == 2:  # noqa: PLR2004
                    token = parts[1]

        if not token:
            return Response(
                content='{"detail": "Authentication required"}',
                status_code=401,
                media_type="application/json",
            )

        try:
            # Decode and validate JWT
            payload = jwt.decode(
                token,
                settings.JWT_SECRET_KEY,
                algorithms=[settings.JWT_ALGORITHM],
            )

            user_id = payload.get("sub")
            if not user_id:
                logger.warning("JWT payload missing user ID")
                return Response(
                    content='{"detail": "Invalid token - missing user ID"}',
                    status_code=401,
                    media_type="application/json",
                )

            # Verify user exists in database
            async for db in get_db():
                try:
                    result = await db.execute(select(User).where(User.id == user_id))
                    user = result.scalar_one_or_none()

                    if not user:
                        logger.warning(
                            "User not found in database",
                            user_id=user_id,
                        )
                        return Response(
                            content='{"detail": "Invalid token - user not found"}',
                            status_code=401,
                            media_type="application/json",
                        )

                    # Check if user account is active
                    if not user.is_active:
                        logger.warning(
                            "Deactivated user attempted access",
                            user_id=user_id,
                        )
                        return Response(
                            content='{"detail": "Account deactivated. Please contact support."}',
                            status_code=403,
                            media_type="application/json",
                        )

                    # Add user info to request state
                    request.state.user_id = user_id

                    # Validate and set user role (defense in depth - don't trust JWT role blindly)
                    jwt_role = payload.get("role", "member")
                    valid_roles = {"member", "admin", "super_admin"}
                    request.state.user_role = jwt_role if jwt_role in valid_roles else "member"
                    break
                finally:
                    # Clean up database session
                    await db.close()

        except JWTError as e:
            logger.warning("JWT validation failed", error=str(e))
            return Response(
                content='{"detail": "Invalid or expired token"}',
                status_code=401,
                media_type="application/json",
            )

        return await call_next(request)


def get_current_user_id(request: Request) -> str:
    """Get current user ID from request state.

    This is a simple helper for routes that just need the user ID.

    Args:
        request: The FastAPI request object

    Returns:
        The authenticated user's ID

    Raises:
        HTTPException: If user is not authenticated
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return str(user_id)


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
