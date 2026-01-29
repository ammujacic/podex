"""Workspace placement service for multi-server orchestration.

This module implements placement algorithms for deciding which server
should host a new workspace based on resource requirements and server capacity.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import TYPE_CHECKING, Any

import structlog

if TYPE_CHECKING:
    pass

logger = structlog.get_logger()


class PlacementStrategy(str, Enum):
    """Placement strategy options."""

    SPREAD = "spread"  # Distribute evenly across servers (default)
    BEST_FIT = "best_fit"  # Use server with least remaining resources after placement
    AFFINITY = "affinity"  # Place on same server as related workspaces
    ROUND_ROBIN = "round_robin"  # Simple round-robin distribution


@dataclass
class ResourceRequirements:
    """Resource requirements for a workspace."""

    cpu: float  # CPU cores (can be fractional)
    memory_mb: int  # Memory in MB
    disk_gb: int  # Disk in GB
    gpu_required: bool = False
    gpu_type: str | None = None
    architecture: str | None = None  # arm64, amd64


@dataclass
class ServerCapacity:
    """Server capacity information."""

    server_id: str
    hostname: str
    total_cpu: int
    total_memory_mb: int
    total_disk_gb: int
    used_cpu: float
    used_memory_mb: int
    used_disk_gb: int
    active_workspaces: int
    has_gpu: bool
    gpu_type: str | None
    gpu_count: int
    architecture: str
    region: str | None
    status: str
    labels: dict[str, Any]

    @property
    def available_cpu(self) -> float:
        """Get available CPU cores."""
        return max(0, self.total_cpu - self.used_cpu)

    @property
    def available_memory_mb(self) -> int:
        """Get available memory in MB."""
        return max(0, self.total_memory_mb - self.used_memory_mb)

    @property
    def available_disk_gb(self) -> int:
        """Get available disk space in GB."""
        return max(0, self.total_disk_gb - self.used_disk_gb)

    @property
    def cpu_utilization(self) -> float:
        """Get CPU utilization as a percentage (0-100)."""
        if self.total_cpu == 0:
            return 100
        return (self.used_cpu / self.total_cpu) * 100

    @property
    def memory_utilization(self) -> float:
        """Get memory utilization as a percentage (0-100)."""
        if self.total_memory_mb == 0:
            return 100
        return (self.used_memory_mb / self.total_memory_mb) * 100

    def can_fit(self, requirements: ResourceRequirements) -> bool:
        """Check if server can fit the workspace requirements."""
        if self.status != "active":
            return False

        if self.available_cpu < requirements.cpu:
            return False

        if self.available_memory_mb < requirements.memory_mb:
            return False

        if self.available_disk_gb < requirements.disk_gb:
            return False

        if requirements.gpu_required:
            if not self.has_gpu or self.gpu_count <= 0:
                return False
            if requirements.gpu_type and self.gpu_type != requirements.gpu_type:
                return False

        if requirements.architecture and self.architecture != requirements.architecture:
            return False

        return True


@dataclass
class PlacementResult:
    """Result of placement decision."""

    server_id: str | None
    hostname: str | None
    success: bool
    reason: str
    score: float = 0.0


class PlacementService:
    """Service for making workspace placement decisions.

    Implements multiple placement strategies:
    - SPREAD: Distribute workspaces evenly to balance load
    - BEST_FIT: Pack workspaces tightly to maximize utilization
    - AFFINITY: Keep related workspaces together
    - ROUND_ROBIN: Simple sequential distribution
    """

    def __init__(self, default_strategy: PlacementStrategy = PlacementStrategy.SPREAD) -> None:
        """Initialize placement service.

        Args:
            default_strategy: Default placement strategy to use
        """
        self.default_strategy = default_strategy
        self._round_robin_index = 0

    def find_placement(
        self,
        servers: list[ServerCapacity],
        requirements: ResourceRequirements,
        strategy: PlacementStrategy | None = None,
        affinity_server_id: str | None = None,
        preferred_region: str | None = None,
    ) -> PlacementResult:
        """Find the best server for workspace placement.

        Args:
            servers: List of available servers with capacity info
            requirements: Resource requirements for the workspace
            strategy: Placement strategy (uses default if not specified)
            affinity_server_id: Preferred server for AFFINITY strategy
            preferred_region: Preferred region for placement

        Returns:
            PlacementResult with selected server or failure reason
        """
        strategy = strategy or self.default_strategy

        if not servers:
            return PlacementResult(
                server_id=None,
                hostname=None,
                success=False,
                reason="No servers available",
            )

        # Filter to eligible servers
        eligible = [s for s in servers if s.can_fit(requirements)]

        if not eligible:
            return PlacementResult(
                server_id=None,
                hostname=None,
                success=False,
                reason="No server has sufficient resources",
            )

        # Apply region preference if specified
        if preferred_region:
            regional = [s for s in eligible if s.region == preferred_region]
            if regional:
                eligible = regional

        # Apply placement strategy
        if strategy == PlacementStrategy.SPREAD:
            return self._spread_placement(eligible, requirements)
        elif strategy == PlacementStrategy.BEST_FIT:
            return self._best_fit_placement(eligible, requirements)
        elif strategy == PlacementStrategy.AFFINITY:
            return self._affinity_placement(eligible, requirements, affinity_server_id)
        elif strategy == PlacementStrategy.ROUND_ROBIN:
            return self._round_robin_placement(eligible)
        else:
            # Default to spread
            return self._spread_placement(eligible, requirements)

    def _spread_placement(
        self,
        servers: list[ServerCapacity],
        requirements: ResourceRequirements,
    ) -> PlacementResult:
        """SPREAD: Place on server with lowest utilization.

        This distributes workspaces evenly across servers to balance load.
        The score is based on average utilization (CPU + memory).
        """
        # Score servers by how much headroom they'll have after placement
        scored: list[tuple[ServerCapacity, float]] = []

        for server in servers:
            # Calculate utilization after placement
            new_cpu_util = ((server.used_cpu + requirements.cpu) / server.total_cpu) * 100
            new_mem_util = ((server.used_memory_mb + requirements.memory_mb) / server.total_memory_mb) * 100

            # Lower utilization = better (higher score)
            avg_util = (new_cpu_util + new_mem_util) / 2
            score = 100 - avg_util  # Higher score for lower utilization

            scored.append((server, score))

        # Sort by score (highest first)
        scored.sort(key=lambda x: x[1], reverse=True)
        best = scored[0]

        logger.debug(
            "SPREAD placement decision",
            selected_server=best[0].hostname,
            score=best[1],
            candidates=len(servers),
        )

        return PlacementResult(
            server_id=best[0].server_id,
            hostname=best[0].hostname,
            success=True,
            reason="Selected server with lowest utilization",
            score=best[1],
        )

    def _best_fit_placement(
        self,
        servers: list[ServerCapacity],
        requirements: ResourceRequirements,
    ) -> PlacementResult:
        """BEST_FIT: Place on server with least remaining resources after placement.

        This maximizes utilization by packing workspaces tightly.
        Useful for cost optimization when servers are metered.
        """
        scored: list[tuple[ServerCapacity, float]] = []

        for server in servers:
            # Calculate remaining resources after placement
            remaining_cpu = server.available_cpu - requirements.cpu
            remaining_mem = server.available_memory_mb - requirements.memory_mb

            # Normalize to percentages
            remaining_cpu_pct = (remaining_cpu / server.total_cpu) * 100 if server.total_cpu else 100
            remaining_mem_pct = (remaining_mem / server.total_memory_mb) * 100 if server.total_memory_mb else 100

            # Lower remaining = better (higher score for best fit)
            avg_remaining = (remaining_cpu_pct + remaining_mem_pct) / 2
            score = 100 - avg_remaining  # Higher score for tighter fit

            scored.append((server, score))

        # Sort by score (highest first = tightest fit)
        scored.sort(key=lambda x: x[1], reverse=True)
        best = scored[0]

        logger.debug(
            "BEST_FIT placement decision",
            selected_server=best[0].hostname,
            score=best[1],
            candidates=len(servers),
        )

        return PlacementResult(
            server_id=best[0].server_id,
            hostname=best[0].hostname,
            success=True,
            reason="Selected server for best resource fit",
            score=best[1],
        )

    def _affinity_placement(
        self,
        servers: list[ServerCapacity],
        requirements: ResourceRequirements,
        affinity_server_id: str | None,
    ) -> PlacementResult:
        """AFFINITY: Prefer placing on specific server or fall back to spread.

        This is useful for keeping related workspaces together (e.g., same user,
        same project, or same organization) to reduce network latency.
        """
        if affinity_server_id:
            # Try to use the preferred server
            for server in servers:
                if server.server_id == affinity_server_id:
                    logger.debug(
                        "AFFINITY placement: using preferred server",
                        server_id=affinity_server_id,
                        hostname=server.hostname,
                    )
                    return PlacementResult(
                        server_id=server.server_id,
                        hostname=server.hostname,
                        success=True,
                        reason="Placed on preferred affinity server",
                        score=100,
                    )

            logger.debug(
                "AFFINITY placement: preferred server not available, falling back to spread",
                preferred_server_id=affinity_server_id,
            )

        # Fall back to spread if no affinity or affinity server not available
        result = self._spread_placement(servers, requirements)
        result.reason = "Affinity server unavailable, used spread placement"
        return result

    def _round_robin_placement(self, servers: list[ServerCapacity]) -> PlacementResult:
        """ROUND_ROBIN: Simple sequential distribution.

        Simple round-robin across available servers. This ensures
        even distribution without considering current utilization.
        """
        # Sort servers by ID for consistent ordering
        sorted_servers = sorted(servers, key=lambda s: s.server_id)

        # Get next server in sequence
        index = self._round_robin_index % len(sorted_servers)
        server = sorted_servers[index]

        # Update index for next call
        self._round_robin_index += 1

        logger.debug(
            "ROUND_ROBIN placement decision",
            selected_server=server.hostname,
            index=index,
            candidates=len(servers),
        )

        return PlacementResult(
            server_id=server.server_id,
            hostname=server.hostname,
            success=True,
            reason=f"Round-robin selection (index {index})",
            score=50,  # Neutral score for round-robin
        )

    def get_server_scores(
        self,
        servers: list[ServerCapacity],
        requirements: ResourceRequirements,
        strategy: PlacementStrategy | None = None,
    ) -> list[dict[str, Any]]:
        """Get placement scores for all servers.

        Useful for debugging and displaying placement options.

        Args:
            servers: List of servers to score
            requirements: Resource requirements
            strategy: Strategy to use for scoring

        Returns:
            List of dicts with server info and scores
        """
        strategy = strategy or self.default_strategy
        results: list[dict[str, Any]] = []

        for server in servers:
            can_fit = server.can_fit(requirements)

            if not can_fit:
                results.append(
                    {
                        "server_id": server.server_id,
                        "hostname": server.hostname,
                        "can_fit": False,
                        "score": 0,
                        "reason": "Insufficient resources",
                    }
                )
                continue

            # Calculate score based on strategy
            if strategy == PlacementStrategy.SPREAD:
                new_cpu_util = ((server.used_cpu + requirements.cpu) / server.total_cpu) * 100
                new_mem_util = ((server.used_memory_mb + requirements.memory_mb) / server.total_memory_mb) * 100
                score = 100 - (new_cpu_util + new_mem_util) / 2
            elif strategy == PlacementStrategy.BEST_FIT:
                remaining_cpu = server.available_cpu - requirements.cpu
                remaining_mem = server.available_memory_mb - requirements.memory_mb
                remaining_cpu_pct = (remaining_cpu / server.total_cpu) * 100
                remaining_mem_pct = (remaining_mem / server.total_memory_mb) * 100
                score = 100 - (remaining_cpu_pct + remaining_mem_pct) / 2
            else:
                score = 50  # Neutral for other strategies

            results.append(
                {
                    "server_id": server.server_id,
                    "hostname": server.hostname,
                    "can_fit": True,
                    "score": round(score, 2),
                    "cpu_utilization": round(server.cpu_utilization, 2),
                    "memory_utilization": round(server.memory_utilization, 2),
                    "active_workspaces": server.active_workspaces,
                }
            )

        # Sort by score descending
        results.sort(key=lambda x: x.get("score", 0), reverse=True)
        return results


# Global placement service instance
_placement_service: PlacementService | None = None


def get_placement_service() -> PlacementService:
    """Get the global placement service instance."""
    global _placement_service
    if _placement_service is None:
        _placement_service = PlacementService()
    return _placement_service
