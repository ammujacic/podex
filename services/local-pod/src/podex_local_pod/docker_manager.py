"""Local Docker manager for workspace management.

Manages Docker containers for workspaces on the local machine.
"""

import base64
import contextlib
import os
import re
import shlex
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import docker
import httpx
import structlog

from .config import LocalPodConfig

logger = structlog.get_logger()


def _generate_workspace_id() -> str:
    """Generate a unique workspace ID."""
    return f"ws_{uuid4().hex[:12]}"


class LocalDockerManager:
    """Manages Docker containers for local workspaces."""

    def __init__(self, config: LocalPodConfig) -> None:
        """Initialize the manager.

        Args:
            config: Pod configuration
        """
        self.config = config
        self._client: docker.DockerClient | None = None
        self._workspaces: dict[str, dict[str, Any]] = {}
        self._terminal_sessions: dict[str, Any] = {}

    @property
    def workspaces(self) -> dict[str, dict[str, Any]]:
        """Get current workspaces."""
        return self._workspaces

    async def initialize(self) -> None:
        """Initialize Docker client and network."""
        logger.info("Initializing Docker manager")

        # Initialize Docker client
        try:
            self._client = docker.from_env()
            info = self._client.info()
            logger.info(
                "Docker connected",
                version=info.get("ServerVersion"),
                containers=info.get("Containers"),
            )
        except docker.errors.DockerException as e:
            logger.error("Failed to connect to Docker", error=str(e))
            raise

        # Ensure network exists
        await self._ensure_network()

        # Clean up any orphaned containers from previous runs
        await self._cleanup_orphaned_containers()

    async def _ensure_network(self) -> None:
        """Ensure the Docker network exists."""
        if not self._client:
            return

        try:
            self._client.networks.get(self.config.docker_network)
            logger.debug("Docker network exists", network=self.config.docker_network)
        except docker.errors.NotFound:
            logger.info("Creating Docker network", network=self.config.docker_network)
            self._client.networks.create(
                self.config.docker_network,
                driver="bridge",
                labels={"podex.managed": "true"},
            )

    async def _cleanup_orphaned_containers(self) -> None:
        """Clean up containers from previous runs."""
        if not self._client:
            return

        try:
            containers = self._client.containers.list(
                all=True,
                filters={"label": "podex.local_pod=true"},
            )
            for container in containers:
                logger.info(
                    "Cleaning up orphaned container",
                    container_id=container.short_id,
                    name=container.name,
                )
                with contextlib.suppress(docker.errors.APIError):
                    container.stop(timeout=5)
                with contextlib.suppress(docker.errors.APIError):
                    container.remove(force=True)
        except Exception as e:
            logger.warning("Error cleaning up orphaned containers", error=str(e))

    async def create_workspace(
        self,
        workspace_id: str | None,
        user_id: str,
        session_id: str,
        config: dict[str, Any],
    ) -> dict[str, Any]:
        """Create a new workspace container.

        Args:
            workspace_id: Optional workspace ID (generated if not provided)
            user_id: Owner user ID
            session_id: Session ID
            config: Workspace configuration

        Returns:
            Workspace info dict
        """
        if not self._client:
            raise RuntimeError("Docker client not initialized")

        # Check workspace limit
        if len(self._workspaces) >= self.config.max_workspaces:
            raise RuntimeError(f"Maximum workspace limit ({self.config.max_workspaces}) reached")

        workspace_id = workspace_id or _generate_workspace_id()
        container_name = f"podex-workspace-{workspace_id}"

        logger.info(
            "Creating workspace",
            workspace_id=workspace_id,
            user_id=user_id,
            session_id=session_id,
        )

        # Build environment variables
        env = {
            "WORKSPACE_ID": workspace_id,
            "USER_ID": user_id,
            "SESSION_ID": session_id,
            **config.get("environment", {}),
        }

        # Get resource limits based on tier
        tier = config.get("tier", "starter")
        cpu_count, mem_limit = self._get_tier_resources(tier)

        try:
            # Create container
            container = self._client.containers.run(
                self.config.workspace_image,
                name=container_name,
                detach=True,
                network=self.config.docker_network,
                cpu_count=cpu_count,
                mem_limit=mem_limit,
                environment=env,
                labels={
                    "podex.workspace_id": workspace_id,
                    "podex.user_id": user_id,
                    "podex.session_id": session_id,
                    "podex.tier": tier,
                    "podex.local_pod": "true",
                },
                working_dir="/home/dev",
                tty=True,
                stdin_open=True,
            )

            # Get container IP
            container.reload()
            networks = container.attrs.get("NetworkSettings", {}).get("Networks", {})
            network_info = networks.get(self.config.docker_network, {})
            container_ip = network_info.get("IPAddress", "")

            workspace_info = {
                "id": workspace_id,
                "user_id": user_id,
                "session_id": session_id,
                "status": "running",
                "tier": tier,
                "host": container_ip,
                "port": 3000,
                "container_id": container.id,
                "container_name": container_name,
                "created_at": datetime.now(UTC).isoformat(),
                "last_activity": datetime.now(UTC).isoformat(),
            }

            self._workspaces[workspace_id] = workspace_info

            logger.info(
                "Workspace created",
                workspace_id=workspace_id,
                container_id=container.short_id,
                ip=container_ip,
            )

            return workspace_info

        except docker.errors.ImageNotFound as e:
            logger.error("Workspace image not found", image=self.config.workspace_image)
            raise RuntimeError(f"Workspace image not found: {self.config.workspace_image}") from e
        except docker.errors.APIError as e:
            logger.error("Docker API error", error=str(e))
            raise RuntimeError(f"Failed to create workspace: {e}") from e

    def _get_tier_resources(self, tier: str) -> tuple[int, str]:
        """Get CPU and memory limits for a tier."""
        tiers = {
            "starter": (2, "4096m"),
            "pro": (4, "8192m"),
            "power": (8, "16384m"),
            "enterprise": (16, "32768m"),
        }
        return tiers.get(tier.lower(), tiers["starter"])

    async def stop_workspace(self, workspace_id: str) -> None:
        """Stop a workspace container."""
        if not self._client:
            return

        workspace = self._workspaces.get(workspace_id)
        if not workspace:
            logger.warning("Workspace not found", workspace_id=workspace_id)
            return

        container_id = workspace.get("container_id")
        if not container_id:
            return

        try:
            container = self._client.containers.get(container_id)
            container.stop(timeout=10)
            workspace["status"] = "stopped"
            logger.info("Workspace stopped", workspace_id=workspace_id)
        except docker.errors.NotFound:
            logger.warning("Container not found", container_id=container_id)
        except Exception as e:
            logger.error("Error stopping workspace", error=str(e))
            raise

    async def delete_workspace(
        self,
        workspace_id: str,
        preserve_files: bool = True,
    ) -> None:
        """Delete a workspace container."""
        if not self._client:
            return

        workspace = self._workspaces.pop(workspace_id, None)
        if not workspace:
            return

        container_id = workspace.get("container_id")
        if not container_id:
            return

        try:
            container = self._client.containers.get(container_id)
            container.stop(timeout=5)
            container.remove(force=True)
            logger.info("Workspace deleted", workspace_id=workspace_id)
        except docker.errors.NotFound:
            pass
        except Exception as e:
            logger.error("Error deleting workspace", error=str(e))

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
        """Execute command in workspace container."""
        if not self._client:
            raise RuntimeError("Docker client not initialized")

        workspace = self._workspaces.get(workspace_id)
        if not workspace:
            raise ValueError(f"Workspace not found: {workspace_id}")

        container_id = workspace.get("container_id")
        if not container_id:
            raise ValueError("Container ID not found")

        try:
            container = self._client.containers.get(container_id)

            # Build command
            workdir = working_dir or "/home/dev"
            exec_cmd = ["bash", "-c", command]

            # Execute command
            result = container.exec_run(
                exec_cmd,
                workdir=workdir,
                demux=True,
            )

            exit_code = result.exit_code
            stdout = result.output[0].decode("utf-8", errors="replace") if result.output[0] else ""
            stderr = result.output[1].decode("utf-8", errors="replace") if result.output[1] else ""

            # Update activity
            workspace["last_activity"] = datetime.now(UTC).isoformat()

            return {
                "exit_code": exit_code,
                "stdout": stdout,
                "stderr": stderr,
            }

        except docker.errors.NotFound as e:
            raise ValueError(f"Container not found: {container_id}") from e
        except Exception as e:
            logger.error("Error executing command", error=str(e))
            raise

    async def read_file(self, workspace_id: str, path: str) -> str:
        """Read file from workspace."""
        safe_path = shlex.quote(path)
        result = await self.exec_command(workspace_id, f"cat {safe_path}")
        if result["exit_code"] != 0:
            raise ValueError(f"Failed to read file: {result['stderr']}")
        stdout: str = result["stdout"]
        return stdout

    async def write_file(self, workspace_id: str, path: str, content: str) -> None:
        """Write file to workspace."""
        safe_path = shlex.quote(path)
        safe_dir = shlex.quote(os.path.dirname(path))

        # Encode content as base64 for safe transfer
        encoded = base64.b64encode(content.encode()).decode()

        command = f"mkdir -p {safe_dir} && echo {shlex.quote(encoded)} | base64 -d > {safe_path}"
        result = await self.exec_command(workspace_id, command)
        if result["exit_code"] != 0:
            raise ValueError(f"Failed to write file: {result['stderr']}")

    async def list_files(self, workspace_id: str, path: str = ".") -> list[dict[str, Any]]:
        """List files in workspace directory."""
        safe_path = shlex.quote(path)
        result = await self.exec_command(workspace_id, f"ls -la {safe_path}")
        if result["exit_code"] != 0:
            raise ValueError(f"Failed to list files: {result['stderr']}")

        files = []
        for line in result["stdout"].strip().split("\n")[1:]:  # Skip "total" line
            parts = line.split(None, 8)
            if len(parts) >= 9:
                file_type = "directory" if parts[0].startswith("d") else "file"
                files.append(
                    {
                        "name": parts[8],
                        "type": file_type,
                        "size": int(parts[4]) if parts[4].isdigit() else 0,
                        "permissions": parts[0],
                    }
                )

        return files

    async def get_active_ports(self, workspace_id: str) -> list[dict[str, Any]]:
        """Get listening ports in workspace."""
        result = await self.exec_command(
            workspace_id,
            "ss -tlnp 2>/dev/null | tail -n +2",
        )
        if result["exit_code"] != 0:
            return []

        ports = []
        for line in result["stdout"].strip().split("\n"):
            if not line:
                continue
            parts = line.split()
            if len(parts) >= 4:
                # Parse local address
                local_addr = parts[3]
                if ":" in local_addr:
                    port_str = local_addr.rsplit(":", 1)[-1]
                    try:
                        port = int(port_str)
                        if port > 1024:  # Skip system ports
                            # Try to get process name
                            process_name = "unknown"
                            if len(parts) >= 6:
                                match = re.search(r'\("([^"]+)"', parts[5])
                                if match:
                                    process_name = match.group(1)
                            ports.append(
                                {
                                    "port": port,
                                    "process_name": process_name,
                                    "state": "LISTEN",
                                }
                            )
                    except ValueError:
                        pass

        return ports

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
        """Proxy HTTP request to workspace container."""
        workspace = self._workspaces.get(workspace_id)
        if not workspace:
            raise ValueError(f"Workspace not found: {workspace_id}")

        host = workspace.get("host")
        if not host:
            raise ValueError("Workspace has no host IP")

        url = f"http://{host}:{port}/{path}"
        if query_string:
            url += f"?{query_string}"

        # Filter hop-by-hop headers
        hop_by_hop = {
            "connection",
            "keep-alive",
            "proxy-authenticate",
            "proxy-authorization",
            "te",
            "trailers",
            "transfer-encoding",
            "upgrade",
            "host",
        }
        filtered_headers = {k: v for k, v in headers.items() if k.lower() not in hop_by_hop}

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.request(
                method=method,
                url=url,
                headers=filtered_headers,
                content=body,
            )

        return {
            "status_code": response.status_code,
            "headers": dict(response.headers),
            "body": response.content.hex() if response.content else None,
        }

    async def terminal_write(self, workspace_id: str, data: str) -> None:
        """Write to terminal (not fully implemented - would need PTY support)."""
        # This would require a more complex PTY implementation
        # For now, just log
        logger.debug("Terminal write", workspace_id=workspace_id, data_len=len(data))

    async def shutdown(self) -> None:
        """Gracefully shut down all workspaces."""
        logger.info("Shutting down Docker manager", workspaces=len(self._workspaces))

        for workspace_id in list(self._workspaces.keys()):
            try:
                await self.stop_workspace(workspace_id)
            except Exception as e:
                logger.warning("Error stopping workspace", workspace_id=workspace_id, error=str(e))

        self._workspaces.clear()
