"""Planner for generating and managing execution plans."""

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from typing import TYPE_CHECKING, Any
from uuid import uuid4

import structlog

from podex_shared.redis_client import RedisClient
from src.providers.llm import CompletionRequest

if TYPE_CHECKING:
    from src.providers.llm import LLMProvider

logger = structlog.get_logger()


class PlanStatus(str, Enum):
    """Plan execution status."""

    DRAFT = "draft"  # Being created
    PENDING_APPROVAL = "pending_approval"  # Waiting for user approval
    APPROVED = "approved"  # Approved, ready to execute
    EXECUTING = "executing"  # Currently executing
    PAUSED = "paused"  # Paused by user
    COMPLETED = "completed"  # Successfully completed
    FAILED = "failed"  # Failed during execution
    REJECTED = "rejected"  # Rejected by user
    CANCELLED = "cancelled"  # Cancelled


class StepStatus(str, Enum):
    """Individual step status."""

    PENDING = "pending"
    EXECUTING = "executing"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"
    ROLLED_BACK = "rolled_back"


@dataclass
class PlanStep:
    """A single step in an execution plan."""

    id: str
    order: int
    action_type: str  # file_write, command_run, git_commit, etc.
    description: str
    action_params: dict[str, Any]
    status: StepStatus = StepStatus.PENDING
    result: dict[str, Any] | None = None
    error: str | None = None
    can_rollback: bool = False
    rollback_action: dict[str, Any] | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    confidence: float = 0.8  # 0-1 confidence in this step

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "order": self.order,
            "action_type": self.action_type,
            "description": self.description,
            "action_params": self.action_params,
            "status": self.status.value,
            "result": self.result,
            "error": self.error,
            "can_rollback": self.can_rollback,
            "rollback_action": self.rollback_action,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "confidence": self.confidence,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PlanStep":
        """Create from dictionary."""
        return cls(
            id=data["id"],
            order=data["order"],
            action_type=data["action_type"],
            description=data["description"],
            action_params=data.get("action_params", {}),
            status=StepStatus(data.get("status", "pending")),
            result=data.get("result"),
            error=data.get("error"),
            can_rollback=data.get("can_rollback", False),
            rollback_action=data.get("rollback_action"),
            started_at=datetime.fromisoformat(data["started_at"])
            if data.get("started_at")
            else None,
            completed_at=datetime.fromisoformat(data["completed_at"])
            if data.get("completed_at")
            else None,
            confidence=data.get("confidence", 0.8),
        )


@dataclass
class ExecutionPlan:
    """An execution plan with multiple steps."""

    id: str
    session_id: str
    agent_id: str
    title: str
    description: str
    steps: list[PlanStep]
    status: PlanStatus = PlanStatus.DRAFT
    confidence_score: float = 0.0  # Overall confidence
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    approved_at: datetime | None = None
    approved_by: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    current_step: int = 0
    error: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "session_id": self.session_id,
            "agent_id": self.agent_id,
            "title": self.title,
            "description": self.description,
            "steps": [s.to_dict() for s in self.steps],
            "status": self.status.value,
            "confidence_score": self.confidence_score,
            "created_at": self.created_at.isoformat(),
            "approved_at": self.approved_at.isoformat() if self.approved_at else None,
            "approved_by": self.approved_by,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "current_step": self.current_step,
            "error": self.error,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ExecutionPlan":
        """Create from dictionary."""
        return cls(
            id=data["id"],
            session_id=data["session_id"],
            agent_id=data["agent_id"],
            title=data["title"],
            description=data["description"],
            steps=[PlanStep.from_dict(s) for s in data.get("steps", [])],
            status=PlanStatus(data.get("status", "draft")),
            confidence_score=data.get("confidence_score", 0.0),
            created_at=datetime.fromisoformat(data["created_at"])
            if data.get("created_at")
            else datetime.now(UTC),
            approved_at=datetime.fromisoformat(data["approved_at"])
            if data.get("approved_at")
            else None,
            approved_by=data.get("approved_by"),
            started_at=datetime.fromisoformat(data["started_at"])
            if data.get("started_at")
            else None,
            completed_at=datetime.fromisoformat(data["completed_at"])
            if data.get("completed_at")
            else None,
            current_step=data.get("current_step", 0),
            error=data.get("error"),
            metadata=data.get("metadata", {}),
        )

    def get_progress(self) -> dict[str, Any]:
        """Get plan execution progress."""
        total = len(self.steps)
        completed = sum(1 for s in self.steps if s.status == StepStatus.COMPLETED)
        failed = sum(1 for s in self.steps if s.status == StepStatus.FAILED)

        return {
            "total_steps": total,
            "completed_steps": completed,
            "failed_steps": failed,
            "current_step": self.current_step,
            "percentage": (completed / total * 100) if total > 0 else 0,
        }


