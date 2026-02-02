"""Change management routes for aggregated diff views."""

import difflib
import uuid
from datetime import UTC, datetime
from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.database.models import ChangeSetFile, PendingChangeSet
from src.database.models import Session as SessionModel
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter
from src.routes.dependencies import DbSession, get_current_user_id

logger = structlog.get_logger()

router = APIRouter()

# Minimum diff length for valid diff output
MIN_DIFF_LINES = 3


# ============================================================================
# Request/Response Models
# ============================================================================


class DiffLineResponse(BaseModel):
    """A single line in a diff."""

    type: str
    content: str
    old_line_number: int | None
    new_line_number: int | None


class DiffHunkResponse(BaseModel):
    """A contiguous block of changes."""

    id: str
    old_start: int
    old_lines: int
    new_start: int
    new_lines: int
    status: str
    lines: list[DiffLineResponse]


class FileChangeResponse(BaseModel):
    """A change to a single file."""

    path: str
    change_type: str
    hunks: list[DiffHunkResponse]
    additions: int
    deletions: int


class ChangeSetResponse(BaseModel):
    """A collection of file changes from an agent."""

    id: str
    session_id: str
    agent_id: str
    agent_name: str
    description: str
    files: list[FileChangeResponse]
    total_files: int
    total_additions: int
    total_deletions: int
    status: str
    created_at: str


class AggregatedFileChange(BaseModel):
    """A file with changes from potentially multiple agents."""

    change_set_id: str
    agent_id: str
    agent_name: str
    change_type: str
    hunks: list[DiffHunkResponse]
    additions: int
    deletions: int


class AggregatedChangesResponse(BaseModel):
    """Aggregated changes across all agents in a session."""

    session_id: str
    files: dict[str, list[AggregatedFileChange]]
    total_files: int
    total_change_sets: int
    conflicts: list[dict[str, Any]]


class CreateChangeSetRequest(BaseModel):
    """Request to create a new change set."""

    agent_id: str
    agent_name: str
    description: str


class AddFileChangeRequest(BaseModel):
    """Request to add a file change to a change set."""

    path: str
    change_type: str  # create, modify, delete
    content_before: str | None = None
    content_after: str | None = None


class UpdateHunkStatusRequest(BaseModel):
    """Request to update hunk selection status."""

    file_path: str
    hunk_id: str
    status: str  # selected, rejected


class ApplyChangeSetRequest(BaseModel):
    """Request to apply a change set."""

    selected_hunks: dict[str, list[str]] | None = None


# ============================================================================
# Helper Types and Functions
# ============================================================================


def _generate_hunks(content_before: str | None, content_after: str | None) -> list[dict[str, Any]]:
    """Generate diff hunks from before/after content.

    Returns hunks as list of dicts for JSONB storage.
    """
    if content_before is None:
        content_before = ""
    if content_after is None:
        content_after = ""

    before_lines = content_before.splitlines(keepends=True)
    after_lines = content_after.splitlines(keepends=True)

    diff = list(difflib.unified_diff(before_lines, after_lines, lineterm=""))

    if len(diff) < MIN_DIFF_LINES:
        return []

    hunks: list[dict[str, Any]] = []
    current_hunk: dict[str, Any] | None = None
    old_line = 0
    new_line = 0

    for line in diff[2:]:
        if line.startswith("@@"):
            parts = line.split()
            old_range = parts[1][1:].split(",")
            new_range = parts[2][1:].split(",")

            old_start = int(old_range[0])
            old_count = int(old_range[1]) if len(old_range) > 1 else 1
            new_start = int(new_range[0])
            new_count = int(new_range[1]) if len(new_range) > 1 else 1

            if current_hunk:
                hunks.append(current_hunk)

            current_hunk = {
                "id": str(uuid.uuid4()),
                "old_start": old_start,
                "old_lines": old_count,
                "new_start": new_start,
                "new_lines": new_count,
                "lines": [],
                "status": "selected",
            }
            old_line = old_start
            new_line = new_start
        elif current_hunk:
            content = line[1:] if line else ""

            if line.startswith("+"):
                current_hunk["lines"].append(
                    {
                        "type": "add",
                        "content": content.rstrip("\n"),
                        "old_line_number": None,
                        "new_line_number": new_line,
                    }
                )
                new_line += 1
            elif line.startswith("-"):
                current_hunk["lines"].append(
                    {
                        "type": "remove",
                        "content": content.rstrip("\n"),
                        "old_line_number": old_line,
                        "new_line_number": None,
                    }
                )
                old_line += 1
            else:
                current_hunk["lines"].append(
                    {
                        "type": "context",
                        "content": content.rstrip("\n"),
                        "old_line_number": old_line,
                        "new_line_number": new_line,
                    }
                )
                old_line += 1
                new_line += 1

    if current_hunk:
        hunks.append(current_hunk)

    return hunks


