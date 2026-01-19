"""Workspace models shared across services."""

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class WorkspaceTier(str, Enum):
    """Workspace compute tier."""

    # Standard tiers (x86_64)
    STARTER = "starter"  # 2 vCPU, 4GB RAM (x86_64)
    PRO = "pro"  # 4 vCPU, 8GB RAM (x86_64)
    POWER = "power"  # 8 vCPU, 16GB RAM (x86_64)
    ENTERPRISE = "enterprise"  # 16 vCPU, 32GB RAM (x86_64)

    # x86 GPU tiers (NVIDIA GPUs)
    GPU_STARTER = "gpu_starter"  # 4 vCPU, 16GB RAM, T4 GPU (g4dn)
    GPU_PRO = "gpu_pro"  # 8 vCPU, 32GB RAM, A10G GPU (g5)
    GPU_POWER = "gpu_power"  # 16 vCPU, 64GB RAM, A100 GPU (p4d)

    # ML Accelerator tiers (TPU/custom silicon - more cost-effective than NVIDIA)
    ML_INFERENCE = "ml_inference"  # TPU - optimized for inference
    ML_TRAINING = "ml_training"  # TPU - optimized for training


class Architecture(str, Enum):
    """CPU architecture."""

    X86_64 = "x86_64"


class AcceleratorType(str, Enum):
    """GPU and ML accelerator types available."""

    # No accelerator
    NONE = "none"

    # NVIDIA GPUs (x86_64 only)
    T4 = "t4"  # 16GB VRAM, good for inference (g4dn instances)
    A10G = "a10g"  # 24GB VRAM, good for training (g5 instances)
    A100_40GB = "a100_40gb"  # 40GB VRAM, large-scale ML (p4d instances)
    A100_80GB = "a100_80gb"  # 80GB VRAM, maximum capability
    L4 = "l4"  # 24GB VRAM, inference optimized (g6 instances)
    H100 = "h100"  # 80GB HBM3, latest generation (p5 instances)

    # TPU/ML Accelerators (custom silicon, more cost-effective)
    TPU_V4 = "tpu_v4"  # TPU v4 - optimized for inference and training
    TPU_V5 = "tpu_v5"  # TPU v5 - latest generation TPU

    # AWS Inferentia (ML inference optimized)
    INFERENTIA2 = "inferentia2"  # AWS Inferentia2 chip for ML inference


# Backward compatibility alias
GPUType = AcceleratorType


class OSVersion(str, Enum):
    """Operating system versions."""

    UBUNTU_22_04 = "ubuntu-22.04"
    UBUNTU_24_04 = "ubuntu-24.04"
    DEBIAN_12 = "debian-12"
    ROCKY_LINUX_9 = "rocky-linux-9"
    ALPINE_3_19 = "alpine-3.19"
    AMAZON_LINUX_2023 = "amazon-linux-2023"


class PythonVersion(str, Enum):
    """Python versions available."""

    PYTHON_3_10 = "3.10"
    PYTHON_3_11 = "3.11"
    PYTHON_3_12 = "3.12"
    PYTHON_3_13 = "3.13"
    NONE = "none"


class NodeVersion(str, Enum):
    """Node.js versions available."""

    NODE_18 = "18"
    NODE_20 = "20"
    NODE_22 = "22"
    NONE = "none"


class GoVersion(str, Enum):
    """Go versions available."""

    GO_1_21 = "1.21"
    GO_1_22 = "1.22"
    GO_1_23 = "1.23"
    NONE = "none"


class RustChannel(str, Enum):
    """Rust release channels."""

    STABLE = "stable"
    BETA = "beta"
    NIGHTLY = "nightly"
    NONE = "none"


class TemplateCategory(str, Enum):
    """Pod template categories."""

    GENERAL = "general"
    WEB_DEVELOPMENT = "web_development"
    ML_DATA_SCIENCE = "ml_data_science"
    DEVOPS = "devops"
    MOBILE = "mobile"
    BLOCKCHAIN = "blockchain"
    GAME_DEV = "game_dev"
    EMBEDDED = "embedded"
    CUSTOM = "custom"


class WorkspaceStatus(str, Enum):
    """Workspace lifecycle status."""

    CREATING = "creating"
    RUNNING = "running"
    STOPPING = "stopping"
    STOPPED = "stopped"
    ERROR = "error"


