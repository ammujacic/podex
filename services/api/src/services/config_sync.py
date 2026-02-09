"""Unified config sync service - syncs database to Redis.

This is the single source of truth for syncing configuration data
(tools, roles, modes, skills, platform settings) from the database to Redis.

Agent service reads directly from Redis using these keys.
"""

from __future__ import annotations

from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.cache import get_cache_client
from src.database.models import AgentRoleConfig, AgentTool, PlatformSetting, SystemSkill

logger = structlog.get_logger()

# Redis key prefixes - Agent service must use the same keys
CONFIG_PREFIX = "config"
TOOLS_KEY = f"{CONFIG_PREFIX}:tools"
ROLES_KEY = f"{CONFIG_PREFIX}:roles"
MODES_KEY = f"{CONFIG_PREFIX}:modes"
SKILLS_KEY = f"{CONFIG_PREFIX}:skills"
SETTINGS_KEY = f"{CONFIG_PREFIX}:settings"

# Mode definitions - these rarely change so they're defined here
# rather than in a separate database table
AGENT_MODES = [
    {
        "mode": "plan",
        "name": "Plan",
        "description": "Read-only mode for analysis",
        "allow_file_reads": True,
        "allow_file_writes": False,
        "allow_commands": False,
        "requires_approval": True,
    },
    {
        "mode": "ask",
        "name": "Ask",
        "description": "Requires approval for file edits and commands",
        "allow_file_reads": True,
        "allow_file_writes": True,
        "allow_commands": True,
        "requires_approval": True,
    },
    {
        "mode": "auto",
        "name": "Auto",
        "description": "Auto file edits, commands need allowlist",
        "allow_file_reads": True,
        "allow_file_writes": True,
        "allow_commands": True,
        "requires_approval": False,
    },
    {
        "mode": "sovereign",
        "name": "Sovereign",
        "description": "Full access to all operations",
        "allow_file_reads": True,
        "allow_file_writes": True,
        "allow_commands": True,
        "requires_approval": False,
    },
]


