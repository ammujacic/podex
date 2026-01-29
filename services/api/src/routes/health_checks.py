"""Health checks CRUD API for managing custom health checks.

Allows users to create, update, delete, and test custom health checks.
"""

from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import HealthCheck
from src.database.models import Session as SessionModel
from src.health.check_runner import CheckRunner
from src.middleware.auth import get_current_user

logger = structlog.get_logger()

router = APIRouter(prefix="/health/checks", tags=["health-checks"])


# ==================== Pydantic Models ====================


class ParseConfigBase(BaseModel):
    """Base parse config that's common to all modes."""


class HealthCheckCreate(BaseModel):
    """Request model for creating a health check."""

    category: str = Field(
        ...,
        description="Category: code_quality, test_coverage, security, documentation, dependencies",
    )
    name: str = Field(..., max_length=255, description="Display name")
    description: str | None = Field(None, description="Description of what this check does")
    command: str = Field(..., description="Shell command to execute")
    working_directory: str | None = Field(
        None, description="Working directory (relative to workspace root)"
    )
    timeout: int = Field(60, ge=5, le=600, description="Command timeout in seconds")
    parse_mode: str = Field(
        ...,
        description="Parse mode: exit_code, json, regex, line_count",
    )
    parse_config: dict[str, Any] = Field(..., description="Mode-specific parsing configuration")
    weight: float = Field(1.0, ge=0.1, le=10.0, description="Weight for this check")
    session_id: str | None = Field(None, description="Session ID for session-specific check")
    project_types: list[str] | None = Field(
        None,
        description="Project types this check applies to (None = all)",
    )
    fix_command: str | None = Field(None, description="Auto-fix command (optional)")


class HealthCheckUpdate(BaseModel):
    """Request model for updating a health check."""

    name: str | None = Field(None, max_length=255)
    description: str | None = None
    command: str | None = None
    working_directory: str | None = None
    timeout: int | None = Field(None, ge=5, le=600)
    parse_mode: str | None = None
    parse_config: dict[str, Any] | None = None
    weight: float | None = Field(None, ge=0.1, le=10.0)
    enabled: bool | None = None
    project_types: list[str] | None = None
    fix_command: str | None = None


class HealthCheckResponse(BaseModel):
    """Response model for a health check."""

    id: str
    category: str
    name: str
    description: str | None
    command: str
    working_directory: str | None
    timeout: int
    parse_mode: str
    parse_config: dict[str, Any]
    weight: float
    enabled: bool
    is_builtin: bool
    project_types: list[str] | None
    fix_command: str | None
    user_id: str | None
    session_id: str | None

    model_config = ConfigDict(from_attributes=True)


class HealthCheckTestRequest(BaseModel):
    """Request model for testing a health check."""

    session_id: str = Field(..., description="Session ID with workspace to test in")


class HealthCheckTestResponse(BaseModel):
    """Response model for health check test results."""

    success: bool
    score: float
    details: dict[str, Any]
    raw_output: str | None
    execution_time_ms: float
    error: str | None = None


# ==================== Endpoints ====================


