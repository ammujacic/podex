"""
Pytest fixtures for API service tests.

This module provides:
- Test client for FastAPI
- Mock authentication
- Test data fixtures
"""

import asyncio
from collections.abc import AsyncGenerator, Generator
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

import warnings
from src.config import settings
from src.middleware.auth import AuthMiddleware

# Suppress JWT secret warning in tests
warnings.filterwarnings("ignore", message="JWT_SECRET_KEY not set - using auto-generated secret", category=UserWarning)


def _add_health_endpoints(app: FastAPI) -> None:
    """Add health check endpoints to the app."""

    @app.get("/health")
    async def health_check() -> dict[str, str]:
        return {"status": "healthy", "version": settings.VERSION}


def _add_auth_endpoints(app: FastAPI) -> None:
    """Add authentication endpoints to the app."""

    @app.post("/api/auth/login")
    async def login(request_body: dict[str, Any]) -> dict[str, Any]:
        email = request_body.get("email", "")
        password = request_body.get("password", "")
        if not email or "@" not in email:
            raise HTTPException(status_code=422, detail="Invalid email")
        if not password:
            raise HTTPException(status_code=422, detail="Password required")
        # Simulate auth failure
        raise HTTPException(status_code=401, detail="Invalid credentials")

    @app.post("/api/auth/signup")
    async def signup(request_body: dict[str, Any]) -> dict[str, Any]:
        email = request_body.get("email", "")
        password = request_body.get("password", "")
        if not email or not password:
            raise HTTPException(status_code=422, detail="Email and password required")
        return {"id": "new-user-id", "email": email}

    @app.get("/api/auth/me")
    async def get_me() -> dict[str, Any]:
        raise HTTPException(status_code=401, detail="Not authenticated")

    @app.post("/api/auth/logout")
    async def logout() -> dict[str, str]:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # OAuth endpoints
    @app.get("/api/oauth/github/url")
    async def github_oauth_url() -> dict[str, str]:
        return {"url": "https://github.com/login/oauth/authorize?client_id=test"}

    @app.get("/api/oauth/google/url")
    async def google_oauth_url() -> dict[str, str]:
        return {"url": "https://accounts.google.com/o/oauth2/auth?client_id=test"}

    @app.get("/api/oauth/github/callback")
    async def github_callback(
        code: str | None = None,
        error: str | None = None,
        error_description: str | None = None,  # noqa: ARG001
    ) -> dict[str, Any]:
        if error:
            raise HTTPException(status_code=400, detail=f"OAuth error: {error}")
        if not code:
            raise HTTPException(status_code=422, detail="Code required")
        return {"token": "test-token"}

    @app.get("/api/oauth/google/callback")
    async def google_callback(
        code: str | None = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        if error:
            raise HTTPException(status_code=400, detail=f"OAuth error: {error}")
        if not code:
            raise HTTPException(status_code=422, detail="Code required")
        return {"token": "test-token"}


def _add_session_endpoints(app: FastAPI) -> None:
    """Add session endpoints to the app."""

    @app.get("/api/sessions")
    async def list_sessions() -> dict[str, Any]:
        raise HTTPException(status_code=401, detail="Not authenticated")

    @app.post("/api/sessions")
    async def create_session(request_body: dict[str, Any]) -> dict[str, Any]:  # noqa: ARG001
        raise HTTPException(status_code=401, detail="Not authenticated")

    @app.get("/api/sessions/{session_id}")
    async def get_session(session_id: str) -> dict[str, Any]:  # noqa: ARG001
        raise HTTPException(status_code=401, detail="Not authenticated")

    @app.delete("/api/sessions/{session_id}")
    async def delete_session(session_id: str) -> dict[str, str]:  # noqa: ARG001
        raise HTTPException(status_code=401, detail="Not authenticated")

    @app.patch("/api/sessions/{session_id}")
    async def update_session(session_id: str, request_body: dict[str, Any]) -> dict[str, Any]:  # noqa: ARG001
        raise HTTPException(status_code=401, detail="Not authenticated")


def _add_template_endpoints(app: FastAPI) -> None:
    """Add template endpoints to the app."""

    @app.get("/api/templates")
    async def list_templates() -> list[dict[str, Any]]:
        return [
            {
                "id": "nodejs",
                "name": "Node.js",
                "slug": "nodejs",
                "icon": "nodejs",
                "is_official": True,
            },
            {
                "id": "python",
                "name": "Python",
                "slug": "python",
                "icon": "python",
                "is_official": True,
            },
        ]

    @app.get("/api/templates/{slug}")
    async def get_template(slug: str) -> dict[str, Any]:
        templates = {
            "nodejs": {"id": "nodejs", "name": "Node.js"},
            "python": {"id": "python", "name": "Python"},
        }
        if slug not in templates:
            raise HTTPException(status_code=404, detail="Template not found")
        return templates[slug]

    # Agent templates
    @app.get("/api/agent-templates")
    async def list_agent_templates() -> list[dict[str, Any]]:
        return [{"id": "architect", "name": "Architect"}]

    @app.get("/api/agent-templates/{template_id}")
    async def get_agent_template(template_id: str) -> dict[str, Any]:
        if template_id != "architect":
            raise HTTPException(status_code=404, detail="Agent template not found")
        return {"id": "architect", "name": "Architect"}

    @app.post("/api/agent-templates")
    async def create_agent_template(request_body: dict[str, Any]) -> dict[str, Any]:  # noqa: ARG001
        raise HTTPException(status_code=401, detail="Not authenticated")


def _add_agent_endpoints(app: FastAPI) -> None:
    """Add agent endpoints to the app."""

    @app.get("/api/sessions/{session_id}/agents")
    async def list_agents(session_id: str) -> list[dict[str, Any]]:  # noqa: ARG001
        raise HTTPException(status_code=401, detail="Not authenticated")

    @app.post("/api/sessions/{session_id}/agents")
    async def create_agent(session_id: str, request_body: dict[str, Any]) -> dict[str, Any]:  # noqa: ARG001
        raise HTTPException(status_code=401, detail="Not authenticated")

    @app.get("/api/sessions/{session_id}/agents/{agent_id}")
    async def get_agent(session_id: str, agent_id: str) -> dict[str, Any]:  # noqa: ARG001
        raise HTTPException(status_code=401, detail="Not authenticated")

    @app.delete("/api/sessions/{session_id}/agents/{agent_id}")
    async def delete_agent(session_id: str, agent_id: str) -> dict[str, str]:  # noqa: ARG001
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Attention endpoints
    @app.get("/api/sessions/{session_id}/attention")
    async def get_attention(session_id: str) -> list[dict[str, Any]]:  # noqa: ARG001
        raise HTTPException(status_code=401, detail="Not authenticated")


def create_test_app() -> FastAPI:
    """Create a test FastAPI app with basic endpoints."""
    test_app = FastAPI(
        title="Podex API (Test)",
        version=settings.VERSION,
    )

    _add_health_endpoints(test_app)
    _add_auth_endpoints(test_app)
    _add_template_endpoints(test_app)
    # Agent endpoints must be added BEFORE session endpoints
    # because /api/sessions/{session_id}/agents is more specific
    _add_agent_endpoints(test_app)
    _add_session_endpoints(test_app)

    # Add auth middleware to test app (same as main app)
    test_app.add_middleware(AuthMiddleware)

    return test_app


# Create the test app
app = create_test_app()


@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    """Create an instance of the default event loop for each test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def mock_db() -> MagicMock:
    """Mock database connection."""
    mock = MagicMock()
    mock.execute = AsyncMock()
    mock.fetchone = AsyncMock()
    mock.fetchall = AsyncMock()
    return mock


@pytest.fixture
def mock_redis() -> MagicMock:
    """Mock Redis connection."""
    mock = MagicMock()
    mock.get = AsyncMock(return_value=None)
    mock.set = AsyncMock(return_value=True)
    mock.delete = AsyncMock(return_value=1)
    mock.exists = AsyncMock(return_value=0)
    mock.incr = AsyncMock(return_value=1)
    mock.expire = AsyncMock(return_value=True)
    return mock


@pytest.fixture
def test_user() -> dict[str, Any]:
    """Create a test user."""
    return {
        "id": "test-user-123",
        "email": "test@example.com",
        "name": "Test User",
        "avatar_url": None,
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z",
    }


@pytest.fixture
def auth_headers() -> dict[str, str]:
    """Create authentication headers for test requests."""
    return {
        "Authorization": "Bearer test-token-for-testing",
        "Content-Type": "application/json",
    }


@pytest.fixture
def test_session() -> dict[str, Any]:
    """Create a test session."""
    return {
        "id": "session-123",
        "user_id": "test-user-123",
        "name": "Test Project",
        "status": "active",
        "template_id": "nodejs",
        "git_url": "https://github.com/test/repo",
        "branch": "main",
        "pinned": False,
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z",
    }


@pytest.fixture
def test_template() -> dict[str, Any]:
    """Create a test template."""
    return {
        "id": "nodejs",
        "name": "Node.js",
        "slug": "nodejs",
        "description": "Node.js development environment",
        "icon": "nodejs",
        "is_official": True,
        "created_at": "2024-01-01T00:00:00Z",
    }


@pytest.fixture
def test_app() -> FastAPI:
    """Get the test FastAPI app instance."""
    return app


@pytest.fixture
def client(test_app: FastAPI) -> Generator[TestClient, None, None]:
    """Create a synchronous test client."""
    with TestClient(test_app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture
async def async_client(test_app: FastAPI) -> AsyncGenerator[AsyncClient, None]:
    """Create an asynchronous test client."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://test",
    ) as ac:
        yield ac


