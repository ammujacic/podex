"""Change management routes for aggregated diff views."""

import difflib
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select

from src.database.models import Session as SessionModel
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
# In-Memory Change Storage (temporary - replace with database in production)
# ============================================================================


@dataclass
class DiffLine:
    type: str
    content: str
    old_line_number: int | None = None
    new_line_number: int | None = None


@dataclass
class DiffHunk:
    id: str
    old_start: int
    old_lines: int
    new_start: int
    new_lines: int
    lines: list[DiffLine]
    status: str = "selected"


@dataclass
class FileChange:
    path: str
    change_type: str
    hunks: list[DiffHunk]
    content_before: str | None = None
    content_after: str | None = None


@dataclass
class ChangeSet:
    id: str
    session_id: str
    agent_id: str
    agent_name: str
    description: str
    files: list[FileChange]
    created_at: datetime = field(default_factory=datetime.utcnow)
    status: str = "pending"


# Simple in-memory storage
_change_sets: dict[str, list[ChangeSet]] = {}


def _generate_hunks(content_before: str | None, content_after: str | None) -> list[DiffHunk]:
    """Generate diff hunks from before/after content."""
    if content_before is None:
        content_before = ""
    if content_after is None:
        content_after = ""

    before_lines = content_before.splitlines(keepends=True)
    after_lines = content_after.splitlines(keepends=True)

    diff = list(difflib.unified_diff(before_lines, after_lines, lineterm=""))

    if len(diff) < MIN_DIFF_LINES:
        return []

    hunks = []
    current_hunk: DiffHunk | None = None
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

            current_hunk = DiffHunk(
                id=str(uuid.uuid4()),
                old_start=old_start,
                old_lines=old_count,
                new_start=new_start,
                new_lines=new_count,
                lines=[],
            )
            old_line = old_start
            new_line = new_start
        elif current_hunk:
            content = line[1:] if line else ""

            if line.startswith("+"):
                current_hunk.lines.append(
                    DiffLine(
                        type="add",
                        content=content.rstrip("\n"),
                        new_line_number=new_line,
                    )
                )
                new_line += 1
            elif line.startswith("-"):
                current_hunk.lines.append(
                    DiffLine(
                        type="remove",
                        content=content.rstrip("\n"),
                        old_line_number=old_line,
                    )
                )
                old_line += 1
            else:
                current_hunk.lines.append(
                    DiffLine(
                        type="context",
                        content=content.rstrip("\n"),
                        old_line_number=old_line,
                        new_line_number=new_line,
                    )
                )
                old_line += 1
                new_line += 1

    if current_hunk:
        hunks.append(current_hunk)

    return hunks


def _count_additions(hunks: list[DiffHunk]) -> int:
    """Count total additions across hunks."""
    return sum(sum(1 for line in hunk.lines if line.type == "add") for hunk in hunks)


def _count_deletions(hunks: list[DiffHunk]) -> int:
    """Count total deletions across hunks."""
    return sum(sum(1 for line in hunk.lines if line.type == "remove") for hunk in hunks)


# ============================================================================
# Routes
# ============================================================================