@router.get("", response_model=list[HealthCheckResponse])
async def list_health_checks(
    category: str | None = None,
    include_builtin: bool = True,
    session_id: str | None = None,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[HealthCheckResponse]:
    """List health checks for the current user.

    Returns built-in checks plus user's custom checks.
    Optionally filter by category or session.
    """
    query = select(HealthCheck).where(
        or_(
            # Built-in checks
            HealthCheck.is_builtin == True if include_builtin else False,
            # User's checks
            HealthCheck.user_id == current_user["user_id"],
        )
    )

    if category:
        query = query.where(HealthCheck.category == category)

    if session_id:
        query = query.where(
            or_(
                HealthCheck.session_id.is_(None),
                HealthCheck.session_id == session_id,
            )
        )

    query = query.order_by(HealthCheck.category, HealthCheck.is_builtin.desc(), HealthCheck.name)

    result = await db.execute(query)
    checks = result.scalars().all()

    return [HealthCheckResponse.model_validate(check) for check in checks]


@router.get("/defaults", response_model=list[HealthCheckResponse])
async def list_default_checks(
    category: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[HealthCheckResponse]:
    """List built-in default health checks.

    These are the checks that come pre-configured with the platform.
    """
    query = select(HealthCheck).where(HealthCheck.is_builtin == True)

    if category:
        query = query.where(HealthCheck.category == category)

    query = query.order_by(HealthCheck.category, HealthCheck.name)

    result = await db.execute(query)
    checks = result.scalars().all()

    return [HealthCheckResponse.model_validate(check) for check in checks]


@router.get("/{check_id}", response_model=HealthCheckResponse)
async def get_health_check(
    check_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> HealthCheckResponse:
    """Get a specific health check by ID."""
    result = await db.execute(select(HealthCheck).where(HealthCheck.id == check_id))
    check = result.scalar_one_or_none()

    if not check:
        raise HTTPException(status_code=404, detail="Health check not found")

    # Verify access (own check or built-in)
    if not check.is_builtin and check.user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Access denied")

    return HealthCheckResponse.model_validate(check)


@router.post("", response_model=HealthCheckResponse, status_code=status.HTTP_201_CREATED)
async def create_health_check(
    request: HealthCheckCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> HealthCheckResponse:
    """Create a new custom health check."""
    # Validate category
    valid_categories = [
        "code_quality",
        "test_coverage",
        "security",
        "documentation",
        "dependencies",
    ]
    if request.category not in valid_categories:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid category. Must be one of: {', '.join(valid_categories)}",
        )

    # Validate parse mode
    valid_parse_modes = ["exit_code", "json", "regex", "line_count"]
    if request.parse_mode not in valid_parse_modes:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid parse_mode. Must be one of: {', '.join(valid_parse_modes)}",
        )

    # Verify session ownership if session_id provided
    if request.session_id:
        session_result = await db.execute(
            select(SessionModel).where(SessionModel.id == request.session_id)
        )
        session = session_result.scalar_one_or_none()
        if not session or session.owner_id != current_user["user_id"]:
            raise HTTPException(status_code=403, detail="Session not found or access denied")

    # Create check
    check = HealthCheck(
        category=request.category,
        name=request.name,
        description=request.description,
        command=request.command,
        working_directory=request.working_directory,
        timeout=request.timeout,
        parse_mode=request.parse_mode,
        parse_config=request.parse_config,
        weight=request.weight,
        enabled=True,
        is_builtin=False,
        project_types=request.project_types,
        fix_command=request.fix_command,
        user_id=current_user["user_id"],
        session_id=request.session_id,
    )

    db.add(check)
    await db.commit()
    await db.refresh(check)

    logger.info(
        "Created custom health check",
        check_id=check.id,
        name=check.name,
        category=check.category,
        user_id=current_user["user_id"],
    )

    return HealthCheckResponse.model_validate(check)


@router.put("/{check_id}", response_model=HealthCheckResponse)
async def update_health_check(
    check_id: str,
    request: HealthCheckUpdate,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> HealthCheckResponse:
    """Update an existing health check.

    Built-in checks cannot be modified (only enabled/disabled).
    """
    result = await db.execute(select(HealthCheck).where(HealthCheck.id == check_id))
    check = result.scalar_one_or_none()

    if not check:
        raise HTTPException(status_code=404, detail="Health check not found")

    # Verify ownership for custom checks
    if not check.is_builtin and check.user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Access denied")

    # For built-in checks, only allow toggling enabled state
    if check.is_builtin:
        if request.enabled is not None:
            # Create a user override for the built-in check
            # For now, we don't support overriding built-in checks
            raise HTTPException(
                status_code=400,
                detail="Built-in checks cannot be modified. Create a custom check instead.",
            )
        return HealthCheckResponse.model_validate(check)

    # Update fields
    update_data = request.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(check, field, value)

    await db.commit()
    await db.refresh(check)

    logger.info(
        "Updated health check",
        check_id=check.id,
        user_id=current_user["user_id"],
    )

    return HealthCheckResponse.model_validate(check)


@router.delete("/{check_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_health_check(
    check_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a custom health check.

    Built-in checks cannot be deleted.
    """
    result = await db.execute(select(HealthCheck).where(HealthCheck.id == check_id))
    check = result.scalar_one_or_none()

    if not check:
        raise HTTPException(status_code=404, detail="Health check not found")

    if check.is_builtin:
        raise HTTPException(status_code=400, detail="Cannot delete built-in checks")

    if check.user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Access denied")

    await db.delete(check)
    await db.commit()

    logger.info(
        "Deleted health check",
        check_id=check_id,
        user_id=current_user["user_id"],
    )


@router.post("/{check_id}/test", response_model=HealthCheckTestResponse)
async def test_health_check(
    check_id: str,
    request: HealthCheckTestRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> HealthCheckTestResponse:
    """Test a health check by running it in a workspace.

    Useful for previewing results before saving a custom check.
    """
    # Get check
    result = await db.execute(select(HealthCheck).where(HealthCheck.id == check_id))
    check = result.scalar_one_or_none()

    if not check:
        raise HTTPException(status_code=404, detail="Health check not found")

    # Verify check access
    if not check.is_builtin and check.user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Access denied")

    # Verify session ownership and get workspace
    session_result = await db.execute(
        select(SessionModel).where(SessionModel.id == request.session_id)
    )
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Session not found or access denied")

    if not session.workspace_id:
        raise HTTPException(status_code=400, detail="Session has no workspace")

    # Run the check
    runner = CheckRunner(session.workspace_id, current_user["user_id"])

    check_result = await runner.run_check(
        check_id=check.id,
        check_name=check.name,
        category=check.category,
        command=check.command,
        working_directory=check.working_directory,
        timeout=check.timeout,
        parse_mode=check.parse_mode,
        parse_config=check.parse_config,
        weight=check.weight,
    )

    return HealthCheckTestResponse(
        success=check_result.success,
        score=check_result.score,
        details=check_result.details,
        raw_output=check_result.raw_output,
        execution_time_ms=check_result.execution_time_ms,
        error=check_result.error,
    )


@router.post("/test-command", response_model=HealthCheckTestResponse)
async def test_custom_command(
    session_id: str,
    command: str,
    working_directory: str | None = None,
    timeout: int = 60,  # noqa: ASYNC109
    parse_mode: str = "exit_code",
    parse_config: dict[str, Any] | None = None,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> HealthCheckTestResponse:
    """Test a custom command without creating a check.

    Useful for trying out commands before saving.
    """
    # Verify session ownership
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == session_id))
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Session not found or access denied")

    if not session.workspace_id:
        raise HTTPException(status_code=400, detail="Session has no workspace")

    # Run the command
    runner = CheckRunner(session.workspace_id, current_user["user_id"])

    check_result = await runner.run_check(
        check_id="test",
        check_name="Test Command",
        category="test",
        command=command,
        working_directory=working_directory,
        timeout=min(timeout, 120),  # Cap at 2 minutes for tests
        parse_mode=parse_mode,
        parse_config=parse_config
        or {"success_codes": [0], "score_on_success": 100, "score_on_failure": 0},
        weight=1.0,
    )

    return HealthCheckTestResponse(
        success=check_result.success,
        score=check_result.score,
        details=check_result.details,
        raw_output=check_result.raw_output,
        execution_time_ms=check_result.execution_time_ms,
        error=check_result.error,
    )
