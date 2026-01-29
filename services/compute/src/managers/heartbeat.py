"""Server Heartbeat Service for multi-server health monitoring.

This module implements health monitoring and heartbeat management for
workspace servers in the multi-server orchestration system.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from enum import Enum
from typing import TYPE_CHECKING, Any

import structlog

if TYPE_CHECKING:
    from src.managers.multi_server_docker import MultiServerDockerManager

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


class HeartbeatService:
    """Service for monitoring server health via heartbeats.

    Periodically checks server health and maintains health status
    for the multi-server orchestration system.
    """

    def __init__(
        self,
        docker_manager: MultiServerDockerManager,
        config: HeartbeatConfig | None = None,
    ) -> None:
        """Initialize heartbeat service.

        Args:
            docker_manager: Multi-server Docker client for health checks
            config: Optional heartbeat configuration
        """
        self._docker = docker_manager
        self._config = config or HeartbeatConfig()
        self._health_status: dict[str, ServerHealth] = {}
        self._running = False
        self._task: asyncio.Task[None] | None = None
        self._callbacks: list[HeartbeatCallback] = []

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
        return [
            server_id
            for server_id, health in self._health_status.items()
            if health.is_healthy
        ]

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
        self._task = asyncio.create_task(self._heartbeat_loop())

        logger.info(
            "Heartbeat service started",
            interval_seconds=self._config.interval_seconds,
            failure_threshold=self._config.failure_threshold,
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

        except asyncio.TimeoutError:
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
        """Main heartbeat loop - runs periodically."""
        while self._running:
            try:
                await self.check_all_servers()

                # Mark stale servers
                self._mark_stale_servers()

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
HeartbeatCallback = type[
    None
]  # Placeholder - actual type is Callable[[str, ServerHealth, ServerHealth], Awaitable[None]]

# For proper typing:
from typing import Callable, Awaitable

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
) -> HeartbeatService:
    """Initialize the global heartbeat service instance.

    Args:
        docker_manager: Multi-server Docker client
        config: Optional heartbeat configuration

    Returns:
        The initialized heartbeat service
    """
    global _heartbeat_service
    _heartbeat_service = HeartbeatService(
        docker_manager=docker_manager,
        config=config,
    )
    return _heartbeat_service
