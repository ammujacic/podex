"""API routes for project health analysis and scoring."""

from __future__ import annotations

import asyncio
import random
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import ProjectHealthScore, Session
from src.middleware.auth import get_current_user

router = APIRouter(prefix="/sessions/{session_id}/health", tags=["project-health"])


# ============================================================================
# Response Models
# ============================================================================


class MetricScore(BaseModel):
    """Individual metric score with details."""

    score: int
    grade: str
    details: dict[str, Any] | None = None


class Recommendation(BaseModel):
    """Health improvement recommendation."""

    id: str
    type: str  # code_quality, test_coverage, security, documentation, dependencies
    title: str
    description: str
    priority: str  # high, medium, low
    effort: str  # low, medium, high
    impact: str  # low, medium, high
    auto_fixable: bool = False


class HealthScoreResponse(BaseModel):
    """Project health score response."""

    id: str
    session_id: str
    overall_score: int
    grade: str

    # Individual scores
    code_quality: MetricScore
    test_coverage: MetricScore
    security: MetricScore
    documentation: MetricScore
    dependencies: MetricScore

    # Metadata
    analyzed_files_count: int
    analysis_duration_seconds: float
    analysis_status: str
    analyzed_at: str | None

    # Trend
    previous_score: int | None
    score_change: int | None


class HealthHistoryItem(BaseModel):
    """Historical health score item."""

    date: str
    overall_score: int
    grade: str


class RecommendationsResponse(BaseModel):
    """List of recommendations with summary."""

    total_count: int
    by_priority: dict[str, int]
    by_type: dict[str, int]
    recommendations: list[Recommendation]


class AnalysisStartResponse(BaseModel):
    """Response after starting analysis."""

    id: str
    status: str
    message: str


# ============================================================================
# Helper Functions
# ============================================================================


def calculate_grade(score: int) -> str:
    """Convert numeric score to letter grade."""
    if score >= 90:
        return "A"
    if score >= 80:
        return "B"
    if score >= 70:
        return "C"
    if score >= 60:
        return "D"
    return "F"


