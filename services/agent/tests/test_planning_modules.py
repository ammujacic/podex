"""Tests for planning modules.

Tests cover:
- PlanStatus and StepStatus enums
- PlanStep dataclass
- ExecutionPlan dataclass
- Planner class
"""

from datetime import datetime, UTC
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestPlanningEnums:
    """Test planning enums."""

    def test_plan_status_enum_exists(self):
        """Test PlanStatus enum exists."""
        from src.planning.planner import PlanStatus
        assert PlanStatus is not None

    def test_plan_status_values(self):
        """Test PlanStatus enum values."""
        from src.planning.planner import PlanStatus

        assert PlanStatus.DRAFT.value == "draft"
        assert PlanStatus.PENDING_APPROVAL.value == "pending_approval"
        assert PlanStatus.APPROVED.value == "approved"
        assert PlanStatus.EXECUTING.value == "executing"
        assert PlanStatus.PAUSED.value == "paused"
        assert PlanStatus.COMPLETED.value == "completed"
        assert PlanStatus.FAILED.value == "failed"
        assert PlanStatus.REJECTED.value == "rejected"
        assert PlanStatus.CANCELLED.value == "cancelled"

    def test_step_status_enum_exists(self):
        """Test StepStatus enum exists."""
        from src.planning.planner import StepStatus
        assert StepStatus is not None

    def test_step_status_values(self):
        """Test StepStatus enum values."""
        from src.planning.planner import StepStatus

        assert StepStatus.PENDING.value == "pending"
        assert StepStatus.EXECUTING.value == "executing"
        assert StepStatus.COMPLETED.value == "completed"
        assert StepStatus.FAILED.value == "failed"
        assert StepStatus.SKIPPED.value == "skipped"
        assert StepStatus.ROLLED_BACK.value == "rolled_back"


class TestPlanStep:
    """Test PlanStep dataclass."""

    def test_plan_step_creation(self):
        """Test creating a PlanStep."""
        from src.planning.planner import PlanStep, StepStatus

        step = PlanStep(
            id="step-123",
            order=1,
            action_type="file_write",
            description="Write a file",
            action_params={"path": "/tmp/test.txt", "content": "Hello"},
        )

        assert step.id == "step-123"
        assert step.order == 1
        assert step.action_type == "file_write"
        assert step.description == "Write a file"
        assert step.status == StepStatus.PENDING
        assert step.confidence == 0.8

    def test_plan_step_to_dict(self):
        """Test PlanStep to_dict method."""
        from src.planning.planner import PlanStep, StepStatus

        step = PlanStep(
            id="step-123",
            order=1,
            action_type="command_run",
            description="Run command",
            action_params={"command": "ls -la"},
            can_rollback=True,
        )

        data = step.to_dict()

        assert data["id"] == "step-123"
        assert data["order"] == 1
        assert data["action_type"] == "command_run"
        assert data["status"] == "pending"
        assert data["can_rollback"] is True

    def test_plan_step_from_dict(self):
        """Test PlanStep from_dict method."""
        from src.planning.planner import PlanStep, StepStatus

        data = {
            "id": "step-456",
            "order": 2,
            "action_type": "git_commit",
            "description": "Commit changes",
            "action_params": {"message": "feat: add new feature"},
            "status": "completed",
            "confidence": 0.95,
        }

        step = PlanStep.from_dict(data)

        assert step.id == "step-456"
        assert step.order == 2
        assert step.action_type == "git_commit"
        assert step.status == StepStatus.COMPLETED
        assert step.confidence == 0.95

    def test_plan_step_from_dict_with_timestamps(self):
        """Test PlanStep from_dict with timestamps."""
        from src.planning.planner import PlanStep

        data = {
            "id": "step-789",
            "order": 3,
            "action_type": "test",
            "description": "Test",
            "action_params": {},
            "started_at": "2024-01-01T00:00:00+00:00",
            "completed_at": "2024-01-01T00:01:00+00:00",
        }

        step = PlanStep.from_dict(data)

        assert step.started_at is not None
        assert step.completed_at is not None


class TestPlannerModule:
    """Test Planner module imports."""

    def test_planner_module_exists(self):
        """Test planner module can be imported."""
        from src.planning import planner
        assert planner is not None

    def test_planner_class_exists(self):
        """Test Planner class exists."""
        from src.planning.planner import Planner
        assert Planner is not None


class TestPlannerInit:
    """Test Planner initialization."""

    def test_planner_initialization(self):
        """Test Planner initialization."""
        from src.planning.planner import Planner

        mock_redis = MagicMock()
        mock_llm = MagicMock()

        planner = Planner(redis_client=mock_redis, llm_provider=mock_llm)

        assert planner._redis == mock_redis
        assert planner._llm == mock_llm


class TestPlanningBackground:
    """Test planning background module."""

    def test_background_module_exists(self):
        """Test background module can be imported."""
        from src.planning import background
        assert background is not None


class TestPlanningComparator:
    """Test planning comparator module."""

    def test_comparator_module_exists(self):
        """Test comparator module can be imported."""
        from src.planning import comparator
        assert comparator is not None


