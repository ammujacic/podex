"""GCP-based compute manager for production (Cloud Run + GKE).

Uses Cloud Run for serverless CPU workspaces and GKE for GPU workloads.
"""

import base64
import shlex
import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Any

import httpx
import structlog

try:
    from google.cloud import run_v2  # type: ignore[import-untyped,attr-defined]
    from google.cloud.run_v2.types import (  # type: ignore[import-untyped]
        Container,
        EnvVar,
        ExecutionTemplate,
        Job,
        ResourceRequirements,
        TaskTemplate,
    )

    GOOGLE_CLOUD_AVAILABLE = True
except ImportError:
    # Mock classes for when Google Cloud is not available
    run_v2 = None
    Container = type("Container", (), {})
    EnvVar = type("EnvVar", (), {})
    ExecutionTemplate = type("ExecutionTemplate", (), {})
    Job = type("Job", (), {})
    ResourceRequirements = type("ResourceRequirements", (), {})
    TaskTemplate = type("TaskTemplate", (), {})
    GOOGLE_CLOUD_AVAILABLE = False

from podex_shared import ComputeUsageParams, get_usage_tracker
from podex_shared.models.workspace import (
    HARDWARE_SPECS,
    AcceleratorType,
    Architecture,
    GPUType,
)
from podex_shared.models.workspace import (
    WorkspaceTier as SharedTier,
)
from src.api_client import sync_workspace_status_to_api
from src.config import settings
from src.managers.base import ComputeManager, ProxyRequest
from src.models.workspace import (
    WorkspaceConfig,
    WorkspaceExecResponse,
    WorkspaceInfo,
    WorkspaceScaleResponse,
    WorkspaceStatus,
    WorkspaceTier,
)
from src.storage.workspace_store import WorkspaceStore

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

# Constants for billing and HTTP status
MINIMUM_BILLING_DURATION_SECONDS = 600  # 10 minutes minimum
HTTP_OK_STATUS_CODE = 200


