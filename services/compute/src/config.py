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

    # Compute mode: docker for local, aws for production
    compute_mode: Literal["docker", "aws"] = "docker"

    # Docker settings (local development)
    docker_host: str = "unix:///var/run/docker.sock"
    max_workspaces: int = 10
    workspace_timeout: int = 3600  # 1 hour idle timeout
    workspace_image: str = "podex/workspace:latest"
    docker_network: str = "podex-dev"

    # Container images for different architectures (AWS production)
    # These are ECR image URIs or public images with architecture-specific tags
    workspace_image_arm64: str = "podex/workspace:latest-arm64"
    workspace_image_x86: str = "podex/workspace:latest-amd64"
    workspace_image_gpu: str = "podex/workspace:latest-gpu"  # x86 + CUDA
    workspace_image_arm_gpu: str = "podex/workspace:latest-arm-gpu"  # ARM + T4G
    workspace_image_ml: str = "podex/workspace:latest-neuron"  # AWS Neuron SDK

    # AWS settings (production)
    aws_region: str = "us-east-1"
    aws_endpoint: str | None = None  # For LocalStack

    # ECS cluster and task definitions
    # Names must match CDK-created task definition families: podex-workspace-{type}-{env}
    # These are overridden by COMPUTE_ECS_* env vars in production
    ecs_cluster_name: str = "podex-dev"
    ecs_task_definition: str = "podex-workspace-x86-dev"  # Fargate x86_64 task definition
    ecs_arm_task_definition: str = "podex-workspace-dev"  # Fargate ARM64 (Graviton) - default
    ecs_gpu_task_definition: str = (
        "podex-workspace-gpu-dev"  # EC2 x86 GPU task definition (NVIDIA T4/A10G/A100)
    )
    ecs_arm_gpu_task_definition: str = (
        "podex-workspace-arm-gpu-dev"  # EC2 ARM GPU task definition (Graviton2 + T4G)
    )
    ecs_ml_accelerator_task_definition: str = (
        "podex-workspace-ml-dev"  # EC2 ML accelerator (Inferentia/Trainium)
    )
    ecs_subnets: list[str] = []
    ecs_security_groups: list[str] = []

    # ECS capacity providers (must match CDK-created capacity providers)
    # These are ECS capacity providers backed by auto-scaling groups
    # GPU capacity providers (NVIDIA x86)
    gpu_capacity_provider_t4: str = "gpu-t4-provider"
    gpu_capacity_provider_a10g: str = "gpu-a10g-provider"
    gpu_capacity_provider_a100: str = "gpu-a100-provider"
    # GPU capacity providers (ARM + NVIDIA T4G via g5g)
    gpu_capacity_provider_arm_t4g: str = "gpu-arm-t4g-provider"
    # ML accelerator capacity providers (AWS custom silicon)
    ml_capacity_provider_inferentia2: str = "ml-inferentia2-provider"
    ml_capacity_provider_trainium: str = "ml-trainium-provider"

    # Redis for state management
    redis_url: str = "redis://localhost:6379"

    # S3 storage for workspace files
    s3_bucket: str = "podex-workspaces"
    s3_prefix: str = "workspaces"
    s3_sync_interval: int = 30  # Seconds between background syncs

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
