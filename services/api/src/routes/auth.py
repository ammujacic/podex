"""Authentication routes."""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal, cast
from uuid import uuid4

import structlog
from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from jose import JWTError, jwt
from passlib.hash import bcrypt
from pydantic import BaseModel, EmailStr
from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from user_agents import parse as parse_user_agent  # type: ignore[import-not-found]

from src.audit_logger import AuditAction, AuditLogger, AuditStatus
from src.auth_constants import COOKIE_ACCESS_TOKEN, COOKIE_REFRESH_TOKEN
from src.config import settings
from src.database.connection import get_db
from src.database.models import (
    DeviceSession,
    PlatformInvitation,
    PlatformSetting,
    SubscriptionPlan,
    User,
    UserSubscription,
)
from src.middleware.rate_limit import RATE_LIMIT_AUTH, RATE_LIMIT_SENSITIVE, limiter
from src.routes.billing import sync_quotas_from_plan
from src.services.geolocation import lookup_ip_location
from src.services.mfa import get_mfa_service
from src.services.token_blacklist import (
    is_token_revoked,
    register_user_token,
    revoke_all_user_tokens,
    revoke_token,
)
from src.utils.password_validator import get_password_strength, validate_password

logger = structlog.get_logger()

router = APIRouter()

# Type alias for database session dependency
DbSession = Annotated[AsyncSession, Depends(get_db)]

# OAuth2 token type constant - standard OAuth2 token type identifier
_OAUTH2_TYPE_STR = "bearer"  # not a password, standard OAuth2 type identifier


def set_auth_cookies(
    response: Response,
    access_token: str,
    refresh_token: str,
    *,
    access_max_age_seconds: int | None = None,
    refresh_max_age_seconds: int | None = None,
) -> None:
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
        max_age=access_max_age_seconds or settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
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
        max_age=refresh_max_age_seconds or settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
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
    invitation_token: str | None = None  # Optional token from platform invitation


