"""Agent template management routes."""

import secrets
import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import AgentTemplate, User, get_db
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

router = APIRouter()

# Maximum characters for system prompt preview
SYSTEM_PROMPT_PREVIEW_LENGTH = 500

# Type alias for database session dependency
DbSession = Annotated[AsyncSession, Depends(get_db)]


def generate_share_token() -> str:
    """Generate a unique share token for a template."""
    return secrets.token_urlsafe(16)[:24]  # 24-char URL-safe token


# Valid tool names that can be assigned to custom agents
VALID_TOOLS = {
    "read_file",
    "write_file",
    "search_code",
    "run_command",
    "list_directory",
    "create_task",
}


def get_current_user_id(request: Request) -> str:
    """Get current user ID from request state.

    Raises:
        HTTPException: If user is not authenticated.
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return str(user_id)


class AgentTemplateCreate(BaseModel):
    """Create agent template request."""

    name: str = Field(..., min_length=1, max_length=255)
    slug: str = Field(..., pattern=r"^[a-z0-9-]+$", min_length=1, max_length=100)
    description: str | None = None
    icon: str | None = None
    system_prompt: str = Field(..., min_length=10)
    allowed_tools: list[str]
    # Model must be provided explicitly; defaults come from platform/role settings
    model: str
    temperature: float | None = Field(None, ge=0, le=1)
    max_tokens: int | None = Field(None, ge=1, le=100000)
    config: dict[str, Any] | None = None


class AgentTemplateUpdate(BaseModel):
    """Update agent template request."""

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    icon: str | None = None
    system_prompt: str | None = Field(None, min_length=10)
    allowed_tools: list[str] | None = None
    model: str | None = None
    temperature: float | None = Field(None, ge=0, le=1)
    max_tokens: int | None = Field(None, ge=1, le=100000)
    config: dict[str, Any] | None = None


class AgentTemplateResponse(BaseModel):
    """Agent template response."""

    id: str
    user_id: str
    name: str
    slug: str
    description: str | None
    icon: str | None
    system_prompt: str
    allowed_tools: list[str]
    model: str
    temperature: float | None
    max_tokens: int | None
    config: dict[str, Any] | None
    is_public: bool
    share_token: str | None
    usage_count: int
    clone_count: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SharedTemplateOwner(BaseModel):
    """Owner info for shared template."""

    name: str | None
    avatar_url: str | None


class SharedTemplateResponse(BaseModel):
    """Public shared template response.

    Includes owner info, excludes full system prompt for preview.
    """

    id: str
    name: str
    slug: str
    description: str | None
    icon: str | None
    system_prompt_preview: str  # First 500 chars
    allowed_tools: list[str]
    model: str
    clone_count: int
    created_at: datetime
    owner: SharedTemplateOwner


class ShareLinkResponse(BaseModel):
    """Share link response."""

    share_token: str
    share_url: str


class AvailableToolsResponse(BaseModel):
    """Available tools response."""

    tools: dict[str, str]


@router.get("/tools", response_model=AvailableToolsResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_available_tools(request: Request, response: Response) -> AvailableToolsResponse:
    """List all available tools that can be assigned to custom agents."""
    tools = {
        "read_file": ("Read files from the workspace - useful for code analysis"),
        "write_file": "Create or modify files - essential for coding agents",
        "search_code": ("Search for code patterns across the workspace"),
        "run_command": ("Execute shell commands - for running tests, builds, git commands"),
        "list_directory": ("Browse directory contents - for exploring project structure"),
        "create_task": ("Delegate tasks to other agents - for orchestration agents"),
    }
    return AvailableToolsResponse(tools=tools)


@router.get("", response_model=list[AgentTemplateResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_agent_templates(
    request: Request,
    response: Response,
    db: DbSession,
) -> list[AgentTemplateResponse]:
    """List all agent templates for current user."""
    user_id = get_current_user_id(request)

    query = (
        select(AgentTemplate)
        .where(AgentTemplate.user_id == user_id)
        .order_by(AgentTemplate.created_at.desc())
    )
    result = await db.execute(query)
    templates = result.scalars().all()
    return [AgentTemplateResponse.model_validate(t) for t in templates]


@router.post("", response_model=AgentTemplateResponse, status_code=201)
@limiter.limit(RATE_LIMIT_STANDARD)
async def create_agent_template(
    request: Request,
    response: Response,
    data: AgentTemplateCreate,
    db: DbSession,
) -> AgentTemplateResponse:
    """Create a new agent template."""
    user_id = get_current_user_id(request)

    # Validate tools
    invalid_tools = set(data.allowed_tools) - VALID_TOOLS
    if invalid_tools:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid tools: {invalid_tools}. Valid tools: {VALID_TOOLS}",
        )

    # Check for duplicate slug
    existing = await db.execute(
        select(AgentTemplate).where(
            AgentTemplate.user_id == user_id,
            AgentTemplate.slug == data.slug,
        ),
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail=f"Template with slug '{data.slug}' already exists",
        )

    template = AgentTemplate(
        user_id=user_id,
        name=data.name,
        slug=data.slug,
        description=data.description,
        icon=data.icon,
        system_prompt=data.system_prompt,
        allowed_tools=data.allowed_tools,
        model=data.model,
        temperature=data.temperature,
        max_tokens=data.max_tokens,
        config=data.config,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)

    return AgentTemplateResponse.model_validate(template)


@router.get("/{template_id}", response_model=AgentTemplateResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_agent_template(
    template_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> AgentTemplateResponse:
    """Get a specific agent template."""
    user_id = get_current_user_id(request)

    query = select(AgentTemplate).where(
        AgentTemplate.id == template_id,
        AgentTemplate.user_id == user_id,
    )
    result = await db.execute(query)
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail="Agent template not found")

    return AgentTemplateResponse.model_validate(template)


@router.patch("/{template_id}", response_model=AgentTemplateResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def update_agent_template(
    template_id: str,
    request: Request,
    response: Response,
    data: AgentTemplateUpdate,
    db: DbSession,
) -> AgentTemplateResponse:
    """Update an agent template."""
    user_id = get_current_user_id(request)

    query = select(AgentTemplate).where(
        AgentTemplate.id == template_id,
        AgentTemplate.user_id == user_id,
    )
    result = await db.execute(query)
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail="Agent template not found")

    # Validate tools if provided
    if data.allowed_tools:
        invalid_tools = set(data.allowed_tools) - VALID_TOOLS
        if invalid_tools:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid tools: {invalid_tools}",
            )

    # Update fields
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(template, field, value)

    await db.commit()
    await db.refresh(template)

    return AgentTemplateResponse.model_validate(template)


@router.delete("/{template_id}")
@limiter.limit(RATE_LIMIT_STANDARD)
async def delete_agent_template(
    template_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, str]:
    """Delete an agent template."""
    user_id = get_current_user_id(request)

    query = select(AgentTemplate).where(
        AgentTemplate.id == template_id,
        AgentTemplate.user_id == user_id,
    )
    result = await db.execute(query)
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail="Agent template not found")

    await db.delete(template)
    await db.commit()
    return {"message": "Agent template deleted"}


# ==================== Sharing Endpoints ====================


@router.post("/{template_id}/share", response_model=ShareLinkResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def create_share_link(
    template_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> ShareLinkResponse:
    """Generate a shareable link for an agent template.

    If a share token already exists, returns the existing link.
    """
    user_id = get_current_user_id(request)

    query = select(AgentTemplate).where(
        AgentTemplate.id == template_id,
        AgentTemplate.user_id == user_id,
    )
    result = await db.execute(query)
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail="Agent template not found")

    # Generate share token if not exists
    if not template.share_token:
        template.share_token = generate_share_token()
        await db.commit()
        await db.refresh(template)

    # Build share URL (frontend route)
    share_url = f"/agents/shared/{template.share_token}"

    return ShareLinkResponse(
        share_token=template.share_token,
        share_url=share_url,
    )


@router.delete("/{template_id}/share")
@limiter.limit(RATE_LIMIT_STANDARD)
async def revoke_share_link(
    template_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, str]:
    """Revoke the shareable link for an agent template."""
    user_id = get_current_user_id(request)

    query = select(AgentTemplate).where(
        AgentTemplate.id == template_id,
        AgentTemplate.user_id == user_id,
    )
    result = await db.execute(query)
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail="Agent template not found")

    template.share_token = None
    await db.commit()

    return {"message": "Share link revoked"}


@router.get("/shared/{share_token}", response_model=SharedTemplateResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_shared_template(
    request: Request,
    response: Response,
    share_token: str,
    db: DbSession,
) -> SharedTemplateResponse:
    """Get a shared agent template by its share token.

    This is a public endpoint - no authentication required.
    """
    query = select(AgentTemplate).where(AgentTemplate.share_token == share_token)
    result = await db.execute(query)
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail="Shared template not found or link expired")

    # Get owner info
    owner_query = select(User).where(User.id == template.user_id)
    owner_result = await db.execute(owner_query)
    owner = owner_result.scalar_one_or_none()

    owner_info = SharedTemplateOwner(
        name=owner.name if owner else None,
        avatar_url=owner.avatar_url if owner else None,
    )

    # Create preview of system prompt (first N chars)
    system_prompt_preview = template.system_prompt[:SYSTEM_PROMPT_PREVIEW_LENGTH]
    if len(template.system_prompt) > SYSTEM_PROMPT_PREVIEW_LENGTH:
        system_prompt_preview += "..."

    return SharedTemplateResponse(
        id=template.id,
        name=template.name,
        slug=template.slug,
        description=template.description,
        icon=template.icon,
        system_prompt_preview=system_prompt_preview,
        allowed_tools=template.allowed_tools,
        model=template.model,
        clone_count=template.clone_count,
        created_at=template.created_at,
        owner=owner_info,
    )


@router.post("/shared/{share_token}/clone", response_model=AgentTemplateResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def clone_shared_template(
    share_token: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> AgentTemplateResponse:
    """Clone a shared agent template to your own collection.

    Creates a copy of the template under your account with a unique slug.
    """
    user_id = get_current_user_id(request)

    # Get the shared template
    query = select(AgentTemplate).where(AgentTemplate.share_token == share_token)
    result = await db.execute(query)
    source_template = result.scalar_one_or_none()

    if not source_template:
        raise HTTPException(status_code=404, detail="Shared template not found or link expired")

    # Check if user is trying to clone their own template
    if source_template.user_id == user_id:
        raise HTTPException(status_code=400, detail="Cannot clone your own template")

    # Generate unique slug for the cloned template
    # SECURITY: Limit iterations to prevent unbounded loop/DoS
    max_slug_attempts = 100
    base_slug = f"{source_template.slug}-copy"
    slug = base_slug
    counter = 1

    while counter <= max_slug_attempts:
        existing = await db.execute(
            select(AgentTemplate).where(
                AgentTemplate.user_id == user_id,
                AgentTemplate.slug == slug,
            ),
        )
        if not existing.scalar_one_or_none():
            break
        slug = f"{base_slug}-{counter}"
        counter += 1
    else:
        # Exhausted all attempts - use UUID suffix as fallback
        slug = f"{base_slug}-{uuid.uuid4().hex[:8]}"

    # Atomically increment clone count on source template to prevent race conditions
    await db.execute(
        update(AgentTemplate)
        .where(AgentTemplate.id == source_template.id)
        .values(clone_count=AgentTemplate.clone_count + 1),
    )

    # Create the cloned template
    cloned_template = AgentTemplate(
        user_id=user_id,
        name=f"{source_template.name} (Copy)",
        slug=slug,
        description=source_template.description,
        icon=source_template.icon,
        system_prompt=source_template.system_prompt,
        allowed_tools=source_template.allowed_tools,
        model=source_template.model,
        temperature=source_template.temperature,
        max_tokens=source_template.max_tokens,
        config=source_template.config,
    )
    db.add(cloned_template)

    await db.commit()
    await db.refresh(cloned_template)

    return AgentTemplateResponse.model_validate(cloned_template)