# ============================================
# Additional fixtures for comprehensive tests
# ============================================


@pytest.fixture
def admin_user() -> dict[str, Any]:
    """Create a test admin user."""
    return {
        "id": "admin-user-123",
        "email": "admin@example.com",
        "name": "Admin User",
        "role": "admin",
        "avatar_url": None,
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z",
    }


@pytest.fixture
def admin_headers() -> dict[str, str]:
    """Create admin authentication headers for test requests."""
    return {
        "Authorization": "Bearer admin-test-token-for-testing",
        "Content-Type": "application/json",
    }


@pytest.fixture
def mock_s3() -> MagicMock:
    """Mock S3 client."""
    mock = MagicMock()
    mock.upload_file = AsyncMock(return_value=True)
    mock.download_file = AsyncMock(return_value=b"file content")
    mock.delete_object = AsyncMock(return_value=True)
    mock.list_objects = AsyncMock(return_value={"Contents": []})
    mock.put_object = AsyncMock(return_value=True)
    mock.get_object = AsyncMock(return_value={"Body": b"file content"})
    return mock


@pytest.fixture
def mock_stripe() -> MagicMock:
    """Mock Stripe client."""
    mock = MagicMock()
    mock.Customer = MagicMock()
    mock.Customer.create = MagicMock(return_value={"id": "cus_test123"})
    mock.Customer.retrieve = MagicMock(
        return_value={"id": "cus_test123", "email": "test@example.com"}
    )
    mock.Subscription = MagicMock()
    mock.Subscription.create = MagicMock(return_value={"id": "sub_test123", "status": "active"})
    mock.Subscription.retrieve = MagicMock(return_value={"id": "sub_test123", "status": "active"})
    mock.checkout = MagicMock()
    mock.checkout.Session = MagicMock()
    mock.checkout.Session.create = MagicMock(
        return_value={"id": "cs_test123", "url": "https://checkout.stripe.com/test"}
    )
    mock.PaymentIntent = MagicMock()
    mock.PaymentIntent.create = MagicMock(
        return_value={"id": "pi_test123", "client_secret": "secret"}
    )
    return mock


