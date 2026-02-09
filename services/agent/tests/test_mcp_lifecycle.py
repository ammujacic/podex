"""Tests for MCP lifecycle management module.

Tests cover:
- MCPLifecycleManager initialization
- Connection state management
- Registry access
"""

import pytest
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
import asyncio


class TestMCPLifecycleManagerInit:
    """Test MCPLifecycleManager initialization."""

    def test_lifecycle_manager_module_exists(self):
        """Test lifecycle module can be imported."""
        from src.mcp import lifecycle
        assert lifecycle is not None

    def test_lifecycle_manager_class_exists(self):
        """Test MCPLifecycleManager class exists."""
        from src.mcp.lifecycle import MCPLifecycleManager
        assert MCPLifecycleManager is not None

    def test_lifecycle_manager_initialization(self):
        """Test MCPLifecycleManager initialization."""
        from src.mcp.lifecycle import MCPLifecycleManager

        manager = MCPLifecycleManager(session_id="session-123")

        assert manager.session_id == "session-123"
        assert manager._connected is False
        assert manager._config is None
        assert manager._failed_servers == []
        assert manager._attempted_servers == []

    def test_lifecycle_manager_has_registry(self):
        """Test MCPLifecycleManager has registry property."""
        from src.mcp.lifecycle import MCPLifecycleManager
        from src.mcp.registry import MCPToolRegistry

        manager = MCPLifecycleManager(session_id="session-123")

        assert manager.registry is not None
        assert isinstance(manager.registry, MCPToolRegistry)

    def test_lifecycle_manager_is_connected_property(self):
        """Test is_connected property."""
        from src.mcp.lifecycle import MCPLifecycleManager

        manager = MCPLifecycleManager(session_id="session-123")

        assert manager.is_connected is False

    def test_lifecycle_manager_has_connection_lock(self):
        """Test lifecycle manager has connection lock."""
        from src.mcp.lifecycle import MCPLifecycleManager

        manager = MCPLifecycleManager(session_id="session-123")

        assert manager._connection_lock is not None
        assert isinstance(manager._connection_lock, asyncio.Lock)


class TestMCPToolRegistry:
    """Test MCPToolRegistry class."""

    def test_registry_module_exists(self):
        """Test registry module can be imported."""
        from src.mcp import registry
        assert registry is not None

    def test_mcp_tool_registry_class_exists(self):
        """Test MCPToolRegistry class exists."""
        from src.mcp.registry import MCPToolRegistry
        assert MCPToolRegistry is not None

    def test_mcp_tool_registry_initialization(self):
        """Test MCPToolRegistry initialization."""
        from src.mcp.registry import MCPToolRegistry

        registry = MCPToolRegistry()
        assert registry is not None


class TestMCPClient:
    """Test MCP client module."""

    def test_client_module_exists(self):
        """Test client module can be imported."""
        from src.mcp import client
        assert client is not None

    def test_mcp_server_config_exists(self):
        """Test MCPServerConfig class exists."""
        from src.mcp.client import MCPServerConfig
        assert MCPServerConfig is not None

    def test_mcp_transport_enum_exists(self):
        """Test MCPTransport enum exists."""
        from src.mcp.client import MCPTransport
        assert MCPTransport is not None

    def test_mcp_transport_values(self):
        """Test MCPTransport enum values."""
        from src.mcp.client import MCPTransport

        assert MCPTransport.STDIO is not None
        assert MCPTransport.HTTP is not None
        assert MCPTransport.SSE is not None


class TestMCPIntegration:
    """Test MCP integration module."""

    def test_integration_module_exists(self):
        """Test integration module can be imported."""
        from src.mcp import integration
        assert integration is not None

    def test_user_mcp_config_exists(self):
        """Test UserMCPConfig class exists."""
        from src.mcp.integration import UserMCPConfig
        assert UserMCPConfig is not None

    def test_user_mcp_server_config_exists(self):
        """Test UserMCPServerConfig class exists."""
        from src.mcp.integration import UserMCPServerConfig
        assert UserMCPServerConfig is not None

    def test_user_mcp_config_creation(self):
        """Test UserMCPConfig creation."""
        from src.mcp.integration import UserMCPConfig

        config = UserMCPConfig(user_id="user-123", servers=[])
        assert config.user_id == "user-123"
        assert config.servers == []

    def test_user_mcp_server_config_creation(self):
        """Test UserMCPServerConfig creation."""
        from src.mcp.integration import UserMCPServerConfig

        server_config = UserMCPServerConfig(
            id="server-123",
            name="test-server",
            transport="stdio",
        )

        assert server_config.id == "server-123"
        assert server_config.name == "test-server"
        assert server_config.transport == "stdio"


