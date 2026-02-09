"""Tests for health check endpoints."""

from fastapi.testclient import TestClient


class TestHealthCheck:
    """Tests for the health check endpoint."""

    def test_health_check_returns_200(self, client: TestClient) -> None:
        """Health check should return 200 OK."""
        response = client.get("/health")
        assert response.status_code == 200

    def test_health_check_returns_status(self, client: TestClient) -> None:
        """Health check should return status in response."""
        response = client.get("/health")
        data = response.json()
        assert "status" in data
        assert data["status"] == "healthy"

    def test_health_check_returns_version(self, client: TestClient) -> None:
        """Health check should return version in response."""
        response = client.get("/health")
        data = response.json()
        assert "version" in data
        assert isinstance(data["version"], str)
