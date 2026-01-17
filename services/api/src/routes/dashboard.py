"""Dashboard routes for statistics and activity feed."""

from collections import defaultdict
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


class PodUsageDataPoint(BaseModel):
    """Per-pod usage data point for charts."""

    date: str
    tokens: int
    api_calls: int
    cost: float
    compute_minutes: float = 0.0  # Actual compute usage in minutes


class PodUsageSeries(BaseModel):
    """Usage series for a specific pod."""

    session_id: str
    session_name: str
    data: list[PodUsageDataPoint]
    color: str  # Hex color code for the chart


class UsageHistoryResponse(BaseModel):
    """Usage history response."""

    daily: list[UsageDataPoint]
    by_pod: list[PodUsageSeries]
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
    # Filter for token types only to get accurate token counts
    total_usage_result = await db.execute(
        select(
            func.coalesce(func.sum(UsageRecord.quantity), 0).label("tokens"),
            func.count(UsageRecord.id).label("calls"),
            func.coalesce(func.sum(UsageRecord.total_cost_cents), 0).label("cost_cents"),
        ).where(
            UsageRecord.user_id == user_id,
            UsageRecord.usage_type.in_(["tokens_input", "tokens_output"]),
        )
    )
    total_usage = total_usage_result.one()

    month_usage_result = await db.execute(
        select(
            func.coalesce(func.sum(UsageRecord.quantity), 0).label("tokens"),
            func.count(UsageRecord.id).label("calls"),
            func.coalesce(func.sum(UsageRecord.total_cost_cents), 0).label("cost_cents"),
        ).where(
            UsageRecord.user_id == user_id,
            UsageRecord.usage_type.in_(["tokens_input", "tokens_output"]),
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

        # Get session usage (filter for token types only)
        session_usage_result = await db.execute(
            select(
                func.coalesce(func.sum(UsageRecord.quantity), 0).label("tokens"),
                func.coalesce(func.sum(UsageRecord.total_cost_cents), 0).label("cost_cents"),
            ).where(
                UsageRecord.session_id == session.id,
                UsageRecord.usage_type.in_(["tokens_input", "tokens_output"]),
            )
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

    # PERFORMANCE: Batch fetch agents for all sessions to avoid N+1 queries
    # Instead of querying agents per session, fetch all at once
    session_ids = [s.id for s in sessions]
    if session_ids:
        # Use a subquery to get top 5 recent agents per session
        # This is a single query instead of N queries

        # Fetch recent agents grouped by session
        agents_result = await db.execute(
            select(Agent)
            .where(Agent.session_id.in_(session_ids))
            .order_by(Agent.session_id, Agent.updated_at.desc())
        )
        all_agents = agents_result.scalars().all()

        # Group agents by session_id, keeping only top 5 per session
        agents_by_session: dict[str, list[Agent]] = defaultdict(list)
        for agent in all_agents:
            if len(agents_by_session[agent.session_id]) < 5:
                agents_by_session[agent.session_id].append(agent)
    else:
        agents_by_session = {}

    # Build session name lookup for agent items
    {s.id: s.name for s in sessions}

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

        # Use pre-fetched agents for this session
        for agent in agents_by_session.get(session.id, []):
            items.append(
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

    # Get daily usage aggregates (total across all pods)
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

    # Get per-pod token usage aggregates
    pod_usage_result = await db.execute(
        select(
            func.date(UsageRecord.created_at).label("date"),
            UsageRecord.session_id,
            Session.name.label("session_name"),
            func.coalesce(func.sum(UsageRecord.quantity), 0).label("tokens"),
            func.count(UsageRecord.id).label("calls"),
            func.coalesce(func.sum(UsageRecord.total_cost_cents), 0).label("cost_cents"),
        )
        .join(Session, UsageRecord.session_id == Session.id, isouter=False)
        .where(
            UsageRecord.user_id == user_id,
            UsageRecord.created_at >= period_start,
            UsageRecord.created_at <= period_end,
            UsageRecord.session_id.isnot(None),
            UsageRecord.usage_type.in_(["tokens_input", "tokens_output"]),
        )
        .group_by(func.date(UsageRecord.created_at), UsageRecord.session_id, Session.name)
        .order_by(func.date(UsageRecord.created_at), UsageRecord.session_id)
    )
    pod_usage_rows = pod_usage_result.all()

    # Get per-pod compute usage aggregates
    compute_usage_result = await db.execute(
        select(
            func.date(UsageRecord.created_at).label("date"),
            UsageRecord.session_id,
            Session.name.label("session_name"),
            func.coalesce(func.sum(UsageRecord.quantity), 0).label("compute_seconds"),
        )
        .join(Session, UsageRecord.session_id == Session.id, isouter=False)
        .where(
            UsageRecord.user_id == user_id,
            UsageRecord.created_at >= period_start,
            UsageRecord.created_at <= period_end,
            UsageRecord.session_id.isnot(None),
            UsageRecord.usage_type == "compute_seconds",
        )
        .group_by(func.date(UsageRecord.created_at), UsageRecord.session_id, Session.name)
        .order_by(func.date(UsageRecord.created_at), UsageRecord.session_id)
    )
    compute_usage_rows = compute_usage_result.all()

    # Organize by pod
    pods_data: dict[str, dict[str, Any]] = {}

    # Add token usage data
    for row in pod_usage_rows:
        if row.session_id not in pods_data:
            pods_data[row.session_id] = {
                "session_id": row.session_id,
                "session_name": row.session_name or "Unnamed Pod",
                "data_map": {},
            }
        date_str = row.date.isoformat()
        if date_str not in pods_data[row.session_id]["data_map"]:
            pods_data[row.session_id]["data_map"][date_str] = {
                "tokens": 0,
                "api_calls": 0,
                "cost": 0.0,
                "compute_minutes": 0.0,
            }
        pods_data[row.session_id]["data_map"][date_str]["tokens"] = int(row.tokens)
        pods_data[row.session_id]["data_map"][date_str]["api_calls"] = int(row.calls)
        pods_data[row.session_id]["data_map"][date_str]["cost"] = float(row.cost_cents) / 100.0

    # Add compute usage data
    for row in compute_usage_rows:
        if row.session_id not in pods_data:
            pods_data[row.session_id] = {
                "session_id": row.session_id,
                "session_name": row.session_name or "Unnamed Pod",
                "data_map": {},
            }
        date_str = row.date.isoformat()
        if date_str not in pods_data[row.session_id]["data_map"]:
            pods_data[row.session_id]["data_map"][date_str] = {
                "tokens": 0,
                "api_calls": 0,
                "cost": 0.0,
                "compute_minutes": 0.0,
            }
        # Convert seconds to minutes
        pods_data[row.session_id]["data_map"][date_str]["compute_minutes"] = round(
            float(row.compute_seconds) / 60.0, 1
        )

    # Generate colors for pods (using a predefined color palette)
    color_palette = [
        "#3b82f6",  # Blue
        "#8b5cf6",  # Purple
        "#ec4899",  # Pink
        "#f59e0b",  # Amber
        "#10b981",  # Green
        "#06b6d4",  # Cyan
        "#f97316",  # Orange
        "#6366f1",  # Indigo
        "#14b8a6",  # Teal
        "#84cc16",  # Lime
    ]

    # Build per-pod series with complete date range
    by_pod: list[PodUsageSeries] = []
    for idx, (session_id, pod_info) in enumerate(pods_data.items()):
        data_map = pod_info["data_map"]
        pod_data: list[PodUsageDataPoint] = []

        current_date = period_start.date()
        while current_date <= end_date:
            date_str = current_date.isoformat()
            if date_str in data_map:
                point_data = data_map[date_str]
                pod_data.append(
                    PodUsageDataPoint(
                        date=date_str,
                        tokens=point_data["tokens"],
                        api_calls=point_data["api_calls"],
                        cost=point_data["cost"],
                        compute_minutes=point_data.get("compute_minutes", 0.0),
                    )
                )
            else:
                pod_data.append(
                    PodUsageDataPoint(
                        date=date_str,
                        tokens=0,
                        api_calls=0,
                        cost=0.0,
                        compute_minutes=0.0,
                    )
                )
            current_date += timedelta(days=1)

        by_pod.append(
            PodUsageSeries(
                session_id=session_id,
                session_name=pod_info["session_name"],
                data=pod_data,
                color=color_palette[idx % len(color_palette)],
            )
        )

    return UsageHistoryResponse(
        daily=daily,
        by_pod=by_pod,
        period_start=period_start.isoformat(),
        period_end=period_end.isoformat(),
    )
