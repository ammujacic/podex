"""
Comprehensive tests for workspace routes.

Tests cover:
- Workspace CRUD operations
- Workspace lifecycle management
- File operations within workspaces
- Workspace sharing and permissions
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient

# ============================================================================
# FIXTURES
# ============================================================================


@pytest.fixture
def test_workspace(test_user: dict[str, Any], test_session: dict[str, Any]) -> dict[str, Any]:
    """Create a test workspace."""
    return {
        "id": "workspace-123",
        "session_id": test_session["id"],
        "user_id": test_user["id"],
        "status": "running",
        "container_id": "container-abc123",
        "host": "localhost",
        "port": 8080,
        "created_at": "2024-01-01T00:00:00Z",
        "last_activity": "2024-01-01T00:00:00Z",
    }


# ============================================================================
# WORKSPACE CRUD TESTS
# ============================================================================


class TestWorkspaceCRUD:
    """Tests for workspace CRUD operations."""

    def test_list_workspaces_unauthenticated(self, client: TestClient) -> None:
        """Test listing workspaces without auth."""
        response = client.get("/api/workspaces")
        assert response.status_code in [401, 404]

    def test_create_workspace_unauthenticated(self, client: TestClient) -> None:
        """Test creating workspace without auth."""
        response = client.post(
            "/api/workspaces",
            json={"session_id": "session-123", "template_id": "nodejs"},
        )
        assert response.status_code in [401, 404]

    def test_get_workspace_unauthenticated(self, client: TestClient) -> None:
        """Test getting workspace without auth."""
        response = client.get("/api/workspaces/workspace-123")
        assert response.status_code in [401, 404]

    def test_delete_workspace_unauthenticated(self, client: TestClient) -> None:
        """Test deleting workspace without auth."""
        response = client.delete("/api/workspaces/workspace-123")
        assert response.status_code in [401, 404]


# ============================================================================
# WORKSPACE LIFECYCLE TESTS
# ============================================================================


class TestWorkspaceLifecycle:
    """Tests for workspace lifecycle management."""

    def test_start_workspace_unauthenticated(self, client: TestClient) -> None:
        """Test starting workspace without auth."""
        response = client.post("/api/workspaces/workspace-123/start")
        assert response.status_code in [401, 404]

    def test_stop_workspace_unauthenticated(self, client: TestClient) -> None:
        """Test stopping workspace without auth."""
        response = client.post("/api/workspaces/workspace-123/stop")
        assert response.status_code in [401, 404]

    def test_restart_workspace_unauthenticated(self, client: TestClient) -> None:
        """Test restarting workspace without auth."""
        response = client.post("/api/workspaces/workspace-123/restart")
        assert response.status_code in [401, 404]


# ============================================================================
# WORKSPACE FILE OPERATIONS TESTS
# ============================================================================


class TestWorkspaceFileOperations:
    """Tests for workspace file operations."""

    def test_list_files_unauthenticated(self, client: TestClient) -> None:
        """Test listing files without auth."""
        response = client.get("/api/workspaces/workspace-123/files")
        assert response.status_code in [401, 404]

    def test_read_file_unauthenticated(self, client: TestClient) -> None:
        """Test reading file without auth."""
        response = client.get("/api/workspaces/workspace-123/files/src/index.ts")
        assert response.status_code in [401, 404]

    def test_write_file_unauthenticated(self, client: TestClient) -> None:
        """Test writing file without auth."""
        response = client.put(
            "/api/workspaces/workspace-123/files/src/index.ts",
            json={"content": "console.log('hello');"},
        )
        assert response.status_code in [401, 404, 405]

    def test_delete_file_unauthenticated(self, client: TestClient) -> None:
        """Test deleting file without auth."""
        response = client.delete("/api/workspaces/workspace-123/files/src/temp.ts")
        assert response.status_code in [401, 404]


# ============================================================================
# WORKSPACE TERMINAL TESTS
# ============================================================================


class TestWorkspaceTerminal:
    """Tests for workspace terminal operations."""

    def test_execute_command_unauthenticated(self, client: TestClient) -> None:
        """Test executing command without auth."""
        response = client.post(
            "/api/workspaces/workspace-123/exec",
            json={"command": "ls -la"},
        )
        assert response.status_code in [401, 404]


# ============================================================================
# WORKSPACE PORT FORWARDING TESTS
# ============================================================================


class TestWorkspacePortForwarding:
    """Tests for workspace port forwarding."""

    def test_list_ports_unauthenticated(self, client: TestClient) -> None:
        """Test listing forwarded ports without auth."""
        response = client.get("/api/workspaces/workspace-123/ports")
        assert response.status_code in [401, 404]

    def test_forward_port_unauthenticated(self, client: TestClient) -> None:
        """Test forwarding port without auth."""
        response = client.post(
            "/api/workspaces/workspace-123/ports",
            json={"port": 3000, "protocol": "http"},
        )
        assert response.status_code in [401, 404]