def _count_additions(hunks: list[dict[str, Any]]) -> int:
    """Count total additions across hunks."""
    return sum(sum(1 for line in hunk["lines"] if line["type"] == "add") for hunk in hunks)


def _count_deletions(hunks: list[dict[str, Any]]) -> int:
    """Count total deletions across hunks."""
    return sum(sum(1 for line in hunk["lines"] if line["type"] == "remove") for hunk in hunks)


def _hunk_to_response(hunk: dict[str, Any]) -> DiffHunkResponse:
    """Convert a hunk dict to response model."""
    return DiffHunkResponse(
        id=hunk["id"],
        old_start=hunk["old_start"],
        old_lines=hunk["old_lines"],
        new_start=hunk["new_start"],
        new_lines=hunk["new_lines"],
        status=hunk.get("status", "selected"),
        lines=[
            DiffLineResponse(
                type=line["type"],
                content=line["content"],
                old_line_number=line.get("old_line_number"),
                new_line_number=line.get("new_line_number"),
            )
            for line in hunk["lines"]
        ],
    )


# ============================================================================
# Routes
# ============================================================================


@router.get("/sessions/{session_id}/changes", response_model=list[ChangeSetResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_session_change_sets(
    session_id: str,
    request: Request,
    response: Response,
    db: DbSession,
    status: str | None = None,
) -> list[ChangeSetResponse]:
    """Get all change sets for a session."""
    user_id = get_current_user_id(request)

    # Verify session access
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == session_id))
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Get change sets from database
    query = (
        select(PendingChangeSet)
        .options(selectinload(PendingChangeSet.files))
        .where(PendingChangeSet.session_id == session_id)
    )

    if status:
        query = query.where(PendingChangeSet.status == status)

    query = query.order_by(PendingChangeSet.created_at.desc())

    result = await db.execute(query)
    change_sets = result.scalars().all()

    return [
        ChangeSetResponse(
            id=str(cs.id),
            session_id=str(cs.session_id),
            agent_id=str(cs.agent_id) if cs.agent_id else "",
            agent_name=cs.agent_name or "",
            description=cs.description,
            files=[
                FileChangeResponse(
                    path=f.file_path,
                    change_type=f.status,  # status maps to change_type (added/modified/deleted)
                    hunks=[_hunk_to_response(h) for h in (f.hunks or [])],
                    additions=f.additions,
                    deletions=f.deletions,
                )
                for f in cs.files
            ],
            total_files=cs.total_files,
            total_additions=cs.total_additions,
            total_deletions=cs.total_deletions,
            status=cs.status,
            created_at=cs.created_at.isoformat() if cs.created_at else "",
        )
        for cs in change_sets
    ]


