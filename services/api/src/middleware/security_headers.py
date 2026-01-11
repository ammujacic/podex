"""Security headers middleware for production hardening."""

from collections.abc import Awaitable, Callable

from fastapi import Request
from fastapi.responses import Response
from starlette.middleware.base import BaseHTTPMiddleware

from src.config import settings


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Middleware to add security headers to all responses.

    Adds the following headers:
    - Strict-Transport-Security (HSTS): Forces HTTPS connections
    - X-Frame-Options: Prevents clickjacking attacks
    - X-Content-Type-Options: Prevents MIME type sniffing
    - X-XSS-Protection: Legacy XSS protection for older browsers
    - Referrer-Policy: Controls referrer information
    - Permissions-Policy: Restricts browser features
    - Content-Security-Policy: Restricts resource loading (when configured)
    """

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        """Add security headers to response."""
        response: Response = await call_next(request)

        # HSTS - only in production with HTTPS
        if settings.ENVIRONMENT == "production":
            # max-age=31536000 (1 year), includeSubDomains, preload
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains; preload"
            )

        # Prevent clickjacking - DENY prevents all framing
        # Use SAMEORIGIN if embedding in same-origin iframes is needed
        response.headers["X-Frame-Options"] = "DENY"

        # Prevent MIME type sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"

        # Legacy XSS protection (for older browsers)
        # Modern browsers use CSP instead, but this doesn't hurt
        response.headers["X-XSS-Protection"] = "1; mode=block"

        # Control referrer information
        # strict-origin-when-cross-origin: Send origin for cross-origin, full URL for same-origin
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Permissions Policy (formerly Feature-Policy)
        # Restrict access to sensitive browser features
        response.headers["Permissions-Policy"] = (
            "accelerometer=(), "
            "camera=(), "
            "geolocation=(), "
            "gyroscope=(), "
            "magnetometer=(), "
            "microphone=(), "
            "payment=(), "
            "usb=()"
        )

        # Content-Security-Policy
        # This is a restrictive default - adjust based on your frontend needs
        if settings.CSP_ENABLED:
            csp_directives = _build_csp_directives()
            response.headers["Content-Security-Policy"] = csp_directives

        # Prevent caching of sensitive responses
        # This is applied to API responses; static assets should have different caching
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
            response.headers["Pragma"] = "no-cache"

        return response


def _build_csp_directives() -> str:
    """Build Content-Security-Policy directives based on configuration.

    Returns a CSP string suitable for an API server.
    The frontend may need different/additional directives.
    """
    # For an API server, we mainly need to:
    # 1. Prevent the API from being embedded in frames on other sites
    # 2. Restrict where scripts can come from (mainly for docs pages)
    # 3. Prevent data exfiltration via form submissions

    directives = [
        # Default: only allow resources from same origin
        "default-src 'self'",
        # Scripts: self + inline for Swagger/ReDoc docs
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
        if settings.ENVIRONMENT != "production"
        else "script-src 'self'",
        # Styles: self + inline for docs
        "style-src 'self' 'unsafe-inline'",
        # Images: self + data URIs (for base64 images in docs)
        "img-src 'self' data: https:",
        # Fonts: self + common CDNs
        "font-src 'self' https://fonts.gstatic.com",
        # Connect: self + WebSocket + configured origins
        f"connect-src 'self' ws: wss: {' '.join(settings.CORS_ORIGINS)}",
        # Frames: deny all framing
        "frame-ancestors 'none'",
        # Forms: only submit to self
        "form-action 'self'",
        # Base URI: restrict to self
        "base-uri 'self'",
        # Object/embed: deny
        "object-src 'none'",
        # Upgrade insecure requests in production
        "upgrade-insecure-requests" if settings.ENVIRONMENT == "production" else "",
    ]

    # Filter out empty directives and join
    return "; ".join(d for d in directives if d)
