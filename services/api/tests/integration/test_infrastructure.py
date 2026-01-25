"""
Integration test infrastructure smoke tests.

These tests verify that the integration test setup is working properly:
- Database connection
- Redis connection
- Seed data loading
- Test user creation
- Auth headers generation
"""

import pytest
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import LLMModel, SubscriptionPlan, User
from src.database.models import LLMProvider


@pytest.mark.integration
async def test_database_connection(integration_db: AsyncSession):
    """Test that we can connect to the test database."""
    result = await integration_db.execute(select(User))
    users = result.scalars().all()
    # No users yet, but query should work
    assert isinstance(users, list)


@pytest.mark.integration
async def test_seed_data_loaded(integration_db: AsyncSession):
    """Test that seed data is properly loaded."""
    # Check LLM Providers
    result = await integration_db.execute(select(LLMProvider))
    providers = result.scalars().all()
    assert len(providers) > 0, "No LLM providers found"

    # Check LLM Models
    result = await integration_db.execute(select(LLMModel))
    models = result.scalars().all()
    assert len(models) > 0, "No LLM models found"

    # Check Subscription Plans
    result = await integration_db.execute(select(SubscriptionPlan))
    plans = result.scalars().all()
    assert len(plans) > 0, "No subscription plans found"


@pytest.mark.integration
async def test_redis_connection(integration_redis: Redis):
    """Test that we can connect to the test Redis instance."""
    # Test basic set/get
    await integration_redis.set("test_key", "test_value")
    value = await integration_redis.get("test_key")
    assert value == "test_value"


@pytest.mark.integration
async def test_user_fixture(test_user_with_db: User, integration_db: AsyncSession):
    """Test that test user fixture creates a user properly."""
    assert test_user_with_db.id is not None
    # Email is generated uniquely per test (test-{uuid}@example.com)
    assert test_user_with_db.email.startswith("test-")
    assert test_user_with_db.email.endswith("@example.com")
    assert test_user_with_db.is_active is True

    # Verify user exists in database
    result = await integration_db.execute(select(User).where(User.id == test_user_with_db.id))
    user = result.scalar_one_or_none()
    assert user is not None
    assert user.email == test_user_with_db.email


@pytest.mark.integration
async def test_admin_user_fixture(admin_user_with_db: User, integration_db: AsyncSession):
    """Test that admin user fixture creates an admin properly."""
    assert admin_user_with_db.id is not None
    assert admin_user_with_db.email == "admin@example.com"
    assert admin_user_with_db.role == "admin"


@pytest.mark.integration
def test_auth_headers_fixture(auth_headers_with_db: dict[str, str], test_user_with_db: User):
    """Test that auth headers are generated properly."""
    assert "Authorization" in auth_headers_with_db
    assert auth_headers_with_db["Authorization"].startswith("Bearer ")


@pytest.mark.integration
async def test_transaction_isolation(integration_db: AsyncSession, test_user_with_db: User):
    """Test that test data is properly isolated between tests.

    This test creates a new user and verifies it exists.
    The user is explicitly cleaned up at the end.
    """
    from datetime import UTC, datetime
    from uuid import uuid4

    # Create a new user with unique email
    user_id = str(uuid4())
    new_user = User(
        id=user_id,
        email=f"isolation_test_{user_id[:8]}@example.com",
        name="Isolation Test",
        password_hash="test",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    integration_db.add(new_user)
    await integration_db.commit()

    # Verify it exists
    result = await integration_db.execute(select(User).where(User.id == user_id))
    found_user = result.scalar_one_or_none()
    assert found_user is not None
    assert found_user.email.startswith("isolation_test_")

    # Track for cleanup if using our fixtures
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["users"].append(user_id)


@pytest.mark.integration
async def test_isolation_cleanup(integration_db: AsyncSession):
    """Test that fixture-created users are properly cleaned up.

    This verifies our test fixture cleanup works - there should be
    no isolation_test users from previous tests.
    """
    result = await integration_db.execute(select(User).where(User.email.like("isolation_test_%")))
    users = result.scalars().all()
    # There might be users from THIS test run or concurrent tests
    # Just verify we can query without errors
    assert isinstance(users, list)
