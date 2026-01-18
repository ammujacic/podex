"""MCP (Model Context Protocol) server management API routes."""

import re
from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.connection import get_db, get_db_context
from src.database.models import MCPServer
from src.mcp_config import (
    get_default_catalog_for_user,
    get_effective_mcp_config,
    sync_servers_from_env,
)
from src.mcp_defaults import (
    get_all_categories,
    get_default_server_by_slug,
)
from src.mcp_discovery import MCPDiscoveryConfig, discover_mcp_tools, execute_mcp_tool
from src.middleware.auth import get_current_user
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

router = APIRouter(prefix="/mcp/servers", tags=["mcp"])
defaults_router = APIRouter(prefix="/mcp/defaults", tags=["mcp-defaults"])

# Type aliases for dependencies
DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[dict[str, str | None], Depends(get_current_user)]

# Patterns for validating MCP server configuration
# Allow alphanumeric, dashes, underscores, periods, forward slashes for file paths
SAFE_COMMAND_PATTERN = re.compile(r"^[a-zA-Z0-9/_.\-]+$")
# Shell metacharacters that could enable command injection
DANGEROUS_SHELL_CHARS = set(";|&$`<>(){}'\"\\!#*?[]")
# Valid environment variable name pattern
ENV_VAR_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

# Validation limits for MCP server configuration
MAX_ARG_LENGTH = 256
MAX_ENV_VARS = 20
MAX_ENV_VAR_VALUE_LENGTH = 1024


class DangerousCharactersError(ValueError):
    """Raised when a field contains dangerous shell characters."""

    def __init__(self, field_name: str) -> None:
        self.field_name = field_name
        super().__init__(f"{field_name} contains potentially dangerous characters")


class InvalidCommandError(ValueError):
    """Raised when command contains invalid characters."""

    def __init__(self) -> None:
        super().__init__(
            "Command must only contain alphanumeric characters, "
            "dashes, underscores, periods, and forward slashes",
        )


class ArgumentTooLongError(ValueError):
    """Raised when an argument exceeds maximum length."""

    def __init__(self, index: int) -> None:
        self.index = index
        super().__init__(f"Argument {index} is too long (max {MAX_ARG_LENGTH} chars)")


class TooManyEnvVarsError(ValueError):
    """Raised when too many environment variables are provided."""

    def __init__(self) -> None:
        super().__init__(f"Maximum of {MAX_ENV_VARS} environment variables allowed")


class InvalidEnvVarNameError(ValueError):
    """Raised when environment variable name is invalid."""

    def __init__(self, key: str) -> None:
        self.key = key
        super().__init__(f"Invalid environment variable name: {key}")


class EnvVarValueTooLongError(ValueError):
    """Raised when environment variable value is too long."""

    def __init__(self, key: str) -> None:
        self.key = key
        super().__init__(
            f"Environment variable {key} value is too long (max {MAX_ENV_VAR_VALUE_LENGTH} chars)",
        )


class EnvVarNewlineError(ValueError):
    """Raised when environment variable value contains newlines."""

    def __init__(self, key: str) -> None:
        self.key = key
        super().__init__(f"Environment variable {key} cannot contain newlines")


def _validate_no_shell_injection(value: str, field_name: str) -> str:
    """Validate string doesn't contain shell metacharacters."""
    if any(char in DANGEROUS_SHELL_CHARS for char in value):
        raise DangerousCharactersError(field_name)
    return value


async def _background_mcp_discovery(server_id: UUID | str) -> None:
    """Run MCP tool discovery in the background.

    This function is designed to run as a background task, so it doesn't block
    API responses. It fetches the server config, runs discovery, and updates
    the server record with discovered tools/resources.
    """
    import structlog

    logger = structlog.get_logger()

    try:
        async with get_db_context() as db:
            server = await db.get(MCPServer, server_id)
            if not server:
                logger.warning(
                    "Background MCP discovery: server not found", server_id=str(server_id)
                )
                return

            if not server.is_enabled:
                logger.debug(
                    "Background MCP discovery: server disabled, skipping", server_id=str(server_id)
                )
                return

            logger.info(
                "Background MCP discovery started",
                server_id=str(server_id),
                server_name=server.name,
            )

            discovery_config = MCPDiscoveryConfig(
                transport=server.transport,
                command=server.command,
                args=server.args or [],
                url=server.url,
                env_vars=server.env_vars or {},
            )

            result = await discover_mcp_tools(discovery_config)

            if result.success:
                server.discovered_tools = [
                    {
                        "name": tool.name,
                        "description": tool.description,
                        "input_schema": tool.input_schema,
                    }
                    for tool in result.tools
                ]
                server.discovered_resources = [
                    {
                        "uri": resource.uri,
                        "name": resource.name,
                        "description": resource.description,
                        "mime_type": resource.mime_type,
                    }
                    for resource in result.resources
                ]
                server.last_connected_at = datetime.now(UTC)
                server.last_error = None
                logger.info(
                    "Background MCP discovery completed",
                    server_id=str(server_id),
                    tools_count=len(result.tools),
                    resources_count=len(result.resources),
                )
            else:
                server.last_error = result.error
                server.last_connected_at = datetime.now(UTC)
                logger.warning(
                    "Background MCP discovery failed",
                    server_id=str(server_id),
                    error=result.error,
                )

            await db.commit()

    except Exception as e:
        logger.exception("Background MCP discovery error", server_id=str(server_id), error=str(e))


