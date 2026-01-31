"""OAuth authentication routes for GitHub and Google."""

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from typing import Annotated, Any
from urllib.parse import urlencode

import httpx
import structlog
from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.cache import cache_delete, user_config_key
from src.compute_client import compute_client
from src.config import settings
from src.database.connection import get_db
from src.database.models import (
    GitHubIntegration,
    GoogleIntegration,
    PlatformInvitation,
    PlatformSetting,
    Session,
    SubscriptionPlan,
    User,
    UserConfig,
    UserSubscription,
)
from src.dependencies import get_current_user
from src.middleware.rate_limit import (
    RATE_LIMIT_OAUTH,
    limiter,
    store_oauth_link_state,
    store_oauth_state,
    validate_oauth_link_state,
    validate_oauth_state,
)
from src.routes.auth import (
    _OAUTH2_TYPE_STR,
    _get_token_ttls,
    _should_return_tokens,
    create_access_token,
    create_refresh_token,
    set_auth_cookies,
)
from src.routes.billing import sync_quotas_from_plan

logger = structlog.get_logger()

router = APIRouter()


@dataclass
class OAuthUserInfo:
    """OAuth user info for account creation/linking."""

    provider: str
    oauth_id: str
    email: str
    name: str | None = None
    avatar_url: str | None = None


# Type alias for database session dependency
DbSession = Annotated[AsyncSession, Depends(get_db)]


class OAuthURLResponse(BaseModel):
    """OAuth authorization URL response."""

    url: str
    state: str


class OAuthCallbackRequest(BaseModel):
    """OAuth callback request."""

    code: str
    state: str


class OAuthTokenResponse(BaseModel):
    """OAuth token response.

    SECURITY:
    - In production (COOKIE_SECURE=true): Tokens are ONLY in httpOnly cookies
    - In development (COOKIE_SECURE=false): Tokens also returned in body
    """

    access_token: str | None = None  # Only set when COOKIE_SECURE=false
    refresh_token: str | None = None  # Only set when COOKIE_SECURE=false
    token_type: str = _OAUTH2_TYPE_STR
    expires_in: int
    user: dict[str, Any]


@dataclass
class OAuthState:
    """OAuth state with expiration and provider binding."""

    provider: str
    created_at: float
    expires_at: float


@dataclass
class GitHubUserData:
    """Data extracted from GitHub OAuth response."""

    user_id: str
    login: str
    email: str
    name: str | None
    avatar_url: str | None
    scopes: list[str] | None = None


@dataclass
class GoogleUserData:
    """Data extracted from Google OAuth response."""

    user_id: str
    email: str
    name: str | None
    avatar_url: str | None


async def generate_state(provider: str) -> str:
    """Generate a secure random state for OAuth and store in Redis."""
    state = secrets.token_urlsafe(32)
    await store_oauth_state(state, provider)
    return state


async def _exchange_github_code_for_token(code: str) -> str:
    """Exchange GitHub OAuth code for access token."""
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
        token_response = await client.post(
            "https://github.com/login/oauth/access_token",
            data={
                "client_id": settings.GITHUB_CLIENT_ID,
                "client_secret": settings.GITHUB_CLIENT_SECRET,
                "code": code,
                "redirect_uri": settings.GITHUB_REDIRECT_URI,
            },
            headers={"Accept": "application/json"},
        )

        if token_response.status_code != HTTPStatus.OK:
            raise HTTPException(status_code=400, detail="Failed to exchange code for token")

        token_data = token_response.json()
        if "error" in token_data:
            raise HTTPException(
                status_code=400,
                detail=token_data.get("error_description", "OAuth error"),
            )

        access_token = str(token_data["access_token"])

        # Log token info for debugging
        logger.info(
            "GitHub token exchange successful",
            token_length=len(access_token),
            token_prefix=access_token[:4] if len(access_token) >= 4 else "SHORT",
            token_type=token_data.get("token_type"),
            scope=token_data.get("scope"),
        )

        return access_token


