"""Device authentication and session management routes.

Implements OAuth 2.0 Device Authorization Grant (RFC 8628) for CLI and non-browser clients,
plus session management for viewing and revoking active sessions.
"""

import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, cast

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import and_, delete, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession
from user_agents import parse as parse_user_agent  # type: ignore[import-not-found]

from src.audit_logger import AuditAction, AuditLogger, AuditStatus
from src.config import settings
from src.database.connection import get_db
from src.database.models import DeviceCode, DeviceSession, User
from src.middleware.rate_limit import RATE_LIMIT_AUTH, RATE_LIMIT_SENSITIVE, limiter
from src.routes.auth import (
    _get_token_ttls,
    _should_return_tokens,
    clear_auth_cookies,
    create_access_token,
    create_refresh_token,
    set_auth_cookies,
)
from src.services.geolocation import lookup_ip_location
from src.services.token_blacklist import register_user_token, revoke_token

logger = structlog.get_logger()

router = APIRouter()

# Type alias for database session dependency
DbSession = Annotated[AsyncSession, Depends(get_db)]

# Device code settings
DEVICE_CODE_LENGTH = 40  # Length of device_code (secret)
USER_CODE_LENGTH = 8  # Length of user_code (human-readable)
DEVICE_CODE_EXPIRES_MINUTES = 15  # How long device codes are valid
DEFAULT_POLL_INTERVAL = 5  # Seconds between polls


def _generate_device_code() -> str:
    """Generate a secure random device code."""
    return secrets.token_urlsafe(DEVICE_CODE_LENGTH)


def _generate_user_code() -> str:
    """Generate a human-readable user code (e.g., ABCD-1234)."""
    # Use only uppercase letters and digits, excluding confusable chars (0, O, I, 1, L)
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    code = "".join(secrets.choice(alphabet) for _ in range(USER_CODE_LENGTH))
    # Format as XXXX-XXXX for readability
    return f"{code[:4]}-{code[4:]}"


def _parse_device_info(request: Request, device_type: str | None = None) -> dict[str, str | None]:
    """Extract device information from request headers."""
    user_agent_str = request.headers.get("user-agent", "")
    ua = parse_user_agent(user_agent_str) if user_agent_str else None

    # Determine device type from header or user agent
    if not device_type:
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
        if device_type == "cli":
            device_name = "Podex CLI"
        elif device_type == "vscode":
            device_name = "VS Code Extension"
        elif ua.browser.family and ua.os.family:
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


# ============== Device Code Flow ==============


class DeviceCodeRequest(BaseModel):
    """Request to initiate device authorization."""

    device_type: str = "cli"  # cli, vscode, mobile
    device_name: str | None = None


class DeviceCodeResponse(BaseModel):
    """Response with device code info for user display."""

    device_code: str  # Secret code for device to poll with
    user_code: str  # Code user enters in browser
    verification_uri: str  # URL user visits
    verification_uri_complete: str  # URL with code pre-filled
    expires_in: int  # Seconds until codes expire
    interval: int  # Minimum seconds between polls


@router.post("/device/code", response_model=DeviceCodeResponse)
@limiter.limit(RATE_LIMIT_AUTH)
async def request_device_code(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    body: DeviceCodeRequest | None = None,
) -> DeviceCodeResponse:
    """Request a device code for CLI/device authentication.

    The device displays the user_code to the user, who then visits
    verification_uri in a browser to authorize the device.
    """
    device_info = _parse_device_info(request, device_type=body.device_type if body else "cli")

    # Generate unique codes
    device_code = _generate_device_code()
    user_code = _generate_user_code()

    # Calculate expiration
    expires_at = datetime.now(UTC) + timedelta(minutes=DEVICE_CODE_EXPIRES_MINUTES)

    # Create device code record
    code_record = DeviceCode(
        device_code=device_code,
        user_code=user_code,
        device_type=device_info["device_type"],
        device_name=body.device_name if body else device_info["device_name"],
        ip_address=device_info["ip_address"],
        user_agent=device_info["user_agent"],
        expires_at=expires_at,
        interval=DEFAULT_POLL_INTERVAL,
    )
    db.add(code_record)
    await db.commit()

    # Build verification URLs
    verification_uri = f"{settings.FRONTEND_URL}/device"
    verification_uri_complete = f"{verification_uri}?code={user_code}"

    logger.info(
        "Device code created",
        device_type=device_info["device_type"],
        user_code=user_code,
    )

    return DeviceCodeResponse(
        device_code=device_code,
        user_code=user_code,
        verification_uri=verification_uri,
        verification_uri_complete=verification_uri_complete,
        expires_in=DEVICE_CODE_EXPIRES_MINUTES * 60,
        interval=DEFAULT_POLL_INTERVAL,
    )


