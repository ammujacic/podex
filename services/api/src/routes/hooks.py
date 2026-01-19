"""API routes for user-defined hooks management."""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.middleware.auth import get_current_user

router = APIRouter(prefix="/hooks", tags=["hooks"])

# Type aliases for Depends
CurrentUser = Annotated[dict[str, Any], Depends(get_current_user)]
DbSession = Annotated[AsyncSession, Depends(get_db)]


class HookConditionRequest(BaseModel):
    """Hook condition configuration."""

    trigger: str = Field(
        default="always", description="Trigger type: always, on_tool, on_file_type, on_pattern"
    )
    tool_names: list[str] = Field(
        default_factory=list, description="Tool names for on_tool trigger"
    )
    file_extensions: list[str] = Field(
        default_factory=list, description="File extensions for on_file_type trigger"
    )
    pattern: str | None = Field(default=None, description="Regex pattern for on_pattern trigger")


class CreateHookRequest(BaseModel):
    """Request to create a new hook."""

    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    hook_type: str = Field(..., description="Hook type: pre_tool_call, post_tool_call, etc.")
    command: str = Field(..., min_length=1, description="Shell command to execute")
    condition: HookConditionRequest = Field(default_factory=HookConditionRequest)
    timeout_ms: int = Field(default=30000, ge=1000, le=300000)
    run_async: bool = Field(default=False)


class UpdateHookRequest(BaseModel):
    """Request to update a hook."""

    name: str | None = None
    description: str | None = None
    command: str | None = None
    condition: HookConditionRequest | None = None
    enabled: bool | None = None
    timeout_ms: int | None = None
    run_async: bool | None = None


class HookResponse(BaseModel):
    """Hook response model."""

    id: str
    user_id: str
    name: str
    description: str | None
    hook_type: str
    command: str
    condition: dict[str, Any]
    enabled: bool
    timeout_ms: int
    run_async: bool
    created_at: str
    updated_at: str


class HookExecutionResponse(BaseModel):
    """Hook execution result."""

    hook_id: str
    success: bool
    output: str | None = None
    error: str | None = None
    duration_ms: int = 0


# In-memory storage (would be database in production)
_user_hooks: dict[str, list[dict[str, Any]]] = {}
_hooks_by_id: dict[str, dict[str, Any]] = {}


def _get_user_hooks(user_id: str) -> list[dict[str, Any]]:
    """Get all hooks for a user."""
    return _user_hooks.get(user_id, [])


def _get_hook_by_id(hook_id: str) -> dict[str, Any] | None:
    """Get a hook by ID."""
    return _hooks_by_id.get(hook_id)


@router.get("", response_model=list[HookResponse])
async def list_hooks(
    current_user: CurrentUser,
    _db: DbSession,
    hook_type: str | None = None,
    *,
    enabled_only: bool = True,
) -> list[dict[str, Any]]:
    """List all hooks for the current user."""
    user_id = str(current_user["id"])
    hooks = _get_user_hooks(user_id)

    if enabled_only:
        hooks = [h for h in hooks if h.get("enabled", True)]

    if hook_type:
        hooks = [h for h in hooks if h.get("hook_type") == hook_type]

    return hooks


@router.post("", response_model=HookResponse, status_code=status.HTTP_201_CREATED)
async def create_hook(
    request: CreateHookRequest,
    current_user: CurrentUser,
    _db: DbSession,
) -> dict[str, Any]:
    """Create a new hook."""
    user_id = str(current_user["id"])

    # Validate hook type
    valid_types = [
        "pre_tool_call",
        "post_tool_call",
        "pre_compact",
        "post_compact",
        "session_start",
        "session_end",
        "subagent_start",
        "subagent_stop",
        "message_received",
        "response_generated",
    ]
    if request.hook_type not in valid_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid hook type. Must be one of: {valid_types}",
        )

    # Validate trigger type
    valid_triggers = ["always", "on_tool", "on_file_type", "on_pattern"]
    if request.condition.trigger not in valid_triggers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid trigger type. Must be one of: {valid_triggers}",
        )

    now = datetime.now(UTC).isoformat()
    hook = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "name": request.name,
        "description": request.description,
        "hook_type": request.hook_type,
        "command": request.command,
        "condition": {
            "trigger": request.condition.trigger,
            "tool_names": request.condition.tool_names,
            "file_extensions": request.condition.file_extensions,
            "pattern": request.condition.pattern,
        },
        "enabled": True,
        "timeout_ms": request.timeout_ms,
        "run_async": request.run_async,
        "created_at": now,
        "updated_at": now,
    }

    if user_id not in _user_hooks:
        _user_hooks[user_id] = []
    _user_hooks[user_id].append(hook)
    hook_id: str = str(hook["id"])
    _hooks_by_id[hook_id] = hook

    return hook


