"""Dynamic skill loader for agents.

Loads skills from the API (database-backed). YAML loading is removed.
All platform skills are now managed via the admin panel and stored in the database.
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx
import structlog

from src.config import settings

logger = structlog.get_logger()


@dataclass
class SkillStep:
    """A step in a skill workflow."""

    name: str
    description: str
    tool: str | None = None  # Tool to execute
    skill: str | None = None  # Skill to chain (for skill-to-skill calls)
    parameters: dict[str, Any] = field(default_factory=dict)
    condition: str | None = None
    on_success: str | None = None  # Step name to jump to on success
    on_failure: str | None = None  # Step name to jump to on failure
    parallel_with: list[str] | None = None  # Steps to run in parallel
    required: bool = True


@dataclass
class Skill:
    """A skill definition for an agent."""

    name: str
    slug: str  # Unique identifier
    description: str
    version: str = "1.0.0"
    author: str = "system"
    skill_type: str = "system"  # "system" or "user"
    tags: list[str] = field(default_factory=list)
    triggers: list[str] = field(default_factory=list)
    required_tools: list[str] = field(default_factory=list)
    required_context: list[str] = field(default_factory=list)
    steps: list[SkillStep] = field(default_factory=list)
    system_prompt: str | None = None
    examples: list[dict[str, str]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    loaded_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "name": self.name,
            "slug": self.slug,
            "description": self.description,
            "version": self.version,
            "author": self.author,
            "skill_type": self.skill_type,
            "tags": self.tags,
            "triggers": self.triggers,
            "required_tools": self.required_tools,
            "required_context": self.required_context,
            "steps": [
                {
                    "name": s.name,
                    "description": s.description,
                    "tool": s.tool,
                    "skill": s.skill,
                    "parameters": s.parameters,
                    "condition": s.condition,
                    "on_success": s.on_success,
                    "on_failure": s.on_failure,
                    "parallel_with": s.parallel_with,
                    "required": s.required,
                }
                for s in self.steps
            ],
            "system_prompt": self.system_prompt,
            "examples": self.examples,
            "metadata": self.metadata,
        }

    def matches_task(self, task: str) -> float:
        """Calculate match score for a task description.

        Args:
            task: Task description to match

        Returns:
            Match score 0-1
        """
        task_lower = task.lower()
        score = 0.0

        # Check triggers
        for trigger in self.triggers:
            if trigger.lower() in task_lower:
                score += 0.5
                break

        # Check tags
        matching_tags = sum(1 for tag in self.tags if tag.lower() in task_lower)
        if matching_tags > 0:
            score += min(0.3, matching_tags * 0.1)

        # Check description keywords
        desc_words = set(self.description.lower().split())
        task_words = set(task_lower.split())
        overlap = len(desc_words & task_words)
        if overlap > 0:
            score += min(0.2, overlap * 0.05)

        return min(1.0, score)


class SkillLoader:
    """Loads skill definitions from the API (database-backed).

    All skills are loaded from the API which reads from the database.
    System skills are managed by admins, user skills are personal.
    """

    def __init__(self, api_url: str | None = None) -> None:
        """Initialize skill loader.

        Args:
            api_url: API base URL (defaults to settings.API_URL)
        """
        self._api_url = api_url or getattr(settings, "API_URL", "http://localhost:8000")
        self._skills: dict[str, Skill] = {}
        self._loaded = False

    async def load_from_api(
        self, user_id: str | None = None, auth_token: str | None = None
    ) -> list[Skill]:
        """Load all available skills from the API.

        Args:
            user_id: User ID for loading user-specific skills
            auth_token: Auth token for API authentication

        Returns:
            List of loaded skills
        """
        try:
            headers = {}
            if auth_token:
                headers["Authorization"] = f"Bearer {auth_token}"

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{self._api_url}/api/v1/skills/available",
                    headers=headers,
                    params={"include_system": True, "include_user": bool(user_id)},
                )

                if response.status_code != 200:
                    logger.warning(
                        "Failed to load skills from API",
                        status=response.status_code,
                        detail=response.text,
                    )
                    return []

                data = response.json()
                skills_data = data.get("skills", [])

                skills = []
                for skill_data in skills_data:
                    skill = self._parse_skill(skill_data)
                    skills.append(skill)
                    self._skills[skill.slug] = skill

                self._loaded = True
                logger.info(
                    "Skills loaded from API",
                    total=len(skills),
                    system=data.get("total_system", 0),
                    user=data.get("total_user", 0),
                )
                return skills

        except httpx.TimeoutException:
            logger.error("Timeout loading skills from API")
            return []
        except Exception as e:
            logger.error("Failed to load skills from API", error=str(e))
            return []

    def _parse_skill(self, data: dict[str, Any]) -> Skill:
        """Parse skill data from API into a Skill object."""
        steps = []
        for step_data in data.get("steps", []):
            steps.append(
                SkillStep(
                    name=step_data.get("name", "unnamed"),
                    description=step_data.get("description", ""),
                    tool=step_data.get("tool"),
                    skill=step_data.get("skill"),
                    parameters=step_data.get("parameters", {}),
                    condition=step_data.get("condition"),
                    on_success=step_data.get("on_success"),
                    on_failure=step_data.get("on_failure"),
                    parallel_with=step_data.get("parallel_with"),
                    required=step_data.get("required", True),
                ),
            )

        # Merge existing metadata with skill ID for tracking
        metadata = data.get("metadata") or {}
        if "id" not in metadata:
            # Store skill ID in metadata for execution tracking
            skill_id = data.get("id")
            if skill_id:
                metadata["id"] = skill_id

        return Skill(
            name=data.get("name", "unnamed"),
            slug=data.get("slug", data.get("name", "unnamed").lower().replace(" ", "_")),
            description=data.get("description", ""),
            version=data.get("version", "1.0.0"),
            author=data.get("author", "system"),
            skill_type=data.get("skill_type", "system"),
            tags=data.get("tags", []),
            triggers=data.get("triggers", []),
            required_tools=data.get("required_tools", []),
            required_context=data.get("required_context", []),
            steps=steps,
            system_prompt=data.get("system_prompt"),
            examples=data.get("examples", []),
            metadata=metadata,
        )

    def get_skill(self, slug: str) -> Skill | None:
        """Get a skill by slug.

        Args:
            slug: Skill slug

        Returns:
            Skill or None
        """
        return self._skills.get(slug)

    def get_skill_by_name(self, name: str) -> Skill | None:
        """Get a skill by name (case-insensitive).

        Args:
            name: Skill name

        Returns:
            Skill or None
        """
        name_lower = name.lower()
        for skill in self._skills.values():
            if skill.name.lower() == name_lower:
                return skill
        return None

    def get_all_skills(self) -> list[Skill]:
        """Get all loaded skills."""
        return list(self._skills.values())

    async def reload_all(
        self, user_id: str | None = None, auth_token: str | None = None
    ) -> list[Skill]:
        """Reload all skills from API."""
        self._skills.clear()
        self._loaded = False
        return await self.load_from_api(user_id, auth_token)

    def add_skill_from_dict(self, data: dict[str, Any]) -> Skill:
        """Add a skill from a dictionary (e.g., runtime-created).

        Args:
            data: Skill definition

        Returns:
            Created skill
        """
        skill = self._parse_skill(data)
        self._skills[skill.slug] = skill
        return skill

    def remove_skill(self, slug: str) -> bool:
        """Remove a skill from the in-memory cache.

        Args:
            slug: Skill slug

        Returns:
            True if removed
        """
        if slug in self._skills:
            del self._skills[slug]
            logger.info("Skill removed from cache", slug=slug)
            return True
        return False

    def validate_skill(self, skill: Skill) -> list[str]:
        """Validate a skill definition.

        Args:
            skill: Skill to validate

        Returns:
            List of validation errors (empty if valid)
        """
        errors = []

        if not skill.name:
            errors.append("Skill name is required")

        if not skill.slug:
            errors.append("Skill slug is required")

        if not skill.description:
            errors.append("Skill description is required")

        if not skill.steps:
            errors.append("At least one step is required")

        for i, step in enumerate(skill.steps):
            # Either tool or skill must be specified
            if not step.tool and not step.skill:
                errors.append(f"Step {i + 1} ({step.name}): tool or skill is required")
            if not step.name:
                errors.append(f"Step {i + 1}: name is required")

        return errors

    @property
    def is_loaded(self) -> bool:
        """Check if skills have been loaded."""
        return self._loaded

    async def record_execution(
        self,
        skill: "Skill",
        success: bool,
        steps_completed: int,
        total_steps: int,
        duration_ms: int,
        auth_token: str | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        error_message: str | None = None,
        context_snapshot: dict[str, Any] | None = None,
        results_snapshot: dict[str, Any] | None = None,
    ) -> bool:
        """Record a skill execution to the API for analytics.

        Args:
            skill: The skill that was executed
            success: Whether execution succeeded
            steps_completed: Number of steps completed
            total_steps: Total number of steps
            duration_ms: Execution duration in milliseconds
            auth_token: Auth token for API authentication
            session_id: Session ID (optional)
            agent_id: Agent ID (optional)
            error_message: Error message if failed
            context_snapshot: Context at execution time
            results_snapshot: Execution results

        Returns:
            True if successfully recorded
        """
        try:
            headers = {"Content-Type": "application/json"}
            if auth_token:
                headers["Authorization"] = f"Bearer {auth_token}"

            # Build request data
            data = {
                "skill_slug": skill.slug,
                "skill_type": skill.skill_type,
                "success": success,
                "steps_completed": steps_completed,
                "total_steps": total_steps,
                "duration_ms": duration_ms,
            }

            # Add optional fields
            if session_id:
                data["session_id"] = session_id
            if agent_id:
                data["agent_id"] = agent_id
            if error_message:
                data["error_message"] = error_message
            if context_snapshot:
                data["context_snapshot"] = context_snapshot
            if results_snapshot:
                data["results_snapshot"] = results_snapshot

            # Get skill ID based on type (requires looking up the skill)
            if skill.skill_type == "user":
                # For user skills, we'd need the ID from the API response
                # The skill metadata might contain it
                skill_id = skill.metadata.get("id")
                if skill_id:
                    data["skill_id"] = skill_id
            else:
                # For system skills, same approach
                system_skill_id = skill.metadata.get("id")
                if system_skill_id:
                    data["system_skill_id"] = system_skill_id

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    f"{self._api_url}/api/v1/skills/executions",
                    headers=headers,
                    json=data,
                )

                if response.status_code == 201:
                    logger.debug(
                        "Skill execution recorded",
                        skill=skill.slug,
                        success=success,
                        duration_ms=duration_ms,
                    )
                    return True
                else:
                    logger.warning(
                        "Failed to record skill execution",
                        status=response.status_code,
                        skill=skill.slug,
                    )
                    return False

        except httpx.TimeoutException:
            logger.warning("Timeout recording skill execution", skill=skill.slug)
            return False
        except Exception as e:
            logger.warning("Error recording skill execution", skill=skill.slug, error=str(e))
            return False
