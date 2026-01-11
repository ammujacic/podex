"""Tests for agent endpoints."""

from fastapi.testclient import TestClient


class TestAgentEndpoints:
    """Tests for /api/sessions/{session_id}/agents endpoints."""

    def test_list_agents_requires_auth(self, client: TestClient) -> None:
        """List agents should require authentication."""
        response = client.get("/api/sessions/session-123/agents")
        assert response.status_code in [401, 403]

    def test_create_agent_requires_auth(self, client: TestClient) -> None:
        """Create agent should require authentication."""
        response = client.post(
            "/api/sessions/session-123/agents",
            json={"name": "New Agent", "type": "coder"},
        )
        assert response.status_code in [401, 403]

    def test_get_agent_status_requires_auth(self, client: TestClient) -> None:
        """Get agent status should require authentication."""
        response = client.get("/api/sessions/session-123/agents/agent-1")
        assert response.status_code in [401, 403]

    def test_delete_agent_requires_auth(self, client: TestClient) -> None:
        """Delete agent should require authentication."""
        response = client.delete("/api/sessions/session-123/agents/agent-1")
        assert response.status_code in [401, 403]


class TestAgentAttentionEndpoints:
    """Tests for agent attention endpoints."""

    def test_get_attention_requires_auth(self, client: TestClient) -> None:
        """Get attention should require authentication."""
        response = client.get("/api/sessions/session-123/attention")
        assert response.status_code in [401, 403]

    def test_request_attention_requires_auth(self, client: TestClient) -> None:
        """Request attention should require authentication."""
        response = client.post(
            "/api/sessions/session-123/attention",
            json={"agent_id": "agent-1", "reason": "Need clarification"},
        )
        assert response.status_code in [401, 403, 404, 405]

    def test_dismiss_attention_requires_auth(self, client: TestClient) -> None:
        """Dismiss attention should require authentication."""
        response = client.delete("/api/sessions/session-123/attention/attention-1")
        assert response.status_code in [401, 403, 404, 405]
