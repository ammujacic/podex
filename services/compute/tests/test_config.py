"""Comprehensive tests for compute service configuration."""

import pytest

from src.config import Settings


class TestSettingsDefaults:
    """Tests for default settings values."""

    def test_environment_default(self) -> None:
        """Test default environment."""
        settings = Settings()
        assert settings.environment == "development"

    def test_debug_default(self) -> None:
        """Test default debug mode."""
        settings = Settings()
        assert settings.debug is False

    def test_compute_mode_default(self) -> None:
        """Test default compute mode."""
        settings = Settings()
        assert settings.compute_mode == "docker"

    def test_docker_settings_defaults(self) -> None:
        """Test default Docker settings."""
        settings = Settings()
        assert settings.docker_host == "unix:///var/run/docker.sock"
        assert settings.max_workspaces == 10
        assert settings.workspace_timeout == 3600
        assert settings.workspace_image == "podex/workspace:latest"
        assert settings.docker_network == "podex-dev"

    def test_aws_settings_defaults(self) -> None:
        """Test default AWS settings."""
        settings = Settings()
        assert settings.aws_region == "us-east-1"
        assert settings.aws_endpoint is None
        assert settings.ecs_cluster_name == "podex-dev"
        assert settings.ecs_task_definition == "podex-workspace-x86-dev"

    def test_redis_settings_default(self) -> None:
        """Test default Redis settings."""
        settings = Settings()
        assert settings.redis_url == "redis://localhost:6379"

    def test_s3_settings_defaults(self) -> None:
        """Test default S3 settings."""
        settings = Settings()
        assert settings.s3_bucket == "podex-workspaces"
        assert settings.s3_prefix == "workspaces"
        assert settings.s3_sync_interval == 30

    def test_tier_cpu_defaults(self) -> None:
        """Test default tier CPU settings."""
        settings = Settings()
        assert settings.tier_starter_cpu == 1
        assert settings.tier_pro_cpu == 1
        assert settings.tier_power_cpu == 1
        assert settings.tier_enterprise_cpu == 1

    def test_tier_memory_defaults(self) -> None:
        """Test default tier memory settings."""
        settings = Settings()
        assert settings.tier_starter_memory == 512
        assert settings.tier_pro_memory == 512
        assert settings.tier_power_memory == 512
        assert settings.tier_enterprise_memory == 512


class TestSettingsCustom:
    """Tests for custom settings values."""

    def test_custom_environment(self) -> None:
        """Test custom environment setting."""
        settings = Settings(environment="production")
        assert settings.environment == "production"

    def test_custom_compute_mode(self) -> None:
        """Test custom compute mode."""
        settings = Settings(compute_mode="aws")
        assert settings.compute_mode == "aws"

    def test_custom_docker_settings(self) -> None:
        """Test custom Docker settings."""
        settings = Settings(
            docker_host="tcp://localhost:2375",
            max_workspaces=20,
        )
        assert settings.docker_host == "tcp://localhost:2375"
        assert settings.max_workspaces == 20

    def test_custom_aws_endpoint(self) -> None:
        """Test custom AWS endpoint (LocalStack)."""
        settings = Settings(
            aws_endpoint="http://localhost:4566",
            aws_region="us-west-2",
        )
        assert settings.aws_endpoint == "http://localhost:4566"
        assert settings.aws_region == "us-west-2"


class TestSettingsGPU:
    """Tests for GPU capacity provider settings."""

    def test_gpu_capacity_providers(self) -> None:
        """Test GPU capacity provider defaults."""
        settings = Settings()
        assert settings.gpu_capacity_provider_t4 == "gpu-t4-provider"
        assert settings.gpu_capacity_provider_a10g == "gpu-a10g-provider"
        assert settings.gpu_capacity_provider_a100 == "gpu-a100-provider"
        assert settings.gpu_capacity_provider_arm_t4g == "gpu-arm-t4g-provider"

    def test_ml_capacity_providers(self) -> None:
        """Test ML accelerator capacity provider defaults."""
        settings = Settings()
        assert settings.ml_capacity_provider_inferentia2 == "ml-inferentia2-provider"
        assert settings.ml_capacity_provider_trainium == "ml-trainium-provider"


class TestSettingsSentry:
    """Tests for Sentry configuration."""

    def test_sentry_defaults(self) -> None:
        """Test Sentry default values."""
        settings = Settings()
        assert settings.sentry_dsn is None
        assert settings.sentry_traces_sample_rate == 0.2
        assert settings.sentry_profiles_sample_rate == 0.1


class TestSettingsEnvPrefix:
    """Tests for environment prefix."""

    def test_env_prefix(self) -> None:
        """Test COMPUTE_ prefix is used."""
        assert Settings.model_config.get("env_prefix") == "COMPUTE_"
