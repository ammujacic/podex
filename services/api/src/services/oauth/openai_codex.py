"""OpenAI Codex OAuth provider for ChatGPT Plus/Pro subscriptions.

Based on the OAuth flow used by OpenAI Codex CLI.
Tokens are JWTs that contain the ChatGPT account ID.
Uses the backend API at chatgpt.com/backend-api for LLM completions.
"""

import base64
import json
import time
from typing import Any
from urllib.parse import urlencode

import httpx
import structlog

from .base import OAuthCredentials, OAuthProvider

logger = structlog.get_logger()

# OAuth configuration (from OpenAI Codex CLI / Pi project)
OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
OPENAI_CODEX_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize"
OPENAI_CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token"
OPENAI_CODEX_SCOPES = "openid profile email offline_access"
# We use a manual code entry flow similar to Anthropic
# The user completes auth in browser and pastes the code or redirect URL
OPENAI_CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback"

# JWT claim path for account ID
JWT_CLAIM_PATH = "https://api.openai.com/auth"


def decode_jwt_payload(token: str) -> dict[str, Any] | None:
    """Decode JWT payload without verification (for extracting account ID).

    Args:
        token: JWT access token

    Returns:
        Decoded payload dict or None if invalid
    """
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        # Add padding for base64 decoding
        payload = parts[1]
        padding = 4 - len(payload) % 4
        if padding != 4:
            payload += "=" * padding
        decoded = base64.urlsafe_b64decode(payload)
        result: dict[str, Any] = json.loads(decoded)
    except Exception:
        return None
    else:
        return result


def get_account_id_from_token(access_token: str) -> str | None:
    """Extract ChatGPT account ID from access token JWT.

    Args:
        access_token: JWT access token

    Returns:
        Account ID string or None if not found
    """
    payload = decode_jwt_payload(access_token)
    if not payload:
        return None
    auth_claim = payload.get(JWT_CLAIM_PATH, {})
    account_id = auth_claim.get("chatgpt_account_id")
    if isinstance(account_id, str) and account_id:
        return account_id
    return None


class OpenAICodexOAuthProvider(OAuthProvider):
    """OAuth provider for OpenAI Codex (ChatGPT Plus/Pro subscriptions)."""

    provider_id = "openai-codex"
    display_name = "OpenAI Codex (ChatGPT Plus/Pro)"

    async def get_auth_url(
        self,
        state: str,
        code_challenge: str,
        redirect_uri: str,  # noqa: ARG002
    ) -> str:
        """Generate OpenAI Codex OAuth authorization URL.

        Uses a local callback approach - the authorization code is passed back
        via redirect URL which the user can paste.
        """
        params = {
            "response_type": "code",
            "client_id": OPENAI_CODEX_CLIENT_ID,
            "redirect_uri": OPENAI_CODEX_REDIRECT_URI,
            "scope": OPENAI_CODEX_SCOPES,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "state": state,
            # Additional params from Codex CLI
            "id_token_add_organizations": "true",
            "codex_cli_simplified_flow": "true",
            "originator": "podex",
        }
        return f"{OPENAI_CODEX_AUTHORIZE_URL}?{urlencode(params)}"

    async def exchange_code(
        self,
        code: str,
        code_verifier: str,
        redirect_uri: str,  # noqa: ARG002
    ) -> OAuthCredentials:
        """Exchange authorization code for OpenAI Codex tokens.

        The code may be in various formats:
        - Just the code
        - code#state format
        - Full URL with code and state params
        """
        # Parse the code - it might be a full URL or code#state format
        actual_code = code
        if "?" in code or "code=" in code:
            # It's a URL or query string
            from urllib.parse import parse_qs, urlparse  # noqa: PLC0415

            if code.startswith("http"):
                parsed = urlparse(code)
                params = parse_qs(parsed.query)
            else:
                params = parse_qs(code)
            actual_code = params.get("code", [code])[0]
        elif "#" in code:
            # code#state format
            actual_code = code.split("#", maxsplit=1)[0]

        # IMPORTANT: OpenAI uses x-www-form-urlencoded, NOT JSON
        async with httpx.AsyncClient() as client:
            response = await client.post(
                OPENAI_CODEX_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "client_id": OPENAI_CODEX_CLIENT_ID,
                    "code": actual_code,
                    "code_verifier": code_verifier,
                    "redirect_uri": OPENAI_CODEX_REDIRECT_URI,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=30.0,
            )

            if response.status_code != 200:
                logger.error(
                    "OpenAI Codex token exchange failed",
                    status=response.status_code,
                    body=response.text,
                )
                msg = f"Token exchange failed: {response.text}"
                raise ValueError(msg)

            data = response.json()

            # Calculate expiration timestamp
            expires_in = data.get("expires_in", 3600)
            expires_at = int(time.time()) + expires_in - 300  # 5 min buffer

            access_token = data["access_token"]

            # Extract account ID from token for verification
            account_id = get_account_id_from_token(access_token)
            if not account_id:
                logger.warning("Could not extract account ID from OpenAI Codex token")

            return OAuthCredentials(
                access_token=access_token,
                refresh_token=data.get("refresh_token"),
                expires_at=expires_at,
                scopes=OPENAI_CODEX_SCOPES,
                token_type=data.get("token_type", "Bearer"),
            )

    async def refresh_token(self, refresh_token: str) -> OAuthCredentials:
        """Refresh an expired OpenAI Codex access token."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                OPENAI_CODEX_TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "client_id": OPENAI_CODEX_CLIENT_ID,
                    "refresh_token": refresh_token,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=30.0,
            )

            if response.status_code != 200:
                logger.error(
                    "OpenAI Codex token refresh failed",
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
                scopes=OPENAI_CODEX_SCOPES,
                token_type=data.get("token_type", "Bearer"),
            )

    async def revoke_token(self, _access_token: str) -> bool:
        """Revoke an OpenAI Codex access token.

        OpenAI doesn't have a public revocation endpoint for Codex tokens.
        Returns True as a no-op since tokens will expire on their own.
        """
        logger.info("OpenAI Codex token revocation requested (no-op)")
        return True

    async def get_user_info(self, access_token: str) -> dict[str, Any]:
        """Get user profile information from the token.

        OpenAI Codex tokens are JWTs that contain user info in claims.
        We decode the token to extract the account ID.
        """
        payload = decode_jwt_payload(access_token)
        if not payload:
            return {}

        auth_claim = payload.get(JWT_CLAIM_PATH, {})
        account_id = auth_claim.get("chatgpt_account_id")

        # Extract standard OIDC claims if present
        return {
            "account_id": account_id,
            "email": payload.get("email"),
            "name": payload.get("name"),
            "sub": payload.get("sub"),
        }


def is_openai_codex_token(token: str) -> bool:
    """Check if a token is an OpenAI Codex OAuth token.

    OpenAI Codex tokens are JWTs that contain the chatgpt_account_id claim.

    Args:
        token: Token string to check

    Returns:
        True if token appears to be an OpenAI Codex JWT
    """
    # Check if it looks like a JWT (three parts separated by dots)
    if token.count(".") != 2:
        return False

    # Try to extract account ID
    account_id = get_account_id_from_token(token)
    return account_id is not None
