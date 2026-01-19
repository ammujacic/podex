"""Pytest configuration for shared service tests."""

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest


@pytest.fixture
def mock_redis_client() -> MagicMock:
    """Create a mock Redis client."""
    client = MagicMock()
    client.get = AsyncMock(return_value=None)
    client.set = AsyncMock(return_value=True)
    client.delete = AsyncMock(return_value=1)
    client.exists = AsyncMock(return_value=0)
    client.expire = AsyncMock(return_value=True)
    client.hget = AsyncMock(return_value=None)
    client.hset = AsyncMock(return_value=1)
    client.hgetall = AsyncMock(return_value={})
    client.hdel = AsyncMock(return_value=1)
    client.publish = AsyncMock(return_value=1)
    client.pubsub = MagicMock()
    client.close = AsyncMock()
    return client


@pytest.fixture
def mock_http_client() -> MagicMock:
    """Create a mock HTTPX async client."""
    client = MagicMock()
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {"success": True}
    response.raise_for_status = MagicMock()
    client.post = AsyncMock(return_value=response)
    client.get = AsyncMock(return_value=response)
    client.aclose = AsyncMock()
    return client


@pytest.fixture
def sample_usage_event_data() -> dict[str, Any]:
    """Sample usage event data."""
    return {
        "user_id": "user-123",
        "session_id": "session-456",
        "workspace_id": "workspace-789",
        "model": "claude-sonnet-4-20250514",
        "input_tokens": 1000,
        "output_tokens": 500,
    }


@pytest.fixture
def sample_session_state_data() -> dict[str, Any]:
    """Sample session state data."""
    return {
        "session_id": "session-123",
        "user_id": "user-456",
        "name": "Test Session",
        "workspaces": [],
        "agents": [],
        "viewers": [],
        "shared_with": [],
        "created_at": "2025-01-01T00:00:00Z",
        "updated_at": "2025-01-01T00:00:00Z",
        "last_activity": "2025-01-01T00:00:00Z",
        "version": 0,
    }


@pytest.fixture
def sample_workspace_config_data() -> dict[str, Any]:
    """Sample workspace config data."""
    return {
        "tier": "starter",
        "architecture": "x86_64",
        "gpu_type": "none",
        "os_version": "ubuntu-22.04",
        "python_version": "3.12",
        "node_version": "20",
        "storage_gb": 20,
        "timeout_hours": 24,
    }
