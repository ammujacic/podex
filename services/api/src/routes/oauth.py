"""OAuth routes for LLM provider authentication.

Handles OAuth flows for personal plan providers:
- Anthropic (Claude Pro/Max)
- OpenAI Codex (ChatGPT Plus/Pro)
- Google (Gemini CLI)
- GitHub (Copilot)
"""

import json
import time
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.connection import get_db
from src.database.models import UserOAuthToken
from src.middleware.auth import get_current_user_id
from src.middleware.rate_limit import (
    RATE_LIMIT_OAUTH,
    RATE_LIMIT_STANDARD,
    get_redis_client,
    limiter,
)
from src.services.oauth import (
    OAUTH_PROVIDERS,
    OAuthCredentials,
    get_oauth_provider,
)
from src.services.oauth.base import generate_pkce, generate_state

logger = structlog.get_logger()

router = APIRouter(tags=["llm-oauth"])

# Type alias for database session dependency
DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUserId = Annotated[str, Depends(get_current_user_id)]

# Redis key prefix for OAuth state storage
OAUTH_STATE_PREFIX = "podex:oauth:state:"
OAUTH_STATE_TTL = 600  # 10 minutes


async def _store_oauth_state(state: str, data: dict[str, Any]) -> None:
    """Store OAuth state in Redis."""
    try:
        redis = await get_redis_client()
        await redis.set(
            f"{OAUTH_STATE_PREFIX}{state}",
            json.dumps(data),
            ex=OAUTH_STATE_TTL,
        )
    except Exception:
        logger.exception("Failed to store OAuth state in Redis")
        raise HTTPException(status_code=500, detail="Failed to initiate OAuth flow")


async def _get_and_delete_oauth_state(state: str) -> dict[str, Any] | None:
    """Get and delete OAuth state from Redis (atomic pop)."""
    try:
        redis = await get_redis_client()
        key = f"{OAUTH_STATE_PREFIX}{state}"
        data = await redis.get(key)
        if data:
            await redis.delete(key)
            result: dict[str, Any] = json.loads(data)
            return result
    except Exception:
        logger.exception("Failed to retrieve OAuth state from Redis")
        return None
    else:
        return None


class OAuthStartResponse(BaseModel):
    """Response for starting OAuth flow."""

    auth_url: str
    state: str


class OAuthCallbackRequest(BaseModel):
    """Request for OAuth callback."""

    code: str
    state: str


class OAuthTokenResponse(BaseModel):
    """Response with OAuth connection status."""

    provider: str
    status: str
    email: str | None = None
    name: str | None = None
    expires_at: int | None = None


class OAuthConnectionsResponse(BaseModel):
    """Response listing all OAuth connections."""

    connections: list[OAuthTokenResponse]


@router.get("/providers")
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_oauth_providers(request: Request, response: Response) -> dict[str, Any]:
    """List available OAuth providers."""
    providers = []
    for provider_id, provider_class in OAUTH_PROVIDERS.items():
        instance = provider_class()
        providers.append(
            {
                "id": provider_id,
                "name": instance.display_name,
                "configured": _is_provider_configured(provider_id),
            }
        )
    return {"providers": providers}


