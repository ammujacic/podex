"""API routes for user skills management."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import SkillExecution, SkillVersion, SystemSkill, UserSkill
from src.middleware.auth import get_current_user, get_optional_user_id

router = APIRouter(prefix="/skills", tags=["skills"])


# ============================================================================
# Request/Response Models
# ============================================================================


class SkillStep(BaseModel):
    """A single step in a skill."""

    action: str
    description: str
    tool: str | None = None
    parameters: dict[str, Any] | None = None


class SkillCreateRequest(BaseModel):
    """Request to create a new skill."""

    name: str = Field(..., min_length=1, max_length=100)
    slug: str = Field(..., min_length=1, max_length=100, pattern=r"^[a-z0-9_-]+$")
    description: str = Field(..., min_length=1, max_length=500)
    version: str = Field(default="1.0.0")
    triggers: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    required_tools: list[str] = Field(default_factory=list)
    steps: list[SkillStep]
    system_prompt: str | None = None
    is_public: bool = False


class SkillUpdateRequest(BaseModel):
    """Request to update an existing skill."""

    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = Field(None, min_length=1, max_length=500)
    version: str | None = None
    triggers: list[str] | None = None
    tags: list[str] | None = None
    required_tools: list[str] | None = None
    steps: list[SkillStep] | None = None
    system_prompt: str | None = None
    is_public: bool | None = None


class SkillResponse(BaseModel):
    """Response containing skill details."""

    id: str
    user_id: str
    name: str
    slug: str
    description: str
    version: str
    triggers: list[str]
    tags: list[str]
    required_tools: list[str]
    steps: list[dict[str, Any]]
    system_prompt: str | None
    generated_by_agent: bool
    source_conversation_id: str | None
    is_public: bool
    usage_count: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SkillListResponse(BaseModel):
    """Paginated list of skills."""

    skills: list[SkillResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class SkillStatsResponse(BaseModel):
    """Statistics about user's skills."""

    total_skills: int
    total_executions: int
    agent_generated: int
    user_created: int
    public_skills: int
    by_tag: dict[str, int]
    most_used: list[dict[str, Any]]


# ============================================================================
# Available Skills Response (for agents)
# ============================================================================


class AvailableSkillResponse(BaseModel):
    """A skill available for agents to use (system or user skill)."""

    id: str  # Skill ID for execution tracking
    slug: str
    name: str
    description: str
    version: str
    author: str
    skill_type: str  # "system" or "user"
    triggers: list[str]
    tags: list[str]
    required_tools: list[str]
    required_context: list[str]
    steps: list[dict[str, Any]]
    system_prompt: str | None
    examples: list[dict[str, Any]] | None
    metadata: dict[str, Any] | None


class AvailableSkillsResponse(BaseModel):
    """List of all available skills for agents."""

    skills: list[AvailableSkillResponse]
    total_system: int
    total_user: int


# ============================================================================
# Versioning Response Models
# ============================================================================


class SkillVersionResponse(BaseModel):
    """Response containing skill version details."""

    id: str
    skill_id: str
    version_number: str
    version_index: int
    name: str
    description: str
    triggers: list[str] | None
    tags: list[str] | None
    required_tools: list[str] | None
    steps: list[dict[str, Any]] | None
    system_prompt: str | None
    change_summary: str | None
    created_by: str
    created_at: datetime

    class Config:
        from_attributes = True


class SkillVersionListResponse(BaseModel):
    """List of skill versions."""

    versions: list[SkillVersionResponse]
    total: int
    current_version: str


class SkillDiffResponse(BaseModel):
    """Diff between two skill versions."""

    version1: SkillVersionResponse
    version2: SkillVersionResponse
    changes: dict[str, dict[str, Any]]  # field -> {old, new}


# ============================================================================
# Analytics Response Models
# ============================================================================


class SkillExecutionResponse(BaseModel):
    """Response containing skill execution details."""

    id: str
    skill_id: str | None
    system_skill_id: str | None
    skill_slug: str
    skill_type: str
    success: bool
    steps_completed: int
    total_steps: int
    duration_ms: int
    error_message: str | None
    executed_at: datetime

    class Config:
        from_attributes = True


class SkillAnalyticsResponse(BaseModel):
    """Analytics data for skills."""

    total_executions: int
    successful_executions: int
    failed_executions: int
    success_rate: float
    average_duration_ms: float
    total_skills: int
    executions_by_skill: list[dict[str, Any]]
    recent_executions: list[SkillExecutionResponse]


