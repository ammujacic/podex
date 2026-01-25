"""Unit tests for credit enforcement service.

Tests credit checks for token and compute quotas with various scenarios.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.services.credit_enforcement import (
    CreditCheckResult,
    CreditErrorCode,
    check_credits_available,
    create_billing_error_detail,
    get_users_with_exhausted_credits,
)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_credits_within_quota():
    """Test user within plan quota can proceed."""
    mock_db = AsyncMock()

    # Mock subscription and plan
    mock_subscription = MagicMock(plan_id="plan123", status="active")
    mock_plan = MagicMock(
        tokens_included=1000000,
        overage_allowed=False,
    )

    # Mock quota - user has used 500k of 1M
    mock_quota = MagicMock(
        limit_value=1000000,
        current_usage=500000,
        overage_allowed=False,
    )

    # Mock execute results
    mock_db.execute = AsyncMock(
        side_effect=[
            # Subscription query
            MagicMock(scalar_one_or_none=lambda: mock_subscription),
            # Plan query
            MagicMock(scalar_one_or_none=lambda: mock_plan),
            # Credit balance query
            MagicMock(scalar_one_or_none=lambda: MagicMock(balance_cents=0)),
            # Quota query
            MagicMock(scalar_one_or_none=lambda: mock_quota),
        ]
    )

    result = await check_credits_available(mock_db, "user123", "tokens")

    assert result.can_proceed is True
    assert result.quota_remaining == 500000
    assert result.credits_remaining == 0
    assert result.overage_allowed is False


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_credits_no_subscription_with_credits():
    """Test user without subscription but with prepaid credits can proceed."""
    mock_db = AsyncMock()

    # Mock no subscription
    mock_db.execute = AsyncMock(
        side_effect=[
            # Subscription query
            MagicMock(scalar_one_or_none=lambda: None),
            # Credit balance query
            MagicMock(scalar_one_or_none=lambda: MagicMock(balance_cents=10000)),
            # Quota query (still called even without subscription)
            MagicMock(scalar_one_or_none=lambda: None),
        ]
    )

    result = await check_credits_available(mock_db, "user123", "tokens")

    assert result.can_proceed is True
    assert result.quota_remaining == 0
    assert result.credits_remaining == 10000
    assert result.overage_allowed is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_credits_no_subscription_no_credits():
    """Test user without subscription and no credits cannot proceed."""
    mock_db = AsyncMock()

    # Mock no subscription and no credits
    mock_db.execute = AsyncMock(
        side_effect=[
            # Subscription query
            MagicMock(scalar_one_or_none=lambda: None),
            # Credit balance query
            MagicMock(scalar_one_or_none=lambda: None),
            # Quota query (still called even without subscription)
            MagicMock(scalar_one_or_none=lambda: None),
        ]
    )

    result = await check_credits_available(mock_db, "user123", "tokens")

    assert result.can_proceed is False
    assert result.quota_remaining == 0
    assert result.credits_remaining == 0
    assert result.error_code == CreditErrorCode.SUBSCRIPTION_REQUIRED


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_credits_no_quota_record_first_time_user():
    """Test new user with subscription but no quota record yet."""
    mock_db = AsyncMock()

    mock_subscription = MagicMock(plan_id="plan123", status="active")
    mock_plan = MagicMock(
        tokens_included=1000000,
        compute_credits_cents_included=5000,
        overage_allowed=True,
    )

    # Mock no quota record yet
    mock_db.execute = AsyncMock(
        side_effect=[
            # Subscription query
            MagicMock(scalar_one_or_none=lambda: mock_subscription),
            # Plan query
            MagicMock(scalar_one_or_none=lambda: mock_plan),
            # Credit balance query
            MagicMock(scalar_one_or_none=lambda: MagicMock(balance_cents=0)),
            # Quota query - no record yet
            MagicMock(scalar_one_or_none=lambda: None),
        ]
    )

    result = await check_credits_available(mock_db, "user123", "tokens")

    assert result.can_proceed is True
    assert result.quota_remaining == 1000000  # Plan's tokens_included
    assert result.overage_allowed is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_credits_quota_exceeded_with_credits():
    """Test user exceeded quota but has prepaid credits."""
    mock_db = AsyncMock()

    mock_subscription = MagicMock(plan_id="plan123", status="active")
    mock_plan = MagicMock(
        tokens_included=1000000,
        overage_allowed=True,
    )

    # Mock quota exceeded
    mock_quota = MagicMock(
        limit_value=1000000,
        current_usage=1500000,  # Over limit
        overage_allowed=True,
    )

    mock_db.execute = AsyncMock(
        side_effect=[
            # Subscription query
            MagicMock(scalar_one_or_none=lambda: mock_subscription),
            # Plan query
            MagicMock(scalar_one_or_none=lambda: mock_plan),
            # Credit balance query - has credits
            MagicMock(scalar_one_or_none=lambda: MagicMock(balance_cents=5000)),
            # Quota query
            MagicMock(scalar_one_or_none=lambda: mock_quota),
        ]
    )

    result = await check_credits_available(mock_db, "user123", "tokens")

    assert result.can_proceed is True
    assert result.quota_remaining == 0
    assert result.credits_remaining == 5000
    assert result.overage_allowed is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_credits_quota_exceeded_no_credits():
    """Test user exceeded quota with no prepaid credits."""
    mock_db = AsyncMock()

    mock_subscription = MagicMock(plan_id="plan123", status="active")
    mock_plan = MagicMock(
        tokens_included=1000000,
        overage_allowed=True,
    )

    # Mock quota exceeded
    mock_quota = MagicMock(
        limit_value=1000000,
        current_usage=1500000,
        overage_allowed=True,
    )

    mock_db.execute = AsyncMock(
        side_effect=[
            # Subscription query
            MagicMock(scalar_one_or_none=lambda: mock_subscription),
            # Plan query
            MagicMock(scalar_one_or_none=lambda: mock_plan),
            # Credit balance query - no credits
            MagicMock(scalar_one_or_none=lambda: MagicMock(balance_cents=0)),
            # Quota query
            MagicMock(scalar_one_or_none=lambda: mock_quota),
        ]
    )

    result = await check_credits_available(mock_db, "user123", "tokens")

    assert result.can_proceed is False
    assert result.quota_remaining == 0
    assert result.error_code == CreditErrorCode.QUOTA_EXCEEDED_NO_CREDITS


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_credits_overage_not_allowed():
    """Test user exceeded quota and overage not allowed."""
    mock_db = AsyncMock()

    mock_subscription = MagicMock(plan_id="plan123", status="active")
    mock_plan = MagicMock(
        tokens_included=1000000,
        overage_allowed=False,
    )

    # Mock quota exceeded with overage not allowed
    mock_quota = MagicMock(
        limit_value=1000000,
        current_usage=1500000,
        overage_allowed=False,
    )

    mock_db.execute = AsyncMock(
        side_effect=[
            # Subscription query
            MagicMock(scalar_one_or_none=lambda: mock_subscription),
            # Plan query
            MagicMock(scalar_one_or_none=lambda: mock_plan),
            # Credit balance query
            MagicMock(scalar_one_or_none=lambda: MagicMock(balance_cents=5000)),
            # Quota query
            MagicMock(scalar_one_or_none=lambda: mock_quota),
        ]
    )

    result = await check_credits_available(mock_db, "user123", "tokens")

    assert result.can_proceed is False
    assert result.quota_remaining == 0
    assert result.credits_remaining == 5000
    assert result.overage_allowed is False
    assert result.error_code == CreditErrorCode.OVERAGE_NOT_ALLOWED


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_credits_compute_resource_type():
    """Test credit check for compute resources."""
    mock_db = AsyncMock()

    mock_subscription = MagicMock(plan_id="plan123", status="active")
    mock_plan = MagicMock(
        compute_credits_cents_included=10000,
        overage_allowed=False,
    )

    # Mock quota for compute_hours
    mock_quota = MagicMock(
        limit_value=10000,
        current_usage=5000,
        overage_allowed=False,
    )

    mock_db.execute = AsyncMock(
        side_effect=[
            # Subscription query
            MagicMock(scalar_one_or_none=lambda: mock_subscription),
            # Plan query
            MagicMock(scalar_one_or_none=lambda: mock_plan),
            # Credit balance query
            MagicMock(scalar_one_or_none=lambda: MagicMock(balance_cents=0)),
            # Quota query
            MagicMock(scalar_one_or_none=lambda: mock_quota),
        ]
    )

    result = await check_credits_available(mock_db, "user123", "compute")

    assert result.can_proceed is True
    assert result.quota_remaining == 5000


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_users_with_exhausted_credits():
    """Test getting users with exhausted credits."""
    mock_db = AsyncMock()

    # Mock query result with user IDs
    mock_result = MagicMock()
    mock_result.fetchall.return_value = [("user1",), ("user2",), ("user3",)]

    mock_db.execute = AsyncMock(return_value=mock_result)

    users = await get_users_with_exhausted_credits(mock_db, "tokens")

    assert len(users) == 3
    assert "user1" in users
    assert "user2" in users
    assert "user3" in users


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_users_with_exhausted_credits_empty():
    """Test getting users with exhausted credits when none exist."""
    mock_db = AsyncMock()

    # Mock empty result
    mock_result = MagicMock()
    mock_result.fetchall.return_value = []

    mock_db.execute = AsyncMock(return_value=mock_result)

    users = await get_users_with_exhausted_credits(mock_db, "compute")

    assert len(users) == 0


@pytest.mark.unit
def test_create_billing_error_detail():
    """Test creating billing error detail dict."""
    result = CreditCheckResult(
        can_proceed=False,
        quota_remaining=0,
        credits_remaining=1000,
        overage_allowed=True,
        error_code=CreditErrorCode.QUOTA_EXCEEDED_NO_CREDITS,
        error_message="Quota exceeded",
    )

    detail = create_billing_error_detail(result, "tokens")

    assert detail["error_code"] == CreditErrorCode.QUOTA_EXCEEDED_NO_CREDITS
    assert detail["message"] == "Quota exceeded"
    assert detail["quota_remaining"] == 0
    assert detail["credits_remaining"] == 1000
    assert detail["resource_type"] == "tokens"
    assert detail["upgrade_url"] == "/settings/plans"
    assert detail["add_credits_url"] == "/settings/billing"


@pytest.mark.unit
def test_create_billing_error_detail_custom_message():
    """Test creating billing error detail with custom message."""
    result = CreditCheckResult(
        can_proceed=False,
        quota_remaining=0,
        credits_remaining=0,
        overage_allowed=False,
        error_code=CreditErrorCode.SUBSCRIPTION_REQUIRED,
        error_message="Default message",
    )

    detail = create_billing_error_detail(result, "compute", custom_message="Custom error")

    assert detail["message"] == "Custom error"
    assert detail["resource_type"] == "compute"
