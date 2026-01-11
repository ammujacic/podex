"""Authentication routes."""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from jose import JWTError, jwt
from passlib.hash import bcrypt
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.connection import get_db
from src.database.models import User
from src.middleware.rate_limit import RATE_LIMIT_AUTH, RATE_LIMIT_SENSITIVE, limiter
from src.services.mfa import get_mfa_service
from src.utils.password_validator import get_password_strength, validate_password

router = APIRouter()

# Type alias for database session dependency
DbSession = Annotated[AsyncSession, Depends(get_db)]

# OAuth2 token type constant - standard OAuth2 token type identifier
_OAUTH2_TYPE_STR = "bearer"  # not a password, standard OAuth2 type identifier


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
    """Token response."""

    access_token: str
    refresh_token: str
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
    """Auth response with user and tokens."""

    user: UserResponse
    access_token: str
    refresh_token: str
    token_type: str = _OAUTH2_TYPE_STR
    expires_in: int
    mfa_required: bool = False


class MFARequiredResponse(BaseModel):
    """Response when MFA is required to complete login."""

    mfa_required: bool = True
    message: str = "MFA verification required"


def create_access_token(user_id: str, role: str = "member") -> str:
    """Create JWT access token."""
    expire = datetime.now(UTC) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {
        "sub": user_id,
        "role": role,
        "exp": expire,
        "type": "access",
    }
    return str(jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM))


def create_refresh_token(user_id: str) -> str:
    """Create JWT refresh token."""
    expire = datetime.now(UTC) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode = {
        "sub": user_id,
        "exp": expire,
        "type": "refresh",
    }
    return str(jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM))


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

    access_token = create_access_token(user.id, role=user_role)
    refresh_token = create_refresh_token(user.id)

    return AuthResponse(
        user=UserResponse(
            id=user.id,
            email=user.email,
            name=user.name,
            avatar_url=user.avatar_url,
            role=user_role,
        ),
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
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

    # Get user role (will be "member" for new users)
    user_role = getattr(user, "role", "member") or "member"

    access_token = create_access_token(user.id, role=user_role)
    refresh_token = create_refresh_token(user.id)

    return AuthResponse(
        user=UserResponse(
            id=user.id,
            email=user.email,
            name=user.name,
            avatar_url=user.avatar_url,
            role=user_role,
        ),
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


class RefreshRequest(BaseModel):
    """Refresh token request."""

    refresh_token: str


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit(RATE_LIMIT_SENSITIVE)
async def refresh_token(
    body: RefreshRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> TokenResponse:
    """Refresh access token using refresh token."""
    try:
        payload = jwt.decode(
            body.refresh_token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )

        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")

        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")

        # Verify user still exists and is active
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()

        if not user or not user.is_active:
            raise HTTPException(status_code=401, detail="User not found or inactive")

        # Get user's current role from database (not from old token)
        # This ensures role changes are reflected on token refresh
        user_role = getattr(user, "role", "member") or "member"

        return TokenResponse(
            access_token=create_access_token(str(user_id), role=user_role),
            refresh_token=create_refresh_token(str(user_id)),
            expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        )
    except JWTError as e:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from e


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
) -> dict[str, str]:
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

    return {"message": "Password changed successfully"}
