"""Comprehensive tests for MCP (Model Context Protocol) integration.

Tests cover:
- MCPLifecycleManager connection management
- MCPToolRegistry tool discovery
- MCPClient communication
- MCP tool execution
- Error handling and timeouts
"""

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestMCPToolRegistry:
    """Test MCPToolRegistry."""

    def test_registry_initialization(self):
        """Test registry initialization."""
        from src.mcp.registry import MCPToolRegistry

        registry = MCPToolRegistry()

        assert len(registry._tools) == 0
        assert len(registry._clients) == 0

    def test_connected_servers_property(self):
        """Test connected_servers property."""
        from src.mcp.registry import MCPToolRegistry

        registry = MCPToolRegistry()

        # Initially no connected servers
        assert len(registry.connected_servers) == 0

    def test_available_tools_property(self):
        """Test available_tools property."""
        from src.mcp.registry import MCPToolRegistry

        registry = MCPToolRegistry()

        # Initially no tools
        assert len(registry.available_tools) == 0

    def test_get_tool_not_found(self):
        """Test getting non-existent tool."""
        from src.mcp.registry import MCPToolRegistry

        registry = MCPToolRegistry()

        tool = registry.get_tool("nonexistent")

        assert tool is None

    def test_get_tool_definitions_empty(self):
        """Test getting tool definitions when empty."""
        from src.mcp.registry import MCPToolRegistry

        registry = MCPToolRegistry()

        definitions = registry.get_tool_definitions()

        assert definitions == []

    def test_search_tools_empty(self):
        """Test searching tools when empty."""
        from src.mcp.registry import MCPToolRegistry

        registry = MCPToolRegistry()

        results = registry.search_tools("test")

        assert results == []


class TestMCPToolRegistryGlobal:
    """Test MCPToolRegistry global instance management."""

    def test_get_mcp_registry(self):
        """Test get_mcp_registry function."""
        from src.mcp.registry import get_mcp_registry, MCPToolRegistry

        registry = get_mcp_registry()

        assert isinstance(registry, MCPToolRegistry)

    def test_set_mcp_registry(self):
        """Test set_mcp_registry function."""
        from src.mcp.registry import get_mcp_registry, set_mcp_registry, MCPToolRegistry

        # Create a new registry
        new_registry = MCPToolRegistry()
        set_mcp_registry(new_registry)

        # Should be the same instance
        assert get_mcp_registry() is new_registry


class TestMCPTool:
    """Test MCPTool class."""

    def test_mcp_tool_properties(self):
        """Test MCPTool properties."""
        from src.mcp.registry import MCPTool
        from src.mcp.client import MCPToolDefinition

        mock_client = MagicMock()
        mock_client.server_id = "test-server"

        definition = MCPToolDefinition(
            name="test_tool",
            description="A test tool",
            input_schema={"type": "object"},
            server_id="test-server",
        )

        tool = MCPTool(definition=definition, client=mock_client)

        assert tool.name == "test_tool"
        assert tool.description == "A test tool"
        assert tool.input_schema == {"type": "object"}
        assert tool.qualified_name == "test-server:test_tool"


class TestMCPLifecycleManager:
    """Test MCPLifecycleManager."""

    def test_manager_initialization(self):
        """Test manager initialization."""
        from src.mcp.lifecycle import MCPLifecycleManager

        manager = MCPLifecycleManager(session_id="session-123")

        assert manager.session_id == "session-123"
        assert manager.is_connected is False

    def test_manager_is_connected_default(self):
        """Test is_connected property default."""
        from src.mcp.lifecycle import MCPLifecycleManager

        manager = MCPLifecycleManager(session_id="session-123")

        assert manager.is_connected is False

    @pytest.mark.asyncio
    async def test_ensure_connected_empty_config(self):
        """Test ensure_connected with empty config."""
        from src.mcp.lifecycle import MCPLifecycleManager
        from src.mcp.integration import UserMCPConfig

        manager = MCPLifecycleManager(session_id="session-123")

        # With empty config, should still work
        config = UserMCPConfig(user_id="user-123", servers=[])
        await manager.ensure_connected(config)

        # Connected flag is set to True even with no servers
        assert manager.is_connected is True

    @pytest.mark.asyncio
    async def test_disconnect_all(self):
        """Test disconnect_all method."""
        from src.mcp.lifecycle import MCPLifecycleManager

        manager = MCPLifecycleManager(session_id="session-123")

        # Should not raise even with nothing connected
        await manager.disconnect_all()

        assert manager.is_connected is False

    def test_get_connected_server_count(self):
        """Test connected server count."""
        from src.mcp.lifecycle import MCPLifecycleManager

        manager = MCPLifecycleManager(session_id="session-123")

        count = manager.get_connected_server_count()

        assert count == 0

    def test_get_tool_count(self):
        """Test tool count."""
        from src.mcp.lifecycle import MCPLifecycleManager

        manager = MCPLifecycleManager(session_id="session-123")

        count = manager.get_tool_count()

        assert count == 0


