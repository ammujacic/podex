"""Multi-server Docker client for managing containers across multiple hosts.

This module provides Docker API access to multiple workspace servers,
supporting TLS-secured connections and connection pooling.
"""

from __future__ import annotations

import asyncio
import ssl
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

import docker
import structlog
from docker.tls import TLSConfig

from src.config import settings

if TYPE_CHECKING:
    from docker import DockerClient
    from docker.models.containers import Container

logger = structlog.get_logger()


@dataclass
class ServerConnection:
    """Connection to a Docker host."""

    server_id: str
    hostname: str
    ip_address: str
    docker_port: int
    architecture: str
    client: DockerClient | None = None
    last_error: str | None = None
    is_healthy: bool = False


@dataclass
class ContainerSpec:
    """Specification for creating a container."""

    name: str
    image: str
    cpu_limit: float  # Number of CPUs (can be fractional)
    memory_limit_mb: int
    disk_limit_gb: int
    environment: dict[str, str] = field(default_factory=dict)
    volumes: dict[str, dict[str, str]] = field(default_factory=dict)
    ports: dict[str, int | None] = field(default_factory=dict)
    labels: dict[str, str] = field(default_factory=dict)
    network: str | None = None
    runtime: str = "runsc"  # gVisor runtime for isolation


class MultiServerDockerManager:
    """Manages Docker connections across multiple workspace servers.

    Provides a unified interface for Docker operations that can be
    directed to specific servers or delegated based on workspace location.
    """

    def __init__(self) -> None:
        """Initialize the multi-server Docker manager."""
        self._connections: dict[str, ServerConnection] = {}
        self._lock = asyncio.Lock()

    async def add_server(
        self,
        server_id: str,
        hostname: str,
        ip_address: str,
        docker_port: int = 2376,
        architecture: str = "arm64",
    ) -> bool:
        """Add a server to the pool and establish connection.

        Args:
            server_id: Unique server identifier
            hostname: Server hostname
            ip_address: Server IP address
            docker_port: Docker API port (default 2376 for TLS)
            architecture: Server architecture (arm64, amd64)

        Returns:
            True if connection successful, False otherwise
        """
        async with self._lock:
            conn = ServerConnection(
                server_id=server_id,
                hostname=hostname,
                ip_address=ip_address,
                docker_port=docker_port,
                architecture=architecture,
            )

            try:
                client = await self._create_docker_client(ip_address, docker_port)
                conn.client = client
                conn.is_healthy = True
                self._connections[server_id] = conn

                logger.info(
                    "Added server to pool",
                    server_id=server_id,
                    hostname=hostname,
                    ip_address=ip_address,
                )
                return True

            except Exception as e:
                conn.last_error = str(e)
                conn.is_healthy = False
                self._connections[server_id] = conn

                logger.error(
                    "Failed to connect to server",
                    server_id=server_id,
                    hostname=hostname,
                    error=str(e),
                )
                return False

    async def remove_server(self, server_id: str) -> None:
        """Remove a server from the pool.

        Args:
            server_id: Server identifier to remove
        """
        async with self._lock:
            if server_id in self._connections:
                conn = self._connections[server_id]
                if conn.client:
                    try:
                        conn.client.close()
                    except Exception:
                        pass
                del self._connections[server_id]
                logger.info("Removed server from pool", server_id=server_id)

    async def _create_docker_client(
        self,
        ip_address: str,
        docker_port: int,
    ) -> DockerClient:
        """Create a Docker client connection.

        Args:
            ip_address: Server IP address
            docker_port: Docker API port

        Returns:
            Docker client instance

        Raises:
            DockerException: If connection fails
        """
        loop = asyncio.get_event_loop()

        def _connect() -> DockerClient:
            if settings.docker_tls_enabled:
                # TLS-secured connection
                cert_path = Path(settings.docker_cert_path)
                tls_config = TLSConfig(
                    client_cert=(
                        str(cert_path / "cert.pem"),
                        str(cert_path / "key.pem"),
                    ),
                    ca_cert=str(cert_path / "ca.pem"),
                    verify=True,
                    ssl_version=ssl.PROTOCOL_TLS_CLIENT,
                )
                base_url = f"https://{ip_address}:{docker_port}"
                return docker.DockerClient(base_url=base_url, tls=tls_config)
            else:
                # Local Docker socket (development)
                return docker.from_env()

        return await loop.run_in_executor(None, _connect)

    def get_client(self, server_id: str) -> DockerClient | None:
        """Get Docker client for a specific server.

        Args:
            server_id: Server identifier

        Returns:
            Docker client if available, None otherwise
        """
        conn = self._connections.get(server_id)
        if conn and conn.is_healthy and conn.client:
            return conn.client
        return None

    def get_connection(self, server_id: str) -> ServerConnection | None:
        """Get connection info for a server.

        Args:
            server_id: Server identifier

        Returns:
            ServerConnection if exists, None otherwise
        """
        return self._connections.get(server_id)

    def get_healthy_servers(self) -> list[ServerConnection]:
        """Get all healthy server connections.

        Returns:
            List of healthy server connections
        """
        return [conn for conn in self._connections.values() if conn.is_healthy]

    async def check_server_health(self, server_id: str) -> bool:
        """Check if a server is healthy.

        Args:
            server_id: Server identifier

        Returns:
            True if server is healthy, False otherwise
        """
        conn = self._connections.get(server_id)
        if not conn or not conn.client:
            return False

        loop = asyncio.get_event_loop()

        def _ping() -> bool:
            try:
                conn.client.ping()  # type: ignore[union-attr]
                return True
            except Exception:
                return False

        try:
            is_healthy = await loop.run_in_executor(None, _ping)
            conn.is_healthy = is_healthy
            if not is_healthy:
                conn.last_error = "Ping failed"
            return is_healthy
        except Exception as e:
            conn.is_healthy = False
            conn.last_error = str(e)
            return False

    async def create_container(
        self,
        server_id: str,
        spec: ContainerSpec,
    ) -> Container | None:
        """Create a container on a specific server.

        Args:
            server_id: Target server identifier
            spec: Container specification

        Returns:
            Container instance if successful, None otherwise
        """
        client = self.get_client(server_id)
        if not client:
            logger.error("No client available for server", server_id=server_id)
            return None

        conn = self._connections[server_id]
        loop = asyncio.get_event_loop()

        def _create() -> Container:
            # Select image based on architecture
            image = spec.image
            if conn.architecture == "arm64" and hasattr(settings, "workspace_image_arm64"):
                image = settings.workspace_image_arm64
            elif conn.architecture == "amd64" and hasattr(settings, "workspace_image_amd64"):
                image = settings.workspace_image_amd64

            # Convert CPU limit to nano-CPUs (1 CPU = 1e9 nano-CPUs)
            nano_cpus = int(spec.cpu_limit * 1e9)

            # Convert memory to bytes
            mem_limit = f"{spec.memory_limit_mb}m"

            container = client.containers.create(
                image=image,
                name=spec.name,
                detach=True,
                environment=spec.environment,
                volumes=spec.volumes,
                ports=spec.ports,
                labels=spec.labels,
                nano_cpus=nano_cpus,
                mem_limit=mem_limit,
                network=spec.network,
                runtime=spec.runtime if settings.docker_runtime else None,
            )
            return container

        try:
            container = await loop.run_in_executor(None, _create)
            logger.info(
                "Created container",
                server_id=server_id,
                container_name=spec.name,
                container_id=container.id[:12] if container else None,
            )
            return container
        except Exception as e:
            logger.exception(
                "Failed to create container",
                server_id=server_id,
                container_name=spec.name,
                error=str(e),
            )
            return None

    async def start_container(self, server_id: str, container_id: str) -> bool:
        """Start a container on a server.

        Args:
            server_id: Server identifier
            container_id: Container ID or name

        Returns:
            True if successful, False otherwise
        """
        client = self.get_client(server_id)
        if not client:
            return False

        loop = asyncio.get_event_loop()

        def _start() -> bool:
            container = client.containers.get(container_id)
            container.start()
            return True

        try:
            return await loop.run_in_executor(None, _start)
        except Exception as e:
            logger.exception(
                "Failed to start container",
                server_id=server_id,
                container_id=container_id,
                error=str(e),
            )
            return False

    async def stop_container(self, server_id: str, container_id: str, timeout: int = 10) -> bool:
        """Stop a container on a server.

        Args:
            server_id: Server identifier
            container_id: Container ID or name
            timeout: Timeout in seconds before force kill

        Returns:
            True if successful, False otherwise
        """
        client = self.get_client(server_id)
        if not client:
            return False

        loop = asyncio.get_event_loop()

        def _stop() -> bool:
            container = client.containers.get(container_id)
            container.stop(timeout=timeout)
            return True

        try:
            return await loop.run_in_executor(None, _stop)
        except Exception as e:
            logger.exception(
                "Failed to stop container",
                server_id=server_id,
                container_id=container_id,
                error=str(e),
            )
            return False

    async def remove_container(
        self,
        server_id: str,
        container_id: str,
        force: bool = False,
        v: bool = False,
    ) -> bool:
        """Remove a container from a server.

        Args:
            server_id: Server identifier
            container_id: Container ID or name
            force: Force removal even if running
            v: Remove associated volumes

        Returns:
            True if successful, False otherwise
        """
        client = self.get_client(server_id)
        if not client:
            return False

        loop = asyncio.get_event_loop()

        def _remove() -> bool:
            container = client.containers.get(container_id)
            container.remove(force=force, v=v)
            return True

        try:
            return await loop.run_in_executor(None, _remove)
        except Exception as e:
            logger.exception(
                "Failed to remove container",
                server_id=server_id,
                container_id=container_id,
                error=str(e),
            )
            return False

    async def run_in_container(
        self,
        server_id: str,
        container_id: str,
        command: str | list[str],
        working_dir: str | None = None,
        user: str = "dev",
        timeout: int = 30,
    ) -> tuple[int, str, str]:
        """Run a command in a container.

        Args:
            server_id: Server identifier
            container_id: Container ID or name
            command: Command to run (string or list)
            working_dir: Working directory
            user: User to run command as
            timeout: Timeout in seconds

        Returns:
            Tuple of (exit_code, stdout, stderr)
        """
        client = self.get_client(server_id)
        if not client:
            return (1, "", "Server not available")

        loop = asyncio.get_event_loop()

        def _run() -> tuple[int, str, str]:
            container = client.containers.get(container_id)

            # Prepare command
            if isinstance(command, str):
                cmd = ["bash", "-c", command]
            else:
                cmd = command

            # Run with demux to separate stdout/stderr
            result = container.exec_run(
                cmd,
                workdir=working_dir or "/home/dev",
                user=user,
                demux=True,
            )

            stdout = result.output[0].decode("utf-8") if result.output[0] else ""
            stderr = result.output[1].decode("utf-8") if result.output[1] else ""

            return (result.exit_code, stdout, stderr)

        try:
            return await asyncio.wait_for(
                loop.run_in_executor(None, _run),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            return (124, "", "Command timed out")
        except Exception as e:
            logger.exception(
                "Failed to run command",
                server_id=server_id,
                container_id=container_id,
                error=str(e),
            )
            return (1, "", str(e))

    async def get_container_stats(
        self,
        server_id: str,
        container_id: str,
    ) -> dict[str, Any] | None:
        """Get container resource usage stats.

        Args:
            server_id: Server identifier
            container_id: Container ID or name

        Returns:
            Stats dict or None if unavailable
        """
        client = self.get_client(server_id)
        if not client:
            return None

        loop = asyncio.get_event_loop()

        def _stats() -> dict[str, Any]:
            container = client.containers.get(container_id)
            return container.stats(stream=False)

        try:
            return await loop.run_in_executor(None, _stats)
        except Exception as e:
            logger.exception(
                "Failed to get container stats",
                server_id=server_id,
                container_id=container_id,
                error=str(e),
            )
            return None

    async def get_server_stats(self, server_id: str) -> dict[str, Any] | None:
        """Get server-level stats (CPU, memory, disk).

        Args:
            server_id: Server identifier

        Returns:
            Stats dict or None if unavailable
        """
        client = self.get_client(server_id)
        if not client:
            return None

        loop = asyncio.get_event_loop()

        def _server_stats() -> dict[str, Any]:
            info = client.info()
            return {
                "cpu_count": info.get("NCPU", 0),
                "memory_total_mb": info.get("MemTotal", 0) // (1024 * 1024),
                "containers_running": info.get("ContainersRunning", 0),
                "containers_paused": info.get("ContainersPaused", 0),
                "containers_stopped": info.get("ContainersStopped", 0),
                "images": info.get("Images", 0),
                "server_version": info.get("ServerVersion", ""),
                "os": info.get("OperatingSystem", ""),
                "architecture": info.get("Architecture", ""),
            }

        try:
            return await loop.run_in_executor(None, _server_stats)
        except Exception as e:
            logger.exception(
                "Failed to get server stats",
                server_id=server_id,
                error=str(e),
            )
            return None

    async def list_containers(
        self,
        server_id: str,
        all: bool = False,  # noqa: A002
        filters: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """List containers on a server.

        Args:
            server_id: Server identifier
            all: Include stopped containers
            filters: Filter dict (e.g., {"label": "workspace_id=xxx"})

        Returns:
            List of container info dicts
        """
        client = self.get_client(server_id)
        if not client:
            return []

        loop = asyncio.get_event_loop()

        def _list() -> list[dict[str, Any]]:
            containers = client.containers.list(all=all, filters=filters)
            return [
                {
                    "id": c.id,
                    "name": c.name,
                    "status": c.status,
                    "labels": c.labels,
                    "created": c.attrs.get("Created"),
                }
                for c in containers
            ]

        try:
            return await loop.run_in_executor(None, _list)
        except Exception as e:
            logger.exception(
                "Failed to list containers",
                server_id=server_id,
                error=str(e),
            )
            return []

    async def create_volume(
        self,
        server_id: str,
        name: str,
        labels: dict[str, str] | None = None,
    ) -> bool:
        """Create a Docker volume on a server.

        Args:
            server_id: Server identifier
            name: Volume name
            labels: Optional labels

        Returns:
            True if successful, False otherwise
        """
        client = self.get_client(server_id)
        if not client:
            return False

        loop = asyncio.get_event_loop()

        def _create_volume() -> bool:
            client.volumes.create(name=name, labels=labels or {})
            return True

        try:
            return await loop.run_in_executor(None, _create_volume)
        except Exception as e:
            logger.exception(
                "Failed to create volume",
                server_id=server_id,
                volume_name=name,
                error=str(e),
            )
            return False

    async def remove_volume(self, server_id: str, name: str, force: bool = False) -> bool:
        """Remove a Docker volume from a server.

        Args:
            server_id: Server identifier
            name: Volume name
            force: Force removal

        Returns:
            True if successful, False otherwise
        """
        client = self.get_client(server_id)
        if not client:
            return False

        loop = asyncio.get_event_loop()

        def _remove_volume() -> bool:
            volume = client.volumes.get(name)
            volume.remove(force=force)
            return True

        try:
            return await loop.run_in_executor(None, _remove_volume)
        except Exception as e:
            logger.exception(
                "Failed to remove volume",
                server_id=server_id,
                volume_name=name,
                error=str(e),
            )
            return False

    async def close_all(self) -> None:
        """Close all server connections."""
        async with self._lock:
            for conn in self._connections.values():
                if conn.client:
                    try:
                        conn.client.close()
                    except Exception:
                        pass
            self._connections.clear()
            logger.info("Closed all server connections")


# Global instance
_docker_manager: MultiServerDockerManager | None = None


def get_multi_server_docker_manager() -> MultiServerDockerManager:
    """Get the global multi-server Docker manager instance."""
    global _docker_manager
    if _docker_manager is None:
        _docker_manager = MultiServerDockerManager()
    return _docker_manager
