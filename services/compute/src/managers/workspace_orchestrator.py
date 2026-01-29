"""Workspace Orchestrator for multi-server container management.

This module coordinates workspace lifecycle across multiple Docker servers,
integrating placement decisions, server health, and container management.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

import structlog

from src.managers.placement import (
    PlacementService,
    PlacementStrategy,
    ResourceRequirements,
    ServerCapacity,
    get_placement_service,
)
from src.models.workspace import (
    WorkspaceConfig,
    WorkspaceExecResponse,
    WorkspaceInfo,
    WorkspaceStatus,
    WorkspaceTier,
)

if TYPE_CHECKING:
    from src.managers.multi_server_docker import ContainerSpec, MultiServerDockerManager
    from src.storage.workspace_store import WorkspaceStore

logger = structlog.get_logger()


# Tier to resource requirements mapping
TIER_RESOURCES: dict[WorkspaceTier, ResourceRequirements] = {
    WorkspaceTier.FREE: ResourceRequirements(cpu=0.5, memory_mb=512, disk_gb=5),
    WorkspaceTier.STARTER: ResourceRequirements(cpu=1.0, memory_mb=1024, disk_gb=10),
    WorkspaceTier.PRO: ResourceRequirements(cpu=2.0, memory_mb=4096, disk_gb=20),
    WorkspaceTier.TEAM: ResourceRequirements(cpu=4.0, memory_mb=8192, disk_gb=50),
    WorkspaceTier.ENTERPRISE: ResourceRequirements(cpu=8.0, memory_mb=16384, disk_gb=100),
}


@dataclass
class OrchestrationResult:
    """Result of an orchestration operation."""

    success: bool
    workspace_id: str | None = None
    server_id: str | None = None
    container_id: str | None = None
    message: str = ""
    details: dict[str, Any] | None = None


class WorkspaceOrchestrator:
    """Orchestrates workspace operations across multiple servers.

    Responsibilities:
    - Workspace creation with placement decisions
    - Container lifecycle management
    - Server selection and load balancing
    - Resource tracking and quota enforcement
    """

    def __init__(
        self,
        docker_manager: MultiServerDockerManager,
        workspace_store: WorkspaceStore | None = None,
        placement_service: PlacementService | None = None,
    ) -> None:
        """Initialize the workspace orchestrator.

        Args:
            docker_manager: Multi-server Docker client
            workspace_store: Optional workspace persistence store
            placement_service: Optional placement service (creates default if not provided)
        """
        self._docker = docker_manager
        self._workspace_store = workspace_store
        self._placement = placement_service or get_placement_service()

    async def get_server_capacities(self) -> list[ServerCapacity]:
        """Get capacity information for all registered servers.

        Returns:
            List of ServerCapacity objects for all servers
        """
        capacities: list[ServerCapacity] = []

        for server_id in self._docker.servers:
            try:
                stats = await self._docker.get_server_stats(server_id)
                if not stats:
                    continue

                # Build ServerCapacity from stats
                capacity = ServerCapacity(
                    server_id=server_id,
                    hostname=stats.get("hostname", server_id),
                    total_cpu=stats.get("total_cpu", 0),
                    total_memory_mb=stats.get("total_memory_mb", 0),
                    total_disk_gb=stats.get("total_disk_gb", 0),
                    used_cpu=stats.get("used_cpu", 0.0),
                    used_memory_mb=stats.get("used_memory_mb", 0),
                    used_disk_gb=stats.get("used_disk_gb", 0),
                    active_workspaces=stats.get("active_workspaces", 0),
                    has_gpu=stats.get("has_gpu", False),
                    gpu_type=stats.get("gpu_type"),
                    gpu_count=stats.get("gpu_count", 0),
                    architecture=stats.get("architecture", "amd64"),
                    region=stats.get("region"),
                    status=stats.get("status", "active"),
                    labels=stats.get("labels", {}),
                )
                capacities.append(capacity)

            except Exception:
                logger.exception("Failed to get server capacity", server_id=server_id)
                continue

        return capacities

    async def create_workspace(
        self,
        user_id: str,
        session_id: str,
        config: WorkspaceConfig,
        workspace_id: str | None = None,
        placement_strategy: PlacementStrategy | None = None,
        affinity_server_id: str | None = None,
        preferred_region: str | None = None,
    ) -> OrchestrationResult:
        """Create a new workspace with automatic server placement.

        Args:
            user_id: Owner user ID
            session_id: Session ID
            config: Workspace configuration
            workspace_id: Optional workspace ID (generated if not provided)
            placement_strategy: Placement strategy to use
            affinity_server_id: Preferred server for affinity placement
            preferred_region: Preferred region for placement

        Returns:
            OrchestrationResult with creation status
        """
        import uuid

        workspace_id = workspace_id or str(uuid.uuid4())

        logger.info(
            "Creating workspace",
            workspace_id=workspace_id[:12],
            user_id=user_id,
            tier=config.tier.value,
        )

        # Get resource requirements for tier
        requirements = TIER_RESOURCES.get(
            config.tier,
            ResourceRequirements(cpu=1.0, memory_mb=1024, disk_gb=10),
        )

        # Check for GPU requirements
        if config.gpu_enabled:
            requirements = ResourceRequirements(
                cpu=requirements.cpu,
                memory_mb=requirements.memory_mb,
                disk_gb=requirements.disk_gb,
                gpu_required=True,
                gpu_type=config.gpu_type,
            )

        # Get server capacities
        servers = await self.get_server_capacities()

        if not servers:
            return OrchestrationResult(
                success=False,
                workspace_id=workspace_id,
                message="No servers available for workspace creation",
            )

        # Find placement
        placement = self._placement.find_placement(
            servers=servers,
            requirements=requirements,
            strategy=placement_strategy,
            affinity_server_id=affinity_server_id,
            preferred_region=preferred_region,
        )

        if not placement.success or not placement.server_id:
            return OrchestrationResult(
                success=False,
                workspace_id=workspace_id,
                message=placement.reason,
            )

        logger.info(
            "Placement decision made",
            workspace_id=workspace_id[:12],
            server_id=placement.server_id,
            hostname=placement.hostname,
            score=placement.score,
        )

        # Create container spec
        from src.managers.multi_server_docker import ContainerSpec

        container_spec = ContainerSpec(
            name=f"workspace-{workspace_id[:12]}",
            image=config.image or "podex/workspace:latest",
            cpu_limit=requirements.cpu,
            memory_limit_mb=requirements.memory_mb,
            environment={
                "WORKSPACE_ID": workspace_id,
                "USER_ID": user_id,
                "SESSION_ID": session_id,
                "WORKSPACE_TIER": config.tier.value,
                **(config.environment or {}),
            },
            labels={
                "podex.workspace_id": workspace_id,
                "podex.user_id": user_id,
                "podex.session_id": session_id,
                "podex.tier": config.tier.value,
            },
            volumes=[],  # Volumes configured based on persistence settings
            network_mode="bridge",
        )

        # Create the container
        try:
            container = await self._docker.create_container(
                server_id=placement.server_id,
                spec=container_spec,
            )
        except Exception as e:
            logger.exception(
                "Failed to create container",
                workspace_id=workspace_id[:12],
                server_id=placement.server_id,
            )
            return OrchestrationResult(
                success=False,
                workspace_id=workspace_id,
                server_id=placement.server_id,
                message=f"Container creation failed: {e}",
            )

        # Create workspace info
        workspace = WorkspaceInfo(
            id=workspace_id,
            user_id=user_id,
            session_id=session_id,
            status=WorkspaceStatus.RUNNING,
            tier=config.tier,
            created_at=datetime.now(UTC),
            last_activity=datetime.now(UTC),
            image=config.image or "podex/workspace:latest",
            repositories=config.repositories or [],
            environment=config.environment or {},
            server_id=placement.server_id,
            container_id=container.id,
        )

        # Persist workspace
        if self._workspace_store:
            await self._workspace_store.save(workspace)

        logger.info(
            "Workspace created successfully",
            workspace_id=workspace_id[:12],
            server_id=placement.server_id,
            container_id=container.id[:12],
        )

        return OrchestrationResult(
            success=True,
            workspace_id=workspace_id,
            server_id=placement.server_id,
            container_id=container.id,
            message="Workspace created successfully",
            details={
                "hostname": placement.hostname,
                "tier": config.tier.value,
                "cpu": requirements.cpu,
                "memory_mb": requirements.memory_mb,
            },
        )

    async def stop_workspace(self, workspace_id: str) -> OrchestrationResult:
        """Stop a running workspace.

        Args:
            workspace_id: Workspace ID to stop

        Returns:
            OrchestrationResult with stop status
        """
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            return OrchestrationResult(
                success=False,
                workspace_id=workspace_id,
                message="Workspace not found",
            )

        if not workspace.server_id or not workspace.container_id:
            return OrchestrationResult(
                success=False,
                workspace_id=workspace_id,
                message="Workspace has no assigned server or container",
            )

        try:
            await self._docker.stop_container(workspace.server_id, workspace.container_id)

            # Update workspace status
            workspace.status = WorkspaceStatus.STOPPED
            if self._workspace_store:
                await self._workspace_store.save(workspace)

            logger.info(
                "Workspace stopped",
                workspace_id=workspace_id[:12],
                server_id=workspace.server_id,
            )

            return OrchestrationResult(
                success=True,
                workspace_id=workspace_id,
                server_id=workspace.server_id,
                container_id=workspace.container_id,
                message="Workspace stopped successfully",
            )

        except Exception as e:
            logger.exception("Failed to stop workspace", workspace_id=workspace_id[:12])
            return OrchestrationResult(
                success=False,
                workspace_id=workspace_id,
                server_id=workspace.server_id,
                message=f"Failed to stop workspace: {e}",
            )

    async def start_workspace(self, workspace_id: str) -> OrchestrationResult:
        """Start a stopped workspace.

        Args:
            workspace_id: Workspace ID to start

        Returns:
            OrchestrationResult with start status
        """
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            return OrchestrationResult(
                success=False,
                workspace_id=workspace_id,
                message="Workspace not found",
            )

        if not workspace.server_id or not workspace.container_id:
            return OrchestrationResult(
                success=False,
                workspace_id=workspace_id,
                message="Workspace has no assigned server or container",
            )

        try:
            await self._docker.start_container(workspace.server_id, workspace.container_id)

            # Update workspace status
            workspace.status = WorkspaceStatus.RUNNING
            workspace.last_activity = datetime.now(UTC)
            if self._workspace_store:
                await self._workspace_store.save(workspace)

            logger.info(
                "Workspace started",
                workspace_id=workspace_id[:12],
                server_id=workspace.server_id,
            )

            return OrchestrationResult(
                success=True,
                workspace_id=workspace_id,
                server_id=workspace.server_id,
                container_id=workspace.container_id,
                message="Workspace started successfully",
            )

        except Exception as e:
            logger.exception("Failed to start workspace", workspace_id=workspace_id[:12])
            return OrchestrationResult(
                success=False,
                workspace_id=workspace_id,
                server_id=workspace.server_id,
                message=f"Failed to start workspace: {e}",
            )

    async def delete_workspace(
        self,
        workspace_id: str,
        *,
        preserve_data: bool = False,
    ) -> OrchestrationResult:
        """Delete a workspace and its container.

        Args:
            workspace_id: Workspace ID to delete
            preserve_data: If True, preserve workspace data volumes

        Returns:
            OrchestrationResult with deletion status
        """
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            return OrchestrationResult(
                success=False,
                workspace_id=workspace_id,
                message="Workspace not found",
            )

        server_id = workspace.server_id
        container_id = workspace.container_id

        # Remove container if exists
        if server_id and container_id:
            try:
                await self._docker.remove_container(
                    server_id,
                    container_id,
                    force=True,
                    remove_volumes=not preserve_data,
                )
            except Exception:
                logger.exception(
                    "Failed to remove container, continuing with cleanup",
                    workspace_id=workspace_id[:12],
                )

        # Remove from store
        if self._workspace_store:
            await self._workspace_store.delete(workspace_id)

        logger.info(
            "Workspace deleted",
            workspace_id=workspace_id[:12],
            server_id=server_id,
            preserve_data=preserve_data,
        )

        return OrchestrationResult(
            success=True,
            workspace_id=workspace_id,
            server_id=server_id,
            container_id=container_id,
            message="Workspace deleted successfully",
        )

    async def exec_command(
        self,
        workspace_id: str,
        command: str,
        working_dir: str | None = None,
        timeout: int = 30,
    ) -> WorkspaceExecResponse:
        """Execute a command in a workspace container.

        Args:
            workspace_id: Workspace ID
            command: Command to execute
            working_dir: Working directory for command
            timeout: Command timeout in seconds

        Returns:
            Command execution response
        """
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            return WorkspaceExecResponse(
                exit_code=-1,
                stdout="",
                stderr="Workspace not found",
            )

        if not workspace.server_id or not workspace.container_id:
            return WorkspaceExecResponse(
                exit_code=-1,
                stdout="",
                stderr="Workspace has no assigned server or container",
            )

        if workspace.status != WorkspaceStatus.RUNNING:
            return WorkspaceExecResponse(
                exit_code=-1,
                stdout="",
                stderr=f"Workspace is not running (status: {workspace.status.value})",
            )

        try:
            exit_code, stdout, stderr = await self._docker.run_in_container(
                server_id=workspace.server_id,
                container_id=workspace.container_id,
                command=command,
                working_dir=working_dir or "/home/dev",
                timeout=timeout,
            )

            # Update activity timestamp
            workspace.last_activity = datetime.now(UTC)
            if self._workspace_store:
                await self._workspace_store.save(workspace)

            return WorkspaceExecResponse(
                exit_code=exit_code,
                stdout=stdout,
                stderr=stderr,
            )

        except Exception as e:
            logger.exception(
                "Command execution failed",
                workspace_id=workspace_id[:12],
                command=command[:50],
            )
            return WorkspaceExecResponse(
                exit_code=-1,
                stdout="",
                stderr=f"Command execution failed: {e}",
            )

    async def check_workspace_health(self, workspace_id: str) -> bool:
        """Check if a workspace is healthy.

        Args:
            workspace_id: Workspace ID to check

        Returns:
            True if workspace is healthy, False otherwise
        """
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            return False

        if not workspace.server_id or not workspace.container_id:
            return False

        if workspace.status != WorkspaceStatus.RUNNING:
            return False

        try:
            # Run a simple health check command
            result = await self.exec_command(
                workspace_id,
                "echo healthy",
                timeout=10,
            )
            return result.exit_code == 0 and "healthy" in result.stdout

        except Exception:
            logger.exception("Health check failed", workspace_id=workspace_id[:12])
            return False

    async def migrate_workspace(
        self,
        workspace_id: str,
        target_server_id: str,
    ) -> OrchestrationResult:
        """Migrate a workspace to a different server.

        This is a cold migration - the workspace is stopped, moved, and restarted.

        Args:
            workspace_id: Workspace ID to migrate
            target_server_id: Target server ID

        Returns:
            OrchestrationResult with migration status
        """
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            return OrchestrationResult(
                success=False,
                workspace_id=workspace_id,
                message="Workspace not found",
            )

        source_server = workspace.server_id
        if source_server == target_server_id:
            return OrchestrationResult(
                success=True,
                workspace_id=workspace_id,
                server_id=target_server_id,
                message="Workspace already on target server",
            )

        # Stop the workspace
        stop_result = await self.stop_workspace(workspace_id)
        if not stop_result.success:
            return OrchestrationResult(
                success=False,
                workspace_id=workspace_id,
                message=f"Failed to stop workspace for migration: {stop_result.message}",
            )

        # TODO: Implement container image commit and transfer
        # For now, we just update the workspace to point to the new server
        # In production, this would involve:
        # 1. Committing the container to an image
        # 2. Pushing the image to a registry
        # 3. Pulling the image on the target server
        # 4. Creating a new container on the target server

        logger.warning(
            "Workspace migration is a placeholder - full implementation needed",
            workspace_id=workspace_id[:12],
            source_server=source_server,
            target_server=target_server_id,
        )

        return OrchestrationResult(
            success=False,
            workspace_id=workspace_id,
            message="Workspace migration not yet fully implemented",
        )

    async def get_cluster_status(self) -> dict[str, Any]:
        """Get overall cluster status.

        Returns:
            Dict with cluster-wide statistics
        """
        servers = await self.get_server_capacities()

        total_cpu = sum(s.total_cpu for s in servers)
        used_cpu = sum(s.used_cpu for s in servers)
        total_memory = sum(s.total_memory_mb for s in servers)
        used_memory = sum(s.used_memory_mb for s in servers)
        total_workspaces = sum(s.active_workspaces for s in servers)

        active_servers = len([s for s in servers if s.status == "active"])
        healthy_servers = len([s for s in servers if s.status in ("active", "draining")])

        return {
            "servers": {
                "total": len(servers),
                "active": active_servers,
                "healthy": healthy_servers,
            },
            "resources": {
                "total_cpu": total_cpu,
                "used_cpu": round(used_cpu, 2),
                "cpu_utilization": round((used_cpu / total_cpu * 100) if total_cpu else 0, 2),
                "total_memory_mb": total_memory,
                "used_memory_mb": used_memory,
                "memory_utilization": round((used_memory / total_memory * 100) if total_memory else 0, 2),
            },
            "workspaces": {
                "total": total_workspaces,
            },
            "placement_strategy": self._placement.default_strategy.value,
        }

    async def _get_workspace(self, workspace_id: str) -> WorkspaceInfo | None:
        """Get workspace from store.

        Args:
            workspace_id: Workspace ID

        Returns:
            WorkspaceInfo if found, None otherwise
        """
        if self._workspace_store:
            return await self._workspace_store.get(workspace_id)
        return None


# Global orchestrator instance
_orchestrator: WorkspaceOrchestrator | None = None


def get_orchestrator() -> WorkspaceOrchestrator | None:
    """Get the global orchestrator instance.

    Returns None if not initialized. Use init_orchestrator() to initialize.
    """
    return _orchestrator


def init_orchestrator(
    docker_manager: MultiServerDockerManager,
    workspace_store: WorkspaceStore | None = None,
    placement_service: PlacementService | None = None,
) -> WorkspaceOrchestrator:
    """Initialize the global orchestrator instance.

    Args:
        docker_manager: Multi-server Docker client
        workspace_store: Optional workspace persistence store
        placement_service: Optional placement service

    Returns:
        The initialized orchestrator
    """
    global _orchestrator
    _orchestrator = WorkspaceOrchestrator(
        docker_manager=docker_manager,
        workspace_store=workspace_store,
        placement_service=placement_service,
    )
    return _orchestrator