async def run_health_analysis(
    _session_id: str,
    health_score_id: str,
    db_url: str,
) -> None:
    """Background task to run project health analysis.

    This is a simplified simulation. In production, this would:
    - Connect to the compute node
    - Run linting tools (eslint, pylint, etc.)
    - Run test coverage analysis
    - Scan for security vulnerabilities
    - Check documentation coverage
    - Analyze dependencies
    """
    from sqlalchemy.ext.asyncio import AsyncSession as AS
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    engine = create_async_engine(db_url)
    async_session = async_sessionmaker(engine, class_=AS, expire_on_commit=False)

    async with async_session() as db:
        # Get the health score record
        result = await db.execute(
            select(ProjectHealthScore).where(ProjectHealthScore.id == health_score_id)
        )
        health = result.scalar_one_or_none()

        if not health:
            return

        try:
            # Update to running status
            health.analysis_status = "running"
            await db.commit()

            start_time = datetime.now(UTC)

            # Simulate analysis delay (in production, actual analysis happens here)
            await asyncio.sleep(2)

            # Simulate analysis results
            # In production, these would come from actual tool runs
            code_quality_score = random.randint(65, 98)
            test_coverage_score = random.randint(40, 95)
            security_score = random.randint(70, 100)
            documentation_score = random.randint(30, 90)
            dependency_score = random.randint(60, 95)

            # Calculate weighted overall score
            overall_score = int(
                code_quality_score * 0.25
                + test_coverage_score * 0.25
                + security_score * 0.20
                + documentation_score * 0.15
                + dependency_score * 0.15
            )

            # Track previous score for trend
            if health.overall_score > 0:
                health.previous_overall_score = health.overall_score
                health.score_change = overall_score - health.overall_score

            # Update scores
            health.overall_score = overall_score
            health.grade = calculate_grade(overall_score)
            health.code_quality_score = code_quality_score
            health.test_coverage_score = test_coverage_score
            health.security_score = security_score
            health.documentation_score = documentation_score
            health.dependency_score = dependency_score

            # Generate detailed metrics
            health.code_quality_details = {
                "linting_errors": random.randint(0, 15),
                "complexity_issues": random.randint(0, 8),
                "duplication_percent": round(random.uniform(0, 10), 1),
                "maintainability_index": random.randint(60, 100),
            }
            health.test_coverage_details = {
                "line_coverage": round(random.uniform(50, 95), 1),
                "branch_coverage": round(random.uniform(40, 90), 1),
                "function_coverage": round(random.uniform(60, 100), 1),
                "test_count": random.randint(10, 200),
                "passing_tests": random.randint(10, 200),
            }
            health.security_details = {
                "vulnerabilities_critical": random.randint(0, 2),
                "vulnerabilities_high": random.randint(0, 5),
                "vulnerabilities_medium": random.randint(0, 10),
                "vulnerabilities_low": random.randint(0, 15),
                "secrets_found": random.randint(0, 3),
            }
            health.documentation_details = {
                "has_readme": True,
                "readme_quality_score": random.randint(50, 100),
                "api_docs_coverage": round(random.uniform(20, 90), 1),
                "inline_comment_ratio": round(random.uniform(5, 25), 1),
            }
            health.dependency_details = {
                "total_dependencies": random.randint(20, 100),
                "outdated_count": random.randint(0, 15),
                "deprecated_count": random.randint(0, 3),
                "vulnerable_count": random.randint(0, 5),
            }

            # Generate recommendations
            recommendations = []

            if health.code_quality_details["linting_errors"] > 5:
                recommendations.append(
                    {
                        "id": str(uuid.uuid4()),
                        "type": "code_quality",
                        "title": "Fix linting errors",
                        "description": (
                            f"Found {health.code_quality_details['linting_errors']} "
                            "linting errors that should be addressed."
                        ),
                        "priority": "medium",
                        "effort": "low",
                        "impact": "medium",
                        "auto_fixable": True,
                    }
                )

            if health.test_coverage_details["line_coverage"] < 70:
                recommendations.append(
                    {
                        "id": str(uuid.uuid4()),
                        "type": "test_coverage",
                        "title": "Improve test coverage",
                        "description": (
                            f"Line coverage is {health.test_coverage_details['line_coverage']}%. "
                            "Aim for at least 70%."
                        ),
                        "priority": "high",
                        "effort": "high",
                        "impact": "high",
                        "auto_fixable": False,
                    }
                )

            if health.security_details["vulnerabilities_critical"] > 0:
                recommendations.append(
                    {
                        "id": str(uuid.uuid4()),
                        "type": "security",
                        "title": "Fix critical vulnerabilities",
                        "description": (
                            f"Found {health.security_details['vulnerabilities_critical']} "
                            "critical security vulnerabilities."
                        ),
                        "priority": "high",
                        "effort": "medium",
                        "impact": "high",
                        "auto_fixable": False,
                    }
                )

            if health.security_details["secrets_found"] > 0:
                recommendations.append(
                    {
                        "id": str(uuid.uuid4()),
                        "type": "security",
                        "title": "Remove exposed secrets",
                        "description": (
                            f"Found {health.security_details['secrets_found']} "
                            "potential secrets in code."
                        ),
                        "priority": "high",
                        "effort": "low",
                        "impact": "high",
                        "auto_fixable": False,
                    }
                )

            if health.documentation_details["api_docs_coverage"] < 50:
                recommendations.append(
                    {
                        "id": str(uuid.uuid4()),
                        "type": "documentation",
                        "title": "Improve API documentation",
                        "description": (
                            f"API documentation coverage is only "
                            f"{health.documentation_details['api_docs_coverage']}%."
                        ),
                        "priority": "low",
                        "effort": "medium",
                        "impact": "medium",
                        "auto_fixable": False,
                    }
                )

            if health.dependency_details["outdated_count"] > 5:
                recommendations.append(
                    {
                        "id": str(uuid.uuid4()),
                        "type": "dependencies",
                        "title": "Update outdated dependencies",
                        "description": (
                            f"{health.dependency_details['outdated_count']} "
                            "dependencies are outdated."
                        ),
                        "priority": "medium",
                        "effort": "low",
                        "impact": "medium",
                        "auto_fixable": True,
                    }
                )

            health.recommendations = recommendations

            # Update metadata
            end_time = datetime.now(UTC)
            health.analyzed_files_count = random.randint(50, 500)
            health.analysis_duration_seconds = (end_time - start_time).total_seconds()
            health.analysis_status = "completed"
            health.analyzed_at = end_time
            health.analysis_error = None

            await db.commit()

        except Exception as e:
            health.analysis_status = "failed"
            health.analysis_error = str(e)
            await db.commit()

        finally:
            await engine.dispose()


