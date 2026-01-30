"""Shared dependencies for agent service routes."""

import secrets
from typing import Annotated

import structlog
from fastapi import Header, HTTPException, status

from src.config import settings

logger = structlog.get_logger()


def require_internal_service_token(
    x_internal_service_token: Annotated[
        str | None, Header(alias="X-Internal-Service-Token")
    ] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """Require a valid internal service token for access.

    Validates service token in X-Internal-Service-Token header
    or Authorization: Bearer header.

    SECURITY: Token is always required - no bypass for development mode.

    Args:
        x_internal_service_token: Service token header
        authorization: Bearer token header (alternative)
    """
    expected_token = settings.INTERNAL_SERVICE_TOKEN
    if not expected_token:
        # SECURITY: Fail closed - if no token configured, reject all requests
        logger.error("INTERNAL_SERVICE_TOKEN not configured - rejecting request")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Service authentication not configured",
        )

    # Extract token from either header
    token = None
    if x_internal_service_token:
        token = x_internal_service_token
    elif authorization and authorization.startswith("Bearer "):
        token = authorization[7:]

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing service token",
        )

    # SECURITY: Use constant-time comparison to prevent timing attacks
    if not secrets.compare_digest(token, expected_token):
        logger.warning("Invalid service token received")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid service token",
        )

    logger.debug("Request authenticated via service token")
