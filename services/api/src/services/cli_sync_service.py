"""Service for syncing Podex skills and MCPs to CLI wrapper agents.

This service handles bidirectional synchronization between Podex and CLI tools:
- Claude Code (~/.claude/)
- OpenAI Codex (~/.codex/)
- Gemini CLI (~/.gemini/)
"""

from __future__ import annotations

import contextlib
import hashlib
import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

import structlog
import toml  # type: ignore[import-untyped]
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import (
    CLISyncConflict,
    CLISyncLog,
    CLISyncStatus,
    MCPServer,
    SystemSkill,
    UserAddedSkill,
    UserConfig,
    UserSkill,
)
from src.services.cli_translators import (
    TRANSLATORS,
    CLITranslator,
)

if TYPE_CHECKING:
    from src.services.dotfiles_sync import DotfilesSync

logger = structlog.get_logger()


@dataclass
class SyncResult:
    """Result of a CLI sync operation."""

    success: bool
    skills_synced: int = 0
    mcps_synced: int = 0
    skills_failed: int = 0
    mcps_failed: int = 0
    conflicts_detected: int = 0
    errors: list[str] = field(default_factory=list)


@dataclass
class CLISyncResult:
    """Result of syncing to a single CLI."""

    cli_name: str
    skills_synced: int = 0
    mcps_synced: int = 0
    errors: list[str] = field(default_factory=list)