@pytest.fixture
def test_billing_plan() -> dict[str, Any]:
    """Create a test billing plan."""
    return {
        "id": "plan-free",
        "name": "Free",
        "slug": "free",
        "price_monthly": 0,
        "price_yearly": 0,
        "compute_hours_monthly": 50,
        "storage_gb": 5,
        "max_sessions": 3,
        "max_agents_per_session": 1,
        "features": ["basic_templates", "community_support"],
        "is_active": True,
        "created_at": "2024-01-01T00:00:00Z",
    }


@pytest.fixture
def test_subscription() -> dict[str, Any]:
    """Create a test subscription."""
    return {
        "id": "sub-123",
        "user_id": "test-user-123",
        "plan_id": "plan-free",
        "status": "active",
        "stripe_subscription_id": "sub_stripe123",
        "current_period_start": "2024-01-01T00:00:00Z",
        "current_period_end": "2024-02-01T00:00:00Z",
        "created_at": "2024-01-01T00:00:00Z",
    }


@pytest.fixture
def test_workspace() -> dict[str, Any]:
    """Create a test workspace."""
    return {
        "id": "ws-123",
        "session_id": "session-123",
        "user_id": "test-user-123",
        "status": "running",
        "container_id": "container-abc123",
        "port": 3000,
        "created_at": "2024-01-01T00:00:00Z",
    }


@pytest.fixture
def test_mcp_server() -> dict[str, Any]:
    """Create a test MCP server."""
    return {
        "id": "mcp-123",
        "name": "Test MCP Server",
        "type": "filesystem",
        "config": {"root_path": "/workspace"},
        "user_id": "test-user-123",
        "is_enabled": True,
        "created_at": "2024-01-01T00:00:00Z",
    }


@pytest.fixture
def test_local_pod() -> dict[str, Any]:
    """Create a test local pod."""
    return {
        "id": "pod-123",
        "name": "My Local Dev Machine",
        "user_id": "test-user-123",
        "pairing_code": "ABCD1234",
        "status": "connected",
        "last_seen": "2024-01-01T00:00:00Z",
        "created_at": "2024-01-01T00:00:00Z",
    }


@pytest.fixture
def test_git_repo() -> dict[str, Any]:
    """Create a test git repository info."""
    return {
        "url": "https://github.com/test/repo",
        "branch": "main",
        "commit_sha": "abc123def456",
        "status": {
            "modified": ["file1.py", "file2.js"],
            "added": ["new_file.ts"],
            "deleted": [],
            "untracked": ["temp.txt"],
        },
    }
