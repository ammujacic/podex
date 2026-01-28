"""Database-driven agent that loads configuration from the API.

This agent dynamically loads its system prompt and tools from the database,
replacing the need for hardcoded agent classes like ArchitectAgent, CoderAgent, etc.

Uses Redis for distributed caching to ensure consistency across agent instances.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx
import structlog

from podex_shared.redis_client import get_redis_client
from src.agents.base import AgentConfig, BaseAgent, Tool
from src.config import settings
from src.mcp.registry import MCPToolRegistry

if TYPE_CHECKING:
    from src.providers.llm import LLMProvider

logger = structlog.get_logger()

# Redis cache configuration
ROLE_CONFIG_CACHE_PREFIX = "agent:role_config:"
TOOL_DEFINITIONS_CACHE_KEY = "agent:tool_definitions"
CACHE_TTL = 300  # 5 minutes


@dataclass
class RoleConfig:
    """Configuration loaded from the agent_role_configs table."""

    role: str
    name: str
    system_prompt: str
    tools: list[str]  # Tool names
    default_model: str | None = None
    default_temperature: float | None = None
    default_max_tokens: int | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for Redis storage."""
        return {
            "role": self.role,
            "name": self.name,
            "system_prompt": self.system_prompt,
            "tools": self.tools,
            "default_model": self.default_model,
            "default_temperature": self.default_temperature,
            "default_max_tokens": self.default_max_tokens,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "RoleConfig":
        """Create from dictionary."""
        return cls(
            role=data["role"],
            name=data["name"],
            system_prompt=data["system_prompt"],
            tools=data["tools"],
            default_model=data.get("default_model"),
            default_temperature=data.get("default_temperature"),
            default_max_tokens=data.get("default_max_tokens"),
        )


@dataclass
class ToolDefinition:
    """Tool definition loaded from the agent_tools table."""

    name: str
    description: str
    parameters: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for Redis storage."""
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ToolDefinition":
        """Create from dictionary."""
        return cls(
            name=data["name"],
            description=data["description"],
            parameters=data["parameters"],
        )


@dataclass
class DatabaseAgentConfig:
    """Configuration for DatabaseAgent initialization."""

    agent_id: str
    role: str
    model: str
    llm_provider: "LLMProvider"
    workspace_path: str | Path | None = None
    session_id: str | None = None
    mcp_registry: MCPToolRegistry | None = None
    mode: str = "ask"
    previous_mode: str | None = None
    command_allowlist: list[str] | None = None
    user_id: str | None = None
    # Workspace container ID for remote tool execution
    workspace_id: str | None = None
    # Optional overrides (if not provided, loaded from database)
    system_prompt_override: str | None = None
    tools_override: list[str] | None = None
    # User-provided LLM API keys for external providers
    llm_api_keys: dict[str, str] | None = None
    # Model's registered provider from database
    model_provider: str | None = None


async def _get_redis() -> Any:
    """Get connected Redis client."""
    redis_client = get_redis_client(settings.REDIS_URL)
    await redis_client.connect()
    return redis_client


async def fetch_role_config(role: str) -> RoleConfig | None:
    """Fetch role configuration from Redis cache or API.

    Uses Redis for distributed caching to ensure consistency across instances.

    Args:
        role: The role name (e.g., 'architect', 'coder').

    Returns:
        RoleConfig if found, None otherwise.
    """
    cache_key = f"{ROLE_CONFIG_CACHE_PREFIX}{role}"

    # Try Redis cache first
    try:
        redis_client = await _get_redis()
        cached = await redis_client.get_json(cache_key)
        if cached:
            logger.debug("Role config cache hit", role=role)
            return RoleConfig.from_dict(cached)
    except Exception as e:
        logger.warning("Redis cache read failed for role config", role=role, error=str(e))

    # Fetch from API
    try:
        api_url = getattr(settings, "API_BASE_URL", "http://localhost:8000")
        headers = {}
        if settings.INTERNAL_SERVICE_TOKEN:
            headers["Authorization"] = f"Bearer {settings.INTERNAL_SERVICE_TOKEN}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{api_url}/api/v1/agent-roles/{role}",
                headers=headers,
            )
            if response.status_code == 200:
                data = response.json()
                config = RoleConfig(
                    role=data["role"],
                    name=data["name"],
                    system_prompt=data["system_prompt"],
                    tools=data["tools"],
                    default_model=data.get("default_model"),
                    default_temperature=data.get("default_temperature"),
                    default_max_tokens=data.get("default_max_tokens"),
                )
                # Cache in Redis
                try:
                    redis_client = await _get_redis()
                    await redis_client.set_json(cache_key, config.to_dict(), ex=CACHE_TTL)
                    logger.debug("Role config cached", role=role)
                except Exception as e:
                    logger.warning(
                        "Redis cache write failed for role config", role=role, error=str(e)
                    )
                return config
            elif response.status_code == 404:
                logger.warning("Role config not found", role=role)
                return None
            else:
                logger.error(
                    "Failed to fetch role config",
                    role=role,
                    status_code=response.status_code,
                )
                return None
    except Exception as e:
        logger.error("Error fetching role config", role=role, error=str(e))
        return None


async def fetch_tool_definitions(tool_names: list[str]) -> dict[str, ToolDefinition]:
    """Fetch tool definitions from Redis cache or API.

    Uses Redis for distributed caching to ensure consistency across instances.

    Args:
        tool_names: List of tool names to fetch.

    Returns:
        Dict mapping tool name to ToolDefinition.
    """
    result: dict[str, ToolDefinition] = {}

    # Try Redis cache first
    try:
        redis_client = await _get_redis()
        cached = await redis_client.get_json(TOOL_DEFINITIONS_CACHE_KEY)
        if cached and isinstance(cached, dict):
            # Check if all requested tools are in cache
            all_found = True
            for name in tool_names:
                if name in cached:
                    result[name] = ToolDefinition.from_dict(cached[name])
                else:
                    all_found = False
            if all_found:
                logger.debug("Tool definitions cache hit", count=len(result))
                return result
    except Exception as e:
        logger.warning("Redis cache read failed for tool definitions", error=str(e))

    # Fetch from API
    try:
        api_url = getattr(settings, "API_BASE_URL", "http://localhost:8000")
        headers = {}
        if settings.INTERNAL_SERVICE_TOKEN:
            headers["Authorization"] = f"Bearer {settings.INTERNAL_SERVICE_TOKEN}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{api_url}/api/v1/agent-tools",
                headers=headers,
            )
            if response.status_code == 200:
                data = response.json()
                all_tools: dict[str, dict[str, Any]] = {}
                for tool_data in data.get("tools", []):
                    name = tool_data["name"]
                    tool_def = ToolDefinition(
                        name=name,
                        description=tool_data["description"],
                        parameters=tool_data["parameters"],
                    )
                    all_tools[name] = tool_def.to_dict()
                    if name in tool_names:
                        result[name] = tool_def

                # Cache all tools in Redis
                try:
                    redis_client = await _get_redis()
                    await redis_client.set_json(TOOL_DEFINITIONS_CACHE_KEY, all_tools, ex=CACHE_TTL)
                    logger.debug("Tool definitions cached", count=len(all_tools))
                except Exception as e:
                    logger.warning("Redis cache write failed for tool definitions", error=str(e))
            else:
                logger.error(
                    "Failed to fetch tool definitions",
                    status_code=response.status_code,
                )
    except Exception as e:
        logger.error("Error fetching tool definitions", error=str(e))

    return result


async def clear_config_cache() -> None:
    """Clear the configuration cache in Redis.

    Useful for testing or when configs are updated.
    """
    try:
        redis_client = await _get_redis()
        # Delete all role config keys
        cursor = 0
        while True:
            cursor, keys = await redis_client.client.scan(
                cursor, match=f"{ROLE_CONFIG_CACHE_PREFIX}*", count=100
            )
            if keys:
                await redis_client.delete(*keys)
            if cursor == 0:
                break
        # Delete tool definitions cache
        await redis_client.delete(TOOL_DEFINITIONS_CACHE_KEY)
        logger.info("Cleared agent config cache")
    except Exception as e:
        logger.warning("Failed to clear config cache", error=str(e))


class DatabaseAgent(BaseAgent):
    """Agent that loads its configuration from the database.

    This replaces the need for hardcoded agent classes (ArchitectAgent, CoderAgent, etc.)
    by dynamically loading system prompts and tools from the database via the API.
    """

    def __init__(
        self,
        config: DatabaseAgentConfig,
        role_config: RoleConfig,
        tool_definitions: dict[str, ToolDefinition],
    ) -> None:
        """Initialize database agent with loaded configuration.

        Args:
            config: Agent configuration.
            role_config: Role configuration loaded from database.
            tool_definitions: Tool definitions loaded from database.
        """
        self._role_config = role_config
        self._tool_definitions = tool_definitions
        self._system_prompt_override = config.system_prompt_override
        self._tools_override = config.tools_override

        # Determine effective model
        effective_model = config.model
        if role_config.default_model and not config.model:
            effective_model = role_config.default_model

        # Create base agent config
        agent_config = AgentConfig(
            agent_id=config.agent_id,
            model=effective_model,
            llm_provider=config.llm_provider,
            workspace_path=config.workspace_path,
            session_id=config.session_id,
            mcp_registry=config.mcp_registry,
            mode=config.mode,
            previous_mode=config.previous_mode,
            command_allowlist=config.command_allowlist,
            user_id=config.user_id,
            workspace_id=config.workspace_id,
            llm_api_keys=config.llm_api_keys,
            model_provider=config.model_provider,
        )

        super().__init__(agent_config)

        logger.info(
            "Initialized database agent",
            agent_id=config.agent_id,
            role=role_config.role,
            model=effective_model,
            tool_count=len(self.tools),
        )

    def _get_system_prompt(self) -> str:
        """Get system prompt from role config or override."""
        if self._system_prompt_override:
            return self._system_prompt_override
        return self._role_config.system_prompt

    def _get_tools(self) -> list[Tool]:
        """Get tools based on role config or override."""
        tool_names = self._tools_override or self._role_config.tools

        tools: list[Tool] = []
        for name in tool_names:
            if name in self._tool_definitions:
                tool_def = self._tool_definitions[name]
                tools.append(
                    Tool(
                        name=tool_def.name,
                        description=tool_def.description,
                        parameters=tool_def.parameters,
                    )
                )
            else:
                logger.warning(
                    "Tool not found in definitions",
                    tool_name=name,
                    role=self._role_config.role,
                )

        return tools

    @property
    def temperature(self) -> float | None:
        """Get temperature setting from role config."""
        return self._role_config.default_temperature

    @property
    def max_tokens(self) -> int | None:
        """Get max_tokens setting from role config."""
        return self._role_config.default_max_tokens


async def create_database_agent(
    agent_id: str,
    role: str,
    model: str,
    llm_provider: "LLMProvider",
    workspace_path: str | Path | None = None,
    session_id: str | None = None,
    mcp_registry: MCPToolRegistry | None = None,
    mode: str = "ask",
    previous_mode: str | None = None,
    command_allowlist: list[str] | None = None,
    user_id: str | None = None,
    system_prompt_override: str | None = None,
    tools_override: list[str] | None = None,
    workspace_id: str | None = None,
    llm_api_keys: dict[str, str] | None = None,
    model_provider: str | None = None,
) -> DatabaseAgent | None:
    """Create a database agent by loading config from the API.

    This is the main factory function for creating database-driven agents.

    Args:
        agent_id: Unique agent identifier.
        role: The role name (e.g., 'architect', 'coder').
        model: LLM model to use.
        llm_provider: LLM provider instance.
        workspace_path: Optional workspace path.
        session_id: Optional session ID.
        mcp_registry: Optional MCP tool registry.
        mode: Agent operating mode.
        previous_mode: Previous mode for auto-revert.
        command_allowlist: Allowed command patterns.
        user_id: User ID for user-scoped operations.
        system_prompt_override: Optional override for system prompt.
        tools_override: Optional override for tool list.
        workspace_id: Optional workspace container ID for remote execution.

    Returns:
        DatabaseAgent if config was loaded successfully, None otherwise.
    """
    # Fetch role config
    role_config = await fetch_role_config(role)
    if not role_config:
        logger.error("Failed to load role config for agent", role=role)
        return None

    # Determine which tools to fetch
    tool_names = tools_override or role_config.tools

    # Fetch tool definitions
    tool_definitions = await fetch_tool_definitions(tool_names)

    # Create agent config
    config = DatabaseAgentConfig(
        agent_id=agent_id,
        role=role,
        model=model,
        llm_provider=llm_provider,
        workspace_path=workspace_path,
        session_id=session_id,
        mcp_registry=mcp_registry,
        mode=mode,
        previous_mode=previous_mode,
        command_allowlist=command_allowlist,
        user_id=user_id,
        workspace_id=workspace_id,
        system_prompt_override=system_prompt_override,
        tools_override=tools_override,
        llm_api_keys=llm_api_keys,
        model_provider=model_provider,
    )

    return DatabaseAgent(config, role_config, tool_definitions)
