"""Authentication routes."""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal, cast
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from jose import JWTError, jwt
from passlib.hash import bcrypt
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.connection import get_db
from src.database.models import SubscriptionPlan, User, UserSubscription
from src.middleware.rate_limit import RATE_LIMIT_AUTH, RATE_LIMIT_SENSITIVE, limiter
from src.services.mfa import get_mfa_service
from src.services.token_blacklist import (
    is_token_revoked,
    register_user_token,
    revoke_all_user_tokens,
    revoke_token,
)
from src.utils.password_validator import get_password_strength, validate_password

router = APIRouter()

# Type alias for database session dependency
DbSession = Annotated[AsyncSession, Depends(get_db)]

# OAuth2 token type constant - standard OAuth2 token type identifier
_OAUTH2_TYPE_STR = "bearer"  # not a password, standard OAuth2 type identifier

# Cookie names for httpOnly auth tokens (not passwords, just cookie names)
COOKIE_ACCESS_TOKEN = "podex_access"
COOKIE_REFRESH_TOKEN = "podex_refresh"


def set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    """Set httpOnly cookies for authentication tokens.

    These cookies are:
    - httpOnly: Not accessible via JavaScript (XSS protection)
    - secure: Only sent over HTTPS (in production)
    - sameSite: Lax for CSRF protection while allowing normal navigation
    """
    # Access token cookie - used for API requests
    response.set_cookie(
        key=COOKIE_ACCESS_TOKEN,
        value=access_token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=cast("Literal['lax', 'strict', 'none']", settings.COOKIE_SAMESITE),
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/api",
        domain=settings.COOKIE_DOMAIN,
    )

    # Refresh token cookie - restricted to auth refresh endpoint
    response.set_cookie(
        key=COOKIE_REFRESH_TOKEN,
        value=refresh_token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=cast("Literal['lax', 'strict', 'none']", settings.COOKIE_SAMESITE),
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/api/auth",  # Restrict to auth endpoints only
        domain=settings.COOKIE_DOMAIN,
    )


def clear_auth_cookies(response: Response) -> None:
    """Clear authentication cookies on logout."""
    response.delete_cookie(
        key=COOKIE_ACCESS_TOKEN,
        path="/api",
        domain=settings.COOKIE_DOMAIN,
    )
    response.delete_cookie(
        key=COOKIE_REFRESH_TOKEN,
        path="/api/auth",
        domain=settings.COOKIE_DOMAIN,
    )


class LoginRequest(BaseModel):
    """Login request body."""

    email: EmailStr
    password: str
    mfa_code: str | None = None  # Optional MFA code for 2FA-enabled accounts


class RegisterRequest(BaseModel):
    """Registration request body."""

    email: EmailStr
    password: str
    name: str


class TokenResponse(BaseModel):
    """Token response.

    SECURITY: Tokens are set via httpOnly cookies, not returned in body.
    The expires_in field indicates when the access token will expire.
    """

    token_type: str = _OAUTH2_TYPE_STR
    expires_in: int


class UserResponse(BaseModel):
    """User response."""

    id: str
    email: str
    name: str | None
    avatar_url: str | None = None
    role: str


class AuthResponse(BaseModel):
    """Auth response with user info.

    SECURITY: Tokens are set via httpOnly cookies, not returned in body.
    This prevents XSS attacks from stealing tokens.
    """

    user: UserResponse
    token_type: str = _OAUTH2_TYPE_STR
    expires_in: int
    mfa_required: bool = False


class MFARequiredResponse(BaseModel):
    """Response when MFA is required to complete login."""

    mfa_required: bool = True
    message: str = "MFA verification required"


class TokenInfo:
    """Token creation result with metadata for registration."""

    def __init__(self, token: str, jti: str, expires_in_seconds: int) -> None:
        self.token = token
        self.jti = jti
        self.expires_in_seconds = expires_in_seconds


def create_access_token(user_id: str, role: str = "member") -> TokenInfo:
    """Create JWT access token with JTI for revocation support."""
    jti = str(uuid4())
    expires_in = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    expire = datetime.now(UTC) + timedelta(seconds=expires_in)
    to_encode = {
        "sub": user_id,
        "role": role,
        "exp": expire,
        "type": "access",
        "jti": jti,
    }
    token = str(jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM))
    return TokenInfo(token, jti, expires_in)


