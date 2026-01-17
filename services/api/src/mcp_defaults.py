"""MCP server helper functions for working with the default MCP server registry.

The DEFAULT_MCP_SERVERS data is stored in src/database/seeds/mcp_servers.py.
This module provides helper functions for looking up and filtering MCP servers.
"""

from typing import Any

from src.database.seeds.mcp_servers import DEFAULT_MCP_SERVERS, MCPCategory

# Re-export for backwards compatibility
__all__ = ["DEFAULT_MCP_SERVERS", "MCPCategory"]


def get_default_server_by_slug(slug: str) -> dict[str, Any] | None:
    """Get a default server configuration by its slug.

    Args:
        slug: The unique identifier for the default server (e.g., "github", "postgres")

    Returns:
        The server configuration dict, or None if not found
    """
    for server in DEFAULT_MCP_SERVERS:
        if server["slug"] == slug:
            return server.copy()  # Return a copy to prevent mutation
    return None


def get_servers_by_category(category: MCPCategory) -> list[dict[str, Any]]:
    """Get all default servers in a specific category.

    Args:
        category: The MCPCategory to filter by

    Returns:
        List of server configurations in that category
    """
    return [s.copy() for s in DEFAULT_MCP_SERVERS if s["category"] == category]


def get_builtin_servers() -> list[dict[str, Any]]:
    """Get all built-in servers that cannot be disabled.

    Returns:
        List of built-in server configurations
    """
    return [s.copy() for s in DEFAULT_MCP_SERVERS if s.get("is_builtin", False)]


def get_all_categories() -> list[str]:
    """Get all unique categories from the default servers.

    Returns:
        List of category values
    """
    return list({s["category"].value for s in DEFAULT_MCP_SERVERS})


def get_required_env_vars_for_slug(slug: str) -> list[str]:
    """Get the required environment variables for a default server.

    Args:
        slug: The server slug

    Returns:
        List of required environment variable names, or empty list if server not found
    """
    server = get_default_server_by_slug(slug)
    if server:
        required_env: list[str] = server.get("required_env", [])
        return required_env
    return []


def check_env_vars_available(slug: str, available_env: dict[str, str]) -> tuple[bool, list[str]]:
    """Check if all required environment variables are available for a server.

    Args:
        slug: The server slug
        available_env: Dict of available environment variable names to values

    Returns:
        Tuple of (all_available: bool, missing_vars: list[str])
    """
    required = get_required_env_vars_for_slug(slug)
    missing = [var for var in required if var not in available_env or not available_env[var]]
    return len(missing) == 0, missing
