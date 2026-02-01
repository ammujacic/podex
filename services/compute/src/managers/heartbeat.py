"""Server and Workspace Heartbeat Service for multi-server health monitoring.

This module implements health monitoring and heartbeat management for
workspace servers and containers in the multi-server orchestration system.

The service performs three key functions:
1. Local server health monitoring via Docker API pings
2. Workspace container health monitoring via Docker container status
3. Reporting health status to the central API for cluster-wide visibility
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from enum import Enum
from typing import TYPE_CHECKING, Any

import httpx
import structlog

from src.config import settings
from src.models.workspace import WorkspaceStatus
from src.utils.task_lock import release_task_lock, try_acquire_task_lock

if TYPE_CHECKING:
    from src.managers.multi_server_docker import MultiServerDockerManager
    from src.storage.workspace_store import WorkspaceStore

logger = structlog.get_logger()


class ServerHealthStatus(str, Enum):
    """Server health status."""

    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    UNREACHABLE = "unreachable"
    UNKNOWN = "unknown"


@dataclass
class ServerHealth:
    """Health information for a server."""

    server_id: str
    status: ServerHealthStatus
    last_heartbeat: datetime
    consecutive_failures: int = 0
    last_error: str | None = None
    metrics: dict[str, Any] = field(default_factory=dict)

    @property
    def is_healthy(self) -> bool:
        """Check if server is considered healthy."""
        return self.status in (ServerHealthStatus.HEALTHY, ServerHealthStatus.DEGRADED)

    @property
    def seconds_since_heartbeat(self) -> float:
        """Get seconds since last successful heartbeat."""
        return (datetime.now(UTC) - self.last_heartbeat).total_seconds()


@dataclass
class HeartbeatConfig:
    """Configuration for heartbeat service."""

    interval_seconds: int = 30  # How often to check servers
    timeout_seconds: int = 10  # Timeout for health check requests
    failure_threshold: int = 3  # Consecutive failures before marking unhealthy
    recovery_threshold: int = 2  # Consecutive successes before marking healthy
    stale_threshold_seconds: int = 120  # Consider server stale after this time
    report_to_api: bool = True  # Whether to report heartbeats to the central API
    check_workspace_containers: bool = True  # Whether to check workspace container health
    workspace_check_interval_multiplier: int = 2  # Check workspaces every N heartbeats


class HeartbeatService:
    """Service for monitoring server and workspace health via heartbeats.

    Periodically checks server and workspace container health and maintains
    health status for the multi-server orchestration system. Also reports
    health to the central API for cluster-wide visibility.
    """

    def __init__(
        self,
        docker_manager: MultiServerDockerManager,
        config: HeartbeatConfig | None = None,
        api_base_url: str | None = None,
        api_token: str | None = None,
        workspace_store: WorkspaceStore | None = None,
    ) -> None:
        """Initialize heartbeat service.

        Args:
            docker_manager: Multi-server Docker client for health checks
            config: Optional heartbeat configuration
            api_base_url: Base URL for the API service (for reporting heartbeats)
            api_token: Authentication token for API calls
            workspace_store: Optional workspace store for updating workspace status
        """
        self._docker = docker_manager
        self._config = config or HeartbeatConfig()
        self._health_status: dict[str, ServerHealth] = {}
        self._running = False
        self._task: asyncio.Task[None] | None = None
        self._callbacks: list[HeartbeatCallback] = []
        self._api_base_url = api_base_url or settings.api_base_url
        self._api_token = api_token or settings.internal_service_token
        self._http_client: httpx.AsyncClient | None = None
        self._workspace_store = workspace_store
        self._heartbeat_count = 0  # Counter for workspace check interval

    @property
    def is_running(self) -> bool:
        """Check if heartbeat service is running."""
        return self._running

    def get_server_health(self, server_id: str) -> ServerHealth | None:
        """Get health status for a specific server.

        Args:
            server_id: Server ID to check

        Returns:
            ServerHealth if available, None otherwise
        """
        return self._health_status.get(server_id)

    def get_all_health(self) -> dict[str, ServerHealth]:
        """Get health status for all servers.

        Returns:
            Dict mapping server_id to ServerHealth
        """
        return dict(self._health_status)

    def get_healthy_servers(self) -> list[str]:
        """Get list of healthy server IDs.

        Returns:
            List of server IDs that are healthy
        """
        return [server_id for server_id, health in self._health_status.items() if health.is_healthy]

    def register_callback(self, callback: HeartbeatCallback) -> None:
        """Register a callback for health status changes.

        Args:
            callback: Callback to invoke on status changes
        """
        self._callbacks.append(callback)

    def unregister_callback(self, callback: HeartbeatCallback) -> None:
        """Unregister a callback.

        Args:
            callback: Callback to remove
        """
        if callback in self._callbacks:
            self._callbacks.remove(callback)

    async def start(self) -> None:
        """Start the heartbeat service.

        Begins periodic health checks for all registered servers.
        """
        if self._running:
            logger.warning("Heartbeat service already running")
            return

        self._running = True

        # Create HTTP client for API reporting
        if self._config.report_to_api:
            headers = {"Content-Type": "application/json"}
            if self._api_token:
                # Use internal service token header for service-to-service auth
                headers["X-Internal-Service-Token"] = self._api_token
            self._http_client = httpx.AsyncClient(
                base_url=self._api_base_url,
                headers=headers,
                timeout=10.0,
            )

        self._task = asyncio.create_task(self._heartbeat_loop())

        logger.info(
            "Heartbeat service started",
            interval_seconds=self._config.interval_seconds,
            failure_threshold=self._config.failure_threshold,
            report_to_api=self._config.report_to_api,
        )

    async def stop(self) -> None:
        """Stop the heartbeat service."""
        if not self._running:
            return

        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

        # Close HTTP client
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None

        logger.info("Heartbeat service stopped")

    async def check_server(self, server_id: str) -> ServerHealth:
        """Perform a health check on a specific server.

        Args:
            server_id: Server ID to check

        Returns:
            Updated ServerHealth for the server
        """
        previous_health = self._health_status.get(server_id)
        now = datetime.now(UTC)

        # Initialize health status if not exists
        if not previous_health:
            previous_health = ServerHealth(
                server_id=server_id,
                status=ServerHealthStatus.UNKNOWN,
                last_heartbeat=now,
            )

        try:
            # Perform Docker API ping
            is_alive = await self._docker.ping_server(server_id)

            if is_alive:
                # Get server stats for metrics
                stats = await self._docker.get_server_stats(server_id)

                # Reset failure count and update metrics
                new_health = ServerHealth(
                    server_id=server_id,
                    status=self._calculate_status(stats),
                    last_heartbeat=now,
                    consecutive_failures=0,
                    metrics=stats or {},
                )
            else:
                # Increment failure count
                failures = previous_health.consecutive_failures + 1
                new_health = ServerHealth(
                    server_id=server_id,
                    status=(
                        ServerHealthStatus.UNHEALTHY
                        if failures >= self._config.failure_threshold
                        else ServerHealthStatus.DEGRADED
                    ),
                    last_heartbeat=previous_health.last_heartbeat,
                    consecutive_failures=failures,
                    last_error="Docker API ping failed",
                    metrics=previous_health.metrics,
                )

        except TimeoutError:
            failures = previous_health.consecutive_failures + 1
            new_health = ServerHealth(
                server_id=server_id,
                status=ServerHealthStatus.UNREACHABLE,
                last_heartbeat=previous_health.last_heartbeat,
                consecutive_failures=failures,
                last_error="Health check timed out",
                metrics=previous_health.metrics,
            )

        except Exception as e:
            failures = previous_health.consecutive_failures + 1
            new_health = ServerHealth(
                server_id=server_id,
                status=(
                    ServerHealthStatus.UNHEALTHY
                    if failures >= self._config.failure_threshold
                    else ServerHealthStatus.DEGRADED
                ),
                last_heartbeat=previous_health.last_heartbeat,
                consecutive_failures=failures,
                last_error=str(e),
                metrics=previous_health.metrics,
            )

        # Update health status
        self._health_status[server_id] = new_health

        # Report heartbeat to central API
        if self._config.report_to_api:
            await self._report_heartbeat_to_api(server_id, new_health)

        # Notify callbacks if status changed
        if previous_health.status != new_health.status:
            await self._notify_status_change(server_id, previous_health, new_health)

        return new_health

    async def check_all_servers(self) -> dict[str, ServerHealth]:
        """Check health of all registered servers.

        Returns:
            Dict mapping server_id to ServerHealth
        """
        server_ids = list(self._docker.servers.keys())

        # Check all servers concurrently
        tasks = [self.check_server(server_id) for server_id in server_ids]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Handle any exceptions
        for server_id, result in zip(server_ids, results, strict=False):
            if isinstance(result, Exception):
                logger.exception(
                    "Health check failed for server",
                    server_id=server_id,
                    error=str(result),
                )

        return self._health_status

    async def check_all_workspace_containers(self) -> dict[str, str]:
        """Check health of all workspace containers across all servers.

        Queries each server for workspace containers and checks their status.
        Updates workspace status in Redis and reports to API if unhealthy.

        Returns:
            Dict mapping workspace_id to container status
        """
        results: dict[str, str] = {}
        unhealthy_count = 0
        checked_count = 0

        for server_id in self._docker.servers:
            try:
                # Get all workspace containers on this server
                containers = await self._docker.list_containers(
                    server_id,
                    all=True,  # Include stopped containers
                    filters={"label": "podex.workspace=true"},
                )

                for container in containers:
                    workspace_id = container.get("labels", {}).get("podex.workspace_id")
                    if not workspace_id:
                        continue

                    checked_count += 1
                    container_status = container.get("status", "unknown")
                    results[workspace_id] = container_status

                    # Determine if workspace is healthy
                    is_healthy = container_status == "running"

                    # Collect metrics for healthy containers
                    if is_healthy:
                        container_id = container.get("id")
                        if container_id:
                            await self._collect_workspace_metrics(
                                workspace_id,
                                container_id,
                                server_id,
                            )

                    if not is_healthy:
                        unhealthy_count += 1
                        logger.warning(
                            "Unhealthy workspace container detected",
                            workspace_id=workspace_id[:12],
                            server_id=server_id,
                            container_status=container_status,
                        )

                        # Update workspace status in Redis
                        await self._update_workspace_status(
                            workspace_id,
                            container_status,
                            server_id,
                        )

                        # Report to API
                        await self._report_workspace_status_to_api(
                            workspace_id,
                            container_status,
                        )

            except Exception:
                logger.exception(
                    "Failed to check workspace containers on server",
                    server_id=server_id,
                )

        if checked_count > 0:
            logger.debug(
                "Workspace container health check complete",
                checked=checked_count,
                unhealthy=unhealthy_count,
            )

        return results

    async def _collect_workspace_metrics(
        self,
        workspace_id: str,
        container_id: str,
        server_id: str,
    ) -> None:
        """Collect and store resource metrics for a workspace container.

        Args:
            workspace_id: The workspace ID
            container_id: Docker container ID
            server_id: Server where container is running
        """
        if not self._workspace_store:
            return

        try:
            # Get raw stats from Docker
            stats = await self._docker.get_container_stats(server_id, container_id)
            if not stats:
                return

            # Parse into metrics
            metrics = self._docker.parse_container_stats(stats)

            # Store in Redis
            await self._workspace_store.update_metrics(workspace_id, metrics)

            logger.debug(
                "Collected workspace metrics",
                workspace_id=workspace_id[:12],
                cpu_percent=f"{metrics.get('cpu_percent', 0):.1f}%",
                memory_mb=metrics.get("memory_used_mb", 0),
            )

        except Exception:
            logger.exception(
                "Failed to collect workspace metrics",
                workspace_id=workspace_id[:12],
                container_id=container_id[:12],
            )

    async def _update_workspace_status(
        self,
        workspace_id: str,
        container_status: str,
        server_id: str,
    ) -> None:
        """Update workspace status in Redis based on container status.

        Args:
            workspace_id: The workspace ID
            container_status: Docker container status
            server_id: Server where container is located
        """
        if not self._workspace_store:
            return

        try:
            workspace = await self._workspace_store.get(workspace_id)
            if not workspace:
                return

            # Map container status to workspace status
            new_status: WorkspaceStatus | None = None
            if container_status == "running":
                new_status = WorkspaceStatus.RUNNING
            elif container_status in ("exited", "stopped"):
                new_status = WorkspaceStatus.STOPPED
            elif container_status in ("dead", "removing", "paused"):
                new_status = WorkspaceStatus.ERROR
            elif container_status == "created":
                new_status = WorkspaceStatus.CREATING

            if new_status and workspace.status != new_status:
                old_status = workspace.status
                workspace.status = new_status
                await self._workspace_store.save(workspace)

                logger.info(
                    "Workspace status updated from container health check",
                    workspace_id=workspace_id[:12],
                    old_status=old_status.value,
                    new_status=new_status.value,
                    container_status=container_status,
                    server_id=server_id,
                )

        except Exception:
            logger.exception(
                "Failed to update workspace status",
                workspace_id=workspace_id,
            )

    async def _report_workspace_status_to_api(
        self,
        workspace_id: str,
        container_status: str,
    ) -> bool:
        """Report workspace status to the central API.

        Args:
            workspace_id: The workspace ID
            container_status: Docker container status

        Returns:
            True if reported successfully, False otherwise
        """
        if not self._config.report_to_api or not self._http_client:
            return False

        try:
            # Map container status to API status
            status_map = {
                "running": "running",
                "exited": "stopped",
                "stopped": "stopped",
                "dead": "error",
                "removing": "error",
                "paused": "error",
                "created": "starting",
            }
            api_status = status_map.get(container_status, "error")

            # Use internal sync endpoint for service-to-service workspace status updates
            response = await self._http_client.post(
                f"/api/workspaces/{workspace_id}/internal/sync-status",
                json={"status": api_status},
            )

            if response.status_code in (200, 204):
                logger.debug(
                    "Reported workspace status to API",
                    workspace_id=workspace_id[:12],
                    status=api_status,
                )
                return True
            elif response.status_code == 404:
                # Workspace not in API DB - might be local-only or deleted
                logger.debug(
                    "Workspace not found in API, skipping status report",
                    workspace_id=workspace_id[:12],
                )
                return False
            else:
                logger.warning(
                    "Failed to report workspace status to API",
                    workspace_id=workspace_id[:12],
                    status_code=response.status_code,
                )
                return False

        except httpx.RequestError as e:
            logger.warning(
                "Network error reporting workspace status to API",
                workspace_id=workspace_id[:12],
                error=str(e),
            )
            return False
        except Exception:
            logger.exception(
                "Unexpected error reporting workspace status to API",
                workspace_id=workspace_id[:12],
            )
            return False

    async def _report_heartbeat_to_api(
        self,
        server_id: str,
        health: ServerHealth,
    ) -> bool:
        """Report server heartbeat to the central API.

        Args:
            server_id: Server ID to report
            health: Current health status with metrics

        Returns:
            True if reported successfully, False otherwise
        """
        if not self._config.report_to_api or not self._http_client:
            return False

        try:
            # Extract metrics from health data
            metrics = health.metrics or {}

            response = await self._http_client.post(
                f"/api/servers/{server_id}/heartbeat",
                params={
                    "used_cpu": metrics.get("used_cpu", 0.0),
                    "used_memory_mb": metrics.get("used_memory_mb", 0),
                    "used_disk_gb": metrics.get("used_disk_gb", 0),
                    "active_workspaces": metrics.get("active_workspaces", 0),
                },
            )

            if response.status_code == 200:
                logger.debug(
                    "Reported heartbeat to API",
                    server_id=server_id,
                    status=health.status.value,
                )
                return True
            elif response.status_code == 404:
                # Server not registered in API - this is expected for new servers
                logger.debug(
                    "Server not registered in API, skipping heartbeat report",
                    server_id=server_id,
                )
                return False
            else:
                logger.warning(
                    "Failed to report heartbeat to API",
                    server_id=server_id,
                    status_code=response.status_code,
                    response=response.text[:200],
                )
                return False

        except httpx.RequestError as e:
            logger.warning(
                "Network error reporting heartbeat to API",
                server_id=server_id,
                error=str(e),
            )
            return False
        except Exception:
            logger.exception(
                "Unexpected error reporting heartbeat to API",
                server_id=server_id,
            )
            return False

    def _calculate_status(self, stats: dict[str, Any] | None) -> ServerHealthStatus:
        """Calculate health status from server stats.

        Args:
            stats: Server statistics

        Returns:
            Calculated health status
        """
        if not stats:
            return ServerHealthStatus.UNKNOWN

        # Check for resource exhaustion
        cpu_util = stats.get("cpu_utilization", 0)
        mem_util = stats.get("memory_utilization", 0)

        if cpu_util > 95 or mem_util > 95:
            return ServerHealthStatus.DEGRADED

        if cpu_util > 80 or mem_util > 85:
            return ServerHealthStatus.HEALTHY  # Still healthy but approaching limits

        return ServerHealthStatus.HEALTHY

    async def _heartbeat_loop(self) -> None:
        """Main heartbeat loop - runs periodically.

        Uses distributed locking so only one worker runs each cycle.
        """
        while self._running:
            try:
                # Distributed lock: only one worker runs per cycle
                if not await try_acquire_task_lock("heartbeat", ttl_seconds=60):
                    # Another worker is handling this cycle, just wait
                    await asyncio.sleep(self._config.interval_seconds)
                    continue

                try:
                    self._heartbeat_count += 1

                    # Check all servers
                    await self.check_all_servers()

                    # Mark stale servers
                    self._mark_stale_servers()

                    # Check workspace containers periodically (every N heartbeats)
                    if (
                        self._config.check_workspace_containers
                        and self._heartbeat_count % self._config.workspace_check_interval_multiplier
                        == 0
                    ):
                        await self.check_all_workspace_containers()
                finally:
                    await release_task_lock("heartbeat")

            except Exception:
                logger.exception("Error in heartbeat loop")

            # Wait for next interval
            await asyncio.sleep(self._config.interval_seconds)

    def _mark_stale_servers(self) -> None:
        """Mark servers as unreachable if heartbeat is stale."""
        now = datetime.now(UTC)
        stale_threshold = timedelta(seconds=self._config.stale_threshold_seconds)

        for server_id, health in self._health_status.items():
            if (now - health.last_heartbeat) > stale_threshold:
                if health.status != ServerHealthStatus.UNREACHABLE:
                    logger.warning(
                        "Server marked as stale",
                        server_id=server_id,
                        seconds_since_heartbeat=health.seconds_since_heartbeat,
                    )
                    self._health_status[server_id] = ServerHealth(
                        server_id=server_id,
                        status=ServerHealthStatus.UNREACHABLE,
                        last_heartbeat=health.last_heartbeat,
                        consecutive_failures=health.consecutive_failures,
                        last_error="Heartbeat stale - server unreachable",
                        metrics=health.metrics,
                    )

    async def _notify_status_change(
        self,
        server_id: str,
        old_health: ServerHealth,
        new_health: ServerHealth,
    ) -> None:
        """Notify callbacks of health status change.

        Args:
            server_id: Server ID
            old_health: Previous health status
            new_health: New health status
        """
        logger.info(
            "Server health status changed",
            server_id=server_id,
            old_status=old_health.status.value,
            new_status=new_health.status.value,
            consecutive_failures=new_health.consecutive_failures,
        )

        for callback in self._callbacks:
            try:
                await callback(server_id, old_health, new_health)
            except Exception:
                logger.exception(
                    "Heartbeat callback failed",
                    server_id=server_id,
                    callback=str(callback),
                )


# Type alias for heartbeat callbacks
from collections.abc import Awaitable, Callable

HeartbeatCallback = Callable[[str, ServerHealth, ServerHealth], Awaitable[None]]


# Global heartbeat service instance
_heartbeat_service: HeartbeatService | None = None


def get_heartbeat_service() -> HeartbeatService | None:
    """Get the global heartbeat service instance.

    Returns None if not initialized. Use init_heartbeat_service() to initialize.
    """
    return _heartbeat_service


def init_heartbeat_service(
    docker_manager: MultiServerDockerManager,
    config: HeartbeatConfig | None = None,
    api_base_url: str | None = None,
    api_token: str | None = None,
    workspace_store: WorkspaceStore | None = None,
) -> HeartbeatService:
    """Initialize the global heartbeat service instance.

    Args:
        docker_manager: Multi-server Docker client
        config: Optional heartbeat configuration
        api_base_url: Base URL for the API service (for reporting heartbeats)
        api_token: Authentication token for API calls
        workspace_store: Optional workspace store for updating workspace status

    Returns:
        The initialized heartbeat service
    """
    global _heartbeat_service
    _heartbeat_service = HeartbeatService(
        docker_manager=docker_manager,
        config=config,
        api_base_url=api_base_url,
        api_token=api_token,
        workspace_store=workspace_store,
    )
    return _heartbeat_service
