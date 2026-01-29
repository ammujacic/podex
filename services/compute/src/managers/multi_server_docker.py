"""Multi-server Docker client for managing containers across multiple hosts.

This module provides Docker API access to multiple workspace servers,
supporting TLS-secured connections and connection pooling.
"""

from __future__ import annotations

import asyncio
import ssl
import subprocess
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
    tls_enabled: bool = False  # Per-server TLS setting
    cert_path: str | None = None  # Path to TLS certs for this server
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
    disk_limit_gb: int = 10
    bandwidth_limit_mbps: int = 100  # Network bandwidth limit in Mbps
    environment: dict[str, str] = field(default_factory=dict)
    volumes: dict[str, dict[str, str]] = field(default_factory=dict)
    ports: dict[str, int | None] = field(default_factory=dict)
    labels: dict[str, str] = field(default_factory=dict)
    network: str | None = None
    network_mode: str | None = None  # e.g., "bridge", "host", "none"
    runtime: str | None = None  # Container runtime (e.g., "runsc" for gVisor, "nvidia" for GPU)
    # GPU configuration
    gpu_enabled: bool = False
    gpu_count: int = 0  # 0 = all available GPUs when gpu_enabled, specific count otherwise
    gpu_type: str | None = None  # e.g., "NVIDIA RTX 4000 SFF Ada"


