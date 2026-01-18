"""Skill management tools for agents."""

import json
from dataclasses import dataclass, field
from typing import Any

import structlog

from src.skills.registry import SkillRegistry


@dataclass
class CreateSkillConfig:
    """Configuration for creating a new skill."""

    name: str
    description: str
    steps: list[dict[str, Any]]
    tags: list[str] = field(default_factory=list)
    triggers: list[str] = field(default_factory=list)
    save: bool = True


logger = structlog.get_logger()


class SkillRegistryHolder:
    """Singleton holder for the skill registry instance."""

    _instance: SkillRegistry | None = None

    @classmethod
    def get(cls) -> SkillRegistry:
        """Get or create skill registry."""
        if cls._instance is None:
            cls._instance = SkillRegistry()
            # Note: load_skills() is async and should be called separately
        return cls._instance


def _get_registry() -> SkillRegistry:
    """Get or create skill registry."""
    return SkillRegistryHolder.get()


async def list_skills(
    tags: list[str] | None = None,
    author: str | None = None,
) -> str:
    """List available skills.

    Args:
        tags: Filter by tags
        author: Filter by author

    Returns:
        JSON string with skills list
    """
    registry = _get_registry()
    skills = registry.list_skills(tags=tags, author=author)

    return json.dumps(
        {
            "success": True,
            "count": len(skills),
            "skills": [
                {
                    "name": s.name,
                    "description": s.description,
                    "version": s.version,
                    "author": s.author,
                    "tags": s.tags,
                    "triggers": s.triggers,
                    "steps": len(s.steps),
                }
                for s in skills
            ],
        },
    )


async def get_skill(name: str) -> str:
    """Get details of a specific skill.

    Args:
        name: Skill name

    Returns:
        JSON string with skill details
    """
    registry = _get_registry()
    skill = registry.get_skill(name)

    if not skill:
        return json.dumps(
            {
                "success": False,
                "error": f"Skill not found: {name}",
            },
        )

    return json.dumps(
        {
            "success": True,
            "skill": skill.to_dict(),
        },
    )


async def match_skills(
    task: str,
    min_score: float = 0.3,
    limit: int = 5,
) -> str:
    """Find skills that match a task description.

    Args:
        task: Task description
        min_score: Minimum match score (0-1)
        limit: Maximum results

    Returns:
        JSON string with matched skills
    """
    registry = _get_registry()
    matches = registry.match_skills(task, min_score=min_score, limit=limit)

    return json.dumps(
        {
            "success": True,
            "task": task,
            "count": len(matches),
            "matches": [
                {
                    "name": m.skill.name,
                    "description": m.skill.description,
                    "score": m.score,
                    "matched_triggers": m.matched_triggers,
                    "matched_tags": m.matched_tags,
                }
                for m in matches
            ],
        },
    )


async def execute_skill(
    skill_name: str,
    context: dict[str, Any] | None = None,
    stop_on_failure: bool = True,
) -> str:
    """Execute a skill.

    Args:
        skill_name: Name of skill to execute
        context: Execution context
        stop_on_failure: Stop on first failed step

    Returns:
        JSON string with execution result
    """
    logger.info("Executing skill", skill=skill_name)

    registry = _get_registry()
    result = await registry.execute_skill(
        skill_name=skill_name,
        context=context,
        stop_on_failure=stop_on_failure,
    )

    return json.dumps(
        {
            "success": True,
            "execution": result.to_dict(),
        },
    )


async def create_skill(config: CreateSkillConfig) -> str:
    """Create a new skill.

    Args:
        config: Skill creation configuration containing name, description,
                steps, tags, triggers, and save flag.

    Returns:
        JSON string with created skill
    """
    logger.info("Creating skill", name=config.name)

    registry = _get_registry()

    skill_data = {
        "name": config.name,
        "description": config.description,
        "steps": config.steps,
        "tags": config.tags,
        "triggers": config.triggers,
        "author": "user",
        "version": "1.0.0",
    }

    skill = registry.register_skill(skill_data)

    # Note: save_skill not implemented - skills are saved via API
    _ = config.save  # Mark as intentionally unused

    return json.dumps(
        {
            "success": True,
            "skill": skill.to_dict(),
            "saved": config.save,
        },
    )


