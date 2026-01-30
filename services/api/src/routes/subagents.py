"""Subagent management routes for context-isolated subagents."""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select

from src.database.models import Agent
from src.database.models import Session as SessionModel
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter
from src.routes.dependencies import DbSession, get_current_user_id

logger = structlog.get_logger()

router = APIRouter()

# Constants
MAX_CONCURRENT_SUBAGENTS = 5
SUMMARY_MAX_LENGTH = 500
SUMMARY_TRUNCATE_LENGTH = 497


# ============================================================================
# Models
# ============================================================================


class SpawnSubagentRequest(BaseModel):
    """Request to spawn a subagent."""

    subagent_type: str
    task: str
    background: bool = False
    system_prompt: str | None = None


class SubagentResponse(BaseModel):
    """Subagent response model."""

    id: str
    parent_agent_id: str
    session_id: str
    name: str
    type: str
    task: str
    status: str
    background: bool
    created_at: str
    completed_at: str | None
    result_summary: str | None
    error: str | None
    context_tokens: int


class SubagentSummaryResponse(BaseModel):
    """Summary to inject into parent context."""

    subagent_id: str
    summary: str
    status: str


# ============================================================================
# In-memory storage (temporary - would use database/agent service in production)
# ============================================================================


@dataclass
class SubagentContext:
    messages: list[dict[str, Any]] = field(default_factory=list)
    tokens_used: int = 0

    def summarize(self) -> str:
        assistant_msgs = [m["content"] for m in self.messages if m["role"] == "assistant"]
        if not assistant_msgs:
            return "No response generated."
        last: str = str(assistant_msgs[-1])
        if len(last) > SUMMARY_MAX_LENGTH:
            return last[:SUMMARY_TRUNCATE_LENGTH] + "..."
        return last


@dataclass
class Subagent:
    id: str
    parent_agent_id: str
    session_id: str
    name: str
    type: str
    task: str
    context: SubagentContext
    status: str = "pending"
    background: bool = False
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    completed_at: datetime | None = None
    result_summary: str | None = None
    error: str | None = None


# Storage
_subagents: dict[str, list[Subagent]] = {}  # parent_agent_id -> subagents
_subagent_by_id: dict[str, Subagent] = {}


# ============================================================================
# Routes
# ============================================================================


