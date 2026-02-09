"""Integration tests for parallel plan generation."""

import pytest
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

from src.planning.parallel import (
    GeneratedPlan,
    ParallelPlanGenerator,
    PlanStatus,
    PlanStep,
    get_parallel_plan_generator,
)


class TestPlanStatus:
    """Tests for PlanStatus enum."""

    def test_status_values(self) -> None:
        """Test all status values are defined."""
        assert PlanStatus.PENDING.value == "pending"
        assert PlanStatus.GENERATING.value == "generating"
        assert PlanStatus.COMPLETED.value == "completed"
        assert PlanStatus.FAILED.value == "failed"
        assert PlanStatus.SELECTED.value == "selected"
        assert PlanStatus.REJECTED.value == "rejected"

    def test_status_is_string_enum(self) -> None:
        """Test that status values can be used as strings."""
        status = PlanStatus.COMPLETED
        assert status == "completed"
        assert status.value == "completed"
        # Note: In f-strings, use .value for the string representation
        assert f"Status: {status.value}" == "Status: completed"


class TestPlanStep:
    """Tests for PlanStep dataclass."""

    def test_plan_step_defaults(self) -> None:
        """Test PlanStep with default values."""
        step = PlanStep(
            index=0,
            title="Test step",
            description="A test step",
            estimated_complexity="medium",
        )

        assert step.index == 0
        assert step.title == "Test step"
        assert step.description == "A test step"
        assert step.estimated_complexity == "medium"
        assert step.files_affected == []
        assert step.dependencies == []

    def test_plan_step_with_files_and_deps(self) -> None:
        """Test PlanStep with files and dependencies."""
        step = PlanStep(
            index=2,
            title="Implement feature",
            description="Add the new feature",
            estimated_complexity="high",
            files_affected=["src/main.py", "src/utils.py"],
            dependencies=[0, 1],
        )

        assert step.files_affected == ["src/main.py", "src/utils.py"]
        assert step.dependencies == [0, 1]


class TestGeneratedPlan:
    """Tests for GeneratedPlan dataclass."""

    def test_generated_plan_defaults(self) -> None:
        """Test GeneratedPlan with default values."""
        plan = GeneratedPlan(
            id="plan-1",
            session_id="session-1",
            agent_id="agent-1",
            task_description="Test task",
            approach_name="Test Approach",
            approach_summary="A test approach",
            steps=[],
            model_used="claude-3",
        )

        assert plan.id == "plan-1"
        assert plan.status == PlanStatus.PENDING
        assert plan.total_estimated_complexity == "medium"
        assert plan.pros == []
        assert plan.cons == []
        assert plan.raw_response is None
        assert plan.error is None
        assert plan.generation_time_ms == 0

    def test_generated_plan_to_dict(self) -> None:
        """Test GeneratedPlan to_dict conversion."""
        step = PlanStep(
            index=0,
            title="Step 1",
            description="First step",
            estimated_complexity="low",
            files_affected=["file.py"],
            dependencies=[],
        )

        plan = GeneratedPlan(
            id="plan-1",
            session_id="session-1",
            agent_id="agent-1",
            task_description="Test task",
            approach_name="Test Approach",
            approach_summary="A test approach",
            steps=[step],
            model_used="claude-3",
            status=PlanStatus.COMPLETED,
            pros=["Fast", "Simple"],
            cons=["Limited scope"],
        )

        result = plan.to_dict()

        assert result["id"] == "plan-1"
        assert result["session_id"] == "session-1"
        assert result["agent_id"] == "agent-1"
        assert result["task_description"] == "Test task"
        assert result["approach_name"] == "Test Approach"
        assert result["approach_summary"] == "A test approach"
        assert result["model_used"] == "claude-3"
        assert result["status"] == "completed"
        assert result["pros"] == ["Fast", "Simple"]
        assert result["cons"] == ["Limited scope"]
        assert len(result["steps"]) == 1
        assert result["steps"][0]["title"] == "Step 1"
        assert result["steps"][0]["index"] == 0
        assert result["steps"][0]["files_affected"] == ["file.py"]
        assert "created_at" in result

    def test_generated_plan_to_dict_empty_steps(self) -> None:
        """Test to_dict with no steps."""
        plan = GeneratedPlan(
            id="plan-2",
            session_id="session-1",
            agent_id="agent-1",
            task_description="Empty task",
            approach_name="Empty",
            approach_summary="",
            steps=[],
            model_used="claude-3",
        )

        result = plan.to_dict()
        assert result["steps"] == []


