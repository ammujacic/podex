"""Tests for health endpoints."""

import pytest
from fastapi.testclient import TestClient

from src.deps import verify_internal_auth
from src.main import app


def noop_auth() -> None:
    """No-op auth dependency for testing."""
    pass


@pytest.fixture
def client() -> TestClient:
    """Create test client."""
    return TestClient(app)


def test_health_check(client: TestClient) -> None:
    """Test health check endpoint."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "compute"


def test_readiness_check(client: TestClient) -> None:
    """Test readiness check endpoint."""
    response = client.get("/ready")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"


def test_root_endpoint() -> None:
    """Test root endpoint with mocked auth."""
    # Override auth dependency for this test since root requires authentication
    app.dependency_overrides[verify_internal_auth] = noop_auth
    try:
        with TestClient(app) as client:
            response = client.get("/")
            assert response.status_code == 200
            data = response.json()
            assert data["service"] == "podex-compute"
            assert "version" in data
    finally:
        app.dependency_overrides.clear()