@router.get("/{hook_id}", response_model=HookResponse)
async def get_hook(
    hook_id: str,
    current_user: CurrentUser,
    _db: DbSession,
) -> dict[str, Any]:
    """Get a specific hook."""
    user_id = str(current_user["id"])
    hook = _get_hook_by_id(hook_id)

    if not hook or hook.get("user_id") != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hook not found")

    return hook


@router.patch("/{hook_id}", response_model=HookResponse)
async def update_hook(
    hook_id: str,
    request: UpdateHookRequest,
    current_user: CurrentUser,
    _db: DbSession,
) -> dict[str, Any]:
    """Update a hook."""
    user_id = str(current_user["id"])
    hook = _get_hook_by_id(hook_id)

    if not hook or hook.get("user_id") != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hook not found")

    # Update fields
    if request.name is not None:
        hook["name"] = request.name
    if request.description is not None:
        hook["description"] = request.description
    if request.command is not None:
        hook["command"] = request.command
    if request.condition is not None:
        hook["condition"] = {
            "trigger": request.condition.trigger,
            "tool_names": request.condition.tool_names,
            "file_extensions": request.condition.file_extensions,
            "pattern": request.condition.pattern,
        }
    if request.enabled is not None:
        hook["enabled"] = request.enabled
    if request.timeout_ms is not None:
        hook["timeout_ms"] = request.timeout_ms
    if request.run_async is not None:
        hook["run_async"] = request.run_async

    hook["updated_at"] = datetime.now(UTC).isoformat()

    return hook


@router.delete("/{hook_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_hook(
    hook_id: str,
    current_user: CurrentUser,
    _db: DbSession,
) -> None:
    """Delete a hook."""
    user_id = str(current_user["id"])
    hook = _get_hook_by_id(hook_id)

    if not hook or hook.get("user_id") != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hook not found")

    # Remove from user list
    _user_hooks[user_id] = [h for h in _user_hooks.get(user_id, []) if h["id"] != hook_id]
    # Remove from ID map
    del _hooks_by_id[hook_id]


@router.post("/{hook_id}/enable", response_model=HookResponse)
async def enable_hook(
    hook_id: str,
    current_user: CurrentUser,
    _db: DbSession,
) -> dict[str, Any]:
    """Enable a hook."""
    user_id = str(current_user["id"])
    hook = _get_hook_by_id(hook_id)

    if not hook or hook.get("user_id") != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hook not found")

    hook["enabled"] = True
    hook["updated_at"] = datetime.now(UTC).isoformat()

    return hook


@router.post("/{hook_id}/disable", response_model=HookResponse)
async def disable_hook(
    hook_id: str,
    current_user: CurrentUser,
    _db: DbSession,
) -> dict[str, Any]:
    """Disable a hook."""
    user_id = str(current_user["id"])
    hook = _get_hook_by_id(hook_id)

    if not hook or hook.get("user_id") != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hook not found")

    hook["enabled"] = False
    hook["updated_at"] = datetime.now(UTC).isoformat()

    return hook


