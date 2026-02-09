"""Tests for agent service endpoints."""

from fastapi.testclient import TestClient


class TestAgentCreation:
    """Tests for agent creation endpoints."""

    def test_create_agent(self, client: TestClient) -> None:
        """Should be able to create a new agent."""
        response = client.post(
            "/agents",
            json={
                "session_id": "session-123",
                "name": "Test Agent",
                "type": "architect",
            },
        )
        assert response.status_code in [200, 201]
        data = response.json()
        assert "id" in data

    def test_create_agent_requires_session_id(self, client: TestClient) -> None:
        """Agent creation should require session_id."""
        response = client.post(
            "/agents",
            json={"name": "Test Agent", "type": "architect"},
        )
        assert response.status_code == 422

    def test_create_agent_requires_type(self, client: TestClient) -> None:
        """Agent creation should require type."""
        response = client.post(
            "/agents",
            json={"session_id": "session-123", "name": "Test Agent"},
        )
        assert response.status_code == 422


class TestAgentMessaging:
    """Tests for agent messaging endpoints."""

    def test_send_message_to_agent(self, client: TestClient) -> None:
        """Should be able to send a message to an agent."""
        response = client.post(
            "/agents/agent-123/message",
            json={"content": "Hello, agent!"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "task_id" in data

    def test_send_message_to_nonexistent_agent(self, client: TestClient) -> None:
        """Sending message to non-existent agent should return 404."""
        response = client.post(
            "/agents/nonexistent/message",
            json={"content": "Hello!"},
        )
        assert response.status_code == 404

    def test_message_requires_content(self, client: TestClient) -> None:
        """Message should require content."""
        response = client.post(
            "/agents/agent-123/message",
            json={},
        )
        assert response.status_code == 422


class TestAgentStatus:
    """Tests for agent status endpoints."""

    def test_get_agent_status(self, client: TestClient) -> None:
        """Should be able to get agent status."""
        response = client.get("/agents/agent-123")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data

    def test_get_nonexistent_agent(self, client: TestClient) -> None:
        """Getting non-existent agent should return 404."""
        response = client.get("/agents/nonexistent")
        assert response.status_code == 404

    def test_list_session_agents(self, client: TestClient) -> None:
        """Should be able to list agents for a session."""
        response = client.get("/agents?session_id=session-123")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)


class TestAgentDeletion:
    """Tests for agent deletion endpoints."""

    def test_delete_agent(self, client: TestClient) -> None:
        """Should be able to delete an agent."""
        response = client.delete("/agents/agent-123")
        assert response.status_code == 200

    def test_delete_nonexistent_agent(self, client: TestClient) -> None:
        """Deleting non-existent agent should return 404."""
        response = client.delete("/agents/nonexistent")
        assert response.status_code == 404


class TestAgentTools:
    """Tests for agent tool execution."""

    def test_list_available_tools(self, client: TestClient) -> None:
        """Should be able to list available tools."""
        response = client.get("/agents/tools")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
