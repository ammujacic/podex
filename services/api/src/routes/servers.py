"""Server management API routes for multi-server orchestration.

This module provides endpoints for managing workspace servers,
including registration, health monitoring, and capacity management.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import ServerStatus, WorkspaceServer
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter
from src.routes.dependencies import DbSession, get_current_user_id

logger = logging.getLogger(__name__)
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
    used_cpu: float
    used_memory_mb: int
    used_disk_gb: int
    available_cpu: float
    available_memory_mb: int
    available_disk_gb: int
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


class ServerHealthResponse(BaseModel):
    """Response containing server health information."""

    server_id: str
    status: str
    is_healthy: bool
    last_heartbeat: str | None
    cpu_utilization: float
    memory_utilization: float
    disk_utilization: float
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
        ip_address=server.ip_address,
        docker_port=server.docker_port,
        status=server.status,
        total_cpu=server.total_cpu,
        total_memory_mb=server.total_memory_mb,
        total_disk_gb=server.total_disk_gb,
        used_cpu=server.used_cpu,
        used_memory_mb=server.used_memory_mb,
        used_disk_gb=server.used_disk_gb,
        available_cpu=server.available_cpu,
        available_memory_mb=server.available_memory_mb,
        available_disk_gb=server.available_disk_gb,
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
        # In production, check admin role
        # raise HTTPException(status_code=403, detail="Admin access required")
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

    # Create new server
    import uuid

    server = WorkspaceServer(
        id=str(uuid.uuid4()),
        name=data.name,
        hostname=data.hostname,
        ip_address=data.ip_address,
        docker_port=data.docker_port,
        status=ServerStatus.ACTIVE,
        total_cpu=data.total_cpu,
        total_memory_mb=data.total_memory_mb,
        total_disk_gb=data.total_disk_gb,
        used_cpu=0.0,
        used_memory_mb=0,
        used_disk_gb=0,
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

    result = await db.execute(
        select(WorkspaceServer).where(WorkspaceServer.id == server_id)
    )
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

    result = await db.execute(
        select(WorkspaceServer).where(WorkspaceServer.id == server_id)
    )
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

    result = await db.execute(
        select(WorkspaceServer).where(WorkspaceServer.id == server_id)
    )
    server = result.scalar_one_or_none()

    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    # Check for active workspaces
    if server.active_workspaces > 0 and not force:
        raise HTTPException(
            status_code=400,
            detail=f"Server has {server.active_workspaces} active workspaces. Use force=true to delete anyway.",
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
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    used_cpu: float = 0.0,
    used_memory_mb: int = 0,
    used_disk_gb: int = 0,
    active_workspaces: int = 0,
) -> ServerHealthResponse:
    """Report server heartbeat with current resource usage.

    Called periodically by workspace servers to report health.
    """
    # This endpoint can be called by the server itself, not just admins
    # In production, should verify server authentication token

    result = await db.execute(
        select(WorkspaceServer).where(WorkspaceServer.id == server_id)
    )
    server = result.scalar_one_or_none()

    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    # Update server stats
    server.used_cpu = used_cpu
    server.used_memory_mb = used_memory_mb
    server.used_disk_gb = used_disk_gb
    server.active_workspaces = active_workspaces
    server.last_heartbeat = datetime.now(UTC)

    # Update status if it was error/offline and heartbeat received
    if server.status in (ServerStatus.ERROR, ServerStatus.OFFLINE):
        server.status = ServerStatus.ACTIVE

    await db.commit()
    await db.refresh(server)

    # Calculate utilization
    cpu_util = (server.used_cpu / server.total_cpu * 100) if server.total_cpu else 0
    mem_util = (server.used_memory_mb / server.total_memory_mb * 100) if server.total_memory_mb else 0
    disk_util = (server.used_disk_gb / server.total_disk_gb * 100) if server.total_disk_gb else 0

    return ServerHealthResponse(
        server_id=server.id,
        status=server.status,
        is_healthy=server.is_healthy,
        last_heartbeat=server.last_heartbeat.isoformat() if server.last_heartbeat else None,
        cpu_utilization=round(cpu_util, 2),
        memory_utilization=round(mem_util, 2),
        disk_utilization=round(disk_util, 2),
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

    result = await db.execute(
        select(WorkspaceServer).where(WorkspaceServer.id == server_id)
    )
    server = result.scalar_one_or_none()

    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    # Calculate utilization
    cpu_util = (server.used_cpu / server.total_cpu * 100) if server.total_cpu else 0
    mem_util = (server.used_memory_mb / server.total_memory_mb * 100) if server.total_memory_mb else 0
    disk_util = (server.used_disk_gb / server.total_disk_gb * 100) if server.total_disk_gb else 0

    return ServerHealthResponse(
        server_id=server.id,
        status=server.status,
        is_healthy=server.is_healthy,
        last_heartbeat=server.last_heartbeat.isoformat() if server.last_heartbeat else None,
        cpu_utilization=round(cpu_util, 2),
        memory_utilization=round(mem_util, 2),
        disk_utilization=round(disk_util, 2),
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

    result = await db.execute(
        select(WorkspaceServer).where(WorkspaceServer.id == server_id)
    )
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

    result = await db.execute(
        select(WorkspaceServer).where(WorkspaceServer.id == server_id)
    )
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
        mem_util = (server.used_memory_mb / server.total_memory_mb * 100) if server.total_memory_mb else 0
        disk_util = (server.used_disk_gb / server.total_disk_gb * 100) if server.total_disk_gb else 0

        server_health.append(
            ServerHealthResponse(
                server_id=server.id,
                status=server.status,
                is_healthy=server.is_healthy,
                last_heartbeat=server.last_heartbeat.isoformat() if server.last_heartbeat else None,
                cpu_utilization=round(cpu_util, 2),
                memory_utilization=round(mem_util, 2),
                disk_utilization=round(disk_util, 2),
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
