"""Health analyzer that orchestrates running all checks for a project.

Detects project type, runs applicable checks, and aggregates scores.
"""

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any

import structlog
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import HealthCheck
from src.health.check_runner import CheckResult, CheckRunner
from src.health.recommendations import generate_recommendations

logger = structlog.get_logger()

# Category weights for overall score calculation
CATEGORY_WEIGHTS = {
    "code_quality": 0.25,
    "test_coverage": 0.25,
    "security": 0.20,
    "documentation": 0.15,
    "dependencies": 0.15,
}


@dataclass
class CategoryResult:
    """Result for a single category."""

    category: str
    score: float
    grade: str
    checks: list[CheckResult]
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class HealthAnalysisResult:
    """Complete health analysis result."""

    overall_score: int
    grade: str
    categories: dict[str, CategoryResult]
    recommendations: list[dict[str, Any]]
    analyzed_files_count: int
    analysis_duration_seconds: float
    project_type: str | None = None
    check_results: list[CheckResult] = field(default_factory=list)


def _calculate_grade(score: float) -> str:
    """Convert score to letter grade."""
    if score >= 90:
        return "A"
    if score >= 80:
        return "B"
    if score >= 70:
        return "C"
    if score >= 60:
        return "D"
    return "F"


class HealthAnalyzer:
    """Analyzes project health by running configured checks."""

    def __init__(
        self,
        db: AsyncSession,
        workspace_id: str,
        user_id: str,
        session_id: str,
    ) -> None:
        """Initialize analyzer.

        Args:
            db: Database session
            workspace_id: Workspace to analyze
            user_id: User ID
            session_id: Session ID for session-specific checks
        """
        self.db = db
        self.workspace_id = workspace_id
        self.user_id = user_id
        self.session_id = session_id
        self.runner = CheckRunner(workspace_id, user_id)

    async def detect_project_type(self) -> str | None:
        """Detect project type based on files in workspace.

        Returns:
            Project type string (nodejs, python, go, rust, etc.) or None
        """
        from src.compute_client import compute_client  # noqa: PLC0415

        # Check for common project files
        checks = [
            ("package.json", "nodejs"),
            ("pyproject.toml", "python"),
            ("requirements.txt", "python"),
            ("Pipfile", "python"),
            ("go.mod", "go"),
            ("Cargo.toml", "rust"),
            ("tsconfig.json", "typescript"),
            ("next.config.js", "nextjs"),
            ("next.config.ts", "nextjs"),
            ("vite.config.ts", "react"),
            ("vue.config.js", "vue"),
        ]

        for filename, project_type in checks:
            try:
                result = await compute_client.exec_command(
                    workspace_id=self.workspace_id,
                    user_id=self.user_id,
                    command=f"test -f {filename} && echo 'found'",
                    exec_timeout=5,
                )
                if result.get("exit_code", 1) == 0 and "found" in result.get("stdout", ""):
                    logger.debug("Detected project type", project_type=project_type, file=filename)
                    return project_type
            except Exception as e:
                logger.debug("Project type detection check failed", file=filename, error=str(e))
                continue

        return None

    async def get_enabled_checks(self, project_type: str | None) -> list[HealthCheck]:
        """Get all enabled checks for this project.

        Includes:
        - Built-in checks matching project type
        - User's custom checks (user-wide)
        - Session-specific checks

        Args:
            project_type: Detected project type

        Returns:
            List of enabled HealthCheck records
        """
        # Query for applicable checks
        query = select(HealthCheck).where(
            HealthCheck.enabled == True,
            or_(
                # Built-in checks (no user_id)
                HealthCheck.user_id.is_(None),
                # User's custom checks
                HealthCheck.user_id == self.user_id,
            ),
            or_(
                # Not session-specific
                HealthCheck.session_id.is_(None),
                # Or this specific session
                HealthCheck.session_id == self.session_id,
            ),
        )

        result = await self.db.execute(query)
        all_checks = result.scalars().all()

        # Filter by project type
        applicable_checks = []
        for check in all_checks:
            # If check has project_types restriction, apply it
            if check.project_types:
                if project_type and project_type in check.project_types:
                    applicable_checks.append(check)
            else:
                # No restriction, include for all projects
                applicable_checks.append(check)

        logger.debug(
            "Found applicable checks",
            total=len(all_checks),
            applicable=len(applicable_checks),
            project_type=project_type,
        )

        return applicable_checks

    async def run_analysis(
        self,
        working_directory_override: str | None = None,
    ) -> HealthAnalysisResult:
        """Run full health analysis.

        Args:
            working_directory_override: If provided, run all checks in this directory
                instead of their individual configured directories

        Returns:
            HealthAnalysisResult with scores and recommendations
        """
        start_time = time.time()

        # Detect project type
        project_type = await self.detect_project_type()
        logger.info("Starting health analysis", project_type=project_type)

        # Get applicable checks
        checks = await self.get_enabled_checks(project_type)

        if not checks:
            logger.warning("No health checks found for project")
            return HealthAnalysisResult(
                overall_score=0,
                grade="N/A",
                categories={},
                recommendations=[
                    {
                        "id": "no_checks",
                        "type": "documentation",
                        "title": "No health checks available",
                        "description": "No health checks are configured for this project type.",
                        "priority": "low",
                        "auto_fixable": False,
                    }
                ],
                analyzed_files_count=0,
                analysis_duration_seconds=time.time() - start_time,
                project_type=project_type,
            )

        # Run checks concurrently
        # Use working_directory_override if provided, otherwise use check's configured directory  # noqa: E501
        check_tasks = [
            self.runner.run_check(
                check_id=check.id,
                check_name=check.name,
                category=check.category,
                command=check.command,
                working_directory=working_directory_override or check.working_directory,
                timeout=check.timeout,
                parse_mode=check.parse_mode,
                parse_config=check.parse_config,
                weight=check.weight,
            )
            for check in checks
        ]

        check_results = await asyncio.gather(*check_tasks, return_exceptions=True)

        # Process results, handling any exceptions
        valid_results: list[CheckResult] = []
        for i, result in enumerate(check_results):
            if isinstance(result, BaseException):
                logger.exception(
                    "Check failed with exception", check=checks[i].name, error=str(result)
                )
                valid_results.append(
                    CheckResult(
                        check_id=checks[i].id,
                        check_name=checks[i].name,
                        category=checks[i].category,
                        score=0,
                        weight=checks[i].weight,
                        success=False,
                        details={"error": str(result)},
                        error=str(result),
                    )
                )
            else:
                # Type narrowing: result is CheckResult here
                valid_results.append(result)

        # Aggregate by category
        categories: dict[str, CategoryResult] = {}
        for category in CATEGORY_WEIGHTS:
            category_checks = [r for r in valid_results if r.category == category]

            if not category_checks:
                categories[category] = CategoryResult(
                    category=category,
                    score=0,
                    grade="N/A",
                    checks=[],
                    details={"no_checks": True},
                )
                continue

            # Calculate weighted average for category
            total_weight = sum(c.weight for c in category_checks)
            if total_weight > 0:
                category_score = sum(c.score * c.weight for c in category_checks) / total_weight
            else:
                category_score = 0

            categories[category] = CategoryResult(
                category=category,
                score=category_score,
                grade=_calculate_grade(category_score),
                checks=category_checks,
                details={
                    "check_count": len(category_checks),
                    "successful_checks": len([c for c in category_checks if c.success]),
                },
            )

        # Calculate overall score using category weights
        overall_score = 0.0
        total_weight = 0.0
        for category, weight in CATEGORY_WEIGHTS.items():
            if category in categories and categories[category].checks:
                overall_score += categories[category].score * weight
                total_weight += weight

        if total_weight > 0:
            overall_score = overall_score / total_weight * (1 / max(0.01, total_weight))
            overall_score = min(100.0, overall_score * total_weight)

        overall_score_int = round(overall_score)

        # Generate recommendations
        recommendations = generate_recommendations(
            categories=categories,
            check_results=valid_results,
            checks=checks,
        )

        analysis_duration = time.time() - start_time

        logger.info(
            "Health analysis complete",
            overall_score=overall_score,
            grade=_calculate_grade(overall_score),
            checks_run=len(valid_results),
            duration_seconds=analysis_duration,
        )

        return HealthAnalysisResult(
            overall_score=overall_score_int,
            grade=_calculate_grade(overall_score),
            categories=categories,
            recommendations=recommendations,
            analyzed_files_count=len(valid_results),  # Approximate
            analysis_duration_seconds=analysis_duration,
            project_type=project_type,
            check_results=valid_results,
        )