class WorkspaceConfig(BaseModel):
    """Configuration for creating a new workspace."""

    # Compute tier
    tier: WorkspaceTier = WorkspaceTier.STARTER

    # Hardware configuration
    architecture: Architecture = Architecture.X86_64
    gpu_type: GPUType = GPUType.NONE

    # Operating system
    os_version: OSVersion = OSVersion.UBUNTU_22_04

    # Language versions
    python_version: PythonVersion = PythonVersion.PYTHON_3_12
    node_version: NodeVersion = NodeVersion.NODE_20
    go_version: GoVersion = GoVersion.GO_1_22
    rust_channel: RustChannel = RustChannel.STABLE

    # Additional packages to install
    apt_packages: list[str] = Field(default_factory=list, description="APT packages to install")
    pip_packages: list[str] = Field(default_factory=list, description="Python packages to install")
    npm_packages: list[str] = Field(default_factory=list, description="Global NPM packages")

    # Git repositories
    repos: list[str] = Field(default_factory=list, description="GitHub URLs to clone")
    git_credentials: str | None = Field(default=None, description="Git credentials for private")

    # Environment variables
    environment: dict[str, str] = Field(default_factory=dict, description="Environment variables")

    # Resource limits
    storage_gb: int = Field(default=20, ge=5, le=500, description="Storage in GB")
    timeout_hours: int = Field(default=24, ge=1, le=168, description="Max runtime in hours")

    # Pre/post initialization commands
    pre_init_commands: list[str] = Field(default_factory=list, description="Commands before setup")
    post_init_commands: list[str] = Field(default_factory=list, description="Commands after setup")

    # Template reference (if using a template)
    template_id: str | None = None

    # Git identity configuration (for commits)
    git_name: str | None = Field(default=None, description="Git user.name for commits")
    git_email: str | None = Field(default=None, description="Git user.email for commits")

    # Docker image to use (overrides default workspace image)
    # Supports Artifact Registry, Docker Hub, or custom registries
    # Example: "podex/workspace:nodejs", "us-docker.pkg.dev/my-project/workspace/ws:python"
    base_image: str | None = Field(
        default=None,
        description="Docker image for the workspace (template's base_image if not specified)",
    )

    # Dotfiles sync configuration
    sync_dotfiles: bool = Field(default=True, description="Whether to sync dotfiles")
    dotfiles_paths: list[str] | None = Field(
        default=None,
        description="List of dotfile paths to sync (e.g., '.bashrc', '.claude/')",
    )


class HardwareSpec(BaseModel):
    """Hardware specification for a compute tier."""

    tier: WorkspaceTier
    display_name: str
    description: str
    architecture: Architecture
    vcpu: int
    memory_mb: int
    gpu_type: GPUType = GPUType.NONE
    gpu_memory_gb: int | None = None
    storage_gb_default: int = 20
    storage_gb_max: int = 100
    hourly_rate: Decimal
    is_available: bool = True
    requires_subscription: str | None = None  # Minimum plan required
    region_availability: list[str] = Field(default_factory=list)

    # Compute routing flags (admin-configurable)
    is_gpu: bool = False  # Whether this tier has GPU/accelerator hardware
    requires_gke: bool = False  # Whether this tier requires GKE (Cloud Run doesn't support GPUs)

    model_config = {"from_attributes": True}