async def _fetch_github_user_data(access_token: str) -> GitHubUserData:
    """Fetch user data from GitHub API."""
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github.v3+json",
        }

        user_response = await client.get("https://api.github.com/user", headers=headers)
        if user_response.status_code != HTTPStatus.OK:
            raise HTTPException(status_code=400, detail="Failed to get user info from GitHub")

        github_user = user_response.json()
        scopes_header = user_response.headers.get("x-oauth-scopes", "")
        scopes = [s.strip() for s in scopes_header.split(",") if s.strip()] or None
        email = await _fetch_github_primary_email(client, headers, github_user)

        return GitHubUserData(
            user_id=str(github_user["id"]),
            login=str(github_user.get("login")),
            email=email,
            name=github_user.get("name") or github_user.get("login"),
            avatar_url=github_user.get("avatar_url"),
            scopes=scopes,
        )


async def _fetch_github_primary_email(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    github_user: dict[str, Any],
) -> str:
    """Fetch user's primary email from GitHub."""
    emails_response = await client.get("https://api.github.com/user/emails", headers=headers)

    email: str | None = None
    if emails_response.status_code == HTTPStatus.OK:
        emails = emails_response.json()
        primary_email = next((e for e in emails if e.get("primary")), None)
        if primary_email:
            email = str(primary_email["email"])
        elif emails:
            email = str(emails[0]["email"])

    if not email:
        email = github_user.get("email")

    if not email:
        raise HTTPException(status_code=400, detail="Could not get email from GitHub")

    return email


async def _exchange_google_code_for_token(code: str) -> str:
    """Exchange Google OAuth code for access token."""
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
        token_response = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "code": code,
                "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
        )

        if token_response.status_code != HTTPStatus.OK:
            raise HTTPException(status_code=400, detail="Failed to exchange code for token")

        token_data = token_response.json()
        if "error" in token_data:
            raise HTTPException(
                status_code=400,
                detail=token_data.get("error_description", "OAuth error"),
            )

        return str(token_data["access_token"])


async def _fetch_google_user_data(access_token: str) -> GoogleUserData:
    """Fetch user data from Google API."""
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
        user_response = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )

        if user_response.status_code != HTTPStatus.OK:
            raise HTTPException(status_code=400, detail="Failed to get user info from Google")

        google_user = user_response.json()
        email = google_user.get("email")

        if not email:
            raise HTTPException(status_code=400, detail="Could not get email from Google")

        return GoogleUserData(
            user_id=str(google_user["id"]),
            email=email,
            name=google_user.get("name"),
            avatar_url=google_user.get("picture"),
        )


async def _find_or_create_oauth_user(db: AsyncSession, user_info: OAuthUserInfo) -> User:
    """Find existing user or create new one for OAuth login."""
    result = await db.execute(
        select(User).where(
            User.oauth_provider == user_info.provider,
            User.oauth_id == user_info.oauth_id,
        ),
    )
    user = result.scalar_one_or_none()

    if user:
        # Check if user account is active
        if not user.is_active:
            logger.warning(
                "OAuth login attempt for disabled account",
                user_id=user.id,
                provider=user_info.provider,
            )
            raise HTTPException(status_code=401, detail="Account is disabled")
        return user

    return await _link_or_create_user(db, user_info)


