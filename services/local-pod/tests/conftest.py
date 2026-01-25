"""Pytest fixtures for local-pod tests."""

from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def mock_docker_client():
    """Create a mock Docker client."""
    mock = MagicMock()
    mock.info.return_value = {
        "ServerVersion": "24.0.0",
        "Containers": 5,
    }
    mock.networks.get.return_value = MagicMock()
    mock.networks.create.return_value = MagicMock()
    mock.containers.list.return_value = []
    return mock


@pytest.fixture
def sample_workspace_info():
    """Sample workspace information."""
    return {
        "id": "ws_test123",
        "user_id": "user-456",
        "session_id": "session-789",
        "status": "running",
        "tier": "starter",
        "host": "172.17.0.2",
        "port": 3000,
        "container_id": "abc123def456",
        "container_name": "podex-workspace-ws_test123",
        "created_at": "2024-01-01T00:00:00+00:00",
        "last_activity": "2024-01-01T00:00:00+00:00",
    }


@pytest.fixture
def mock_container():
    """Create a mock Docker container."""
    mock = MagicMock()
    mock.id = "abc123def456"
    mock.short_id = "abc123"
    mock.name = "podex-workspace-ws_test123"
    mock.status = "running"
    mock.attrs = {
        "NetworkSettings": {
            "Networks": {
                "podex-local": {
                    "IPAddress": "172.17.0.2",
                }
            }
        }
    }
    mock.reload.return_value = None
    mock.stop.return_value = None
    mock.remove.return_value = None
    mock.exec_run.return_value = MagicMock(
        exit_code=0,
        output=(b"success", b""),
    )
    return mock


@pytest.fixture
def cli_runner():
    """Click CLI test runner."""
    from click.testing import CliRunner

    return CliRunner()


@pytest.fixture
def temp_config_file(tmp_path):
    """Create temporary TOML config file."""
    config_file = tmp_path / "config.toml"
    config_file.write_text(
        """[podex]
pod_token = "pdx_pod_test_token"
cloud_url = "https://test.api.dev"
max_workspaces = 5
"""
    )
    return config_file


@pytest.fixture
def mock_sentry_sdk():
    """Mock Sentry SDK."""
    with (
        patch("sentry_sdk.init") as mock_init,
        patch("sentry_sdk.set_tag") as mock_tag,
        patch("sentry_sdk.flush") as mock_flush,
    ):
        yield {"init": mock_init, "set_tag": mock_tag, "flush": mock_flush}


@pytest.fixture
def mock_psutil():
    """Mock psutil for system checks."""
    with (
        patch("psutil.virtual_memory") as mock_mem,
        patch("psutil.cpu_count") as mock_cpu,
        patch("psutil.cpu_percent") as mock_cpu_pct,
    ):
        mock_mem.return_value = MagicMock(
            total=17179869184,  # 16 GB
            used=8589934592,  # 8 GB
            percent=50.0,
        )
        mock_cpu.return_value = 8
        mock_cpu_pct.return_value = 25.0
        yield {"memory": mock_mem, "cpu_count": mock_cpu, "cpu_percent": mock_cpu_pct}


@pytest.fixture
def mock_signal_handlers():
    """Mock signal handler setup."""
    with patch("signal.signal") as mock_signal:
        yield mock_signal
