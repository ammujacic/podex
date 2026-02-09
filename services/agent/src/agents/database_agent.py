"""Database-driven agent that loads configuration from Redis.

This agent dynamically loads its system prompt and tools from Redis,
which is populated by the API service on startup (synced from database).

This replaces the need for hardcoded agent classes like ArchitectAgent, CoderAgent, etc.
All configuration comes from ConfigReader which reads from Redis.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

import structlog

from src.agents.base import AgentConfig, BaseAgent, Tool
from src.config_reader import get_config_reader
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

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for Redis storage."""
        return {
            "role": self.role,
            "name": self.name,
            "system_prompt": self.system_prompt,
            "tools": self.tools,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "RoleConfig":
        """Create from dictionary."""
        return cls(
            role=data["role"],
            name=data["name"],
            system_prompt=data["system_prompt"],
            tools=data["tools"],
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


async def fetch_role_config(role: str) -> RoleConfig | None:
    """Fetch role configuration from Redis (synced from database by API).

    Uses ConfigReader which reads directly from Redis. The API service
    syncs role configurations from the database to Redis on startup.

    Args:
        role: The role name (e.g., 'architect', 'coder').

    Returns:
        RoleConfig if found, None otherwise.
    """
    try:
        config = get_config_reader()
        role_def = await config.get_role(role)

        if role_def:
            logger.debug("Role config loaded from Redis", role=role)
            return RoleConfig(
                role=role_def.role,
                name=role_def.name,
                system_prompt=role_def.system_prompt,
                tools=role_def.tools,
            )

        logger.warning("Role config not found in Redis", role=role)
        return None
    except Exception as e:
        logger.error("Error fetching role config from Redis", role=role, error=str(e))
        return None


async def fetch_tool_definitions(tool_names: list[str]) -> dict[str, ToolDefinition]:
    """Fetch tool definitions from Redis (synced from database by API).

    Uses ConfigReader which reads directly from Redis. The API service
    syncs tool definitions from the database to Redis on startup.

    Args:
        tool_names: List of tool names to fetch.

    Returns:
        Dict mapping tool name to ToolDefinition.
    """
    result: dict[str, ToolDefinition] = {}

    try:
        config = get_config_reader()

        for name in tool_names:
            tool_def = await config.get_tool(name)
            if tool_def:
                result[name] = ToolDefinition(
                    name=tool_def.name,
                    description=tool_def.description,
                    parameters=tool_def.parameters,
                )
            else:
                logger.warning("Tool not found in Redis", tool_name=name)

        logger.debug("Tool definitions loaded from Redis", count=len(result))
    except Exception as e:
        logger.error("Error fetching tool definitions from Redis", error=str(e))

    return result


class DatabaseAgent(BaseAgent):
    """Agent that loads its configuration from Redis (synced from database).

    This replaces the need for hardcoded agent classes (ArchitectAgent, CoderAgent, etc.)
    by dynamically loading system prompts and tools from Redis via ConfigReader.
    The API service syncs all configuration from the database to Redis on startup.
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

        # Create base agent config
        agent_config = AgentConfig(
            agent_id=config.agent_id,
            model=config.model,
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
            model=config.model,
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
    """Create a database agent by loading config from Redis.

    This is the main factory function for creating database-driven agents.
    Configuration is loaded from Redis via ConfigReader (synced from DB by API).

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
