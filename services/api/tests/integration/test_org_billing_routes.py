"""Integration tests for organization billing routes.

These tests focus on:
- Stripe configuration error paths
- Credits checkout happy path (with Stripe mocked)
- Seat update validation against current member count
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models.organization import (
    Organization,
    OrganizationMember,
    OrganizationSubscription,
)
from src.database.models.billing import SubscriptionPlan
from src.routes import org_billing as org_billing_module


async def _create_org_with_owner(
    db: AsyncSession,
    *,
    org_id: str = "org-123",
    user_id: str = "",
    slug: str | None = None,
) -> Organization:
    """Create an organization and corresponding owner membership."""
    org = Organization(
        id=org_id,
        name="Test Org",
        slug=slug or org_id.replace("-", "_"),
        credit_model="pooled",
        credit_pool_cents=0,
        is_active=True,
    )
    db.add(org)
    member = OrganizationMember(
        organization_id=org_id,
        user_id=user_id,
        role="owner",
    )
    db.add(member)
    await db.commit()
    return org


@pytest.mark.asyncio
async def test_org_subscription_checkout_stripe_not_configured(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db,  # noqa: ANN001 - from integration conftest
    auth_headers_with_db: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When STRIPE is not configured, subscription checkout should return 503."""
    from src import config as config_module

    # Disable Stripe
    monkeypatch.setattr(config_module.settings, "STRIPE_SECRET_KEY", "", raising=False)

    org_id = str(uuid4())
    await _create_org_with_owner(integration_db, org_id=org_id, user_id=test_user_with_db.id)

    resp = await test_client.post(
        f"/api/organizations/{org_id}/billing/checkout/subscription",
        headers=auth_headers_with_db,
        json={"plan_slug": "pro", "billing_cycle": "monthly", "seat_count": 1},
    )
    assert resp.status_code == 503
    assert resp.json()["detail"] == "Stripe not configured"