class MCPServerCreate(BaseModel):
    """Request to create an MCP server."""

    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = Field(None, max_length=500)
    transport: str = Field(..., pattern="^(stdio|sse|http)$")
    command: str | None = Field(None, max_length=256)  # For stdio transport
    args: list[str] = Field(default_factory=list, max_length=20)
    url: str | None = Field(None, max_length=512)  # For sse/http transport
    env_vars: dict[str, str] = Field(default_factory=dict)

    @field_validator("command")
    @classmethod
    def validate_command(cls, v: str | None) -> str | None:
        """Validate command doesn't contain shell injection characters."""
        if v is None:
            return None
        if not SAFE_COMMAND_PATTERN.match(v):
            raise InvalidCommandError
        return v

    @field_validator("args")
    @classmethod
    def validate_args(cls, v: list[str]) -> list[str]:
        """Validate args don't contain shell injection characters."""
        for i, arg in enumerate(v):
            if len(arg) > MAX_ARG_LENGTH:
                raise ArgumentTooLongError(i)
            _validate_no_shell_injection(arg, f"Argument {i}")
        return v

    @field_validator("env_vars")
    @classmethod
    def validate_env_vars(cls, v: dict[str, str]) -> dict[str, str]:
        """Validate environment variables."""
        if len(v) > MAX_ENV_VARS:
            raise TooManyEnvVarsError
        for key, value in v.items():
            if not ENV_VAR_NAME_PATTERN.match(key):
                raise InvalidEnvVarNameError(key)
            if len(value) > MAX_ENV_VAR_VALUE_LENGTH:
                raise EnvVarValueTooLongError(key)
            # Don't allow newlines in env var values
            if "\n" in value or "\r" in value:
                raise EnvVarNewlineError(key)
        return v


class MCPServerUpdate(BaseModel):
    """Request to update an MCP server."""

    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = Field(None, max_length=500)
    command: str | None = Field(None, max_length=256)
    args: list[str] | None = Field(None, max_length=20)
    url: str | None = Field(None, max_length=512)
    env_vars: dict[str, str] | None = None
    is_enabled: bool | None = None

    @field_validator("command")
    @classmethod
    def validate_command(cls, v: str | None) -> str | None:
        """Validate command doesn't contain shell injection characters."""
        if v is None:
            return None
        if not SAFE_COMMAND_PATTERN.match(v):
            raise InvalidCommandError
        return v

    @field_validator("args")
    @classmethod
    def validate_args(cls, v: list[str] | None) -> list[str] | None:
        """Validate args don't contain shell injection characters."""
        if v is None:
            return None
        for i, arg in enumerate(v):
            if len(arg) > MAX_ARG_LENGTH:
                raise ArgumentTooLongError(i)
            _validate_no_shell_injection(arg, f"Argument {i}")
        return v

    @field_validator("env_vars")
    @classmethod
    def validate_env_vars(cls, v: dict[str, str] | None) -> dict[str, str] | None:
        """Validate environment variables."""
        if v is None:
            return None
        if len(v) > MAX_ENV_VARS:
            raise TooManyEnvVarsError
        for key, value in v.items():
            if not ENV_VAR_NAME_PATTERN.match(key):
                raise InvalidEnvVarNameError(key)
            if len(value) > MAX_ENV_VAR_VALUE_LENGTH:
                raise EnvVarValueTooLongError(key)
            if "\n" in value or "\r" in value:
                raise EnvVarNewlineError(key)
        return v