@router.post("/agents/{agent_id}/subagents", response_model=SubagentResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def spawn_subagent(
    agent_id: str,
    request: Request,
    response: Response,
    db: DbSession,
    body: SpawnSubagentRequest,
) -> SubagentResponse:
    """Spawn a new subagent with isolated context."""
    user_id = get_current_user_id(request)

    # Verify agent access
    agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = agent_result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Verify session access
    session_result = await db.execute(
        select(SessionModel).where(SessionModel.id == agent.session_id)
    )
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Check concurrent limit
    active = [s for s in _subagents.get(agent_id, []) if s.status in ("pending", "running")]
    if len(active) >= MAX_CONCURRENT_SUBAGENTS:
        raise HTTPException(
            status_code=429,
            detail=f"Maximum {MAX_CONCURRENT_SUBAGENTS} concurrent subagents exceeded",
        )

    # Create subagent
    subagent = Subagent(
        id=str(uuid.uuid4()),
        parent_agent_id=agent_id,
        session_id=str(agent.session_id),
        name=f"{body.subagent_type.capitalize()} Subagent",
        type=body.subagent_type.lower(),
        task=body.task,
        context=SubagentContext(),
        background=body.background,
    )

    # Register
    if agent_id not in _subagents:
        _subagents[agent_id] = []
    _subagents[agent_id].append(subagent)
    _subagent_by_id[subagent.id] = subagent

    # Simulate execution (in production, would delegate to agent service)
    subagent.status = "running"
    subagent.context.messages.append(
        {
            "role": "user",
            "content": body.task,
        }
    )

    # For now, immediately complete with acknowledgment
    # In production, this would be async via agent service
    subagent.context.messages.append(
        {
            "role": "assistant",
            "content": f"[{subagent.name}] Task acknowledged: {body.task}\n\n"
            f"Processing with isolated context...",
        }
    )
    subagent.context.tokens_used = len(body.task) // 4 + 50

    if not body.background:
        subagent.status = "completed"
        subagent.completed_at = datetime.now(UTC)
        subagent.result_summary = subagent.context.summarize()

    return SubagentResponse(
        id=subagent.id,
        parent_agent_id=subagent.parent_agent_id,
        session_id=subagent.session_id,
        name=subagent.name,
        type=subagent.type,
        task=subagent.task,
        status=subagent.status,
        background=subagent.background,
        created_at=subagent.created_at.isoformat(),
        completed_at=subagent.completed_at.isoformat() if subagent.completed_at else None,
        result_summary=subagent.result_summary,
        error=subagent.error,
        context_tokens=subagent.context.tokens_used,
    )


@router.get("/agents/{agent_id}/subagents", response_model=list[SubagentResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_subagents(
    agent_id: str,
    request: Request,
    response: Response,
    db: DbSession,
    status: str | None = None,
) -> list[SubagentResponse]:
    """List subagents for an agent."""
    user_id = get_current_user_id(request)

    # Verify agent access
    agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = agent_result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Verify session access
    session_result = await db.execute(
        select(SessionModel).where(SessionModel.id == agent.session_id)
    )
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Get subagents
    subagents = _subagents.get(agent_id, [])
    if status:
        subagents = [s for s in subagents if s.status == status]

    return [
        SubagentResponse(
            id=s.id,
            parent_agent_id=s.parent_agent_id,
            session_id=s.session_id,
            name=s.name,
            type=s.type,
            task=s.task,
            status=s.status,
            background=s.background,
            created_at=s.created_at.isoformat(),
            completed_at=s.completed_at.isoformat() if s.completed_at else None,
            result_summary=s.result_summary,
            error=s.error,
            context_tokens=s.context.tokens_used,
        )
        for s in subagents
    ]


@router.get("/subagents/{subagent_id}", response_model=SubagentResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_subagent(
    subagent_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> SubagentResponse:
    """Get a specific subagent."""
    user_id = get_current_user_id(request)

    subagent = _subagent_by_id.get(subagent_id)
    if not subagent:
        raise HTTPException(status_code=404, detail="Subagent not found")

    # Verify session access
    session_result = await db.execute(
        select(SessionModel).where(SessionModel.id == subagent.session_id)
    )
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return SubagentResponse(
        id=subagent.id,
        parent_agent_id=subagent.parent_agent_id,
        session_id=subagent.session_id,
        name=subagent.name,
        type=subagent.type,
        task=subagent.task,
        status=subagent.status,
        background=subagent.background,
        created_at=subagent.created_at.isoformat(),
        completed_at=subagent.completed_at.isoformat() if subagent.completed_at else None,
        result_summary=subagent.result_summary,
        error=subagent.error,
        context_tokens=subagent.context.tokens_used,
    )


@router.get("/subagents/{subagent_id}/summary", response_model=SubagentSummaryResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_subagent_summary(
    subagent_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> SubagentSummaryResponse:
    """Get the summary to inject into parent context."""
    user_id = get_current_user_id(request)

    subagent = _subagent_by_id.get(subagent_id)
    if not subagent:
        raise HTTPException(status_code=404, detail="Subagent not found")

    # Verify session access
    session_result = await db.execute(
        select(SessionModel).where(SessionModel.id == subagent.session_id)
    )
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Generate summary
    if subagent.status == "completed":
        summary = f"[{subagent.name} completed] {subagent.result_summary}"
    elif subagent.status == "failed":
        summary = f"[{subagent.name} failed] Error: {subagent.error}"
    elif subagent.status == "running":
        summary = f"[{subagent.name} running] Task in progress..."
    else:
        summary = f"[{subagent.name}] Status: {subagent.status}"

    return SubagentSummaryResponse(
        subagent_id=subagent_id,
        summary=summary,
        status=subagent.status,
    )


@router.post("/subagents/{subagent_id}/cancel")
@limiter.limit(RATE_LIMIT_STANDARD)
async def cancel_subagent(
    subagent_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, str]:
    """Cancel a running subagent."""
    user_id = get_current_user_id(request)

    subagent = _subagent_by_id.get(subagent_id)
    if not subagent:
        raise HTTPException(status_code=404, detail="Subagent not found")

    # Verify session access
    session_result = await db.execute(
        select(SessionModel).where(SessionModel.id == subagent.session_id)
    )
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    if subagent.status not in ("pending", "running"):
        raise HTTPException(
            status_code=400, detail=f"Cannot cancel subagent with status: {subagent.status}"
        )

    subagent.status = "cancelled"
    subagent.completed_at = datetime.now(UTC)

    return {"status": "cancelled", "subagent_id": subagent_id}
