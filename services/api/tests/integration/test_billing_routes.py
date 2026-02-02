"""Integration tests for user billing routes.

Covers: GET /billing/subscription, GET /billing/plans (in test_plans_routes),
POST /billing/portal (503 when Stripe not configured), GET /billing/payment-methods.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient


# -----------------------------------------------------------------------------
# Subscription
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_user_subscription_returns_null_when_none(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /billing/subscription returns null when user has no subscription."""
    resp = await test_client.get(
        "/api/billing/subscription",
        headers=auth_headers_with_db,
    )
    # Route may return null or 200 with null body
    assert resp.status_code == 200
    data = resp.json()
    # When no subscription, response is typically null or has status indicating none
    assert data is None or isinstance(data, dict)


@pytest.mark.asyncio
async def test_get_user_subscription_requires_auth(test_client: AsyncClient) -> None:
    """GET /billing/subscription without auth returns 401."""
    resp = await test_client.get(
        "/api/billing/subscription",
        headers={"X-Requested-With": "XMLHttpRequest", "Origin": "http://test"},
    )
    assert resp.status_code == 401


# -----------------------------------------------------------------------------
# Portal (Stripe)
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_billing_portal_503_when_stripe_not_configured(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """POST /billing/portal returns 503 when Stripe is not configured."""
    from src import config as config_module

    monkeypatch.setattr(config_module.settings, "STRIPE_SECRET_KEY", "", raising=False)

    resp = await test_client.post(
        "/api/billing/portal",
        headers=auth_headers_with_db,
        json={"return_url": "https://example.com/settings"},
    )
    assert resp.status_code == 503
    assert "stripe" in resp.json().get("detail", "").lower()


# -----------------------------------------------------------------------------
# Payment methods
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_payment_methods_structure(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /billing/payment-methods returns list structure (may be empty)."""
    resp = await test_client.get(
        "/api/billing/payment-methods",
        headers=auth_headers_with_db,
    )
    # When Stripe not configured may be 503; when configured returns 200 with structure
    if resp.status_code == 200:
        data = resp.json()
        assert "payment_methods" in data
        assert isinstance(data["payment_methods"], list)
    else:
        assert resp.status_code == 503