@router.get("/sessions/{session_id}/changes", response_model=list[ChangeSetResponse])
async def get_session_change_sets(
    session_id: str,
    request: Request,
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

    # Get change sets
    change_sets = _change_sets.get(session_id, [])
    if status:
        change_sets = [cs for cs in change_sets if cs.status == status]

    return [
        ChangeSetResponse(
            id=cs.id,
            session_id=cs.session_id,
            agent_id=cs.agent_id,
            agent_name=cs.agent_name,
            description=cs.description,
            files=[
                FileChangeResponse(
                    path=f.path,
                    change_type=f.change_type,
                    hunks=[
                        DiffHunkResponse(
                            id=h.id,
                            old_start=h.old_start,
                            old_lines=h.old_lines,
                            new_start=h.new_start,
                            new_lines=h.new_lines,
                            status=h.status,
                            lines=[
                                DiffLineResponse(
                                    type=line.type,
                                    content=line.content,
                                    old_line_number=line.old_line_number,
                                    new_line_number=line.new_line_number,
                                )
                                for line in h.lines
                            ],
                        )
                        for h in f.hunks
                    ],
                    additions=_count_additions(f.hunks),
                    deletions=_count_deletions(f.hunks),
                )
                for f in cs.files
            ],
            total_files=len(cs.files),
            total_additions=sum(_count_additions(f.hunks) for f in cs.files),
            total_deletions=sum(_count_deletions(f.hunks) for f in cs.files),
            status=cs.status,
            created_at=cs.created_at.isoformat(),
        )
        for cs in change_sets
    ]


@router.get("/sessions/{session_id}/changes/aggregated", response_model=AggregatedChangesResponse)
async def get_aggregated_changes(
    session_id: str,
    request: Request,
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

    # Get pending change sets
    pending = [cs for cs in _change_sets.get(session_id, []) if cs.status == "pending"]

    # Aggregate by file path
    files_by_path: dict[str, list[AggregatedFileChange]] = {}

    for cs in pending:
        for f in cs.files:
            if f.path not in files_by_path:
                files_by_path[f.path] = []

            files_by_path[f.path].append(
                AggregatedFileChange(
                    change_set_id=cs.id,
                    agent_id=cs.agent_id,
                    agent_name=cs.agent_name,
                    change_type=f.change_type,
                    hunks=[
                        DiffHunkResponse(
                            id=h.id,
                            old_start=h.old_start,
                            old_lines=h.old_lines,
                            new_start=h.new_start,
                            new_lines=h.new_lines,
                            status=h.status,
                            lines=[
                                DiffLineResponse(
                                    type=line.type,
                                    content=line.content,
                                    old_line_number=line.old_line_number,
                                    new_line_number=line.new_line_number,
                                )
                                for line in h.lines
                            ],
                        )
                        for h in f.hunks
                    ],
                    additions=_count_additions(f.hunks),
                    deletions=_count_deletions(f.hunks),
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
async def create_change_set(
    session_id: str,
    request: Request,
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

    # Create change set
    cs = ChangeSet(
        id=str(uuid.uuid4()),
        session_id=session_id,
        agent_id=body.agent_id,
        agent_name=body.agent_name,
        description=body.description,
        files=[],
    )

    if session_id not in _change_sets:
        _change_sets[session_id] = []
    _change_sets[session_id].append(cs)

    return ChangeSetResponse(
        id=cs.id,
        session_id=cs.session_id,
        agent_id=cs.agent_id,
        agent_name=cs.agent_name,
        description=cs.description,
        files=[],
        total_files=0,
        total_additions=0,
        total_deletions=0,
        status=cs.status,
        created_at=cs.created_at.isoformat(),
    )


@router.post("/changes/{change_set_id}/files", response_model=FileChangeResponse)
async def add_file_to_change_set(
    change_set_id: str,
    request: Request,
    db: DbSession,
    body: AddFileChangeRequest,
) -> FileChangeResponse:
    """Add a file change to an existing change set."""
    user_id = get_current_user_id(request)

    # Find change set
    cs = None
    for session_sets in _change_sets.values():
        for s in session_sets:
            if s.id == change_set_id:
                cs = s
                break

    if not cs:
        raise HTTPException(status_code=404, detail="Change set not found")

    # Verify session access
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == cs.session_id))
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Generate hunks and add file
    hunks = _generate_hunks(body.content_before, body.content_after)

    file_change = FileChange(
        path=body.path,
        change_type=body.change_type,
        hunks=hunks,
        content_before=body.content_before,
        content_after=body.content_after,
    )
    cs.files.append(file_change)

    return FileChangeResponse(
        path=file_change.path,
        change_type=file_change.change_type,
        hunks=[
            DiffHunkResponse(
                id=h.id,
                old_start=h.old_start,
                old_lines=h.old_lines,
                new_start=h.new_start,
                new_lines=h.new_lines,
                status=h.status,
                lines=[
                    DiffLineResponse(
                        type=line.type,
                        content=line.content,
                        old_line_number=line.old_line_number,
                        new_line_number=line.new_line_number,
                    )
                    for line in h.lines
                ],
            )
            for h in file_change.hunks
        ],
        additions=_count_additions(file_change.hunks),
        deletions=_count_deletions(file_change.hunks),
    )


@router.patch("/changes/{change_set_id}/hunks")
async def update_hunk_status(
    change_set_id: str,
    request: Request,
    db: DbSession,
    body: UpdateHunkStatusRequest,
) -> dict[str, str]:
    """Update the selection status of a hunk."""
    user_id = get_current_user_id(request)

    # Find change set
    cs = None
    for session_sets in _change_sets.values():
        for s in session_sets:
            if s.id == change_set_id:
                cs = s
                break

    if not cs:
        raise HTTPException(status_code=404, detail="Change set not found")

    # Verify session access
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == cs.session_id))
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Find and update hunk
    for f in cs.files:
        if f.path == body.file_path:
            for h in f.hunks:
                if h.id == body.hunk_id:
                    h.status = body.status
                    return {"status": "updated"}

    raise HTTPException(status_code=404, detail="Hunk not found")


@router.post("/changes/{change_set_id}/apply")
async def apply_change_set(
    change_set_id: str,
    request: Request,
    db: DbSession,
    body: ApplyChangeSetRequest,
) -> dict[str, Any]:
    """Apply a change set (or selected hunks)."""
    user_id = get_current_user_id(request)

    # Find change set
    cs = None
    for session_sets in _change_sets.values():
        for s in session_sets:
            if s.id == change_set_id:
                cs = s
                break

    if not cs:
        raise HTTPException(status_code=404, detail="Change set not found")

    # Verify session access
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == cs.session_id))
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Apply changes (mark as applied)
    cs.status = "applied"

    applied_files = []
    for f in cs.files:
        if body.selected_hunks:
            hunk_ids = body.selected_hunks.get(f.path, [])
            hunks_to_apply = [h for h in f.hunks if h.id in hunk_ids]
        else:
            hunks_to_apply = [h for h in f.hunks if h.status == "selected"]

        if hunks_to_apply:
            applied_files.append(
                {
                    "path": f.path,
                    "change_type": f.change_type,
                    "hunks_applied": len(hunks_to_apply),
                }
            )

    return {
        "success": True,
        "change_set_id": change_set_id,
        "files_applied": len(applied_files),
        "details": applied_files,
    }


@router.post("/changes/{change_set_id}/reject")
async def reject_change_set(
    change_set_id: str,
    request: Request,
    db: DbSession,
) -> dict[str, str]:
    """Reject an entire change set."""
    user_id = get_current_user_id(request)

    # Find change set
    cs = None
    for session_sets in _change_sets.values():
        for s in session_sets:
            if s.id == change_set_id:
                cs = s
                break

    if not cs:
        raise HTTPException(status_code=404, detail="Change set not found")

    # Verify session access
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == cs.session_id))
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    cs.status = "rejected"

    return {"status": "rejected", "change_set_id": change_set_id}
