"""Admin System Skill management routes.

Provides management of system-wide skills available on the platform,
including CRUD operations, analytics, and bulk operations.
"""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import Integer, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import SkillExecution, SystemSkill
from src.middleware.admin import get_admin_user_id, require_admin, require_super_admin
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

logger = structlog.get_logger()

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db)]


# ==================== Pydantic Models ====================


class SkillStepSchema(BaseModel):
    """Schema for a skill step."""

    name: str = Field(..., min_length=1, max_length=100)
    description: str
    tool: str | None = None
    skill: str | None = None  # For chaining skills
    parameters: dict[str, Any] = Field(default_factory=dict)
    condition: str | None = None
    on_success: str | None = None
    on_failure: str | None = None
    parallel_with: list[str] | None = None
    required: bool = True


class SkillMetadataSchema(BaseModel):
    """Schema for skill metadata."""

    category: str = Field(default="general", description="Skill category")
    estimated_duration: int = Field(default=60, description="Estimated duration in seconds")
    requires_approval: bool = Field(
        default=False, description="Whether skill requires user approval"
    )


class CreateSkillRequest(BaseModel):
    """Request to create a new system skill."""

    name: str = Field(..., min_length=1, max_length=100)
    slug: str = Field(..., min_length=1, max_length=100, pattern=r"^[a-z0-9_-]+$")
    description: str = Field(..., min_length=1)
    version: str = Field(default="1.0.0", max_length=20)
    author: str = Field(default="system", max_length=100)
    triggers: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    required_tools: list[str] = Field(default_factory=list)
    required_context: list[str] = Field(default_factory=list)
    steps: list[SkillStepSchema] = Field(default_factory=list)
    system_prompt: str | None = None
    examples: list[dict[str, str]] | None = None
    metadata: SkillMetadataSchema | None = None
    is_active: bool = True
    is_default: bool = True
    allowed_plans: list[str] | None = None
    allowed_roles: list[str] | None = None


class UpdateSkillRequest(BaseModel):
    """Request to update a system skill."""

    name: str | None = None
    description: str | None = None
    version: str | None = None
    author: str | None = None
    triggers: list[str] | None = None
    tags: list[str] | None = None
    required_tools: list[str] | None = None
    required_context: list[str] | None = None
    steps: list[SkillStepSchema] | None = None
    system_prompt: str | None = None
    examples: list[dict[str, str]] | None = None
    metadata: SkillMetadataSchema | None = None
    is_active: bool | None = None
    is_default: bool | None = None
    allowed_plans: list[str] | None = None
    allowed_roles: list[str] | None = None


class SystemSkillResponse(BaseModel):
    """System skill response."""

    id: str
    name: str
    slug: str
    description: str
    version: str
    author: str
    triggers: list[str]
    tags: list[str]
    required_tools: list[str]
    required_context: list[str]
    steps: list[dict[str, Any]]
    system_prompt: str | None
    examples: list[dict[str, Any]] | None
    metadata: dict[str, Any] | None
    is_active: bool
    is_default: bool
    allowed_plans: list[str] | None
    allowed_roles: list[str] | None
    created_at: datetime
    updated_at: datetime
    created_by: str | None

    class Config:
        from_attributes = True


class SkillListResponse(BaseModel):
    """Paginated list of skills."""

    items: list[SystemSkillResponse]
    total: int
    offset: int
    limit: int


class SkillAnalyticsResponse(BaseModel):
    """Analytics for a single skill."""

    skill_slug: str
    skill_name: str
    total_executions: int
    successful_executions: int
    failed_executions: int
    success_rate: float
    avg_duration_ms: float | None
    last_executed_at: datetime | None


class SkillsAnalyticsSummary(BaseModel):
    """Summary analytics for all system skills."""

    total_skills: int
    active_skills: int
    total_executions: int
    overall_success_rate: float
    skills_by_category: dict[str, int]
    top_skills: list[SkillAnalyticsResponse]


class BulkUpdateRequest(BaseModel):
    """Request to bulk update skills."""

    slugs: list[str]
    is_active: bool | None = None
    is_default: bool | None = None
    allowed_plans: list[str] | None = None


