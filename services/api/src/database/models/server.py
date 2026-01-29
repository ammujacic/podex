"""Workspace server models for multi-server Docker orchestration."""

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.database.models.base import Base, _generate_uuid


class WorkspaceServer(Base):
    """Physical or virtual server running Docker for workspace containers.

    Each server has defined capacity (CPU, memory, disk) and tracks current
    utilization. The placement service uses this information to decide where
    to schedule new workspaces.
    """

    __tablename__ = "workspace_servers"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    hostname: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    ip_address: Mapped[str] = mapped_column(INET, nullable=False)
    ssh_port: Mapped[int] = mapped_column(Integer, nullable=False, default=22)
    docker_port: Mapped[int] = mapped_column(Integer, nullable=False, default=2376)

    # Capacity (what the server has available)
    total_cpu: Mapped[int] = mapped_column(Integer, nullable=False)
    total_memory_mb: Mapped[int] = mapped_column(Integer, nullable=False)
    total_disk_gb: Mapped[int] = mapped_column(Integer, nullable=False)

    # Usage (updated by heartbeat service)
    used_cpu: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    used_memory_mb: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    used_disk_gb: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    active_workspaces: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Status
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    last_heartbeat: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Features
    has_gpu: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    gpu_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    gpu_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    docker_runtime: Mapped[str] = mapped_column(String(20), nullable=False, default="runsc")
    architecture: Mapped[str] = mapped_column(String(20), nullable=False, default="arm64")

    # Metadata
    labels: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    region: Mapped[str | None] = mapped_column(String(50), nullable=True)
    provider: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    workspaces: Mapped[list["Workspace"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Workspace",
        back_populates="server",
        lazy="selectin",
    )

    # Table indexes
    __table_args__ = (
        Index("idx_workspace_servers_status", "status"),
        Index("idx_workspace_servers_region", "region"),
        Index("idx_workspace_servers_architecture", "architecture"),
    )

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
            return 0
        return (self.used_cpu / self.total_cpu) * 100

    @property
    def memory_utilization(self) -> float:
        """Get memory utilization as a percentage (0-100)."""
        if self.total_memory_mb == 0:
            return 0
        return (self.used_memory_mb / self.total_memory_mb) * 100

    @property
    def disk_utilization(self) -> float:
        """Get disk utilization as a percentage (0-100)."""
        if self.total_disk_gb == 0:
            return 0
        return (self.used_disk_gb / self.total_disk_gb) * 100

    @property
    def is_healthy(self) -> bool:
        """Check if server is healthy (active status and recent heartbeat)."""
        if self.status != "active":
            return False
        if self.last_heartbeat is None:
            return False
        # Consider unhealthy if no heartbeat in last 2 minutes
        from datetime import timezone

        now = datetime.now(timezone.utc)
        time_since_heartbeat = (now - self.last_heartbeat).total_seconds()
        return time_since_heartbeat < 120

    def can_fit_workspace(
        self,
        cpu: float,
        memory_mb: int,
        disk_gb: int,
    ) -> bool:
        """Check if server can fit a workspace with the given requirements."""
        return (
            self.is_healthy
            and self.available_cpu >= cpu
            and self.available_memory_mb >= memory_mb
            and self.available_disk_gb >= disk_gb
        )

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary representation."""
        return {
            "id": self.id,
            "name": self.name,
            "hostname": self.hostname,
            "ip_address": str(self.ip_address),
            "ssh_port": self.ssh_port,
            "docker_port": self.docker_port,
            "total_cpu": self.total_cpu,
            "total_memory_mb": self.total_memory_mb,
            "total_disk_gb": self.total_disk_gb,
            "used_cpu": self.used_cpu,
            "used_memory_mb": self.used_memory_mb,
            "used_disk_gb": self.used_disk_gb,
            "active_workspaces": self.active_workspaces,
            "available_cpu": self.available_cpu,
            "available_memory_mb": self.available_memory_mb,
            "available_disk_gb": self.available_disk_gb,
            "status": self.status,
            "last_heartbeat": self.last_heartbeat.isoformat() if self.last_heartbeat else None,
            "last_error": self.last_error,
            "has_gpu": self.has_gpu,
            "gpu_type": self.gpu_type,
            "gpu_count": self.gpu_count,
            "docker_runtime": self.docker_runtime,
            "architecture": self.architecture,
            "labels": self.labels,
            "region": self.region,
            "provider": self.provider,
            "is_healthy": self.is_healthy,
            "cpu_utilization": self.cpu_utilization,
            "memory_utilization": self.memory_utilization,
            "disk_utilization": self.disk_utilization,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


# Server status constants
class ServerStatus:
    """Server status constants."""

    ACTIVE = "active"
    DRAINING = "draining"  # No new workspaces, existing ones continue
    MAINTENANCE = "maintenance"  # Scheduled maintenance
    OFFLINE = "offline"  # Not reachable
    ERROR = "error"  # Has errors