# ============================================================================
# Extended MCP Client Tests
# ============================================================================


class TestMCPServerConfig:
    """Test MCPServerConfig dataclass."""

    def test_mcp_server_config_creation(self):
        """Test MCPServerConfig creation."""
        from src.mcp.client import MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="server-1",
            name="Test Server",
            transport=MCPTransport.STDIO,
            command="node",
            args=["server.js"],
        )

        assert config.id == "server-1"
        assert config.name == "Test Server"
        assert config.transport == MCPTransport.STDIO
        assert config.command == "node"
        assert config.args == ["server.js"]
        assert config.timeout == 30  # default

    def test_mcp_server_config_http(self):
        """Test MCPServerConfig for HTTP transport."""
        from src.mcp.client import MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="http-server",
            name="HTTP Server",
            transport=MCPTransport.HTTP,
            url="http://localhost:8080/mcp",
            auth_token="token-123",
        )

        assert config.transport == MCPTransport.HTTP
        assert config.url == "http://localhost:8080/mcp"
        assert config.auth_token == "token-123"

    def test_mcp_server_config_with_env_vars(self):
        """Test MCPServerConfig with environment variables."""
        from src.mcp.client import MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="server-env",
            name="Server with Env",
            transport=MCPTransport.STDIO,
            command="python",
            env_vars={"API_KEY": "secret", "DEBUG": "true"},
        )

        assert config.env_vars == {"API_KEY": "secret", "DEBUG": "true"}


class TestMCPToolDefinition:
    """Test MCPToolDefinition dataclass."""

    def test_mcp_tool_definition_creation(self):
        """Test MCPToolDefinition creation."""
        from src.mcp.client import MCPToolDefinition

        tool = MCPToolDefinition(
            name="search",
            description="Search for documents",
            input_schema={
                "type": "object",
                "properties": {"query": {"type": "string"}},
            },
            server_id="server-1",
        )

        assert tool.name == "search"
        assert tool.description == "Search for documents"
        assert tool.server_id == "server-1"


class TestIsSafeEnvVar:
    """Test _is_safe_env_var function."""

    def test_safe_env_vars(self):
        """Test safe environment variable names."""
        from src.mcp.client import _is_safe_env_var

        assert _is_safe_env_var("API_KEY") is True
        assert _is_safe_env_var("MY_CONFIG") is True
        assert _is_safe_env_var("DEBUG") is True
        assert _is_safe_env_var("custom_var") is True

    def test_dangerous_exact_match_vars(self):
        """Test dangerous exact match env vars are blocked."""
        from src.mcp.client import _is_safe_env_var

        assert _is_safe_env_var("PATH") is False
        assert _is_safe_env_var("HOME") is False
        assert _is_safe_env_var("SHELL") is False
        assert _is_safe_env_var("ENV") is False

    def test_dangerous_prefix_vars(self):
        """Test dangerous prefix env vars are blocked."""
        from src.mcp.client import _is_safe_env_var

        assert _is_safe_env_var("LD_PRELOAD") is False
        assert _is_safe_env_var("LD_LIBRARY_PATH") is False
        assert _is_safe_env_var("PYTHONPATH") is False
        assert _is_safe_env_var("NODE_OPTIONS") is False
        assert _is_safe_env_var("JAVA_TOOL_OPTIONS") is False

    def test_invalid_format_vars(self):
        """Test invalid format env vars are blocked."""
        from src.mcp.client import _is_safe_env_var

        # Special characters not allowed
        assert _is_safe_env_var("VAR$NAME") is False
        assert _is_safe_env_var("VAR=NAME") is False
        assert _is_safe_env_var("VAR NAME") is False