# Hardware specifications for each tier
HARDWARE_SPECS: dict[WorkspaceTier, HardwareSpec] = {
    WorkspaceTier.STARTER: HardwareSpec(
        tier=WorkspaceTier.STARTER,
        display_name="Starter",
        description="Basic development environment for learning and small projects",
        architecture=Architecture.X86_64,
        vcpu=2,
        memory_mb=4096,
        storage_gb_default=20,
        storage_gb_max=50,
        hourly_rate=Decimal("0.05"),
        region_availability=["us-east1"],
    ),
    WorkspaceTier.PRO: HardwareSpec(
        tier=WorkspaceTier.PRO,
        display_name="Pro",
        description="Professional development with more resources",
        architecture=Architecture.X86_64,
        vcpu=4,
        memory_mb=8192,
        storage_gb_default=50,
        storage_gb_max=100,
        hourly_rate=Decimal("0.10"),
        requires_subscription="starter",
        region_availability=["us-east1"],
    ),
    WorkspaceTier.POWER: HardwareSpec(
        tier=WorkspaceTier.POWER,
        display_name="Power",
        description="High-performance for large codebases and heavy compilation",
        architecture=Architecture.X86_64,
        vcpu=8,
        memory_mb=16384,
        storage_gb_default=100,
        storage_gb_max=200,
        hourly_rate=Decimal("0.20"),
        requires_subscription="pro",
        region_availability=["us-east1"],
    ),
    WorkspaceTier.ENTERPRISE: HardwareSpec(
        tier=WorkspaceTier.ENTERPRISE,
        display_name="Enterprise",
        description="Maximum resources for enterprise workloads",
        architecture=Architecture.X86_64,
        vcpu=16,
        memory_mb=32768,
        storage_gb_default=200,
        storage_gb_max=500,
        hourly_rate=Decimal("0.40"),
        requires_subscription="team",
        region_availability=["us-east1"],
    ),
    # x86 GPU tiers (NVIDIA GPUs)
    WorkspaceTier.GPU_STARTER: HardwareSpec(
        tier=WorkspaceTier.GPU_STARTER,
        display_name="GPU Starter",
        description="Entry-level GPU for ML inference and light training",
        architecture=Architecture.X86_64,
        vcpu=4,
        memory_mb=16384,
        gpu_type=GPUType.T4,
        gpu_memory_gb=16,
        storage_gb_default=50,
        storage_gb_max=200,
        hourly_rate=Decimal("0.50"),
        requires_subscription="pro",
        region_availability=["us-east1"],
        is_gpu=True,
        requires_gke=True,
    ),
    WorkspaceTier.GPU_PRO: HardwareSpec(
        tier=WorkspaceTier.GPU_PRO,
        display_name="GPU Pro",
        description="Professional GPU for model training",
        architecture=Architecture.X86_64,
        vcpu=8,
        memory_mb=32768,
        gpu_type=GPUType.A10G,
        gpu_memory_gb=24,
        storage_gb_default=100,
        storage_gb_max=500,
        hourly_rate=Decimal("1.00"),
        requires_subscription="team",
        region_availability=["us-east1"],
        is_gpu=True,
        requires_gke=True,
    ),
    WorkspaceTier.GPU_POWER: HardwareSpec(
        tier=WorkspaceTier.GPU_POWER,
        display_name="GPU Power",
        description="High-end GPU for large-scale ML workloads",
        architecture=Architecture.X86_64,
        vcpu=16,
        memory_mb=65536,
        gpu_type=GPUType.A100_40GB,
        gpu_memory_gb=40,
        storage_gb_default=200,
        storage_gb_max=1000,
        hourly_rate=Decimal("3.00"),
        requires_subscription="enterprise",
        region_availability=["us-east1"],
        is_gpu=True,
        requires_gke=True,
    ),
    # ML Accelerator tiers - TPU (more cost-effective than NVIDIA GPUs)
    WorkspaceTier.ML_INFERENCE: HardwareSpec(
        tier=WorkspaceTier.ML_INFERENCE,
        display_name="ML Inference",
        description="TPU v4 - optimized for ML inference at lower cost than GPU",
        architecture=Architecture.X86_64,
        vcpu=4,
        memory_mb=16384,
        gpu_type=AcceleratorType.TPU_V4,
        gpu_memory_gb=32,  # TPU v4 has 32GB HBM per chip
        storage_gb_default=100,
        storage_gb_max=500,
        hourly_rate=Decimal("0.35"),
        requires_subscription="pro",
        region_availability=["us-east1"],
        is_gpu=True,
        requires_gke=True,
    ),
    WorkspaceTier.ML_TRAINING: HardwareSpec(
        tier=WorkspaceTier.ML_TRAINING,
        display_name="ML Training",
        description="TPU v5 - optimized for ML training at lower cost than GPU",
        architecture=Architecture.X86_64,
        vcpu=8,
        memory_mb=32768,
        gpu_type=AcceleratorType.TPU_V5,
        gpu_memory_gb=64,  # TPU v5 has 64GB HBM per chip
        storage_gb_default=200,
        storage_gb_max=1000,
        hourly_rate=Decimal("0.75"),
        requires_subscription="team",
        region_availability=["us-east1"],
        is_gpu=True,
        requires_gke=True,
    ),
}


class SoftwareStackConfig(BaseModel):
    """Software stack configuration."""

    os_version: OSVersion
    python_version: PythonVersion | None = None
    node_version: NodeVersion | None = None
    go_version: GoVersion | None = None
    rust_channel: RustChannel | None = None

    # Pre-installed packages
    apt_packages: list[str] = Field(default_factory=list)
    pip_packages: list[str] = Field(default_factory=list)
    npm_packages: list[str] = Field(default_factory=list)

    # Docker image to use (if custom)
    custom_image: str | None = None