@router.get("/connections", response_model=OAuthConnectionsResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_oauth_connections(
    request: Request,
    response: Response,
    user_id: CurrentUserId,
    db: DbSession,
) -> OAuthConnectionsResponse:
    """List all OAuth connections for the current user."""
    result = await db.execute(select(UserOAuthToken).where(UserOAuthToken.user_id == user_id))
    tokens = result.scalars().all()

    connections = []
    for token in tokens:
        profile = token.profile_info or {}
        connections.append(
            OAuthTokenResponse(
                provider=token.provider,
                status=token.status,
                email=profile.get("email"),
                name=profile.get("name") or profile.get("login"),
                expires_at=token.expires_at,
            )
        )

    return OAuthConnectionsResponse(connections=connections)


@router.get("/{provider}/start", response_model=OAuthStartResponse)
@limiter.limit(RATE_LIMIT_OAUTH)
async def start_oauth_flow(
    provider: str,
    request: Request,
    response: Response,
    user_id: CurrentUserId,
) -> OAuthStartResponse:
    """Start OAuth flow for a provider.

    Returns the authorization URL to redirect the user to.
    """
    if provider not in OAUTH_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    if not _is_provider_configured(provider):
        raise HTTPException(
            status_code=400,
            detail=f"Provider {provider} is not configured",
        )

    oauth_provider = get_oauth_provider(provider)

    # Generate PKCE and state
    code_verifier, code_challenge = generate_pkce()

    # For Anthropic, use code_verifier as state (matching pi-mono's approach)
    # This is required because Anthropic's token endpoint validates state == code_verifier
    state = code_verifier if provider == "anthropic" else generate_state()

    # Build redirect URI
    redirect_uri = f"{settings.API_BASE_URL}/api/llm-oauth/{provider}/callback"

    # Get authorization URL
    auth_url = await oauth_provider.get_auth_url(
        state=state,
        code_challenge=code_challenge,
        redirect_uri=redirect_uri,
    )

    # Store state in Redis for callback verification (10 min TTL handles cleanup)
    await _store_oauth_state(
        state,
        {
            "user_id": user_id,
            "provider": provider,
            "code_verifier": code_verifier,
            "redirect_uri": redirect_uri,
            "created_at": time.time(),
        },
    )

    logger.info("Started OAuth flow", provider=provider, user_id=user_id)

    return OAuthStartResponse(auth_url=auth_url, state=state)


@router.get("/{provider}/callback")
@limiter.limit(RATE_LIMIT_OAUTH)
async def oauth_callback(
    provider: str,
    request: Request,
    response: Response,
    code: str = Query(...),
    state: str = Query(...),
    db: DbSession = None,  # type: ignore
) -> dict[str, Any]:
    """Handle OAuth callback from provider.

    This endpoint is called by the OAuth provider after user authorization.
    """
    # Verify state (atomic get-and-delete from Redis)
    state_data = await _get_and_delete_oauth_state(state)
    if not state_data:
        raise HTTPException(status_code=400, detail="Invalid or expired state")

    if state_data["provider"] != provider:
        raise HTTPException(status_code=400, detail="Provider mismatch")

    user_id = state_data["user_id"]
    code_verifier = state_data["code_verifier"]
    redirect_uri = state_data["redirect_uri"]

    oauth_provider = get_oauth_provider(provider)

    try:
        # Exchange code for tokens
        credentials = await oauth_provider.exchange_code(
            code=code,
            code_verifier=code_verifier,
            redirect_uri=redirect_uri,
        )

        # Get user profile
        profile_info = await oauth_provider.get_user_info(credentials.access_token)

        # Store or update token in database
        await _save_oauth_token(
            db=db,
            user_id=user_id,
            provider=provider,
            credentials=credentials,
            profile_info=profile_info,
        )

        logger.info(
            "OAuth flow completed",
            provider=provider,
            user_id=user_id,
            email=profile_info.get("email"),
        )

        # Return HTML that closes the popup and notifies parent
        return _oauth_success_response(provider, profile_info)

    except Exception as e:
        logger.exception("OAuth callback failed", provider=provider, error=str(e))
        return _oauth_error_response(provider, str(e))


@router.post("/{provider}/callback", response_model=OAuthTokenResponse)
@limiter.limit(RATE_LIMIT_OAUTH)
async def oauth_callback_post(
    provider: str,
    request: Request,
    response: Response,
    body: OAuthCallbackRequest,
    user_id: CurrentUserId,
    db: DbSession,
) -> OAuthTokenResponse:
    """Handle OAuth callback via POST (alternative to redirect).

    Used when frontend handles the callback and sends code/state to backend.
    """
    # Verify state (atomic get-and-delete from Redis)
    state_data = await _get_and_delete_oauth_state(body.state)
    if not state_data:
        raise HTTPException(status_code=400, detail="Invalid or expired state")

    if state_data["provider"] != provider:
        raise HTTPException(status_code=400, detail="Provider mismatch")

    if state_data["user_id"] != user_id:
        raise HTTPException(status_code=400, detail="User mismatch")

    code_verifier = state_data["code_verifier"]
    redirect_uri = state_data["redirect_uri"]

    oauth_provider = get_oauth_provider(provider)

    try:
        # Exchange code for tokens
        credentials = await oauth_provider.exchange_code(
            code=body.code,
            code_verifier=code_verifier,
            redirect_uri=redirect_uri,
        )

        # Get user profile
        profile_info = await oauth_provider.get_user_info(credentials.access_token)

        # Store or update token in database
        await _save_oauth_token(
            db=db,
            user_id=user_id,
            provider=provider,
            credentials=credentials,
            profile_info=profile_info,
        )

        logger.info(
            "OAuth flow completed (POST)",
            provider=provider,
            user_id=user_id,
        )

        return OAuthTokenResponse(
            provider=provider,
            status="connected",
            email=profile_info.get("email"),
            name=profile_info.get("name") or profile_info.get("login"),
            expires_at=credentials.expires_at,
        )

    except Exception as e:
        logger.exception("OAuth callback failed", provider=provider, error=str(e))
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{provider}")
@limiter.limit(RATE_LIMIT_STANDARD)
async def disconnect_oauth(
    provider: str,
    request: Request,
    response: Response,
    user_id: CurrentUserId,
    db: DbSession,
) -> dict[str, Any]:
    """Disconnect OAuth provider.

    Revokes the token and removes it from the database.
    """
    # Get existing token
    result = await db.execute(
        select(UserOAuthToken).where(
            UserOAuthToken.user_id == user_id,
            UserOAuthToken.provider == provider,
        )
    )
    token = result.scalar_one_or_none()

    if not token:
        raise HTTPException(status_code=404, detail="Connection not found")

    # Try to revoke token with provider
    oauth_provider = get_oauth_provider(provider)
    try:
        await oauth_provider.revoke_token(token.access_token)
    except Exception as e:
        logger.warning("Token revocation failed", provider=provider, error=str(e))

    # Delete from database
    await db.execute(
        delete(UserOAuthToken).where(
            UserOAuthToken.user_id == user_id,
            UserOAuthToken.provider == provider,
        )
    )
    await db.commit()

    logger.info("OAuth disconnected", provider=provider, user_id=user_id)

    return {"status": "disconnected", "provider": provider}


@router.post("/{provider}/refresh")
@limiter.limit(RATE_LIMIT_OAUTH)
async def refresh_oauth_token(
    provider: str,
    request: Request,
    response: Response,
    user_id: CurrentUserId,
    db: DbSession,
) -> OAuthTokenResponse:
    """Manually refresh an OAuth token."""
    result = await db.execute(
        select(UserOAuthToken).where(
            UserOAuthToken.user_id == user_id,
            UserOAuthToken.provider == provider,
        )
    )
    token = result.scalar_one_or_none()

    if not token:
        raise HTTPException(status_code=404, detail="Connection not found")

    if not token.refresh_token:
        raise HTTPException(status_code=400, detail="No refresh token available")

    oauth_provider = get_oauth_provider(provider)

    try:
        credentials = await oauth_provider.refresh_token(token.refresh_token)

        # Update token
        token.access_token = credentials.access_token
        if credentials.refresh_token:
            token.refresh_token = credentials.refresh_token
        token.expires_at = credentials.expires_at
        token.status = "connected"
        token.last_error = None

        await db.commit()

        profile = token.profile_info or {}
        return OAuthTokenResponse(
            provider=provider,
            status="connected",
            email=profile.get("email"),
            name=profile.get("name") or profile.get("login"),
            expires_at=credentials.expires_at,
        )

    except Exception as e:
        token.status = "error"
        token.last_error = str(e)
        await db.commit()
        raise HTTPException(status_code=400, detail=str(e))


# Helper functions


def _is_provider_configured(provider: str) -> bool:
    """Check if a provider has required configuration."""
    if provider == "anthropic":
        # Anthropic uses a public client ID, always configured
        return True
    if provider == "openai-codex":
        # OpenAI Codex uses a public client ID (like Anthropic), always configured
        return True
    if provider == "google":
        return bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)
    if provider == "github":
        return bool(settings.GITHUB_CLIENT_ID and settings.GITHUB_CLIENT_SECRET)
    return False


