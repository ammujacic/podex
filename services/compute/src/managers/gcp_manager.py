"""GCP-based compute manager for production (Cloud Run + GKE).

Uses Cloud Run for serverless CPU workspaces and GKE for GPU workloads.
"""

import asyncio
import re
import secrets
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
        GCSVolumeSource,
        Job,
        ResourceRequirements,
        TaskTemplate,
        Volume,
        VolumeMount,
    )

    GOOGLE_CLOUD_AVAILABLE = True
except ImportError:
    # Mock classes for when Google Cloud is not available
    run_v2 = None
    Container = type("Container", (), {})
    EnvVar = type("EnvVar", (), {})
    ExecutionTemplate = type("ExecutionTemplate", (), {})
    GCSVolumeSource = type("GCSVolumeSource", (), {})
    Job = type("Job", (), {})
    ResourceRequirements = type("ResourceRequirements", (), {})
    TaskTemplate = type("TaskTemplate", (), {})
    Volume = type("Volume", (), {})
    VolumeMount = type("VolumeMount", (), {})
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
from src.middleware.script_injector import inject_devtools_script
from src.models.workspace import (
    WorkspaceConfig,
    WorkspaceExecResponse,
    WorkspaceInfo,
    WorkspaceScaleResponse,
    WorkspaceStatus,
    WorkspaceTier,
)
from src.storage.user_bucket_service import UserBucketService
from src.storage.workspace_store import WorkspaceStore

