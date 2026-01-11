"""AWS-based compute manager for production (ECS Fargate for CPU, EC2 for GPU)."""

import base64
import shlex
import uuid
from datetime import UTC, datetime
from typing import Any

import aioboto3
import httpx
import structlog

from podex_shared.models.workspace import (
    HARDWARE_SPECS,
    AcceleratorType,
    Architecture,
    GPUType,
)
from src.config import settings
from src.managers.base import ComputeManager, ProxyRequest
from src.models.workspace import (
    WorkspaceConfig,
    WorkspaceExecResponse,
    WorkspaceInfo,
    WorkspaceStatus,
    WorkspaceTier,
)

logger = structlog.get_logger()

# Constants for parsing command output
MIN_LS_PARTS = 9
MIN_SS_PARTS = 4
SS_LOCAL_ADDR_INDEX = 3
SS_ALT_LOCAL_ADDR_INDEX = 2
SS_PROCESS_INFO_MIN_PARTS = 6
MIN_SYSTEM_PORT = 1024
PROCESS_NAME_START_OFFSET = 3
MIN_PROCESS_NAME_START = 2


# x86 GPU tiers require EC2 launch type (Fargate doesn't support GPUs/accelerators)
GPU_TIERS = {
    WorkspaceTier.GPU_STARTER,
    WorkspaceTier.GPU_PRO,
    WorkspaceTier.GPU_POWER,
}

# ARM GPU tiers (Graviton2 + NVIDIA T4G via g5g instances)
ARM_GPU_TIERS = {
    WorkspaceTier.ARM_GPU_STARTER,
    WorkspaceTier.ARM_GPU_PRO,
    WorkspaceTier.ARM_GPU_POWER,
}

# ML Accelerator tiers (AWS custom silicon - Inferentia/Trainium)
ML_ACCELERATOR_TIERS = {
    WorkspaceTier.ML_INFERENCE,
    WorkspaceTier.ML_TRAINING,
}

# All tiers requiring EC2 (any accelerator - GPU or ML)
ACCELERATOR_TIERS = GPU_TIERS | ARM_GPU_TIERS | ML_ACCELERATOR_TIERS

# ARM CPU-only tiers use Graviton processors (more cost-effective)
ARM_TIERS = {
    WorkspaceTier.ARM_STARTER,
    WorkspaceTier.ARM_PRO,
}

# x86 CPU-only tiers (for software requiring Intel/AMD compatibility)
X86_CPU_TIERS = {
    WorkspaceTier.X86_STARTER,
    WorkspaceTier.X86_PRO,
    WorkspaceTier.X86_POWER,
}

# Mapping of accelerator types to EC2 instance types
# This is where we map our tier accelerators to actual AWS instance types
ACCELERATOR_INSTANCE_TYPES = {
    # NVIDIA GPUs (x86_64)
    AcceleratorType.T4: "g4dn.xlarge",  # 4 vCPU, 16GB RAM, 1x T4 GPU
    AcceleratorType.A10G: "g5.2xlarge",  # 8 vCPU, 32GB RAM, 1x A10G GPU
    AcceleratorType.A100_40GB: "p4d.24xlarge",  # 96 vCPU, 8x A100 GPUs
    AcceleratorType.A100_80GB: "p5.48xlarge",  # 192 vCPU, 8x H100 GPUs
    AcceleratorType.L4: "g6.xlarge",  # 4 vCPU, 16GB RAM, 1x L4 GPU
    AcceleratorType.H100: "p5.48xlarge",  # 192 vCPU, 8x H100 GPUs
    # NVIDIA GPUs (ARM64 - Graviton2 + T4G)
    AcceleratorType.T4G: "g5g.xlarge",  # 4 vCPU, 8GB RAM, 1x T4G GPU (ARM!)
    # AWS ML Accelerators (custom silicon)
    AcceleratorType.INFERENTIA2: "inf2.xlarge",  # 4 vCPU, 16GB RAM, 1x Inferentia2
    AcceleratorType.TRAINIUM: "trn1.2xlarge",  # 8 vCPU, 32GB RAM, 1x Trainium
}

