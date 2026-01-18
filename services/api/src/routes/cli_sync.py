"""API routes for CLI sync management.

Enables synchronization of Podex skills and MCPs to CLI wrapper agents
(Claude Code, Codex, Gemini CLI).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.compute_client import compute_client
from src.database import get_db
from src.database.models import UserConfig
from src.middleware.auth import get_current_user
from src.services.cli_sync_service import CLISyncService

router = APIRouter(prefix="/cli-sync", tags=["cli-sync"])


# ============================================================================
# Request/Response Models
# ============================================================================


class SyncRequest(BaseModel):
    """Request to trigger CLI sync."""

    cli_agents: list[str] | None = Field(
        default=None,
        description="CLI agents to sync to. If None, sync to all enabled.",
    )
    sync_skills: bool = Field(default=True, description="Whether to sync skills")
    sync_mcps: bool = Field(default=True, description="Whether to sync MCPs")


class SyncResponse(BaseModel):
    """Sync operation response."""

    success: bool
    skills_synced: int
    mcps_synced: int
    errors: list[str] = Field(default_factory=list)


class SyncStatusResponse(BaseModel):
    """Sync status for a user."""

    by_cli: dict[str, dict[str, Any]]
    total_synced: int
    total_pending: int
    total_failed: int
    total_conflicts: int


class ConflictResponse(BaseModel):
    """A sync conflict requiring resolution."""

    id: str
    conflict_type: str
    podex_version: dict[str, Any] | None
    cli_version: dict[str, Any] | None
    created_at: str


class ConflictResolutionRequest(BaseModel):
    """Request to resolve a sync conflict."""

    resolution: str = Field(
        ...,
        description="Resolution strategy: 'use_podex', 'use_cli', 'merge', or 'delete'",
    )
    merged_config: dict[str, Any] | None = Field(
        default=None,
        description="Merged config if resolution is 'merge'",
    )


class SyncPreferencesRequest(BaseModel):
    """Request to update sync preferences."""

    claude_code: dict[str, Any] | None = None
    codex: dict[str, Any] | None = None
    gemini_cli: dict[str, Any] | None = None
    conflict_resolution: str | None = Field(
        default=None,
        description="Default conflict resolution: 'podex_wins', 'cli_wins', or 'manual'",
    )


class SyncFromWorkspaceRequest(BaseModel):
    """Request to sync changes from workspace back to Podex."""

    workspace_id: str
    cli_agent: str = Field(
        ...,
        description="CLI agent to sync from: 'claude_code', 'codex', or 'gemini_cli'",
    )


# ============================================================================
# Helper functions
# ============================================================================


def _get_sync_service(db: AsyncSession) -> CLISyncService:
    """Create CLI sync service instance."""
    # Note: In production, dotfiles_sync would be injected as a dependency
    return CLISyncService(db=db)


# ============================================================================
# Routes
# ============================================================================


@router.post("/sync", response_model=SyncResponse)
async def trigger_sync(
    request: SyncRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SyncResponse:
    """Trigger sync of skills and MCPs to CLI agents.

    This endpoint syncs all enabled skills and MCPs to the specified CLI agents.
    If no CLI agents are specified, syncs to all enabled agents based on user preferences.
    """
    user_id = UUID(current_user["id"])
    service = _get_sync_service(db)

    result = await service.sync_all_enabled(
        user_id=user_id,
        cli_agents=request.cli_agents,
    )

    return SyncResponse(
        success=result.success,
        skills_synced=result.skills_synced,
        mcps_synced=result.mcps_synced,
        errors=result.errors,
    )


@router.post("/sync/skill/{skill_id}", response_model=SyncResponse)
async def sync_skill(
    skill_id: str,
    skill_type: str = Query(default="user", description="'user' or 'system'"),
    cli_agents: list[str] | None = Query(default=None),
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SyncResponse:
    """Sync a single skill to CLI agents."""
    user_id = UUID(current_user["id"])
    service = _get_sync_service(db)

    result = await service.sync_skill(
        user_id=user_id,
        skill_id=skill_id,
        skill_type=skill_type,
        cli_agents=cli_agents,
    )

    return SyncResponse(
        success=result.success,
        skills_synced=result.skills_synced,
        mcps_synced=result.mcps_synced,
        errors=result.errors,
    )


@router.post("/sync/mcp/{mcp_id}", response_model=SyncResponse)
async def sync_mcp(
    mcp_id: str,
    cli_agents: list[str] | None = Query(default=None),
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SyncResponse:
    """Sync a single MCP to CLI agents."""
    user_id = UUID(current_user["id"])
    service = _get_sync_service(db)

    result = await service.sync_mcp(
        user_id=user_id,
        mcp_id=mcp_id,
        cli_agents=cli_agents,
    )

    return SyncResponse(
        success=result.success,
        skills_synced=result.skills_synced,
        mcps_synced=result.mcps_synced,
        errors=result.errors,
    )


@router.delete("/sync/skill/{skill_id}", response_model=SyncResponse)
async def remove_skill_from_cli(
    skill_id: str,
    cli_agents: list[str] | None = Query(default=None),
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SyncResponse:
    """Remove a skill from CLI configs.

    Called when a skill is deleted or disabled in Podex.
    """
    user_id = UUID(current_user["id"])
    service = _get_sync_service(db)

    result = await service.remove_skill_from_cli(
        user_id=user_id,
        skill_id=skill_id,
        cli_agents=cli_agents,
    )

    return SyncResponse(
        success=result.success,
        skills_synced=result.skills_synced,
        mcps_synced=result.mcps_synced,
        errors=result.errors,
    )


@router.get("/status", response_model=SyncStatusResponse)
async def get_sync_status(
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SyncStatusResponse:
    """Get current sync status for the user.

    Returns counts of synced, pending, failed items and conflicts by CLI agent.
    """
    user_id = UUID(current_user["id"])
    service = _get_sync_service(db)

    status = await service.get_sync_status(user_id)

    return SyncStatusResponse(
        by_cli=status["by_cli"],
        total_synced=status["total_synced"],
        total_pending=status["total_pending"],
        total_failed=status["total_failed"],
        total_conflicts=status["total_conflicts"],
    )


@router.get("/conflicts", response_model=list[ConflictResponse])
async def list_conflicts(
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ConflictResponse]:
    """List unresolved sync conflicts.

    Returns all conflicts that require manual resolution.
    """
    user_id = UUID(current_user["id"])
    service = _get_sync_service(db)

    conflicts = await service.get_conflicts(user_id)

    return [
        ConflictResponse(
            id=c["id"],
            conflict_type=c["conflict_type"],
            podex_version=c["podex_version"],
            cli_version=c["cli_version"],
            created_at=c["created_at"],
        )
        for c in conflicts
    ]


@router.post("/conflicts/{conflict_id}/resolve")
async def resolve_conflict(
    conflict_id: str,
    request: ConflictResolutionRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Resolve a sync conflict.

    Args:
        conflict_id: ID of the conflict to resolve
        request: Resolution strategy and optional merged config
    """
    user_id = UUID(current_user["id"])
    service = _get_sync_service(db)

    success = await service.resolve_conflict(
        user_id=user_id,
        conflict_id=conflict_id,
        resolution=request.resolution,
        merged_config=request.merged_config,
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conflict not found",
        )

    return {"success": True, "conflict_id": conflict_id, "resolution": request.resolution}


