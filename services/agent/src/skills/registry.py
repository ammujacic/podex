"""Skill registry for managing and matching skills to tasks."""

import ast
import json
import operator
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import structlog

from src.skills.loader import Skill, SkillLoader
from src.tools.executor import ToolExecutor

logger = structlog.get_logger()


@dataclass
class SkillMatch:
    """A matched skill with relevance score."""

    skill: Skill
    score: float
    matched_triggers: list[str] = field(default_factory=list)
    matched_tags: list[str] = field(default_factory=list)


@dataclass
class SkillExecutionResult:
    """Result of executing a skill."""

    skill_name: str
    success: bool
    steps_completed: int
    total_steps: int
    results: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None
    duration_ms: int = 0
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "skill_name": self.skill_name,
            "success": self.success,
            "steps_completed": self.steps_completed,
            "total_steps": self.total_steps,
            "results": self.results,
            "error": self.error,
            "duration_ms": self.duration_ms,
            "timestamp": self.timestamp.isoformat(),
        }


class SkillRegistry:
    """Registry for managing skills and matching them to tasks.

    Features:
    - Skill matching based on triggers and tags
    - Skill execution with step-by-step tracking
    - User skill management
    - Skill recommendations
    """

    def __init__(
        self,
        loader: SkillLoader | None = None,
        tool_executor: ToolExecutor | None = None,
    ) -> None:
        """Initialize skill registry.

        Args:
            loader: Skill loader instance
            tool_executor: Tool executor for running skill steps
        """
        self._loader = loader or SkillLoader()
        self._tool_executor = tool_executor
        self._execution_history: list[SkillExecutionResult] = []

    def load_skills(self) -> list[Skill]:
        """Load all skills from the loader."""
        return self._loader.load_all()

    def get_skill(self, name: str) -> Skill | None:
        """Get a skill by name."""
        return self._loader.get_skill(name)

    def list_skills(
        self,
        tags: list[str] | None = None,
        author: str | None = None,
    ) -> list[Skill]:
        """List skills with optional filtering.

        Args:
            tags: Filter by tags
            author: Filter by author

        Returns:
            List of matching skills
        """
        skills = self._loader.get_all_skills()

        if tags:
            skills = [s for s in skills if any(t in s.tags for t in tags)]

        if author:
            skills = [s for s in skills if s.author == author]

        return skills

    def match_skills(
        self,
        task: str,
        min_score: float = 0.3,
        limit: int = 5,
    ) -> list[SkillMatch]:
        """Find skills that match a task description.

        Args:
            task: Task description
            min_score: Minimum match score (0-1)
            limit: Maximum results

        Returns:
            List of matched skills sorted by score
        """
        skills = self._loader.get_all_skills()
        matches = []
        task_lower = task.lower()

        for skill in skills:
            score = skill.matches_task(task)

            if score >= min_score:
                # Find specific matched triggers and tags
                matched_triggers = [t for t in skill.triggers if t.lower() in task_lower]
                matched_tags = [t for t in skill.tags if t.lower() in task_lower]

                matches.append(
                    SkillMatch(
                        skill=skill,
                        score=score,
                        matched_triggers=matched_triggers,
                        matched_tags=matched_tags,
                    ),
                )

        # Sort by score descending
        matches.sort(key=lambda m: m.score, reverse=True)

        return matches[:limit]

    def get_best_skill(self, task: str) -> Skill | None:
        """Get the best matching skill for a task.

        Args:
            task: Task description

        Returns:
            Best matching skill or None
        """
        matches = self.match_skills(task, min_score=0.4, limit=1)
        return matches[0].skill if matches else None

    async def execute_skill(
        self,
        skill_name: str,
        context: dict[str, Any] | None = None,
        stop_on_failure: bool = True,
    ) -> SkillExecutionResult:
        """Execute a skill step by step.

        Args:
            skill_name: Name of skill to execute
            context: Execution context with variables
            stop_on_failure: Stop on first failed step

        Returns:
            Execution result
        """
        skill = self.get_skill(skill_name)
        if not skill:
            return SkillExecutionResult(
                skill_name=skill_name,
                success=False,
                steps_completed=0,
                total_steps=0,
                error=f"Skill not found: {skill_name}",
            )

        if not self._tool_executor:
            return SkillExecutionResult(
                skill_name=skill_name,
                success=False,
                steps_completed=0,
                total_steps=len(skill.steps),
                error="Tool executor not configured",
            )

        start_time = time.time()
        context = context or {}
        results = []
        steps_completed = 0

        logger.info(
            "Executing skill",
            skill=skill_name,
            steps=len(skill.steps),
        )

        for step in skill.steps:
            # Check condition
            if step.condition and not self._evaluate_condition(step.condition, context):
                results.append(
                    {
                        "step": step.name,
                        "status": "skipped",
                        "reason": "condition not met",
                    },
                )
                continue

            # Resolve parameters
            params = self._resolve_parameters(step.parameters, context)

            logger.debug(
                "Executing step",
                skill=skill_name,
                step=step.name,
                tool=step.tool,
            )

            try:
                # Execute the step
                result = await self._tool_executor.execute(step.tool, params)

                # Parse result
                try:
                    result_data = json.loads(result)
                except json.JSONDecodeError:
                    result_data = {"output": result}

                success = result_data.get("success", True)

                # Update context with result
                context[f"{step.name}_result"] = result_data

                results.append(
                    {
                        "step": step.name,
                        "tool": step.tool,
                        "status": "success" if success else "failed",
                        "result": result_data,
                    },
                )

                if success:
                    steps_completed += 1
                elif step.required and stop_on_failure:
                    logger.error(
                        "Required step failed",
                        skill=skill_name,
                        step=step.name,
                    )
                    break

            except Exception as e:
                results.append(
                    {
                        "step": step.name,
                        "tool": step.tool,
                        "status": "error",
                        "error": str(e),
                    },
                )

                if step.required and stop_on_failure:
                    logger.error(
                        "Step execution error",
                        skill=skill_name,
                        step=step.name,
                        error=str(e),
                    )
                    break

        duration_ms = int((time.time() - start_time) * 1000)
        success = steps_completed == len([s for s in skill.steps if s.required])

        execution_result = SkillExecutionResult(
            skill_name=skill_name,
            success=success,
            steps_completed=steps_completed,
            total_steps=len(skill.steps),
            results=results,
            duration_ms=duration_ms,
        )

        self._execution_history.append(execution_result)

        logger.info(
            "Skill execution completed",
            skill=skill_name,
            success=success,
            steps_completed=steps_completed,
            duration_ms=duration_ms,
        )

        return execution_result

    def _evaluate_condition(
        self,
        condition: str,
        context: dict[str, Any],
    ) -> bool:
        """Evaluate a step condition safely without using eval().

        Args:
            condition: Condition expression
            context: Current context

        Returns:
            True if condition is met

        Supports simple expressions like:
        - "has_tests == true"
        - "file_count > 0"
        - "status == 'success'"
        """
        # Safe comparison operators
        safe_operators = {
            ast.Eq: operator.eq,
            ast.NotEq: operator.ne,
            ast.Lt: operator.lt,
            ast.LtE: operator.le,
            ast.Gt: operator.gt,
            ast.GtE: operator.ge,
        }

        # Boolean constants mapping
        bool_constants = {"true": True, "false": False, "none": None}

        def safe_eval_node(node: ast.AST) -> Any:
            """Safely evaluate an AST node."""
            if isinstance(node, ast.Expression):
                return safe_eval_node(node.body)
            if isinstance(node, ast.Compare):
                # Handle comparison: left op right
                if len(node.ops) != 1 or len(node.comparators) != 1:
                    raise ValueError("Only simple comparisons supported")
                left = safe_eval_node(node.left)
                right = safe_eval_node(node.comparators[0])
                op = type(node.ops[0])
                if op not in safe_operators:
                    raise ValueError(f"Unsupported operator: {op.__name__}")
                return safe_operators[op](left, right)
            if isinstance(node, ast.Constant):
                return node.value
            if isinstance(node, ast.Name):
                name = node.id.lower()
                if name in bool_constants:
                    return bool_constants[name]
                if node.id in context:
                    return context[node.id]
                raise ValueError(f"Unknown variable: {node.id}")
            if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
                # Handle negative numbers
                return -safe_eval_node(node.operand)
            raise ValueError(f"Unsupported expression type: {type(node).__name__}")

        try:
            # Parse as expression to validate syntax
            tree = ast.parse(condition, mode="eval")
            return bool(safe_eval_node(tree))
        except (SyntaxError, ValueError) as e:
            logger.warning(
                "Condition evaluation failed",
                condition=condition,
                error=str(e),
            )
            return False
        except Exception as e:
            logger.warning(
                "Unexpected condition evaluation error",
                condition=condition,
                error=str(e),
            )
            return False

    def _resolve_parameters(
        self,
        parameters: dict[str, Any],
        context: dict[str, Any],
    ) -> dict[str, Any]:
        """Resolve parameter templates with context values.

        Args:
            parameters: Parameters with potential templates
            context: Context for template resolution

        Returns:
            Resolved parameters
        """
        resolved: dict[str, Any] = {}

        for key, param_value in parameters.items():
            if isinstance(param_value, str) and "{{" in param_value:
                # Template resolution
                resolved_value = param_value
                for ctx_key, ctx_value in context.items():
                    resolved_value = resolved_value.replace(f"{{{{{ctx_key}}}}}", str(ctx_value))
                resolved[key] = resolved_value
            elif isinstance(param_value, dict):
                resolved[key] = self._resolve_parameters(param_value, context)
            else:
                resolved[key] = param_value

        return resolved

    def register_skill(self, skill_data: dict[str, Any]) -> Skill:
        """Register a new skill from data.

        Args:
            skill_data: Skill definition

        Returns:
            Registered skill
        """
        return self._loader.add_skill_from_dict(skill_data)

    def save_skill(self, skill_name: str) -> bool:
        """Save a skill to file.

        Args:
            skill_name: Skill to save

        Returns:
            True if saved
        """
        skill = self.get_skill(skill_name)
        if not skill:
            return False
        return self._loader.save_skill(skill)

    def delete_skill(self, skill_name: str) -> bool:
        """Delete a skill.

        Args:
            skill_name: Skill to delete

        Returns:
            True if deleted
        """
        return self._loader.delete_skill(skill_name)

    def get_execution_history(
        self,
        skill_name: str | None = None,
        limit: int = 10,
    ) -> list[SkillExecutionResult]:
        """Get skill execution history.

        Args:
            skill_name: Filter by skill name
            limit: Maximum results

        Returns:
            Execution history
        """
        history = self._execution_history

        if skill_name:
            history = [h for h in history if h.skill_name == skill_name]

        return history[-limit:]

    def get_skill_stats(self, skill_name: str) -> dict[str, Any]:
        """Get statistics for a skill.

        Args:
            skill_name: Skill name

        Returns:
            Statistics dictionary
        """
        history = [h for h in self._execution_history if h.skill_name == skill_name]

        if not history:
            return {
                "skill_name": skill_name,
                "executions": 0,
            }

        successful = [h for h in history if h.success]
        durations = [h.duration_ms for h in history]

        return {
            "skill_name": skill_name,
            "executions": len(history),
            "success_rate": len(successful) / len(history) * 100,
            "avg_duration_ms": sum(durations) / len(durations),
            "min_duration_ms": min(durations),
            "max_duration_ms": max(durations),
            "last_executed": history[-1].timestamp.isoformat(),
        }

    def recommend_skills(
        self,
        agent_role: str,
        recent_tasks: list[str] | None = None,
        limit: int = 5,
    ) -> list[Skill]:
        """Recommend skills for an agent.

        Args:
            agent_role: Agent role
            recent_tasks: Recent task descriptions
            limit: Maximum recommendations

        Returns:
            Recommended skills
        """
        skills = self.list_skills()
        scored_skills = []

        for skill in skills:
            score = 0.0

            # Check if skill is tagged for this agent role
            if agent_role.lower() in [t.lower() for t in skill.tags]:
                score += 0.5

            # Check recent task matches
            if recent_tasks:
                for task in recent_tasks:
                    score += skill.matches_task(task) * 0.1

            # Boost frequently successful skills
            stats = self.get_skill_stats(skill.name)
            if stats.get("executions", 0) > 0:
                success_rate = stats.get("success_rate", 0)
                score += (success_rate / 100) * 0.2

            if score > 0:
                scored_skills.append((skill, score))

        # Sort by score
        scored_skills.sort(key=lambda x: x[1], reverse=True)

        return [s[0] for s in scored_skills[:limit]]
