"""Admin MCP server catalog management routes."""

from datetime import datetime
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import DefaultMCPServer
from src.middleware.admin import get_admin_user_id, require_admin
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

logger = structlog.get_logger()

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db)]


class InvalidCategoryError(ValueError):
    """Invalid category value."""

    def __init__(self, category: str, valid_categories: set[str]) -> None:
        self.category = category
        self.valid_categories = valid_categories
        super().__init__(f"Category must be one of: {', '.join(sorted(valid_categories))}")


class InvalidTransportError(ValueError):
    """Invalid transport value."""

    def __init__(self, transport: str, valid_transports: set[str]) -> None:
        self.transport = transport
        self.valid_transports = valid_transports
        super().__init__(f"Transport must be one of: {', '.join(sorted(valid_transports))}")


# Valid categories and transports
VALID_CATEGORIES = {
    "version_control",
    "web",
    "memory",
    "monitoring",
    "productivity",
    "database",
    "communication",
    "containers",
}
VALID_TRANSPORTS = {"stdio", "sse", "http"}


# ==================== Pydantic Models ====================


class DefaultMCPServerResponse(BaseModel):
    """Default MCP server response."""

    id: str
    slug: str
    name: str
    description: str | None
    category: str
    transport: str
    command: str | None
    args: list[str] | None
    url: str | None
    env_vars: dict[str, str] | None
    required_env: list[str] | None
    optional_env: list[str] | None
    icon: str | None
    is_builtin: bool
    docs_url: str | None
    sort_order: int
    is_enabled: bool
    is_system: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CreateDefaultMCPServerRequest(BaseModel):
    """Create default MCP server request."""

    slug: str = Field(..., min_length=1, max_length=50, pattern=r"^[a-z0-9-]+$")
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    category: str = Field(..., min_length=1, max_length=30)
    transport: str = Field(..., min_length=1, max_length=20)
    command: str | None = Field(None, max_length=500)
    args: list[str] | None = Field(default_factory=list)
    url: str | None = Field(None, max_length=500)
    env_vars: dict[str, str] | None = Field(default_factory=dict)
    required_env: list[str] | None = Field(default_factory=list)
    optional_env: list[str] | None = Field(default_factory=list)
    icon: str | None = Field(None, max_length=50)
    is_builtin: bool = False
    docs_url: str | None = Field(None, max_length=500)
    sort_order: int = Field(default=100, ge=0)

    @field_validator("category")
    @classmethod
    def validate_category(cls, v: str) -> str:
        if v not in VALID_CATEGORIES:
            raise InvalidCategoryError(v, VALID_CATEGORIES)
        return v

    @field_validator("transport")
    @classmethod
    def validate_transport(cls, v: str) -> str:
        if v not in VALID_TRANSPORTS:
            raise InvalidTransportError(v, VALID_TRANSPORTS)
        return v