class GCPComputeManager(ComputeManager):
    """Production implementation using GCP Cloud Run and GKE.

    Architecture:
    - **CPU tiers**: Uses Cloud Run Jobs for serverless compute.
      Auto-scales and cost-effective.

    - **GPU tiers**: Uses GKE with GPU node pools.
      Requires GPU-enabled nodes (T4, A100, etc.).

    Features:
    - Creates isolated Cloud Run jobs for each workspace
    - Tier-based resource allocation (CPU, memory, GPU)
    - Integration with GCS for persistent storage
    - GPU support via GKE with NVIDIA instances
    """

    def __init__(self, workspace_store: WorkspaceStore | None = None) -> None:
        """Initialize GCP clients."""
        if not GOOGLE_CLOUD_AVAILABLE:
            raise ImportError(
                "Google Cloud Run package is not available. "
                "Install with: pip install google-cloud-run"
            )

        self._jobs_client = run_v2.JobsAsyncClient()
        self._executions_client = run_v2.ExecutionsAsyncClient()
        self._workspace_store = workspace_store
        # FileSync is set via set_file_sync() during initialization

        logger.info(
            "GCPComputeManager initialized",
            project_id=settings.gcp_project_id,
            region=settings.gcp_region,
            has_workspace_store=workspace_store is not None,
        )

    async def _get_workspace(self, workspace_id: str) -> WorkspaceInfo | None:
        """Get workspace from Redis store.

        Always reads from Redis to ensure consistency across instances.
        No local caching - Redis is the single source of truth.
        """
        if self._workspace_store:
            return await self._workspace_store.get(workspace_id)
        return None

    async def _save_workspace(self, workspace: WorkspaceInfo) -> None:
        """Save workspace to Redis store."""
        if self._workspace_store:
            await self._workspace_store.save(workspace)

    async def _delete_workspace(self, workspace_id: str) -> None:
        """Delete workspace from Redis store."""
        if self._workspace_store:
            await self._workspace_store.delete(workspace_id)

    def _is_gpu_tier(self, tier: WorkspaceTier) -> bool:
        """Check if the tier requires GPU compute.

        Uses the is_gpu field from HARDWARE_SPECS which is admin-configurable.
        """
        spec = HARDWARE_SPECS.get(tier)
        return spec.is_gpu if spec else False

    def _requires_gke(self, tier: WorkspaceTier) -> bool:
        """Check if the tier requires GKE.

        Cloud Run doesn't support GPUs, so GPU tiers must use GKE.
        Uses the requires_gke field from HARDWARE_SPECS which is admin-configurable.
        """
        spec = HARDWARE_SPECS.get(tier)
        return spec.requires_gke if spec else False

    def _get_accelerator_type(self, tier: WorkspaceTier) -> AcceleratorType:
        """Get the accelerator type for a tier."""
        spec = HARDWARE_SPECS.get(tier)
        if spec:
            return spec.gpu_type
        return AcceleratorType.NONE

    def _get_architecture(self, tier: WorkspaceTier) -> Architecture:
        """Get the CPU architecture for a tier."""
        spec = HARDWARE_SPECS.get(tier)
        if spec:
            return spec.architecture
        return Architecture.X86_64  # GCP Cloud Run uses x86_64

    def _get_container_image(self, config: WorkspaceConfig, requires_gke: bool) -> str:
        """Determine the container image to use for the workspace."""
        # Priority 1: User or template specified a custom image
        if config.base_image:
            logger.debug("Using custom base image from config", image=config.base_image)
            return config.base_image

        # Priority 2: Select tier-appropriate image
        if requires_gke:
            return settings.workspace_image_gpu

        return settings.workspace_image_x86

    def _get_resource_config(self, tier: WorkspaceTier) -> dict[str, Any]:
        """Get Cloud Run resource configuration for a tier."""
        tier_settings = {
            WorkspaceTier.STARTER: {
                "cpu": str(settings.tier_starter_cpu),
                "memory": f"{settings.tier_starter_memory}Mi",
            },
            WorkspaceTier.PRO: {
                "cpu": str(settings.tier_pro_cpu),
                "memory": f"{settings.tier_pro_memory}Mi",
            },
            WorkspaceTier.POWER: {
                "cpu": str(settings.tier_power_cpu),
                "memory": f"{settings.tier_power_memory}Mi",
            },
            WorkspaceTier.ENTERPRISE: {
                "cpu": str(settings.tier_enterprise_cpu),
                "memory": f"{settings.tier_enterprise_memory}Mi",
            },
        }

        if tier in tier_settings:
            return tier_settings[tier]

        # For GPU and other tiers, use HARDWARE_SPECS
        spec = HARDWARE_SPECS.get(tier)
        if spec:
            config: dict[str, Any] = {
                "cpu": str(spec.vcpu),
                "memory": f"{spec.memory_mb}Mi",
            }
            if spec.gpu_type != GPUType.NONE:
                config["gpu_count"] = 1
                config["gpu_type"] = spec.gpu_type
            return config

        # Default fallback
        return tier_settings[WorkspaceTier.STARTER]

    def _get_job_parent(self) -> str:
        """Get the parent resource path for Cloud Run jobs."""
        return f"projects/{settings.gcp_project_id}/locations/{settings.gcp_region}"

    def _get_job_name(self, workspace_id: str) -> str:
        """Get the full resource name for a Cloud Run job."""
        return f"{self._get_job_parent()}/jobs/ws-{workspace_id}"

    async def create_workspace(
        self,
        user_id: str,
        session_id: str,
        config: WorkspaceConfig,
        workspace_id: str | None = None,
    ) -> WorkspaceInfo:
        """Create a new Cloud Run job workspace."""
        workspace_id = workspace_id or f"ws_{uuid.uuid4().hex[:12]}"
        requires_gke = self._requires_gke(config.tier)
        is_gpu = self._is_gpu_tier(config.tier)
        architecture = self._get_architecture(config.tier)
        accelerator_type = self._get_accelerator_type(config.tier)

        logger.info(
            "Creating GCP workspace",
            workspace_id=workspace_id,
            user_id=user_id,
            tier=config.tier,
            architecture=architecture.value,
            requires_gke=requires_gke,
            is_gpu=is_gpu,
            accelerator_type=accelerator_type.value if accelerator_type else None,
        )

        if requires_gke:
            # GPU workloads go to GKE
            return await self._create_gke_workspace(workspace_id, user_id, session_id, config)

        # CPU workloads use Cloud Run
        resource_config = self._get_resource_config(config.tier)
        container_image = self._get_container_image(config, requires_gke=False)

        # Build environment variables
        env_vars = [
            EnvVar(name="WORKSPACE_ID", value=workspace_id),
            EnvVar(name="USER_ID", value=user_id),
            EnvVar(name="SESSION_ID", value=session_id),
            EnvVar(name="GPU_ENABLED", value="false"),
            EnvVar(name="TEMPLATE_ID", value=config.template_id or ""),
        ]
        # Add git identity config if provided (container entrypoint can use these)
        if config.git_name:
            env_vars.append(EnvVar(name="GIT_AUTHOR_NAME", value=config.git_name))
            env_vars.append(EnvVar(name="GIT_COMMITTER_NAME", value=config.git_name))
        if config.git_email:
            env_vars.append(EnvVar(name="GIT_AUTHOR_EMAIL", value=config.git_email))
            env_vars.append(EnvVar(name="GIT_COMMITTER_EMAIL", value=config.git_email))
        env_vars.extend(EnvVar(name=k, value=v) for k, v in config.environment.items())

        # Create Cloud Run job
        container = Container(
            image=container_image,
            env=env_vars,
            resources=ResourceRequirements(
                limits={
                    "cpu": resource_config["cpu"],
                    "memory": resource_config["memory"],
                }
            ),
        )

        task_template = TaskTemplate(
            containers=[container],
            max_retries=0,
        )

        execution_template = ExecutionTemplate(
            template=task_template,
        )

        job = Job(
            template=execution_template,
            labels={
                "podex-workspace-id": workspace_id,
                "podex-user-id": user_id[:63],  # GCP label limit
                "podex-session-id": session_id[:63],
                "podex-tier": config.tier.value,
            },
        )

        job_name = f"ws-{workspace_id}"

        try:
            request = run_v2.CreateJobRequest(
                parent=self._get_job_parent(),
                job=job,
                job_id=job_name,
            )
            operation = await self._jobs_client.create_job(request=request)
            created_job = await operation.result()

            # Start an execution
            exec_request = run_v2.RunJobRequest(name=created_job.name)
            exec_operation = await self._jobs_client.run_job(request=exec_request)
            execution = await exec_operation.result()

            now = datetime.now(UTC)
            workspace_info = WorkspaceInfo(
                id=workspace_id,
                user_id=user_id,
                session_id=session_id,
                status=WorkspaceStatus.CREATING,
                tier=config.tier,
                host=execution.name,
                port=3000,
                container_id=execution.name,
                repos=config.repos,
                created_at=now,
                last_activity=now,
                metadata={
                    "job_name": created_job.name,
                    "execution_name": execution.name,
                    "last_billing_timestamp": now.isoformat(),
                    # Store dotfiles config for sync on stop
                    "sync_dotfiles": config.sync_dotfiles,
                    "dotfiles_paths": config.dotfiles_paths,
                    # Store git config for setup when workspace is ready
                    "git_name": config.git_name,
                    "git_email": config.git_email,
                    # Flag to indicate if GitHub token auth needs setup
                    "has_github_token": bool(config.environment.get("GITHUB_TOKEN")),
                },
            )

            await self._save_workspace(workspace_info)

            logger.info(
                "GCP workspace created",
                workspace_id=workspace_id,
                job_name=created_job.name,
            )

            return workspace_info

        except Exception as e:
            logger.exception("Failed to create GCP workspace", error=str(e))
            raise

    async def _create_gke_workspace(
        self,
        workspace_id: str,
        user_id: str,
        session_id: str,
        config: WorkspaceConfig,
    ) -> WorkspaceInfo:
        """Create a workspace on GKE for GPU workloads.

        This is a placeholder for GKE-based GPU workloads.
        Would use kubernetes client to create pods on GPU node pools.
        """
        logger.warning(
            "GKE GPU workloads not yet implemented, falling back to Cloud Run",
            workspace_id=workspace_id,
            tier=config.tier,
        )

        # For now, create a Cloud Run job (without GPU)
        # In production, this would use kubernetes client
        now = datetime.now(UTC)
        workspace_info = WorkspaceInfo(
            id=workspace_id,
            user_id=user_id,
            session_id=session_id,
            status=WorkspaceStatus.CREATING,
            tier=config.tier,
            host="pending",
            port=3000,
            container_id="pending",
            repos=config.repos,
            created_at=now,
            last_activity=now,
            metadata={
                "requires_gke": True,
                "last_billing_timestamp": now.isoformat(),
                # Store dotfiles config for sync on stop
                "sync_dotfiles": config.sync_dotfiles,
                "dotfiles_paths": config.dotfiles_paths,
            },
        )

        # Save to store if available
        if self._workspace_store:
            await self._workspace_store.save(workspace_info)
        return workspace_info

    async def stop_workspace(self, workspace_id: str) -> None:
        """Stop a Cloud Run job workspace."""
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            return

        # Save user dotfiles before stopping
        sync_dotfiles = workspace.metadata.get("sync_dotfiles", True)
        if sync_dotfiles:
            try:
                dotfiles_paths = workspace.metadata.get("dotfiles_paths")
                await self._file_sync.save_user_dotfiles(
                    workspace_id=workspace_id,
                    user_id=workspace.user_id,
                    dotfiles_paths=dotfiles_paths,
                )
                workspace.metadata["dotfiles_sync_status"] = "success"
                logger.info(
                    "Saved user dotfiles before workspace stop",
                    workspace_id=workspace_id,
                    user_id=workspace.user_id,
                )
            except Exception as e:
                logger.exception(
                    "Failed to save user dotfiles before stop",
                    workspace_id=workspace_id,
                    user_id=workspace.user_id,
                )
                workspace.metadata["dotfiles_sync_status"] = "error"
                workspace.metadata["dotfiles_sync_error"] = str(e)

        try:
            execution_name = workspace.metadata.get("execution_name")
            if execution_name:
                # Cancel the execution
                request = run_v2.CancelExecutionRequest(name=execution_name)
                await self._executions_client.cancel_execution(request=request)

            workspace.status = WorkspaceStatus.STOPPED
            workspace.last_activity = datetime.now(UTC)
            await self._save_workspace(workspace)
            logger.info("GCP workspace stopped", workspace_id=workspace_id)

        except Exception as e:
            logger.exception("Failed to stop GCP workspace", error=str(e))

    async def restart_workspace(self, workspace_id: str) -> None:
        """Restart a stopped GCP workspace.

        For Cloud Run jobs, this would require re-executing the job.
        Currently not implemented - workspaces need to be recreated.
        """
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            raise ValueError(f"Workspace {workspace_id} not found")

        # GCP Cloud Run jobs cannot be restarted - they need to be recreated
        # The API layer should handle this by creating a new workspace
        logger.warning(
            "GCP workspace restart not supported, workspace needs recreation",
            workspace_id=workspace_id,
        )
        raise ValueError(
            "GCP workspaces cannot be restarted. "
            "Please create a new workspace or use the web UI to resume."
        )

    async def _track_compute_usage(
        self,
        workspace: WorkspaceInfo,
        duration_seconds: int,
    ) -> None:
        """Track compute usage for billing."""
        tracker = get_usage_tracker()
        if not tracker:
            logger.debug("Usage tracker not initialized")
            return

        try:
            tier_enum = SharedTier(workspace.tier.value)
            hardware_spec = HARDWARE_SPECS.get(tier_enum)
            default_rate_cents = 5
            hourly_rate_cents = (
                int(hardware_spec.hourly_rate * 100) if hardware_spec else default_rate_cents
            )

            params = ComputeUsageParams(
                user_id=workspace.user_id,
                tier=workspace.tier.value,
                duration_seconds=duration_seconds,
                session_id=workspace.session_id,
                workspace_id=workspace.id,
                hourly_rate_cents=hourly_rate_cents,
                metadata={
                    "execution_name": workspace.container_id,
                },
            )
            await tracker.record_compute_usage(params)
            logger.debug(
                "Recorded compute usage",
                workspace_id=workspace.id,
                duration_seconds=duration_seconds,
            )
        except Exception:
            logger.exception("Failed to track compute usage")

    async def track_running_workspaces_usage(self) -> None:
        """Track compute usage for all running workspaces."""
        now = datetime.now(UTC)

        # Get all running workspaces from store
        workspaces: list[WorkspaceInfo] = []
        if self._workspace_store:
            workspaces = await self._workspace_store.list_running()
        else:
            # Fallback: return empty list if store not available
            workspaces = []

        for workspace in workspaces:
            if workspace.status != WorkspaceStatus.RUNNING:
                continue

            try:
                last_billing_str = workspace.metadata.get("last_billing_timestamp")
                if not last_billing_str:
                    workspace.metadata["last_billing_timestamp"] = now.isoformat()
                    await self._save_workspace(workspace)
                    logger.warning(
                        "Missing last_billing_timestamp, skipping billing tick",
                        workspace_id=workspace.id,
                    )
                    continue
                else:
                    last_billing = datetime.fromisoformat(last_billing_str)

                if last_billing.tzinfo is None:
                    last_billing = last_billing.replace(tzinfo=UTC)

                duration = (now - last_billing).total_seconds()

                if duration >= MINIMUM_BILLING_DURATION_SECONDS:
                    duration_seconds = int(duration)
                    await self._track_compute_usage(workspace, duration_seconds)
                    workspace.metadata["last_billing_timestamp"] = now.isoformat()
                    await self._save_workspace(workspace)

            except Exception:
                logger.exception(
                    "Failed to track periodic usage",
                    workspace_id=workspace.id,
                )

    async def delete_workspace(self, workspace_id: str, preserve_files: bool = True) -> None:
        """Delete a workspace."""
        await self.stop_workspace(workspace_id)

        workspace = await self._get_workspace(workspace_id)
        if workspace:
            # Delete the Cloud Run job
            job_name = workspace.metadata.get("job_name")
            if job_name:
                try:
                    request = run_v2.DeleteJobRequest(name=job_name)
                    await self._jobs_client.delete_job(request=request)
                except Exception as e:
                    logger.warning("Failed to delete Cloud Run job", error=str(e))

            # Clean up GCS files if requested
            if not preserve_files:
                try:
                    await self._file_sync.delete_workspace_files(workspace_id)
                    logger.info("Deleted GCS files for workspace", workspace_id=workspace_id)
                except Exception as e:
                    logger.warning("Failed to delete GCS files", error=str(e))

            await self._delete_workspace(workspace_id)

        logger.info(
            "Workspace deleted",
            workspace_id=workspace_id,
            files_preserved=preserve_files,
        )

    async def get_workspace(self, workspace_id: str) -> WorkspaceInfo | None:  # noqa: PLR0912
        """Get workspace information."""
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            return None

        execution_name = workspace.metadata.get("execution_name")
        if execution_name:
            try:
                request = run_v2.GetExecutionRequest(name=execution_name)
                execution = await self._executions_client.get_execution(request=request)

                # Map execution status to workspace status
                old_status = workspace.status
                if execution.reconciling:
                    workspace.status = WorkspaceStatus.CREATING
                elif execution.failed_count > 0 or execution.succeeded_count > 0:
                    workspace.status = WorkspaceStatus.STOPPED
                elif execution.running_count > 0:
                    workspace.status = WorkspaceStatus.RUNNING

                await self._save_workspace(workspace)

                # If status changed to RUNNING, set up git configuration and MCP gateway
                if (
                    old_status != WorkspaceStatus.RUNNING
                    and workspace.status == WorkspaceStatus.RUNNING
                ):
                    # Set up git configuration
                    if not workspace.metadata.get("git_setup_done"):
                        try:
                            await self.setup_workspace_git(workspace_id)
                            workspace.metadata["git_setup_done"] = True
                            await self._save_workspace(workspace)
                        except Exception as e:
                            logger.warning(
                                "Failed to setup git on workspace ready",
                                workspace_id=workspace_id,
                                error=str(e),
                            )

                    # Start MCP gateway for agent access to filesystem/git
                    if not workspace.metadata.get("mcp_gateway_started"):
                        try:
                            result = await self.exec_command(
                                workspace_id,
                                "/home/dev/.local/bin/start-mcp-gateway.sh",
                            )
                            if result.exit_code == 0:
                                workspace.metadata["mcp_gateway_started"] = True
                                await self._save_workspace(workspace)
                                logger.info(
                                    "MCP gateway started",
                                    workspace_id=workspace_id,
                                )
                            else:
                                logger.warning(
                                    "MCP gateway startup failed",
                                    workspace_id=workspace_id,
                                    exit_code=result.exit_code,
                                )
                        except Exception as e:
                            logger.warning(
                                "Failed to start MCP gateway",
                                workspace_id=workspace_id,
                                error=str(e),
                            )

                # If status changed, sync to API
                if old_status != workspace.status:
                    await sync_workspace_status_to_api(
                        workspace_id=workspace_id,
                        status=workspace.status.value,
                        container_id=execution_name,
                    )

            except Exception as e:
                logger.warning("Failed to get execution status", error=str(e))

        return workspace

    async def list_workspaces(
        self,
        user_id: str | None = None,
        session_id: str | None = None,
    ) -> list[WorkspaceInfo]:
        """List workspaces filtered by user or session."""
        if self._workspace_store:
            if user_id:
                return await self._workspace_store.list_by_user(user_id)
            if session_id:
                return await self._workspace_store.list_by_session(session_id)
            return await self._workspace_store.list_all()

        # Fallback: return empty list if store not available
        workspaces: list[WorkspaceInfo] = []
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
        """Execute a command in the workspace.

        For Cloud Run jobs, we use the workspace's HTTP API endpoint.
        """
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            msg = f"Workspace {workspace_id} not found"
            raise ValueError(msg)

        safe_working_dir = shlex.quote(working_dir) if working_dir else "/home/dev"

        try:
            # Cloud Run exposes an HTTP endpoint on the workspace
            # The workspace container runs a small API server for command execution
            workspace_url = f"http://{workspace.host}:{workspace.port}"

            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    f"{workspace_url}/exec",
                    json={
                        "command": command,
                        "working_dir": safe_working_dir,
                    },
                )

                if response.status_code == HTTP_OK_STATUS_CODE:
                    data = response.json()
                    return WorkspaceExecResponse(
                        exit_code=data.get("exit_code", 0),
                        stdout=data.get("stdout", ""),
                        stderr=data.get("stderr", ""),
                    )
                else:
                    return WorkspaceExecResponse(
                        exit_code=-1,
                        stdout="",
                        stderr=f"HTTP {response.status_code}: {response.text}",
                    )

        except Exception as e:
            logger.exception("Failed to execute command", workspace_id=workspace_id)
            return WorkspaceExecResponse(
                exit_code=-1,
                stdout="",
                stderr=str(e),
            )

    def set_file_sync(self, file_sync: Any) -> None:
        """Set the file sync service for workspace file synchronization.

        This MUST be called during initialization. FileSync is required
        for proper workspace operation.

        Args:
            file_sync: The file sync service instance

        Raises:
            ValueError: If file_sync is None
        """
        if file_sync is None:
            raise ValueError("FileSync is required and cannot be None")
        self._file_sync = file_sync

    async def setup_workspace_git(self, workspace_id: str) -> None:
        """Set up git configuration in the workspace.

        This should be called after the workspace becomes ready (RUNNING status).
        It configures git identity and GitHub token authentication based on
        the workspace metadata stored during creation.
        """
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            logger.warning("Cannot setup git - workspace not found", workspace_id=workspace_id)
            return

        # Set up git identity
        git_name = workspace.metadata.get("git_name")
        git_email = workspace.metadata.get("git_email")

        if git_name:
            try:
                safe_name = git_name.replace("'", "'\\''")
                cmd = f"git config --global user.name '{safe_name}'"
                await self.exec_command(workspace_id, cmd)
                logger.debug("Set git user.name", workspace_id=workspace_id)
            except Exception:
                logger.warning(
                    "Failed to set git user.name",
                    workspace_id=workspace_id,
                    exc_info=True,
                )

        if git_email:
            try:
                safe_email = git_email.replace("'", "'\\''")
                cmd = f"git config --global user.email '{safe_email}'"
                await self.exec_command(workspace_id, cmd)
                logger.debug("Set git user.email", workspace_id=workspace_id)
            except Exception:
                logger.warning(
                    "Failed to set git user.email",
                    workspace_id=workspace_id,
                    exc_info=True,
                )

        # Set up GitHub token authentication
        if workspace.metadata.get("has_github_token"):
            await self._setup_github_token_auth(workspace_id)

    async def _setup_github_token_auth(self, workspace_id: str) -> None:
        """Configure git to use GITHUB_TOKEN environment variable for GitHub authentication.

        This sets up a credential helper that reads the token from the GITHUB_TOKEN
        environment variable, enabling git push/pull/fetch operations to GitHub
        without requiring manual authentication.
        """
        try:
            # Create a credential helper script that reads from GITHUB_TOKEN env var
            credential_helper_script = """#!/bin/bash
if [ -n "$GITHUB_TOKEN" ]; then
    echo "protocol=https"
    echo "host=github.com"
    echo "username=x-access-token"
    echo "password=$GITHUB_TOKEN"
fi
"""

            # Write the credential helper script
            script_path = "~/.local/bin/git-credential-github-token"
            await self.exec_command(
                workspace_id,
                f"mkdir -p ~/.local/bin && cat > {script_path} << 'SCRIPT'\n"
                f"{credential_helper_script}SCRIPT",
            )

            # Make it executable
            chmod_cmd = "chmod +x ~/.local/bin/git-credential-github-token"
            await self.exec_command(workspace_id, chmod_cmd)

            # Configure git to use this credential helper for github.com
            helper_cmd = (
                "git config --global credential.https://github.com.helper "
                "'!~/.local/bin/git-credential-github-token'"
            )
            await self.exec_command(workspace_id, helper_cmd)

            logger.info("GitHub token authentication configured", workspace_id=workspace_id)

        except Exception:
            # Non-fatal: log warning but continue
            logger.warning(
                "Failed to configure GitHub token authentication",
                workspace_id=workspace_id,
                exc_info=True,
            )

    async def discover_existing_workspaces(self) -> None:
        """Discover and re-register existing workspaces after service restart.

        For GCP, this loads workspaces from Redis and syncs their current
        status to the API database. Unlike Docker, we rely on Redis as the
        source of truth since Cloud Run jobs are managed externally.
        """
        if not self._workspace_store:
            logger.info("No workspace store configured, skipping GCP workspace discovery")
            return

        try:
            # Load all workspaces from Redis
            workspaces = await self._workspace_store.list_all()

            synced_count = 0
            for workspace in workspaces:
                # Get current status from Cloud Run
                execution_name = workspace.metadata.get("execution_name")
                if execution_name:
                    try:
                        request = run_v2.GetExecutionRequest(name=execution_name)
                        execution = await self._executions_client.get_execution(request=request)

                        # Map execution status to workspace status
                        if execution.reconciling:
                            workspace.status = WorkspaceStatus.CREATING
                        elif execution.failed_count > 0 or execution.succeeded_count > 0:
                            workspace.status = WorkspaceStatus.STOPPED
                        elif execution.running_count > 0:
                            workspace.status = WorkspaceStatus.RUNNING

                        await self._save_workspace(workspace)
                    except Exception as e:
                        logger.warning(
                            "Failed to get GCP execution status during discovery",
                            workspace_id=workspace.id,
                            error=str(e),
                        )
                        # Mark as stopped if we can't get status
                        workspace.status = WorkspaceStatus.STOPPED
                        await self._save_workspace(workspace)

                # Sync to API
                success = await sync_workspace_status_to_api(
                    workspace_id=workspace.id,
                    status=workspace.status.value,
                    container_id=execution_name,
                )
                if success:
                    synced_count += 1

                # Start MCP gateway if workspace is running but gateway not started
                if workspace.status == WorkspaceStatus.RUNNING and not workspace.metadata.get(
                    "mcp_gateway_started"
                ):
                    try:
                        result = await self.exec_command(
                            workspace.id,
                            "/home/dev/.local/bin/start-mcp-gateway.sh",
                        )
                        if result.exit_code == 0:
                            workspace.metadata["mcp_gateway_started"] = True
                            await self._save_workspace(workspace)
                            logger.info(
                                "MCP gateway started during discovery",
                                workspace_id=workspace.id,
                            )
                    except Exception as e:
                        logger.warning(
                            "Failed to start MCP gateway during discovery",
                            workspace_id=workspace.id,
                            error=str(e),
                        )

            logger.info(
                "GCP workspace discovery complete",
                total_workspaces=len(workspaces),
                synced_to_api=synced_count,
            )

        except Exception:
            logger.exception("Failed to discover existing GCP workspaces")

    async def exec_command_stream(
        self,
        workspace_id: str,
        command: str,
        working_dir: str | None = None,
        timeout: int = 60,
    ) -> AsyncGenerator[str, None]:
        """Execute a command and stream output chunks.

        For Cloud Run workspaces, we use the workspace's HTTP streaming endpoint.

        Args:
            workspace_id: The workspace ID
            command: Shell command to execute
            working_dir: Working directory (default: /home/dev)
            timeout: Command timeout in seconds

        Yields:
            Output chunks as strings
        """
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            msg = f"Workspace {workspace_id} not found"
            raise ValueError(msg)

        safe_working_dir = shlex.quote(working_dir) if working_dir else "/home/dev"

        try:
            workspace_url = f"http://{workspace.host}:{workspace.port}"

            async with (
                httpx.AsyncClient(timeout=timeout) as client,
                client.stream(
                    "POST",
                    f"{workspace_url}/exec-stream",
                    json={
                        "command": command,
                        "working_dir": safe_working_dir,
                    },
                ) as response,
            ):
                response.raise_for_status()

                # Process SSE stream from workspace
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]  # Remove "data: " prefix
                        if data == "[DONE]":
                            break
                        if data.startswith("ERROR:"):
                            yield data
                            break
                        # Unescape newlines from SSE format
                        chunk = data.replace("\\n", "\n")
                        yield chunk

        except httpx.TimeoutException:
            logger.error(
                "Streaming exec timed out",
                workspace_id=workspace_id,
                timeout=timeout,
            )
            yield f"Command timed out after {timeout} seconds"
        except Exception as e:
            logger.exception("Failed to stream command", workspace_id=workspace_id)
            yield f"Error: {e}"

    async def read_file(self, workspace_id: str, path: str) -> str:
        """Read a file from the workspace via exec."""
        safe_path = shlex.quote(path)
        result = await self.exec_command(workspace_id, f"cat {safe_path}")
        if result.exit_code != 0:
            msg = f"Failed to read file: {result.stderr}"
            raise ValueError(msg)
        return result.stdout

    async def write_file(self, workspace_id: str, path: str, content: str) -> None:
        """Write a file to the workspace via exec."""
        safe_path = shlex.quote(path)
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
        if self._workspace_store:
            await self._workspace_store.update_heartbeat(workspace_id)
        # No fallback needed - heartbeat is best-effort

    async def cleanup_idle_workspaces(self, timeout_seconds: int) -> list[str]:
        """Clean up workspaces that have been idle too long."""
        now = datetime.now(UTC)
        cleaned_up = []

        # Get all workspaces from store
        workspaces: list[WorkspaceInfo] = []
        if self._workspace_store:
            workspaces = await self._workspace_store.list_all()
        # No fallback - store is required for cleanup

        # Filter workspaces that need cleanup
        workspaces_to_cleanup = []
        for workspace in workspaces:
            idle_time = (now - workspace.last_activity).total_seconds()
            if idle_time > timeout_seconds:
                workspaces_to_cleanup.append((workspace, idle_time))

        if workspaces_to_cleanup:
            logger.info(
                "Starting GCP workspace cleanup",
                total_to_cleanup=len(workspaces_to_cleanup),
                timeout_seconds=timeout_seconds,
            )

        for i, (workspace, idle_time) in enumerate(workspaces_to_cleanup, 1):
            logger.info(
                "Cleaning up GCP workspace",
                progress=f"{i}/{len(workspaces_to_cleanup)}",
                workspace_id=workspace.id[:12],
                idle_seconds=int(idle_time),
            )
            try:
                await self.delete_workspace(workspace.id)
                cleaned_up.append(workspace.id)
            except Exception:
                logger.exception(
                    "Failed to cleanup GCP workspace, continuing with others",
                    workspace_id=workspace.id,
                )

        if workspaces_to_cleanup:
            logger.info(
                "GCP workspace cleanup completed",
                cleaned_up_count=len(cleaned_up),
                total_attempted=len(workspaces_to_cleanup),
            )

        return cleaned_up

    async def get_preview_url(self, workspace_id: str, port: int) -> str | None:
        """Get the URL to access a dev server running in the workspace."""
        workspace = await self.get_workspace(workspace_id)
        if not workspace or workspace.status != WorkspaceStatus.RUNNING:
            return None

        if workspace.host and workspace.host != "pending":
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

        if not workspace.host or workspace.host == "pending":
            raise ValueError(f"Workspace {request.workspace_id} IP not yet available")

        base_url = f"http://{workspace.host}:{request.port}"
        target_url = f"{base_url}/{request.path.lstrip('/')}"
        if request.query_string:
            target_url = f"{target_url}?{request.query_string}"

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
            "Proxying request to GCP workspace",
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
                    if k.lower() not in ("content-encoding", "transfer-encoding", "connection")
                }

                return response.status_code, response_headers, response.content

        except httpx.ConnectError as e:
            logger.warning(
                "Failed to connect to GCP workspace service",
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
                "Request to GCP workspace timed out",
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
        workspace = await self._get_workspace(workspace_id)
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
                "Failed to get active ports in GCP workspace",
                workspace_id=workspace_id,
            )
            return []

    async def scale_workspace(  # noqa: PLR0912
        self,
        workspace_id: str,
        new_tier: WorkspaceTier,
    ) -> WorkspaceScaleResponse:
        """Scale a GCP workspace to a new compute tier.

        For GCP Cloud Run:
        - CPU tiers: Create new job with new tier, stop old job
        - GPU tiers: Requires GKE (not yet implemented)
        """
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            raise ValueError(f"Workspace {workspace_id} not found")

        old_tier = workspace.tier

        # Check if scaling to the same tier
        if old_tier == new_tier:
            spec = HARDWARE_SPECS.get(new_tier)
            return WorkspaceScaleResponse(
                success=False,
                message=f"Workspace is already on {new_tier.value} tier",
                new_tier=new_tier,
                estimated_cost_per_hour=spec.hourly_rate if spec else None,
            )

        # Check if scaling involves GPU tiers (not yet implemented)
        old_spec = HARDWARE_SPECS.get(old_tier)
        new_spec = HARDWARE_SPECS.get(new_tier)

        if (old_spec and old_spec.requires_gke) or (new_spec and new_spec.requires_gke):
            return WorkspaceScaleResponse(
                success=False,
                message=(
                    "Scaling between GPU tiers is not yet supported. "
                    "GPU workspaces require GKE which is not fully implemented."
                ),
                new_tier=None,
                estimated_cost_per_hour=None,
            )

        logger.info(
            "Scaling GCP workspace",
            workspace_id=workspace_id,
            old_tier=old_tier.value,
            new_tier=new_tier.value,
        )

        try:
            # Step 1: Save dotfiles before scaling
            if workspace.metadata.get("sync_dotfiles", True):
                try:
                    dotfiles_paths = workspace.metadata.get("dotfiles_paths")
                    await self._file_sync.save_user_dotfiles(
                        workspace_id=workspace_id,
                        user_id=workspace.user_id,
                        dotfiles_paths=dotfiles_paths,
                    )
                    logger.info(
                        "Saved dotfiles before scaling",
                        workspace_id=workspace_id,
                        user_id=workspace.user_id,
                    )
                except Exception as e:
                    logger.warning(
                        "Failed to save dotfiles before scaling",
                        workspace_id=workspace_id,
                        error=str(e),
                    )

            # Step 2: Stop the current workspace
            await self.stop_workspace(workspace_id)

            # Step 3: Create new workspace config with the new tier
            # We need to reconstruct the original config from the workspace metadata
            new_config = WorkspaceConfig(tier=new_tier)

            # Copy over important config from workspace metadata if available
            if "git_name" in workspace.metadata:
                new_config.git_name = workspace.metadata["git_name"]
            if "git_email" in workspace.metadata:
                new_config.git_email = workspace.metadata["git_email"]
            if "sync_dotfiles" in workspace.metadata:
                new_config.sync_dotfiles = workspace.metadata["sync_dotfiles"]
            if "dotfiles_paths" in workspace.metadata:
                new_config.dotfiles_paths = workspace.metadata["dotfiles_paths"]

            # Step 4: Create new workspace with the same parameters but new tier
            session_id = workspace.session_id
            user_id = workspace.user_id

            # Remove the old workspace from tracking
            await self._delete_workspace(workspace_id)

            # Create new workspace with the same ID but new tier
            await self.create_workspace(
                user_id=user_id,
                session_id=session_id,
                config=new_config,
                workspace_id=workspace_id,  # Reuse the same workspace ID
            )

            return WorkspaceScaleResponse(
                success=True,
                message=f"Successfully scaled workspace to {new_tier.value} tier",
                new_tier=new_tier,
                estimated_cost_per_hour=new_spec.hourly_rate if new_spec else None,
                requires_restart=True,
            )

        except Exception as e:
            logger.exception(
                "Failed to scale GCP workspace",
                workspace_id=workspace_id,
                old_tier=old_tier.value,
                new_tier=new_tier.value,
                error=str(e),
            )

            # Try to restore the original workspace if scaling failed
            try:
                # Recreate with original tier
                original_config = WorkspaceConfig(tier=old_tier)
                if "git_name" in workspace.metadata:
                    original_config.git_name = workspace.metadata["git_name"]
                if "git_email" in workspace.metadata:
                    original_config.git_email = workspace.metadata["git_email"]

                await self.create_workspace(
                    user_id=workspace.user_id,
                    session_id=workspace.session_id,
                    config=original_config,
                    workspace_id=workspace_id,
                )
                logger.info(
                    "Restored original workspace after scaling failure",
                    workspace_id=workspace_id,
                )
            except Exception as restore_error:
                logger.error(
                    "Failed to restore original workspace after scaling failure",
                    workspace_id=workspace_id,
                    error=str(restore_error),
                )

            raise ValueError(f"Failed to scale workspace: {e}") from e