async def _link_or_create_user(db: AsyncSession, user_info: OAuthUserInfo) -> User:
    """Link OAuth to existing user or create new user."""
    result = await db.execute(select(User).where(User.email == user_info.email))
    existing_user = result.scalar_one_or_none()

    is_new_user = existing_user is None
    invitation: PlatformInvitation | None = None

    # If new user, check if registration is enabled
    if is_new_user:
        # Check if registration is enabled
        feature_flags_result = await db.execute(
            select(PlatformSetting).where(PlatformSetting.key == "feature_flags")
        )
        feature_flags = feature_flags_result.scalar_one_or_none()
        registration_enabled = (
            not feature_flags
            or not isinstance(feature_flags.value, dict)
            or feature_flags.value.get("registration_enabled", True)
        )

        # Check for valid invitation by email (for OAuth, we match by email)
        invitation_result = await db.execute(
            select(PlatformInvitation)
            .where(PlatformInvitation.email == user_info.email)
            .where(PlatformInvitation.status == "pending")
            .where(PlatformInvitation.expires_at > datetime.now(UTC))
        )
        invitation = invitation_result.scalar_one_or_none()

        # If registration is disabled and no valid invitation, reject
        if not registration_enabled and not invitation:
            raise HTTPException(
                status_code=403,
                detail="Registration is disabled. You need an invitation to create an account.",
            )

    if existing_user:
        existing_user.oauth_provider = user_info.provider
        existing_user.oauth_id = user_info.oauth_id
        existing_user.avatar_url = user_info.avatar_url
        if not existing_user.name:
            existing_user.name = user_info.name
        user = existing_user
    else:
        user = User(
            email=user_info.email,
            name=user_info.name,
            avatar_url=user_info.avatar_url,
            oauth_provider=user_info.provider,
            oauth_id=user_info.oauth_id,
            is_active=True,
        )
        db.add(user)

    try:
        await db.commit()
        await db.refresh(user)
    except IntegrityError:
        await db.rollback()
        result = await db.execute(select(User).where(User.email == user_info.email))
        found_user = result.scalar_one_or_none()
        if not found_user:
            raise HTTPException(status_code=500, detail="Failed to create user") from None
        user = found_user
        is_new_user = False

    # Handle subscription for new users
    if is_new_user:
        now = datetime.now(UTC)
        plan_assigned = False

        # Check if invitation has gift subscription
        if invitation and invitation.gift_plan_id and invitation.gift_months:
            plan_result = await db.execute(
                select(SubscriptionPlan).where(SubscriptionPlan.id == invitation.gift_plan_id)
            )
            gift_plan = plan_result.scalar_one_or_none()

            if gift_plan:
                # Create sponsored subscription with gifted months
                period_end = now + relativedelta(months=invitation.gift_months)
                subscription = UserSubscription(
                    user_id=user.id,
                    plan_id=gift_plan.id,
                    status="active",
                    billing_cycle="monthly",
                    current_period_start=now,
                    current_period_end=period_end,
                    is_sponsored=True,
                    sponsored_by_id=invitation.invited_by_id,
                    sponsored_at=now,
                    sponsor_reason=f"Platform invitation - {invitation.gift_months} month gift",
                    last_credit_grant=now,
                )
                db.add(subscription)
                await db.flush()
                await sync_quotas_from_plan(db, user.id, gift_plan, subscription)
                plan_assigned = True

        # Fall back to free plan if no gift
        if not plan_assigned:
            free_plan_result = await db.execute(
                select(SubscriptionPlan).where(SubscriptionPlan.slug == "free")
            )
            free_plan = free_plan_result.scalar_one_or_none()

            if free_plan:
                period_end = now + timedelta(days=30)
                subscription = UserSubscription(
                    user_id=user.id,
                    plan_id=free_plan.id,
                    status="active",
                    billing_cycle="monthly",
                    current_period_start=now,
                    current_period_end=period_end,
                    last_credit_grant=now,
                )
                db.add(subscription)
                await db.flush()
                await sync_quotas_from_plan(db, user.id, free_plan, subscription)

        # Mark invitation as accepted if used
        if invitation:
            invitation.status = "accepted"
            invitation.accepted_at = now
            invitation.accepted_by_id = user.id

        await db.commit()

    return user


async def _update_git_config_from_github(
    db: AsyncSession,
    user_id: str,
    github_name: str | None,
    github_email: str,
) -> None:
    """Update user's git config from GitHub data.

    Automatically sets git_name and git_email from GitHub profile when connecting.
    """
    result = await db.execute(select(UserConfig).where(UserConfig.user_id == user_id))
    config = result.scalar_one_or_none()

    if not config:
        # Create config if it doesn't exist
        config = UserConfig(
            user_id=user_id,
            git_name=github_name,
            git_email=github_email,
        )
        db.add(config)
    else:
        # Update git config from GitHub data
        if github_name:
            config.git_name = github_name
        if github_email:
            config.git_email = github_email

    await db.commit()
    await db.refresh(config)

    # Invalidate cache
    await cache_delete(user_config_key(user_id))

    logger.info(
        "Updated git config from GitHub",
        user_id=user_id,
        git_name=config.git_name,
        git_email=config.git_email,
    )


