"""Pending changes routes for agent-proposed file modifications.

When agents in Ask mode want to modify files, they create pending changes
that users can review via a diff view and accept or reject.
"""

from datetime import UTC, datetime

import structlog
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select

from src.database.models import Agent, PendingChange
from src.database.models import Session as SessionModel
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter
from src.routes.dependencies import DbSession, get_current_user_id

logger = structlog.get_logger()

router = APIRouter()


# ============================================================================
# Request/Response Models
# ============================================================================


class PendingChangeResponse(BaseModel):
    """A pending file change proposed by an agent."""

    id: str
    session_id: str
    agent_id: str
    agent_name: str
    file_path: str
    original_content: str | None
    proposed_content: str
    description: str | None
    status: str
    created_at: str


class CreatePendingChangeRequest(BaseModel):
    """Request to create a pending change (typically from agent service)."""

    agent_id: str
    file_path: str
    original_content: str | None = None
    proposed_content: str
    description: str | None = None


class RejectChangeRequest(BaseModel):
    """Request to reject a pending change with optional feedback."""

    feedback: str | None = None


# ============================================================================
# Routes
# ============================================================================


@router.get("/sessions/{session_id}/pending-changes", response_model=list[PendingChangeResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_pending_changes(
    session_id: str,
    request: Request,
    response: Response,
    db: DbSession,
    status: str | None = None,
) -> list[PendingChangeResponse]:
    """List pending changes for a session."""
    user_id = get_current_user_id(request)

    # Verify session access
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == session_id))
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Build query
    query = (
        select(PendingChange, Agent.name.label("agent_name"))
        .join(Agent, PendingChange.agent_id == Agent.id)
        .where(PendingChange.session_id == session_id)
    )

    if status:
        query = query.where(PendingChange.status == status)

    query = query.order_by(PendingChange.created_at.desc())

    result = await db.execute(query)
    rows = result.all()

    return [
        PendingChangeResponse(
            id=change.id,
            session_id=change.session_id,
            agent_id=change.agent_id,
            agent_name=agent_name,
            file_path=change.file_path,
            original_content=change.original_content,
            proposed_content=change.proposed_content,
            description=change.description,
            status=change.status,
            created_at=change.created_at.isoformat(),
        )
        for change, agent_name in rows
    ]


@router.get(
    "/sessions/{session_id}/pending-changes/{change_id}",
    response_model=PendingChangeResponse,
)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_pending_change(
    session_id: str,
    change_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> PendingChangeResponse:
    """Get a specific pending change."""
    user_id = get_current_user_id(request)

    # Verify session access
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == session_id))
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Get the change with agent name
    query = (
        select(PendingChange, Agent.name.label("agent_name"))
        .join(Agent, PendingChange.agent_id == Agent.id)
        .where(
            PendingChange.id == change_id,
            PendingChange.session_id == session_id,
        )
    )

    result = await db.execute(query)
    row = result.one_or_none()

    if not row:
        raise HTTPException(status_code=404, detail="Pending change not found")

    change, agent_name = row

    return PendingChangeResponse(
        id=change.id,
        session_id=change.session_id,
        agent_id=change.agent_id,
        agent_name=agent_name,
        file_path=change.file_path,
        original_content=change.original_content,
        proposed_content=change.proposed_content,
        description=change.description,
        status=change.status,
        created_at=change.created_at.isoformat(),
    )


@router.post("/sessions/{session_id}/pending-changes", response_model=PendingChangeResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def create_pending_change(
    session_id: str,
    request: Request,
    response: Response,
    db: DbSession,
    body: CreatePendingChangeRequest,
) -> PendingChangeResponse:
    """Create a new pending change (typically called by agent service)."""
    user_id = get_current_user_id(request)

    # Verify session access
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == session_id))
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Verify agent exists and belongs to session
    agent_result = await db.execute(
        select(Agent).where(Agent.id == body.agent_id, Agent.session_id == session_id)
    )
    agent = agent_result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found in session")

    # Create the pending change
    change = PendingChange(
        session_id=session_id,
        agent_id=body.agent_id,
        file_path=body.file_path,
        original_content=body.original_content,
        proposed_content=body.proposed_content,
        description=body.description,
        status="pending",
    )

    db.add(change)
    await db.commit()
    await db.refresh(change)

    logger.info(
        "Created pending change",
        change_id=change.id,
        session_id=session_id,
        agent_id=body.agent_id,
        file_path=body.file_path,
    )

    return PendingChangeResponse(
        id=change.id,
        session_id=change.session_id,
        agent_id=change.agent_id,
        agent_name=agent.name,
        file_path=change.file_path,
        original_content=change.original_content,
        proposed_content=change.proposed_content,
        description=change.description,
        status=change.status,
        created_at=change.created_at.isoformat(),
    )


@router.post("/sessions/{session_id}/pending-changes/{change_id}/accept")
@limiter.limit(RATE_LIMIT_STANDARD)
async def accept_pending_change(
    session_id: str,
    change_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, str]:
    """Accept a pending change and apply the file modification."""
    user_id = get_current_user_id(request)

    # Verify session access
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == session_id))
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Get the pending change
    change_result = await db.execute(
        select(PendingChange).where(
            PendingChange.id == change_id,
            PendingChange.session_id == session_id,
        )
    )
    change = change_result.scalar_one_or_none()

    if not change:
        raise HTTPException(status_code=404, detail="Pending change not found")

    if change.status != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"Change already {change.status}",
        )

    # Update status
    change.status = "accepted"
    change.resolved_at = datetime.now(tz=UTC)
    change.resolved_by = user_id

    await db.commit()

    logger.info(
        "Accepted pending change",
        change_id=change_id,
        session_id=session_id,
        file_path=change.file_path,
    )

    return {
        "status": "accepted",
        "change_id": change_id,
        "file_path": change.file_path,
    }


@router.post("/sessions/{session_id}/pending-changes/{change_id}/reject")
@limiter.limit(RATE_LIMIT_STANDARD)
async def reject_pending_change(
    session_id: str,
    change_id: str,
    request: Request,
    response: Response,
    db: DbSession,
    body: RejectChangeRequest | None = None,
) -> dict[str, str]:
    """Reject a pending change."""
    user_id = get_current_user_id(request)

    # Verify session access
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == session_id))
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Get the pending change
    change_result = await db.execute(
        select(PendingChange).where(
            PendingChange.id == change_id,
            PendingChange.session_id == session_id,
        )
    )
    change = change_result.scalar_one_or_none()

    if not change:
        raise HTTPException(status_code=404, detail="Pending change not found")

    if change.status != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"Change already {change.status}",
        )

    # Update status
    change.status = "rejected"
    change.resolved_at = datetime.now(tz=UTC)
    change.resolved_by = user_id
    if body and body.feedback:
        change.rejection_feedback = body.feedback

    await db.commit()

    logger.info(
        "Rejected pending change",
        change_id=change_id,
        session_id=session_id,
        file_path=change.file_path,
        feedback=body.feedback if body else None,
    )

    return {
        "status": "rejected",
        "change_id": change_id,
        "file_path": change.file_path,
    }