class SkillDetailedAnalyticsResponse(BaseModel):
    """Detailed analytics for a single skill."""

    skill_slug: str
    skill_name: str
    total_executions: int
    successful_executions: int
    failed_executions: int
    success_rate: float
    average_duration_ms: float
    min_duration_ms: int
    max_duration_ms: int
    step_completion_rate: float
    recent_executions: list[SkillExecutionResponse]
    execution_trend: list[dict[str, Any]]  # {date, count, success_rate}


class SkillTimelineResponse(BaseModel):
    """Execution timeline data."""

    timeline: list[dict[str, Any]]  # {date, total, successful, failed}
    period_start: datetime
    period_end: datetime


class SkillTrendResponse(BaseModel):
    """Usage trend data."""

    trends: list[
        dict[str, Any]
    ]  # {skill_slug, skill_name, current_count, previous_count, change_percent}
    period: str  # "daily", "weekly", "monthly"


# ============================================================================
# Routes - Available Skills (for agent service)
# ============================================================================


@router.get("/available", response_model=AvailableSkillsResponse)
async def get_available_skills(
    request: Request,
    include_system: bool = Query(True, description="Include system skills"),
    include_user: bool = Query(True, description="Include user skills"),
    tag: str | None = Query(None, description="Filter by tag"),
    db: AsyncSession = Depends(get_db),
) -> AvailableSkillsResponse:
    """Get all skills available to the current user (for agent service).

    Returns a merged list of:
    - Active system skills (filtered by user's plan if applicable)
    - User's own skills

    This endpoint is used by the agent service to load available skills.
    """
    skills: list[AvailableSkillResponse] = []
    total_system = 0
    total_user = 0

    # Get system skills
    if include_system:
        system_query = select(SystemSkill).where(SystemSkill.is_active == True)

        if tag:
            system_query = system_query.where(SystemSkill.tags.contains([tag]))

        system_result = await db.execute(system_query)
        system_skills = system_result.scalars().all()
        total_system = len(system_skills)

        for skill in system_skills:
            skills.append(
                AvailableSkillResponse(
                    id=skill.id,
                    slug=skill.slug,
                    name=skill.name,
                    description=skill.description,
                    version=skill.version,
                    author=skill.author,
                    skill_type="system",
                    triggers=skill.triggers or [],
                    tags=skill.tags or [],
                    required_tools=skill.required_tools or [],
                    required_context=skill.required_context or [],
                    steps=skill.steps or [],
                    system_prompt=skill.system_prompt,
                    examples=skill.examples,
                    metadata=skill.skill_metadata,
                )
            )

    # Get user skills
    user_id = get_optional_user_id(request)
    if include_user and user_id:
        user_query = select(UserSkill).where(UserSkill.user_id == user_id)

        if tag:
            user_query = user_query.where(UserSkill.tags.contains([tag]))

        user_result = await db.execute(user_query)
        user_skills = user_result.scalars().all()
        total_user = len(user_skills)

        for user_skill in user_skills:
            skills.append(
                AvailableSkillResponse(
                    id=user_skill.id,
                    slug=user_skill.slug,
                    name=user_skill.name,
                    description=user_skill.description,
                    version=user_skill.version,
                    author="user",
                    skill_type="user",
                    triggers=user_skill.triggers or [],
                    tags=user_skill.tags or [],
                    required_tools=user_skill.required_tools or [],
                    required_context=[],  # UserSkill doesn't have required_context
                    steps=user_skill.steps or [],
                    system_prompt=user_skill.system_prompt,
                    examples=None,  # UserSkill doesn't have examples
                    metadata=None,  # UserSkill doesn't have metadata
                )
            )

    return AvailableSkillsResponse(
        skills=skills,
        total_system=total_system,
        total_user=total_user,
    )


# ============================================================================
# Routes - User Skills CRUD
# ============================================================================


