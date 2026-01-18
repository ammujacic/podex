"""Skill registry for managing and matching skills to tasks.

Loads skills from the API (database-backed). All skills are now managed via
the admin panel and stored in the database. Supports skill chaining and
parallel step execution.
"""

import ast
import asyncio
import json
import operator
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

import structlog

from src.skills.loader import Skill, SkillLoader, SkillStep

if TYPE_CHECKING:
    from src.streaming.publisher import StreamPublisher
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
    - Skill chaining (skills calling other skills)
    - Parallel step execution
    - User skill management
    - Skill recommendations
    - Execution tracking and analytics

    All skills are loaded from the API (database-backed).
    """

    def __init__(
        self,
        loader: SkillLoader | None = None,
        tool_executor: "ToolExecutor | None" = None,
        publisher: "StreamPublisher | None" = None,
        api_url: str | None = None,
    ) -> None:
        """Initialize skill registry.

        Args:
            loader: Skill loader instance
            tool_executor: Tool executor for running skill steps
            publisher: Stream publisher for real-time updates
            api_url: API base URL for skill loading
        """
        self._loader = loader or SkillLoader(api_url=api_url)
        self._tool_executor = tool_executor
        self._publisher = publisher
        self._execution_history: list[SkillExecutionResult] = []
        self._loaded = False
        self._executing_skills: set[str] = set()  # Track nested skill calls to prevent cycles
        # Auth context for API calls (set via set_auth_context)
        self._auth_token: str | None = None
        self._session_id: str | None = None
        self._agent_id: str | None = None

    def set_auth_context(
        self,
        auth_token: str | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
    ) -> None:
        """Set authentication and session context for API calls.

        Args:
            auth_token: Bearer token for API authentication
            session_id: Current session ID
            agent_id: Current agent ID
        """
        self._auth_token = auth_token
        self._session_id = session_id
        self._agent_id = agent_id

    async def load_skills(
        self, user_id: str | None = None, auth_token: str | None = None
    ) -> list[Skill]:
        """Load all skills from the API.

        Args:
            user_id: User ID for loading user-specific skills
            auth_token: Auth token for API authentication

        Returns:
            List of loaded skills
        """
        skills = await self._loader.load_from_api(user_id, auth_token)
        self._loaded = True
        return skills

    async def reload_skills(
        self, user_id: str | None = None, auth_token: str | None = None
    ) -> list[Skill]:
        """Reload all skills from the API.

        Args:
            user_id: User ID for loading user-specific skills
            auth_token: Auth token for API authentication

        Returns:
            List of loaded skills
        """
        self._executing_skills.clear()
        return await self._loader.reload_all(user_id, auth_token)

    def get_skill(self, name_or_slug: str) -> Skill | None:
        """Get a skill by name or slug.

        Args:
            name_or_slug: Skill name or slug

        Returns:
            Skill or None
        """
        # Try by slug first (more specific)
        skill = self._loader.get_skill(name_or_slug)
        if skill:
            return skill

        # Fall back to name lookup
        return self._loader.get_skill_by_name(name_or_slug)

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

        Supports:
        - Tool execution (step.tool)
        - Skill chaining (step.skill) - calls another skill
        - Parallel execution (step.parallel_with) - runs steps concurrently
        - Branching (step.on_success, step.on_failure) - jumps to specific steps

        Args:
            skill_name: Name or slug of skill to execute
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

        # Prevent circular skill calls
        if skill.slug in self._executing_skills:
            return SkillExecutionResult(
                skill_name=skill_name,
                success=False,
                steps_completed=0,
                total_steps=len(skill.steps),
                error=f"Circular skill call detected: {skill_name}",
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
        results: list[dict[str, Any]] = []
        steps_completed = 0

        # Track this skill to prevent cycles
        self._executing_skills.add(skill.slug)

        # Build step lookup map for branching
        step_map = {step.name: step for step in skill.steps}
        executed_steps: set[str] = set()

        logger.info(
            "Executing skill",
            skill=skill_name,
            slug=skill.slug,
            steps=len(skill.steps),
        )

        # Publish skill start event
        if self._publisher:
            await self._publisher.publish_skill_start(
                skill_name=skill.name,
                skill_slug=skill.slug,
                total_steps=len(skill.steps),
            )

        try:
            # Execute steps with branching support
            step_index = 0
            while step_index < len(skill.steps):
                step = skill.steps[step_index]

                # Skip already executed steps (from branching)
                if step.name in executed_steps:
                    step_index += 1
                    continue

                executed_steps.add(step.name)

                # Check condition
                if step.condition and not self._evaluate_condition(step.condition, context):
                    results.append(
                        {
                            "step": step.name,
                            "status": "skipped",
                            "reason": "condition not met",
                        }
                    )
                    # Publish step skipped
                    if self._publisher:
                        await self._publisher.publish_skill_step(
                            step_name=step.name,
                            step_index=step_index,
                            status="skipped",
                        )
                    step_index += 1
                    continue

                # Handle parallel execution
                if step.parallel_with:
                    step_result = await self._execute_parallel_steps(
                        skill, step, step_map, context, step_index
                    )
                    results.extend(step_result["results"])
                    if step_result["success"]:
                        steps_completed += step_result["completed"]
                    elif step.required and stop_on_failure:
                        break
                    # Mark parallel steps as executed
                    for name in step.parallel_with:
                        executed_steps.add(name)
                    step_index += 1
                    continue

                # Execute single step
                step_result = await self._execute_single_step(skill, step, context, step_index)
                results.append(step_result)

                success = step_result.get("status") == "success"

                if success:
                    steps_completed += 1
                    # Handle on_success branching
                    if step.on_success and step.on_success in step_map:
                        # Jump to the specified step
                        next_step_index = next(
                            (i for i, s in enumerate(skill.steps) if s.name == step.on_success),
                            None,
                        )
                        if next_step_index is not None:
                            step_index = next_step_index
                            continue
                else:
                    # Handle on_failure branching
                    if step.on_failure and step.on_failure in step_map:
                        next_step_index = next(
                            (i for i, s in enumerate(skill.steps) if s.name == step.on_failure),
                            None,
                        )
                        if next_step_index is not None:
                            step_index = next_step_index
                            continue

                    if step.required and stop_on_failure:
                        logger.error(
                            "Required step failed",
                            skill=skill_name,
                            step=step.name,
                        )
                        break

                step_index += 1

        finally:
            # Remove from executing set
            self._executing_skills.discard(skill.slug)

        duration_ms = int((time.time() - start_time) * 1000)
        required_steps = len([s for s in skill.steps if s.required])
        success = steps_completed >= required_steps

        # Build error message if any step failed
        error_message = None
        for result in results:
            if result.get("status") == "error":
                error_message = result.get("error")
                break
            elif result.get("status") == "failed":
                error_message = result.get("result", {}).get("error") or "Step failed"
                break

        execution_result = SkillExecutionResult(
            skill_name=skill_name,
            success=success,
            steps_completed=steps_completed,
            total_steps=len(skill.steps),
            results=results,
            error=error_message,
            duration_ms=duration_ms,
        )

        self._execution_history.append(execution_result)

        # Publish skill complete event
        if self._publisher:
            await self._publisher.publish_skill_complete(
                skill_name=skill.name,
                skill_slug=skill.slug,
                success=success,
                duration_ms=duration_ms,
            )

        # Persist execution to API for analytics (fire-and-forget, don't block)
        # Only record at top level (not for nested/chained skills to avoid duplicates)
        if len(self._executing_skills) == 0:  # Already cleared from set
            try:
                await self._loader.record_execution(
                    skill=skill,
                    success=success,
                    steps_completed=steps_completed,
                    total_steps=len(skill.steps),
                    duration_ms=duration_ms,
                    auth_token=self._auth_token,
                    session_id=self._session_id,
                    agent_id=self._agent_id,
                    error_message=error_message,
                    results_snapshot={"steps": results} if results else None,
                )
            except Exception as e:
                # Don't fail skill execution if recording fails
                logger.warning(
                    "Failed to record skill execution",
                    skill=skill_name,
                    error=str(e),
                )

        logger.info(
            "Skill execution completed",
            skill=skill_name,
            success=success,
            steps_completed=steps_completed,
            duration_ms=duration_ms,
        )

        return execution_result

    async def _execute_single_step(
        self,
        skill: Skill,
        step: SkillStep,
        context: dict[str, Any],
        step_index: int,
    ) -> dict[str, Any]:
        """Execute a single step (tool or chained skill).

        Args:
            skill: Parent skill
            step: Step to execute
            context: Execution context
            step_index: Current step index

        Returns:
            Step result dictionary
        """
        # Publish step start
        if self._publisher:
            await self._publisher.publish_skill_step(
                step_name=step.name,
                step_index=step_index,
                status="running",
            )

        # Resolve parameters
        params = self._resolve_parameters(step.parameters, context)

        logger.debug(
            "Executing step",
            skill=skill.name,
            step=step.name,
            tool=step.tool,
            chained_skill=step.skill,
        )

        try:
            # Handle skill chaining - execute another skill
            if step.skill:
                chained_result = await self.execute_skill(step.skill, context)

                # Update context with chained skill result
                context[f"{step.name}_result"] = chained_result.to_dict()

                step_result = {
                    "step": step.name,
                    "skill": step.skill,
                    "status": "success" if chained_result.success else "failed",
                    "result": chained_result.to_dict(),
                }

                # Publish step complete
                if self._publisher:
                    await self._publisher.publish_skill_step(
                        step_name=step.name,
                        step_index=step_index,
                        status="success" if chained_result.success else "failed",
                    )

                return step_result

            # Handle tool execution
            if step.tool and self._tool_executor:
                result = await self._tool_executor.execute(step.tool, params)

                # Parse result
                try:
                    result_data = json.loads(result) if isinstance(result, str) else result
                except json.JSONDecodeError:
                    result_data = {"output": result}

                success = result_data.get("success", True)

                # Update context with result
                context[f"{step.name}_result"] = result_data

                step_result = {
                    "step": step.name,
                    "tool": step.tool,
                    "status": "success" if success else "failed",
                    "result": result_data,
                }

                # Publish step complete
                if self._publisher:
                    await self._publisher.publish_skill_step(
                        step_name=step.name,
                        step_index=step_index,
                        status="success" if success else "failed",
                    )

                return step_result

            # No tool or skill specified
            return {
                "step": step.name,
                "status": "error",
                "error": "Step has no tool or skill specified",
            }

        except Exception as e:
            logger.error(
                "Step execution error",
                skill=skill.name,
                step=step.name,
                error=str(e),
            )

            # Publish step error
            if self._publisher:
                await self._publisher.publish_skill_step(
                    step_name=step.name,
                    step_index=step_index,
                    status="error",
                )

            return {
                "step": step.name,
                "tool": step.tool,
                "skill": step.skill,
                "status": "error",
                "error": str(e),
            }

    async def _execute_parallel_steps(
        self,
        skill: Skill,
        primary_step: SkillStep,
        step_map: dict[str, SkillStep],
        context: dict[str, Any],
        base_index: int,
    ) -> dict[str, Any]:
        """Execute multiple steps in parallel.

        Args:
            skill: Parent skill
            primary_step: Main step with parallel_with list
            step_map: Map of step names to steps
            context: Execution context
            base_index: Base step index for publishing

        Returns:
            Combined results from all parallel steps
        """
        # Gather all steps to execute in parallel
        parallel_steps = [primary_step]
        for step_name in primary_step.parallel_with or []:
            if step_name in step_map:
                parallel_steps.append(step_map[step_name])
            else:
                logger.warning(
                    "Parallel step not found",
                    skill=skill.name,
                    step=step_name,
                )

        logger.info(
            "Executing parallel steps",
            skill=skill.name,
            steps=[s.name for s in parallel_steps],
        )

        # Execute all steps concurrently
        tasks = [
            self._execute_single_step(skill, step, context.copy(), base_index + i)
            for i, step in enumerate(parallel_steps)
        ]

        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Process results
        step_results: list[dict[str, Any]] = []
        completed = 0
        all_success = True

        for i, result in enumerate(results):
            if isinstance(result, BaseException):
                step_results.append(
                    {
                        "step": parallel_steps[i].name,
                        "status": "error",
                        "error": str(result),
                    }
                )
                if parallel_steps[i].required:
                    all_success = False
            else:
                step_results.append(result)
                if result.get("status") == "success":
                    completed += 1
                elif parallel_steps[i].required:
                    all_success = False

        return {
            "success": all_success,
            "completed": completed,
            "results": step_results,
        }

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
        """Register a skill in memory from data (runtime-created).

        Note: This only adds to in-memory cache. To persist skills,
        use the API endpoints which save to the database.

        Args:
            skill_data: Skill definition

        Returns:
            Registered skill
        """
        return self._loader.add_skill_from_dict(skill_data)

    def remove_skill(self, slug: str) -> bool:
        """Remove a skill from in-memory cache.

        Note: This only removes from cache. To permanently delete,
        use the API endpoints which modify the database.

        Args:
            slug: Skill slug to remove

        Returns:
            True if removed
        """
        return self._loader.remove_skill(slug)

    @property
    def is_loaded(self) -> bool:
        """Check if skills have been loaded from API."""
        return self._loaded

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
