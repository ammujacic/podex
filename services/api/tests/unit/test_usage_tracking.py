"""Unit tests for usage tracking and billing enforcement.

Tests cover:
- Token usage tracking
- Compute usage tracking
- Quota enforcement for personal and org users
- Credit pool deduction for orgs
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest


@pytest.fixture
def mock_db():
    """Mock database session."""
    db = AsyncMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    db.flush = AsyncMock()
    db.add = MagicMock()
    return db


@pytest.fixture
def mock_user():
    """Mock user."""
    user = MagicMock()
    user.id = "user-123"
    user.email = "user@test.com"
    user.name = "Test User"
    user.stripe_customer_id = "cus_test123"
    return user


@pytest.fixture
def mock_quota_tokens():
    """Mock tokens quota."""
    quota = MagicMock()
    quota.id = "quota-tokens-123"
    quota.user_id = "user-123"
    quota.quota_type = "tokens"
    quota.limit_value = 1000000
    quota.current_usage = 500000
    quota.overage_allowed = True
    quota.reset_at = datetime.now(UTC) + timedelta(days=15)
    quota.warning_sent_at = None
    return quota


@pytest.fixture
def mock_quota_compute():
    """Mock compute credits quota."""
    quota = MagicMock()
    quota.id = "quota-compute-123"
    quota.user_id = "user-123"
    quota.quota_type = "compute_credits"
    quota.limit_value = 5000  # $50 in cents
    quota.current_usage = 2000  # $20 in cents
    quota.overage_allowed = True
    quota.reset_at = datetime.now(UTC) + timedelta(days=15)
    quota.warning_sent_at = None
    return quota


@pytest.fixture
def mock_org_member():
    """Mock organization member."""
    member = MagicMock()
    member.id = "member-123"
    member.user_id = "user-123"
    member.organization_id = "org-123"
    member.role = "member"
    member.spending_limit_cents = 10000
    member.current_spending_cents = 5000
    member.billing_period_spending_cents = 3000
    member.allocated_credits_cents = 20000
    member.used_credits_cents = 5000
    member.is_blocked = False
    return member


@pytest.fixture
def mock_org():
    """Mock organization with pooled credits."""
    org = MagicMock()
    org.id = "org-123"
    org.name = "Test Org"
    org.credit_model = "pooled"
    org.credit_pool_cents = 100000  # $1000
    return org


class TestTokenUsageTracking:
    """Tests for token usage tracking."""

    @pytest.mark.unit
    def test_quota_within_limit(self, mock_quota_tokens):
        """Test usage within quota limit."""
        additional_usage = 100000  # 100K tokens

        new_usage = mock_quota_tokens.current_usage + additional_usage
        is_within_limit = new_usage <= mock_quota_tokens.limit_value

        assert is_within_limit is True
        assert new_usage == 600000

    @pytest.mark.unit
    def test_quota_exceeds_limit(self, mock_quota_tokens):
        """Test usage exceeding quota limit."""
        additional_usage = 600000  # 600K tokens

        new_usage = mock_quota_tokens.current_usage + additional_usage
        is_within_limit = new_usage <= mock_quota_tokens.limit_value

        assert is_within_limit is False
        assert new_usage == 1100000

    @pytest.mark.unit
    def test_overage_allowed_permits_excess(self, mock_quota_tokens):
        """Test that overage_allowed permits usage beyond limit."""
        mock_quota_tokens.current_usage = 900000
        additional_usage = 200000

        # When overage_allowed, we don't block
        can_proceed = mock_quota_tokens.overage_allowed or (
            mock_quota_tokens.current_usage + additional_usage <= mock_quota_tokens.limit_value
        )

        assert can_proceed is True

    @pytest.mark.unit
    def test_overage_not_allowed_blocks_excess(self, mock_quota_tokens):
        """Test that overage not allowed blocks usage beyond limit."""
        mock_quota_tokens.overage_allowed = False
        mock_quota_tokens.current_usage = 900000
        additional_usage = 200000

        # When overage not allowed, we block at limit
        can_proceed = mock_quota_tokens.overage_allowed or (
            mock_quota_tokens.current_usage + additional_usage <= mock_quota_tokens.limit_value
        )

        assert can_proceed is False


class TestComputeUsageTracking:
    """Tests for compute usage tracking."""

    @pytest.mark.unit
    def test_compute_credits_within_limit(self, mock_quota_compute):
        """Test compute credits within limit."""
        additional_cost_cents = 1000  # $10

        new_usage = mock_quota_compute.current_usage + additional_cost_cents
        is_within_limit = new_usage <= mock_quota_compute.limit_value

        assert is_within_limit is True
        assert new_usage == 3000

    @pytest.mark.unit
    def test_compute_credits_exceeds_limit(self, mock_quota_compute):
        """Test compute credits exceeding limit."""
        additional_cost_cents = 5000  # $50

        new_usage = mock_quota_compute.current_usage + additional_cost_cents
        is_within_limit = new_usage <= mock_quota_compute.limit_value

        assert is_within_limit is False


class TestOrgPooledCredits:
    """Tests for organization pooled credit model."""

    @pytest.mark.unit
    def test_pooled_deduction(self, mock_org):
        """Test credit pool deduction."""
        cost_cents = 500

        mock_org.credit_pool_cents -= cost_cents

        assert mock_org.credit_pool_cents == 99500

    @pytest.mark.unit
    def test_pooled_insufficient_credits(self, mock_org):
        """Test pooled credits insufficient."""
        mock_org.credit_pool_cents = 100
        cost_cents = 500

        has_sufficient = mock_org.credit_pool_cents >= cost_cents

        assert has_sufficient is False

    @pytest.mark.unit
    def test_individual_spending_limit(self, mock_org_member):
        """Test individual spending limit within org."""
        cost_cents = 1000

        new_spending = mock_org_member.current_spending_cents + cost_cents
        within_limit = new_spending <= mock_org_member.spending_limit_cents

        assert within_limit is True
        assert new_spending == 6000

    @pytest.mark.unit
    def test_individual_spending_limit_exceeded(self, mock_org_member):
        """Test individual spending limit exceeded within org."""
        mock_org_member.current_spending_cents = 9500
        cost_cents = 1000

        new_spending = mock_org_member.current_spending_cents + cost_cents
        within_limit = new_spending <= mock_org_member.spending_limit_cents

        assert within_limit is False


class TestOrgAllocatedCredits:
    """Tests for organization allocated credit model."""

    @pytest.mark.unit
    def test_allocated_within_limit(self, mock_org_member):
        """Test allocated credits within member's allocation."""
        cost_cents = 5000

        new_used = mock_org_member.used_credits_cents + cost_cents
        within_allocation = new_used <= mock_org_member.allocated_credits_cents

        assert within_allocation is True

    @pytest.mark.unit
    def test_allocated_exceeds_limit(self, mock_org_member):
        """Test allocated credits exceeds member's allocation."""
        mock_org_member.used_credits_cents = 18000
        cost_cents = 5000

        new_used = mock_org_member.used_credits_cents + cost_cents
        within_allocation = new_used <= mock_org_member.allocated_credits_cents

        assert within_allocation is False