async def _update_workspaces_with_github_token(
    db: AsyncSession,
    user_id: str,
    github_token: str,
) -> None:
    """Update all running workspaces for a user with GitHub token configuration.

    This ensures that when a user connects their GitHub account, all their
    existing workspaces are configured to use git with GitHub authentication.
    """
    try:
        # Get all active sessions for this user that have a workspace
        result = await db.execute(
            select(Session)
            .where(Session.owner_id == user_id)
            .where(Session.workspace_id.isnot(None))
            .where(Session.status == "running")
        )
        sessions = result.scalars().all()

        if not sessions:
            logger.info(
                "No active workspaces to update with GitHub token",
                user_id=user_id,
            )
            return

        logger.info(
            "Updating workspaces with GitHub token",
            user_id=user_id,
            workspace_count=len(sessions),
        )

        # Update each workspace
        updated_count = 0
        for session in sessions:
            if not session.workspace_id:
                continue

            try:
                workspace_id = session.workspace_id

                # Export GITHUB_TOKEN in .zshrc and .bashrc
                # First, check if it's already exported to avoid duplicates
                # Use single quotes to properly escape the token
                export_cmd = f"export GITHUB_TOKEN='{github_token}'"

                # Add to .bashrc if not already present
                # Use sh -c to properly handle the command
                bashrc_cmd = (
                    f'sh -c \'grep -q "GITHUB_TOKEN" ~/.bashrc 2>/dev/null || '
                    f'echo "{export_cmd}" >> ~/.bashrc\''
                )
                await compute_client.exec_command(
                    workspace_id, user_id, bashrc_cmd, exec_timeout=10
                )

                # Add to .zshrc if not already present
                zshrc_cmd = (
                    f'sh -c \'grep -q "GITHUB_TOKEN" ~/.zshrc 2>/dev/null || '
                    f'echo "{export_cmd}" >> ~/.zshrc\''
                )
                await compute_client.exec_command(workspace_id, user_id, zshrc_cmd, exec_timeout=10)

                # Set up git credential helper
                credential_helper_script = """#!/bin/bash
if [ -n "$GITHUB_TOKEN" ]; then
    echo "protocol=https"
    echo "host=github.com"
    echo "username=x-access-token"
    echo "password=$GITHUB_TOKEN"
fi
"""

                # Create credential helper script
                script_path = "~/.local/bin/git-credential-github-token"
                await compute_client.exec_command(
                    workspace_id,
                    user_id,
                    "mkdir -p ~/.local/bin",
                    exec_timeout=10,
                )

                # Write the script using a heredoc (same approach as docker_manager)
                # Use a single command with heredoc
                script_cmd = (
                    f"mkdir -p ~/.local/bin && cat > {script_path} << 'SCRIPT_EOF'\n"
                    f"{credential_helper_script}SCRIPT_EOF"
                )
                await compute_client.exec_command(
                    workspace_id,
                    user_id,
                    script_cmd,
                    exec_timeout=10,
                )

                # Make it executable
                await compute_client.exec_command(
                    workspace_id,
                    user_id,
                    f"chmod +x {script_path}",
                    exec_timeout=10,
                )

                # Configure git to use this credential helper
                helper_cmd = (
                    "git config --global credential.https://github.com.helper "
                    "'!~/.local/bin/git-credential-github-token'"
                )
                await compute_client.exec_command(
                    workspace_id,
                    user_id,
                    helper_cmd,
                    exec_timeout=10,
                )

                updated_count += 1
                logger.info(
                    "Updated workspace with GitHub token",
                    workspace_id=workspace_id,
                    user_id=user_id,
                )

            except Exception as e:
                logger.warning(
                    "Failed to update workspace with GitHub token",
                    workspace_id=session.workspace_id,
                    user_id=user_id,
                    error=str(e),
                    exc_info=True,
                )
                # Continue with other workspaces even if one fails

        logger.info(
            "Finished updating workspaces with GitHub token",
            user_id=user_id,
            updated_count=updated_count,
            total_count=len(sessions),
        )

    except Exception as e:
        # Non-fatal: log error but don't fail the GitHub linking
        logger.warning(
            "Failed to update workspaces with GitHub token",
            user_id=user_id,
            error=str(e),
            exc_info=True,
        )