async def _save_oauth_token(
    db: AsyncSession,
    user_id: str,
    provider: str,
    credentials: OAuthCredentials,
    profile_info: dict[str, Any],
) -> UserOAuthToken:
    """Save or update OAuth token in database."""
    result = await db.execute(
        select(UserOAuthToken).where(
            UserOAuthToken.user_id == user_id,
            UserOAuthToken.provider == provider,
        )
    )
    token = result.scalar_one_or_none()

    if token:
        # Update existing
        token.access_token = credentials.access_token
        token.refresh_token = credentials.refresh_token
        token.expires_at = credentials.expires_at
        token.scopes = credentials.scopes
        token.status = "connected"
        token.last_error = None
        token.profile_info = profile_info
    else:
        # Create new
        token = UserOAuthToken(
            user_id=user_id,
            provider=provider,
            access_token=credentials.access_token,
            refresh_token=credentials.refresh_token,
            expires_at=credentials.expires_at,
            scopes=credentials.scopes,
            status="connected",
            profile_info=profile_info,
        )
        db.add(token)

    await db.commit()
    return token


def _oauth_success_response(provider: str, profile_info: dict[str, Any]) -> dict[str, Any]:
    """Generate HTML response for successful OAuth in popup."""
    email = profile_info.get("email", "")
    name = profile_info.get("name") or profile_info.get("login", "")

    # Return a simple dict that frontend can handle
    return {
        "status": "success",
        "provider": provider,
        "email": email,
        "name": name,
    }


def _oauth_error_response(provider: str, error: str) -> dict[str, Any]:
    """Generate HTML response for failed OAuth in popup."""
    return {
        "status": "error",
        "provider": provider,
        "error": error,
    }