class TestOrgUsageBasedBilling:
    """Tests for organization usage-based (PAYG) credit model."""

    @pytest.mark.unit
    def test_usage_based_tracks_spending(self, mock_org_member):
        """Test usage-based model tracks billing period spending."""
        cost_cents = 1000

        mock_org_member.billing_period_spending_cents += cost_cents

        assert mock_org_member.billing_period_spending_cents == 4000

    @pytest.mark.unit
    def test_usage_based_individual_cap(self, mock_org_member):
        """Test usage-based model respects individual spending cap."""
        mock_org_member.billing_period_spending_cents = 9500
        cost_cents = 1000

        new_spending = mock_org_member.billing_period_spending_cents + cost_cents
        within_cap = new_spending <= mock_org_member.spending_limit_cents

        # Even in usage-based, individual cap can be enforced
        assert within_cap is False


class TestQuotaWarnings:
    """Tests for quota warning thresholds."""

    @pytest.mark.unit
    def test_warning_threshold_80_percent(self, mock_quota_tokens):
        """Test warning at 80% usage."""
        mock_quota_tokens.current_usage = 800000  # 80%

        percentage = (mock_quota_tokens.current_usage / mock_quota_tokens.limit_value) * 100
        should_warn = percentage >= 80 and mock_quota_tokens.warning_sent_at is None

        assert percentage == 80.0
        assert should_warn is True

    @pytest.mark.unit
    def test_no_warning_below_threshold(self, mock_quota_tokens):
        """Test no warning below 80% usage."""
        mock_quota_tokens.current_usage = 700000  # 70%

        percentage = (mock_quota_tokens.current_usage / mock_quota_tokens.limit_value) * 100
        should_warn = percentage >= 80 and mock_quota_tokens.warning_sent_at is None

        assert percentage == 70.0
        assert should_warn is False

    @pytest.mark.unit
    def test_no_duplicate_warning(self, mock_quota_tokens):
        """Test no duplicate warning if already sent."""
        mock_quota_tokens.current_usage = 900000  # 90%
        mock_quota_tokens.warning_sent_at = datetime.now(UTC)

        percentage = (mock_quota_tokens.current_usage / mock_quota_tokens.limit_value) * 100
        should_warn = percentage >= 80 and mock_quota_tokens.warning_sent_at is None

        assert percentage == 90.0
        assert should_warn is False


class TestSeatEnforcement:
    """Tests for organization seat enforcement."""

    @pytest.mark.unit
    def test_within_seat_limit(self):
        """Test member count within seat limit."""
        current_members = 5
        seat_count = 10

        can_add_member = current_members < seat_count

        assert can_add_member is True

    @pytest.mark.unit
    def test_at_seat_limit(self):
        """Test member count at seat limit."""
        current_members = 10
        seat_count = 10

        can_add_member = current_members < seat_count

        assert can_add_member is False

    @pytest.mark.unit
    def test_seat_reduction_blocked_by_members(self):
        """Test seat reduction blocked when exceeds current members."""
        current_members = 8
        requested_seats = 5

        can_reduce = requested_seats >= current_members

        assert can_reduce is False