@router.get("", response_model=SkillListResponse)
async def list_skills(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    tag: str | None = Query(None),
    search: str | None = Query(None),
    include_public: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> SkillListResponse:
    """List user's skills with optional filtering."""
    user_id = user["id"]

    # Build base query
    conditions: list[Any] = []
    if include_public:
        conditions.append((UserSkill.user_id == user_id) | (UserSkill.is_public == True))
    else:
        conditions.append(UserSkill.user_id == user_id)

    if tag:
        conditions.append(UserSkill.tags.contains([tag]))

    if search:
        search_pattern = f"%{search}%"
        conditions.append(
            (UserSkill.name.ilike(search_pattern)) | (UserSkill.description.ilike(search_pattern))
        )

    # Get total count
    count_query = select(func.count(UserSkill.id)).where(*conditions)
    total = (await db.execute(count_query)).scalar() or 0

    # Get paginated results
    query = (
        select(UserSkill)
        .where(*conditions)
        .order_by(UserSkill.usage_count.desc(), UserSkill.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(query)
    skills = result.scalars().all()

    return SkillListResponse(
        skills=[SkillResponse.model_validate(s) for s in skills],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size if total > 0 else 1,
    )


@router.get("/stats", response_model=SkillStatsResponse)
async def get_skill_stats(
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> SkillStatsResponse:
    """Get statistics about user's skills."""
    user_id = user["id"]

    # Get all user skills
    query = select(UserSkill).where(UserSkill.user_id == user_id)
    result = await db.execute(query)
    skills = result.scalars().all()

    # Calculate stats
    total_skills = len(skills)
    total_executions = sum(s.usage_count for s in skills)
    agent_generated = sum(1 for s in skills if s.generated_by_agent)
    user_created = total_skills - agent_generated
    public_skills = sum(1 for s in skills if s.is_public)

    # Count by tag
    by_tag: dict[str, int] = {}
    for skill in skills:
        for tag in skill.tags or []:
            by_tag[tag] = by_tag.get(tag, 0) + 1

    # Most used skills
    sorted_skills = sorted(skills, key=lambda s: s.usage_count, reverse=True)[:5]
    most_used = [
        {"name": s.name, "slug": s.slug, "usage_count": s.usage_count} for s in sorted_skills
    ]

    return SkillStatsResponse(
        total_skills=total_skills,
        total_executions=total_executions,
        agent_generated=agent_generated,
        user_created=user_created,
        public_skills=public_skills,
        by_tag=by_tag,
        most_used=most_used,
    )


@router.get("/{skill_id}", response_model=SkillResponse)
async def get_skill(
    skill_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> SkillResponse:
    """Get a specific skill by ID."""
    user_id = user["id"]

    query = select(UserSkill).where(
        UserSkill.id == skill_id,
        (UserSkill.user_id == user_id) | (UserSkill.is_public == True),
    )
    result = await db.execute(query)
    skill = result.scalar_one_or_none()

    if not skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill not found",
        )

    return SkillResponse.model_validate(skill)


@router.post("", response_model=SkillResponse, status_code=status.HTTP_201_CREATED)
async def create_skill(
    request: SkillCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> SkillResponse:
    """Create a new skill."""
    user_id = user["id"]

    # Check for duplicate slug
    existing_query = select(UserSkill).where(
        UserSkill.user_id == user_id,
        UserSkill.slug == request.slug,
    )
    existing = (await db.execute(existing_query)).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Skill with slug '{request.slug}' already exists",
        )

    now = datetime.now(UTC)
    skill = UserSkill(
        id=str(uuid4()),
        user_id=user_id,
        name=request.name,
        slug=request.slug,
        description=request.description,
        version=request.version,
        triggers=request.triggers,
        tags=request.tags,
        required_tools=request.required_tools,
        steps=[step.model_dump() for step in request.steps],
        system_prompt=request.system_prompt,
        generated_by_agent=False,
        source_conversation_id=None,
        is_public=request.is_public,
        usage_count=0,
        created_at=now,
        updated_at=now,
    )

    db.add(skill)
    await db.commit()
    await db.refresh(skill)

    return SkillResponse.model_validate(skill)


@router.patch("/{skill_id}", response_model=SkillResponse)
async def update_skill(
    skill_id: str,
    request: SkillUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> SkillResponse:
    """Update an existing skill."""
    user_id = user["id"]

    # Get existing skill
    query = select(UserSkill).where(
        UserSkill.id == skill_id,
        UserSkill.user_id == user_id,
    )
    result = await db.execute(query)
    skill = result.scalar_one_or_none()

    if not skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill not found",
        )

    # Build update data
    update_data = request.model_dump(exclude_unset=True)
    if update_data.get("steps"):
        update_data["steps"] = [
            step.model_dump() if hasattr(step, "model_dump") else step
            for step in update_data["steps"]
        ]

    update_data["updated_at"] = datetime.now(UTC)

    # Apply update
    await db.execute(update(UserSkill).where(UserSkill.id == skill_id).values(**update_data))
    await db.commit()
    await db.refresh(skill)

    return SkillResponse.model_validate(skill)


@router.delete("/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_skill(
    skill_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> None:
    """Delete a skill."""
    user_id = user["id"]

    # Check ownership
    query = select(UserSkill).where(
        UserSkill.id == skill_id,
        UserSkill.user_id == user_id,
    )
    result = await db.execute(query)
    skill = result.scalar_one_or_none()

    if not skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill not found",
        )

    await db.execute(delete(UserSkill).where(UserSkill.id == skill_id))
    await db.commit()


@router.post("/{skill_id}/execute", response_model=dict)
async def record_execution(
    skill_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> dict[str, Any]:
    """Record a skill execution (increment usage count)."""
    user_id = user["id"]

    query = select(UserSkill).where(
        UserSkill.id == skill_id,
        (UserSkill.user_id == user_id) | (UserSkill.is_public == True),
    )
    result = await db.execute(query)
    skill = result.scalar_one_or_none()

    if not skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill not found",
        )

    await db.execute(
        update(UserSkill)
        .where(UserSkill.id == skill_id)
        .values(usage_count=UserSkill.usage_count + 1)
    )
    await db.commit()

    return {"success": True, "usage_count": skill.usage_count + 1}


@router.post("/import", response_model=SkillResponse)
async def import_skill(
    skill_data: dict[str, Any],
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> SkillResponse:
    """Import a skill from YAML/JSON data."""
    user_id = user["id"]

    # Validate required fields
    required_fields = ["name", "slug", "description", "steps"]
    for field in required_fields:
        if field not in skill_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Missing required field: {field}",
            )

    # Check for duplicate slug
    existing_query = select(UserSkill).where(
        UserSkill.user_id == user_id,
        UserSkill.slug == skill_data["slug"],
    )
    existing = (await db.execute(existing_query)).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Skill with slug '{skill_data['slug']}' already exists",
        )

    now = datetime.now(UTC)
    skill = UserSkill(
        id=str(uuid4()),
        user_id=user_id,
        name=skill_data["name"],
        slug=skill_data["slug"],
        description=skill_data["description"],
        version=skill_data.get("version", "1.0.0"),
        triggers=skill_data.get("triggers", []),
        tags=skill_data.get("tags", []),
        required_tools=skill_data.get("required_tools", []),
        steps=skill_data["steps"],
        system_prompt=skill_data.get("system_prompt"),
        generated_by_agent=False,
        source_conversation_id=None,
        is_public=False,
        usage_count=0,
        created_at=now,
        updated_at=now,
    )

    db.add(skill)
    await db.commit()
    await db.refresh(skill)

    return SkillResponse.model_validate(skill)


@router.get("/{skill_id}/export", response_model=dict)
async def export_skill(
    skill_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> dict[str, Any]:
    """Export a skill as YAML-compatible dict."""
    user_id = user["id"]

    query = select(UserSkill).where(
        UserSkill.id == skill_id,
        (UserSkill.user_id == user_id) | (UserSkill.is_public == True),
    )
    result = await db.execute(query)
    skill = result.scalar_one_or_none()

    if not skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill not found",
        )

    return {
        "name": skill.name,
        "slug": skill.slug,
        "description": skill.description,
        "version": skill.version,
        "triggers": skill.triggers,
        "tags": skill.tags,
        "required_tools": skill.required_tools,
        "steps": skill.steps,
        "system_prompt": skill.system_prompt,
    }


# ============================================================================
# Routes - Skill Versioning
# ============================================================================


@router.get("/{skill_id}/versions", response_model=SkillVersionListResponse)
async def list_skill_versions(
    skill_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> SkillVersionListResponse:
    """List all versions of a skill."""
    user_id = user["id"]

    # Check skill access
    skill_query = select(UserSkill).where(
        UserSkill.id == skill_id,
        (UserSkill.user_id == user_id) | (UserSkill.is_public == True),
    )
    skill = (await db.execute(skill_query)).scalar_one_or_none()

    if not skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill not found",
        )

    # Get versions
    versions_query = (
        select(SkillVersion)
        .where(SkillVersion.skill_id == skill_id)
        .order_by(SkillVersion.version_index.desc())
    )
    result = await db.execute(versions_query)
    versions = result.scalars().all()

    return SkillVersionListResponse(
        versions=[SkillVersionResponse.model_validate(v) for v in versions],
        total=len(versions),
        current_version=skill.version,
    )


@router.get("/{skill_id}/versions/{version_id}", response_model=SkillVersionResponse)
async def get_skill_version(
    skill_id: str,
    version_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> SkillVersionResponse:
    """Get a specific version of a skill."""
    user_id = user["id"]

    # Check skill access
    skill_query = select(UserSkill).where(
        UserSkill.id == skill_id,
        (UserSkill.user_id == user_id) | (UserSkill.is_public == True),
    )
    skill = (await db.execute(skill_query)).scalar_one_or_none()

    if not skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill not found",
        )

    # Get version
    version_query = select(SkillVersion).where(
        SkillVersion.id == version_id,
        SkillVersion.skill_id == skill_id,
    )
    version = (await db.execute(version_query)).scalar_one_or_none()

    if not version:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Version not found",
        )

    return SkillVersionResponse.model_validate(version)


@router.post("/{skill_id}/rollback/{version_id}", response_model=SkillResponse)
async def rollback_skill_version(
    skill_id: str,
    version_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> SkillResponse:
    """Rollback a skill to a previous version."""
    user_id = user["id"]

    # Check skill ownership (only owner can rollback)
    skill_query = select(UserSkill).where(
        UserSkill.id == skill_id,
        UserSkill.user_id == user_id,
    )
    skill = (await db.execute(skill_query)).scalar_one_or_none()

    if not skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill not found or you don't have permission to modify it",
        )

    # Get version to rollback to
    version_query = select(SkillVersion).where(
        SkillVersion.id == version_id,
        SkillVersion.skill_id == skill_id,
    )
    version = (await db.execute(version_query)).scalar_one_or_none()

    if not version:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Version not found",
        )

    # Create a new version record for the current state before rollback
    current_version_index = (
        await db.execute(
            select(func.max(SkillVersion.version_index)).where(SkillVersion.skill_id == skill_id)
        )
    ).scalar() or 0

    # Save current state as a version
    pre_rollback_version = SkillVersion(
        id=str(uuid4()),
        skill_id=skill_id,
        version_number=skill.version,
        version_index=current_version_index + 1,
        name=skill.name,
        description=skill.description,
        triggers=skill.triggers,
        tags=skill.tags,
        required_tools=skill.required_tools,
        steps=skill.steps,
        system_prompt=skill.system_prompt,
        change_summary=f"Pre-rollback snapshot (rolling back to v{version.version_number})",
        created_by="user",
        created_at=datetime.now(UTC),
    )
    db.add(pre_rollback_version)

    # Apply rollback
    await db.execute(
        update(UserSkill)
        .where(UserSkill.id == skill_id)
        .values(
            name=version.name,
            description=version.description,
            version=version.version_number,
            triggers=version.triggers,
            tags=version.tags,
            required_tools=version.required_tools,
            steps=version.steps,
            system_prompt=version.system_prompt,
            updated_at=datetime.now(UTC),
        )
    )

    await db.commit()
    await db.refresh(skill)

    return SkillResponse.model_validate(skill)


@router.get("/{skill_id}/diff/{version1_id}/{version2_id}", response_model=SkillDiffResponse)
async def diff_skill_versions(
    skill_id: str,
    version1_id: str,
    version2_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> SkillDiffResponse:
    """Compare two versions of a skill."""
    user_id = user["id"]

    # Check skill access
    skill_query = select(UserSkill).where(
        UserSkill.id == skill_id,
        (UserSkill.user_id == user_id) | (UserSkill.is_public == True),
    )
    skill = (await db.execute(skill_query)).scalar_one_or_none()

    if not skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill not found",
        )

    # Get both versions
    v1_query = select(SkillVersion).where(
        SkillVersion.id == version1_id,
        SkillVersion.skill_id == skill_id,
    )
    v1 = (await db.execute(v1_query)).scalar_one_or_none()

    v2_query = select(SkillVersion).where(
        SkillVersion.id == version2_id,
        SkillVersion.skill_id == skill_id,
    )
    v2 = (await db.execute(v2_query)).scalar_one_or_none()

    if not v1 or not v2:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="One or both versions not found",
        )

    # Calculate diff
    changes: dict[str, dict[str, Any]] = {}
    fields_to_compare = [
        "name",
        "description",
        "triggers",
        "tags",
        "required_tools",
        "steps",
        "system_prompt",
    ]

    for field in fields_to_compare:
        old_val = getattr(v1, field)
        new_val = getattr(v2, field)
        if old_val != new_val:
            changes[field] = {"old": old_val, "new": new_val}

    return SkillDiffResponse(
        version1=SkillVersionResponse.model_validate(v1),
        version2=SkillVersionResponse.model_validate(v2),
        changes=changes,
    )


