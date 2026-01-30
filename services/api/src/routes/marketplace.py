"""API routes for skill marketplace."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import MarketplaceSkill, UserAddedSkill
from src.middleware.auth import get_current_user
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

router = APIRouter(prefix="/marketplace", tags=["marketplace"])


# ============================================================================
# Request/Response Models
# ============================================================================


class MarketplaceSkillSubmitRequest(BaseModel):
    """Request to submit a skill to the marketplace."""

    name: str = Field(..., min_length=1, max_length=100)
    slug: str = Field(..., min_length=1, max_length=100, pattern=r"^[a-z0-9_-]+$")
    description: str = Field(..., min_length=10, max_length=1000)
    category: str = Field(default="general", max_length=50)
    triggers: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    required_tools: list[str] = Field(default_factory=list)
    required_context: list[str] = Field(default_factory=list)
    steps: list[dict[str, Any]] = Field(...)
    system_prompt: str | None = None
    examples: list[dict[str, Any]] | None = None


class MarketplaceSkillResponse(BaseModel):
    """Response containing marketplace skill details."""

    id: str
    name: str
    slug: str
    description: str
    version: str
    category: str
    triggers: list[str]
    tags: list[str]
    required_tools: list[str]
    steps: list[dict[str, Any]]
    status: str
    usage_count: int
    install_count: int
    submitted_by: str
    submitted_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MarketplaceListResponse(BaseModel):
    """List of marketplace skills."""

    skills: list[MarketplaceSkillResponse]
    total: int
    page: int
    page_size: int
    categories: list[str]


class UserAddedSkillResponse(BaseModel):
    """Response for user's added skill."""

    id: str
    skill_slug: str
    skill_name: str
    system_skill_id: str | None
    usage_count: int
    is_enabled: bool
    added_at: datetime
    last_used_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# Public Marketplace Routes
# ============================================================================


