"""Integration tests for planning comparator module.

Tests cover:
- PlanComparison dataclass
- PlanDiff dataclass
- PlanComparator.compare_plans()
- PlanComparator.diff_plans()
- PlanComparator.rank_plans()
"""

from typing import Any
from unittest.mock import MagicMock

import pytest

from src.planning.comparator import PlanComparator, PlanComparison, PlanDiff
from src.planning.parallel import GeneratedPlan, PlanStep


def create_plan_step(
    index: int,
    title: str,
    description: str,
    estimated_complexity: str = "medium",
    files_affected: list[str] | None = None,
    dependencies: list[int] | None = None,
) -> PlanStep:
    """Helper to create PlanStep with defaults."""
    return PlanStep(
        index=index,
        title=title,
        description=description,
        estimated_complexity=estimated_complexity,
        files_affected=files_affected or [],
        dependencies=dependencies or [],
    )


def create_plan(
    plan_id: str,
    approach_name: str,
    steps: list[PlanStep],
    session_id: str = "session-1",
    agent_id: str = "agent-1",
) -> GeneratedPlan:
    """Helper to create GeneratedPlan with defaults."""
    return GeneratedPlan(
        id=plan_id,
        session_id=session_id,
        agent_id=agent_id,
        task_description="Test task",
        approach_name=approach_name,
        approach_summary=f"{approach_name} approach",
        steps=steps,
        model_used="claude-3",
    )


class TestPlanComparisonDataclass:
    """Tests for PlanComparison dataclass."""

    def test_plan_comparison_creation(self) -> None:
        """Test creating PlanComparison with all fields."""
        comparison = PlanComparison(
            plan_ids=["plan-1", "plan-2"],
            complexity_scores={"plan-1": 5, "plan-2": 8},
            step_counts={"plan-1": 3, "plan-2": 5},
            files_touched={"plan-1": 2, "plan-2": 4},
            shared_files=["shared.py"],
            unique_approaches={"plan-1": ["use library A"], "plan-2": ["manual impl"]},
            recommendations=["Plan 1 is simpler"],
        )

        assert comparison.plan_ids == ["plan-1", "plan-2"]
        assert comparison.complexity_scores["plan-1"] == 5
        assert comparison.step_counts["plan-2"] == 5
        assert "shared.py" in comparison.shared_files

    def test_plan_comparison_empty(self) -> None:
        """Test creating empty PlanComparison."""
        comparison = PlanComparison(
            plan_ids=[],
            complexity_scores={},
            step_counts={},
            files_touched={},
            shared_files=[],
            unique_approaches={},
            recommendations=[],
        )

        assert len(comparison.plan_ids) == 0
        assert len(comparison.complexity_scores) == 0


class TestPlanDiffDataclass:
    """Tests for PlanDiff dataclass."""

    def test_plan_diff_creation(self) -> None:
        """Test creating PlanDiff with all fields."""
        diff = PlanDiff(
            plan_a_id="plan-1",
            plan_b_id="plan-2",
            steps_only_in_a=["Step A1", "Step A2"],
            steps_only_in_b=["Step B1"],
            similar_steps=[("Step 1", "Step 1")],
            files_only_in_a=["a.py"],
            files_only_in_b=["b.py"],
            complexity_diff=3,
        )

        assert diff.plan_a_id == "plan-1"
        assert diff.plan_b_id == "plan-2"
        assert len(diff.steps_only_in_a) == 2
        assert diff.complexity_diff == 3

    def test_plan_diff_no_difference(self) -> None:
        """Test creating PlanDiff with no differences."""
        diff = PlanDiff(
            plan_a_id="plan-1",
            plan_b_id="plan-2",
            steps_only_in_a=[],
            steps_only_in_b=[],
            similar_steps=[],
            files_only_in_a=[],
            files_only_in_b=[],
            complexity_diff=0,
        )

        assert len(diff.steps_only_in_a) == 0
        assert diff.complexity_diff == 0


