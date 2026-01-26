"""Native execution manager for workspace management.

STATELESS: For native mode, the local pod doesn't track workspace state.
The backend is the source of truth - it passes working_dir with each RPC call.
This manager provides configuration, path validation, and proxy support.
"""

from pathlib import Path
from typing import Any

import structlog

from .config import LocalPodConfig
from .security import PathValidator

logger = structlog.get_logger()


class NativeManager:
    """Manages native mode configuration and services.

    STATELESS: Doesn't track workspace state. All operations use working_dir
    passed from the backend. This manager provides:
    - Configuration access
    - Path validation
    - Proxy request handling
    """

    def __init__(self, config: LocalPodConfig) -> None:
        """Initialize the manager.

        Args:
            config: Pod configuration.
        """
        self.config = config
        # Empty dict - native mode is stateless, workspace state comes from backend
        self._workspaces: dict[str, dict[str, Any]] = {}

        # Create path validator from config
        self._validator = PathValidator(
            mounts=config.get_mounts_as_dicts(),
            security=config.native.security,
            workspace_dir=config.native.workspace_dir,
        )

    @property
    def workspaces(self) -> dict[str, dict[str, Any]]:
        """Get current workspaces (empty for stateless native mode)."""
        return self._workspaces

    async def initialize(self) -> None:
        """Initialize the native manager."""
        logger.info(
            "Initializing native manager (stateless mode)",
            workspace_dir=self.config.native.workspace_dir,
            security=self.config.native.security,
        )

        # Ensure workspace directory exists (for default workspace creation)
        workspace_dir = Path(self.config.native.workspace_dir)
        workspace_dir.mkdir(parents=True, exist_ok=True)

    # ==================== Workspace Lifecycle (No-ops for stateless mode) ====================
    # These methods exist for API compatibility but are essentially no-ops.
    # The backend is the source of truth for workspace state.

    async def create_workspace(
        self,
        workspace_id: str | None,
        user_id: str,
        session_id: str,
        config: dict[str, Any],
    ) -> dict[str, Any]:
        """Create workspace - returns config info without tracking state."""
        mount_path = config.get("mount_path") or str(
            Path(self.config.native.workspace_dir) / (workspace_id or "default")
        )
        return {
            "id": workspace_id,
            "user_id": user_id,
            "session_id": session_id,
            "status": "running",
            "working_dir": mount_path,
            "mount_path": mount_path,
        }

    async def stop_workspace(self, workspace_id: str) -> None:
        """Stop workspace - no-op for stateless mode."""
        logger.debug("Stop workspace (no-op)", workspace_id=workspace_id)

    async def delete_workspace(
        self,
        workspace_id: str,
        preserve_files: bool = True,
    ) -> None:
        """Delete workspace - no-op for stateless mode."""
        logger.debug("Delete workspace (no-op)", workspace_id=workspace_id)

    async def get_workspace(self, workspace_id: str) -> dict[str, Any] | None:
        """Get workspace - returns None (backend is source of truth)."""
        return None

    async def list_workspaces(
        self,
        user_id: str | None = None,
        session_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """List workspaces - returns empty (backend is source of truth)."""
        return []

    async def heartbeat(self, workspace_id: str) -> None:
        """Heartbeat - no-op for stateless mode."""
        pass

    async def update_workspace(
        self,
        workspace_id: str,
        working_dir: str | None = None,
    ) -> dict[str, Any] | None:
        """Update workspace - no-op for stateless mode."""
        return None

    # ==================== Command Execution (handled by RPCHandler) ====================

    async def exec_command(
        self,
        workspace_id: str,
        command: str,
        working_dir: str | None = None,
        timeout: int = 30,
    ) -> dict[str, Any]:
        """Execute command - handled by RPCHandler for native mode."""
        raise NotImplementedError("exec_command is handled by RPCHandler in native mode")

    # ==================== File Operations (handled by RPCHandler) ====================

    async def read_file(self, workspace_id: str, path: str) -> str:
        """Read file - handled by RPCHandler for native mode."""
        raise NotImplementedError("read_file is handled by RPCHandler in native mode")

    async def write_file(self, workspace_id: str, path: str, content: str) -> None:
        """Write file - handled by RPCHandler for native mode."""
        raise NotImplementedError("write_file is handled by RPCHandler in native mode")

    async def list_files(self, workspace_id: str, path: str = ".") -> list[dict[str, Any]]:
        """List files - handled by RPCHandler for native mode."""
        raise NotImplementedError("list_files is handled by RPCHandler in native mode")

    # ==================== Terminal (handled by RPCHandler) ====================

    async def terminal_write(self, workspace_id: str, data: str) -> None:
        """Terminal write - handled by RPCHandler for native mode."""
        raise NotImplementedError("terminal_write is handled by RPCHandler in native mode")

    # ==================== Proxy Support ====================

    async def get_active_ports(self, workspace_id: str) -> list[dict[str, Any]]:
        """Get listening ports - not applicable for native mode."""
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

    async def shutdown(self) -> None:
        """Gracefully shut down - no-op for stateless mode."""
        logger.info("Shutting down native manager (stateless)")
