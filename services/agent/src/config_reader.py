"""Config reader - reads configuration directly from Redis.

This is the agent service's interface to the unified configuration system.
The API service syncs tools, roles, modes, and skills from the database to Redis.
The agent service reads them directly from Redis using this module.

Redis keys (must match API's config_sync.py):
- config:tools:all - List of all enabled tools
- config:tools:{name} - Single tool definition
- config:roles:all - List of all enabled roles
- config:roles:{role} - Single role definition
- config:roles:delegatable - List of roles that can be used for delegation
- config:modes:all - List of all agent modes
- config:modes:{mode} - Single mode definition
- config:skills:all - List of all active skills
- config:skills:{slug} - Single skill definition
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import structlog

from src.config import get_settings

logger = structlog.get_logger()

# Redis key prefixes - must match API's config_sync.py
CONFIG_PREFIX = "config"
TOOLS_KEY = f"{CONFIG_PREFIX}:tools"
ROLES_KEY = f"{CONFIG_PREFIX}:roles"
MODES_KEY = f"{CONFIG_PREFIX}:modes"
SKILLS_KEY = f"{CONFIG_PREFIX}:skills"
SETTINGS_KEY = f"{CONFIG_PREFIX}:settings"


@dataclass
class ToolDefinition:
    """Tool definition from database via Redis."""

    name: str
    description: str
    parameters: dict[str, Any]
    category: str
    is_system: bool = True
    # Permission flags for mode-based access control
    is_read_operation: bool = True  # Allowed in Plan mode (read-only)
    is_write_operation: bool = False  # Modifies files (needs approval in Ask)
    is_command_operation: bool = False  # Executes shell commands (needs allowlist in Auto)
    is_deploy_operation: bool = False  # Deployment ops (always needs approval)


@dataclass
class RoleDefinition:
    """Agent role definition from database via Redis."""

    role: str
    name: str
    description: str
    system_prompt: str
    tools: list[str]
    category: str
    color: str = ""
    icon: str = ""
    is_system: bool = True


@dataclass
class ModeDefinition:
    """Agent mode definition from Redis."""

    mode: str
    name: str
    description: str
    allow_file_reads: bool
    allow_file_writes: bool
    allow_commands: bool
    requires_approval: bool


@dataclass
class SkillDefinition:
    """Skill definition from database via Redis."""

    id: str
    slug: str
    name: str
    description: str
    system_prompt: str | None
    steps: list[dict[str, Any]]
    category: str
    icon: str = ""
    is_active: bool = True
    triggers: list[str] | None = None
    tags: list[str] | None = None
    required_tools: list[str] | None = None


class ConfigReader:
    """Reads configuration from Redis. No caching - always fresh from Redis."""

    def __init__(self) -> None:
        self._redis_client: Any = None

    async def _get_redis(self) -> Any:
        """Get connected Redis client."""
        if self._redis_client is None:
            from podex_shared.redis_client import get_redis_client

            settings = get_settings()
            self._redis_client = get_redis_client(settings.REDIS_URL)
            await self._redis_client.connect()
        return self._redis_client

    # ==================== TOOLS ====================

    async def get_all_tools(self) -> list[ToolDefinition]:
        """Get all enabled tools from Redis."""
        redis = await self._get_redis()
        data = await redis.get_json(f"{TOOLS_KEY}:all")
        if not data:
            logger.warning("No tools found in Redis - config may not be synced")
            return []

        return [ToolDefinition(**t) for t in data]

    async def get_tool(self, name: str) -> ToolDefinition | None:
        """Get a specific tool by name."""
        redis = await self._get_redis()
        data = await redis.get_json(f"{TOOLS_KEY}:{name}")
        if not data:
            return None
        return ToolDefinition(**data)

    async def get_tool_names(self) -> set[str]:
        """Get set of all tool names."""
        tools = await self.get_all_tools()
        return {t.name for t in tools}

    async def is_valid_tool(self, name: str) -> bool:
        """Check if a tool exists."""
        return await self.get_tool(name) is not None

    # ==================== ROLES ====================

    async def get_all_roles(self) -> list[RoleDefinition]:
        """Get all enabled roles from Redis."""
        redis = await self._get_redis()
        data = await redis.get_json(f"{ROLES_KEY}:all")
        if not data:
            logger.warning("No roles found in Redis - config may not be synced")
            return []

        return [RoleDefinition(**r) for r in data]

    async def get_role(self, role: str) -> RoleDefinition | None:
        """Get a specific role configuration."""
        redis = await self._get_redis()
        data = await redis.get_json(f"{ROLES_KEY}:{role}")
        if not data:
            return None
        return RoleDefinition(**data)

    async def get_delegatable_roles(self) -> list[dict[str, str]]:
        """Get roles that can be used for task delegation."""
        redis = await self._get_redis()
        data = await redis.get_json(f"{ROLES_KEY}:delegatable")
        if not data:
            return []
        # Data is validated during sync; cast to expected type
        result: list[dict[str, str]] = data
        return result

    async def get_delegatable_role_names(self) -> set[str]:
        """Get set of role names that can be used for delegation."""
        roles = await self.get_delegatable_roles()
        return {r["role"] for r in roles}

    async def is_valid_role(self, role: str) -> bool:
        """Check if a role exists."""
        return await self.get_role(role) is not None

    async def is_delegatable_role(self, role: str) -> bool:
        """Check if a role can be used for delegation."""
        delegatable = await self.get_delegatable_role_names()
        return role in delegatable

    # ==================== MODES ====================

    async def get_all_modes(self) -> list[ModeDefinition]:
        """Get all agent modes from Redis."""
        redis = await self._get_redis()
        data = await redis.get_json(f"{MODES_KEY}:all")
        if not data:
            logger.warning("No modes found in Redis - config may not be synced")
            return []

        return [ModeDefinition(**m) for m in data]

    async def get_mode(self, mode: str) -> ModeDefinition | None:
        """Get a specific mode definition."""
        redis = await self._get_redis()
        data = await redis.get_json(f"{MODES_KEY}:{mode}")
        if not data:
            return None
        return ModeDefinition(**data)

    async def is_valid_mode(self, mode: str) -> bool:
        """Check if a mode exists."""
        return await self.get_mode(mode) is not None

    # ==================== SKILLS ====================

    async def get_all_skills(self) -> list[SkillDefinition]:
        """Get all active skills from Redis."""
        redis = await self._get_redis()
        data = await redis.get_json(f"{SKILLS_KEY}:all")
        if not data:
            return []

        return [SkillDefinition(**s) for s in data]

    async def get_skill(self, slug: str) -> SkillDefinition | None:
        """Get a specific skill by slug."""
        redis = await self._get_redis()
        data = await redis.get_json(f"{SKILLS_KEY}:{slug}")
        if not data:
            return None
        return SkillDefinition(**data)

    # ==================== PLATFORM SETTINGS ====================

    async def get_setting(self, key: str) -> dict[str, Any] | list[Any] | None:
        """Get a platform setting by key."""
        redis = await self._get_redis()
        result = await redis.get_json(f"{SETTINGS_KEY}:{key}")
        # Validate and return typed result
        if result is None:
            return None
        if isinstance(result, dict):
            return result
        if isinstance(result, list):
            return result
        return None

    async def get_session_defaults(self) -> dict[str, str]:
        """Get session default settings.

        Returns:
            Dict with default_role, default_mode, model_fallback_role
        """
        data = await self.get_setting("session_defaults")
        if not data or not isinstance(data, dict):
            raise RuntimeError(
                "Session defaults not found in configuration. "
                "Ensure the API service is running and has synced settings to Redis."
            )
        return data

    async def get_forbidden_command_patterns(self) -> set[str]:
        """Get forbidden command patterns for command allowlist validation."""
        data = await self.get_setting("forbidden_command_patterns")
        if not data or not isinstance(data, list):
            raise RuntimeError(
                "Forbidden command patterns not found in configuration. "
                "Ensure the API service is running and has synced settings to Redis."
            )
        return set(data)

    async def get_tool_categories(self) -> dict[str, list[str]]:
        """Get tool permission categories from tool definitions.

        Reads permission flags directly from tool definitions in Redis.
        Each tool has explicit is_read_operation, is_write_operation,
        is_command_operation, and is_deploy_operation flags set in the database.

        Returns:
            Dict mapping permission category names to lists of tool names.
            Categories:
            - write_tools: tools with is_write_operation=True
            - read_tools: tools with is_read_operation=True (and no other flags)
            - command_tools: tools with is_command_operation=True
            - deploy_tools: tools with is_deploy_operation=True
        """
        tools = await self.get_all_tools()

        write_tools: list[str] = []
        read_tools: list[str] = []
        command_tools: list[str] = []
        deploy_tools: list[str] = []

        for tool in tools:
            name = tool.name

            # Check explicit permission flags from database
            if tool.is_write_operation:
                write_tools.append(name)
            if tool.is_command_operation:
                command_tools.append(name)
            if tool.is_deploy_operation:
                deploy_tools.append(name)
            if tool.is_read_operation:
                read_tools.append(name)

        return {
            "write_tools": write_tools,
            "read_tools": read_tools,
            "command_tools": command_tools,
            "deploy_tools": deploy_tools,
        }

    async def get_special_agent_roles(self) -> dict[str, Any]:
        """Get special agent role identifiers.

        Returns:
            Dict with agent_builder_role, orchestrator_role, non_delegatable_roles
        """
        data = await self.get_setting("special_agent_roles")
        if not data or not isinstance(data, dict):
            raise RuntimeError(
                "Special agent roles not found in configuration. "
                "Ensure the API service is running and has synced settings to Redis."
            )
        return data


# Singleton instance
_config_reader: ConfigReader | None = None


def get_config_reader() -> ConfigReader:
    """Get the config reader singleton instance."""
    global _config_reader
    if _config_reader is None:
        _config_reader = ConfigReader()
    return _config_reader
