"""Admin routes for marketplace skill management."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import MarketplaceSkill, SkillExecution, SystemSkill, User
from src.middleware.admin import require_admin_dependency

router = APIRouter(prefix="/marketplace", tags=["admin-marketplace"])


# ============================================================================
# Request/Response Models
# ============================================================================


class MarketplaceSkillAdminResponse(BaseModel):
    """Admin response with full marketplace skill details."""

    id: str
    name: str
    slug: str
    description: str
    version: str
    category: str
    triggers: list[str]
    tags: list[str]
    required_tools: list[str]
    required_context: list[str]
    steps: list[dict[str, Any]]
    system_prompt: str | None
    examples: list[dict[str, Any]] | None
    status: str
    rejection_reason: str | None
    usage_count: int
    install_count: int
    submitted_by: str
    submitted_at: datetime
    reviewed_by: str | None
    reviewed_at: datetime | None
    approved_skill_id: str | None
    submitter_name: str | None = None
    submitter_email: str | None = None

    model_config = ConfigDict(from_attributes=True)


class MarketplaceListAdminResponse(BaseModel):
    """Admin list response."""

    skills: list[MarketplaceSkillAdminResponse]
    total: int
    pending_count: int
    approved_count: int
    rejected_count: int


class ApproveSkillRequest(BaseModel):
    """Request to approve a marketplace skill."""

    is_default: bool = Field(default=False, description="Make available to all users by default")
    allowed_plans: list[str] | None = Field(default=None, description="Restrict to specific plans")


class RejectSkillRequest(BaseModel):
    """Request to reject a marketplace skill."""

    reason: str = Field(..., min_length=10, max_length=500)


# ============================================================================
# Admin Routes
# ============================================================================


@router.get("", response_model=MarketplaceListAdminResponse)
async def list_all_marketplace_skills(
    status_filter: str | None = Query(None, pattern="^(pending|approved|rejected)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    admin: dict[str, str | None] = Depends(require_admin_dependency),
) -> MarketplaceListAdminResponse:
    """List all marketplace skills for admin review."""
    # Build query
    query = select(MarketplaceSkill, User).outerjoin(User, MarketplaceSkill.submitted_by == User.id)

    if status_filter:
        query = query.where(MarketplaceSkill.status == status_filter)

    query = query.order_by(
        # Pending first, then by submission date
        MarketplaceSkill.status.desc(),
        MarketplaceSkill.submitted_at.desc(),
    )

    # Get paginated results
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    rows = result.all()

    skills = []
    for skill, user in rows:
        skill_dict = MarketplaceSkillAdminResponse.model_validate(skill).model_dump()
        if user:
            skill_dict["submitter_name"] = user.name
            skill_dict["submitter_email"] = user.email
        skills.append(MarketplaceSkillAdminResponse(**skill_dict))

    # Get counts
    pending_count = (
        await db.execute(
            select(func.count(MarketplaceSkill.id)).where(MarketplaceSkill.status == "pending")
        )
    ).scalar() or 0

    approved_count = (
        await db.execute(
            select(func.count(MarketplaceSkill.id)).where(MarketplaceSkill.status == "approved")
        )
    ).scalar() or 0

    rejected_count = (
        await db.execute(
            select(func.count(MarketplaceSkill.id)).where(MarketplaceSkill.status == "rejected")
        )
    ).scalar() or 0

    return MarketplaceListAdminResponse(
        skills=skills,
        total=pending_count + approved_count + rejected_count,
        pending_count=pending_count,
        approved_count=approved_count,
        rejected_count=rejected_count,
    )


@router.get("/{skill_id}", response_model=MarketplaceSkillAdminResponse)
async def get_marketplace_skill_admin(
    skill_id: str,
    db: AsyncSession = Depends(get_db),
    admin: dict[str, str | None] = Depends(require_admin_dependency),
) -> MarketplaceSkillAdminResponse:
    """Get full details of a marketplace skill for review."""
    query = (
        select(MarketplaceSkill, User)
        .outerjoin(User, MarketplaceSkill.submitted_by == User.id)
        .where(MarketplaceSkill.id == skill_id)
    )

    result = await db.execute(query)
    row = result.first()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill not found",
        )

    skill, user = row
    skill_dict = MarketplaceSkillAdminResponse.model_validate(skill).model_dump()
    if user:
        skill_dict["submitter_name"] = user.name
        skill_dict["submitter_email"] = user.email

    return MarketplaceSkillAdminResponse(**skill_dict)


@router.post("/{skill_id}/approve", response_model=MarketplaceSkillAdminResponse)
async def approve_marketplace_skill(
    skill_id: str,
    request: ApproveSkillRequest,
    db: AsyncSession = Depends(get_db),
    admin: dict[str, str | None] = Depends(require_admin_dependency),
) -> MarketplaceSkillAdminResponse:
    """Approve a marketplace skill submission."""
    admin_id = admin["id"]

    # Get the skill
    skill_query = select(MarketplaceSkill).where(MarketplaceSkill.id == skill_id)
    skill = (await db.execute(skill_query)).scalar_one_or_none()

    if not skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill not found",
        )

    if skill.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Skill is already {skill.status}",
        )

    # Check for duplicate slug in SystemSkill
    existing = await db.execute(select(SystemSkill).where(SystemSkill.slug == skill.slug))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A system skill with slug '{skill.slug}' already exists",
        )

    # Create SystemSkill from marketplace skill
    now = datetime.now(UTC)
    system_skill = SystemSkill(
        id=str(uuid4()),
        name=skill.name,
        slug=skill.slug,
        description=skill.description,
        version=skill.version,
        author=f"community:{skill.submitted_by}",
        triggers=skill.triggers,
        tags=skill.tags,
        required_tools=skill.required_tools,
        required_context=skill.required_context,
        steps=skill.steps,
        system_prompt=skill.system_prompt,
        examples=skill.examples,
        metadata={
            "category": skill.category,
            "marketplace_id": skill.id,
            "submitted_by": skill.submitted_by,
        },
        is_active=True,
        is_default=request.is_default,
        allowed_plans=request.allowed_plans,
        created_at=now,
        created_by=admin_id,
    )
    db.add(system_skill)

    # Update marketplace skill status
    skill.status = "approved"
    skill.reviewed_by = admin_id
    skill.reviewed_at = now
    skill.approved_skill_id = system_skill.id

    await db.commit()
    await db.refresh(skill)

    return MarketplaceSkillAdminResponse.model_validate(skill)


@router.post("/{skill_id}/reject", response_model=MarketplaceSkillAdminResponse)
async def reject_marketplace_skill(
    skill_id: str,
    request: RejectSkillRequest,
    db: AsyncSession = Depends(get_db),
    admin: dict[str, str | None] = Depends(require_admin_dependency),
) -> MarketplaceSkillAdminResponse:
    """Reject a marketplace skill submission."""
    admin_id = admin["id"]

    # Get the skill
    skill_query = select(MarketplaceSkill).where(MarketplaceSkill.id == skill_id)
    skill = (await db.execute(skill_query)).scalar_one_or_none()

    if not skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill not found",
        )

    if skill.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Skill is already {skill.status}",
        )

    # Update status
    skill.status = "rejected"
    skill.rejection_reason = request.reason
    skill.reviewed_by = admin_id
    skill.reviewed_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(skill)

    return MarketplaceSkillAdminResponse.model_validate(skill)


@router.delete("/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_marketplace_skill(
    skill_id: str,
    db: AsyncSession = Depends(get_db),
    admin: dict[str, str | None] = Depends(require_admin_dependency),
) -> None:
    """Delete a marketplace skill (and its system skill if approved)."""
    # Get the skill
    skill_query = select(MarketplaceSkill).where(MarketplaceSkill.id == skill_id)
    skill = (await db.execute(skill_query)).scalar_one_or_none()

    if not skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill not found",
        )

    # If approved, also delete the system skill
    if skill.approved_skill_id:
        system_skill = (
            await db.execute(select(SystemSkill).where(SystemSkill.id == skill.approved_skill_id))
        ).scalar_one_or_none()
        if system_skill:
            await db.delete(system_skill)

    await db.delete(skill)
    await db.commit()


# ============================================================================
# Analytics
# ============================================================================


@router.get("/analytics/popularity", response_model=dict)
async def get_skill_popularity(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    admin: dict[str, str | None] = Depends(require_admin_dependency),
) -> dict[str, Any]:
    """Get skill popularity analytics."""
    end_date = datetime.now(UTC)
    start_date = end_date - timedelta(days=days)

    # Get execution counts by skill
    exec_query = (
        select(
            SkillExecution.skill_slug,
            SkillExecution.skill_type,
            func.count(SkillExecution.id).label("execution_count"),
            func.count(SkillExecution.id)
            .filter(SkillExecution.success == True)
            .label("success_count"),
        )
        .where(SkillExecution.executed_at >= start_date)
        .group_by(SkillExecution.skill_slug, SkillExecution.skill_type)
        .order_by(func.count(SkillExecution.id).desc())
        .limit(limit)
    )

    result = await db.execute(exec_query)
    rows = result.all()

    skills = []
    for row in rows:
        skills.append(
            {
                "skill_slug": row.skill_slug,
                "skill_type": row.skill_type,
                "execution_count": row.execution_count,
                "success_count": row.success_count or 0,
                "success_rate": round((row.success_count or 0) / row.execution_count * 100, 2)
                if row.execution_count > 0
                else 0,
            }
        )

    # Get install counts for marketplace skills
    install_query = (
        select(MarketplaceSkill.slug, MarketplaceSkill.name, MarketplaceSkill.install_count)
        .where(MarketplaceSkill.status == "approved")
        .order_by(MarketplaceSkill.install_count.desc())
        .limit(limit)
    )
    install_result = await db.execute(install_query)
    top_installed = [
        {"slug": r.slug, "name": r.name, "install_count": r.install_count} for r in install_result
    ]

    return {
        "period_days": days,
        "top_executed": skills,
        "top_installed": top_installed,
    }
