"""Abstract base class for compute managers."""

from __future__ import annotations

import base64
import shlex
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

import structlog

from src.models.workspace import (
    WorkspaceConfig,
    WorkspaceExecResponse,
    WorkspaceInfo,
    WorkspaceScaleResponse,
    WorkspaceStatus,
)

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    from src.storage.workspace_store import WorkspaceStore

logger = structlog.get_logger()

# Constants for parsing command output
MIN_LS_PARTS = 9
MIN_SS_PARTS = 4
SS_LOCAL_ADDR_INDEX = 3
SS_ALT_LOCAL_ADDR_INDEX = 2
SS_PROCESS_INFO_MIN_PARTS = 6
MIN_SYSTEM_PORT = 1024
PROCESS_NAME_START_OFFSET = 3
MIN_PROCESS_NAME_START = 2


@dataclass
class ProxyRequest:
    """HTTP proxy request parameters."""

    workspace_id: str
    port: int
    method: str
    path: str
    headers: dict[str, str]
    body: bytes | None = None
    query_string: str | None = None


class ComputeManager(ABC):
    """Abstract compute manager interface.

    Implemented by:
    - DockerComputeManager: Docker-based workspace containers

    Subclasses must initialize:
    - self._workspace_store: WorkspaceStore | None

    Many methods have default implementations that rely on exec_command
    and the workspace store. Subclasses can override for custom behavior.
    """

    # Subclasses should initialize this
    _workspace_store: WorkspaceStore | None = None

    # --- Workspace Store Helpers (used by default implementations) ---

    async def _get_workspace(self, workspace_id: str) -> WorkspaceInfo | None:
        """Get workspace from Redis store.

        Always reads from Redis to ensure consistency across instances.
        No local caching - Redis is the single source of truth.
        """
        if self._workspace_store:
            return await self._workspace_store.get(workspace_id)
        return None

    async def _save_workspace(self, workspace: WorkspaceInfo) -> None:
        """Save workspace to Redis store."""
        if self._workspace_store:
            await self._workspace_store.save(workspace)

    async def _delete_workspace(self, workspace_id: str) -> None:
        """Delete workspace from Redis store."""
        if self._workspace_store:
            await self._workspace_store.delete(workspace_id)

    # --- Abstract Methods (must be implemented by subclasses) ---

    @abstractmethod
    async def create_workspace(
        self,
        user_id: str,
        session_id: str,
        config: WorkspaceConfig,
        workspace_id: str | None = None,
    ) -> WorkspaceInfo:
        """Create a new isolated workspace for a user.

        Args:
            user_id: The user ID who owns this workspace
            session_id: The session ID this workspace belongs to
            config: Workspace configuration (tier, repos, env)
            workspace_id: Optional workspace ID. If not provided, one is generated.

        Returns:
            WorkspaceInfo with workspace details
        """

    @abstractmethod
    async def stop_workspace(self, workspace_id: str) -> None:
        """Stop a running workspace.

        Args:
            workspace_id: The workspace ID to stop
        """

    @abstractmethod
    async def restart_workspace(self, workspace_id: str) -> None:
        """Restart a stopped workspace.

        Args:
            workspace_id: The workspace ID to restart
        """

    @abstractmethod
    async def delete_workspace(self, workspace_id: str, preserve_files: bool = True) -> None:
        """Delete a workspace and clean up resources.

        Args:
            workspace_id: The workspace ID to delete
            preserve_files: If True, keep files on disk. If False, delete workspace files.
        """

    @abstractmethod
    async def get_workspace(self, workspace_id: str) -> WorkspaceInfo | None:
        """Get workspace information.

        Args:
            workspace_id: The workspace ID to query

        Returns:
            WorkspaceInfo if found, None otherwise
        """

    @abstractmethod
    async def exec_command(
        self,
        workspace_id: str,
        command: str,
        working_dir: str | None = None,
        timeout: int = 30,
    ) -> WorkspaceExecResponse:
        """Execute a command in the workspace.

        Args:
            workspace_id: The workspace ID
            command: Shell command to execute
            working_dir: Working directory (default: /home/dev)
            timeout: Command timeout in seconds

        Returns:
            Command execution result
        """

    @abstractmethod
    async def check_workspace_health(self, workspace_id: str) -> bool:
        """Check if a workspace is healthy and can execute commands.

        Args:
            workspace_id: The workspace ID to check

        Returns:
            True if the workspace is healthy, False otherwise.
            Should update workspace status if unhealthy.
        """

    @abstractmethod
    async def get_preview_url(self, workspace_id: str, port: int) -> str | None:
        """Get the URL to access a dev server running in the workspace.

        Args:
            workspace_id: The workspace ID
            port: The port the dev server is listening on

        Returns:
            The URL to access the server, or None if not available
        """

    @abstractmethod
    async def proxy_request(
        self,
        request: ProxyRequest,
    ) -> tuple[int, dict[str, str], bytes]:
        """Proxy an HTTP request to a workspace container.

        Args:
            request: The proxy request parameters

        Returns:
            Tuple of (status_code, response_headers, response_body)
        """

    @abstractmethod
    async def track_running_workspaces_usage(self) -> None:
        """Track compute usage for all running workspaces.

        This method should be called periodically (e.g., every minute) to
        record compute usage for billing purposes. It tracks the time since
        the last billing event for each running workspace.
        """

    @abstractmethod
    async def scale_workspace(
        self,
        workspace_id: str,
        new_tier: str,
    ) -> WorkspaceScaleResponse:
        """Scale a workspace to a new compute tier.

        Args:
            workspace_id: The workspace ID to scale
            new_tier: The new compute tier name (e.g., "starter_arm", "pro", "gpu_starter")

        Returns:
            WorkspaceScaleResponse with scaling result
        """

    # --- Default Implementations (can be overridden by subclasses) ---

    async def list_workspaces(
        self,
        user_id: str | None = None,
        session_id: str | None = None,
    ) -> list[WorkspaceInfo]:
        """List workspaces, optionally filtered by user and/or session.

        Args:
            user_id: Filter by user ID
            session_id: Filter by session ID (applied after user_id filter)

        Returns:
            List of workspace info
        """
        if self._workspace_store:
            if user_id:
                workspaces = await self._workspace_store.list_by_user(user_id)
                # Apply session_id filter on top of user_id filter if both provided
                if session_id:
                    workspaces = [w for w in workspaces if w.session_id == session_id]
                return workspaces
            if session_id:
                return await self._workspace_store.list_by_session(session_id)
            return await self._workspace_store.list_all()

        # Fallback: return empty list if store not available
        return []

    async def read_file(self, workspace_id: str, path: str) -> str:
        """Read a file from the workspace.

        Args:
            workspace_id: The workspace ID
            path: File path relative to workspace root

        Returns:
            File contents as string
        """
        safe_path = shlex.quote(path)
        result = await self.exec_command(workspace_id, f"cat {safe_path}")
        if result.exit_code != 0:
            msg = f"Failed to read file: {result.stderr}"
            raise ValueError(msg)
        return result.stdout

    async def write_file(self, workspace_id: str, path: str, content: str) -> None:
        """Write a file to the workspace.

        Args:
            workspace_id: The workspace ID
            path: File path relative to workspace root
            content: File contents
        """
        safe_path = shlex.quote(path)
        encoded_content = base64.b64encode(content.encode("utf-8")).decode("ascii")
        cmd = (
            f"mkdir -p $(dirname {safe_path}) && "
            f"echo {shlex.quote(encoded_content)} | base64 -d > {safe_path}"
        )
        result = await self.exec_command(workspace_id, cmd)
        if result.exit_code != 0:
            msg = f"Failed to write file: {result.stderr}"
            raise ValueError(msg)

    async def list_files(
        self,
        workspace_id: str,
        path: str = ".",
    ) -> list[dict[str, str]]:
        """List files in a workspace directory.

        Args:
            workspace_id: The workspace ID
            path: Directory path relative to workspace root

        Returns:
            List of file info dicts with name, type, size
        """
        safe_path = shlex.quote(path)
        # Use -L to follow symlinks so symlinks to directories show as directories
        result = await self.exec_command(
            workspace_id,
            f"ls -laL {safe_path} | tail -n +2",
        )
        if result.exit_code != 0:
            return []

        files = []
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            parts = line.split()
            if len(parts) >= MIN_LS_PARTS:
                name = " ".join(parts[8:])
                file_type = "directory" if parts[0].startswith("d") else "file"

                files.append(
                    {
                        "name": name,
                        "type": file_type,
                        "size": parts[4],
                    }
                )

        return files

    async def heartbeat(self, workspace_id: str) -> None:
        """Update workspace last activity timestamp.

        Called periodically to keep workspace alive.

        Args:
            workspace_id: The workspace ID
        """
        if self._workspace_store:
            await self._workspace_store.update_heartbeat(workspace_id)
        # No fallback needed - heartbeat is best-effort

    async def cleanup_idle_workspaces(self, timeout_seconds: int) -> list[str]:
        """Clean up workspaces that have been idle too long.

        Args:
            timeout_seconds: Idle timeout in seconds

        Returns:
            List of workspace IDs that were cleaned up
        """
        now = datetime.now(UTC)
        cleaned_up = []

        # Get all workspaces from store
        workspaces: list[WorkspaceInfo] = []
        if self._workspace_store:
            workspaces = await self._workspace_store.list_all()

        # Filter workspaces that need cleanup
        workspaces_to_cleanup = []
        for workspace in workspaces:
            idle_time = (now - workspace.last_activity).total_seconds()
            if idle_time > timeout_seconds:
                workspaces_to_cleanup.append((workspace, idle_time))

        if workspaces_to_cleanup:
            logger.info(
                "Starting workspace cleanup",
                total_to_cleanup=len(workspaces_to_cleanup),
                timeout_seconds=timeout_seconds,
            )

        for i, (workspace, idle_time) in enumerate(workspaces_to_cleanup, 1):
            logger.info(
                "Cleaning up workspace",
                progress=f"{i}/{len(workspaces_to_cleanup)}",
                workspace_id=workspace.id[:12],
                idle_seconds=int(idle_time),
            )
            try:
                await self.delete_workspace(workspace.id)
                cleaned_up.append(workspace.id)
            except Exception:
                logger.exception(
                    "Failed to cleanup workspace, continuing with others",
                    workspace_id=workspace.id,
                )

        if workspaces_to_cleanup:
            logger.info(
                "Workspace cleanup completed",
                cleaned_up_count=len(cleaned_up),
                total_attempted=len(workspaces_to_cleanup),
            )

        return cleaned_up

    async def check_all_workspaces_health(self) -> dict[str, bool]:
        """Check health of all running workspaces.

        Returns a dict mapping workspace_id to health status.
        """
        results: dict[str, bool] = {}

        workspaces: list[WorkspaceInfo] = []
        if self._workspace_store:
            workspaces = await self._workspace_store.list_all()

        for workspace in workspaces:
            if workspace.status == WorkspaceStatus.RUNNING:
                is_healthy = await self.check_workspace_health(workspace.id)
                results[workspace.id] = is_healthy
                if not is_healthy:
                    logger.warning(
                        "Unhealthy workspace detected",
                        workspace_id=workspace.id,
                    )

        return results

    # --- Port Parsing Helpers (used by get_active_ports) ---

    def _extract_process_name(self, process_info: str) -> str:
        """Extract process name from ss output format."""
        if "users:" not in process_info:
            return ""
        start = process_info.find('(("') + PROCESS_NAME_START_OFFSET
        end = process_info.find('",', start)
        if start > MIN_PROCESS_NAME_START and end > start:
            return process_info[start:end]
        return ""

    def _parse_port_line(self, parts: list[str]) -> dict[str, Any] | None:
        """Parse a single line from ss output and return port info if valid."""
        if len(parts) < MIN_SS_PARTS:
            return None

        local_addr = (
            parts[SS_LOCAL_ADDR_INDEX]
            if len(parts) > SS_LOCAL_ADDR_INDEX
            else parts[SS_ALT_LOCAL_ADDR_INDEX]
        )
        if ":" not in local_addr:
            return None

        port_str = local_addr.split(":")[-1]
        try:
            port = int(port_str)
        except ValueError:
            return None

        if port <= MIN_SYSTEM_PORT:
            return None

        process_info = parts[-1] if len(parts) > SS_PROCESS_INFO_MIN_PARTS else ""
        process_name = self._extract_process_name(process_info)

        return {
            "port": port,
            "process_name": process_name or "unknown",
            "state": "LISTEN",
        }

    async def get_active_ports(self, workspace_id: str) -> list[dict[str, Any]]:
        """Get list of ports with active services in the workspace.

        Args:
            workspace_id: The workspace ID

        Returns:
            List of dicts with port info: {port, process_name, state}
        """
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            return []

        try:
            result = await self.exec_command(
                workspace_id,
                "ss -tlnp 2>/dev/null | tail -n +2",
            )

            if result.exit_code != 0:
                return []

            ports = []
            for line in result.stdout.strip().split("\n"):
                if not line:
                    continue
                parts = line.split()
                port_info = self._parse_port_line(parts)
                if port_info:
                    ports.append(port_info)

            # Deduplicate by port
            seen_ports: set[int] = set()
            unique_ports = []
            for p in ports:
                if p["port"] not in seen_ports:
                    seen_ports.add(p["port"])
                    unique_ports.append(p)

            return unique_ports

        except Exception:
            logger.exception("Failed to get active ports", workspace_id=workspace_id)
            return []

    async def discover_existing_workspaces(self) -> None:  # noqa: B027
        """Discover and re-register existing workspaces after service restart.

        This is an optional method that implementations can override to
        recover workspace state after a service restart. The default
        implementation does nothing.
        """
        pass

    async def exec_command_stream(
        self,
        workspace_id: str,
        command: str,
        working_dir: str | None = None,
        timeout: int = 60,
    ) -> AsyncGenerator[str, None]:
        """Execute a command and stream output chunks as an async generator.

        This is used for interactive commands like authentication flows
        where we want to stream output in real-time to the user.

        Default implementation falls back to regular exec and yields once.
        Subclasses can override for true streaming behavior.

        Args:
            workspace_id: The workspace ID
            command: Shell command to execute
            working_dir: Working directory (default: /home/dev)
            timeout: Command timeout in seconds

        Yields:
            Output chunks as strings (stdout and stderr combined)
        """
        # Default implementation: run command and yield full output
        result = await self.exec_command(workspace_id, command, working_dir, timeout)
        if result.stdout:
            yield result.stdout
        if result.stderr:
            yield result.stderr
