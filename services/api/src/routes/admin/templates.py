"""Admin pod template management routes."""

from datetime import datetime
from typing import Annotated, Any, cast

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import PodTemplate, Session, User
from src.middleware.admin import get_admin_user_id, require_admin
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter
from src.routes.templates import get_icon_url

logger = structlog.get_logger()

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db)]


# ==================== Pydantic Models ====================


class PortMapping(BaseModel):
    """Port mapping for template."""

    port: int
    name: str
    protocol: str = "http"


class CreateTemplateRequest(BaseModel):
    """Create pod template request."""

    name: str = Field(..., min_length=1, max_length=255)
    slug: str = Field(..., min_length=1, max_length=100, pattern=r"^[a-z0-9-]+$")
    description: str | None = None
    icon: str | None = None
    base_image: str = "podex/workspace:latest"

    # Template configuration
    pre_install_commands: list[str] | None = None
    environment_variables: dict[str, str] | None = None
    default_ports: list[PortMapping] | None = None
    packages: list[str] | None = None
    language_versions: dict[str, str] | None = None

    # Visibility
    is_public: bool = True
    is_official: bool = True


class UpdateTemplateRequest(BaseModel):
    """Update pod template request."""

    name: str | None = None
    description: str | None = None
    icon: str | None = None
    base_image: str | None = None
    pre_install_commands: list[str] | None = None
    environment_variables: dict[str, str] | None = None
    default_ports: list[dict[str, Any]] | None = None
    packages: list[str] | None = None
    language_versions: dict[str, str] | None = None
    is_public: bool | None = None
    is_official: bool | None = None


class AdminTemplateResponse(BaseModel):
    """Admin template response with usage stats."""

    id: str
    name: str
    slug: str
    description: str | None
    icon: str | None
    icon_url: str | None = None
    base_image: str
    pre_install_commands: list[str] | None
    environment_variables: dict[str, str] | None
    default_ports: list[dict[str, Any]] | None
    packages: list[str] | None
    language_versions: dict[str, str] | None
    is_public: bool
    is_official: bool
    owner_id: str | None
    owner_email: str | None = None
    usage_count: int
    created_at: datetime
    updated_at: datetime

    # Aggregated
    active_session_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class TemplateListResponse(BaseModel):
    """Paginated template list response."""

    items: list[AdminTemplateResponse]
    total: int
    page: int
    page_size: int
    has_more: bool


# ==================== Endpoints ====================


@router.get("", response_model=TemplateListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def list_templates(
    request: Request,
    response: Response,
    db: DbSession,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
    is_official: Annotated[bool | None, Query()] = None,
    is_public: Annotated[bool | None, Query()] = None,
    search: Annotated[str | None, Query()] = None,
) -> TemplateListResponse:
    """List all pod templates with filtering and pagination."""
    query = select(PodTemplate)
    count_query = select(func.count()).select_from(PodTemplate)

    # Apply filters
    conditions = []

    if is_official is not None:
        conditions.append(PodTemplate.is_official == is_official)

    if is_public is not None:
        conditions.append(PodTemplate.is_public == is_public)

    if search:
        search_pattern = f"%{search}%"
        conditions.append(
            or_(
                PodTemplate.name.ilike(search_pattern),
                PodTemplate.slug.ilike(search_pattern),
                PodTemplate.description.ilike(search_pattern),
            )
        )

    if conditions:
        for cond in conditions:
            query = query.where(cond)
            count_query = count_query.where(cond)

    # Get total count
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Apply pagination and ordering
    offset = (page - 1) * page_size
    query = (
        query.order_by(PodTemplate.is_official.desc(), PodTemplate.usage_count.desc())
        .offset(offset)
        .limit(page_size)
    )

    result = await db.execute(query)
    templates = result.scalars().all()

    if not templates:
        return TemplateListResponse(
            items=[],
            total=total,
            page=page,
            page_size=page_size,
            has_more=False,
        )

    # Batch query: Get all template IDs for batch lookups
    template_ids = [template.id for template in templates]

    # Batch query: Get active session counts for all templates in one query
    session_counts_query = (
        select(Session.template_id, func.count(Session.id).label("active_count"))
        .where(Session.template_id.in_(template_ids))
        .where(Session.status == "running")
        .group_by(Session.template_id)
    )
    session_counts_result = await db.execute(session_counts_query)
    session_counts: dict[str, int] = {
        row.template_id: int(row.active_count) for row in session_counts_result
    }

    # Batch query: Get owner emails for all templates with owners in one query
    owner_ids = [t.owner_id for t in templates if t.owner_id]
    owner_emails: dict[str, str] = {}
    if owner_ids:
        owners_query = select(User.id, User.email).where(User.id.in_(owner_ids))
        owners_result = await db.execute(owners_query)
        owner_emails = {row.id: row.email for row in owners_result}

    # Build response with batched data (no N+1 queries)
    items = []
    for template in templates:
        active_session_count = session_counts.get(template.id, 0)
        owner_email = owner_emails.get(template.owner_id) if template.owner_id else None

        items.append(
            AdminTemplateResponse(
                id=str(template.id),
                name=template.name,
                slug=template.slug,
                description=template.description,
                icon=template.icon,
                icon_url=get_icon_url(template.icon),
                base_image=template.base_image,
                pre_install_commands=template.pre_install_commands,
                environment_variables=template.environment_variables,
                default_ports=template.default_ports,
                packages=template.packages,
                language_versions=template.language_versions,
                is_public=template.is_public,
                is_official=template.is_official,
                owner_id=str(template.owner_id) if template.owner_id else None,
                owner_email=owner_email,
                usage_count=template.usage_count,
                created_at=template.created_at,
                updated_at=template.updated_at,
                active_session_count=active_session_count,
            )
        )

    return TemplateListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        has_more=(offset + page_size) < total,
    )


