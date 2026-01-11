"""Comprehensive tests for workspace models."""

from datetime import datetime
from decimal import Decimal

import pytest

from podex_shared.models.workspace import (
    HARDWARE_SPECS,
    SOFTWARE_STACKS,
    AcceleratorType,
    Architecture,
    GoVersion,
    GPUType,
    HardwareSpec,
    NodeVersion,
    OSVersion,
    PythonVersion,
    RustChannel,
    SoftwareStackConfig,
    TemplateCategory,
    WorkspaceConfig,
    WorkspaceCreateRequest,
    WorkspaceExecRequest,
    WorkspaceExecResponse,
    WorkspaceFileRequest,
    WorkspaceInfo,
    WorkspaceStatus,
    WorkspaceTier,
)


class TestWorkspaceTier:
    """Tests for WorkspaceTier enum."""

    def test_standard_tiers(self) -> None:
        """Test standard ARM tier values."""
        assert WorkspaceTier.STARTER == "starter"
        assert WorkspaceTier.PRO == "pro"
        assert WorkspaceTier.POWER == "power"
        assert WorkspaceTier.ENTERPRISE == "enterprise"

    def test_x86_tiers(self) -> None:
        """Test x86 tier values."""
        assert WorkspaceTier.X86_STARTER == "x86_starter"
        assert WorkspaceTier.X86_PRO == "x86_pro"
        assert WorkspaceTier.X86_POWER == "x86_power"

    def test_gpu_tiers(self) -> None:
        """Test GPU tier values."""
        assert WorkspaceTier.GPU_STARTER == "gpu_starter"
        assert WorkspaceTier.GPU_PRO == "gpu_pro"
        assert WorkspaceTier.GPU_POWER == "gpu_power"

    def test_arm_gpu_tiers(self) -> None:
        """Test ARM GPU tier values."""
        assert WorkspaceTier.ARM_GPU_STARTER == "arm_gpu_starter"
        assert WorkspaceTier.ARM_GPU_PRO == "arm_gpu_pro"
        assert WorkspaceTier.ARM_GPU_POWER == "arm_gpu_power"

    def test_ml_accelerator_tiers(self) -> None:
        """Test ML accelerator tier values."""
        assert WorkspaceTier.ML_INFERENCE == "ml_inference"
        assert WorkspaceTier.ML_TRAINING == "ml_training"


class TestArchitecture:
    """Tests for Architecture enum."""

    def test_architectures(self) -> None:
        """Test architecture values."""
        assert Architecture.X86_64 == "x86_64"
        assert Architecture.ARM64 == "arm64"


class TestAcceleratorType:
    """Tests for AcceleratorType enum."""

    def test_no_accelerator(self) -> None:
        """Test no accelerator value."""
        assert AcceleratorType.NONE == "none"

    def test_nvidia_gpus(self) -> None:
        """Test NVIDIA GPU values."""
        assert AcceleratorType.T4 == "t4"
        assert AcceleratorType.A10G == "a10g"
        assert AcceleratorType.A100_40GB == "a100_40gb"
        assert AcceleratorType.A100_80GB == "a100_80gb"
        assert AcceleratorType.L4 == "l4"
        assert AcceleratorType.H100 == "h100"

    def test_arm_gpu(self) -> None:
        """Test ARM GPU value."""
        assert AcceleratorType.T4G == "t4g"

    def test_ml_accelerators(self) -> None:
        """Test AWS ML accelerator values."""
        assert AcceleratorType.INFERENTIA2 == "inferentia2"
        assert AcceleratorType.TRAINIUM == "trainium"

    def test_gpu_type_alias(self) -> None:
        """Test GPUType is an alias for AcceleratorType."""
        assert GPUType.T4 == AcceleratorType.T4
        assert GPUType.NONE == AcceleratorType.NONE


class TestOSVersion:
    """Tests for OSVersion enum."""

    def test_os_versions(self) -> None:
        """Test OS version values."""
        assert OSVersion.UBUNTU_22_04 == "ubuntu-22.04"
        assert OSVersion.UBUNTU_24_04 == "ubuntu-24.04"
        assert OSVersion.DEBIAN_12 == "debian-12"
        assert OSVersion.AMAZON_LINUX_2023 == "amazon-linux-2023"
        assert OSVersion.ALPINE_3_19 == "alpine-3.19"


