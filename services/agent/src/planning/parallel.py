"""Parallel plan generation for comparing multiple approaches."""

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from typing import Any

import structlog

logger = structlog.get_logger()


class PlanStatus(str, Enum):
    """Status of a generated plan."""

    PENDING = "pending"
    GENERATING = "generating"
    COMPLETED = "completed"
    FAILED = "failed"
    SELECTED = "selected"
    REJECTED = "rejected"


@dataclass
class PlanStep:
    """A single step in a plan."""

    index: int
    title: str
    description: str
    estimated_complexity: str  # "low", "medium", "high"
    files_affected: list[str] = field(default_factory=list)
    dependencies: list[int] = field(default_factory=list)  # Step indices this depends on


@dataclass
class GeneratedPlan:
    """A generated plan with steps and metadata."""

    id: str
    session_id: str
    agent_id: str
    task_description: str
    approach_name: str
    approach_summary: str
    steps: list[PlanStep]
    model_used: str
    status: PlanStatus = PlanStatus.PENDING
    total_estimated_complexity: str = "medium"
    pros: list[str] = field(default_factory=list)
    cons: list[str] = field(default_factory=list)
    raw_response: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    generation_time_ms: int = 0
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "session_id": self.session_id,
            "agent_id": self.agent_id,
            "task_description": self.task_description,
            "approach_name": self.approach_name,
            "approach_summary": self.approach_summary,
            "steps": [
                {
                    "index": s.index,
                    "title": s.title,
                    "description": s.description,
                    "estimated_complexity": s.estimated_complexity,
                    "files_affected": s.files_affected,
                    "dependencies": s.dependencies,
                }
                for s in self.steps
            ],
            "model_used": self.model_used,
            "status": self.status.value,
            "total_estimated_complexity": self.total_estimated_complexity,
            "pros": self.pros,
            "cons": self.cons,
            "created_at": self.created_at.isoformat(),
            "generation_time_ms": self.generation_time_ms,
            "error": self.error,
        }