def create_refresh_token(user_id: str) -> TokenInfo:
    """Create JWT refresh token with JTI for revocation support."""
    jti = str(uuid4())
    expires_in = settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400
    expire = datetime.now(UTC) + timedelta(seconds=expires_in)
    to_encode = {
        "sub": user_id,
        "exp": expire,
        "type": "refresh",
        "jti": jti,
    }
    token = str(jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM))
    return TokenInfo(token, jti, expires_in)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash."""
    result: bool = bcrypt.verify(plain_password, hashed_password)
    return result


def hash_password(password: str) -> str:
    """Hash a password."""
    hashed: str = bcrypt.hash(password)
    return hashed


@router.post("/login", response_model=AuthResponse | MFARequiredResponse)
@limiter.limit(RATE_LIMIT_AUTH)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> AuthResponse | MFARequiredResponse:
    """Authenticate user and return tokens.

    If MFA is enabled, either provide mfa_code in the request body,
    or receive an MFARequiredResponse indicating MFA is needed.
    """
    # Query user by email
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Check if user has a password (not OAuth-only user)
    if not user.password_hash:
        raise HTTPException(
            status_code=401,
            detail="This account uses OAuth login. Please sign in with your OAuth provider.",
        )

    # Verify password
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Check if user is active
    if not user.is_active:
        raise HTTPException(status_code=401, detail="Account is disabled")

    # Check if MFA is required
    if user.mfa_enabled:
        if not body.mfa_code:
            # MFA is enabled but no code provided - request MFA
            return MFARequiredResponse()

        # Verify MFA code
        mfa_service = get_mfa_service()
        verification, updated_backup_codes = mfa_service.verify_mfa(
            body.mfa_code,
            user.mfa_secret,
            user.mfa_backup_codes,
        )

        if not verification.success:
            raise HTTPException(status_code=401, detail="Invalid MFA code")

        # Update backup codes if one was used
        if verification.used_backup_code and updated_backup_codes is not None:
            user.mfa_backup_codes = updated_backup_codes
            await db.commit()

    # Get user role from database
    user_role = getattr(user, "role", "member") or "member"

    access_token_info = create_access_token(user.id, role=user_role)
    refresh_token_info = create_refresh_token(user.id)

    # Register tokens for bulk revocation support
    await register_user_token(user.id, access_token_info.jti, access_token_info.expires_in_seconds)
    await register_user_token(
        user.id, refresh_token_info.jti, refresh_token_info.expires_in_seconds
    )

    # Set httpOnly cookies for secure token storage
    # SECURITY: Tokens are NOT returned in response body to prevent XSS theft
    set_auth_cookies(response, access_token_info.token, refresh_token_info.token)

    return AuthResponse(
        user=UserResponse(
            id=user.id,
            email=user.email,
            name=user.name,
            avatar_url=user.avatar_url,
            role=user_role,
        ),
        expires_in=access_token_info.expires_in_seconds,
    )


@router.post("/register", response_model=AuthResponse)
@limiter.limit(RATE_LIMIT_AUTH)
async def register(
    body: RegisterRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> AuthResponse:
    """Register new user."""
    # Validate password complexity
    password_validation = validate_password(body.password)
    if not password_validation.is_valid:
        # Format errors as a string for consistent API response format
        errors_str = "; ".join(password_validation.errors)
        raise HTTPException(
            status_code=400,
            detail=f"Password does not meet requirements: {errors_str}",
        )

    # Check if email already exists
    result = await db.execute(select(User).where(User.email == body.email))
    existing_user = result.scalar_one_or_none()

    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Create new user with hashed password
    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        name=body.name,
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # Auto-assign Free plan subscription
    free_plan_result = await db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.slug == "free")
    )
    free_plan = free_plan_result.scalar_one_or_none()

    if free_plan:
        # Create subscription for this user
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

    # Get user role (will be "member" for new users)
    user_role = getattr(user, "role", "member") or "member"

    access_token_info = create_access_token(user.id, role=user_role)
    refresh_token_info = create_refresh_token(user.id)

    # Register tokens for bulk revocation support
    await register_user_token(user.id, access_token_info.jti, access_token_info.expires_in_seconds)
    await register_user_token(
        user.id, refresh_token_info.jti, refresh_token_info.expires_in_seconds
    )

    # Set httpOnly cookies for secure token storage
    set_auth_cookies(response, access_token_info.token, refresh_token_info.token)

    return AuthResponse(
        user=UserResponse(
            id=user.id,
            email=user.email,
            name=user.name,
            avatar_url=user.avatar_url,
            role=user_role,
        ),
        expires_in=access_token_info.expires_in_seconds,
    )


class RefreshRequest(BaseModel):
    """Refresh token request.

    The refresh_token can be provided in the request body OR via httpOnly cookie.
    Cookie-based refresh is preferred for security.
    """

    refresh_token: str | None = None  # Optional - can use cookie instead


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def refresh_token(
    request: Request,
    response: Response,
    db: DbSession,
    body: RefreshRequest | None = None,
) -> TokenResponse:
    """Refresh access token using refresh token.

    The refresh token can be provided via:
    1. httpOnly cookie (preferred, more secure)
    2. Request body (for backward compatibility)
    """
    # Get refresh token from cookie first, then body
    token = request.cookies.get(COOKIE_REFRESH_TOKEN)
    if not token and body and body.refresh_token:
        token = body.refresh_token

    if not token:
        raise HTTPException(status_code=401, detail="Refresh token required")

    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )

        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")

        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")

        # SECURITY: Require jti claim for token revocation support
        old_jti = payload.get("jti")
        if not old_jti:
            raise HTTPException(status_code=401, detail="Invalid token format")

        # SECURITY: Check if this refresh token has been revoked BEFORE issuing new tokens
        # This prevents reuse of compromised refresh tokens
        if await is_token_revoked(old_jti):
            raise HTTPException(status_code=401, detail="Token has been revoked")

        # Verify user still exists and is active
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()

        if not user or not user.is_active:
            raise HTTPException(status_code=401, detail="User not found or inactive")

        # Revoke the old refresh token to prevent reuse
        if old_jti:
            old_exp = payload.get("exp", 0)
            remaining_ttl = max(int(old_exp - datetime.now(UTC).timestamp()), 0)
            await revoke_token(old_jti, remaining_ttl)

        # Get user's current role from database (not from old token)
        # This ensures role changes are reflected on token refresh
        user_role = getattr(user, "role", "member") or "member"

        new_access_token_info = create_access_token(str(user_id), role=user_role)
        new_refresh_token_info = create_refresh_token(str(user_id))

        # Register new tokens for bulk revocation support
        await register_user_token(
            str(user_id), new_access_token_info.jti, new_access_token_info.expires_in_seconds
        )
        await register_user_token(
            str(user_id), new_refresh_token_info.jti, new_refresh_token_info.expires_in_seconds
        )

        # Set new httpOnly cookies
        set_auth_cookies(response, new_access_token_info.token, new_refresh_token_info.token)

        return TokenResponse(
            expires_in=new_access_token_info.expires_in_seconds,
        )
    except JWTError as e:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from e


class LogoutResponse(BaseModel):
    """Logout response."""

    message: str = "Logged out successfully"


class LogoutRequest(BaseModel):
    """Logout request."""

    revoke_all_sessions: bool = False  # If True, revoke all tokens for this user


@router.post("/logout", response_model=LogoutResponse)
async def logout(
    request: Request,
    response: Response,
    body: LogoutRequest | None = None,
) -> LogoutResponse:
    """Log out user by clearing authentication cookies.

    This endpoint clears the httpOnly cookies that store auth tokens.
    Optionally revokes all sessions for the user if requested.
    """
    clear_auth_cookies(response)

    # Optionally revoke all user tokens (e.g., "log out everywhere")
    if body and body.revoke_all_sessions:
        user_id = getattr(request.state, "user_id", None)
        if user_id:
            revoked_count = await revoke_all_user_tokens(user_id)
            return LogoutResponse(
                message=f"Logged out successfully. Revoked {revoked_count} active sessions."
            )

    return LogoutResponse()


@router.get("/me", response_model=UserResponse)
async def get_current_user(request: Request, db: DbSession) -> UserResponse:
    """Get current authenticated user."""
    user_id = getattr(request.state, "user_id", None)

    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        avatar_url=user.avatar_url,
        role=getattr(request.state, "user_role", "member"),
    )


class PasswordStrengthRequest(BaseModel):
    """Password strength check request."""

    password: str


class PasswordStrengthResponse(BaseModel):
    """Password strength check response."""

    strength: str  # weak, fair, good, strong, very_strong
    is_valid: bool
    errors: list[str]


@router.post("/password/check", response_model=PasswordStrengthResponse)
async def check_password_strength(body: PasswordStrengthRequest) -> PasswordStrengthResponse:
    """Check password strength without creating account.

    This endpoint is public to allow password strength feedback during signup.
    """
    validation = validate_password(body.password)
    strength = get_password_strength(body.password)

    return PasswordStrengthResponse(
        strength=strength,
        is_valid=validation.is_valid,
        errors=validation.errors,
    )


class ChangePasswordRequest(BaseModel):
    """Change password request."""

    current_password: str
    new_password: str


@router.post("/password/change")
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def change_password(
    body: ChangePasswordRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, str | int]:
    """Change current user's password."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Check if user has a password (not OAuth-only)
    if not user.password_hash:
        raise HTTPException(
            status_code=400,
            detail="Cannot change password for OAuth-only accounts",
        )

    # Verify current password
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    # Validate new password complexity
    password_validation = validate_password(body.new_password)
    if not password_validation.is_valid:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "New password does not meet requirements",
                "errors": password_validation.errors,
            },
        )

    # Ensure new password is different from current
    if verify_password(body.new_password, user.password_hash):
        raise HTTPException(
            status_code=400,
            detail="New password must be different from current password",
        )

    # Update password
    user.password_hash = hash_password(body.new_password)
    await db.commit()

    # SECURITY: Revoke all existing tokens on password change
    # This ensures any compromised sessions are terminated
    revoked_count = await revoke_all_user_tokens(user_id)

    # Clear current session cookies
    clear_auth_cookies(response)

    return {
        "message": "Password changed successfully. Please log in again.",
        "sessions_revoked": revoked_count,
    }