class TestMCPClientInit:
    """Test MCPClient initialization."""

    def test_mcp_client_initialization(self):
        """Test MCPClient initialization."""
        from src.mcp.client import MCPClient, MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="test",
            name="Test",
            transport=MCPTransport.STDIO,
            command="node",
        )

        client = MCPClient(config)

        assert client._config == config
        assert client._connected is False
        assert client._tools == []
        assert client._request_id == 0

    def test_mcp_client_is_connected_property(self):
        """Test MCPClient is_connected property."""
        from src.mcp.client import MCPClient, MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="test",
            name="Test",
            transport=MCPTransport.STDIO,
            command="node",
        )

        client = MCPClient(config)

        assert client.is_connected is False

    def test_mcp_client_tools_property(self):
        """Test MCPClient tools property."""
        from src.mcp.client import MCPClient, MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="test",
            name="Test",
            transport=MCPTransport.STDIO,
            command="node",
        )

        client = MCPClient(config)

        assert client.tools == []


class TestMCPClientConnect:
    """Test MCPClient connect method."""

    @pytest.mark.asyncio
    async def test_connect_already_connected(self):
        """Test connect when already connected."""
        from src.mcp.client import MCPClient, MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="test",
            name="Test",
            transport=MCPTransport.STDIO,
            command="node",
        )

        client = MCPClient(config)
        client._connected = True

        result = await client.connect()
        assert result is True

    @pytest.mark.asyncio
    async def test_connect_stdio_no_command(self):
        """Test connect stdio with no command fails."""
        from src.mcp.client import MCPClient, MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="test",
            name="Test",
            transport=MCPTransport.STDIO,
            command=None,
        )

        client = MCPClient(config)
        result = await client.connect()
        assert result is False

    @pytest.mark.asyncio
    async def test_connect_http_no_url(self):
        """Test connect HTTP with no URL fails."""
        from src.mcp.client import MCPClient, MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="test",
            name="Test",
            transport=MCPTransport.HTTP,
            url=None,
        )

        client = MCPClient(config)
        result = await client.connect()
        assert result is False


class TestMCPClientDisconnect:
    """Test MCPClient disconnect method."""

    @pytest.mark.asyncio
    async def test_disconnect_clears_state(self):
        """Test disconnect clears connection state."""
        from src.mcp.client import MCPClient, MCPServerConfig, MCPTransport, MCPToolDefinition

        config = MCPServerConfig(
            id="test",
            name="Test",
            transport=MCPTransport.STDIO,
            command="node",
        )

        client = MCPClient(config)
        client._connected = True
        client._tools = [
            MCPToolDefinition(name="t1", description="d", input_schema={}, server_id="test")
        ]

        await client.disconnect()

        assert client._connected is False
        assert client._tools == []

    @pytest.mark.asyncio
    async def test_disconnect_with_process(self):
        """Test disconnect terminates process."""
        from src.mcp.client import MCPClient, MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="test",
            name="Test",
            transport=MCPTransport.STDIO,
            command="node",
        )

        client = MCPClient(config)
        mock_process = MagicMock()
        mock_process.terminate = MagicMock()
        mock_process.wait = AsyncMock()
        client._process = mock_process
        client._connected = True

        await client.disconnect()

        mock_process.terminate.assert_called_once()

    @pytest.mark.asyncio
    async def test_disconnect_with_http_client(self):
        """Test disconnect closes HTTP client."""
        from src.mcp.client import MCPClient, MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="test",
            name="Test",
            transport=MCPTransport.HTTP,
            url="http://localhost:8080",
        )

        client = MCPClient(config)
        mock_http_client = MagicMock()
        mock_http_client.aclose = AsyncMock()
        client._http_client = mock_http_client
        client._connected = True

        await client.disconnect()

        mock_http_client.aclose.assert_called_once()
        assert client._http_client is None