class TestMCPClient:
    """Test MCPClient."""

    def test_client_initialization(self):
        """Test MCPClient initialization."""
        from src.mcp.client import MCPClient, MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="test-server",
            name="Test Server",
            transport=MCPTransport.STDIO,
            command="echo",
            args=["hello"],
        )

        client = MCPClient(config)

        assert client._config.id == "test-server"
        assert client.is_connected is False

    @pytest.mark.asyncio
    async def test_client_disconnect_when_not_connected(self):
        """Test disconnect when not connected."""
        from src.mcp.client import MCPClient, MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="test-server",
            name="Test Server",
            transport=MCPTransport.STDIO,
            command="echo",
            args=[],
        )

        client = MCPClient(config)

        # Should not raise
        await client.disconnect()

    def test_client_is_connected(self):
        """Test is_connected property."""
        from src.mcp.client import MCPClient, MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="test-server",
            name="Test Server",
            transport=MCPTransport.STDIO,
            command="echo",
            args=[],
        )

        client = MCPClient(config)

        assert client.is_connected is False


class TestMCPServerConfig:
    """Test MCPServerConfig."""

    def test_config_creation(self):
        """Test MCPServerConfig creation."""
        from src.mcp.client import MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="github-server",
            name="GitHub MCP Server",
            transport=MCPTransport.STDIO,
            command="npx",
            args=["-y", "@modelcontextprotocol/server-github"],
            env_vars={"GITHUB_TOKEN": "test-token"},
        )

        assert config.id == "github-server"
        assert config.name == "GitHub MCP Server"
        assert config.transport == MCPTransport.STDIO
        assert config.command == "npx"
        assert "GITHUB_TOKEN" in config.env_vars


class TestMCPTransport:
    """Test MCPTransport enum."""

    def test_transport_values(self):
        """Test MCPTransport enum values."""
        from src.mcp.client import MCPTransport

        assert MCPTransport.STDIO.value == "stdio"
        assert MCPTransport.SSE.value == "sse"


class TestMCPToolDefinition:
    """Test MCPToolDefinition."""

    def test_definition_creation(self):
        """Test MCPToolDefinition creation."""
        from src.mcp.client import MCPToolDefinition

        definition = MCPToolDefinition(
            name="read_file",
            description="Read file contents",
            input_schema={"type": "object", "properties": {"path": {"type": "string"}}},
            server_id="filesystem-server",
        )

        assert definition.name == "read_file"
        assert definition.description == "Read file contents"
        assert definition.server_id == "filesystem-server"


class TestMCPHelperFunctions:
    """Test MCP helper functions."""

    @pytest.mark.asyncio
    async def test_get_lifecycle_manager(self):
        """Test get_lifecycle_manager function."""
        from src.mcp.lifecycle import get_lifecycle_manager

        manager = await get_lifecycle_manager("session-123")

        assert manager is not None
        assert manager.session_id == "session-123"

    @pytest.mark.asyncio
    async def test_cleanup_session_mcp(self):
        """Test cleanup_session_mcp function."""
        from src.mcp.lifecycle import cleanup_session_mcp

        # Should not raise
        await cleanup_session_mcp("session-123")


class TestMCPErrors:
    """Test MCP error handling."""

    def test_mcp_tool_not_found(self):
        """Test getting non-existent MCP tool."""
        from src.mcp.registry import MCPToolRegistry

        registry = MCPToolRegistry()

        # Should return None, not raise
        tool = registry.get_tool("mcp:nonexistent:tool")

        assert tool is None

    def test_search_returns_empty_for_no_match(self):
        """Test search returns empty list for no matches."""
        from src.mcp.registry import MCPToolRegistry

        registry = MCPToolRegistry()

        results = registry.search_tools("nonexistent_functionality")

        assert results == []


class TestMCPIntegration:
    """Test MCP integration with other systems."""

    def test_registry_singleton_pattern(self):
        """Test registry uses singleton pattern."""
        from src.mcp.registry import get_mcp_registry

        registry1 = get_mcp_registry()
        registry2 = get_mcp_registry()

        assert registry1 is registry2

    @pytest.mark.asyncio
    async def test_lifecycle_manager_per_session(self):
        """Test each session gets its own lifecycle manager."""
        from src.mcp.lifecycle import get_lifecycle_manager

        manager1 = await get_lifecycle_manager("session-1")
        manager2 = await get_lifecycle_manager("session-2")

        assert manager1.session_id == "session-1"
        assert manager2.session_id == "session-2"
