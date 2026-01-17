"""API routes for cost optimization insights and suggestions."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import LLMModel, UsageRecord
from src.middleware.auth import get_current_user

router = APIRouter(prefix="/cost-insights", tags=["cost-insights"])


# ============================================================================
# Response Models
# ============================================================================


class CostBreakdown(BaseModel):
    """Cost breakdown by category."""

    total_cents: int
    by_model: dict[str, int]
    by_session: dict[str, int]
    by_day: dict[str, int]


class CostSuggestion(BaseModel):
    """A single cost optimization suggestion."""

    id: str
    type: str  # model_downgrade, context_reduction, batch_operations, caching, plan_upgrade
    priority: str  # high, medium, low
    title: str
    description: str
    potential_savings_cents: int
    potential_savings_percent: float
    current_usage: dict[str, Any]
    recommended_action: str
    applies_to: list[str]  # List of model IDs, session IDs, etc.


class ModelComparison(BaseModel):
    """Comparison of current model usage vs alternatives."""

    current_model_id: str
    current_model_name: str
    current_cost_cents: int
    alternatives: list[dict[str, Any]]  # model_id, model_name, cost, savings, capabilities


class CostForecast(BaseModel):
    """Cost forecast for upcoming periods."""

    current_month_to_date: int
    projected_month_end: int
    next_month_estimate: int
    daily_average: int
    trend: str  # increasing, decreasing, stable
    trend_percent: float


class CostInsightsSummary(BaseModel):
    """Summary of cost insights."""

    total_cost_30d_cents: int
    total_cost_7d_cents: int
    average_daily_cost_cents: int
    cost_breakdown: CostBreakdown
    top_suggestions: list[CostSuggestion]
    forecast: CostForecast
    optimization_score: int  # 0-100, how optimized is the usage


# ============================================================================
# Cost Optimizer Logic
# ============================================================================


def generate_suggestions(
    usage_records: list[UsageRecord],
    models: dict[str, LLMModel],
    total_cost_cents: int,
) -> list[CostSuggestion]:
    """Generate cost optimization suggestions based on usage patterns."""
    suggestions: list[CostSuggestion] = []

    # Analyze model usage
    model_costs: dict[str, int] = {}
    model_usage_counts: dict[str, int] = {}
    for record in usage_records:
        model_name = record.model or "unknown"
        cost = record.total_cost_cents or 0
        model_costs[model_name] = model_costs.get(model_name, 0) + cost
        model_usage_counts[model_name] = model_usage_counts.get(model_name, 0) + 1

    # Find expensive model usage that could be downgraded
    for model_id, cost in model_costs.items():
        model = models.get(model_id)
        if not model:
            continue

        # If using a premium model frequently, suggest downgrade for simple tasks
        if model.cost_tier in ["high", "premium"] and model_usage_counts.get(model_id, 0) > 10:
            # Find a cheaper alternative
            cheaper_models = [
                m
                for m in models.values()
                if m.cost_tier in ["low", "medium"]
                and m.provider == model.provider
                and m.is_enabled
            ]

            if cheaper_models:
                potential_savings = int(cost * 0.4)  # Estimate 40% savings
                suggestions.append(
                    CostSuggestion(
                        id=f"downgrade-{model_id}",
                        type="model_downgrade",
                        priority="high" if potential_savings > 1000 else "medium",
                        title="Consider using a lighter model",
                        description=(
                            f"You've used {model.display_name} {model_usage_counts[model_id]} "
                            f"times. For simpler tasks, consider using a more cost-effective model."
                        ),
                        potential_savings_cents=potential_savings,
                        potential_savings_percent=round(potential_savings / max(cost, 1) * 100, 1),
                        current_usage={
                            "model": model.display_name,
                            "usage_count": model_usage_counts[model_id],
                            "total_cost_cents": cost,
                        },
                        recommended_action=(
                            f"Use {cheaper_models[0].display_name} for routine tasks"
                        ),
                        applies_to=[model_id],
                    )
                )

    # Check for high context usage (filter for token input records with high quantity)
    high_context_records = [
        r for r in usage_records if r.usage_type == "tokens_input" and (r.quantity or 0) > 50000
    ]
    if len(high_context_records) > 5:
        avg_tokens = sum(r.quantity or 0 for r in high_context_records) // len(high_context_records)
        potential_savings = int(total_cost_cents * 0.15)
        suggestions.append(
            CostSuggestion(
                id="context-reduction",
                type="context_reduction",
                priority="medium",
                title="Optimize context window usage",
                description=(
                    f"You have {len(high_context_records)} requests with very large context "
                    f"windows (avg {avg_tokens:,} tokens). Consider summarizing or chunking."
                ),
                potential_savings_cents=potential_savings,
                potential_savings_percent=15.0,
                current_usage={
                    "high_context_requests": len(high_context_records),
                    "avg_input_tokens": avg_tokens,
                },
                recommended_action="Use document summarization or chunking strategies",
                applies_to=[r.id for r in high_context_records[:5]],
            )
        )

    # Check for repeated similar queries (caching opportunity)
    # This is simplified - production would use semantic similarity
    if len(usage_records) > 50:
        potential_savings = int(total_cost_cents * 0.1)
        suggestions.append(
            CostSuggestion(
                id="caching-opportunity",
                type="caching",
                priority="low",
                title="Enable response caching",
                description=(
                    "High query volume detected. Caching similar queries could reduce "
                    "redundant API calls."
                ),
                potential_savings_cents=potential_savings,
                potential_savings_percent=10.0,
                current_usage={"total_queries": len(usage_records)},
                recommended_action="Enable the response cache in agent settings",
                applies_to=[],
            )
        )

    return sorted(suggestions, key=lambda s: s.potential_savings_cents, reverse=True)


# ============================================================================
# Routes
# ============================================================================


@router.get("/summary", response_model=CostInsightsSummary)
async def get_cost_summary(
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> CostInsightsSummary:
    """Get cost insights summary with suggestions."""
    user_id = user["id"]
    now = datetime.now(UTC)
    thirty_days_ago = now - timedelta(days=30)
    seven_days_ago = now - timedelta(days=7)

    # Fetch usage records
    query = (
        select(UsageRecord)
        .where(
            UsageRecord.user_id == user_id,
            UsageRecord.created_at >= thirty_days_ago,
        )
        .order_by(UsageRecord.created_at.desc())
    )

    result = await db.execute(query)
    records = result.scalars().all()

    # Fetch models for reference
    models_query = select(LLMModel).where(LLMModel.is_enabled == True)
    models_result = await db.execute(models_query)
    models = {m.model_id: m for m in models_result.scalars().all()}

    # Calculate totals
    total_30d = sum(r.total_cost_cents or 0 for r in records)
    records_7d = [r for r in records if r.created_at and r.created_at >= seven_days_ago]
    total_7d = sum(r.total_cost_cents or 0 for r in records_7d)

    # Calculate breakdown
    by_model: dict[str, int] = {}
    by_session: dict[str, int] = {}
    by_day: dict[str, int] = {}

    for r in records:
        model_key = r.model or "unknown"
        by_model[model_key] = by_model.get(model_key, 0) + (r.total_cost_cents or 0)

        session_key = r.session_id or "unknown"
        by_session[session_key] = by_session.get(session_key, 0) + (r.total_cost_cents or 0)

        if r.created_at:
            day_key = r.created_at.strftime("%Y-%m-%d")
            by_day[day_key] = by_day.get(day_key, 0) + (r.total_cost_cents or 0)

    # Generate suggestions
    suggestions = generate_suggestions(list(records), models, total_30d)

    # Calculate forecast
    days_with_data = len(by_day)
    daily_avg = total_30d // max(days_with_data, 1)
    days_in_month = 30
    day_of_month = now.day
    remaining_days = days_in_month - day_of_month

    month_to_date = sum(
        cost for day, cost in by_day.items() if day.startswith(now.strftime("%Y-%m"))
    )
    projected_month_end = month_to_date + (daily_avg * remaining_days)

    # Determine trend
    first_half_records = [
        r
        for r in records
        if r.created_at
        and r.created_at >= thirty_days_ago
        and r.created_at < now - timedelta(days=15)
    ]
    first_half = sum(r.total_cost_cents or 0 for r in first_half_records)

    second_half_records = [
        r for r in records if r.created_at and r.created_at >= now - timedelta(days=15)
    ]
    second_half = sum(r.total_cost_cents or 0 for r in second_half_records)

    if first_half == 0:
        trend = "stable"
        trend_percent = 0.0
    elif second_half > first_half * 1.1:
        trend = "increasing"
        trend_percent = round((second_half - first_half) / first_half * 100, 1)
    elif second_half < first_half * 0.9:
        trend = "decreasing"
        trend_percent = round((first_half - second_half) / first_half * 100, 1)
    else:
        trend = "stable"
        trend_percent = 0.0

    # Calculate optimization score (simplified)
    total_potential_savings = sum(s.potential_savings_cents for s in suggestions)
    optimization_score = max(
        0, min(100, 100 - int(total_potential_savings / max(total_30d, 1) * 100))
    )

    return CostInsightsSummary(
        total_cost_30d_cents=total_30d,
        total_cost_7d_cents=total_7d,
        average_daily_cost_cents=daily_avg,
        cost_breakdown=CostBreakdown(
            total_cents=total_30d,
            by_model=dict(sorted(by_model.items(), key=lambda x: x[1], reverse=True)[:5]),
            by_session=dict(sorted(by_session.items(), key=lambda x: x[1], reverse=True)[:5]),
            by_day=by_day,
        ),
        top_suggestions=suggestions[:5],
        forecast=CostForecast(
            current_month_to_date=month_to_date,
            projected_month_end=projected_month_end,
            next_month_estimate=projected_month_end,  # Simplified
            daily_average=daily_avg,
            trend=trend,
            trend_percent=trend_percent,
        ),
        optimization_score=optimization_score,
    )


@router.get("/suggestions", response_model=list[CostSuggestion])
async def get_suggestions(
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> list[CostSuggestion]:
    """Get all cost optimization suggestions."""
    user_id = user["id"]
    thirty_days_ago = datetime.now(UTC) - timedelta(days=30)

    # Fetch usage records
    query = select(UsageRecord).where(
        UsageRecord.user_id == user_id,
        UsageRecord.created_at >= thirty_days_ago,
    )
    result = await db.execute(query)
    records = result.scalars().all()

    # Fetch models
    models_query = select(LLMModel).where(LLMModel.is_enabled == True)
    models_result = await db.execute(models_query)
    models = {m.model_id: m for m in models_result.scalars().all()}

    total_cost = sum(r.total_cost_cents or 0 for r in records)
    suggestions = generate_suggestions(list(records), models, total_cost)

    return suggestions[:limit]


@router.get("/model-comparison", response_model=list[ModelComparison])
async def get_model_comparison(
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> list[ModelComparison]:
    """Compare current model usage costs with alternatives."""
    user_id = user["id"]
    thirty_days_ago = datetime.now(UTC) - timedelta(days=30)

    # Get usage by model
    query = select(UsageRecord).where(
        UsageRecord.user_id == user_id,
        UsageRecord.created_at >= thirty_days_ago,
    )
    result = await db.execute(query)
    records = result.scalars().all()

    # Fetch all models
    models_query = select(LLMModel).where(LLMModel.is_enabled == True)
    models_result = await db.execute(models_query)
    models = {m.model_id: m for m in models_result.scalars().all()}

    # Group usage by model
    model_usage: dict[str, dict[str, Any]] = {}
    for r in records:
        model_name = r.model or "unknown"
        if model_name not in model_usage:
            model_usage[model_name] = {
                "total_cost": 0,
                "total_input_tokens": 0,
                "total_output_tokens": 0,
                "request_count": 0,
            }
        model_usage[model_name]["total_cost"] += r.total_cost_cents or 0
        # Track token usage based on usage_type
        if r.usage_type == "tokens_input":
            model_usage[model_name]["total_input_tokens"] += r.quantity or 0
        elif r.usage_type == "tokens_output":
            model_usage[model_name]["total_output_tokens"] += r.quantity or 0
        model_usage[model_name]["request_count"] += 1

    comparisons = []
    for model_id, usage in model_usage.items():
        current_model = models.get(model_id)
        if not current_model:
            continue

        # Find alternatives (same provider, lower cost tier)
        alternatives = []
        for alt_model in models.values():
            if alt_model.model_id == model_id:
                continue
            if alt_model.provider != current_model.provider:
                continue

            # Estimate cost with alternative model
            input_cost = (usage["total_input_tokens"] / 1_000_000) * (
                alt_model.input_cost_per_million or 0
            )
            output_cost = (usage["total_output_tokens"] / 1_000_000) * (
                alt_model.output_cost_per_million or 0
            )
            estimated_cost = int((input_cost + output_cost) * 100)  # Convert to cents

            savings = usage["total_cost"] - estimated_cost

            capabilities_diff = []
            if current_model.capabilities and alt_model.capabilities:
                for cap in ["vision", "tools", "extended_thinking"]:
                    if current_model.capabilities.get(cap) and not alt_model.capabilities.get(cap):
                        capabilities_diff.append(f"-{cap}")
                    elif not current_model.capabilities.get(cap) and alt_model.capabilities.get(
                        cap
                    ):
                        capabilities_diff.append(f"+{cap}")

            alternatives.append(
                {
                    "model_id": alt_model.model_id,
                    "model_name": alt_model.display_name,
                    "estimated_cost_cents": estimated_cost,
                    "savings_cents": savings,
                    "cost_tier": alt_model.cost_tier,
                    "capabilities_diff": capabilities_diff,
                }
            )

        # Sort by savings
        alternatives.sort(key=lambda x: x["savings_cents"], reverse=True)

        comparisons.append(
            ModelComparison(
                current_model_id=model_id,
                current_model_name=current_model.display_name,
                current_cost_cents=usage["total_cost"],
                alternatives=alternatives[:3],  # Top 3 alternatives
            )
        )

    # Sort by current cost
    comparisons.sort(key=lambda x: x.current_cost_cents, reverse=True)
    return comparisons


@router.get("/forecast", response_model=CostForecast)
async def get_cost_forecast(
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> CostForecast:
    """Get cost forecast for upcoming periods."""
    user_id = user["id"]
    now = datetime.now(UTC)
    thirty_days_ago = now - timedelta(days=30)

    # Fetch usage records
    query = select(UsageRecord).where(
        UsageRecord.user_id == user_id,
        UsageRecord.created_at >= thirty_days_ago,
    )
    result = await db.execute(query)
    records = result.scalars().all()

    # Calculate daily costs
    by_day: dict[str, int] = {}
    for r in records:
        if r.created_at:
            day_key = r.created_at.strftime("%Y-%m-%d")
            by_day[day_key] = by_day.get(day_key, 0) + (r.total_cost_cents or 0)

    days_with_data = len(by_day)
    total_cost = sum(by_day.values())
    daily_avg = total_cost // max(days_with_data, 1)

    # Month calculations
    month_to_date = sum(
        cost for day, cost in by_day.items() if day.startswith(now.strftime("%Y-%m"))
    )
    day_of_month = now.day
    remaining_days = 30 - day_of_month
    projected_month_end = month_to_date + (daily_avg * remaining_days)

    # Trend analysis
    first_half_records = [
        r
        for r in records
        if r.created_at
        and r.created_at >= thirty_days_ago
        and r.created_at < now - timedelta(days=15)
    ]
    first_half = sum(r.total_cost_cents or 0 for r in first_half_records)

    second_half_records = [
        r for r in records if r.created_at and r.created_at >= now - timedelta(days=15)
    ]
    second_half = sum(r.total_cost_cents or 0 for r in second_half_records)

    if first_half == 0:
        trend = "stable"
        trend_percent = 0.0
    elif second_half > first_half * 1.1:
        trend = "increasing"
        trend_percent = round((second_half - first_half) / first_half * 100, 1)
    elif second_half < first_half * 0.9:
        trend = "decreasing"
        trend_percent = round((first_half - second_half) / first_half * 100, 1)
    else:
        trend = "stable"
        trend_percent = 0.0

    return CostForecast(
        current_month_to_date=month_to_date,
        projected_month_end=projected_month_end,
        next_month_estimate=projected_month_end,
        daily_average=daily_avg,
        trend=trend,
        trend_percent=trend_percent,
    )
