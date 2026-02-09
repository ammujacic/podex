"""Integration tests for subscription plans (billing plans).

Covers: GET /billing/plans (list), GET /billing/plans/{slug} (get by slug).
Uses seed data (free plan) for assertions.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient


# -----------------------------------------------------------------------------
# List plans
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_billing_plans_success(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /billing/plans returns list of active subscription plans."""
    resp = await test_client.get("/api/billing/plans", headers=auth_headers_with_db)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    # Seed data includes at least "free" plan
    slugs = [p["slug"] for p in data]
    assert "free" in slugs


# -----------------------------------------------------------------------------
# Get plan by slug
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_billing_plan_by_slug_success(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /billing/plans/free returns plan details."""
    resp = await test_client.get(
        "/api/billing/plans/free",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["slug"] == "free"
    assert "name" in data
    assert "price_monthly" in data
    assert "price_yearly" in data


@pytest.mark.asyncio
async def test_get_billing_plan_by_slug_404(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /billing/plans/nonexistent returns 404."""
    resp = await test_client.get(
        "/api/billing/plans/nonexistent-plan-slug",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 404
    assert "not found" in resp.json().get("detail", "").lower()