# Detailed instance sizing by tier (for capacity provider selection)
TIER_INSTANCE_SIZES = {
    # x86 GPU tiers
    WorkspaceTier.GPU_STARTER: "g4dn.xlarge",  # 4 vCPU, 16GB
    WorkspaceTier.GPU_PRO: "g5.2xlarge",  # 8 vCPU, 32GB
    WorkspaceTier.GPU_POWER: "p4d.24xlarge",  # 96 vCPU, 1152GB (multi-GPU)
    # ARM GPU tiers (g5g instances)
    WorkspaceTier.ARM_GPU_STARTER: "g5g.xlarge",  # 4 vCPU, 8GB, 1x T4G
    WorkspaceTier.ARM_GPU_PRO: "g5g.2xlarge",  # 8 vCPU, 16GB, 1x T4G
    WorkspaceTier.ARM_GPU_POWER: "g5g.4xlarge",  # 16 vCPU, 32GB, 1x T4G
    # ML Accelerator tiers
    WorkspaceTier.ML_INFERENCE: "inf2.xlarge",  # 4 vCPU, 16GB
    WorkspaceTier.ML_TRAINING: "trn1.2xlarge",  # 8 vCPU, 32GB
}

# Capacity provider names for accelerators (must match CDK-created providers)
ACCELERATOR_CAPACITY_PROVIDERS = {
    # NVIDIA GPUs (x86)
    AcceleratorType.T4: "gpu-t4-provider",
    AcceleratorType.A10G: "gpu-a10g-provider",
    AcceleratorType.A100_40GB: "gpu-a100-provider",
    AcceleratorType.A100_80GB: "gpu-a100-80-provider",
    AcceleratorType.L4: "gpu-l4-provider",
    AcceleratorType.H100: "gpu-h100-provider",
    # NVIDIA GPUs (ARM - g5g)
    AcceleratorType.T4G: "gpu-arm-t4g-provider",
    # AWS ML Accelerators
    AcceleratorType.INFERENTIA2: "ml-inferentia2-provider",
    AcceleratorType.TRAINIUM: "ml-trainium-provider",
}

# Backward compatibility aliases
GPU_INSTANCE_TYPES = ACCELERATOR_INSTANCE_TYPES
GPU_CAPACITY_PROVIDERS = ACCELERATOR_CAPACITY_PROVIDERS


