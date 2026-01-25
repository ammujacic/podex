"""Native execution manager for workspace management.

Manages workspaces running directly on the host without Docker containers.
"""

import asyncio
import json
import os
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import structlog

from .config import LocalPodConfig
from .security import PathSecurityError, PathValidator

logger = structlog.get_logger()

WORKSPACE_META_FILE = ".podex-meta.json"


def _generate_workspace_id() -> str:
    """Generate a unique workspace ID."""
    return f"ws_{uuid4().hex[:12]}"


class NativeManager:
    """Manages workspaces running natively on the host."""

    def __init__(self, config: LocalPodConfig) -> None:
        """Initialize the manager.

        Args:
            config: Pod configuration.
        """
        self.config = config
        self._workspaces: dict[str, dict[str, Any]] = {}

        # Create path validator from config
        # Include workspace_dir as always-allowed (for default workspace creation)
        self._validator = PathValidator(
            mounts=config.get_mounts_as_dicts(),
            security=config.native.security,
            workspace_dir=config.native.workspace_dir,
        )

    @property
    def workspaces(self) -> dict[str, dict[str, Any]]:
        """Get current workspaces."""
        return self._workspaces

    async def initialize(self) -> None:
        """Initialize the native manager."""
        logger.info(
            "Initializing native manager",
            workspace_dir=self.config.native.workspace_dir,
            security=self.config.native.security,
        )

        # Ensure workspace directory exists
        workspace_dir = Path(self.config.native.workspace_dir)
        workspace_dir.mkdir(parents=True, exist_ok=True)

        # Recover existing workspaces
        await self._recover_workspaces()

    async def _recover_workspaces(self) -> None:
        """Recover workspace state from disk."""
        workspace_dir = Path(self.config.native.workspace_dir)

        for entry in workspace_dir.iterdir():
            if not entry.is_dir():
                continue

            meta_file = entry / WORKSPACE_META_FILE
            if not meta_file.exists():
                continue

            try:
                with open(meta_file) as f:
                    meta = json.load(f)

                workspace_id = meta.get("id")
                if workspace_id:
                    self._workspaces[workspace_id] = {
                        **meta,
                        "status": "running",
                        "working_dir": str(entry),
                    }
                    logger.info("Recovered workspace", workspace_id=workspace_id)
            except Exception as e:
                logger.warning("Failed to recover workspace", path=str(entry), error=str(e))

    async def create_workspace(
        self,
        workspace_id: str | None,
        user_id: str,
        session_id: str,
        config: dict[str, Any],
    ) -> dict[str, Any]:
        """Create a new native workspace.

        Args:
            workspace_id: Optional workspace ID (generated if not provided).
            user_id: Owner user ID.
            session_id: Session ID.
            config: Workspace configuration.

        Returns:
            Workspace info dict.
        """
        # Check workspace limit
        if len(self._workspaces) >= self.config.max_workspaces:
            raise RuntimeError(f"Maximum workspace limit ({self.config.max_workspaces}) reached")

        workspace_id = workspace_id or _generate_workspace_id()

        logger.info(
            "Creating native workspace",
            workspace_id=workspace_id,
            user_id=user_id,
            session_id=session_id,
        )

        # Determine working directory
        mount_path = config.get("mount_path")
        if mount_path:
            # User selected a specific mount path
            try:
                working_dir = self._validator.validate_path(mount_path, require_write=True)
            except PathSecurityError as e:
                raise RuntimeError(f"Mount path not allowed: {e}") from e
        else:
            # Create workspace in default workspace directory
            working_dir = str(Path(self.config.native.workspace_dir) / workspace_id)
            Path(working_dir).mkdir(parents=True, exist_ok=True)

        # Create metadata
        workspace_info = {
            "id": workspace_id,
            "user_id": user_id,
            "session_id": session_id,
            "status": "running",
            "tier": config.get("tier", "starter"),
            "working_dir": working_dir,
            "mount_path": mount_path,
            "created_at": datetime.now(UTC).isoformat(),
            "last_activity": datetime.now(UTC).isoformat(),
        }

        # Save metadata to workspace directory (only if we own the directory)
        if not mount_path:
            meta_file = Path(working_dir) / WORKSPACE_META_FILE
            with open(meta_file, "w") as f:
                json.dump(workspace_info, f, indent=2)

        self._workspaces[workspace_id] = workspace_info

        logger.info(
            "Native workspace created",
            workspace_id=workspace_id,
            working_dir=working_dir,
        )

        return workspace_info

    async def stop_workspace(self, workspace_id: str) -> None:
        """Stop a workspace (marks as stopped)."""
        workspace = self._workspaces.get(workspace_id)
        if not workspace:
            logger.warning("Workspace not found", workspace_id=workspace_id)
            return

        workspace["status"] = "stopped"
        logger.info("Workspace stopped", workspace_id=workspace_id)

    async def delete_workspace(
        self,
        workspace_id: str,
        preserve_files: bool = True,
    ) -> None:
        """Delete a workspace.

        Args:
            workspace_id: Workspace to delete.
            preserve_files: If True, keep workspace files.
        """
        workspace = self._workspaces.pop(workspace_id, None)
        if not workspace:
            return

        working_dir = workspace.get("working_dir")
        mount_path = workspace.get("mount_path")

        # Only delete files if:
        # 1. preserve_files is False
        # 2. This is NOT a mounted path (we don't own mounted paths)
        if not preserve_files and not mount_path and working_dir:
            try:
                shutil.rmtree(working_dir)
                logger.info("Workspace files deleted", workspace_id=workspace_id)
            except Exception as e:
                logger.warning(
                    "Failed to delete workspace files",
                    workspace_id=workspace_id,
                    error=str(e),
                )
        else:
            # Just remove the metadata file if we created one
            if not mount_path and working_dir:
                meta_file = Path(working_dir) / WORKSPACE_META_FILE
                if meta_file.exists():
                    meta_file.unlink()

        logger.info("Workspace deleted", workspace_id=workspace_id)

    async def get_workspace(self, workspace_id: str) -> dict[str, Any] | None:
        """Get workspace info."""
        return self._workspaces.get(workspace_id)

    async def list_workspaces(
        self,
        user_id: str | None = None,
        session_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """List workspaces, optionally filtered."""
        workspaces = list(self._workspaces.values())

        if user_id:
            workspaces = [w for w in workspaces if w.get("user_id") == user_id]
        if session_id:
            workspaces = [w for w in workspaces if w.get("session_id") == session_id]

        return workspaces

    async def heartbeat(self, workspace_id: str) -> None:
        """Update workspace activity timestamp."""
        if workspace_id in self._workspaces:
            self._workspaces[workspace_id]["last_activity"] = datetime.now(UTC).isoformat()

    async def exec_command(
        self,
        workspace_id: str,
        command: str,
        working_dir: str | None = None,
        timeout: int = 30,
    ) -> dict[str, Any]:
        """Execute a command in the workspace.

        Args:
            workspace_id: Workspace ID.
            command: Shell command to execute.
            working_dir: Optional working directory override.
            timeout: Command timeout in seconds.

        Returns:
            Dict with exit_code, stdout, stderr.
        """
        workspace = self._workspaces.get(workspace_id)
        if not workspace:
            raise ValueError(f"Workspace not found: {workspace_id}")

        # Determine working directory
        cwd: str = working_dir or workspace.get("working_dir") or "."

        # Validate working directory
        if not self._validator.is_unrestricted():
            try:
                cwd = self._validator.validate_working_dir(cwd)
                # Also validate command paths (best effort)
                self._validator.filter_command_paths(command)
            except PathSecurityError as e:
                return {
                    "exit_code": 1,
                    "stdout": "",
                    "stderr": f"Security error: {e}",
                }

        try:
            # Create subprocess
            process = await asyncio.create_subprocess_shell(
                command,
                cwd=cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env={**os.environ, "WORKSPACE_ID": workspace_id},
            )

            # Wait for completion with timeout
            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=timeout,
                )
            except TimeoutError:
                # Kill the process on timeout
                process.kill()
                await process.wait()
                return {
                    "exit_code": 124,
                    "stdout": "",
                    "stderr": f"Command timed out after {timeout} seconds",
                }

            # Update activity
            workspace["last_activity"] = datetime.now(UTC).isoformat()

            return {
                "exit_code": process.returncode or 0,
                "stdout": stdout.decode("utf-8", errors="replace"),
                "stderr": stderr.decode("utf-8", errors="replace"),
            }

        except Exception as e:
            logger.error("Error executing command", error=str(e))
            return {
                "exit_code": 1,
                "stdout": "",
                "stderr": str(e),
            }

    async def read_file(self, workspace_id: str, path: str) -> str:
        """Read a file from the workspace.

        Args:
            workspace_id: Workspace ID.
            path: File path (relative to workspace or absolute).

        Returns:
            File contents.
        """
        workspace = self._workspaces.get(workspace_id)
        if not workspace:
            raise ValueError(f"Workspace not found: {workspace_id}")

        # Resolve path relative to workspace
        working_dir = workspace.get("working_dir", ".")
        full_path = os.path.join(working_dir, path) if not os.path.isabs(path) else path

        # Validate path
        try:
            full_path = self._validator.validate_path(full_path)
        except PathSecurityError as e:
            raise ValueError(f"Access denied: {e}") from e

        # Read file
        with open(full_path) as f:
            return f.read()

    async def write_file(self, workspace_id: str, path: str, content: str) -> None:
        """Write a file to the workspace.

        Args:
            workspace_id: Workspace ID.
            path: File path (relative to workspace or absolute).
            content: File contents.
        """
        workspace = self._workspaces.get(workspace_id)
        if not workspace:
            raise ValueError(f"Workspace not found: {workspace_id}")

        # Resolve path relative to workspace
        working_dir = workspace.get("working_dir", ".")
        full_path = os.path.join(working_dir, path) if not os.path.isabs(path) else path

        # Validate path (requires write)
        try:
            full_path = self._validator.validate_path(full_path, require_write=True)
        except PathSecurityError as e:
            raise ValueError(f"Access denied: {e}") from e

        # Ensure parent directory exists
        Path(full_path).parent.mkdir(parents=True, exist_ok=True)

        # Write file
        with open(full_path, "w") as f:
            f.write(content)

    async def list_files(self, workspace_id: str, path: str = ".") -> list[dict[str, Any]]:
        """List files in a workspace directory.

        Args:
            workspace_id: Workspace ID.
            path: Directory path (relative to workspace or absolute).

        Returns:
            List of file info dicts.
        """
        workspace = self._workspaces.get(workspace_id)
        if not workspace:
            raise ValueError(f"Workspace not found: {workspace_id}")

        # Resolve path relative to workspace
        working_dir = workspace.get("working_dir", ".")
        full_path = os.path.join(working_dir, path) if not os.path.isabs(path) else path

        # Validate path
        try:
            full_path = self._validator.validate_path(full_path)
        except PathSecurityError as e:
            raise ValueError(f"Access denied: {e}") from e

        # List directory
        files = []
        dir_path = Path(full_path)

        if not dir_path.is_dir():
            raise ValueError(f"Not a directory: {path}")

        for entry in dir_path.iterdir():
            stat = entry.stat()
            files.append(
                {
                    "name": entry.name,
                    "type": "directory" if entry.is_dir() else "file",
                    "size": stat.st_size if entry.is_file() else 0,
                    "permissions": oct(stat.st_mode)[-3:],
                }
            )

        return sorted(files, key=lambda f: (f["type"] != "directory", f["name"]))

    async def get_active_ports(self, workspace_id: str) -> list[dict[str, Any]]:
        """Get listening ports (not really applicable for native mode).

        Returns empty list since we don't track ports per-workspace in native mode.
        """
        return []

    async def proxy_request(
        self,
        workspace_id: str,
        port: int,
        method: str,
        path: str,
        headers: dict[str, str],
        body: bytes | None,
        query_string: str | None,
    ) -> dict[str, Any]:
        """Proxy HTTP request to a service on localhost.

        In native mode, services run directly on the host, so we proxy to localhost.
        """
        import httpx

        workspace = self._workspaces.get(workspace_id)
        if not workspace:
            return {"status": 404, "body": b"Workspace not found", "headers": {}}

        url = f"http://localhost:{port}{path}"
        if query_string:
            url = f"{url}?{query_string}"

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.request(
                    method=method,
                    url=url,
                    headers=headers,
                    content=body,
                )
                return {
                    "status": response.status_code,
                    "body": response.content.hex(),
                    "headers": dict(response.headers),
                }
        except Exception as e:
            logger.warning("Proxy request failed", error=str(e), port=port, path=path)
            return {"status": 502, "body": str(e).encode().hex(), "headers": {}}

    async def terminal_write(self, workspace_id: str, data: str) -> None:
        """Write to terminal (not implemented for native mode).

        Native mode doesn't have persistent terminal sessions like Docker.
        Terminal interaction is handled via exec_command.
        """
        logger.debug("Terminal write (not implemented)", workspace_id=workspace_id)

    async def shutdown(self) -> None:
        """Gracefully shut down all workspaces."""
        logger.info("Shutting down native manager", workspaces=len(self._workspaces))

        for workspace_id in list(self._workspaces.keys()):
            try:
                await self.stop_workspace(workspace_id)
            except Exception as e:
                logger.warning("Error stopping workspace", workspace_id=workspace_id, error=str(e))

        self._workspaces.clear()