@router.post("", response_model=AdminTemplateResponse, status_code=201)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def create_template(
    request: Request,
    response: Response,
    data: CreateTemplateRequest,
    db: DbSession,
) -> AdminTemplateResponse:
    """Create a new official pod template."""
    admin_id = get_admin_user_id(request)

    # Check slug uniqueness
    existing = await db.execute(select(PodTemplate).where(PodTemplate.slug == data.slug))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Template slug already exists")

    template = PodTemplate(
        name=data.name,
        slug=data.slug,
        description=data.description,
        icon=data.icon,
        base_image=data.base_image,
        pre_install_commands=data.pre_install_commands,
        environment_variables=data.environment_variables,
        default_ports=[p.model_dump() for p in data.default_ports] if data.default_ports else None,
        packages=data.packages,
        language_versions=data.language_versions,
        is_public=data.is_public,
        is_official=data.is_official,
        owner_id=admin_id if not data.is_official else None,
    )

    db.add(template)
    await db.commit()
    await db.refresh(template)

    logger.info("Admin created template", admin_id=admin_id, slug=template.slug)

    return AdminTemplateResponse(
        id=str(template.id),
        name=template.name,
        slug=template.slug,
        description=template.description,
        icon=template.icon,
        icon_url=get_icon_url(template.icon),
        base_image=template.base_image,
        pre_install_commands=template.pre_install_commands,
        environment_variables=template.environment_variables,
        default_ports=template.default_ports,
        packages=template.packages,
        language_versions=template.language_versions,
        is_public=template.is_public,
        is_official=template.is_official,
        owner_id=str(template.owner_id) if template.owner_id else None,
        owner_email=None,
        usage_count=0,
        created_at=template.created_at,
        updated_at=template.updated_at,
        active_session_count=0,
    )


@router.get("/{template_id}", response_model=AdminTemplateResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_template(
    template_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> AdminTemplateResponse:
    """Get pod template by ID or slug."""
    result = await db.execute(
        select(PodTemplate).where(
            or_(PodTemplate.id == template_id, PodTemplate.slug == template_id)
        )
    )
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    active_count_result = await db.execute(
        select(func.count())
        .select_from(Session)
        .where(Session.template_id == template.id)
        .where(Session.status == "running")
    )
    active_session_count = active_count_result.scalar() or 0

    owner_email = None
    if template.owner_id:
        owner_result = await db.execute(select(User.email).where(User.id == template.owner_id))
        owner_email = owner_result.scalar_one_or_none()

    return AdminTemplateResponse(
        id=str(template.id),
        name=template.name,
        slug=template.slug,
        description=template.description,
        icon=template.icon,
        icon_url=get_icon_url(template.icon),
        base_image=template.base_image,
        pre_install_commands=template.pre_install_commands,
        environment_variables=template.environment_variables,
        default_ports=template.default_ports,
        packages=template.packages,
        language_versions=template.language_versions,
        is_public=template.is_public,
        is_official=template.is_official,
        owner_id=str(template.owner_id) if template.owner_id else None,
        owner_email=owner_email,
        usage_count=template.usage_count,
        created_at=template.created_at,
        updated_at=template.updated_at,
        active_session_count=active_session_count,
    )


@router.patch("/{template_id}", response_model=AdminTemplateResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def update_template(
    template_id: str,
    request: Request,
    response: Response,
    data: UpdateTemplateRequest,
    db: DbSession,
) -> AdminTemplateResponse:
    """Update pod template."""
    admin_id = get_admin_user_id(request)

    result = await db.execute(select(PodTemplate).where(PodTemplate.id == template_id))
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    update_data = data.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        setattr(template, field, value)

    await db.commit()
    await db.refresh(template)

    logger.info(
        "Admin updated template",
        admin_id=admin_id,
        template_id=template_id,
        changes=list(update_data.keys()),
    )

    return cast("AdminTemplateResponse", await get_template(template_id, request, db))


@router.delete("/{template_id}")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def delete_template(
    template_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, str]:
    """Delete pod template."""
    admin_id = get_admin_user_id(request)

    result = await db.execute(select(PodTemplate).where(PodTemplate.id == template_id))
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # Check for active sessions
    active_count_result = await db.execute(
        select(func.count())
        .select_from(Session)
        .where(Session.template_id == template.id)
        .where(Session.status == "running")
    )
    active_count = active_count_result.scalar() or 0

    if active_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete template with {active_count} active sessions.",
        )

    # For official templates, just mark as non-public
    if template.is_official:
        template.is_public = False
        template.is_official = False
        await db.commit()
        logger.info("Admin unpublished official template", admin_id=admin_id, slug=template.slug)
        return {"message": "Official template unpublished"}

    # For non-official, actually delete
    await db.delete(template)
    await db.commit()

    logger.info("Admin deleted template", admin_id=admin_id, slug=template.slug)

    return {"message": "Template deleted"}


@router.post("/{template_id}/promote")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def promote_template(
    template_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, str]:
    """Promote a user template to official."""
    admin_id = get_admin_user_id(request)

    result = await db.execute(select(PodTemplate).where(PodTemplate.id == template_id))
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    if template.is_official:
        raise HTTPException(status_code=400, detail="Template is already official")

    template.is_official = True
    template.is_public = True
    await db.commit()

    logger.info(
        "Admin promoted template to official",
        admin_id=admin_id,
        template_slug=template.slug,
    )

    return {"message": "Template promoted to official"}