async def delete_skill(name: str) -> str:
    """Delete a skill.

    Args:
        name: Skill name

    Returns:
        JSON string with result
    """
    logger.info("Deleting skill", name=name)

    # Note: delete_skill not implemented - skills are managed via API
    # This returns a placeholder response
    return json.dumps(
        {
            "success": False,
            "message": f"Skill deletion for '{name}' is managed via the API",
        },
    )


async def get_skill_stats(name: str) -> str:
    """Get execution statistics for a skill.

    Args:
        name: Skill name

    Returns:
        JSON string with stats
    """
    registry = _get_registry()
    stats = registry.get_skill_stats(name)

    return json.dumps(
        {
            "success": True,
            "stats": stats,
        },
    )


async def recommend_skills(
    agent_role: str,
    recent_tasks: list[str] | None = None,
    limit: int = 5,
) -> str:
    """Get skill recommendations for an agent.

    Args:
        agent_role: Agent role
        recent_tasks: Recent task descriptions
        limit: Maximum recommendations

    Returns:
        JSON string with recommendations
    """
    registry = _get_registry()
    skills = registry.recommend_skills(
        agent_role=agent_role,
        recent_tasks=recent_tasks,
        limit=limit,
    )

    return json.dumps(
        {
            "success": True,
            "agent_role": agent_role,
            "recommendations": [
                {
                    "name": s.name,
                    "description": s.description,
                    "tags": s.tags,
                }
                for s in skills
            ],
        },
    )


# Tool definitions for registration
SKILL_TOOLS = {
    "list_skills": {
        "function": list_skills,
        "description": "List all available skills with optional filtering by tags or author.",
        "parameters": {
            "type": "object",
            "properties": {
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Filter by tags",
                },
                "author": {
                    "type": "string",
                    "description": "Filter by author",
                },
            },
        },
    },
    "get_skill": {
        "function": get_skill,
        "description": "Get detailed information about a specific skill.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Skill name",
                },
            },
            "required": ["name"],
        },
    },
    "match_skills": {
        "function": match_skills,
        "description": "Find skills that match a task description.",
        "parameters": {
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": "Task description to match",
                },
                "min_score": {
                    "type": "number",
                    "description": "Minimum match score (0-1)",
                    "default": 0.3,
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum results",
                    "default": 5,
                },
            },
            "required": ["task"],
        },
    },
    "execute_skill": {
        "function": execute_skill,
        "description": "Execute a skill step by step.",
        "parameters": {
            "type": "object",
            "properties": {
                "skill_name": {
                    "type": "string",
                    "description": "Name of skill to execute",
                },
                "context": {
                    "type": "object",
                    "description": "Execution context with variables",
                },
                "stop_on_failure": {
                    "type": "boolean",
                    "description": "Stop on first failed step",
                    "default": True,
                },
            },
            "required": ["skill_name"],
        },
    },
    "create_skill": {
        "function": create_skill,
        "description": "Create a new custom skill.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Skill name",
                },
                "description": {
                    "type": "string",
                    "description": "Skill description",
                },
                "steps": {
                    "type": "array",
                    "description": "List of skill steps",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "description": {"type": "string"},
                            "tool": {"type": "string"},
                            "parameters": {"type": "object"},
                        },
                    },
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "triggers": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "save": {
                    "type": "boolean",
                    "description": "Save to file",
                    "default": True,
                },
            },
            "required": ["name", "description", "steps"],
        },
    },
    "delete_skill": {
        "function": delete_skill,
        "description": "Delete a skill.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Skill name",
                },
            },
            "required": ["name"],
        },
    },
    "recommend_skills": {
        "function": recommend_skills,
        "description": "Get skill recommendations for an agent based on role and recent tasks.",
        "parameters": {
            "type": "object",
            "properties": {
                "agent_role": {
                    "type": "string",
                    "description": "Agent role (coder, reviewer, architect, tester)",
                },
                "recent_tasks": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Recent task descriptions",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum recommendations",
                    "default": 5,
                },
            },
            "required": ["agent_role"],
        },
    },
}
