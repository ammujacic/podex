"""Authentication middleware for JWT validation."""

import secrets
from collections.abc import Awaitable, Callable

import structlog
from fastapi import HTTPException, Request, Response
from jose import JWTError, jwt
from sqlalchemy import select
from starlette.middleware.base import BaseHTTPMiddleware

from src.config import settings
from src.database.connection import async_session_factory
from src.database.models import User
from src.routes.auth import COOKIE_ACCESS_TOKEN

logger = structlog.get_logger()


def _create_error_response(
    request: Request, content: str, status_code: int, media_type: str = "application/json"
) -> Response:
    """Create an error response with CORS headers.

    This ensures 401/403 responses include CORS headers so the browser
    can properly read the response instead of blocking it.
    """
    response = Response(content=content, status_code=status_code, media_type=media_type)

    # Add CORS headers based on request origin
    origin = request.headers.get("origin")
    if origin and origin in settings.CORS_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Headers"] = (
            "Authorization, Content-Type, Accept, Origin, X-Requested-With, X-Request-ID"
        )

    return response


# Paths that don't require authentication
# Use tuples: (path, is_prefix) where is_prefix=True allows subpaths
PUBLIC_PATHS: list[tuple[str, bool]] = [
    ("/health", False),
    ("/api/auth/login", False),
    ("/api/auth/register", False),
    ("/api/auth/signup", False),
    ("/api/auth/refresh", False),
    ("/api/auth/logout", False),  # Allow logout without valid token
    ("/api/auth/password/check", False),  # Public password strength check
    ("/api/billing/plans", True),  # Public subscription plans
    # OAuth login/signup endpoints (public)
    ("/api/oauth/github", True),  # GitHub OAuth endpoints (all subpaths)
    ("/api/oauth/google", True),  # Google OAuth endpoints (all subpaths)
    ("/api/webhooks", True),  # Stripe webhooks (has own auth)
    ("/socket.io", True),  # Socket.IO has subpaths
]

INTERNAL_TOKEN_PATHS: list[tuple[str, bool]] = [
    ("/api/billing/usage/record", False),
    ("/api/models/capabilities", True),
    ("/api/v1/models/capabilities", True),
    ("/api/v1/agent-tools", True),
    ("/api/agent-tools", True),
]