def _build_token_response(
    user: User,
    request: Request,
    response: Response,
) -> OAuthTokenResponse:
    """Build OAuth token response for authenticated user."""
    # Get user role from database
    user_role = getattr(user, "role", "member") or "member"

    return_tokens = _should_return_tokens(request)
    access_ttl, refresh_ttl = _get_token_ttls(return_tokens)
    access_token_info = create_access_token(user.id, role=user_role, expires_in_seconds=access_ttl)
    refresh_token_info = create_refresh_token(user.id, expires_in_seconds=refresh_ttl)

    # Set httpOnly cookies for authentication (same as login/register)
    set_auth_cookies(
        response,
        access_token_info.token,
        refresh_token_info.token,
        access_max_age_seconds=access_ttl,
        refresh_max_age_seconds=refresh_ttl,
    )

    # In production (COOKIE_SECURE=true), tokens are ONLY in httpOnly cookies
    # In development (COOKIE_SECURE=false), also return in body for compatibility
    return OAuthTokenResponse(
        access_token=access_token_info.token if return_tokens else None,
        refresh_token=refresh_token_info.token if return_tokens else None,
        expires_in=access_token_info.expires_in_seconds,
        user={
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "avatar_url": user.avatar_url,
            "role": user_role,
        },
    )


# ============== GitHub OAuth ==============


@router.get("/github/authorize", response_model=OAuthURLResponse)
@limiter.limit(RATE_LIMIT_OAUTH)
async def github_authorize(
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
) -> OAuthURLResponse:
    """Get GitHub OAuth authorization URL."""
    if not settings.GITHUB_CLIENT_ID:
        raise HTTPException(status_code=501, detail="GitHub OAuth not configured")

    state = await generate_state("github")

    params = {
        "client_id": settings.GITHUB_CLIENT_ID,
        "redirect_uri": settings.GITHUB_REDIRECT_URI,
        "scope": "read:user user:email repo read:org workflow",
        "state": state,
    }

    url = f"https://github.com/login/oauth/authorize?{urlencode(params)}"
    return OAuthURLResponse(url=url, state=state)


# ============== GitHub Account Linking ==============
# The link-authorize endpoint is used to start the link flow for logged-in users


class GitHubLinkResponse(BaseModel):
    """Response for GitHub account linking."""

    success: bool
    github_username: str
    message: str


@router.get("/github/link-authorize", response_model=OAuthURLResponse)
@limiter.limit(RATE_LIMIT_OAUTH)
async def github_link_authorize(
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
    user: dict[str, Any] = Depends(get_current_user),
) -> OAuthURLResponse:
    """Get GitHub OAuth authorization URL for account linking.

    This endpoint is for logged-in users who want to link their GitHub
    account to their existing Podex account (not for login/signup).
    """
    if not settings.GITHUB_CLIENT_ID:
        raise HTTPException(status_code=501, detail="GitHub OAuth not configured")

    state = secrets.token_urlsafe(32)
    # Store state with user_id for linking
    await store_oauth_link_state(state, "github", user["id"])

    params = {
        "client_id": settings.GITHUB_CLIENT_ID,
        "redirect_uri": settings.GITHUB_REDIRECT_URI,  # Use same redirect URI as login
        "scope": "read:user user:email repo read:org workflow",
        "state": state,
    }

    url = f"https://github.com/login/oauth/authorize?{urlencode(params)}"
    return OAuthURLResponse(url=url, state=state)


# ============== Unified GitHub Callback ==============
# Auto-detects whether this is a link flow or login flow based on Redis state