class ImportSkillRequest(BaseModel):
    """Request to import a skill from YAML/JSON."""

    data: dict[str, Any]


# ==================== Helper Functions ====================


def _skill_to_response(skill: SystemSkill) -> SystemSkillResponse:
    """Convert SystemSkill to response model."""
    return SystemSkillResponse(
        id=skill.id,
        name=skill.name,
        slug=skill.slug,
        description=skill.description,
        version=skill.version,
        author=skill.author,
        triggers=skill.triggers or [],
        tags=skill.tags or [],
        required_tools=skill.required_tools or [],
        required_context=skill.required_context or [],
        steps=skill.steps or [],
        system_prompt=skill.system_prompt,
        examples=skill.examples,
        metadata=skill.skill_metadata,
        is_active=skill.is_active,
        is_default=skill.is_default,
        allowed_plans=skill.allowed_plans,
        allowed_roles=skill.allowed_roles,
        created_at=skill.created_at,
        updated_at=skill.updated_at,
        created_by=skill.created_by,
    )


# ==================== CRUD Routes ====================


@router.get("", response_model=SkillListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def list_system_skills(
    request: Request,
    response: Response,
    db: DbSession,
    category: Annotated[str | None, Query(description="Filter by category")] = None,
    tag: Annotated[str | None, Query(description="Filter by tag")] = None,
    active_only: Annotated[bool, Query(description="Only show active skills")] = False,
    search: Annotated[str | None, Query(description="Search in name/description")] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> SkillListResponse:
    """List all system skills with filtering and pagination."""
    query = select(SystemSkill).order_by(SystemSkill.name)

    if active_only:
        query = query.where(SystemSkill.is_active == True)

    if category:
        query = query.where(SystemSkill.skill_metadata["category"].astext == category)

    if tag:
        query = query.where(SystemSkill.tags.contains([tag]))

    if search:
        search_pattern = f"%{search.lower()}%"
        query = query.where(
            (func.lower(SystemSkill.name).like(search_pattern))
            | (func.lower(SystemSkill.description).like(search_pattern))
        )

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Apply pagination
    query = query.offset(offset).limit(limit)
    result = await db.execute(query)
    skills = result.scalars().all()

    return SkillListResponse(
        items=[_skill_to_response(s) for s in skills],
        total=total,
        offset=offset,
        limit=limit,
    )


@router.get("/analytics", response_model=SkillsAnalyticsSummary)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_skills_analytics(
    request: Request,
    response: Response,
    db: DbSession,
    days: Annotated[int, Query(ge=1, le=365, description="Number of days to analyze")] = 30,
) -> SkillsAnalyticsSummary:
    """Get analytics summary for all system skills."""
    cutoff_date = datetime.now(UTC) - timedelta(days=days)

    # Count skills
    total_result = await db.execute(select(func.count()).select_from(SystemSkill))
    total_skills = total_result.scalar() or 0

    active_result = await db.execute(
        select(func.count()).select_from(SystemSkill).where(SystemSkill.is_active == True)
    )
    active_skills = active_result.scalar() or 0

    # Get execution stats
    exec_stats = await db.execute(
        select(
            func.count(SkillExecution.id).label("total"),
            func.sum(func.cast(SkillExecution.success, Integer)).label("successful"),
        )
        .where(SkillExecution.skill_type == "system")
        .where(SkillExecution.executed_at >= cutoff_date)
    )
    stats = exec_stats.one()
    total_executions = stats.total or 0
    successful = stats.successful or 0
    success_rate = (successful / total_executions * 100) if total_executions > 0 else 0.0

    # Skills by category
    category_expr = SystemSkill.skill_metadata["category"].astext
    category_result = await db.execute(
        select(
            category_expr.label("category"),
            func.count(SystemSkill.id).label("count"),
        )
        .where(SystemSkill.is_active == True)
        .group_by(category_expr)
    )
    skills_by_category: dict[str, int] = {}
    for row in category_result:
        category = row.category or "general"
        count = row[1]  # Access by index since label gives wrong type
        skills_by_category[category] = int(count) if count else 0

    # Top skills by usage
    top_skills_result = await db.execute(
        select(
            SkillExecution.skill_slug,
            func.count(SkillExecution.id).label("total"),
            func.sum(func.cast(SkillExecution.success, Integer)).label("successful"),
            func.avg(SkillExecution.duration_ms).label("avg_duration"),
            func.max(SkillExecution.executed_at).label("last_executed"),
        )
        .where(SkillExecution.skill_type == "system")
        .where(SkillExecution.executed_at >= cutoff_date)
        .group_by(SkillExecution.skill_slug)
        .order_by(func.count(SkillExecution.id).desc())
        .limit(10)
    )

    top_skills = []
    for row in top_skills_result:
        # Get skill name
        skill_result = await db.execute(
            select(SystemSkill.name).where(SystemSkill.slug == row.skill_slug)
        )
        skill_name = skill_result.scalar() or row.skill_slug

        total = row.total or 0
        succ = row.successful or 0
        top_skills.append(
            SkillAnalyticsResponse(
                skill_slug=row.skill_slug,
                skill_name=skill_name,
                total_executions=total,
                successful_executions=succ,
                failed_executions=total - succ,
                success_rate=(succ / total * 100) if total > 0 else 0.0,
                avg_duration_ms=row.avg_duration,
                last_executed_at=row.last_executed,
            )
        )

    return SkillsAnalyticsSummary(
        total_skills=total_skills,
        active_skills=active_skills,
        total_executions=total_executions,
        overall_success_rate=success_rate,
        skills_by_category=skills_by_category,
        top_skills=top_skills,
    )


@router.get("/{slug}", response_model=SystemSkillResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_system_skill(
    slug: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> SystemSkillResponse:
    """Get a specific system skill by slug."""
    result = await db.execute(select(SystemSkill).where(SystemSkill.slug == slug))
    skill = result.scalar_one_or_none()

    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")

    return _skill_to_response(skill)


@router.get("/{slug}/analytics", response_model=SkillAnalyticsResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_skill_analytics(
    slug: str,
    request: Request,
    response: Response,
    db: DbSession,
    days: Annotated[int, Query(ge=1, le=365)] = 30,
) -> SkillAnalyticsResponse:
    """Get analytics for a specific skill."""
    cutoff_date = datetime.now(UTC) - timedelta(days=days)

    # Get skill
    skill_result = await db.execute(select(SystemSkill).where(SystemSkill.slug == slug))
    skill = skill_result.scalar_one_or_none()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")

    # Get execution stats
    stats_result = await db.execute(
        select(
            func.count(SkillExecution.id).label("total"),
            func.sum(func.cast(SkillExecution.success, Integer)).label("successful"),
            func.avg(SkillExecution.duration_ms).label("avg_duration"),
            func.max(SkillExecution.executed_at).label("last_executed"),
        )
        .where(SkillExecution.skill_slug == slug)
        .where(SkillExecution.skill_type == "system")
        .where(SkillExecution.executed_at >= cutoff_date)
    )
    stats = stats_result.one()

    total = stats.total or 0
    successful = stats.successful or 0

    return SkillAnalyticsResponse(
        skill_slug=slug,
        skill_name=skill.name,
        total_executions=total,
        successful_executions=successful,
        failed_executions=total - successful,
        success_rate=(successful / total * 100) if total > 0 else 0.0,
        avg_duration_ms=stats.avg_duration,
        last_executed_at=stats.last_executed,
    )


@router.post("", response_model=SystemSkillResponse, status_code=201)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def create_system_skill(
    request: Request,
    response: Response,
    data: CreateSkillRequest,
    db: DbSession,
) -> SystemSkillResponse:
    """Create a new system skill."""
    admin_id = get_admin_user_id(request)

    # Check for duplicate slug
    existing = await db.execute(select(SystemSkill).where(SystemSkill.slug == data.slug))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Skill with this slug already exists")

    # Check for duplicate name
    existing_name = await db.execute(select(SystemSkill).where(SystemSkill.name == data.name))
    if existing_name.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Skill with this name already exists")

    skill = SystemSkill(
        name=data.name,
        slug=data.slug,
        description=data.description,
        version=data.version,
        author=data.author,
        triggers=data.triggers,
        tags=data.tags,
        required_tools=data.required_tools,
        required_context=data.required_context,
        steps=[s.model_dump() for s in data.steps],
        system_prompt=data.system_prompt,
        examples=data.examples,
        metadata=data.metadata.model_dump() if data.metadata else None,
        is_active=data.is_active,
        is_default=data.is_default,
        allowed_plans=data.allowed_plans,
        allowed_roles=data.allowed_roles,
        created_by=admin_id,
    )

    db.add(skill)
    await db.commit()
    await db.refresh(skill)

    logger.info("Admin created system skill", admin_id=admin_id, skill_slug=skill.slug)

    return _skill_to_response(skill)


@router.patch("/{slug}", response_model=SystemSkillResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def update_system_skill(
    slug: str,
    request: Request,
    response: Response,
    data: UpdateSkillRequest,
    db: DbSession,
) -> SystemSkillResponse:
    """Update a system skill."""
    admin_id = get_admin_user_id(request)

    result = await db.execute(select(SystemSkill).where(SystemSkill.slug == slug))
    skill = result.scalar_one_or_none()

    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")

    update_data = data.model_dump(exclude_unset=True)

    # Handle nested models
    if "steps" in update_data and update_data["steps"] is not None:
        update_data["steps"] = [
            s.model_dump() if hasattr(s, "model_dump") else s for s in update_data["steps"]
        ]

    if (
        "metadata" in update_data
        and update_data["metadata"] is not None
        and hasattr(update_data["metadata"], "model_dump")
    ):
        update_data["metadata"] = update_data["metadata"].model_dump()

    for field, value in update_data.items():
        setattr(skill, field, value)

    await db.commit()
    await db.refresh(skill)

    logger.info("Admin updated system skill", admin_id=admin_id, skill_slug=slug)

    return _skill_to_response(skill)


@router.delete("/{slug}")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_super_admin
async def delete_system_skill(
    slug: str,
    request: Request,
    response: Response,
    db: DbSession,
    hard_delete: Annotated[
        bool, Query(description="Permanently delete instead of soft delete")
    ] = False,
) -> dict[str, str]:
    """Delete a system skill (super admin only).

    By default performs soft delete (sets is_active=False).
    Use hard_delete=True to permanently remove.
    """
    admin_id = get_admin_user_id(request)

    result = await db.execute(select(SystemSkill).where(SystemSkill.slug == slug))
    skill = result.scalar_one_or_none()

    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")

    if hard_delete:
        await db.delete(skill)
        logger.info("Admin hard deleted system skill", admin_id=admin_id, skill_slug=slug)
        message = f"Skill {slug} permanently deleted"
    else:
        skill.is_active = False
        logger.info("Admin soft deleted system skill", admin_id=admin_id, skill_slug=slug)
        message = f"Skill {slug} deactivated"

    await db.commit()

    return {"message": message}


# ==================== Bulk Operations ====================


@router.post("/bulk-update")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def bulk_update_skills(
    request: Request,
    response: Response,
    data: BulkUpdateRequest,
    db: DbSession,
) -> dict[str, Any]:
    """Bulk update skills (enable/disable, plan restrictions)."""
    admin_id = get_admin_user_id(request)

    updated = 0
    for slug in data.slugs:
        result = await db.execute(select(SystemSkill).where(SystemSkill.slug == slug))
        skill = result.scalar_one_or_none()

        if skill:
            if data.is_active is not None:
                skill.is_active = data.is_active
            if data.is_default is not None:
                skill.is_default = data.is_default
            if data.allowed_plans is not None:
                skill.allowed_plans = data.allowed_plans
            updated += 1

    await db.commit()

    logger.info(
        "Admin bulk updated skills",
        admin_id=admin_id,
        count=updated,
        is_active=data.is_active,
    )

    return {"updated": updated}


# ==================== Import/Export ====================


@router.post("/{slug}/duplicate", response_model=SystemSkillResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def duplicate_skill(
    slug: str,
    request: Request,
    response: Response,
    db: DbSession,
    new_slug: Annotated[str, Query(description="Slug for the duplicated skill")],
    new_name: Annotated[str | None, Query(description="Name for the duplicated skill")] = None,
) -> SystemSkillResponse:
    """Duplicate an existing skill."""
    admin_id = get_admin_user_id(request)

    result = await db.execute(select(SystemSkill).where(SystemSkill.slug == slug))
    original = result.scalar_one_or_none()

    if not original:
        raise HTTPException(status_code=404, detail="Skill not found")

    # Check new slug doesn't exist
    existing = await db.execute(select(SystemSkill).where(SystemSkill.slug == new_slug))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Skill with new slug already exists")

    duplicate = SystemSkill(
        name=new_name or f"{original.name} (Copy)",
        slug=new_slug,
        description=original.description,
        version="1.0.0",
        author=original.author,
        triggers=original.triggers,
        tags=original.tags,
        required_tools=original.required_tools,
        required_context=original.required_context,
        steps=original.steps,
        system_prompt=original.system_prompt,
        examples=original.examples,
        metadata=original.metadata,
        is_active=False,  # Start inactive
        is_default=False,
        allowed_plans=original.allowed_plans,
        allowed_roles=original.allowed_roles,
        created_by=admin_id,
    )

    db.add(duplicate)
    await db.commit()
    await db.refresh(duplicate)

    logger.info("Admin duplicated skill", admin_id=admin_id, original=slug, new_slug=new_slug)

    return _skill_to_response(duplicate)


@router.post("/import", response_model=SystemSkillResponse, status_code=201)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def import_skill(
    request: Request,
    response: Response,
    data: ImportSkillRequest,
    db: DbSession,
) -> SystemSkillResponse:
    """Import a skill from YAML/JSON format."""
    admin_id = get_admin_user_id(request)
    skill_data = data.data

    required_fields = ["name", "slug", "description"]
    for field in required_fields:
        if field not in skill_data:
            raise HTTPException(status_code=400, detail=f"Missing required field: {field}")

    # Check for duplicate slug
    existing = await db.execute(select(SystemSkill).where(SystemSkill.slug == skill_data["slug"]))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Skill with this slug already exists")

    skill = SystemSkill(
        name=skill_data["name"],
        slug=skill_data["slug"],
        description=skill_data["description"],
        version=skill_data.get("version", "1.0.0"),
        author=skill_data.get("author", "imported"),
        triggers=skill_data.get("triggers", []),
        tags=skill_data.get("tags", []),
        required_tools=skill_data.get("required_tools", []),
        required_context=skill_data.get("required_context", []),
        steps=skill_data.get("steps", []),
        system_prompt=skill_data.get("system_prompt"),
        examples=skill_data.get("examples"),
        metadata=skill_data.get("metadata"),
        is_active=skill_data.get("is_active", True),
        is_default=skill_data.get("is_default", True),
        allowed_plans=skill_data.get("allowed_plans"),
        allowed_roles=skill_data.get("allowed_roles"),
        created_by=admin_id,
    )

    db.add(skill)
    await db.commit()
    await db.refresh(skill)

    logger.info("Admin imported skill", admin_id=admin_id, skill_slug=skill.slug)

    return _skill_to_response(skill)


@router.get("/{slug}/export")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def export_skill(
    slug: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, Any]:
    """Export a skill in YAML-compatible JSON format."""
    result = await db.execute(select(SystemSkill).where(SystemSkill.slug == slug))
    skill = result.scalar_one_or_none()

    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")

    return {
        "name": skill.name,
        "slug": skill.slug,
        "description": skill.description,
        "version": skill.version,
        "author": skill.author,
        "triggers": skill.triggers,
        "tags": skill.tags,
        "required_tools": skill.required_tools,
        "required_context": skill.required_context,
        "steps": skill.steps,
        "system_prompt": skill.system_prompt,
        "examples": skill.examples,
        "metadata": skill.skill_metadata,
    }