@router.get("/sessions/{session_id}/changes/aggregated", response_model=AggregatedChangesResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_aggregated_changes(
    session_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> AggregatedChangesResponse:
    """Get aggregated pending changes across all agents."""
    user_id = get_current_user_id(request)

    # Verify session access
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == session_id))
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Get pending change sets from database
    query = (
        select(PendingChangeSet)
        .options(selectinload(PendingChangeSet.files))
        .where(
            PendingChangeSet.session_id == session_id,
            PendingChangeSet.status == "pending",
        )
    )

    result = await db.execute(query)
    pending = result.scalars().all()

    # Aggregate by file path
    files_by_path: dict[str, list[AggregatedFileChange]] = {}

    for cs in pending:
        for f in cs.files:
            if f.file_path not in files_by_path:
                files_by_path[f.file_path] = []

            hunks = f.hunks or []
            files_by_path[f.file_path].append(
                AggregatedFileChange(
                    change_set_id=str(cs.id),
                    agent_id=str(cs.agent_id) if cs.agent_id else "",
                    agent_name=cs.agent_name or "",
                    change_type=f.status,
                    hunks=[_hunk_to_response(h) for h in hunks],
                    additions=f.additions,
                    deletions=f.deletions,
                )
            )

    # Detect conflicts
    conflicts = []
    for path, changes in files_by_path.items():
        if len(changes) > 1:
            for i, c1 in enumerate(changes):
                for c2 in changes[i + 1 :]:
                    for h1 in c1.hunks:
                        for h2 in c2.hunks:
                            # Check for overlapping line ranges
                            end1 = h1.old_start + h1.old_lines
                            end2 = h2.old_start + h2.old_lines
                            if not (end1 <= h2.old_start or end2 <= h1.old_start):
                                conflicts.append(
                                    {
                                        "file_path": path,
                                        "agent1": c1.agent_name,
                                        "agent2": c2.agent_name,
                                        "hunk1_id": h1.id,
                                        "hunk2_id": h2.id,
                                    }
                                )

    return AggregatedChangesResponse(
        session_id=session_id,
        files=files_by_path,
        total_files=len(files_by_path),
        total_change_sets=len(pending),
        conflicts=conflicts,
    )


@router.post("/sessions/{session_id}/changes", response_model=ChangeSetResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def create_change_set(
    session_id: str,
    request: Request,
    response: Response,
    db: DbSession,
    body: CreateChangeSetRequest,
) -> ChangeSetResponse:
    """Create a new change set for an agent."""
    user_id = get_current_user_id(request)

    # Verify session access
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == session_id))
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Create change set in database
    cs = PendingChangeSet(
        session_id=session_id,
        agent_id=body.agent_id or None,
        agent_name=body.agent_name,
        description=body.description,
        status="pending",
        total_files=0,
        total_additions=0,
        total_deletions=0,
    )

    db.add(cs)
    await db.commit()
    await db.refresh(cs)

    return ChangeSetResponse(
        id=str(cs.id),
        session_id=str(cs.session_id),
        agent_id=str(cs.agent_id) if cs.agent_id else "",
        agent_name=cs.agent_name or "",
        description=cs.description,
        files=[],
        total_files=0,
        total_additions=0,
        total_deletions=0,
        status=cs.status,
        created_at=cs.created_at.isoformat() if cs.created_at else "",
    )


@router.post("/changes/{change_set_id}/files", response_model=FileChangeResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def add_file_to_change_set(
    change_set_id: str,
    request: Request,
    response: Response,
    db: DbSession,
    body: AddFileChangeRequest,
) -> FileChangeResponse:
    """Add a file change to an existing change set."""
    user_id = get_current_user_id(request)

    # Find change set
    result = await db.execute(select(PendingChangeSet).where(PendingChangeSet.id == change_set_id))
    cs = result.scalar_one_or_none()

    if not cs:
        raise HTTPException(status_code=404, detail="Change set not found")

    # Verify session access
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == cs.session_id))
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Generate hunks
    hunks = _generate_hunks(body.content_before, body.content_after)
    additions = _count_additions(hunks)
    deletions = _count_deletions(hunks)

    # Create file change record
    file_change = ChangeSetFile(
        change_set_id=change_set_id,
        file_path=body.path,
        status=body.change_type,  # create, modify, delete
        original_content=body.content_before,
        new_content=body.content_after,
        hunks=hunks,
        additions=additions,
        deletions=deletions,
        review_status="pending",
        accepted_hunk_ids=[],
    )

    db.add(file_change)

    # Update change set totals
    cs.total_files += 1
    cs.total_additions += additions
    cs.total_deletions += deletions

    await db.commit()
    await db.refresh(file_change)

    return FileChangeResponse(
        path=file_change.file_path,
        change_type=file_change.status,
        hunks=[_hunk_to_response(h) for h in hunks],
        additions=file_change.additions,
        deletions=file_change.deletions,
    )


