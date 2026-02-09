"""Request ID middleware for distributed tracing.

This middleware assigns a unique request ID to each incoming request,
which can be used for:
- Correlating logs across services
- Debugging production issues
- Distributed tracing integration
"""

from collections.abc import Awaitable, Callable
from uuid import uuid4

import structlog
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

# Header names for request ID
REQUEST_ID_HEADER = "X-Request-ID"
CORRELATION_ID_HEADER = "X-Correlation-ID"


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Middleware that assigns a unique request ID to each request.

    The request ID is:
    1. Extracted from X-Request-ID header if present (from upstream service)
    2. Generated as a new UUID if not present
    3. Added to the response headers for client reference
    4. Bound to the structlog context for all log messages
    """

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        """Process request and add request ID."""
        # Get or generate request ID
        request_id = request.headers.get(REQUEST_ID_HEADER) or str(uuid4())

        # Get correlation ID if provided (for distributed tracing)
        correlation_id = request.headers.get(CORRELATION_ID_HEADER)

        # Store in request state for use by route handlers
        request.state.request_id = request_id
        if correlation_id:
            request.state.correlation_id = correlation_id

        # Bind to structlog context for automatic inclusion in logs
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            path=request.url.path,
            method=request.method,
        )
        if correlation_id:
            structlog.contextvars.bind_contextvars(correlation_id=correlation_id)

        # Process the request
        response = await call_next(request)

        # Add request ID to response headers
        response.headers[REQUEST_ID_HEADER] = request_id
        if correlation_id:
            response.headers[CORRELATION_ID_HEADER] = correlation_id

        return response


def get_request_id(request: Request) -> str:
    """Get the request ID from request state.

    Args:
        request: The FastAPI request object.

    Returns:
        The request ID string.
    """
    return getattr(request.state, "request_id", "unknown")


def get_correlation_id(request: Request) -> str | None:
    """Get the correlation ID from request state if present.

    Args:
        request: The FastAPI request object.

    Returns:
        The correlation ID string or None if not present.
    """
    return getattr(request.state, "correlation_id", None)
