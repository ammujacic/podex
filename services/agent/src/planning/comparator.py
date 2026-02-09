"""Plan comparison utilities for evaluating and ranking plans."""

from dataclasses import dataclass
from typing import Any

import structlog

from .parallel import GeneratedPlan

logger = structlog.get_logger()


@dataclass
class PlanComparison:
    """Comparison between two or more plans."""

    plan_ids: list[str]
    complexity_scores: dict[str, int]  # plan_id -> complexity score (lower is better)
    step_counts: dict[str, int]  # plan_id -> number of steps
    files_touched: dict[str, int]  # plan_id -> unique files affected
    shared_files: list[str]  # Files affected by multiple plans
    unique_approaches: dict[str, list[str]]  # plan_id -> unique aspects
    recommendations: list[str]  # Comparative recommendations


@dataclass
class PlanDiff:
    """Difference between two plans."""

    plan_a_id: str
    plan_b_id: str
    steps_only_in_a: list[str]
    steps_only_in_b: list[str]
    similar_steps: list[tuple[str, str]]  # (step_a, step_b) pairs
    files_only_in_a: list[str]
    files_only_in_b: list[str]
    complexity_diff: int  # Positive means B is more complex


class PlanComparator:
    """
    Compares and ranks generated plans.

    Features:
    - Compare complexity scores
    - Find shared and unique aspects
    - Rank plans by various criteria
    - Generate comparison summaries
    """

    COMPLEXITY_WEIGHTS = {
        "low": 1,
        "medium": 2,
        "high": 3,
    }

    def compare_plans(self, plans: list[GeneratedPlan]) -> PlanComparison:
        """
        Compare multiple plans and generate comparison metrics.

        Args:
            plans: List of plans to compare

        Returns:
            PlanComparison with metrics and recommendations
        """
        if not plans:
            return PlanComparison(
                plan_ids=[],
                complexity_scores={},
                step_counts={},
                files_touched={},
                shared_files=[],
                unique_approaches={},
                recommendations=[],
            )

        complexity_scores: dict[str, int] = {}
        step_counts: dict[str, int] = {}
        files_touched: dict[str, int] = {}
        all_files: dict[str, list[str]] = {}  # file -> list of plan_ids

        for plan in plans:
            # Calculate complexity score
            score = sum(
                self.COMPLEXITY_WEIGHTS.get(step.estimated_complexity, 2) for step in plan.steps
            )
            complexity_scores[plan.id] = score
            step_counts[plan.id] = len(plan.steps)

            # Collect files
            files = set()
            for step in plan.steps:
                files.update(step.files_affected)
            files_touched[plan.id] = len(files)

            for f in files:
                if f not in all_files:
                    all_files[f] = []
                all_files[f].append(plan.id)

        # Find shared files (affected by multiple plans)
        shared_files = [f for f, plan_ids in all_files.items() if len(plan_ids) > 1]

        # Identify unique approaches
        unique_approaches: dict[str, list[str]] = {}
        for plan in plans:
            unique = []
            if plan.pros:
                unique.extend(plan.pros[:2])
            unique_approaches[plan.id] = unique

        # Generate recommendations
        recommendations = self._generate_recommendations(
            plans, complexity_scores, step_counts, files_touched
        )

        return PlanComparison(
            plan_ids=[p.id for p in plans],
            complexity_scores=complexity_scores,
            step_counts=step_counts,
            files_touched=files_touched,
            shared_files=shared_files,
            unique_approaches=unique_approaches,
            recommendations=recommendations,
        )

    def diff_plans(
        self,
        plan_a: GeneratedPlan,
        plan_b: GeneratedPlan,
    ) -> PlanDiff:
        """
        Generate a diff between two plans.

        Args:
            plan_a: First plan
            plan_b: Second plan

        Returns:
            PlanDiff with differences highlighted
        """
        # Get step titles
        steps_a = {step.title.lower(): step.title for step in plan_a.steps}
        steps_b = {step.title.lower(): step.title for step in plan_b.steps}

        steps_only_in_a = [steps_a[k] for k in steps_a.keys() - steps_b.keys()]
        steps_only_in_b = [steps_b[k] for k in steps_b.keys() - steps_a.keys()]

        # Find similar steps (same key)
        similar_steps = [(steps_a[k], steps_b[k]) for k in steps_a.keys() & steps_b.keys()]

        # Get files
        files_a = set()
        files_b = set()
        for step in plan_a.steps:
            files_a.update(step.files_affected)
        for step in plan_b.steps:
            files_b.update(step.files_affected)

        files_only_in_a = list(files_a - files_b)
        files_only_in_b = list(files_b - files_a)

        # Complexity diff
        complexity_a = sum(
            self.COMPLEXITY_WEIGHTS.get(step.estimated_complexity, 2) for step in plan_a.steps
        )
        complexity_b = sum(
            self.COMPLEXITY_WEIGHTS.get(step.estimated_complexity, 2) for step in plan_b.steps
        )

        return PlanDiff(
            plan_a_id=plan_a.id,
            plan_b_id=plan_b.id,
            steps_only_in_a=steps_only_in_a,
            steps_only_in_b=steps_only_in_b,
            similar_steps=similar_steps,
            files_only_in_a=files_only_in_a,
            files_only_in_b=files_only_in_b,
            complexity_diff=complexity_b - complexity_a,
        )

    def rank_plans(
        self,
        plans: list[GeneratedPlan],
        criteria: str = "balanced",
    ) -> list[tuple[GeneratedPlan, int, str]]:
        """
        Rank plans by specified criteria.

        Args:
            plans: Plans to rank
            criteria: Ranking criteria - "complexity", "minimal", "comprehensive", "balanced"

        Returns:
            List of (plan, rank, reason) tuples
        """
        if not plans:
            return []

        scored: list[tuple[GeneratedPlan, float, str]] = []

        for plan in plans:
            score = 0.0
            reason_parts = []

            # Calculate base complexity score
            complexity = sum(
                self.COMPLEXITY_WEIGHTS.get(step.estimated_complexity, 2) for step in plan.steps
            )

            step_count = len(plan.steps)
            file_count = len(set(f for step in plan.steps for f in step.files_affected))

            if criteria == "complexity":
                # Lower complexity is better
                score = -complexity
                reason_parts.append(f"complexity: {complexity}")

            elif criteria == "minimal":
                # Fewer steps and files is better
                score = -(step_count * 2 + file_count)
                reason_parts.append(f"steps: {step_count}, files: {file_count}")

            elif criteria == "comprehensive":
                # More thorough coverage is better
                score = step_count + file_count * 0.5 + len(plan.pros)
                reason_parts.append(f"coverage: {step_count} steps, {len(plan.pros)} benefits")

            else:  # balanced
                # Balance between complexity and thoroughness
                thoroughness = step_count + file_count * 0.3
                simplicity = 10 - (complexity / len(plan.steps) if plan.steps else 0)
                score = thoroughness * 0.4 + simplicity * 0.6
                reason_parts.append(f"balanced score: {score:.1f}")

            scored.append((plan, score, ", ".join(reason_parts)))

        # Sort by score descending
        scored.sort(key=lambda x: x[1], reverse=True)

        # Convert to ranks
        return [(plan, rank + 1, reason) for rank, (plan, _, reason) in enumerate(scored)]

    def _generate_recommendations(
        self,
        plans: list[GeneratedPlan],
        complexity_scores: dict[str, int],
        step_counts: dict[str, int],
        files_touched: dict[str, int],
    ) -> list[str]:
        """Generate comparative recommendations."""
        recommendations: list[str] = []

        if not plans:
            return recommendations

        # Find simplest plan
        simplest = min(plans, key=lambda p: complexity_scores.get(p.id, 0))
        recommendations.append(
            f"'{simplest.approach_name}' has the lowest complexity "
            f"({complexity_scores[simplest.id]} points)"
        )

        # Find most thorough plan
        most_thorough = max(plans, key=lambda p: step_counts.get(p.id, 0))
        if most_thorough.id != simplest.id:
            recommendations.append(
                f"'{most_thorough.approach_name}' is most thorough "
                f"with {step_counts[most_thorough.id]} steps"
            )

        # Find smallest footprint
        smallest_footprint = min(plans, key=lambda p: files_touched.get(p.id, 0))
        if smallest_footprint.id not in [simplest.id, most_thorough.id]:
            recommendations.append(
                f"'{smallest_footprint.approach_name}' affects the fewest files "
                f"({files_touched[smallest_footprint.id]} files)"
            )

        return recommendations

    def to_comparison_dict(self, comparison: PlanComparison) -> dict[str, Any]:
        """Convert comparison to dictionary for API response."""
        return {
            "plan_ids": comparison.plan_ids,
            "complexity_scores": comparison.complexity_scores,
            "step_counts": comparison.step_counts,
            "files_touched": comparison.files_touched,
            "shared_files": comparison.shared_files,
            "unique_approaches": comparison.unique_approaches,
            "recommendations": comparison.recommendations,
        }

    def to_diff_dict(self, diff: PlanDiff) -> dict[str, Any]:
        """Convert diff to dictionary for API response."""
        return {
            "plan_a_id": diff.plan_a_id,
            "plan_b_id": diff.plan_b_id,
            "steps_only_in_a": diff.steps_only_in_a,
            "steps_only_in_b": diff.steps_only_in_b,
            "similar_steps": [{"plan_a": a, "plan_b": b} for a, b in diff.similar_steps],
            "files_only_in_a": diff.files_only_in_a,
            "files_only_in_b": diff.files_only_in_b,
            "complexity_diff": diff.complexity_diff,
            "complexity_assessment": (
                "Plan B is more complex"
                if diff.complexity_diff > 0
                else "Plan A is more complex"
                if diff.complexity_diff < 0
                else "Equal complexity"
            ),
        }


# Global instance
_comparator: PlanComparator | None = None


def get_plan_comparator() -> PlanComparator:
    """Get or create the global plan comparator."""
    global _comparator
    if _comparator is None:
        _comparator = PlanComparator()
    return _comparator
