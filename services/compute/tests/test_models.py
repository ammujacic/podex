"""Tests for workspace models."""

from datetime import UTC, datetime

from src.models.workspace import (
    WorkspaceConfig,
    WorkspaceCreateRequest,
    WorkspaceExecRequest,
    WorkspaceInfo,
    WorkspaceStatus,
)


def test_workspace_config_defaults() -> None:
    """Test WorkspaceConfig default values."""
    config = WorkspaceConfig()
    assert config.tier == "starter_arm"
    assert config.repos == []
    assert config.environment == {}
    assert config.git_credentials is None


def test_workspace_config_with_values() -> None:
    """Test WorkspaceConfig with custom values."""
    config = WorkspaceConfig(
        tier="pro_arm",
        repos=["https://github.com/user/repo"],
        environment={"NODE_ENV": "development"},
    )
    assert config.tier == "pro_arm"
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
        tier="starter_arm",
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
    assert request.config.tier == "starter_arm"


def test_workspace_exec_request() -> None:
    """Test WorkspaceExecRequest model."""
    request = WorkspaceExecRequest(command="ls -la")
    assert request.command == "ls -la"
    assert request.working_dir is None
    assert request.timeout == 30


def test_workspace_tier_values() -> None:
    """Test that tier is now a string (no longer an enum).

    Tiers are loaded from the database. Common tiers include:
    - starter_arm, pro_arm, power_arm, enterprise_arm (ARM)
    - starter, pro, power, enterprise (x86)
    - gpu_starter, gpu_pro (GPU)
    """
    # Tier is now a string, just verify the default works
    config = WorkspaceConfig()
    assert isinstance(config.tier, str)
    assert config.tier == "starter_arm"

    # Can set any tier string
    config = WorkspaceConfig(tier="gpu_starter")
    assert config.tier == "gpu_starter"


def test_workspace_status_values() -> None:
    """Test WorkspaceStatus enum values."""
    assert WorkspaceStatus.CREATING.value == "creating"
    assert WorkspaceStatus.RUNNING.value == "running"
    assert WorkspaceStatus.STOPPING.value == "stopping"
    assert WorkspaceStatus.STOPPED.value == "stopped"
    assert WorkspaceStatus.ERROR.value == "error"
