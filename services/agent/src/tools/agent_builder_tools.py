"""Tools for the Agent Builder agent."""

import re
from dataclasses import dataclass
from typing import Any

import structlog
from sqlalchemy import select

from src.config_reader import get_config_reader
from src.database.connection import get_db_context
from src.database.models import AgentTemplate

logger = structlog.get_logger()

# Preview limits
SYSTEM_PROMPT_PREVIEW_LENGTH = 500


@dataclass
class AgentTemplateConfig:
    """Configuration for creating an agent template."""

    user_id: str
    name: str
    slug: str
    system_prompt: str
    allowed_tools: list[str]
    model: str
    description: str | None = None
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

    # Validate tools against database (via Redis)
    config_reader = get_config_reader()
    valid_tools = await config_reader.get_tool_names()
    if not valid_tools:
        return {
            "success": False,
            "error": "Failed to load tools from configuration. Ensure the API service is running.",
        }
    invalid_tools = set(config.allowed_tools) - valid_tools
    if invalid_tools:
        return {
            "success": False,
            "error": f"Invalid tools: {invalid_tools}. Valid tools are: {valid_tools}",
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

    Fetches tools from Redis (synced from database) which is the
    single source of truth for available tools.

    Returns:
        Dictionary with success status and tools information.
    """
    config_reader = get_config_reader()
    tools = await config_reader.get_all_tools()
    if not tools:
        return {
            "success": False,
            "error": "Failed to load tools from configuration. Ensure the API service is running.",
        }

    # Build tools dict: name -> description
    tools_dict = {tool.name: tool.description for tool in tools}

    return {
        "success": True,
        "tools": tools_dict,
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
    model: str
    description: str | None = None
    temperature: float | None = None
    icon: str | None = None


async def preview_agent_template(config: AgentTemplatePreviewConfig) -> dict[str, Any]:
    """Generate a preview of what the agent template will look like.

    Args:
        config: Configuration for the preview.

    Returns:
        Dictionary with success status and preview text.
    """
    # Validate tools against database (via Redis)
    config_reader = get_config_reader()
    valid_tools = await config_reader.get_tool_names()
    if not valid_tools:
        return {
            "success": False,
            "error": "Failed to load tools from configuration. Ensure the API service is running.",
        }
    invalid_tools = set(config.allowed_tools) - valid_tools
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
