"""Tests for health check routes."""

from fastapi import status
from fastapi.testclient import TestClient


def test_health_endpoint(fastapi_client: TestClient):
    """Test GET /health returns healthy status."""
    # Health check doesn't require authentication
    response = fastapi_client.get("/health", headers={})

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "compute"


def test_readiness_endpoint(fastapi_client: TestClient):
    """Test GET /ready returns ready status."""
    # Readiness check doesn't require authentication
    response = fastapi_client.get("/ready", headers={})

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["status"] == "ready"
    assert data["service"] == "compute"


def test_root_endpoint(fastapi_client: TestClient):
    """Test GET / returns service info."""
    # Root endpoint doesn't require authentication
    response = fastapi_client.get("/", headers={})

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert "service" in data
    assert data["service"] == "compute"