class MCPToolResponse(BaseModel):
    """An MCP tool response."""

    name: str
    description: str | None
    input_schema: dict[str, Any]


class MCPResourceResponse(BaseModel):
    """An MCP resource response."""

    uri: str
    name: str
    description: str | None
    mime_type: str | None


class MCPServerResponse(BaseModel):
    """MCP server response."""

    id: str
    user_id: str
    name: str
    description: str | None
    transport: str
    command: str | None
    args: list[str]
    url: str | None
    is_enabled: bool
    discovered_tools: list[MCPToolResponse]
    discovered_resources: list[MCPResourceResponse]
    last_connected_at: str | None
    last_error: str | None
    # New fields for default registry tracking
    source_slug: str | None = None
    category: str | None = None
    is_default: bool = False
    config_source: str = "ui"
    icon: str | None = None
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


# ============== Default Catalog Response Models ==============


class MCPDefaultServerInfo(BaseModel):
    """Information about a default MCP server in the registry."""

    slug: str
    name: str
    description: str
    category: str
    transport: str
    command: str | None = None
    args: list[str] = Field(default_factory=list)
    url: str | None = None
    icon: str | None = None
    required_env: list[str] = Field(default_factory=list)
    is_builtin: bool = False
    docs_url: str | None = None
    # User-specific status
    is_enabled: bool = False
    has_required_secrets: bool = False
    missing_secrets: list[str] = Field(default_factory=list)


class MCPDefaultsListResponse(BaseModel):
    """List of default MCP servers."""

    servers: list[MCPDefaultServerInfo]
    categories: list[str]


class EnableDefaultRequest(BaseModel):
    """Request to enable a default server."""

    env_vars: dict[str, str] = Field(default_factory=dict)
    auto_refresh: bool = True


class SyncFromEnvResponse(BaseModel):
    """Response from syncing servers from environment."""

    created: list[str]
    updated: list[str]


class EffectiveMCPServerResponse(BaseModel):
    """Effective MCP server config for agent execution."""

    id: str
    name: str
    description: str | None
    transport: str
    command: str | None
    args: list[str]
    url: str | None
    env_vars: dict[str, str]  # Resolved secrets (redacted for display)
    discovered_tools: list[MCPToolResponse]
    source: str
    source_slug: str | None = None
    category: str | None = None
    icon: str | None = None


class EffectiveMCPConfigResponse(BaseModel):
    """The merged, effective MCP configuration."""

    servers: list[EffectiveMCPServerResponse]
    total_tools: int
    config_sources: dict[str, int]


class MCPServerListResponse(BaseModel):
    """List of MCP servers response."""

    servers: list[MCPServerResponse]
    total: int


class MCPToolExecuteRequest(BaseModel):
    """Request to execute an MCP tool."""

    server_id: str | None = Field(None, description="Server ID (UUID)")
    server_name: str | None = Field(None, description="Server name (alternative to ID)")
    tool_name: str = Field(..., min_length=1, max_length=256)
    arguments: dict[str, Any] = Field(default_factory=dict)
    session_id: str | None = Field(None, description="Optional session ID for tracking")


class MCPToolExecuteResponse(BaseModel):
    """Response from executing an MCP tool."""

    success: bool
    result: Any = None
    error: str | None = None
    is_error: bool = False
    server_name: str | None = None
    tool_name: str | None = None


