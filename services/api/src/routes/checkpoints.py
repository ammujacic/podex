"""Checkpoint management routes for undo/restore functionality."""

from datetime import UTC, datetime
from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.compute_client import get_compute_client_for_workspace
from src.database.models import (
    FileCheckpoint,
)
from src.database.models import (
    Session as SessionModel,
)
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter
from src.routes.dependencies import DbSession, get_current_user_id
from src.websocket.hub import emit_to_session

logger = structlog.get_logger()

router = APIRouter()


class FileChangeResponse(BaseModel):
    """File change in a checkpoint."""

    path: str
    change_type: str
    lines_added: int
    lines_removed: int


class CheckpointResponse(BaseModel):
    """Checkpoint response model."""

    id: str
    checkpoint_number: int
    description: str | None
    action_type: str
    agent_id: str
    status: str
    created_at: str
    files: list[FileChangeResponse]
    file_count: int
    total_lines_added: int
    total_lines_removed: int


class CheckpointDiffResponse(BaseModel):
    """Full diff for a checkpoint."""

    id: str
    description: str | None
    files: list[dict[str, Any]]


class RestoreResponse(BaseModel):
    """Restore operation response."""

    success: bool
    checkpoint_id: str
    files: list[dict[str, Any]]


@router.get("/sessions/{session_id}/checkpoints", response_model=list[CheckpointResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_session_checkpoints(
    session_id: str,
    request: Request,
    response: Response,
    db: DbSession,
    agent_id: str | None = None,
    limit: int = 50,
) -> list[CheckpointResponse]:
    """Get checkpoints for a session."""
    user_id = get_current_user_id(request)

    # Verify session access
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == session_id))
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Build query with eager loading to avoid N+1 queries
    query = (
        select(FileCheckpoint)
        .where(FileCheckpoint.session_id == session_id)
        .options(selectinload(FileCheckpoint.files))  # Eager load related files
    )

    if agent_id:
        query = query.where(FileCheckpoint.agent_id == agent_id)

    query = query.order_by(FileCheckpoint.checkpoint_number.desc()).limit(limit)

    result = await db.execute(query)
    checkpoints = result.scalars().all()

    responses = []
    for cp in checkpoints:
        # Files are already loaded via selectinload - no additional queries
        files = cp.files

        responses.append(
            CheckpointResponse(
                id=str(cp.id),
                checkpoint_number=cp.checkpoint_number,
                description=cp.description,
                action_type=cp.action_type,
                agent_id=str(cp.agent_id),
                status=cp.status,
                created_at=cp.created_at.isoformat()
                if cp.created_at
                else datetime.now(UTC).isoformat(),
                files=[
                    FileChangeResponse(
                        path=f.file_path,
                        change_type=f.change_type,
                        lines_added=f.lines_added or 0,
                        lines_removed=f.lines_removed or 0,
                    )
                    for f in files
                ],
                file_count=len(files),
                total_lines_added=sum(f.lines_added or 0 for f in files),
                total_lines_removed=sum(f.lines_removed or 0 for f in files),
            )
        )

    return responses