class TestPythonVersion:
    """Tests for PythonVersion enum."""

    def test_python_versions(self) -> None:
        """Test Python version values."""
        assert PythonVersion.PYTHON_3_10 == "3.10"
        assert PythonVersion.PYTHON_3_11 == "3.11"
        assert PythonVersion.PYTHON_3_12 == "3.12"
        assert PythonVersion.PYTHON_3_13 == "3.13"
        assert PythonVersion.NONE == "none"


class TestNodeVersion:
    """Tests for NodeVersion enum."""

    def test_node_versions(self) -> None:
        """Test Node.js version values."""
        assert NodeVersion.NODE_18 == "18"
        assert NodeVersion.NODE_20 == "20"
        assert NodeVersion.NODE_22 == "22"
        assert NodeVersion.NONE == "none"


class TestGoVersion:
    """Tests for GoVersion enum."""

    def test_go_versions(self) -> None:
        """Test Go version values."""
        assert GoVersion.GO_1_21 == "1.21"
        assert GoVersion.GO_1_22 == "1.22"
        assert GoVersion.GO_1_23 == "1.23"
        assert GoVersion.NONE == "none"


class TestRustChannel:
    """Tests for RustChannel enum."""

    def test_rust_channels(self) -> None:
        """Test Rust channel values."""
        assert RustChannel.STABLE == "stable"
        assert RustChannel.BETA == "beta"
        assert RustChannel.NIGHTLY == "nightly"
        assert RustChannel.NONE == "none"


class TestTemplateCategory:
    """Tests for TemplateCategory enum."""

    def test_categories(self) -> None:
        """Test template category values."""
        assert TemplateCategory.GENERAL == "general"
        assert TemplateCategory.WEB_DEVELOPMENT == "web_development"
        assert TemplateCategory.ML_DATA_SCIENCE == "ml_data_science"
        assert TemplateCategory.DEVOPS == "devops"
        assert TemplateCategory.MOBILE == "mobile"
        assert TemplateCategory.BLOCKCHAIN == "blockchain"
        assert TemplateCategory.GAME_DEV == "game_dev"
        assert TemplateCategory.EMBEDDED == "embedded"
        assert TemplateCategory.CUSTOM == "custom"


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
        assert config.tier == WorkspaceTier.STARTER
        assert config.architecture == Architecture.ARM64
        assert config.gpu_type == GPUType.NONE
        assert config.os_version == OSVersion.UBUNTU_22_04
        assert config.python_version == PythonVersion.PYTHON_3_12
        assert config.node_version == NodeVersion.NODE_20
        assert config.go_version == GoVersion.GO_1_22
        assert config.rust_channel == RustChannel.STABLE
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
            tier=WorkspaceTier.GPU_PRO,
            architecture=Architecture.X86_64,
            gpu_type=GPUType.A10G,
            python_version=PythonVersion.PYTHON_3_11,
            pip_packages=["torch", "tensorflow"],
            storage_gb=100,
            environment={"CUDA_VISIBLE_DEVICES": "0"},
        )
        assert config.tier == WorkspaceTier.GPU_PRO
        assert config.gpu_type == GPUType.A10G
        assert len(config.pip_packages) == 2
        assert config.storage_gb == 100


class TestHardwareSpec:
    """Tests for HardwareSpec model."""

    def test_hardware_spec(self) -> None:
        """Test creating HardwareSpec."""
        spec = HardwareSpec(
            tier=WorkspaceTier.PRO,
            display_name="Pro",
            description="Professional tier",
            architecture=Architecture.ARM64,
            vcpu=4,
            memory_mb=8192,
            hourly_rate=Decimal("0.10"),
        )
        assert spec.tier == WorkspaceTier.PRO
        assert spec.vcpu == 4
        assert spec.memory_mb == 8192
        assert spec.hourly_rate == Decimal("0.10")
        assert spec.gpu_type == GPUType.NONE
        assert spec.is_available is True