class TestPlanningExecutor:
    """Test planning executor module."""

    def test_executor_module_exists(self):
        """Test executor module can be imported."""
        from src.planning import executor
        assert executor is not None


class TestPlanningParallel:
    """Test planning parallel module."""

    def test_parallel_module_exists(self):
        """Test parallel module can be imported."""
        from src.planning import parallel
        assert parallel is not None


class TestSkillsRegistry:
    """Test skills registry module."""

    def test_registry_module_exists(self):
        """Test registry module can be imported."""
        from src.skills import registry
        assert registry is not None

    def test_skill_match_dataclass(self):
        """Test SkillMatch dataclass."""
        from src.skills.registry import SkillMatch
        from src.skills.loader import Skill

        mock_skill = MagicMock(spec=Skill)
        match = SkillMatch(
            skill=mock_skill,
            score=0.95,
            matched_triggers=["build", "compile"],
            matched_tags=["dev"],
        )

        assert match.score == 0.95
        assert "build" in match.matched_triggers
        assert "dev" in match.matched_tags

    def test_skill_execution_result_dataclass(self):
        """Test SkillExecutionResult dataclass."""
        from src.skills.registry import SkillExecutionResult

        result = SkillExecutionResult(
            skill_name="test-skill",
            success=True,
            steps_completed=3,
            total_steps=3,
            duration_ms=150,
        )

        assert result.skill_name == "test-skill"
        assert result.success is True
        assert result.steps_completed == 3
        assert result.error is None

    def test_skill_execution_result_to_dict(self):
        """Test SkillExecutionResult to_dict method."""
        from src.skills.registry import SkillExecutionResult

        result = SkillExecutionResult(
            skill_name="build-project",
            success=False,
            steps_completed=2,
            total_steps=5,
            error="Build failed",
            duration_ms=5000,
        )

        data = result.to_dict()

        assert data["skill_name"] == "build-project"
        assert data["success"] is False
        assert data["error"] == "Build failed"
        assert "timestamp" in data


class TestSkillRegistryClass:
    """Test SkillRegistry class."""

    def test_skill_registry_class_exists(self):
        """Test SkillRegistry class exists."""
        from src.skills.registry import SkillRegistry
        assert SkillRegistry is not None

    def test_skill_registry_initialization(self):
        """Test SkillRegistry initialization."""
        from src.skills.registry import SkillRegistry

        registry = SkillRegistry()

        assert registry._loaded is False
        assert registry._execution_history == []
        assert registry._executing_skills == set()

    def test_skill_registry_with_dependencies(self):
        """Test SkillRegistry with dependencies."""
        from src.skills.registry import SkillRegistry
        from src.skills.loader import SkillLoader

        mock_loader = MagicMock(spec=SkillLoader)
        mock_executor = MagicMock()
        mock_publisher = MagicMock()

        registry = SkillRegistry(
            loader=mock_loader,
            tool_executor=mock_executor,
            publisher=mock_publisher,
        )

        assert registry._loader == mock_loader
        assert registry._tool_executor == mock_executor
        assert registry._publisher == mock_publisher

    def test_set_auth_context(self):
        """Test set_auth_context method."""
        from src.skills.registry import SkillRegistry

        registry = SkillRegistry()
        registry.set_auth_context(
            auth_token="token-123",
            session_id="session-456",
            agent_id="agent-789",
        )

        assert registry._auth_token == "token-123"
        assert registry._session_id == "session-456"
        assert registry._agent_id == "agent-789"


class TestSkillLoader:
    """Test SkillLoader class."""

    def test_skill_loader_class_exists(self):
        """Test SkillLoader class exists."""
        from src.skills.loader import SkillLoader
        assert SkillLoader is not None

    def test_skill_class_exists(self):
        """Test Skill class exists."""
        from src.skills.loader import Skill
        assert Skill is not None

    def test_skill_step_class_exists(self):
        """Test SkillStep class exists."""
        from src.skills.loader import SkillStep
        assert SkillStep is not None


# ============================================================================
# Extended Planning Tests
# ============================================================================