class TestPlanComparator:
    """Tests for PlanComparator class."""

    @pytest.fixture
    def comparator(self) -> PlanComparator:
        """Create PlanComparator instance."""
        return PlanComparator()

    @pytest.fixture
    def sample_plans(self) -> list[GeneratedPlan]:
        """Create sample plans for testing."""
        plan1 = create_plan(
            plan_id="plan-1",
            approach_name="Simple",
            steps=[
                create_plan_step(0, "Step 1", "First step", "low", ["file1.py"]),
                create_plan_step(1, "Step 2", "Second step", "medium", ["file2.py"], [0]),
            ],
        )

        plan2 = create_plan(
            plan_id="plan-2",
            approach_name="Complex",
            steps=[
                create_plan_step(0, "Step 1", "First step", "medium", ["file1.py", "file3.py"]),
                create_plan_step(1, "Step 2", "Second step", "high", ["file2.py"], [0]),
                create_plan_step(2, "Step 3", "Third step", "high", ["file4.py"], [1]),
            ],
        )

        return [plan1, plan2]

    def test_compare_plans_empty(self, comparator: PlanComparator) -> None:
        """Test comparing empty plan list."""
        comparison = comparator.compare_plans([])

        assert comparison.plan_ids == []
        assert comparison.complexity_scores == {}
        assert comparison.recommendations == []

    def test_compare_plans_single(
        self, comparator: PlanComparator, sample_plans: list[GeneratedPlan]
    ) -> None:
        """Test comparing single plan."""
        comparison = comparator.compare_plans([sample_plans[0]])

        assert len(comparison.plan_ids) == 1
        assert "plan-1" in comparison.plan_ids
        assert comparison.step_counts["plan-1"] == 2

    def test_compare_plans_multiple(
        self, comparator: PlanComparator, sample_plans: list[GeneratedPlan]
    ) -> None:
        """Test comparing multiple plans."""
        comparison = comparator.compare_plans(sample_plans)

        assert len(comparison.plan_ids) == 2
        assert "plan-1" in comparison.plan_ids
        assert "plan-2" in comparison.plan_ids

        # Plan 1 should have lower complexity
        assert comparison.complexity_scores["plan-1"] < comparison.complexity_scores["plan-2"]

        # Plan 2 has more steps
        assert comparison.step_counts["plan-1"] == 2
        assert comparison.step_counts["plan-2"] == 3

    def test_compare_plans_shared_files(
        self, comparator: PlanComparator, sample_plans: list[GeneratedPlan]
    ) -> None:
        """Test detecting shared files between plans."""
        comparison = comparator.compare_plans(sample_plans)

        # Both plans affect file1.py and file2.py
        assert "file1.py" in comparison.shared_files
        assert "file2.py" in comparison.shared_files

    def test_compare_plans_complexity_calculation(
        self, comparator: PlanComparator
    ) -> None:
        """Test complexity score calculation."""
        plan = create_plan(
            plan_id="test-plan",
            approach_name="Test",
            steps=[
                create_plan_step(0, "Low", "Low complexity", "low"),
                create_plan_step(1, "Medium", "Medium complexity", "medium"),
                create_plan_step(2, "High", "High complexity", "high"),
            ],
        )

        comparison = comparator.compare_plans([plan])

        # Complexity: 1 (low) + 2 (medium) + 3 (high) = 6
        assert comparison.complexity_scores["test-plan"] == 6


class TestPlanComparatorDiff:
    """Tests for PlanComparator diff functionality."""

    @pytest.fixture
    def comparator(self) -> PlanComparator:
        """Create PlanComparator instance."""
        return PlanComparator()

    def test_diff_plans(self, comparator: PlanComparator) -> None:
        """Test generating diff between two plans."""
        plan_a = create_plan(
            plan_id="plan-a",
            approach_name="Approach A",
            steps=[
                create_plan_step(0, "Only in A", "Only in A desc", "low", ["a.py"]),
                create_plan_step(1, "Shared step", "Shared desc", "medium", ["shared.py"]),
            ],
        )

        plan_b = create_plan(
            plan_id="plan-b",
            approach_name="Approach B",
            steps=[
                create_plan_step(0, "Shared step", "Shared desc", "medium", ["shared.py"]),
                create_plan_step(1, "Only in B", "Only in B desc", "high", ["b.py"]),
            ],
        )

        diff = comparator.diff_plans(plan_a, plan_b)

        assert diff.plan_a_id == "plan-a"
        assert diff.plan_b_id == "plan-b"
        assert "a.py" in diff.files_only_in_a
        assert "b.py" in diff.files_only_in_b


