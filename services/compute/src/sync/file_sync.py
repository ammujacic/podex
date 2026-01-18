"""File synchronization between GCS and workspace containers.

Handles bidirectional sync of workspace files:
- Startup: GCS → Container (restore workspace state)
- Runtime: Container → GCS (periodic backup)
- Shutdown: Container → GCS (final backup before destruction)
"""

import asyncio
import base64
import contextlib
import json
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import TYPE_CHECKING, Any

import structlog
from google.cloud import storage  # type: ignore[import-untyped,attr-defined]
from google.cloud.exceptions import NotFound  # type: ignore[import-untyped]

from src.config import settings

if TYPE_CHECKING:
    from src.managers.base import ComputeManager

logger = structlog.get_logger()


class FileSync:
    """Synchronizes workspace files between GCS and containers.

    The sync strategy:
    1. GCS is the source of truth for workspace files
    2. On workspace startup, files are restored from GCS
    3. During runtime, changes are periodically synced to GCS
    4. On workspace stop/destroy, final sync ensures no data loss
    """

    def __init__(
        self,
        compute_manager: "ComputeManager",
        bucket: str | None = None,
        prefix: str | None = None,
    ) -> None:
        """Initialize FileSync.

        Args:
            compute_manager: The compute manager for container operations
            bucket: GCS bucket name (defaults to settings)
            prefix: GCS key prefix (defaults to settings)
        """
        self.compute = compute_manager
        self.bucket_name = bucket or settings.gcs_bucket
        self.prefix = prefix or settings.gcs_prefix
        self._client = storage.Client(project=settings.gcp_project_id)
        self._bucket = self._client.bucket(self.bucket_name)
        self._sync_tasks: dict[str, asyncio.Task[None]] = {}

    def _get_gcs_prefix(self, workspace_id: str) -> str:
        """Get the GCS prefix for a workspace."""
        return f"{self.prefix}/{workspace_id}"

    async def sync_from_gcs(
        self,
        workspace_id: str,
        target_path: str = "/home/project",
    ) -> dict[str, Any]:
        """Sync files from GCS to the workspace container.

        Called on workspace startup to restore files.

        Args:
            workspace_id: The workspace to sync to
            target_path: Container path to sync files to

        Returns:
            Sync result with file count and status
        """
        logger.info(
            "Syncing files from GCS to container",
            workspace_id=workspace_id,
            bucket=self.bucket_name,
            target_path=target_path,
        )

        prefix = self._get_gcs_prefix(workspace_id)
        files_synced = 0
        errors = []

        try:
            # List all files in the workspace prefix
            blobs = self._client.list_blobs(self._bucket, prefix=f"{prefix}/")

            for blob in blobs:
                key = blob.name
                # Get relative path (remove prefix)
                relative_path = key[len(prefix) + 1 :]  # +1 for trailing slash
                if not relative_path:
                    continue

                container_path = f"{target_path}/{relative_path}"

                try:
                    # Download file content
                    content = blob.download_as_bytes()

                    # Create directory and write file in container
                    dir_path = str(PurePosixPath(container_path).parent)
                    await self.compute.exec_command(
                        workspace_id,
                        f"mkdir -p {dir_path}",
                    )

                    # Write file using base64 to handle binary content
                    encoded = base64.b64encode(content).decode("ascii")
                    await self.compute.exec_command(
                        workspace_id,
                        f"echo '{encoded}' | base64 -d > {container_path}",
                    )

                    files_synced += 1
                    logger.debug(
                        "Synced file from GCS",
                        workspace_id=workspace_id,
                        path=relative_path,
                    )
                except Exception as e:
                    errors.append({"path": relative_path, "error": str(e)})
                    logger.warning(
                        "Failed to sync file from GCS",
                        workspace_id=workspace_id,
                        path=relative_path,
                        error=str(e),
                    )

        except NotFound:
            logger.warning("GCS bucket does not exist", bucket=self.bucket_name)

        logger.info(
            "Completed GCS to container sync",
            workspace_id=workspace_id,
            files_synced=files_synced,
            errors=len(errors),
        )

        return {
            "workspace_id": workspace_id,
            "direction": "gcs_to_container",
            "files_synced": files_synced,
            "errors": errors,
            "timestamp": datetime.now(UTC).isoformat(),
        }

    async def sync_to_gcs(
        self,
        workspace_id: str,
        source_path: str = "/home/project",
        exclude_patterns: list[str] | None = None,
    ) -> dict[str, Any]:
        """Sync files from the workspace container to GCS.

        Called periodically and on shutdown to backup files.

        Args:
            workspace_id: The workspace to sync from
            source_path: Container path to sync files from
            exclude_patterns: Glob patterns to exclude (e.g., node_modules)

        Returns:
            Sync result with file count and status
        """
        if exclude_patterns is None:
            exclude_patterns = [
                "node_modules",
                ".git",
                "__pycache__",
                ".venv",
                "venv",
                ".next",
                "dist",
                "build",
                ".cache",
            ]

        logger.info(
            "Syncing files from container to GCS",
            workspace_id=workspace_id,
            bucket=self.bucket_name,
            source_path=source_path,
        )

        prefix = self._get_gcs_prefix(workspace_id)
        files_synced = 0
        errors = []

        # Build exclude args for find command
        exclude_args = " ".join([f"-name '{p}' -prune -o" for p in exclude_patterns])

        # Get list of files to sync (exclude common large directories)
        find_cmd = f"find {source_path} {exclude_args} -type f -print"
        result = await self.compute.exec_command(workspace_id, find_cmd)

        if result.exit_code != 0:
            logger.warning(
                "Failed to list files in container",
                workspace_id=workspace_id,
                error=result.stderr,
            )
            return {
                "workspace_id": workspace_id,
                "direction": "container_to_gcs",
                "files_synced": 0,
                "errors": [{"error": result.stderr}],
                "timestamp": datetime.now(UTC).isoformat(),
            }

        files = [f.strip() for f in result.stdout.strip().split("\n") if f.strip()]

        for file_path in files:
            # Get relative path
            if file_path.startswith(source_path):
                relative_path = file_path[len(source_path) + 1 :]
            else:
                relative_path = file_path

            if not relative_path:
                continue

            gcs_key = f"{prefix}/{relative_path}"

            try:
                # Read file content (base64 encoded to handle binary)
                read_result = await self.compute.exec_command(
                    workspace_id,
                    f"base64 {file_path}",
                )

                if read_result.exit_code != 0:
                    errors.append({"path": relative_path, "error": read_result.stderr})
                    continue

                content = base64.b64decode(read_result.stdout.strip())

                # Upload to GCS
                blob = self._bucket.blob(gcs_key)
                blob.upload_from_string(content)

                files_synced += 1
                logger.debug(
                    "Synced file to GCS",
                    workspace_id=workspace_id,
                    path=relative_path,
                )

            except Exception as e:
                errors.append({"path": relative_path, "error": str(e)})
                logger.warning(
                    "Failed to sync file to GCS",
                    workspace_id=workspace_id,
                    path=relative_path,
                    error=str(e),
                )

        logger.info(
            "Completed container to GCS sync",
            workspace_id=workspace_id,
            files_synced=files_synced,
            errors=len(errors),
        )

        return {
            "workspace_id": workspace_id,
            "direction": "container_to_gcs",
            "files_synced": files_synced,
            "errors": errors,
            "timestamp": datetime.now(UTC).isoformat(),
        }

    async def start_background_sync(
        self,
        workspace_id: str,
        interval: int | None = None,
    ) -> None:
        """Start periodic background sync for a workspace.

        Args:
            workspace_id: The workspace to sync
            interval: Sync interval in seconds (defaults to settings)
        """
        if workspace_id in self._sync_tasks:
            logger.warning(
                "Background sync already running",
                workspace_id=workspace_id,
            )
            return

        sync_interval = interval or settings.gcs_sync_interval

        async def sync_loop() -> None:
            while True:
                try:
                    await asyncio.sleep(sync_interval)
                    await self.sync_to_gcs(workspace_id)
                except asyncio.CancelledError:
                    # Final sync before stopping
                    logger.info("Background sync cancelled, performing final sync")
                    await self.sync_to_gcs(workspace_id)
                    raise
                except Exception:
                    logger.exception(
                        "Background sync failed",
                        workspace_id=workspace_id,
                    )

        task = asyncio.create_task(sync_loop())
        self._sync_tasks[workspace_id] = task

        logger.info(
            "Started background sync",
            workspace_id=workspace_id,
            interval=sync_interval,
        )

    async def stop_background_sync(self, workspace_id: str) -> None:
        """Stop background sync for a workspace.

        Performs a final sync before stopping.

        Args:
            workspace_id: The workspace to stop syncing
        """
        task = self._sync_tasks.pop(workspace_id, None)
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

            logger.info("Stopped background sync", workspace_id=workspace_id)

    async def delete_workspace_files(self, workspace_id: str) -> dict[str, Any]:
        """Delete all GCS files for a workspace.

        Called when a workspace is permanently deleted.

        Args:
            workspace_id: The workspace to delete files for

        Returns:
            Deletion result with file count
        """
        prefix = self._get_gcs_prefix(workspace_id)
        deleted_count = 0

        try:
            blobs = list(self._client.list_blobs(self._bucket, prefix=f"{prefix}/"))
            for blob in blobs:
                blob.delete()
                deleted_count += 1

        except NotFound:
            pass

        logger.info(
            "Deleted workspace files from GCS",
            workspace_id=workspace_id,
            files_deleted=deleted_count,
        )

        return {
            "workspace_id": workspace_id,
            "files_deleted": deleted_count,
        }

    async def get_workspace_size(self, workspace_id: str) -> dict[str, Any]:
        """Get the total size of a workspace in GCS.

        Args:
            workspace_id: The workspace to check

        Returns:
            Size information
        """
        prefix = self._get_gcs_prefix(workspace_id)
        total_size = 0
        file_count = 0

        try:
            blobs = self._client.list_blobs(self._bucket, prefix=f"{prefix}/")
            for blob in blobs:
                total_size += blob.size or 0
                file_count += 1
        except NotFound:
            pass

        return {
            "workspace_id": workspace_id,
            "total_bytes": total_size,
            "total_mb": round(total_size / (1024 * 1024), 2),
            "file_count": file_count,
        }

    # ============== User Dotfiles Sync ==============

    def _get_user_dotfiles_prefix(self, user_id: str) -> str:
        """Get the GCS prefix for a user's dotfiles."""
        return f"users/{user_id}/dotfiles"

    async def sync_user_dotfiles(
        self,
        workspace_id: str,
        user_id: str,
        target_path: str = "/home/dev",
    ) -> dict[str, Any]:
        """Sync user's dotfiles from GCS to the pod.

        Called on pod startup to restore user's shell configs, git settings, etc.

        Args:
            workspace_id: The workspace/pod to sync to
            user_id: The user whose dotfiles to sync
            target_path: Container path to sync files to (usually /home/dev)

        Returns:
            Sync result with file count and status
        """
        logger.info(
            "Syncing user dotfiles from GCS to pod",
            workspace_id=workspace_id,
            user_id=user_id,
            target_path=target_path,
        )

        prefix = self._get_user_dotfiles_prefix(user_id)
        files_synced = 0
        errors = []

        try:
            blobs = self._client.list_blobs(self._bucket, prefix=f"{prefix}/")

            for blob in blobs:
                key = blob.name
                # Get relative path (remove prefix)
                relative_path = key[len(prefix) + 1 :]
                if not relative_path:
                    continue

                container_path = f"{target_path}/{relative_path}"

                try:
                    # Download file content
                    content = blob.download_as_bytes()

                    # Create directory and write file in container
                    dir_path = str(PurePosixPath(container_path).parent)
                    await self.compute.exec_command(
                        workspace_id,
                        f"mkdir -p {dir_path}",
                    )

                    # Write file using base64 to handle binary content
                    encoded = base64.b64encode(content).decode("ascii")
                    await self.compute.exec_command(
                        workspace_id,
                        f"echo '{encoded}' | base64 -d > {container_path}",
                    )

                    # Set proper permissions for dotfiles
                    if relative_path.startswith(".ssh"):
                        await self.compute.exec_command(
                            workspace_id,
                            f"chmod 600 {container_path}",
                        )

                    files_synced += 1
                    logger.debug(
                        "Synced user dotfile",
                        user_id=user_id,
                        path=relative_path,
                    )
                except Exception as e:
                    errors.append({"path": relative_path, "error": str(e)})
                    logger.warning(
                        "Failed to sync user dotfile",
                        user_id=user_id,
                        path=relative_path,
                        error=str(e),
                    )

        except NotFound:
            logger.warning("GCS bucket does not exist", bucket=self.bucket_name)

        # Also set up git config if we have the values
        await self._setup_git_config(workspace_id, user_id)

        logger.info(
            "Completed user dotfiles sync",
            user_id=user_id,
            workspace_id=workspace_id,
            files_synced=files_synced,
            errors=len(errors),
        )

        return {
            "user_id": user_id,
            "workspace_id": workspace_id,
            "files_synced": files_synced,
            "errors": errors,
            "timestamp": datetime.now(UTC).isoformat(),
        }

    async def _setup_git_config(self, workspace_id: str, user_id: str) -> None:
        """Set up git config in the pod from user settings.

        This reads from a special metadata file in GCS rather than .gitconfig.
        """
        try:
            # Try to read git config from GCS metadata
            blob = self._bucket.blob(f"users/{user_id}/config/git.json")
            try:
                config_data = json.loads(blob.download_as_text())

                if config_data.get("name"):
                    await self.compute.exec_command(
                        workspace_id,
                        f'git config --global user.name "{config_data["name"]}"',
                    )
                if config_data.get("email"):
                    await self.compute.exec_command(
                        workspace_id,
                        f'git config --global user.email "{config_data["email"]}"',
                    )
            except NotFound:
                # No git config stored, that's fine
                pass
        except Exception:
            logger.warning("Failed to set up git config", user_id=user_id)

    async def save_user_dotfiles(
        self,
        workspace_id: str,
        user_id: str,
        source_path: str = "/home/dev",
        dotfiles_paths: list[str] | None = None,
    ) -> dict[str, Any]:
        """Sync user's dotfiles from pod to GCS.

        Called periodically or on pod shutdown to preserve user configs.

        Args:
            workspace_id: The workspace/pod to sync from
            user_id: The user whose dotfiles to save
            source_path: Container path to sync from
            dotfiles_paths: Specific files to sync (defaults to common dotfiles)

        Returns:
            Sync result with file count
        """
        if dotfiles_paths is None:
            dotfiles_paths = [
                ".bashrc",
                ".zshrc",
                ".profile",
                ".gitconfig",
                ".npmrc",
                ".vimrc",
                ".config/starship.toml",
                ".ssh/config",
            ]

        logger.info(
            "Saving user dotfiles from pod to GCS",
            workspace_id=workspace_id,
            user_id=user_id,
            files_count=len(dotfiles_paths),
        )

        prefix = self._get_user_dotfiles_prefix(user_id)
        files_saved = 0
        errors = []

        for dotfile in dotfiles_paths:
            container_path = f"{source_path}/{dotfile}"

            try:
                # Check if file exists
                check_result = await self.compute.exec_command(
                    workspace_id,
                    f"test -f {container_path} && echo 'exists'",
                )

                if "exists" not in check_result.stdout:
                    continue

                # Read file content (base64 encoded)
                read_result = await self.compute.exec_command(
                    workspace_id,
                    f"base64 {container_path}",
                )

                if read_result.exit_code != 0:
                    continue

                content = base64.b64decode(read_result.stdout.strip())

                # Upload to GCS
                gcs_key = f"{prefix}/{dotfile}"
                blob = self._bucket.blob(gcs_key)
                blob.upload_from_string(content)

                files_saved += 1
                logger.debug(
                    "Saved user dotfile to GCS",
                    user_id=user_id,
                    path=dotfile,
                )

            except Exception as e:
                errors.append({"path": dotfile, "error": str(e)})

        logger.info(
            "Completed saving user dotfiles",
            user_id=user_id,
            files_saved=files_saved,
            errors=len(errors),
        )

        return {
            "user_id": user_id,
            "workspace_id": workspace_id,
            "files_saved": files_saved,
            "errors": errors,
            "timestamp": datetime.now(UTC).isoformat(),
        }

    async def apply_pod_template(
        self,
        workspace_id: str,
        template: dict[str, Any],
    ) -> dict[str, Any]:
        """Apply a pod template's pre-install commands.

        Called on pod startup after syncing workspace files.

        Args:
            workspace_id: The workspace/pod to configure
            template: Template configuration dict with pre_install_commands, etc.

        Returns:
            Result with commands executed
        """
        logger.info(
            "Applying pod template",
            workspace_id=workspace_id,
            template_name=template.get("name", "unknown"),
        )

        commands_run = 0
        errors = []

        # Set environment variables
        env_vars = template.get("environment_variables", {})
        for key, value in env_vars.items():
            try:
                await self.compute.exec_command(
                    workspace_id,
                    f"echo 'export {key}=\"{value}\"' >> ~/.bashrc",
                )
                await self.compute.exec_command(
                    workspace_id,
                    f"echo 'export {key}=\"{value}\"' >> ~/.zshrc",
                )
            except Exception as e:
                errors.append({"type": "env_var", "key": key, "error": str(e)})

        # Run pre-install commands
        pre_install = template.get("pre_install_commands", [])
        for cmd in pre_install:
            try:
                result = await self.compute.exec_command(
                    workspace_id,
                    cmd,
                    timeout=300,  # 5 min timeout for installs
                )
                if result.exit_code != 0:
                    errors.append(
                        {
                            "type": "command",
                            "command": cmd,
                            "error": result.stderr,
                        }
                    )
                else:
                    commands_run += 1
            except Exception as e:
                errors.append({"type": "command", "command": cmd, "error": str(e)})

        logger.info(
            "Pod template applied",
            workspace_id=workspace_id,
            commands_run=commands_run,
            errors=len(errors),
        )

        return {
            "workspace_id": workspace_id,
            "template_name": template.get("name"),
            "commands_run": commands_run,
            "errors": errors,
            "timestamp": datetime.now(UTC).isoformat(),
        }