@router.post("/sync-from-workspace", response_model=SyncResponse)
async def sync_from_workspace(
    request: SyncFromWorkspaceRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SyncResponse:
    """Sync changes from workspace CLI config back to Podex.

    This enables bidirectional sync - changes made directly in CLI configs
    (e.g., ~/.claude/commands/) are imported back to Podex.
    """
    user_id = UUID(current_user["id"])
    service = _get_sync_service(db)

    # Get workspace from compute client
    workspace_info = await compute_client.get_workspace(request.workspace_id, str(user_id))
    if not workspace_info:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace not found",
        )

    # Use the workspace container path or default to /workspaces/{id}
    workspace_path = f"/workspaces/{request.workspace_id}"

    result = await service.sync_from_cli(
        user_id=user_id,
        cli_name=request.cli_agent,
        workspace_path=workspace_path,
    )

    return SyncResponse(
        success=result.success,
        skills_synced=result.skills_synced,
        mcps_synced=result.mcps_synced,
        errors=result.errors,
    )


@router.get("/preferences")
async def get_sync_preferences(
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get user's CLI sync preferences."""
    user_id = UUID(current_user["id"])

    query = select(UserConfig).where(UserConfig.user_id == str(user_id))
    result = await db.execute(query)
    config = result.scalar_one_or_none()

    if not config or not config.cli_sync_preferences:
        # Return defaults
        return {
            "claude_code": {"auto_sync": True, "sync_skills": True, "sync_mcp": True},
            "codex": {"auto_sync": True, "sync_skills": True, "sync_mcp": True},
            "gemini_cli": {"auto_sync": True, "sync_skills": True, "sync_mcp": False},
            "conflict_resolution": "manual",
        }

    return config.cli_sync_preferences


@router.patch("/preferences")
async def update_sync_preferences(
    request: SyncPreferencesRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Update user's CLI sync preferences."""
    user_id = UUID(current_user["id"])

    query = select(UserConfig).where(UserConfig.user_id == str(user_id))
    result = await db.execute(query)
    config = result.scalar_one_or_none()

    if not config:
        config = UserConfig(
            id=str(uuid4()),
            user_id=str(user_id),
        )
        db.add(config)

    # Merge with existing preferences
    current_prefs = config.cli_sync_preferences or {}

    if request.claude_code is not None:
        current_prefs["claude_code"] = {
            **current_prefs.get("claude_code", {}),
            **request.claude_code,
        }

    if request.codex is not None:
        current_prefs["codex"] = {
            **current_prefs.get("codex", {}),
            **request.codex,
        }

    if request.gemini_cli is not None:
        current_prefs["gemini_cli"] = {
            **current_prefs.get("gemini_cli", {}),
            **request.gemini_cli,
        }

    if request.conflict_resolution is not None:
        current_prefs["conflict_resolution"] = request.conflict_resolution

    config.cli_sync_preferences = current_prefs
    await db.commit()

    return config.cli_sync_preferences


@router.get("/supported-clis")
async def list_supported_clis() -> list[dict[str, Any]]:
    """List supported CLI agents with their capabilities."""
    return [
        {
            "name": "claude_code",
            "display_name": "Claude Code",
            "supports_mcp": True,
            "supports_skills": True,
            "config_directory": ".claude",
            "skills_format": "Markdown files in ~/.claude/commands/",
            "mcp_format": "mcpServers in ~/.claude/config.json",
        },
        {
            "name": "codex",
            "display_name": "OpenAI Codex",
            "supports_mcp": True,
            "supports_skills": True,
            "config_directory": ".codex",
            "skills_format": "[commands.*] sections in ~/.codex/config.toml",
            "mcp_format": "[mcp_servers.*] sections in ~/.codex/config.toml",
        },
        {
            "name": "gemini_cli",
            "display_name": "Gemini CLI",
            "supports_mcp": False,
            "supports_skills": True,
            "config_directory": ".gemini",
            "skills_format": "Markdown files in ~/.gemini/skills/",
            "mcp_format": None,
        },
    ]
