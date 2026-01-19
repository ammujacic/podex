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

    # Compute mode: docker for local, gcp for production
    compute_mode: Literal["docker", "gcp"] = "docker"

    # Docker settings (local development)
    docker_host: str = "unix:///var/run/docker.sock"
    max_workspaces: int = 10
    workspace_timeout: int = 3600  # 1 hour idle timeout
    shutdown_timeout: int = 60  # Max seconds for graceful shutdown before forcing exit
    workspace_image: str = "podex/workspace:latest"
    docker_network: str = "podex-dev"

    # GCP settings
    gcp_project_id: str | None = None
    gcp_region: str = "us-east1"

    # Container images for different architectures (GCP production)
    # These are GCR/Artifact Registry image URIs
    workspace_image_x86: str = "podex/workspace:latest-amd64"
    workspace_image_gpu: str = "podex/workspace:latest-gpu"  # x86 + CUDA

    # GKE cluster settings
    gke_cluster_name: str = "podex-workspaces"
    gke_namespace: str = "workspaces"

    # Cloud Run settings (for serverless workspaces)
    cloud_run_service_account: str | None = None

    # Redis for state management
    redis_url: str = "redis://localhost:6379"

    # GCS storage for workspace files
    gcs_bucket: str = "podex-workspaces"
    gcs_prefix: str = "workspaces"
    gcs_sync_interval: int = 30  # Seconds between background syncs

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
