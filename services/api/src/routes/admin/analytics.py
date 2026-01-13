"""Admin analytics and dashboard routes."""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import case, extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import (
    CreditTransaction,
    Session,
    SubscriptionPlan,
    UsageRecord,
    User,
    UserSubscription,
)
from src.middleware.admin import require_admin
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

logger = structlog.get_logger()

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db)]


# ==================== Pydantic Models ====================


class DashboardOverview(BaseModel):
    """Dashboard overview metrics."""

    # Users
    total_users: int
    active_users_30d: int
    new_users_30d: int
    user_growth_percent: float

    # Sessions
    total_sessions: int
    active_sessions: int
    sessions_today: int

    # Revenue
    mrr_cents: int
    arr_cents: int
    mrr_growth_percent: float

    # Usage
    total_tokens_30d: int
    total_compute_hours_30d: float
    total_storage_gb: float

    # Subscriptions
    paying_customers: int
    conversion_rate: float
    churn_rate_30d: float


class RevenueMetrics(BaseModel):
    """Revenue analytics metrics."""

    mrr_cents: int
    arr_cents: int
    mrr_previous_cents: int
    mrr_growth_percent: float

    # By source
    subscription_revenue_cents: int
    credit_revenue_cents: int
    overage_revenue_cents: int

    # By plan
    revenue_by_plan: list[dict[str, Any]]

    # Net revenue retention
    nrr_percent: float

    # Average revenue per user
    arpu_cents: int

    # Lifetime value (estimated)
    ltv_cents: int


class UsageMetrics(BaseModel):
    """Usage analytics metrics."""

    # Token usage
    total_tokens: int
    input_tokens: int
    output_tokens: int
    tokens_by_model: list[dict[str, Any]]
    tokens_by_provider: list[dict[str, Any]]

    # Compute usage
    total_compute_hours: float
    compute_by_tier: list[dict[str, Any]]

    # Storage
    total_storage_gb: float

    # Daily trends
    daily_usage: list[dict[str, Any]]


class CostMetrics(BaseModel):
    """Cost vs revenue metrics."""

    # Revenue
    gross_revenue_cents: int

    # Costs (estimated based on usage)
    llm_cost_cents: int
    compute_cost_cents: int
    storage_cost_cents: int
    total_cost_cents: int

    # Margins
    gross_margin_percent: float
    llm_margin_percent: float
    compute_margin_percent: float

    # Breakdown by type
    cost_breakdown: list[dict[str, Any]]
    revenue_breakdown: list[dict[str, Any]]


class UserGrowthMetrics(BaseModel):
    """User growth and retention metrics."""

    # Signups
    daily_signups: list[dict[str, Any]]
    total_signups_30d: int
    signup_growth_percent: float

    # Retention
    day_1_retention: float
    day_7_retention: float
    day_30_retention: float

    # Churn
    churned_users_30d: int
    churn_rate: float

    # Activation
    activation_rate: float  # % users who created a session


class SessionMetrics(BaseModel):
    """Session analytics metrics."""

    total_sessions: int
    active_sessions: int
    avg_session_duration_minutes: float
    sessions_by_template: list[dict[str, Any]]
    sessions_by_hardware: list[dict[str, Any]]
    daily_sessions: list[dict[str, Any]]


class TimeSeriesPoint(BaseModel):
    """Single point in a time series."""

    date: str
    value: float | int


# ==================== Helper Functions ====================


def get_date_range(days: int) -> tuple[datetime, datetime]:
    """Get date range for queries."""
    end_date = datetime.now(UTC)
    start_date = end_date - timedelta(days=days)
    return start_date, end_date


# ==================== Endpoints ====================


