"""Tests for template endpoints."""

from fastapi.testclient import TestClient


class TestTemplateEndpoints:
    """Tests for /api/templates endpoints."""

    def test_list_templates(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        """List templates should return all templates."""
        response = client.get("/api/templates", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # Should have at least one template
        if len(data) > 0:
            assert "name" in data[0]

    def test_list_templates_with_official_filter(
        self, client: TestClient, auth_headers: dict[str, str]
    ) -> None:
        """List templates should support query params."""
        response = client.get("/api/templates?official=true", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    def test_get_template_by_slug(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        """Get template by slug should return the template."""
        response = client.get("/api/templates/nodejs", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "name" in data

    def test_get_template_not_found(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        """Get template should return 404 for non-existent template."""
        response = client.get("/api/templates/nonexistent", headers=auth_headers)
        assert response.status_code == 404


class TestAgentTemplateEndpoints:
    """Tests for /api/agent-templates endpoints."""

    def test_list_agent_templates_requires_auth(self, client: TestClient) -> None:
        """List agent templates should require authentication."""
        response = client.get("/api/agent-templates")
        assert response.status_code == 401

    def test_get_agent_template_requires_auth(self, client: TestClient) -> None:
        """Get agent template should require authentication."""
        response = client.get("/api/agent-templates/architect")
        assert response.status_code == 401

    def test_get_agent_template_not_found_requires_auth(self, client: TestClient) -> None:
        """Get agent template should require authentication even for non-existent template."""
        response = client.get("/api/agent-templates/nonexistent")
        assert response.status_code == 401

    def test_create_custom_agent_template_requires_auth(self, client: TestClient) -> None:
        """Create custom agent template should require authentication."""
        response = client.post(
            "/api/agent-templates",
            json={"name": "Custom Agent", "system_prompt": "You are a helpful assistant"},
        )
        assert response.status_code in [401, 403, 422]