class TestMCPClientCallTool:
    """Test MCPClient call_tool method."""

    @pytest.mark.asyncio
    async def test_call_tool_not_connected(self):
        """Test call_tool when not connected."""
        from src.mcp.client import MCPClient, MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="test",
            name="Test",
            transport=MCPTransport.STDIO,
            command="node",
        )

        client = MCPClient(config)
        result = await client.call_tool("test_tool", {"arg": "value"})

        assert result["success"] is False
        assert "Not connected" in result["error"]

    @pytest.mark.asyncio
    async def test_call_tool_success(self):
        """Test call_tool success."""
        from src.mcp.client import MCPClient, MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="test",
            name="Test",
            transport=MCPTransport.HTTP,
            url="http://localhost:8080",
        )

        client = MCPClient(config)
        client._connected = True
        client._send_request = AsyncMock(return_value={
            "result": {
                "content": [
                    {"type": "text", "text": "Tool output"}
                ]
            }
        })

        result = await client.call_tool("test_tool", {"arg": "value"})

        assert result["success"] is True
        assert result["output"] == "Tool output"

    @pytest.mark.asyncio
    async def test_call_tool_error_response(self):
        """Test call_tool with error response."""
        from src.mcp.client import MCPClient, MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="test",
            name="Test",
            transport=MCPTransport.HTTP,
            url="http://localhost:8080",
        )

        client = MCPClient(config)
        client._connected = True
        client._send_request = AsyncMock(return_value={
            "error": {"message": "Tool not found"}
        })

        result = await client.call_tool("unknown_tool", {})

        assert result["success"] is False
        assert result["error"] == "Tool not found"


class TestMCPClientListResources:
    """Test MCPClient list_resources method."""

    @pytest.mark.asyncio
    async def test_list_resources_success(self):
        """Test list_resources success."""
        from src.mcp.client import MCPClient, MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="test",
            name="Test",
            transport=MCPTransport.HTTP,
            url="http://localhost:8080",
        )

        client = MCPClient(config)
        client._connected = True
        client._send_request = AsyncMock(return_value={
            "result": {
                "resources": [
                    {"uri": "file://test.txt", "name": "test.txt"}
                ]
            }
        })

        resources = await client.list_resources()

        assert len(resources) == 1
        assert resources[0]["uri"] == "file://test.txt"

    @pytest.mark.asyncio
    async def test_list_resources_error(self):
        """Test list_resources with error."""
        from src.mcp.client import MCPClient, MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="test",
            name="Test",
            transport=MCPTransport.HTTP,
            url="http://localhost:8080",
        )

        client = MCPClient(config)
        client._connected = True
        client._send_request = AsyncMock(return_value={"error": {"message": "Failed"}})

        resources = await client.list_resources()

        assert resources == []


class TestMCPClientReadResource:
    """Test MCPClient read_resource method."""

    @pytest.mark.asyncio
    async def test_read_resource_success(self):
        """Test read_resource success."""
        from src.mcp.client import MCPClient, MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="test",
            name="Test",
            transport=MCPTransport.HTTP,
            url="http://localhost:8080",
        )

        client = MCPClient(config)
        client._connected = True
        client._send_request = AsyncMock(return_value={
            "result": {
                "contents": [{"type": "text", "text": "File content"}]
            }
        })

        result = await client.read_resource("file://test.txt")

        assert result["success"] is True
        assert len(result["contents"]) == 1

    @pytest.mark.asyncio
    async def test_read_resource_error(self):
        """Test read_resource with error."""
        from src.mcp.client import MCPClient, MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="test",
            name="Test",
            transport=MCPTransport.HTTP,
            url="http://localhost:8080",
        )

        client = MCPClient(config)
        client._connected = True
        client._send_request = AsyncMock(return_value={
            "error": {"message": "Resource not found"}
        })

        result = await client.read_resource("file://missing.txt")

        assert result["success"] is False
        assert result["error"] == "Resource not found"