@router.get("/dashboard", response_model=DashboardOverview)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_dashboard_overview(
    request: Request,
    response: Response,
    db: DbSession,
) -> DashboardOverview:
    """Get dashboard overview metrics."""
    now = datetime.now(UTC)
    thirty_days_ago = now - timedelta(days=30)
    sixty_days_ago = now - timedelta(days=60)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Total users
    total_users_result = await db.execute(select(func.count()).select_from(User))
    total_users = total_users_result.scalar() or 0

    # Active users in last 30 days (users with sessions)
    active_users_result = await db.execute(
        select(func.count(func.distinct(Session.owner_id)))
        .select_from(Session)
        .where(Session.created_at >= thirty_days_ago)
    )
    active_users_30d = active_users_result.scalar() or 0

    # New users in last 30 days
    new_users_result = await db.execute(
        select(func.count()).select_from(User).where(User.created_at >= thirty_days_ago)
    )
    new_users_30d = new_users_result.scalar() or 0

    # User growth (compare to previous 30 days)
    prev_users_result = await db.execute(
        select(func.count())
        .select_from(User)
        .where(User.created_at >= sixty_days_ago)
        .where(User.created_at < thirty_days_ago)
    )
    prev_new_users = prev_users_result.scalar() or 1  # Avoid division by zero
    user_growth_percent = (
        ((new_users_30d - prev_new_users) / prev_new_users) * 100 if prev_new_users > 0 else 0
    )

    # Sessions
    total_sessions_result = await db.execute(select(func.count()).select_from(Session))
    total_sessions = total_sessions_result.scalar() or 0

    active_sessions_result = await db.execute(
        select(func.count()).select_from(Session).where(Session.status == "running")
    )
    active_sessions = active_sessions_result.scalar() or 0

    sessions_today_result = await db.execute(
        select(func.count()).select_from(Session).where(Session.created_at >= today_start)
    )
    sessions_today = sessions_today_result.scalar() or 0

    # MRR (sum of active subscriptions' monthly price)
    mrr_result = await db.execute(
        select(func.coalesce(func.sum(SubscriptionPlan.price_monthly_cents), 0))
        .select_from(UserSubscription)
        .join(SubscriptionPlan, UserSubscription.plan_id == SubscriptionPlan.id)
        .where(UserSubscription.status.in_(["active", "trialing"]))
    )
    mrr_cents = mrr_result.scalar() or 0
    arr_cents = mrr_cents * 12

    # MRR growth (simplified - count new vs cancelled subscriptions)
    mrr_growth_percent = 0.0  # Would need historical data for accurate calculation

    # Usage in last 30 days - tokens stored as tokens_input/tokens_output
    tokens_result = await db.execute(
        select(func.coalesce(func.sum(UsageRecord.quantity), 0))
        .select_from(UsageRecord)
        .where(UsageRecord.usage_type.in_(["tokens_input", "tokens_output"]))
        .where(UsageRecord.created_at >= thirty_days_ago)
    )
    total_tokens_30d = tokens_result.scalar() or 0

    compute_result = await db.execute(
        select(func.coalesce(func.sum(UsageRecord.quantity), 0))
        .select_from(UsageRecord)
        .where(UsageRecord.usage_type == "compute_seconds")
        .where(UsageRecord.created_at >= thirty_days_ago)
    )
    compute_seconds = compute_result.scalar() or 0
    total_compute_hours_30d = compute_seconds / 3600

    # Storage - stored as storage_gb with quantity in bytes
    storage_result = await db.execute(
        select(func.coalesce(func.sum(UsageRecord.quantity), 0))
        .select_from(UsageRecord)
        .where(UsageRecord.usage_type == "storage_gb")
    )
    storage_bytes = storage_result.scalar() or 0
    total_storage_gb = storage_bytes / (1024**3)

    # Paying customers
    paying_result = await db.execute(
        select(func.count(func.distinct(UserSubscription.user_id)))
        .select_from(UserSubscription)
        .join(SubscriptionPlan, UserSubscription.plan_id == SubscriptionPlan.id)
        .where(UserSubscription.status.in_(["active", "trialing"]))
        .where(SubscriptionPlan.price_monthly_cents > 0)
    )
    paying_customers = paying_result.scalar() or 0

    # Conversion rate
    conversion_rate = (paying_customers / total_users * 100) if total_users > 0 else 0

    # Churn rate (simplified)
    churn_rate_30d = 0.0

    return DashboardOverview(
        total_users=total_users,
        active_users_30d=active_users_30d,
        new_users_30d=new_users_30d,
        user_growth_percent=round(user_growth_percent, 2),
        total_sessions=total_sessions,
        active_sessions=active_sessions,
        sessions_today=sessions_today,
        mrr_cents=mrr_cents,
        arr_cents=arr_cents,
        mrr_growth_percent=round(mrr_growth_percent, 2),
        total_tokens_30d=total_tokens_30d,
        total_compute_hours_30d=round(total_compute_hours_30d, 2),
        total_storage_gb=round(total_storage_gb, 2),
        paying_customers=paying_customers,
        conversion_rate=round(conversion_rate, 2),
        churn_rate_30d=round(churn_rate_30d, 2),
    )


