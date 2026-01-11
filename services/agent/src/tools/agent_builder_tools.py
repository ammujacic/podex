"""Tools for the Agent Builder agent."""

import re
from dataclasses import dataclass
from typing import Any

import structlog
from sqlalchemy import select

from src.database.connection import get_db_context
from src.database.models import AgentTemplate

logger = structlog.get_logger()

# Preview limits
SYSTEM_PROMPT_PREVIEW_LENGTH = 500

# Valid tool names that can be assigned to custom agents
VALID_TOOLS = {
    "read_file",
    "write_file",
    "search_code",
    "run_command",
    "list_directory",
    "create_task",
}

# Tool descriptions for the list_available_tools function
TOOL_DESCRIPTIONS = {
    "read_file": (
        "Read files from the workspace - useful for code analysis, reviewing existing code"
    ),
    "write_file": ("Create or modify files - essential for coding agents that need to write code"),
    "search_code": (
        "Search for code patterns across the workspace - good for finding usages, implementations"
    ),
    "run_command": "Execute shell commands - for running tests, builds, git commands, etc.",
    "list_directory": "Browse directory contents - for exploring project structure",
    "create_task": "Delegate tasks to other agents - for orchestration/architect-type agents",
}


@dataclass
class AgentTemplateConfig:
    """Configuration for creating an agent template."""

    user_id: str
    name: str
    slug: str
    system_prompt: str
    allowed_tools: list[str]
    description: str | None = None
    model: str = "claude-sonnet-4-20250514"
    temperature: float | None = None
    icon: str | None = None


async def create_agent_template(config: AgentTemplateConfig) -> dict[str, Any]:
    """Create a new agent template in the database.

    Args:
        config: Configuration for the agent template.

    Returns:
        Dictionary with success status and template info or error message.
    """
    # Validate slug format
    if not re.match(r"^[a-z0-9-]+$", config.slug):
        return {
            "success": False,
            "error": "Slug must contain only lowercase letters, numbers, and hyphens",
        }

    # Validate tools
    invalid_tools = set(config.allowed_tools) - VALID_TOOLS
    if invalid_tools:
        return {
            "success": False,
            "error": f"Invalid tools: {invalid_tools}. Valid tools are: {VALID_TOOLS}",
        }

    if not config.allowed_tools:
        return {
            "success": False,
            "error": "At least one tool must be selected",
        }

    try:
        async with get_db_context() as db:
            # Check for duplicate slug for this user
            existing = await db.execute(
                select(AgentTemplate).where(
                    AgentTemplate.user_id == config.user_id,
                    AgentTemplate.slug == config.slug,
                ),
            )
            if existing.scalar_one_or_none():
                return {
                    "success": False,
                    "error": (
                        f"You already have an agent template with slug "
                        f"'{config.slug}'. Please choose a different name."
                    ),
                }

            # Create the template
            template = AgentTemplate(
                user_id=config.user_id,
                name=config.name,
                slug=config.slug,
                description=config.description,
                system_prompt=config.system_prompt,
                allowed_tools=config.allowed_tools,
                model=config.model,
                temperature=config.temperature,
                icon=config.icon,
            )
            db.add(template)
            await db.commit()
            await db.refresh(template)

            logger.info(
                "Agent template created",
                template_id=template.id,
                user_id=config.user_id,
                name=config.name,
            )

            return {
                "success": True,
                "template_id": template.id,
                "name": config.name,
                "slug": config.slug,
                "message": (
                    f"Successfully created agent template '{config.name}'! You can "
                    "now use this template when adding agents to your "
                    "sessions. Look for it in the 'Custom Agents' section of "
                    "the agent picker."
                ),
            }

    except Exception as e:
        logger.error("Failed to create agent template", error=str(e), user_id=config.user_id)
        return {"success": False, "error": f"Failed to create template: {e!s}"}


async def list_available_tools() -> dict[str, Any]:
    """Return list of available tools with descriptions.

    Returns:
        Dictionary with success status and tools information.
    """
    return {
        "success": True,
        "tools": TOOL_DESCRIPTIONS,
        "message": (
            "These are all the tools you can assign to a custom agent. "
            "Select the ones that match your agent's purpose."
        ),
    }


@dataclass
class AgentTemplatePreviewConfig:
    """Configuration for previewing an agent template."""

    name: str
    system_prompt: str
    allowed_tools: list[str]
    description: str | None = None
    model: str = "claude-sonnet-4-20250514"
    temperature: float | None = None
    icon: str | None = None


async def preview_agent_template(config: AgentTemplatePreviewConfig) -> dict[str, Any]:
    """Generate a preview of what the agent template will look like.

    Args:
        config: Configuration for the preview.

    Returns:
        Dictionary with success status and preview text.
    """
    # Validate tools
    invalid_tools = set(config.allowed_tools) - VALID_TOOLS
    if invalid_tools:
        return {
            "success": False,
            "error": f"Invalid tools: {invalid_tools}",
        }

    # Format tools list
    tools_list = "\n".join(f"  - {tool}" for tool in config.allowed_tools)

    # Format temperature
    temp_str = str(config.temperature) if config.temperature is not None else "default"

    # Truncate system prompt for preview
    prompt_preview = config.system_prompt[:SYSTEM_PROMPT_PREVIEW_LENGTH]
    if len(config.system_prompt) > SYSTEM_PROMPT_PREVIEW_LENGTH:
        prompt_preview += "..."

    preview = f"""
## Agent Template Preview

**Name:** {config.name}
**Icon:** {config.icon or "None"}
**Description:** {config.description or "None provided"}
**Model:** {config.model}
**Temperature:** {temp_str}

### Selected Tools:
{tools_list}

### System Prompt:
```
{prompt_preview}
```

---
Does this look correct? If yes, I'll create the template. If you'd like to
make changes, let me know what to modify.
"""

    return {
        "success": True,
        "preview": preview,
        "message": "Please review the template configuration above.",
    }