class TestParallelPlanGenerator:
    """Tests for ParallelPlanGenerator class."""

    @pytest.fixture
    def generator(self) -> ParallelPlanGenerator:
        """Create a ParallelPlanGenerator instance."""
        return ParallelPlanGenerator()

    def test_init_defaults(self, generator: ParallelPlanGenerator) -> None:
        """Test default initialization."""
        assert generator._llm_client is None
        assert generator._plans == {}
        assert generator._generation_tasks == {}

    def test_init_with_llm_client(self) -> None:
        """Test initialization with LLM client."""
        mock_client = MagicMock()
        gen = ParallelPlanGenerator(llm_client=mock_client)
        assert gen._llm_client is mock_client

    def test_max_parallel_plans_constant(self) -> None:
        """Test MAX_PARALLEL_PLANS is set correctly."""
        assert ParallelPlanGenerator.MAX_PARALLEL_PLANS == 5

    @pytest.mark.asyncio
    async def test_generate_parallel_plans_no_models_raises(
        self, generator: ParallelPlanGenerator
    ) -> None:
        """Test that generate_parallel_plans raises without models."""
        with pytest.raises(ValueError) as exc_info:
            await generator.generate_parallel_plans(
                session_id="session-1",
                agent_id="agent-1",
                task_description="Test task",
                num_plans=3,
                models=None,
            )

        assert "models are required" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_generate_parallel_plans_empty_models_raises(
        self, generator: ParallelPlanGenerator
    ) -> None:
        """Test that generate_parallel_plans raises with empty models list."""
        with pytest.raises(ValueError) as exc_info:
            await generator.generate_parallel_plans(
                session_id="session-1",
                agent_id="agent-1",
                task_description="Test task",
                num_plans=3,
                models=[],
            )

        assert "models are required" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_generate_parallel_plans_mock_generation(
        self, generator: ParallelPlanGenerator
    ) -> None:
        """Test generating plans with mock (no LLM client)."""
        plans = await generator.generate_parallel_plans(
            session_id="session-1",
            agent_id="agent-1",
            task_description="Implement a feature",
            num_plans=2,
            models=["claude-3", "claude-3-sonnet"],
        )

        assert len(plans) == 2
        assert all(p.status == PlanStatus.COMPLETED for p in plans)
        assert all(len(p.steps) > 0 for p in plans)
        assert plans[0].model_used == "claude-3"
        assert plans[1].model_used == "claude-3-sonnet"

    @pytest.mark.asyncio
    async def test_generate_parallel_plans_caps_at_max(
        self, generator: ParallelPlanGenerator
    ) -> None:
        """Test that num_plans is capped at MAX_PARALLEL_PLANS."""
        plans = await generator.generate_parallel_plans(
            session_id="session-1",
            agent_id="agent-1",
            task_description="Test task",
            num_plans=10,  # Exceeds max
            models=["claude-3"],
        )

        assert len(plans) == 5  # Capped at MAX_PARALLEL_PLANS

    @pytest.mark.asyncio
    async def test_generate_parallel_plans_cycles_models(
        self, generator: ParallelPlanGenerator
    ) -> None:
        """Test that models are cycled when fewer than num_plans."""
        plans = await generator.generate_parallel_plans(
            session_id="session-1",
            agent_id="agent-1",
            task_description="Test task",
            num_plans=4,
            models=["model-a", "model-b"],  # Only 2 models for 4 plans
        )

        assert len(plans) == 4
        assert plans[0].model_used == "model-a"
        assert plans[1].model_used == "model-b"
        assert plans[2].model_used == "model-a"  # Cycles back
        assert plans[3].model_used == "model-b"

    @pytest.mark.asyncio
    async def test_generate_parallel_plans_with_context(
        self, generator: ParallelPlanGenerator
    ) -> None:
        """Test generating plans with additional context."""
        plans = await generator.generate_parallel_plans(
            session_id="session-1",
            agent_id="agent-1",
            task_description="Add feature X",
            num_plans=1,
            models=["claude-3"],
            context="This is a Python FastAPI project",
        )

        assert len(plans) == 1
        assert plans[0].status == PlanStatus.COMPLETED

    @pytest.mark.asyncio
    async def test_generate_parallel_plans_stores_in_session(
        self, generator: ParallelPlanGenerator
    ) -> None:
        """Test that generated plans are stored by session."""
        await generator.generate_parallel_plans(
            session_id="session-1",
            agent_id="agent-1",
            task_description="Task 1",
            num_plans=2,
            models=["claude-3"],
        )

        await generator.generate_parallel_plans(
            session_id="session-1",
            agent_id="agent-1",
            task_description="Task 2",
            num_plans=1,
            models=["claude-3"],
        )

        session_plans = generator.get_session_plans("session-1")
        assert len(session_plans) == 3  # 2 + 1

    @pytest.mark.asyncio
    async def test_generate_parallel_plans_with_llm_client(self) -> None:
        """Test generating plans with real LLM client (mocked)."""
        mock_client = MagicMock()
        mock_client.generate = AsyncMock(
            return_value="""## Approach Name
Test Approach

## Summary
This is a test approach summary.

## Pros
- Fast implementation
- Low risk

## Cons
- Limited scope

## Steps
1. **Analyze codebase**
   - Description: Review existing code
   - Complexity: low
   - Files: src/main.py
   - Dependencies:

2. **Implement feature**
   - Description: Add the new feature
   - Complexity: medium
   - Files: src/feature.py, tests/test_feature.py
   - Dependencies: 1
"""
        )

        gen = ParallelPlanGenerator(llm_client=mock_client)
        plans = await gen.generate_parallel_plans(
            session_id="session-1",
            agent_id="agent-1",
            task_description="Add a new feature",
            num_plans=1,
            models=["claude-3"],
        )

        assert len(plans) == 1
        assert plans[0].status == PlanStatus.COMPLETED
        assert plans[0].approach_name == "Test Approach"
        assert "test approach summary" in plans[0].approach_summary.lower()
        assert len(plans[0].pros) == 2
        assert len(plans[0].cons) == 1
        assert len(plans[0].steps) == 2
        assert plans[0].steps[0].title == "Analyze codebase"
        assert plans[0].steps[1].title == "Implement feature"

    @pytest.mark.asyncio
    async def test_generate_single_plan_llm_error(self) -> None:
        """Test handling LLM client errors."""
        mock_client = MagicMock()
        mock_client.generate = AsyncMock(side_effect=Exception("API error"))

        gen = ParallelPlanGenerator(llm_client=mock_client)
        plans = await gen.generate_parallel_plans(
            session_id="session-1",
            agent_id="agent-1",
            task_description="Test task",
            num_plans=1,
            models=["claude-3"],
        )

        assert len(plans) == 1
        assert plans[0].status == PlanStatus.FAILED
        assert "API error" in plans[0].error

    def test_get_session_plans_empty(self, generator: ParallelPlanGenerator) -> None:
        """Test getting plans for nonexistent session."""
        plans = generator.get_session_plans("nonexistent")
        assert plans == []

    @pytest.mark.asyncio
    async def test_get_session_plans(self, generator: ParallelPlanGenerator) -> None:
        """Test getting plans for a session."""
        await generator.generate_parallel_plans(
            session_id="session-1",
            agent_id="agent-1",
            task_description="Test",
            num_plans=2,
            models=["claude-3"],
        )

        plans = generator.get_session_plans("session-1")
        assert len(plans) == 2

    def test_get_plan_not_found(self, generator: ParallelPlanGenerator) -> None:
        """Test getting nonexistent plan."""
        plan = generator.get_plan("nonexistent-id")
        assert plan is None

    @pytest.mark.asyncio
    async def test_get_plan_found(self, generator: ParallelPlanGenerator) -> None:
        """Test getting existing plan by ID."""
        plans = await generator.generate_parallel_plans(
            session_id="session-1",
            agent_id="agent-1",
            task_description="Test",
            num_plans=1,
            models=["claude-3"],
        )

        plan_id = plans[0].id
        found = generator.get_plan(plan_id)
        assert found is not None
        assert found.id == plan_id

    def test_select_plan_not_found(self, generator: ParallelPlanGenerator) -> None:
        """Test selecting nonexistent plan."""
        result = generator.select_plan("nonexistent-id")
        assert result is False

    @pytest.mark.asyncio
    async def test_select_plan_success(self, generator: ParallelPlanGenerator) -> None:
        """Test selecting a plan marks it and rejects others."""
        plans = await generator.generate_parallel_plans(
            session_id="session-1",
            agent_id="agent-1",
            task_description="Test",
            num_plans=3,
            models=["claude-3"],
        )

        # All should be completed
        assert all(p.status == PlanStatus.COMPLETED for p in plans)

        # Select the first plan
        result = generator.select_plan(plans[0].id)
        assert result is True

        # Verify statuses
        assert plans[0].status == PlanStatus.SELECTED
        assert plans[1].status == PlanStatus.REJECTED
        assert plans[2].status == PlanStatus.REJECTED

    @pytest.mark.asyncio
    async def test_select_plan_skips_failed(self, generator: ParallelPlanGenerator) -> None:
        """Test that select_plan doesn't change failed plans."""
        # Create a plan manually with FAILED status
        failed_plan = GeneratedPlan(
            id="failed-plan",
            session_id="session-1",
            agent_id="agent-1",
            task_description="Test",
            approach_name="Failed",
            approach_summary="",
            steps=[],
            model_used="claude-3",
            status=PlanStatus.FAILED,
        )

        completed_plan = GeneratedPlan(
            id="completed-plan",
            session_id="session-1",
            agent_id="agent-1",
            task_description="Test",
            approach_name="Completed",
            approach_summary="",
            steps=[],
            model_used="claude-3",
            status=PlanStatus.COMPLETED,
        )

        generator._plans["session-1"] = [failed_plan, completed_plan]

        result = generator.select_plan("completed-plan")
        assert result is True

        assert failed_plan.status == PlanStatus.FAILED  # Unchanged
        assert completed_plan.status == PlanStatus.SELECTED

    def test_clear_session_plans_empty(self, generator: ParallelPlanGenerator) -> None:
        """Test clearing plans for empty session."""
        count = generator.clear_session_plans("nonexistent")
        assert count == 0

    @pytest.mark.asyncio
    async def test_clear_session_plans(self, generator: ParallelPlanGenerator) -> None:
        """Test clearing plans for a session."""
        await generator.generate_parallel_plans(
            session_id="session-1",
            agent_id="agent-1",
            task_description="Test",
            num_plans=3,
            models=["claude-3"],
        )

        count = generator.clear_session_plans("session-1")
        assert count == 3

        # Verify cleared
        plans = generator.get_session_plans("session-1")
        assert plans == []


