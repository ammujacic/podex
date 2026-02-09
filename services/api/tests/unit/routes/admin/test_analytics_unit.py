"""Unit tests for admin analytics helpers and Pydantic models."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest

from src.routes.admin import analytics as ana


# --- get_date_range ---


def test_get_date_range_returns_start_and_end() -> None:
    """get_date_range returns (start_date, end_date) with correct delta."""
    fixed_end = datetime(2025, 2, 15, 12, 0, 0, tzinfo=UTC)
    with patch("src.routes.admin.analytics.datetime") as mock_dt:
        mock_dt.now.return_value = fixed_end
        start, end = ana.get_date_range(30)
    assert end == fixed_end
    assert start == fixed_end - timedelta(days=30)
    assert (end - start).days == 30


def test_get_date_range_7_days() -> None:
    """get_date_range(7) returns 7-day range."""
    fixed = datetime(2025, 1, 10, 0, 0, 0, tzinfo=UTC)
    with patch("src.routes.admin.analytics.datetime") as mock_dt:
        mock_dt.now.return_value = fixed
        start, end = ana.get_date_range(7)
    assert (end - start).days == 7
    assert start == datetime(2025, 1, 3, 0, 0, 0, tzinfo=UTC)


def test_get_date_range_1_day() -> None:
    """get_date_range(1) returns 1-day range."""
    fixed = datetime(2025, 1, 10, 12, 30, 0, tzinfo=UTC)
    with patch("src.routes.admin.analytics.datetime") as mock_dt:
        mock_dt.now.return_value = fixed
        start, end = ana.get_date_range(1)
    assert end == fixed
    assert (end - start).total_seconds() == 86400  # 1 day in seconds


# --- Pydantic models (smoke / instantiation) ---


def test_dashboard_overview_model() -> None:
    """DashboardOverview accepts all required fields."""
    m = ana.DashboardOverview(
        total_users=100,
        active_users_30d=50,
        new_users_30d=10,
        user_growth_percent=5.0,
        total_sessions=200,
        active_sessions=5,
        sessions_today=20,
        mrr_cents=10000,
        arr_cents=120000,
        mrr_growth_percent=2.0,
        total_tokens_30d=1_000_000,
        total_compute_hours_30d=10.5,
        total_storage_gb=50.0,
        paying_customers=25,
        conversion_rate=0.25,
        churn_rate_30d=0.02,
    )
    assert m.total_users == 100
    assert m.mrr_cents == 10000
    assert m.conversion_rate == 0.25


def test_revenue_metrics_model() -> None:
    """RevenueMetrics accepts all required fields."""
    m = ana.RevenueMetrics(
        mrr_cents=5000,
        arr_cents=60000,
        mrr_previous_cents=4500,
        mrr_growth_percent=11.1,
        subscription_revenue_cents=4000,
        credit_revenue_cents=500,
        overage_revenue_cents=500,
        revenue_by_plan=[{"plan": "pro", "revenue_cents": 4000}],
        nrr_percent=95.0,
        arpu_cents=200,
        ltv_cents=2400,
    )
    assert m.mrr_cents == 5000
    assert len(m.revenue_by_plan) == 1


def test_usage_metrics_model() -> None:
    """UsageMetrics accepts all required fields."""
    m = ana.UsageMetrics(
        total_tokens=1_000_000,
        input_tokens=600_000,
        output_tokens=400_000,
        tokens_by_model=[],
        tokens_by_provider=[],
        total_compute_hours=100.0,
        compute_by_tier=[],
        total_storage_gb=10.0,
        daily_usage=[],
    )
    assert m.total_tokens == 1_000_000
    assert m.input_tokens == 600_000


def test_cost_metrics_model() -> None:
    """CostMetrics accepts all required fields."""
    m = ana.CostMetrics(
        gross_revenue_cents=10000,
        llm_cost_cents=2000,
        compute_cost_cents=1000,
        storage_cost_cents=500,
        total_cost_cents=3500,
        gross_margin_percent=65.0,
        llm_margin_percent=80.0,
        compute_margin_percent=90.0,
        cost_breakdown=[],
        revenue_breakdown=[],
    )
    assert m.total_cost_cents == 3500
    assert m.gross_margin_percent == 65.0


def test_user_growth_metrics_model() -> None:
    """UserGrowthMetrics accepts all required fields."""
    m = ana.UserGrowthMetrics(
        daily_signups=[],
        total_signups_30d=50,
        signup_growth_percent=10.0,
        day_1_retention=0.8,
        day_7_retention=0.6,
        day_30_retention=0.4,
        churned_users_30d=5,
        churn_rate=0.1,
        activation_rate=0.7,
    )
    assert m.total_signups_30d == 50
    assert m.activation_rate == 0.7


def test_session_metrics_model() -> None:
    """SessionMetrics accepts all required fields."""
    m = ana.SessionMetrics(
        total_sessions=100,
        active_sessions=10,
        avg_session_duration_minutes=45.0,
        sessions_by_template=[],
        sessions_by_hardware=[],
        daily_sessions=[],
    )
    assert m.avg_session_duration_minutes == 45.0


def test_time_series_point_model() -> None:
    """TimeSeriesPoint accepts date and value."""
    m = ana.TimeSeriesPoint(date="2025-01-15", value=100)
    assert m.date == "2025-01-15"
    assert m.value == 100
    m2 = ana.TimeSeriesPoint(date="2025-01-16", value=99.5)
    assert m2.value == 99.5