class MultiServerDockerManager:
    """Manages Docker connections across multiple workspace servers.

    Provides a unified interface for Docker operations that can be
    directed to specific servers or delegated based on workspace location.
    """

    def __init__(self) -> None:
        """Initialize the multi-server Docker manager."""
        self._connections: dict[str, ServerConnection] = {}
        self._lock = asyncio.Lock()

    @property
    def servers(self) -> dict[str, ServerConnection]:
        """Get all server connections."""
        return self._connections

    async def add_server(
        self,
        server_id: str,
        hostname: str,
        ip_address: str,
        docker_port: int = 2375,
        architecture: str = "amd64",
        tls_enabled: bool = False,
        cert_path: str | None = None,
    ) -> bool:
        """Add a server to the pool and establish connection.

        Args:
            server_id: Unique server identifier
            hostname: Server hostname
            ip_address: Server IP address (or Docker hostname for local dev)
            docker_port: Docker API port (2375 for HTTP, 2376 for TLS)
            architecture: Server architecture (arm64, amd64)
            tls_enabled: Whether to use TLS for this server
            cert_path: Path to TLS certificates (required if tls_enabled)

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
                tls_enabled=tls_enabled,
                cert_path=cert_path,
            )

            try:
                client = await self._create_docker_client(
                    ip_address=ip_address,
                    docker_port=docker_port,
                    tls_enabled=tls_enabled,
                    cert_path=cert_path,
                )
                conn.client = client
                conn.is_healthy = True
                self._connections[server_id] = conn

                logger.info(
                    "Added server to pool",
                    server_id=server_id,
                    hostname=hostname,
                    ip_address=ip_address,
                    tls_enabled=tls_enabled,
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

    async def ping_server(self, server_id: str) -> bool:
        """Ping a server to check if it's alive.

        Args:
            server_id: Server identifier

        Returns:
            True if server responds, False otherwise
        """
        client = self.get_client(server_id)
        if not client:
            return False

        loop = asyncio.get_event_loop()

        def _ping() -> bool:
            try:
                client.ping()
                return True
            except Exception:
                return False

        try:
            return await loop.run_in_executor(None, _ping)
        except Exception:
            return False

    async def _create_docker_client(
        self,
        ip_address: str,
        docker_port: int,
        tls_enabled: bool = False,
        cert_path: str | None = None,
    ) -> DockerClient:
        """Create a Docker client connection.

        Args:
            ip_address: Server IP address or hostname
            docker_port: Docker API port
            tls_enabled: Whether to use TLS for this connection
            cert_path: Path to TLS certificates (required if tls_enabled)

        Returns:
            Docker client instance

        Raises:
            DockerException: If connection fails
            ValueError: If TLS enabled but no cert_path provided
        """
        loop = asyncio.get_event_loop()

        def _connect() -> DockerClient:
            if tls_enabled:
                # TLS-secured connection (production)
                if not cert_path:
                    raise ValueError(f"cert_path required for TLS connection to {ip_address}")
                certs = Path(cert_path)
                tls_config = TLSConfig(
                    client_cert=(
                        str(certs / "cert.pem"),
                        str(certs / "key.pem"),
                    ),
                    ca_cert=str(certs / "ca.pem"),
                    verify=True,
                    ssl_version=ssl.PROTOCOL_TLS_CLIENT,  # type: ignore[call-arg]
                )
                base_url = f"https://{ip_address}:{docker_port}"
                return docker.DockerClient(base_url=base_url, tls=tls_config)
            else:
                # HTTP connection (local development with DinD servers)
                base_url = f"tcp://{ip_address}:{docker_port}"
                return docker.DockerClient(base_url=base_url)

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
            # Select image based on architecture (GPU workspaces use x86_64)
            image = spec.image
            if not spec.gpu_enabled:
                if conn.architecture == "arm64" and hasattr(settings, "workspace_image_arm64"):
                    image = settings.workspace_image_arm64
                elif conn.architecture == "amd64" and hasattr(settings, "workspace_image_amd64"):
                    image = settings.workspace_image_amd64

            # Convert CPU limit to nano-CPUs (1 CPU = 1e9 nano-CPUs)
            nano_cpus = int(spec.cpu_limit * 1e9)

            # Convert memory to bytes
            mem_limit = f"{spec.memory_limit_mb}m"

            # Build container kwargs
            create_kwargs: dict[str, Any] = {
                "image": image,
                "name": spec.name,
                "detach": True,
                "environment": spec.environment,
                "volumes": spec.volumes,
                "ports": spec.ports,
                "labels": spec.labels,
                "nano_cpus": nano_cpus,
                "mem_limit": mem_limit,
            }

            # Add network if specified
            if spec.network:
                create_kwargs["network"] = spec.network
            elif spec.network_mode:
                create_kwargs["network_mode"] = spec.network_mode

            # Configure GPU access if enabled
            if spec.gpu_enabled:
                # Use NVIDIA Container Runtime for GPU workspaces
                create_kwargs["runtime"] = "nvidia"

                # Configure GPU device requests
                # count=-1 means all GPUs, count=N means specific number
                gpu_count = -1 if spec.gpu_count == 0 else spec.gpu_count
                create_kwargs["device_requests"] = [
                    docker.types.DeviceRequest(
                        count=gpu_count,
                        capabilities=[["gpu"]],
                    )
                ]

                # Add NVIDIA environment variables for CUDA support
                env = spec.environment.copy()
                env.setdefault("NVIDIA_VISIBLE_DEVICES", "all")
                env.setdefault("NVIDIA_DRIVER_CAPABILITIES", "compute,utility")
                create_kwargs["environment"] = env

                logger.info(
                    "Configuring GPU container",
                    container_name=spec.name,
                    gpu_count=gpu_count,
                    gpu_type=spec.gpu_type,
                )
            elif spec.runtime:
                # Add runtime only if specified (e.g., runsc for gVisor)
                create_kwargs["runtime"] = spec.runtime

            container = client.containers.create(**create_kwargs)
            return container

        try:
            container = await loop.run_in_executor(None, _create)
            logger.info(
                "Created container",
                server_id=server_id,
                container_name=spec.name,
                container_id=container.id[:12] if container and container.id else None,
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

    async def apply_bandwidth_limit(
        self,
        server_id: str,
        container_id: str,
        bandwidth_mbps: int,
        ssh_host: str | None = None,
        ssh_port: int = 22,
        ssh_user: str = "root",
    ) -> bool:
        """Apply bandwidth limit to a container using tc (traffic control) from the host.

        This applies the limit on the HOST side of the container's veth interface,
        which the user cannot bypass since they don't have host access.

        Args:
            server_id: Server identifier
            container_id: Container ID or name
            bandwidth_mbps: Bandwidth limit in Mbps
            ssh_host: SSH host (defaults to server IP from connection)
            ssh_port: SSH port
            ssh_user: SSH user (requires root or sudo)

        Returns:
            True if successful, False otherwise

        Note:
            For local development (DinD), this may not work as expected since
            the containers run inside Docker-in-Docker. In production, this runs
            on actual hosts with direct network namespace access.
        """
        client = self.get_client(server_id)
        if not client:
            logger.error("No client available for bandwidth limiting", server_id=server_id)
            return False

        conn = self._connections.get(server_id)
        if not conn:
            logger.error("No connection info for server", server_id=server_id)
            return False

        loop = asyncio.get_event_loop()

        def _apply_tc() -> bool:
            # Get container PID
            container = client.containers.get(container_id)
            pid = container.attrs.get("State", {}).get("Pid")

            if not pid:
                logger.error("Container PID not found", container_id=container_id)
                return False

            # Commands to find veth interface and apply tc
            # Step 1: Get the interface index from inside container's network namespace
            # Step 2: Find host interface with that index
            # Step 3: Apply tc rule

            # For local execution on the host (production scenario)
            # In local dev with DinD, this needs SSH or docker exec into the host container

            host = ssh_host or conn.ip_address

            # Build the tc script that will run on the host
            # This finds the container's veth and applies bandwidth limiting
            tc_script = f"""
                # Get the iflink (interface index) from container's eth0
                IFLINK=$(nsenter -t {pid} -n cat /sys/class/net/eth0/iflink 2>/dev/null)
                if [ -z "$IFLINK" ]; then
                    echo "Failed to get iflink"
                    exit 1
                fi

                # Find the host interface with that index
                VETH=$(ip link | grep "^$IFLINK:" | cut -d':' -f2 | cut -d'@' -f1 | tr -d ' ')
                if [ -z "$VETH" ]; then
                    echo "Failed to find veth interface"
                    exit 1
                fi

                # Apply tc rule (replace if exists)
                RATE={bandwidth_mbps}mbit
                tc qdisc replace dev $VETH root tbf rate $RATE burst 32kbit latency 400ms
                echo "Applied limit to $VETH for container {container_id[:12]}"
            """

            # For local development, try to exec into the workspace server (if it's a DinD setup)
            # For production, SSH to the host
            if settings.environment == "development":
                # In development, we might be using Docker-in-Docker
                # Try to run the command via docker exec on the DinD server container
                # This is a simplification - in production, we'd SSH to the actual host
                logger.warning(
                    "Bandwidth limiting in development mode may not work with DinD",
                    container_id=container_id[:12],
                    bandwidth_mbps=bandwidth_mbps,
                )
                # For now, just log and return True in development
                # Real bandwidth limiting requires host-level access
                return True
            else:
                # Production: SSH to the host and run tc commands
                ssh_cmd = [
                    "ssh",
                    "-o",
                    "StrictHostKeyChecking=no",
                    "-o",
                    "ConnectTimeout=10",
                    "-p",
                    str(ssh_port),
                    f"{ssh_user}@{host}",
                    tc_script,
                ]

                result = subprocess.run(  # noqa: S603
                    ssh_cmd,
                    capture_output=True,
                    text=True,
                    timeout=30,
                    check=False,
                )

                if result.returncode != 0:
                    logger.error(
                        "Failed to apply bandwidth limit via SSH",
                        server_id=server_id,
                        container_id=container_id[:12],
                        stderr=result.stderr,
                    )
                    return False

                logger.info(
                    "Applied bandwidth limit",
                    server_id=server_id,
                    container_id=container_id[:12],
                    bandwidth_mbps=bandwidth_mbps,
                    output=result.stdout.strip(),
                )
                return True

        try:
            return await loop.run_in_executor(None, _apply_tc)
        except subprocess.TimeoutExpired:
            logger.error(
                "Timeout applying bandwidth limit",
                server_id=server_id,
                container_id=container_id,
            )
            return False
        except Exception as e:
            logger.exception(
                "Failed to apply bandwidth limit",
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
        remove_volumes: bool = False,
    ) -> bool:
        """Remove a container from a server.

        Args:
            server_id: Server identifier
            container_id: Container ID or name
            force: Force removal even if running
            remove_volumes: Remove associated volumes

        Returns:
            True if successful, False otherwise
        """
        client = self.get_client(server_id)
        if not client:
            return False

        loop = asyncio.get_event_loop()

        def _remove() -> bool:
            container = client.containers.get(container_id)
            container.remove(force=force, v=remove_volumes)
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
        except TimeoutError:
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
            stats = container.stats(stream=False)
            # stats() with stream=False returns a dict, not an iterator
            return stats  # type: ignore[return-value]

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

    def parse_container_stats(self, stats: dict[str, Any]) -> dict[str, Any]:
        """Parse raw Docker stats into resource metrics.

        Args:
            stats: Raw stats dict from Docker API

        Returns:
            Parsed metrics dict matching WorkspaceResourceMetrics fields
        """
        from datetime import UTC, datetime  # noqa: PLC0415

        result: dict[str, Any] = {
            "cpu_percent": 0.0,
            "cpu_limit_cores": 1.0,
            "memory_used_mb": 0,
            "memory_limit_mb": 1024,
            "memory_percent": 0.0,
            "disk_read_mb": 0.0,
            "disk_write_mb": 0.0,
            "network_rx_mb": 0.0,
            "network_tx_mb": 0.0,
            "collected_at": datetime.now(UTC).isoformat(),
            "container_uptime_seconds": 0,
        }

        if not stats:
            return result

        # CPU calculation
        # Docker stats provides cumulative CPU usage - we need delta between samples
        cpu_stats = stats.get("cpu_stats", {})
        precpu_stats = stats.get("precpu_stats", {})

        cpu_usage = cpu_stats.get("cpu_usage", {})
        precpu_usage = precpu_stats.get("cpu_usage", {})

        cpu_delta = cpu_usage.get("total_usage", 0) - precpu_usage.get("total_usage", 0)
        system_delta = cpu_stats.get("system_cpu_usage", 0) - precpu_stats.get(
            "system_cpu_usage", 0
        )
        num_cpus = cpu_stats.get("online_cpus", 1) or 1

        if system_delta > 0 and cpu_delta > 0:
            result["cpu_percent"] = (cpu_delta / system_delta) * num_cpus * 100.0

        result["cpu_limit_cores"] = num_cpus

        # Memory
        memory_stats = stats.get("memory_stats", {})
        memory_usage = memory_stats.get("usage", 0)
        memory_limit = memory_stats.get("limit", 0)

        # Convert to MB
        result["memory_used_mb"] = memory_usage // (1024 * 1024)
        result["memory_limit_mb"] = memory_limit // (1024 * 1024) if memory_limit > 0 else 1024

        if memory_limit > 0:
            result["memory_percent"] = (memory_usage / memory_limit) * 100.0

        # Network (sum all interfaces)
        networks = stats.get("networks", {})
        total_rx = 0
        total_tx = 0
        for iface_stats in networks.values():
            total_rx += iface_stats.get("rx_bytes", 0)
            total_tx += iface_stats.get("tx_bytes", 0)

        # Convert to MB
        result["network_rx_mb"] = total_rx / (1024 * 1024)
        result["network_tx_mb"] = total_tx / (1024 * 1024)

        # Disk I/O
        blkio_stats = stats.get("blkio_stats", {})
        io_service_bytes = blkio_stats.get("io_service_bytes_recursive") or []

        for entry in io_service_bytes:
            op = entry.get("op", "").lower()
            value = entry.get("value", 0)
            if op == "read":
                result["disk_read_mb"] += value / (1024 * 1024)
            elif op == "write":
                result["disk_write_mb"] += value / (1024 * 1024)

        return result

    async def get_container_status(
        self,
        server_id: str,
        container_id: str,
    ) -> dict[str, Any] | None:
        """Get container status information.

        Args:
            server_id: Server identifier
            container_id: Container ID or name

        Returns:
            Dict with status info or None if container not found
        """
        client = self.get_client(server_id)
        if not client:
            return None

        loop = asyncio.get_event_loop()

        def _status() -> dict[str, Any]:
            container = client.containers.get(container_id)
            return {
                "id": container.id,
                "name": container.name,
                "status": container.status,
                "health": container.attrs.get("State", {}).get("Health", {}).get("Status"),
                "started_at": container.attrs.get("State", {}).get("StartedAt"),
                "finished_at": container.attrs.get("State", {}).get("FinishedAt"),
                "exit_code": container.attrs.get("State", {}).get("ExitCode"),
                "labels": container.labels,
            }

        try:
            return await loop.run_in_executor(None, _status)
        except Exception as e:
            logger.warning(
                "Failed to get container status",
                server_id=server_id,
                container_id=container_id,
                error=str(e),
            )
            return None

    async def get_server_stats(self, server_id: str) -> dict[str, Any] | None:
        """Get server-level stats including resource usage from workspace containers.

        Args:
            server_id: Server identifier

        Returns:
            Stats dict with total and used resources, or None if unavailable
        """
        client = self.get_client(server_id)
        if not client:
            return None

        connection = self._connections.get(server_id)
        loop = asyncio.get_event_loop()

        def _server_stats() -> dict[str, Any]:
            info = client.info()
            total_cpu = info.get("NCPU", 0)
            total_memory_mb = info.get("MemTotal", 0) // (1024 * 1024)

            # Calculate used resources from workspace containers
            used_cpu = 0.0
            used_memory_mb = 0
            active_workspaces = 0

            # List workspace containers and sum their resource reservations
            workspace_containers = client.containers.list(filters={"label": "podex.workspace=true"})

            for container in workspace_containers:
                active_workspaces += 1
                # Get resource limits from container config
                host_config = container.attrs.get("HostConfig", {})

                # CPU: NanoCpus is in units of 10^-9 CPUs
                nano_cpus = host_config.get("NanoCpus", 0)
                if nano_cpus:
                    used_cpu += nano_cpus / 1_000_000_000

                # Memory limit in bytes
                mem_limit = host_config.get("Memory", 0)
                if mem_limit:
                    used_memory_mb += mem_limit // (1024 * 1024)

            # Detect GPU support from Docker info
            # Check if NVIDIA runtime is available (indicates NVIDIA Container Toolkit installed)
            runtimes = info.get("Runtimes", {})
            has_nvidia_runtime = "nvidia" in runtimes

            # Try to detect GPU count and type from labels or server metadata
            # Hetzner GPU servers have specific labels we can check
            gpu_count = 0
            gpu_type = None

            if has_nvidia_runtime:
                # Server has NVIDIA runtime, check for GPU devices
                # GPU info may be in server labels set during registration
                server_labels = info.get("Labels", []) or []
                for label in server_labels:
                    if isinstance(label, str):
                        if label.startswith("gpu.count="):
                            gpu_count = int(label.split("=")[1])
                        elif label.startswith("gpu.type="):
                            gpu_type = label.split("=", 1)[1]

                # Default to 1 GPU if nvidia runtime present but no count label
                if gpu_count == 0:
                    gpu_count = 1

            return {
                "hostname": connection.hostname if connection else server_id,
                "total_cpu": total_cpu,
                "total_memory_mb": total_memory_mb,
                "total_disk_gb": 100,  # TODO: Get actual disk from Docker
                "used_cpu": used_cpu,
                "used_memory_mb": used_memory_mb,
                "used_disk_gb": 0,  # TODO: Calculate from container volumes
                "active_workspaces": active_workspaces,
                "has_gpu": has_nvidia_runtime and gpu_count > 0,
                "gpu_type": gpu_type,
                "gpu_count": gpu_count,
                "architecture": (
                    connection.architecture if connection else info.get("Architecture", "amd64")
                ),
                "region": None,
                "status": "active" if connection and connection.is_healthy else "unhealthy",
                "labels": {},
                # Legacy fields
                "cpu_count": total_cpu,
                "memory_total_mb": total_memory_mb,
                "containers_running": info.get("ContainersRunning", 0),
                "server_version": info.get("ServerVersion", ""),
                "os": info.get("OperatingSystem", ""),
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
        all: bool = False,
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

    async def update_container(
        self,
        server_id: str,
        container_id: str,
        cpu_limit: float | None = None,
        memory_limit_mb: int | None = None,
    ) -> bool:
        """Update resource limits on a running container.

        This uses docker update to change CPU/memory limits without restart.

        Args:
            server_id: Server identifier
            container_id: Container ID or name
            cpu_limit: New CPU limit (cores)
            memory_limit_mb: New memory limit in MB

        Returns:
            True if successful, False otherwise
        """
        client = self.get_client(server_id)
        if not client:
            return False

        loop = asyncio.get_event_loop()

        def _update() -> bool:
            container = client.containers.get(container_id)
            update_kwargs: dict[str, Any] = {}

            if cpu_limit is not None:
                update_kwargs["nano_cpus"] = int(cpu_limit * 1e9)

            if memory_limit_mb is not None:
                update_kwargs["mem_limit"] = memory_limit_mb * 1024 * 1024

            if update_kwargs:
                container.update(**update_kwargs)

            return True

        try:
            result = await loop.run_in_executor(None, _update)
            logger.info(
                "Updated container resources",
                server_id=server_id,
                container_id=container_id[:12],
                cpu_limit=cpu_limit,
                memory_limit_mb=memory_limit_mb,
            )
            return result
        except Exception as e:
            logger.exception(
                "Failed to update container",
                server_id=server_id,
                container_id=container_id,
                error=str(e),
            )
            return False

    async def setup_workspace_directory(
        self,
        server_id: str,
        workspace_id: str,
        storage_gb: int,
    ) -> bool:
        """Create workspace directory with XFS quota on the server.

        In production, creates directory and sets XFS project quota.
        In development, only creates directory (no quota enforcement).

        Args:
            server_id: Server identifier
            workspace_id: Workspace ID
            storage_gb: Storage quota in GB

        Returns:
            True if successful, False otherwise
        """
        conn = self._connections.get(server_id)
        if not conn:
            logger.error("Server not found", server_id=server_id)
            return False

        data_path = settings.workspace_data_path
        workspace_path = f"{data_path}/{workspace_id}"

        # In development, we can create the directory via docker exec on DinD
        if settings.environment == "development":
            client = self.get_client(server_id)
            if not client:
                return False

            # For DinD, create directory inside the DinD container's filesystem
            # The DinD container has /data/workspaces mounted
            loop = asyncio.get_event_loop()

            def _create_dir() -> bool:
                # Run mkdir in the DinD server using docker exec
                # DinD container name matches server_id
                import docker as docker_lib  # noqa: PLC0415

                local_client = docker_lib.from_env()
                try:
                    dind_container = local_client.containers.get(server_id)
                    result = dind_container.exec_run(
                        f"mkdir -p {workspace_path}/home && chown -R 1000:1000 {workspace_path}",
                        user="root",
                    )
                    return result.exit_code == 0
                except Exception:
                    # Fallback: assume directory exists or will be created
                    return True

            try:
                return await loop.run_in_executor(None, _create_dir)
            except Exception as e:
                logger.warning(
                    "Failed to create workspace directory in dev",
                    error=str(e),
                )
                return True  # Continue anyway in dev

        # Production: SSH to server
        loop = asyncio.get_event_loop()

        def _ssh_setup() -> bool:
            # Create directory
            mkdir_cmd = [
                "ssh",
                "-o",
                "StrictHostKeyChecking=no",
                "-o",
                "BatchMode=yes",
                f"root@{conn.ip_address}",
                f"mkdir -p {workspace_path}/home && chown -R 1000:1000 {workspace_path}",
            ]
            result = subprocess.run(mkdir_cmd, capture_output=True, timeout=30, check=False)  # noqa: S603
            if result.returncode != 0:
                logger.error("Failed to create directory", stderr=result.stderr.decode())
                return False

            # Set XFS quota if enabled
            if settings.xfs_quotas_enabled:
                project_id = abs(hash(workspace_id)) % 65536
                quota_cmds = [
                    f'echo "{project_id}:{workspace_path}" >> /etc/projects',
                    f'echo "ws_{workspace_id}:{project_id}" >> /etc/projid',
                    f'xfs_quota -x -c "project -s ws_{workspace_id}" {data_path}',
                    f'xfs_quota -x -c "limit -p bhard={storage_gb}g ws_{workspace_id}" {data_path}',
                ]
                quota_cmd = " && ".join(quota_cmds)
                ssh_cmd = [
                    "ssh",
                    "-o",
                    "StrictHostKeyChecking=no",
                    "-o",
                    "BatchMode=yes",
                    f"root@{conn.ip_address}",
                    quota_cmd,
                ]
                result = subprocess.run(ssh_cmd, capture_output=True, timeout=30, check=False)  # noqa: S603
                if result.returncode != 0:
                    logger.warning(
                        "Failed to set XFS quota",
                        stderr=result.stderr.decode(),
                    )
                    # Continue anyway - directory exists

            return True

        try:
            success = await loop.run_in_executor(None, _ssh_setup)
            if success:
                logger.info(
                    "Created workspace directory",
                    server_id=server_id,
                    workspace_id=workspace_id[:12],
                    storage_gb=storage_gb,
                )
            return success
        except Exception as e:
            logger.exception(
                "Failed to setup workspace directory",
                server_id=server_id,
                workspace_id=workspace_id,
                error=str(e),
            )
            return False

    async def update_xfs_quota(
        self,
        server_id: str,
        workspace_id: str,
        storage_gb: int,
    ) -> bool:
        """Update XFS quota for a workspace (live, no restart needed).

        Args:
            server_id: Server identifier
            workspace_id: Workspace ID
            storage_gb: New storage quota in GB

        Returns:
            True if successful, False otherwise
        """
        if not settings.xfs_quotas_enabled:
            logger.debug("XFS quotas disabled, skipping update")
            return True

        if settings.environment == "development":
            logger.debug("Skipping XFS quota update in development")
            return True

        conn = self._connections.get(server_id)
        if not conn:
            return False

        data_path = settings.workspace_data_path
        loop = asyncio.get_event_loop()

        def _update_quota() -> bool:
            quota_cmd = (
                f'xfs_quota -x -c "limit -p bhard={storage_gb}g ws_{workspace_id}" {data_path}'
            )
            ssh_cmd = [
                "ssh",
                "-o",
                "StrictHostKeyChecking=no",
                "-o",
                "BatchMode=yes",
                f"root@{conn.ip_address}",
                quota_cmd,
            ]
            result = subprocess.run(ssh_cmd, capture_output=True, timeout=30, check=False)  # noqa: S603
            return result.returncode == 0

        try:
            success = await loop.run_in_executor(None, _update_quota)
            if success:
                logger.info(
                    "Updated XFS quota",
                    workspace_id=workspace_id[:12],
                    storage_gb=storage_gb,
                )
            return success
        except Exception as e:
            logger.exception("Failed to update XFS quota", error=str(e))
            return False

    async def remove_workspace_directory(
        self,
        server_id: str,
        workspace_id: str,
    ) -> bool:
        """Remove workspace directory and clean up XFS quota entries.

        Args:
            server_id: Server identifier
            workspace_id: Workspace ID

        Returns:
            True if successful, False otherwise
        """
        conn = self._connections.get(server_id)
        if not conn:
            return False

        data_path = settings.workspace_data_path
        workspace_path = f"{data_path}/{workspace_id}"

        if settings.environment == "development":
            # In dev, remove via docker exec
            client = self.get_client(server_id)
            if client:
                loop = asyncio.get_event_loop()

                def _remove_dir() -> bool:
                    import docker as docker_lib  # noqa: PLC0415

                    try:
                        local_client = docker_lib.from_env()
                        dind_container = local_client.containers.get(server_id)
                        dind_container.exec_run(f"rm -rf {workspace_path}", user="root")
                        return True
                    except Exception:
                        return True  # Ignore errors in dev

                await loop.run_in_executor(None, _remove_dir)
            return True

        # Production: SSH to remove
        loop = asyncio.get_event_loop()

        def _ssh_remove() -> bool:
            rm_cmd = [
                "ssh",
                "-o",
                "StrictHostKeyChecking=no",
                "-o",
                "BatchMode=yes",
                f"root@{conn.ip_address}",
                f"rm -rf {workspace_path}",
            ]
            subprocess.run(rm_cmd, capture_output=True, timeout=30, check=False)  # noqa: S603

            # Clean up quota entries
            if settings.xfs_quotas_enabled:
                sed_cmd = (
                    f"sed -i '/ws_{workspace_id}/d' /etc/projects; "
                    f"sed -i '/ws_{workspace_id}/d' /etc/projid"
                )
                cleanup_cmd = [
                    "ssh",
                    "-o",
                    "StrictHostKeyChecking=no",
                    "-o",
                    "BatchMode=yes",
                    f"root@{conn.ip_address}",
                    sed_cmd,
                ]
                subprocess.run(cleanup_cmd, capture_output=True, timeout=30, check=False)  # noqa: S603

            return True

        try:
            await loop.run_in_executor(None, _ssh_remove)
            logger.info(
                "Removed workspace directory",
                server_id=server_id,
                workspace_id=workspace_id[:12],
            )
            return True
        except Exception as e:
            logger.exception("Failed to remove workspace directory", error=str(e))
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
