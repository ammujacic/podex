"""API routes for productivity metrics and dashboard."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import ProductivityMetric
from src.middleware.auth import get_current_user

router = APIRouter(prefix="/productivity", tags=["productivity"])


# ============================================================================
# Response Models
# ============================================================================


class DailyMetricResponse(BaseModel):
    """Single day productivity metrics."""

    date: str
    lines_written: int
    lines_deleted: int
    files_modified: int
    commits_count: int
    agent_messages_sent: int
    agent_suggestions_accepted: int
    agent_suggestions_rejected: int
    agent_tasks_completed: int
    active_session_minutes: int
    coding_minutes: int
    estimated_time_saved_minutes: int
    language_breakdown: dict[str, Any] | None
    agent_usage_breakdown: dict[str, Any] | None
    current_streak_days: int
    longest_streak_days: int


class ProductivitySummary(BaseModel):
    """Summary of productivity metrics over a period."""

    period_start: str
    period_end: str
    total_days: int
    active_days: int

    # Code totals
    total_lines_written: int
    total_lines_deleted: int
    net_lines: int
    total_files_modified: int
    total_commits: int

    # Agent totals
    total_agent_messages: int
    total_suggestions_accepted: int
    total_suggestions_rejected: int
    acceptance_rate: float
    total_tasks_completed: int

    # Time totals
    total_active_minutes: int
    total_coding_minutes: int
    total_time_saved_minutes: int
    time_saved_hours: float

    # Averages
    avg_lines_per_day: float
    avg_coding_minutes_per_day: float
    avg_agent_messages_per_day: float

    # Streaks
    current_streak: int
    longest_streak: int

    # Breakdowns
    top_languages: dict[str, int]
    top_agent_usage: dict[str, int]


class TrendDataPoint(BaseModel):
    """A single data point in a trend."""

    date: str
    value: int | float


class ProductivityTrends(BaseModel):
    """Trends over time for various metrics."""

    dates: list[str]
    lines_written: list[int]
    coding_minutes: list[int]
    agent_messages: list[int]
    time_saved: list[int]
    commits: list[int]


class TimeSavedResponse(BaseModel):
    """Detailed time saved analysis."""

    total_minutes_saved: int
    hours_saved: float
    days_saved: float  # Assuming 8-hour workday

    # Breakdown by type
    by_code_generation: int
    by_code_review: int
    by_debugging: int
    by_documentation: int
    by_other: int

    # Comparison
    avg_minutes_per_day: float
    highest_single_day: int
    highest_single_day_date: str | None


class AgentUsageResponse(BaseModel):
    """Detailed agent usage statistics."""

    total_messages: int
    total_tasks: int
    acceptance_rate: float
    rejection_rate: float

    # By agent type
    by_agent_type: dict[str, int]

    # Most productive hours
    peak_usage_hours: list[int]

    # Recent activity
    last_7_days: int
    last_30_days: int


# ============================================================================
# Routes
# ============================================================================


@router.get("/summary", response_model=ProductivitySummary)
async def get_productivity_summary(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> ProductivitySummary:
    """Get productivity summary for the specified period."""
    user_id = user["id"]
    end_date = datetime.now(UTC)
    start_date = end_date - timedelta(days=days)

    # Fetch metrics for the period
    query = (
        select(ProductivityMetric)
        .where(
            ProductivityMetric.user_id == user_id,
            ProductivityMetric.date >= start_date,
            ProductivityMetric.date <= end_date,
        )
        .order_by(ProductivityMetric.date.desc())
    )

    result = await db.execute(query)
    metrics = result.scalars().all()

    # Calculate totals
    total_lines_written = sum(m.lines_written for m in metrics)
    total_lines_deleted = sum(m.lines_deleted for m in metrics)
    total_files_modified = sum(m.files_modified for m in metrics)
    total_commits = sum(m.commits_count for m in metrics)
    total_agent_messages = sum(m.agent_messages_sent for m in metrics)
    total_suggestions_accepted = sum(m.agent_suggestions_accepted for m in metrics)
    total_suggestions_rejected = sum(m.agent_suggestions_rejected for m in metrics)
    total_tasks_completed = sum(m.agent_tasks_completed for m in metrics)
    total_active_minutes = sum(m.active_session_minutes for m in metrics)
    total_coding_minutes = sum(m.coding_minutes for m in metrics)
    total_time_saved = sum(m.estimated_time_saved_minutes for m in metrics)

    # Calculate acceptance rate
    total_suggestions = total_suggestions_accepted + total_suggestions_rejected
    acceptance_rate = (
        (total_suggestions_accepted / total_suggestions * 100) if total_suggestions > 0 else 0.0
    )

    # Active days count
    active_days = len([m for m in metrics if m.coding_minutes > 0])

    # Calculate averages
    avg_lines_per_day = total_lines_written / max(active_days, 1)
    avg_coding_per_day = total_coding_minutes / max(active_days, 1)
    avg_agent_per_day = total_agent_messages / max(active_days, 1)

    # Get streaks
    current_streak = metrics[0].current_streak_days if metrics else 0
    longest_streak = max((m.longest_streak_days for m in metrics), default=0)

    # Aggregate language breakdown
    top_languages: dict[str, int] = {}
    for m in metrics:
        if m.language_breakdown:
            for lang, lines in m.language_breakdown.items():
                top_languages[lang] = top_languages.get(lang, 0) + lines
    # Sort and take top 5
    top_languages = dict(sorted(top_languages.items(), key=lambda x: x[1], reverse=True)[:5])

    # Aggregate agent usage breakdown
    top_agent_usage: dict[str, int] = {}
    for m in metrics:
        if m.agent_usage_breakdown:
            for agent, count in m.agent_usage_breakdown.items():
                top_agent_usage[agent] = top_agent_usage.get(agent, 0) + count
    # Sort and take top 5
    top_agent_usage = dict(sorted(top_agent_usage.items(), key=lambda x: x[1], reverse=True)[:5])

    return ProductivitySummary(
        period_start=start_date.isoformat(),
        period_end=end_date.isoformat(),
        total_days=days,
        active_days=active_days,
        total_lines_written=total_lines_written,
        total_lines_deleted=total_lines_deleted,
        net_lines=total_lines_written - total_lines_deleted,
        total_files_modified=total_files_modified,
        total_commits=total_commits,
        total_agent_messages=total_agent_messages,
        total_suggestions_accepted=total_suggestions_accepted,
        total_suggestions_rejected=total_suggestions_rejected,
        acceptance_rate=round(acceptance_rate, 1),
        total_tasks_completed=total_tasks_completed,
        total_active_minutes=total_active_minutes,
        total_coding_minutes=total_coding_minutes,
        total_time_saved_minutes=total_time_saved,
        time_saved_hours=round(total_time_saved / 60, 1),
        avg_lines_per_day=round(avg_lines_per_day, 1),
        avg_coding_minutes_per_day=round(avg_coding_per_day, 1),
        avg_agent_messages_per_day=round(avg_agent_per_day, 1),
        current_streak=current_streak,
        longest_streak=longest_streak,
        top_languages=top_languages,
        top_agent_usage=top_agent_usage,
    )


@router.get("/daily", response_model=list[DailyMetricResponse])
async def get_daily_metrics(
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    days: int = Query(30, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> list[DailyMetricResponse]:
    """Get daily productivity metrics."""
    user_id = user["id"]

    end_dt = datetime.fromisoformat(end_date) if end_date else datetime.now(UTC)
    start_dt = datetime.fromisoformat(start_date) if start_date else end_dt - timedelta(days=days)

    query = (
        select(ProductivityMetric)
        .where(
            ProductivityMetric.user_id == user_id,
            ProductivityMetric.date >= start_dt,
            ProductivityMetric.date <= end_dt,
        )
        .order_by(ProductivityMetric.date)
    )

    result = await db.execute(query)
    metrics = result.scalars().all()

    return [
        DailyMetricResponse(
            date=m.date.isoformat(),
            lines_written=m.lines_written,
            lines_deleted=m.lines_deleted,
            files_modified=m.files_modified,
            commits_count=m.commits_count,
            agent_messages_sent=m.agent_messages_sent,
            agent_suggestions_accepted=m.agent_suggestions_accepted,
            agent_suggestions_rejected=m.agent_suggestions_rejected,
            agent_tasks_completed=m.agent_tasks_completed,
            active_session_minutes=m.active_session_minutes,
            coding_minutes=m.coding_minutes,
            estimated_time_saved_minutes=m.estimated_time_saved_minutes,
            language_breakdown=m.language_breakdown,
            agent_usage_breakdown=m.agent_usage_breakdown,
            current_streak_days=m.current_streak_days,
            longest_streak_days=m.longest_streak_days,
        )
        for m in metrics
    ]


@router.get("/trends", response_model=ProductivityTrends)
async def get_productivity_trends(
    days: int = Query(30, ge=7, le=90),
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> ProductivityTrends:
    """Get productivity trends for charts."""
    user_id = user["id"]
    end_date = datetime.now(UTC)
    start_date = end_date - timedelta(days=days)

    query = (
        select(ProductivityMetric)
        .where(
            ProductivityMetric.user_id == user_id,
            ProductivityMetric.date >= start_date,
            ProductivityMetric.date <= end_date,
        )
        .order_by(ProductivityMetric.date)
    )

    result = await db.execute(query)
    metrics = result.scalars().all()

    # Create date -> metric mapping
    metric_map = {m.date.strftime("%Y-%m-%d"): m for m in metrics}

    # Fill in all dates
    dates = []
    lines_written = []
    coding_minutes = []
    agent_messages = []
    time_saved = []
    commits = []

    current = start_date
    while current <= end_date:
        date_str = current.strftime("%Y-%m-%d")
        dates.append(date_str)

        m = metric_map.get(date_str)
        lines_written.append(m.lines_written if m else 0)
        coding_minutes.append(m.coding_minutes if m else 0)
        agent_messages.append(m.agent_messages_sent if m else 0)
        time_saved.append(m.estimated_time_saved_minutes if m else 0)
        commits.append(m.commits_count if m else 0)

        current += timedelta(days=1)

    return ProductivityTrends(
        dates=dates,
        lines_written=lines_written,
        coding_minutes=coding_minutes,
        agent_messages=agent_messages,
        time_saved=time_saved,
        commits=commits,
    )


@router.get("/time-saved", response_model=TimeSavedResponse)
async def get_time_saved(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> TimeSavedResponse:
    """Get detailed time saved analysis."""
    user_id = user["id"]
    end_date = datetime.now(UTC)
    start_date = end_date - timedelta(days=days)

    query = (
        select(ProductivityMetric)
        .where(
            ProductivityMetric.user_id == user_id,
            ProductivityMetric.date >= start_date,
            ProductivityMetric.date <= end_date,
        )
        .order_by(ProductivityMetric.date)
    )

    result = await db.execute(query)
    metrics = result.scalars().all()

    total_minutes = sum(m.estimated_time_saved_minutes for m in metrics)
    active_days = len([m for m in metrics if m.estimated_time_saved_minutes > 0])

    # Find highest single day
    highest_day = max(metrics, key=lambda m: m.estimated_time_saved_minutes, default=None)

    # Estimate breakdown (simplified - in production would be more sophisticated)
    by_code_gen = int(total_minutes * 0.4)
    by_review = int(total_minutes * 0.25)
    by_debug = int(total_minutes * 0.2)
    by_docs = int(total_minutes * 0.1)
    by_other = total_minutes - by_code_gen - by_review - by_debug - by_docs

    return TimeSavedResponse(
        total_minutes_saved=total_minutes,
        hours_saved=round(total_minutes / 60, 1),
        days_saved=round(total_minutes / 480, 2),  # 8-hour day
        by_code_generation=by_code_gen,
        by_code_review=by_review,
        by_debugging=by_debug,
        by_documentation=by_docs,
        by_other=by_other,
        avg_minutes_per_day=round(total_minutes / max(active_days, 1), 1),
        highest_single_day=highest_day.estimated_time_saved_minutes if highest_day else 0,
        highest_single_day_date=highest_day.date.isoformat() if highest_day else None,
    )


@router.get("/agent-usage", response_model=AgentUsageResponse)
async def get_agent_usage(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> AgentUsageResponse:
    """Get detailed agent usage statistics."""
    user_id = user["id"]
    end_date = datetime.now(UTC)
    start_date = end_date - timedelta(days=days)
    last_7_date = end_date - timedelta(days=7)

    query = select(ProductivityMetric).where(
        ProductivityMetric.user_id == user_id,
        ProductivityMetric.date >= start_date,
        ProductivityMetric.date <= end_date,
    )

    result = await db.execute(query)
    metrics = result.scalars().all()

    total_messages = sum(m.agent_messages_sent for m in metrics)
    total_tasks = sum(m.agent_tasks_completed for m in metrics)
    total_accepted = sum(m.agent_suggestions_accepted for m in metrics)
    total_rejected = sum(m.agent_suggestions_rejected for m in metrics)
    total_suggestions = total_accepted + total_rejected

    acceptance_rate = (total_accepted / total_suggestions * 100) if total_suggestions > 0 else 0.0
    rejection_rate = (total_rejected / total_suggestions * 100) if total_suggestions > 0 else 0.0

    # Aggregate by agent type
    by_agent_type: dict[str, int] = {}
    for m in metrics:
        if m.agent_usage_breakdown:
            for agent, count in m.agent_usage_breakdown.items():
                by_agent_type[agent] = by_agent_type.get(agent, 0) + count

    # Last 7 and 30 days
    last_7_days = sum(m.agent_messages_sent for m in metrics if m.date >= last_7_date)
    last_30_days = total_messages

    return AgentUsageResponse(
        total_messages=total_messages,
        total_tasks=total_tasks,
        acceptance_rate=round(acceptance_rate, 1),
        rejection_rate=round(rejection_rate, 1),
        by_agent_type=by_agent_type,
        peak_usage_hours=[9, 10, 11, 14, 15, 16],  # Simplified - would be calculated
        last_7_days=last_7_days,
        last_30_days=last_30_days,
    )
