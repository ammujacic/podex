"""GitHub OAuth provider for Copilot/Codex access.

Uses GitHub OAuth 2.0 with device flow or authorization code flow.
Provides access to GitHub Copilot APIs when user has Copilot subscription.
"""

import base64
import json
import os
import time
from typing import Any
from urllib.parse import urlencode

import httpx
import structlog

from .base import OAuthCredentials, OAuthProvider

logger = structlog.get_logger()

# GitHub OAuth configuration
GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USERINFO_URL = "https://api.github.com/user"
GITHUB_COPILOT_CHECK_URL = "https://api.github.com/copilot_internal/v2/token"

# Scopes for Copilot access
GITHUB_SCOPES = "read:user user:email copilot"


class GitHubOAuthProvider(OAuthProvider):
    """OAuth provider for GitHub Copilot/Codex access."""

    provider_id = "github"
    display_name = "GitHub (Copilot)"

    def __init__(self) -> None:
        """Initialize with client credentials from environment."""
        self.client_id = os.environ.get("GITHUB_OAUTH_CLIENT_ID", "")
        self.client_secret = os.environ.get("GITHUB_OAUTH_CLIENT_SECRET", "")

        if not self.client_id or not self.client_secret:
            logger.warning(
                "GitHub OAuth credentials not configured",
                has_client_id=bool(self.client_id),
                has_client_secret=bool(self.client_secret),
            )

    async def get_auth_url(
        self,
        state: str,
        code_challenge: str,  # noqa: ARG002
        redirect_uri: str,
    ) -> str:
        """Generate GitHub OAuth authorization URL.

        Note: GitHub doesn't support PKCE, so code_challenge is ignored.
        """
        params = {
            "client_id": self.client_id,
            "redirect_uri": redirect_uri,
            "scope": GITHUB_SCOPES,
            "state": state,
            "allow_signup": "false",
        }
        return f"{GITHUB_AUTHORIZE_URL}?{urlencode(params)}"

    async def exchange_code(
        self,
        code: str,
        code_verifier: str,  # noqa: ARG002
        redirect_uri: str,
    ) -> OAuthCredentials:
        """Exchange authorization code for GitHub tokens.

        Note: GitHub doesn't use PKCE, so code_verifier is ignored.
        GitHub tokens don't expire by default (unless configured).
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                GITHUB_TOKEN_URL,
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "code": code,
                    "redirect_uri": redirect_uri,
                },
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                timeout=30.0,
            )

            if response.status_code != 200:
                logger.error(
                    "GitHub token exchange failed",
                    status=response.status_code,
                    body=response.text,
                )
                msg = f"Token exchange failed: {response.text}"
                raise ValueError(msg)

            data = response.json()

            if "error" in data:
                error_detail = data.get("error_description", data["error"])
                msg = f"Token exchange failed: {error_detail}"
                raise ValueError(msg)

            # GitHub tokens don't expire by default, set far future expiry
            # If the org has token expiry enabled, expires_in will be set
            expires_in = data.get("expires_in")
            if expires_in:
                expires_at = int(time.time()) + expires_in - 300
            else:
                # 1 year from now for non-expiring tokens
                expires_at = int(time.time()) + 365 * 24 * 60 * 60

            return OAuthCredentials(
                access_token=data["access_token"],
                refresh_token=data.get("refresh_token"),
                expires_at=expires_at,
                scopes=data.get("scope", GITHUB_SCOPES),
                token_type=data.get("token_type", "bearer"),
            )

    async def refresh_token(self, refresh_token: str) -> OAuthCredentials:
        """Refresh a GitHub access token.

        Note: Only works if the org has token expiry enabled.
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                GITHUB_TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "refresh_token": refresh_token,
                },
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                timeout=30.0,
            )

            if response.status_code != 200:
                logger.error(
                    "GitHub token refresh failed",
                    status=response.status_code,
                    body=response.text,
                )
                msg = f"Token refresh failed: {response.text}"
                raise ValueError(msg)

            data = response.json()

            if "error" in data:
                error_detail = data.get("error_description", data["error"])
                msg = f"Token refresh failed: {error_detail}"
                raise ValueError(msg)

            expires_in = data.get("expires_in")
            if expires_in:
                expires_at = int(time.time()) + expires_in - 300
            else:
                expires_at = int(time.time()) + 365 * 24 * 60 * 60

            return OAuthCredentials(
                access_token=data["access_token"],
                refresh_token=data.get("refresh_token", refresh_token),
                expires_at=expires_at,
                scopes=data.get("scope", GITHUB_SCOPES),
                token_type=data.get("token_type", "bearer"),
            )

    async def revoke_token(self, access_token: str) -> bool:
        """Revoke a GitHub access token.

        GitHub requires app credentials to revoke tokens.
        """
        try:
            async with httpx.AsyncClient() as client:
                # GitHub uses Basic auth with client_id:client_secret
                auth = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode()

                response = await client.request(
                    "DELETE",
                    f"https://api.github.com/applications/{self.client_id}/token",
                    content=json.dumps({"access_token": access_token}).encode(),
                    headers={
                        "Authorization": f"Basic {auth}",
                        "Accept": "application/vnd.github+json",
                        "Content-Type": "application/json",
                    },
                    timeout=30.0,
                )
                return response.status_code == 204
        except Exception as e:
            logger.warning("GitHub token revocation failed", error=str(e))
            return False

    async def get_user_info(self, access_token: str) -> dict[str, Any]:
        """Get GitHub user profile information."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                GITHUB_USERINFO_URL,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/vnd.github+json",
                },
                timeout=30.0,
            )

            if response.status_code != 200:
                logger.warning(
                    "Failed to get GitHub user info",
                    status=response.status_code,
                )
                return {}

            data: dict[str, Any] = response.json()

            # Also get email if not public
            if not data.get("email"):
                email_response = await client.get(
                    "https://api.github.com/user/emails",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Accept": "application/vnd.github+json",
                    },
                    timeout=30.0,
                )
                if email_response.status_code == 200:
                    emails = email_response.json()
                    primary = next(
                        (e for e in emails if e.get("primary")),
                        emails[0] if emails else None,
                    )
                    if primary:
                        data["email"] = primary.get("email")

            return data

    async def check_copilot_access(self, access_token: str) -> bool:
        """Check if user has Copilot access.

        Args:
            access_token: GitHub access token

        Returns:
            True if user has active Copilot subscription
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    GITHUB_COPILOT_CHECK_URL,
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Accept": "application/json",
                    },
                    timeout=30.0,
                )
                return response.status_code == 200
        except Exception:
            return False
