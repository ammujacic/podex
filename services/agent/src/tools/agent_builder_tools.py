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
    # File tools
    "read_file",
    "write_file",
    "list_directory",
    "search_code",
    "glob_files",
    "grep",
    "apply_patch",
    # Command tools
    "run_command",
    # Git tools
    "git_status",
    "git_commit",
    "git_push",
    "git_branch",
    "git_diff",
    "git_log",
    "create_pr",
    # Memory tools
    "store_memory",
    "recall_memory",
    "update_memory",
    "delete_memory",
    "get_session_memories",
    # Task/orchestration tools
    "create_task",
    "create_execution_plan",
    "delegate_task",
    "create_custom_agent",
    "delegate_to_custom_agent",
    "get_task_status",
    "wait_for_tasks",
    "get_all_pending_tasks",
    "synthesize_results",
    # Web tools
    "fetch_url",
    "search_web",
    "screenshot_page",
    "interact_with_page",
    "extract_page_data",
    # Vision tools
    "analyze_screenshot",
    "design_to_code",
    # Skill tools
    "list_skills",
    "get_skill",
    "match_skills",
    "execute_skill",
    "create_skill",
    "delete_skill",
    "get_skill_stats",
    "recommend_skills",
    # Deploy tools
    "deploy_preview",
    "get_preview_status",
    "stop_preview",
    "run_e2e_tests",
    "rollback_deploy",
    "check_deployment_health",
    "wait_for_deployment",
    "list_previews",
    "get_preview_logs",
}

# Tool descriptions for the list_available_tools function
TOOL_DESCRIPTIONS = {
    # File tools
    "read_file": (
        "Read files from the workspace - useful for code analysis, reviewing existing code"
    ),
    "write_file": "Create or modify files - essential for coding agents that need to write code",
    "list_directory": "Browse directory contents - for exploring project structure",
    "search_code": "Search for code patterns across the workspace - good for finding usages",
    "glob_files": "Find files matching a glob pattern (e.g., **/*.py) - for bulk file discovery",
    "grep": "Search file contents with regex patterns - for finding text across files",
    "apply_patch": "Apply a unified diff patch to a file - for making precise edits",
    # Command tools
    "run_command": "Execute shell commands - for running tests, builds, npm, etc.",
    # Git tools
    "git_status": "Check git status - see modified, staged, and untracked files",
    "git_commit": "Create a git commit with staged changes",
    "git_push": "Push commits to a remote repository",
    "git_branch": "List, create, or switch git branches",
    "git_diff": "Show changes between commits, branches, or working directory",
    "git_log": "View commit history",
    "create_pr": "Create a pull request on GitHub",
    # Memory tools
    "store_memory": "Store facts or insights for later recall - persists across sessions",
    "recall_memory": "Search and retrieve stored memories by semantic similarity",
    "update_memory": "Update existing memories - for managing stored information",
    "delete_memory": "Delete memories - for cleaning up outdated information",
    "get_session_memories": "Get all memories from the current session",
    # Task/orchestration tools
    "create_task": "Create a task for another agent to handle",
    "create_execution_plan": "Create a multi-step execution plan for complex tasks",
    "delegate_task": "Delegate a task to a specific agent role",
    "create_custom_agent": "Create a custom agent with specific capabilities",
    "delegate_to_custom_agent": "Delegate a task to a custom agent",
    "get_task_status": "Check the status of a delegated task",
    "wait_for_tasks": "Wait for multiple tasks to complete",
    "get_all_pending_tasks": "Get all pending tasks in the session",
    "synthesize_results": "Combine results from multiple tasks into a summary",
    # Web tools
    "fetch_url": "Fetch content from a URL - for reading web pages or APIs",
    "search_web": "Search the web for information",
    "screenshot_page": "Take a screenshot of a web page",
    "interact_with_page": "Interact with web page elements (click, type, etc.)",
    "extract_page_data": "Extract structured data from a web page",
    # Vision tools
    "analyze_screenshot": "Analyze a screenshot using vision AI",
    "design_to_code": "Convert a design image to code",
    # Skill tools
    "list_skills": "List available skills in the skill library",
    "get_skill": "Get details about a specific skill",
    "match_skills": "Find skills matching a query or task description",
    "execute_skill": "Execute a skill with given parameters",
    "create_skill": "Create a new reusable skill",
    "delete_skill": "Delete a skill from the library",
    "get_skill_stats": "Get usage statistics for skills",
    "recommend_skills": "Get skill recommendations for a task",
    # Deploy tools
    "deploy_preview": "Deploy a preview environment for testing",
    "get_preview_status": "Get status of a preview deployment",
    "stop_preview": "Stop a running preview environment",
    "run_e2e_tests": "Run end-to-end tests against a deployment",
    "rollback_deploy": "Rollback a deployment to a previous commit",
    "check_deployment_health": "Check health of a deployed service",
    "wait_for_deployment": "Wait for a deployment to become healthy",
    "list_previews": "List all preview deployments for the session",
    "get_preview_logs": "Get logs from a preview deployment",
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
