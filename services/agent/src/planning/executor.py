"""Executor for running execution plans step by step."""

import json
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, cast

import structlog

from src.planning.planner import (
    ExecutionPlan,
    Planner,
    PlanStatus,
    PlanStep,
    StepStatus,
)
from src.tools.executor import ToolExecutor

logger = structlog.get_logger()


@dataclass
class PlanExecutorCallbacks:
    """Callbacks for plan executor events."""

    on_step_start: Callable[[ExecutionPlan, PlanStep], Coroutine[Any, Any, None]] | None = None
    on_step_complete: Callable[[ExecutionPlan, PlanStep], Coroutine[Any, Any, None]] | None = None
    on_step_error: Callable[[ExecutionPlan, PlanStep, str], Coroutine[Any, Any, None]] | None = None
    on_plan_complete: Callable[[ExecutionPlan], Coroutine[Any, Any, None]] | None = None


class PlanExecutor:
    """Executes plans step by step with progress tracking.

    Features:
    - Step-by-step execution with status updates
    - Pause/resume support
    - Rollback on failure
    - Progress callbacks for real-time updates
    """

    def __init__(
        self,
        planner: Planner,
        tool_executor: ToolExecutor,
        callbacks: PlanExecutorCallbacks | None = None,
    ) -> None:
        """Initialize executor.

        Args:
            planner: Planner instance for updating plans
            tool_executor: Tool executor for running actions
            callbacks: Optional callbacks for plan events
        """
        self._planner = planner
        self._tool_executor = tool_executor
        callbacks = callbacks or PlanExecutorCallbacks()
        self._on_step_start = callbacks.on_step_start
        self._on_step_complete = callbacks.on_step_complete
        self._on_step_error = callbacks.on_step_error
        self._on_plan_complete = callbacks.on_plan_complete
        self._paused_plans: set[str] = set()

    async def execute_plan(
        self,
        plan_id: str,
        stop_on_error: bool = True,
    ) -> ExecutionPlan | None:
        """Execute all steps in a plan.

        Args:
            plan_id: Plan ID to execute
            stop_on_error: Stop execution on first error

        Returns:
            Final plan state
        """
        plan = await self._planner.get_plan(plan_id)
        if not plan:
            logger.error("Plan not found", plan_id=plan_id)
            return None

        if plan.status not in (PlanStatus.APPROVED, PlanStatus.PAUSED):
            logger.warning(
                "Plan not ready for execution",
                plan_id=plan_id,
                status=plan.status.value,
            )
            return plan

        # Mark as executing
        plan.status = PlanStatus.EXECUTING
        plan.started_at = plan.started_at or datetime.now(UTC)
        await self._planner._save_plan(plan)

        logger.info(
            "Starting plan execution",
            plan_id=plan_id,
            total_steps=len(plan.steps),
        )

        # Execute steps starting from current step
        for i, step in enumerate(plan.steps[plan.current_step :], start=plan.current_step):
            # Check if paused
            if plan_id in self._paused_plans:
                plan.status = PlanStatus.PAUSED
                plan.current_step = i
                await self._planner._save_plan(plan)
                logger.info("Plan paused", plan_id=plan_id, at_step=i)
                return plan

            # Skip completed steps
            if step.status == StepStatus.COMPLETED:
                continue

            # Execute step
            success = await self._execute_step(plan, step)

            if not success and stop_on_error:
                plan.status = PlanStatus.FAILED
                plan.error = step.error
                await self._planner._save_plan(plan)
                return plan

            plan.current_step = i + 1

        # All steps completed
        plan.status = PlanStatus.COMPLETED
        plan.completed_at = datetime.now(UTC)
        await self._planner._save_plan(plan)

        if self._on_plan_complete:
            await self._on_plan_complete(plan)

        logger.info(
            "Plan execution completed",
            plan_id=plan_id,
            status=plan.status.value,
        )

        return plan

    async def _execute_step(
        self,
        plan: ExecutionPlan,
        step: PlanStep,
    ) -> bool:
        """Execute a single step.

        Args:
            plan: Parent plan
            step: Step to execute

        Returns:
            True if successful
        """
        # Update status to executing
        step.status = StepStatus.EXECUTING
        step.started_at = datetime.now(UTC)
        await self._planner._save_plan(plan)

        if self._on_step_start:
            await self._on_step_start(plan, step)

        logger.info(
            "Executing step",
            plan_id=plan.id,
            step_id=step.id,
            action_type=step.action_type,
        )

        try:
            # Map action type to tool
            result = await self._execute_action(step.action_type, step.action_params)

            # Parse result
            if isinstance(result, str):
                try:
                    result = json.loads(result)
                except json.JSONDecodeError:
                    result = {"output": result}

            success: bool = result.get("success", True)

            if success:
                step.status = StepStatus.COMPLETED
                step.result = result
                step.completed_at = datetime.now(UTC)

                if self._on_step_complete:
                    await self._on_step_complete(plan, step)

                logger.info(
                    "Step completed",
                    plan_id=plan.id,
                    step_id=step.id,
                )
            else:
                error = result.get("error", "Unknown error")
                step.status = StepStatus.FAILED
                step.error = error
                step.completed_at = datetime.now(UTC)

                if self._on_step_error:
                    await self._on_step_error(plan, step, error)

                logger.error(
                    "Step failed",
                    plan_id=plan.id,
                    step_id=step.id,
                    error=error,
                )

            await self._planner._save_plan(plan)
            return success

        except Exception as e:
            step.status = StepStatus.FAILED
            step.error = str(e)
            step.completed_at = datetime.now(UTC)

            if self._on_step_error:
                await self._on_step_error(plan, step, str(e))

            await self._planner._save_plan(plan)

            logger.exception(
                "Step execution error",
                plan_id=plan.id,
                step_id=step.id,
            )
            return False

    async def _execute_action(
        self,
        action_type: str,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        """Execute an action using the tool executor.

        Args:
            action_type: Type of action
            params: Action parameters

        Returns:
            Execution result
        """
        # Map action types to tool names
        action_tool_map = {
            "file_write": "write_file",
            "file_read": "read_file",
            "command_run": "run_command",
            "search_code": "search_code",
            "list_directory": "list_directory",
            "git_status": "git_status",
            "git_commit": "git_commit",
            "git_push": "git_push",
            "git_branch": "git_branch",
        }

        tool_name = action_tool_map.get(action_type, action_type)
        result = await self._tool_executor.execute(tool_name, params)

        try:
            return cast("dict[str, Any]", json.loads(result))
        except json.JSONDecodeError:
            return {"success": True, "output": result}

    def pause_plan(self, plan_id: str) -> None:
        """Mark a plan for pausing.

        Args:
            plan_id: Plan ID to pause
        """
        self._paused_plans.add(plan_id)
        logger.info("Plan marked for pause", plan_id=plan_id)

    def resume_plan(self, plan_id: str) -> None:
        """Remove pause flag from a plan.

        Args:
            plan_id: Plan ID to resume
        """
        self._paused_plans.discard(plan_id)
        logger.info("Plan pause flag removed", plan_id=plan_id)

    async def rollback_step(
        self,
        plan: ExecutionPlan,
        step: PlanStep,
    ) -> bool:
        """Rollback a completed step.

        Args:
            plan: Parent plan
            step: Step to rollback

        Returns:
            True if rollback successful
        """
        if not step.can_rollback or not step.rollback_action:
            logger.warning(
                "Step cannot be rolled back",
                plan_id=plan.id,
                step_id=step.id,
            )
            return False

        if step.status != StepStatus.COMPLETED:
            logger.warning(
                "Only completed steps can be rolled back",
                plan_id=plan.id,
                step_id=step.id,
                status=step.status.value,
            )
            return False

        logger.info(
            "Rolling back step",
            plan_id=plan.id,
            step_id=step.id,
        )

        try:
            rollback = step.rollback_action
            result = await self._execute_action(
                rollback.get("action_type", "unknown"),
                rollback.get("params", {}),
            )

            success: bool = result.get("success", True)

            if success:
                step.status = StepStatus.ROLLED_BACK
                await self._planner._save_plan(plan)
                logger.info("Step rolled back", plan_id=plan.id, step_id=step.id)
            else:
                logger.error(
                    "Rollback failed",
                    plan_id=plan.id,
                    step_id=step.id,
                    error=result.get("error"),
                )

            return success

        except Exception:
            logger.exception("Rollback error", plan_id=plan.id, step_id=step.id)
            return False

    async def rollback_plan(self, plan_id: str) -> ExecutionPlan | None:
        """Rollback all completed steps in reverse order.

        Args:
            plan_id: Plan ID to rollback

        Returns:
            Updated plan
        """
        plan = await self._planner.get_plan(plan_id)
        if not plan:
            return None

        logger.info("Rolling back plan", plan_id=plan_id)

        # Rollback in reverse order
        for step in reversed(plan.steps):
            if step.status == StepStatus.COMPLETED and step.can_rollback:
                await self.rollback_step(plan, step)

        plan.status = PlanStatus.CANCELLED
        plan.completed_at = datetime.now(UTC)
        await self._planner._save_plan(plan)

        return plan
