"""Dashboard routes for statistics and activity feed."""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.connection import get_db
from src.database.models import Agent, Session, UsageRecord
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

logger = structlog.get_logger()

router = APIRouter()

# Type alias for database session dependency
DbSession = Annotated[AsyncSession, Depends(get_db)]


# ============================================================================
# Response Models
# ============================================================================


class UsageStats(BaseModel):
    """Usage statistics."""

    total_tokens_used: int
    total_api_calls: int
    total_cost: float
    tokens_this_month: int
    api_calls_this_month: int
    cost_this_month: float


class PodStats(BaseModel):
    """Pod (session) statistics."""

    session_id: str
    session_name: str
    active_agents: int
    total_tokens: int
    total_cost: float
    last_activity: str


class DashboardStats(BaseModel):
    """Dashboard statistics response."""

    usage: UsageStats
    pods: list[PodStats]
    total_pods: int
    active_pods: int
    total_agents: int


class ActivityItem(BaseModel):
    """Activity feed item."""

    id: str
    type: str
    session_id: str
    session_name: str
    agent_id: str | None = None
    agent_name: str | None = None
    message: str
    metadata: dict[str, Any] | None = None
    created_at: str


class ActivityFeedResponse(BaseModel):
    """Activity feed response."""

    items: list[ActivityItem]
    has_more: bool


class UsageDataPoint(BaseModel):
    """Usage data point for charts."""

    date: str
    tokens: int
    api_calls: int
    cost: float


class UsageHistoryResponse(BaseModel):
    """Usage history response."""

    daily: list[UsageDataPoint]
    period_start: str
    period_end: str


# ============================================================================
# Routes
# ============================================================================