class TestExecutionPlanDataclass:
    """Test ExecutionPlan dataclass."""

    def test_execution_plan_creation(self):
        """Test ExecutionPlan creation."""
        from src.planning.planner import ExecutionPlan, PlanStatus

        plan = ExecutionPlan(
            id="plan-123",
            session_id="session-456",
            agent_id="agent-789",
            title="Setup Project",
            description="Set up the project structure",
            steps=[],
        )
        assert plan.id == "plan-123"
        assert plan.session_id == "session-456"
        assert plan.agent_id == "agent-789"
        assert plan.title == "Setup Project"
        assert plan.status == PlanStatus.DRAFT
        assert plan.current_step == 0
        assert plan.confidence_score == 0.0
        assert plan.metadata == {}

    def test_execution_plan_with_steps(self):
        """Test ExecutionPlan with steps."""
        from src.planning.planner import ExecutionPlan, PlanStep

        steps = [
            PlanStep(
                id="step-1",
                order=0,
                action_type="file_write",
                description="Create file",
                action_params={"path": "test.py"},
            ),
            PlanStep(
                id="step-2",
                order=1,
                action_type="command_run",
                description="Run tests",
                action_params={"command": "pytest"},
            ),
        ]

        plan = ExecutionPlan(
            id="plan-1",
            session_id="session-1",
            agent_id="agent-1",
            title="Test Plan",
            description="Test plan description",
            steps=steps,
        )
        assert len(plan.steps) == 2
        assert plan.steps[0].action_type == "file_write"
        assert plan.steps[1].action_type == "command_run"

    def test_execution_plan_to_dict(self):
        """Test ExecutionPlan.to_dict method."""
        from src.planning.planner import ExecutionPlan, PlanStatus, PlanStep

        now = datetime.now(UTC)
        plan = ExecutionPlan(
            id="plan-dict",
            session_id="sess-1",
            agent_id="agent-1",
            title="Dict Test",
            description="Testing to_dict",
            steps=[
                PlanStep(id="s1", order=0, action_type="test", description="Test", action_params={})
            ],
            status=PlanStatus.APPROVED,
            confidence_score=0.9,
            approved_by="user-1",
            approved_at=now,
            metadata={"key": "value"},
        )

        d = plan.to_dict()
        assert d["id"] == "plan-dict"
        assert d["session_id"] == "sess-1"
        assert d["status"] == "approved"
        assert d["confidence_score"] == 0.9
        assert d["approved_by"] == "user-1"
        assert d["approved_at"] == now.isoformat()
        assert len(d["steps"]) == 1
        assert d["metadata"] == {"key": "value"}

    def test_execution_plan_from_dict(self):
        """Test ExecutionPlan.from_dict method."""
        from src.planning.planner import ExecutionPlan, PlanStatus

        now = datetime.now(UTC)
        data = {
            "id": "plan-from",
            "session_id": "sess-2",
            "agent_id": "agent-2",
            "title": "From Dict",
            "description": "Testing from_dict",
            "steps": [
                {
                    "id": "step-1",
                    "order": 0,
                    "action_type": "file_read",
                    "description": "Read",
                    "action_params": {},
                }
            ],
            "status": "executing",
            "confidence_score": 0.85,
            "created_at": now.isoformat(),
            "current_step": 1,
        }

        plan = ExecutionPlan.from_dict(data)
        assert plan.id == "plan-from"
        assert plan.status == PlanStatus.EXECUTING
        assert plan.confidence_score == 0.85
        assert len(plan.steps) == 1
        assert plan.current_step == 1

    def test_execution_plan_get_progress(self):
        """Test ExecutionPlan.get_progress method."""
        from src.planning.planner import ExecutionPlan, PlanStep, StepStatus

        steps = [
            PlanStep(
                id="s1", order=0, action_type="t", description="d", action_params={},
                status=StepStatus.COMPLETED
            ),
            PlanStep(
                id="s2", order=1, action_type="t", description="d", action_params={},
                status=StepStatus.COMPLETED
            ),
            PlanStep(
                id="s3", order=2, action_type="t", description="d", action_params={},
                status=StepStatus.FAILED
            ),
            PlanStep(
                id="s4", order=3, action_type="t", description="d", action_params={},
                status=StepStatus.PENDING
            ),
        ]

        plan = ExecutionPlan(
            id="p1",
            session_id="s1",
            agent_id="a1",
            title="Progress Test",
            description="Testing progress",
            steps=steps,
            current_step=3,
        )

        progress = plan.get_progress()
        assert progress["total_steps"] == 4
        assert progress["completed_steps"] == 2
        assert progress["failed_steps"] == 1
        assert progress["current_step"] == 3
        assert progress["percentage"] == 50.0

    def test_execution_plan_get_progress_empty(self):
        """Test ExecutionPlan.get_progress with no steps."""
        from src.planning.planner import ExecutionPlan

        plan = ExecutionPlan(
            id="p1",
            session_id="s1",
            agent_id="a1",
            title="Empty",
            description="No steps",
            steps=[],
        )

        progress = plan.get_progress()
        assert progress["total_steps"] == 0
        assert progress["percentage"] == 0


class TestPlanExecutorCallbacks:
    """Test PlanExecutorCallbacks dataclass."""

    def test_callbacks_creation(self):
        """Test PlanExecutorCallbacks creation."""
        from src.planning.executor import PlanExecutorCallbacks

        callbacks = PlanExecutorCallbacks()
        assert callbacks.on_step_start is None
        assert callbacks.on_step_complete is None
        assert callbacks.on_step_error is None
        assert callbacks.on_plan_complete is None

    def test_callbacks_with_functions(self):
        """Test PlanExecutorCallbacks with callback functions."""
        from src.planning.executor import PlanExecutorCallbacks

        async def on_start(plan, step):
            pass

        async def on_complete(plan, step):
            pass

        callbacks = PlanExecutorCallbacks(
            on_step_start=on_start,
            on_step_complete=on_complete,
        )
        assert callbacks.on_step_start is on_start
        assert callbacks.on_step_complete is on_complete


