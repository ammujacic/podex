"""Service-to-service authentication that works locally and in GCP.

This module provides a unified authentication client that:
- In production (GCP Cloud Run): Uses GCP ID tokens from the metadata server
- In development (Docker): Uses API key headers (existing behavior)

Usage:
    from podex_shared.auth import ServiceAuthClient

    # Create client for a target service
    auth = ServiceAuthClient(
        target_url="https://compute.podex.dev",
        api_key="dev-key",  # Used in development
        environment="production",  # or "development"
    )

    # Get auth headers for requests
    headers = await auth.get_auth_headers()
    # Returns {"Authorization": "Bearer <id_token>"} in production
    # Returns {"X-Internal-API-Key": "dev-key"} in development
"""

from __future__ import annotations

import time
from typing import Any

import httpx
import structlog

logger = structlog.get_logger()

# GCP metadata server URL for fetching ID tokens
_METADATA_SERVER_URL = "http://metadata.google.internal/computeMetadata/v1"
_METADATA_TOKEN_PATH = "/instance/service-accounts/default/identity"

# Token cache with expiration buffer (refresh 5 minutes before expiry)
_TOKEN_EXPIRY_BUFFER_SECONDS = 300


class ServiceAuthClient:
    """Service-to-service authentication client.

    Provides dual-mode authentication:
    - Production (GCP): Fetches ID tokens from the GCP metadata server
    - Development (Docker): Uses API key headers

    The client caches ID tokens and automatically refreshes them before expiry.
    """

    def __init__(
        self,
        target_url: str,
        api_key: str | None = None,
        environment: str = "development",
        api_key_header: str = "X-Internal-API-Key",
    ) -> None:
        """Initialize the auth client.

        Args:
            target_url: The URL of the service being called (used as audience for ID tokens)
            api_key: API key for development mode authentication
            environment: Environment name from settings (production, development, staging).
                        Callers should pass settings.ENVIRONMENT explicitly.
            api_key_header: Header name for API key auth (default: X-Internal-API-Key)
        """
        self.target_url = target_url.rstrip("/")
        self.api_key = api_key
        self.api_key_header = api_key_header

        # Environment from settings - callers must pass this explicitly
        self._environment = environment
        self._is_production = self._environment == "production"

        # Token cache
        self._cached_token: str | None = None
        self._token_expiry: float = 0

    @property
    def is_production(self) -> bool:
        """Check if running in production mode."""
        return self._is_production

    async def get_auth_headers(self) -> dict[str, str]:
        """Get authentication headers for the target service.

        Returns:
            Dict with either:
            - {"Authorization": "Bearer <token>"} in production
            - {api_key_header: "<key>"} in development
            - {} if no auth configured
        """
        if self._is_production:
            return await self._get_gcp_id_token_headers()
        else:
            return self._get_api_key_headers()

    def _get_api_key_headers(self) -> dict[str, str]:
        """Get API key headers for development mode."""
        if self.api_key:
            return {self.api_key_header: self.api_key}
        return {}

    async def _get_gcp_id_token_headers(self) -> dict[str, str]:
        """Get GCP ID token headers for production mode.

        Fetches an ID token from the GCP metadata server with the target
        service URL as the audience. Caches the token and refreshes
        automatically before expiry.
        """
        # Check if we have a valid cached token
        if self._cached_token and time.time() < self._token_expiry:
            return {"Authorization": f"Bearer {self._cached_token}"}

        try:
            id_token = await self._fetch_id_token()
            if id_token:
                # Cache the token with a buffer before expiry
                # GCP ID tokens are valid for 1 hour
                self._cached_token = id_token
                self._token_expiry = time.time() + 3600 - _TOKEN_EXPIRY_BUFFER_SECONDS
                return {"Authorization": f"Bearer {id_token}"}
        except Exception as e:
            logger.warning(
                "Failed to fetch GCP ID token, falling back to API key",
                error=str(e),
                target_url=self.target_url,
            )
            # Fall back to API key if available
            return self._get_api_key_headers()

        return {}

    async def _fetch_id_token(self) -> str | None:
        """Fetch an ID token from the GCP metadata server.

        Returns:
            The ID token string, or None if unavailable
        """
        # Build the metadata server URL with audience parameter
        # The audience must match the target service URL
        metadata_url = f"{_METADATA_SERVER_URL}{_METADATA_TOKEN_PATH}?audience={self.target_url}"

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    metadata_url,
                    headers={"Metadata-Flavor": "Google"},
                )
                response.raise_for_status()
                token = response.text
                logger.debug(
                    "Successfully fetched GCP ID token",
                    target_url=self.target_url,
                    token_length=len(token),
                )
                return token
        except httpx.ConnectError:
            # Not running on GCP - metadata server not available
            logger.debug(
                "GCP metadata server not available, not running on GCP",
                target_url=self.target_url,
            )
            return None
        except httpx.HTTPStatusError as e:
            logger.warning(
                "Failed to fetch ID token from metadata server",
                status_code=e.response.status_code,
                target_url=self.target_url,
            )
            return None
        except Exception as e:
            logger.warning(
                "Unexpected error fetching ID token",
                error=str(e),
                target_url=self.target_url,
            )
            return None

    def clear_cache(self) -> None:
        """Clear the cached token. Useful for testing or forced refresh."""
        self._cached_token = None
        self._token_expiry = 0


async def get_service_auth_headers(
    target_url: str,
    environment: str,
    api_key: str | None = None,
    api_key_header: str = "X-Internal-API-Key",
) -> dict[str, str]:
    """Convenience function to get auth headers without creating a client.

    For one-off requests. For repeated requests to the same service,
    use ServiceAuthClient to benefit from token caching.

    Args:
        target_url: The URL of the service being called
        environment: Environment name from settings (production, development, staging).
                    Callers should pass settings.ENVIRONMENT explicitly.
        api_key: API key for development mode
        api_key_header: Header name for API key auth

    Returns:
        Dict with authentication headers
    """
    client = ServiceAuthClient(
        target_url=target_url,
        api_key=api_key,
        environment=environment,
        api_key_header=api_key_header,
    )
    return await client.get_auth_headers()


def validate_gcp_id_token(
    token: str, expected_audience: str | None = None
) -> dict[str, Any] | None:
    """Validate a GCP ID token and return its claims.

    Note: In production with Cloud Run, the token is already validated
    by Cloud Run's IAM layer before the request reaches the application.
    This function is useful for additional validation or extracting claims.

    Args:
        token: The ID token to validate
        expected_audience: Optional audience to verify

    Returns:
        Token claims dict if valid, None if invalid
    """
    try:
        # Import google-auth library for token verification
        from google.auth.transport import requests  # type: ignore[import-untyped]  # noqa: PLC0415
        from google.oauth2 import id_token  # type: ignore[import-untyped]  # noqa: PLC0415

        # Verify the token using Google's public keys
        request = requests.Request()
        claims = id_token.verify_oauth2_token(  # type: ignore[no-untyped-call]
            token, request, expected_audience
        )
        return dict(claims)
    except ImportError:
        logger.warning("google-auth library not installed, cannot validate token")
        return None
    except Exception as e:
        logger.warning("Token validation failed", error=str(e))
        return None
