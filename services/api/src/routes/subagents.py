"""Subagent management routes for context-isolated subagents.

Subagents are spawned by a parent agent to handle delegated tasks in isolation.
Tasks are enqueued to a Redis-backed task queue and processed by agent workers.
"""

from datetime import UTC, datetime
from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, select

from src.database.models import Agent, Subagent
from src.database.models import Session as SessionModel
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter
from src.routes.dependencies import DbSession, get_current_user_id
from src.services.task_queue import (
    SubagentTaskData,
    TaskPriority,
    TaskStatus,
    get_subagent_task_queue,
)
from src.websocket.hub import emit_to_session

logger = structlog.get_logger()

router = APIRouter()

# Constants
MAX_CONCURRENT_SUBAGENTS = 5
SUMMARY_MAX_LENGTH = 500
SUMMARY_TRUNCATE_LENGTH = 497
FOREGROUND_TIMEOUT = 120.0  # Max wait time for foreground subagents


# ============================================================================
# Models
# ============================================================================


class SpawnSubagentRequest(BaseModel):
    """Request to spawn a subagent."""

    subagent_type: str
    task: str
    background: bool = False
    system_prompt: str | None = None
    priority: str = "medium"


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
    progress: int = 0
    progress_message: str | None = None
    task_id: str | None = None


class SubagentSummaryResponse(BaseModel):
    """Summary to inject into parent context."""

    subagent_id: str
    summary: str
    status: str


class SubagentProgressResponse(BaseModel):
    """Progress update for a running subagent."""

    task_id: str
    subagent_id: str
    status: str
    progress: int
    progress_message: str | None
    result: dict[str, Any] | None = None
    error: str | None = None


# ============================================================================
# Helper Functions
# ============================================================================


def _subagent_to_response(s: Subagent) -> SubagentResponse:
    """Convert a Subagent model to API response."""
    # Extract type from name (e.g., "Explore Subagent" -> "explore")
    subagent_type = s.name.lower().replace(" subagent", "") if s.name else "unknown"

    # Extract task from system_prompt (first line or full prompt)
    task = ""
    if s.system_prompt:
        lines = s.system_prompt.split("\n")
        task = lines[0] if lines else s.system_prompt

    # Extract error from verbose_output if status is failed
    error = None
    if s.status == "failed" and s.verbose_output:
        error = s.verbose_output

    # Extract task_id from tools field (used for queue tracking)
    task_id = None
    if s.tools and isinstance(s.tools, list) and len(s.tools) > 0:
        # We store task_id in tools[0] as a hack to persist it
        first_tool = s.tools[0]
        if isinstance(first_tool, str) and first_tool.startswith("task_id:"):
            task_id = first_tool.replace("task_id:", "")

    return SubagentResponse(
        id=str(s.id),
        parent_agent_id=str(s.parent_agent_id),
        session_id=str(s.session_id),
        name=s.name,
        type=subagent_type,
        task=task,
        status=s.status,
        background=not s.blocking,  # blocking=False means background=True
        created_at=s.started_at.isoformat() if s.started_at else "",
        completed_at=s.completed_at.isoformat() if s.completed_at else None,
        result_summary=s.summary,
        error=error,
        context_tokens=s.tokens_used,
        task_id=task_id,
    )


def _task_status_to_subagent_status(status: TaskStatus) -> str:
    """Convert task queue status to subagent status."""
    mapping = {
        TaskStatus.PENDING: "spawned",
        TaskStatus.RUNNING: "running",
        TaskStatus.COMPLETED: "completed",
        TaskStatus.FAILED: "failed",
        TaskStatus.CANCELLED: "failed",  # Map cancelled to failed for Subagent model
    }
    return mapping.get(status, "running")


