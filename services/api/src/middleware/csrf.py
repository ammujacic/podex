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
        # No origin but has Authorization header - allow (non-browser API clients)
        if not request_origin:
            if request.headers.get("Authorization"):
                return None

            logger.warning(
                "CSRF: No Origin header for state-changing request",
                method=request.method,
                path=request.url.path,
                client_ip=request.client.host if request.client else "unknown",
            )
            return JSONResponse(
                status_code=403,
                content={"detail": "Missing Origin header"},
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

        # Handle wildcard (be careful with this in production)
        if normalized_allowed == "*":
            return True

    return False
