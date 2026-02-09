"""Unit tests for billing route helpers (validate_subscription_transition, cents_to_dollars, _build_plan_response)."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from src.routes import billing as billing_module


def test_validate_subscription_transition_same_status() -> None:
    """Same current and new status is valid."""
    assert billing_module.validate_subscription_transition("active", "active") is True
    assert billing_module.validate_subscription_transition("trialing", "trialing") is True


def test_validate_subscription_transition_active_to_canceled() -> None:
    """active -> canceled is valid."""
    assert billing_module.validate_subscription_transition("active", "canceled") is True


def test_validate_subscription_transition_trialing_to_active() -> None:
    """trialing -> active is valid."""
    assert billing_module.validate_subscription_transition("trialing", "active") is True


def test_validate_subscription_transition_invalid_transition() -> None:
    """active -> trialing is invalid (cannot go back to trialing)."""
    assert billing_module.validate_subscription_transition("active", "trialing") is False


def test_validate_subscription_transition_invalid_status() -> None:
    """Unknown status returns False."""
    assert billing_module.validate_subscription_transition("active", "unknown") is False
    assert billing_module.validate_subscription_transition("unknown", "active") is False


def test_cents_to_dollars() -> None:
    """cents_to_dollars converts correctly."""
    assert billing_module.cents_to_dollars(100) == 1.0
    assert billing_module.cents_to_dollars(199) == 1.99
    assert billing_module.cents_to_dollars(0) == 0.0
    assert billing_module.cents_to_dollars(10000) == 100.0


def test_build_plan_response() -> None:
    """_build_plan_response maps plan fields and converts cents to dollars."""
    plan = MagicMock()
    plan.id = "plan-1"
    plan.name = "Pro"
    plan.slug = "pro"
    plan.description = "Pro plan"
    plan.price_monthly_cents = 1999
    plan.price_yearly_cents = 19990
    plan.currency = "usd"
    plan.tokens_included = 1000000
    plan.compute_credits_cents_included = 5000
    plan.storage_gb_included = 50
    plan.max_agents = 5
    plan.max_sessions = 10
    plan.max_team_members = 3
    plan.overage_allowed = True
    plan.overage_token_rate_cents = 10
    plan.overage_compute_rate_cents = 50
    plan.overage_storage_rate_cents = 20
    plan.features = {"support": "email"}
    plan.is_popular = True
    plan.is_enterprise = False

    resp = billing_module._build_plan_response(plan)

    assert resp.id == "plan-1"
    assert resp.name == "Pro"
    assert resp.slug == "pro"
    assert resp.price_monthly == 19.99
    assert resp.price_yearly == 199.90
    assert resp.compute_credits_included == 50.0
    assert resp.overage_token_rate == 0.10
    assert resp.overage_compute_rate == 0.50
    assert resp.overage_storage_rate == 0.20
    assert resp.features == {"support": "email"}
    assert resp.is_popular is True
    assert resp.is_enterprise is False


def test_build_plan_response_none_overage_rates() -> None:
    """_build_plan_response handles None overage rates as 0."""
    plan = MagicMock()
    plan.id = "plan-free"
    plan.name = "Free"
    plan.slug = "free"
    plan.description = None
    plan.price_monthly_cents = 0
    plan.price_yearly_cents = 0
    plan.currency = "usd"
    plan.tokens_included = 10000
    plan.compute_credits_cents_included = 0
    plan.storage_gb_included = 1
    plan.max_agents = 1
    plan.max_sessions = 1
    plan.max_team_members = 0
    plan.overage_allowed = False
    plan.overage_token_rate_cents = None
    plan.overage_compute_rate_cents = None
    plan.overage_storage_rate_cents = None
    plan.features = None
    plan.is_popular = False
    plan.is_enterprise = False

    resp = billing_module._build_plan_response(plan)

    assert resp.overage_token_rate == 0.0
    assert resp.overage_compute_rate == 0.0
    assert resp.overage_storage_rate == 0.0
    assert resp.features == {}
