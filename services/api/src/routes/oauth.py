"""OAuth authentication routes for GitHub and Google."""

import secrets
from dataclasses import dataclass
from http import HTTPStatus
from typing import Annotated, Any
from urllib.parse import urlencode

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.connection import get_db
from src.database.models import SubscriptionPlan, User, UserSubscription
from src.middleware.rate_limit import (
    RATE_LIMIT_OAUTH,
    limiter,
    store_oauth_state,
    validate_oauth_state,
)
from src.routes.auth import _OAUTH2_TYPE_STR, create_access_token, create_refresh_token

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
    """OAuth token response."""

    access_token: str
    refresh_token: str
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
    email: str
    name: str | None
    avatar_url: str | None


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

        return str(token_data["access_token"])


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
        email = await _fetch_github_primary_email(client, headers, github_user)

        return GitHubUserData(
            user_id=str(github_user["id"]),
            email=email,
            name=github_user.get("name") or github_user.get("login"),
            avatar_url=github_user.get("avatar_url"),
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

    # Auto-assign Free plan subscription for new users
    if is_new_user:
        free_plan_result = await db.execute(
            select(SubscriptionPlan).where(SubscriptionPlan.slug == "free")
        )
        free_plan = free_plan_result.scalar_one_or_none()

        if free_plan:
            from datetime import UTC, datetime, timedelta

            now = datetime.now(UTC)
            subscription = UserSubscription(
                user_id=user.id,
                plan_id=free_plan.id,
                status="active",
                billing_cycle="monthly",
                current_period_start=now,
                current_period_end=now + timedelta(days=30),
            )
            db.add(subscription)
            await db.commit()

    return user


def _build_token_response(user: User) -> OAuthTokenResponse:
    """Build OAuth token response for authenticated user."""
    # Get user role from database
    user_role = getattr(user, "role", "member") or "member"

    access_token_info = create_access_token(user.id, role=user_role)
    refresh_token_info = create_refresh_token(user.id)

    return OAuthTokenResponse(
        access_token=access_token_info.token,
        refresh_token=refresh_token_info.token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
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
async def github_authorize(request: Request, response: Response) -> OAuthURLResponse:
    """Get GitHub OAuth authorization URL."""
    if not settings.GITHUB_CLIENT_ID:
        raise HTTPException(status_code=501, detail="GitHub OAuth not configured")

    state = await generate_state("github")

    params = {
        "client_id": settings.GITHUB_CLIENT_ID,
        "redirect_uri": settings.GITHUB_REDIRECT_URI,
        "scope": "read:user user:email",
        "state": state,
    }

    url = f"https://github.com/login/oauth/authorize?{urlencode(params)}"
    return OAuthURLResponse(url=url, state=state)


@router.post("/github/callback", response_model=OAuthTokenResponse)
@limiter.limit(RATE_LIMIT_OAUTH)
async def github_callback(
    body: OAuthCallbackRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> OAuthTokenResponse:
    """Handle GitHub OAuth callback."""
    if not settings.GITHUB_CLIENT_ID or not settings.GITHUB_CLIENT_SECRET:
        raise HTTPException(status_code=501, detail="GitHub OAuth not configured")

    # Validate state from Redis (one-time use)
    if not await validate_oauth_state(body.state, "github"):
        raise HTTPException(status_code=400, detail="Invalid or expired state parameter")

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

    return _build_token_response(user)


# ============== Google OAuth ==============


@router.get("/google/authorize", response_model=OAuthURLResponse)
@limiter.limit(RATE_LIMIT_OAUTH)
async def google_authorize(request: Request, response: Response) -> OAuthURLResponse:
    """Get Google OAuth authorization URL."""
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


@router.post("/google/callback", response_model=OAuthTokenResponse)
@limiter.limit(RATE_LIMIT_OAUTH)
async def google_callback(
    body: OAuthCallbackRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> OAuthTokenResponse:
    """Handle Google OAuth callback."""
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=501, detail="Google OAuth not configured")

    # Validate state from Redis (one-time use)
    if not await validate_oauth_state(body.state, "google"):
        raise HTTPException(status_code=400, detail="Invalid or expired state parameter")

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

    return _build_token_response(user)