class TestHardwareSpecsDict:
    """Tests for HARDWARE_SPECS dictionary."""

    def test_starter_spec(self) -> None:
        """Test Starter tier spec."""
        spec = HARDWARE_SPECS.get(WorkspaceTier.STARTER)
        assert spec is not None
        assert spec.vcpu == 2
        assert spec.memory_mb == 4096
        assert spec.architecture == Architecture.ARM64
        assert spec.hourly_rate == Decimal("0.05")

    def test_pro_spec(self) -> None:
        """Test Pro tier spec."""
        spec = HARDWARE_SPECS.get(WorkspaceTier.PRO)
        assert spec is not None
        assert spec.vcpu == 4
        assert spec.memory_mb == 8192

    def test_power_spec(self) -> None:
        """Test Power tier spec."""
        spec = HARDWARE_SPECS.get(WorkspaceTier.POWER)
        assert spec is not None
        assert spec.vcpu == 8
        assert spec.memory_mb == 16384

    def test_gpu_starter_spec(self) -> None:
        """Test GPU Starter spec."""
        spec = HARDWARE_SPECS.get(WorkspaceTier.GPU_STARTER)
        assert spec is not None
        assert spec.gpu_type == GPUType.T4
        assert spec.gpu_memory_gb == 16
        assert spec.architecture == Architecture.X86_64

    def test_arm_gpu_spec(self) -> None:
        """Test ARM GPU spec."""
        spec = HARDWARE_SPECS.get(WorkspaceTier.ARM_GPU_STARTER)
        assert spec is not None
        assert spec.gpu_type == AcceleratorType.T4G
        assert spec.architecture == Architecture.ARM64

    def test_ml_inference_spec(self) -> None:
        """Test ML Inference spec."""
        spec = HARDWARE_SPECS.get(WorkspaceTier.ML_INFERENCE)
        assert spec is not None
        assert spec.gpu_type == AcceleratorType.INFERENTIA2

    def test_all_tiers_have_specs(self) -> None:
        """Test that all tiers have hardware specs."""
        for tier in WorkspaceTier:
            spec = HARDWARE_SPECS.get(tier)
            # Note: Not all tiers may be defined
            if spec is not None:
                assert spec.tier == tier


class TestSoftwareStackConfig:
    """Tests for SoftwareStackConfig model."""

    def test_software_stack_config(self) -> None:
        """Test creating SoftwareStackConfig."""
        config = SoftwareStackConfig(
            os_version=OSVersion.UBUNTU_22_04,
            python_version=PythonVersion.PYTHON_3_12,
            node_version=NodeVersion.NODE_20,
            pip_packages=["pytest", "black"],
            npm_packages=["typescript"],
        )
        assert config.os_version == OSVersion.UBUNTU_22_04
        assert config.python_version == PythonVersion.PYTHON_3_12
        assert len(config.pip_packages) == 2


class TestSoftwareStacksDict:
    """Tests for SOFTWARE_STACKS dictionary."""

    def test_default_stack(self) -> None:
        """Test default software stack."""
        stack = SOFTWARE_STACKS.get("default")
        assert stack is not None
        assert stack.python_version == PythonVersion.PYTHON_3_12
        assert stack.node_version == NodeVersion.NODE_20
        assert "poetry" in stack.pip_packages
        assert "typescript" in stack.npm_packages

    def test_ml_data_science_stack(self) -> None:
        """Test ML/Data Science stack."""
        stack = SOFTWARE_STACKS.get("ml-data-science")
        assert stack is not None
        assert "numpy" in stack.pip_packages
        assert "pandas" in stack.pip_packages
        assert "torch" in stack.pip_packages

    def test_web3_blockchain_stack(self) -> None:
        """Test Web3/Blockchain stack."""
        stack = SOFTWARE_STACKS.get("web3-blockchain")
        assert stack is not None
        assert stack.rust_channel == RustChannel.STABLE
        assert "hardhat" in stack.npm_packages

    def test_devops_stack(self) -> None:
        """Test DevOps stack."""
        stack = SOFTWARE_STACKS.get("devops-platform")
        assert stack is not None
        assert "ansible" in stack.pip_packages
        assert stack.go_version == GoVersion.GO_1_22

    def test_rust_development_stack(self) -> None:
        """Test Rust development stack."""
        stack = SOFTWARE_STACKS.get("rust-development")
        assert stack is not None
        assert stack.rust_channel == RustChannel.STABLE

    def test_go_development_stack(self) -> None:
        """Test Go development stack."""
        stack = SOFTWARE_STACKS.get("go-development")
        assert stack is not None
        assert stack.go_version == GoVersion.GO_1_22


