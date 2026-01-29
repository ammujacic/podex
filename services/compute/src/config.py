"""Compute service configuration."""

import json
from typing import Any, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings


class WorkspaceServerConfig:
    """Configuration for a single workspace server."""

    def __init__(
        self,
        server_id: str,
        host: str,
        docker_port: int = 2375,
        tls_enabled: bool = False,
        cert_path: str | None = None,
        max_cpu: float = 8.0,
        max_memory_mb: int = 16384,
        max_workspaces: int = 50,
        labels: dict[str, str] | None = None,
        architecture: str = "amd64",
        # GPU configuration
        has_gpu: bool = False,
        gpu_type: str | None = None,
        gpu_count: int = 0,
    ):
        self.server_id = server_id
        self.host = host
        self.docker_port = docker_port
        self.tls_enabled = tls_enabled
        self.cert_path = cert_path
        self.max_cpu = max_cpu
        self.max_memory_mb = max_memory_mb
        self.max_workspaces = max_workspaces
        self.labels = labels or {}
        self.architecture = architecture
        # GPU
        self.has_gpu = has_gpu
        self.gpu_type = gpu_type
        self.gpu_count = gpu_count


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Service
    environment: Literal["development", "staging", "production"] = "development"
    debug: bool = False

    # Internal service authentication
    # This key must be shared between API service and compute service
    internal_api_key: str = ""  # Required in production

    # API service (for usage tracking)
    api_base_url: str = "http://localhost:3001"
    internal_service_token: str | None = None  # Token for service-to-service auth

    # CORS - allowed origins for API access
    cors_origins: list[str] = ["http://localhost:3000"]

    # Workspace servers configuration (JSON array)
    # Each server: {"server_id", "host", "docker_port", "tls_enabled", "cert_path", ...}
    workspace_servers_json: str = Field(default="[]", validation_alias="COMPUTE_WORKSPACE_SERVERS")

    # Workspace settings
    max_workspaces: int = 10  # Max workspaces per server (soft limit)
    workspace_timeout: int = 3600  # 1 hour idle timeout
    shutdown_timeout: int = 60  # Max seconds for graceful shutdown before forcing exit
    workspace_image: str = "podex/workspace:latest"

    # Container runtime for workspace isolation (runsc for gVisor, runc for standard)
    docker_runtime: str | None = "runsc"  # Set to None to use server default

    @field_validator("workspace_servers_json", mode="before")
    @classmethod
    def parse_workspace_servers(cls, v: Any) -> str:
        """Ensure workspace_servers is a string (JSON)."""
        if isinstance(v, list):
            return json.dumps(v)
        return v or "[]"

    @property
    def workspace_servers(self) -> list[WorkspaceServerConfig]:
        """Parse workspace servers from JSON config."""
        try:
            servers_data = json.loads(self.workspace_servers_json)
            return [
                WorkspaceServerConfig(
                    server_id=s.get("server_id", s.get("name", f"server-{i}")),
                    host=s.get("host", "localhost"),
                    docker_port=s.get("docker_port", 2375),
                    tls_enabled=s.get("tls_enabled", False),
                    cert_path=s.get("cert_path"),
                    max_cpu=s.get("max_cpu", 8.0),
                    max_memory_mb=s.get("max_memory_mb", 16384),
                    max_workspaces=s.get("max_workspaces", 50),
                    labels=s.get("labels", {}),
                    architecture=s.get("architecture", "amd64"),
                    # GPU configuration
                    has_gpu=s.get("has_gpu", False),
                    gpu_type=s.get("gpu_type"),
                    gpu_count=s.get("gpu_count", 0),
                )
                for i, s in enumerate(servers_data)
            ]
        except (json.JSONDecodeError, TypeError):
            return []

    # Redis for state management
    redis_url: str = "redis://localhost:6379"

    # Workspace data storage (bind mounts with XFS quotas in production)
    workspace_data_path: str = "/data/workspaces"
    # Enable XFS project quotas for disk limits (requires XFS with pquota mount option)
    xfs_quotas_enabled: bool = False  # Set to True in production

    # Workspace container images for different architectures
    workspace_image_arm64: str = "podex/workspace:latest-arm64"
    workspace_image_amd64: str = "podex/workspace:latest-amd64"
    workspace_image_gpu: str = (
        "podex/workspace:latest-cuda"  # CUDA-enabled image for GPU workspaces
    )

    # Workspace communication security
    # When enabled, workspace containers are accessed via HTTPS with token auth
    workspace_tls_enabled: bool = False  # Enable HTTPS for workspace connections
    workspace_auth_enabled: bool = True  # Require token auth for workspace API
    workspace_token_header: str = "X-Workspace-Token"  # Header name for auth token  # noqa: S105

    # Workspace tiers (vCPU, memory in MB)
    # ALPHA: All tiers use minimum resources - scale up when needed
    # These are overridden by COMPUTE_TIER_* env vars in production
    tier_starter_cpu: int = 1
    tier_starter_memory: int = 512
    tier_pro_cpu: int = 1
    tier_pro_memory: int = 512
    tier_power_cpu: int = 1
    tier_power_memory: int = 512
    tier_enterprise_cpu: int = 1
    tier_enterprise_memory: int = 512

    # Sentry (reads from SENTRY_ env vars, not COMPUTE_)
    sentry_dsn: str | None = Field(default=None, validation_alias="SENTRY_DSN")
    sentry_traces_sample_rate: float = Field(
        default=0.2, validation_alias="SENTRY_TRACES_SAMPLE_RATE"
    )
    sentry_profiles_sample_rate: float = Field(
        default=0.1, validation_alias="SENTRY_PROFILES_SAMPLE_RATE"
    )

    model_config = {"env_prefix": "COMPUTE_", "case_sensitive": False}


settings = Settings()