INTERNAL_OR_USER_PATHS: list[tuple[str, bool]] = [
    ("/api/v1/skills/available", False),
    ("/api/skills/available", False),
    ("/api/v1/agent-roles", True),
    ("/api/agent-roles", True),
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


def _is_internal_token_path(request_path: str) -> bool:
    """Check if the request path requires internal service token."""
    for path, is_prefix in INTERNAL_TOKEN_PATHS:
        if is_prefix:
            if request_path == path or request_path.startswith((path + "/", path + "?")):
                return True
        elif request_path == path:
            return True
    return False


def _is_internal_or_user_path(request_path: str) -> bool:
    """Check if the request path allows internal token or user auth."""
    for path, is_prefix in INTERNAL_OR_USER_PATHS:
        if is_prefix:
            if request_path == path or request_path.startswith((path + "/", path + "?")):
                return True
        elif request_path == path:
            return True
    return False


def _verify_internal_service_token(request: Request) -> bool:
    """Validate internal service token from headers."""
    expected_token = settings.INTERNAL_SERVICE_TOKEN
    if not expected_token:
        logger.error(
            "INTERNAL_SERVICE_TOKEN not configured - rejecting service request",
            environment=settings.ENVIRONMENT,
        )
        return False

    header_token = request.headers.get("X-Internal-Service-Token")
    if header_token and secrets.compare_digest(header_token, expected_token):
        return True

    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        if secrets.compare_digest(token, expected_token):
            return True

    return False


class AuthMiddleware(BaseHTTPMiddleware):
    """JWT authentication middleware."""

    async def dispatch(
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

        # Require internal service token for internal-only endpoints
        if _is_internal_token_path(request.url.path):
            if not _verify_internal_service_token(request):
                return _create_error_response(request, '{"detail": "Invalid service token"}', 401)
            return await call_next(request)

        # Allow internal token OR user JWT for shared endpoints
        if _is_internal_or_user_path(request.url.path) and _verify_internal_service_token(request):
            return await call_next(request)
        # Fall through to JWT validation if no valid service token

        # Check for internal service token (for service-to-service auth)
        # Internal endpoints use X-Internal-Service-Token header instead of JWT
        if "/internal/" in request.url.path:
            internal_token = request.headers.get("X-Internal-Service-Token")
            if internal_token:
                # Let the endpoint handler validate the token
                # This allows internal endpoints to have their own auth logic
                return await call_next(request)
            # If no internal token, fall through to JWT check
            # (in case user is trying to access via browser)

        # Extract token: prefer httpOnly cookie, fall back to Authorization header
        # Cookie-based auth is more secure (XSS protection)
        token = request.cookies.get(COOKIE_ACCESS_TOKEN)

        if not token:
            # Fall back to Authorization header for backward compatibility
            auth_header = request.headers.get("Authorization")
            if auth_header and auth_header.startswith("Bearer "):
                parts = auth_header.split(" ")
                if len(parts) == 2:
                    token = parts[1]

        if not token:
            return _create_error_response(request, '{"detail": "Authentication required"}', 401)

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
                return _create_error_response(
                    request, '{"detail": "Invalid token - missing user ID"}', 401
                )

            # SECURITY: Require jti claim for token revocation support
            # Tokens without jti cannot be individually revoked, making them a security risk
            token_jti = payload.get("jti")
            if not token_jti:
                logger.warning("Token missing jti claim - cannot be revoked", user_id=user_id)
                return _create_error_response(request, '{"detail": "Invalid token format"}', 401)

            # Check if token has been revoked (e.g., after password change or logout)
            from src.services.token_blacklist import is_token_revoked

            if await is_token_revoked(token_jti):
                logger.warning("Revoked token used", user_id=user_id, jti=token_jti)
                return _create_error_response(request, '{"detail": "Token has been revoked"}', 401)

            # Verify user exists in database using proper async context manager
            async with async_session_factory() as db:
                result = await db.execute(select(User).where(User.id == user_id))
                user = result.scalar_one_or_none()

                if not user:
                    logger.warning(
                        "User not found in database",
                        user_id=user_id,
                    )
                    return _create_error_response(
                        request, '{"detail": "Invalid token - user not found"}', 401
                    )

                # Check if user account is active
                if not user.is_active:
                    logger.warning(
                        "Deactivated user attempted access",
                        user_id=user_id,
                    )
                    return _create_error_response(
                        request, '{"detail": "Account deactivated. Please contact support."}', 403
                    )

                # Add user info to request state
                request.state.user_id = user_id
                # SECURITY: Add email for admin bypass checks (ADMIN_SUPER_USER_EMAILS)
                request.state.user_email = user.email

                # SECURITY: Always use the role from database, not from JWT
                # This ensures role changes take effect immediately
                valid_roles = {"member", "admin", "super_admin"}
                db_role = getattr(user, "role", "member") or "member"
                request.state.user_role = db_role if db_role in valid_roles else "member"

        except JWTError as e:
            logger.warning("JWT validation failed", error=str(e))
            return _create_error_response(request, '{"detail": "Invalid or expired token"}', 401)

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


def get_optional_user_id(request: Request) -> str | None:
    """Get current user ID if authenticated, None otherwise.

    Use this for endpoints that work for both authenticated and unauthenticated
    users but want to provide additional info when authenticated.

    Args:
        request: The FastAPI request object

    Returns:
        The authenticated user's ID, or None if not authenticated
    """
    user_id = getattr(request.state, "user_id", None)
    return str(user_id) if user_id else None


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
