"""Database-driven agent that loads configuration from the API.

This agent dynamically loads its system prompt and tools from the database,
replacing the need for hardcoded agent classes like ArchitectAgent, CoderAgent, etc.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx
import structlog

from src.agents.base import AgentConfig, BaseAgent, Tool
from src.config import settings
from src.mcp.registry import MCPToolRegistry

if TYPE_CHECKING:
    from src.providers.llm import LLMProvider

logger = structlog.get_logger()


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


@dataclass
class ToolDefinition:
    """Tool definition loaded from the agent_tools table."""

    name: str
    description: str
    parameters: dict[str, Any]


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
    # Optional overrides (if not provided, loaded from database)
    system_prompt_override: str | None = None
    tools_override: list[str] | None = None


# Cache for role configs and tools (in-memory, per-process)
_role_config_cache: dict[str, RoleConfig] = {}
_tool_definitions_cache: dict[str, ToolDefinition] = {}


async def fetch_role_config(role: str) -> RoleConfig | None:
    """Fetch role configuration from the API.

    Args:
        role: The role name (e.g., 'architect', 'coder').

    Returns:
        RoleConfig if found, None otherwise.
    """
    # Check cache first
    if role in _role_config_cache:
        return _role_config_cache[role]

    try:
        api_url = getattr(settings, "API_BASE_URL", "http://localhost:8000")
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{api_url}/api/v1/agent-roles/{role}")
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
                # Cache the result
                _role_config_cache[role] = config
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
    """Fetch tool definitions from the API.

    Args:
        tool_names: List of tool names to fetch.

    Returns:
        Dict mapping tool name to ToolDefinition.
    """
    result: dict[str, ToolDefinition] = {}

    # Check cache for already loaded tools
    missing_tools: list[str] = []
    for name in tool_names:
        if name in _tool_definitions_cache:
            result[name] = _tool_definitions_cache[name]
        else:
            missing_tools.append(name)

    if not missing_tools:
        return result

    try:
        api_url = getattr(settings, "API_BASE_URL", "http://localhost:8000")
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Fetch all tools (we could optimize this with a batch endpoint)
            response = await client.get(f"{api_url}/api/v1/agent-tools")
            if response.status_code == 200:
                data = response.json()
                for tool_data in data.get("tools", []):
                    name = tool_data["name"]
                    tool_def = ToolDefinition(
                        name=name,
                        description=tool_data["description"],
                        parameters=tool_data["parameters"],
                    )
                    # Cache all tools
                    _tool_definitions_cache[name] = tool_def
                    # Add to result if requested
                    if name in tool_names:
                        result[name] = tool_def
            else:
                logger.error(
                    "Failed to fetch tool definitions",
                    status_code=response.status_code,
                )
    except Exception as e:
        logger.error("Error fetching tool definitions", error=str(e))

    return result


def clear_config_cache() -> None:
    """Clear the configuration cache.

    Useful for testing or when configs are updated.
    """
    _role_config_cache.clear()
    _tool_definitions_cache.clear()


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
        system_prompt_override=system_prompt_override,
        tools_override=tools_override,
    )

    return DatabaseAgent(config, role_config, tool_definitions)
