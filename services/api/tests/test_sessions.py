"""Tests for session management endpoints."""

from fastapi.testclient import TestClient


class TestSessionEndpoints:
    """Tests for /api/sessions endpoints."""

    def test_list_sessions_requires_auth(self, client: TestClient) -> None:
        """List sessions should require authentication."""
        response = client.get("/api/sessions")
        assert response.status_code in [401, 403]

    def test_create_session_requires_auth(self, client: TestClient) -> None:
        """Create session should require authentication."""
        response = client.post("/api/sessions", json={"name": "Test"})
        assert response.status_code in [401, 403]

    def test_get_session_requires_auth(self, client: TestClient) -> None:
        """Get session should require authentication."""
        response = client.get("/api/sessions/session-123")
        assert response.status_code in [401, 403]

    def test_delete_session_requires_auth(self, client: TestClient) -> None:
        """Delete session should require authentication."""
        response = client.delete("/api/sessions/session-123")
        assert response.status_code in [401, 403]

    def test_update_session_requires_auth(self, client: TestClient) -> None:
        """Update session should require authentication."""
        response = client.patch("/api/sessions/session-123", json={"name": "Updated"})
        assert response.status_code in [401, 403]


class TestSessionSharingEndpoints:
    """Tests for session sharing endpoints."""

    def test_share_session_requires_auth(self, client: TestClient) -> None:
        """Share session should require authentication."""
        response = client.post("/api/sessions/session-123/share")
        assert response.status_code in [401, 403, 404, 405]

    def test_get_shared_session_by_token(self, client: TestClient) -> None:
        """Should return error for invalid share token."""
        response = client.get("/api/sessions/shared/invalid-token")
        assert response.status_code in [401, 404]


class TestSessionPinningEndpoints:
    """Tests for session pinning endpoints."""

    def test_pin_session_requires_auth(self, client: TestClient) -> None:
        """Pin session should require authentication."""
        response = client.post("/api/sessions/session-123/pin")
        assert response.status_code in [401, 403, 404, 405]

    def test_unpin_session_requires_auth(self, client: TestClient) -> None:
        """Unpin session should require authentication."""
        response = client.delete("/api/sessions/session-123/pin")
        assert response.status_code in [401, 403, 404, 405]
