"""Comprehensive tests for compute service configuration."""


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

    def test_gcp_settings_defaults(self) -> None:
        """Test default GCP settings."""
        settings = Settings()
        assert settings.gcp_region == "us-east1"
        assert settings.gcp_project_id is None
        assert settings.gke_cluster_name == "podex-workspaces"
        assert settings.gke_namespace == "workspaces"

    def test_redis_settings_default(self) -> None:
        """Test default Redis settings."""
        settings = Settings()
        assert settings.redis_url == "redis://localhost:6379"

    def test_gcs_settings_defaults(self) -> None:
        """Test default GCS settings."""
        settings = Settings()
        assert settings.gcs_bucket == "podex-workspaces"
        assert settings.gcs_prefix == "workspaces"
        assert settings.gcs_sync_interval == 30

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
        settings = Settings(compute_mode="gcp")
        assert settings.compute_mode == "gcp"

    def test_custom_docker_settings(self) -> None:
        """Test custom Docker settings."""
        settings = Settings(
            docker_host="tcp://localhost:2375",
            max_workspaces=20,
        )
        assert settings.docker_host == "tcp://localhost:2375"
        assert settings.max_workspaces == 20

    def test_custom_gcp_settings(self) -> None:
        """Test custom GCP settings."""
        settings = Settings(
            gcp_project_id="my-project",
            gcp_region="us-east1",
        )
        assert settings.gcp_project_id == "my-project"
        assert settings.gcp_region == "us-east1"


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