@router.get("/revenue", response_model=RevenueMetrics)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_revenue_analytics(
    request: Request,
    response: Response,
    db: DbSession,
    days: Annotated[int, Query(ge=7, le=365)] = 30,
) -> RevenueMetrics:
    """Get revenue analytics."""
    start_date, _end_date = get_date_range(days)
    start_date - timedelta(days=days)

    # Current MRR
    mrr_result = await db.execute(
        select(func.coalesce(func.sum(SubscriptionPlan.price_monthly_cents), 0))
        .select_from(UserSubscription)
        .join(SubscriptionPlan, UserSubscription.plan_id == SubscriptionPlan.id)
        .where(UserSubscription.status.in_(["active", "trialing"]))
    )
    mrr_cents = mrr_result.scalar() or 0
    arr_cents = mrr_cents * 12

    # Previous period MRR (approximated from historical subscriptions)
    mrr_previous_cents = mrr_cents  # Would need historical snapshots for accuracy
    mrr_growth_percent = 0.0

    # Revenue by source
    subscription_revenue_result = await db.execute(
        select(func.coalesce(func.sum(CreditTransaction.amount_cents), 0))
        .select_from(CreditTransaction)
        .where(CreditTransaction.transaction_type == "subscription_credit")
        .where(CreditTransaction.created_at >= start_date)
    )
    subscription_revenue_cents = abs(subscription_revenue_result.scalar() or 0)

    credit_revenue_result = await db.execute(
        select(func.coalesce(func.sum(CreditTransaction.amount_cents), 0))
        .select_from(CreditTransaction)
        .where(CreditTransaction.transaction_type == "purchase")
        .where(CreditTransaction.created_at >= start_date)
    )
    credit_revenue_cents = credit_revenue_result.scalar() or 0

    overage_revenue_result = await db.execute(
        select(func.coalesce(func.sum(UsageRecord.total_cost_cents), 0))
        .select_from(UsageRecord)
        .where(UsageRecord.is_overage == True)  # noqa: E712
        .where(UsageRecord.created_at >= start_date)
    )
    overage_revenue_cents = overage_revenue_result.scalar() or 0

    # Revenue by plan
    plan_revenue_result = await db.execute(
        select(
            SubscriptionPlan.name,
            SubscriptionPlan.slug,
            func.count(UserSubscription.id).label("subscribers"),
            func.sum(SubscriptionPlan.price_monthly_cents).label("mrr"),
        )
        .select_from(UserSubscription)
        .join(SubscriptionPlan, UserSubscription.plan_id == SubscriptionPlan.id)
        .where(UserSubscription.status.in_(["active", "trialing"]))
        .group_by(SubscriptionPlan.id)
        .order_by(func.sum(SubscriptionPlan.price_monthly_cents).desc())
    )
    revenue_by_plan = [
        {
            "plan": row.name,
            "slug": row.slug,
            "subscribers": row.subscribers,
            "mrr_cents": row.mrr or 0,
        }
        for row in plan_revenue_result
    ]

    # ARPU
    paying_users_result = await db.execute(
        select(func.count(func.distinct(UserSubscription.user_id)))
        .select_from(UserSubscription)
        .where(UserSubscription.status.in_(["active", "trialing"]))
    )
    paying_users = paying_users_result.scalar() or 1
    arpu_cents = mrr_cents // paying_users if paying_users > 0 else 0

    # LTV (simplified: ARPU * average lifetime in months, assuming 12 months)
    ltv_cents = arpu_cents * 12

    # NRR (would need historical data)
    nrr_percent = 100.0

    return RevenueMetrics(
        mrr_cents=mrr_cents,
        arr_cents=arr_cents,
        mrr_previous_cents=mrr_previous_cents,
        mrr_growth_percent=mrr_growth_percent,
        subscription_revenue_cents=subscription_revenue_cents,
        credit_revenue_cents=credit_revenue_cents,
        overage_revenue_cents=overage_revenue_cents,
        revenue_by_plan=revenue_by_plan,
        nrr_percent=nrr_percent,
        arpu_cents=arpu_cents,
        ltv_cents=ltv_cents,
    )