# Predefined software stacks for templates
SOFTWARE_STACKS: dict[str, SoftwareStackConfig] = {
    "default": SoftwareStackConfig(
        os_version=OSVersion.UBUNTU_22_04,
        python_version=PythonVersion.PYTHON_3_12,
        node_version=NodeVersion.NODE_20,
        go_version=GoVersion.GO_1_22,
        rust_channel=RustChannel.STABLE,
        pip_packages=["poetry", "black", "ruff", "mypy", "pytest", "httpie"],
        npm_packages=["typescript", "ts-node", "tsx", "eslint", "prettier"],
    ),
    "ml-data-science": SoftwareStackConfig(
        os_version=OSVersion.UBUNTU_22_04,
        python_version=PythonVersion.PYTHON_3_11,
        apt_packages=["libopenblas-dev", "libomp-dev"],
        pip_packages=[
            "numpy",
            "pandas",
            "scipy",
            "scikit-learn",
            "torch",
            "torchvision",
            "torchaudio",
            "tensorflow",
            "keras",
            "jupyter",
            "jupyterlab",
            "notebook",
            "matplotlib",
            "seaborn",
            "plotly",
            "transformers",
            "datasets",
            "accelerate",
            "mlflow",
            "wandb",
        ],
    ),
    "web3-blockchain": SoftwareStackConfig(
        os_version=OSVersion.UBUNTU_22_04,
        node_version=NodeVersion.NODE_20,
        rust_channel=RustChannel.STABLE,
        npm_packages=[
            "typescript",
            "ts-node",
            "hardhat",
            "@nomicfoundation/hardhat-toolbox",
            "ethers",
            "viem",
            "wagmi",
            "@solana/web3.js",
            "@project-serum/anchor",
        ],
        pip_packages=["vyper", "eth-brownie", "slither-analyzer"],
    ),
    "devops-platform": SoftwareStackConfig(
        os_version=OSVersion.UBUNTU_22_04,
        python_version=PythonVersion.PYTHON_3_12,
        go_version=GoVersion.GO_1_22,
        apt_packages=["apt-transport-https", "gnupg"],
        pip_packages=["ansible", "google-cloud-storage", "docker", "kubernetes"],
    ),
    "mobile-development": SoftwareStackConfig(
        os_version=OSVersion.UBUNTU_22_04,
        node_version=NodeVersion.NODE_20,
        npm_packages=[
            "react-native-cli",
            "expo-cli",
            "@react-native-community/cli",
            "typescript",
            "ts-node",
        ],
    ),
    "rust-development": SoftwareStackConfig(
        os_version=OSVersion.UBUNTU_22_04,
        rust_channel=RustChannel.STABLE,
        apt_packages=["pkg-config", "libssl-dev", "cmake"],
    ),
    "go-development": SoftwareStackConfig(
        os_version=OSVersion.UBUNTU_22_04,
        go_version=GoVersion.GO_1_22,
        apt_packages=["protobuf-compiler"],
    ),
}


class WorkspaceInfo(BaseModel):
    """Information about a running workspace."""

    id: str
    user_id: str
    session_id: str
    status: WorkspaceStatus
    tier: WorkspaceTier
    host: str  # Internal hostname/IP
    port: int
    container_id: str | None = None  # Docker container ID or Cloud Run execution name
    repos: list[str] = Field(default_factory=list)
    created_at: datetime
    last_activity: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = {"from_attributes": True}


class WorkspaceCreateRequest(BaseModel):
    """Request to create a new workspace."""

    session_id: str
    workspace_id: str | None = Field(
        default=None,
        description="Optional workspace ID. If not provided, compute service generates one.",
    )
    config: WorkspaceConfig = Field(default_factory=WorkspaceConfig)


class WorkspaceExecRequest(BaseModel):
    """Request to execute a command in a workspace."""

    command: str
    working_dir: str | None = None
    timeout: int = 30  # seconds


class WorkspaceExecResponse(BaseModel):
    """Response from executing a command."""

    exit_code: int
    stdout: str
    stderr: str


class WorkspaceFileRequest(BaseModel):
    """Request to read/write a file in workspace."""

    path: str
    content: str | None = None  # For write operations


class WorkspaceScaleRequest(BaseModel):
    """Request to scale a workspace's compute resources."""

    new_tier: WorkspaceTier = Field(description="The new compute tier to scale to")


class WorkspaceScaleResponse(BaseModel):
    """Response from scaling a workspace."""

    success: bool
    message: str
    new_tier: WorkspaceTier | None = None
    estimated_cost_per_hour: Decimal | None = None
    requires_restart: bool = True  # Scaling typically requires workspace restart
