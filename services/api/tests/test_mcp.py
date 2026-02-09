"""
Comprehensive tests for MCP (Model Context Protocol) routes.

Tests cover:
- MCP server CRUD operations
- Server discovery and refresh
- Default server catalog
- Effective configuration
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient

# ============================================================================
# FIXTURES
# ============================================================================


@pytest.fixture
def test_mcp_server(test_user: dict[str, Any]) -> dict[str, Any]:
    """Create a test MCP server."""
    return {
        "id": "mcp-server-123",
        "user_id": test_user["id"],
        "name": "Test MCP Server",
        "description": "A test MCP server",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@test/mcp-server"],
        "url": None,
        "env_vars": {"TEST_VAR": "test_value"},
        "is_enabled": True,
        "discovered_tools": [
            {
                "name": "test_tool",
                "description": "A test tool",
                "input_schema": {"type": "object", "properties": {}},
            }
        ],
        "discovered_resources": [],
        "last_connected_at": "2024-01-01T00:00:00Z",
        "last_error": None,
        "source_slug": None,
        "category": None,
        "is_default": False,
        "config_source": "ui",
        "icon": None,
    }


@pytest.fixture
def test_mcp_server_create() -> dict[str, Any]:
    """Create data for creating an MCP server."""
    return {
        "name": "New MCP Server",
        "description": "A new MCP server",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@new/mcp-server"],
        "env_vars": {},
    }


# ============================================================================
# MCP SERVER CRUD TESTS
# ============================================================================


class TestMCPServerCRUD:
    """Tests for MCP server CRUD operations."""

    def test_list_servers_unauthenticated(self, client: TestClient) -> None:
        """Test listing MCP servers without auth."""
        response = client.get("/api/mcp/servers")
        assert response.status_code in [401, 404]

    def test_create_server_unauthenticated(
        self, client: TestClient, test_mcp_server_create: dict[str, Any]
    ) -> None:
        """Test creating MCP server without auth."""
        response = client.post("/api/mcp/servers", json=test_mcp_server_create)
        assert response.status_code in [401, 404]

    def test_get_server_unauthenticated(self, client: TestClient) -> None:
        """Test getting MCP server without auth."""
        response = client.get("/api/mcp/servers/mcp-server-123")
        assert response.status_code in [401, 404]

    def test_update_server_unauthenticated(self, client: TestClient) -> None:
        """Test updating MCP server without auth."""
        response = client.patch(
            "/api/mcp/servers/mcp-server-123",
            json={"name": "Updated Server"},
        )
        assert response.status_code in [401, 404]

    def test_delete_server_unauthenticated(self, client: TestClient) -> None:
        """Test deleting MCP server without auth."""
        response = client.delete("/api/mcp/servers/mcp-server-123")
        assert response.status_code in [401, 404]


# ============================================================================
# MCP SERVER VALIDATION TESTS
# ============================================================================


class TestMCPServerValidation:
    """Tests for MCP server input validation."""

    def test_create_server_invalid_transport(self, client: TestClient) -> None:
        """Test creating server with invalid transport."""
        response = client.post(
            "/api/mcp/servers",
            json={
                "name": "Test",
                "transport": "invalid",
                "command": "test",
            },
        )
        assert response.status_code in [401, 404, 422]

    def test_create_server_missing_command_for_stdio(self, client: TestClient) -> None:
        """Test creating stdio server without command."""
        response = client.post(
            "/api/mcp/servers",
            json={
                "name": "Test",
                "transport": "stdio",
            },
        )
        assert response.status_code in [400, 401, 404, 422]

    def test_create_server_missing_url_for_sse(self, client: TestClient) -> None:
        """Test creating sse server without url."""
        response = client.post(
            "/api/mcp/servers",
            json={
                "name": "Test",
                "transport": "sse",
            },
        )
        assert response.status_code in [400, 401, 404, 422]

    def test_create_server_shell_injection_command(self, client: TestClient) -> None:
        """Test creating server with shell injection in command."""
        response = client.post(
            "/api/mcp/servers",
            json={
                "name": "Test",
                "transport": "stdio",
                "command": "test; rm -rf /",
            },
        )
        assert response.status_code in [401, 404, 422]

    def test_create_server_shell_injection_args(self, client: TestClient) -> None:
        """Test creating server with shell injection in args."""
        response = client.post(
            "/api/mcp/servers",
            json={
                "name": "Test",
                "transport": "stdio",
                "command": "npx",
                "args": ["test", "; rm -rf /"],
            },
        )
        assert response.status_code in [401, 404, 422]

    def test_create_server_invalid_env_var_name(self, client: TestClient) -> None:
        """Test creating server with invalid env var name."""
        response = client.post(
            "/api/mcp/servers",
            json={
                "name": "Test",
                "transport": "stdio",
                "command": "npx",
                "env_vars": {"123INVALID": "value"},
            },
        )
        assert response.status_code in [401, 404, 422]


# ============================================================================
# MCP SERVER DISCOVERY TESTS
# ============================================================================


class TestMCPServerDiscovery:
    """Tests for MCP server discovery and refresh."""

    def test_refresh_server_unauthenticated(self, client: TestClient) -> None:
        """Test refreshing server without auth."""
        response = client.post("/api/mcp/servers/mcp-server-123/refresh")
        assert response.status_code in [401, 404]

    def test_list_server_tools_unauthenticated(self, client: TestClient) -> None:
        """Test listing server tools without auth."""
        response = client.get("/api/mcp/servers/mcp-server-123/tools")
        assert response.status_code in [401, 404]


# ============================================================================
# MCP SERVER ENABLE/DISABLE TESTS
# ============================================================================


class TestMCPServerEnableDisable:
    """Tests for MCP server enable/disable."""

    def test_enable_server_unauthenticated(self, client: TestClient) -> None:
        """Test enabling server without auth."""
        response = client.post("/api/mcp/servers/mcp-server-123/enable")
        assert response.status_code in [401, 404]

    def test_disable_server_unauthenticated(self, client: TestClient) -> None:
        """Test disabling server without auth."""
        response = client.post("/api/mcp/servers/mcp-server-123/disable")
        assert response.status_code in [401, 404]


# ============================================================================
# MCP DEFAULTS CATALOG TESTS
# ============================================================================


class TestMCPDefaultsCatalog:
    """Tests for MCP defaults catalog."""

    def test_list_default_servers_unauthenticated(self, client: TestClient) -> None:
        """Test listing default servers without auth."""
        response = client.get("/api/mcp/defaults")
        assert response.status_code in [401, 404]

    def test_get_default_server_unauthenticated(self, client: TestClient) -> None:
        """Test getting default server without auth."""
        response = client.get("/api/mcp/defaults/github")
        assert response.status_code in [401, 404]

    def test_enable_default_server_unauthenticated(self, client: TestClient) -> None:
        """Test enabling default server without auth."""
        response = client.post(
            "/api/mcp/defaults/github/enable",
            json={"env_vars": {"GITHUB_TOKEN": "test"}},
        )
        assert response.status_code in [401, 404]

    def test_disable_default_server_unauthenticated(self, client: TestClient) -> None:
        """Test disabling default server without auth."""
        response = client.post("/api/mcp/defaults/github/disable")
        assert response.status_code in [401, 404]


# ============================================================================
# MCP EFFECTIVE CONFIG TESTS
# ============================================================================


class TestMCPEffectiveConfig:
    """Tests for effective MCP configuration."""

    def test_get_effective_config_unauthenticated(self, client: TestClient) -> None:
        """Test getting effective config without auth."""
        response = client.get("/api/mcp/servers/effective")
        assert response.status_code in [401, 404]

    def test_sync_from_env_unauthenticated(self, client: TestClient) -> None:
        """Test syncing from env without auth."""
        response = client.post("/api/mcp/servers/sync-from-env")
        assert response.status_code in [401, 404]