class GitHubUnifiedCallbackResponse(BaseModel):
    """Response for unified GitHub callback that handles both link and login flows.

    The frontend should check `flow_type` to determine how to handle the response:
    - "link": Account linking completed, redirect to settings
    - "login": Login/signup completed, redirect to dashboard
    """

    flow_type: str  # "link" or "login"
    # Link flow fields (present when flow_type == "link")
    github_username: str | None = None
    link_message: str | None = None
    # Login flow fields (present when flow_type == "login")
    access_token: str | None = None
    refresh_token: str | None = None
    token_type: str = "bearer"
    expires_in: int | None = None
    user: dict[str, Any] | None = None


@router.post("/github/callback-auto", response_model=GitHubUnifiedCallbackResponse)
@limiter.limit(RATE_LIMIT_OAUTH)
async def github_callback_auto(
    body: OAuthCallbackRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> GitHubUnifiedCallbackResponse:
    """Unified GitHub OAuth callback that auto-detects link vs login flow.

    This endpoint checks the state token against both Redis stores:
    1. First checks if it's a "link" state (user linking GitHub to existing account)
    2. If not, checks if it's a "login" state (user logging in or signing up)

    This eliminates the need for frontend sessionStorage to track flow type,
    making the OAuth flow more reliable across redirects.
    """
    if not settings.GITHUB_CLIENT_ID or not settings.GITHUB_CLIENT_SECRET:
        raise HTTPException(status_code=501, detail="GitHub OAuth not configured")

    # First, check if this is an account linking flow
    link_user_id = await validate_oauth_link_state(body.state, "github")

    if link_user_id:
        # === LINK FLOW ===
        # This is an account linking request from a logged-in user
        logger.info(
            "GitHub callback: detected link flow",
            user_id=link_user_id[:8],
            state=body.state[:8],
        )

        # Exchange code for token
        access_token = await _exchange_github_code_for_token(body.code)
        user_data = await _fetch_github_user_data(access_token)

        # Verify the user exists
        result = await db.execute(select(User).where(User.id == link_user_id))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Check if this GitHub account is already linked to another user
        existing_integration = await db.execute(
            select(GitHubIntegration).where(
                GitHubIntegration.github_user_id == int(user_data.user_id),
                GitHubIntegration.user_id != link_user_id,
            )
        )
        if existing_integration.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail="This GitHub account is already linked to another Podex account",
            )

        # Create or update the GitHub integration
        integration_result = await db.execute(
            select(GitHubIntegration).where(GitHubIntegration.user_id == link_user_id)
        )
        integration = integration_result.scalar_one_or_none()

        if integration:
            integration.github_user_id = int(user_data.user_id)
            integration.github_username = user_data.login
            integration.github_avatar_url = user_data.avatar_url
            integration.github_email = user_data.email
            integration.access_token = access_token
            integration.refresh_token = None
            integration.token_expires_at = None
            integration.scopes = user_data.scopes
            integration.is_active = True
        else:
            integration = GitHubIntegration(
                user_id=link_user_id,
                github_user_id=int(user_data.user_id),
                github_username=user_data.login,
                github_avatar_url=user_data.avatar_url,
                github_email=user_data.email,
                access_token=access_token,
                refresh_token=None,
                token_expires_at=None,
                scopes=user_data.scopes,
                is_active=True,
            )
            db.add(integration)

        await db.commit()

        # Update git config and workspaces
        await _update_git_config_from_github(db, link_user_id, user_data.name, user_data.email)
        await _update_workspaces_with_github_token(db, link_user_id, access_token)

        logger.info(
            "GitHub account linked successfully via unified callback",
            user_id=link_user_id,
            github_username=user_data.login,
        )

        return GitHubUnifiedCallbackResponse(
            flow_type="link",
            github_username=user_data.login,
            link_message=f"Successfully linked GitHub account @{user_data.login}",
        )

    # Not a link flow, check if it's a login flow
    if not await validate_oauth_state(body.state, "github"):
        raise HTTPException(status_code=400, detail="Invalid or expired state parameter")

    # === LOGIN FLOW ===
    logger.info(
        "GitHub callback: detected login flow",
        state=body.state[:8],
    )

    access_token = await _exchange_github_code_for_token(body.code)
    user_data = await _fetch_github_user_data(access_token)

    oauth_user_info = OAuthUserInfo(
        provider="github",
        oauth_id=user_data.user_id,
        email=user_data.email,
        name=user_data.name,
        avatar_url=user_data.avatar_url,
    )
    user = await _find_or_create_oauth_user(db, oauth_user_info)

    # Create/update GitHub integration
    integration_result = await db.execute(
        select(GitHubIntegration).where(GitHubIntegration.user_id == user.id)
    )
    integration = integration_result.scalar_one_or_none()

    if integration:
        integration.github_user_id = int(user_data.user_id)
        integration.github_username = user_data.login
        integration.github_avatar_url = user_data.avatar_url
        integration.github_email = user_data.email
        integration.access_token = access_token
        integration.refresh_token = None
        integration.token_expires_at = None
        integration.scopes = user_data.scopes
        integration.is_active = True
    else:
        integration = GitHubIntegration(
            user_id=user.id,
            github_user_id=int(user_data.user_id),
            github_username=user_data.login,
            github_avatar_url=user_data.avatar_url,
            github_email=user_data.email,
            access_token=access_token,
            refresh_token=None,
            token_expires_at=None,
            scopes=user_data.scopes,
            is_active=True,
        )
        db.add(integration)

    await db.commit()

    # Update git config and workspaces
    await _update_git_config_from_github(db, user.id, user_data.name, user_data.email)
    await _update_workspaces_with_github_token(db, user.id, access_token)

    logger.info(
        "GitHub login completed via unified callback",
        user_id=str(user.id),
        github_username=user_data.login,
    )

    # Build token response
    token_response = _build_token_response(user, request, response)

    return GitHubUnifiedCallbackResponse(
        flow_type="login",
        access_token=token_response.access_token,
        refresh_token=token_response.refresh_token,
        token_type=token_response.token_type,
        expires_in=token_response.expires_in,
        user=token_response.user,
    )


