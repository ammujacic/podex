"""MCP lifecycle management for session-scoped registries.

This module provides:
- MCPLifecycleManager: Manages MCP server connections for a session
- Connection pooling and lazy initialization
- Graceful cleanup on session termination
"""

import asyncio
from typing import Any

import structlog

from src.config import settings
from src.mcp.client import MCPServerConfig, MCPTransport
from src.mcp.integration import UserMCPConfig, UserMCPServerConfig
from src.mcp.registry import MCPToolRegistry

logger = structlog.get_logger()


class MCPLifecycleManager:
    """Manages MCP server connections for a session.

    Features:
    - Lazy connection (connect when first needed)
    - Session-scoped isolation (user A's servers != user B's)
    - Graceful disconnection on cleanup
    - Connection retry with exponential backoff
    """

    def __init__(self, session_id: str) -> None:
        """Initialize lifecycle manager.

        Args:
            session_id: The session ID this manager belongs to
        """
        self.session_id = session_id
        self._registry = MCPToolRegistry()
        self._connected = False
        self._connection_lock = asyncio.Lock()
        self._config: UserMCPConfig | None = None
        self._failed_servers: list[str] = []
        self._attempted_servers: list[str] = []

    @property
    def registry(self) -> MCPToolRegistry:
        """Get the MCP tool registry."""
        return self._registry

    @property
    def is_connected(self) -> bool:
        """Check if MCP servers are connected."""
        return self._connected

    async def ensure_connected(self, config: UserMCPConfig) -> None:
        """Ensure all enabled MCP servers are connected.

        Called lazily when agent needs to execute.
        Uses lock to prevent concurrent connection attempts.

        Args:
            config: User's MCP configuration from API service
        """
        async with self._connection_lock:
            if self._connected:
                return

            self._config = config
            await self._connect_servers(config.servers)
            self._connected = True

    async def _connect_servers(self, servers: list[UserMCPServerConfig]) -> None:
        """Connect to all servers in the config.

        Args:
            servers: List of server configurations
        """
        self._failed_servers = []
        self._attempted_servers = []

        for server_config in servers:
            self._attempted_servers.append(server_config.name)

            mcp_config = MCPServerConfig(
                id=server_config.id,
                name=server_config.name,
                transport=MCPTransport(server_config.transport),
                command=server_config.command,
                args=server_config.args,
                url=server_config.url,
                env_vars=server_config.env_vars,
                timeout=settings.MCP_CONNECTION_TIMEOUT,
            )

            success = await self._connect_with_retry(mcp_config)

            if not success:
                self._failed_servers.append(server_config.name)
                logger.warning(
                    "Failed to connect MCP server",
                    server=server_config.name,
                    session=self.session_id,
                )

    async def _connect_with_retry(
        self,
        config: MCPServerConfig,
        max_retries: int | None = None,
    ) -> bool:
        """Connect to an MCP server with retry logic.

        Args:
            config: Server configuration
            max_retries: Maximum retry attempts (uses settings default if None)

        Returns:
            True if connected successfully
        """
        retries = max_retries or settings.MCP_MAX_RETRIES
        delay = settings.MCP_RETRY_DELAY

        for attempt in range(retries):
            try:
                success = await self._registry.add_server(config)
                if success:
                    logger.info(
                        "Connected to MCP server",
                        server=config.name,
                        session=self.session_id,
                        attempt=attempt + 1,
                    )
                    return True
            except Exception as e:
                logger.warning(
                    "MCP connection attempt failed",
                    server=config.name,
                    session=self.session_id,
                    attempt=attempt + 1,
                    error=str(e),
                )

            # Exponential backoff
            if attempt < retries - 1:
                await asyncio.sleep(delay * (2**attempt))

        return False

    async def disconnect_all(self) -> None:
        """Disconnect all MCP servers."""
        server_ids = list(self._registry.connected_servers)

        for server_id in server_ids:
            try:
                await self._registry.remove_server(server_id)
            except Exception as e:
                logger.error(
                    "Error disconnecting MCP server",
                    server_id=server_id,
                    session=self.session_id,
                    error=str(e),
                )

        self._connected = False
        logger.info(
            "Disconnected all MCP servers",
            session=self.session_id,
            count=len(server_ids),
        )

    async def refresh_server(self, server_id: str) -> bool:
        """Refresh a specific server's tools.

        Args:
            server_id: The server ID to refresh

        Returns:
            True if refreshed successfully
        """
        return await self._registry.refresh_server(server_id)

    def get_tool_count(self) -> int:
        """Get total number of available MCP tools."""
        return len(self._registry.available_tools)

    def get_connected_server_count(self) -> int:
        """Get number of successfully connected servers."""
        return len(self._registry.connected_servers)

    def get_failed_servers(self) -> list[str]:
        """Get list of server names that failed to connect."""
        return self._failed_servers.copy()

    def get_attempted_servers(self) -> list[str]:
        """Get list of server names that were attempted."""
        return self._attempted_servers.copy()

    def get_server_status(self) -> dict[str, Any]:
        """Get status of all servers.

        Returns:
            Dict with server statuses
        """
        return {
            "session_id": self.session_id,
            "connected": self._connected,
            "servers": self._registry.connected_servers,
            "total_tools": self.get_tool_count(),
        }


