"""API routes for user skills management."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import UserSkill
from src.middleware.auth import get_current_user

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
# Routes
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
