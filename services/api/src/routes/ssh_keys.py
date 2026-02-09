"""SSH key management routes."""

import base64
import hashlib
from datetime import UTC, datetime
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.connection import get_db
from src.database.models import User
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

logger = structlog.get_logger()

router = APIRouter()

DbSession = Annotated[AsyncSession, Depends(get_db)]

# Supported key types
SUPPORTED_KEY_TYPES = {
    "ssh-rsa",
    "ssh-ed25519",
    "ecdsa-sha2-nistp256",
    "ecdsa-sha2-nistp384",
    "ecdsa-sha2-nistp521",
}


def validate_ssh_public_key(key: str) -> tuple[str, str]:
    """Validate SSH public key format and compute fingerprint.

    Args:
        key: The SSH public key string.

    Returns:
        Tuple of (key_type, fingerprint).

    Raises:
        ValueError: If key is invalid.
    """
    key = key.strip()
    parts = key.split()

    if len(parts) < 2:
        raise ValueError("Invalid SSH public key format")  # noqa: TRY003

    key_type = parts[0]
    if key_type not in SUPPORTED_KEY_TYPES:
        raise ValueError(f"Unsupported key type: {key_type}")  # noqa: TRY003

    try:
        key_data = base64.b64decode(parts[1])
    except Exception as e:
        raise ValueError(f"Invalid base64 in key: {e}") from e  # noqa: TRY003

    # Compute MD5 fingerprint (classic format)
    digest = hashlib.md5(key_data).hexdigest()
    fingerprint = ":".join(digest[i : i + 2] for i in range(0, len(digest), 2))

    return key_type, fingerprint


class SSHKeyCreate(BaseModel):
    """Request to add an SSH key."""

    name: str
    public_key: str


class SSHKeyResponse(BaseModel):
    """SSH key response."""

    name: str
    key_type: str
    fingerprint: str
    public_key: str
    created_at: str


class SSHKeyListResponse(BaseModel):
    """List of SSH keys."""

    keys: list[SSHKeyResponse]
    total: int


async def get_current_user(request: Request, db: AsyncSession) -> User:
    """Get the current authenticated user."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return user


@router.get("", response_model=SSHKeyListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_ssh_keys(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> SSHKeyListResponse:
    """List all SSH keys for the current user."""
    user = await get_current_user(request, db)
    keys = user.ssh_public_keys or []

    return SSHKeyListResponse(
        keys=[
            SSHKeyResponse(
                name=k["name"],
                key_type=k["key_type"],
                fingerprint=k["fingerprint"],
                public_key=k["public_key"],
                created_at=k["created_at"],
            )
            for k in keys
        ],
        total=len(keys),
    )


@router.post("", response_model=SSHKeyResponse, status_code=201)
@limiter.limit(RATE_LIMIT_STANDARD)
async def add_ssh_key(
    request: Request,
    response: Response,  # noqa: ARG001
    body: SSHKeyCreate,
    db: DbSession,
) -> SSHKeyResponse:
    """Add a new SSH key."""
    user = await get_current_user(request, db)

    # Validate the key
    try:
        key_type, fingerprint = validate_ssh_public_key(body.public_key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid SSH public key: {e}") from e

    # Check for duplicate fingerprint
    existing_keys = user.ssh_public_keys or []
    for k in existing_keys:
        if k["fingerprint"] == fingerprint:
            raise HTTPException(status_code=409, detail="SSH key already exists")

    # Add the key
    now = datetime.now(UTC).isoformat()
    new_key = {
        "name": body.name,
        "key_type": key_type,
        "fingerprint": fingerprint,
        "public_key": body.public_key.strip(),
        "created_at": now,
    }
    existing_keys.append(new_key)
    user.ssh_public_keys = existing_keys

    await db.commit()
    await db.refresh(user)

    logger.info("SSH key added", user_id=user.id, fingerprint=fingerprint)

    return SSHKeyResponse(
        name=new_key["name"],
        key_type=new_key["key_type"],
        fingerprint=new_key["fingerprint"],
        public_key=new_key["public_key"],
        created_at=new_key["created_at"],
    )


@router.delete("/{fingerprint}", status_code=204)
@limiter.limit(RATE_LIMIT_STANDARD)
async def delete_ssh_key(
    fingerprint: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> None:
    """Delete an SSH key by fingerprint."""
    user = await get_current_user(request, db)
    existing_keys = user.ssh_public_keys or []

    # Find and remove the key
    new_keys = [k for k in existing_keys if k["fingerprint"] != fingerprint]

    if len(new_keys) == len(existing_keys):
        raise HTTPException(status_code=404, detail="SSH key not found")

    user.ssh_public_keys = new_keys
    await db.commit()

    logger.info("SSH key deleted", user_id=user.id, fingerprint=fingerprint)
