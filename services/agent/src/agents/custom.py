"""Custom agent that loads configuration from a template.

Tool definitions are loaded from Redis (synced from database) via ConfigReader.
This is the single source of truth for available tools.
"""

import asyncio
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

# Cache for tool definitions loaded from Redis
_tools_cache: dict[str, Tool] | None = None
_tools_cache_lock = asyncio.Lock()


async def _load_tools_from_config() -> dict[str, Tool]:
    """Load tool definitions from Redis configuration.

    Returns:
        Dictionary mapping tool name to Tool object.

    Raises:
        RuntimeError: If tools cannot be loaded from Redis.
    """
    global _tools_cache

    async with _tools_cache_lock:
        if _tools_cache is not None:
            return _tools_cache

        config_reader = get_config_reader()
        tools = await config_reader.get_all_tools()

        if not tools:
            raise RuntimeError(
                "Failed to load tools from configuration. "
                "Ensure the API service is running and has synced tools to Redis."
            )

        # Convert ToolDefinitions to Tool objects
        _tools_cache = {}
        for tool_def in tools:
            _tools_cache[tool_def.name] = Tool(
                name=tool_def.name,
                description=tool_def.description,
                parameters=tool_def.parameters,
            )

        logger.info("Loaded tools from config", tool_count=len(_tools_cache))
        return _tools_cache


def _get_cached_tools() -> dict[str, Tool]:
    """Get cached tools synchronously. Returns empty dict if not cached yet."""
    if _tools_cache is None:
        return {}
    return _tools_cache


@dataclass
class AgentTemplateConfig:
    """Configuration loaded from agent_templates table."""

    name: str
    system_prompt: str
    allowed_tools: list[str]
    model: str
    temperature: float | None = None
    max_tokens: int | None = None
    config: dict[str, Any] | None = None


@dataclass
class CustomAgentContext:
    """Context for custom agent initialization."""

    workspace_path: str | Path | None = None
    session_id: str | None = None
    user_id: str | None = None


@dataclass
class CustomAgentInitConfig:
    """Configuration for initializing a CustomAgent."""

    agent_id: str
    model: str
    llm_provider: "LLMProvider"
    template_config: AgentTemplateConfig
    context: CustomAgentContext | None = None
    mcp_registry: MCPToolRegistry | None = None
    user_id: str | None = None


class CustomAgent(BaseAgent):
    """Agent that loads its configuration from a template."""

    def __init__(self, init_config: CustomAgentInitConfig) -> None:
        """Initialize custom agent with template configuration.

        Args:
            init_config: Configuration containing agent_id, model, llm_provider,
                template_config, context, and mcp_registry.
        """
        self._template_config = init_config.template_config
        context = init_config.context or CustomAgentContext()
        # Use template's model if specified, otherwise use provided model
        effective_model = init_config.template_config.model or init_config.model
        # Get user_id from init_config or context (prefer init_config)
        user_id = init_config.user_id or context.user_id
        config = AgentConfig(
            agent_id=init_config.agent_id,
            model=effective_model,
            llm_provider=init_config.llm_provider,
            workspace_path=context.workspace_path,
            session_id=context.session_id,
            mcp_registry=init_config.mcp_registry,
            user_id=user_id,
        )
        super().__init__(config)

    def _get_system_prompt(self) -> str:
        """Get system prompt from template config."""
        return self._template_config.system_prompt

    def _get_tools(self) -> list[Tool]:
        """Get tools based on allowed_tools from template config.

        Tools are loaded from Redis (synced from database). The cache must be
        populated before this is called - use load_tools_cache() during agent setup.
        """
        available_tools = _get_cached_tools()
        if not available_tools:
            logger.warning(
                "Tools cache empty, custom agent may have no tools available",
                agent_id=self.agent_id,
                allowed_tools=self._template_config.allowed_tools,
            )
            return []

        tools = []
        for tool_name in self._template_config.allowed_tools:
            if tool_name in available_tools:
                tools.append(available_tools[tool_name])
            else:
                logger.warning(
                    "Tool not found in cache",
                    tool_name=tool_name,
                    agent_id=self.agent_id,
                )
        return tools

    @classmethod
    async def load_tools_cache(cls) -> None:
        """Load tools from Redis into cache. Should be called during agent setup."""
        await _load_tools_from_config()

    @property
    def temperature(self) -> float | None:
        """Get temperature setting from template config."""
        return self._template_config.temperature

    @property
    def max_tokens(self) -> int | None:
        """Get max_tokens setting from template config."""
        return self._template_config.max_tokens
