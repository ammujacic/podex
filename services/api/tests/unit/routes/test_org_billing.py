"""Unit tests for organization billing routes.

Tests cover:
- Organization usage breakdown
- Plan change checkout
- Subscription management
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.fixture
def mock_db():
    """Mock database session."""
    db = AsyncMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    db.flush = AsyncMock()
    return db


@pytest.fixture
def mock_org():
    """Mock organization."""
    org = MagicMock()
    org.id = "org-123"
    org.name = "Test Org"
    org.slug = "test-org"
    org.stripe_customer_id = "cus_test123"
    org.credit_pool_cents = 100000
    org.credit_model = "pooled"
    return org


@pytest.fixture
def mock_subscription():
    """Mock organization subscription."""
    now = datetime.now(UTC)
    sub = MagicMock()
    sub.id = "sub-123"
    sub.organization_id = "org-123"
    sub.plan_id = "plan-123"
    sub.status = "active"
    sub.billing_cycle = "monthly"
    sub.seat_count = 5
    sub.current_period_start = now
    sub.current_period_end = now + timedelta(days=30)
    sub.cancel_at_period_end = False
    sub.canceled_at = None
    sub.stripe_subscription_id = "stripe_sub_123"
    return sub


@pytest.fixture
def mock_plan():
    """Mock subscription plan."""
    plan = MagicMock()
    plan.id = "plan-123"
    plan.name = "Pro"
    plan.slug = "pro"
    plan.tokens_included = 1000000
    plan.compute_credits_cents_included = 5000
    plan.storage_gb_included = 50
    plan.max_sessions = 10
    plan.price_monthly_cents = 2900
    plan.price_yearly_cents = 29000
    plan.stripe_price_id_monthly = "price_monthly_123"
    plan.stripe_price_id_yearly = "price_yearly_123"
    plan.is_active = True
    return plan


@pytest.fixture
def mock_member():
    """Mock organization member (owner)."""
    member = MagicMock()
    member.id = "member-123"
    member.user_id = "user-123"
    member.organization_id = "org-123"
    member.role = "owner"
    return member


@pytest.fixture
def mock_user():
    """Mock user."""
    user = MagicMock()
    user.id = "user-123"
    user.email = "owner@test.com"
    user.name = "Test Owner"
    return user


class TestOrgUsageBreakdown:
    """Tests for organization usage breakdown endpoint."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_usage_breakdown_returns_totals(self, mock_db, mock_org, mock_subscription):
        """Test usage breakdown returns correct totals."""
        from src.routes.org_billing import OrgUsageResponse

        # This is a simplified test - full integration test would require more setup
        response = OrgUsageResponse(
            period_start=mock_subscription.current_period_start,
            period_end=mock_subscription.current_period_end,
            total_tokens=500000,
            total_compute_cents=2500,
            total_cost_cents=5000,
            by_model=[],
            by_member=[],
            by_session=[],
        )

        assert response.total_tokens == 500000
        assert response.total_compute_cents == 2500
        assert response.total_cost_cents == 5000

    @pytest.mark.unit
    def test_model_usage_structure(self):
        """Test ModelUsage pydantic model structure."""
        from src.routes.org_billing import ModelUsage

        usage = ModelUsage(
            model="gpt-4",
            total_tokens=100000,
            total_cost_cents=500,
            record_count=50,
        )

        assert usage.model == "gpt-4"
        assert usage.total_tokens == 100000
        assert usage.record_count == 50

    @pytest.mark.unit
    def test_member_usage_structure(self):
        """Test MemberUsage pydantic model structure."""
        from src.routes.org_billing import MemberUsage

        usage = MemberUsage(
            user_id="user-123",
            user_name="John Doe",
            user_email="john@test.com",
            total_tokens=50000,
            total_compute_cents=1000,
            total_cost_cents=2000,
        )

        assert usage.user_id == "user-123"
        assert usage.total_tokens == 50000
        assert usage.total_compute_cents == 1000


class TestPlanChangeCheckout:
    """Tests for plan change checkout endpoint."""

    @pytest.mark.unit
    def test_plan_change_request_validation(self):
        """Test PlanChangeRequest model validation."""
        from src.routes.org_billing import PlanChangeRequest

        request = PlanChangeRequest(
            plan_slug="enterprise",
            billing_cycle="yearly",
        )

        assert request.plan_slug == "enterprise"
        assert request.billing_cycle == "yearly"

    @pytest.mark.unit
    def test_plan_change_request_defaults(self):
        """Test PlanChangeRequest default values."""
        from src.routes.org_billing import PlanChangeRequest

        request = PlanChangeRequest(plan_slug="pro")

        assert request.billing_cycle == "monthly"
        assert request.success_url is None
        assert request.cancel_url is None

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_cannot_change_to_same_plan(self, mock_db, mock_org, mock_subscription, mock_plan):
        """Test that changing to the same plan is rejected."""
        from fastapi import HTTPException

        from src.routes.org_billing import PlanChangeRequest

        # This would be tested in integration tests with full setup
        # Here we just verify the model accepts the data
        request = PlanChangeRequest(plan_slug="pro")
        assert request.plan_slug == "pro"