class AWSComputeManager(ComputeManager):
    """Production implementation using AWS ECS.

    Architecture:
    - **CPU tiers (STARTER, PRO, POWER, ENTERPRISE, ARM_*)**: Uses ECS Fargate
      for serverless, cost-effective compute. No GPU support but auto-scales.

    - **GPU tiers (GPU_STARTER, GPU_PRO, GPU_POWER)**: Uses ECS on EC2 with
      GPU-enabled instances (g4dn, g5, p4d). Requires capacity providers with
      auto-scaling groups of GPU instances.

    Features:
    - Creates isolated ECS tasks for each workspace
    - Supports warm pool via ECS capacity providers
    - Tier-based resource allocation (CPU, memory, GPU)
    - Integration with EFS for persistent storage
    - SSM Session Manager for command execution
    - GPU support via EC2 launch type with NVIDIA instances
    """

    def __init__(self) -> None:
        """Initialize AWS clients."""
        self._session = aioboto3.Session()
        self._workspaces: dict[str, WorkspaceInfo] = {}
        self._file_sync: Any = None  # Optional file sync service
        logger.info(
            "AWSComputeManager initialized",
            region=settings.aws_region,
            cluster=settings.ecs_cluster_name,
        )

    def _is_gpu_tier(self, tier: WorkspaceTier) -> bool:
        """Check if the tier requires x86 NVIDIA GPU compute."""
        return tier in GPU_TIERS

    def _is_arm_gpu_tier(self, tier: WorkspaceTier) -> bool:
        """Check if the tier uses ARM GPU (Graviton2 + T4G via g5g)."""
        return tier in ARM_GPU_TIERS

    def _is_ml_accelerator_tier(self, tier: WorkspaceTier) -> bool:
        """Check if the tier uses AWS ML accelerators (Inferentia/Trainium)."""
        return tier in ML_ACCELERATOR_TIERS

    def _requires_ec2(self, tier: WorkspaceTier) -> bool:
        """Check if the tier requires EC2 (has GPU or ML accelerator).

        Fargate doesn't support GPUs or ML accelerators, so these tiers
        must use ECS on EC2 with capacity providers.
        """
        return tier in ACCELERATOR_TIERS

    def _is_arm_tier(self, tier: WorkspaceTier) -> bool:
        """Check if the tier uses ARM architecture (Graviton).

        This includes ARM CPU-only tiers AND ARM GPU tiers (g5g).
        """
        spec = HARDWARE_SPECS.get(tier)
        if spec:
            return spec.architecture == Architecture.ARM64  # type: ignore[no-any-return]
        return tier in ARM_TIERS or tier in ARM_GPU_TIERS

    def _get_accelerator_type(self, tier: WorkspaceTier) -> AcceleratorType:
        """Get the accelerator type (GPU or ML accelerator) for a tier."""
        spec = HARDWARE_SPECS.get(tier)
        if spec:
            return spec.gpu_type  # gpu_type field holds AcceleratorType
        return AcceleratorType.NONE

    def _get_gpu_type(self, tier: WorkspaceTier) -> GPUType:
        """Get the GPU type for a tier (alias for _get_accelerator_type)."""
        return self._get_accelerator_type(tier)

    def _get_architecture(self, tier: WorkspaceTier) -> Architecture:
        """Get the CPU architecture for a tier."""
        spec = HARDWARE_SPECS.get(tier)
        if spec:
            return spec.architecture
        return Architecture.ARM64  # Default to ARM for cost efficiency

    def _get_container_image(
        self,
        config: WorkspaceConfig,
        architecture: Architecture,
        requires_ec2: bool,
        is_ml_accelerator: bool,
    ) -> str:
        """Determine the container image to use for the workspace.

        Selects the appropriate container image based on:
        - User/template override (config.base_image)
        - CPU architecture (ARM64 vs x86_64)
        - Accelerator type (GPU vs ML accelerator vs CPU-only)

        Args:
            config: Workspace configuration with optional base_image override.
            architecture: CPU architecture (ARM64 or X86_64).
            requires_ec2: Whether the tier needs EC2 (has GPU/ML accelerator).
            is_ml_accelerator: Whether the tier uses AWS ML accelerators.

        Returns:
            Container image URI to use for the workspace.
        """
        # Priority 1: User or template specified a custom image
        if config.base_image:
            logger.debug(
                "Using custom base image from config",
                image=config.base_image,
            )
            return config.base_image  # type: ignore[no-any-return]

        # Priority 2: Select architecture and accelerator-appropriate image
        if is_ml_accelerator:
            # AWS ML accelerators (Inferentia/Trainium) need Neuron SDK runtime
            return settings.workspace_image_ml

        if requires_ec2:
            # GPU tiers - select based on architecture
            if architecture == Architecture.ARM64:
                # ARM GPU (Graviton2 + T4G via g5g instances)
                return settings.workspace_image_arm_gpu
            # x86 NVIDIA GPU (T4, A10G, A100, H100)
            return settings.workspace_image_gpu

        # CPU-only tiers - select based on architecture
        if architecture == Architecture.ARM64:
            return settings.workspace_image_arm64

        return settings.workspace_image_x86

    def _get_resource_config(self, tier: WorkspaceTier) -> dict[str, Any]:
        """Get ECS task resource configuration for a tier.

        Returns CPU units, memory, and GPU requirements based on the tier.
        For GPU tiers, also includes the GPU resource requirements for ECS.
        """
        # Try to get from hardware specs first
        spec = HARDWARE_SPECS.get(tier)
        if spec:
            config: dict[str, Any] = {
                "cpu": str(spec.vcpu * 1024),  # ECS uses CPU units (1024 = 1 vCPU)
                "memory": str(spec.memory_mb),
            }
            # Add GPU requirements for GPU tiers
            if spec.gpu_type != GPUType.NONE:
                config["gpu_count"] = 1  # Can be extended for multi-GPU
                config["gpu_type"] = spec.gpu_type
            return config

        # Fallback to settings-based configs for backward compatibility
        configs = {
            WorkspaceTier.STARTER: {
                "cpu": str(settings.tier_starter_cpu * 1024),
                "memory": str(settings.tier_starter_memory),
            },
            WorkspaceTier.PRO: {
                "cpu": str(settings.tier_pro_cpu * 1024),
                "memory": str(settings.tier_pro_memory),
            },
            WorkspaceTier.POWER: {
                "cpu": str(settings.tier_power_cpu * 1024),
                "memory": str(settings.tier_power_memory),
            },
            WorkspaceTier.ENTERPRISE: {
                "cpu": str(settings.tier_enterprise_cpu * 1024),
                "memory": str(settings.tier_enterprise_memory),
            },
        }
        return configs.get(tier, configs[WorkspaceTier.STARTER])

    async def create_workspace(  # noqa: PLR0915
        self,
        user_id: str,
        session_id: str,
        config: WorkspaceConfig,
        workspace_id: str | None = None,
    ) -> WorkspaceInfo:
        """Create a new ECS task workspace.

        Uses Fargate for CPU tiers and EC2 with GPU instances for GPU tiers.
        """
        # Use provided workspace_id or generate one
        workspace_id = workspace_id or f"ws_{uuid.uuid4().hex[:12]}"
        requires_ec2 = self._requires_ec2(config.tier)
        is_gpu = self._is_gpu_tier(config.tier)
        is_ml_accelerator = self._is_ml_accelerator_tier(config.tier)
        is_arm = self._is_arm_tier(config.tier)
        architecture = self._get_architecture(config.tier)
        accelerator_type = self._get_accelerator_type(config.tier)

        logger.info(
            "Creating AWS workspace",
            workspace_id=workspace_id,
            user_id=user_id,
            tier=config.tier,
            architecture=architecture.value,
            requires_ec2=requires_ec2,
            is_gpu=is_gpu,
            is_ml_accelerator=is_ml_accelerator,
            is_arm=is_arm,
            accelerator_type=accelerator_type.value if accelerator_type else None,
        )

        resource_config = self._get_resource_config(config.tier)

        async with self._session.client(
            "ecs",
            region_name=settings.aws_region,
            endpoint_url=settings.aws_endpoint,
        ) as ecs:
            # Build task definition based on tier and architecture
            # Task definitions are architecture-specific (ARM64 vs x86_64) and accelerator-aware
            is_arm_gpu = self._is_arm_gpu_tier(config.tier)

            if is_arm_gpu:
                # ARM GPU tiers use Graviton2 + T4G (g5g instances) task definition
                task_definition = settings.ecs_arm_gpu_task_definition
            elif is_gpu:
                # x86 NVIDIA GPU tiers use x86_64 GPU task definition
                task_definition = settings.ecs_gpu_task_definition
            elif is_ml_accelerator:
                # AWS ML accelerators use specialized task definition with Neuron runtime
                task_definition = settings.ecs_ml_accelerator_task_definition
            elif is_arm:
                # ARM CPU-only tiers use Graviton-optimized task definition
                task_definition = settings.ecs_arm_task_definition
            else:
                # Default x86_64 CPU task definition
                task_definition = settings.ecs_task_definition

            # Determine the container image to use
            # Priority: config.base_image > architecture/tier-specific default
            container_image = self._get_container_image(
                config, architecture, requires_ec2, is_ml_accelerator
            )

            # Build container overrides
            container_overrides: list[dict[str, Any]] = [
                {
                    "name": "workspace",
                    "environment": [
                        {"name": "WORKSPACE_ID", "value": workspace_id},
                        {"name": "USER_ID", "value": user_id},
                        {"name": "SESSION_ID", "value": session_id},
                        {"name": "GPU_ENABLED", "value": "true" if is_gpu else "false"},
                        {"name": "ARCH", "value": architecture.value},
                        {"name": "TEMPLATE_ID", "value": config.template_id or ""},
                        *[{"name": k, "value": v} for k, v in config.environment.items()],
                    ],
                },
            ]

            # Set the container image (always specified based on architecture/tier)
            container_overrides[0]["image"] = container_image
            logger.info(
                "Using container image",
                image=container_image,
                architecture=architecture.value,
                is_custom=bool(config.base_image),
                workspace_id=workspace_id,
            )

            # Add accelerator resource requirements for GPU/ML accelerator tiers
            if requires_ec2 and accelerator_type != AcceleratorType.NONE:
                if is_gpu:
                    # NVIDIA GPUs use "GPU" resource type
                    container_overrides[0]["resourceRequirements"] = [
                        {"type": "GPU", "value": str(resource_config.get("gpu_count", 1))}
                    ]
                elif is_ml_accelerator:
                    # AWS Inferentia/Trainium use "InferenceAccelerator" resource type
                    # Note: Inferentia2 and Trainium use AWS Neuron SDK
                    container_overrides[0]["resourceRequirements"] = [
                        {"type": "InferenceAccelerator", "value": "1"}
                    ]

            # Build overrides
            overrides: dict[str, Any] = {
                "cpu": resource_config["cpu"],
                "memory": resource_config["memory"],
                "containerOverrides": container_overrides,
            }

            # Build tags
            tags = [
                {"key": "podex:workspace_id", "value": workspace_id},
                {"key": "podex:user_id", "value": user_id},
                {"key": "podex:session_id", "value": session_id},
                {"key": "podex:tier", "value": config.tier.value},
                {"key": "podex:architecture", "value": architecture.value},
            ]
            if accelerator_type != AcceleratorType.NONE:
                tags.append({"key": "podex:accelerator_type", "value": accelerator_type.value})

            # Build run_task parameters
            run_task_params: dict[str, Any] = {
                "cluster": settings.ecs_cluster_name,
                "taskDefinition": task_definition,
                "networkConfiguration": {
                    "awsvpcConfiguration": {
                        "subnets": settings.ecs_subnets,
                        "securityGroups": settings.ecs_security_groups,
                        "assignPublicIp": "DISABLED",
                    },
                },
                "overrides": overrides,
                "tags": tags,
            }

            if requires_ec2:
                # GPU/ML accelerator tiers use EC2 launch type with capacity providers
                # Capacity providers are auto-scaling groups of accelerator instances
                capacity_provider = ACCELERATOR_CAPACITY_PROVIDERS.get(
                    accelerator_type, "gpu-t4-provider"
                )
                run_task_params["capacityProviderStrategy"] = [
                    {"capacityProvider": capacity_provider, "weight": 1, "base": 0}
                ]
                logger.info(
                    "Using accelerator capacity provider",
                    capacity_provider=capacity_provider,
                    accelerator_type=accelerator_type.value,
                    is_gpu=is_gpu,
                    is_ml_accelerator=is_ml_accelerator,
                )
            else:
                # CPU-only tiers use Fargate (serverless)
                run_task_params["launchType"] = "FARGATE"

            # Run ECS task
            response = await ecs.run_task(**run_task_params)

            if not response.get("tasks"):
                failures = response.get("failures", [])
                msg = f"Failed to create ECS task: {failures}"
                raise RuntimeError(msg)

            task = response["tasks"][0]
            task_arn = task["taskArn"]

            # Wait for task to be running (simplified - should use waiters)
            # In production, this would poll until the task is RUNNING

            workspace_info = WorkspaceInfo(
                id=workspace_id,
                user_id=user_id,
                session_id=session_id,
                status=WorkspaceStatus.CREATING,
                tier=config.tier,
                host=task_arn,  # Will be replaced with actual IP once running
                port=3000,
                container_id=task_arn,
                repos=config.repos,
                created_at=datetime.now(UTC),
                last_activity=datetime.now(UTC),
                metadata={"task_arn": task_arn},
            )

            self._workspaces[workspace_id] = workspace_info

            logger.info(
                "AWS workspace created",
                workspace_id=workspace_id,
                task_arn=task_arn,
            )

            return workspace_info

    async def stop_workspace(self, workspace_id: str) -> None:
        """Stop an ECS task workspace."""
        workspace = self._workspaces.get(workspace_id)
        if not workspace or not workspace.container_id:
            return

        async with self._session.client(
            "ecs",
            region_name=settings.aws_region,
            endpoint_url=settings.aws_endpoint,
        ) as ecs:
            await ecs.stop_task(
                cluster=settings.ecs_cluster_name,
                task=workspace.container_id,
                reason="User requested stop",
            )

        workspace.status = WorkspaceStatus.STOPPED
        workspace.last_activity = datetime.now(UTC)
        logger.info("AWS workspace stopped", workspace_id=workspace_id)

    async def delete_workspace(self, workspace_id: str, preserve_files: bool = True) -> None:
        """Delete a workspace (stop task and cleanup).

        Args:
            workspace_id: The workspace to delete
            preserve_files: If True, files remain in S3. If False, S3 files are deleted too.
        """
        # Stop the workspace container first
        await self.stop_workspace(workspace_id)

        # Clean up S3 files if requested
        if not preserve_files and self._file_sync:
            try:
                await self._file_sync.delete_workspace_files(workspace_id)
                logger.info("Deleted S3 files for workspace", workspace_id=workspace_id)
            except Exception as e:
                logger.warning(
                    "Failed to delete S3 files for workspace",
                    workspace_id=workspace_id,
                    error=str(e),
                )

        # Remove from local tracking
        if workspace_id in self._workspaces:
            del self._workspaces[workspace_id]

        logger.info(
            "Workspace deleted",
            workspace_id=workspace_id,
            files_preserved=preserve_files,
        )

    async def get_workspace(self, workspace_id: str) -> WorkspaceInfo | None:
        """Get workspace information from ECS."""
        workspace = self._workspaces.get(workspace_id)
        if not workspace:
            return None

        if workspace.container_id:
            async with self._session.client(
                "ecs",
                region_name=settings.aws_region,
                endpoint_url=settings.aws_endpoint,
            ) as ecs:
                response = await ecs.describe_tasks(
                    cluster=settings.ecs_cluster_name,
                    tasks=[workspace.container_id],
                )

                if response.get("tasks"):
                    task = response["tasks"][0]
                    status = task.get("lastStatus", "UNKNOWN")

                    if status == "RUNNING":
                        workspace.status = WorkspaceStatus.RUNNING
                        # Get the private IP
                        for attachment in task.get("attachments", []):
                            if attachment.get("type") == "ElasticNetworkInterface":
                                for detail in attachment.get("details", []):
                                    if detail.get("name") == "privateIPv4Address":
                                        workspace.host = detail.get("value", workspace.host)
                    elif status == "STOPPED":
                        workspace.status = WorkspaceStatus.STOPPED
                    elif status in ("PENDING", "PROVISIONING"):
                        workspace.status = WorkspaceStatus.CREATING

        return workspace

    async def list_workspaces(
        self,
        user_id: str | None = None,
        session_id: str | None = None,
    ) -> list[WorkspaceInfo]:
        """List workspaces filtered by user or session."""
        workspaces = list(self._workspaces.values())

        if user_id:
            workspaces = [w for w in workspaces if w.user_id == user_id]
        if session_id:
            workspaces = [w for w in workspaces if w.session_id == session_id]

        return workspaces

    async def exec_command(
        self,
        workspace_id: str,
        command: str,
        working_dir: str | None = None,
        timeout: int = 30,
    ) -> WorkspaceExecResponse:
        """Execute a command via ECS Exec / SSM Session Manager.

        Note: The command parameter is executed directly - callers must ensure
        it is properly sanitized or constructed from safe inputs.
        """
        workspace = self._workspaces.get(workspace_id)
        if not workspace or not workspace.container_id:
            msg = f"Workspace {workspace_id} not found"
            raise ValueError(msg)

        # Sanitize working_dir to prevent command injection
        safe_working_dir = shlex.quote(working_dir) if working_dir else "/home/dev"

        try:
            # Use SSM Run Command for non-interactive execution
            async with self._session.client(
                "ssm",
                region_name=settings.aws_region,
                endpoint_url=settings.aws_endpoint,
            ) as ssm:
                # Get the EC2 instance ID from ECS task
                async with self._session.client(
                    "ecs",
                    region_name=settings.aws_region,
                    endpoint_url=settings.aws_endpoint,
                ) as ecs:
                    task_response = await ecs.describe_tasks(
                        cluster=settings.ecs_cluster_name,
                        tasks=[workspace.container_id],
                    )

                    if not task_response.get("tasks"):
                        raise ValueError(f"Task {workspace.container_id} not found")

                    task = task_response["tasks"][0]
                    container_instance_arn = task.get("containerInstanceArn")

                    if not container_instance_arn:
                        # Fargate task - use ECS Exec instead
                        return await self._exec_command_fargate(
                            workspace, command, safe_working_dir, timeout
                        )

                    # Get EC2 instance ID for EC2 launch type
                    ci_response = await ecs.describe_container_instances(
                        cluster=settings.ecs_cluster_name,
                        containerInstances=[container_instance_arn],
                    )

                    if not ci_response.get("containerInstances"):
                        raise ValueError("Container instance not found")

                    instance_id = ci_response["containerInstances"][0].get("ec2InstanceId")

                # Execute command via SSM Run Command
                full_command = f"cd {safe_working_dir} && {command}"
                send_response = await ssm.send_command(
                    InstanceIds=[instance_id],
                    DocumentName="AWS-RunShellScript",
                    Parameters={"commands": [full_command]},
                    TimeoutSeconds=timeout,
                )

                command_id = send_response["Command"]["CommandId"]

                # Wait for command to complete
                import asyncio  # noqa: PLC0415

                for _ in range(timeout):
                    await asyncio.sleep(1)
                    result = await ssm.get_command_invocation(
                        CommandId=command_id,
                        InstanceId=instance_id,
                    )

                    status = result.get("Status")
                    if status in ("Success", "Failed", "Cancelled", "TimedOut"):
                        return WorkspaceExecResponse(
                            exit_code=result.get("ResponseCode", -1),
                            stdout=result.get("StandardOutputContent", ""),
                            stderr=result.get("StandardErrorContent", ""),
                        )

                # Timeout
                return WorkspaceExecResponse(
                    exit_code=-1,
                    stdout="",
                    stderr="Command execution timed out",
                )

        except Exception as e:
            logger.exception("Failed to execute command", workspace_id=workspace_id, error=str(e))
            return WorkspaceExecResponse(
                exit_code=-1,
                stdout="",
                stderr=str(e),
            )

    async def _exec_command_fargate(
        self,
        workspace: WorkspaceInfo,
        command: str,
        working_dir: str,
        timeout: int,  # noqa: ARG002
    ) -> WorkspaceExecResponse:
        """Execute command on Fargate task using ECS Exec."""

        try:
            async with self._session.client(
                "ecs",
                region_name=settings.aws_region,
                endpoint_url=settings.aws_endpoint,
            ) as ecs:
                # Start ECS Exec session
                full_command = f"cd {working_dir} && {command}"
                response = await ecs.execute_command(
                    cluster=settings.ecs_cluster_name,
                    task=workspace.container_id,
                    container="workspace",
                    interactive=False,
                    command=full_command,
                )

                # For non-interactive, get session output
                session = response.get("session", {})
                stream_url = session.get("streamUrl")
                token = session.get("tokenValue")

                if not stream_url or not token:
                    # Fallback for when session data isn't available
                    logger.warning(
                        "ECS Exec session data not available, returning partial response"
                    )
                    return WorkspaceExecResponse(
                        exit_code=0,
                        stdout="Command submitted successfully",
                        stderr="",
                    )

                # In a real implementation, you would use websocket-client
                # to connect to the streamUrl and capture output
                # For now, return success indication
                return WorkspaceExecResponse(
                    exit_code=0,
                    stdout="Command submitted via ECS Exec",
                    stderr="",
                )

        except Exception as e:
            logger.exception("Fargate exec failed", error=str(e))
            return WorkspaceExecResponse(
                exit_code=-1,
                stdout="",
                stderr=str(e),
            )

    async def read_file(self, workspace_id: str, path: str) -> str:
        """Read a file from the workspace via exec."""
        safe_path = shlex.quote(path)
        result = await self.exec_command(workspace_id, f"cat {safe_path}")
        if result.exit_code != 0:
            msg = f"Failed to read file: {result.stderr}"
            raise ValueError(msg)
        stdout: str = result.stdout
        return stdout

    async def write_file(self, workspace_id: str, path: str, content: str) -> None:
        """Write a file to the workspace via exec."""
        safe_path = shlex.quote(path)
        # Use base64 encoding to safely transfer content without shell escaping issues
        encoded_content = base64.b64encode(content.encode("utf-8")).decode("ascii")
        cmd = (
            f"mkdir -p $(dirname {safe_path}) && "
            f"echo {shlex.quote(encoded_content)} | base64 -d > {safe_path}"
        )
        result = await self.exec_command(workspace_id, cmd)
        if result.exit_code != 0:
            msg = f"Failed to write file: {result.stderr}"
            raise ValueError(msg)

    async def list_files(
        self,
        workspace_id: str,
        path: str = ".",
    ) -> list[dict[str, str]]:
        """List files in a workspace directory."""
        safe_path = shlex.quote(path)
        result = await self.exec_command(
            workspace_id,
            f"ls -la {safe_path} | tail -n +2",
        )
        if result.exit_code != 0:
            return []

        files = []
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            parts = line.split()
            if len(parts) >= MIN_LS_PARTS:
                file_type = "directory" if parts[0].startswith("d") else "file"
                files.append(
                    {
                        "name": " ".join(parts[8:]),
                        "type": file_type,
                        "size": parts[4],
                    }
                )

        return files

    async def heartbeat(self, workspace_id: str) -> None:
        """Update workspace last activity timestamp."""
        workspace = self._workspaces.get(workspace_id)
        if workspace:
            workspace.last_activity = datetime.now(UTC)

    async def cleanup_idle_workspaces(self, timeout_seconds: int) -> list[str]:
        """Clean up workspaces that have been idle too long."""
        now = datetime.now(UTC)
        cleaned_up = []

        for workspace_id, workspace in list(self._workspaces.items()):
            idle_time = (now - workspace.last_activity).total_seconds()
            if idle_time > timeout_seconds:
                logger.info(
                    "Cleaning up idle AWS workspace",
                    workspace_id=workspace_id,
                    idle_seconds=idle_time,
                )
                await self.delete_workspace(workspace_id)
                cleaned_up.append(workspace_id)

        return cleaned_up

    async def get_preview_url(self, workspace_id: str, port: int) -> str | None:
        """Get the URL to access a dev server running in the workspace.

        For AWS, this returns the private IP of the ECS task.
        In production, this would go through an ALB or API Gateway.
        """
        workspace = await self.get_workspace(workspace_id)
        if not workspace or workspace.status != WorkspaceStatus.RUNNING:
            return None

        if workspace.host and workspace.host != workspace.container_id:
            return f"http://{workspace.host}:{port}"

        return None

    async def proxy_request(
        self,
        request: ProxyRequest,
    ) -> tuple[int, dict[str, str], bytes]:
        """Proxy an HTTP request to a workspace container."""
        workspace = await self.get_workspace(request.workspace_id)
        if not workspace:
            raise ValueError(f"Workspace {request.workspace_id} not found")

        if workspace.status != WorkspaceStatus.RUNNING:
            raise ValueError(f"Workspace {request.workspace_id} is not running")

        if not workspace.host or workspace.host == workspace.container_id:
            raise ValueError(f"Workspace {request.workspace_id} IP not yet available")

        # Build target URL
        base_url = f"http://{workspace.host}:{request.port}"
        target_url = f"{base_url}/{request.path.lstrip('/')}"
        if request.query_string:
            target_url = f"{target_url}?{request.query_string}"

        # Filter out hop-by-hop headers
        filtered_headers = {
            k: v
            for k, v in request.headers.items()
            if k.lower()
            not in (
                "host",
                "connection",
                "keep-alive",
                "proxy-authenticate",
                "proxy-authorization",
                "te",
                "trailer",
                "transfer-encoding",
                "upgrade",
            )
        }

        logger.debug(
            "Proxying request to AWS workspace",
            workspace_id=request.workspace_id,
            port=request.port,
            method=request.method,
            path=request.path,
        )

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.request(
                    method=request.method,
                    url=target_url,
                    headers=filtered_headers,
                    content=request.body,
                    follow_redirects=False,
                )

                response_headers = {
                    k: v
                    for k, v in response.headers.items()
                    if k.lower()
                    not in (
                        "content-encoding",
                        "transfer-encoding",
                        "connection",
                    )
                }

                return response.status_code, response_headers, response.content

        except httpx.ConnectError as e:
            logger.warning(
                "Failed to connect to AWS workspace service",
                workspace_id=request.workspace_id,
                port=request.port,
                error=str(e),
            )
            raise ValueError(
                f"Could not connect to service on port {request.port}. "
                "Is the development server running?",
            ) from e
        except httpx.TimeoutException as e:
            logger.warning(
                "Request to AWS workspace timed out",
                workspace_id=request.workspace_id,
                port=request.port,
            )
            raise ValueError("Request timed out") from e

    def _extract_process_name(self, process_info: str) -> str:
        """Extract process name from ss output format."""
        if "users:" not in process_info:
            return ""
        start = process_info.find('(("') + PROCESS_NAME_START_OFFSET
        end = process_info.find('",', start)
        if start > MIN_PROCESS_NAME_START and end > start:
            return process_info[start:end]
        return ""

    def _parse_port_line(self, parts: list[str]) -> dict[str, Any] | None:
        """Parse a single line from ss output and return port info if valid."""
        if len(parts) < MIN_SS_PARTS:
            return None

        local_addr = (
            parts[SS_LOCAL_ADDR_INDEX]
            if len(parts) > SS_LOCAL_ADDR_INDEX
            else parts[SS_ALT_LOCAL_ADDR_INDEX]
        )
        if ":" not in local_addr:
            return None

        port_str = local_addr.split(":")[-1]
        try:
            port = int(port_str)
        except ValueError:
            return None

        if port <= MIN_SYSTEM_PORT:
            return None

        process_info = parts[-1] if len(parts) > SS_PROCESS_INFO_MIN_PARTS else ""
        process_name = self._extract_process_name(process_info)

        return {
            "port": port,
            "process_name": process_name or "unknown",
            "state": "LISTEN",
        }

    async def get_active_ports(self, workspace_id: str) -> list[dict[str, Any]]:
        """Get list of ports with active services in the workspace."""
        workspace = self._workspaces.get(workspace_id)
        if not workspace:
            return []

        try:
            result = await self.exec_command(
                workspace_id,
                "ss -tlnp 2>/dev/null | tail -n +2",
            )

            if result.exit_code != 0:
                return []

            ports = []
            for line in result.stdout.strip().split("\n"):
                if not line:
                    continue
                parts = line.split()
                port_info = self._parse_port_line(parts)
                if port_info:
                    ports.append(port_info)

            # Deduplicate
            seen: set[int] = set()
            unique = []
            for p in ports:
                if p["port"] not in seen:
                    seen.add(p["port"])
                    unique.append(p)

            return unique

        except Exception:
            logger.exception(
                "Failed to get active ports in AWS workspace", workspace_id=workspace_id
            )
            return []
