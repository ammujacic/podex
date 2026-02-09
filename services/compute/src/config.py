"""Compute service configuration."""

import json
from typing import Literal

from pydantic import AliasChoices, Field
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
        region: str | None = None,
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
        self.region = region
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
    # This token must be shared between all services (API, compute, agent)
    # Reads from INTERNAL_SERVICE_TOKEN env var (not prefixed with COMPUTE_)
    internal_service_token: str = Field(default="", validation_alias="INTERNAL_SERVICE_TOKEN")

    # API service (for usage tracking)
    api_base_url: str = "http://localhost:3001"

    # CORS - stored as raw string to avoid pydantic-settings JSON parsing issues
    cors_origins_raw: str = Field(
        default='["http://localhost:3000"]',
        validation_alias=AliasChoices("cors_origins", "COMPUTE_CORS_ORIGINS"),
    )

    @property
    def cors_origins(self) -> list[str]:
        """Parse CORS origins from JSON array, comma-separated, or plain string."""
        v = self.cors_origins_raw.strip() if self.cors_origins_raw else ""
        if not v:
            return ["http://localhost:3000"]
        # Try JSON array first
        if v.startswith("["):
            try:
                parsed = json.loads(v)
                return [str(x) for x in parsed] if isinstance(parsed, list) else [v]
            except json.JSONDecodeError:
                pass
        # Comma-separated list (e.g., "https://a.com,https://b.com")
        if "," in v:
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        # Single origin
        return [v]

    # Server sync interval (seconds between syncing server list from API)
    server_sync_interval: int = 30

    # Region this compute service manages (None = manages all regions)
    # Set via COMPUTE_REGION env var in production to filter servers by region
    compute_region: str | None = None

    # Workspace settings
    max_workspaces: int = 10  # Max workspaces per server (soft limit)
    shutdown_timeout: int = 60  # Max seconds for graceful shutdown before forcing exit
    # Fallback workspace image (used only when server has no image configured)
    # In production, images are configured per-server in the database via admin UI
    workspace_image: str = "ghcr.io/mujacica/workspace:latest"

    # Container runtime for workspace isolation (runsc for gVisor, runc for standard)
    docker_runtime: str | None = "runsc"  # Set to None to use server default

    # Redis for state management
    redis_url: str = "redis://localhost:6379"

    # Workspace data storage (bind mounts with XFS quotas in production)
    workspace_data_path: str = "/data/workspaces"
    # Enable XFS project quotas for disk limits (requires XFS with pquota mount option)
    xfs_quotas_enabled: bool = False  # Set to True in production

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