class ConfigSyncService:
    """Syncs configuration from database to Redis."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def sync_all(self) -> dict[str, int]:
        """Sync all configuration to Redis. Returns counts."""
        # Sync settings first as they are used by other syncs (e.g., non_delegatable_roles)
        settings_count = await self.sync_settings()
        tools_count = await self.sync_tools()
        roles_count = await self.sync_roles()
        modes_count = await self.sync_modes()
        skills_count = await self.sync_skills()

        logger.info(
            "Config synced to Redis",
            settings=settings_count,
            tools=tools_count,
            roles=roles_count,
            modes=modes_count,
            skills=skills_count,
        )
        return {
            "settings": settings_count,
            "tools": tools_count,
            "roles": roles_count,
            "modes": modes_count,
            "skills": skills_count,
        }

    async def sync_settings(self) -> int:
        """Sync platform settings to Redis.

        Syncs specific settings needed by the agent service:
        - session_defaults: default role, mode, fallback role
        - forbidden_command_patterns: dangerous command patterns
        - special_agent_roles: special role identifiers

        Note: Tool categories for permission checking are derived from the
        tools table (by category field) rather than stored as a setting.
        """
        redis = await get_cache_client()

        # Settings keys to sync
        settings_keys = [
            "session_defaults",
            "forbidden_command_patterns",
            "special_agent_roles",
        ]

        synced_count = 0
        for key in settings_keys:
            result = await self.db.execute(
                select(PlatformSetting).where(PlatformSetting.key == key)
            )
            setting = result.scalar_one_or_none()
            if setting:
                await redis.set_json(f"{SETTINGS_KEY}:{key}", setting.value)
                synced_count += 1
            else:
                logger.warning("Platform setting '%s' not found in database", key)

        return synced_count

    async def sync_tools(self) -> int:
        """Sync all enabled tools to Redis."""
        redis = await get_cache_client()

        # Query all enabled tools
        result = await self.db.execute(select(AgentTool).where(AgentTool.is_enabled == True))
        tools = result.scalars().all()

        # Build tool list
        tools_list: list[dict[str, Any]] = []
        for tool in tools:
            tool_data = {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
                "category": tool.category,
                "is_system": tool.is_system,
                # Permission flags for mode-based access control
                "is_read_operation": tool.is_read_operation,
                "is_write_operation": tool.is_write_operation,
                "is_command_operation": tool.is_command_operation,
                "is_deploy_operation": tool.is_deploy_operation,
            }
            tools_list.append(tool_data)
            # Also store individual tool
            await redis.set_json(
                f"{TOOLS_KEY}:{tool.name}",
                tool_data,
            )

        # Store full list
        await redis.set_json(f"{TOOLS_KEY}:all", tools_list)
        return len(tools_list)

    async def sync_roles(self) -> int:
        """Sync all enabled roles to Redis."""
        redis = await get_cache_client()

        # Get non-delegatable roles from settings (already synced to Redis)
        non_delegatable: set[str] = set()
        special_roles_data = await redis.get_json(f"{SETTINGS_KEY}:special_agent_roles")
        if special_roles_data and isinstance(special_roles_data, dict):
            non_delegatable = set(special_roles_data.get("non_delegatable_roles", []))
        else:
            # Fallback to database if not yet synced
            settings_result = await self.db.execute(
                select(PlatformSetting).where(PlatformSetting.key == "special_agent_roles")
            )
            setting = settings_result.scalar_one_or_none()
            if setting and isinstance(setting.value, dict):
                non_delegatable = set(setting.value.get("non_delegatable_roles", []))

        roles_result = await self.db.execute(
            select(AgentRoleConfig).where(AgentRoleConfig.is_enabled == True)
        )
        roles = roles_result.scalars().all()

        roles_list: list[dict[str, Any]] = []
        delegatable_list: list[dict[str, str]] = []

        for role in roles:
            role_data = {
                "role": role.role,
                "name": role.name,
                "description": role.description,
                "system_prompt": role.system_prompt,
                "tools": role.tools or [],
                "category": role.category,
                "color": role.color,
                "icon": role.icon,
                "is_system": role.is_system,
            }
            roles_list.append(role_data)

            # Track delegatable roles (exclude non-delegatable roles from settings)
            if role.role not in non_delegatable:
                delegatable_list.append({"role": role.role, "name": role.name})

            # Store individual role
            await redis.set_json(
                f"{ROLES_KEY}:{role.role}",
                role_data,
            )

        # Store full list and delegatable list
        await redis.set_json(f"{ROLES_KEY}:all", roles_list)
        await redis.set_json(f"{ROLES_KEY}:delegatable", delegatable_list)

        # Also store a simple list of valid role names for quick validation
        role_names = [r["role"] for r in roles_list]
        await redis.set_json(f"{ROLES_KEY}:names", role_names)

        return len(roles_list)

    async def sync_modes(self) -> int:
        """Sync agent modes to Redis."""
        redis = await get_cache_client()

        await redis.set_json(f"{MODES_KEY}:all", AGENT_MODES)

        for mode in AGENT_MODES:
            await redis.set_json(
                f"{MODES_KEY}:{mode['mode']}",
                mode,
            )

        # Also store simple list of valid mode names
        mode_names = [m["mode"] for m in AGENT_MODES]
        await redis.set_json(f"{MODES_KEY}:names", mode_names)

        return len(AGENT_MODES)

    async def sync_skills(self) -> int:
        """Sync all active skills to Redis."""
        redis = await get_cache_client()

        result = await self.db.execute(select(SystemSkill).where(SystemSkill.is_active == True))
        skills = result.scalars().all()

        skills_list: list[dict[str, Any]] = []
        for skill in skills:
            # Extract category and icon from skill_metadata if available
            metadata = skill.skill_metadata or {}
            skill_data = {
                "id": str(skill.id),
                "slug": skill.slug,
                "name": skill.name,
                "description": skill.description,
                "system_prompt": skill.system_prompt,
                "steps": skill.steps,
                "category": metadata.get("category", "general"),
                "icon": metadata.get("icon", ""),
                "is_active": skill.is_active,
                "triggers": skill.triggers or [],
                "tags": skill.tags or [],
                "required_tools": skill.required_tools or [],
            }
            skills_list.append(skill_data)
            await redis.set_json(
                f"{SKILLS_KEY}:{skill.slug}",
                skill_data,
            )

        await redis.set_json(f"{SKILLS_KEY}:all", skills_list)

        # Store simple list of skill slugs
        skill_slugs = [s["slug"] for s in skills_list]
        await redis.set_json(f"{SKILLS_KEY}:slugs", skill_slugs)

        return len(skills_list)


async def sync_config_to_redis(db: AsyncSession) -> dict[str, int]:
    """Helper function to sync all config to Redis.

    This should be called:
    1. On API startup (after database seeding)
    2. When admin updates tools/roles via the admin API
    """
    service = ConfigSyncService(db)
    return await service.sync_all()


async def sync_tools_to_redis(db: AsyncSession) -> int:
    """Sync only tools to Redis."""
    service = ConfigSyncService(db)
    return await service.sync_tools()


async def sync_roles_to_redis(db: AsyncSession) -> int:
    """Sync only roles to Redis."""
    service = ConfigSyncService(db)
    return await service.sync_roles()


async def sync_skills_to_redis(db: AsyncSession) -> int:
    """Sync only skills to Redis."""
    service = ConfigSyncService(db)
    return await service.sync_skills()


async def sync_settings_to_redis(db: AsyncSession) -> int:
    """Sync only platform settings to Redis."""
    service = ConfigSyncService(db)
    return await service.sync_settings()