# ============== Google OAuth ==============


@router.get("/google/authorize", response_model=OAuthURLResponse)
@limiter.limit(RATE_LIMIT_OAUTH)
async def google_authorize(
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
) -> OAuthURLResponse:
    """Get Google OAuth authorization URL for login/signup."""
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=501, detail="Google OAuth not configured")

    state = await generate_state("google")

    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
    }

    url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
    return OAuthURLResponse(url=url, state=state)


# ============== Google Account Linking ==============
# The link-authorize endpoint is used to start the link flow for logged-in users


class GoogleLinkResponse(BaseModel):
    """Response for Google account linking."""

    success: bool
    google_email: str
    message: str


@router.get("/google/link-authorize", response_model=OAuthURLResponse)
@limiter.limit(RATE_LIMIT_OAUTH)
async def google_link_authorize(
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
    user: dict[str, Any] = Depends(get_current_user),
) -> OAuthURLResponse:
    """Get Google OAuth authorization URL for account linking.

    This endpoint is for logged-in users who want to link their Google
    account to their existing Podex account (not for login/signup).
    """
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=501, detail="Google OAuth not configured")

    state = secrets.token_urlsafe(32)
    # Store state with user_id for linking
    await store_oauth_link_state(state, "google", user["id"])

    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
    }

    url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
    return OAuthURLResponse(url=url, state=state)


# ============== Unified Google Callback ==============
# Auto-detects whether this is a link flow or login flow based on Redis state


class GoogleUnifiedCallbackResponse(BaseModel):
    """Response for unified Google callback that handles both link and login flows.

    The frontend should check `flow_type` to determine how to handle the response:
    - "link": Account linking completed, redirect to settings
    - "login": Login/signup completed, redirect to dashboard
    """

    flow_type: str  # "link" or "login"
    # Link flow fields (present when flow_type == "link")
    google_email: str | None = None
    link_message: str | None = None
    # Login flow fields (present when flow_type == "login")
    access_token: str | None = None
    refresh_token: str | None = None
    token_type: str = "bearer"
    expires_in: int | None = None
    user: dict[str, Any] | None = None


