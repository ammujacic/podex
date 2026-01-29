"""Compute service configuration."""

from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings


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

    # Docker settings
    docker_host: str = "unix:///var/run/docker.sock"
    max_workspaces: int = 10
    workspace_timeout: int = 3600  # 1 hour idle timeout
    shutdown_timeout: int = 60  # Max seconds for graceful shutdown before forcing exit
    workspace_image: str = "podex/workspace:latest"
    docker_network: str = "podex-dev"

    # Multi-server Docker settings
    docker_tls_enabled: bool = False  # Enable TLS for remote Docker API
    docker_cert_path: str = "/etc/docker/certs"  # Path to TLS certificates

    # Container runtime for workspace isolation
    docker_runtime: str = "runsc"  # gVisor runtime for security isolation

    # Redis for state management
    redis_url: str = "redis://localhost:6379"

    # Local storage for workspace files (Docker volumes)
    workspace_volume_base: str = "/var/lib/podex/workspaces"

    # Workspace container images for different architectures
    workspace_image_arm64: str = "podex/workspace:latest-arm64"
    workspace_image_amd64: str = "podex/workspace:latest-amd64"

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
