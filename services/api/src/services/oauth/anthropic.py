"""Anthropic OAuth provider for Claude Pro/Max personal plans.

Based on the OAuth flow used by Claude Code CLI.
Tokens have the prefix "sk-ant-oat-" and can be used with the Anthropic SDK.
"""

import time
from typing import Any
from urllib.parse import urlencode

import httpx
import structlog

from .base import OAuthCredentials, OAuthProvider

logger = structlog.get_logger()

# OAuth configuration (from Claude Code CLI)
ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
ANTHROPIC_AUTHORIZE_URL = "https://claude.ai/oauth/authorize"
ANTHROPIC_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token"
ANTHROPIC_REVOKE_URL = "https://console.anthropic.com/v1/oauth/revoke"
ANTHROPIC_USERINFO_URL = "https://api.anthropic.com/v1/me"
ANTHROPIC_SCOPES = "org:create_api_key user:profile user:inference"


class AnthropicOAuthProvider(OAuthProvider):
    """OAuth provider for Anthropic Claude personal plans."""

    provider_id = "anthropic"
    display_name = "Anthropic (Claude Pro/Max)"

    async def get_auth_url(
        self,
        state: str,
        code_challenge: str,
        redirect_uri: str,
    ) -> str:
        """Generate Anthropic OAuth authorization URL."""
        params = {
            "code": "true",
            "client_id": ANTHROPIC_CLIENT_ID,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "scope": ANTHROPIC_SCOPES,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "state": state,
        }
        return f"{ANTHROPIC_AUTHORIZE_URL}?{urlencode(params)}"

    async def exchange_code(
        self,
        code: str,
        code_verifier: str,
        redirect_uri: str,
    ) -> OAuthCredentials:
        """Exchange authorization code for Anthropic tokens."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                ANTHROPIC_TOKEN_URL,
                json={
                    "grant_type": "authorization_code",
                    "client_id": ANTHROPIC_CLIENT_ID,
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "code_verifier": code_verifier,
                },
                headers={"Content-Type": "application/json"},
                timeout=30.0,
            )

            if response.status_code != 200:
                logger.error(
                    "Anthropic token exchange failed",
                    status=response.status_code,
                    body=response.text,
                )
                msg = f"Token exchange failed: {response.text}"
                raise ValueError(msg)

            data = response.json()

            # Calculate expiration timestamp
            expires_in = data.get("expires_in", 3600)
            expires_at = int(time.time()) + expires_in - 300  # 5 min buffer

            return OAuthCredentials(
                access_token=data["access_token"],
                refresh_token=data.get("refresh_token"),
                expires_at=expires_at,
                scopes=ANTHROPIC_SCOPES,
                token_type=data.get("token_type", "Bearer"),
            )

    async def refresh_token(self, refresh_token: str) -> OAuthCredentials:
        """Refresh an expired Anthropic access token."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                ANTHROPIC_TOKEN_URL,
                json={
                    "grant_type": "refresh_token",
                    "client_id": ANTHROPIC_CLIENT_ID,
                    "refresh_token": refresh_token,
                },
                headers={"Content-Type": "application/json"},
                timeout=30.0,
            )

            if response.status_code != 200:
                logger.error(
                    "Anthropic token refresh failed",
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
                scopes=ANTHROPIC_SCOPES,
                token_type=data.get("token_type", "Bearer"),
            )

    async def revoke_token(self, access_token: str) -> bool:
        """Revoke an Anthropic access token."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    ANTHROPIC_REVOKE_URL,
                    json={"token": access_token},
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {access_token}",
                    },
                    timeout=30.0,
                )
                return response.status_code in (200, 204)
        except Exception as e:
            logger.warning("Anthropic token revocation failed", error=str(e))
            return False

    async def get_user_info(self, access_token: str) -> dict[str, Any]:
        """Get Anthropic user profile information."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                ANTHROPIC_USERINFO_URL,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "anthropic-dangerous-direct-browser-access": "true",
                },
                timeout=30.0,
            )

            if response.status_code != 200:
                logger.warning(
                    "Failed to get Anthropic user info",
                    status=response.status_code,
                )
                return {}

            data: dict[str, Any] = response.json()
            return data


def is_anthropic_oauth_token(token: str) -> bool:
    """Check if a token is an Anthropic OAuth token.

    Args:
        token: Token string to check

    Returns:
        True if token has OAuth prefix (sk-ant-oat-)
    """
    return token.startswith("sk-ant-oat")