async def _sync_task_to_subagent(
    db: Any,
    subagent: Subagent,
    task: SubagentTaskData,
) -> None:
    """Sync task queue data to the database Subagent model."""
    subagent.status = _task_status_to_subagent_status(task.status)

    if task.started_at:
        subagent.started_at = task.started_at

    if task.completed_at:
        subagent.completed_at = task.completed_at

    if task.result:
        summary = task.result.get("summary", "")
        if len(summary) > SUMMARY_MAX_LENGTH:
            subagent.summary = summary[:SUMMARY_TRUNCATE_LENGTH] + "..."
        else:
            subagent.summary = summary

        # Store full output if available
        if "output" in task.result:
            subagent.verbose_output = task.result["output"]

        # Update tokens if reported
        if "tokens_used" in task.result:
            subagent.tokens_used = task.result["tokens_used"]

    if task.error:
        subagent.verbose_output = task.error

    await db.commit()


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
    """Spawn a new subagent with isolated context.

    The subagent task is enqueued to the task queue and processed by an agent
    worker. For foreground tasks, this endpoint waits for completion. For
    background tasks, it returns immediately with the subagent ID.
    """
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

    # Check concurrent limit from database
    active_count_result = await db.execute(
        select(func.count(Subagent.id)).where(
            Subagent.parent_agent_id == agent_id,
            Subagent.status.in_(["spawned", "running"]),
        )
    )
    active_count = active_count_result.scalar() or 0

    if active_count >= MAX_CONCURRENT_SUBAGENTS:
        raise HTTPException(
            status_code=429,
            detail=f"Maximum {MAX_CONCURRENT_SUBAGENTS} concurrent subagents exceeded",
        )

    # Parse priority
    try:
        priority = TaskPriority(body.priority)
    except ValueError:
        priority = TaskPriority.MEDIUM

    # Enqueue task to the task queue
    task_queue = get_subagent_task_queue()
    task = await task_queue.enqueue(
        session_id=str(session.id),
        parent_agent_id=agent_id,
        subagent_type=body.subagent_type,
        task_description=body.task,
        system_prompt=body.system_prompt,
        background=body.background,
        priority=priority,
    )

    # Create subagent record in database for tracking
    subagent = Subagent(
        parent_agent_id=agent_id,
        session_id=str(agent.session_id),
        name=f"{body.subagent_type.capitalize()} Subagent",
        system_prompt=body.task,  # Store task in system_prompt
        tools=[f"task_id:{task.id}"],  # Store task_id for queue tracking
        status="spawned" if body.background else "running",
        blocking=not body.background,
        tokens_used=0,
    )

    db.add(subagent)
    await db.commit()
    await db.refresh(subagent)

    # Emit WebSocket event for subagent spawned
    await emit_to_session(
        str(session.id),
        "subagent_spawned",
        {
            "subagent_id": str(subagent.id),
            "task_id": task.id,
            "parent_agent_id": agent_id,
            "subagent_type": body.subagent_type,
            "task": body.task,
            "background": body.background,
        },
    )

    # For foreground tasks, wait for completion
    if not body.background:
        completed_task = await task_queue.wait_for_completion(
            task.id,
            timeout=FOREGROUND_TIMEOUT,
        )

        if completed_task:
            await _sync_task_to_subagent(db, subagent, completed_task)
            await db.refresh(subagent)

            # Emit completion event
            await emit_to_session(
                str(session.id),
                "subagent_completed",
                {
                    "subagent_id": str(subagent.id),
                    "task_id": task.id,
                    "status": subagent.status,
                    "result_summary": subagent.summary,
                    "error": subagent.verbose_output if subagent.status == "failed" else None,
                },
            )

    return _subagent_to_response(subagent)


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

    # Get subagents from database
    query = select(Subagent).where(Subagent.parent_agent_id == agent_id)

    if status:
        query = query.where(Subagent.status == status)

    query = query.order_by(Subagent.started_at.desc())

    result = await db.execute(query)
    subagents = result.scalars().all()

    return [_subagent_to_response(s) for s in subagents]


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

    result = await db.execute(select(Subagent).where(Subagent.id == subagent_id))
    subagent = result.scalar_one_or_none()

    if not subagent:
        raise HTTPException(status_code=404, detail="Subagent not found")

    # Verify session access
    session_result = await db.execute(
        select(SessionModel).where(SessionModel.id == subagent.session_id)
    )
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Sync with task queue if still running
    if subagent.status in ("spawned", "running"):
        # Extract task_id from tools
        task_id = None
        if subagent.tools and len(subagent.tools) > 0:
            first_tool = subagent.tools[0]
            if isinstance(first_tool, str) and first_tool.startswith("task_id:"):
                task_id = first_tool.replace("task_id:", "")

        if task_id:
            task_queue = get_subagent_task_queue()
            task = await task_queue.get_task(task_id)
            if task:
                await _sync_task_to_subagent(db, subagent, task)
                await db.refresh(subagent)

    return _subagent_to_response(subagent)