@pytest.mark.asyncio
async def test_org_credits_checkout_happy_path_with_mocked_stripe(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db,  # noqa: ANN001
    auth_headers_with_db: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Credits checkout should return URL and session_id when Stripe is mocked."""
    from src import config as config_module

    # Enable Stripe in settings
    monkeypatch.setattr(
        config_module.settings,
        "STRIPE_SECRET_KEY",
        "sk_test_dummy",
        raising=False,
    )

    org_id = str(uuid4())
    await _create_org_with_owner(integration_db, org_id=org_id, user_id=test_user_with_db.id)

    # Provide a minimal Stripe mock that returns a session with id/url
    class _FakeSession:
        def __init__(self) -> None:
            self.id = "cs_test_123"
            self.url = "https://example.com/checkout"

    class _FakeCheckout:
        def __init__(self) -> None:
            self.Session = type(
                "Session",
                (),
                {"create": staticmethod(lambda **kwargs: _FakeSession())},  # noqa: ARG001
            )

    class _FakeStripeError(Exception):
        """Minimal StripeError for except stripe.error.StripeError in routes."""

    class _FakeStripeErrorModule:
        StripeError = _FakeStripeError

    class _FakeCustomer:
        id = "cus_test_123"

    class _FakeCustomerModule:
        @staticmethod
        def create(**kwargs: Any) -> _FakeCustomer:
            return _FakeCustomer()

    class _FakeStripe:
        def __init__(self) -> None:
            self.api_key: str | None = None
            self.checkout = _FakeCheckout()
            self.Customer = _FakeCustomerModule
            self.error = _FakeStripeErrorModule()

    monkeypatch.setattr(org_billing_module, "stripe", _FakeStripe())

    resp = await test_client.post(
        f"/api/organizations/{org_id}/billing/checkout/credits",
        headers=auth_headers_with_db,
        json={"amount_cents": 5000},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["session_id"] == "cs_test_123"
    assert data["url"].startswith("https://")


@pytest.mark.asyncio
async def test_update_seats_cannot_reduce_below_member_count(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db,  # noqa: ANN001
    auth_headers_with_db: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """update-seats should reject requests that set seats < current members."""
    from src import config as config_module

    monkeypatch.setattr(
        config_module.settings, "STRIPE_SECRET_KEY", "sk_test_dummy", raising=False
    )
    org_id = str(uuid4())
    org = await _create_org_with_owner(integration_db, org_id=org_id, user_id=test_user_with_db.id)

    # Create a second user and add as member to drive member_count > requested seat_count
    from src.database.models import User

    other_user_id = str(uuid4())
    other_user = User(
        id=other_user_id,
        email=f"other-{other_user_id}@example.com",
        name="Other",
        password_hash="hash",
        is_active=True,
        role="member",
    )
    integration_db.add(other_user)
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["users"].append(other_user_id)
    another_member = OrganizationMember(
        organization_id=org.id,
        user_id=other_user_id,
        role="member",
    )
    integration_db.add(another_member)

    # Create an active subscription with >1 seats so endpoint logic can proceed
    now = datetime.now(UTC)
    plan = SubscriptionPlan(
        name="Org Plan",
        slug=f"org-plan-{uuid4()}",
        price_monthly_cents=1000,
        price_yearly_cents=10_000,
        tokens_included=0,
        compute_credits_cents_included=0,
        storage_gb_included=0,
        max_agents=1,
        max_sessions=1,
        max_team_members=10,
        features={},
    )
    integration_db.add(plan)
    await integration_db.flush()

    subscription = OrganizationSubscription(
        organization_id=org.id,
        plan_id=plan.id,
        status="active",
        billing_cycle="monthly",
        seat_count=3,
        current_period_start=now,
        current_period_end=now + timedelta(days=30),
    )
    integration_db.add(subscription)
    await integration_db.commit()

    # There are 2 members, so requesting 1 seat should fail
    resp = await test_client.post(
        f"/api/organizations/{org_id}/billing/update-seats",
        headers=auth_headers_with_db,
        json={"seat_count": 1},
    )
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert "Cannot reduce seats below current member count" in detail


@pytest.mark.asyncio
async def test_get_org_subscription_returns_null_when_no_subscription(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db,  # noqa: ANN001
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET subscription when org has no active subscription should return null."""
    org_id = str(uuid4())
    await _create_org_with_owner(
        integration_db, org_id=org_id, user_id=test_user_with_db.id
    )

    resp = await test_client.get(
        f"/api/organizations/{org_id}/billing/subscription",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 200
    # No subscription -> null body
    assert resp.json() is None


@pytest.mark.asyncio
async def test_get_org_subscription_requires_owner(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db,  # noqa: ANN001
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET subscription as non-owner (member) should return 403."""
    from jose import jwt as jose_jwt

    from src.config import settings
    from src.database.models import User

    org_id = str(uuid4())
    await _create_org_with_owner(integration_db, org_id=org_id, user_id=test_user_with_db.id)

    # Create a second user (member, not owner)
    member_user = User(
        id=str(uuid4()),
        email=f"member-{uuid4().hex[:8]}@example.com",
        name="Member",
        password_hash="hash",
        is_active=True,
        role="member",
    )
    integration_db.add(member_user)
    integration_db.add(
        OrganizationMember(organization_id=org_id, user_id=member_user.id, role="member")
    )
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["users"].append(member_user.id)
    await integration_db.commit()

    member_token = jose_jwt.encode(
        {
            "sub": member_user.id,
            "email": member_user.email,
            "jti": str(uuid4()),
            "exp": datetime.now(UTC).timestamp() + 3600,
        },
        settings.JWT_SECRET_KEY,
        algorithm="HS256",
    )
    member_headers = {
        "Authorization": f"Bearer {member_token}",
        "X-Requested-With": "XMLHttpRequest",
    }

    resp = await test_client.get(
        f"/api/organizations/{org_id}/billing/subscription",
        headers=member_headers,
    )
    assert resp.status_code == 403
    assert "Only organization owners" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_list_org_payment_methods_empty_when_no_stripe_customer(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db,  # noqa: ANN001
    auth_headers_with_db: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """List payment methods when org has no Stripe customer should return empty list."""
    from src import config as config_module

    monkeypatch.setattr(
        config_module.settings, "STRIPE_SECRET_KEY", "sk_test_dummy", raising=False
    )

    org_id = str(uuid4())
    org = await _create_org_with_owner(
        integration_db, org_id=org_id, user_id=test_user_with_db.id
    )
    assert org.stripe_customer_id is None

    resp = await test_client.get(
        f"/api/organizations/{org_id}/billing/payment-methods",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["payment_methods"] == []
    assert data["default_payment_method_id"] is None


# ============== GET subscription success, portal, cancel, usage, invoices, transactions ==============


@pytest.mark.asyncio
async def test_get_org_subscription_returns_data_when_subscription_exists(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db,  # noqa: ANN001
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET subscription when org has active subscription returns subscription data."""
    org_id = str(uuid4())
    await _create_org_with_owner(
        integration_db, org_id=org_id, user_id=test_user_with_db.id
    )

    now = datetime.now(UTC)
    plan = SubscriptionPlan(
        name="Pro Plan",
        slug=f"pro-{uuid4()}",
        price_monthly_cents=2900,
        price_yearly_cents=29_000,
        tokens_included=0,
        compute_credits_cents_included=0,
        storage_gb_included=0,
        max_agents=2,
        max_sessions=5,
        max_team_members=5,
        features={},
    )
    integration_db.add(plan)
    await integration_db.flush()

    sub = OrganizationSubscription(
        organization_id=org_id,
        plan_id=plan.id,
        status="active",
        billing_cycle="monthly",
        seat_count=2,
        current_period_start=now,
        current_period_end=now + timedelta(days=30),
        cancel_at_period_end=False,
    )
    integration_db.add(sub)
    await integration_db.commit()

    resp = await test_client.get(
        f"/api/organizations/{org_id}/billing/subscription",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data is not None
    assert data["plan_name"] == "Pro Plan"
    assert data["plan_slug"] == plan.slug
    assert data["status"] == "active"
    assert data["seat_count"] == 2
    assert "current_period_start" in data
    assert "current_period_end" in data


@pytest.mark.asyncio
async def test_org_portal_returns_503_when_stripe_not_configured(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db,  # noqa: ANN001
    auth_headers_with_db: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """POST portal when Stripe is not configured returns 503."""
    from src import config as config_module

    monkeypatch.setattr(
        config_module.settings, "STRIPE_SECRET_KEY", "", raising=False
    )
    org_id = str(uuid4())
    await _create_org_with_owner(
        integration_db, org_id=org_id, user_id=test_user_with_db.id
    )

    resp = await test_client.post(
        f"/api/organizations/{org_id}/billing/portal",
        json={},
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 503
    assert "Stripe" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_cancel_subscription_returns_404_when_no_subscription(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db,  # noqa: ANN001
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST cancel-subscription when org has no subscription returns 404."""
    org_id = str(uuid4())
    await _create_org_with_owner(
        integration_db, org_id=org_id, user_id=test_user_with_db.id
    )

    resp = await test_client.post(
        f"/api/organizations/{org_id}/billing/cancel-subscription",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 404
    assert "No active subscription" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_cancel_subscription_success_when_subscription_exists(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db,  # noqa: ANN001
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST cancel-subscription when org has active subscription (no Stripe id) succeeds."""
    org_id = str(uuid4())
    await _create_org_with_owner(
        integration_db, org_id=org_id, user_id=test_user_with_db.id
    )

    now = datetime.now(UTC)
    plan = SubscriptionPlan(
        name="Basic",
        slug=f"basic-{uuid4()}",
        price_monthly_cents=0,
        price_yearly_cents=0,
        tokens_included=0,
        compute_credits_cents_included=0,
        storage_gb_included=0,
        max_agents=1,
        max_sessions=1,
        max_team_members=1,
        features={},
    )
    integration_db.add(plan)
    await integration_db.flush()

    sub = OrganizationSubscription(
        organization_id=org_id,
        plan_id=plan.id,
        status="active",
        billing_cycle="monthly",
        seat_count=1,
        current_period_start=now,
        current_period_end=now + timedelta(days=30),
        cancel_at_period_end=False,
        stripe_subscription_id=None,  # no Stripe call
    )
    integration_db.add(sub)
    await integration_db.commit()

    resp = await test_client.post(
        f"/api/organizations/{org_id}/billing/cancel-subscription",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 200
    assert "canceled" in resp.json()["message"].lower() or "end" in resp.json()["message"].lower()


@pytest.mark.asyncio
async def test_get_org_usage_returns_structure(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db,  # noqa: ANN001
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET usage returns usage breakdown structure (can be empty)."""
    org_id = str(uuid4())
    await _create_org_with_owner(
        integration_db, org_id=org_id, user_id=test_user_with_db.id
    )

    resp = await test_client.get(
        f"/api/organizations/{org_id}/billing/usage",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "period_start" in data and "period_end" in data
    assert "total_tokens" in data and "total_cost_cents" in data
    assert "by_model" in data and "by_member" in data and "by_session" in data


@pytest.mark.asyncio
async def test_list_org_invoices_returns_empty_when_no_stripe_customer(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db,  # noqa: ANN001
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET invoices when org has no Stripe customer returns empty list."""
    org_id = str(uuid4())
    await _create_org_with_owner(
        integration_db, org_id=org_id, user_id=test_user_with_db.id
    )
    # org.stripe_customer_id is None by default

    resp = await test_client.get(
        f"/api/organizations/{org_id}/billing/invoices",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_org_transactions_returns_list(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db,  # noqa: ANN001
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET transactions returns list (can be empty)."""
    org_id = str(uuid4())
    await _create_org_with_owner(
        integration_db, org_id=org_id, user_id=test_user_with_db.id
    )

    resp = await test_client.get(
        f"/api/organizations/{org_id}/billing/transactions",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
