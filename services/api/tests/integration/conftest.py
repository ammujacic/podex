"""
Integration test fixtures and configuration.

This module provides fixtures for integration tests that use real PostgreSQL and Redis.
Tests are isolated using database transactions with automatic rollback.
"""

import asyncio
import contextlib
import os
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from jose import jwt as jose_jwt
from passlib.context import CryptContext
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from src.config import settings
from src.database import Base, LLMModel, SubscriptionPlan, User
from src.database.models import (
    AgentRoleConfig,
    AgentTool,
    DefaultMCPServer,
    HardwareSpec,
    HealthCheck,
    LLMProvider,
    PlatformSetting,
    PodTemplate,
    SkillTemplate,
    SystemSkill,
)
from src.database.seeds import (
    DEFAULT_AGENT_ROLES,
    DEFAULT_AGENT_TOOLS,
    DEFAULT_HARDWARE_SPECS,
    DEFAULT_HEALTH_CHECKS,
    DEFAULT_MCP_SERVERS,
    DEFAULT_MODELS,
    DEFAULT_PLANS,
    DEFAULT_PROVIDERS,
    DEFAULT_SETTINGS,
    DEFAULT_SKILL_TEMPLATES,
    DEFAULT_SYSTEM_SKILLS,
    OFFICIAL_TEMPLATES,
)
from src.main import app

# Password hasher
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# Module-level engine - created once per test session
_engine: AsyncEngine | None = None
_tables_created = False


@pytest_asyncio.fixture(scope="function")
async def integration_engine() -> AsyncGenerator[AsyncEngine, None]:
    """Create database engine for each test.

    Function-scoped to ensure connections are created in the correct event loop.
    Each test gets a fresh engine bound to its event loop.
    """
    test_db_url = os.getenv(
        "DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5433/podex_test"
    )
    engine = create_async_engine(
        test_db_url,
        echo=False,
        poolclass=NullPool,  # No pooling - create new connection each time
        pool_pre_ping=True,  # Verify connections before use
    )

    # Ensure tables exist (idempotent operation)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    # Critical: Dispose engine synchronously to close all connections in this event loop
    await engine.dispose()

    # Give asyncpg time to clean up connection resources

    await asyncio.sleep(0.05)


async def get_engine() -> AsyncEngine:
    """Get or create the database engine (legacy function for seed data loading)."""
    global _engine, _tables_created
    if _engine is None:
        test_db_url = os.getenv(
            "DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5433/podex_test"
        )
        _engine = create_async_engine(
            test_db_url,
            echo=False,
            poolclass=NullPool,  # No pooling - create new connection each time
        )

    # Create tables if not already created
    if not _tables_created:
        async with _engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        _tables_created = True

    return _engine


# Track if seed data has been loaded
_seed_data_loaded = False


async def load_seed_data(engine: AsyncEngine) -> None:
    """Load seed data once for all integration tests."""
    global _seed_data_loaded

    async_session_maker = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    async with async_session_maker() as session:
        # Check if seed data already loaded in database
        result = await session.execute(select(LLMProvider).limit(1))
        if result.scalars().first() is not None:
            _seed_data_loaded = True
            return  # Seed data already exists in database

        # If we already tried to load seed data, don't try again
        if _seed_data_loaded:
            return

        # Load LLM Providers - use dict unpacking like seed_database() does
        for provider_data in DEFAULT_PROVIDERS:
            session.add(LLMProvider(**provider_data))

        # Load LLM Models
        for model_data in DEFAULT_MODELS:
            session.add(LLMModel(**model_data))

        # Load Subscription Plans
        for plan_data in DEFAULT_PLANS:
            session.add(SubscriptionPlan(**plan_data))

        # Load Hardware Specs
        for hw_data in DEFAULT_HARDWARE_SPECS:
            session.add(HardwareSpec(**hw_data))

        # Load Agent Roles
        for role_data in DEFAULT_AGENT_ROLES:
            session.add(AgentRoleConfig(**role_data))

        # Load Agent Tools
        for tool_data in DEFAULT_AGENT_TOOLS:
            session.add(AgentTool(**tool_data))

        # Load Platform Settings
        for setting_data in DEFAULT_SETTINGS:
            session.add(PlatformSetting(**setting_data))

        # Load Pod Templates
        for template_data in OFFICIAL_TEMPLATES:
            session.add(PodTemplate(**template_data))

        # Load MCP Servers
        for mcp_data in DEFAULT_MCP_SERVERS:
            session.add(DefaultMCPServer(**mcp_data))

        # Load Skill Templates
        for skill_data in DEFAULT_SKILL_TEMPLATES:
            session.add(SkillTemplate(**skill_data))

        # Load System Skills
        for system_skill_data in DEFAULT_SYSTEM_SKILLS:
            session.add(SystemSkill(**system_skill_data))

        # Load Health Checks
        for health_data in DEFAULT_HEALTH_CHECKS:
            session.add(HealthCheck(**health_data))

        await session.commit()
        _seed_data_loaded = True