class TestParsePlanResponse:
    """Tests for _parse_plan_response method."""

    @pytest.fixture
    def generator(self) -> ParallelPlanGenerator:
        """Create a generator instance."""
        return ParallelPlanGenerator()

    @pytest.fixture
    def base_plan(self) -> GeneratedPlan:
        """Create a base plan for parsing."""
        return GeneratedPlan(
            id="plan-1",
            session_id="session-1",
            agent_id="agent-1",
            task_description="Test",
            approach_name="",
            approach_summary="",
            steps=[],
            model_used="claude-3",
        )

    def test_parse_approach_name(
        self, generator: ParallelPlanGenerator, base_plan: GeneratedPlan
    ) -> None:
        """Test parsing approach name."""
        response = """## Approach Name
Minimal Changes Approach

## Summary
Test summary
"""
        generator._parse_plan_response(base_plan, response)
        assert base_plan.approach_name == "Minimal Changes Approach"

    def test_parse_summary(
        self, generator: ParallelPlanGenerator, base_plan: GeneratedPlan
    ) -> None:
        """Test parsing summary."""
        response = """## Summary
This is a multi-line
summary that spans
multiple lines.
"""
        generator._parse_plan_response(base_plan, response)
        assert "multi-line" in base_plan.approach_summary
        assert "multiple lines" in base_plan.approach_summary

    def test_parse_pros_and_cons(
        self, generator: ParallelPlanGenerator, base_plan: GeneratedPlan
    ) -> None:
        """Test parsing pros and cons."""
        response = """## Pros
- Fast implementation
- Low risk
- Easy to understand

## Cons
- Limited functionality
- May need refactoring
"""
        generator._parse_plan_response(base_plan, response)
        assert len(base_plan.pros) == 3
        assert "Fast implementation" in base_plan.pros
        assert len(base_plan.cons) == 2
        assert "Limited functionality" in base_plan.cons

    def test_parse_steps_basic(
        self, generator: ParallelPlanGenerator, base_plan: GeneratedPlan
    ) -> None:
        """Test parsing basic steps."""
        response = """## Steps
1. **Analyze code**
   - Description: Review the codebase
   - Complexity: low

2. **Implement changes**
   - Description: Make the changes
   - Complexity: high
"""
        generator._parse_plan_response(base_plan, response)
        assert len(base_plan.steps) == 2
        assert base_plan.steps[0].title == "Analyze code"
        assert base_plan.steps[0].description == "Review the codebase"
        assert base_plan.steps[0].estimated_complexity == "low"
        assert base_plan.steps[1].title == "Implement changes"
        assert base_plan.steps[1].estimated_complexity == "high"

    def test_parse_steps_with_files(
        self, generator: ParallelPlanGenerator, base_plan: GeneratedPlan
    ) -> None:
        """Test parsing steps with files affected."""
        response = """## Steps
1. **Update models**
   - Description: Modify data models
   - Complexity: medium
   - Files: src/models.py, src/schema.py
"""
        generator._parse_plan_response(base_plan, response)
        assert len(base_plan.steps) == 1
        assert base_plan.steps[0].files_affected == ["src/models.py", "src/schema.py"]

    def test_parse_steps_with_dependencies(
        self, generator: ParallelPlanGenerator, base_plan: GeneratedPlan
    ) -> None:
        """Test parsing steps with dependencies."""
        response = """## Steps
1. **Step one**
   - Description: First step
   - Complexity: low

2. **Step two**
   - Description: Second step
   - Complexity: medium
   - Dependencies: 1

3. **Step three**
   - Description: Third step
   - Complexity: high
   - Dependencies: 1, 2
"""
        generator._parse_plan_response(base_plan, response)
        assert len(base_plan.steps) == 3
        assert base_plan.steps[0].dependencies == []
        assert base_plan.steps[1].dependencies == [0]  # 1 -> 0 (converted to 0-indexed)
        assert base_plan.steps[2].dependencies == [0, 1]  # 1,2 -> 0,1

    def test_parse_empty_response(
        self, generator: ParallelPlanGenerator, base_plan: GeneratedPlan
    ) -> None:
        """Test parsing empty response."""
        generator._parse_plan_response(base_plan, "")
        assert base_plan.approach_name == ""
        assert base_plan.approach_summary == ""
        assert base_plan.steps == []

    def test_parse_invalid_complexity_defaults_to_medium(
        self, generator: ParallelPlanGenerator, base_plan: GeneratedPlan
    ) -> None:
        """Test that invalid complexity values default to medium."""
        response = """## Steps
1. **Test step**
   - Description: Test
   - Complexity: extreme
"""
        generator._parse_plan_response(base_plan, response)
        assert len(base_plan.steps) == 1
        assert base_plan.steps[0].estimated_complexity == "medium"  # Default