class TestMCPClientSendRequest:
    """Test MCPClient _send_request method routing."""

    @pytest.mark.asyncio
    async def test_send_request_routes_to_http(self):
        """Test _send_request routes to HTTP for HTTP transport."""
        from src.mcp.client import MCPClient, MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="test",
            name="Test",
            transport=MCPTransport.HTTP,
            url="http://localhost:8080",
        )

        client = MCPClient(config)
        client._send_http_request = AsyncMock(return_value={"result": {}})

        await client._send_request("test_method", {"param": "value"})

        client._send_http_request.assert_called_once_with("test_method", {"param": "value"})

    @pytest.mark.asyncio
    async def test_send_request_routes_to_sse(self):
        """Test _send_request routes to HTTP for SSE transport."""
        from src.mcp.client import MCPClient, MCPServerConfig, MCPTransport

        config = MCPServerConfig(
            id="test",
            name="Test",
            transport=MCPTransport.SSE,
            url="http://localhost:8080",
        )

        client = MCPClient(config)
        client._send_http_request = AsyncMock(return_value={"result": {}})

        await client._send_request("test_method", {"param": "value"})

        client._send_http_request.assert_called_once()


class TestMCPLifecycleManagerMethods:
    """Test MCPLifecycleManager async methods."""

    @pytest.fixture
    def manager(self):
        """Create lifecycle manager."""
        from src.mcp.lifecycle import MCPLifecycleManager
        return MCPLifecycleManager(session_id="session-123")

    def test_get_server_status_not_connected(self, manager):
        """Test get_server_status when not connected."""
        status = manager.get_server_status()
        assert status["connected"] is False
        assert status["session_id"] == "session-123"

    def test_failed_servers_tracking(self, manager):
        """Test failed servers are tracked."""
        manager._failed_servers = ["server1", "server2"]
        assert len(manager._failed_servers) == 2

    def test_attempted_servers_tracking(self, manager):
        """Test attempted servers are tracked."""
        manager._attempted_servers = ["server1"]
        assert "server1" in manager._attempted_servers

    @pytest.mark.asyncio
    async def test_ensure_connected_connects_once(self, monkeypatch: pytest.MonkeyPatch, manager):
        """ensure_connected only connects once and reuses registry."""
        from src.mcp.lifecycle import MCPLifecycleManager
        from src.mcp.integration import UserMCPConfig, UserMCPServerConfig

        # Replace registry with a mock to avoid real connections
        mock_registry = MagicMock()
        mock_registry.add_server = AsyncMock(return_value=True)
        manager._registry = mock_registry

        server_cfg = UserMCPServerConfig(
            id="s1",
            name="server-1",
            transport="stdio",
            command="node",
        )
        user_cfg = UserMCPConfig(user_id="u1", servers=[server_cfg])

        await manager.ensure_connected(user_cfg)
        assert manager.is_connected is True
        # Second call should be a no-op
        await manager.ensure_connected(user_cfg)
        mock_registry.add_server.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_connect_servers_sets_auth_token_for_internal_agent(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """_connect_servers sets auth_token when URL matches AGENT_INTERNAL_URL."""
        from src import config as config_module
        from src.mcp.lifecycle import MCPLifecycleManager
        from src.mcp.integration import UserMCPServerConfig

        manager = MCPLifecycleManager(session_id="s1")

        # Configure settings to look like a deployed internal URL
        config_module.settings.AGENT_INTERNAL_URL = "http://agent:3002"
        config_module.settings.INTERNAL_SERVICE_TOKEN = "secret-token"

        # Capture configs passed to registry
        captured: list[Any] = []

        async def fake_add_server(mcp_config: Any) -> bool:
            captured.append(mcp_config)
            return True

        manager._registry = MagicMock()
        manager._registry.add_server = AsyncMock(side_effect=fake_add_server)

        servers = [
            UserMCPServerConfig(
                id="internal",
                name="internal-server",
                transport="http",
                url="http://agent:3002/mcp",
            ),
            UserMCPServerConfig(
                id="external",
                name="external-server",
                transport="http",
                url="https://example.com/mcp",
            ),
        ]

        await manager._connect_servers(servers)

        assert len(captured) == 2
        internal_cfg = next(c for c in captured if c.id == "internal")
        external_cfg = next(c for c in captured if c.id == "external")
        assert internal_cfg.auth_token == "secret-token"
        assert external_cfg.auth_token is None

    @pytest.mark.asyncio
    async def test_connect_with_retry_limits_retries_on_failure(
        self,
        monkeypatch: pytest.MonkeyPatch,
        manager,
    ):
        """_connect_with_retry stops after configured retries."""
        from src.mcp.client import MCPServerConfig, MCPTransport
        from src import config as config_module

        config_module.settings.MCP_MAX_RETRIES = 3
        config_module.settings.MCP_RETRY_DELAY = 0.01

        # Always fail
        manager._registry = MagicMock()
        manager._registry.add_server = AsyncMock(side_effect=RuntimeError("fail"))

        async def fake_sleep(_delay: float) -> None:
            return None

        monkeypatch.setattr("asyncio.sleep", fake_sleep)

        cfg = MCPServerConfig(
            id="s1",
            name="server-1",
            transport=MCPTransport.STDIO,
            command="node",
        )

        result = await manager._connect_with_retry(cfg)
        assert result is False
        # Should have attempted MCP_MAX_RETRIES times
        assert manager._registry.add_server.await_count == config_module.settings.MCP_MAX_RETRIES

    @pytest.mark.asyncio
    async def test_disconnect_all_removes_servers_and_resets_state(self, manager):
        """disconnect_all removes all servers and marks manager as disconnected."""
        # Pretend two servers are connected
        manager._registry = MagicMock()
        manager._registry.connected_servers = {"s1", "s2"}
        manager._registry.remove_server = AsyncMock()
        manager._connected = True

        await manager.disconnect_all()

        # Called for each server id
        calls = {c.args[0] for c in manager._registry.remove_server.await_args_list}
        assert calls == {"s1", "s2"}
        assert manager._connected is False


class TestLifecycleStoreAndHelpers:
    """Tests for MCPLifecycleStore and helper functions."""

    @pytest.mark.asyncio
    async def test_get_or_create_returns_same_manager_for_session(self):
        from src.mcp.lifecycle import MCPLifecycleStore

        store = MCPLifecycleStore()
        m1 = await store.get_or_create("s1")
        m2 = await store.get_or_create("s1")
        assert m1 is m2

    @pytest.mark.asyncio
    async def test_remove_cleans_up_manager(self, monkeypatch: pytest.MonkeyPatch):
        from src.mcp.lifecycle import MCPLifecycleStore

        store = MCPLifecycleStore()
        manager = MagicMock()
        manager.disconnect_all = AsyncMock()

        # Inject fake manager
        store._managers["s1"] = manager

        await store.remove("s1")

        manager.disconnect_all.assert_awaited_once()
        assert "s1" not in store._managers

    @pytest.mark.asyncio
    async def test_cleanup_all_clears_all_managers(self):
        from src.mcp.lifecycle import MCPLifecycleStore

        store = MCPLifecycleStore()
        m1 = MagicMock()
        m1.disconnect_all = AsyncMock()
        m2 = MagicMock()
        m2.disconnect_all = AsyncMock()
        store._managers = {"s1": m1, "s2": m2}

        await store.cleanup_all()

        m1.disconnect_all.assert_awaited_once()
        m2.disconnect_all.assert_awaited_once()
        assert store._managers == {}

    def test_singleton_store_reuses_instance(self):
        from src.mcp.lifecycle import get_lifecycle_store

        s1 = get_lifecycle_store()
        s2 = get_lifecycle_store()
        assert s1 is s2

    @pytest.mark.asyncio
    async def test_get_lifecycle_manager_helper_uses_store(self, monkeypatch: pytest.MonkeyPatch):
        from src.mcp.lifecycle import get_lifecycle_manager, MCPLifecycleStore

        store = MCPLifecycleStore()
        manager = MagicMock()
        store.get_or_create = AsyncMock(return_value=manager)

        # Force singleton to use our store instance
        from src.mcp import lifecycle as lifecycle_module

        lifecycle_module._LifecycleStoreSingleton._instance = store

        result = await get_lifecycle_manager("s1")
        assert result is manager

    @pytest.mark.asyncio
    async def test_cleanup_session_mcp_uses_store(self, monkeypatch: pytest.MonkeyPatch):
        from src.mcp.lifecycle import cleanup_session_mcp, MCPLifecycleStore

        store = MCPLifecycleStore()
        store.remove = AsyncMock()

        from src.mcp import lifecycle as lifecycle_module

        lifecycle_module._LifecycleStoreSingleton._instance = store

        await cleanup_session_mcp("s1")
        store.remove.assert_awaited_once_with("s1")
