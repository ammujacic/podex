"""Local pod management API routes for self-hosted compute."""

import hashlib
import hmac
import secrets
from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.connection import get_db
from src.database.models import LocalPod, Workspace
from src.middleware.auth import get_current_user
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

router = APIRouter(prefix="/local-pods", tags=["local-pods"])

# Type aliases for dependencies
DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[dict[str, str | None], Depends(get_current_user)]

# Limits
MAX_PODS_PER_USER = 10
MAX_WORKSPACES_PER_POD = 10


# ============== Request/Response Models ==============


class LocalPodCreate(BaseModel):
    """Request to register a new local pod."""

    name: str = Field(..., min_length=1, max_length=100)
    labels: dict[str, str] = Field(default_factory=dict)
    max_workspaces: int = Field(default=3, ge=1, le=MAX_WORKSPACES_PER_POD)


class LocalPodUpdate(BaseModel):
    """Request to update a local pod."""

    name: str | None = Field(None, min_length=1, max_length=100)
    labels: dict[str, str] | None = None
    max_workspaces: int | None = Field(None, ge=1, le=MAX_WORKSPACES_PER_POD)


class LocalPodResponse(BaseModel):
    """Local pod response (without token)."""

    id: str
    user_id: str
    name: str
    token_prefix: str
    status: str
    last_heartbeat: str | None
    last_error: str | None
    os_info: str | None
    architecture: str | None
    docker_version: str | None
    total_memory_mb: int | None
    total_cpu_cores: int | None
    max_workspaces: int
    current_workspaces: int
    labels: dict[str, Any] | None
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


class LocalPodRegisterResponse(BaseModel):
    """Response with pod token (shown only once on creation)."""

    id: str
    name: str
    token: str  # Full token - only shown once!
    connection_url: str  # WebSocket URL to connect to


class LocalPodListResponse(BaseModel):
    """List of local pods response."""

    pods: list[LocalPodResponse]
    total: int


class LocalPodWorkspaceResponse(BaseModel):
    """Workspace running on a local pod."""

    id: str
    status: str
    container_id: str | None
    created_at: str


class LocalPodWorkspacesResponse(BaseModel):
    """List of workspaces on a local pod."""

    workspaces: list[LocalPodWorkspaceResponse]
    total: int


class TokenRegenerateResponse(BaseModel):
    """Response with new token after regeneration."""

    token: str  # New token - shown only once!
    token_prefix: str


# ============== Helper Functions ==============


def _generate_pod_token() -> tuple[str, str, str]:
    """Generate a new pod token.

    Returns:
        Tuple of (full_token, token_hash, token_prefix)
    """
    # Generate 32 bytes of secure random data
    raw_token = secrets.token_urlsafe(32)
    full_token = f"pdx_pod_{raw_token}"

    # Hash for storage
    token_hash = hashlib.sha256(full_token.encode()).hexdigest()

    # Prefix for display (first 8 chars of the raw token part)
    token_prefix = raw_token[:8]

    return full_token, token_hash, token_prefix


def _pod_to_response(pod: LocalPod) -> LocalPodResponse:
    """Convert pod model to response."""
    return LocalPodResponse(
        id=pod.id,
        user_id=pod.user_id,
        name=pod.name,
        token_prefix=pod.token_prefix,
        status=pod.status,
        last_heartbeat=pod.last_heartbeat.isoformat() if pod.last_heartbeat else None,
        last_error=pod.last_error,
        os_info=pod.os_info,
        architecture=pod.architecture,
        docker_version=pod.docker_version,
        total_memory_mb=pod.total_memory_mb,
        total_cpu_cores=pod.total_cpu_cores,
        max_workspaces=pod.max_workspaces,
        current_workspaces=pod.current_workspaces,
        labels=pod.labels,
        created_at=pod.created_at.isoformat(),
        updated_at=pod.updated_at.isoformat(),
    )


# ============== Routes ==============


