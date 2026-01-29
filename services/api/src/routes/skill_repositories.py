"""API routes for skill repository sync management."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import get_db
from src.database.models import SkillRepository, SkillSyncLog
from src.middleware.auth import get_current_user

router = APIRouter(prefix="/skill-repositories", tags=["skill-repositories"])


# ============================================================================
# Request/Response Models
# ============================================================================


class SkillRepositoryCreateRequest(BaseModel):
    """Request to connect a new skill repository."""

    name: str = Field(..., min_length=1, max_length=100)
    repo_url: str = Field(..., min_length=1, max_length=500)
    branch: str = Field(default="main", max_length=100)
    skills_path: str = Field(default="/", max_length=200)
    sync_direction: str = Field(default="pull", pattern="^(pull|push|bidirectional)$")


class SkillRepositoryUpdateRequest(BaseModel):
    """Request to update repository settings."""

    name: str | None = Field(None, min_length=1, max_length=100)
    branch: str | None = Field(None, max_length=100)
    skills_path: str | None = Field(None, max_length=200)
    sync_direction: str | None = Field(None, pattern="^(pull|push|bidirectional)$")
    is_active: bool | None = None


class SkillRepositoryResponse(BaseModel):
    """Response containing repository details."""

    id: str
    user_id: str
    name: str
    repo_url: str
    branch: str
    skills_path: str
    sync_direction: str
    last_synced_at: datetime | None
    last_sync_status: str | None
    last_sync_error: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class SkillRepositoryListResponse(BaseModel):
    """List of skill repositories."""

    repositories: list[SkillRepositoryResponse]
    total: int


class SkillSyncLogResponse(BaseModel):
    """Response containing sync log details."""

    id: str
    repository_id: str
    direction: str
    status: str
    skills_added: int
    skills_updated: int
    skills_removed: int
    error_message: str | None
    started_at: datetime
    completed_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class SkillSyncLogListResponse(BaseModel):
    """List of sync logs."""

    logs: list[SkillSyncLogResponse]
    total: int


class SyncTriggerResponse(BaseModel):
    """Response after triggering a sync."""

    sync_id: str
    status: str
    message: str


# ============================================================================
# Routes
# ============================================================================


@router.get("", response_model=SkillRepositoryListResponse)
async def list_repositories(
    include_inactive: bool = Query(False, description="Include inactive repositories"),
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> SkillRepositoryListResponse:
    """List user's connected skill repositories."""
    user_id = user["id"]

    query = select(SkillRepository).where(SkillRepository.user_id == user_id)

    if not include_inactive:
        query = query.where(SkillRepository.is_active == True)

    query = query.order_by(SkillRepository.created_at.desc())

    result = await db.execute(query)
    repositories = result.scalars().all()

    return SkillRepositoryListResponse(
        repositories=[SkillRepositoryResponse.model_validate(r) for r in repositories],
        total=len(repositories),
    )


@router.post("", response_model=SkillRepositoryResponse, status_code=status.HTTP_201_CREATED)
async def create_repository(
    request: SkillRepositoryCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> SkillRepositoryResponse:
    """Connect a new skill repository."""
    user_id = user["id"]

    # Check for duplicate URL
    existing_query = select(SkillRepository).where(
        SkillRepository.user_id == user_id,
        SkillRepository.repo_url == request.repo_url,
    )
    existing = (await db.execute(existing_query)).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Repository with this URL already connected",
        )

    # Generate webhook secret
    webhook_secret = secrets.token_urlsafe(32)

    now = datetime.now(UTC)
    repository = SkillRepository(
        id=str(uuid4()),
        user_id=user_id,
        name=request.name,
        repo_url=request.repo_url,
        branch=request.branch,
        skills_path=request.skills_path,
        sync_direction=request.sync_direction,
        webhook_secret=webhook_secret,
        is_active=True,
        created_at=now,
    )

    db.add(repository)
    await db.commit()
    await db.refresh(repository)

    return SkillRepositoryResponse.model_validate(repository)