class TestPlanExecutorInitialization:
    """Test PlanExecutor initialization."""

    def test_executor_initialization(self):
        """Test PlanExecutor initialization."""
        from src.planning.executor import PlanExecutor, PlanExecutorCallbacks

        mock_planner = MagicMock()
        mock_tool_executor = MagicMock()

        executor = PlanExecutor(
            planner=mock_planner,
            tool_executor=mock_tool_executor,
        )
        assert executor._planner is mock_planner
        assert executor._tool_executor is mock_tool_executor
        assert executor._paused_plans == set()

    def test_executor_with_callbacks(self):
        """Test PlanExecutor with callbacks."""
        from src.planning.executor import PlanExecutor, PlanExecutorCallbacks

        mock_planner = MagicMock()
        mock_tool_executor = MagicMock()

        async def on_start(plan, step):
            pass

        callbacks = PlanExecutorCallbacks(on_step_start=on_start)

        executor = PlanExecutor(
            planner=mock_planner,
            tool_executor=mock_tool_executor,
            callbacks=callbacks,
        )
        assert executor._on_step_start is on_start


class TestPlanExecutorPauseResume:
    """Test PlanExecutor pause and resume methods."""

    @pytest.fixture
    def executor(self):
        """Create executor instance."""
        from src.planning.executor import PlanExecutor

        return PlanExecutor(
            planner=MagicMock(),
            tool_executor=MagicMock(),
        )

    def test_pause_plan(self, executor):
        """Test pause_plan method."""
        executor.pause_plan("plan-123")
        assert "plan-123" in executor._paused_plans

    def test_resume_plan(self, executor):
        """Test resume_plan method."""
        executor._paused_plans.add("plan-123")
        executor.resume_plan("plan-123")
        assert "plan-123" not in executor._paused_plans

    def test_resume_plan_not_paused(self, executor):
        """Test resume_plan when plan is not paused."""
        executor.resume_plan("nonexistent")
        assert "nonexistent" not in executor._paused_plans