@router.get("/usage", response_model=UsageMetrics)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_usage_analytics(
    request: Request,
    response: Response,
    db: DbSession,
    days: Annotated[int, Query(ge=7, le=365)] = 30,
) -> UsageMetrics:
    """Get usage analytics."""
    start_date, _end_date = get_date_range(days)

    # Total tokens - records are stored as tokens_input and tokens_output
    tokens_result = await db.execute(
        select(
            func.coalesce(func.sum(UsageRecord.quantity), 0).label("total"),
            func.coalesce(
                func.sum(
                    case(
                        (UsageRecord.usage_type == "tokens_input", UsageRecord.quantity),
                        else_=0,
                    )
                ),
                0,
            ).label("input_tokens"),
            func.coalesce(
                func.sum(
                    case(
                        (UsageRecord.usage_type == "tokens_output", UsageRecord.quantity),
                        else_=0,
                    )
                ),
                0,
            ).label("output_tokens"),
        )
        .select_from(UsageRecord)
        .where(UsageRecord.usage_type.in_(["tokens_input", "tokens_output"]))
        .where(UsageRecord.created_at >= start_date)
    )
    tokens_row = tokens_result.one()
    total_tokens = tokens_row.total or 0
    input_tokens = tokens_row.input_tokens or 0
    output_tokens = tokens_row.output_tokens or 0

    # Tokens by model
    tokens_by_model_result = await db.execute(
        select(
            UsageRecord.model,
            func.sum(UsageRecord.quantity).label("tokens"),
        )
        .select_from(UsageRecord)
        .where(UsageRecord.usage_type.in_(["tokens_input", "tokens_output"]))
        .where(UsageRecord.created_at >= start_date)
        .where(UsageRecord.model.isnot(None))
        .group_by(UsageRecord.model)
        .order_by(func.sum(UsageRecord.quantity).desc())
        .limit(10)
    )
    tokens_by_model = [{"model": row.model, "tokens": row.tokens} for row in tokens_by_model_result]

    # Tokens by provider - derive from model name
    tokens_by_provider_result = await db.execute(
        select(
            case(
                (UsageRecord.model.like("claude%"), "anthropic"),
                (UsageRecord.model.like("gpt%"), "openai"),
                (UsageRecord.model.like("o1%"), "openai"),
                (UsageRecord.model.like("amazon%"), "bedrock"),
                else_="other",
            ).label("provider"),
            func.sum(UsageRecord.quantity).label("tokens"),
        )
        .select_from(UsageRecord)
        .where(UsageRecord.usage_type.in_(["tokens_input", "tokens_output"]))
        .where(UsageRecord.created_at >= start_date)
        .where(UsageRecord.model.isnot(None))
        .group_by("provider")
        .order_by(func.sum(UsageRecord.quantity).desc())
    )
    tokens_by_provider = [
        {"provider": row.provider, "tokens": row.tokens} for row in tokens_by_provider_result
    ]

    # Compute usage
    compute_result = await db.execute(
        select(func.coalesce(func.sum(UsageRecord.quantity), 0))
        .select_from(UsageRecord)
        .where(UsageRecord.usage_type == "compute_seconds")
        .where(UsageRecord.created_at >= start_date)
    )
    compute_seconds = compute_result.scalar() or 0
    total_compute_hours = compute_seconds / 3600

    # Compute by tier (ordered by most to least used, returned in minutes)
    compute_by_tier_result = await db.execute(
        select(
            UsageRecord.tier.label("tier"),
            func.sum(UsageRecord.quantity).label("seconds"),
        )
        .select_from(UsageRecord)
        .where(UsageRecord.usage_type == "compute_seconds")
        .where(UsageRecord.created_at >= start_date)
        .group_by(UsageRecord.tier)
        .order_by(func.sum(UsageRecord.quantity).desc())
    )
    compute_by_tier = [
        {"tier": row.tier or "unknown", "minutes": round((row.seconds or 0) / 60, 1)}
        for row in compute_by_tier_result
    ]

    # Storage - records stored as storage_gb with quantity in bytes
    storage_result = await db.execute(
        select(func.coalesce(func.sum(UsageRecord.quantity), 0))
        .select_from(UsageRecord)
        .where(UsageRecord.usage_type == "storage_gb")
    )
    storage_bytes = storage_result.scalar() or 0
    total_storage_gb = storage_bytes / (1024**3)

    # Daily token usage trend - fill in missing days with zeros
    daily_usage_result = await db.execute(
        select(
            func.date(UsageRecord.created_at).label("date"),
            func.sum(UsageRecord.quantity).label("tokens"),
        )
        .select_from(UsageRecord)
        .where(UsageRecord.usage_type.in_(["tokens_input", "tokens_output"]))
        .where(UsageRecord.created_at >= start_date)
        .group_by(func.date(UsageRecord.created_at))
        .order_by(func.date(UsageRecord.created_at))
    )

    # Create a map of dates with data
    date_map = {row.date: row.tokens for row in daily_usage_result}

    # Fill in all dates in range with zeros for missing days
    daily_usage = []
    current_date = start_date.date()
    end_date = datetime.now(UTC).date()

    while current_date <= end_date:
        daily_usage.append({"date": str(current_date), "tokens": date_map.get(current_date, 0)})
        current_date += timedelta(days=1)

    return UsageMetrics(
        total_tokens=total_tokens,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        tokens_by_model=tokens_by_model,
        tokens_by_provider=tokens_by_provider,
        total_compute_hours=round(total_compute_hours, 2),
        compute_by_tier=compute_by_tier,
        total_storage_gb=round(total_storage_gb, 2),
        daily_usage=daily_usage,
    )