@router.get("/{repo_id}", response_model=SkillRepositoryResponse)
async def get_repository(
    repo_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> SkillRepositoryResponse:
    """Get a specific repository's details."""
    user_id = user["id"]

    query = select(SkillRepository).where(
        SkillRepository.id == repo_id,
        SkillRepository.user_id == user_id,
    )
    result = await db.execute(query)
    repository = result.scalar_one_or_none()

    if not repository:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repository not found",
        )

    return SkillRepositoryResponse.model_validate(repository)


@router.patch("/{repo_id}", response_model=SkillRepositoryResponse)
async def update_repository(
    repo_id: str,
    request: SkillRepositoryUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> SkillRepositoryResponse:
    """Update repository settings."""
    user_id = user["id"]

    # Get existing repository
    query = select(SkillRepository).where(
        SkillRepository.id == repo_id,
        SkillRepository.user_id == user_id,
    )
    result = await db.execute(query)
    repository = result.scalar_one_or_none()

    if not repository:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repository not found",
        )

    # Build update data
    update_data = request.model_dump(exclude_unset=True)
    update_data["updated_at"] = datetime.now(UTC)

    # Apply update
    await db.execute(
        update(SkillRepository).where(SkillRepository.id == repo_id).values(**update_data)
    )
    await db.commit()
    await db.refresh(repository)

    return SkillRepositoryResponse.model_validate(repository)


@router.delete("/{repo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_repository(
    repo_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> None:
    """Disconnect a repository (soft delete by setting inactive)."""
    user_id = user["id"]

    # Get existing repository
    query = select(SkillRepository).where(
        SkillRepository.id == repo_id,
        SkillRepository.user_id == user_id,
    )
    result = await db.execute(query)
    repository = result.scalar_one_or_none()

    if not repository:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repository not found",
        )

    # Soft delete
    await db.execute(
        update(SkillRepository)
        .where(SkillRepository.id == repo_id)
        .values(is_active=False, updated_at=datetime.now(UTC))
    )
    await db.commit()


@router.post("/{repo_id}/sync", response_model=SyncTriggerResponse)
async def trigger_sync(
    repo_id: str,
    force: bool = Query(False, description="Force sync even if recently synced"),
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> SyncTriggerResponse:
    """Trigger a manual sync for a repository."""
    user_id = user["id"]

    # Get repository
    query = select(SkillRepository).where(
        SkillRepository.id == repo_id,
        SkillRepository.user_id == user_id,
    )
    result = await db.execute(query)
    repository = result.scalar_one_or_none()

    if not repository:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repository not found",
        )

    if not repository.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot sync inactive repository",
        )

    # Check rate limiting (unless force)
    if not force and repository.last_synced_at:
        min_interval = timedelta(minutes=5)
        if datetime.now(UTC) - repository.last_synced_at < min_interval:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Repository was synced recently. Wait 5 minutes or use force=true",
            )

    # Create sync log entry
    now = datetime.now(UTC)
    sync_log = SkillSyncLog(
        id=str(uuid4()),
        repository_id=repo_id,
        direction=repository.sync_direction,
        status="pending",
        skills_added=0,
        skills_updated=0,
        skills_removed=0,
        started_at=now,
    )
    db.add(sync_log)

    # Update repository sync status
    await db.execute(
        update(SkillRepository)
        .where(SkillRepository.id == repo_id)
        .values(last_sync_status="pending")
    )

    await db.commit()

    # In a real implementation, this would trigger a background task
    # For now, we return immediately with the sync ID
    # The actual sync would be handled by src/services/skill_sync.py

    return SyncTriggerResponse(
        sync_id=sync_log.id,
        status="pending",
        message="Sync has been queued. Check sync logs for status.",
    )


