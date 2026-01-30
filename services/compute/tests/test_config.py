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

    def test_workspace_settings_defaults(self) -> None:
        """Test default workspace settings."""
        settings = Settings()
        assert settings.max_workspaces == 10
        assert settings.workspace_timeout == 3600
        assert settings.workspace_image == "podex/workspace:latest"
        # Multi-server mode: workspace servers are configured via JSON
        assert settings.workspace_servers_json == "[]"
        assert len(settings.workspace_servers) == 0

    def test_redis_settings_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test default Redis settings."""
        # Clear env var that may override the default
        monkeypatch.delenv("COMPUTE_REDIS_URL", raising=False)
        settings = Settings()
        assert settings.redis_url == "redis://localhost:6379"

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

    def test_custom_workspace_settings(self) -> None:
        """Test custom workspace settings."""
        settings = Settings(
            max_workspaces=20,
            workspace_servers='[{"server_id": "test-1", "host": "localhost", "docker_port": 2375}]',
        )
        assert settings.max_workspaces == 20
        assert len(settings.workspace_servers) == 1
        assert settings.workspace_servers[0].server_id == "test-1"

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