class TestPlanExecutorExecutePlan:
    """Test PlanExecutor execute_plan method."""

    @pytest.fixture
    def mock_planner(self):
        """Create mock planner."""
        planner = MagicMock()
        planner.get_plan = AsyncMock()
        planner._save_plan = AsyncMock()
        return planner

    @pytest.fixture
    def mock_tool_executor(self):
        """Create mock tool executor."""
        executor = MagicMock()
        executor.execute = AsyncMock(return_value='{"success": true}')
        return executor

    @pytest.fixture
    def executor(self, mock_planner, mock_tool_executor):
        """Create plan executor."""
        from src.planning.executor import PlanExecutor

        return PlanExecutor(
            planner=mock_planner,
            tool_executor=mock_tool_executor,
        )

    async def test_execute_plan_not_found(self, executor, mock_planner):
        """Test execute_plan when plan not found."""
        mock_planner.get_plan.return_value = None

        result = await executor.execute_plan("nonexistent")
        assert result is None
        mock_planner.get_plan.assert_called_once_with("nonexistent")

    async def test_execute_plan_wrong_status(self, executor, mock_planner):
        """Test execute_plan when plan not in approved/paused status."""
        from src.planning.planner import ExecutionPlan, PlanStatus

        plan = ExecutionPlan(
            id="plan-1",
            session_id="s1",
            agent_id="a1",
            title="Test",
            description="Test",
            steps=[],
            status=PlanStatus.DRAFT,
        )
        mock_planner.get_plan.return_value = plan

        result = await executor.execute_plan("plan-1")
        assert result is plan
        assert result.status == PlanStatus.DRAFT

    async def test_execute_plan_empty_steps(self, executor, mock_planner):
        """Test execute_plan with no steps."""
        from src.planning.planner import ExecutionPlan, PlanStatus

        plan = ExecutionPlan(
            id="plan-1",
            session_id="s1",
            agent_id="a1",
            title="Empty Plan",
            description="No steps",
            steps=[],
            status=PlanStatus.APPROVED,
        )
        mock_planner.get_plan.return_value = plan

        result = await executor.execute_plan("plan-1")
        assert result.status == PlanStatus.COMPLETED

    async def test_execute_plan_success(self, executor, mock_planner, mock_tool_executor):
        """Test execute_plan successfully completes."""
        from src.planning.planner import ExecutionPlan, PlanStatus, PlanStep

        steps = [
            PlanStep(
                id="s1", order=0, action_type="file_write", description="Write",
                action_params={"path": "test.py", "content": "test"}
            ),
            PlanStep(
                id="s2", order=1, action_type="command_run", description="Run",
                action_params={"command": "echo hello"}
            ),
        ]

        plan = ExecutionPlan(
            id="plan-1",
            session_id="s1",
            agent_id="a1",
            title="Test Plan",
            description="Testing",
            steps=steps,
            status=PlanStatus.APPROVED,
        )
        mock_planner.get_plan.return_value = plan
        mock_tool_executor.execute.return_value = '{"success": true}'

        result = await executor.execute_plan("plan-1")
        assert result.status == PlanStatus.COMPLETED
        assert mock_tool_executor.execute.call_count == 2

    async def test_execute_plan_step_failure(self, executor, mock_planner, mock_tool_executor):
        """Test execute_plan when step fails."""
        from src.planning.planner import ExecutionPlan, PlanStatus, PlanStep

        step = PlanStep(
            id="s1", order=0, action_type="command_run", description="Fail",
            action_params={"command": "false"}
        )

        plan = ExecutionPlan(
            id="plan-1",
            session_id="s1",
            agent_id="a1",
            title="Failing Plan",
            description="Will fail",
            steps=[step],
            status=PlanStatus.APPROVED,
        )
        mock_planner.get_plan.return_value = plan
        mock_tool_executor.execute.return_value = '{"success": false, "error": "Command failed"}'

        result = await executor.execute_plan("plan-1")
        assert result.status == PlanStatus.FAILED
        assert result.error is not None

    async def test_execute_plan_continues_on_error(self, executor, mock_planner, mock_tool_executor):
        """Test execute_plan with stop_on_error=False."""
        from src.planning.planner import ExecutionPlan, PlanStatus, PlanStep

        steps = [
            PlanStep(
                id="s1", order=0, action_type="command_run", description="Fail",
                action_params={}
            ),
            PlanStep(
                id="s2", order=1, action_type="command_run", description="Success",
                action_params={}
            ),
        ]

        plan = ExecutionPlan(
            id="plan-1",
            session_id="s1",
            agent_id="a1",
            title="Continue Plan",
            description="Continue on error",
            steps=steps,
            status=PlanStatus.APPROVED,
        )
        mock_planner.get_plan.return_value = plan
        mock_tool_executor.execute.side_effect = [
            '{"success": false, "error": "First failed"}',
            '{"success": true}',
        ]

        result = await executor.execute_plan("plan-1", stop_on_error=False)
        assert mock_tool_executor.execute.call_count == 2

    async def test_execute_plan_paused(self, executor, mock_planner, mock_tool_executor):
        """Test execute_plan can be paused."""
        from src.planning.planner import ExecutionPlan, PlanStatus, PlanStep

        steps = [
            PlanStep(id="s1", order=0, action_type="test", description="t", action_params={}),
            PlanStep(id="s2", order=1, action_type="test", description="t", action_params={}),
        ]

        plan = ExecutionPlan(
            id="plan-pause",
            session_id="s1",
            agent_id="a1",
            title="Pause Plan",
            description="Will pause",
            steps=steps,
            status=PlanStatus.APPROVED,
        )
        mock_planner.get_plan.return_value = plan
        executor.pause_plan("plan-pause")
        mock_tool_executor.execute.return_value = '{"success": true}'

        result = await executor.execute_plan("plan-pause")
        assert result.status == PlanStatus.PAUSED

    async def test_execute_plan_skips_completed_steps(self, executor, mock_planner, mock_tool_executor):
        """Test execute_plan skips already completed steps."""
        from src.planning.planner import ExecutionPlan, PlanStatus, PlanStep, StepStatus

        steps = [
            PlanStep(
                id="s1", order=0, action_type="test", description="t", action_params={},
                status=StepStatus.COMPLETED
            ),
            PlanStep(
                id="s2", order=1, action_type="test", description="t", action_params={},
            ),
        ]

        plan = ExecutionPlan(
            id="plan-1",
            session_id="s1",
            agent_id="a1",
            title="Skip Test",
            description="Skip completed",
            steps=steps,
            status=PlanStatus.APPROVED,
        )
        mock_planner.get_plan.return_value = plan
        mock_tool_executor.execute.return_value = '{"success": true}'

        await executor.execute_plan("plan-1")
        assert mock_tool_executor.execute.call_count == 1

    async def test_execute_plan_with_callbacks(self, mock_planner, mock_tool_executor):
        """Test execute_plan calls callbacks."""
        from src.planning.executor import PlanExecutor, PlanExecutorCallbacks
        from src.planning.planner import ExecutionPlan, PlanStatus, PlanStep

        on_step_start = AsyncMock()
        on_step_complete = AsyncMock()
        on_plan_complete = AsyncMock()

        callbacks = PlanExecutorCallbacks(
            on_step_start=on_step_start,
            on_step_complete=on_step_complete,
            on_plan_complete=on_plan_complete,
        )

        executor = PlanExecutor(
            planner=mock_planner,
            tool_executor=mock_tool_executor,
            callbacks=callbacks,
        )

        step = PlanStep(id="s1", order=0, action_type="test", description="t", action_params={})
        plan = ExecutionPlan(
            id="plan-cb",
            session_id="s1",
            agent_id="a1",
            title="Callback Test",
            description="Test callbacks",
            steps=[step],
            status=PlanStatus.APPROVED,
        )
        mock_planner.get_plan.return_value = plan
        mock_tool_executor.execute.return_value = '{"success": true}'

        await executor.execute_plan("plan-cb")

        on_step_start.assert_called_once()
        on_step_complete.assert_called_once()
        on_plan_complete.assert_called_once()


