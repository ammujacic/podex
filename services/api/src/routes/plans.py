"""Execution plans API routes for planning mode."""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.connection import get_db
from src.database.models import ExecutionPlan, Session
from src.middleware.auth import get_current_user
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

router = APIRouter(prefix="/api/sessions/{session_id}/plans", tags=["plans"])

# Type aliases for dependencies
DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[dict[str, str | None], Depends(get_current_user)]


@dataclass
class PlanListParams:
    """Query parameters for listing plans."""

    status: str | None = None
    page: int = 1
    page_size: int = 20


def get_plan_list_params(
    status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> PlanListParams:
    """Dependency to get plan list parameters."""
    return PlanListParams(status=status, page=page, page_size=page_size)


class PlanStepResponse(BaseModel):
    """A step in an execution plan."""

    id: str
    description: str
    action_type: str
    action_params: dict[str, Any]
    status: str
    result: dict[str, Any] | None
    error: str | None
    can_rollback: bool


class PlanResponse(BaseModel):
    """Execution plan response."""

    id: str
    session_id: str
    agent_id: str | None
    title: str
    description: str | None
    original_task: str | None
    steps: list[PlanStepResponse]
    current_step: int
    status: str
    confidence_score: float | None
    error: str | None
    created_at: str
    approved_at: str | None
    approved_by: str | None
    started_at: str | None
    completed_at: str | None

    model_config = ConfigDict(from_attributes=True)


class PlanListResponse(BaseModel):
    """List of plans response."""

    plans: list[PlanResponse]
    total: int
    page: int
    page_size: int


class ApprovalRequest(BaseModel):
    """Request to approve a plan."""

    notes: str | None = None


class RejectionRequest(BaseModel):
    """Request to reject a plan."""

    reason: str = Field(..., min_length=1, max_length=500)


@router.get("", response_model=PlanListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_plans(
    request: Request,
    response: Response,
    session_id: UUID,
    db: DbSession,
    current_user: CurrentUser,
    params: Annotated[PlanListParams, Depends(get_plan_list_params)],
) -> PlanListResponse:
    """List execution plans for a session."""
    # Verify session access
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.owner_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Build query
    query = select(ExecutionPlan).where(ExecutionPlan.session_id == session_id)

    if params.status:
        query = query.where(ExecutionPlan.status == params.status)

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.scalar(count_query) or 0

    # Apply pagination
    query = query.offset((params.page - 1) * params.page_size).limit(params.page_size)
    query = query.order_by(ExecutionPlan.created_at.desc())

    result = await db.execute(query)
    plans = result.scalars().all()

    return PlanListResponse(
        plans=[_plan_to_response(p) for p in plans],
        total=total,
        page=params.page,
        page_size=params.page_size,
    )


@router.get("/pending", response_model=list[PlanResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_pending_plans(
    request: Request,
    response: Response,
    session_id: UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> list[PlanResponse]:
    """List plans pending approval."""
    # Verify session access
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.owner_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    query = (
        select(ExecutionPlan)
        .where(
            ExecutionPlan.session_id == session_id,
            ExecutionPlan.status == "pending_approval",
        )
        .order_by(ExecutionPlan.created_at.desc())
    )

    result = await db.execute(query)
    plans = result.scalars().all()

    return [_plan_to_response(p) for p in plans]


@router.get("/{plan_id}", response_model=PlanResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_plan(
    request: Request,
    response: Response,
    session_id: UUID,
    plan_id: UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> PlanResponse:
    """Get a specific execution plan."""
    plan = await db.get(ExecutionPlan, plan_id)

    if not plan or str(plan.session_id) != str(session_id):
        raise HTTPException(status_code=404, detail="Plan not found")

    # Verify session access
    session = await db.get(Session, session_id)
    if not session or session.owner_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    return _plan_to_response(plan)


@router.post("/{plan_id}/approve", response_model=PlanResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def approve_plan(
    request: Request,
    response: Response,
    session_id: UUID,
    plan_id: UUID,
    db: DbSession,
    current_user: CurrentUser,
    _data: ApprovalRequest | None = None,
) -> PlanResponse:
    """Approve a pending execution plan."""
    plan = await db.get(ExecutionPlan, plan_id)

    if not plan or str(plan.session_id) != str(session_id):
        raise HTTPException(status_code=404, detail="Plan not found")

    # Verify session access
    session = await db.get(Session, session_id)
    if not session or session.owner_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    if plan.status != "pending_approval":
        raise HTTPException(
            status_code=400,
            detail=f"Plan cannot be approved (current status: {plan.status})",
        )

    # Update plan
    plan.status = "approved"
    plan.approved_at = datetime.now(UTC)
    plan.approved_by = current_user["id"]

    await db.commit()
    await db.refresh(plan)

    return _plan_to_response(plan)


@router.post("/{plan_id}/reject", response_model=PlanResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def reject_plan(
    request: Request,
    response: Response,
    session_id: UUID,
    plan_id: UUID,
    data: RejectionRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> PlanResponse:
    """Reject a pending execution plan."""
    plan = await db.get(ExecutionPlan, plan_id)

    if not plan or str(plan.session_id) != str(session_id):
        raise HTTPException(status_code=404, detail="Plan not found")

    # Verify session access
    session = await db.get(Session, session_id)
    if not session or session.owner_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    if plan.status != "pending_approval":
        raise HTTPException(
            status_code=400,
            detail=f"Plan cannot be rejected (current status: {plan.status})",
        )

    # Update plan
    plan.status = "rejected"
    plan.error = f"Rejected: {data.reason}"

    await db.commit()
    await db.refresh(plan)

    return _plan_to_response(plan)


@router.post("/{plan_id}/cancel", response_model=PlanResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def cancel_plan(
    request: Request,
    response: Response,
    session_id: UUID,
    plan_id: UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> PlanResponse:
    """Cancel an executing plan."""
    plan = await db.get(ExecutionPlan, plan_id)

    if not plan or str(plan.session_id) != str(session_id):
        raise HTTPException(status_code=404, detail="Plan not found")

    # Verify session access
    session = await db.get(Session, session_id)
    if not session or session.owner_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    if plan.status not in ("approved", "executing", "paused"):
        raise HTTPException(
            status_code=400,
            detail=f"Plan cannot be cancelled (current status: {plan.status})",
        )

    plan.status = "cancelled"
    plan.error = "Cancelled by user"

    await db.commit()
    await db.refresh(plan)

    return _plan_to_response(plan)


@router.post("/{plan_id}/pause", response_model=PlanResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def pause_plan(
    request: Request,
    response: Response,
    session_id: UUID,
    plan_id: UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> PlanResponse:
    """Pause an executing plan."""
    plan = await db.get(ExecutionPlan, plan_id)

    if not plan or str(plan.session_id) != str(session_id):
        raise HTTPException(status_code=404, detail="Plan not found")

    # Verify session access
    session = await db.get(Session, session_id)
    if not session or session.owner_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    if plan.status != "executing":
        raise HTTPException(
            status_code=400,
            detail=f"Only executing plans can be paused (current status: {plan.status})",
        )

    plan.status = "paused"

    await db.commit()
    await db.refresh(plan)

    return _plan_to_response(plan)


@router.post("/{plan_id}/resume", response_model=PlanResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def resume_plan(
    request: Request,
    response: Response,
    session_id: UUID,
    plan_id: UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> PlanResponse:
    """Resume a paused plan."""
    plan = await db.get(ExecutionPlan, plan_id)

    if not plan or str(plan.session_id) != str(session_id):
        raise HTTPException(status_code=404, detail="Plan not found")

    # Verify session access
    session = await db.get(Session, session_id)
    if not session or session.owner_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    if plan.status != "paused":
        raise HTTPException(
            status_code=400,
            detail=f"Only paused plans can be resumed (current status: {plan.status})",
        )

    plan.status = "executing"

    await db.commit()
    await db.refresh(plan)

    return _plan_to_response(plan)


def _plan_to_response(plan: ExecutionPlan) -> PlanResponse:
    """Convert plan model to response."""
    steps = plan.steps or []

    return PlanResponse(
        id=plan.id,
        session_id=plan.session_id,
        agent_id=plan.agent_id,
        title=plan.title,
        description=plan.description,
        original_task=plan.original_task,
        steps=[
            PlanStepResponse(
                id=s.get("id", ""),
                description=s.get("description", ""),
                action_type=s.get("action_type", ""),
                action_params=s.get("action_params", {}),
                status=s.get("status", "pending"),
                result=s.get("result"),
                error=s.get("error"),
                can_rollback=s.get("can_rollback", False),
            )
            for s in steps
        ],
        current_step=plan.current_step,
        status=plan.status,
        confidence_score=plan.confidence_score,
        error=plan.error,
        created_at=plan.created_at.isoformat(),
        approved_at=plan.approved_at.isoformat() if plan.approved_at else None,
        approved_by=plan.approved_by,
        started_at=plan.started_at.isoformat() if plan.started_at else None,
        completed_at=plan.completed_at.isoformat() if plan.completed_at else None,
    )
