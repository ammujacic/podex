"""CLI sync triggers for automatic synchronization.

This module provides event handlers that trigger CLI sync operations
when skills or MCPs are created, updated, deleted, or enabled/disabled.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from src.services.cli_sync_service import CLISyncService

if TYPE_CHECKING:
    from uuid import UUID

logger = structlog.get_logger()


class CLISyncTriggers:
    """Handles automatic sync triggers for CLI agents.

    This class provides static methods that can be called after skill/MCP
    operations to automatically sync changes to CLI configs.

    Usage:
        # In skills.py route after creating a skill:
        await CLISyncTriggers.on_skill_created(db, user_id, skill.id)

        # In mcp.py route after enabling an MCP:
        await CLISyncTriggers.on_mcp_enabled(db, user_id, mcp_id)
    """

    @staticmethod
    async def on_skill_created(
        db: AsyncSession,
        user_id: UUID,
        skill_id: str,
        skill_type: str = "user",
        background: bool = True,
    ) -> None:
        """Trigger sync when a skill is created.

        Args:
            db: Database session
            user_id: User ID
            skill_id: ID of the created skill
            skill_type: "user" or "system"
            background: If True, run sync in background task
        """
        logger.info(
            "Skill created - triggering CLI sync",
            user_id=str(user_id),
            skill_id=skill_id,
        )

        if background:
            asyncio.create_task(  # noqa: RUF006
                CLISyncTriggers._sync_skill(db, user_id, skill_id, skill_type)
            )
        else:
            await CLISyncTriggers._sync_skill(db, user_id, skill_id, skill_type)

    @staticmethod
    async def on_skill_updated(
        db: AsyncSession,
        user_id: UUID,
        skill_id: str,
        skill_type: str = "user",
        background: bool = True,
    ) -> None:
        """Trigger sync when a skill is updated."""
        logger.info(
            "Skill updated - triggering CLI sync",
            user_id=str(user_id),
            skill_id=skill_id,
        )

        if background:
            asyncio.create_task(  # noqa: RUF006
                CLISyncTriggers._sync_skill(db, user_id, skill_id, skill_type)
            )
        else:
            await CLISyncTriggers._sync_skill(db, user_id, skill_id, skill_type)

    @staticmethod
    async def on_skill_deleted(
        db: AsyncSession,
        user_id: UUID,
        skill_id: str,
        background: bool = True,
    ) -> None:
        """Trigger sync to remove skill from CLIs when deleted."""
        logger.info(
            "Skill deleted - triggering CLI removal",
            user_id=str(user_id),
            skill_id=skill_id,
        )

        if background:
            asyncio.create_task(  # noqa: RUF006
                CLISyncTriggers._remove_skill(db, user_id, skill_id)
            )
        else:
            await CLISyncTriggers._remove_skill(db, user_id, skill_id)

    @staticmethod
    async def on_skill_enabled(
        db: AsyncSession,
        user_id: UUID,
        skill_id: str,
        skill_type: str = "user",
        background: bool = True,
    ) -> None:
        """Trigger sync when a skill is enabled."""
        logger.info(
            "Skill enabled - triggering CLI sync",
            user_id=str(user_id),
            skill_id=skill_id,
        )

        if background:
            asyncio.create_task(  # noqa: RUF006
                CLISyncTriggers._sync_skill(db, user_id, skill_id, skill_type)
            )
        else:
            await CLISyncTriggers._sync_skill(db, user_id, skill_id, skill_type)

    @staticmethod
    async def on_skill_disabled(
        db: AsyncSession,
        user_id: UUID,
        skill_id: str,
        background: bool = True,
    ) -> None:
        """Trigger sync to remove skill from CLIs when disabled."""
        logger.info(
            "Skill disabled - triggering CLI removal",
            user_id=str(user_id),
            skill_id=skill_id,
        )

        if background:
            asyncio.create_task(  # noqa: RUF006
                CLISyncTriggers._remove_skill(db, user_id, skill_id)
            )
        else:
            await CLISyncTriggers._remove_skill(db, user_id, skill_id)

    @staticmethod
    async def on_mcp_created(
        db: AsyncSession,
        user_id: UUID,
        mcp_id: str,
        background: bool = True,
    ) -> None:
        """Trigger sync when an MCP is created."""
        logger.info(
            "MCP created - triggering CLI sync",
            user_id=str(user_id),
            mcp_id=mcp_id,
        )

        if background:
            asyncio.create_task(  # noqa: RUF006
                CLISyncTriggers._sync_mcp(db, user_id, mcp_id)
            )
        else:
            await CLISyncTriggers._sync_mcp(db, user_id, mcp_id)

    @staticmethod
    async def on_mcp_updated(
        db: AsyncSession,
        user_id: UUID,
        mcp_id: str,
        background: bool = True,
    ) -> None:
        """Trigger sync when an MCP is updated."""
        logger.info(
            "MCP updated - triggering CLI sync",
            user_id=str(user_id),
            mcp_id=mcp_id,
        )

        if background:
            asyncio.create_task(  # noqa: RUF006
                CLISyncTriggers._sync_mcp(db, user_id, mcp_id)
            )
        else:
            await CLISyncTriggers._sync_mcp(db, user_id, mcp_id)

    @staticmethod
    async def on_mcp_enabled(
        db: AsyncSession,
        user_id: UUID,
        mcp_id: str,
        background: bool = True,
    ) -> None:
        """Trigger sync when an MCP is enabled."""
        logger.info(
            "MCP enabled - triggering CLI sync",
            user_id=str(user_id),
            mcp_id=mcp_id,
        )

        if background:
            asyncio.create_task(  # noqa: RUF006
                CLISyncTriggers._sync_mcp(db, user_id, mcp_id)
            )
        else:
            await CLISyncTriggers._sync_mcp(db, user_id, mcp_id)

    @staticmethod
    async def on_mcp_disabled(
        _db: AsyncSession,
        user_id: UUID,
        mcp_id: str,
        _background: bool = True,
    ) -> None:
        """Trigger to remove MCP from CLI configs when disabled.

        Note: We don't actually remove the MCP config, just update sync status.
        The user may want to keep the config in CLI tools.
        """
        logger.info(
            "MCP disabled - updating CLI sync status",
            user_id=str(user_id),
            mcp_id=mcp_id,
        )
        # For MCPs, we typically don't remove them from CLI configs
        # as users may have configured them manually there

    @staticmethod
    async def on_workspace_start(
        _db: AsyncSession,
        user_id: UUID,
        workspace_id: str,
    ) -> None:
        """Trigger sync when a workspace session starts.

        This ensures the workspace has the latest CLI configs including
        synced skills and MCPs.
        """
        logger.info(
            "Workspace started - syncing CLI configs",
            user_id=str(user_id),
            workspace_id=workspace_id,
        )

        # Note: Dotfiles sync functionality has been removed

    @staticmethod
    async def on_workspace_file_change(
        db: AsyncSession,
        user_id: UUID,
        workspace_id: str,
        file_path: str,
    ) -> None:
        """Handle CLI config file changes in workspace for reverse sync.

        Called when workspace detects changes to CLI config files.
        This enables bidirectional sync.
        """
        # Check if file_path is a CLI config file
        cli_config_patterns = {
            ".claude/config.json": "claude_code",
            ".claude/commands/": "claude_code",
            ".codex/config.toml": "codex",
            ".gemini/settings.json": "gemini_cli",
            ".gemini/skills/": "gemini_cli",
        }

        cli_name = None
        for pattern, cli in cli_config_patterns.items():
            if file_path.startswith(pattern) or pattern in file_path:
                cli_name = cli
                break

        if not cli_name:
            return  # Not a CLI config file

        logger.info(
            "CLI config file changed - triggering reverse sync",
            user_id=str(user_id),
            workspace_id=workspace_id,
            file_path=file_path,
            cli_name=cli_name,
        )

        # Trigger reverse sync
        # Note: This should be debounced in the file watcher to avoid
        # triggering multiple syncs for rapid changes
        try:
            service = CLISyncService(db=db)
            await service.sync_from_cli(
                user_id=user_id,
                cli_name=cli_name,
                workspace_path=f"/workspaces/{workspace_id}",
            )
        except Exception as e:
            logger.exception("Failed to reverse sync from CLI", error=str(e))

    # Private helper methods

    @staticmethod
    async def _sync_skill(
        db: AsyncSession,
        user_id: UUID,
        skill_id: str,
        skill_type: str,
    ) -> None:
        """Internal: Sync a skill to CLI agents."""
        try:
            service = CLISyncService(db=db)
            result = await service.sync_skill(
                user_id=user_id,
                skill_id=skill_id,
                skill_type=skill_type,
            )

            if result.errors:
                logger.warning(
                    "Skill sync completed with errors",
                    skill_id=skill_id,
                    errors=result.errors,
                )
            else:
                logger.info(
                    "Skill synced to CLI agents",
                    skill_id=skill_id,
                    skills_synced=result.skills_synced,
                )
        except Exception as e:
            logger.exception("Failed to sync skill to CLI", skill_id=skill_id, error=str(e))

    @staticmethod
    async def _remove_skill(
        db: AsyncSession,
        user_id: UUID,
        skill_id: str,
    ) -> None:
        """Internal: Remove a skill from CLI agents."""
        try:
            service = CLISyncService(db=db)
            result = await service.remove_skill_from_cli(
                user_id=user_id,
                skill_id=skill_id,
            )

            if result.errors:
                logger.warning(
                    "Skill removal completed with errors",
                    skill_id=skill_id,
                    errors=result.errors,
                )
            else:
                logger.info(
                    "Skill removed from CLI agents",
                    skill_id=skill_id,
                )
        except Exception as e:
            logger.exception("Failed to remove skill from CLI", skill_id=skill_id, error=str(e))

    @staticmethod
    async def _sync_mcp(
        db: AsyncSession,
        user_id: UUID,
        mcp_id: str,
    ) -> None:
        """Internal: Sync an MCP to CLI agents."""
        try:
            service = CLISyncService(db=db)
            result = await service.sync_mcp(
                user_id=user_id,
                mcp_id=mcp_id,
            )

            if result.errors:
                logger.warning(
                    "MCP sync completed with errors",
                    mcp_id=mcp_id,
                    errors=result.errors,
                )
            else:
                logger.info(
                    "MCP synced to CLI agents",
                    mcp_id=mcp_id,
                    mcps_synced=result.mcps_synced,
                )
        except Exception as e:
            logger.exception("Failed to sync MCP to CLI", mcp_id=mcp_id, error=str(e))
