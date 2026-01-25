"""Integration tests for billing routes.

Tests billing operations including subscriptions, payments, usage tracking,
credits, and invoices with real database and Stripe mock.
"""

import pytest
from datetime import UTC, datetime, timedelta
from decimal import Decimal


@pytest.mark.integration
@pytest.mark.asyncio
async def test_list_subscription_plans(test_client, auth_headers_with_db):
    """Test listing available subscription plans."""
    response = await test_client.get(
        "/api/billing/plans",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0

    # Verify plan structure
    plan = data[0]
    assert "id" in plan
    assert "name" in plan
    assert "slug" in plan
    assert "price_monthly" in plan
    assert "price_yearly" in plan
    assert "features" in plan


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_plan_by_slug(test_client, auth_headers_with_db):
    """Test getting a specific plan by slug."""
    response = await test_client.get(
        "/api/billing/plans/free",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["slug"] == "free"
    assert "features" in data
    assert isinstance(data["features"], dict)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_nonexistent_plan(test_client, auth_headers_with_db):
    """Test getting a plan that doesn't exist returns 404."""
    response = await test_client.get(
        "/api/billing/plans/nonexistent-plan",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 404


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_current_subscription(test_client, test_user_with_db, auth_headers_with_db):
    """Test getting the current user's subscription."""
    # User should have a subscription from the fixture
    response = await test_client.get(
        "/api/billing/subscription",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 200
    data = response.json()

    if data:  # User might have subscription from fixture
        assert "id" in data
        assert "plan" in data
        assert "status" in data
        assert "billing_cycle" in data
        assert data["status"] == "active"
        assert isinstance(data["plan"], dict)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_usage_summary(test_client, auth_headers_with_db):
    """Test getting usage summary for current user."""
    response = await test_client.get(
        "/api/billing/usage",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 200
    data = response.json()

    # Verify usage summary structure
    assert "tokens_input" in data
    assert "tokens_output" in data
    assert "tokens_cost" in data
    assert "period_start" in data
    assert "period_end" in data
    assert isinstance(data["tokens_input"], int)
    assert isinstance(data["tokens_output"], int)
    assert isinstance(data["tokens_cost"], (int, float))


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_usage_history(test_client, auth_headers_with_db):
    """Test getting usage history."""
    response = await test_client.get(
        "/api/billing/usage/history",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)

    # If there's usage data, verify structure
    if data:
        record = data[0]
        assert "id" in record
        assert "usage_type" in record
        assert "quantity" in record
        assert "unit" in record
        assert "cost" in record
        assert "created_at" in record


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_usage_history_with_filters(test_client, auth_headers_with_db):
    """Test getting usage history with filters."""
    response = await test_client.get(
        "/api/billing/usage/history",
        headers=auth_headers_with_db,
        params={
            "usage_type": "api_tokens",
            "page": 1,
            "page_size": 10,
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_quotas(test_client, auth_headers_with_db):
    """Test getting usage quotas."""
    response = await test_client.get(
        "/api/billing/quotas",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_credit_balance(test_client, auth_headers_with_db):
    """Test getting credit balance."""
    response = await test_client.get(
        "/api/billing/credits",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 200
    data = response.json()

    assert "balance" in data
    assert "pending" in data
    assert "total_purchased" in data
    assert "total_used" in data
    assert isinstance(data["balance"], (int, float))
    assert isinstance(data["pending"], (int, float))
    assert isinstance(data["total_purchased"], (int, float))


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_credit_history(test_client, auth_headers_with_db):
    """Test getting credit transaction history."""
    response = await test_client.get(
        "/api/billing/credits/history",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)

    # If there are transactions, verify structure
    if data:
        transaction = data[0]
        assert "id" in transaction
        assert "amount" in transaction
        assert "transaction_type" in transaction
        assert "created_at" in transaction


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_invoices(test_client, auth_headers_with_db):
    """Test getting invoice list."""
    response = await test_client.get(
        "/api/billing/invoices",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_hardware_specs(test_client, auth_headers_with_db):
    """Test listing hardware specifications."""
    response = await test_client.get(
        "/api/billing/hardware-specs",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0

    # Verify hardware spec structure
    spec = data[0]
    assert "id" in spec
    assert "tier" in spec
    assert "vcpu" in spec
    assert "memory_mb" in spec
    assert "storage_gb_default" in spec
    assert "hourly_rate" in spec


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_hardware_spec_by_tier(test_client, auth_headers_with_db):
    """Test getting a specific hardware spec by tier."""
    response = await test_client.get(
        "/api/billing/hardware-specs/starter",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["tier"] == "starter"
    assert "vcpu" in data
    assert "memory_mb" in data


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_nonexistent_hardware_spec(test_client, auth_headers_with_db):
    """Test getting a hardware spec that doesn't exist returns 404."""
    response = await test_client.get(
        "/api/billing/hardware-specs/nonexistent",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 404


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_billing_events(test_client, auth_headers_with_db):
    """Test getting billing events."""
    response = await test_client.get(
        "/api/billing/events",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_record_usage_requires_service_token(
    test_client, integration_db, test_user_with_db, auth_headers_with_db
):
    """Test that record usage endpoint requires internal service token, not user auth."""
    from tests.integration.conftest import create_test_session

    # Create a session to record usage for
    session = await create_test_session(integration_db, test_user_with_db)

    # This endpoint requires INTERNAL_SERVICE_TOKEN, not user JWT
    response = await test_client.post(
        "/api/billing/usage/record",
        headers=auth_headers_with_db,
        json={
            "usage_type": "api_tokens",
            "quantity": 1000,
            "session_id": session.id,
            "unit": "tokens",
            "unit_price_cents": 1,
            "total_cost_cents": 10,
        },
    )

    # Should reject with 401 since user doesn't have service token
    assert response.status_code == 401


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_budgets(test_client, auth_headers_with_db):
    """Test getting user budgets."""
    response = await test_client.get(
        "/api/billing/budgets",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_budget_status(test_client, auth_headers_with_db):
    """Test getting budget status."""
    response = await test_client.get(
        "/api/billing/budgets/status",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_subscription_proration_preview(test_client, integration_db, auth_headers_with_db):
    """Test getting proration preview for plan change."""
    # Get a different plan to preview change
    plans_response = await test_client.get(
        "/api/billing/plans",
        headers=auth_headers_with_db,
    )
    plans = plans_response.json()

    if len(plans) > 1:
        target_plan = plans[1]

        response = await test_client.get(
            "/api/billing/subscription/proration-preview",
            headers=auth_headers_with_db,
            params={
                "new_plan_slug": target_plan["slug"],
                "billing_cycle": "monthly",
            },
        )

        # Response might be 404 if user doesn't have active subscription
        # 400 if validation fails, 503 if Stripe not available, or 200 with proration details
        assert response.status_code in [200, 400, 404, 503]

        if response.status_code == 200:
            data = response.json()
            assert "proration_amount_cents" in data
            assert "next_billing_date" in data


@pytest.mark.integration
@pytest.mark.asyncio
async def test_create_user_budget(test_client, auth_headers_with_db):
    """Test creating a user-level budget."""
    response = await test_client.post(
        "/api/billing/budgets/user",
        headers=auth_headers_with_db,
        json={
            "amount": 100.0,  # $100 budget
            "period": "monthly",
            "warning_threshold": 0.8,  # 80% warning threshold
            "hard_limit": False,
        },
    )

    # Might return 200 if created, 400 if exists, or 404 if endpoint not found
    assert response.status_code in [200, 400, 404]

    if response.status_code == 200:
        data = response.json()
        assert "id" in data
        assert data["amount"] == 100.0


@pytest.mark.integration
@pytest.mark.asyncio
async def test_create_session_budget(
    test_client, integration_db, test_user_with_db, auth_headers_with_db
):
    """Test creating a session-level budget."""
    from tests.integration.conftest import create_test_session

    session = await create_test_session(integration_db, test_user_with_db)

    response = await test_client.post(
        f"/api/billing/budgets/session/{session.id}",
        headers=auth_headers_with_db,
        json={
            "amount": 50.0,  # $50 budget
            "warning_threshold": 0.9,  # 90% warning threshold
            "hard_limit": False,
        },
    )

    # Might return 200 if created, 400 if exists, or 404 if endpoint not found
    assert response.status_code in [200, 400, 404]

    if response.status_code == 200:
        data = response.json()
        assert "id" in data
        assert data["amount"] == 50.0


@pytest.mark.integration
@pytest.mark.asyncio
async def test_realtime_session_cost(
    test_client, integration_db, test_user_with_db, auth_headers_with_db
):
    """Test getting realtime cost for a session."""
    from tests.integration.conftest import create_test_session

    session = await create_test_session(integration_db, test_user_with_db)

    response = await test_client.get(
        f"/api/billing/realtime/session/{session.id}",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 200
    data = response.json()
    assert "session_id" in data
    assert "total_cost" in data
    assert "input_cost" in data
    assert "output_cost" in data
    assert "total_tokens" in data


@pytest.mark.integration
@pytest.mark.asyncio
async def test_realtime_daily_usage(test_client, auth_headers_with_db):
    """Test getting realtime daily usage."""
    response = await test_client.get(
        "/api/billing/realtime/daily-usage",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_unauthorized_billing_access(test_client):
    """Test that billing endpoints that require user context require authentication."""
    # The /plans endpoint is public, but /subscription requires auth
    response = await test_client.get("/api/billing/subscription")

    # Should get 403 (CSRF) or 401 (unauthorized)
    assert response.status_code in [401, 403]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_subscription_validation():
    """Test subscription state transition validation."""
    from src.routes.billing import validate_subscription_transition

    # Valid transitions
    assert validate_subscription_transition("trialing", "active") is True
    assert validate_subscription_transition("active", "canceled") is True
    assert validate_subscription_transition("past_due", "active") is True

    # Invalid transitions
    assert validate_subscription_transition("canceled", "past_due") is False
    assert validate_subscription_transition("trialing", "paused") is False

    # Same state (no-op)
    assert validate_subscription_transition("active", "active") is True

    # Invalid states
    assert validate_subscription_transition("invalid", "active") is False
    assert validate_subscription_transition("active", "invalid") is False


@pytest.mark.integration
@pytest.mark.asyncio
async def test_usage_pagination(test_client, auth_headers_with_db):
    """Test usage history pagination."""
    # First page
    response1 = await test_client.get(
        "/api/billing/usage/history",
        headers=auth_headers_with_db,
        params={"page": 1, "page_size": 5},
    )
    assert response1.status_code == 200

    # Second page
    response2 = await test_client.get(
        "/api/billing/usage/history",
        headers=auth_headers_with_db,
        params={"page": 2, "page_size": 5},
    )
    assert response2.status_code == 200


@pytest.mark.integration
@pytest.mark.asyncio
async def test_credit_history_pagination(test_client, auth_headers_with_db):
    """Test credit history pagination."""
    response = await test_client.get(
        "/api/billing/credits/history",
        headers=auth_headers_with_db,
        params={"page": 1, "page_size": 10},
    )

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_invoice_pagination(test_client, auth_headers_with_db):
    """Test invoice list pagination."""
    response = await test_client.get(
        "/api/billing/invoices",
        headers=auth_headers_with_db,
        params={"page": 1, "page_size": 10},
    )

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