class TokenResponse(BaseModel):
    """Token response.

    SECURITY:
    - In production, browser clients use httpOnly cookies.
    - Non-browser clients can receive tokens in the response body.
    """

    access_token: str | None = None
    refresh_token: str | None = None
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

    SECURITY:
    - In production (COOKIE_SECURE=true): Tokens are ONLY in httpOnly cookies (XSS protection)
    - In development (COOKIE_SECURE=false): Tokens also returned in body for compatibility
    """

    user: UserResponse
    access_token: str | None = None  # Only set when COOKIE_SECURE=false
    refresh_token: str | None = None  # Only set when COOKIE_SECURE=false
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


def _is_browser_request(request: Request) -> bool:
    """Heuristic check for browser requests based on headers."""
    user_agent = request.headers.get("user-agent", "")
    if not user_agent:
        return False
    browser_markers = ("Mozilla/", "AppleWebKit/", "Chrome/", "Safari/", "Firefox/")
    return any(marker in user_agent for marker in browser_markers)


def _should_return_tokens(request: Request) -> bool:
    """Decide whether to include tokens in the response body."""
    if not settings.COOKIE_SECURE:
        return True
    if request.headers.get("x-client-type") == "non-browser":
        return True
    if request.headers.get("x-auth-response") == "token":
        return True
    return not _is_browser_request(request)


def _get_token_ttls(return_tokens: bool) -> tuple[int, int]:
    """Get access/refresh token TTLs based on client type."""
    if return_tokens:
        access_ttl = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
        refresh_ttl = settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400
    else:
        access_ttl = settings.BROWSER_ACCESS_TOKEN_EXPIRE_MINUTES * 60
        refresh_ttl = settings.BROWSER_REFRESH_TOKEN_EXPIRE_DAYS * 86400
    return access_ttl, refresh_ttl


def _parse_device_info(request: Request) -> dict[str, str | None]:
    """Extract device information from request headers for session tracking."""
    user_agent_str = request.headers.get("user-agent", "")
    ua = parse_user_agent(user_agent_str) if user_agent_str else None

    # Determine device type from header or user agent
    x_device_type = request.headers.get("x-device-type", "").lower()
    if x_device_type:
        device_type = x_device_type
    elif ua:
        if ua.is_mobile:
            device_type = "mobile"
        elif ua.is_tablet:
            device_type = "tablet"
        elif ua.is_pc:
            device_type = "browser"
        else:
            device_type = "unknown"
    else:
        device_type = "unknown"

    # Build device name
    device_name = request.headers.get("x-device-name")
    if not device_name and ua:
        if ua.browser.family and ua.os.family:
            device_name = f"{ua.browser.family} on {ua.os.family}"
        elif ua.device.family:
            device_name = ua.device.family

    # Get IP address (handle proxies)
    ip_address: str | None = (
        request.headers.get("x-forwarded-for", "").split(",")[0].strip() or None
    )
    if not ip_address:
        ip_address = request.client.host if request.client else None

    return {
        "device_type": device_type,
        "device_name": device_name,
        "user_agent": user_agent_str,
        "ip_address": ip_address,
        "os_name": ua.os.family if ua else None,
        "browser_name": ua.browser.family if ua else None,
    }


async def _create_device_session(
    db: AsyncSession,
    user_id: str,
    refresh_token_jti: str,
    refresh_ttl: int,
    request: Request,
) -> DeviceSession:
    """Create a device session record for tracking active sessions."""
    device_info = _parse_device_info(request)

    # Look up geolocation from IP
    city, country, country_code = lookup_ip_location(device_info["ip_address"])

    device_session = DeviceSession(
        user_id=user_id,
        device_type=device_info["device_type"],
        device_name=device_info["device_name"],
        refresh_token_jti=refresh_token_jti,
        ip_address=device_info["ip_address"],
        user_agent=device_info["user_agent"],
        os_name=device_info["os_name"],
        browser_name=device_info["browser_name"],
        city=city,
        country=country,
        country_code=country_code,
        expires_at=datetime.now(UTC) + timedelta(seconds=refresh_ttl),
    )
    db.add(device_session)

    return device_session


def create_access_token(
    user_id: str,
    role: str = "member",
    expires_in_seconds: int | None = None,
) -> TokenInfo:
    """Create JWT access token with JTI for revocation support."""
    jti = str(uuid4())
    expires_in = expires_in_seconds or settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
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


def create_refresh_token(user_id: str, expires_in_seconds: int | None = None) -> TokenInfo:
    """Create JWT refresh token with JTI for revocation support."""
    jti = str(uuid4())
    expires_in = expires_in_seconds or settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400
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
        # Log failed login attempt (user not found)
        audit = AuditLogger(db).set_context(request=request)
        await audit.log_auth(
            AuditAction.AUTH_LOGIN_FAILED,
            status=AuditStatus.FAILURE,
            details={"email": body.email, "reason": "user_not_found"},
        )
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Check if user has a password (not OAuth-only user)
    if not user.password_hash:
        raise HTTPException(
            status_code=401,
            detail="This account uses OAuth login. Please sign in with your OAuth provider.",
        )

    # Verify password
    if not verify_password(body.password, user.password_hash):
        # Log failed login attempt (bad password)
        audit = AuditLogger(db).set_context(request=request, user_id=user.id, user_email=user.email)
        await audit.log_auth(
            AuditAction.AUTH_LOGIN_FAILED,
            status=AuditStatus.FAILURE,
            details={"reason": "invalid_password"},
            resource_id=user.id,
        )
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
            # Log failed MFA verification
            audit = AuditLogger(db).set_context(
                request=request, user_id=user.id, user_email=user.email
            )
            await audit.log_auth(
                AuditAction.AUTH_LOGIN_FAILED,
                status=AuditStatus.FAILURE,
                details={"reason": "invalid_mfa_code"},
                resource_id=user.id,
            )
            raise HTTPException(status_code=401, detail="Invalid MFA code")

        # Update backup codes if one was used
        if verification.used_backup_code and updated_backup_codes is not None:
            user.mfa_backup_codes = updated_backup_codes
            await db.commit()

    # Get user role from database
    user_role = getattr(user, "role", "member") or "member"

    return_tokens = _should_return_tokens(request)
    access_ttl, refresh_ttl = _get_token_ttls(return_tokens)
    access_token_info = create_access_token(user.id, role=user_role, expires_in_seconds=access_ttl)
    refresh_token_info = create_refresh_token(user.id, expires_in_seconds=refresh_ttl)

    # Register tokens for bulk revocation support
    await register_user_token(user.id, access_token_info.jti, access_token_info.expires_in_seconds)
    await register_user_token(
        user.id, refresh_token_info.jti, refresh_token_info.expires_in_seconds
    )

    # Create device session for tracking
    await _create_device_session(db, user.id, refresh_token_info.jti, refresh_ttl, request)
    await db.commit()

    # Set httpOnly cookies for secure token storage (XSS protection)
    set_auth_cookies(
        response,
        access_token_info.token,
        refresh_token_info.token,
        access_max_age_seconds=access_ttl,
        refresh_max_age_seconds=refresh_ttl,
    )

    # Log successful login
    audit = AuditLogger(db).set_context(request=request, user_id=user.id, user_email=user.email)
    await audit.log_auth(
        AuditAction.AUTH_LOGIN,
        status=AuditStatus.SUCCESS,
        details={"mfa_used": user.mfa_enabled},
        resource_id=user.id,
    )

    # In production (COOKIE_SECURE=true), tokens are ONLY in httpOnly cookies
    # In development (COOKIE_SECURE=false), also return in body for compatibility
    return AuthResponse(
        user=UserResponse(
            id=user.id,
            email=user.email,
            name=user.name,
            avatar_url=user.avatar_url,
            role=user_role,
        ),
        access_token=access_token_info.token if return_tokens else None,
        refresh_token=refresh_token_info.token if return_tokens else None,
        expires_in=access_token_info.expires_in_seconds,
    )


class InvitationValidationResponse(BaseModel):
    """Response for invitation validation."""

    valid: bool
    email: str | None = None
    gift_plan_name: str | None = None
    gift_months: int | None = None
    expires_at: datetime | None = None
    message: str | None = None
    inviter_name: str | None = None


@router.get("/invitation/{token}", response_model=InvitationValidationResponse)
@limiter.limit(RATE_LIMIT_AUTH)
async def validate_invitation(
    token: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> InvitationValidationResponse:
    """Validate an invitation token (public endpoint for registration page)."""
    result = await db.execute(
        select(PlatformInvitation)
        .where(PlatformInvitation.token == token)
        .where(PlatformInvitation.status == "pending")
        .where(PlatformInvitation.expires_at > datetime.now(UTC))
    )
    invitation = result.scalar_one_or_none()

    if not invitation:
        return InvitationValidationResponse(valid=False)

    return InvitationValidationResponse(
        valid=True,
        email=invitation.email,
        gift_plan_name=invitation.gift_plan.name if invitation.gift_plan else None,
        gift_months=invitation.gift_months,
        expires_at=invitation.expires_at,
        message=invitation.message,
        inviter_name=invitation.invited_by.name if invitation.invited_by else None,
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

    # Validate invitation if registration is disabled or token is provided
    invitation: PlatformInvitation | None = None
    if body.invitation_token:
        invitation_result = await db.execute(
            select(PlatformInvitation)
            .where(PlatformInvitation.token == body.invitation_token)
            .where(PlatformInvitation.status == "pending")
            .where(PlatformInvitation.expires_at > datetime.now(UTC))
        )
        invitation = invitation_result.scalar_one_or_none()

        if not invitation:
            raise HTTPException(
                status_code=403,
                detail="Invalid or expired invitation token.",
            )

        # Verify email matches invitation
        if invitation.email.lower() != body.email.lower():
            raise HTTPException(
                status_code=403,
                detail="Email does not match the invitation.",
            )

    # If registration is disabled and no valid invitation, reject
    if not registration_enabled and not invitation:
        raise HTTPException(
            status_code=403,
            detail="Registration is currently disabled. You need an invitation to register.",
        )

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

    # Determine which plan to assign
    now = datetime.now(UTC)

    # Check if invitation has gift subscription
    if invitation and invitation.gift_plan_id and invitation.gift_months:
        # Use gifted plan from invitation
        plan_result = await db.execute(
            select(SubscriptionPlan).where(SubscriptionPlan.id == invitation.gift_plan_id)
        )
        plan = plan_result.scalar_one_or_none()

        if plan:
            # Create sponsored subscription with gifted months
            period_end = now + relativedelta(months=invitation.gift_months)
            subscription = UserSubscription(
                user_id=user.id,
                plan_id=plan.id,
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
            await sync_quotas_from_plan(db, user.id, plan, subscription)
        else:
            # Fallback to free plan if gifted plan not found
            plan = None

    else:
        plan = None

    # If no gifted plan, assign Free plan
    if not plan:
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

    # Get user role (will be "member" for new users)
    user_role = getattr(user, "role", "member") or "member"

    return_tokens = _should_return_tokens(request)
    access_ttl, refresh_ttl = _get_token_ttls(return_tokens)
    access_token_info = create_access_token(user.id, role=user_role, expires_in_seconds=access_ttl)
    refresh_token_info = create_refresh_token(user.id, expires_in_seconds=refresh_ttl)

    # Register tokens for bulk revocation support
    await register_user_token(user.id, access_token_info.jti, access_token_info.expires_in_seconds)
    await register_user_token(
        user.id, refresh_token_info.jti, refresh_token_info.expires_in_seconds
    )

    # Create device session for tracking
    await _create_device_session(db, user.id, refresh_token_info.jti, refresh_ttl, request)
    await db.commit()

    # Set httpOnly cookies for secure token storage (XSS protection)
    set_auth_cookies(
        response,
        access_token_info.token,
        refresh_token_info.token,
        access_max_age_seconds=access_ttl,
        refresh_max_age_seconds=refresh_ttl,
    )

    # Log user registration
    audit = AuditLogger(db).set_context(request=request, user_id=user.id, user_email=user.email)
    await audit.log(
        AuditAction.USER_CREATED,
        category="user",
        status=AuditStatus.SUCCESS,
        resource_type="user",
        resource_id=user.id,
        details={"email": user.email, "name": user.name},
    )

    # In production (COOKIE_SECURE=true), tokens are ONLY in httpOnly cookies
    # In development (COOKIE_SECURE=false), also return in body for compatibility
    return AuthResponse(
        user=UserResponse(
            id=user.id,
            email=user.email,
            name=user.name,
            avatar_url=user.avatar_url,
            role=user_role,
        ),
        access_token=access_token_info.token if return_tokens else None,
        refresh_token=refresh_token_info.token if return_tokens else None,
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

        # SECURITY: Refresh Token Reuse Detection
        # If the token has already been revoked but someone is trying to use it again,
        # this indicates potential token theft. The legitimate user already rotated the token,
        # but an attacker is trying to use the stolen (now-revoked) token.
        if await is_token_revoked(old_jti):
            logger.warning(
                "Refresh token reuse detected - potential token theft",
                user_id=user_id[:8] if user_id else None,
                jti=old_jti[:8],
            )

            # SECURITY RESPONSE: Revoke ALL sessions for this user
            # This forces re-authentication on all devices
            await revoke_all_user_tokens(str(user_id))

            # Also mark all device sessions as revoked in the database
            await db.execute(
                update(DeviceSession)
                .where(
                    and_(
                        DeviceSession.user_id == user_id,
                        DeviceSession.is_revoked == False,
                    )
                )
                .values(is_revoked=True, revoked_at=datetime.now(UTC))
            )
            await db.commit()

            raise HTTPException(
                status_code=401,
                detail=(
                    "Security alert: Token reuse detected. "
                    "All sessions have been revoked. Please log in again."
                ),
            )

        # Verify user still exists and is active
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()

        if not user or not user.is_active:
            raise HTTPException(status_code=401, detail="User not found or inactive")

        # Find the device session for this refresh token
        device_session_result = await db.execute(
            select(DeviceSession).where(DeviceSession.refresh_token_jti == old_jti)
        )
        device_session = device_session_result.scalar_one_or_none()

        # Revoke the old refresh token to prevent reuse
        old_exp = payload.get("exp", 0)
        remaining_ttl = max(int(old_exp - datetime.now(UTC).timestamp()), 0)
        await revoke_token(old_jti, remaining_ttl)

        # Get user's current role from database (not from old token)
        # This ensures role changes are reflected on token refresh
        user_role = getattr(user, "role", "member") or "member"

        return_tokens = _should_return_tokens(request)
        access_ttl, refresh_ttl = _get_token_ttls(return_tokens)
        new_access_token_info = create_access_token(
            str(user_id), role=user_role, expires_in_seconds=access_ttl
        )
        new_refresh_token_info = create_refresh_token(str(user_id), expires_in_seconds=refresh_ttl)

        # Register new tokens for bulk revocation support
        await register_user_token(
            str(user_id), new_access_token_info.jti, new_access_token_info.expires_in_seconds
        )
        await register_user_token(
            str(user_id), new_refresh_token_info.jti, new_refresh_token_info.expires_in_seconds
        )

        # Update device session with new refresh token JTI (token rotation)
        if device_session:
            device_session.refresh_token_jti = new_refresh_token_info.jti
            device_session.last_active_at = datetime.now(UTC)
            device_session.expires_at = datetime.now(UTC) + timedelta(seconds=refresh_ttl)
            await db.commit()

        # Set new httpOnly cookies
        set_auth_cookies(
            response,
            new_access_token_info.token,
            new_refresh_token_info.token,
            access_max_age_seconds=access_ttl,
            refresh_max_age_seconds=refresh_ttl,
        )

        return TokenResponse(
            access_token=new_access_token_info.token if return_tokens else None,
            refresh_token=new_refresh_token_info.token if return_tokens else None,
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
    db: DbSession,
    body: LogoutRequest | None = None,
) -> LogoutResponse:
    """Log out user by clearing authentication cookies.

    This endpoint clears the httpOnly cookies that store auth tokens.
    Optionally revokes all sessions for the user if requested.
    """
    user_id = getattr(request.state, "user_id", None)
    user_email = getattr(request.state, "user_email", None)

    clear_auth_cookies(response)

    # Log logout
    if user_id:
        audit = AuditLogger(db).set_context(request=request, user_id=user_id, user_email=user_email)
        await audit.log_auth(
            AuditAction.AUTH_LOGOUT,
            status=AuditStatus.SUCCESS,
            resource_id=user_id,
            details={"revoke_all_sessions": body.revoke_all_sessions if body else False},
        )

    # Optionally revoke all user tokens (e.g., "log out everywhere")
    if body and body.revoke_all_sessions and user_id:
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

    # Log password change
    audit = AuditLogger(db).set_context(request=request, user_id=user.id, user_email=user.email)
    await audit.log_auth(
        AuditAction.AUTH_PASSWORD_CHANGED,
        status=AuditStatus.SUCCESS,
        resource_id=user.id,
    )

    # SECURITY: Revoke all existing tokens on password change
    # This ensures any compromised sessions are terminated
    revoked_count = await revoke_all_user_tokens(user_id)

    # Clear current session cookies
    clear_auth_cookies(response)

    return {
        "message": "Password changed successfully. Please log in again.",
        "sessions_revoked": revoked_count,
    }


# ============== Password Reset ==============


class ForgotPasswordRequest(BaseModel):
    """Forgot password request."""

    email: EmailStr


class ForgotPasswordResponse(BaseModel):
    """Forgot password response."""

    message: str = "If an account exists with this email, a password reset link has been sent."


class ResetPasswordRequest(BaseModel):
    """Reset password request."""

    token: str
    new_password: str


class ResetPasswordResponse(BaseModel):
    """Reset password response."""

    message: str = "Password reset successfully. Please log in with your new password."


# Password reset token storage (using Redis)
PASSWORD_RESET_PREFIX = "podex:password_reset:"
PASSWORD_RESET_TTL = 3600  # 1 hour


async def _store_password_reset_token(token: str, user_id: str, email: str) -> None:
    """Store password reset token in Redis."""
    import json  # noqa: PLC0415

    from src.middleware.rate_limit import get_redis_client  # noqa: PLC0415

    client = await get_redis_client()
    key = f"{PASSWORD_RESET_PREFIX}{token}"
    value = json.dumps({"user_id": user_id, "email": email})
    await client.setex(key, PASSWORD_RESET_TTL, value)


async def _validate_password_reset_token(token: str) -> dict[str, str] | None:
    """Validate and consume password reset token from Redis.

    Returns user_id and email if valid, None otherwise.
    Token is consumed (deleted) on validation to prevent reuse.
    """
    import json  # noqa: PLC0415

    from src.middleware.rate_limit import get_redis_client  # noqa: PLC0415

    try:
        client = await get_redis_client()
        key = f"{PASSWORD_RESET_PREFIX}{token}"

        # Get and delete atomically to prevent reuse
        value = await client.getdel(key)

        if not value:
            return None

        data = json.loads(value)
        return {"user_id": data.get("user_id"), "email": data.get("email")}
    except Exception:
        return None


@router.post("/password/forgot", response_model=ForgotPasswordResponse)
@limiter.limit(RATE_LIMIT_AUTH)
async def forgot_password(
    body: ForgotPasswordRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> ForgotPasswordResponse:
    """Request a password reset link.

    Always returns success to prevent email enumeration.
    Only sends email if user exists and has a password (not OAuth-only).
    """
    import secrets  # noqa: PLC0415

    import structlog  # noqa: PLC0415

    from src.services.email import EmailTemplate, get_email_service  # noqa: PLC0415

    logger = structlog.get_logger()

    # Look up user by email
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    # Only send reset email if user exists and has a password
    # (OAuth-only users cannot reset password)
    if user and user.password_hash:
        # Generate secure reset token
        reset_token = secrets.token_urlsafe(32)

        # Store token in Redis with user info
        await _store_password_reset_token(reset_token, user.id, user.email)

        # Build reset URL
        reset_url = f"{settings.FRONTEND_URL}/auth/reset-password?token={reset_token}"

        # Send password reset email
        email_service = get_email_service()
        email_result = await email_service.send_email(
            to_email=user.email,
            template=EmailTemplate.PASSWORD_RESET,
            context={
                "name": user.name or "there",
                "reset_url": reset_url,
            },
        )

        if email_result.success:
            logger.info("Password reset email sent", user_id=user.id[:8])
        else:
            logger.error(
                "Failed to send password reset email",
                user_id=user.id[:8],
                error=email_result.error,
            )
    else:
        # Log for security monitoring but don't reveal if user exists
        logger = structlog.get_logger()
        logger.info(
            "Password reset requested for non-existent or OAuth user", email=body.email[:3] + "***"
        )

    # Always return success to prevent email enumeration
    return ForgotPasswordResponse()


@router.post("/password/reset", response_model=ResetPasswordResponse)
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def reset_password(
    body: ResetPasswordRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> ResetPasswordResponse:
    """Reset password using a valid reset token."""
    import structlog  # noqa: PLC0415

    from src.services.email import EmailTemplate, get_email_service  # noqa: PLC0415

    logger = structlog.get_logger()

    # Validate token and get user info
    token_data = await _validate_password_reset_token(body.token)
    if not token_data:
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired reset token. Please request a new password reset.",
        )

    user_id = token_data["user_id"]

    # Get user from database
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=400, detail="Invalid reset token")

    # Validate new password complexity
    password_validation = validate_password(body.new_password)
    if not password_validation.is_valid:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Password does not meet requirements",
                "errors": password_validation.errors,
            },
        )

    # Update password
    user.password_hash = hash_password(body.new_password)
    await db.commit()

    # Log password reset
    audit = AuditLogger(db).set_context(request=request, user_id=user.id, user_email=user.email)
    await audit.log_auth(
        AuditAction.AUTH_PASSWORD_CHANGED,
        status=AuditStatus.SUCCESS,
        resource_id=user.id,
        details={"method": "reset_token"},
    )

    # SECURITY: Revoke all existing tokens on password reset
    await revoke_all_user_tokens(user_id)

    # Send password changed notification email
    email_service = get_email_service()
    await email_service.send_email(
        to_email=user.email,
        template=EmailTemplate.PASSWORD_CHANGED,
        context={"name": user.name or "there"},
    )

    logger.info("Password reset completed", user_id=user.id[:8])

    return ResetPasswordResponse()


# ============== Account Deletion ==============


class DeleteAccountRequest(BaseModel):
    """Delete account request."""

    password: str
    mfa_code: str | None = None  # Required if MFA is enabled
    confirmation: str  # Must match user's email


class DeleteAccountResponse(BaseModel):
    """Delete account response."""

    message: str = "Account deleted successfully"


@router.delete("/account", response_model=DeleteAccountResponse)
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def delete_account(
    body: DeleteAccountRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> DeleteAccountResponse:
    """Permanently delete the current user's account.

    This action:
    - Cancels any active subscriptions
    - Deactivates the account (soft delete)
    - Revokes all authentication tokens
    - Cannot be undone
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Verify confirmation matches email
    if body.confirmation.lower() != user.email.lower():
        raise HTTPException(
            status_code=400,
            detail="Email confirmation does not match",
        )

    # Verify password (if user has password - not OAuth-only)
    if user.password_hash:
        if not verify_password(body.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Password is incorrect")
    else:
        # OAuth-only users can delete without password verification
        # but still need email confirmation
        pass

    # Check MFA if enabled
    if user.mfa_enabled:
        if not body.mfa_code:
            raise HTTPException(
                status_code=400,
                detail="MFA code required for account deletion",
            )

        mfa_service = get_mfa_service()
        verification, updated_backup_codes = mfa_service.verify_mfa(
            body.mfa_code,
            user.mfa_secret,
            user.mfa_backup_codes,
        )
        if not verification.success:
            raise HTTPException(
                status_code=401,
                detail="Invalid MFA code",
            )
        # Update backup codes if a backup code was used
        if updated_backup_codes is not None:
            user.mfa_backup_codes = updated_backup_codes

    # Cancel active subscriptions via Stripe
    subscription_result = await db.execute(
        select(UserSubscription).where(
            UserSubscription.user_id == user_id,
            UserSubscription.status.in_(["active", "trialing"]),
        )
    )
    active_subscriptions = subscription_result.scalars().all()

    for sub in active_subscriptions:
        if sub.stripe_subscription_id:
            try:
                import stripe  # noqa: PLC0415

                stripe.api_key = settings.STRIPE_SECRET_KEY
                stripe.Subscription.cancel(sub.stripe_subscription_id)
                logger.info(
                    "Cancelled subscription during account deletion",
                    user_id=user_id[:8],
                    subscription_id=sub.stripe_subscription_id[:8],
                )
            except Exception:
                logger.exception(
                    "Failed to cancel Stripe subscription",
                    user_id=user_id[:8],
                )
        sub.status = "canceled"

    # Soft delete: deactivate user account
    user.is_active = False
    user.deleted_at = datetime.now(UTC)

    # Clear sensitive data but keep record for audit purposes
    user.mfa_enabled = False
    user.mfa_secret = None
    user.mfa_backup_codes = None

    await db.commit()

    # Log account deletion
    audit = AuditLogger(db).set_context(request=request, user_id=user.id, user_email=user.email)
    await audit.log_auth(
        AuditAction.AUTH_ACCOUNT_DELETED,
        status=AuditStatus.SUCCESS,
        resource_id=user.id,
    )

    # Revoke all tokens
    await revoke_all_user_tokens(user_id)

    # Clear auth cookies
    clear_auth_cookies(response)

    logger.info("Account deleted", user_id=user_id[:8])

    return DeleteAccountResponse()