# Prompt for generating plans
PLAN_GENERATION_PROMPT = """You are a planning assistant. Generate a detailed
execution plan for the following task.

Task: {task_description}

Context: {context}

Generate a plan with the following JSON structure:
{{
    "title": "Brief title for the plan",
    "description": "Detailed description of what the plan will accomplish",
    "steps": [
        {{
            "action_type": "file_write|file_read|command_run|git_commit|...",
            "description": "What this step does",
            "action_params": {{}},
            "confidence": 0.0-1.0,
            "can_rollback": true/false,
            "rollback_action": {{}} // if can_rollback is true
        }}
    ],
    "confidence_score": 0.0-1.0
}}

Guidelines:
- Break down complex tasks into atomic steps
- Each step should be independently executable
- Include rollback actions for destructive operations
- Be specific about file paths and command arguments
- Set realistic confidence scores

Respond with only valid JSON."""


class Planner:
    """Generates and manages execution plans.

    Plans are stored in Redis and can be:
    - Generated from task descriptions using LLM
    - Approved/rejected by users
    - Executed step by step with progress tracking
    - Rolled back on failure
    """

    PLAN_KEY = "podex:plan:{plan_id}"
    SESSION_PLANS_KEY = "podex:plans:session:{session_id}"
    PLAN_TTL = 86400 * 7  # 7 days

    def __init__(
        self,
        redis_client: RedisClient,
        llm_provider: "LLMProvider",
    ) -> None:
        """Initialize planner.

        Args:
            redis_client: Redis client instance
            llm_provider: LLM provider for plan generation
        """
        self._redis = redis_client
        self._llm = llm_provider

    async def create_plan(
        self,
        session_id: str,
        agent_id: str,
        task_description: str,
        context: str = "",
    ) -> ExecutionPlan:
        """Generate an execution plan for a task.

        Args:
            session_id: Session ID
            agent_id: Agent ID creating the plan
            task_description: Description of the task
            context: Additional context

        Returns:
            Generated ExecutionPlan
        """
        # Generate plan using LLM
        prompt = PLAN_GENERATION_PROMPT.format(
            task_description=task_description,
            context=context or "No additional context provided.",
        )

        request = CompletionRequest(
            model="claude-sonnet-4-20250514",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=4096,
            temperature=0.3,
        )
        response = await self._llm.complete(request)

        content = response.get("content", "")

        # Parse JSON response
        try:
            # Extract JSON from response (handle markdown code blocks)
            json_str = content
            if "```json" in content:
                json_str = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                json_str = content.split("```")[1].split("```")[0]

            plan_data = json.loads(json_str.strip())
        except (json.JSONDecodeError, IndexError) as e:
            logger.error("Failed to parse plan JSON", error=str(e), content=content[:500])
            # Create a simple fallback plan
            plan_data = {
                "title": "Task Execution",
                "description": task_description,
                "steps": [],
                "confidence_score": 0.5,
            }

        # Create plan object
        plan_id = str(uuid4())
        steps = []

        for i, step_data in enumerate(plan_data.get("steps", [])):
            step = PlanStep(
                id=str(uuid4()),
                order=i,
                action_type=step_data.get("action_type", "unknown"),
                description=step_data.get("description", ""),
                action_params=step_data.get("action_params", {}),
                confidence=step_data.get("confidence", 0.8),
                can_rollback=step_data.get("can_rollback", False),
                rollback_action=step_data.get("rollback_action"),
            )
            steps.append(step)

        plan = ExecutionPlan(
            id=plan_id,
            session_id=session_id,
            agent_id=agent_id,
            title=plan_data.get("title", "Task Execution"),
            description=plan_data.get("description", task_description),
            steps=steps,
            status=PlanStatus.PENDING_APPROVAL,
            confidence_score=plan_data.get("confidence_score", 0.7),
        )

        # Store plan
        await self._save_plan(plan)

        # Add to session index
        session_key = self.SESSION_PLANS_KEY.format(session_id=session_id)
        await self._redis.client.lpush(session_key, plan_id)
        await self._redis.client.ltrim(session_key, 0, 99)  # Keep last 100

        logger.info(
            "Plan created",
            plan_id=plan_id,
            session_id=session_id,
            steps=len(steps),
            confidence=plan.confidence_score,
        )

        return plan

    async def get_plan(self, plan_id: str) -> ExecutionPlan | None:
        """Get a plan by ID.

        Args:
            plan_id: Plan ID

        Returns:
            ExecutionPlan if found
        """
        plan_key = self.PLAN_KEY.format(plan_id=plan_id)
        data = await self._redis.get_json(plan_key)

        if data and isinstance(data, dict):
            return ExecutionPlan.from_dict(data)
        return None

    async def approve_plan(
        self,
        plan_id: str,
        approved_by: str,
    ) -> ExecutionPlan | None:
        """Approve a plan for execution.

        Args:
            plan_id: Plan ID to approve
            approved_by: User ID approving

        Returns:
            Updated plan
        """
        plan = await self.get_plan(plan_id)
        if not plan:
            return None

        if plan.status != PlanStatus.PENDING_APPROVAL:
            logger.warning("Plan not pending approval", plan_id=plan_id, status=plan.status.value)
            return plan

        plan.status = PlanStatus.APPROVED
        plan.approved_at = datetime.now(UTC)
        plan.approved_by = approved_by

        await self._save_plan(plan)

        logger.info("Plan approved", plan_id=plan_id, approved_by=approved_by)
        return plan

    async def reject_plan(
        self,
        plan_id: str,
        reason: str = "",
    ) -> ExecutionPlan | None:
        """Reject a plan.

        Args:
            plan_id: Plan ID to reject
            reason: Rejection reason

        Returns:
            Updated plan
        """
        plan = await self.get_plan(plan_id)
        if not plan:
            return None

        plan.status = PlanStatus.REJECTED
        plan.error = reason
        plan.completed_at = datetime.now(UTC)

        await self._save_plan(plan)

        logger.info("Plan rejected", plan_id=plan_id, reason=reason)
        return plan

    async def update_step_status(
        self,
        plan_id: str,
        step_id: str,
        status: StepStatus,
        result: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> ExecutionPlan | None:
        """Update a step's status.

        Uses distributed locking to prevent race conditions when multiple
        concurrent calls update different steps.

        Args:
            plan_id: Plan ID
            step_id: Step ID to update
            status: New status
            result: Optional result data
            error: Optional error message

        Returns:
            Updated plan
        """
        # Use distributed lock to prevent race conditions
        async with self._redis.lock(f"plan:{plan_id}", timeout=10):
            plan = await self.get_plan(plan_id)
            if not plan:
                return None

            for step in plan.steps:
                if step.id == step_id:
                    step.status = status
                    step.result = result
                    step.error = error

                    if status == StepStatus.EXECUTING:
                        step.started_at = datetime.now(UTC)
                    elif status in (StepStatus.COMPLETED, StepStatus.FAILED, StepStatus.SKIPPED):
                        step.completed_at = datetime.now(UTC)

                    break

            # Update plan status if needed
            all_completed = all(s.status == StepStatus.COMPLETED for s in plan.steps)
            any_failed = any(s.status == StepStatus.FAILED for s in plan.steps)

            if all_completed:
                plan.status = PlanStatus.COMPLETED
                plan.completed_at = datetime.now(UTC)
            elif any_failed:
                plan.status = PlanStatus.FAILED
                plan.error = error

            await self._save_plan(plan)
            return plan

    async def get_session_plans(
        self,
        session_id: str,
        limit: int = 20,
    ) -> list[ExecutionPlan]:
        """Get plans for a session.

        Args:
            session_id: Session ID
            limit: Max plans to return

        Returns:
            List of plans
        """
        session_key = self.SESSION_PLANS_KEY.format(session_id=session_id)
        plan_ids = await self._redis.client.lrange(session_key, 0, limit - 1)

        plans = []
        for plan_id in plan_ids:
            plan = await self.get_plan(plan_id)
            if plan:
                plans.append(plan)

        return plans

    async def _save_plan(self, plan: ExecutionPlan) -> None:
        """Save a plan to Redis.

        Args:
            plan: Plan to save
        """
        plan_key = self.PLAN_KEY.format(plan_id=plan.id)
        await self._redis.set_json(plan_key, plan.to_dict(), ex=self.PLAN_TTL)