class TestPlanComparatorRanking:
    """Tests for PlanComparator ranking functionality."""

    @pytest.fixture
    def comparator(self) -> PlanComparator:
        """Create PlanComparator instance."""
        return PlanComparator()

    @pytest.fixture
    def plans_to_rank(self) -> list[GeneratedPlan]:
        """Create plans with different complexities."""
        plans = []
        for i, complexity in enumerate(["high", "low", "medium"]):
            plan = create_plan(
                plan_id=f"plan-{i}",
                approach_name=f"Approach {i}",
                steps=[
                    create_plan_step(0, "Step", "Step desc", complexity),
                ],
            )
            plans.append(plan)
        return plans

    def test_rank_by_complexity(
        self, comparator: PlanComparator, plans_to_rank: list[GeneratedPlan]
    ) -> None:
        """Test ranking plans by complexity (lower is better)."""
        ranked = comparator.rank_plans(plans_to_rank, criteria="complexity")

        # rank_plans returns list of (plan, rank, reason) tuples
        # Plan with "low" complexity should rank first (rank=1)
        assert ranked[0][0].id == "plan-1"  # low complexity, best rank
        assert ranked[0][1] == 1  # rank 1
        assert ranked[1][0].id == "plan-2"  # medium complexity
        assert ranked[2][0].id == "plan-0"  # high complexity

    def test_rank_by_minimal(
        self, comparator: PlanComparator
    ) -> None:
        """Test ranking plans by minimal criteria (fewer steps/files is better)."""
        plans = []
        for i, num_steps in enumerate([3, 1, 2]):
            plan = create_plan(
                plan_id=f"plan-{i}",
                approach_name=f"Approach {i}",
                steps=[
                    create_plan_step(j, f"Step {j}", f"Step {j} desc", "medium")
                    for j in range(num_steps)
                ],
            )
            plans.append(plan)

        ranked = comparator.rank_plans(plans, criteria="minimal")

        # Plan with 1 step should rank first
        assert ranked[0][0].id == "plan-1"  # 1 step
        assert ranked[1][0].id == "plan-2"  # 2 steps
        assert ranked[2][0].id == "plan-0"  # 3 steps

    def test_rank_empty_list(self, comparator: PlanComparator) -> None:
        """Test ranking empty plan list."""
        ranked = comparator.rank_plans([], criteria="complexity")
        assert ranked == []

    def test_rank_single_plan(
        self, comparator: PlanComparator, plans_to_rank: list[GeneratedPlan]
    ) -> None:
        """Test ranking single plan."""
        ranked = comparator.rank_plans([plans_to_rank[0]], criteria="complexity")
        assert len(ranked) == 1
        assert ranked[0][0].id == "plan-0"  # plan
        assert ranked[0][1] == 1  # rank

    def test_rank_by_balanced(
        self, comparator: PlanComparator, plans_to_rank: list[GeneratedPlan]
    ) -> None:
        """Test ranking plans by balanced criteria."""
        ranked = comparator.rank_plans(plans_to_rank, criteria="balanced")

        # Should return ranked results with reasons
        assert len(ranked) == 3
        for plan, rank, reason in ranked:
            assert isinstance(plan, GeneratedPlan)
            assert isinstance(rank, int)
            assert isinstance(reason, str)


class TestComplexityWeights:
    """Tests for complexity weight constants."""

    def test_complexity_weights_defined(self) -> None:
        """Test that all complexity weights are defined."""
        assert PlanComparator.COMPLEXITY_WEIGHTS["low"] == 1
        assert PlanComparator.COMPLEXITY_WEIGHTS["medium"] == 2
        assert PlanComparator.COMPLEXITY_WEIGHTS["high"] == 3

    def test_complexity_weights_ordering(self) -> None:
        """Test that weights are properly ordered."""
        weights = PlanComparator.COMPLEXITY_WEIGHTS
        assert weights["low"] < weights["medium"] < weights["high"]
