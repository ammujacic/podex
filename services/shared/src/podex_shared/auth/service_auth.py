"""Service-to-service authentication using service tokens.

This module provides a unified authentication client for inter-service communication.

Usage:
    from podex_shared.auth import ServiceAuthClient

    # Create client for a target service
    auth = ServiceAuthClient(
        target_url="https://compute.podex.dev",
        api_key="your-service-token",
    )

    # Get auth headers for requests
    headers = await auth.get_auth_headers()
    # Returns {"X-Internal-Service-Token": "your-service-token"}
"""

from __future__ import annotations

import structlog

logger = structlog.get_logger()


class ServiceAuthClient:
    """Service-to-service authentication client using API keys.

    Provides consistent authentication headers for inter-service communication.
    """

    def __init__(
        self,
        target_url: str,
        api_key: str | None = None,
        environment: str = "development",  # Kept for backwards compatibility
        api_key_header: str = "X-Internal-Service-Token",
    ) -> None:
        """Initialize the auth client.

        Args:
            target_url: The URL of the service being called (for logging)
            api_key: Service token for authentication (required)
            environment: Environment name (kept for backwards compatibility, unused)
            api_key_header: Header name for service token auth (default: X-Internal-Service-Token)
        """
        self.target_url = target_url.rstrip("/")
        self.api_key = api_key
        self.api_key_header = api_key_header
        # Environment kept for backwards compatibility but not used
        self._environment = environment

    async def get_auth_headers(self) -> dict[str, str]:
        """Get authentication headers for the target service.

        Returns:
            Dict with {api_key_header: "<key>"} if key configured, {} otherwise

        Raises:
            ValueError: If no API key is configured
        """
        if not self.api_key:
            logger.error(
                "No API key configured for service auth",
                target_url=self.target_url,
            )
            raise ValueError(f"No API key configured for {self.target_url}")

        return {self.api_key_header: self.api_key}

    def clear_cache(self) -> None:
        """Clear any cached data. No-op for API key auth, kept for compatibility."""
        pass


async def get_service_auth_headers(
    target_url: str,
    environment: str,  # Kept for backwards compatibility
    api_key: str | None = None,
    api_key_header: str = "X-Internal-Service-Token",
) -> dict[str, str]:
    """Convenience function to get auth headers without creating a client.

    For one-off requests. For repeated requests to the same service,
    use ServiceAuthClient to benefit from any future caching.

    Args:
        target_url: The URL of the service being called
        environment: Environment name (kept for backwards compatibility, unused)
        api_key: Service token for authentication
        api_key_header: Header name for service token auth

    Returns:
        Dict with authentication headers

    Raises:
        ValueError: If no API key is configured
    """
    client = ServiceAuthClient(
        target_url=target_url,
        api_key=api_key,
        environment=environment,
        api_key_header=api_key_header,
    )
    return await client.get_auth_headers()