# ============================================================================
# Routes
# ============================================================================


@router.get("", response_model=HealthScoreResponse)
async def get_health_score(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> HealthScoreResponse:
    """Get the latest health score for a session."""
    user_id = user["id"]

    # Verify session ownership
    session_result = await db.execute(
        select(Session).where(
            Session.id == session_id,
            Session.owner_id == user_id,
        )
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    # Get latest health score
    result = await db.execute(
        select(ProjectHealthScore)
        .where(ProjectHealthScore.session_id == session_id)
        .order_by(ProjectHealthScore.created_at.desc())
        .limit(1)
    )
    health = result.scalar_one_or_none()

    if not health:
        # Return empty score if no analysis has been run
        return HealthScoreResponse(
            id="",
            session_id=session_id,
            overall_score=0,
            grade="N/A",
            code_quality=MetricScore(score=0, grade="N/A"),
            test_coverage=MetricScore(score=0, grade="N/A"),
            security=MetricScore(score=0, grade="N/A"),
            documentation=MetricScore(score=0, grade="N/A"),
            dependencies=MetricScore(score=0, grade="N/A"),
            analyzed_files_count=0,
            analysis_duration_seconds=0,
            analysis_status="not_run",
            analyzed_at=None,
            previous_score=None,
            score_change=None,
        )

    return HealthScoreResponse(
        id=health.id,
        session_id=health.session_id,
        overall_score=health.overall_score,
        grade=health.grade,
        code_quality=MetricScore(
            score=health.code_quality_score,
            grade=calculate_grade(health.code_quality_score),
            details=health.code_quality_details,
        ),
        test_coverage=MetricScore(
            score=health.test_coverage_score,
            grade=calculate_grade(health.test_coverage_score),
            details=health.test_coverage_details,
        ),
        security=MetricScore(
            score=health.security_score,
            grade=calculate_grade(health.security_score),
            details=health.security_details,
        ),
        documentation=MetricScore(
            score=health.documentation_score,
            grade=calculate_grade(health.documentation_score),
            details=health.documentation_details,
        ),
        dependencies=MetricScore(
            score=health.dependency_score,
            grade=calculate_grade(health.dependency_score),
            details=health.dependency_details,
        ),
        analyzed_files_count=health.analyzed_files_count,
        analysis_duration_seconds=health.analysis_duration_seconds,
        analysis_status=health.analysis_status,
        analyzed_at=health.analyzed_at.isoformat() if health.analyzed_at else None,
        previous_score=health.previous_overall_score,
        score_change=health.score_change,
    )


@router.post("/analyze", response_model=AnalysisStartResponse)
async def start_health_analysis(
    session_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> AnalysisStartResponse:
    """Start a new health analysis for a session."""
    user_id = user["id"]

    # Verify session ownership
    session_result = await db.execute(
        select(Session).where(
            Session.id == session_id,
            Session.owner_id == user_id,
        )
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    # Check if analysis is already running
    result = await db.execute(
        select(ProjectHealthScore).where(
            ProjectHealthScore.session_id == session_id,
            ProjectHealthScore.analysis_status == "running",
        )
    )
    running = result.scalar_one_or_none()
    if running:
        return AnalysisStartResponse(
            id=running.id,
            status="running",
            message="Analysis is already in progress",
        )

    # Create new health score record
    health_score = ProjectHealthScore(
        session_id=session_id,
        user_id=user_id,
        analysis_status="pending",
    )
    db.add(health_score)
    await db.commit()
    await db.refresh(health_score)

    # Get database URL for background task
    from src.config import settings

    db_url = settings.DATABASE_URL

    # Start background analysis
    background_tasks.add_task(
        run_health_analysis,
        session_id,
        health_score.id,
        db_url,
    )

    return AnalysisStartResponse(
        id=health_score.id,
        status="pending",
        message="Health analysis started",
    )


@router.get("/recommendations", response_model=RecommendationsResponse)
async def get_recommendations(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> RecommendationsResponse:
    """Get health improvement recommendations."""
    user_id = user["id"]

    # Verify session ownership
    session_result = await db.execute(
        select(Session).where(
            Session.id == session_id,
            Session.owner_id == user_id,
        )
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    # Get latest health score with recommendations
    result = await db.execute(
        select(ProjectHealthScore)
        .where(ProjectHealthScore.session_id == session_id)
        .order_by(ProjectHealthScore.created_at.desc())
        .limit(1)
    )
    health = result.scalar_one_or_none()

    if not health or not health.recommendations:
        return RecommendationsResponse(
            total_count=0,
            by_priority={},
            by_type={},
            recommendations=[],
        )

    # Parse recommendations
    recommendations = [Recommendation(**r) for r in health.recommendations]

    # Count by priority
    by_priority: dict[str, int] = {}
    by_type: dict[str, int] = {}
    for rec in recommendations:
        by_priority[rec.priority] = by_priority.get(rec.priority, 0) + 1
        by_type[rec.type] = by_type.get(rec.type, 0) + 1

    return RecommendationsResponse(
        total_count=len(recommendations),
        by_priority=by_priority,
        by_type=by_type,
        recommendations=recommendations,
    )


@router.post("/fix/{recommendation_id}", response_model=dict[str, str])
async def auto_fix_recommendation(
    session_id: str,
    recommendation_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> dict[str, str]:
    """Attempt to auto-fix a recommendation via agent.

    This would trigger the agent to apply the fix automatically
    for recommendations that support auto-fixing.
    """
    user_id = user["id"]

    # Verify session ownership
    session_result = await db.execute(
        select(Session).where(
            Session.id == session_id,
            Session.owner_id == user_id,
        )
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    # Get latest health score
    result = await db.execute(
        select(ProjectHealthScore)
        .where(ProjectHealthScore.session_id == session_id)
        .order_by(ProjectHealthScore.created_at.desc())
        .limit(1)
    )
    health = result.scalar_one_or_none()

    if not health or not health.recommendations:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No recommendations found",
        )

    # Find the recommendation
    recommendation = None
    for rec in health.recommendations:
        if rec.get("id") == recommendation_id:
            recommendation = rec
            break

    if not recommendation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recommendation not found",
        )

    if not recommendation.get("auto_fixable"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This recommendation cannot be auto-fixed",
        )

    # In production, this would trigger the agent to apply the fix
    # For now, return a success message
    return {
        "status": "initiated",
        "message": f"Auto-fix initiated for: {recommendation.get('title')}",
        "recommendation_id": recommendation_id,
    }


@router.get("/history", response_model=list[HealthHistoryItem])
async def get_health_history(
    session_id: str,
    limit: int = 30,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> list[HealthHistoryItem]:
    """Get health score history for a session."""
    user_id = user["id"]

    # Verify session ownership
    session_result = await db.execute(
        select(Session).where(
            Session.id == session_id,
            Session.owner_id == user_id,
        )
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    # Get health score history
    result = await db.execute(
        select(ProjectHealthScore)
        .where(
            ProjectHealthScore.session_id == session_id,
            ProjectHealthScore.analysis_status == "completed",
        )
        .order_by(ProjectHealthScore.analyzed_at.desc())
        .limit(limit)
    )
    scores = result.scalars().all()

    return [
        HealthHistoryItem(
            date=s.analyzed_at.isoformat() if s.analyzed_at else s.created_at.isoformat(),
            overall_score=s.overall_score,
            grade=s.grade,
        )
        for s in scores
    ]