@router.get("/stats", response_model=DashboardStats)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_dashboard_stats(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> DashboardStats:
    """Get dashboard statistics for the current user."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Get start of current month
    now = datetime.now(UTC)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    # Get all user's sessions (not archived)
    sessions_result = await db.execute(
        select(Session).where(
            Session.owner_id == user_id,
            Session.archived_at.is_(None),
        )
    )
    sessions = sessions_result.scalars().all()

    # Get total agents count
    agents_result = await db.execute(
        select(func.count(Agent.id))
        .join(Session, Agent.session_id == Session.id)
        .where(Session.owner_id == user_id)
    )
    total_agents = agents_result.scalar() or 0

    # Get usage records for all-time and this month
    # UsageRecord: quantity (amount), usage_type (tokens_input/output/etc), total_cost_cents
    total_usage_result = await db.execute(
        select(
            func.coalesce(func.sum(UsageRecord.quantity), 0).label("tokens"),
            func.count(UsageRecord.id).label("calls"),
            func.coalesce(func.sum(UsageRecord.total_cost_cents), 0).label("cost_cents"),
        ).where(UsageRecord.user_id == user_id)
    )
    total_usage = total_usage_result.one()

    month_usage_result = await db.execute(
        select(
            func.coalesce(func.sum(UsageRecord.quantity), 0).label("tokens"),
            func.count(UsageRecord.id).label("calls"),
            func.coalesce(func.sum(UsageRecord.total_cost_cents), 0).label("cost_cents"),
        ).where(
            UsageRecord.user_id == user_id,
            UsageRecord.created_at >= month_start,
        )
    )
    month_usage = month_usage_result.one()

    # Build pod stats
    pods: list[PodStats] = []
    active_pods = 0

    for session in sessions:
        # Count active agents for this session
        agents_count_result = await db.execute(
            select(func.count(Agent.id)).where(
                Agent.session_id == session.id,
                Agent.status == "active",
            )
        )
        active_agents = agents_count_result.scalar() or 0

        # Get session usage
        session_usage_result = await db.execute(
            select(
                func.coalesce(func.sum(UsageRecord.quantity), 0).label("tokens"),
                func.coalesce(func.sum(UsageRecord.total_cost_cents), 0).label("cost_cents"),
            ).where(UsageRecord.session_id == session.id)
        )
        session_usage = session_usage_result.one()

        if session.status == "active":
            active_pods += 1

        pods.append(
            PodStats(
                session_id=session.id,
                session_name=session.name,
                active_agents=active_agents,
                total_tokens=int(session_usage.tokens),
                total_cost=float(session_usage.cost_cents) / 100.0,
                last_activity=session.updated_at.isoformat(),
            )
        )

    # Sort pods by last activity
    pods.sort(key=lambda p: p.last_activity, reverse=True)

    return DashboardStats(
        usage=UsageStats(
            total_tokens_used=int(total_usage.tokens),
            total_api_calls=int(total_usage.calls),
            total_cost=float(total_usage.cost_cents) / 100.0,
            tokens_this_month=int(month_usage.tokens),
            api_calls_this_month=int(month_usage.calls),
            cost_this_month=float(month_usage.cost_cents) / 100.0,
        ),
        pods=pods[:10],  # Return top 10 most recent
        total_pods=len(sessions),
        active_pods=active_pods,
        total_agents=total_agents,
    )


@router.get("/activity", response_model=ActivityFeedResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_activity_feed(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    limit: int = Query(default=20, ge=1, le=100),
) -> ActivityFeedResponse:
    """Get recent activity feed for the current user."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Get recent sessions with activity
    sessions_result = await db.execute(
        select(Session)
        .where(Session.owner_id == user_id)
        .order_by(Session.updated_at.desc())
        .limit(limit)
    )
    sessions = sessions_result.scalars().all()

    items: list[ActivityItem] = []

    for session in sessions:
        # Add session creation/update activity
        items.append(
            ActivityItem(
                id=f"session-{session.id}",
                type="session_created"
                if session.created_at == session.updated_at
                else "session_started",
                session_id=session.id,
                session_name=session.name,
                message=f"Session '{session.name}' was "
                f"{'created' if session.created_at == session.updated_at else 'updated'}",
                created_at=session.updated_at.isoformat(),
            )
        )

        # Get recent agents for this session
        agents_result = await db.execute(
            select(Agent)
            .where(Agent.session_id == session.id)
            .order_by(Agent.updated_at.desc())
            .limit(5)
        )
        agents = agents_result.scalars().all()

        for agent in agents:
            items.append(  # noqa: PERF401
                ActivityItem(
                    id=f"agent-{agent.id}",
                    type="agent_created"
                    if agent.created_at == agent.updated_at
                    else "agent_message",
                    session_id=session.id,
                    session_name=session.name,
                    agent_id=agent.id,
                    agent_name=agent.name,
                    message=f"Agent '{agent.name}' was "
                    f"{'created' if agent.created_at == agent.updated_at else 'active'}",
                    created_at=agent.updated_at.isoformat(),
                )
            )

    # Sort by created_at descending and limit
    items.sort(key=lambda x: x.created_at, reverse=True)
    items = items[:limit]

    return ActivityFeedResponse(
        items=items,
        has_more=len(items) == limit,
    )


@router.get("/usage-history", response_model=UsageHistoryResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_usage_history(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    days: int = Query(default=30, ge=1, le=365),
) -> UsageHistoryResponse:
    """Get usage history for charts."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    now = datetime.now(UTC)
    period_end = now.replace(hour=23, minute=59, second=59, microsecond=999999)
    period_start = (now - timedelta(days=days)).replace(hour=0, minute=0, second=0, microsecond=0)

    # Get daily usage aggregates
    daily_usage_result = await db.execute(
        select(
            func.date(UsageRecord.created_at).label("date"),
            func.coalesce(func.sum(UsageRecord.quantity), 0).label("tokens"),
            func.count(UsageRecord.id).label("calls"),
            func.coalesce(func.sum(UsageRecord.total_cost_cents), 0).label("cost_cents"),
        )
        .where(
            UsageRecord.user_id == user_id,
            UsageRecord.created_at >= period_start,
            UsageRecord.created_at <= period_end,
        )
        .group_by(func.date(UsageRecord.created_at))
        .order_by(func.date(UsageRecord.created_at))
    )
    daily_usage = daily_usage_result.all()

    # Build complete date range with zeros for missing days
    date_map = {row.date.isoformat(): row for row in daily_usage}
    daily: list[UsageDataPoint] = []

    current_date = period_start.date()
    end_date = period_end.date()

    while current_date <= end_date:
        date_str = current_date.isoformat()
        if date_str in date_map:
            row = date_map[date_str]
            daily.append(
                UsageDataPoint(
                    date=date_str,
                    tokens=int(row.tokens),
                    api_calls=int(row.calls),
                    cost=float(row.cost_cents) / 100.0,
                )
            )
        else:
            daily.append(
                UsageDataPoint(
                    date=date_str,
                    tokens=0,
                    api_calls=0,
                    cost=0.0,
                )
            )
        current_date += timedelta(days=1)

    return UsageHistoryResponse(
        daily=daily,
        period_start=period_start.isoformat(),
        period_end=period_end.isoformat(),
    )
