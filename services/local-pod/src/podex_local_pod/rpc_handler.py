"""RPC request handler for local pod.

Handles workspace management commands from Podex cloud.
"""

from typing import Any

import structlog

from .docker_manager import LocalDockerManager

logger = structlog.get_logger()


class RPCHandler:
    """Handles RPC requests from Podex cloud."""

    def __init__(self, docker_manager: LocalDockerManager) -> None:
        """Initialize the handler.

        Args:
            docker_manager: Docker manager for workspace operations
        """
        self.docker = docker_manager

        # Method dispatch table
        self._handlers: dict[str, Any] = {
            # Workspace lifecycle
            "workspace.create": self._create_workspace,
            "workspace.stop": self._stop_workspace,
            "workspace.delete": self._delete_workspace,
            "workspace.get": self._get_workspace,
            "workspace.list": self._list_workspaces,
            "workspace.heartbeat": self._workspace_heartbeat,
            # Command execution
            "workspace.exec": self._exec_command,
            # File operations
            "workspace.read_file": self._read_file,
            "workspace.write_file": self._write_file,
            "workspace.list_files": self._list_files,
            # Ports/preview
            "workspace.get_ports": self._get_active_ports,
            "workspace.proxy": self._proxy_request,
            # Health
            "health.check": self._health_check,
        }

    async def handle(self, method: str, params: dict[str, Any]) -> Any:
        """Dispatch RPC method to handler.

        Args:
            method: RPC method name
            params: Method parameters

        Returns:
            Result from the handler

        Raises:
            ValueError: If method is unknown
        """
        handler = self._handlers.get(method)
        if not handler:
            raise ValueError(f"Unknown RPC method: {method}")

        logger.debug("Handling RPC", method=method)
        return await handler(params)

    async def _create_workspace(self, params: dict[str, Any]) -> dict[str, Any]:
        """Create a new workspace."""
        workspace = await self.docker.create_workspace(
            workspace_id=params.get("workspace_id"),
            user_id=params["user_id"],
            session_id=params["session_id"],
            config=params.get("config", {}),
        )
        return workspace

    async def _stop_workspace(self, params: dict[str, Any]) -> None:
        """Stop a workspace."""
        await self.docker.stop_workspace(params["workspace_id"])

    async def _delete_workspace(self, params: dict[str, Any]) -> None:
        """Delete a workspace."""
        await self.docker.delete_workspace(
            params["workspace_id"],
            preserve_files=params.get("preserve_files", True),
        )

    async def _get_workspace(self, params: dict[str, Any]) -> dict[str, Any] | None:
        """Get workspace info."""
        workspace = await self.docker.get_workspace(params["workspace_id"])
        return workspace

    async def _list_workspaces(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        """List all workspaces."""
        workspaces = await self.docker.list_workspaces(
            user_id=params.get("user_id"),
            session_id=params.get("session_id"),
        )
        return workspaces

    async def _workspace_heartbeat(self, params: dict[str, Any]) -> None:
        """Update workspace activity timestamp."""
        await self.docker.heartbeat(params["workspace_id"])

    async def _exec_command(self, params: dict[str, Any]) -> dict[str, Any]:
        """Execute command in workspace."""
        result = await self.docker.exec_command(
            workspace_id=params["workspace_id"],
            command=params["command"],
            working_dir=params.get("working_dir"),
            timeout=params.get("timeout", 30),
        )
        return result

    async def _read_file(self, params: dict[str, Any]) -> str:
        """Read file from workspace."""
        content = await self.docker.read_file(
            params["workspace_id"],
            params["path"],
        )
        return content

    async def _write_file(self, params: dict[str, Any]) -> None:
        """Write file to workspace."""
        await self.docker.write_file(
            params["workspace_id"],
            params["path"],
            params["content"],
        )

    async def _list_files(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        """List files in workspace directory."""
        files = await self.docker.list_files(
            params["workspace_id"],
            params.get("path", "."),
        )
        return files

    async def _get_active_ports(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        """Get active ports in workspace."""
        ports = await self.docker.get_active_ports(params["workspace_id"])
        return ports

    async def _proxy_request(self, params: dict[str, Any]) -> dict[str, Any]:
        """Proxy HTTP request to workspace."""
        result = await self.docker.proxy_request(
            workspace_id=params["workspace_id"],
            port=params["port"],
            method=params["method"],
            path=params["path"],
            headers=params.get("headers", {}),
            body=bytes.fromhex(params["body"]) if params.get("body") else None,
            query_string=params.get("query_string"),
        )
        return result

    async def _health_check(self, params: dict[str, Any]) -> dict[str, Any]:
        """Health check."""
        return {
            "status": "healthy",
            "workspaces": len(self.docker.workspaces),
        }