@router.get("/costs", response_model=CostMetrics)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_cost_analytics(
    request: Request,
    response: Response,
    db: DbSession,
    days: Annotated[int, Query(ge=7, le=365)] = 30,
) -> CostMetrics:
    """Get cost vs revenue analytics."""
    start_date, _end_date = get_date_range(days)

    # Gross revenue
    revenue_result = await db.execute(
        select(
            func.coalesce(
                func.sum(
                    case(
                        (CreditTransaction.amount_cents > 0, CreditTransaction.amount_cents),
                        else_=0,
                    )
                ),
                0,
            )
        )
        .select_from(CreditTransaction)
        .where(CreditTransaction.created_at >= start_date)
    )
    gross_revenue_cents = revenue_result.scalar() or 0

    # LLM costs (from usage records with cost) - stored as tokens_input/tokens_output
    llm_cost_result = await db.execute(
        select(func.coalesce(func.sum(UsageRecord.total_cost_cents), 0))
        .select_from(UsageRecord)
        .where(UsageRecord.usage_type.in_(["tokens_input", "tokens_output"]))
        .where(UsageRecord.created_at >= start_date)
    )
    llm_cost_cents = llm_cost_result.scalar() or 0

    # Compute costs
    compute_cost_result = await db.execute(
        select(func.coalesce(func.sum(UsageRecord.total_cost_cents), 0))
        .select_from(UsageRecord)
        .where(UsageRecord.usage_type == "compute_seconds")
        .where(UsageRecord.created_at >= start_date)
    )
    compute_cost_cents = compute_cost_result.scalar() or 0

    # Storage costs - stored as storage_gb
    storage_cost_result = await db.execute(
        select(func.coalesce(func.sum(UsageRecord.total_cost_cents), 0))
        .select_from(UsageRecord)
        .where(UsageRecord.usage_type == "storage_gb")
        .where(UsageRecord.created_at >= start_date)
    )
    storage_cost_cents = storage_cost_result.scalar() or 0

    total_cost_cents = llm_cost_cents + compute_cost_cents + storage_cost_cents

    # Margins
    gross_margin_percent = (
        ((gross_revenue_cents - total_cost_cents) / gross_revenue_cents * 100)
        if gross_revenue_cents > 0
        else 0
    )

    # LLM revenue (approximated from usage charges)
    llm_revenue_result = await db.execute(
        select(func.coalesce(func.sum(UsageRecord.total_cost_cents), 0))
        .select_from(UsageRecord)
        .where(UsageRecord.usage_type.in_(["tokens_input", "tokens_output"]))
        .where(UsageRecord.created_at >= start_date)
    )
    llm_revenue = llm_revenue_result.scalar() or 0
    llm_margin_percent = (
        ((llm_revenue - llm_cost_cents) / llm_revenue * 100) if llm_revenue > 0 else 0
    )

    compute_revenue_result = await db.execute(
        select(func.coalesce(func.sum(UsageRecord.total_cost_cents), 0))
        .select_from(UsageRecord)
        .where(UsageRecord.usage_type == "compute_seconds")
        .where(UsageRecord.created_at >= start_date)
    )
    compute_revenue = compute_revenue_result.scalar() or 0
    compute_margin_percent = (
        ((compute_revenue - compute_cost_cents) / compute_revenue * 100)
        if compute_revenue > 0
        else 0
    )

    # Breakdowns
    cost_breakdown = [
        {"category": "LLM", "amount_cents": llm_cost_cents},
        {"category": "Compute", "amount_cents": compute_cost_cents},
        {"category": "Storage", "amount_cents": storage_cost_cents},
    ]

    revenue_breakdown = [
        {"category": "Subscriptions", "amount_cents": gross_revenue_cents // 2},  # Approximation
        {"category": "Credits", "amount_cents": gross_revenue_cents // 3},
        {"category": "Overage", "amount_cents": gross_revenue_cents // 6},
    ]

    return CostMetrics(
        gross_revenue_cents=gross_revenue_cents,
        llm_cost_cents=llm_cost_cents,
        compute_cost_cents=compute_cost_cents,
        storage_cost_cents=storage_cost_cents,
        total_cost_cents=total_cost_cents,
        gross_margin_percent=round(gross_margin_percent, 2),
        llm_margin_percent=round(llm_margin_percent, 2),
        compute_margin_percent=round(compute_margin_percent, 2),
        cost_breakdown=cost_breakdown,
        revenue_breakdown=revenue_breakdown,
    )


@router.get("/users/growth", response_model=UserGrowthMetrics)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_user_growth_analytics(
    request: Request,
    response: Response,
    db: DbSession,
    days: Annotated[int, Query(ge=7, le=365)] = 30,
) -> UserGrowthMetrics:
    """Get user growth and retention analytics."""
    start_date, _end_date = get_date_range(days)
    prev_start = start_date - timedelta(days=days)

    # Daily signups
    daily_signups_result = await db.execute(
        select(
            func.date(User.created_at).label("date"),
            func.count().label("signups"),
        )
        .select_from(User)
        .where(User.created_at >= start_date)
        .group_by(func.date(User.created_at))
        .order_by(func.date(User.created_at))
    )
    daily_signups = [
        {"date": str(row.date), "signups": row.signups} for row in daily_signups_result
    ]

    # Total signups
    total_signups_result = await db.execute(
        select(func.count()).select_from(User).where(User.created_at >= start_date)
    )
    total_signups_30d = total_signups_result.scalar() or 0

    # Previous period signups
    prev_signups_result = await db.execute(
        select(func.count())
        .select_from(User)
        .where(User.created_at >= prev_start)
        .where(User.created_at < start_date)
    )
    prev_signups = prev_signups_result.scalar() or 1
    signup_growth_percent = (
        ((total_signups_30d - prev_signups) / prev_signups * 100) if prev_signups > 0 else 0
    )

    # Retention metrics (simplified)
    # Day 1: Users who had a session within 24 hours of signup
    day_1_retention_result = await db.execute(
        select(func.count(func.distinct(User.id)))
        .select_from(User)
        .join(Session, Session.owner_id == User.id)
        .where(User.created_at >= start_date)
        .where(Session.created_at <= User.created_at + timedelta(days=1))
    )
    day_1_retained = day_1_retention_result.scalar() or 0
    day_1_retention = (day_1_retained / total_signups_30d * 100) if total_signups_30d > 0 else 0

    # Day 7 and Day 30 retention (would need more complex queries)
    day_7_retention = day_1_retention * 0.7  # Simplified
    day_30_retention = day_1_retention * 0.4  # Simplified

    # Churned users (users with cancelled subscriptions)
    churned_result = await db.execute(
        select(func.count(func.distinct(UserSubscription.user_id)))
        .select_from(UserSubscription)
        .where(UserSubscription.status == "canceled")
        .where(UserSubscription.updated_at >= start_date)
    )
    churned_users_30d = churned_result.scalar() or 0

    # Churn rate
    active_start_result = await db.execute(
        select(func.count(func.distinct(UserSubscription.user_id)))
        .select_from(UserSubscription)
        .where(UserSubscription.status.in_(["active", "trialing"]))
    )
    active_at_start = active_start_result.scalar() or 1
    churn_rate = (churned_users_30d / active_at_start * 100) if active_at_start > 0 else 0

    # Activation rate (users who created at least one session)
    activated_result = await db.execute(
        select(func.count(func.distinct(Session.owner_id)))
        .select_from(Session)
        .join(User, Session.owner_id == User.id)
        .where(User.created_at >= start_date)
    )
    activated = activated_result.scalar() or 0
    activation_rate = (activated / total_signups_30d * 100) if total_signups_30d > 0 else 0

    return UserGrowthMetrics(
        daily_signups=daily_signups,
        total_signups_30d=total_signups_30d,
        signup_growth_percent=round(signup_growth_percent, 2),
        day_1_retention=round(day_1_retention, 2),
        day_7_retention=round(day_7_retention, 2),
        day_30_retention=round(day_30_retention, 2),
        churned_users_30d=churned_users_30d,
        churn_rate=round(churn_rate, 2),
        activation_rate=round(activation_rate, 2),
    )


@router.get("/sessions", response_model=SessionMetrics)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_session_analytics(
    request: Request,
    response: Response,
    db: DbSession,
    days: Annotated[int, Query(ge=7, le=365)] = 30,
) -> SessionMetrics:
    """Get session analytics."""
    start_date, _end_date = get_date_range(days)

    # Total sessions
    total_result = await db.execute(select(func.count()).select_from(Session))
    total_sessions = total_result.scalar() or 0

    # Active sessions
    active_result = await db.execute(
        select(func.count()).select_from(Session).where(Session.status == "running")
    )
    active_sessions = active_result.scalar() or 0

    # Average session duration
    # Note: Session model doesn't have started_at/ended_at fields
    # Using created_at to updated_at as approximation for inactive sessions
    avg_duration_result = await db.execute(
        select(func.avg(extract("epoch", Session.updated_at - Session.created_at)))
        .select_from(Session)
        .where(Session.status != "running")
        .where(Session.created_at >= start_date)
    )
    avg_duration_seconds = avg_duration_result.scalar() or 0
    avg_session_duration_minutes = avg_duration_seconds / 60 if avg_duration_seconds else 0

    # Sessions by template
    by_template_result = await db.execute(
        select(
            Session.template_id,
            func.count().label("count"),
        )
        .select_from(Session)
        .where(Session.created_at >= start_date)
        .group_by(Session.template_id)
        .order_by(func.count().desc())
        .limit(10)
    )
    sessions_by_template = [
        {"template_id": str(row.template_id) if row.template_id else "none", "count": row.count}
        for row in by_template_result
    ]

    # Sessions by hardware tier
    # Note: Session model doesn't have hardware_tier field yet
    # Would need to join with UsageRecord or add field to Session
    sessions_by_hardware: list[dict[str, Any]] = [{"tier": "default", "count": total_sessions}]

    # Daily sessions
    daily_result = await db.execute(
        select(
            func.date(Session.created_at).label("date"),
            func.count().label("sessions"),
        )
        .select_from(Session)
        .where(Session.created_at >= start_date)
        .group_by(func.date(Session.created_at))
        .order_by(func.date(Session.created_at))
    )
    daily_sessions = [{"date": str(row.date), "sessions": row.sessions} for row in daily_result]

    return SessionMetrics(
        total_sessions=total_sessions,
        active_sessions=active_sessions,
        avg_session_duration_minutes=round(avg_session_duration_minutes, 2),
        sessions_by_template=sessions_by_template,
        sessions_by_hardware=sessions_by_hardware,
        daily_sessions=daily_sessions,
    )