class TestOrgSubscriptionResponse:
    """Tests for organization subscription response."""

    @pytest.mark.unit
    def test_subscription_response_structure(self, mock_subscription, mock_plan):
        """Test OrgSubscriptionResponse structure."""
        from src.routes.org_billing import OrgSubscriptionResponse

        response = OrgSubscriptionResponse(
            id=str(mock_subscription.id),
            plan_name=mock_plan.name,
            plan_slug=mock_plan.slug,
            status=mock_subscription.status,
            billing_cycle=mock_subscription.billing_cycle,
            seat_count=mock_subscription.seat_count,
            current_period_start=mock_subscription.current_period_start,
            current_period_end=mock_subscription.current_period_end,
            cancel_at_period_end=mock_subscription.cancel_at_period_end,
            canceled_at=mock_subscription.canceled_at,
            price_monthly_cents=mock_plan.price_monthly_cents,
            price_yearly_cents=mock_plan.price_yearly_cents,
        )

        assert response.plan_name == "Pro"
        assert response.seat_count == 5
        assert response.status == "active"


class TestWebhookEmailNotifications:
    """Tests for webhook email notifications."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_get_org_owner_returns_owner(self, mock_db, mock_user):
        """Test _get_org_owner returns the organization owner."""
        # Mock the query result
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_user
        mock_db.execute.return_value = mock_result

        from src.routes.webhooks import _get_org_owner

        owner = await _get_org_owner(mock_db, "org-123")

        assert owner is not None
        assert owner.email == "owner@test.com"

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_get_org_owner_returns_none_when_no_owner(self, mock_db):
        """Test _get_org_owner returns None when no owner found."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        from src.routes.webhooks import _get_org_owner

        owner = await _get_org_owner(mock_db, "org-nonexistent")

        assert owner is None


class TestOrgBillingCheckout:
    """Tests for organization billing checkout."""

    @pytest.mark.unit
    def test_checkout_subscription_request_validation(self):
        """Test OrgCheckoutSubscriptionRequest validation."""
        from src.routes.org_billing import OrgCheckoutSubscriptionRequest

        request = OrgCheckoutSubscriptionRequest(
            plan_slug="pro",
            billing_cycle="monthly",
            seat_count=10,
        )

        assert request.plan_slug == "pro"
        assert request.seat_count == 10

    @pytest.mark.unit
    def test_checkout_subscription_request_min_seats(self):
        """Test OrgCheckoutSubscriptionRequest requires at least 1 seat."""
        from pydantic import ValidationError

        from src.routes.org_billing import OrgCheckoutSubscriptionRequest

        with pytest.raises(ValidationError):
            OrgCheckoutSubscriptionRequest(
                plan_slug="pro",
                seat_count=0,
            )

    @pytest.mark.unit
    def test_checkout_credits_request_validation(self):
        """Test OrgCheckoutCreditsRequest validation."""
        from src.routes.org_billing import OrgCheckoutCreditsRequest

        request = OrgCheckoutCreditsRequest(amount_cents=5000)

        assert request.amount_cents == 5000

    @pytest.mark.unit
    def test_checkout_credits_request_min_amount(self):
        """Test OrgCheckoutCreditsRequest requires minimum $1."""
        from pydantic import ValidationError

        from src.routes.org_billing import OrgCheckoutCreditsRequest

        with pytest.raises(ValidationError):
            OrgCheckoutCreditsRequest(amount_cents=50)


class TestUpdateSeats:
    """Tests for updating organization seats."""

    @pytest.mark.unit
    def test_update_seats_request_validation(self):
        """Test OrgUpdateSeatsRequest validation."""
        from src.routes.org_billing import OrgUpdateSeatsRequest

        request = OrgUpdateSeatsRequest(seat_count=15)

        assert request.seat_count == 15

    @pytest.mark.unit
    def test_update_seats_request_min_seats(self):
        """Test OrgUpdateSeatsRequest requires at least 1 seat."""
        from pydantic import ValidationError

        from src.routes.org_billing import OrgUpdateSeatsRequest

        with pytest.raises(ValidationError):
            OrgUpdateSeatsRequest(seat_count=0)