# ============================================================================
# Routes - Skill Analytics
# ============================================================================


@router.get("/analytics", response_model=SkillAnalyticsResponse)
async def get_skill_analytics(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> SkillAnalyticsResponse:
    """Get overall analytics for user's skills."""
    user_id = user["id"]

    # Calculate date range
    end_date = datetime.now(UTC)
    start_date = end_date.replace(hour=0, minute=0, second=0, microsecond=0)
    start_date = start_date - timedelta(days=days)

    # Get user's skill IDs
    skills_query = select(UserSkill.id, UserSkill.slug, UserSkill.name).where(
        UserSkill.user_id == user_id
    )
    skills_result = await db.execute(skills_query)
    user_skills = {row.id: {"slug": row.slug, "name": row.name} for row in skills_result}
    skill_ids = list(user_skills.keys())

    # Get execution stats
    if skill_ids:
        exec_query = select(SkillExecution).where(
            SkillExecution.user_id == user_id,
            SkillExecution.executed_at >= start_date,
        )
        exec_result = await db.execute(exec_query)
        executions = exec_result.scalars().all()
    else:
        executions = []

    total_executions = len(executions)
    successful_executions = sum(1 for e in executions if e.success)
    failed_executions = total_executions - successful_executions
    success_rate = (successful_executions / total_executions * 100) if total_executions > 0 else 0.0
    average_duration = (
        sum(e.duration_ms for e in executions) / total_executions if total_executions > 0 else 0.0
    )

    # Group executions by skill
    executions_by_skill: dict[str, dict[str, Any]] = {}
    for e in executions:
        slug = e.skill_slug
        if slug not in executions_by_skill:
            executions_by_skill[slug] = {
                "skill_slug": slug,
                "skill_name": slug,  # Will be updated if we find the name
                "count": 0,
                "successful": 0,
                "average_duration_ms": 0,
                "total_duration": 0,
            }
        executions_by_skill[slug]["count"] += 1
        if e.success:
            executions_by_skill[slug]["successful"] += 1
        executions_by_skill[slug]["total_duration"] += e.duration_ms

    # Calculate averages
    for data in executions_by_skill.values():
        if data["count"] > 0:
            data["average_duration_ms"] = data["total_duration"] / data["count"]
        del data["total_duration"]

    # Sort by count and take top 10
    sorted_by_skill = sorted(executions_by_skill.values(), key=lambda x: x["count"], reverse=True)[
        :10
    ]

    # Get recent executions
    recent_query = (
        select(SkillExecution)
        .where(SkillExecution.user_id == user_id)
        .order_by(SkillExecution.executed_at.desc())
        .limit(10)
    )
    recent_result = await db.execute(recent_query)
    recent_executions = recent_result.scalars().all()

    return SkillAnalyticsResponse(
        total_executions=total_executions,
        successful_executions=successful_executions,
        failed_executions=failed_executions,
        success_rate=round(success_rate, 2),
        average_duration_ms=round(average_duration, 2),
        total_skills=len(skill_ids),
        executions_by_skill=sorted_by_skill,
        recent_executions=[SkillExecutionResponse.model_validate(e) for e in recent_executions],
    )


@router.get("/{skill_id}/analytics", response_model=SkillDetailedAnalyticsResponse)
async def get_skill_detailed_analytics(
    skill_id: str,
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> SkillDetailedAnalyticsResponse:
    """Get detailed analytics for a specific skill."""
    user_id = user["id"]

    # Check skill access
    skill_query = select(UserSkill).where(
        UserSkill.id == skill_id,
        (UserSkill.user_id == user_id) | (UserSkill.is_public == True),
    )
    skill = (await db.execute(skill_query)).scalar_one_or_none()

    if not skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill not found",
        )

    # Calculate date range
    end_date = datetime.now(UTC)
    start_date = end_date - timedelta(days=days)

    # Get executions for this skill
    exec_query = (
        select(SkillExecution)
        .where(
            SkillExecution.skill_id == skill_id,
            SkillExecution.executed_at >= start_date,
        )
        .order_by(SkillExecution.executed_at.desc())
    )
    exec_result = await db.execute(exec_query)
    executions = exec_result.scalars().all()

    total_executions = len(executions)
    successful_executions = sum(1 for e in executions if e.success)
    failed_executions = total_executions - successful_executions
    success_rate = (successful_executions / total_executions * 100) if total_executions > 0 else 0.0

    if executions:
        durations = [e.duration_ms for e in executions]
        average_duration = sum(durations) / len(durations)
        min_duration = min(durations)
        max_duration = max(durations)
        total_steps_completed = sum(e.steps_completed for e in executions)
        total_steps_possible = sum(e.total_steps for e in executions)
        step_completion_rate = (
            (total_steps_completed / total_steps_possible * 100)
            if total_steps_possible > 0
            else 0.0
        )
    else:
        average_duration = 0.0
        min_duration = 0
        max_duration = 0
        step_completion_rate = 0.0

    # Build execution trend (by day)
    execution_trend: list[dict[str, Any]] = []
    executions_by_date: dict[str, list[SkillExecution]] = {}
    for e in executions:
        date_key = e.executed_at.strftime("%Y-%m-%d")
        if date_key not in executions_by_date:
            executions_by_date[date_key] = []
        executions_by_date[date_key].append(e)

    for date_key in sorted(executions_by_date.keys()):
        date_execs = executions_by_date[date_key]
        date_success = sum(1 for e in date_execs if e.success)
        execution_trend.append(
            {
                "date": date_key,
                "count": len(date_execs),
                "success_rate": round(date_success / len(date_execs) * 100, 2) if date_execs else 0,
            }
        )

    return SkillDetailedAnalyticsResponse(
        skill_slug=skill.slug,
        skill_name=skill.name,
        total_executions=total_executions,
        successful_executions=successful_executions,
        failed_executions=failed_executions,
        success_rate=round(success_rate, 2),
        average_duration_ms=round(average_duration, 2),
        min_duration_ms=min_duration,
        max_duration_ms=max_duration,
        step_completion_rate=round(step_completion_rate, 2),
        recent_executions=[SkillExecutionResponse.model_validate(e) for e in executions[:10]],
        execution_trend=execution_trend,
    )


@router.get("/analytics/timeline", response_model=SkillTimelineResponse)
async def get_skill_timeline(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> SkillTimelineResponse:
    """Get execution timeline for all user skills."""
    user_id = user["id"]

    # Calculate date range
    end_date = datetime.now(UTC)
    start_date = end_date - timedelta(days=days)

    # Get all executions in date range
    exec_query = (
        select(SkillExecution)
        .where(
            SkillExecution.user_id == user_id,
            SkillExecution.executed_at >= start_date,
        )
        .order_by(SkillExecution.executed_at)
    )
    exec_result = await db.execute(exec_query)
    executions = exec_result.scalars().all()

    # Group by date
    timeline: list[dict[str, Any]] = []
    executions_by_date: dict[str, list[SkillExecution]] = {}
    for e in executions:
        date_key = e.executed_at.strftime("%Y-%m-%d")
        if date_key not in executions_by_date:
            executions_by_date[date_key] = []
        executions_by_date[date_key].append(e)

    # Fill in all dates in range
    current_date = start_date
    while current_date <= end_date:
        date_key = current_date.strftime("%Y-%m-%d")
        date_execs = executions_by_date.get(date_key, [])
        successful = sum(1 for e in date_execs if e.success)
        timeline.append(
            {
                "date": date_key,
                "total": len(date_execs),
                "successful": successful,
                "failed": len(date_execs) - successful,
            }
        )
        current_date += timedelta(days=1)

    return SkillTimelineResponse(
        timeline=timeline,
        period_start=start_date,
        period_end=end_date,
    )


@router.get("/analytics/trends", response_model=SkillTrendResponse)
async def get_skill_trends(
    period: str = Query("weekly", pattern="^(daily|weekly|monthly)$"),
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> SkillTrendResponse:
    """Get usage trends comparing current period to previous period."""
    user_id = user["id"]

    # Determine period boundaries
    now = datetime.now(UTC)
    if period == "daily":
        current_start = now - timedelta(days=1)
        previous_start = now - timedelta(days=2)
        previous_end = current_start
    elif period == "weekly":
        current_start = now - timedelta(weeks=1)
        previous_start = now - timedelta(weeks=2)
        previous_end = current_start
    else:  # monthly
        current_start = now - timedelta(days=30)
        previous_start = now - timedelta(days=60)
        previous_end = current_start

    # Get current period executions
    current_query = select(SkillExecution).where(
        SkillExecution.user_id == user_id,
        SkillExecution.executed_at >= current_start,
    )
    current_result = await db.execute(current_query)
    current_executions = current_result.scalars().all()

    # Get previous period executions
    previous_query = select(SkillExecution).where(
        SkillExecution.user_id == user_id,
        SkillExecution.executed_at >= previous_start,
        SkillExecution.executed_at < previous_end,
    )
    previous_result = await db.execute(previous_query)
    previous_executions = previous_result.scalars().all()

    # Count by skill
    current_counts: dict[str, int] = {}
    skill_names: dict[str, str] = {}
    for e in current_executions:
        current_counts[e.skill_slug] = current_counts.get(e.skill_slug, 0) + 1
        skill_names[e.skill_slug] = e.skill_slug  # Could look up actual name

    previous_counts: dict[str, int] = {}
    for e in previous_executions:
        previous_counts[e.skill_slug] = previous_counts.get(e.skill_slug, 0) + 1
        if e.skill_slug not in skill_names:
            skill_names[e.skill_slug] = e.skill_slug

    # Calculate trends
    all_skills = set(current_counts.keys()) | set(previous_counts.keys())
    trends: list[dict[str, Any]] = []

    for slug in all_skills:
        current = current_counts.get(slug, 0)
        previous = previous_counts.get(slug, 0)
        if previous > 0:
            change_percent = ((current - previous) / previous) * 100
        elif current > 0:
            change_percent = 100.0  # New skill
        else:
            change_percent = 0.0

        trends.append(
            {
                "skill_slug": slug,
                "skill_name": skill_names.get(slug, slug),
                "current_count": current,
                "previous_count": previous,
                "change_percent": round(change_percent, 2),
            }
        )

    # Sort by current count descending
    trends.sort(key=lambda x: x["current_count"], reverse=True)

    return SkillTrendResponse(
        trends=trends[:20],  # Top 20
        period=period,
    )


# ============================================================================
# Routes - Skill Execution Recording (for agent service)
# ============================================================================


class RecordExecutionRequest(BaseModel):
    """Request to record a skill execution."""

    skill_slug: str = Field(..., description="Skill slug identifier")
    skill_type: str = Field(
        ..., pattern="^(system|user)$", description="Skill type: 'system' or 'user'"
    )
    skill_id: str | None = Field(None, description="User skill ID (if user skill)")
    system_skill_id: str | None = Field(None, description="System skill ID (if system skill)")
    session_id: str | None = Field(None, description="Session ID")
    agent_id: str | None = Field(None, description="Agent ID")
    success: bool = Field(..., description="Whether execution succeeded")
    steps_completed: int = Field(..., ge=0, description="Number of steps completed")
    total_steps: int = Field(..., ge=0, description="Total number of steps")
    duration_ms: int = Field(..., ge=0, description="Execution duration in milliseconds")
    error_message: str | None = Field(None, description="Error message if failed")
    context_snapshot: dict[str, Any] | None = Field(None, description="Context at execution")
    results_snapshot: dict[str, Any] | None = Field(None, description="Execution results")


class RecordExecutionResponse(BaseModel):
    """Response after recording execution."""

    id: str
    skill_slug: str
    success: bool
    recorded_at: datetime


@router.post(
    "/executions", response_model=RecordExecutionResponse, status_code=status.HTTP_201_CREATED
)
async def record_skill_execution(
    request: RecordExecutionRequest,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> RecordExecutionResponse:
    """Record a skill execution for analytics tracking.

    This endpoint is called by the agent service after executing a skill
    to persist the execution record for analytics and usage tracking.
    """
    user_id = user["id"]
    now = datetime.now(UTC)

    # Create execution record
    execution = SkillExecution(
        id=str(uuid4()),
        skill_id=request.skill_id,
        system_skill_id=request.system_skill_id,
        skill_slug=request.skill_slug,
        skill_type=request.skill_type,
        user_id=user_id,
        session_id=request.session_id,
        agent_id=request.agent_id,
        success=request.success,
        steps_completed=request.steps_completed,
        total_steps=request.total_steps,
        duration_ms=request.duration_ms,
        error_message=request.error_message,
        context_snapshot=request.context_snapshot,
        results_snapshot=request.results_snapshot,
        executed_at=now,
    )

    db.add(execution)

    # Also increment usage_count on the skill
    if request.skill_type == "user" and request.skill_id:
        await db.execute(
            update(UserSkill)
            .where(UserSkill.id == request.skill_id)
            .values(usage_count=UserSkill.usage_count + 1)
        )
    elif request.skill_type == "system" and request.system_skill_id:
        # SystemSkill doesn't have usage_count, but we track via SkillExecution
        pass

    await db.commit()
    await db.refresh(execution)

    return RecordExecutionResponse(
        id=execution.id,
        skill_slug=execution.skill_slug,
        success=execution.success,
        recorded_at=execution.executed_at,
    )
