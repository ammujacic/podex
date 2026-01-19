"""Shared dependencies for agent service routes."""

import secrets
from typing import Annotated

from fastapi import Header, HTTPException, status

from src.config import settings


def require_internal_service_token(
    x_internal_service_token: Annotated[
        str | None, Header(alias="X-Internal-Service-Token")
    ] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """Require a valid internal service token for access."""
    expected_token = settings.INTERNAL_SERVICE_TOKEN
    if not expected_token:
        if settings.ENVIRONMENT == "production":
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal service token not configured",
            )
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
