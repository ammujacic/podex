"""Workspace models shared across services.

All configuration data (tiers, versions, categories, accelerators) comes from the database.
These models define the structure for data transfer between services.
"""

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class WorkspaceStatus(str, Enum):
    """Workspace lifecycle status.

    This is a state machine enum - these are fixed states in the workspace lifecycle.
    """

    CREATING = "creating"
    RUNNING = "running"
    STOPPING = "stopping"
    STOPPED = "stopped"
    ERROR = "error"


class WorkspaceConfig(BaseModel):
    """Configuration for creating a new workspace.

    All tier/version/architecture values are validated against the database.
    Use /api/billing/hardware-specs for available tiers.
    Use /api/templates for available templates and their configurations.
    """

    # Compute tier (validated against hardware_specs table)
    tier: str = "starter_arm"

    # Hardware configuration (validated against hardware_specs table)
    architecture: str = "arm64"
    gpu_type: str | None = None

    # Operating system (validated against supported_versions table)
    os_version: str = "ubuntu-22.04"

    # Language versions (validated against supported_versions table)
    python_version: str | None = "3.12"
    node_version: str | None = "20"
    go_version: str | None = None
    rust_channel: str | None = None

    # Additional packages to install
    apt_packages: list[str] = Field(default_factory=list, description="APT packages to install")
    pip_packages: list[str] = Field(default_factory=list, description="Python packages to install")
    npm_packages: list[str] = Field(default_factory=list, description="Global NPM packages")

    # Git repositories
    repos: list[str] = Field(default_factory=list, description="GitHub URLs to clone")
    git_branch: str | None = Field(default=None, description="Branch to checkout after cloning")
    git_credentials: str | None = Field(default=None, description="Git credentials for private")

    # Environment variables
    environment: dict[str, str] = Field(default_factory=dict, description="Environment variables")

    # Resource limits
    storage_gb: int = Field(default=20, ge=5, le=500, description="Storage in GB")
    timeout_hours: int = Field(default=24, ge=1, le=168, description="Max runtime in hours")

    # Pre/post initialization commands
    pre_init_commands: list[str] = Field(default_factory=list, description="Commands before setup")
    post_init_commands: list[str] = Field(default_factory=list, description="Commands after setup")

    # Template reference (if using a template)
    template_id: str | None = None

    # Git identity configuration (for commits)
    git_name: str | None = Field(default=None, description="Git user.name for commits")
    git_email: str | None = Field(default=None, description="Git user.email for commits")

    # Docker image to use (overrides default workspace image)
    base_image: str | None = Field(
        default=None,
        description="Docker image for the workspace (template's base_image if not specified)",
    )

    # Region preference for placement (strict - fails if no capacity)
    region_preference: str | None = Field(
        default=None,
        description="Required region for workspace placement (e.g., 'eu', 'us')",
    )


class HardwareSpec(BaseModel):
    """Hardware specification for a compute tier.

    This model is populated from the hardware_specs database table.
    """

    id: str | None = None
    tier: str
    display_name: str
    description: str
    architecture: str
    vcpu: int
    memory_mb: int
    gpu_type: str | None = None
    gpu_memory_gb: int | None = None
    gpu_count: int = 0
    storage_gb_default: int = 20
    storage_gb_max: int = 100
    hourly_rate: Decimal | None = None
    hourly_rate_cents: int | None = None
    is_available: bool = True
    requires_subscription: str | None = None
    region_availability: list[str] = Field(default_factory=list)
    is_gpu: bool = False

    model_config = {"from_attributes": True}


class WorkspaceInfo(BaseModel):
    """Information about a running workspace."""

    id: str
    user_id: str
    session_id: str
    status: WorkspaceStatus
    tier: str
    host: str
    port: int = 8080
    server_id: str | None = None
    container_id: str | None = None
    repos: list[str] = Field(default_factory=list)
    created_at: datetime
    last_activity: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)
    auth_token: str | None = None
    image: str | None = None
    repositories: list[str] = Field(default_factory=list)
    environment: dict[str, str] = Field(default_factory=dict)

    model_config = {"from_attributes": True}


class WorkspaceCreateRequest(BaseModel):
    """Request to create a new workspace."""

    session_id: str
    workspace_id: str | None = Field(
        default=None,
        description="Optional workspace ID. If not provided, compute service generates one.",
    )
    config: WorkspaceConfig = Field(default_factory=WorkspaceConfig)


class WorkspaceExecRequest(BaseModel):
    """Request to execute a command in a workspace."""

    command: str
    working_dir: str | None = None
    timeout: int = 30


class WorkspaceExecResponse(BaseModel):
    """Response from executing a command."""

    exit_code: int
    stdout: str
    stderr: str


class WorkspaceFileRequest(BaseModel):
    """Request to read/write a file in workspace."""

    path: str
    content: str | None = None


class WorkspaceScaleRequest(BaseModel):
    """Request to scale a workspace's compute resources."""

    new_tier: str = Field(description="The new compute tier to scale to")


class WorkspaceScaleResponse(BaseModel):
    """Response from scaling a workspace."""

    success: bool
    message: str
    new_tier: str | None = None
    estimated_cost_per_hour: Decimal | None = None
    requires_restart: bool = True


class WorkspaceResourceMetrics(BaseModel):
    """Real-time resource usage metrics for a workspace container."""

    # CPU
    cpu_percent: float = 0.0  # Current usage (0-100%)
    cpu_limit_cores: float = 1.0  # Allocated cores from container config

    # Memory
    memory_used_mb: int = 0  # Current usage in MB
    memory_limit_mb: int = 1024  # Allocated limit in MB
    memory_percent: float = 0.0  # Usage percentage

    # Disk (block I/O - cumulative since container start)
    disk_read_mb: float = 0.0  # Total read
    disk_write_mb: float = 0.0  # Total written

    # Network (cumulative since container start)
    network_rx_mb: float = 0.0  # Total received
    network_tx_mb: float = 0.0  # Total transmitted

    # Metadata
    collected_at: datetime | None = None  # When metrics were captured
    container_uptime_seconds: int = 0
