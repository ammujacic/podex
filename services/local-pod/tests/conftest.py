"""Pytest fixtures for local-pod tests."""

from unittest.mock import AsyncMock, MagicMock, patch

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