logger = structlog.get_logger()

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
        # Lock for billing operations to prevent race conditions
        self._billing_lock = asyncio.Lock()
        # Lock for workspace setup operations to prevent concurrent setup
        self._setup_locks: dict[str, asyncio.Lock] = {}
        # Shared HTTP client for connection pooling
        self._http_client: httpx.AsyncClient | None = None

        # User bucket service for managing per-user GCS buckets
        self._bucket_service = UserBucketService(
            project_id=settings.gcp_project_id or "podex-dev",
            region=settings.gcp_region,
            env=settings.environment,
        )

        logger.info(
            "GCPComputeManager initialized",
            project_id=settings.gcp_project_id,
            region=settings.gcp_region,
            has_workspace_store=workspace_store is not None,
        )

    def _get_setup_lock(self, workspace_id: str) -> asyncio.Lock:
        """Get or create a lock for workspace setup operations."""
        if workspace_id not in self._setup_locks:
            self._setup_locks[workspace_id] = asyncio.Lock()
        return self._setup_locks[workspace_id]

    async def _get_http_client(self) -> httpx.AsyncClient:
        """Get shared HTTP client with connection pooling."""
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(
                timeout=30.0,
                limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
            )
        return self._http_client

    async def close(self) -> None:
        """Close shared resources."""
        if self._http_client and not self._http_client.is_closed:
            await self._http_client.aclose()
            self._http_client = None

    # Note: _get_workspace, _save_workspace, _delete_workspace are inherited from base class

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

    async def create_workspace(  # noqa: PLR0915
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

        # Ensure user bucket exists (lazy creation)
        bucket_name = await self._bucket_service.ensure_bucket_exists(user_id)
        await self._bucket_service.initialize_structure(user_id)
        await self._bucket_service.ensure_workspace_directory(user_id, workspace_id)

        logger.info(
            "User bucket ready for workspace",
            workspace_id=workspace_id,
            user_id=user_id,
            bucket_name=bucket_name,
        )

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
        # Add dotfiles settings for entrypoint script
        env_vars.append(
            EnvVar(name="SYNC_DOTFILES", value="true" if config.sync_dotfiles else "false")
        )
        if config.dotfiles_paths:
            env_vars.append(EnvVar(name="DOTFILES_PATHS", value=",".join(config.dotfiles_paths)))
        env_vars.extend(EnvVar(name=k, value=v) for k, v in config.environment.items())

        # GCS volume mount for per-user bucket
        volumes = [
            Volume(
                name="user-storage",
                gcs=GCSVolumeSource(
                    bucket=bucket_name,
                    read_only=False,
                ),
            ),
        ]

        # Create Cloud Run job with volume mount
        container = Container(
            image=container_image,
            env=env_vars,
            resources=ResourceRequirements(
                limits={
                    "cpu": resource_config["cpu"],
                    "memory": resource_config["memory"],
                }
            ),
            volume_mounts=[
                VolumeMount(
                    name="user-storage",
                    mount_path="/mnt/gcs",
                ),
            ],
        )

        task_template = TaskTemplate(
            containers=[container],
            volumes=volumes,
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

        created_job = None
        try:
            request = run_v2.CreateJobRequest(
                parent=self._get_job_parent(),
                job=job,
                job_id=job_name,
            )
            operation = await self._jobs_client.create_job(request=request)
            created_job = await operation.result()

            # Start an execution
            try:
                exec_request = run_v2.RunJobRequest(name=created_job.name)
                exec_operation = await self._jobs_client.run_job(request=exec_request)
                execution = await exec_operation.result()
            except Exception as exec_error:
                # Clean up the job if execution fails
                logger.warning(
                    "Job execution failed, cleaning up job",
                    workspace_id=workspace_id,
                    job_name=created_job.name,
                    error=str(exec_error),
                )
                try:
                    delete_request = run_v2.DeleteJobRequest(name=created_job.name)
                    await self._jobs_client.delete_job(request=delete_request)
                except Exception as cleanup_error:
                    logger.error(
                        "Failed to cleanup job after execution failure",
                        workspace_id=workspace_id,
                        error=str(cleanup_error),
                    )
                raise

            now = datetime.now(UTC)
            # Generate a secure auth token for workspace API authentication
            auth_token = secrets.token_urlsafe(32) if settings.workspace_auth_enabled else None
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
                auth_token=auth_token,
                metadata={
                    "job_name": created_job.name,
                    "execution_name": execution.name,
                    "last_billing_timestamp": now.isoformat(),
                    # Storage mode - volume mount means files are directly available via GCS
                    "storage_mode": "volume_mount",
                    "bucket_name": bucket_name,
                    # User preferences (from API)
                    "sync_dotfiles": config.sync_dotfiles,
                    "dotfiles_paths": config.dotfiles_paths,
                    # Store git config for setup when workspace is ready
                    "git_name": config.git_name,
                    "git_email": config.git_email,
                    # Flag to indicate if GitHub token auth needs setup
                    "has_github_token": bool(config.environment.get("GITHUB_TOKEN")),
                    # Store repo cloning config for when workspace becomes ready
                    "git_credentials": config.git_credentials,
                    "git_branch": config.git_branch,
                    "post_init_commands": config.post_init_commands,
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
            # Clean up GCS workspace directory on failure
            try:
                await self._bucket_service.delete_workspace_directory(user_id, workspace_id)
                logger.info(
                    "Cleaned up GCS workspace directory after creation failure",
                    workspace_id=workspace_id,
                )
            except Exception as cleanup_error:
                logger.warning(
                    "Failed to cleanup GCS directory after workspace creation failure",
                    workspace_id=workspace_id,
                    error=str(cleanup_error),
                )
            raise

    async def _create_gke_workspace(
        self,
        workspace_id: str,
        user_id: str,
        session_id: str,
        config: WorkspaceConfig,
    ) -> WorkspaceInfo:
        """Create a workspace on GKE for GPU workloads.

        Uses GCS FUSE CSI driver for mounting user bucket.

        Pod spec would include:
        - annotations: {"gke-gcsfuse/volumes": "true"}
        - volumes with CSI driver: gcsfuse.csi.storage.gke.io
        - volumeAttributes: {bucketName, mountOptions}

        This is a placeholder for GKE-based GPU workloads.
        Full implementation would use kubernetes client to create pods.
        """
        logger.warning(
            "GKE GPU workloads not yet implemented, creating placeholder",
            workspace_id=workspace_id,
            tier=config.tier,
        )

        # Ensure user bucket exists (same as Cloud Run)
        bucket_name = await self._bucket_service.ensure_bucket_exists(user_id)
        await self._bucket_service.initialize_structure(user_id)
        await self._bucket_service.ensure_workspace_directory(user_id, workspace_id)

        # GKE pod spec documentation (example structure):
        # Metadata includes gke-gcsfuse/volumes annotation
        # Spec defines a CSI volume using gcsfuse.csi.storage.gke.io driver
        # with bucketName and mountOptions configured
        # Container volumeMounts attach the user-storage volume to /mnt/gcs

        now = datetime.now(UTC)
        # Generate a secure auth token for workspace API authentication
        auth_token = secrets.token_urlsafe(32) if settings.workspace_auth_enabled else None
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
            auth_token=auth_token,
            metadata={
                "requires_gke": True,
                "last_billing_timestamp": now.isoformat(),
                # Storage mode - volume mount via GCS FUSE CSI
                "storage_mode": "volume_mount",
                "bucket_name": bucket_name,
                # User preferences (from API)
                "sync_dotfiles": config.sync_dotfiles,
                "dotfiles_paths": config.dotfiles_paths,
            },
        )

        # Save to store if available
        if self._workspace_store:
            await self._workspace_store.save(workspace_info)
        return workspace_info

    async def _clone_repos(  # noqa: PLR0912, PLR0915
        self,
        workspace_id: str,
        repos: list[str],
        git_credentials: str | None,
        git_branch: str | None = None,
    ) -> None:
        """Clone repositories into the workspace.

        Args:
            workspace_id: The workspace ID
            repos: List of repository URLs to clone
            git_credentials: Git credentials (username:token format)
            git_branch: Optional branch to checkout after cloning
        """
        # Validate git URL format to prevent injection
        git_url_pattern = re.compile(
            r"^https?://[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z0-9][-a-zA-Z0-9]*)+/[\w./-]+$",
        )

        # Validate git credentials format if provided (expect username:token format)
        validated_credentials: tuple[str, str] | None = None
        if git_credentials:
            if ":" not in git_credentials:
                logger.warning("Invalid git_credentials format, expected 'username:token'")
            else:
                parts = git_credentials.split(":", 1)
                # Validate username and token don't contain shell-dangerous characters
                username = parts[0]
                token = parts[1]
                if re.match(r"^[\w.-]+$", username) and re.match(r"^[\w.-]+$", token):
                    validated_credentials = (username, token)
                else:
                    logger.warning("Git credentials contain invalid characters, ignoring")

        for repo_url in repos:
            # Validate URL format
            if not git_url_pattern.match(repo_url):
                logger.warning("Invalid git URL format, skipping", repo=repo_url)
                continue

            # Extract repo name from URL (alphanumeric, dash, underscore only)
            repo_name = repo_url.rstrip("/").split("/")[-1].replace(".git", "")
            repo_name = re.sub(r"[^a-zA-Z0-9_-]", "", repo_name)
            if not repo_name:
                logger.warning("Could not extract valid repo name", repo=repo_url)
                continue

            # Clone command with properly escaped arguments
            # Clone into projects subdirectory to keep workspace organized
            safe_dest = shlex.quote(f"/home/dev/projects/{repo_name}")

            if validated_credentials:
                # Set up git credential helper using a script that reads from env
                # This avoids storing credentials in files
                username, token = validated_credentials
                # Create a credential helper script that outputs credentials
                # This is more secure than storing in ~/.git-credentials
                helper_script = f"""#!/bin/sh
echo "protocol=https"
echo "host=github.com"
echo "username={shlex.quote(username)}"
echo "password={shlex.quote(token)}"
"""
                setup_cmd = (
                    f"mkdir -p ~/.local/bin && "
                    f"cat > ~/.local/bin/git-cred-helper << 'HELPER'\n{helper_script}HELPER\n"
                    f"chmod 700 ~/.local/bin/git-cred-helper && "
                    f"git config --global credential.helper '!~/.local/bin/git-cred-helper'"
                )
                try:
                    await self.exec_command(workspace_id, setup_cmd, timeout=10)
                except Exception:
                    logger.warning("Failed to set up git credentials", workspace_id=workspace_id)

            clone_cmd = f"git clone {shlex.quote(repo_url)} {safe_dest}"

            try:
                await self.exec_command(workspace_id, clone_cmd, timeout=120)
                logger.info("Cloned repository", workspace_id=workspace_id, repo=repo_name)

                # Checkout specific branch if specified (and not main/master)
                if git_branch and git_branch not in ("main", "master"):
                    safe_branch = shlex.quote(git_branch)
                    checkout_cmd = f"cd {safe_dest} && git checkout {safe_branch}"
                    try:
                        result = await self.exec_command(workspace_id, checkout_cmd, timeout=30)
                        if result.exit_code == 0:
                            logger.info(
                                "Checked out branch",
                                workspace_id=workspace_id,
                                repo=repo_name,
                                branch=git_branch,
                            )
                        else:
                            logger.warning(
                                "Failed to checkout branch",
                                workspace_id=workspace_id,
                                repo=repo_name,
                                branch=git_branch,
                                stderr=result.stderr[:200] if result.stderr else "",
                            )
                    except Exception:
                        logger.warning(
                            "Failed to checkout branch",
                            workspace_id=workspace_id,
                            repo=repo_name,
                            branch=git_branch,
                            exc_info=True,
                        )
            except Exception:
                logger.exception("Failed to clone repository", repo=repo_url)
            finally:
                # Clean up git credentials after cloning to prevent credential leakage
                if validated_credentials:
                    try:
                        cleanup_cmd = (
                            "rm -f ~/.local/bin/git-cred-helper && "
                            "git config --global --unset credential.helper 2>/dev/null || true"
                        )
                        await self.exec_command(workspace_id, cleanup_cmd, timeout=10)
                        logger.debug("Cleaned up git credentials", workspace_id=workspace_id)
                    except Exception:
                        logger.warning(
                            "Failed to clean up git credentials", workspace_id=workspace_id
                        )

    async def stop_workspace(self, workspace_id: str) -> None:
        """Stop a Cloud Run job workspace."""
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            return

        # With volume mounts, dotfiles are automatically persisted - no sync needed
        logger.debug(
            "Volume mount mode - dotfiles already persisted",
            workspace_id=workspace_id,
        )

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
        """Track compute usage for all running workspaces (called periodically).

        Uses a lock to prevent race conditions where concurrent calls could
        read the same timestamp and double-bill.
        """
        async with self._billing_lock:
            now = datetime.now(UTC)

            # Get all running workspaces from store
            workspaces: list[WorkspaceInfo] = []
            if self._workspace_store:
                workspaces = await self._workspace_store.list_running()

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

                    # Parse last billing timestamp
                    last_billing = datetime.fromisoformat(last_billing_str)

                    # Ensure last_billing is timezone-aware
                    if last_billing.tzinfo is None:
                        last_billing = last_billing.replace(tzinfo=UTC)

                    # Calculate duration since last billing
                    duration = (now - last_billing).total_seconds()
                    if duration <= 0:
                        workspace.metadata["last_billing_timestamp"] = now.isoformat()
                        await self._save_workspace(workspace)
                        logger.warning(
                            "Non-positive billing duration, resetting timestamp",
                            workspace_id=workspace.id,
                        )
                        continue

                    if duration >= MINIMUM_BILLING_DURATION_SECONDS:
                        duration_seconds = int(duration)

                        # Update timestamp BEFORE tracking to prevent double-billing
                        # even if _track_compute_usage fails and retries
                        old_timestamp = workspace.metadata.get("last_billing_timestamp")
                        workspace.metadata["last_billing_timestamp"] = now.isoformat()

                        try:
                            # Track the usage
                            await self._track_compute_usage(workspace, duration_seconds)

                            # Save workspace after updating billing timestamp
                            await self._save_workspace(workspace)

                            logger.debug(
                                "Tracked periodic compute usage",
                                workspace_id=workspace.id,
                                duration_seconds=duration_seconds,
                            )
                        except Exception:
                            # Restore old timestamp on failure so we retry next time
                            if old_timestamp:
                                workspace.metadata["last_billing_timestamp"] = old_timestamp
                            else:
                                workspace.metadata.pop("last_billing_timestamp", None)
                            await self._save_workspace(workspace)
                            raise
                except Exception:
                    logger.exception(
                        "Failed to track periodic usage for workspace",
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
                    # Delete from user bucket
                    await self._bucket_service.delete_workspace_directory(
                        workspace.user_id, workspace_id
                    )
                    logger.info("Deleted GCS files for workspace", workspace_id=workspace_id)
                except Exception as e:
                    logger.warning("Failed to delete GCS files", error=str(e))

            await self._delete_workspace(workspace_id)

        logger.info(
            "Workspace deleted",
            workspace_id=workspace_id,
            files_preserved=preserve_files,
        )

    async def get_workspace(self, workspace_id: str) -> WorkspaceInfo | None:  # noqa: PLR0912, PLR0915
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
                else:
                    # Unknown state - log and preserve current status
                    logger.warning(
                        "Unknown execution state, preserving current status",
                        workspace_id=workspace_id,
                        reconciling=execution.reconciling,
                        failed_count=execution.failed_count,
                        succeeded_count=execution.succeeded_count,
                        running_count=execution.running_count,
                        current_status=workspace.status.value,
                    )
                    # Don't change status if we can't determine the state

                await self._save_workspace(workspace)

                # If status changed to RUNNING, set up workspace (git, repos, post-init, MCP)
                # Use setup lock to prevent concurrent setup from multiple get_workspace calls
                if (
                    old_status != WorkspaceStatus.RUNNING
                    and workspace.status == WorkspaceStatus.RUNNING
                ):
                    # Try to acquire setup lock - if already locked, another call is doing setup
                    setup_lock = self._get_setup_lock(workspace_id)
                    if setup_lock.locked():
                        logger.debug(
                            "Setup already in progress, skipping",
                            workspace_id=workspace_id,
                        )
                    else:
                        async with setup_lock:
                            # Re-check metadata flags after acquiring lock
                            workspace = await self._get_workspace(workspace_id)
                            if not workspace:
                                return None

                            # Wait for entrypoint to complete before doing any setup
                            # The entrypoint creates /home/dev/projects as a symlink to
                            # /mnt/gcs/workspaces/...
                            # We need to wait to avoid race conditions where we clone into
                            # a temporary directory that gets replaced by the symlink
                            entrypoint_ready = False
                            for _ in range(30):  # Wait up to 30 seconds
                                result = await self.exec_command(
                                    workspace_id,
                                    "test -L /home/dev/projects && echo 'ready'",
                                    timeout=5,
                                )
                                if result.stdout.strip() == "ready":
                                    entrypoint_ready = True
                                    break
                                await asyncio.sleep(1)

                            if not entrypoint_ready:
                                logger.warning(
                                    "Entrypoint may not have completed",
                                    workspace_id=workspace_id,
                                    hint="projects symlink not detected",
                                )
                                # Fall back to creating projects directory manually
                                await self.exec_command(
                                    workspace_id, "mkdir -p /home/dev/projects", timeout=10
                                )

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

                            # Clone repositories if specified
                            if not workspace.metadata.get("repos_cloned") and workspace.repos:
                                try:
                                    git_credentials = workspace.metadata.get("git_credentials")
                                    git_branch = workspace.metadata.get("git_branch")
                                    await self._clone_repos(
                                        workspace_id, workspace.repos, git_credentials, git_branch
                                    )
                                    workspace.metadata["repos_cloned"] = True
                                    await self._save_workspace(workspace)
                                except Exception as e:
                                    logger.warning(
                                        "Failed to clone repos on workspace ready",
                                        workspace_id=workspace_id,
                                        error=str(e),
                                    )

                            # Execute post-init commands
                            post_init_commands = workspace.metadata.get("post_init_commands", [])
                            if not workspace.metadata.get("post_init_done") and post_init_commands:
                                logger.info(
                                    "Executing post-init commands",
                                    workspace_id=workspace_id,
                                    command_count=len(post_init_commands),
                                )
                                for cmd in post_init_commands:
                                    try:
                                        # Use longer timeout for setup commands
                                        result = await self.exec_command(
                                            workspace_id, cmd, timeout=300
                                        )
                                        if result.exit_code != 0:
                                            logger.warning(
                                                "Post-init command failed",
                                                workspace_id=workspace_id,
                                                command=cmd[:100],
                                                exit_code=result.exit_code,
                                                stderr=result.stderr[:500] if result.stderr else "",
                                            )
                                    except Exception:
                                        logger.exception(
                                            "Failed to execute post-init command",
                                            workspace_id=workspace_id,
                                            command=cmd[:100],
                                        )
                                workspace.metadata["post_init_done"] = True
                                await self._save_workspace(workspace)

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
                # workspace is guaranteed non-None (checked above)
                assert workspace is not None  # noqa: S101

                # Classify the error for better handling
                error_str = str(e)
                if "NotFound" in error_str or "404" in error_str:
                    logger.warning(
                        "Execution not found - workspace may have been deleted",
                        workspace_id=workspace_id,
                        execution_name=execution_name,
                    )
                    workspace.status = WorkspaceStatus.STOPPED
                    await self._save_workspace(workspace)
                elif "PermissionDenied" in error_str or "403" in error_str:
                    logger.error(
                        "Permission denied accessing execution - check IAM roles",
                        workspace_id=workspace_id,
                        error=error_str[:200],
                    )
                    workspace.status = WorkspaceStatus.ERROR
                    await self._save_workspace(workspace)
                elif "Unauthenticated" in error_str or "401" in error_str:
                    logger.error(
                        "Authentication failed - check service account credentials",
                        workspace_id=workspace_id,
                        error=error_str[:200],
                    )
                    workspace.status = WorkspaceStatus.ERROR
                    await self._save_workspace(workspace)
                else:
                    logger.warning(
                        "Failed to get execution status",
                        workspace_id=workspace_id,
                        error=error_str[:200],
                    )

        return workspace

    # Note: list_workspaces is inherited from base class

    async def exec_command(
        self,
        workspace_id: str,
        command: str,
        working_dir: str | None = None,
        timeout: int = 30,
    ) -> WorkspaceExecResponse:
        """Execute a command in the workspace.

        For Cloud Run jobs, we use the workspace's HTTP API endpoint.
        Includes audit logging for security tracking.
        """
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            msg = f"Workspace {workspace_id} not found"
            raise ValueError(msg)

        safe_working_dir = shlex.quote(working_dir) if working_dir else "/home/dev"

        # Audit log the command execution (truncate for safety)
        # This helps with security auditing and debugging
        command_preview = command[:100] + "..." if len(command) > 100 else command  # noqa: PLR2004
        logger.info(
            "Executing workspace command",
            workspace_id=workspace_id,
            user_id=workspace.user_id,
            command_preview=command_preview,
            working_dir=safe_working_dir,
        )

        try:
            # Cloud Run exposes an HTTP endpoint on the workspace
            # The workspace container runs a small API server for command execution
            # Use HTTPS when TLS is enabled, HTTP for development
            protocol = "https" if settings.workspace_tls_enabled else "http"
            workspace_url = f"{protocol}://{workspace.host}:{workspace.port}"

            # Build request headers with optional token auth
            headers: dict[str, str] = {}
            if settings.workspace_auth_enabled and workspace.auth_token:
                headers[settings.workspace_token_header] = workspace.auth_token

            # Use shared HTTP client with connection pooling
            client = await self._get_http_client()
            response = await client.post(
                f"{workspace_url}/exec",
                json={
                    "command": command,
                    "working_dir": safe_working_dir,
                },
                headers=headers,
                timeout=float(timeout),  # Override default timeout for this request
            )

            if response.status_code == HTTP_OK_STATUS_CODE:
                data = response.json()
                return WorkspaceExecResponse(
                    exit_code=data.get("exit_code", 0),
                    stdout=data.get("stdout", ""),
                    stderr=data.get("stderr", ""),
                )
            else:
                logger.warning(
                    "Workspace exec returned non-200 status",
                    workspace_id=workspace_id,
                    status_code=response.status_code,
                )
                return WorkspaceExecResponse(
                    exit_code=-1,
                    stdout="",
                    stderr=f"HTTP {response.status_code}: {response.text}",
                )

        except httpx.TimeoutException:
            logger.warning(
                "Workspace exec timed out",
                workspace_id=workspace_id,
                timeout=timeout,
            )
            return WorkspaceExecResponse(
                exit_code=-1,
                stdout="",
                stderr=f"Command timed out after {timeout} seconds",
            )
        except httpx.ConnectError as e:
            logger.warning(
                "Failed to connect to workspace",
                workspace_id=workspace_id,
                error=str(e)[:100],
            )
            return WorkspaceExecResponse(
                exit_code=-1,
                stdout="",
                stderr=f"Connection failed: {e}",
            )
        except Exception as e:
            logger.exception("Failed to execute command", workspace_id=workspace_id)
            return WorkspaceExecResponse(
                exit_code=-1,
                stdout="",
                stderr=str(e),
            )

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

        Also exports GITHUB_TOKEN in .zshrc and .bashrc so it's available in interactive shells.
        """
        try:
            # Get the GITHUB_TOKEN from the container's environment
            # The token should be available in the environment since it was set during pod creation
            env_check = await self.exec_command(
                workspace_id,
                'echo "$GITHUB_TOKEN"',
            )
            github_token = env_check.stdout.strip()

            if not github_token:
                logger.warning(
                    "GITHUB_TOKEN not found in environment, skipping GitHub auth setup",
                    workspace_id=workspace_id,
                )
                return

            # Export GITHUB_TOKEN in .zshrc and .bashrc so it's available in interactive shells
            # Check if it's already exported to avoid duplicates
            # Escape single quotes in the token
            escaped_token = github_token.replace("'", "'\"'\"'")
            export_cmd = f"export GITHUB_TOKEN='{escaped_token}'"

            # Add to .bashrc if not already present
            bashrc_cmd = (
                f'sh -c \'grep -q "GITHUB_TOKEN" ~/.bashrc 2>/dev/null || '
                f'echo "{export_cmd}" >> ~/.bashrc\''
            )
            await self.exec_command(workspace_id, bashrc_cmd)

            # Add to .zshrc if not already present
            zshrc_cmd = (
                f'sh -c \'grep -q "GITHUB_TOKEN" ~/.zshrc 2>/dev/null || '
                f'echo "{export_cmd}" >> ~/.zshrc\''
            )
            await self.exec_command(workspace_id, zshrc_cmd)

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

    # Note: read_file, write_file, list_files, heartbeat, and cleanup_idle_workspaces
    # are inherited from base class

    async def check_workspace_health(self, workspace_id: str) -> bool:
        """Check if a GKE workspace pod is healthy and can execute commands.

        Returns True if the pod is running and can execute commands.
        Updates workspace status if the pod is in a bad state.
        """
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            return False

        if not workspace.host or workspace.host == "pending":
            return False

        try:
            # Try a simple command to verify the pod is responding
            result = await self.exec_command(workspace_id, "echo health", timeout=10)
            if result.exit_code == 0:
                return True

            logger.warning(
                "Workspace health check failed",
                workspace_id=workspace_id,
                exit_code=result.exit_code,
            )
            return False
        except Exception as e:
            logger.warning(
                "Workspace health check error",
                workspace_id=workspace_id,
                error=str(e)[:100],
            )
            workspace.status = WorkspaceStatus.ERROR
            await self._save_workspace(workspace)
            return False

    async def check_all_workspaces_health(self) -> dict[str, bool]:
        """Check health of all running workspaces.

        Returns a dict mapping workspace_id to health status.
        """
        results: dict[str, bool] = {}

        workspaces: list[WorkspaceInfo] = []
        if self._workspace_store:
            workspaces = await self._workspace_store.list_all()

        for workspace in workspaces:
            if workspace.status == WorkspaceStatus.RUNNING:
                is_healthy = await self.check_workspace_health(workspace.id)
                results[workspace.id] = is_healthy
                if not is_healthy:
                    logger.warning(
                        "Unhealthy workspace detected",
                        workspace_id=workspace.id,
                    )

        return results

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
            # Use shared HTTP client with connection pooling
            client = await self._get_http_client()
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

            # Inject DevTools bridge script into HTML responses
            content_type = response_headers.get("content-type", "")
            response_body = inject_devtools_script(response.content, content_type)

            # Update content-length if script was injected
            if len(response_body) != len(response.content):
                response_headers["content-length"] = str(len(response_body))

            return response.status_code, response_headers, response_body

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

    # Note: _extract_process_name, _parse_port_line, and get_active_ports
    # are inherited from base class

    async def scale_workspace(
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
            # With volume mounts, dotfiles are already persisted - no sync needed

            # Step 1: Stop the current workspace
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