@router.get("", response_model=MarketplaceListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_marketplace_skills(
    request: Request,
    response: Response,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    category: str | None = Query(None),
    search: str | None = Query(None),
    sort_by: str = Query("popular", pattern="^(popular|recent|name)$"),
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> MarketplaceListResponse:
    """List approved skills available in the marketplace."""
    # Only show approved skills
    query = select(MarketplaceSkill).where(MarketplaceSkill.status == "approved")

    if category:
        query = query.where(MarketplaceSkill.category == category)

    if search:
        search_pattern = f"%{search}%"
        query = query.where(
            or_(
                MarketplaceSkill.name.ilike(search_pattern),
                MarketplaceSkill.description.ilike(search_pattern),
                MarketplaceSkill.tags.contains([search]),
            )
        )

    # Sorting
    if sort_by == "popular":
        query = query.order_by(MarketplaceSkill.install_count.desc())
    elif sort_by == "recent":
        query = query.order_by(MarketplaceSkill.submitted_at.desc())
    else:
        query = query.order_by(MarketplaceSkill.name)

    # Get total count
    count_query = select(func.count(MarketplaceSkill.id)).where(
        MarketplaceSkill.status == "approved"
    )
    if category:
        count_query = count_query.where(MarketplaceSkill.category == category)
    total = (await db.execute(count_query)).scalar() or 0

    # Get paginated results
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    skills = result.scalars().all()

    # Get categories
    cat_query = (
        select(MarketplaceSkill.category).where(MarketplaceSkill.status == "approved").distinct()
    )
    cat_result = await db.execute(cat_query)
    categories = [row[0] for row in cat_result if row[0]]

    return MarketplaceListResponse(
        skills=[MarketplaceSkillResponse.model_validate(s) for s in skills],
        total=total,
        page=page,
        page_size=page_size,
        categories=sorted(categories),
    )


@router.get("/{slug}", response_model=MarketplaceSkillResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_marketplace_skill(
    slug: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> MarketplaceSkillResponse:
    """Get details of a specific marketplace skill."""
    query = select(MarketplaceSkill).where(
        MarketplaceSkill.slug == slug,
        MarketplaceSkill.status == "approved",
    )
    result = await db.execute(query)
    skill = result.scalar_one_or_none()

    if not skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill not found in marketplace",
        )

    return MarketplaceSkillResponse.model_validate(skill)


@router.post("/{slug}/install", response_model=UserAddedSkillResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def install_marketplace_skill(
    slug: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> UserAddedSkillResponse:
    """Add a marketplace skill to user's account."""
    user_id = user["id"]

    # Get marketplace skill
    skill_query = select(MarketplaceSkill).where(
        MarketplaceSkill.slug == slug,
        MarketplaceSkill.status == "approved",
    )
    skill = (await db.execute(skill_query)).scalar_one_or_none()

    if not skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill not found in marketplace",
        )

    # Check if already installed
    existing = await db.execute(
        select(UserAddedSkill).where(
            UserAddedSkill.user_id == user_id,
            UserAddedSkill.skill_slug == slug,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Skill already added to your account",
        )

    # Create user added skill entry
    now = datetime.now(UTC)
    user_skill = UserAddedSkill(
        id=str(uuid4()),
        user_id=user_id,
        system_skill_id=skill.approved_skill_id,
        skill_slug=skill.slug,
        skill_name=skill.name,
        added_at=now,
        usage_count=0,
        is_enabled=True,
    )
    db.add(user_skill)

    # Increment install count
    await db.execute(
        update(MarketplaceSkill)
        .where(MarketplaceSkill.id == skill.id)
        .values(install_count=MarketplaceSkill.install_count + 1)
    )

    await db.commit()
    await db.refresh(user_skill)

    return UserAddedSkillResponse.model_validate(user_skill)


@router.delete("/{slug}/uninstall", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(RATE_LIMIT_STANDARD)
async def uninstall_marketplace_skill(
    slug: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> None:
    """Remove a marketplace skill from user's account."""
    user_id = user["id"]

    # Get user's added skill
    query = select(UserAddedSkill).where(
        UserAddedSkill.user_id == user_id,
        UserAddedSkill.skill_slug == slug,
    )
    user_skill = (await db.execute(query)).scalar_one_or_none()

    if not user_skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill not found in your account",
        )

    await db.delete(user_skill)
    await db.commit()


# ============================================================================
# User's Added Skills
# ============================================================================


@router.get("/my/skills", response_model=list[UserAddedSkillResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_my_added_skills(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> list[UserAddedSkillResponse]:
    """List skills user has added from the marketplace."""
    user_id = user["id"]

    query = (
        select(UserAddedSkill)
        .where(UserAddedSkill.user_id == user_id)
        .order_by(UserAddedSkill.added_at.desc())
    )
    result = await db.execute(query)
    skills = result.scalars().all()

    return [UserAddedSkillResponse.model_validate(s) for s in skills]


@router.patch("/my/skills/{slug}/toggle", response_model=UserAddedSkillResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def toggle_added_skill(
    slug: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> UserAddedSkillResponse:
    """Enable/disable an added skill."""
    user_id = user["id"]

    query = select(UserAddedSkill).where(
        UserAddedSkill.user_id == user_id,
        UserAddedSkill.skill_slug == slug,
    )
    skill = (await db.execute(query)).scalar_one_or_none()

    if not skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill not found",
        )

    skill.is_enabled = not skill.is_enabled
    await db.commit()
    await db.refresh(skill)

    return UserAddedSkillResponse.model_validate(skill)


# ============================================================================
# Submission Routes
# ============================================================================


@router.post(
    "/submit", response_model=MarketplaceSkillResponse, status_code=status.HTTP_201_CREATED
)
@limiter.limit(RATE_LIMIT_STANDARD)
async def submit_skill_to_marketplace(
    request: Request,
    response: Response,
    body: MarketplaceSkillSubmitRequest,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> MarketplaceSkillResponse:
    """Submit a skill to the marketplace for approval."""
    user_id = user["id"]

    # Check for duplicate slug
    existing = await db.execute(select(MarketplaceSkill).where(MarketplaceSkill.slug == body.slug))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Skill with slug '{body.slug}' already exists",
        )

    # Create marketplace skill in pending state
    now = datetime.now(UTC)
    skill = MarketplaceSkill(
        id=str(uuid4()),
        submitted_by=user_id,
        name=body.name,
        slug=body.slug,
        description=body.description,
        version="1.0.0",
        category=body.category,
        triggers=body.triggers,
        tags=body.tags,
        required_tools=body.required_tools,
        required_context=body.required_context,
        steps=body.steps,
        system_prompt=body.system_prompt,
        examples=body.examples,
        status="pending",
        submitted_at=now,
    )

    db.add(skill)
    await db.commit()
    await db.refresh(skill)

    return MarketplaceSkillResponse.model_validate(skill)


@router.get("/my/submissions", response_model=list[MarketplaceSkillResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_my_submissions(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> list[MarketplaceSkillResponse]:
    """List user's marketplace submissions."""
    user_id = user["id"]

    query = (
        select(MarketplaceSkill)
        .where(MarketplaceSkill.submitted_by == user_id)
        .order_by(MarketplaceSkill.submitted_at.desc())
    )
    result = await db.execute(query)
    skills = result.scalars().all()

    return [MarketplaceSkillResponse.model_validate(s) for s in skills]
