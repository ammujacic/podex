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

    Supports dual-mode authentication:
    - Production (GCP Cloud Run): GCP ID token in Authorization header
      The token is validated by Cloud Run's IAM layer before reaching here.
    - Development (Docker): Service token in X-Internal-Service-Token header
      or Authorization: Bearer header

    Args:
        x_internal_service_token: Service token header (development mode)
        authorization: Bearer token header (both modes)
    """
    if settings.ENVIRONMENT == "production":
        # In production, Cloud Run validates the ID token via IAM
        # The request only reaches here if IAM allowed it
        if authorization and authorization.startswith("Bearer "):
            # Token validated by Cloud Run IAM - allow request
            logger.debug("Request authenticated via GCP IAM")
            return

        # Check for service token as fallback (gradual migration)
        expected_token = settings.INTERNAL_SERVICE_TOKEN
        if expected_token and x_internal_service_token:
            if secrets.compare_digest(x_internal_service_token, expected_token):
                logger.debug("Request authenticated via service token (production fallback)")
                return

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authentication",
        )

    # Development mode: Use service token authentication
    expected_token = settings.INTERNAL_SERVICE_TOKEN
    if not expected_token:
        # No token configured in development - allow all requests
        logger.debug("No internal service token configured, allowing request (dev mode)")
        return

    token = None
    if x_internal_service_token:
        token = x_internal_service_token
    elif authorization and authorization.startswith("Bearer "):
        token = authorization[7:]

    if not token or not secrets.compare_digest(token, expected_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid service token",
        )