class MCPLifecycleStore:
    """Store for session-scoped MCP lifecycle managers.

    Maintains one MCPLifecycleManager per session to ensure
    proper isolation and cleanup.
    """

    def __init__(self) -> None:
        """Initialize the store."""
        self._managers: dict[str, MCPLifecycleManager] = {}
        self._lock = asyncio.Lock()

    async def get_or_create(self, session_id: str) -> MCPLifecycleManager:
        """Get or create a lifecycle manager for a session.

        Args:
            session_id: The session ID

        Returns:
            MCPLifecycleManager for this session
        """
        async with self._lock:
            if session_id not in self._managers:
                self._managers[session_id] = MCPLifecycleManager(session_id)
                logger.debug(
                    "Created MCP lifecycle manager",
                    session=session_id,
                )
            return self._managers[session_id]

    async def remove(self, session_id: str) -> None:
        """Remove and cleanup a session's lifecycle manager.

        Args:
            session_id: The session ID
        """
        async with self._lock:
            if session_id in self._managers:
                manager = self._managers.pop(session_id)
                await manager.disconnect_all()
                logger.info(
                    "Removed MCP lifecycle manager",
                    session=session_id,
                )

    async def cleanup_all(self) -> None:
        """Cleanup all lifecycle managers (for shutdown)."""
        async with self._lock:
            for _session_id, manager in list(self._managers.items()):
                await manager.disconnect_all()
            self._managers.clear()
            logger.info("Cleaned up all MCP lifecycle managers")


class _LifecycleStoreSingleton:
    """Singleton holder for the lifecycle store instance."""

    _instance: MCPLifecycleStore | None = None

    @classmethod
    def get_instance(cls) -> MCPLifecycleStore:
        """Get or create the singleton lifecycle store instance."""
        if cls._instance is None:
            cls._instance = MCPLifecycleStore()
        return cls._instance


def get_lifecycle_store() -> MCPLifecycleStore:
    """Get the global lifecycle store (singleton)."""
    return _LifecycleStoreSingleton.get_instance()


async def get_lifecycle_manager(session_id: str) -> MCPLifecycleManager:
    """Get the lifecycle manager for a session.

    Args:
        session_id: The session ID

    Returns:
        MCPLifecycleManager for this session
    """
    store = get_lifecycle_store()
    return await store.get_or_create(session_id)


async def cleanup_session_mcp(session_id: str) -> None:
    """Cleanup MCP resources for a session.

    Should be called when a session ends or is cleaned up.

    Args:
        session_id: The session ID
    """
    store = get_lifecycle_store()
    await store.remove(session_id)