@router.get("", response_model=MCPServerListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_servers(
    request: Request,
    response: Response,
    db: DbSession,
    current_user: CurrentUser,
    *,
    is_enabled: bool | None = Query(default=None),
) -> MCPServerListResponse:
    """List MCP servers for the current user."""
    query = select(MCPServer).where(MCPServer.user_id == current_user["id"])

    if is_enabled is not None:
        query = query.where(MCPServer.is_enabled == is_enabled)

    query = query.order_by(MCPServer.created_at.desc())

    result = await db.execute(query)
    servers = result.scalars().all()

    return MCPServerListResponse(
        servers=[_server_to_response(s) for s in servers],
        total=len(servers),
    )


@router.post("/execute", response_model=MCPToolExecuteResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def execute_tool(
    request: Request,
    response: Response,
    data: MCPToolExecuteRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> MCPToolExecuteResponse:
    """Execute an MCP tool on behalf of a terminal agent.

    This endpoint allows terminal agents running in containers to call MCP tools
    without needing direct MCP server access. The API handles server connection,
    authentication, and tool execution.

    Either server_id or server_name must be provided to identify the MCP server.
    """
    import structlog

    logger = structlog.get_logger()

    # Find the server by ID or name
    if data.server_id:
        server = await db.get(MCPServer, data.server_id)
        if not server or server.user_id != current_user["id"]:
            raise HTTPException(status_code=404, detail="Server not found")
    elif data.server_name:
        result = await db.execute(
            select(MCPServer).where(
                MCPServer.user_id == current_user["id"],
                MCPServer.name == data.server_name,
            )
        )
        server = result.scalar_one_or_none()
        if not server:
            raise HTTPException(
                status_code=404,
                detail=f"Server with name '{data.server_name}' not found",
            )
    else:
        raise HTTPException(
            status_code=400,
            detail="Either server_id or server_name must be provided",
        )

    # Check if server is enabled
    if not server.is_enabled:
        raise HTTPException(
            status_code=400,
            detail=f"Server '{server.name}' is disabled",
        )

    # Verify the tool exists in discovered tools
    discovered_tools = server.discovered_tools or []
    tool_names = [name for t in discovered_tools if (name := t.get("name"))]
    if data.tool_name not in tool_names:
        raise HTTPException(
            status_code=404,
            detail=f"Tool '{data.tool_name}' not found on server '{server.name}'. "
            f"Available tools: {', '.join(tool_names)}",
        )

    # Build configuration for the MCP server
    env_vars = server.env_vars or {}
    config = MCPDiscoveryConfig(
        transport=server.transport,
        command=server.command,
        args=server.args or [],
        url=server.url,
        env_vars=env_vars,
        timeout=60,  # Longer timeout for tool execution
    )

    # Debug: log what env vars we're passing (redact sensitive values)
    redacted_env = {
        k: "***REDACTED***" if "TOKEN" in k or "KEY" in k or "SECRET" in k else v
        for k, v in env_vars.items()
    }
    logger.info(
        "Executing MCP tool",
        user_id=current_user["id"],
        server_name=server.name,
        tool_name=data.tool_name,
        session_id=data.session_id,
        env_vars_keys=list(env_vars.keys()),
        env_vars_redacted=redacted_env,
        has_sentry_token="SENTRY_ACCESS_TOKEN" in env_vars,
    )

    # Execute the tool
    execution_result = await execute_mcp_tool(
        config=config,
        tool_name=data.tool_name,
        arguments=data.arguments,
    )

    if not execution_result.success:
        logger.warning(
            "MCP tool execution failed",
            server_name=server.name,
            tool_name=data.tool_name,
            error=execution_result.error,
        )
        return MCPToolExecuteResponse(
            success=False,
            error=execution_result.error,
            server_name=server.name,
            tool_name=data.tool_name,
        )

    logger.info(
        "MCP tool executed successfully",
        server_name=server.name,
        tool_name=data.tool_name,
        is_error=execution_result.is_error,
    )

    return MCPToolExecuteResponse(
        success=True,
        result=execution_result.result,
        is_error=execution_result.is_error,
        server_name=server.name,
        tool_name=data.tool_name,
    )


@router.post("", response_model=MCPServerResponse, status_code=201)
@limiter.limit(RATE_LIMIT_STANDARD)
async def create_server(
    request: Request,
    response: Response,
    data: MCPServerCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> MCPServerResponse:
    """Create a new MCP server."""
    # Validate transport-specific requirements
    if data.transport == "stdio" and not data.command:
        raise HTTPException(
            status_code=400,
            detail="command is required for stdio transport",
        )
    if data.transport in ("sse", "http") and not data.url:
        raise HTTPException(
            status_code=400,
            detail="url is required for sse/http transport",
        )

    # Check for duplicate name
    existing = await db.execute(
        select(MCPServer).where(
            MCPServer.user_id == current_user["id"],
            MCPServer.name == data.name,
        ),
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail=f"Server with name '{data.name}' already exists",
        )

    server = MCPServer(
        user_id=current_user["id"],
        name=data.name,
        description=data.description,
        transport=data.transport,
        command=data.command,
        args=data.args,
        url=data.url,
        env_vars=data.env_vars,
    )

    db.add(server)
    await db.commit()
    await db.refresh(server)

    return _server_to_response(server)


@router.get("/{server_id}", response_model=MCPServerResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_server(
    request: Request,
    response: Response,
    server_id: UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> MCPServerResponse:
    """Get a specific MCP server."""
    server = await db.get(MCPServer, server_id)

    if not server or server.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Server not found")

    return _server_to_response(server)


@router.patch("/{server_id}", response_model=MCPServerResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def update_server(
    request: Request,
    response: Response,
    server_id: UUID,
    data: MCPServerUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> MCPServerResponse:
    """Update an MCP server."""
    server = await db.get(MCPServer, server_id)

    if not server or server.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Server not found")

    # Check for duplicate name if updating
    if data.name and data.name != server.name:
        existing = await db.execute(
            select(MCPServer).where(
                MCPServer.user_id == current_user["id"],
                MCPServer.name == data.name,
                MCPServer.id != server_id,
            ),
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=400,
                detail=f"Server with name '{data.name}' already exists",
            )

    # Update fields
    if data.name is not None:
        server.name = data.name
    if data.description is not None:
        server.description = data.description
    if data.command is not None:
        server.command = data.command
    if data.args is not None:
        server.args = data.args
    if data.url is not None:
        server.url = data.url
    if data.env_vars is not None:
        server.env_vars = data.env_vars
    if data.is_enabled is not None:
        server.is_enabled = data.is_enabled

    await db.commit()
    await db.refresh(server)

    return _server_to_response(server)


@router.delete("/{server_id}", status_code=204)
@limiter.limit(RATE_LIMIT_STANDARD)
async def delete_server(
    request: Request,
    response: Response,
    server_id: UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> None:
    """Delete an MCP server."""
    server = await db.get(MCPServer, server_id)

    if not server or server.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Server not found")

    await db.delete(server)
    await db.commit()


class MCPTestConnectionResponse(BaseModel):
    """Response from testing MCP server connection."""

    success: bool
    message: str
    tools_count: int | None = None
    error: str | None = None


@router.post("/{server_id}/test", response_model=MCPTestConnectionResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def test_server_connection(
    request: Request,
    response: Response,
    server_id: UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> MCPTestConnectionResponse:
    """Test connection to an MCP server.

    Performs a lightweight connectivity check without full tool discovery.
    """
    server = await db.get(MCPServer, server_id)

    if not server or server.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Server not found")

    if not server.is_enabled:
        return MCPTestConnectionResponse(
            success=False,
            message="Server is disabled",
            error="Enable the server before testing connection",
        )

    # Perform discovery to test connection
    discovery_config = MCPDiscoveryConfig(
        transport=server.transport,
        command=server.command,
        args=server.args or [],
        url=server.url,
        env_vars=server.env_vars or {},
    )

    result = await discover_mcp_tools(discovery_config)

    if result.success:
        # Update last_connected_at on successful test
        server.last_connected_at = datetime.now(UTC)
        server.last_error = None
        # Also update discovered tools
        server.discovered_tools = [
            {
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.input_schema,
            }
            for tool in result.tools
        ]
        await db.commit()

        return MCPTestConnectionResponse(
            success=True,
            message=f"Successfully connected to {server.name}",
            tools_count=len(result.tools),
        )
    # Update last_error
    server.last_error = result.error
    server.last_connected_at = datetime.now(UTC)
    await db.commit()

    return MCPTestConnectionResponse(
        success=False,
        message=f"Failed to connect to {server.name}",
        error=result.error,
    )


@router.post("/{server_id}/refresh", response_model=MCPServerResponse, status_code=202)
@limiter.limit(RATE_LIMIT_STANDARD)
async def refresh_server(
    request: Request,
    response: Response,
    server_id: UUID,
    background_tasks: BackgroundTasks,
    db: DbSession,
    current_user: CurrentUser,
) -> MCPServerResponse:
    """Refresh discovered tools and resources from an MCP server.

    Discovery runs in the background and does not block the response.
    The server record will be updated asynchronously when discovery completes.
    Returns 202 Accepted with current server state.
    """
    server = await db.get(MCPServer, server_id)

    if not server or server.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Server not found")

    if not server.is_enabled:
        raise HTTPException(
            status_code=400,
            detail="Server is disabled. Enable it first.",
        )

    # Queue discovery in background (non-blocking)
    background_tasks.add_task(_background_mcp_discovery, server.id)

    return _server_to_response(server)


@router.post("/{server_id}/enable", response_model=MCPServerResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def enable_server(
    request: Request,
    response: Response,
    server_id: UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> MCPServerResponse:
    """Enable an MCP server."""
    server = await db.get(MCPServer, server_id)

    if not server or server.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Server not found")

    server.is_enabled = True
    await db.commit()
    await db.refresh(server)

    return _server_to_response(server)


@router.post("/{server_id}/disable", response_model=MCPServerResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def disable_server(
    request: Request,
    response: Response,
    server_id: UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> MCPServerResponse:
    """Disable an MCP server."""
    server = await db.get(MCPServer, server_id)

    if not server or server.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Server not found")

    server.is_enabled = False
    await db.commit()
    await db.refresh(server)

    return _server_to_response(server)


@router.get("/{server_id}/tools", response_model=list[MCPToolResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_server_tools(
    request: Request,
    response: Response,
    server_id: UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> list[MCPToolResponse]:
    """List discovered tools from an MCP server."""
    server = await db.get(MCPServer, server_id)

    if not server or server.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Server not found")

    tools = server.discovered_tools or []

    return [
        MCPToolResponse(
            name=t.get("name", ""),
            description=t.get("description"),
            input_schema=t.get("input_schema", {}),
        )
        for t in tools
    ]


def _server_to_response(server: MCPServer) -> MCPServerResponse:
    """Convert server model to response."""
    tools = server.discovered_tools or []
    resources = server.discovered_resources or []

    return MCPServerResponse(
        id=server.id,
        user_id=server.user_id,
        name=server.name,
        description=server.description,
        transport=server.transport,
        command=server.command,
        args=server.args or [],
        url=server.url,
        is_enabled=server.is_enabled,
        discovered_tools=[
            MCPToolResponse(
                name=t.get("name", ""),
                description=t.get("description"),
                input_schema=t.get("input_schema", {}),
            )
            for t in tools
        ],
        discovered_resources=[
            MCPResourceResponse(
                uri=r.get("uri", ""),
                name=r.get("name", ""),
                description=r.get("description"),
                mime_type=r.get("mime_type"),
            )
            for r in resources
        ],
        last_connected_at=server.last_connected_at.isoformat()
        if server.last_connected_at
        else None,
        last_error=server.last_error,
        # New fields
        source_slug=getattr(server, "source_slug", None),
        category=getattr(server, "category", None),
        is_default=getattr(server, "is_default", False),
        config_source=getattr(server, "config_source", "ui"),
        icon=getattr(server, "icon", None),
        created_at=server.created_at.isoformat(),
        updated_at=server.updated_at.isoformat(),
    )


# ============== Default Catalog Endpoints ==============


@defaults_router.get("", response_model=MCPDefaultsListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_default_servers(
    request: Request,
    response: Response,
    db: DbSession,
    current_user: CurrentUser,
) -> MCPDefaultsListResponse:
    """List all available default MCP servers from the registry.

    Returns the full catalog with user's enablement status for each.
    """
    # Get user's current servers to determine enabled status
    result = await db.execute(
        select(MCPServer).where(MCPServer.user_id == current_user["id"]),
    )
    user_servers = list(result.scalars().all())

    # Get catalog with user status
    catalog = get_default_catalog_for_user(user_servers)

    servers = [
        MCPDefaultServerInfo(
            slug=s["slug"],
            name=s["name"],
            description=s.get("description", ""),
            category=s["category"].value if hasattr(s["category"], "value") else s["category"],
            transport=s["transport"],
            command=s.get("command"),
            args=s.get("args", []),
            url=s.get("url"),
            icon=s.get("icon"),
            required_env=s.get("required_env", []),
            is_builtin=s.get("is_builtin", False),
            docs_url=s.get("docs_url"),
            is_enabled=s.get("is_enabled", False),
            has_required_secrets=s.get("has_required_secrets", False),
            missing_secrets=s.get("missing_secrets", []),
        )
        for s in catalog
    ]

    return MCPDefaultsListResponse(
        servers=servers,
        categories=get_all_categories(),
    )


@defaults_router.get("/{slug}", response_model=MCPDefaultServerInfo)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_default_server(
    request: Request,
    response: Response,
    slug: str,
    db: DbSession,
    current_user: CurrentUser,
) -> MCPDefaultServerInfo:
    """Get details for a specific default server."""
    default_config = get_default_server_by_slug(slug)
    if not default_config:
        raise HTTPException(status_code=404, detail=f"Default server '{slug}' not found")

    # Check if user has it enabled
    result = await db.execute(
        select(MCPServer).where(
            MCPServer.user_id == current_user["id"],
            MCPServer.source_slug == slug,
        ),
    )
    user_server = result.scalar_one_or_none()

    return MCPDefaultServerInfo(
        slug=default_config["slug"],
        name=default_config["name"],
        description=default_config.get("description", ""),
        category=(
            default_config["category"].value
            if hasattr(default_config["category"], "value")
            else default_config["category"]
        ),
        transport=default_config["transport"],
        command=default_config.get("command"),
        args=default_config.get("args", []),
        url=default_config.get("url"),
        icon=default_config.get("icon"),
        required_env=default_config.get("required_env", []),
        is_builtin=default_config.get("is_builtin", False),
        docs_url=default_config.get("docs_url"),
        is_enabled=user_server.is_enabled if user_server else False,
        has_required_secrets=_check_required_secrets(default_config.get("required_env", [])),
        missing_secrets=_get_missing_secrets(default_config.get("required_env", [])),
    )


def _check_required_secrets(required_env: list[str]) -> bool:
    """Check if all required environment variables are set."""
    import os

    if not required_env:
        return True
    return all(os.environ.get(env_var) for env_var in required_env)


def _get_missing_secrets(required_env: list[str]) -> list[str]:
    """Get list of missing required environment variables."""
    import os

    if not required_env:
        return []
    return [env_var for env_var in required_env if not os.environ.get(env_var)]


@defaults_router.post("/{slug}/enable", response_model=MCPServerResponse, status_code=201)
@limiter.limit(RATE_LIMIT_STANDARD)
async def enable_default_server(
    request: Request,
    response: Response,
    slug: str,
    data: EnableDefaultRequest,
    background_tasks: BackgroundTasks,
    db: DbSession,
    current_user: CurrentUser,
) -> MCPServerResponse:
    """Enable a default MCP server for the current user.

    Creates an MCPServer record with is_default=True using the default config.
    """
    import structlog

    logger = structlog.get_logger()

    # Debug: log what env vars we're receiving
    logger.info(
        "Enabling default MCP server",
        slug=slug,
        user_id=current_user["id"],
        env_vars_keys=list(data.env_vars.keys()),
        has_sentry_token="SENTRY_ACCESS_TOKEN" in data.env_vars,
        auto_refresh=data.auto_refresh,
    )

    default_config = get_default_server_by_slug(slug)
    if not default_config:
        raise HTTPException(status_code=404, detail=f"Default server '{slug}' not found")

    # Check if already exists
    result = await db.execute(
        select(MCPServer).where(
            MCPServer.user_id == current_user["id"],
            MCPServer.source_slug == slug,
        ),
    )
    existing = result.scalar_one_or_none()

    if existing:
        # Always update env vars - replace completely, don't merge
        # This ensures old values like SENTRY_HOST are properly cleared when not provided
        if data.env_vars:
            existing.env_vars = data.env_vars

        # Re-enable if disabled
        if not existing.is_enabled:
            existing.is_enabled = True

        await db.commit()
        await db.refresh(existing)

        # Auto-refresh to discover tools in background (non-blocking)
        if data.auto_refresh:
            background_tasks.add_task(_background_mcp_discovery, existing.id)

        return _server_to_response(existing)

    # Create new server from default config
    server = MCPServer(
        user_id=current_user["id"],
        name=default_config["name"],
        description=default_config.get("description"),
        transport=default_config["transport"],
        command=default_config.get("command"),
        args=default_config.get("args", []),
        url=default_config.get("url"),
        env_vars=data.env_vars,
        is_enabled=True,
        source_slug=slug,
        category=(
            default_config["category"].value
            if hasattr(default_config["category"], "value")
            else default_config["category"]
        ),
        is_default=True,
        config_source="ui",
        icon=default_config.get("icon"),
    )

    db.add(server)
    await db.commit()
    await db.refresh(server)

    # Auto-refresh to discover tools in background (non-blocking)
    if data.auto_refresh:
        background_tasks.add_task(_background_mcp_discovery, server.id)

    return _server_to_response(server)


class TestDefaultRequest(BaseModel):
    """Request to test a default server connection."""

    env_vars: dict[str, str] = Field(default_factory=dict)


class TestDefaultResponse(BaseModel):
    """Response from testing a default server connection."""

    success: bool
    message: str
    tools_count: int | None = None
    error: str | None = None


@defaults_router.post("/{slug}/test", response_model=TestDefaultResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def test_default_server(
    request: Request,
    response: Response,
    slug: str,
    data: TestDefaultRequest,
    current_user: CurrentUser,
) -> TestDefaultResponse:
    """Test connection to a default MCP server before enabling it.

    Allows testing with provided env_vars (like auth tokens) without
    permanently enabling the server.
    """
    default_config = get_default_server_by_slug(slug)
    if not default_config:
        raise HTTPException(status_code=404, detail=f"Default server '{slug}' not found")

    # Build a test configuration using the default config + provided env vars
    discovery_config = MCPDiscoveryConfig(
        transport=default_config["transport"],
        command=default_config.get("command"),
        args=default_config.get("args", []),
        url=default_config.get("url"),
        env_vars=data.env_vars,
    )

    # Attempt to connect and discover tools
    result = await discover_mcp_tools(discovery_config)

    if result.success:
        return TestDefaultResponse(
            success=True,
            message=f"Successfully connected to {default_config['name']}",
            tools_count=len(result.tools),
        )

    return TestDefaultResponse(
        success=False,
        message=f"Failed to connect to {default_config['name']}",
        error=result.error,
    )


@defaults_router.post("/{slug}/disable", status_code=204)
@limiter.limit(RATE_LIMIT_STANDARD)
async def disable_default_server(
    request: Request,
    response: Response,
    slug: str,
    db: DbSession,
    current_user: CurrentUser,
) -> None:
    """Disable a default MCP server for the current user."""
    default_config = get_default_server_by_slug(slug)
    if not default_config:
        raise HTTPException(status_code=404, detail=f"Default server '{slug}' not found")

    # Check if it's a built-in server
    if default_config.get("is_builtin", False):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot disable built-in server '{slug}'",
        )

    # Find user's server
    result = await db.execute(
        select(MCPServer).where(
            MCPServer.user_id == current_user["id"],
            MCPServer.source_slug == slug,
        ),
    )
    server = result.scalar_one_or_none()

    if not server:
        raise HTTPException(status_code=404, detail="Server not enabled for this user")

    server.is_enabled = False
    await db.commit()


# ============== Effective Config & Sync Endpoints ==============


@router.get("/effective", response_model=EffectiveMCPConfigResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_effective_config(
    request: Request,
    response: Response,
    db: DbSession,
    current_user: CurrentUser,
) -> EffectiveMCPConfigResponse:
    """Get the merged effective MCP configuration.

    Returns the final config after merging env vars, user settings, and defaults.
    This is what the agent service uses.
    """
    effective = await get_effective_mcp_config(db, str(current_user["id"]))

    if not effective:
        return EffectiveMCPConfigResponse(
            servers=[],
            total_tools=0,
            config_sources={},
        )

    # Count tools and sources
    total_tools = sum(len(s.discovered_tools) for s in effective.servers)
    config_sources: dict[str, int] = {}
    for server in effective.servers:
        source = server.source
        config_sources[source] = config_sources.get(source, 0) + 1

    # Redact secrets in env_vars for display
    def redact_env_vars(env_vars: dict[str, str]) -> dict[str, str]:
        sensitive_keys = {"TOKEN", "KEY", "SECRET", "PASSWORD", "CREDENTIAL"}
        result = {}
        for k, v in env_vars.items():
            if any(sk in k.upper() for sk in sensitive_keys):
                result[k] = "********"
            else:
                result[k] = v
        return result

    servers = [
        EffectiveMCPServerResponse(
            id=s.id,
            name=s.name,
            description=s.description,
            transport=s.transport,
            command=s.command,
            args=s.args,
            url=s.url,
            env_vars=redact_env_vars(s.env_vars),
            discovered_tools=[
                MCPToolResponse(
                    name=t.get("name", ""),
                    description=t.get("description"),
                    input_schema=t.get("input_schema", {}),
                )
                for t in s.discovered_tools
            ],
            source=s.source,
            source_slug=s.source_slug,
            category=s.category,
            icon=s.icon,
        )
        for s in effective.servers
    ]

    return EffectiveMCPConfigResponse(
        servers=servers,
        total_tools=total_tools,
        config_sources=config_sources,
    )


@router.post("/sync-from-env", response_model=SyncFromEnvResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def sync_from_env(
    request: Request,
    response: Response,
    db: DbSession,
    current_user: CurrentUser,
) -> SyncFromEnvResponse:
    """Sync MCP server config from environment variables.

    Reads MCP_ENABLED_SERVERS and creates/updates MCPServer records.
    """
    created, updated = await sync_servers_from_env(db, str(current_user["id"]))
    return SyncFromEnvResponse(created=created, updated=updated)