class DeviceTokenRequest(BaseModel):
    """Request to exchange device code for tokens."""

    device_code: str


class DeviceTokenResponse(BaseModel):
    """Token response for device auth."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class DeviceTokenErrorResponse(BaseModel):
    """Error response during device token polling."""

    error: str  # authorization_pending, slow_down, expired_token, access_denied
    error_description: str | None = None


@router.post("/device/token")
@limiter.limit(RATE_LIMIT_AUTH)
async def poll_device_token(
    request: Request,
    response: Response,
    db: DbSession,
    body: DeviceTokenRequest,
) -> DeviceTokenResponse | DeviceTokenErrorResponse:
    """Poll for access token using device code.

    Returns tokens when user authorizes, or an error code while waiting.
    """
    # Look up device code
    result = await db.execute(select(DeviceCode).where(DeviceCode.device_code == body.device_code))
    code_record = result.scalar_one_or_none()

    if not code_record:
        return DeviceTokenErrorResponse(
            error="invalid_grant",
            error_description="Invalid device code",
        )

    # Check if expired
    if datetime.now(UTC) > code_record.expires_at:
        code_record.status = "expired"
        await db.commit()
        return DeviceTokenErrorResponse(
            error="expired_token",
            error_description="Device code has expired. Please request a new code.",
        )

    # Check status
    if code_record.status == "denied":
        return DeviceTokenErrorResponse(
            error="access_denied",
            error_description="User denied the authorization request.",
        )

    if code_record.status == "pending":
        return DeviceTokenErrorResponse(
            error="authorization_pending",
            error_description="User has not yet authorized this device.",
        )

    if code_record.status != "authorized":
        return DeviceTokenErrorResponse(
            error="invalid_grant",
            error_description="Invalid device code status.",
        )

    # Status is authorized - issue tokens
    user_id = code_record.user_id
    if not user_id:
        return DeviceTokenErrorResponse(
            error="server_error",
            error_description="Authorization incomplete.",
        )

    # Get user for role
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        return DeviceTokenErrorResponse(
            error="server_error",
            error_description="User not found.",
        )

    user_role = getattr(user, "role", "member") or "member"

    # Create tokens
    return_tokens = _should_return_tokens(request)
    access_ttl, refresh_ttl = _get_token_ttls(return_tokens)
    access_token_info = create_access_token(user_id, role=user_role, expires_in_seconds=access_ttl)
    refresh_token_info = create_refresh_token(user_id, expires_in_seconds=refresh_ttl)

    # Register tokens for bulk revocation
    await register_user_token(user_id, access_token_info.jti, access_token_info.expires_in_seconds)
    await register_user_token(
        user_id, refresh_token_info.jti, refresh_token_info.expires_in_seconds
    )

    # Create device session record
    device_info = _parse_device_info(request, code_record.device_type)

    # Look up geolocation from IP
    city, country, country_code = lookup_ip_location(device_info["ip_address"])

    device_session = DeviceSession(
        user_id=user_id,
        device_type=code_record.device_type,
        device_name=code_record.device_name or device_info["device_name"],
        refresh_token_jti=refresh_token_info.jti,
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

    # Delete the used device code
    await db.execute(delete(DeviceCode).where(DeviceCode.id == code_record.id))

    await db.commit()

    # Log successful device auth
    audit = AuditLogger(db).set_context(request=request, user_id=user_id, user_email=user.email)
    await audit.log_auth(
        AuditAction.AUTH_LOGIN,
        status=AuditStatus.SUCCESS,
        details={"method": "device_flow", "device_type": code_record.device_type},
        resource_id=user_id,
    )

    logger.info(
        "Device authorized",
        user_id=user_id[:8],
        device_type=code_record.device_type,
    )

    # Set cookies for browser-based polling (rare but possible)
    set_auth_cookies(
        response,
        access_token_info.token,
        refresh_token_info.token,
        access_max_age_seconds=access_ttl,
        refresh_max_age_seconds=refresh_ttl,
    )

    return DeviceTokenResponse(
        access_token=access_token_info.token,
        refresh_token=refresh_token_info.token,
        expires_in=access_token_info.expires_in_seconds,
    )


class AuthorizeDeviceRequest(BaseModel):
    """Request to authorize a device code from the web UI."""

    user_code: str
    action: str = "approve"  # approve or deny


class AuthorizeDeviceResponse(BaseModel):
    """Response after authorizing/denying a device."""

    success: bool
    message: str
    device_name: str | None = None
    device_type: str | None = None


@router.post("/device/authorize", response_model=AuthorizeDeviceResponse)
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def authorize_device(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    body: AuthorizeDeviceRequest,
) -> AuthorizeDeviceResponse:
    """Authorize or deny a device code from the web UI.

    This endpoint is called when the user visits the verification URL
    and enters the user_code displayed on their device.
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Normalize user code (remove dashes, uppercase)
    normalized_code = body.user_code.replace("-", "").upper()
    formatted_code = (
        f"{normalized_code[:4]}-{normalized_code[4:]}"
        if len(normalized_code) == 8
        else body.user_code
    )

    # Look up pending device code
    result = await db.execute(
        select(DeviceCode).where(
            and_(
                DeviceCode.user_code == formatted_code,
                DeviceCode.status == "pending",
                DeviceCode.expires_at > datetime.now(UTC),
            )
        )
    )
    code_record = result.scalar_one_or_none()

    if not code_record:
        raise HTTPException(
            status_code=404,
            detail="Invalid or expired device code. Please request a new code on your device.",
        )

    if body.action == "deny":
        code_record.status = "denied"
        await db.commit()

        logger.info("Device denied", user_id=user_id[:8], user_code=formatted_code)

        return AuthorizeDeviceResponse(
            success=True,
            message="Device authorization denied.",
            device_name=code_record.device_name,
            device_type=code_record.device_type,
        )

    # Approve the device
    code_record.status = "authorized"
    code_record.user_id = user_id
    code_record.authorized_at = datetime.now(UTC)
    await db.commit()

    logger.info(
        "Device authorized",
        user_id=user_id[:8],
        user_code=formatted_code,
        device_type=code_record.device_type,
    )

    return AuthorizeDeviceResponse(
        success=True,
        message=(
            "Device authorized successfully! You can close this window and return to your device."
        ),
        device_name=code_record.device_name,
        device_type=code_record.device_type,
    )