class UpdateDefaultMCPServerRequest(BaseModel):
    """Update default MCP server request."""

    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = None
    category: str | None = Field(None, min_length=1, max_length=30)
    transport: str | None = Field(None, min_length=1, max_length=20)
    command: str | None = Field(None, max_length=500)
    args: list[str] | None = None
    url: str | None = Field(None, max_length=500)
    env_vars: dict[str, str] | None = None
    required_env: list[str] | None = None
    optional_env: list[str] | None = None
    icon: str | None = Field(None, max_length=50)
    is_builtin: bool | None = None
    docs_url: str | None = Field(None, max_length=500)
    sort_order: int | None = Field(None, ge=0)
    is_enabled: bool | None = None

    @field_validator("category")
    @classmethod
    def validate_category(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_CATEGORIES:
            raise InvalidCategoryError(v, VALID_CATEGORIES)
        return v

    @field_validator("transport")
    @classmethod
    def validate_transport(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_TRANSPORTS:
            raise InvalidTransportError(v, VALID_TRANSPORTS)
        return v


class DefaultMCPServerListResponse(BaseModel):
    """List of default MCP servers."""

    servers: list[DefaultMCPServerResponse]
    total: int


# ==================== Admin Endpoints ====================


@router.get("", response_model=DefaultMCPServerListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def list_default_mcp_servers(
    request: Request,
    response: Response,
    db: DbSession,
) -> DefaultMCPServerListResponse:
    """List all default MCP servers in the catalog (admin).

    Includes disabled servers that are hidden from users.
    """
    result = await db.execute(
        select(DefaultMCPServer).order_by(DefaultMCPServer.sort_order, DefaultMCPServer.name)
    )
    servers = result.scalars().all()

    return DefaultMCPServerListResponse(
        servers=[DefaultMCPServerResponse.model_validate(s) for s in servers],
        total=len(servers),
    )


@router.get("/{server_id}", response_model=DefaultMCPServerResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_default_mcp_server(
    server_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> DefaultMCPServerResponse:
    """Get a specific default MCP server by ID (admin)."""
    result = await db.execute(select(DefaultMCPServer).where(DefaultMCPServer.id == server_id))
    server = result.scalar_one_or_none()

    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")

    return DefaultMCPServerResponse.model_validate(server)


@router.post("", response_model=DefaultMCPServerResponse, status_code=201)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def create_default_mcp_server(
    data: CreateDefaultMCPServerRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> DefaultMCPServerResponse:
    """Create a new default MCP server in the catalog (admin).

    System servers are created via database seeds.
    Custom servers created here can be deleted.
    """
    # Check if slug already exists
    result = await db.execute(select(DefaultMCPServer).where(DefaultMCPServer.slug == data.slug))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=409, detail=f"MCP server with slug '{data.slug}' already exists"
        )

    server = DefaultMCPServer(
        slug=data.slug,
        name=data.name,
        description=data.description,
        category=data.category,
        transport=data.transport,
        command=data.command,
        args=data.args,
        url=data.url,
        env_vars=data.env_vars,
        required_env=data.required_env,
        optional_env=data.optional_env,
        icon=data.icon,
        is_builtin=data.is_builtin,
        docs_url=data.docs_url,
        sort_order=data.sort_order,
        is_enabled=True,
        is_system=False,  # Custom servers can be deleted
    )

    db.add(server)
    await db.commit()
    await db.refresh(server)

    logger.info(
        "Default MCP server created",
        server_id=server.id,
        slug=server.slug,
        admin_id=get_admin_user_id(request),
    )

    return DefaultMCPServerResponse.model_validate(server)


@router.put("/{server_id}", response_model=DefaultMCPServerResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def update_default_mcp_server(
    server_id: str,
    data: UpdateDefaultMCPServerRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> DefaultMCPServerResponse:
    """Update a default MCP server in the catalog (admin).

    Only non-None fields in the request will be updated.
    """
    result = await db.execute(select(DefaultMCPServer).where(DefaultMCPServer.id == server_id))
    server = result.scalar_one_or_none()

    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")

    # Update only provided fields
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(server, field, value)

    await db.commit()
    await db.refresh(server)

    logger.info(
        "Default MCP server updated",
        server_id=server_id,
        slug=server.slug,
        admin_id=get_admin_user_id(request),
        updated_fields=list(update_data.keys()),
    )

    return DefaultMCPServerResponse.model_validate(server)


@router.delete("/{server_id}", status_code=204)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def delete_default_mcp_server(
    server_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> None:
    """Delete a custom MCP server from the catalog (admin).

    System servers cannot be deleted - disable them instead.
    """
    result = await db.execute(select(DefaultMCPServer).where(DefaultMCPServer.id == server_id))
    server = result.scalar_one_or_none()

    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")

    if server.is_system:
        raise HTTPException(
            status_code=403,
            detail="System MCP servers cannot be deleted. Disable them instead.",
        )

    await db.delete(server)
    await db.commit()

    logger.info(
        "Default MCP server deleted",
        server_id=server_id,
        slug=server.slug,
        admin_id=get_admin_user_id(request),
    )


@router.post("/{server_id}/toggle", response_model=DefaultMCPServerResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def toggle_default_mcp_server(
    server_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> DefaultMCPServerResponse:
    """Toggle the enabled status of a default MCP server (admin)."""
    result = await db.execute(select(DefaultMCPServer).where(DefaultMCPServer.id == server_id))
    server = result.scalar_one_or_none()

    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")

    server.is_enabled = not server.is_enabled
    await db.commit()
    await db.refresh(server)

    logger.info(
        "Default MCP server toggled",
        server_id=server_id,
        slug=server.slug,
        is_enabled=server.is_enabled,
        admin_id=get_admin_user_id(request),
    )

    return DefaultMCPServerResponse.model_validate(server)