class CLISyncService:
    """Service for syncing Podex skills and MCPs to CLI agents.

    Supports bidirectional sync:
    - Push: Podex -> CLI configs (skills become commands, MCPs become server configs)
    - Pull: CLI configs -> Podex (reverse sync for changes made in CLI tools)

    Usage:
        service = CLISyncService(db, dotfiles_sync)
        result = await service.sync_all_enabled(user_id)
    """

    def __init__(
        self,
        db: AsyncSession,
        dotfiles_sync: DotfilesSync | None = None,
    ) -> None:
        """Initialize the CLI sync service.

        Args:
            db: Database session
            dotfiles_sync: DotfilesSync instance for writing to GCS
        """
        self.db = db
        self.dotfiles_sync = dotfiles_sync
        self._translators: dict[str, CLITranslator] = {
            name: cls() for name, cls in TRANSLATORS.items()
        }

    async def sync_all_enabled(
        self,
        user_id: UUID,
        cli_agents: list[str] | None = None,
    ) -> SyncResult:
        """Sync all enabled skills and MCPs to specified CLI agents.

        Args:
            user_id: User ID
            cli_agents: List of CLI agents to sync to. If None, sync to all enabled.

        Returns:
            SyncResult with counts and any errors
        """
        result = SyncResult(success=True)

        # Get user's sync preferences
        config = await self._get_user_config(user_id)
        sync_prefs = config.cli_sync_preferences or self._default_sync_preferences()

        # Determine which CLIs to sync to
        target_clis = cli_agents or list(self._translators.keys())
        target_clis = [cli for cli in target_clis if sync_prefs.get(cli, {}).get("auto_sync", True)]

        logger.info(
            "Starting CLI sync",
            user_id=str(user_id),
            target_clis=target_clis,
        )

        for cli_name in target_clis:
            try:
                cli_result = await self._sync_to_cli(user_id, cli_name, sync_prefs)
                result.skills_synced += cli_result.skills_synced
                result.mcps_synced += cli_result.mcps_synced
                result.errors.extend(cli_result.errors)
            except Exception as e:
                logger.exception("Failed to sync to CLI", cli_name=cli_name, error=str(e))
                result.errors.append(f"{cli_name}: {e!s}")

        if result.errors:
            result.success = False

        return result

    async def sync_skill(
        self,
        user_id: UUID,
        skill_id: str,
        skill_type: str,
        cli_agents: list[str] | None = None,
    ) -> SyncResult:
        """Sync a single skill to CLI agents.

        Args:
            user_id: User ID
            skill_id: Skill ID to sync
            skill_type: "user" or "system"
            cli_agents: List of CLI agents to sync to

        Returns:
            SyncResult
        """
        result = SyncResult(success=True)

        # Get the skill
        skill: UserSkill | SystemSkill | None
        if skill_type == "user":
            skill = await self._get_user_skill(skill_id)
        else:
            skill = await self._get_system_skill(skill_id)

        if not skill:
            result.success = False
            result.errors.append(f"Skill not found: {skill_id}")
            return result

        skill_dict = self._skill_to_dict(skill)

        # Get user preferences
        config = await self._get_user_config(user_id)
        sync_prefs = config.cli_sync_preferences or self._default_sync_preferences()

        # Determine target CLIs
        target_clis = cli_agents or list(self._translators.keys())
        target_clis = [
            cli for cli in target_clis if sync_prefs.get(cli, {}).get("sync_skills", True)
        ]

        for cli_name in target_clis:
            translator = self._translators[cli_name]
            try:
                translated = translator.translate_skill(skill_dict)
                await self._write_skill_config(user_id, translator, translated)
                await self._update_sync_status(
                    user_id=user_id,
                    source_id=skill_id,
                    source_table="user_skills" if skill_type == "user" else "system_skills",
                    cli_name=cli_name,
                    status="synced",
                    translated_config=translated.cli_format,
                    file_path=translated.file_path,
                )
                result.skills_synced += 1
            except Exception as e:
                logger.exception("Failed to sync skill", skill_id=skill_id, cli_name=cli_name)
                result.errors.append(f"{cli_name}: {e!s}")
                result.skills_failed += 1

        return result

    async def sync_mcp(
        self,
        user_id: UUID,
        mcp_id: str,
        cli_agents: list[str] | None = None,
    ) -> SyncResult:
        """Sync a single MCP to CLI agents.

        Args:
            user_id: User ID
            mcp_id: MCP server ID to sync
            cli_agents: List of CLI agents to sync to

        Returns:
            SyncResult
        """
        result = SyncResult(success=True)

        # Get the MCP
        mcp = await self._get_mcp_server(mcp_id)
        if not mcp:
            result.success = False
            result.errors.append(f"MCP not found: {mcp_id}")
            return result

        mcp_dict = self._mcp_to_dict(mcp)

        # Get user preferences
        config = await self._get_user_config(user_id)
        sync_prefs = config.cli_sync_preferences or self._default_sync_preferences()

        # Determine target CLIs (only those that support MCP)
        target_clis = cli_agents or list(self._translators.keys())
        target_clis = [
            cli
            for cli in target_clis
            if sync_prefs.get(cli, {}).get("sync_mcp", True) and self._translators[cli].supports_mcp
        ]

        for cli_name in target_clis:
            translator = self._translators[cli_name]
            try:
                translated = translator.translate_mcp(mcp_dict)
                if translated:
                    await self._write_mcp_config(
                        user_id, translator, {translated.name: translated.cli_format}
                    )
                    await self._update_sync_status(
                        user_id=user_id,
                        source_id=mcp_id,
                        source_table="mcp_servers",
                        cli_name=cli_name,
                        status="synced",
                        translated_config={
                            "key": translated.config_key,
                            "config": translated.cli_format,
                        },
                    )
                    result.mcps_synced += 1
            except Exception as e:
                logger.exception("Failed to sync MCP", mcp_id=mcp_id, cli_name=cli_name)
                result.errors.append(f"{cli_name}: {e!s}")
                result.mcps_failed += 1

        return result

    async def remove_skill_from_cli(
        self,
        user_id: UUID,
        skill_id: str,
        cli_agents: list[str] | None = None,
    ) -> SyncResult:
        """Remove a skill from CLI configs (when deleted or disabled in Podex).

        Args:
            user_id: User ID
            skill_id: Skill ID to remove
            cli_agents: List of CLI agents to remove from

        Returns:
            SyncResult
        """
        result = SyncResult(success=True)

        # Get sync status records to find file paths
        query = select(CLISyncStatus).where(
            CLISyncStatus.user_id == str(user_id),
            CLISyncStatus.source_id == skill_id,
            CLISyncStatus.sync_type == "skill",
        )
        status_result = await self.db.execute(query)
        statuses = status_result.scalars().all()

        for status in statuses:
            if cli_agents and status.cli_agent not in cli_agents:
                continue

            try:
                # Delete the file from GCS
                if status.cli_file_path and self.dotfiles_sync:
                    translator = self._translators[status.cli_agent]
                    config_dir = translator.config_directory
                    await self._delete_file(user_id, f"{config_dir}/{status.cli_file_path}")

                # Mark status as deleted
                status.sync_status = "deleted"
                status.updated_at = datetime.now(UTC)
                result.skills_synced += 1

            except Exception as e:
                logger.exception("Failed to remove skill from CLI", skill_id=skill_id)
                result.errors.append(f"{status.cli_agent}: {e!s}")

        await self.db.commit()
        return result

    async def sync_from_cli(
        self,
        user_id: UUID,
        cli_name: str,
        workspace_path: str,
    ) -> SyncResult:
        """Sync changes from CLI config back to Podex (reverse sync).

        Called when workspace detects CLI config file changes.

        Args:
            user_id: User ID
            cli_name: CLI agent name
            workspace_path: Path to workspace directory

        Returns:
            SyncResult with imported items and conflicts
        """
        result = SyncResult(success=True)

        translator = self._translators[cli_name]

        # Get user's conflict resolution preference
        config = await self._get_user_config(user_id)
        sync_prefs = config.cli_sync_preferences or self._default_sync_preferences()
        conflict_resolution = sync_prefs.get("conflict_resolution", "manual")

        # Read CLI config files from workspace
        cli_configs = await self._read_cli_configs(workspace_path, translator)

        # Process skills
        for skill_config, file_path in cli_configs.get("skills", []):
            try:
                parsed = translator.parse_cli_skill(skill_config, file_path)
                await self._import_skill_from_cli(
                    user_id, parsed, cli_name, conflict_resolution, result
                )
            except Exception as e:
                logger.exception("Failed to import skill from CLI", error=str(e))
                result.errors.append(f"Skill import error: {e!s}")

        # Process MCPs (if supported)
        if translator.supports_mcp:
            for mcp_config, key in cli_configs.get("mcps", []):
                try:
                    parsed_mcp: dict[str, Any] | None = translator.parse_cli_mcp(mcp_config, key)
                    if parsed_mcp is not None:
                        await self._import_mcp_from_cli(
                            user_id, parsed_mcp, cli_name, conflict_resolution, result
                        )
                except Exception as e:
                    logger.exception("Failed to import MCP from CLI", error=str(e))
                    result.errors.append(f"MCP import error: {e!s}")

        await self.db.commit()
        return result

    async def get_sync_status(self, user_id: UUID) -> dict[str, Any]:
        """Get current sync status for a user.

        Returns:
            Dictionary with sync status by CLI and item counts
        """
        query = select(CLISyncStatus).where(CLISyncStatus.user_id == str(user_id))
        status_result = await self.db.execute(query)
        statuses = status_result.scalars().all()

        by_cli: dict[str, dict[str, Any]] = {}
        for status in statuses:
            if status.cli_agent not in by_cli:
                by_cli[status.cli_agent] = {
                    "synced": 0,
                    "pending": 0,
                    "failed": 0,
                    "conflicts": 0,
                    "last_sync": None,
                }

            cli_status = by_cli[status.cli_agent]
            cli_status[status.sync_status] = cli_status.get(status.sync_status, 0) + 1

            if status.last_synced_at and (
                cli_status["last_sync"] is None or status.last_synced_at > cli_status["last_sync"]
            ):
                cli_status["last_sync"] = status.last_synced_at

        return {
            "by_cli": by_cli,
            "total_synced": sum(c.get("synced", 0) for c in by_cli.values()),
            "total_pending": sum(c.get("pending", 0) for c in by_cli.values()),
            "total_failed": sum(c.get("failed", 0) for c in by_cli.values()),
            "total_conflicts": sum(c.get("conflicts", 0) for c in by_cli.values()),
        }

    async def get_conflicts(self, user_id: UUID) -> list[dict[str, Any]]:
        """Get unresolved sync conflicts for a user."""
        query = select(CLISyncConflict).where(
            CLISyncConflict.user_id == str(user_id),
            CLISyncConflict.resolved == False,
        )
        result = await self.db.execute(query)
        conflicts = result.scalars().all()

        return [
            {
                "id": c.id,
                "conflict_type": c.conflict_type,
                "podex_version": c.podex_version,
                "cli_version": c.cli_version,
                "created_at": c.created_at.isoformat(),
            }
            for c in conflicts
        ]

    async def resolve_conflict(
        self,
        user_id: UUID,
        conflict_id: str,
        resolution: str,
        merged_config: dict[str, Any] | None = None,
    ) -> bool:
        """Resolve a sync conflict.

        Args:
            user_id: User ID
            conflict_id: Conflict ID to resolve
            resolution: "use_podex" | "use_cli" | "merge" | "delete"
            merged_config: Merged config if resolution is "merge"

        Returns:
            True if resolved successfully
        """
        query = select(CLISyncConflict).where(
            CLISyncConflict.id == conflict_id,
            CLISyncConflict.user_id == str(user_id),
        )
        result = await self.db.execute(query)
        conflict = result.scalar_one_or_none()

        if not conflict:
            return False

        # Apply resolution
        if resolution == "use_podex":
            # Re-sync Podex version to CLI
            pass  # Implementation depends on sync_status
        elif resolution == "use_cli":
            # Import CLI version to Podex
            pass  # Implementation depends on conflict.cli_version
        elif resolution == "merge" and merged_config:
            # Apply merged config
            pass
        elif resolution == "delete":
            # Remove from both
            pass

        conflict.resolved = True
        conflict.resolution = resolution
        conflict.resolved_at = datetime.now(UTC)
        await self.db.commit()

        return True

    # Private helper methods

    async def _sync_to_cli(
        self,
        user_id: UUID,
        cli_name: str,
        sync_prefs: dict[str, Any],
    ) -> CLISyncResult:
        """Sync all enabled skills and MCPs to a specific CLI."""
        translator = self._translators[cli_name]
        cli_prefs = sync_prefs.get(cli_name, {})
        result = CLISyncResult(cli_name=cli_name)

        # Create sync log
        sync_log = CLISyncLog(
            id=str(uuid4()),
            user_id=str(user_id),
            cli_agent=cli_name,
            sync_type="bulk",
            direction="push",
            started_at=datetime.now(UTC),
        )
        self.db.add(sync_log)

        try:
            # Sync skills if enabled
            if cli_prefs.get("sync_skills", True):
                skills_result = await self._sync_skills_to_cli(user_id, cli_name, translator)
                result.skills_synced = skills_result["synced"]
                result.errors.extend(skills_result.get("errors", []))

            # Sync MCPs if enabled and supported
            if cli_prefs.get("sync_mcp", True) and translator.supports_mcp:
                mcps_result = await self._sync_mcps_to_cli(user_id, cli_name, translator)
                result.mcps_synced = mcps_result["synced"]
                result.errors.extend(mcps_result.get("errors", []))

            # Update sync log
            sync_log.items_synced = result.skills_synced + result.mcps_synced
            sync_log.items_failed = len(result.errors)
            sync_log.completed_at = datetime.now(UTC)
            sync_log.duration_ms = int(
                (sync_log.completed_at - sync_log.started_at).total_seconds() * 1000
            )

        except Exception as e:
            logger.exception("CLI sync failed", cli_name=cli_name, error=str(e))
            sync_log.error_message = str(e)
            sync_log.completed_at = datetime.now(UTC)
            result.errors.append(str(e))

        await self.db.commit()
        return result

    async def _sync_skills_to_cli(
        self,
        user_id: UUID,
        cli_name: str,
        translator: CLITranslator,
    ) -> dict[str, Any]:
        """Sync all user's enabled skills to a CLI."""
        result: dict[str, Any] = {"synced": 0, "errors": []}

        # Get user skills
        user_skills = await self._get_user_skills(user_id)

        # Get user-added system skills
        system_skills = await self._get_user_added_system_skills(user_id)

        # Translate and sync each skill
        for skill in user_skills:
            try:
                skill_dict = self._skill_to_dict(skill)
                translated = translator.translate_skill(skill_dict)
                await self._write_skill_config(user_id, translator, translated)
                await self._update_sync_status(
                    user_id=user_id,
                    source_id=skill.id,
                    source_table="user_skills",
                    cli_name=cli_name,
                    status="synced",
                    translated_config=translated.cli_format,
                    file_path=translated.file_path,
                )
                result["synced"] += 1
            except Exception as e:
                result["errors"].append(f"Skill {skill.slug}: {e!s}")

        for sys_skill in system_skills:
            try:
                skill_dict = self._system_skill_to_dict(sys_skill)
                translated = translator.translate_skill(skill_dict)
                await self._write_skill_config(user_id, translator, translated)
                await self._update_sync_status(
                    user_id=user_id,
                    source_id=sys_skill.id,
                    source_table="system_skills",
                    cli_name=cli_name,
                    status="synced",
                    translated_config=translated.cli_format,
                    file_path=translated.file_path,
                )
                result["synced"] += 1
            except Exception as e:
                result["errors"].append(f"System skill {sys_skill.slug}: {e!s}")

        return result

    async def _sync_mcps_to_cli(
        self,
        user_id: UUID,
        cli_name: str,
        translator: CLITranslator,
    ) -> dict[str, Any]:
        """Sync all user's enabled MCPs to a CLI."""
        result: dict[str, Any] = {"synced": 0, "errors": []}

        # Get enabled MCP servers
        mcps = await self._get_enabled_mcps(user_id)

        # Collect all MCP configs for bulk write
        mcp_configs: dict[str, Any] = {}

        for mcp in mcps:
            try:
                mcp_dict = self._mcp_to_dict(mcp)
                translated = translator.translate_mcp(mcp_dict)

                if translated:
                    mcp_configs[translated.name] = translated.cli_format
                    await self._update_sync_status(
                        user_id=user_id,
                        source_id=mcp.id,
                        source_table="mcp_servers",
                        cli_name=cli_name,
                        status="synced",
                        translated_config={
                            "key": translated.config_key,
                            "config": translated.cli_format,
                        },
                    )
                    result["synced"] += 1
            except Exception as e:
                result["errors"].append(f"MCP {mcp.name}: {e!s}")

        # Write all MCP configs at once
        if mcp_configs:
            try:
                await self._write_mcp_config(user_id, translator, mcp_configs)
            except Exception as e:
                result["errors"].append(f"Failed to write MCP config: {e!s}")

        return result

    async def _write_skill_config(
        self,
        user_id: UUID,
        translator: CLITranslator,
        translated: Any,
    ) -> None:
        """Write translated skill config to GCS dotfiles."""
        if not self.dotfiles_sync:
            logger.warning("DotfilesSync not available, skipping file write")
            return

        dotfiles_sync = self.dotfiles_sync  # Type narrowing for mypy
        config_dir = translator.config_directory
        file_path = f"{config_dir}/{translated.file_path}"

        content = translated.cli_format.get("content", "")
        if isinstance(translated.cli_format, dict) and "content" in translated.cli_format:
            content = translated.cli_format["content"]
        else:
            content = json.dumps(translated.cli_format, indent=2)

        # Write to GCS via dotfiles sync
        await dotfiles_sync._gcs.put_object(
            f"{user_id}/{file_path}",
            content.encode("utf-8"),
        )

    async def _write_mcp_config(
        self,
        user_id: UUID,
        translator: CLITranslator,
        mcp_configs: dict[str, Any],
    ) -> None:
        """Write MCP configs to CLI config file."""
        if not self.dotfiles_sync:
            logger.warning("DotfilesSync not available, skipping file write")
            return

        config_dir = translator.config_directory

        if translator.cli_name == "claude_code":
            await self._write_claude_code_mcp_config(user_id, config_dir, mcp_configs)
        elif translator.cli_name == "codex":
            await self._write_codex_mcp_config(user_id, config_dir, mcp_configs)

    async def _write_claude_code_mcp_config(
        self,
        user_id: UUID,
        config_dir: str,
        mcp_configs: dict[str, Any],
    ) -> None:
        """Write MCP configs to Claude Code's config.json."""
        assert self.dotfiles_sync is not None  # Type narrowing for mypy  # noqa: S101
        config_path = f"{config_dir}/config.json"

        # Read existing config or create new
        try:
            existing = await self.dotfiles_sync._gcs.get_object(f"{user_id}/{config_path}")
            config = json.loads(existing.decode("utf-8"))
        except Exception:
            config = {}

        # Update mcpServers
        if "mcpServers" not in config:
            config["mcpServers"] = {}

        for name, value in mcp_configs.items():
            config["mcpServers"][name] = value

        # Write back
        await self.dotfiles_sync._gcs.put_object(
            f"{user_id}/{config_path}",
            json.dumps(config, indent=2).encode("utf-8"),
        )

    async def _write_codex_mcp_config(
        self,
        user_id: UUID,
        config_dir: str,
        mcp_configs: dict[str, Any],
    ) -> None:
        """Write MCP configs to Codex's config.toml."""
        assert self.dotfiles_sync is not None  # Type narrowing for mypy  # noqa: S101

        config_path = f"{config_dir}/config.toml"

        # Read existing config or create new
        try:
            existing = await self.dotfiles_sync._gcs.get_object(f"{user_id}/{config_path}")
            config = toml.loads(existing.decode("utf-8"))
        except Exception:
            config = {}

        # Update mcp_servers
        if "mcp_servers" not in config:
            config["mcp_servers"] = {}

        for name, value in mcp_configs.items():
            config["mcp_servers"][name] = value

        # Write back
        await self.dotfiles_sync._gcs.put_object(
            f"{user_id}/{config_path}",
            toml.dumps(config).encode("utf-8"),
        )

    async def _delete_file(self, user_id: UUID, file_path: str) -> None:
        """Delete a file from GCS dotfiles."""
        if self.dotfiles_sync:
            with contextlib.suppress(Exception):
                # File might not exist
                await self.dotfiles_sync._gcs.delete_object(f"{user_id}/{file_path}")

    async def _read_cli_configs(
        self,
        workspace_path: str,
        translator: CLITranslator,
    ) -> dict[str, list[tuple[dict[str, Any], str]]]:
        """Read CLI config files from workspace."""
        result: dict[str, list[tuple[dict[str, Any], str]]] = {
            "skills": [],
            "mcps": [],
        }

        config_dir = Path(workspace_path) / translator.config_directory
        if not config_dir.exists():
            return result

        # Read skills
        skills_dir = config_dir / translator.get_skills_directory()
        if skills_dir.exists() and skills_dir.is_dir():
            for file_path in skills_dir.glob("*.md"):
                try:
                    content = file_path.read_text()
                    rel_path = str(file_path.relative_to(config_dir))
                    result["skills"].append(({"content": content}, rel_path))
                except Exception:
                    logger.exception("Failed to read skill file", path=str(file_path))

        # Read MCPs from config file
        if translator.supports_mcp and translator.config_file_name:
            config_file = config_dir / translator.config_file_name
            if config_file.exists():
                try:
                    if translator.cli_name == "claude_code":
                        config = json.loads(config_file.read_text())
                        for name, mcp_config in config.get("mcpServers", {}).items():
                            result["mcps"].append((mcp_config, f"mcpServers.{name}"))
                    elif translator.cli_name == "codex":
                        config = toml.loads(config_file.read_text())
                        for name, mcp_config in config.get("mcp_servers", {}).items():
                            result["mcps"].append((mcp_config, f"mcp_servers.{name}"))
                except Exception:
                    logger.exception("Failed to read config file", path=str(config_file))

        return result

    async def _import_skill_from_cli(
        self,
        user_id: UUID,
        parsed: dict[str, Any],
        cli_name: str,
        conflict_resolution: str,
        result: SyncResult,
    ) -> None:
        """Import a skill from CLI config to Podex."""
        # Check if this skill already exists
        existing = await self._find_existing_skill(user_id, parsed["slug"])

        if existing:
            # Check for conflict
            if await self._has_skill_conflict(user_id, existing, parsed, cli_name):
                if conflict_resolution == "cli_wins":
                    await self._update_skill_from_cli(existing, parsed)
                    result.skills_synced += 1
                elif conflict_resolution == "podex_wins":
                    # Re-sync Podex version
                    pass
                else:  # manual
                    await self._create_skill_conflict(user_id, existing, parsed, cli_name)
                    result.conflicts_detected += 1
        else:
            # Create new skill
            await self._create_skill_from_cli(user_id, parsed, cli_name)
            result.skills_synced += 1

    async def _import_mcp_from_cli(
        self,
        user_id: UUID,
        parsed: dict[str, Any],
        cli_name: str,
        conflict_resolution: str,
        result: SyncResult,
    ) -> None:
        """Import an MCP from CLI config to Podex."""
        # Check if this MCP already exists
        existing = await self._find_existing_mcp(user_id, parsed["name"])

        if existing:
            # Check for conflict
            if await self._has_mcp_conflict(user_id, existing, parsed, cli_name):
                if conflict_resolution == "cli_wins":
                    await self._update_mcp_from_cli(existing, parsed)
                    result.mcps_synced += 1
                elif conflict_resolution == "podex_wins":
                    pass
                else:
                    result.conflicts_detected += 1
        else:
            await self._create_mcp_from_cli(user_id, parsed, cli_name)
            result.mcps_synced += 1

    async def _update_sync_status(
        self,
        user_id: UUID,
        source_id: str,
        source_table: str,
        cli_name: str,
        status: str,
        translated_config: dict[str, Any],
        file_path: str | None = None,
    ) -> None:
        """Update or create sync status record."""
        query = select(CLISyncStatus).where(
            CLISyncStatus.user_id == str(user_id),
            CLISyncStatus.source_id == source_id,
            CLISyncStatus.cli_agent == cli_name,
        )
        result = await self.db.execute(query)
        existing = result.scalar_one_or_none()

        config_hash = hashlib.sha256(
            json.dumps(translated_config, sort_keys=True).encode()
        ).hexdigest()[:16]

        if existing:
            existing.sync_status = status
            existing.last_synced_at = datetime.now(UTC)
            existing.podex_version += 1
            existing.cli_config_hash = config_hash
            existing.translated_config = translated_config
            existing.cli_file_path = file_path
            existing.updated_at = datetime.now(UTC)
        else:
            sync_status = CLISyncStatus(
                id=str(uuid4()),
                user_id=str(user_id),
                sync_type="skill" if source_table.endswith("skills") else "mcp",
                source_id=source_id,
                source_table=source_table,
                cli_agent=cli_name,
                sync_status=status,
                sync_direction="to_cli",
                last_synced_at=datetime.now(UTC),
                podex_version=1,
                cli_version=0,
                cli_config_hash=config_hash,
                translated_config=translated_config,
                cli_file_path=file_path,
            )
            self.db.add(sync_status)

    # Database query helpers

    async def _get_user_config(self, user_id: UUID) -> UserConfig:
        """Get or create user config."""
        query = select(UserConfig).where(UserConfig.user_id == str(user_id))
        result = await self.db.execute(query)
        config = result.scalar_one_or_none()

        if not config:
            config = UserConfig(
                id=str(uuid4()),
                user_id=str(user_id),
            )
            self.db.add(config)

        return config

    async def _get_user_skills(self, user_id: UUID) -> list[UserSkill]:
        """Get all user skills."""
        query = select(UserSkill).where(UserSkill.user_id == str(user_id))
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def _get_user_added_system_skills(self, user_id: UUID) -> list[SystemSkill]:
        """Get system skills the user has added."""
        # Get user-added skill IDs
        added_query = select(UserAddedSkill.system_skill_id).where(
            UserAddedSkill.user_id == str(user_id),
            UserAddedSkill.is_enabled == True,
        )
        added_result = await self.db.execute(added_query)
        skill_ids = [r for r in added_result.scalars().all() if r]

        if not skill_ids:
            return []

        # Get the actual skills
        query = select(SystemSkill).where(SystemSkill.id.in_(skill_ids))
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def _get_enabled_mcps(self, user_id: UUID) -> list[MCPServer]:
        """Get enabled MCP servers for a user."""
        query = select(MCPServer).where(
            MCPServer.user_id == str(user_id),
            MCPServer.is_enabled == True,
        )
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def _get_user_skill(self, skill_id: str) -> UserSkill | None:
        """Get a user skill by ID."""
        query = select(UserSkill).where(UserSkill.id == skill_id)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def _get_system_skill(self, skill_id: str) -> SystemSkill | None:
        """Get a system skill by ID."""
        query = select(SystemSkill).where(SystemSkill.id == skill_id)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def _get_mcp_server(self, mcp_id: str) -> MCPServer | None:
        """Get an MCP server by ID."""
        query = select(MCPServer).where(MCPServer.id == mcp_id)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def _find_existing_skill(self, user_id: UUID, slug: str) -> UserSkill | None:
        """Find an existing user skill by slug."""
        query = select(UserSkill).where(
            UserSkill.user_id == str(user_id),
            UserSkill.slug == slug,
        )
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def _find_existing_mcp(self, user_id: UUID, name: str) -> MCPServer | None:
        """Find an existing MCP by name."""
        # Normalize the name for comparison
        name_lower = name.lower().replace(" ", "-")
        query = select(MCPServer).where(MCPServer.user_id == str(user_id))
        result = await self.db.execute(query)
        mcps = result.scalars().all()

        for mcp in mcps:
            if mcp.name.lower().replace(" ", "-") == name_lower:
                return mcp

        return None

    async def _has_skill_conflict(
        self,
        user_id: UUID,
        existing: UserSkill,
        _parsed: dict[str, Any],
        cli_name: str,
    ) -> bool:
        """Check if there's a conflict between Podex and CLI versions."""
        # Get sync status
        query = select(CLISyncStatus).where(
            CLISyncStatus.user_id == str(user_id),
            CLISyncStatus.source_id == existing.id,
            CLISyncStatus.cli_agent == cli_name,
        )
        result = await self.db.execute(query)
        status = result.scalar_one_or_none()

        if not status:
            return False  # Not previously synced, no conflict

        # Compare versions
        return status.podex_version > 0 and status.cli_version > 0

    async def _has_mcp_conflict(
        self,
        user_id: UUID,
        existing: MCPServer,
        _parsed: dict[str, Any],
        cli_name: str,
    ) -> bool:
        """Check if there's a conflict between Podex and CLI versions."""
        query = select(CLISyncStatus).where(
            CLISyncStatus.user_id == str(user_id),
            CLISyncStatus.source_id == existing.id,
            CLISyncStatus.cli_agent == cli_name,
        )
        result = await self.db.execute(query)
        status = result.scalar_one_or_none()

        if not status:
            return False

        return status.podex_version > 0 and status.cli_version > 0

    async def _create_skill_from_cli(
        self,
        user_id: UUID,
        parsed: dict[str, Any],
        _cli_name: str,
    ) -> UserSkill:
        """Create a new user skill from CLI config."""
        skill = UserSkill(
            id=str(uuid4()),
            user_id=str(user_id),
            name=parsed["name"],
            slug=parsed["slug"],
            description=parsed.get("description", ""),
            version="1.0.0",
            triggers=parsed.get("triggers", []),
            tags=parsed.get("tags", []),
            required_tools=parsed.get("required_tools", []),
            steps=parsed.get("steps", []),
            system_prompt=parsed.get("system_prompt"),
        )
        self.db.add(skill)
        return skill

    async def _create_mcp_from_cli(
        self,
        user_id: UUID,
        parsed: dict[str, Any],
        _cli_name: str,
    ) -> MCPServer:
        """Create a new MCP server from CLI config."""
        mcp = MCPServer(
            id=str(uuid4()),
            user_id=str(user_id),
            name=parsed["name"],
            transport=parsed.get("transport", "stdio"),
            command=parsed.get("command"),
            args=parsed.get("args", []),
            url=parsed.get("url"),
            env_vars=parsed.get("env_vars", {}),
            is_enabled=True,
        )
        self.db.add(mcp)
        return mcp

    async def _update_skill_from_cli(
        self,
        existing: UserSkill,
        parsed: dict[str, Any],
    ) -> None:
        """Update an existing skill from CLI config."""
        existing.name = parsed["name"]
        existing.description = parsed.get("description", "")
        existing.triggers = parsed.get("triggers", [])
        existing.tags = parsed.get("tags", [])
        existing.required_tools = parsed.get("required_tools", [])
        existing.steps = parsed.get("steps", [])
        existing.system_prompt = parsed.get("system_prompt")

    async def _update_mcp_from_cli(
        self,
        existing: MCPServer,
        parsed: dict[str, Any],
    ) -> None:
        """Update an existing MCP from CLI config."""
        existing.transport = parsed.get("transport", "stdio")
        existing.command = parsed.get("command")
        existing.args = parsed.get("args", [])
        existing.url = parsed.get("url")
        existing.env_vars = parsed.get("env_vars", {})

    async def _create_skill_conflict(
        self,
        user_id: UUID,
        existing: UserSkill,
        parsed: dict[str, Any],
        cli_name: str,
    ) -> CLISyncConflict:
        """Create a conflict record for manual resolution."""
        # Get sync status
        query = select(CLISyncStatus).where(
            CLISyncStatus.user_id == str(user_id),
            CLISyncStatus.source_id == existing.id,
            CLISyncStatus.cli_agent == cli_name,
        )
        result = await self.db.execute(query)
        status = result.scalar_one_or_none()

        conflict = CLISyncConflict(
            id=str(uuid4()),
            user_id=str(user_id),
            sync_status_id=status.id if status else str(uuid4()),
            conflict_type="content_mismatch",
            podex_version=self._skill_to_dict(existing),
            cli_version=parsed,
        )
        self.db.add(conflict)
        return conflict

    # Conversion helpers

    def _skill_to_dict(self, skill: UserSkill | SystemSkill) -> dict[str, Any]:
        """Convert a skill model to dictionary."""
        return {
            "id": skill.id,
            "name": skill.name,
            "slug": skill.slug,
            "description": skill.description,
            "version": skill.version,
            "triggers": skill.triggers or [],
            "tags": skill.tags or [],
            "required_tools": skill.required_tools or [],
            "steps": skill.steps or [],
            "system_prompt": skill.system_prompt,
        }

    def _system_skill_to_dict(self, skill: SystemSkill) -> dict[str, Any]:
        """Convert a system skill to dictionary."""
        return self._skill_to_dict(skill)

    def _mcp_to_dict(self, mcp: MCPServer) -> dict[str, Any]:
        """Convert an MCP model to dictionary."""
        return {
            "id": mcp.id,
            "name": mcp.name,
            "description": mcp.description,
            "transport": mcp.transport,
            "command": mcp.command,
            "args": mcp.args or [],
            "url": mcp.url,
            "env_vars": mcp.env_vars or {},
        }

    def _default_sync_preferences(self) -> dict[str, Any]:
        """Return default CLI sync preferences."""
        return {
            "claude_code": {"auto_sync": True, "sync_skills": True, "sync_mcp": True},
            "codex": {"auto_sync": True, "sync_skills": True, "sync_mcp": True},
            "gemini_cli": {"auto_sync": True, "sync_skills": True, "sync_mcp": False},
            "conflict_resolution": "manual",
        }
