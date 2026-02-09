"""Tests for workspace models."""

from datetime import datetime
from decimal import Decimal

from podex_shared.models.workspace import (
    HardwareSpec,
    WorkspaceConfig,
    WorkspaceCreateRequest,
    WorkspaceExecRequest,
    WorkspaceExecResponse,
    WorkspaceFileRequest,
    WorkspaceInfo,
    WorkspaceScaleRequest,
    WorkspaceScaleResponse,
    WorkspaceStatus,
)


class TestWorkspaceStatus:
    """Tests for WorkspaceStatus enum."""

    def test_status_values(self) -> None:
        """Test workspace status values."""
        assert WorkspaceStatus.CREATING == "creating"
        assert WorkspaceStatus.RUNNING == "running"
        assert WorkspaceStatus.STOPPING == "stopping"
        assert WorkspaceStatus.STOPPED == "stopped"
        assert WorkspaceStatus.ERROR == "error"


class TestWorkspaceConfig:
    """Tests for WorkspaceConfig model."""

    def test_workspace_config_defaults(self) -> None:
        """Test WorkspaceConfig default values."""
        config = WorkspaceConfig()
        assert config.tier == "starter_arm"
        assert config.architecture == "arm64"
        assert config.gpu_type is None
        assert config.os_version == "ubuntu-22.04"
        assert config.python_version == "3.12"
        assert config.node_version == "20"
        assert config.go_version is None
        assert config.rust_channel is None
        assert config.apt_packages == []
        assert config.pip_packages == []
        assert config.npm_packages == []
        assert config.repos == []
        assert config.git_credentials is None
        assert config.environment == {}
        assert config.storage_gb == 20
        assert config.timeout_hours == 24
        assert config.pre_init_commands == []
        assert config.post_init_commands == []
        assert config.template_id is None
        assert config.base_image is None

    def test_workspace_config_custom(self) -> None:
        """Test WorkspaceConfig with custom values."""
        config = WorkspaceConfig(
            tier="gpu_pro",
            architecture="x86_64",
            gpu_type="a10g",
            python_version="3.11",
            pip_packages=["torch", "tensorflow"],
            storage_gb=100,
            environment={"CUDA_VISIBLE_DEVICES": "0"},
        )
        assert config.tier == "gpu_pro"
        assert config.gpu_type == "a10g"
        assert len(config.pip_packages) == 2
        assert config.storage_gb == 100


class TestHardwareSpec:
    """Tests for HardwareSpec model."""

    def test_hardware_spec(self) -> None:
        """Test creating HardwareSpec."""
        spec = HardwareSpec(
            tier="pro",
            display_name="Pro",
            description="Professional tier",
            architecture="x86_64",
            vcpu=4,
            memory_mb=8192,
            hourly_rate=Decimal("0.10"),
        )
        assert spec.tier == "pro"
        assert spec.vcpu == 4
        assert spec.memory_mb == 8192
        assert spec.hourly_rate == Decimal("0.10")
        assert spec.gpu_type is None
        assert spec.is_available is True


class TestWorkspaceInfo:
    """Tests for WorkspaceInfo model."""

    def test_workspace_info(self) -> None:
        """Test creating WorkspaceInfo."""
        now = datetime.now()
        info = WorkspaceInfo(
            id="ws-123",
            user_id="user-456",
            session_id="session-789",
            status=WorkspaceStatus.RUNNING,
            tier="pro",
            host="ws-123.internal",
            port=8080,
            created_at=now,
            last_activity=now,
        )
        assert info.id == "ws-123"
        assert info.status == WorkspaceStatus.RUNNING
        assert info.tier == "pro"
        assert info.host == "ws-123.internal"

    def test_workspace_info_with_container(self) -> None:
        """Test WorkspaceInfo with container ID."""
        now = datetime.now()
        info = WorkspaceInfo(
            id="ws-123",
            user_id="user-456",
            session_id="session-789",
            status=WorkspaceStatus.RUNNING,
            tier="pro",
            host="ws-123.internal",
            container_id="abc123",
            created_at=now,
            last_activity=now,
        )
        assert info.container_id == "abc123"


class TestWorkspaceCreateRequest:
    """Tests for WorkspaceCreateRequest model."""

    def test_create_request_minimal(self) -> None:
        """Test minimal create request."""
        request = WorkspaceCreateRequest(session_id="session-123")
        assert request.session_id == "session-123"
        assert request.workspace_id is None
        assert request.config is not None

    def test_create_request_with_config(self) -> None:
        """Test create request with config."""
        config = WorkspaceConfig(tier="pro", storage_gb=50)
        request = WorkspaceCreateRequest(
            session_id="session-123",
            workspace_id="ws-custom",
            config=config,
        )
        assert request.workspace_id == "ws-custom"
        assert request.config.tier == "pro"


class TestWorkspaceExecRequest:
    """Tests for WorkspaceExecRequest model."""

    def test_exec_request(self) -> None:
        """Test exec request."""
        request = WorkspaceExecRequest(command="ls -la", working_dir="/home/user")
        assert request.command == "ls -la"
        assert request.working_dir == "/home/user"
        assert request.timeout == 30

    def test_exec_request_custom_timeout(self) -> None:
        """Test exec request with custom timeout."""
        request = WorkspaceExecRequest(command="sleep 100", timeout=120)
        assert request.timeout == 120


class TestWorkspaceExecResponse:
    """Tests for WorkspaceExecResponse model."""

    def test_exec_response(self) -> None:
        """Test exec response."""
        response = WorkspaceExecResponse(
            exit_code=0,
            stdout="file1.txt\nfile2.txt",
            stderr="",
        )
        assert response.exit_code == 0
        assert "file1.txt" in response.stdout


class TestWorkspaceFileRequest:
    """Tests for WorkspaceFileRequest model."""

    def test_file_request_read(self) -> None:
        """Test file request for reading."""
        request = WorkspaceFileRequest(path="/home/user/file.txt")
        assert request.path == "/home/user/file.txt"
        assert request.content is None

    def test_file_request_write(self) -> None:
        """Test file request for writing."""
        request = WorkspaceFileRequest(
            path="/home/user/file.txt",
            content="Hello, World!",
        )
        assert request.content == "Hello, World!"


class TestWorkspaceScaleRequest:
    """Tests for WorkspaceScaleRequest model."""

    def test_scale_request(self) -> None:
        """Test scale request."""
        request = WorkspaceScaleRequest(new_tier="power")
        assert request.new_tier == "power"


class TestWorkspaceScaleResponse:
    """Tests for WorkspaceScaleResponse model."""

    def test_scale_response_success(self) -> None:
        """Test successful scale response."""
        response = WorkspaceScaleResponse(
            success=True,
            message="Scaled to power tier",
            new_tier="power",
            estimated_cost_per_hour=Decimal("0.20"),
        )
        assert response.success is True
        assert response.new_tier == "power"

    def test_scale_response_failure(self) -> None:
        """Test failed scale response."""
        response = WorkspaceScaleResponse(
            success=False,
            message="Insufficient resources",
        )
        assert response.success is False
        assert response.new_tier is None
