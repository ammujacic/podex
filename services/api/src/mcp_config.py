"""MCP configuration resolution service.

This module handles the merging of MCP server configurations from multiple sources:
1. Environment variables (highest priority for secrets)
2. User database config (MCPServer records)
3. Default registry (base configs)

The effective configuration is what the agent service uses to connect to MCP servers.
"""

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import MCPServer
from src.mcp_defaults import DEFAULT_MCP_SERVERS, get_default_server_by_slug


@dataclass
class EffectiveMCPServer:
    """Resolved MCP server configuration ready for use by the agent service.

    This represents the final, merged configuration after resolving
    environment variables and user overrides.
    """

    id: str
    name: str
    description: str | None
    transport: str  # "stdio" | "sse" | "http"
    command: str | None
    args: list[str]
    url: str | None
    env_vars: dict[str, str]  # Fully resolved with secrets
    discovered_tools: list[dict[str, Any]]
    source: str  # "default" | "custom" | "env"
    source_slug: str | None = None  # For default servers
    category: str | None = None
    icon: str | None = None


@dataclass
class EffectiveMCPConfig:
    """The complete effective MCP configuration for a user."""

    user_id: str
    servers: list[EffectiveMCPServer] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dict for passing to agent service."""
        return {
            "user_id": self.user_id,
            "servers": [
                {
                    "id": s.id,
                    "name": s.name,
                    "description": s.description,
                    "transport": s.transport,
                    "command": s.command,
                    "args": s.args,
                    "url": s.url,
                    "env_vars": s.env_vars,
                    "discovered_tools": s.discovered_tools,
                    "source": s.source,
                    "source_slug": s.source_slug,
                    "category": s.category,
                    "icon": s.icon,
                }
                for s in self.servers
            ],
        }


def resolve_env_vars_for_server(
    source_slug: str | None,
    db_env_vars: dict[str, str] | None,
) -> dict[str, str]:
    """Resolve environment variables for an MCP server with precedence.

    Order (highest wins):
    1. Settings-defined MCP_* vars (from environment)
    2. Database-stored env_vars

    Args:
        source_slug: The default server slug (e.g., "github") or None for custom
        db_env_vars: Environment variables stored in the database record

    Returns:
        Fully resolved environment variables dict
    """
    resolved: dict[str, str] = {}

    # Start with DB values as base
    if db_env_vars:
        resolved.update(db_env_vars)

    # Override with settings-based secrets (from environment variables)
    if source_slug == "github":
        token = getattr(settings, "MCP_GITHUB_TOKEN", None)
        if token:
            resolved["GITHUB_TOKEN"] = token
    elif source_slug == "brave-search":
        api_key = getattr(settings, "MCP_BRAVE_API_KEY", None)
        if api_key:
            resolved["BRAVE_API_KEY"] = api_key
    elif source_slug == "slack":
        bot_token = getattr(settings, "MCP_SLACK_BOT_TOKEN", None)
        team_id = getattr(settings, "MCP_SLACK_TEAM_ID", None)
        if bot_token:
            resolved["SLACK_BOT_TOKEN"] = bot_token
        if team_id:
            resolved["SLACK_TEAM_ID"] = team_id
    elif source_slug == "postgres":
        conn_string = getattr(settings, "MCP_POSTGRES_CONNECTION_STRING", None)
        if conn_string:
            resolved["POSTGRES_CONNECTION_STRING"] = conn_string

    return resolved


async def get_effective_mcp_config(
    db: AsyncSession,
    user_id: str,
) -> EffectiveMCPConfig | None:
    """Get the fully resolved MCP configuration for a user.

    This merges all configuration sources and returns the effective
    configuration that should be passed to the agent service.

    Args:
        db: Database session
        user_id: The user's ID

    Returns:
        EffectiveMCPConfig with all enabled servers, or None if no servers enabled
    """
    # Query user's enabled servers
    result = await db.execute(
        select(MCPServer).where(
            MCPServer.user_id == user_id,
            MCPServer.is_enabled == True,  # noqa: E712
        ),
    )
    servers = result.scalars().all()

    if not servers:
        return None

    effective_servers: list[EffectiveMCPServer] = []

    for server in servers:
        # Resolve environment variables
        env_vars = resolve_env_vars_for_server(
            getattr(server, "source_slug", None),
            server.env_vars,
        )

        # Determine source type
        is_default = getattr(server, "is_default", False)
        source = "default" if is_default else "custom"

        effective_servers.append(
            EffectiveMCPServer(
                id=str(server.id),
                name=server.name,
                description=server.description,
                transport=server.transport,
                command=server.command,
                args=server.args or [],
                url=server.url,
                env_vars=env_vars,
                discovered_tools=server.discovered_tools or [],
                source=source,
                source_slug=getattr(server, "source_slug", None),
                category=getattr(server, "category", None),
                icon=getattr(server, "icon", None),
            ),
        )

    return EffectiveMCPConfig(user_id=user_id, servers=effective_servers)


def get_enabled_servers_from_env() -> list[str]:
    """Get list of MCP server slugs enabled via environment variable.

    Reads MCP_ENABLED_SERVERS env var (comma-separated slugs).

    Returns:
        List of server slugs, or empty list if not set
    """
    enabled = getattr(settings, "MCP_ENABLED_SERVERS", "")
    if not enabled:
        return []
    return [s.strip() for s in enabled.split(",") if s.strip()]


async def sync_servers_from_env(
    db: AsyncSession,
    user_id: str,
) -> tuple[list[str], list[str]]:
    """Sync MCP server configuration from environment variables to database.

    Reads MCP_ENABLED_SERVERS and creates/updates MCPServer records accordingly.
    This allows power users to configure MCP servers entirely via env vars.

    Args:
        db: Database session
        user_id: The user's ID

    Returns:
        Tuple of (created_slugs, updated_slugs)
    """
    enabled_slugs = get_enabled_servers_from_env()
    created: list[str] = []
    updated: list[str] = []

    for slug in enabled_slugs:
        # Get default config for this slug
        default_config = get_default_server_by_slug(slug)
        if not default_config:
            continue  # Skip unknown slugs

        # Check if server already exists for this user
        result = await db.execute(
            select(MCPServer).where(
                MCPServer.user_id == user_id,
                MCPServer.name == default_config["name"],
            ),
        )
        existing = result.scalar_one_or_none()

        if existing:
            # Update existing server if disabled
            if not existing.is_enabled:
                existing.is_enabled = True
                updated.append(slug)
        else:
            # Create new server from default
            server = MCPServer(
                user_id=user_id,
                name=default_config["name"],
                description=default_config.get("description"),
                transport=default_config["transport"],
                command=default_config.get("command"),
                args=default_config.get("args", []),
                env_vars={},  # Secrets resolved at runtime from env
                is_enabled=True,
            )
            # Set new fields if model supports them
            if hasattr(MCPServer, "source_slug"):
                server.source_slug = slug
            if hasattr(MCPServer, "is_default"):
                server.is_default = True
            if hasattr(MCPServer, "config_source"):
                server.config_source = "env"
            if hasattr(MCPServer, "category"):
                cat = default_config.get("category")
                server.category = cat.value if cat else None
            if hasattr(MCPServer, "icon"):
                server.icon = default_config.get("icon")

            db.add(server)
            created.append(slug)

    await db.commit()
    return created, updated


def build_mcp_config_for_agent(
    servers: list[EffectiveMCPServer],
    user_id: str,
) -> dict[str, Any]:
    """Build MCP configuration dict for passing to agent service.

    Args:
        servers: List of effective MCP server configs
        user_id: The user's ID

    Returns:
        Dict suitable for passing in agent execution context
    """
    return {
        "user_id": user_id,
        "servers": [
            {
                "id": s.id,
                "name": s.name,
                "transport": s.transport,
                "command": s.command,
                "args": s.args,
                "url": s.url,
                "env_vars": s.env_vars,
                "discovered_tools": s.discovered_tools,
            }
            for s in servers
        ],
    }


def get_default_catalog_for_user(
    user_servers: list[MCPServer],
) -> list[dict[str, Any]]:
    """Get the default MCP catalog with user's enablement status.

    Args:
        user_servers: List of user's MCPServer records

    Returns:
        List of default server configs with is_enabled and has_required_secrets flags
    """
    # Build lookup of user's enabled servers by source_slug
    user_enabled_slugs: set[str] = set()
    for server in user_servers:
        slug = getattr(server, "source_slug", None)
        if slug and server.is_enabled:
            user_enabled_slugs.add(slug)

    catalog: list[dict[str, Any]] = []
    for default in DEFAULT_MCP_SERVERS:
        slug = default["slug"]
        required_env = default.get("required_env", [])

        # Check if user has required secrets configured
        has_secrets = True
        for env_var in required_env:
            # Check if available in settings
            settings_key = f"MCP_{env_var}" if not env_var.startswith("MCP_") else env_var
            if not getattr(settings, settings_key, None):
                has_secrets = False
                break

        catalog.append(
            {
                **default,
                "is_enabled": slug in user_enabled_slugs,
                "has_required_secrets": has_secrets,
                "missing_secrets": [
                    env_var
                    for env_var in required_env
                    if not getattr(
                        settings,
                        f"MCP_{env_var}" if not env_var.startswith("MCP_") else env_var,
                        None,
                    )
                ],
            },
        )

    return catalog