@router.post("/{hook_id}/test", response_model=HookExecutionResponse)
async def run_hook_test(
    hook_id: str,
    current_user: CurrentUser,
    _db: DbSession,
) -> HookExecutionResponse:
    """Validate a hook configuration.

    Note: Hooks are executed within your workspace environment for security.
    This endpoint validates the hook configuration only.
    """
    user_id = str(current_user["id"])
    hook = _get_hook_by_id(hook_id)

    if not hook or hook.get("user_id") != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hook not found")

    # Security: Do NOT execute arbitrary commands on the API server.
    # Hooks run within user workspaces where sandboxing is enforced.
    # This endpoint validates the hook configuration only.

    # Validate command is not empty
    command = hook.get("command", "")
    if not command or not command.strip():
        return HookExecutionResponse(
            hook_id=hook_id,
            success=False,
            error="Hook command cannot be empty",
            duration_ms=0,
        )

    # Check for obviously problematic patterns (informational only)
    warnings = []
    dangerous_patterns = ["rm -rf /", "mkfs", "dd if=", "> /dev/", ":(){ :|:& };:"]
    for pattern in dangerous_patterns:
        if pattern in command:
            warnings.append(f"Command contains potentially dangerous pattern: {pattern}")

    if warnings:
        return HookExecutionResponse(
            hook_id=hook_id,
            success=False,
            error="Validation warnings: " + "; ".join(warnings),
            duration_ms=0,
        )

    return HookExecutionResponse(
        hook_id=hook_id,
        success=True,
        output="Hook configuration validated. Hooks execute within your workspace environment.",
        duration_ms=0,
    )


@router.get("/{hook_id}/history", response_model=list[HookExecutionResponse])
async def get_hook_history(
    hook_id: str,
    current_user: CurrentUser,
    _db: DbSession,
    _limit: int = 20,
) -> list[HookExecutionResponse]:
    """Get execution history for a hook."""
    user_id = str(current_user["id"])
    hook = _get_hook_by_id(hook_id)

    if not hook or hook.get("user_id") != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hook not found")

    # In production, this would query the database
    # For now, return empty list
    return []


# Hook types reference endpoint
@router.get("/types/list")
async def list_hook_types() -> dict[str, Any]:
    """List all available hook types with descriptions."""
    return {
        "hook_types": [
            {
                "type": "pre_tool_call",
                "description": "Runs before a tool is executed",
                "context_vars": ["PODEX_TOOL_NAME", "PODEX_TOOL_ARGS"],
            },
            {
                "type": "post_tool_call",
                "description": "Runs after a tool is executed",
                "context_vars": ["PODEX_TOOL_NAME", "PODEX_TOOL_ARGS", "PODEX_TOOL_RESULT"],
            },
            {
                "type": "pre_compact",
                "description": "Runs before context compaction",
                "context_vars": ["PODEX_SESSION_ID", "PODEX_AGENT_ID"],
            },
            {
                "type": "post_compact",
                "description": "Runs after context compaction",
                "context_vars": ["PODEX_SESSION_ID", "PODEX_AGENT_ID"],
            },
            {
                "type": "session_start",
                "description": "Runs when a new session starts",
                "context_vars": ["PODEX_SESSION_ID"],
            },
            {
                "type": "session_end",
                "description": "Runs when a session ends",
                "context_vars": ["PODEX_SESSION_ID"],
            },
            {
                "type": "subagent_start",
                "description": "Runs when a subagent is spawned",
                "context_vars": ["PODEX_AGENT_ID", "PODEX_SUBAGENT_TYPE"],
            },
            {
                "type": "subagent_stop",
                "description": "Runs when a subagent completes",
                "context_vars": ["PODEX_AGENT_ID", "PODEX_SUBAGENT_RESULT"],
            },
            {
                "type": "message_received",
                "description": "Runs when a user message is received",
                "context_vars": ["PODEX_MESSAGE_CONTENT"],
            },
            {
                "type": "response_generated",
                "description": "Runs after agent generates a response",
                "context_vars": ["PODEX_MESSAGE_CONTENT"],
            },
        ],
        "trigger_types": [
            {"type": "always", "description": "Always run this hook"},
            {
                "type": "on_tool",
                "description": "Only run for specific tools",
                "config": "tool_names",
            },
            {
                "type": "on_file_type",
                "description": "Only run for specific file types",
                "config": "file_extensions",
            },
            {"type": "on_pattern", "description": "Run when pattern matches", "config": "pattern"},
        ],
    }
