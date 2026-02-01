"""API routes for project health analysis and scoring."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import ProjectHealthScore, Session
from src.middleware.auth import get_current_user
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

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


class AnalysisStartRequest(BaseModel):
    """Request to start health analysis."""

    working_directory: str | None = None
    """Optional: Run all checks in this directory (relative to workspace root).
    Similar to folder selector in git widget. If not provided, each check
    uses its own configured working directory."""


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
    session_id: str,
    health_score_id: str,
    db_url: str,
    workspace_id: str,
    user_id: str,
    working_directory: str | None = None,
) -> None:
    """Background task to run project health analysis.

    Runs configured health checks in the workspace container and
    aggregates results into scores and recommendations.

    Args:
        session_id: Session ID
        health_score_id: Health score record ID
        db_url: Database URL for creating session
        workspace_id: Workspace container ID
        user_id: User ID
        working_directory: Optional directory to run all checks in
    """
    import structlog
    from sqlalchemy.ext.asyncio import AsyncSession as AS
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from src.health.analyzer import HealthAnalyzer

    logger = structlog.get_logger()

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

            logger.info(
                "Starting health analysis",
                session_id=session_id,
                workspace_id=workspace_id,
            )

            # Run the actual analysis
            analyzer = HealthAnalyzer(
                db=db,
                workspace_id=workspace_id,
                user_id=user_id,
                session_id=session_id,
            )

            analysis_result = await analyzer.run_analysis(
                working_directory_override=working_directory
            )

            # Track previous score for trend
            if health.overall_score > 0:
                health.previous_overall_score = health.overall_score
                health.score_change = analysis_result.overall_score - health.overall_score

            # Update scores from analysis result
            health.overall_score = analysis_result.overall_score
            health.grade = analysis_result.grade

            # Update individual category scores
            categories = analysis_result.categories

            if "code_quality" in categories:
                health.code_quality_score = int(categories["code_quality"].score)
                health.code_quality_details = categories["code_quality"].details
            else:
                health.code_quality_score = 0
                health.code_quality_details = {"no_checks": True}

            if "test_coverage" in categories:
                health.test_coverage_score = int(categories["test_coverage"].score)
                health.test_coverage_details = categories["test_coverage"].details
            else:
                health.test_coverage_score = 0
                health.test_coverage_details = {"no_checks": True}

            if "security" in categories:
                health.security_score = int(categories["security"].score)
                health.security_details = categories["security"].details
            else:
                health.security_score = 0
                health.security_details = {"no_checks": True}

            if "documentation" in categories:
                health.documentation_score = int(categories["documentation"].score)
                health.documentation_details = categories["documentation"].details
            else:
                health.documentation_score = 0
                health.documentation_details = {"no_checks": True}

            if "dependencies" in categories:
                health.dependency_score = int(categories["dependencies"].score)
                health.dependency_details = categories["dependencies"].details
            else:
                health.dependency_score = 0
                health.dependency_details = {"no_checks": True}

            # Store recommendations
            health.recommendations = analysis_result.recommendations

            # Update metadata
            health.analyzed_files_count = analysis_result.analyzed_files_count
            health.analysis_duration_seconds = analysis_result.analysis_duration_seconds
            health.analysis_status = "completed"
            health.analyzed_at = datetime.now(UTC)
            health.analysis_error = None

            await db.commit()

            logger.info(
                "Health analysis completed",
                session_id=session_id,
                overall_score=analysis_result.overall_score,
                grade=analysis_result.grade,
                checks_run=len(analysis_result.check_results),
            )

        except Exception as e:
            logger.exception(
                "Health analysis failed",
                session_id=session_id,
                error=str(e),
            )
            health.analysis_status = "failed"
            health.analysis_error = str(e)
            await db.commit()

        finally:
            await engine.dispose()


# ============================================================================
# Routes
# ============================================================================


@router.get("", response_model=HealthScoreResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_health_score(
    session_id: str,
    request: Request,
    response: Response,
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
@limiter.limit(RATE_LIMIT_STANDARD)
async def start_health_analysis(
    session_id: str,
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
    body: AnalysisStartRequest | None = None,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> AnalysisStartResponse:
    """Start a new health analysis for a session.

    Optionally specify a working_directory to run all checks in a specific folder
    (similar to the folder selector in the git widget).
    """
    user_id_raw = user["id"]
    if not user_id_raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User ID not found")
    user_id: str = user_id_raw
    working_directory = body.working_directory if body else None

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

    # Check if workspace exists
    if not session.workspace_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session has no workspace. Start the workspace first.",
        )

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

    # Start background analysis with workspace info
    background_tasks.add_task(
        run_health_analysis,
        session_id,
        health_score.id,
        db_url,
        session.workspace_id,
        user_id,
        working_directory,
    )

    return AnalysisStartResponse(
        id=health_score.id,
        status="pending",
        message="Health analysis started",
    )


@router.get("/recommendations", response_model=RecommendationsResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_recommendations(
    session_id: str,
    request: Request,
    response: Response,
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


class FixResponse(BaseModel):
    """Response for auto-fix operation."""

    status: str
    message: str
    recommendation_id: str
    output: str | None = None
    error: str | None = None


@router.post("/fix/{recommendation_id}", response_model=FixResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def auto_fix_recommendation(
    session_id: str,
    recommendation_id: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> FixResponse:
    """Apply an auto-fix for a recommendation.

    Executes the fix command in the workspace container.
    """
    from src.compute_client import get_compute_client_for_workspace
    from src.database.models import HealthCheck

    user_id_raw = user["id"]
    if not user_id_raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User ID not found")
    user_id: str = user_id_raw

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

    if not session.workspace_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session has no workspace",
        )

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

    fix_command = recommendation.get("fix_command")

    # If no fix_command in recommendation, try to get it from the check
    if not fix_command and recommendation.get("check_id"):
        check_result = await db.execute(
            select(HealthCheck).where(HealthCheck.id == recommendation.get("check_id"))
        )
        check = check_result.scalar_one_or_none()
        if check:
            fix_command = check.fix_command

    if not fix_command:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fix command available for this recommendation",
        )

    # Execute the fix command
    try:
        compute = await get_compute_client_for_workspace(session.workspace_id)
        exec_result = await compute.exec_command(
            workspace_id=session.workspace_id,
            user_id=user_id,
            command=fix_command,
            exec_timeout=120,  # 2 minute timeout for fixes
        )

        exit_code = exec_result.get("exit_code", 1)
        stdout = exec_result.get("stdout", "")
        stderr = exec_result.get("stderr", "")

        if exit_code == 0:
            return FixResponse(
                status="success",
                message=f"Successfully applied fix: {recommendation.get('title')}",
                recommendation_id=recommendation_id,
                output=stdout[:2000] if stdout else None,
            )
        return FixResponse(
            status="failed",
            message=f"Fix command failed with exit code {exit_code}",
            recommendation_id=recommendation_id,
            output=stdout[:1000] if stdout else None,
            error=stderr[:1000] if stderr else None,
        )

    except Exception as e:
        return FixResponse(
            status="error",
            message=f"Error executing fix: {e!s}",
            recommendation_id=recommendation_id,
            error=str(e),
        )


@router.get("/history", response_model=list[HealthHistoryItem])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_health_history(
    session_id: str,
    request: Request,
    response: Response,
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