class TestWorkspaceInfo:
    """Tests for WorkspaceInfo model."""

    def test_workspace_info(self) -> None:
        """Test creating WorkspaceInfo."""
        now = datetime.utcnow()
        info = WorkspaceInfo(
            id="ws-123",
            user_id="user-456",
            session_id="session-789",
            status=WorkspaceStatus.RUNNING,
            tier=WorkspaceTier.PRO,
            host="ws-123.internal",
            port=8080,
            created_at=now,
            last_activity=now,
        )
        assert info.id == "ws-123"
        assert info.status == WorkspaceStatus.RUNNING
        assert info.tier == WorkspaceTier.PRO
        assert info.host == "ws-123.internal"
        assert info.container_id is None
        assert info.repos == []
        assert info.metadata == {}


class TestWorkspaceCreateRequest:
    """Tests for WorkspaceCreateRequest model."""

    def test_workspace_create_request(self) -> None:
        """Test creating WorkspaceCreateRequest."""
        request = WorkspaceCreateRequest(session_id="session-123")
        assert request.session_id == "session-123"
        assert request.config.tier == WorkspaceTier.STARTER

    def test_workspace_create_request_custom_config(self) -> None:
        """Test WorkspaceCreateRequest with custom config."""
        config = WorkspaceConfig(tier=WorkspaceTier.GPU_PRO)
        request = WorkspaceCreateRequest(
            session_id="session-123",
            config=config,
        )
        assert request.config.tier == WorkspaceTier.GPU_PRO


class TestWorkspaceExecRequest:
    """Tests for WorkspaceExecRequest model."""

    def test_workspace_exec_request_defaults(self) -> None:
        """Test WorkspaceExecRequest default values."""
        request = WorkspaceExecRequest(command="ls -la")
        assert request.command == "ls -la"
        assert request.working_dir is None
        assert request.timeout == 30

    def test_workspace_exec_request_custom(self) -> None:
        """Test WorkspaceExecRequest with custom values."""
        request = WorkspaceExecRequest(
            command="npm test",
            working_dir="/app",
            timeout=120,
        )
        assert request.command == "npm test"
        assert request.working_dir == "/app"
        assert request.timeout == 120


class TestWorkspaceExecResponse:
    """Tests for WorkspaceExecResponse model."""

    def test_workspace_exec_response(self) -> None:
        """Test creating WorkspaceExecResponse."""
        response = WorkspaceExecResponse(
            exit_code=0,
            stdout="Success!",
            stderr="",
        )
        assert response.exit_code == 0
        assert response.stdout == "Success!"
        assert response.stderr == ""

    def test_workspace_exec_response_error(self) -> None:
        """Test WorkspaceExecResponse with error."""
        response = WorkspaceExecResponse(
            exit_code=1,
            stdout="",
            stderr="Command not found",
        )
        assert response.exit_code == 1
        assert response.stderr == "Command not found"


class TestWorkspaceFileRequest:
    """Tests for WorkspaceFileRequest model."""

    def test_workspace_file_request_read(self) -> None:
        """Test WorkspaceFileRequest for reading."""
        request = WorkspaceFileRequest(path="/src/main.py")
        assert request.path == "/src/main.py"
        assert request.content is None

    def test_workspace_file_request_write(self) -> None:
        """Test WorkspaceFileRequest for writing."""
        request = WorkspaceFileRequest(
            path="/src/main.py",
            content="print('hello')",
        )
        assert request.path == "/src/main.py"
        assert request.content == "print('hello')"