class TestPlanExecutorExecuteAction:
    """Test PlanExecutor._execute_action method."""

    @pytest.fixture
    def executor(self):
        """Create executor."""
        from src.planning.executor import PlanExecutor

        mock_planner = MagicMock()
        mock_tool_executor = MagicMock()
        mock_tool_executor.execute = AsyncMock()

        return PlanExecutor(
            planner=mock_planner,
            tool_executor=mock_tool_executor,
        )

    async def test_execute_action_file_write(self, executor):
        """Test _execute_action maps file_write to write_file."""
        executor._tool_executor.execute.return_value = '{"success": true}'

        result = await executor._execute_action(
            "file_write",
            {"path": "test.py", "content": "test"},
        )
        executor._tool_executor.execute.assert_called_with(
            "write_file",
            {"path": "test.py", "content": "test"},
        )
        assert result["success"] is True

    async def test_execute_action_command_run(self, executor):
        """Test _execute_action maps command_run to run_command."""
        executor._tool_executor.execute.return_value = '{"success": true, "output": "hello"}'

        await executor._execute_action("command_run", {"command": "echo hello"})
        executor._tool_executor.execute.assert_called_with(
            "run_command",
            {"command": "echo hello"},
        )

    async def test_execute_action_unknown_type(self, executor):
        """Test _execute_action with unknown action type passes through."""
        executor._tool_executor.execute.return_value = '{"success": true}'

        await executor._execute_action("custom_action", {"param": "value"})
        executor._tool_executor.execute.assert_called_with(
            "custom_action",
            {"param": "value"},
        )

    async def test_execute_action_non_json_result(self, executor):
        """Test _execute_action handles non-JSON result."""
        executor._tool_executor.execute.return_value = "plain text output"

        result = await executor._execute_action("file_read", {"path": "test.py"})
        assert result == {"success": True, "output": "plain text output"}


class TestPlanExecutorRollback:
    """Test PlanExecutor rollback methods."""

    @pytest.fixture
    def executor(self):
        """Create executor."""
        from src.planning.executor import PlanExecutor

        mock_planner = MagicMock()
        mock_planner.get_plan = AsyncMock()
        mock_planner._save_plan = AsyncMock()

        mock_tool_executor = MagicMock()
        mock_tool_executor.execute = AsyncMock(return_value='{"success": true}')

        return PlanExecutor(
            planner=mock_planner,
            tool_executor=mock_tool_executor,
        )

    async def test_rollback_step_success(self, executor):
        """Test rollback_step success."""
        from src.planning.planner import ExecutionPlan, PlanStep, StepStatus

        step = PlanStep(
            id="s1",
            order=0,
            action_type="file_write",
            description="Write file",
            action_params={"path": "test.py"},
            status=StepStatus.COMPLETED,
            can_rollback=True,
            rollback_action={
                "action_type": "file_delete",
                "params": {"path": "test.py"},
            },
        )

        plan = ExecutionPlan(
            id="p1",
            session_id="s1",
            agent_id="a1",
            title="Rollback Test",
            description="Test rollback",
            steps=[step],
        )

        result = await executor.rollback_step(plan, step)
        assert result is True
        assert step.status == StepStatus.ROLLED_BACK

    async def test_rollback_step_cannot_rollback(self, executor):
        """Test rollback_step when step cannot be rolled back."""
        from src.planning.planner import ExecutionPlan, PlanStep, StepStatus

        step = PlanStep(
            id="s1",
            order=0,
            action_type="command_run",
            description="Run command",
            action_params={},
            status=StepStatus.COMPLETED,
            can_rollback=False,
        )

        plan = ExecutionPlan(
            id="p1",
            session_id="s1",
            agent_id="a1",
            title="Test",
            description="Test",
            steps=[step],
        )

        result = await executor.rollback_step(plan, step)
        assert result is False

    async def test_rollback_step_not_completed(self, executor):
        """Test rollback_step when step is not completed."""
        from src.planning.planner import ExecutionPlan, PlanStep, StepStatus

        step = PlanStep(
            id="s1",
            order=0,
            action_type="test",
            description="Test",
            action_params={},
            status=StepStatus.PENDING,
            can_rollback=True,
            rollback_action={"action_type": "test", "params": {}},
        )

        plan = ExecutionPlan(
            id="p1",
            session_id="s1",
            agent_id="a1",
            title="Test",
            description="Test",
            steps=[step],
        )

        result = await executor.rollback_step(plan, step)
        assert result is False

    async def test_rollback_step_failure(self, executor):
        """Test rollback_step when rollback action fails."""
        from src.planning.planner import ExecutionPlan, PlanStep, StepStatus

        step = PlanStep(
            id="s1",
            order=0,
            action_type="test",
            description="Test",
            action_params={},
            status=StepStatus.COMPLETED,
            can_rollback=True,
            rollback_action={"action_type": "test", "params": {}},
        )

        plan = ExecutionPlan(
            id="p1",
            session_id="s1",
            agent_id="a1",
            title="Test",
            description="Test",
            steps=[step],
        )

        executor._tool_executor.execute.return_value = '{"success": false, "error": "Rollback failed"}'

        result = await executor.rollback_step(plan, step)
        assert result is False

    async def test_rollback_plan_success(self, executor):
        """Test rollback_plan rolls back all completed steps."""
        from src.planning.planner import ExecutionPlan, PlanStatus, PlanStep, StepStatus

        steps = [
            PlanStep(
                id="s1", order=0, action_type="test", description="t", action_params={},
                status=StepStatus.COMPLETED, can_rollback=True,
                rollback_action={"action_type": "test", "params": {}},
            ),
            PlanStep(
                id="s2", order=1, action_type="test", description="t", action_params={},
                status=StepStatus.COMPLETED, can_rollback=True,
                rollback_action={"action_type": "test", "params": {}},
            ),
            PlanStep(
                id="s3", order=2, action_type="test", description="t", action_params={},
                status=StepStatus.PENDING,
            ),
        ]

        plan = ExecutionPlan(
            id="p1",
            session_id="s1",
            agent_id="a1",
            title="Rollback All",
            description="Test rollback all",
            steps=steps,
        )
        executor._planner.get_plan.return_value = plan

        result = await executor.rollback_plan("p1")
        assert result.status == PlanStatus.CANCELLED
        assert executor._tool_executor.execute.call_count == 2

    async def test_rollback_plan_not_found(self, executor):
        """Test rollback_plan when plan not found."""
        executor._planner.get_plan.return_value = None

        result = await executor.rollback_plan("nonexistent")
        assert result is None


