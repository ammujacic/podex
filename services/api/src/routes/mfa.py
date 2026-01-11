"""Multi-Factor Authentication (MFA/2FA) routes."""

from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from passlib.hash import bcrypt
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import User
from src.middleware.auth import get_current_user_id
from src.middleware.rate_limit import RATE_LIMIT_SENSITIVE, limiter
from src.services.mfa import get_mfa_service

logger = structlog.get_logger()

router = APIRouter(prefix="/mfa", tags=["mfa"])
DbSession = Annotated[AsyncSession, Depends(get_db)]


# ==================== Request/Response Models ====================


class MFASetupResponse(BaseModel):
    """Response for MFA setup initialization."""

    secret: str
    qr_code_base64: str
    provisioning_uri: str
    backup_codes: list[str]


class MFAVerifyRequest(BaseModel):
    """Request to verify MFA setup or login."""

    code: str = Field(..., min_length=6, max_length=20)


class MFAStatusResponse(BaseModel):
    """Response for MFA status check."""

    enabled: bool
    backup_codes_remaining: int


class MFABackupCodesResponse(BaseModel):
    """Response with regenerated backup codes."""

    backup_codes: list[str]


class MFADisableRequest(BaseModel):
    """Request to disable MFA."""

    code: str = Field(..., min_length=6, max_length=20)
    password: str = Field(..., min_length=1)


# ==================== Endpoints ====================


@router.get("/status", response_model=MFAStatusResponse)
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def get_mfa_status(
    request: Request,
    response: Response,
    db: DbSession,
    user_id: Annotated[str, Depends(get_current_user_id)],
) -> MFAStatusResponse:
    """Get the current MFA status for the user."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    backup_codes_remaining = len(user.mfa_backup_codes) if user.mfa_backup_codes else 0

    return MFAStatusResponse(
        enabled=user.mfa_enabled,
        backup_codes_remaining=backup_codes_remaining,
    )


@router.post("/setup", response_model=MFASetupResponse)
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def setup_mfa(
    request: Request,
    response: Response,
    db: DbSession,
    user_id: Annotated[str, Depends(get_current_user_id)],
) -> MFASetupResponse:
    """Initialize MFA setup for the user.

    Returns the TOTP secret, QR code, and backup codes.
    The user must verify with a TOTP code to complete setup.
    """
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.mfa_enabled:
        raise HTTPException(status_code=400, detail="MFA is already enabled")

    mfa_service = get_mfa_service()
    setup_result = mfa_service.setup_mfa(user.email)

    # Store the secret temporarily (not yet enabled)
    user.mfa_secret = setup_result.secret
    user.mfa_backup_codes = mfa_service.hash_backup_codes(setup_result.backup_codes)
    await db.commit()

    logger.info("MFA setup initiated", user_id=user_id)

    return MFASetupResponse(
        secret=setup_result.secret,
        qr_code_base64=setup_result.qr_code_base64,
        provisioning_uri=setup_result.provisioning_uri,
        backup_codes=setup_result.backup_codes,
    )


@router.post("/verify-setup")
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def verify_mfa_setup(
    request: Request,
    response: Response,
    body: MFAVerifyRequest,
    db: DbSession,
    user_id: Annotated[str, Depends(get_current_user_id)],
) -> dict[str, str]:
    """Verify MFA setup with a TOTP code to complete enrollment.

    This endpoint completes the MFA setup process by verifying
    that the user has correctly configured their authenticator app.
    """
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.mfa_enabled:
        raise HTTPException(status_code=400, detail="MFA is already enabled")

    if not user.mfa_secret:
        raise HTTPException(
            status_code=400,
            detail="MFA setup not initiated. Call /mfa/setup first.",
        )

    mfa_service = get_mfa_service()

    # Only accept TOTP codes for setup verification (not backup codes)
    if not mfa_service.verify_totp(user.mfa_secret, body.code):
        raise HTTPException(status_code=400, detail="Invalid verification code")

    # Enable MFA
    user.mfa_enabled = True
    await db.commit()

    logger.info("MFA enabled", user_id=user_id)

    return {"message": "MFA has been enabled successfully"}


@router.post("/disable")
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def disable_mfa(
    request: Request,
    response: Response,
    body: MFADisableRequest,
    db: DbSession,
    user_id: Annotated[str, Depends(get_current_user_id)],
) -> dict[str, str]:
    """Disable MFA for the user.

    Requires both a valid MFA code and the user's password.
    """
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not user.mfa_enabled:
        raise HTTPException(status_code=400, detail="MFA is not enabled")

    # Verify password (only for non-OAuth users)
    if user.password_hash:
        if not bcrypt.verify(body.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Invalid password")
    elif user.oauth_provider:
        # OAuth users can disable without password, but still need MFA code
        pass
    else:
        raise HTTPException(status_code=400, detail="Cannot verify identity")

    # Verify MFA code
    mfa_service = get_mfa_service()
    verification, _ = mfa_service.verify_mfa(
        body.code,
        user.mfa_secret,
        user.mfa_backup_codes,
    )

    if not verification.success:
        raise HTTPException(status_code=400, detail="Invalid verification code")

    # Disable MFA
    user.mfa_enabled = False
    user.mfa_secret = None
    user.mfa_backup_codes = None
    await db.commit()

    logger.info("MFA disabled", user_id=user_id)

    return {"message": "MFA has been disabled"}


@router.post("/regenerate-backup-codes", response_model=MFABackupCodesResponse)
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def regenerate_backup_codes(
    request: Request,
    response: Response,
    body: MFAVerifyRequest,
    db: DbSession,
    user_id: Annotated[str, Depends(get_current_user_id)],
) -> MFABackupCodesResponse:
    """Regenerate backup codes.

    Requires a valid MFA code (TOTP preferred).
    This invalidates all existing backup codes.
    """
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not user.mfa_enabled:
        raise HTTPException(status_code=400, detail="MFA is not enabled")

    mfa_service = get_mfa_service()

    # Verify with TOTP code (prefer TOTP over backup codes for this operation)
    if not user.mfa_secret or not mfa_service.verify_totp(user.mfa_secret, body.code):
        raise HTTPException(
            status_code=400,
            detail="Invalid verification code. Use your authenticator app.",
        )

    # Generate new backup codes
    new_codes = mfa_service.generate_backup_codes()
    user.mfa_backup_codes = mfa_service.hash_backup_codes(new_codes)
    await db.commit()

    logger.info("MFA backup codes regenerated", user_id=user_id)

    return MFABackupCodesResponse(backup_codes=new_codes)
