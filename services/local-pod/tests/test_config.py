"""Tests for local-pod configuration."""

from unittest.mock import patch

import pytest

from podex_local_pod.config import LocalPodConfig, load_config


class TestLocalPodConfig:
    """Tests for LocalPodConfig settings."""

    def test_defaults(self) -> None:
        """Test default configuration values."""
        config = LocalPodConfig()
        assert config.pod_token == ""
        assert config.cloud_url == "https://api.podex.dev"
        assert config.pod_name is None
        assert config.heartbeat_interval == 30
        assert config.reconnect_delay == 1
        assert config.reconnect_delay_max == 30
        assert config.log_level == "INFO"

    def test_custom_values(self) -> None:
        """Test custom configuration values."""
        config = LocalPodConfig(
            pod_token="pdx_pod_test123",
            cloud_url="https://custom.api.dev",
            pod_name="MyPod",
            heartbeat_interval=60,
            log_level="DEBUG",
        )
        assert config.pod_token == "pdx_pod_test123"
        assert config.cloud_url == "https://custom.api.dev"
        assert config.pod_name == "MyPod"
        assert config.heartbeat_interval == 60
        assert config.log_level == "DEBUG"

    def test_heartbeat_interval_bounds(self) -> None:
        """Test heartbeat_interval bounds validation."""
        # Minimum
        config = LocalPodConfig(heartbeat_interval=10)
        assert config.heartbeat_interval == 10

        # Maximum
        config = LocalPodConfig(heartbeat_interval=300)
        assert config.heartbeat_interval == 300

        # Below minimum should fail
        with pytest.raises(ValueError):
            LocalPodConfig(heartbeat_interval=5)

        # Above maximum should fail
        with pytest.raises(ValueError):
            LocalPodConfig(heartbeat_interval=301)


class TestLoadConfig:
    """Tests for load_config function."""

    def test_load_from_environment(self) -> None:
        """Test loading config from environment."""
        with patch.dict(
            "os.environ",
            {
                "PODEX_POD_TOKEN": "pdx_pod_env123",
                "PODEX_CLOUD_URL": "https://env.api.dev",
            },
        ):
            config = load_config()
            assert isinstance(config, LocalPodConfig)

    def test_load_returns_config(self) -> None:
        """Test loading config returns a valid config object."""
        config = load_config()
        assert isinstance(config, LocalPodConfig)


class TestConfigEnvPrefix:
    """Tests for environment variable prefix."""

    def test_env_prefix(self) -> None:
        """Test that PODEX_ prefix is used for env vars."""
        assert LocalPodConfig.model_config.get("env_prefix") == "PODEX_"
