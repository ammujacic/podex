"""Recommendation generator for health analysis.

Generates actionable recommendations based on analysis results.
"""

import uuid
from typing import Any

from src.database.models import HealthCheck
from src.health.check_runner import CheckResult


def generate_recommendations(
    categories: dict[str, Any],  # noqa: ARG001
    check_results: list[CheckResult],
    checks: list[HealthCheck],
) -> list[dict[str, Any]]:
    """Generate recommendations based on health analysis results.

    Args:
        categories: Category results from analysis
        check_results: Individual check results
        checks: Original HealthCheck records (for fix commands)

    Returns:
        List of recommendation dicts
    """
    recommendations = []

    # Create lookup for checks by ID
    checks_by_id = {check.id: check for check in checks}

    for result in check_results:
        # Skip successful checks with high scores
        if result.success and result.score >= 80:
            continue

        check = checks_by_id.get(result.check_id)
        if not check:
            continue

        # Generate recommendation based on check type and score
        rec = _generate_recommendation_for_check(result, check)
        if rec:
            recommendations.append(rec)

    # Sort by priority (high first)
    priority_order = {"high": 0, "medium": 1, "low": 2}
    recommendations.sort(key=lambda r: priority_order.get(r.get("priority", "low"), 3))

    # Limit to top 10 recommendations
    return recommendations[:10]


def _generate_recommendation_for_check(
    result: CheckResult,
    check: HealthCheck,
) -> dict[str, Any] | None:
    """Generate a recommendation for a single check result.

    Args:
        result: Check result
        check: HealthCheck configuration

    Returns:
        Recommendation dict or None
    """
    # Determine priority based on score
    if result.score < 30:
        priority = "high"
    elif result.score < 60:
        priority = "medium"
    else:
        priority = "low"

    # Determine effort based on fix command availability
    if check.fix_command:
        effort = "low"
        auto_fixable = True
    else:
        effort = "medium"
        auto_fixable = False

    # Generate recommendation based on category and details
    title, description = _get_recommendation_text(result, check)

    if not title:
        return None

    return {
        "id": str(uuid.uuid4()),
        "type": result.category,
        "title": title,
        "description": description,
        "priority": priority,
        "effort": effort,
        "impact": _get_impact(result.category, result.score),
        "auto_fixable": auto_fixable,
        "fix_command": check.fix_command,
        "check_id": check.id,
        "check_name": check.name,
        "current_score": result.score,
    }


def _get_recommendation_text(
    result: CheckResult,
    check: HealthCheck,
) -> tuple[str | None, str]:
    """Get recommendation title and description based on check results.

    Args:
        result: Check result
        check: HealthCheck configuration

    Returns:
        Tuple of (title, description)
    """
    details = result.details
    category = result.category

    # Code quality recommendations
    if category == "code_quality":
        error_count = details.get("error_count", 0)
        warning_count = details.get("warning_count", 0)

        if error_count > 0:
            if check.fix_command:
                return (
                    f"Fix {error_count} linting errors",
                    f"Run '{check.fix_command}' to automatically fix linting errors. "
                    f"Found {error_count} errors and {warning_count} warnings.",
                )
            return (
                f"Fix {error_count} linting errors",
                f"Review and fix the {error_count} linting errors found by {check.name}. "
                f"Also found {warning_count} warnings.",
            )
        if warning_count > 5:
            return (
                f"Address {warning_count} linting warnings",
                f"Consider fixing the {warning_count} warnings found by {check.name} "
                "to improve code quality.",
            )

    # Test coverage recommendations
    elif category == "test_coverage":
        coverage = details.get("line_coverage") or details.get("percent_covered", 0)

        if coverage < 50:
            return (
                "Increase test coverage",
                f"Current test coverage is {coverage:.1f}%. "
                "Aim for at least 70% coverage by adding unit tests for critical paths.",
            )
        if coverage < 70:
            return (
                "Improve test coverage",
                f"Test coverage is at {coverage:.1f}%. "
                "Consider adding more tests to reach 80% coverage.",
            )

    # Security recommendations
    elif category == "security":
        critical = details.get("critical", 0)
        high = details.get("high", details.get("high_severity", 0))
        total = details.get("total", details.get("vulnerability_count", 0))

        if critical > 0:
            if check.fix_command:
                return (
                    f"Fix {critical} critical vulnerabilities",
                    f"Found {critical} critical security vulnerabilities. "
                    f"Run '{check.fix_command}' to fix what can be auto-resolved.",
                )
            return (
                f"Fix {critical} critical vulnerabilities",
                f"Found {critical} critical security vulnerabilities that require "
                "immediate attention. Review and update affected dependencies.",
            )
        if high > 0:
            return (
                f"Address {high} high-severity vulnerabilities",
                f"Found {high} high-severity security issues. "
                "Review the vulnerable dependencies and update where possible.",
            )
        if total > 0:
            return (
                f"Review {total} security findings",
                f"Found {total} security findings. "
                "Review and address based on your risk tolerance.",
            )

    # Documentation recommendations
    elif category == "documentation":
        has_readme = details.get("has_readme", False)
        line_count = details.get("line_count", 0)

        if not has_readme or line_count == 0:
            return (
                "Add README documentation",
                "Create a README.md file with project description, setup instructions, "
                "and usage examples.",
            )
        if line_count < 20:
            return (
                "Expand README documentation",
                "The README is minimal. Add sections for installation, usage, contributing, "
                "and license.",
            )

    # Dependencies recommendations
    elif category == "dependencies":
        major = details.get("major_outdated", 0)
        total = details.get("total_outdated", details.get("outdated_count", 0))

        if major > 0:
            return (
                f"Update {major} major version dependencies",
                f"Found {major} packages with major updates available. "
                "Review changelogs and update carefully to avoid breaking changes.",
            )
        if total > 5:
            if check.fix_command:
                return (
                    f"Update {total} outdated dependencies",
                    f"Run '{check.fix_command}' to update minor and patch versions. "
                    f"Found {total} outdated packages.",
                )
            return (
                f"Update {total} outdated dependencies",
                f"Found {total} outdated packages. Consider updating to get bug fixes "
                "and improvements.",
            )

    # Generic recommendation for failed checks
    if not result.success:
        return (
            f"Fix {check.name} check",
            f"The {check.name} check failed. Error: {result.error or 'Unknown error'}",
        )

    # Generic recommendation for low scores
    if result.score < 50:
        return (
            f"Improve {check.name} score",
            f"The {check.name} check scored {result.score:.0f}/100. "
            "Review the detailed output and address the identified issues.",
        )

    return None, ""


def _get_impact(category: str, score: float) -> str:
    """Determine impact level based on category and score.

    Args:
        category: Check category
        score: Current score

    Returns:
        Impact level (high, medium, low)
    """
    # Security issues always have high impact when score is low
    if category == "security" and score < 50:
        return "high"

    # Code quality has medium impact
    if category == "code_quality":
        return "medium" if score < 50 else "low"

    # Test coverage has high impact when very low
    if category == "test_coverage":
        if score < 30:
            return "high"
        if score < 60:
            return "medium"
        return "low"

    # Documentation has low impact
    if category == "documentation":
        return "low"

    # Dependencies have medium impact
    if category == "dependencies":
        return "medium" if score < 50 else "low"

    return "medium"
