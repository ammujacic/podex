"""
Dotfiles sync service - syncs user configuration files between GCS and workspaces.

This service is used by Claude Code to persist authentication credentials
across workspace sessions. When a user authenticates with Claude Code,
the ~/.claude/ directory is synced to GCS. On subsequent workspace startups,
the credentials are synced back to the container.

This allows users to authenticate once and have their credentials available
in all their workspaces without needing to re-authenticate.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

import structlog

from podex_shared.gcp.storage import GCSClient

if TYPE_CHECKING:
    from uuid import UUID

logger = structlog.get_logger()


class DotfilesSync:
    """
    Syncs user dotfiles including ~/.claude/ between GCS and workspace containers.

    Uses GCS as persistent storage with the following structure:
        gs://bucket/dotfiles/{user_id}/.claude/credentials.json
        gs://bucket/dotfiles/{user_id}/.claude/settings.json
        gs://bucket/dotfiles/{user_id}/.zshrc
        ...
    """

    def __init__(
        self,
        gcs_bucket: str,
        project_id: str | None = None,
        endpoint_url: str | None = None,
    ) -> None:
        """
        Initialize the dotfiles sync service.

        Args:
            gcs_bucket: GCS bucket name for storing dotfiles
            project_id: GCP project ID (uses default if not specified)
            endpoint_url: Optional custom endpoint (for GCS emulator in dev)
        """
        self._gcs = GCSClient(
            bucket=gcs_bucket,
            prefix="dotfiles",
            project_id=project_id,
            endpoint_url=endpoint_url,
        )

    def _get_user_prefix(self, user_id: UUID) -> str:
        """Get the key prefix for a user's dotfiles (relative to base prefix)."""
        return str(user_id)

    async def sync_to_workspace(
        self,
        user_id: UUID,
        workspace_path: str,
        paths: list[str] | None = None,
    ) -> int:
        """
        Sync dotfiles from GCS to a workspace directory.

        Args:
            user_id: The user whose dotfiles to sync
            workspace_path: Path to the workspace directory
            paths: Optional list of relative paths to sync (e.g., [".claude/"])
                   If None, syncs all dotfiles for the user.

        Returns:
            Number of files synced
        """
        user_prefix = self._get_user_prefix(user_id)
        files_synced = 0

        try:
            # List all objects under the user's prefix
            objects = await self._gcs.list_all_objects(user_prefix)

            for obj in objects:
                key = obj["Key"]
                # Extract relative path (remove base prefix and user prefix)
                # Key format: dotfiles/{user_id}/{relative_path}
                parts = key.split("/", 2)  # Split into [prefix, user_id, relative_path]
                if len(parts) < 3:
                    continue
                relative_path = parts[2]

                # Filter by paths if specified
                if paths and not any(relative_path.startswith(p.lstrip("/")) for p in paths):
                    continue

                # Download the file
                content = await self._gcs.get_object(f"{user_prefix}/{relative_path}")

                # Write to workspace
                target_path = Path(workspace_path) / relative_path
                target_path.parent.mkdir(parents=True, exist_ok=True)
                target_path.write_bytes(content)

                logger.debug(
                    "Synced file to workspace",
                    user_id=str(user_id),
                    file=relative_path,
                )
                files_synced += 1

        except Exception as e:
            logger.exception(
                "Failed to sync dotfiles to workspace",
                user_id=str(user_id),
                error=str(e),
            )
            raise

        logger.info(
            "Synced dotfiles to workspace",
            user_id=str(user_id),
            files_synced=files_synced,
        )
        return files_synced

    async def sync_from_workspace(
        self,
        user_id: UUID,
        workspace_path: str,
        paths: list[str],
    ) -> int:
        """
        Sync dotfiles from a workspace directory to GCS.

        Args:
            user_id: The user whose dotfiles to sync
            workspace_path: Path to the workspace directory
            paths: List of relative paths to sync (e.g., [".claude/"])

        Returns:
            Number of files synced
        """
        user_prefix = self._get_user_prefix(user_id)
        files_synced = 0

        try:
            for path in paths:
                source_path = Path(workspace_path) / path.lstrip("/")

                if not source_path.exists():
                    logger.debug(
                        "Path does not exist in workspace",
                        user_id=str(user_id),
                        path=path,
                    )
                    continue

                # Find all files under this path
                if source_path.is_file():
                    files_to_sync = [source_path]
                else:
                    files_to_sync = list(source_path.rglob("*"))
                    files_to_sync = [f for f in files_to_sync if f.is_file()]

                for file_path in files_to_sync:
                    # Calculate relative path from workspace
                    relative_path = file_path.relative_to(Path(workspace_path))
                    gcs_key = f"{user_prefix}/{relative_path}"

                    # Read file content
                    content = file_path.read_bytes()

                    # Upload to GCS
                    await self._gcs.put_object(gcs_key, content)

                    logger.debug(
                        "Synced file to GCS",
                        user_id=str(user_id),
                        file=str(relative_path),
                    )
                    files_synced += 1

        except Exception as e:
            logger.exception(
                "Failed to sync dotfiles from workspace",
                user_id=str(user_id),
                error=str(e),
            )
            raise

        logger.info(
            "Synced dotfiles from workspace to GCS",
            user_id=str(user_id),
            files_synced=files_synced,
        )
        return files_synced

    async def delete_user_dotfiles(self, user_id: UUID) -> int:
        """
        Delete all dotfiles for a user from GCS.

        Args:
            user_id: The user whose dotfiles to delete

        Returns:
            Number of files deleted
        """
        user_prefix = self._get_user_prefix(user_id)

        try:
            files_deleted: int = await self._gcs.delete_prefix(user_prefix)

        except Exception as e:
            logger.exception(
                "Failed to delete user dotfiles",
                user_id=str(user_id),
                error=str(e),
            )
            raise

        logger.info(
            "Deleted user dotfiles",
            user_id=str(user_id),
            files_deleted=files_deleted,
        )
        return files_deleted

    async def list_user_dotfiles(self, user_id: UUID) -> list[str]:
        """
        List all dotfiles for a user.

        Args:
            user_id: The user whose dotfiles to list

        Returns:
            List of relative file paths
        """
        user_prefix = self._get_user_prefix(user_id)
        files = []

        try:
            objects = await self._gcs.list_all_objects(user_prefix)

            for obj in objects:
                key = obj["Key"]
                # Extract relative path (remove base prefix and user prefix)
                # Key format: dotfiles/{user_id}/{relative_path}
                parts = key.split("/", 2)
                if len(parts) >= 3:
                    files.append(parts[2])

        except Exception as e:
            logger.exception(
                "Failed to list user dotfiles",
                user_id=str(user_id),
                error=str(e),
            )
            raise

        return files

    # CLI Sync Methods

    async def sync_cli_configs_to_workspace(
        self,
        user_id: UUID,
        workspace_path: str,
        cli_agents: list[str] | None = None,
    ) -> int:
        """
        Sync CLI config files from GCS to workspace.

        This ensures the workspace has the latest CLI configs including:
        - ~/.claude/config.json (MCPs)
        - ~/.claude/commands/ (custom commands)
        - ~/.codex/config.toml
        - ~/.gemini/settings.json
        - ~/.gemini/skills/

        Args:
            user_id: User ID
            workspace_path: Path to workspace directory
            cli_agents: List of CLI agents to sync. If None, sync all.

        Returns:
            Number of files synced
        """
        cli_paths = []

        if cli_agents is None or "claude_code" in cli_agents:
            cli_paths.extend([".claude/config.json", ".claude/commands/"])

        if cli_agents is None or "codex" in cli_agents:
            cli_paths.append(".codex/")

        if cli_agents is None or "gemini_cli" in cli_agents:
            cli_paths.extend([".gemini/settings.json", ".gemini/skills/"])

        return await self.sync_to_workspace(
            user_id=user_id,
            workspace_path=workspace_path,
            paths=cli_paths,
        )

    async def sync_cli_configs_from_workspace(
        self,
        user_id: UUID,
        workspace_path: str,
        cli_agents: list[str] | None = None,
    ) -> int:
        """
        Sync CLI config files from workspace back to GCS.

        Called when workspace detects CLI config changes for bidirectional sync.

        Args:
            user_id: User ID
            workspace_path: Path to workspace directory
            cli_agents: List of CLI agents to sync. If None, sync all.

        Returns:
            Number of files synced
        """
        cli_paths = []

        if cli_agents is None or "claude_code" in cli_agents:
            cli_paths.extend([".claude/config.json", ".claude/commands/"])

        if cli_agents is None or "codex" in cli_agents:
            cli_paths.append(".codex/")

        if cli_agents is None or "gemini_cli" in cli_agents:
            cli_paths.extend([".gemini/settings.json", ".gemini/skills/"])

        return await self.sync_from_workspace(
            user_id=user_id,
            workspace_path=workspace_path,
            paths=cli_paths,
        )