@router.post("/google/callback-auto", response_model=GoogleUnifiedCallbackResponse)
@limiter.limit(RATE_LIMIT_OAUTH)
async def google_callback_auto(
    body: OAuthCallbackRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> GoogleUnifiedCallbackResponse:
    """Unified Google OAuth callback that auto-detects link vs login flow.

    This endpoint checks the state token against both Redis stores:
    1. First checks if it's a "link" state (user linking Google to existing account)
    2. If not, checks if it's a "login" state (user logging in or signing up)

    This eliminates the need for frontend sessionStorage to track flow type,
    making the OAuth flow more reliable across redirects.
    """
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=501, detail="Google OAuth not configured")

    # First, check if this is an account linking flow
    link_user_id = await validate_oauth_link_state(body.state, "google")

    if link_user_id:
        # === LINK FLOW ===
        # This is an account linking request from a logged-in user
        logger.info(
            "Google callback: detected link flow",
            user_id=link_user_id[:8],
            state=body.state[:8],
        )

        # Exchange code for token
        access_token = await _exchange_google_code_for_token(body.code)
        user_data = await _fetch_google_user_data(access_token)

        # Verify the user exists
        result = await db.execute(select(User).where(User.id == link_user_id))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Check if this Google account is already linked to another user
        existing_integration = await db.execute(
            select(GoogleIntegration).where(
                GoogleIntegration.google_user_id == user_data.user_id,
                GoogleIntegration.user_id != link_user_id,
            )
        )
        if existing_integration.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail="This Google account is already linked to another Podex account",
            )

        # Create or update the Google integration
        integration_result = await db.execute(
            select(GoogleIntegration).where(GoogleIntegration.user_id == link_user_id)
        )
        integration = integration_result.scalar_one_or_none()

        if integration:
            integration.google_user_id = user_data.user_id
            integration.google_email = user_data.email
            integration.google_name = user_data.name
            integration.google_avatar_url = user_data.avatar_url
            integration.access_token = access_token
            integration.is_active = True
        else:
            integration = GoogleIntegration(
                user_id=link_user_id,
                google_user_id=user_data.user_id,
                google_email=user_data.email,
                google_name=user_data.name,
                google_avatar_url=user_data.avatar_url,
                access_token=access_token,
                is_active=True,
            )
            db.add(integration)

        await db.commit()

        logger.info(
            "Google account linked successfully via unified callback",
            user_id=link_user_id,
            google_email=user_data.email,
        )

        return GoogleUnifiedCallbackResponse(
            flow_type="link",
            google_email=user_data.email,
            link_message=f"Successfully linked Google account {user_data.email}",
        )

    # Not a link flow, check if it's a login flow
    if not await validate_oauth_state(body.state, "google"):
        raise HTTPException(status_code=400, detail="Invalid or expired state parameter")

    # === LOGIN FLOW ===
    logger.info(
        "Google callback: detected login flow",
        state=body.state[:8],
    )

    access_token = await _exchange_google_code_for_token(body.code)
    user_data = await _fetch_google_user_data(access_token)

    oauth_user_info = OAuthUserInfo(
        provider="google",
        oauth_id=user_data.user_id,
        email=user_data.email,
        name=user_data.name,
        avatar_url=user_data.avatar_url,
    )
    user = await _find_or_create_oauth_user(db, oauth_user_info)

    logger.info(
        "Google login completed via unified callback",
        user_id=str(user.id),
        google_email=user_data.email,
    )

    # Build token response
    token_response = _build_token_response(user, request, response)

    return GoogleUnifiedCallbackResponse(
        flow_type="login",
        access_token=token_response.access_token,
        refresh_token=token_response.refresh_token,
        token_type=token_response.token_type,
        expires_in=token_response.expires_in,
        user=token_response.user,
    )