@router.patch("/changes/{change_set_id}/hunks")
@limiter.limit(RATE_LIMIT_STANDARD)
async def update_hunk_status(
    change_set_id: str,
    request: Request,
    response: Response,
    db: DbSession,
    body: UpdateHunkStatusRequest,
) -> dict[str, str]:
    """Update the selection status of a hunk."""
    user_id = get_current_user_id(request)

    # Find change set
    result = await db.execute(
        select(PendingChangeSet)
        .options(selectinload(PendingChangeSet.files))
        .where(PendingChangeSet.id == change_set_id)
    )
    cs = result.scalar_one_or_none()

    if not cs:
        raise HTTPException(status_code=404, detail="Change set not found")

    # Verify session access
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == cs.session_id))
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Find and update hunk
    for f in cs.files:
        if f.file_path == body.file_path:
            hunks = list(f.hunks) if f.hunks else []
            for h in hunks:
                if h["id"] == body.hunk_id:
                    h["status"] = body.status
                    # Update the JSONB column
                    f.hunks = hunks
                    await db.commit()
                    return {"status": "updated"}

    raise HTTPException(status_code=404, detail="Hunk not found")


@router.post("/changes/{change_set_id}/apply")
@limiter.limit(RATE_LIMIT_STANDARD)
async def apply_change_set(
    change_set_id: str,
    request: Request,
    response: Response,
    db: DbSession,
    body: ApplyChangeSetRequest,
) -> dict[str, Any]:
    """Apply a change set (or selected hunks)."""
    user_id = get_current_user_id(request)

    # Find change set
    result = await db.execute(
        select(PendingChangeSet)
        .options(selectinload(PendingChangeSet.files))
        .where(PendingChangeSet.id == change_set_id)
    )
    cs = result.scalar_one_or_none()

    if not cs:
        raise HTTPException(status_code=404, detail="Change set not found")

    # Verify session access
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == cs.session_id))
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Apply changes (mark as applied)
    cs.status = "applied"
    cs.completed_at = datetime.now(UTC)
    cs.completed_by = user_id

    applied_files = []
    for f in cs.files:
        hunks = f.hunks or []
        if body.selected_hunks:
            hunk_ids = body.selected_hunks.get(f.file_path, [])
            hunks_to_apply = [h for h in hunks if h["id"] in hunk_ids]
            # Track accepted hunk IDs
            f.accepted_hunk_ids = hunk_ids
            f.review_status = "partial" if len(hunk_ids) < len(hunks) else "accepted"
        else:
            hunks_to_apply = [h for h in hunks if h.get("status") == "selected"]
            f.accepted_hunk_ids = [h["id"] for h in hunks_to_apply]
            f.review_status = "accepted" if hunks_to_apply else "rejected"

        if hunks_to_apply:
            applied_files.append(
                {
                    "path": f.file_path,
                    "change_type": f.status,
                    "hunks_applied": len(hunks_to_apply),
                }
            )

    await db.commit()

    return {
        "success": True,
        "change_set_id": change_set_id,
        "files_applied": len(applied_files),
        "details": applied_files,
    }


@router.post("/changes/{change_set_id}/reject")
@limiter.limit(RATE_LIMIT_STANDARD)
async def reject_change_set(
    change_set_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, str]:
    """Reject an entire change set."""
    user_id = get_current_user_id(request)

    # Find change set
    result = await db.execute(
        select(PendingChangeSet)
        .options(selectinload(PendingChangeSet.files))
        .where(PendingChangeSet.id == change_set_id)
    )
    cs = result.scalar_one_or_none()

    if not cs:
        raise HTTPException(status_code=404, detail="Change set not found")

    # Verify session access
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == cs.session_id))
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    cs.status = "rejected"
    cs.completed_at = datetime.now(UTC)
    cs.completed_by = user_id

    # Mark all files as rejected
    for f in cs.files:
        f.review_status = "rejected"

    await db.commit()

    return {"status": "rejected", "change_set_id": change_set_id}
