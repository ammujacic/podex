"""Custom commands routes.

User-defined slash commands that can be used with agents.
Commands are prompt templates that can include argument placeholders.
"""

from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.connection import get_db
from src.database.models import CustomCommand
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

logger = structlog.get_logger()

router = APIRouter(prefix="/commands", tags=["commands"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


# =============================================================================
# Request/Response Models
# =============================================================================


class CommandArgument(BaseModel):
    """Definition of a command argument."""

    name: str = Field(..., min_length=1, max_length=50)
    type: str = Field(default="string")  # string, file, selection, number
    required: bool = Field(default=False)
    default: str | None = Field(default=None)
    description: str | None = Field(default=None)


class CreateCommandRequest(BaseModel):
    """Request to create a custom command."""

    name: str = Field(..., min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9_-]*$")
    description: str | None = Field(default=None, max_length=255)
    prompt_template: str = Field(..., min_length=1, max_length=10000)
    arguments: list[CommandArgument] | None = Field(default=None)
    category: str = Field(default="custom", max_length=50)
    session_id: str | None = Field(default=None, description="Scope to a specific session")


class UpdateCommandRequest(BaseModel):
    """Request to update a custom command."""

    name: str | None = Field(
        default=None, min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9_-]*$"
    )
    description: str | None = Field(default=None, max_length=255)
    prompt_template: str | None = Field(default=None, min_length=1, max_length=10000)
    arguments: list[CommandArgument] | None = Field(default=None)
    category: str | None = Field(default=None, max_length=50)
    enabled: bool | None = Field(default=None)
    sort_order: int | None = Field(default=None, ge=0, le=10000)


class CommandResponse(BaseModel):
    """Response with command details."""

    id: str
    name: str
    description: str | None
    prompt_template: str
    arguments: list[dict[str, Any]] | None
    category: str
    enabled: bool
    sort_order: int
    is_global: bool
    usage_count: int
    user_id: str | None
    session_id: str | None
    created_at: str
    updated_at: str


class CommandListResponse(BaseModel):
    """Response with list of commands."""

    commands: list[CommandResponse]
    total: int


class ExecuteCommandRequest(BaseModel):
    """Request to execute a command."""

    arguments: dict[str, str] = Field(default_factory=dict)


class ExecuteCommandResponse(BaseModel):
    """Response with rendered prompt."""

    prompt: str
    command_id: str
    command_name: str


# =============================================================================
# Helper Functions
# =============================================================================


def _command_to_response(cmd: CustomCommand) -> CommandResponse:
    """Convert a CustomCommand model to response."""
    return CommandResponse(
        id=cmd.id,
        name=cmd.name,
        description=cmd.description,
        prompt_template=cmd.prompt_template,
        arguments=cmd.arguments,
        category=cmd.category,
        enabled=cmd.enabled,
        sort_order=cmd.sort_order,
        is_global=cmd.is_global,
        usage_count=cmd.usage_count,
        user_id=cmd.user_id,
        session_id=cmd.session_id,
        created_at=cmd.created_at.isoformat(),
        updated_at=cmd.updated_at.isoformat(),
    )


def _render_prompt(template: str, arguments: dict[str, str]) -> str:
    """Render a prompt template with provided arguments.

    Supports {{arg_name}} placeholders.
    """
    result = template
    for key, value in arguments.items():
        result = result.replace(f"{{{{{key}}}}}", value)
    return result


# =============================================================================
# Routes
# =============================================================================


@router.get("", response_model=CommandListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_commands(  # noqa: PLR0913
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    category: Annotated[str | None, Query(description="Filter by category")] = None,
    session_id: Annotated[
        str | None, Query(description="Include session-specific commands")
    ] = None,
    include_global: Annotated[bool, Query(description="Include global commands")] = True,  # noqa: FBT002
    enabled_only: Annotated[bool, Query(description="Only return enabled commands")] = True,  # noqa: FBT002
) -> CommandListResponse:
    """List custom commands available to the current user.

    Returns user's personal commands, optionally filtered by category,
    and optionally including global commands and session-specific commands.
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Build query conditions
    conditions = []

    # User's own commands
    user_condition = CustomCommand.user_id == user_id
    if session_id:
        # Include session-specific commands
        user_condition = or_(
            user_condition,
            CustomCommand.session_id == session_id,
        )
    conditions.append(user_condition)

    # Optionally include global commands
    if include_global:
        conditions.append(CustomCommand.is_global == True)  # noqa: E712

    # Category filter
    query = select(CustomCommand).where(or_(*conditions))
    if category:
        query = query.where(CustomCommand.category == category)
    if enabled_only:
        query = query.where(CustomCommand.enabled == True)  # noqa: E712

    query = query.order_by(CustomCommand.sort_order, CustomCommand.name)

    result = await db.execute(query)
    commands = result.scalars().all()

    return CommandListResponse(
        commands=[_command_to_response(cmd) for cmd in commands],
        total=len(commands),
    )


@router.post("", response_model=CommandResponse, status_code=201)
@limiter.limit(RATE_LIMIT_STANDARD)
async def create_command(
    data: CreateCommandRequest,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> CommandResponse:
    """Create a new custom command.

    Commands can be scoped to a specific session or be user-wide.
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Check for duplicate name
    existing = await db.execute(
        select(CustomCommand).where(
            CustomCommand.user_id == user_id,
            CustomCommand.name == data.name,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail=f"Command '/{data.name}' already exists",
        )

    command = CustomCommand(
        user_id=user_id,
        session_id=data.session_id,
        name=data.name,
        description=data.description,
        prompt_template=data.prompt_template,
        arguments=[arg.model_dump() for arg in data.arguments] if data.arguments else None,
        category=data.category,
    )
    db.add(command)
    await db.commit()
    await db.refresh(command)

    logger.info("Custom command created", command_id=command.id, name=command.name, user_id=user_id)

    return _command_to_response(command)


@router.get("/{command_id}", response_model=CommandResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_command(
    command_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> CommandResponse:
    """Get a custom command by ID."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await db.execute(select(CustomCommand).where(CustomCommand.id == command_id))
    command = result.scalar_one_or_none()

    if not command:
        raise HTTPException(status_code=404, detail="Command not found")

    # Check access: user owns it, or it's global
    if command.user_id != user_id and not command.is_global:
        raise HTTPException(status_code=403, detail="Access denied")

    return _command_to_response(command)


@router.patch("/{command_id}", response_model=CommandResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def update_command(
    command_id: str,
    data: UpdateCommandRequest,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> CommandResponse:
    """Update a custom command."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await db.execute(select(CustomCommand).where(CustomCommand.id == command_id))
    command = result.scalar_one_or_none()

    if not command:
        raise HTTPException(status_code=404, detail="Command not found")

    # Only owner can update (global commands require admin)
    if command.user_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Check for duplicate name if changing name
    if data.name and data.name != command.name:
        existing = await db.execute(
            select(CustomCommand).where(
                CustomCommand.user_id == user_id,
                CustomCommand.name == data.name,
                CustomCommand.id != command_id,
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail=f"Command '/{data.name}' already exists",
            )

    # Update fields
    if data.name is not None:
        command.name = data.name
    if data.description is not None:
        command.description = data.description
    if data.prompt_template is not None:
        command.prompt_template = data.prompt_template
    if data.arguments is not None:
        command.arguments = [arg.model_dump() for arg in data.arguments]
    if data.category is not None:
        command.category = data.category
    if data.enabled is not None:
        command.enabled = data.enabled
    if data.sort_order is not None:
        command.sort_order = data.sort_order

    await db.commit()
    await db.refresh(command)

    logger.info("Custom command updated", command_id=command.id, name=command.name)

    return _command_to_response(command)


@router.delete("/{command_id}", status_code=204)
@limiter.limit(RATE_LIMIT_STANDARD)
async def delete_command(
    command_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> None:
    """Delete a custom command."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await db.execute(select(CustomCommand).where(CustomCommand.id == command_id))
    command = result.scalar_one_or_none()

    if not command:
        raise HTTPException(status_code=404, detail="Command not found")

    # Only owner can delete
    if command.user_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    await db.delete(command)
    await db.commit()

    logger.info("Custom command deleted", command_id=command_id)


@router.post("/{command_id}/execute", response_model=ExecuteCommandResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def execute_command(
    command_id: str,
    data: ExecuteCommandRequest,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> ExecuteCommandResponse:
    """Execute a command and return the rendered prompt.

    This renders the command template with provided arguments.
    The caller is responsible for sending the prompt to the agent.
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await db.execute(select(CustomCommand).where(CustomCommand.id == command_id))
    command = result.scalar_one_or_none()

    if not command:
        raise HTTPException(status_code=404, detail="Command not found")

    # Check access
    if command.user_id != user_id and not command.is_global:
        raise HTTPException(status_code=403, detail="Access denied")

    if not command.enabled:
        raise HTTPException(status_code=400, detail="Command is disabled")

    # Validate required arguments
    if command.arguments:
        for arg_def in command.arguments:
            if arg_def.get("required") and arg_def["name"] not in data.arguments:
                raise HTTPException(
                    status_code=400,
                    detail=f"Missing required argument: {arg_def['name']}",
                )

    # Render prompt
    prompt = _render_prompt(command.prompt_template, data.arguments)

    # Increment usage count
    command.usage_count = (command.usage_count or 0) + 1
    await db.commit()

    logger.info("Custom command executed", command_id=command.id, name=command.name)

    return ExecuteCommandResponse(
        prompt=prompt,
        command_id=command.id,
        command_name=command.name,
    )


@router.get("/by-name/{name}", response_model=CommandResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_command_by_name(
    name: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    session_id: Annotated[str | None, Query(description="Session context")] = None,
) -> CommandResponse:
    """Get a command by its name (for slash command lookup).

    Checks in order: session-specific, user, global.
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # First check session-specific
    if session_id:
        result = await db.execute(
            select(CustomCommand).where(
                CustomCommand.session_id == session_id,
                CustomCommand.name == name,
                CustomCommand.enabled == True,  # noqa: E712
            )
        )
        command = result.scalar_one_or_none()
        if command:
            return _command_to_response(command)

    # Then check user's commands
    result = await db.execute(
        select(CustomCommand).where(
            CustomCommand.user_id == user_id,
            CustomCommand.session_id == None,  # noqa: E711
            CustomCommand.name == name,
            CustomCommand.enabled == True,  # noqa: E712
        )
    )
    command = result.scalar_one_or_none()
    if command:
        return _command_to_response(command)

    # Finally check global commands
    result = await db.execute(
        select(CustomCommand).where(
            CustomCommand.is_global == True,  # noqa: E712
            CustomCommand.name == name,
            CustomCommand.enabled == True,  # noqa: E712
        )
    )
    command = result.scalar_one_or_none()
    if command:
        return _command_to_response(command)

    raise HTTPException(status_code=404, detail=f"Command '/{name}' not found")
