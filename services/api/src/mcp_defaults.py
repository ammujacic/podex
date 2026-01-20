"""MCP server helper functions for working with the default MCP server registry.

The default MCP server catalog is stored in the DefaultMCPServer database table.
This module provides async helper functions for looking up and filtering MCP servers.
"""

from enum import Enum
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import DefaultMCPServer


class MCPCategory(str, Enum):
    """Categories for organizing MCP servers in the UI."""

    VERSION_CONTROL = "version_control"
    WEB = "web"
    MEMORY = "memory"
    MONITORING = "monitoring"
    PRODUCTIVITY = "productivity"


async def get_all_default_servers(db: AsyncSession) -> list[dict[str, Any]]:
    """Get all default MCP servers from the database.

    Args:
        db: Database session

    Returns:
        List of default server configurations
    """
    result = await db.execute(
        select(DefaultMCPServer)
        .where(DefaultMCPServer.is_enabled == True)
        .order_by(DefaultMCPServer.sort_order)
    )
    servers = result.scalars().all()
    return [_server_to_dict(s) for s in servers]


async def get_default_server_by_slug(db: AsyncSession, slug: str) -> dict[str, Any] | None:
    """Get a default server configuration by its slug.

    Args:
        db: Database session
        slug: The unique identifier for the default server (e.g., "github", "postgres")

    Returns:
        The server configuration dict, or None if not found
    """
    result = await db.execute(select(DefaultMCPServer).where(DefaultMCPServer.slug == slug))
    server = result.scalar_one_or_none()
    if server:
        return _server_to_dict(server)
    return None


async def get_servers_by_category(
    db: AsyncSession, category: MCPCategory | str
) -> list[dict[str, Any]]:
    """Get all default servers in a specific category.

    Args:
        db: Database session
        category: The MCPCategory to filter by

    Returns:
        List of server configurations in that category
    """
    category_value = category.value if hasattr(category, "value") else category
    result = await db.execute(
        select(DefaultMCPServer)
        .where(
            DefaultMCPServer.category == category_value,
            DefaultMCPServer.is_enabled == True,
        )
        .order_by(DefaultMCPServer.sort_order)
    )
    servers = result.scalars().all()
    return [_server_to_dict(s) for s in servers]


async def get_all_categories(db: AsyncSession) -> list[str]:
    """Get all unique categories from the default servers.

    Args:
        db: Database session

    Returns:
        List of category values
    """
    result = await db.execute(
        select(DefaultMCPServer.category).where(DefaultMCPServer.is_enabled == True).distinct()
    )
    return [row[0] for row in result.all()]


async def get_required_env_vars_for_slug(db: AsyncSession, slug: str) -> list[str]:
    """Get the required environment variables for a default server.

    Args:
        db: Database session
        slug: The server slug

    Returns:
        List of required environment variable names, or empty list if server not found
    """
    server = await get_default_server_by_slug(db, slug)
    if server:
        return server.get("required_env", []) or []
    return []


async def check_env_vars_available(
    db: AsyncSession, slug: str, available_env: dict[str, str]
) -> tuple[bool, list[str]]:
    """Check if all required environment variables are available for a server.

    Args:
        db: Database session
        slug: The server slug
        available_env: Dict of available environment variable names to values

    Returns:
        Tuple of (all_available: bool, missing_vars: list[str])
    """
    required = await get_required_env_vars_for_slug(db, slug)
    missing = [var for var in required if var not in available_env or not available_env[var]]
    return len(missing) == 0, missing


def _server_to_dict(server: DefaultMCPServer) -> dict[str, Any]:
    """Convert a DefaultMCPServer model to a dict.

    Args:
        server: The DefaultMCPServer model instance

    Returns:
        Dict representation matching the expected format
    """
    return {
        "slug": server.slug,
        "name": server.name,
        "description": server.description,
        "category": MCPCategory(server.category) if server.category else None,
        "transport": server.transport,
        "command": server.command,
        "args": server.args or [],
        "url": server.url,
        "env_vars": server.env_vars or {},
        "required_env": server.required_env or [],
        "optional_env": server.optional_env or [],
        "icon": server.icon,
        "is_builtin": server.is_builtin,
        "docs_url": server.docs_url,
    }