@router.get("", response_model=LocalPodListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_pods(
    request: Request,
    response: Response,
    db: DbSession,
    current_user: CurrentUser,
    *,
    status: str | None = Query(default=None, pattern="^(offline|online|busy|error)$"),
) -> LocalPodListResponse:
    """List local pods for the current user."""
    query = select(LocalPod).where(LocalPod.user_id == current_user["id"])

    if status is not None:
        query = query.where(LocalPod.status == status)

    query = query.order_by(LocalPod.created_at.desc())

    result = await db.execute(query)
    pods = result.scalars().all()

    return LocalPodListResponse(
        pods=[_pod_to_response(p) for p in pods],
        total=len(pods),
    )


@router.post("", response_model=LocalPodRegisterResponse, status_code=201)
@limiter.limit(RATE_LIMIT_STANDARD)
async def register_pod(
    request: Request,
    response: Response,
    data: LocalPodCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> LocalPodRegisterResponse:
    """Register a new local pod.

    Returns the pod token which is only shown once. Store it securely!
    """
    # Check pod limit per user
    count_query = select(LocalPod).where(LocalPod.user_id == current_user["id"])
    result = await db.execute(count_query)
    existing_count = len(list(result.scalars().all()))

    if existing_count >= MAX_PODS_PER_USER:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum of {MAX_PODS_PER_USER} local pods per user",
        )

    # Check for duplicate name
    existing = await db.execute(
        select(LocalPod).where(
            LocalPod.user_id == current_user["id"],
            LocalPod.name == data.name,
        ),
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail=f"Local pod with name '{data.name}' already exists",
        )

    # Generate token
    full_token, token_hash, token_prefix = _generate_pod_token()

    pod = LocalPod(
        user_id=current_user["id"],
        name=data.name,
        token_hash=token_hash,
        token_prefix=token_prefix,
        labels=data.labels if data.labels else None,
        max_workspaces=data.max_workspaces,
    )

    db.add(pod)
    await db.commit()
    await db.refresh(pod)

    # Build WebSocket connection URL
    # In production, this would be the actual WebSocket endpoint
    ws_protocol = "wss" if settings.ENVIRONMENT != "development" else "ws"
    api_host = settings.API_HOST if hasattr(settings, "API_HOST") else "localhost:3001"
    connection_url = f"{ws_protocol}://{api_host}/local-pod"

    return LocalPodRegisterResponse(
        id=pod.id,
        name=pod.name,
        token=full_token,
        connection_url=connection_url,
    )


@router.get("/{pod_id}", response_model=LocalPodResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_pod(
    request: Request,
    response: Response,
    pod_id: UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> LocalPodResponse:
    """Get a specific local pod."""
    pod = await db.get(LocalPod, pod_id)

    if not pod or pod.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Local pod not found")

    return _pod_to_response(pod)


@router.patch("/{pod_id}", response_model=LocalPodResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def update_pod(
    request: Request,
    response: Response,
    pod_id: UUID,
    data: LocalPodUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> LocalPodResponse:
    """Update a local pod."""
    pod = await db.get(LocalPod, pod_id)

    if not pod or pod.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Local pod not found")

    # Check for duplicate name if updating
    if data.name and data.name != pod.name:
        existing = await db.execute(
            select(LocalPod).where(
                LocalPod.user_id == current_user["id"],
                LocalPod.name == data.name,
                LocalPod.id != pod_id,
            ),
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=400,
                detail=f"Local pod with name '{data.name}' already exists",
            )

    # Update fields
    if data.name is not None:
        pod.name = data.name
    if data.labels is not None:
        pod.labels = data.labels if data.labels else None
    if data.max_workspaces is not None:
        pod.max_workspaces = data.max_workspaces

    await db.commit()
    await db.refresh(pod)

    return _pod_to_response(pod)


@router.delete("/{pod_id}", status_code=204)
@limiter.limit(RATE_LIMIT_STANDARD)
async def delete_pod(
    request: Request,
    response: Response,
    pod_id: UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> None:
    """Delete a local pod.

    This will disconnect the pod and orphan any workspaces running on it.
    """
    pod = await db.get(LocalPod, pod_id)

    if not pod or pod.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Local pod not found")

    # Check if pod has active workspaces
    if pod.current_workspaces > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete pod with {pod.current_workspaces} active workspace(s). "
            "Stop all workspaces first.",
        )

    await db.delete(pod)
    await db.commit()


@router.post("/{pod_id}/regenerate-token", response_model=TokenRegenerateResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def regenerate_token(
    request: Request,
    response: Response,
    pod_id: UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> TokenRegenerateResponse:
    """Regenerate the token for a local pod.

    This invalidates the old token immediately. The pod will need to
    reconnect with the new token.
    """
    pod = await db.get(LocalPod, pod_id)

    if not pod or pod.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Local pod not found")

    # Generate new token
    full_token, token_hash, token_prefix = _generate_pod_token()

    # Update pod
    pod.token_hash = token_hash
    pod.token_prefix = token_prefix
    # Mark as offline since old token is now invalid
    pod.status = "offline"
    pod.last_heartbeat = None

    await db.commit()

    return TokenRegenerateResponse(
        token=full_token,
        token_prefix=token_prefix,
    )


@router.get("/{pod_id}/workspaces", response_model=LocalPodWorkspacesResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_pod_workspaces(
    request: Request,
    response: Response,
    pod_id: UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> LocalPodWorkspacesResponse:
    """List workspaces running on a local pod."""
    pod = await db.get(LocalPod, pod_id)

    if not pod or pod.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Local pod not found")

    # Query workspaces on this pod
    result = await db.execute(
        select(Workspace).where(Workspace.local_pod_id == pod_id),
    )
    workspaces = result.scalars().all()

    return LocalPodWorkspacesResponse(
        workspaces=[
            LocalPodWorkspaceResponse(
                id=w.id,
                status=w.status,
                container_id=w.container_id,
                created_at=w.created_at.isoformat(),
            )
            for w in workspaces
        ],
        total=len(workspaces),
    )


# ============== Internal/WebSocket Helper Functions ==============
# These are used by the WebSocket hub, not exposed as REST endpoints


async def verify_pod_token(token: str, db: AsyncSession) -> LocalPod | None:
    """Verify a pod token and return the pod if valid.

    Used by the WebSocket hub for authentication.

    SECURITY: Uses constant-time comparison to prevent timing attacks.
    We query by token_prefix (public) then verify hash in Python.
    """
    if not token.startswith("pdx_pod_"):
        return None

    # Extract the token part after "pdx_pod_" prefix
    token_body = token[8:]  # Remove "pdx_pod_" prefix
    if len(token_body) < 8:
        return None

    # Use the prefix for initial lookup (prefix is public)
    provided_prefix = token_body[:8]

    result = await db.execute(
        select(LocalPod).where(LocalPod.token_prefix == provided_prefix),
    )
    pod = result.scalar_one_or_none()

    if not pod:
        return None

    # SECURITY: Use constant-time comparison for the full hash
    # This prevents timing attacks that could reveal hash bytes
    provided_hash = hashlib.sha256(token.encode()).hexdigest()
    if not hmac.compare_digest(provided_hash, pod.token_hash):
        return None

    return pod


async def update_pod_status(
    db: AsyncSession,
    pod_id: str,
    status: str,
    *,
    last_error: str | None = None,
) -> None:
    """Update pod status. Used by WebSocket hub on connect/disconnect."""
    values: dict[str, Any] = {
        "status": status,
        "updated_at": datetime.now(UTC),
    }
    if status == "online":
        values["last_heartbeat"] = datetime.now(UTC)
        values["last_error"] = None
    elif last_error:
        values["last_error"] = last_error

    await db.execute(
        update(LocalPod).where(LocalPod.id == pod_id).values(**values),
    )
    await db.commit()


async def update_pod_capabilities(
    db: AsyncSession,
    pod_id: str,
    capabilities: dict[str, Any],
) -> None:
    """Update pod capabilities. Called when pod reports its system info."""
    await db.execute(
        update(LocalPod)
        .where(LocalPod.id == pod_id)
        .values(
            os_info=capabilities.get("os_info"),
            architecture=capabilities.get("architecture"),
            docker_version=capabilities.get("docker_version"),
            total_memory_mb=capabilities.get("total_memory_mb"),
            total_cpu_cores=capabilities.get("cpu_cores"),
            updated_at=datetime.now(UTC),
        ),
    )
    await db.commit()


async def update_pod_heartbeat(
    db: AsyncSession,
    pod_id: str,
    current_workspaces: int,
) -> None:
    """Update pod heartbeat. Called periodically by connected pods."""
    await db.execute(
        update(LocalPod)
        .where(LocalPod.id == pod_id)
        .values(
            last_heartbeat=datetime.now(UTC),
            current_workspaces=current_workspaces,
            updated_at=datetime.now(UTC),
        ),
    )
    await db.commit()
