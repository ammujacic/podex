"""MCP integration module for bridging API config with agent execution.

This module provides:
- Data classes for MCP config passed from API service
- Conversion utilities for MCP tools to agent Tool format
- Session-scoped registry management
"""

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from src.mcp.client import MCPServerConfig, MCPTransport
from src.mcp.registry import MCPTool, MCPToolRegistry

if TYPE_CHECKING:
    from src.agents.base import Tool


@dataclass
class UserMCPServerConfig:
    """MCP server configuration passed from API service.

    This mirrors the effective config structure from the API service.
    """

    id: str
    name: str
    transport: str  # "stdio" | "sse" | "http"
    command: str | None = None
    args: list[str] = field(default_factory=list)
    url: str | None = None
    env_vars: dict[str, str] = field(default_factory=dict)
    discovered_tools: list[dict[str, Any]] = field(default_factory=list)
    source: str = "default"  # "default" | "custom"
    source_slug: str | None = None
    category: str | None = None
    icon: str | None = None


@dataclass
class UserMCPConfig:
    """User's complete MCP configuration from API service."""

    user_id: str
    servers: list[UserMCPServerConfig] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "UserMCPConfig | None":
        """Create from dict (as passed in agent execution context).

        Args:
            data: MCP config dict from API service

        Returns:
            UserMCPConfig instance, or None if data is empty/None
        """
        if not data:
            return None

        servers = []
        for server_data in data.get("servers", []):
            servers.append(
                UserMCPServerConfig(
                    id=server_data.get("id", ""),
                    name=server_data.get("name", ""),
                    transport=server_data.get("transport", "stdio"),
                    command=server_data.get("command"),
                    args=server_data.get("args", []),
                    url=server_data.get("url"),
                    env_vars=server_data.get("env_vars", {}),
                    discovered_tools=server_data.get("discovered_tools", []),
                    source=server_data.get("source", "default"),
                    source_slug=server_data.get("source_slug"),
                    category=server_data.get("category"),
                    icon=server_data.get("icon"),
                ),
            )

        return cls(
            user_id=data.get("user_id", ""),
            servers=servers,
        )


def user_config_to_mcp_config(user_config: UserMCPServerConfig) -> MCPServerConfig:
    """Convert UserMCPServerConfig to MCPServerConfig for client use.

    Args:
        user_config: User's server config from API

    Returns:
        MCPServerConfig for the MCP client
    """
    transport = MCPTransport(user_config.transport)

    return MCPServerConfig(
        id=user_config.id,
        name=user_config.name,
        transport=transport,
        command=user_config.command,
        args=user_config.args,
        url=user_config.url,
        env_vars=user_config.env_vars,
    )


def mcp_tool_to_agent_tool(mcp_tool: MCPTool) -> "Tool":
    """Convert an MCP tool to the agent's Tool format.

    Uses qualified naming to prevent conflicts with built-in tools:
    "mcp:{server_id}:{tool_name}"

    Args:
        mcp_tool: MCP tool from registry

    Returns:
        Tool instance for agent use
    """
    # Late import to avoid circular dependency
    from src.agents.base import Tool

    return Tool(
        name=f"mcp:{mcp_tool.qualified_name}",  # e.g., "mcp:github:create_issue"
        description=f"[MCP:{mcp_tool.definition.server_id}] {mcp_tool.description}",
        parameters=mcp_tool.input_schema,
    )


def get_mcp_tools_as_agent_tools(registry: MCPToolRegistry) -> list["Tool"]:
    """Get all MCP tools converted to agent Tool format.

    Args:
        registry: MCP tool registry

    Returns:
        List of Tool instances
    """
    return [mcp_tool_to_agent_tool(tool) for tool in registry.available_tools]


def is_mcp_tool_name(tool_name: str) -> bool:
    """Check if a tool name is an MCP tool (has mcp: prefix).

    Args:
        tool_name: The tool name to check

    Returns:
        True if this is an MCP tool name
    """
    return tool_name.startswith("mcp:")


def extract_mcp_qualified_name(tool_name: str) -> str | None:
    """Extract the qualified name from an MCP tool name.

    "mcp:github:create_issue" -> "github:create_issue"

    Args:
        tool_name: Full MCP tool name with prefix

    Returns:
        Qualified name without mcp: prefix, or None if not an MCP tool
    """
    if not is_mcp_tool_name(tool_name):
        return None
    return tool_name[4:]  # Strip "mcp:" prefix
