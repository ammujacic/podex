"""Google OAuth provider for Gemini CLI / Code Assist access.

Uses Google OAuth 2.0 with scopes for Gemini API access.
Supports both free tier (AI Studio) and paid Code Assist subscriptions.
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

# Code Assist API endpoints
GOOGLE_CODE_ASSIST_DISCOVER_URL = (
    "https://cloudcode-pa.googleapis.com/v1/discover/freeTierCloudAICompanion"
)
GOOGLE_CODE_ASSIST_PROJECT_URL = (
    "https://cloudcode-pa.googleapis.com/v1/freeTierCloudAICompanion:provisionFreeInstance"
)

# Scopes for Gemini CLI / Code Assist access
# cloud-platform is required for Code Assist API
# generative-language scopes for AI Studio fallback
GOOGLE_SCOPES = (
    "https://www.googleapis.com/auth/cloud-platform "
    "https://www.googleapis.com/auth/generative-language.retriever "
    "https://www.googleapis.com/auth/generative-language.tuning "
    "https://www.googleapis.com/auth/userinfo.email "
    "https://www.googleapis.com/auth/userinfo.profile "
    "openid"
)


class GoogleOAuthProvider(OAuthProvider):
    """OAuth provider for Google Gemini CLI / Code Assist.

    Supports multiple tiers:
    - Free tier: Uses AI Studio API (generativelanguage.googleapis.com)
    - Code Assist: Uses Cloud Code Assist API with project ID
    - Enterprise: Uses Vertex AI with explicit project configuration
    """

    provider_id = "google"
    display_name = "Google (Gemini CLI)"

    def __init__(self) -> None:
        """Initialize with client credentials from environment."""
        self.client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")
        self.client_secret = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "")
        # Optional: explicit project ID for enterprise/paid Code Assist
        self.cloud_project = os.environ.get("GOOGLE_CLOUD_PROJECT", "")

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

    async def discover_code_assist_project(self, access_token: str) -> dict[str, Any] | None:
        """Discover user's existing Code Assist project.

        This checks if the user already has a free tier Code Assist project
        provisioned for their Google account.

        Args:
            access_token: Google OAuth access token

        Returns:
            Project info dict with 'project_id' and 'billing_type', or None if not found
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    GOOGLE_CODE_ASSIST_DISCOVER_URL,
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json",
                    },
                    timeout=30.0,
                )

                if response.status_code == 200:
                    data = response.json()
                    project_id = data.get("cloudAiCompanionProjectId")
                    if project_id:
                        return {
                            "project_id": project_id,
                            "billing_type": data.get("billingType", "FREE"),
                        }
                elif response.status_code == 404:
                    # No project exists yet
                    return None
                else:
                    logger.warning(
                        "Code Assist discovery returned unexpected status",
                        status=response.status_code,
                        body=response.text,
                    )
                    return None

        except Exception as e:
            logger.warning("Failed to discover Code Assist project", error=str(e))
            return None

        return None

    async def provision_free_tier_project(self, access_token: str) -> dict[str, Any] | None:
        """Provision a new free tier Code Assist project.

        Creates a new Google Cloud project with Code Assist enabled for the user.
        This is used when the user doesn't have an existing project.

        Args:
            access_token: Google OAuth access token

        Returns:
            Project info dict with 'project_id', or None if provisioning failed
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    GOOGLE_CODE_ASSIST_PROJECT_URL,
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json",
                    },
                    json={},  # Empty body for provisioning request
                    timeout=60.0,  # Provisioning can take longer
                )

                if response.status_code == 200:
                    data = response.json()
                    project_id = data.get("cloudAiCompanionProjectId")
                    if project_id:
                        logger.info(
                            "Provisioned free tier Code Assist project",
                            project_id=project_id,
                        )
                        return {
                            "project_id": project_id,
                            "billing_type": "FREE",
                        }
                else:
                    logger.error(
                        "Failed to provision Code Assist project",
                        status=response.status_code,
                        body=response.text,
                    )
                    return None

        except Exception as e:
            logger.exception("Failed to provision Code Assist project", error=str(e))
            return None

        return None

    async def get_gemini_api_config(self, access_token: str) -> dict[str, Any]:
        """Get Gemini API configuration for the user.

        Determines the appropriate API base URL and project ID based on:
        1. Explicit GOOGLE_CLOUD_PROJECT env var (enterprise)
        2. Discovered/provisioned Code Assist project
        3. Fallback to AI Studio (free tier without project)

        Args:
            access_token: Google OAuth access token

        Returns:
            Dict with 'base_url', 'project_id' (optional), and 'tier'
        """
        # Check for explicit enterprise project configuration
        if self.cloud_project:
            return {
                "base_url": f"https://{self.cloud_project}-aiplatform.googleapis.com",
                "project_id": self.cloud_project,
                "tier": "enterprise",
            }

        # Try to discover existing Code Assist project
        project_info = await self.discover_code_assist_project(access_token)

        if project_info:
            project_id = project_info["project_id"]
            return {
                "base_url": "https://generativelanguage.googleapis.com",
                "project_id": project_id,
                "tier": project_info.get("billing_type", "FREE").lower(),
            }

        # Try to provision a new free tier project
        project_info = await self.provision_free_tier_project(access_token)

        if project_info:
            project_id = project_info["project_id"]
            return {
                "base_url": "https://generativelanguage.googleapis.com",
                "project_id": project_id,
                "tier": "free",
            }

        # Fallback to AI Studio without project (basic free tier)
        logger.warning("No Code Assist project available, using AI Studio fallback")
        return {
            "base_url": "https://generativelanguage.googleapis.com",
            "project_id": None,
            "tier": "ai_studio",
        }