class TestGetParallelPlanGenerator:
    """Tests for global generator accessor."""

    def test_get_parallel_plan_generator_singleton(self) -> None:
        """Test that get_parallel_plan_generator returns singleton."""
        # Reset global state
        import src.planning.parallel as module

        module._generator = None

        gen1 = get_parallel_plan_generator()
        gen2 = get_parallel_plan_generator()

        assert gen1 is gen2

    def test_get_parallel_plan_generator_creates_instance(self) -> None:
        """Test that get_parallel_plan_generator creates instance if none exists."""
        import src.planning.parallel as module

        module._generator = None

        gen = get_parallel_plan_generator()
        assert isinstance(gen, ParallelPlanGenerator)


class TestMockGeneration:
    """Tests for mock generation behavior (no LLM client)."""

    @pytest.mark.asyncio
    async def test_mock_generation_approach_names(self) -> None:
        """Test that mock generation creates different approach names."""
        gen = ParallelPlanGenerator()
        plans = await gen.generate_parallel_plans(
            session_id="session-1",
            agent_id="agent-1",
            task_description="Test task",
            num_plans=5,
            models=["claude-3"],
        )

        # Verify we get different approaches
        approach_names = [p.approach_name for p in plans]
        assert len(set(approach_names)) == 5  # All different

        # Check that approach names contain expected keywords
        all_names = " ".join(approach_names).lower()
        assert "minimal" in all_names
        assert "comprehensive" in all_names
        assert "optimized" in all_names

    @pytest.mark.asyncio
    async def test_mock_generation_has_steps(self) -> None:
        """Test that mock generation creates steps."""
        gen = ParallelPlanGenerator()
        plans = await gen.generate_parallel_plans(
            session_id="session-1",
            agent_id="agent-1",
            task_description="Test task",
            num_plans=1,
            models=["claude-3"],
        )

        plan = plans[0]
        assert len(plan.steps) == 3

        # Verify step structure
        step_titles = [s.title for s in plan.steps]
        assert "Analyze existing code" in step_titles
        assert "Implement core changes" in step_titles
        assert "Add tests" in step_titles

    @pytest.mark.asyncio
    async def test_mock_generation_has_pros_cons(self) -> None:
        """Test that mock generation creates pros and cons."""
        gen = ParallelPlanGenerator()
        plans = await gen.generate_parallel_plans(
            session_id="session-1",
            agent_id="agent-1",
            task_description="Test task",
            num_plans=1,
            models=["claude-3"],
        )

        plan = plans[0]
        assert len(plan.pros) > 0
        assert len(plan.cons) > 0

    @pytest.mark.asyncio
    async def test_mock_generation_records_timing(self) -> None:
        """Test that mock generation records timing."""
        gen = ParallelPlanGenerator()
        plans = await gen.generate_parallel_plans(
            session_id="session-1",
            agent_id="agent-1",
            task_description="Test task",
            num_plans=1,
            models=["claude-3"],
        )

        plan = plans[0]
        # Should have some generation time (at least 500ms from sleep)
        assert plan.generation_time_ms >= 500