class TestPlannerGetPlan:
    """Test Planner.get_plan method."""

    @pytest.fixture
    def planner(self):
        """Create planner."""
        from src.planning.planner import Planner

        mock_redis = MagicMock()
        mock_redis.get_json = AsyncMock()

        mock_llm = MagicMock()

        return Planner(redis_client=mock_redis, llm_provider=mock_llm)

    async def test_get_plan_found(self, planner):
        """Test get_plan when plan exists."""
        from src.planning.planner import PlanStatus

        planner._redis.get_json.return_value = {
            "id": "plan-123",
            "session_id": "s1",
            "agent_id": "a1",
            "title": "Test Plan",
            "description": "Testing",
            "steps": [],
            "status": "approved",
        }

        plan = await planner.get_plan("plan-123")
        assert plan is not None
        assert plan.id == "plan-123"
        assert plan.status == PlanStatus.APPROVED

    async def test_get_plan_not_found(self, planner):
        """Test get_plan when plan doesn't exist."""
        planner._redis.get_json.return_value = None

        plan = await planner.get_plan("nonexistent")
        assert plan is None


class TestPlannerApprovePlan:
    """Test Planner.approve_plan method."""

    @pytest.fixture
    def planner(self):
        """Create planner."""
        from src.planning.planner import Planner

        mock_redis = MagicMock()
        mock_redis.get_json = AsyncMock()
        mock_redis.set_json = AsyncMock()

        mock_llm = MagicMock()

        return Planner(redis_client=mock_redis, llm_provider=mock_llm)

    async def test_approve_plan_success(self, planner):
        """Test approve_plan success."""
        from src.planning.planner import PlanStatus

        planner._redis.get_json.return_value = {
            "id": "plan-1",
            "session_id": "s1",
            "agent_id": "a1",
            "title": "Test",
            "description": "Test",
            "steps": [],
            "status": "pending_approval",
        }

        plan = await planner.approve_plan("plan-1", "user-1")
        assert plan is not None
        assert plan.status == PlanStatus.APPROVED
        assert plan.approved_by == "user-1"
        assert plan.approved_at is not None

    async def test_approve_plan_not_found(self, planner):
        """Test approve_plan when plan not found."""
        planner._redis.get_json.return_value = None

        plan = await planner.approve_plan("nonexistent", "user-1")
        assert plan is None

    async def test_approve_plan_wrong_status(self, planner):
        """Test approve_plan when plan not pending approval."""
        from src.planning.planner import PlanStatus

        planner._redis.get_json.return_value = {
            "id": "plan-1",
            "session_id": "s1",
            "agent_id": "a1",
            "title": "Test",
            "description": "Test",
            "steps": [],
            "status": "completed",
        }

        plan = await planner.approve_plan("plan-1", "user-1")
        assert plan is not None
        assert plan.status == PlanStatus.COMPLETED


class TestPlannerRejectPlan:
    """Test Planner.reject_plan method."""

    @pytest.fixture
    def planner(self):
        """Create planner."""
        from src.planning.planner import Planner

        mock_redis = MagicMock()
        mock_redis.get_json = AsyncMock()
        mock_redis.set_json = AsyncMock()

        mock_llm = MagicMock()

        return Planner(redis_client=mock_redis, llm_provider=mock_llm)

    async def test_reject_plan_success(self, planner):
        """Test reject_plan success."""
        from src.planning.planner import PlanStatus

        planner._redis.get_json.return_value = {
            "id": "plan-1",
            "session_id": "s1",
            "agent_id": "a1",
            "title": "Test",
            "description": "Test",
            "steps": [],
            "status": "pending_approval",
        }

        plan = await planner.reject_plan("plan-1", "Not needed")
        assert plan is not None
        assert plan.status == PlanStatus.REJECTED
        assert plan.error == "Not needed"

    async def test_reject_plan_not_found(self, planner):
        """Test reject_plan when plan not found."""
        planner._redis.get_json.return_value = None

        plan = await planner.reject_plan("nonexistent")
        assert plan is None


