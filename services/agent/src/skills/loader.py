"""Dynamic skill loader for agents."""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import structlog
import yaml

logger = structlog.get_logger()


@dataclass
class SkillStep:
    """A step in a skill workflow."""

    name: str
    description: str
    tool: str
    parameters: dict[str, Any] = field(default_factory=dict)
    condition: str | None = None
    on_success: str | None = None
    on_failure: str | None = None
    required: bool = True


@dataclass
class Skill:
    """A skill definition for an agent."""

    name: str
    description: str
    version: str = "1.0.0"
    author: str = "system"
    tags: list[str] = field(default_factory=list)
    triggers: list[str] = field(default_factory=list)
    required_tools: list[str] = field(default_factory=list)
    required_context: list[str] = field(default_factory=list)
    steps: list[SkillStep] = field(default_factory=list)
    system_prompt: str | None = None
    examples: list[dict[str, str]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    source_file: str | None = None
    loaded_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "author": self.author,
            "tags": self.tags,
            "triggers": self.triggers,
            "required_tools": self.required_tools,
            "required_context": self.required_context,
            "steps": [
                {
                    "name": s.name,
                    "description": s.description,
                    "tool": s.tool,
                    "parameters": s.parameters,
                    "condition": s.condition,
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
    """Loads skill definitions from YAML files.

    Features:
    - Load skills from directory
    - Hot-reload support
    - Validation
    - User-defined skills
    """

    SKILLS_DIR = Path(__file__).parent.parent.parent / "skills"

    def __init__(self, skills_dir: str | Path | None = None) -> None:
        """Initialize skill loader.

        Args:
            skills_dir: Custom skills directory
        """
        self._skills_dir = Path(skills_dir) if skills_dir else self.SKILLS_DIR
        self._skills: dict[str, Skill] = {}
        self._loaded = False

    def load_all(self) -> list[Skill]:
        """Load all skills from the skills directory.

        Returns:
            List of loaded skills
        """
        if not self._skills_dir.exists():
            logger.warning("Skills directory not found", path=str(self._skills_dir))
            self._skills_dir.mkdir(parents=True, exist_ok=True)
            return []

        skills = []
        for file_path in self._skills_dir.glob("**/*.yaml"):
            skill = self.load_skill(file_path)
            if skill:
                skills.append(skill)

        for file_path in self._skills_dir.glob("**/*.yml"):
            skill = self.load_skill(file_path)
            if skill:
                skills.append(skill)

        self._loaded = True
        logger.info("Skills loaded", count=len(skills))
        return skills

    def load_skill(self, file_path: str | Path) -> Skill | None:
        """Load a single skill from a YAML file.

        Args:
            file_path: Path to skill YAML file

        Returns:
            Loaded skill or None
        """
        path = Path(file_path)
        if not path.exists():
            logger.warning("Skill file not found", path=str(path))
            return None

        try:
            with path.open() as f:
                data = yaml.safe_load(f)

            if not data:
                return None

            skill = self._parse_skill(data)
            skill.source_file = str(path)

            self._skills[skill.name] = skill

            logger.debug(
                "Skill loaded",
                name=skill.name,
                version=skill.version,
                path=str(path),
            )

            return skill

        except yaml.YAMLError as e:
            logger.error("Failed to parse skill YAML", path=str(path), error=str(e))
            return None
        except Exception as e:
            logger.error("Failed to load skill", path=str(path), error=str(e))
            return None

    def _parse_skill(self, data: dict[str, Any]) -> Skill:
        """Parse skill data into a Skill object."""
        steps = []
        for step_data in data.get("steps", []):
            steps.append(
                SkillStep(
                    name=step_data.get("name", "unnamed"),
                    description=step_data.get("description", ""),
                    tool=step_data.get("tool", ""),
                    parameters=step_data.get("parameters", {}),
                    condition=step_data.get("condition"),
                    on_success=step_data.get("on_success"),
                    on_failure=step_data.get("on_failure"),
                    required=step_data.get("required", True),
                ),
            )

        return Skill(
            name=data.get("name", "unnamed"),
            description=data.get("description", ""),
            version=data.get("version", "1.0.0"),
            author=data.get("author", "system"),
            tags=data.get("tags", []),
            triggers=data.get("triggers", []),
            required_tools=data.get("required_tools", []),
            required_context=data.get("required_context", []),
            steps=steps,
            system_prompt=data.get("system_prompt"),
            examples=data.get("examples", []),
            metadata=data.get("metadata", {}),
        )

    def get_skill(self, name: str) -> Skill | None:
        """Get a skill by name.

        Args:
            name: Skill name

        Returns:
            Skill or None
        """
        if not self._loaded:
            self.load_all()
        return self._skills.get(name)

    def get_all_skills(self) -> list[Skill]:
        """Get all loaded skills."""
        if not self._loaded:
            self.load_all()
        return list(self._skills.values())

    def reload_skill(self, name: str) -> Skill | None:
        """Reload a skill from its source file.

        Args:
            name: Skill name

        Returns:
            Reloaded skill or None
        """
        skill = self._skills.get(name)
        if not skill or not skill.source_file:
            return None

        return self.load_skill(skill.source_file)

    def reload_all(self) -> list[Skill]:
        """Reload all skills."""
        self._skills.clear()
        self._loaded = False
        return self.load_all()

    def add_skill_from_dict(self, data: dict[str, Any]) -> Skill:
        """Add a skill from a dictionary (e.g., user-created).

        Args:
            data: Skill definition

        Returns:
            Created skill
        """
        skill = self._parse_skill(data)
        self._skills[skill.name] = skill
        return skill

    def save_skill(self, skill: Skill, file_path: str | Path | None = None) -> bool:
        """Save a skill to a YAML file.

        Args:
            skill: Skill to save
            file_path: Optional custom path

        Returns:
            True if saved successfully
        """
        path = Path(file_path) if file_path else self._skills_dir / f"{skill.name}.yaml"

        try:
            path.parent.mkdir(parents=True, exist_ok=True)

            data = {
                "name": skill.name,
                "description": skill.description,
                "version": skill.version,
                "author": skill.author,
                "tags": skill.tags,
                "triggers": skill.triggers,
                "required_tools": skill.required_tools,
                "required_context": skill.required_context,
                "steps": [
                    {
                        "name": s.name,
                        "description": s.description,
                        "tool": s.tool,
                        "parameters": s.parameters,
                        "condition": s.condition,
                        "on_success": s.on_success,
                        "on_failure": s.on_failure,
                        "required": s.required,
                    }
                    for s in skill.steps
                ],
                "system_prompt": skill.system_prompt,
                "examples": skill.examples,
                "metadata": skill.metadata,
            }

            with path.open("w") as f:
                yaml.dump(data, f, default_flow_style=False, sort_keys=False)

            skill.source_file = str(path)
            logger.info("Skill saved", name=skill.name, path=str(path))
            return True

        except Exception as e:
            logger.error("Failed to save skill", name=skill.name, error=str(e))
            return False

    def delete_skill(self, name: str) -> bool:
        """Delete a skill and its source file.

        Args:
            name: Skill name

        Returns:
            True if deleted
        """
        skill = self._skills.get(name)
        if not skill:
            return False

        # Delete source file if exists
        if skill.source_file:
            try:
                Path(skill.source_file).unlink(missing_ok=True)
            except Exception as e:
                logger.warning("Failed to delete skill file", path=skill.source_file, error=str(e))

        del self._skills[name]
        logger.info("Skill deleted", name=name)
        return True

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

        if not skill.description:
            errors.append("Skill description is required")

        if not skill.steps:
            errors.append("At least one step is required")

        for i, step in enumerate(skill.steps):
            if not step.tool:
                errors.append(f"Step {i + 1} ({step.name}): tool is required")
            if not step.name:
                errors.append(f"Step {i + 1}: name is required")

        return errors