class ParallelPlanGenerator:
    """
    Generates multiple competing plans for a task in parallel.

    Features:
    - Generate up to 5 parallel plans with different approaches
    - Use configurable models for each plan
    - Track generation progress and timing
    - Parse and structure plan steps
    """

    MAX_PARALLEL_PLANS = 5

    def __init__(self, llm_client: Any = None):
        self._llm_client = llm_client
        # Store plans by session
        self._plans: dict[str, list[GeneratedPlan]] = {}
        # Active generation tasks
        self._generation_tasks: dict[str, asyncio.Task[None]] = {}

    async def generate_parallel_plans(
        self,
        session_id: str,
        agent_id: str,
        task_description: str,
        num_plans: int = 3,
        models: list[str] | None = None,
        context: str | None = None,
    ) -> list[GeneratedPlan]:
        """
        Generate multiple plans for a task in parallel.

        Args:
            session_id: The session ID
            agent_id: The agent ID
            task_description: Description of the task to plan
            num_plans: Number of plans to generate (max 5)
            models: Optional list of models to use (cycles through if fewer than num_plans)
            context: Optional additional context about the codebase

        Returns:
            List of generated plans (may include failures)
        """
        num_plans = min(num_plans, self.MAX_PARALLEL_PLANS)
        if not models:
            raise ValueError(
                "models are required for parallel planning. "
                "Pass explicit planning models derived from DB/role defaults."
            )

        logger.info(
            "generating_parallel_plans",
            session_id=session_id,
            num_plans=num_plans,
            models=models[:num_plans],
        )

        # Create plan placeholders
        plans: list[GeneratedPlan] = []
        for i in range(num_plans):
            plan = GeneratedPlan(
                id=str(uuid.uuid4()),
                session_id=session_id,
                agent_id=agent_id,
                task_description=task_description,
                approach_name=f"Approach {i + 1}",
                approach_summary="",
                steps=[],
                model_used=models[i % len(models)],
                status=PlanStatus.GENERATING,
            )
            plans.append(plan)

        # Store plans
        if session_id not in self._plans:
            self._plans[session_id] = []
        self._plans[session_id].extend(plans)

        # Generate plans in parallel
        tasks = [
            self._generate_single_plan(plan, task_description, i, context)
            for i, plan in enumerate(plans)
        ]

        await asyncio.gather(*tasks, return_exceptions=True)

        logger.info(
            "parallel_plans_generated",
            session_id=session_id,
            completed=sum(1 for p in plans if p.status == PlanStatus.COMPLETED),
            failed=sum(1 for p in plans if p.status == PlanStatus.FAILED),
        )

        return plans

    async def _generate_single_plan(
        self,
        plan: GeneratedPlan,
        task_description: str,
        approach_index: int,
        context: str | None = None,
    ) -> None:
        """Generate a single plan."""
        import time

        start_time = time.time()

        approach_prompts = [
            "Focus on a straightforward, minimal-change approach",
            "Focus on a comprehensive, well-structured approach with clear separation of concerns",
            "Focus on a performance-optimized approach",
            "Focus on a maintainability-focused approach with extensive documentation",
            "Focus on a modern best-practices approach using the latest patterns",
        ]

        prompt = f"""You are a senior software architect planning an implementation.

Task: {task_description}

{f"Context: {context}" if context else ""}

{approach_prompts[approach_index % len(approach_prompts)]}

Generate a detailed implementation plan with the following structure:

## Approach Name
Give this approach a short, descriptive name (3-5 words)

## Summary
One paragraph summary of this approach

## Pros
- List 2-4 advantages of this approach

## Cons
- List 2-4 disadvantages or trade-offs

## Steps
For each step, provide:
1. **Step Title**: Short title
   - Description: What this step accomplishes
   - Complexity: low/medium/high
   - Files: List of files that will be affected
   - Dependencies: Which earlier steps this depends on (by number)

Plan should have 3-10 steps depending on task complexity.
"""

        try:
            if self._llm_client:
                # Real LLM call
                response = await self._llm_client.generate(
                    model=plan.model_used,
                    prompt=prompt,
                    max_tokens=2000,
                )
                plan.raw_response = response
                self._parse_plan_response(plan, response)
            else:
                # Mock response for development
                await asyncio.sleep(0.5)  # Simulate API latency
                approaches = ["Minimal", "Comprehensive", "Optimized", "Maintainable", "Modern"]
                approach = approaches[approach_index % 5]
                plan.approach_name = f"Approach {approach_index + 1}: {approach}"
                focuses = [
                    "minimal changes",
                    "comprehensive refactoring",
                    "performance optimization",
                    "clean architecture",
                    "modern patterns",
                ]
                focus = focuses[approach_index % 5]
                plan.approach_summary = f"This approach focuses on {focus}."
                plan.pros = ["Clear implementation path", "Low risk", "Easy to review"]
                plan.cons = ["May need future refactoring", "Limited extensibility"]
                plan.steps = [
                    PlanStep(
                        index=0,
                        title="Analyze existing code",
                        description="Review the current implementation and identify change points",
                        estimated_complexity="low",
                        files_affected=["src/main.py"],
                    ),
                    PlanStep(
                        index=1,
                        title="Implement core changes",
                        description="Make the primary modifications to achieve the task",
                        estimated_complexity="medium",
                        files_affected=["src/core.py", "src/utils.py"],
                        dependencies=[0],
                    ),
                    PlanStep(
                        index=2,
                        title="Add tests",
                        description="Write unit tests for the new functionality",
                        estimated_complexity="low",
                        files_affected=["tests/test_core.py"],
                        dependencies=[1],
                    ),
                ]

            plan.status = PlanStatus.COMPLETED
            plan.generation_time_ms = int((time.time() - start_time) * 1000)

        except Exception as e:
            plan.status = PlanStatus.FAILED
            plan.error = str(e)
            plan.generation_time_ms = int((time.time() - start_time) * 1000)
            logger.error("plan_generation_failed", plan_id=plan.id, error=str(e))

    def _parse_plan_response(self, plan: GeneratedPlan, response: str) -> None:
        """Parse LLM response into structured plan."""
        import re

        lines = response.split("\n")
        current_section = None
        current_step = None
        step_index = 0

        for line in lines:
            line = line.strip()

            # Section headers
            if line.startswith("## Approach Name"):
                current_section = "name"
                continue
            elif line.startswith("## Summary"):
                current_section = "summary"
                continue
            elif line.startswith("## Pros"):
                current_section = "pros"
                continue
            elif line.startswith("## Cons"):
                current_section = "cons"
                continue
            elif line.startswith("## Steps"):
                current_section = "steps"
                continue

            # Parse content based on section
            if current_section == "name" and line:
                plan.approach_name = line
            elif current_section == "summary" and line:
                plan.approach_summary += line + " "
            elif current_section == "pros" and line.startswith("-"):
                plan.pros.append(line[1:].strip())
            elif current_section == "cons" and line.startswith("-"):
                plan.cons.append(line[1:].strip())
            elif current_section == "steps":
                # Parse step headers (numbered or bold)
                step_match = re.match(r"^(\d+)\.\s*\*\*(.+?)\*\*", line)
                if step_match:
                    if current_step:
                        plan.steps.append(current_step)
                    current_step = PlanStep(
                        index=step_index,
                        title=step_match.group(2),
                        description="",
                        estimated_complexity="medium",
                    )
                    step_index += 1
                elif current_step:
                    # Parse step details
                    if line.startswith("- Description:"):
                        current_step.description = line.split(":", 1)[1].strip()
                    elif line.startswith("- Complexity:"):
                        complexity = line.split(":", 1)[1].strip().lower()
                        if complexity in ["low", "medium", "high"]:
                            current_step.estimated_complexity = complexity
                    elif line.startswith("- Files:"):
                        files = line.split(":", 1)[1].strip()
                        current_step.files_affected = [f.strip() for f in files.split(",")]
                    elif line.startswith("- Dependencies:"):
                        deps = line.split(":", 1)[1].strip()
                        current_step.dependencies = [
                            int(d.strip()) - 1 for d in deps.split(",") if d.strip().isdigit()
                        ]

        # Add last step
        if current_step:
            plan.steps.append(current_step)

        # Clean up
        plan.approach_summary = plan.approach_summary.strip()

    def get_session_plans(self, session_id: str) -> list[GeneratedPlan]:
        """Get all plans for a session."""
        return self._plans.get(session_id, [])

    def get_plan(self, plan_id: str) -> GeneratedPlan | None:
        """Get a specific plan by ID."""
        for plans in self._plans.values():
            for plan in plans:
                if plan.id == plan_id:
                    return plan
        return None

    def select_plan(self, plan_id: str) -> bool:
        """Mark a plan as selected and reject others in the same session."""
        plan = self.get_plan(plan_id)
        if not plan:
            return False

        session_plans = self._plans.get(plan.session_id, [])
        for p in session_plans:
            if p.id == plan_id:
                p.status = PlanStatus.SELECTED
            elif p.status == PlanStatus.COMPLETED:
                p.status = PlanStatus.REJECTED

        logger.info("plan_selected", plan_id=plan_id, session_id=plan.session_id)
        return True

    def clear_session_plans(self, session_id: str) -> int:
        """Clear all plans for a session."""
        plans = self._plans.pop(session_id, [])
        return len(plans)


# Global instance
_generator: ParallelPlanGenerator | None = None


def get_parallel_plan_generator() -> ParallelPlanGenerator:
    """Get or create the global parallel plan generator."""
    global _generator
    if _generator is None:
        _generator = ParallelPlanGenerator()
    return _generator