# ============== Session Management ==============


class DeviceSessionInfo(BaseModel):
    """Information about an active device session."""

    id: str
    device_type: str
    device_name: str | None
    os_name: str | None
    browser_name: str | None
    ip_address: str | None
    city: str | None
    country: str | None
    last_active_at: datetime
    created_at: datetime
    is_current: bool


class SessionListResponse(BaseModel):
    """List of active sessions."""

    sessions: list[DeviceSessionInfo]
    total: int


@router.get("/sessions", response_model=SessionListResponse)
async def list_sessions(
    request: Request,
    db: DbSession,
) -> SessionListResponse:
    """List all active sessions for the current user."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Get current session's refresh token JTI to mark as "current"
    current_jti = getattr(request.state, "token_jti", None)

    # Query active (non-revoked, non-expired) sessions
    result = await db.execute(
        select(DeviceSession)
        .where(
            and_(
                DeviceSession.user_id == user_id,
                DeviceSession.is_revoked == False,
                DeviceSession.expires_at > datetime.now(UTC),
            )
        )
        .order_by(DeviceSession.last_active_at.desc())
    )
    sessions = result.scalars().all()

    session_list = []
    for session in sessions:
        session_list.append(
            DeviceSessionInfo(
                id=session.id,
                device_type=session.device_type,
                device_name=session.device_name,
                os_name=session.os_name,
                browser_name=session.browser_name,
                ip_address=session.ip_address,
                city=session.city,
                country=session.country,
                last_active_at=session.last_active_at,
                created_at=session.created_at,
                is_current=session.refresh_token_jti == current_jti if current_jti else False,
            )
        )

    return SessionListResponse(sessions=session_list, total=len(session_list))


class RevokeSessionResponse(BaseModel):
    """Response after revoking a session."""

    success: bool
    message: str


@router.delete("/sessions/{session_id}", response_model=RevokeSessionResponse)
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def revoke_session(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> RevokeSessionResponse:
    """Revoke a specific session by ID."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Get the session
    result = await db.execute(
        select(DeviceSession).where(
            and_(
                DeviceSession.id == session_id,
                DeviceSession.user_id == user_id,
            )
        )
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.is_revoked:
        return RevokeSessionResponse(success=True, message="Session already revoked")

    # Revoke the refresh token
    await revoke_token(session.refresh_token_jti, 86400 * 7)  # Keep in blacklist for 7 days

    # Mark session as revoked
    session.is_revoked = True
    session.revoked_at = datetime.now(UTC)
    await db.commit()

    # Log session revocation
    audit = AuditLogger(db).set_context(request=request, user_id=user_id)
    await audit.log_auth(
        AuditAction.AUTH_LOGOUT,
        status=AuditStatus.SUCCESS,
        details={
            "method": "session_revoke",
            "device_type": session.device_type,
            "session_id": session_id,
        },
    )

    logger.info(
        "Session revoked",
        user_id=user_id[:8],
        session_id=session_id[:8],
        device_type=session.device_type,
    )

    return RevokeSessionResponse(
        success=True,
        message=f"Session on {session.device_name or session.device_type} has been revoked.",
    )


class RevokeAllSessionsResponse(BaseModel):
    """Response after revoking all sessions."""

    success: bool
    message: str
    revoked_count: int


@router.delete("/sessions", response_model=RevokeAllSessionsResponse)
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def revoke_all_sessions(
    request: Request,
    response: Response,
    db: DbSession,
    keep_current: bool = True,
) -> RevokeAllSessionsResponse:
    """Revoke all sessions (logout everywhere).

    By default, keeps the current session active. Set keep_current=false to revoke all.
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    current_jti = getattr(request.state, "token_jti", None)

    # Get all active sessions
    query = select(DeviceSession).where(
        and_(
            DeviceSession.user_id == user_id,
            DeviceSession.is_revoked == False,
        )
    )
    if keep_current and current_jti:
        query = query.where(DeviceSession.refresh_token_jti != current_jti)

    result = await db.execute(query)
    sessions = result.scalars().all()

    revoked_count = 0
    for session in sessions:
        await revoke_token(session.refresh_token_jti, 86400 * 7)
        session.is_revoked = True
        session.revoked_at = datetime.now(UTC)
        revoked_count += 1

    await db.commit()

    # If revoking current session too, clear cookies
    if not keep_current:
        clear_auth_cookies(response)

    # Log bulk revocation
    audit = AuditLogger(db).set_context(request=request, user_id=user_id)
    await audit.log_auth(
        AuditAction.AUTH_LOGOUT,
        status=AuditStatus.SUCCESS,
        details={
            "method": "revoke_all",
            "revoked_count": revoked_count,
            "keep_current": keep_current,
        },
    )

    logger.info(
        "All sessions revoked",
        user_id=user_id[:8],
        revoked_count=revoked_count,
        keep_current=keep_current,
    )

    return RevokeAllSessionsResponse(
        success=True,
        message=f"Revoked {revoked_count} session(s)."
        + (" Current session kept active." if keep_current else ""),
        revoked_count=revoked_count,
    )


# ============== Cleanup ==============


async def cleanup_expired_device_codes(db: AsyncSession) -> int:
    """Delete expired device codes. Called by background task."""
    result = cast(
        "CursorResult[tuple[()]]",
        await db.execute(delete(DeviceCode).where(DeviceCode.expires_at < datetime.now(UTC))),
    )
    await db.commit()
    return result.rowcount


async def cleanup_expired_sessions(db: AsyncSession) -> int:
    """Mark expired sessions as revoked. Called by background task."""
    result = cast(
        "CursorResult[tuple[()]]",
        await db.execute(
            update(DeviceSession)
            .where(
                and_(
                    DeviceSession.expires_at < datetime.now(UTC),
                    DeviceSession.is_revoked == False,
                )
            )
            .values(is_revoked=True, revoked_at=datetime.now(UTC))
        ),
    )
    await db.commit()
    return result.rowcount
