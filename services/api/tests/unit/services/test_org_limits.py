"""Unit tests for organization limits service.

Tests resource limit enforcement for organization members.
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.services.org_limits import (
    FeatureAccessDeniedError,
    InstanceTypeAccessDeniedError,
    LimitExceededError,
    LimitStatus,
    ModelAccessDeniedError,
    OrgLimitsService,
)


@pytest.fixture
def mock_db():
    """Mock database session."""
    db = AsyncMock()
    # Mock the execute().scalar_one_or_none() chain for subscription query
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None  # No subscription by default
    db.execute.return_value = mock_result
    return db


@pytest.fixture
def mock_member():
    """Mock organization member."""
    member = MagicMock()
    member.user_id = "user123"
    member.organization_id = "org123"
    member.spending_limit_cents = 10000
    member.current_spending_cents = 5000
    member.billing_period_spending_cents = 3000
    member.allocated_credits_cents = 20000
    member.used_credits_cents = 5000
    member.allowed_models = ["gpt-4", "claude-3-opus"]
    member.allowed_instance_types = ["cpu-small", "gpu-t4"]
    member.storage_limit_gb = 100
    member.feature_access = {"mcp_servers": True}
    member.is_blocked = False
    member.blocked_reason = None
    member.billing_period_start = datetime.now(UTC)
    member.blocked_at = None
    return member


@pytest.fixture
def mock_org():
    """Mock organization."""
    org = MagicMock()
    org.id = "org123"
    org.credit_model = "pooled"
    org.credit_pool_cents = 100000
    org.default_allowed_models = ["gpt-4"]
    org.default_allowed_instance_types = ["cpu-small"]
    org.default_storage_limit_gb = 50
    org.default_feature_access = {"mcp_servers": False}
    return org


@pytest.mark.unit
def test_limit_exceeded_error():
    """Test LimitExceededError exception."""
    error = LimitExceededError("spending", 5000, 10000)

    assert error.limit_type == "spending"
    assert error.current == 5000
    assert error.limit == 10000
    assert "spending limit exceeded: 5000/10000" in error.message


@pytest.mark.unit
def test_model_access_denied_error():
    """Test ModelAccessDeniedError exception."""
    error = ModelAccessDeniedError("gpt-4-turbo", ["gpt-4", "claude-3-opus"])

    assert error.model == "gpt-4-turbo"
    assert error.allowed_models == ["gpt-4", "claude-3-opus"]
    assert "gpt-4-turbo" in str(error)


@pytest.mark.unit
def test_instance_type_access_denied_error():
    """Test InstanceTypeAccessDeniedError exception."""
    error = InstanceTypeAccessDeniedError("gpu-a100", ["gpu-t4"])

    assert error.instance_type == "gpu-a100"
    assert error.allowed_types == ["gpu-t4"]


@pytest.mark.unit
def test_feature_access_denied_error():
    """Test FeatureAccessDeniedError exception."""
    error = FeatureAccessDeniedError("custom_agents")

    assert error.feature == "custom_agents"
    assert "custom_agents" in str(error)


@pytest.mark.unit
def test_limit_status_is_at_limit_blocked():
    """Test LimitStatus.is_at_limit when member is blocked."""
    status = LimitStatus(
        spending_limit_cents=10000,
        current_spending_cents=5000,
        remaining_spending_cents=5000,
        allocated_credits_cents=20000,
        used_credits_cents=5000,
        remaining_allocated_cents=15000,
        billing_period_spending_cents=3000,
        allowed_models=None,
        allowed_instance_types=None,
        storage_limit_gb=None,
        feature_access=None,
        is_blocked=True,
        blocked_reason="Test",
        credit_model="pooled",
    )

    assert status.is_at_limit is True


@pytest.mark.unit
def test_limit_status_is_at_limit_allocated_exhausted():
    """Test LimitStatus.is_at_limit for allocated model with exhausted credits."""
    status = LimitStatus(
        spending_limit_cents=10000,
        current_spending_cents=5000,
        remaining_spending_cents=5000,
        allocated_credits_cents=10000,
        used_credits_cents=10000,
        remaining_allocated_cents=0,
        billing_period_spending_cents=0,
        allowed_models=None,
        allowed_instance_types=None,
        storage_limit_gb=None,
        feature_access=None,
        is_blocked=False,
        blocked_reason=None,
        credit_model="allocated",
    )

    assert status.is_at_limit is True


@pytest.mark.unit
def test_limit_status_is_at_limit_spending_exceeded():
    """Test LimitStatus.is_at_limit for spending limit exceeded."""
    status = LimitStatus(
        spending_limit_cents=10000,
        current_spending_cents=10000,
        remaining_spending_cents=0,
        allocated_credits_cents=20000,
        used_credits_cents=5000,
        remaining_allocated_cents=15000,
        billing_period_spending_cents=10000,
        allowed_models=None,
        allowed_instance_types=None,
        storage_limit_gb=None,
        feature_access=None,
        is_blocked=False,
        blocked_reason=None,
        credit_model="pooled",
    )

    assert status.is_at_limit is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_limit_status_pooled(mock_db, mock_member, mock_org):
    """Test getting limit status for pooled credit model."""
    service = OrgLimitsService(mock_db)

    status = await service.get_limit_status(mock_member, mock_org)

    assert status.spending_limit_cents == 10000
    assert status.current_spending_cents == 5000
    assert status.remaining_spending_cents == 5000
    assert status.credit_model == "pooled"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_limit_status_usage_based(mock_db, mock_member, mock_org):
    """Test getting limit status for usage-based credit model."""
    mock_org.credit_model = "usage_based"
    service = OrgLimitsService(mock_db)

    status = await service.get_limit_status(mock_member, mock_org)

    assert status.remaining_spending_cents == 7000  # 10000 - 3000


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_limit_status_uses_org_defaults(mock_db, mock_member, mock_org):
    """Test getting limit status uses org defaults when member has none."""
    mock_member.allowed_models = None
    mock_member.allowed_instance_types = None
    service = OrgLimitsService(mock_db)

    status = await service.get_limit_status(mock_member, mock_org)

    assert status.allowed_models == ["gpt-4"]
    assert status.allowed_instance_types == ["cpu-small"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_spending_limit_blocked(mock_db, mock_member, mock_org):
    """Test checking spending limit when member is blocked."""
    mock_member.is_blocked = True
    mock_member.blocked_reason = "Test block"
    service = OrgLimitsService(mock_db)

    with pytest.raises(LimitExceededError) as exc_info:
        await service.check_spending_limit(mock_member, mock_org, 100)

    assert exc_info.value.limit_type == "blocked"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_spending_limit_pooled_individual_exceeded(mock_db, mock_member, mock_org):
    """Test checking spending limit for pooled model with individual limit exceeded."""
    mock_member.current_spending_cents = 9500
    service = OrgLimitsService(mock_db)

    with pytest.raises(LimitExceededError) as exc_info:
        await service.check_spending_limit(mock_member, mock_org, 600)

    assert exc_info.value.limit_type == "spending"
    assert "Individual spending limit" in exc_info.value.message


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_spending_limit_pooled_org_pool_exhausted(mock_db, mock_member, mock_org):
    """Test checking spending limit for pooled model with org pool exhausted."""
    mock_org.credit_pool_cents = 50
    service = OrgLimitsService(mock_db)

    with pytest.raises(LimitExceededError) as exc_info:
        await service.check_spending_limit(mock_member, mock_org, 100)

    assert exc_info.value.limit_type == "organization_pool"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_spending_limit_allocated_exhausted(mock_db, mock_member, mock_org):
    """Test checking spending limit for allocated model with exhausted credits."""
    mock_org.credit_model = "allocated"
    mock_member.allocated_credits_cents = 10000
    mock_member.used_credits_cents = 9500
    service = OrgLimitsService(mock_db)

    with pytest.raises(LimitExceededError) as exc_info:
        await service.check_spending_limit(mock_member, mock_org, 600)

    assert exc_info.value.limit_type == "allocated_credits"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_spending_limit_usage_based_exceeded(mock_db, mock_member, mock_org):
    """Test checking spending limit for usage-based model exceeded."""
    mock_org.credit_model = "usage_based"
    mock_member.billing_period_spending_cents = 9500
    service = OrgLimitsService(mock_db)

    with pytest.raises(LimitExceededError) as exc_info:
        await service.check_spending_limit(mock_member, mock_org, 600)

    assert exc_info.value.limit_type == "spending"
    assert "Billing period" in exc_info.value.message


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_spending_limit_success(mock_db, mock_member, mock_org):
    """Test successful spending limit check."""
    service = OrgLimitsService(mock_db)

    result = await service.check_spending_limit(mock_member, mock_org, 1000)

    assert result is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_model_access_allowed(mock_db, mock_member, mock_org):
    """Test checking model access when allowed."""
    service = OrgLimitsService(mock_db)

    result = await service.check_model_access(mock_member, mock_org, "gpt-4")

    assert result is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_model_access_denied(mock_db, mock_member, mock_org):
    """Test checking model access when denied."""
    service = OrgLimitsService(mock_db)

    with pytest.raises(ModelAccessDeniedError) as exc_info:
        await service.check_model_access(mock_member, mock_org, "gpt-4-turbo")

    assert exc_info.value.model == "gpt-4-turbo"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_model_access_no_restrictions(mock_db, mock_member, mock_org):
    """Test checking model access when no restrictions."""
    mock_member.allowed_models = None
    mock_org.default_allowed_models = None
    service = OrgLimitsService(mock_db)

    result = await service.check_model_access(mock_member, mock_org, "any-model")

    assert result is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_instance_type_access_allowed(mock_db, mock_member, mock_org):
    """Test checking instance type access when allowed."""
    service = OrgLimitsService(mock_db)

    result = await service.check_instance_type_access(mock_member, mock_org, "cpu-small")

    assert result is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_instance_type_access_denied(mock_db, mock_member, mock_org):
    """Test checking instance type access when denied."""
    service = OrgLimitsService(mock_db)

    with pytest.raises(InstanceTypeAccessDeniedError) as exc_info:
        await service.check_instance_type_access(mock_member, mock_org, "gpu-a100")

    assert exc_info.value.instance_type == "gpu-a100"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_feature_access_allowed(mock_db, mock_member, mock_org):
    """Test checking feature access when allowed."""
    service = OrgLimitsService(mock_db)

    result = await service.check_feature_access(mock_member, mock_org, "mcp_servers")

    assert result is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_feature_access_denied(mock_db, mock_member, mock_org):
    """Test checking feature access when denied."""
    mock_member.feature_access = {"custom_agents": False}
    service = OrgLimitsService(mock_db)

    with pytest.raises(FeatureAccessDeniedError) as exc_info:
        await service.check_feature_access(mock_member, mock_org, "custom_agents")

    assert exc_info.value.feature == "custom_agents"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_feature_access_default_true(mock_db, mock_member, mock_org):
    """Test checking feature access defaults to True if not specified."""
    mock_member.feature_access = {}
    service = OrgLimitsService(mock_db)

    result = await service.check_feature_access(mock_member, mock_org, "unknown_feature")

    assert result is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_unblock_member(mock_db, mock_member):
    """Test manually unblocking a member."""
    mock_member.is_blocked = True
    mock_member.blocked_reason = "Test"
    mock_db.commit = AsyncMock()

    service = OrgLimitsService(mock_db)

    await service.unblock_member(mock_member, "Manual unblock")

    assert mock_member.is_blocked is False
    assert mock_member.blocked_reason is None
    assert mock_member.blocked_at is None
    mock_db.commit.assert_called_once()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_reset_billing_period(mock_db, mock_member, mock_org):
    """Test resetting member billing period."""
    mock_member.billing_period_spending_cents = 5000
    mock_db.commit = AsyncMock()

    service = OrgLimitsService(mock_db)

    await service.reset_billing_period(mock_member, mock_org)

    assert mock_member.billing_period_spending_cents == 0
    assert mock_member.billing_period_start is not None
    mock_db.commit.assert_called_once()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_reset_billing_period_unblocks_if_needed(mock_db, mock_member, mock_org):
    """Test reset billing period unblocks member if blocked due to billing limit."""
    mock_member.is_blocked = True
    mock_member.blocked_reason = "Billing period spending limit reached"
    mock_db.commit = AsyncMock()

    service = OrgLimitsService(mock_db)

    await service.reset_billing_period(mock_member, mock_org)

    assert mock_member.is_blocked is False
    assert mock_member.blocked_reason is None
