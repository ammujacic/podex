"""Base OAuth provider interface."""

import base64
import hashlib
import secrets
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass
class OAuthCredentials:
    """OAuth credentials returned from token exchange."""

    access_token: str
    refresh_token: str | None
    expires_at: int  # Unix timestamp
    scopes: str | None = None
    token_type: str = "Bearer"


@dataclass
class OAuthState:
    """State for OAuth flow (stored temporarily during authorization)."""

    state: str
    code_verifier: str
    redirect_uri: str
    provider: str


class OAuthProvider(ABC):
    """Abstract base class for OAuth providers."""

    # Provider identifier (e.g., "anthropic", "google", "github")
    provider_id: str = ""

    # Display name for UI
    display_name: str = ""

    @abstractmethod
    async def get_auth_url(
        self,
        state: str,
        code_challenge: str,
        redirect_uri: str,
    ) -> str:
        """Generate OAuth authorization URL.

        Args:
            state: Random state for CSRF protection
            code_challenge: PKCE code challenge
            redirect_uri: Callback URL

        Returns:
            Full authorization URL to redirect user to
        """
        ...

    @abstractmethod
    async def exchange_code(
        self,
        code: str,
        code_verifier: str,
        redirect_uri: str,
    ) -> OAuthCredentials:
        """Exchange authorization code for tokens.

        Args:
            code: Authorization code from callback
            code_verifier: PKCE code verifier
            redirect_uri: Must match the redirect_uri used in auth URL

        Returns:
            OAuth credentials with access and refresh tokens
        """
        ...

    @abstractmethod
    async def refresh_token(self, refresh_token: str) -> OAuthCredentials:
        """Refresh an expired access token.

        Args:
            refresh_token: Refresh token from previous credentials

        Returns:
            New OAuth credentials
        """
        ...

    @abstractmethod
    async def revoke_token(self, access_token: str) -> bool:
        """Revoke an access token.

        Args:
            access_token: Token to revoke

        Returns:
            True if revocation succeeded
        """
        ...

    @abstractmethod
    async def get_user_info(self, access_token: str) -> dict[str, Any]:
        """Get user profile information.

        Args:
            access_token: Valid access token

        Returns:
            Dict with user profile info (email, name, etc.)
        """
        ...

    def is_token_expired(self, expires_at: int, buffer_seconds: int = 300) -> bool:
        """Check if token is expired or will expire soon.

        Args:
            expires_at: Token expiration timestamp
            buffer_seconds: Consider expired if within this many seconds

        Returns:
            True if token is expired or expiring soon
        """
        return time.time() >= (expires_at - buffer_seconds)


def generate_pkce() -> tuple[str, str]:
    """Generate PKCE code verifier and challenge.

    Returns:
        Tuple of (code_verifier, code_challenge)
    """
    # Generate random verifier (43-128 characters)
    code_verifier = secrets.token_urlsafe(32)

    # Create SHA256 hash and base64url encode
    code_challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode()).digest())
        .decode()
        .rstrip("=")
    )

    return code_verifier, code_challenge


def generate_state() -> str:
    """Generate random state for OAuth flow."""
    return secrets.token_urlsafe(32)
