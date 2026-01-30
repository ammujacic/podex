"""Google OAuth provider for Gemini personal plans.

Uses Google OAuth 2.0 with scopes for Gemini API access.
"""

import os
import time
from typing import Any
from urllib.parse import urlencode

import httpx
import structlog

from .base import OAuthCredentials, OAuthProvider

logger = structlog.get_logger()

# Google OAuth configuration
# Note: These need to be configured in your Google Cloud Console project
# and set via environment variables
GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

# Scopes for Gemini API access
GOOGLE_SCOPES = (
    "https://www.googleapis.com/auth/generative-language.retriever "
    "https://www.googleapis.com/auth/generative-language.tuning "
    "https://www.googleapis.com/auth/userinfo.email "
    "https://www.googleapis.com/auth/userinfo.profile "
    "openid"
)


class GoogleOAuthProvider(OAuthProvider):
    """OAuth provider for Google Gemini personal plans."""

    provider_id = "google"
    display_name = "Google (Gemini)"

    def __init__(self) -> None:
        """Initialize with client credentials from environment."""
        self.client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")
        self.client_secret = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "")

        if not self.client_id or not self.client_secret:
            logger.warning(
                "Google OAuth credentials not configured",
                has_client_id=bool(self.client_id),
                has_client_secret=bool(self.client_secret),
            )

    async def get_auth_url(
        self,
        state: str,
        code_challenge: str,
        redirect_uri: str,
    ) -> str:
        """Generate Google OAuth authorization URL."""
        params = {
            "client_id": self.client_id,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "scope": GOOGLE_SCOPES,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "state": state,
            "access_type": "offline",  # Request refresh token
            "prompt": "consent",  # Force consent screen to get refresh token
        }
        return f"{GOOGLE_AUTHORIZE_URL}?{urlencode(params)}"

    async def exchange_code(
        self,
        code: str,
        code_verifier: str,
        redirect_uri: str,
    ) -> OAuthCredentials:
        """Exchange authorization code for Google tokens."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "code_verifier": code_verifier,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=30.0,
            )

            if response.status_code != 200:
                logger.error(
                    "Google token exchange failed",
                    status=response.status_code,
                    body=response.text,
                )
                msg = f"Token exchange failed: {response.text}"
                raise ValueError(msg)

            data = response.json()

            expires_in = data.get("expires_in", 3600)
            expires_at = int(time.time()) + expires_in - 300

            return OAuthCredentials(
                access_token=data["access_token"],
                refresh_token=data.get("refresh_token"),
                expires_at=expires_at,
                scopes=data.get("scope", GOOGLE_SCOPES),
                token_type=data.get("token_type", "Bearer"),
            )

    async def refresh_token(self, refresh_token: str) -> OAuthCredentials:
        """Refresh an expired Google access token."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "refresh_token": refresh_token,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=30.0,
            )

            if response.status_code != 200:
                logger.error(
                    "Google token refresh failed",
                    status=response.status_code,
                    body=response.text,
                )
                msg = f"Token refresh failed: {response.text}"
                raise ValueError(msg)

            data = response.json()

            expires_in = data.get("expires_in", 3600)
            expires_at = int(time.time()) + expires_in - 300

            return OAuthCredentials(
                access_token=data["access_token"],
                refresh_token=data.get("refresh_token", refresh_token),
                expires_at=expires_at,
                scopes=data.get("scope", GOOGLE_SCOPES),
                token_type=data.get("token_type", "Bearer"),
            )

    async def revoke_token(self, access_token: str) -> bool:
        """Revoke a Google access token."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    GOOGLE_REVOKE_URL,
                    data={"token": access_token},
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    timeout=30.0,
                )
                return response.status_code == 200
        except Exception as e:
            logger.warning("Google token revocation failed", error=str(e))
            return False

    async def get_user_info(self, access_token: str) -> dict[str, Any]:
        """Get Google user profile information."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=30.0,
            )

            if response.status_code != 200:
                logger.warning(
                    "Failed to get Google user info",
                    status=response.status_code,
                )
                return {}

            data: dict[str, Any] = response.json()
            return data
