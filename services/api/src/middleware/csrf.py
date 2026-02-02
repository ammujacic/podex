"""CSRF protection middleware via Origin header validation.

For APIs using JWT tokens in Authorization headers (not cookies),
traditional CSRF token protection is not strictly necessary because:
- CSRF attacks rely on browsers automatically sending cookies
- Authorization headers are NOT automatically sent by browsers
- Cross-origin requests can't read responses due to CORS

However, Origin validation provides defense-in-depth by ensuring
state-changing requests come from expected origins.
"""

from collections.abc import Awaitable, Callable
from urllib.parse import urlparse

import structlog
from fastapi import Request
from fastapi.responses import JSONResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware

from src.config import settings

logger = structlog.get_logger()

# Methods that modify state and should have origin validation
STATE_CHANGING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Paths that should be exempt from CSRF validation (e.g., auth endpoints for CLI)
# These endpoints are either:
# - Initial auth endpoints where no credentials exist yet (device auth flow)
# - Public endpoints with no harmful side effects (login, register, password check)
CSRF_EXEMPT_PATHS = {
    "/api/v1/auth/device/code",  # Device auth initiation (no creds yet)
    "/api/v1/auth/device/token",  # Device auth token polling (uses device_code secret)
    "/api/auth/device/code",  # Device auth initiation (no creds yet)
    "/api/auth/device/token",  # Device auth token polling (uses device_code secret)
    "/api/auth/login",  # No creds yet
    "/api/auth/register",  # No creds yet
    "/api/auth/register/",  # Alternate path form
    "/api/auth/password/check",  # Public strength check
}


class CSRFMiddleware(BaseHTTPMiddleware):
    """Middleware for CSRF protection via Origin header validation.

    Validates that state-changing requests (POST, PUT, PATCH, DELETE)
    come from allowed origins as configured in CORS_ORIGINS.
    """

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        """Validate Origin header for state-changing requests."""
        # Check if validation should be skipped
        if self._should_skip_validation(request):
            return await call_next(request)

        # Get request origin from headers
        request_origin = self._get_request_origin(request)

        # Validate origin
        error_response = self._validate_origin(request, request_origin)
        if error_response:
            return error_response

        return await call_next(request)

    def _should_skip_validation(self, request: Request) -> bool:
        """Check if CSRF validation should be skipped for this request."""
        # Skip validation for non-state-changing methods
        if request.method not in STATE_CHANGING_METHODS:
            return True

        # Skip validation for exempt paths (auth endpoints for CLI, etc.)
        if request.url.path in CSRF_EXEMPT_PATHS:
            return True

        # Skip CSRF check in development for easier testing
        if settings.ENVIRONMENT == "development" and not settings.CSRF_ENABLED_IN_DEV:
            return True

        # Internal API-to-API calls may not have Origin header
        internal_token = request.headers.get("X-Internal-Service-Token")
        return bool(internal_token and internal_token == settings.INTERNAL_SERVICE_TOKEN)

    def _get_request_origin(self, request: Request) -> str | None:
        """Extract request origin from Origin or Referer header."""
        origin = request.headers.get("Origin")
        if origin:
            return origin

        referer = request.headers.get("Referer")
        if referer:
            parsed = urlparse(referer)
            if parsed.scheme and parsed.netloc:
                return f"{parsed.scheme}://{parsed.netloc}"

        return None

    def _validate_origin(self, request: Request, request_origin: str | None) -> Response | None:
        """Validate the request origin. Returns error response if invalid, None if valid."""
        # No origin header - need additional verification for non-browser clients
        if not request_origin:
            # For non-browser API clients without Origin header, require BOTH:
            # 1. Authorization header (will be validated later by auth middleware)
            # 2. X-Requested-With header set to "XMLHttpRequest" or similar
            #    (this header cannot be set by HTML forms, providing CSRF protection)
            has_auth = request.headers.get("Authorization")
            has_xhr_header = request.headers.get("X-Requested-With")

            if has_auth and has_xhr_header:
                # Non-browser client with proper headers
                return None

            # Also allow if Content-Type is application/json (can't be set by forms)
            content_type = request.headers.get("Content-Type", "")
            if has_auth and "application/json" in content_type:
                return None

            logger.warning(
                "CSRF: No Origin header and missing required headers",
                method=request.method,
                path=request.url.path,
                has_auth=bool(has_auth),
                has_xhr=bool(has_xhr_header),
                content_type=content_type,
                client_ip=request.client.host if request.client else "unknown",
            )
            return JSONResponse(
                status_code=403,
                content={
                    "detail": "Missing Origin header. API clients must include "
                    "X-Requested-With header or use application/json content type."
                },
            )

        # Validate origin against allowed origins
        if not _is_allowed_origin(request_origin):
            logger.warning(
                "CSRF: Invalid Origin header",
                origin=request_origin,
                method=request.method,
                path=request.url.path,
                allowed_origins=settings.CORS_ORIGINS,
                client_ip=request.client.host if request.client else "unknown",
            )
            return JSONResponse(
                status_code=403,
                content={"detail": "Invalid request origin"},
            )

        return None


def _is_allowed_origin(origin: str) -> bool:
    """Check if the origin is in the allowed list.

    Args:
        origin: The origin to check (e.g., "https://example.com")

    Returns:
        True if the origin is allowed, False otherwise
    """
    # Normalize origin (remove trailing slash)
    normalized_origin = origin.rstrip("/")

    for allowed_origin in settings.CORS_ORIGINS:
        # Normalize allowed origin
        normalized_allowed = allowed_origin.rstrip("/")

        # Exact match
        if normalized_origin == normalized_allowed:
            return True

        # Handle wildcard - BLOCKED in production for security
        if normalized_allowed == "*":
            if settings.ENVIRONMENT == "production":
                logger.error(
                    "SECURITY: Wildcard CORS origin (*) blocked in production. "
                    "Configure specific origins in CORS_ORIGINS.",
                    origin=origin,
                )
                # SECURITY: Block wildcard in production instead of allowing
                return False
            # Allow wildcard only in development
            return True

    return False


class CORSConfigurationError(Exception):
    """Raised when CORS is misconfigured in production."""


def check_cors_configuration() -> None:
    """Check CORS configuration for security issues at startup.

    Call this during application initialization to warn about insecure configs.

    Raises:
        CORSConfigurationError: If wildcard CORS is configured in production.
    """
    if "*" in settings.CORS_ORIGINS:
        if settings.ENVIRONMENT == "production":
            error_msg = (
                "CRITICAL SECURITY ISSUE: Wildcard CORS origin (*) configured in production! "
                "This allows any website to make authenticated requests. "
                "Please configure specific origins in CORS_ORIGINS. "
                "The application will not start with this configuration."
            )
            logger.error(error_msg)
            raise CORSConfigurationError(error_msg)
        logger.warning(
            "Wildcard CORS origin (*) is configured. "
            "This is acceptable for development but must be changed for production."
        )