@router.get("/{repo_id}/logs", response_model=SkillSyncLogListResponse)
async def list_sync_logs(
    repo_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> SkillSyncLogListResponse:
    """Get sync history for a repository."""
    user_id = user["id"]

    # Verify repository ownership
    repo_query = select(SkillRepository).where(
        SkillRepository.id == repo_id,
        SkillRepository.user_id == user_id,
    )
    repo = (await db.execute(repo_query)).scalar_one_or_none()

    if not repo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repository not found",
        )

    # Get total count
    count_query = select(func.count(SkillSyncLog.id)).where(SkillSyncLog.repository_id == repo_id)
    total = (await db.execute(count_query)).scalar() or 0

    # Get logs
    logs_query = (
        select(SkillSyncLog)
        .where(SkillSyncLog.repository_id == repo_id)
        .order_by(SkillSyncLog.started_at.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(logs_query)
    logs = result.scalars().all()

    return SkillSyncLogListResponse(
        logs=[SkillSyncLogResponse.model_validate(log) for log in logs],
        total=total,
    )


@router.get("/{repo_id}/webhook-url", response_model=dict)
async def get_webhook_url(
    repo_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> dict[str, Any]:
    """Get the webhook URL for this repository (for GitHub/GitLab webhooks)."""
    user_id = user["id"]

    query = select(SkillRepository).where(
        SkillRepository.id == repo_id,
        SkillRepository.user_id == user_id,
    )
    result = await db.execute(query)
    repository = result.scalar_one_or_none()

    if not repository:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repository not found",
        )

    # Build webhook URL
    base_url = settings.API_BASE_URL or "https://api.podex.dev"
    webhook_url = f"{base_url}/api/v1/skill-repositories/webhook/{repository.webhook_secret}"

    return {
        "webhook_url": webhook_url,
        "secret": repository.webhook_secret,
        "events": ["push"],
        "content_type": "application/json",
    }


# ============================================================================
# Webhook Endpoint
# ============================================================================


@router.post("/webhook/{secret}", response_model=dict)
async def receive_webhook(
    secret: str,
    payload: dict[str, Any],
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Receive webhook from GitHub/GitLab when skills are updated.

    This endpoint is public (no auth required) but protected by the secret.
    """
    # Find repository by webhook secret
    query = select(SkillRepository).where(
        SkillRepository.webhook_secret == secret,
        SkillRepository.is_active == True,
    )
    result = await db.execute(query)
    repository = result.scalar_one_or_none()

    if not repository:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invalid webhook secret",
        )

    # Check if this is a push to the tracked branch
    ref = payload.get("ref", "")
    branch = ref.replace("refs/heads/", "") if ref.startswith("refs/heads/") else ref

    if branch != repository.branch:
        return {
            "status": "ignored",
            "message": f"Push to {branch}, not tracking branch {repository.branch}",
        }

    # Check if changes affect the skills path
    skills_path = repository.skills_path.strip("/")
    changes_in_skills = False

    commits = payload.get("commits", [])
    for commit in commits:
        for file_path in (
            commit.get("added", []) + commit.get("modified", []) + commit.get("removed", [])
        ):
            if file_path.startswith(skills_path) and (file_path.endswith((".yaml", ".yml"))):
                changes_in_skills = True
                break
        if changes_in_skills:
            break

    if not changes_in_skills:
        return {
            "status": "ignored",
            "message": "No changes to skill files",
        }

    # Create sync log and trigger sync
    now = datetime.now(UTC)
    sync_log = SkillSyncLog(
        id=str(uuid4()),
        repository_id=repository.id,
        direction="pull",
        status="pending",
        skills_added=0,
        skills_updated=0,
        skills_removed=0,
        started_at=now,
    )
    db.add(sync_log)

    await db.execute(
        update(SkillRepository)
        .where(SkillRepository.id == repository.id)
        .values(last_sync_status="pending")
    )

    await db.commit()

    # In production, this would trigger the sync service
    return {
        "status": "queued",
        "sync_id": sync_log.id,
        "message": "Sync has been triggered",
    }
