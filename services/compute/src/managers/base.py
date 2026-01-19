"""Abstract base class for compute managers."""

from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Any

from src.models.workspace import (
    WorkspaceConfig,
    WorkspaceExecResponse,
    WorkspaceInfo,
)


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
    - DockerComputeManager: Local development using Docker containers
    - GCPComputeManager: Production using Cloud Run / GKE
    """

    _file_sync: Any = None

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
            preserve_files: If True, sync files to GCS before deletion.
                          If False, also delete the GCS files.
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
    async def list_workspaces(
        self,
        user_id: str | None = None,
        session_id: str | None = None,
    ) -> list[WorkspaceInfo]:
        """List workspaces, optionally filtered by user or session.

        Args:
            user_id: Filter by user ID
            session_id: Filter by session ID

        Returns:
            List of workspace info
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
    async def read_file(self, workspace_id: str, path: str) -> str:
        """Read a file from the workspace.

        Args:
            workspace_id: The workspace ID
            path: File path relative to workspace root

        Returns:
            File contents as string
        """

    @abstractmethod
    async def write_file(self, workspace_id: str, path: str, content: str) -> None:
        """Write a file to the workspace.

        Args:
            workspace_id: The workspace ID
            path: File path relative to workspace root
            content: File contents
        """

    @abstractmethod
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

    @abstractmethod
    async def heartbeat(self, workspace_id: str) -> None:
        """Update workspace last activity timestamp.

        Called periodically to keep workspace alive.

        Args:
            workspace_id: The workspace ID
        """

    @abstractmethod
    async def cleanup_idle_workspaces(self, timeout_seconds: int) -> list[str]:
        """Clean up workspaces that have been idle too long.

        Args:
            timeout_seconds: Idle timeout in seconds

        Returns:
            List of workspace IDs that were cleaned up
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
    async def get_active_ports(self, workspace_id: str) -> list[dict[str, Any]]:
        """Get list of ports with active services in the workspace.

        Args:
            workspace_id: The workspace ID

        Returns:
            List of dicts with port info: {port, pid, process_name}
        """

    @abstractmethod
    async def track_running_workspaces_usage(self) -> None:
        """Track compute usage for all running workspaces.

        This method should be called periodically (e.g., every minute) to
        record compute usage for billing purposes. It tracks the time since
        the last billing event for each running workspace.
        """

    async def discover_existing_workspaces(self) -> None:  # noqa: B027
        """Discover and re-register existing workspaces after service restart.

        This is an optional method that implementations can override to
        recover workspace state after a service restart. The default
        implementation does nothing.
        """
        pass

    def set_file_sync(self, file_sync: Any) -> None:
        """Set the file sync service for workspace file synchronization.

        This is an optional method that implementations can override to
        enable file sync capabilities.

        Args:
            file_sync: The file sync service instance
        """
        self._file_sync = file_sync

    def get_file_sync(self) -> Any:
        """Get the file sync service instance.

        Returns:
            The file sync service instance, or None if not configured
        """
        return self._file_sync

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
