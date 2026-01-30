"""Server management API routes for multi-server orchestration.

This module provides endpoints for managing workspace servers,
including registration, health monitoring, and capacity management.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import structlog
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.config import settings
from src.database.models import (
    HardwareSpec,
    ServerStatus,
    Session,
    Workspace,
    WorkspaceServer,
)
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter
from src.routes.dependencies import DbSession, get_current_user_id

logger = structlog.get_logger()
router = APIRouter()


# ============== Pydantic Models ==============


class ServerRegisterRequest(BaseModel):
    """Request to register a new workspace server."""

    name: str = Field(..., min_length=1, max_length=255)
    hostname: str = Field(..., min_length=1, max_length=255)
    ip_address: str = Field(..., pattern=r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$")
    docker_port: int = Field(default=2376, ge=1, le=65535)
    total_cpu: int = Field(..., ge=1)
    total_memory_mb: int = Field(..., ge=512)
    total_disk_gb: int = Field(..., ge=1)
    total_bandwidth_mbps: int = Field(default=1000, ge=1)  # 1 Gbps default
    architecture: str = Field(default="amd64", pattern=r"^(amd64|arm64)$")
    region: str | None = None
    labels: dict[str, str] = Field(default_factory=dict)
    has_gpu: bool = False
    gpu_type: str | None = None
    gpu_count: int = 0


class ServerUpdateRequest(BaseModel):
    """Request to update a workspace server."""

    name: str | None = None
    status: str | None = Field(None, pattern=r"^(active|draining|maintenance|offline)$")
    labels: dict[str, str] | None = None
    max_workspaces: int | None = Field(None, ge=1)


class ServerResponse(BaseModel):
    """Response containing server information."""

    id: str
    name: str
    hostname: str
    ip_address: str
    docker_port: int
    status: str
    total_cpu: int
    total_memory_mb: int
    total_disk_gb: int
    total_bandwidth_mbps: int
    used_cpu: float
    used_memory_mb: int
    used_disk_gb: int
    used_bandwidth_mbps: int
    available_cpu: float
    available_memory_mb: int
    available_disk_gb: int
    available_bandwidth_mbps: int
    active_workspaces: int
    max_workspaces: int
    architecture: str
    region: str | None
    labels: dict[str, str]
    has_gpu: bool
    gpu_type: str | None
    gpu_count: int
    created_at: str
    last_heartbeat: str | None
    is_healthy: bool
    bandwidth_utilization: float


class ServerHealthResponse(BaseModel):
    """Response containing server health information."""

    server_id: str
    status: str
    is_healthy: bool
    last_heartbeat: str | None
    cpu_utilization: float
    memory_utilization: float
    disk_utilization: float
    bandwidth_utilization: float
    active_workspaces: int


class ClusterStatusResponse(BaseModel):
    """Response containing cluster-wide status."""

    total_servers: int
    active_servers: int
    healthy_servers: int
    total_cpu: int
    used_cpu: float
    cpu_utilization: float
    total_memory_mb: int
    used_memory_mb: int
    memory_utilization: float
    total_workspaces: int
    servers: list[ServerHealthResponse]


# ============== Helper Functions ==============


def _server_to_response(server: WorkspaceServer) -> ServerResponse:
    """Convert a WorkspaceServer model to a response."""
    return ServerResponse(
        id=server.id,
        name=server.name,
        hostname=server.hostname,
        ip_address=str(server.ip_address),
        docker_port=server.docker_port,
        status=server.status,
        total_cpu=server.total_cpu,
        total_memory_mb=server.total_memory_mb,
        total_disk_gb=server.total_disk_gb,
        total_bandwidth_mbps=server.total_bandwidth_mbps,
        used_cpu=server.used_cpu,
        used_memory_mb=server.used_memory_mb,
        used_disk_gb=server.used_disk_gb,
        used_bandwidth_mbps=server.used_bandwidth_mbps,
        available_cpu=server.available_cpu,
        available_memory_mb=server.available_memory_mb,
        available_disk_gb=server.available_disk_gb,
        available_bandwidth_mbps=server.available_bandwidth_mbps,
        active_workspaces=server.active_workspaces,
        max_workspaces=server.max_workspaces,
        architecture=server.architecture,
        region=server.region,
        labels=server.labels or {},
        has_gpu=server.has_gpu,
        gpu_type=server.gpu_type,
        gpu_count=server.gpu_count,
        created_at=server.created_at.isoformat(),
        last_heartbeat=server.last_heartbeat.isoformat() if server.last_heartbeat else None,
        is_healthy=server.is_healthy,
        bandwidth_utilization=server.bandwidth_utilization,
    )


def _require_admin(request: Request) -> str:
    """Require admin access for server management.

    In production, this should check for admin role.
    For now, we just verify the user is authenticated.
    """
    user_id = get_current_user_id(request)
    # TODO: Add proper admin role check
    # For now, allow any authenticated user in development
    if settings.ENVIRONMENT != "development":
        # TODO: In production, check admin role
        pass
    return user_id


# ============== Server Endpoints ==============


@router.get("", response_model=list[ServerResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_servers(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    status: str | None = None,
    region: str | None = None,
) -> list[ServerResponse]:
    """List all workspace servers.

    Optionally filter by status or region.
    """
    _require_admin(request)

    query = select(WorkspaceServer)

    if status:
        query = query.where(WorkspaceServer.status == status)
    if region:
        query = query.where(WorkspaceServer.region == region)

    query = query.order_by(WorkspaceServer.created_at.desc())

    result = await db.execute(query)
    servers = result.scalars().all()

    return [_server_to_response(s) for s in servers]


@router.post("", response_model=ServerResponse, status_code=201)
@limiter.limit(RATE_LIMIT_STANDARD)
async def register_server(
    request: Request,
    response: Response,  # noqa: ARG001
    data: ServerRegisterRequest,
    db: DbSession,
) -> ServerResponse:
    """Register a new workspace server."""
    _require_admin(request)

    # Check for duplicate hostname
    existing = await db.execute(
        select(WorkspaceServer).where(WorkspaceServer.hostname == data.hostname)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail=f"Server with hostname '{data.hostname}' already registered",
        )

    # Create new server with hostname as ID (matches compute service config)
    server = WorkspaceServer(
        id=data.hostname,  # Use hostname as ID for consistency with compute service
        name=data.name,
        hostname=data.hostname,
        ip_address=data.ip_address,
        docker_port=data.docker_port,
        status=ServerStatus.ACTIVE,
        total_cpu=data.total_cpu,
        total_memory_mb=data.total_memory_mb,
        total_disk_gb=data.total_disk_gb,
        total_bandwidth_mbps=data.total_bandwidth_mbps,
        used_cpu=0.0,
        used_memory_mb=0,
        used_disk_gb=0,
        used_bandwidth_mbps=0,
        active_workspaces=0,
        architecture=data.architecture,
        region=data.region,
        labels=data.labels,
        has_gpu=data.has_gpu,
        gpu_type=data.gpu_type,
        gpu_count=data.gpu_count,
        created_at=datetime.now(UTC),
        last_heartbeat=datetime.now(UTC),
    )

    db.add(server)
    await db.commit()
    await db.refresh(server)

    logger.info(
        "Server registered",
        server_id=server.id,
        hostname=server.hostname,
        region=server.region,
    )

    return _server_to_response(server)


@router.get("/{server_id}", response_model=ServerResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_server(
    server_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> ServerResponse:
    """Get a specific workspace server."""
    _require_admin(request)

    result = await db.execute(select(WorkspaceServer).where(WorkspaceServer.id == server_id))
    server = result.scalar_one_or_none()

    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    return _server_to_response(server)


@router.patch("/{server_id}", response_model=ServerResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def update_server(
    server_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    data: ServerUpdateRequest,
    db: DbSession,
) -> ServerResponse:
    """Update a workspace server."""
    _require_admin(request)

    result = await db.execute(select(WorkspaceServer).where(WorkspaceServer.id == server_id))
    server = result.scalar_one_or_none()

    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    # Apply updates
    if data.name is not None:
        server.name = data.name
    if data.status is not None:
        server.status = data.status
    if data.labels is not None:
        server.labels = data.labels
    if data.max_workspaces is not None:
        server.max_workspaces = data.max_workspaces

    await db.commit()
    await db.refresh(server)

    logger.info(
        "Server updated",
        server_id=server_id,
        updates=data.model_dump(exclude_unset=True),
    )

    return _server_to_response(server)


@router.delete("/{server_id}", status_code=204)
@limiter.limit(RATE_LIMIT_STANDARD)
async def delete_server(
    server_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    *,
    force: bool = False,
) -> None:
    """Delete a workspace server.

    By default, prevents deletion if server has active workspaces.
    Use force=true to delete anyway (workspaces will be orphaned).
    """
    _require_admin(request)

    result = await db.execute(select(WorkspaceServer).where(WorkspaceServer.id == server_id))
    server = result.scalar_one_or_none()

    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    # Check for active workspaces
    if server.active_workspaces > 0 and not force:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Server has {server.active_workspaces} active workspaces. "
                "Use force=true to delete anyway."
            ),
        )

    await db.delete(server)
    await db.commit()

    logger.info(
        "Server deleted",
        server_id=server_id,
        hostname=server.hostname,
        force=force,
    )


# ============== Server Health Endpoints ==============


@router.post("/{server_id}/heartbeat", response_model=ServerHealthResponse)
@limiter.limit("60/minute")  # Allow more frequent heartbeats
async def server_heartbeat(
    server_id: str,
    request: Request,  # noqa: ARG001 - Required for rate limiter
    response: Response,  # noqa: ARG001
    db: DbSession,
    used_cpu: float = 0.0,
    used_memory_mb: int = 0,
    used_disk_gb: int = 0,
    used_bandwidth_mbps: int = 0,
    active_workspaces: int = 0,
) -> ServerHealthResponse:
    """Report server heartbeat with current resource usage.

    Called periodically by workspace servers to report health.
    The server_id can be either a UUID or a hostname.
    """
    # This endpoint can be called by the server itself, not just admins
    # In production, should verify server authentication token

    # Try to find server by UUID first, then by hostname
    # This allows compute service to use either the DB id or the hostname
    try:
        # Check if it's a valid UUID
        uuid.UUID(server_id)
        result = await db.execute(select(WorkspaceServer).where(WorkspaceServer.id == server_id))
    except ValueError:
        # Not a UUID, try hostname
        result = await db.execute(
            select(WorkspaceServer).where(WorkspaceServer.hostname == server_id)
        )
    server = result.scalar_one_or_none()

    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    # Update server stats
    server.used_cpu = used_cpu
    server.used_memory_mb = used_memory_mb
    server.used_disk_gb = used_disk_gb
    server.used_bandwidth_mbps = used_bandwidth_mbps
    server.active_workspaces = active_workspaces
    server.last_heartbeat = datetime.now(UTC)

    # Update status if it was error/offline and heartbeat received
    if server.status in (ServerStatus.ERROR, ServerStatus.OFFLINE):
        server.status = ServerStatus.ACTIVE

    await db.commit()
    await db.refresh(server)

    # Calculate utilization
    cpu_util = (server.used_cpu / server.total_cpu * 100) if server.total_cpu else 0
    mem_util = (
        (server.used_memory_mb / server.total_memory_mb * 100) if server.total_memory_mb else 0
    )
    disk_util = (server.used_disk_gb / server.total_disk_gb * 100) if server.total_disk_gb else 0
    bw_util = (
        (server.used_bandwidth_mbps / server.total_bandwidth_mbps * 100)
        if server.total_bandwidth_mbps
        else 0
    )

    return ServerHealthResponse(
        server_id=server.id,
        status=server.status,
        is_healthy=server.is_healthy,
        last_heartbeat=server.last_heartbeat.isoformat() if server.last_heartbeat else None,
        cpu_utilization=round(cpu_util, 2),
        memory_utilization=round(mem_util, 2),
        disk_utilization=round(disk_util, 2),
        bandwidth_utilization=round(bw_util, 2),
        active_workspaces=server.active_workspaces,
    )


@router.get("/{server_id}/health", response_model=ServerHealthResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_server_health(
    server_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> ServerHealthResponse:
    """Get health status for a specific server."""
    _require_admin(request)

    result = await db.execute(select(WorkspaceServer).where(WorkspaceServer.id == server_id))
    server = result.scalar_one_or_none()

    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    # Calculate utilization
    cpu_util = (server.used_cpu / server.total_cpu * 100) if server.total_cpu else 0
    mem_util = (
        (server.used_memory_mb / server.total_memory_mb * 100) if server.total_memory_mb else 0
    )
    disk_util = (server.used_disk_gb / server.total_disk_gb * 100) if server.total_disk_gb else 0
    bw_util = (
        (server.used_bandwidth_mbps / server.total_bandwidth_mbps * 100)
        if server.total_bandwidth_mbps
        else 0
    )

    return ServerHealthResponse(
        server_id=server.id,
        status=server.status,
        is_healthy=server.is_healthy,
        last_heartbeat=server.last_heartbeat.isoformat() if server.last_heartbeat else None,
        cpu_utilization=round(cpu_util, 2),
        memory_utilization=round(mem_util, 2),
        disk_utilization=round(disk_util, 2),
        bandwidth_utilization=round(bw_util, 2),
        active_workspaces=server.active_workspaces,
    )


@router.post("/{server_id}/drain", response_model=ServerResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def drain_server(
    server_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> ServerResponse:
    """Set server to draining mode.

    In draining mode, no new workspaces will be placed on this server,
    but existing workspaces continue to run.
    """
    _require_admin(request)

    result = await db.execute(select(WorkspaceServer).where(WorkspaceServer.id == server_id))
    server = result.scalar_one_or_none()

    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    server.status = ServerStatus.DRAINING
    await db.commit()
    await db.refresh(server)

    logger.info(
        "Server set to draining",
        server_id=server_id,
        hostname=server.hostname,
        active_workspaces=server.active_workspaces,
    )

    return _server_to_response(server)


@router.post("/{server_id}/activate", response_model=ServerResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def activate_server(
    server_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> ServerResponse:
    """Activate a server for workspace placement."""
    _require_admin(request)

    result = await db.execute(select(WorkspaceServer).where(WorkspaceServer.id == server_id))
    server = result.scalar_one_or_none()

    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    server.status = ServerStatus.ACTIVE
    await db.commit()
    await db.refresh(server)

    logger.info(
        "Server activated",
        server_id=server_id,
        hostname=server.hostname,
    )

    return _server_to_response(server)


# ============== Cluster Status Endpoint ==============


@router.get("/cluster/status", response_model=ClusterStatusResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_cluster_status(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> ClusterStatusResponse:
    """Get cluster-wide status and resource utilization."""
    _require_admin(request)

    result = await db.execute(select(WorkspaceServer))
    servers = list(result.scalars().all())

    # Calculate aggregates
    total_cpu = sum(s.total_cpu for s in servers)
    used_cpu = sum(s.used_cpu for s in servers)
    total_memory = sum(s.total_memory_mb for s in servers)
    used_memory = sum(s.used_memory_mb for s in servers)
    total_workspaces = sum(s.active_workspaces for s in servers)

    active_count = len([s for s in servers if s.status == ServerStatus.ACTIVE])
    healthy_count = len([s for s in servers if s.is_healthy])

    # Build per-server health responses
    server_health: list[ServerHealthResponse] = []
    for server in servers:
        cpu_util = (server.used_cpu / server.total_cpu * 100) if server.total_cpu else 0
        mem_util = (
            (server.used_memory_mb / server.total_memory_mb * 100) if server.total_memory_mb else 0
        )
        disk_util = (
            (server.used_disk_gb / server.total_disk_gb * 100) if server.total_disk_gb else 0
        )
        bw_util = (
            (server.used_bandwidth_mbps / server.total_bandwidth_mbps * 100)
            if server.total_bandwidth_mbps
            else 0
        )

        server_health.append(
            ServerHealthResponse(
                server_id=server.id,
                status=server.status,
                is_healthy=server.is_healthy,
                last_heartbeat=server.last_heartbeat.isoformat() if server.last_heartbeat else None,
                cpu_utilization=round(cpu_util, 2),
                memory_utilization=round(mem_util, 2),
                disk_utilization=round(disk_util, 2),
                bandwidth_utilization=round(bw_util, 2),
                active_workspaces=server.active_workspaces,
            )
        )

    return ClusterStatusResponse(
        total_servers=len(servers),
        active_servers=active_count,
        healthy_servers=healthy_count,
        total_cpu=total_cpu,
        used_cpu=round(used_cpu, 2),
        cpu_utilization=round((used_cpu / total_cpu * 100) if total_cpu else 0, 2),
        total_memory_mb=total_memory,
        used_memory_mb=used_memory,
        memory_utilization=round((used_memory / total_memory * 100) if total_memory else 0, 2),
        total_workspaces=total_workspaces,
        servers=server_health,
    )


# ============== Capacity Check Endpoints ==============


class TierCapacity(BaseModel):
    """Capacity info for a single tier."""

    available: bool
    slots: int  # How many workspaces of this tier can fit


class RegionCapacityResponse(BaseModel):
    """Response containing capacity per tier for a region."""

    region: str
    tiers: dict[str, TierCapacity]


@router.get("/capacity/{region}", response_model=RegionCapacityResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_region_capacity(
    region: str,
    request: Request,  # noqa: ARG001 - Required for rate limiter
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> RegionCapacityResponse:
    """Get available capacity per tier for a specific region.

    Used by frontend to show which plans are available in the selected region.
    This endpoint is public (no admin required) so users can see capacity.
    """
    # Get all active servers in the region
    result = await db.execute(
        select(WorkspaceServer).where(
            WorkspaceServer.region == region,
            WorkspaceServer.status == ServerStatus.ACTIVE,
        )
    )
    servers = list(result.scalars().all())

    # Get all hardware specs
    specs_result = await db.execute(select(HardwareSpec).where(HardwareSpec.is_available.is_(True)))
    specs = {s.tier: s for s in specs_result.scalars().all()}

    # Calculate capacity per tier
    tiers: dict[str, TierCapacity] = {}

    for tier, spec in specs.items():
        slots = 0
        for server in servers:
            # Check if server can fit this tier's requirements
            # Consider CPU, memory, disk, and bandwidth
            bandwidth_required = spec.bandwidth_mbps or 100  # Default to 100 if not set

            # Calculate how many of this tier could fit on the server
            cpu_slots = int(server.available_cpu / spec.vcpu) if spec.vcpu else 0
            mem_slots = int(server.available_memory_mb / spec.memory_mb) if spec.memory_mb else 0
            disk_slots = int(server.available_disk_gb / spec.storage_gb) if spec.storage_gb else 0
            bw_slots = (
                int(server.available_bandwidth_mbps / bandwidth_required)
                if bandwidth_required
                else 0
            )

            # The limiting factor determines slots
            server_slots = min(cpu_slots, mem_slots, disk_slots, bw_slots)

            # Also check architecture if specified in spec
            if spec.architecture and server.architecture != spec.architecture:
                server_slots = 0

            # Check GPU requirements
            gpu_mismatch = spec.gpu_type and server.gpu_type != spec.gpu_type
            if spec.is_gpu and (not server.has_gpu or gpu_mismatch):
                server_slots = 0

            slots += server_slots

        tiers[tier] = TierCapacity(available=slots > 0, slots=slots)

    return RegionCapacityResponse(region=region, tiers=tiers)


# ============== Server Workspaces Endpoints ==============


class ServerWorkspaceInfo(BaseModel):
    """Info about a workspace on a server."""

    workspace_id: str
    user_id: str
    user_email: str | None
    tier: str | None
    status: str
    assigned_cpu: float | None
    assigned_memory_mb: int | None
    assigned_bandwidth_mbps: int | None
    created_at: str
    last_activity: str | None


class ServerWorkspacesResponse(BaseModel):
    """Response containing all workspaces on a server."""

    server_id: str
    server_name: str
    region: str | None
    workspaces: list[ServerWorkspaceInfo]
    total_count: int


@router.get("/{server_id}/workspaces", response_model=ServerWorkspacesResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_server_workspaces(
    server_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> ServerWorkspacesResponse:
    """Get all workspaces running on a specific server.

    Admin endpoint for viewing which users/workspaces are on a server.
    """
    _require_admin(request)

    # Get server
    server_result = await db.execute(select(WorkspaceServer).where(WorkspaceServer.id == server_id))
    server = server_result.scalar_one_or_none()

    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    # Get all workspaces on this server with user info
    # Use selectinload to eagerly load session and owner relationships
    workspaces_result = await db.execute(
        select(Workspace)
        .where(Workspace.server_id == server_id)
        .options(selectinload(Workspace.session).selectinload(Session.owner))
        .order_by(Workspace.created_at.desc())
    )
    workspaces = list(workspaces_result.scalars().all())

    # Gather user emails (need separate query since workspace->session->user)
    workspace_infos: list[ServerWorkspaceInfo] = []
    for ws in workspaces:
        # Get user email via session relationship
        user_email = None
        tier = None
        if ws.session:
            if ws.session.owner:
                user_email = ws.session.owner.email
            # Tier can be derived from assigned resources; for now, set to None
            tier = None

        workspace_infos.append(
            ServerWorkspaceInfo(
                workspace_id=ws.id,
                user_id=ws.session.owner_id if ws.session else "unknown",
                user_email=user_email,
                tier=tier,
                status=ws.status,
                assigned_cpu=ws.assigned_cpu,
                assigned_memory_mb=ws.assigned_memory_mb,
                assigned_bandwidth_mbps=ws.assigned_bandwidth_mbps,
                created_at=ws.created_at.isoformat(),
                last_activity=ws.last_activity.isoformat() if ws.last_activity else None,
            )
        )

    return ServerWorkspacesResponse(
        server_id=server.id,
        server_name=server.name,
        region=server.region,
        workspaces=workspace_infos,
        total_count=len(workspace_infos),
    )