class TestPlannerGetSessionPlans:
    """Test Planner.get_session_plans method."""

    @pytest.fixture
    def planner(self):
        """Create planner."""
        from src.planning.planner import Planner

        mock_redis = MagicMock()
        mock_redis.get_json = AsyncMock()
        mock_redis.client = MagicMock()
        mock_redis.client.lrange = AsyncMock()

        mock_llm = MagicMock()

        return Planner(redis_client=mock_redis, llm_provider=mock_llm)

    async def test_get_session_plans_success(self, planner):
        """Test get_session_plans returns plans."""
        planner._redis.client.lrange.return_value = [b"plan-1", b"plan-2"]
        planner._redis.get_json.side_effect = [
            {
                "id": "plan-1",
                "session_id": "s1",
                "agent_id": "a1",
                "title": "Plan 1",
                "description": "First",
                "steps": [],
                "status": "completed",
            },
            {
                "id": "plan-2",
                "session_id": "s1",
                "agent_id": "a1",
                "title": "Plan 2",
                "description": "Second",
                "steps": [],
                "status": "pending_approval",
            },
        ]

        plans = await planner.get_session_plans("s1")
        assert len(plans) == 2
        assert plans[0].id == "plan-1"
        assert plans[1].id == "plan-2"

    async def test_get_session_plans_empty(self, planner):
        """Test get_session_plans with no plans."""
        planner._redis.client.lrange.return_value = []

        plans = await planner.get_session_plans("s1")
        assert plans == []


class TestPlannerUpdateStepStatus:
    """Test Planner.update_step_status method."""

    @pytest.fixture
    def planner(self):
        """Create planner."""
        from src.planning.planner import Planner

        mock_redis = MagicMock()
        mock_redis.get_json = AsyncMock()
        mock_redis.set_json = AsyncMock()
        mock_redis.lock = MagicMock()

        mock_llm = MagicMock()

        return Planner(redis_client=mock_redis, llm_provider=mock_llm)

    async def test_update_step_status_executing(self, planner):
        """Test update_step_status to executing."""
        from src.planning.planner import StepStatus

        planner._redis.get_json.return_value = {
            "id": "plan-1",
            "session_id": "s1",
            "agent_id": "a1",
            "title": "Test",
            "description": "Test",
            "steps": [
                {
                    "id": "step-1",
                    "order": 0,
                    "action_type": "test",
                    "description": "Test",
                    "action_params": {},
                    "status": "pending",
                }
            ],
            "status": "executing",
        }

        class AsyncContextManager:
            async def __aenter__(self):
                return self
            async def __aexit__(self, *args):
                pass

        planner._redis.lock.return_value = AsyncContextManager()

        plan = await planner.update_step_status(
            "plan-1",
            "step-1",
            StepStatus.EXECUTING,
        )
        assert plan is not None
        assert plan.steps[0].status == StepStatus.EXECUTING
        assert plan.steps[0].started_at is not None

    async def test_update_step_status_completed_updates_plan(self, planner):
        """Test update_step_status to completed updates plan status."""
        from src.planning.planner import PlanStatus, StepStatus

        planner._redis.get_json.return_value = {
            "id": "plan-1",
            "session_id": "s1",
            "agent_id": "a1",
            "title": "Test",
            "description": "Test",
            "steps": [
                {
                    "id": "step-1",
                    "order": 0,
                    "action_type": "test",
                    "description": "Test",
                    "action_params": {},
                    "status": "executing",
                }
            ],
            "status": "executing",
        }

        class AsyncContextManager:
            async def __aenter__(self):
                return self
            async def __aexit__(self, *args):
                pass

        planner._redis.lock.return_value = AsyncContextManager()

        plan = await planner.update_step_status(
            "plan-1",
            "step-1",
            StepStatus.COMPLETED,
            result={"output": "done"},
        )
        assert plan is not None
        assert plan.steps[0].status == StepStatus.COMPLETED
        assert plan.steps[0].result == {"output": "done"}
        assert plan.status == PlanStatus.COMPLETED


class TestPlannerKeyConstants:
    """Test Planner key constants."""

    def test_plan_key_format(self):
        """Test plan key format."""
        from src.planning.planner import Planner

        assert "{plan_id}" in Planner.PLAN_KEY
        assert "podex:plan:" in Planner.PLAN_KEY

    def test_session_plans_key_format(self):
        """Test session plans key format."""
        from src.planning.planner import Planner

        assert "{session_id}" in Planner.SESSION_PLANS_KEY
        assert "podex:plans:session:" in Planner.SESSION_PLANS_KEY

    def test_plan_ttl(self):
        """Test plan TTL."""
        from src.planning.planner import Planner

        assert Planner.PLAN_TTL == 86400 * 7


class TestPlanGenerationPrompt:
    """Test PLAN_GENERATION_PROMPT."""

    def test_prompt_contains_required_elements(self):
        """Test prompt contains required elements."""
        from src.planning.planner import PLAN_GENERATION_PROMPT

        assert "{task_description}" in PLAN_GENERATION_PROMPT
        assert "{context}" in PLAN_GENERATION_PROMPT
        assert "action_type" in PLAN_GENERATION_PROMPT
        assert "rollback" in PLAN_GENERATION_PROMPT
        assert "confidence" in PLAN_GENERATION_PROMPT
