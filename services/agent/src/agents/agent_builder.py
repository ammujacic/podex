"""Agent Builder - guides users through creating custom agent templates."""

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from src.agents.base import AgentConfig, BaseAgent, Tool
from src.mcp.registry import MCPToolRegistry

if TYPE_CHECKING:
    from src.providers.llm import LLMProvider


@dataclass
class AgentBuilderConfig:
    """Configuration for Agent Builder agent."""

    agent_id: str
    model: str
    workspace_path: str | Path | None = None
    session_id: str | None = None
    user_id: str | None = None


class AgentBuilderAgent(BaseAgent):
    """Special agent that guides users through creating custom agent templates."""

    def __init__(
        self,
        config: AgentBuilderConfig,
        llm_provider: "LLMProvider",
        mcp_registry: MCPToolRegistry | None = None,
    ) -> None:
        """Initialize Agent Builder with user_id for template creation.

        Args:
            config: Configuration for the agent builder.
            llm_provider: LLM provider instance.
            mcp_registry: Optional MCP tool registry for MCP tool access.
        """
        self.user_id = config.user_id
        agent_config = AgentConfig(
            agent_id=config.agent_id,
            model=config.model,
            llm_provider=llm_provider,
            workspace_path=config.workspace_path,
            session_id=config.session_id,
            mcp_registry=mcp_registry,
            user_id=config.user_id,
        )
        super().__init__(agent_config)

    def _get_system_prompt(self) -> str:
        """Get the Agent Builder system prompt."""
        return (
            "You are the Agent Builder, a specialized assistant that helps "
            "users create custom AI agent templates.\n\n"
            "Your job is to guide users through creating a new agent by "
            """gathering the following information:

## 1. Name & Description
- What should this agent be called?
- What is its purpose? (Brief description)
- What icon/emoji represents it? (optional)

## 2. Personality & System Prompt
How should this agent behave? Help the user craft a detailed system prompt that includes:
- The agent's role and expertise
- Tone (formal, casual, technical, friendly)
- Specific instructions or constraints
- What it should and shouldn't do

## 3. Tool Selection
Which tools should this agent have access to? Available tools:
- **read_file**: Read files from the workspace - useful for code analysis
- **write_file**: Create or modify files - essential for coding agents
- **search_code**: Search for code patterns - good for finding usages
- **run_command**: Execute shell commands - for tests, builds, git
- **list_directory**: Browse directory contents - for exploring projects
- **create_task**: Delegate tasks to other agents - for orchestration

## 4. Model Selection
Which AI model should power this agent?
- **claude-opus-4-5-20251101**: Most capable, best for complex reasoning
- **claude-sonnet-4-20250514**: Good balance of speed and capability (recommended default)
- **gpt-4o**: OpenAI's flagship model
- **gpt-4o-mini**: Faster, more economical

## 5. Temperature (optional)
How creative vs deterministic should responses be?
- 0.0-0.3: More deterministic, factual, consistent
- 0.4-0.7: Balanced (default if not specified)
- 0.8-1.0: More creative, varied responses

## Guidelines
- Be conversational and helpful
- Ask one or two questions at a time, not all at once
- If the user seems unsure, provide suggestions based on their use case
- Before creating the template, use `preview_agent_template` to show a summary
- Once confirmed, use `create_agent_template` to save the template

## Slug Generation
When creating the template, generate a URL-friendly slug from the name:
- Lowercase letters, numbers, and hyphens only
- Example: "React Testing Expert" -> "react-testing-expert"
"""
        )

    def _get_tools(self) -> list[Tool]:
        """Get Agent Builder tools."""
        return [
            Tool(
                name="create_agent_template",
                description=(
                    "Create and save a new custom agent template with the gathered configuration"
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Display name for the agent template",
                        },
                        "slug": {
                            "type": "string",
                            "description": (
                                "URL-friendly identifier (lowercase, numbers, hyphens only)"
                            ),
                        },
                        "description": {
                            "type": "string",
                            "description": "Brief description of what this agent does",
                        },
                        "system_prompt": {
                            "type": "string",
                            "description": (
                                "The full system prompt defining the agent's "
                                "behavior and personality"
                            ),
                        },
                        "allowed_tools": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "List of tool names this agent can use",
                        },
                        "model": {
                            "type": "string",
                            "description": "LLM model to use",
                            "default": "claude-sonnet-4-20250514",
                        },
                        "temperature": {
                            "type": "number",
                            "description": "Temperature setting (0.0-1.0), omit for default",
                            "minimum": 0,
                            "maximum": 1,
                        },
                        "icon": {
                            "type": "string",
                            "description": "Emoji or icon identifier for the agent",
                        },
                    },
                    "required": ["name", "slug", "system_prompt", "allowed_tools"],
                },
            ),
            Tool(
                name="list_available_tools",
                description=(
                    "List all available tools that can be assigned to custom "
                    "agents with their descriptions"
                ),
                parameters={
                    "type": "object",
                    "properties": {},
                    "required": [],
                },
            ),
            Tool(
                name="preview_agent_template",
                description="Show a preview of the agent template configuration before creating it",
                parameters={
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Agent name",
                        },
                        "description": {
                            "type": "string",
                            "description": "Agent description",
                        },
                        "system_prompt": {
                            "type": "string",
                            "description": "System prompt",
                        },
                        "allowed_tools": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Selected tools",
                        },
                        "model": {
                            "type": "string",
                            "description": "Selected model",
                        },
                        "temperature": {
                            "type": "number",
                            "description": "Temperature setting",
                        },
                        "icon": {
                            "type": "string",
                            "description": "Icon/emoji",
                        },
                    },
                    "required": ["name", "system_prompt", "allowed_tools"],
                },
            ),
        ]