@pytest_asyncio.fixture
async def integration_db(integration_engine: AsyncEngine) -> AsyncGenerator[AsyncSession, None]:
    """Create database session for each test with automatic cleanup.

    Test data is committed so it's visible to middleware and other sessions,
    then cleaned up after the test completes.
    """
    # Ensure seed data is loaded using this test's engine
    await load_seed_data(integration_engine)

    # Create a session for this test
    async_session_maker = async_sessionmaker(
        integration_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    session = async_session_maker()

    # Track created objects for cleanup
    session._test_created_ids = {"users": [], "sessions": [], "agents": [], "workspaces": []}

    try:
        yield session
    finally:
        # Clean up test data
        try:
            from src.database import Agent, Session, User, Workspace

            # Expire all objects first to detach from session
            session.expire_all()

            # Delete in reverse dependency order
            for agent_id in session._test_created_ids.get("agents", []):
                await session.execute(Agent.__table__.delete().where(Agent.id == agent_id))
            for workspace_id in session._test_created_ids.get("workspaces", []):
                await session.execute(
                    Workspace.__table__.delete().where(Workspace.id == workspace_id)
                )
            for session_id in session._test_created_ids.get("sessions", []):
                await session.execute(Session.__table__.delete().where(Session.id == session_id))
            for user_id in session._test_created_ids.get("users", []):
                await session.execute(User.__table__.delete().where(User.id == user_id))

            await session.commit()
        except Exception:
            with contextlib.suppress(Exception):
                await session.rollback()
        finally:
            # Close the session properly
            with contextlib.suppress(Exception):
                await session.close()


@pytest_asyncio.fixture
async def integration_redis() -> AsyncGenerator[Redis, None]:
    """Create Redis client for integration tests pointing to redis-test."""
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6380")

    redis_client = Redis.from_url(redis_url, decode_responses=True)

    yield redis_client

    # Cleanup: flush test database
    await redis_client.flushdb()
    await redis_client.aclose()


@pytest_asyncio.fixture
async def test_user_with_db(integration_db: AsyncSession) -> User:
    """Create a test user in the database with active subscription."""
    from src.database import UserSubscription

    # Get a subscription plan
    result = await integration_db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.slug == "free")
    )
    plan = result.scalar_one()

    user_id = str(uuid4())
    user = User(
        id=user_id,
        email=f"test-{user_id}@example.com",  # Unique email per test
        name="Test User",
        password_hash=pwd_context.hash("testpass123"),
        is_active=True,
        role="member",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    integration_db.add(user)
    await integration_db.commit()
    await integration_db.refresh(user)

    # Create active subscription for user
    now = datetime.now(UTC)
    subscription = UserSubscription(
        id=str(uuid4()),
        user_id=user.id,
        plan_id=plan.id,
        status="active",
        billing_cycle="monthly",
        current_period_start=now,
        current_period_end=now.replace(day=28) if now.day < 28 else now,  # Simple period end
        created_at=now,
        updated_at=now,
    )
    integration_db.add(subscription)
    await integration_db.commit()

    # Make objects independent of the session
    integration_db.expunge(user)
    integration_db.expunge(subscription)

    # Track for cleanup
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["users"].append(user.id)

    return user


@pytest_asyncio.fixture
async def admin_user_with_db(integration_db: AsyncSession) -> User:
    """Create an admin user in the database."""
    user = User(
        id=str(uuid4()),
        email="admin@example.com",
        name="Admin User",
        password_hash=pwd_context.hash("adminpass123"),
        is_active=True,
        role="admin",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    integration_db.add(user)
    await integration_db.commit()
    await integration_db.refresh(user)

    # Track for cleanup
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["users"].append(user.id)

    return user


@pytest.fixture
def auth_headers_with_db(test_user_with_db: User) -> dict[str, str]:
    """Generate JWT auth headers for test user with CSRF bypass."""
    token_data = {
        "sub": test_user_with_db.id,
        "email": test_user_with_db.email,
        "jti": str(uuid4()),  # Token ID for revocation checking
        "exp": datetime.now(UTC).timestamp() + 3600,  # 1 hour
    }
    token = jose_jwt.encode(token_data, settings.JWT_SECRET_KEY, algorithm="HS256")

    return {
        "Authorization": f"Bearer {token}",
        "X-Requested-With": "XMLHttpRequest",  # CSRF bypass for tests
    }


@pytest.fixture
def admin_headers_with_db(admin_user_with_db: User) -> dict[str, str]:
    """Generate JWT auth headers for admin user with CSRF bypass."""
    token_data = {
        "sub": admin_user_with_db.id,
        "email": admin_user_with_db.email,
        "is_admin": True,
        "jti": str(uuid4()),  # Token ID for revocation checking
        "exp": datetime.now(UTC).timestamp() + 3600,  # 1 hour
    }
    token = jose_jwt.encode(token_data, settings.JWT_SECRET_KEY, algorithm="HS256")

    return {
        "Authorization": f"Bearer {token}",
        "X-Requested-With": "XMLHttpRequest",  # CSRF bypass for tests
    }


@pytest_asyncio.fixture
async def async_client() -> AsyncGenerator[AsyncClient, None]:
    """Create async HTTP client for testing FastAPI app."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client


@pytest_asyncio.fixture(autouse=True)
async def cleanup_after_test() -> AsyncGenerator[None, None]:
    """Cleanup fixture that runs after each test to prevent state pollution.

    This runs at the END of each test, after all other fixtures have cleaned up.
    It ensures no async operations bleed into the next test's event loop.
    """
    yield

    import gc

    # Clear app dependency overrides first
    app.dependency_overrides.clear()

    # Wait significantly longer for all async operations to complete
    # This is critical to prevent event loop contamination
    await asyncio.sleep(0.5)

    # Force garbage collection to clean up any remaining references
    gc.collect()

    # Give asyncpg extra time to fully clean up connections
    await asyncio.sleep(0.2)


@pytest_asyncio.fixture
async def test_client(
    integration_db: AsyncSession, integration_redis: Redis
) -> AsyncGenerator[AsyncClient, None]:
    """Create async HTTP client with database dependency overrides.

    Creates a separate engine for the test client to avoid event loop contamination.
    The client engine is disposed before this fixture completes to ensure all
    connections are closed in the current event loop.
    """
    from unittest.mock import AsyncMock, patch

    from src.database.connection import get_db

    # Create a completely separate engine for the test client
    # This avoids event loop issues with shared engines
    test_db_url = os.getenv(
        "DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5433/podex_test"
    )
    client_engine = create_async_engine(
        test_db_url,
        echo=False,
        poolclass=NullPool,  # No connection pooling
        pool_pre_ping=True,  # Verify connections before use
    )

    # Track active sessions created by the client for cleanup
    _active_sessions = []

    # Override the get_db dependency to create a new session for each request
    # This ensures the session is created in the correct event loop context
    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        # Create a new session for this request using client's own engine
        async_session_maker = async_sessionmaker(
            client_engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )
        session = async_session_maker()
        # Share the test tracking dict so cleanup works
        session._test_created_ids = integration_db._test_created_ids
        _active_sessions.append(session)
        try:
            yield session
        finally:
            with contextlib.suppress(Exception):
                await session.close()
            if session in _active_sessions:
                _active_sessions.remove(session)

    # Save current overrides to restore later
    original_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = override_get_db

    # Mock token blacklist to always return False (tokens are valid)
    patcher = patch("src.services.token_blacklist.is_token_revoked", new_callable=AsyncMock)
    mock_revoked = patcher.start()
    mock_revoked.return_value = False

    client = None
    try:
        client = AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        )
        yield client
    finally:
        # Critical cleanup order to prevent event loop contamination:

        # 1. Close the HTTP client - this waits for all requests to complete
        if client is not None:
            with contextlib.suppress(Exception):
                await client.aclose()

        # 2. Wait for any lingering middleware tasks to finish
        # This is critical - middleware can spawn background tasks
        await asyncio.sleep(0.3)

        # 3. Close any remaining active sessions
        for session in _active_sessions:
            with contextlib.suppress(Exception):
                await session.close()
        _active_sessions.clear()

        # 4. Stop the mock patcher
        with contextlib.suppress(Exception):
            patcher.stop()

        # 5. Dispose the client engine - this closes all connections in THIS event loop
        with contextlib.suppress(Exception):
            await client_engine.dispose()

        # 6. Give asyncpg time to clean up connection resources
        await asyncio.sleep(0.05)

        # 7. Restore original dependency overrides
        app.dependency_overrides = original_overrides

        # 8. Expire all database objects in integration_db to prevent stale references
        with contextlib.suppress(Exception):
            integration_db.expire_all()


# Helper functions for creating test data


async def create_test_session(
    db: AsyncSession,
    user: User,
    **kwargs: Any,
) -> Any:  # Returns Session model
    """Helper to create a test session."""
    from src.database import Session

    session_data = {
        "id": str(uuid4()),
        "owner_id": user.id,  # Fixed: Session uses owner_id not user_id
        "name": kwargs.get("name", "Test Session"),
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
        **kwargs,
    }

    session = Session(**session_data)
    db.add(session)
    await db.commit()
    await db.refresh(session)

    # Make object independent of the session
    db.expunge(session)

    # Track for cleanup
    if hasattr(db, "_test_created_ids"):
        db._test_created_ids["sessions"].append(session.id)

    return session


async def create_test_agent(
    db: AsyncSession,
    session_id: str,
    **kwargs: Any,
) -> Any:  # Returns Agent model
    """Helper to create a test agent."""
    from src.database import Agent

    # Get a default model
    result = await db.execute(select(LLMModel).where(LLMModel.model_id == "claude-sonnet-4.5"))
    model = result.scalar_one()

    agent_data = {
        "id": str(uuid4()),
        "session_id": session_id,
        "role": kwargs.get("role", "coder"),
        "model": kwargs.get("model", model.model_id),  # Agent uses 'model' field, not 'model_id'
        "name": kwargs.get("name", "Test Agent"),
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
        **kwargs,
    }

    agent = Agent(**agent_data)
    db.add(agent)
    await db.commit()
    await db.refresh(agent)

    # Make object independent of the session
    db.expunge(agent)

    # Track for cleanup
    if hasattr(db, "_test_created_ids"):
        db._test_created_ids["agents"].append(agent.id)

    return agent


async def create_test_workspace(
    db: AsyncSession,
    session_id: str,
    **kwargs: Any,
) -> Any:  # Returns Workspace model
    """Helper to create a test workspace."""
    from src.database import Workspace

    # Get a default hardware spec
    result = await db.execute(select(HardwareSpec).where(HardwareSpec.tier == "starter"))
    hardware = result.scalar_one()

    workspace_data = {
        "id": str(uuid4()),
        "session_id": session_id,
        "hardware_spec_id": kwargs.get("hardware_spec_id", hardware.id),
        "status": kwargs.get("status", "stopped"),
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
        **kwargs,
    }

    workspace = Workspace(**workspace_data)
    db.add(workspace)
    await db.commit()
    await db.refresh(workspace)

    return workspace