@router.get("/subagents/{subagent_id}/progress", response_model=SubagentProgressResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_subagent_progress(
    subagent_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> SubagentProgressResponse:
    """Get real-time progress for a running subagent."""
    user_id = get_current_user_id(request)

    result = await db.execute(select(Subagent).where(Subagent.id == subagent_id))
    subagent = result.scalar_one_or_none()

    if not subagent:
        raise HTTPException(status_code=404, detail="Subagent not found")

    # Verify session access
    session_result = await db.execute(
        select(SessionModel).where(SessionModel.id == subagent.session_id)
    )
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Extract task_id
    task_id = None
    if subagent.tools and len(subagent.tools) > 0:
        first_tool = subagent.tools[0]
        if isinstance(first_tool, str) and first_tool.startswith("task_id:"):
            task_id = first_tool.replace("task_id:", "")

    if not task_id:
        # No task queue tracking available
        return SubagentProgressResponse(
            task_id="",
            subagent_id=subagent_id,
            status=subagent.status,
            progress=100 if subagent.status == "completed" else 0,
            progress_message=None,
            result={"summary": subagent.summary} if subagent.summary else None,
            error=subagent.verbose_output if subagent.status == "failed" else None,
        )

    # Get latest from task queue
    task_queue = get_subagent_task_queue()
    task = await task_queue.get_task(task_id)

    if not task:
        return SubagentProgressResponse(
            task_id=task_id,
            subagent_id=subagent_id,
            status=subagent.status,
            progress=100 if subagent.status == "completed" else 0,
            progress_message=None,
            result={"summary": subagent.summary} if subagent.summary else None,
            error=subagent.verbose_output if subagent.status == "failed" else None,
        )

    # Sync if needed
    if task.status != TaskStatus(
        subagent.status if subagent.status in [s.value for s in TaskStatus] else "pending"
    ):
        await _sync_task_to_subagent(db, subagent, task)

    return SubagentProgressResponse(
        task_id=task_id,
        subagent_id=subagent_id,
        status=task.status.value,
        progress=task.progress,
        progress_message=task.progress_message,
        result=task.result,
        error=task.error,
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

    result = await db.execute(select(Subagent).where(Subagent.id == subagent_id))
    subagent = result.scalar_one_or_none()

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
        summary = f"[{subagent.name} completed] {subagent.summary or 'No summary available'}"
    elif subagent.status == "failed":
        error = subagent.verbose_output or "Unknown error"
        summary = f"[{subagent.name} failed] Error: {error}"
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

    result = await db.execute(select(Subagent).where(Subagent.id == subagent_id))
    subagent = result.scalar_one_or_none()

    if not subagent:
        raise HTTPException(status_code=404, detail="Subagent not found")

    # Verify session access
    session_result = await db.execute(
        select(SessionModel).where(SessionModel.id == subagent.session_id)
    )
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Map spawned to pending-like behavior for cancellation check
    cancellable_statuses = ("spawned", "running")
    if subagent.status not in cancellable_statuses:
        raise HTTPException(
            status_code=400, detail=f"Cannot cancel subagent with status: {subagent.status}"
        )

    # Cancel in task queue
    task_id = None
    if subagent.tools and len(subagent.tools) > 0:
        first_tool = subagent.tools[0]
        if isinstance(first_tool, str) and first_tool.startswith("task_id:"):
            task_id = first_tool.replace("task_id:", "")

    if task_id:
        task_queue = get_subagent_task_queue()
        await task_queue.cancel_task(task_id)

    # Update database
    subagent.status = "failed"  # Use failed status since the model doesn't have cancelled
    subagent.completed_at = datetime.now(UTC)
    subagent.verbose_output = "Cancelled by user"

    await db.commit()

    # Emit cancellation event
    await emit_to_session(
        str(session.id),
        "subagent_cancelled",
        {
            "subagent_id": subagent_id,
            "task_id": task_id,
        },
    )

    return {"status": "cancelled", "subagent_id": subagent_id}


@router.get("/sessions/{session_id}/subagents/queue")
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_session_subagent_queue(
    session_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, Any]:
    """Get the subagent task queue status for a session.

    Returns pending and active tasks from the task queue.
    """
    user_id = get_current_user_id(request)

    # Verify session access
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == session_id))
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    task_queue = get_subagent_task_queue()

    pending_tasks = await task_queue.get_pending_tasks(session_id)
    active_tasks = await task_queue.get_active_tasks(session_id)

    return {
        "session_id": session_id,
        "pending": [t.to_dict() for t in pending_tasks],
        "active": [t.to_dict() for t in active_tasks],
        "pending_count": len(pending_tasks),
        "active_count": len(active_tasks),
    }