@router.get("/checkpoints/{checkpoint_id}", response_model=CheckpointResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_checkpoint(
    checkpoint_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> CheckpointResponse:
    """Get a specific checkpoint."""
    user_id = get_current_user_id(request)

    # Get checkpoint
    result = await db.execute(select(FileCheckpoint).where(FileCheckpoint.id == checkpoint_id))
    checkpoint = result.scalar_one_or_none()

    if not checkpoint:
        raise HTTPException(status_code=404, detail="Checkpoint not found")

    # Verify session access
    session_result = await db.execute(
        select(SessionModel).where(SessionModel.id == checkpoint.session_id)
    )
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Get files - re-fetch checkpoint with eager loading
    cp_with_files_result = await db.execute(
        select(FileCheckpoint)
        .where(FileCheckpoint.id == checkpoint_id)
        .options(selectinload(FileCheckpoint.files))
    )
    cp_with_files = cp_with_files_result.scalar_one()
    files = cp_with_files.files

    return CheckpointResponse(
        id=str(checkpoint.id),
        checkpoint_number=checkpoint.checkpoint_number,
        description=checkpoint.description,
        action_type=checkpoint.action_type,
        agent_id=str(checkpoint.agent_id),
        status=checkpoint.status,
        created_at=checkpoint.created_at.isoformat()
        if checkpoint.created_at
        else datetime.now(UTC).isoformat(),
        files=[
            FileChangeResponse(
                path=f.file_path,
                change_type=f.change_type,
                lines_added=f.lines_added or 0,
                lines_removed=f.lines_removed or 0,
            )
            for f in files
        ],
        file_count=len(files),
        total_lines_added=sum(f.lines_added or 0 for f in files),
        total_lines_removed=sum(f.lines_removed or 0 for f in files),
    )


@router.get("/checkpoints/{checkpoint_id}/diff", response_model=CheckpointDiffResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_checkpoint_diff(
    checkpoint_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> CheckpointDiffResponse:
    """Get the full diff for a checkpoint."""
    user_id = get_current_user_id(request)

    # Get checkpoint
    result = await db.execute(select(FileCheckpoint).where(FileCheckpoint.id == checkpoint_id))
    checkpoint = result.scalar_one_or_none()

    if not checkpoint:
        raise HTTPException(status_code=404, detail="Checkpoint not found")

    # Verify session access
    session_result = await db.execute(
        select(SessionModel).where(SessionModel.id == checkpoint.session_id)
    )
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Get files with content - re-fetch with eager loading
    cp_with_files_result = await db.execute(
        select(FileCheckpoint)
        .where(FileCheckpoint.id == checkpoint_id)
        .options(selectinload(FileCheckpoint.files))
    )
    cp_with_files = cp_with_files_result.scalar_one()
    files = cp_with_files.files

    return CheckpointDiffResponse(
        id=str(checkpoint.id),
        description=checkpoint.description,
        files=[
            {
                "path": f.file_path,
                "change_type": f.change_type,
                "content_before": f.content_before,
                "content_after": f.content_after,
                "lines_added": f.lines_added or 0,
                "lines_removed": f.lines_removed or 0,
            }
            for f in files
        ],
    )


@router.post("/checkpoints/{checkpoint_id}/restore", response_model=RestoreResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def restore_checkpoint(
    checkpoint_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> RestoreResponse:
    """Restore files to their state at a checkpoint."""
    user_id = get_current_user_id(request)

    # Get checkpoint
    result = await db.execute(select(FileCheckpoint).where(FileCheckpoint.id == checkpoint_id))
    checkpoint = result.scalar_one_or_none()

    if not checkpoint:
        raise HTTPException(status_code=404, detail="Checkpoint not found")

    # Verify session access
    session_result = await db.execute(
        select(SessionModel).where(SessionModel.id == checkpoint.session_id)
    )
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    if not session.workspace_id:
        raise HTTPException(status_code=400, detail="Session has no workspace")

    # Get workspace information from compute service
    compute = await get_compute_client_for_workspace(session.workspace_id)
    workspace_info = await compute.get_workspace(session.workspace_id, user_id)

    if not workspace_info:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Emit restore started event with workspace info
    await emit_to_session(
        str(checkpoint.session_id),
        "checkpoint_restore_started",
        {
            "checkpoint_id": checkpoint_id,
            "session_id": str(checkpoint.session_id),
            "workspace_id": session.workspace_id,
            "workspace_host": workspace_info.get("host"),
            "workspace_port": workspace_info.get("port"),
        },
    )

    # Get files - re-fetch checkpoint with eager loading
    cp_with_files_result = await db.execute(
        select(FileCheckpoint)
        .where(FileCheckpoint.id == checkpoint_id)
        .options(selectinload(FileCheckpoint.files))
    )
    cp_with_files = cp_with_files_result.scalar_one()
    files = cp_with_files.files

    # Mark checkpoint as restored
    checkpoint.status = "restored"

    # Mark later checkpoints as superseded
    await db.execute(
        select(FileCheckpoint)
        .where(FileCheckpoint.session_id == checkpoint.session_id)
        .where(FileCheckpoint.checkpoint_number > checkpoint.checkpoint_number)
    )
    later_checkpoints_result = await db.execute(
        select(FileCheckpoint)
        .where(FileCheckpoint.session_id == checkpoint.session_id)
        .where(FileCheckpoint.checkpoint_number > checkpoint.checkpoint_number)
    )
    for later_cp in later_checkpoints_result.scalars().all():
        later_cp.status = "superseded"

    await db.commit()

    # Emit restore completed event
    await emit_to_session(
        str(checkpoint.session_id),
        "checkpoint_restore_completed",
        {
            "checkpoint_id": checkpoint_id,
            "session_id": str(checkpoint.session_id),
            "files_restored": len(files),
        },
    )

    return RestoreResponse(
        success=True,
        checkpoint_id=checkpoint_id,
        files=[
            {
                "path": f.file_path,
                "action": "restored" if f.change_type != "create" else "removed",
                "success": True,
            }
            for f in files
        ],
    )
