"""
Comprehensive tests for local pods routes.

Tests cover:
- Local pod CRUD operations
- Pod status and health
- Pod pairing with cloud
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient

# ============================================================================
# FIXTURES
# ============================================================================


@pytest.fixture
def test_local_pod(test_user: dict[str, Any]) -> dict[str, Any]:
    """Create a test local pod."""
    return {
        "id": "pod-123",
        "user_id": test_user["id"],
        "name": "My Local Pod",
        "machine_id": "machine-abc123",
        "status": "connected",
        "ip_address": "192.168.1.100",
        "hostname": "my-machine",
        "os": "darwin",
        "arch": "arm64",
        "version": "1.0.0",
        "last_heartbeat": "2024-01-01T00:00:00Z",
        "created_at": "2024-01-01T00:00:00Z",
    }


# ============================================================================
# LOCAL POD CRUD TESTS
# ============================================================================


class TestLocalPodCRUD:
    """Tests for local pod CRUD operations."""

    def test_list_local_pods_unauthenticated(self, client: TestClient) -> None:
        """Test listing local pods without auth."""
        response = client.get("/api/local-pods")
        assert response.status_code in [401, 404]

    def test_create_local_pod_unauthenticated(self, client: TestClient) -> None:
        """Test creating local pod without auth."""
        response = client.post(
            "/api/local-pods",
            json={"name": "New Pod", "machine_id": "machine-123"},
        )
        assert response.status_code in [401, 404]

    def test_get_local_pod_unauthenticated(self, client: TestClient) -> None:
        """Test getting local pod without auth."""
        response = client.get("/api/local-pods/pod-123")
        assert response.status_code in [401, 404]

    def test_update_local_pod_unauthenticated(self, client: TestClient) -> None:
        """Test updating local pod without auth."""
        response = client.patch(
            "/api/local-pods/pod-123",
            json={"name": "Updated Pod"},
        )
        assert response.status_code in [401, 404, 405]

    def test_delete_local_pod_unauthenticated(self, client: TestClient) -> None:
        """Test deleting local pod without auth."""
        response = client.delete("/api/local-pods/pod-123")
        assert response.status_code in [401, 404]


# ============================================================================
# LOCAL POD STATUS TESTS
# ============================================================================


class TestLocalPodStatus:
    """Tests for local pod status operations."""

    def test_get_pod_status_unauthenticated(self, client: TestClient) -> None:
        """Test getting pod status without auth."""
        response = client.get("/api/local-pods/pod-123/status")
        assert response.status_code in [401, 404]

    def test_update_pod_heartbeat_unauthenticated(self, client: TestClient) -> None:
        """Test updating pod heartbeat without auth."""
        response = client.post(
            "/api/local-pods/pod-123/heartbeat",
            json={"status": "healthy"},
        )
        assert response.status_code in [401, 404]


# ============================================================================
# LOCAL POD PAIRING TESTS
# ============================================================================


class TestLocalPodPairing:
    """Tests for local pod pairing operations."""

    def test_generate_pairing_code_unauthenticated(self, client: TestClient) -> None:
        """Test generating pairing code without auth."""
        response = client.post("/api/local-pods/pairing-code")
        assert response.status_code in [401, 404]

    def test_verify_pairing_code_unauthenticated(self, client: TestClient) -> None:
        """Test verifying pairing code without auth."""
        response = client.post(
            "/api/local-pods/verify-pairing",
            json={"code": "ABC123"},
        )
        assert response.status_code in [401, 404]


# ============================================================================
# LOCAL POD COMMAND EXECUTION TESTS
# ============================================================================


class TestLocalPodCommandExecution:
    """Tests for local pod command execution."""

    def test_execute_command_unauthenticated(self, client: TestClient) -> None:
        """Test executing command on pod without auth."""
        response = client.post(
            "/api/local-pods/pod-123/exec",
            json={"command": "ls -la"},
        )
        assert response.status_code in [401, 404]
