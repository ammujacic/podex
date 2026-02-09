"""Registry for managing MCP tools across multiple servers."""

from dataclasses import dataclass
from typing import Any

import structlog

from src.mcp.client import MCPClient, MCPServerConfig, MCPToolDefinition

logger = structlog.get_logger()


@dataclass
class MCPTool:
    """A tool from an MCP server with client reference."""

    definition: MCPToolDefinition
    client: MCPClient

    @property
    def name(self) -> str:
        return self.definition.name

    @property
    def description(self) -> str:
        return self.definition.description

    @property
    def input_schema(self) -> dict[str, Any]:
        return self.definition.input_schema

    @property
    def qualified_name(self) -> str:
        """Get fully qualified name (server:tool)."""
        return f"{self.definition.server_id}:{self.definition.name}"

    async def execute(self, arguments: dict[str, Any]) -> dict[str, Any]:
        """Execute this tool.

        Args:
            arguments: Tool arguments

        Returns:
            Execution result
        """
        return await self.client.call_tool(self.definition.name, arguments)


class MCPToolRegistry:
    """Registry for MCP tools from multiple servers.

    Features:
    - Connect to multiple MCP servers
    - Discover and cache tools
    - Execute tools by name
    - Search tools by description
    """

    def __init__(self) -> None:
        """Initialize registry."""
        self._clients: dict[str, MCPClient] = {}
        self._tools: dict[str, MCPTool] = {}  # qualified_name -> MCPTool
        self._tool_index: dict[str, MCPTool] = {}  # short_name -> MCPTool (for unique names)

    @property
    def connected_servers(self) -> list[str]:
        """Get list of connected server IDs."""
        return [sid for sid, client in self._clients.items() if client.is_connected]

    @property
    def available_tools(self) -> list[MCPTool]:
        """Get all available tools."""
        return list(self._tools.values())

    async def add_server(self, config: MCPServerConfig) -> bool:
        """Add and connect to an MCP server.

        Args:
            config: Server configuration

        Returns:
            True if connected successfully
        """
        if config.id in self._clients:
            logger.warning("Server already registered", server_id=config.id)
            return self._clients[config.id].is_connected

        client = MCPClient(config)
        self._clients[config.id] = client

        # Connect
        success = await client.connect()

        if success:
            # Register tools
            for tool_def in client.tools:
                tool = MCPTool(definition=tool_def, client=client)
                self._tools[tool.qualified_name] = tool

                # Index by short name if unique
                if tool.name not in self._tool_index:
                    self._tool_index[tool.name] = tool
                # Name collision, remove from short name index
                elif tool.name in self._tool_index:
                    del self._tool_index[tool.name]

            logger.info(
                "MCP server added",
                server_id=config.id,
                tools=len(client.tools),
            )

        return success

    async def remove_server(self, server_id: str) -> None:
        """Remove and disconnect from an MCP server.

        Args:
            server_id: Server ID to remove
        """
        if server_id not in self._clients:
            return

        client = self._clients[server_id]

        # Remove tools
        tools_to_remove = [
            qname for qname, tool in self._tools.items() if tool.definition.server_id == server_id
        ]
        for qname in tools_to_remove:
            tool = self._tools.pop(qname)
            # Also remove from short name index
            if tool.name in self._tool_index and self._tool_index[tool.name] == tool:
                del self._tool_index[tool.name]

        # Disconnect
        await client.disconnect()
        del self._clients[server_id]

        logger.info("MCP server removed", server_id=server_id)

    async def refresh_server(self, server_id: str) -> bool:
        """Refresh tools from a server.

        Args:
            server_id: Server ID to refresh

        Returns:
            True if successful
        """
        if server_id not in self._clients:
            return False

        client = self._clients[server_id]

        # Disconnect and reconnect
        await client.disconnect()
        success = await client.connect()

        if success:
            # Re-register tools
            old_tools = [
                qname
                for qname, tool in self._tools.items()
                if tool.definition.server_id == server_id
            ]
            for qname in old_tools:
                tool = self._tools.pop(qname)
                if tool.name in self._tool_index:
                    del self._tool_index[tool.name]

            for tool_def in client.tools:
                tool = MCPTool(definition=tool_def, client=client)
                self._tools[tool.qualified_name] = tool
                if tool.name not in self._tool_index:
                    self._tool_index[tool.name] = tool

        return success

    def get_tool(self, name: str) -> MCPTool | None:
        """Get a tool by name.

        Args:
            name: Tool name (short or qualified)

        Returns:
            MCPTool if found
        """
        # Try qualified name first
        if ":" in name:
            return self._tools.get(name)

        # Try short name
        return self._tool_index.get(name)

    async def execute_tool(
        self,
        name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Execute a tool by name.

        Args:
            name: Tool name
            arguments: Tool arguments

        Returns:
            Execution result
        """
        tool = self.get_tool(name)
        if not tool:
            return {"success": False, "error": f"Tool not found: {name}"}

        return await tool.execute(arguments)

    def search_tools(
        self,
        query: str,
        limit: int = 10,
    ) -> list[MCPTool]:
        """Search tools by name or description.

        Args:
            query: Search query
            limit: Max results

        Returns:
            Matching tools
        """
        query_lower = query.lower()
        results = []

        for tool in self._tools.values():
            # Check name match
            if query_lower in tool.name.lower():
                results.append((tool, 2))  # Higher score for name match
            # Check description match
            elif query_lower in tool.description.lower():
                results.append((tool, 1))

        # Sort by score, limit results
        results.sort(key=lambda x: x[1], reverse=True)
        return [tool for tool, _ in results[:limit]]

    def get_tool_definitions(self) -> list[dict[str, Any]]:
        """Get tool definitions in Anthropic API format.

        Returns:
            List of tool definitions
        """
        definitions = []

        for tool in self._tools.values():
            definitions.append(
                {
                    "name": tool.qualified_name,
                    "description": f"[MCP:{tool.definition.server_id}] {tool.description}",
                    "input_schema": tool.input_schema,
                },
            )

        return definitions


class MCPRegistryHolder:
    """Singleton holder for the global MCP registry instance."""

    _instance: MCPToolRegistry | None = None

    @classmethod
    def get(cls) -> MCPToolRegistry:
        """Get or create the global MCP registry."""
        if cls._instance is None:
            cls._instance = MCPToolRegistry()
        return cls._instance

    @classmethod
    def set(cls, registry: MCPToolRegistry) -> None:
        """Set the global MCP registry."""
        cls._instance = registry


def get_mcp_registry() -> MCPToolRegistry:
    """Get or create the global MCP registry."""
    return MCPRegistryHolder.get()


def set_mcp_registry(registry: MCPToolRegistry) -> None:
    """Set the global MCP registry."""
    MCPRegistryHolder.set(registry)
