"""Admin agent tools management routes."""

from datetime import datetime
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import AgentTool
from src.middleware.admin import get_admin_user_id, require_admin
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

logger = structlog.get_logger()

router = APIRouter()
public_router = APIRouter()  # For unauthenticated endpoints
DbSession = Annotated[AsyncSession, Depends(get_db)]


# ==================== Pydantic Models ====================


class AgentToolResponse(BaseModel):
    """Agent tool response."""

    id: str
    name: str
    description: str
    parameters: dict[str, Any]
    category: str
    sort_order: int
    is_enabled: bool
    is_system: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class UpdateAgentToolRequest(BaseModel):
    """Update agent tool request."""

    description: str | None = None
    parameters: dict[str, Any] | None = None
    category: str | None = Field(None, max_length=50)
    sort_order: int | None = Field(None, ge=0)
    is_enabled: bool | None = None


class CreateAgentToolRequest(BaseModel):
    """Create custom agent tool request."""

    name: str = Field(..., min_length=1, max_length=100, pattern=r"^[a-z0-9_]+$")
    description: str = Field(..., min_length=1)
    parameters: dict[str, Any] = Field(...)
    category: str = Field(default="custom", max_length=50)
    sort_order: int = Field(default=500, ge=0)


class AgentToolListResponse(BaseModel):
    """List of agent tools."""

    tools: list[AgentToolResponse]
    total: int


# ==================== Public Endpoints ====================


@public_router.get("", response_model=AgentToolListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_public_tools(
    request: Request,
    response: Response,
    db: DbSession,
    category: str | None = None,
) -> AgentToolListResponse:
    """Get all enabled agent tools (public).

    This is the single source of truth for agent tool definitions.
    Agent service should use this instead of hardcoded constants.
    """
    _ = request  # Required for rate limiter
    query = select(AgentTool).where(AgentTool.is_enabled == True)
    if category:
        query = query.where(AgentTool.category == category)
    query = query.order_by(AgentTool.sort_order, AgentTool.name)

    result = await db.execute(query)
    tools = result.scalars().all()

    return AgentToolListResponse(
        tools=[AgentToolResponse.model_validate(t) for t in tools],
        total=len(tools),
    )


@public_router.get("/{tool_name}", response_model=AgentToolResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_public_tool(
    tool_name: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> AgentToolResponse:
    """Get a specific agent tool by name (public)."""
    _ = request  # Required for rate limiter
    result = await db.execute(
        select(AgentTool).where(
            AgentTool.name == tool_name,
            AgentTool.is_enabled == True,
        )
    )
    tool = result.scalar_one_or_none()

    if not tool:
        raise HTTPException(status_code=404, detail=f"Tool '{tool_name}' not found")

    return AgentToolResponse.model_validate(tool)


# ==================== Admin Endpoints ====================


@router.get("", response_model=AgentToolListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def list_tools(
    request: Request,
    response: Response,
    db: DbSession,
    category: str | None = None,
) -> AgentToolListResponse:
    """List all agent tools (admin).

    Includes disabled tools that are hidden from public endpoint.
    """
    query = select(AgentTool)
    if category:
        query = query.where(AgentTool.category == category)
    query = query.order_by(AgentTool.sort_order, AgentTool.name)

    result = await db.execute(query)
    tools = result.scalars().all()

    return AgentToolListResponse(
        tools=[AgentToolResponse.model_validate(t) for t in tools],
        total=len(tools),
    )


@router.get("/{tool_id}", response_model=AgentToolResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_tool(
    tool_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> AgentToolResponse:
    """Get a specific agent tool by ID (admin)."""
    result = await db.execute(select(AgentTool).where(AgentTool.id == tool_id))
    tool = result.scalar_one_or_none()

    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")

    return AgentToolResponse.model_validate(tool)


@router.put("/{tool_id}", response_model=AgentToolResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def update_tool(
    tool_id: str,
    data: UpdateAgentToolRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> AgentToolResponse:
    """Update an agent tool (admin).

    Only non-None fields in the request will be updated.
    """
    result = await db.execute(select(AgentTool).where(AgentTool.id == tool_id))
    tool = result.scalar_one_or_none()

    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")

    # Update only provided fields
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(tool, field, value)

    await db.commit()
    await db.refresh(tool)

    logger.info(
        "Agent tool updated",
        tool_id=tool_id,
        tool_name=tool.name,
        admin_id=get_admin_user_id(request),
        updated_fields=list(update_data.keys()),
    )

    return AgentToolResponse.model_validate(tool)


@router.post("", response_model=AgentToolResponse, status_code=201)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def create_tool(
    data: CreateAgentToolRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> AgentToolResponse:
    """Create a new custom agent tool (admin).

    System tools are created via database seeds.
    Custom tools created here can be deleted.
    """
    # Check if tool already exists
    result = await db.execute(select(AgentTool).where(AgentTool.name == data.name))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Tool '{data.name}' already exists")

    tool = AgentTool(
        name=data.name,
        description=data.description,
        parameters=data.parameters,
        category=data.category,
        sort_order=data.sort_order,
        is_enabled=True,
        is_system=False,  # Custom tools can be deleted
    )

    db.add(tool)
    await db.commit()
    await db.refresh(tool)

    logger.info(
        "Agent tool created",
        tool_id=tool.id,
        tool_name=tool.name,
        admin_id=get_admin_user_id(request),
    )

    return AgentToolResponse.model_validate(tool)


@router.delete("/{tool_id}", status_code=204)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def delete_tool(
    tool_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> None:
    """Delete a custom agent tool (admin).

    System tools cannot be deleted - disable them instead.
    """
    result = await db.execute(select(AgentTool).where(AgentTool.id == tool_id))
    tool = result.scalar_one_or_none()

    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")

    if tool.is_system:
        raise HTTPException(
            status_code=403,
            detail="System tools cannot be deleted. Disable them instead.",
        )

    await db.delete(tool)
    await db.commit()

    logger.info(
        "Agent tool deleted",
        tool_id=tool_id,
        tool_name=tool.name,
        admin_id=get_admin_user_id(request),
    )
