"""Git worktree management routes for parallel agent execution."""

from datetime import UTC, datetime
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.compute_client import compute_client
from src.database import get_db
from src.database.models import AgentWorktree
from src.database.models import Session as SessionModel
from src.websocket.hub import emit_to_session

logger = structlog.get_logger()

router = APIRouter()

DbSession = Annotated[AsyncSession, Depends(get_db)]


def get_current_user_id(request: Request) -> str:
    """Get current user ID from request state."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return str(user_id)


class WorktreeResponse(BaseModel):
    """Worktree response model."""

    id: str
    agent_id: str
    session_id: str
    worktree_path: str
    branch_name: str
    status: str
    created_at: str
    merged_at: str | None


class WorktreeListResponse(BaseModel):
    """List of worktrees with summary stats."""

    worktrees: list[WorktreeResponse]
    total: int
    active: int
    merged: int
    conflicts: int


@router.get("/sessions/{session_id}/worktrees", response_model=WorktreeListResponse)
async def get_session_worktrees(
    session_id: str,
    request: Request,
    db: DbSession,
) -> WorktreeListResponse:
    """Get all worktrees for a session."""
    user_id = get_current_user_id(request)

    # Verify session access
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == session_id))
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Get all worktrees for the session
    query = select(AgentWorktree).where(AgentWorktree.session_id == session_id)
    result = await db.execute(query)
    worktrees = result.scalars().all()

    # Calculate stats
    total = len(worktrees)
    active = sum(1 for w in worktrees if w.status == "active")
    merged = sum(1 for w in worktrees if w.status == "merged")
    conflicts = sum(1 for w in worktrees if w.status == "conflict")

    worktree_responses = [
        WorktreeResponse(
            id=w.id,
            agent_id=w.agent_id,
            session_id=w.session_id,
            worktree_path=w.worktree_path,
            branch_name=w.branch_name,
            status=w.status,
            created_at=w.created_at.isoformat(),
            merged_at=w.merged_at.isoformat() if w.merged_at else None,
        )
        for w in worktrees
    ]

    return WorktreeListResponse(
        worktrees=worktree_responses,
        total=total,
        active=active,
        merged=merged,
        conflicts=conflicts,
    )


@router.get("/worktrees/{worktree_id}", response_model=WorktreeResponse)
async def get_worktree(
    worktree_id: str,
    request: Request,
    db: DbSession,
) -> WorktreeResponse:
    """Get single worktree details."""
    user_id = get_current_user_id(request)

    # Get worktree
    result = await db.execute(select(AgentWorktree).where(AgentWorktree.id == worktree_id))
    worktree = result.scalar_one_or_none()

    if not worktree:
        raise HTTPException(status_code=404, detail="Worktree not found")

    # Verify session access
    session_result = await db.execute(
        select(SessionModel).where(SessionModel.id == worktree.session_id)
    )
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return WorktreeResponse(
        id=worktree.id,
        agent_id=worktree.agent_id,
        session_id=worktree.session_id,
        worktree_path=worktree.worktree_path,
        branch_name=worktree.branch_name,
        status=worktree.status,
        created_at=worktree.created_at.isoformat(),
        merged_at=worktree.merged_at.isoformat() if worktree.merged_at else None,
    )


class MergeWorktreeRequest(BaseModel):
    """Request to merge a worktree."""

    delete_after_merge: bool = True


class MergeWorktreeResponse(BaseModel):
    """Response from merge operation."""

    success: bool
    worktree_id: str
    message: str


@router.post("/worktrees/{worktree_id}/merge", response_model=MergeWorktreeResponse)
async def merge_worktree(
    worktree_id: str,
    request: Request,
    db: DbSession,
    merge_request: MergeWorktreeRequest = MergeWorktreeRequest(),  # noqa: B008
) -> MergeWorktreeResponse:
    """Trigger merge of worktree to main branch."""
    user_id = get_current_user_id(request)

    # Get worktree
    result = await db.execute(select(AgentWorktree).where(AgentWorktree.id == worktree_id))
    worktree = result.scalar_one_or_none()

    if not worktree:
        raise HTTPException(status_code=404, detail="Worktree not found")

    # Verify session access
    session_result = await db.execute(
        select(SessionModel).where(SessionModel.id == worktree.session_id)
    )
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    if worktree.status == "merged":
        raise HTTPException(status_code=400, detail="Worktree already merged")

    # Update status to merging
    old_status = worktree.status
    worktree.status = "merging"
    await db.commit()

    # Emit status change event
    await emit_to_session(
        worktree.session_id,
        "worktree_status_changed",
        {
            "worktree_id": worktree.id,
            "agent_id": worktree.agent_id,
            "old_status": old_status,
            "new_status": "merging",
        },
    )

    try:
        # Perform actual git merge via compute service
        if not session.workspace_id:
            raise HTTPException(status_code=400, detail="Session workspace_id is required")  # noqa: TRY301

        merge_result = await compute_client.git_worktree_merge(
            session.workspace_id,
            user_id,
            worktree.branch_name,
            delete_branch=merge_request.delete_after_merge,
        )

        if merge_result.get("success"):
            # Update status to merged
            worktree.status = "merged"
            worktree.merged_at = datetime.now(UTC)
            await db.commit()

            # Emit merged event
            await emit_to_session(
                worktree.session_id,
                "worktree_merged",
                {
                    "worktree_id": worktree.id,
                    "agent_id": worktree.agent_id,
                    "merge_result": {
                        "success": True,
                        "message": merge_result.get("message", "Merged successfully"),
                    },
                },
            )

            logger.info(
                "Worktree merged successfully",
                worktree_id=worktree.id,
                branch=worktree.branch_name,
            )

            return MergeWorktreeResponse(
                success=True,
                worktree_id=worktree.id,
                message="Merge completed successfully",
            )
        # Merge failed
        worktree.status = "failed"
        await db.commit()

        # Emit failed event
        await emit_to_session(
            worktree.session_id,
            "worktree_merged",
            {
                "worktree_id": worktree.id,
                "agent_id": worktree.agent_id,
                "merge_result": {
                    "success": False,
                    "message": merge_result.get("message", "Merge failed"),
                },
            },
        )

        raise HTTPException(status_code=500, detail=merge_result.get("message", "Merge failed"))  # noqa: TRY301

    except HTTPException:
        raise
    except Exception as e:
        # Merge failed with exception
        worktree.status = "failed"
        await db.commit()

        logger.exception(
            "Worktree merge failed",
            worktree_id=worktree.id,
            error=str(e),
        )

        raise HTTPException(status_code=500, detail=f"Merge failed: {e!s}")  # noqa: B904


class DeleteWorktreeResponse(BaseModel):
    """Response from delete operation."""

    success: bool
    worktree_id: str
    message: str


@router.delete("/worktrees/{worktree_id}", response_model=DeleteWorktreeResponse)
async def delete_worktree(
    worktree_id: str,
    request: Request,
    db: DbSession,
) -> DeleteWorktreeResponse:
    """Delete/cleanup a worktree."""
    user_id = get_current_user_id(request)

    # Get worktree
    result = await db.execute(select(AgentWorktree).where(AgentWorktree.id == worktree_id))
    worktree = result.scalar_one_or_none()

    if not worktree:
        raise HTTPException(status_code=404, detail="Worktree not found")

    # Verify session access
    session_result = await db.execute(
        select(SessionModel).where(SessionModel.id == worktree.session_id)
    )
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    session_id = worktree.session_id
    agent_id = worktree.agent_id

    try:
        # Delete the worktree via compute service
        if not session.workspace_id:
            raise HTTPException(status_code=400, detail="Session workspace_id is required")  # noqa: TRY301

        delete_result = await compute_client.git_worktree_delete(
            session.workspace_id,
            user_id,
            worktree.worktree_path,
            worktree.branch_name,
        )

        if delete_result.get("success"):
            # Delete the database record
            await db.delete(worktree)
            await db.commit()

            # Emit WebSocket event
            await emit_to_session(
                session_id,
                "worktree_deleted",
                {
                    "worktree_id": worktree_id,
                    "agent_id": agent_id,
                },
            )

            logger.info("Worktree deleted", worktree_id=worktree_id)

            return DeleteWorktreeResponse(
                success=True,
                worktree_id=worktree_id,
                message="Worktree deleted successfully",
            )
        raise HTTPException(  # noqa: TRY301
            status_code=500,
            detail=delete_result.get("message", "Failed to delete worktree"),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Worktree deletion failed", worktree_id=worktree_id, error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to delete worktree: {e!s}")  # noqa: B904


class ConflictFile(BaseModel):
    """File with merge conflict."""

    path: str
    conflict_markers: int


class ConflictsResponse(BaseModel):
    """Worktree conflicts response."""

    has_conflicts: bool
    files: list[ConflictFile]


@router.get("/worktrees/{worktree_id}/conflicts", response_model=ConflictsResponse)
async def check_worktree_conflicts(
    worktree_id: str,
    request: Request,
    db: DbSession,
) -> ConflictsResponse:
    """Check for merge conflicts in a worktree."""
    user_id = get_current_user_id(request)

    # Get worktree
    result = await db.execute(select(AgentWorktree).where(AgentWorktree.id == worktree_id))
    worktree = result.scalar_one_or_none()

    if not worktree:
        raise HTTPException(status_code=404, detail="Worktree not found")

    # Verify session access
    session_result = await db.execute(
        select(SessionModel).where(SessionModel.id == worktree.session_id)
    )
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    try:
        # Check for conflicts via compute service
        if not session.workspace_id:
            raise HTTPException(status_code=400, detail="Session workspace_id is required")  # noqa: TRY301

        conflicts_result = await compute_client.git_worktree_check_conflicts(
            session.workspace_id,
            user_id,
            worktree.branch_name,
        )

        return ConflictsResponse(
            has_conflicts=conflicts_result.get("has_conflicts", False),
            files=[
                ConflictFile(path=f["path"], conflict_markers=f.get("conflict_markers", 1))
                for f in conflicts_result.get("files", [])
            ],
        )

    except Exception as e:
        logger.exception(
            "Failed to check worktree conflicts", worktree_id=worktree_id, error=str(e)
        )
        # Return no conflicts on error to avoid breaking the UI
        return ConflictsResponse(
            has_conflicts=False,
            files=[],
        )
