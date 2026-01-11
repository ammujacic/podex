"""Tests for workspace models."""

from datetime import UTC, datetime

from src.models.workspace import (
    WorkspaceConfig,
    WorkspaceCreateRequest,
    WorkspaceExecRequest,
    WorkspaceInfo,
    WorkspaceStatus,
    WorkspaceTier,
)


def test_workspace_config_defaults() -> None:
    """Test WorkspaceConfig default values."""
    config = WorkspaceConfig()
    assert config.tier == WorkspaceTier.STARTER
    assert config.repos == []
    assert config.environment == {}
    assert config.git_credentials is None


def test_workspace_config_with_values() -> None:
    """Test WorkspaceConfig with custom values."""
    config = WorkspaceConfig(
        tier=WorkspaceTier.PRO,
        repos=["https://github.com/user/repo"],
        environment={"NODE_ENV": "development"},
    )
    assert config.tier == WorkspaceTier.PRO
    assert len(config.repos) == 1
    assert config.environment["NODE_ENV"] == "development"


def test_workspace_info() -> None:
    """Test WorkspaceInfo model."""
    now = datetime.now(UTC)
    info = WorkspaceInfo(
        id="ws_123",
        user_id="user_456",
        session_id="sess_789",
        status=WorkspaceStatus.RUNNING,
        tier=WorkspaceTier.STARTER,
        host="localhost",
        port=3000,
        created_at=now,
        last_activity=now,
    )
    assert info.id == "ws_123"
    assert info.status == WorkspaceStatus.RUNNING
    assert info.container_id is None


def test_workspace_create_request() -> None:
    """Test WorkspaceCreateRequest model."""
    request = WorkspaceCreateRequest(session_id="sess_123")
    assert request.session_id == "sess_123"
    assert request.config.tier == WorkspaceTier.STARTER


def test_workspace_exec_request() -> None:
    """Test WorkspaceExecRequest model."""
    request = WorkspaceExecRequest(command="ls -la")
    assert request.command == "ls -la"
    assert request.working_dir is None
    assert request.timeout == 30


def test_workspace_tier_values() -> None:
    """Test WorkspaceTier enum values."""
    assert WorkspaceTier.STARTER.value == "starter"
    assert WorkspaceTier.PRO.value == "pro"
    assert WorkspaceTier.POWER.value == "power"
    assert WorkspaceTier.ENTERPRISE.value == "enterprise"


def test_workspace_status_values() -> None:
    """Test WorkspaceStatus enum values."""
    assert WorkspaceStatus.CREATING.value == "creating"
    assert WorkspaceStatus.RUNNING.value == "running"
    assert WorkspaceStatus.STOPPING.value == "stopping"
    assert WorkspaceStatus.STOPPED.value == "stopped"
    assert WorkspaceStatus.ERROR.value == "error"
