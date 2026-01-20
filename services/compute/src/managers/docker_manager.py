"""Docker-based compute manager for local development."""

from __future__ import annotations

import asyncio
import base64
import re
import shlex
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, cast

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Iterator

import docker
import httpx
import structlog
from docker.errors import ContainerError, ImageNotFound, NotFound

from podex_shared import ComputeUsageParams, get_usage_tracker
from podex_shared.models.workspace import HARDWARE_SPECS
from podex_shared.models.workspace import WorkspaceTier as SharedTier
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

if TYPE_CHECKING:
    from docker.models.containers import Container

    from src.storage.workspace_store import WorkspaceStore
    from src.sync.file_sync import FileSync

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


class DockerComputeManager(ComputeManager):
    """Local development implementation using Docker containers.

    Features:
    - Creates isolated Docker containers for each workspace
    - Supports warm pool for faster startup
    - Tier-based resource limits
    - Automatic cleanup of idle workspaces
    """

    def __init__(self, workspace_store: WorkspaceStore | None = None) -> None:
        """Initialize Docker client and workspace tracking."""
        self.client = docker.from_env()
        self._workspace_store = workspace_store
        # FileSync is set via set_file_sync() during initialization (required)
        self._file_sync: FileSync
        # Lock for billing operations to prevent race conditions
        self._billing_lock = asyncio.Lock()
        logger.info(
            "DockerComputeManager initialized",
            docker_host=settings.docker_host,
            workspace_image=settings.workspace_image,
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

    async def discover_existing_workspaces(self) -> None:  # noqa: PLR0915
        """Discover and re-register existing workspace containers.

        Called on startup to recover from service restarts without losing
        track of running workspaces. This ensures billing continuity.

        Strategy:
        1. Load workspaces from Redis (if available)
        2. Discover containers from Docker
        3. Reconcile: Update Redis with actual container state
        """
        try:
            # First, load workspaces from Redis if available
            redis_workspaces: dict[str, WorkspaceInfo] = {}
            if self._workspace_store:
                try:
                    all_workspaces = await self._workspace_store.list_all()
                    redis_workspaces = {w.id: w for w in all_workspaces}
                    logger.info(
                        "Loaded workspaces from Redis",
                        count=len(redis_workspaces),
                    )
                except Exception as e:
                    logger.warning(
                        "Failed to load workspaces from Redis, will discover from containers",
                        error=str(e),
                    )

            # Find all containers with podex workspace labels
            containers = await asyncio.to_thread(
                self.client.containers.list,
                filters={"label": "podex.workspace_id"},
            )

            for container in containers:
                try:
                    labels = container.labels
                    workspace_id = labels.get("podex.workspace_id")
                    user_id = labels.get("podex.user_id")
                    session_id = labels.get("podex.session_id")
                    tier_str = labels.get("podex.tier", "starter")

                    if not workspace_id or not user_id or not session_id:
                        logger.warning(
                            "Container missing required labels",
                            container_id=container.id[:12] if container.id else "unknown",
                        )
                        continue

                    # Parse tier
                    try:
                        tier = WorkspaceTier(tier_str)
                    except ValueError:
                        tier = WorkspaceTier.STARTER
                        logger.warning(
                            "Invalid tier in container label, using STARTER",
                            tier_str=tier_str,
                            workspace_id=workspace_id,
                        )

                    # Get container IP
                    container.reload()
                    container_ip = self._get_container_ip(container)

                    # Create workspace info
                    now = datetime.now(UTC)
                    workspace_info = WorkspaceInfo(
                        id=workspace_id,
                        user_id=user_id,
                        session_id=session_id,
                        status=WorkspaceStatus.RUNNING,
                        tier=tier,
                        host=container_ip or container.name or "localhost",
                        port=3000,
                        container_id=container.id or "",
                        repos=[],
                        created_at=now,  # We don't know actual creation time
                        last_activity=now,
                        metadata={
                            "container_name": container.name or "",
                            "last_billing_timestamp": now.isoformat(),
                            "rediscovered": True,
                        },
                    )

                    await self._save_workspace(workspace_info)

                    # Mark as found in container discovery
                    redis_workspaces.pop(workspace_id, None)

                    # Note: Don't restore dotfiles for rediscovered workspaces - they're already
                    # running with files intact. Only restore when creating NEW workspaces.

                    logger.info(
                        "Rediscovered existing workspace",
                        workspace_id=workspace_id,
                        container_id=container.id[:12] if container.id else "unknown",
                        tier=tier.value,
                    )

                    # Start MCP gateway for rediscovered workspace
                    try:
                        mcp_result = await self.exec_command(
                            workspace_id,
                            "/home/dev/.local/bin/start-mcp-gateway.sh",
                            timeout=30,
                        )
                        if mcp_result.exit_code == 0:
                            logger.info(
                                "MCP gateway started for rediscovered workspace",
                                workspace_id=workspace_id,
                            )
                    except Exception:
                        logger.warning(
                            "Failed to start MCP gateway for rediscovered workspace",
                            workspace_id=workspace_id,
                            exc_info=True,
                        )

                    # Notify API service about the rediscovered workspace
                    # This ensures database is synced with actual container state
                    await sync_workspace_status_to_api(
                        workspace_id=workspace_id,
                        status="running",
                        container_id=container.id,
                    )
                except Exception as e:
                    logger.exception(
                        "Failed to rediscover workspace container",
                        container_id=container.id[:12] if container.id else "unknown",
                        error=str(e),
                    )

            # Reconcile: Workspaces in Redis but not in containers are stale
            # Mark them as stopped
            for workspace_id, workspace in redis_workspaces.items():
                if workspace.status == WorkspaceStatus.RUNNING:
                    logger.warning(
                        "Workspace in Redis but container not found, marking as stopped",
                        workspace_id=workspace_id,
                    )
                    workspace.status = WorkspaceStatus.STOPPED
                    workspace.metadata["stale_discovery"] = True
                    await self._save_workspace(workspace)

            # Count rediscovered workspaces
            rediscovered_count = 0
            if self._workspace_store:
                all_workspaces = await self._workspace_store.list_all()
                rediscovered_count = len(
                    [w for w in all_workspaces if w.metadata.get("rediscovered")]
                )

            logger.info(
                "Workspace discovery complete",
                rediscovered_count=rediscovered_count,
                stale_count=len(redis_workspaces),
            )
        except Exception:
            logger.exception("Failed to discover existing workspaces")

    def set_file_sync(self, file_sync: FileSync) -> None:
        """Set the file sync service for GCS synchronization.

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

    def _get_resource_limits(self, tier: WorkspaceTier) -> dict[str, Any]:
        """Get Docker resource limits for a tier."""
        limits = {
            WorkspaceTier.STARTER: {
                "cpu_count": settings.tier_starter_cpu,
                "mem_limit": f"{settings.tier_starter_memory}m",
            },
            WorkspaceTier.PRO: {
                "cpu_count": settings.tier_pro_cpu,
                "mem_limit": f"{settings.tier_pro_memory}m",
            },
            WorkspaceTier.POWER: {
                "cpu_count": settings.tier_power_cpu,
                "mem_limit": f"{settings.tier_power_memory}m",
            },
            WorkspaceTier.ENTERPRISE: {
                "cpu_count": settings.tier_enterprise_cpu,
                "mem_limit": f"{settings.tier_enterprise_memory}m",
            },
        }
        return limits.get(tier, limits[WorkspaceTier.STARTER])

    async def create_workspace(  # noqa: PLR0912, PLR0915
        self,
        user_id: str,
        session_id: str,
        config: WorkspaceConfig,
        workspace_id: str | None = None,
    ) -> WorkspaceInfo:
        """Create a new Docker container workspace."""
        # Use provided workspace_id or generate one
        workspace_id = workspace_id or f"ws_{uuid.uuid4().hex[:12]}"

        logger.info(
            "Creating workspace",
            workspace_id=workspace_id,
            user_id=user_id,
            session_id=session_id,
            tier=config.tier,
        )

        # Check workspace limit
        active_count = 0
        if self._workspace_store:
            running_workspaces = await self._workspace_store.list_running()
            active_count = len(running_workspaces)
        if active_count >= settings.max_workspaces:
            msg = f"Maximum workspaces ({settings.max_workspaces}) reached"
            raise RuntimeError(msg)

        # Get resource limits for tier
        limits = self._get_resource_limits(config.tier)

        # Environment variables for the container
        env_vars = {
            "WORKSPACE_ID": workspace_id,
            "USER_ID": user_id,
            "SESSION_ID": session_id,
            "TEMPLATE_ID": config.template_id or "",
            **config.environment,
        }

        # Labels for tracking
        labels = {
            "podex.workspace_id": workspace_id,
            "podex.user_id": user_id,
            "podex.session_id": session_id,
            "podex.tier": config.tier.value,
        }

        # Determine image - config.base_image has priority
        container_image = config.base_image or settings.workspace_image
        if config.base_image:
            logger.info(
                "Using custom container image",
                image=container_image,
                workspace_id=workspace_id,
            )

        container_name = f"podex-workspace-{workspace_id}"

        # Clean up any existing container with the same name (from failed previous attempts)
        try:
            existing = self.client.containers.get(container_name)
            logger.warning(
                "Removing existing container with same name",
                workspace_id=workspace_id,
                container_id=existing.id,
            )
            existing.remove(force=True)
        except NotFound:
            pass  # No existing container, good
        except Exception as e:
            logger.warning(
                "Failed to remove existing container",
                workspace_id=workspace_id,
                error=str(e),
            )

        try:
            # Run container - use sh as command since stdin_open=True and tty=True
            # will keep it waiting for input. sh exists in virtually all images.
            container: Container = await asyncio.to_thread(
                self.client.containers.run,  # type: ignore[arg-type]
                container_image,
                command="/bin/sh",
                detach=True,
                name=container_name,
                environment=env_vars,
                labels=labels,
                network=settings.docker_network,
                **limits,
                # Keep container running - shell waits for input
                stdin_open=True,
                tty=True,
                # Working directory
                working_dir="/home/dev",
            )

            # Get container info
            container.reload()
            container_ip = self._get_container_ip(container)

            now = datetime.now(UTC)
            workspace_info = WorkspaceInfo(
                id=workspace_id,
                user_id=user_id,
                session_id=session_id,
                status=WorkspaceStatus.RUNNING,
                tier=config.tier,
                host=container_ip or container.name or "localhost",
                port=3000,  # Default dev server port
                container_id=container.id or "",
                repos=config.repos,
                created_at=now,
                last_activity=now,
                metadata={
                    "container_name": container.name or "",
                    "last_billing_timestamp": now.isoformat(),
                    # Store dotfiles config for sync on stop
                    "sync_dotfiles": config.sync_dotfiles,
                    "dotfiles_paths": config.dotfiles_paths,
                },
            )

            await self._save_workspace(workspace_info)

            # Sync files from GCS (restore workspace state)
            try:
                await self._file_sync.sync_from_gcs(workspace_id)
                # Start background sync (includes dotfiles)
                await self._file_sync.start_background_sync(
                    workspace_id=workspace_id,
                    user_id=user_id,
                    dotfiles_paths=config.dotfiles_paths,
                )
                workspace_info.metadata["gcs_sync_status"] = "success"
            except Exception as e:
                logger.exception(
                    "Failed to sync files from GCS",
                    workspace_id=workspace_id,
                )
                # Store sync error in metadata for visibility
                workspace_info.metadata["gcs_sync_status"] = "error"
                workspace_info.metadata["gcs_sync_error"] = str(e)

            # Sync user dotfiles (restore .claude/, .codex/, .gemini/ configs)
            try:
                await self._file_sync.sync_user_dotfiles(
                    workspace_id=workspace_id,
                    user_id=user_id,
                )
                workspace_info.metadata["dotfiles_sync_status"] = "success"
                logger.info(
                    "Synced user dotfiles to workspace",
                    workspace_id=workspace_id,
                    user_id=user_id,
                )
            except Exception as e:
                logger.exception(
                    "Failed to sync user dotfiles",
                    workspace_id=workspace_id,
                    user_id=user_id,
                )
                workspace_info.metadata["dotfiles_sync_status"] = "error"
                workspace_info.metadata["dotfiles_sync_error"] = str(e)

            # Ensure projects directory exists
            await self.exec_command(workspace_id, "mkdir -p /home/dev/projects", timeout=10)

            # Set up git identity from user configuration
            if config.git_name or config.git_email:
                await self._setup_git_identity(workspace_id, config.git_name, config.git_email)

            # Set up GitHub token authentication if GITHUB_TOKEN is in environment
            if config.environment.get("GITHUB_TOKEN"):
                await self._setup_github_token_auth(workspace_id)

            # Clone repos if specified (only if no GCS files were synced)
            if config.repos:
                await self._clone_repos(workspace_id, config.repos, config.git_credentials)

            # Execute post-init commands (e.g., template setup commands)
            if config.post_init_commands:
                logger.info(
                    "Executing post-init commands",
                    workspace_id=workspace_id,
                    command_count=len(config.post_init_commands),
                )
                for cmd in config.post_init_commands:
                    try:
                        # Use longer timeout for setup commands
                        result = await self.exec_command(workspace_id, cmd, timeout=300)
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

            # Start MCP gateway for the workspace
            # This provides HTTP access to MCP servers (filesystem, git) for the agent
            try:
                mcp_result = await self.exec_command(
                    workspace_id,
                    "/home/dev/.local/bin/start-mcp-gateway.sh",
                    timeout=30,
                )
                if mcp_result.exit_code == 0:
                    logger.info(
                        "MCP gateway started",
                        workspace_id=workspace_id,
                    )
                else:
                    logger.warning(
                        "MCP gateway startup failed",
                        workspace_id=workspace_id,
                        exit_code=mcp_result.exit_code,
                        stderr=mcp_result.stderr[:200] if mcp_result.stderr else "",
                    )
            except Exception:
                logger.warning(
                    "Failed to start MCP gateway",
                    workspace_id=workspace_id,
                    exc_info=True,
                )

            logger.info(
                "Workspace created",
                workspace_id=workspace_id,
                container_id=(container.id or "")[:12],
                host=workspace_info.host,
            )

            return workspace_info

        except ImageNotFound:
            logger.exception("Workspace image not found", image=settings.workspace_image)
            raise
        except ContainerError as e:
            logger.exception("Container failed to start", error=str(e))
            raise

    def _get_container_ip(self, container: Container) -> str | None:
        """Get container IP address on the Docker network."""
        networks = container.attrs.get("NetworkSettings", {}).get("Networks", {})
        network_info = networks.get(settings.docker_network, {})
        ip_address: str | None = network_info.get("IPAddress")
        return ip_address

    async def _setup_git_identity(
        self,
        workspace_id: str,
        git_name: str | None,
        git_email: str | None,
    ) -> None:
        """Set up git identity (user.name and user.email) in the workspace.

        Args:
            workspace_id: The workspace ID
            git_name: Git user.name for commits
            git_email: Git user.email for commits
        """
        try:
            if git_name:
                # Escape single quotes in the name by replacing ' with '\''
                safe_name = git_name.replace("'", "'\\''")
                await self.exec_command(
                    workspace_id,
                    f"git config --global user.name '{safe_name}'",
                    timeout=10,
                )
                logger.debug("Set git user.name", workspace_id=workspace_id)

            if git_email:
                # Escape single quotes in the email (unlikely but safe)
                safe_email = git_email.replace("'", "'\\''")
                await self.exec_command(
                    workspace_id,
                    f"git config --global user.email '{safe_email}'",
                    timeout=10,
                )
                logger.debug("Set git user.email", workspace_id=workspace_id)

            if git_name or git_email:
                logger.info(
                    "Git identity configured",
                    workspace_id=workspace_id,
                    has_name=bool(git_name),
                    has_email=bool(git_email),
                )
        except Exception:
            # Non-fatal: log warning but continue workspace creation
            logger.warning(
                "Failed to set git identity",
                workspace_id=workspace_id,
                exc_info=True,
            )

    async def _setup_github_token_auth(self, workspace_id: str) -> None:
        """Configure git to use GITHUB_TOKEN environment variable for GitHub authentication.

        This sets up a credential helper that reads the token from the GITHUB_TOKEN
        environment variable, enabling git push/pull/fetch operations to GitHub
        without requiring manual authentication.
        """
        try:
            # Create a credential helper script that reads from GITHUB_TOKEN env var
            # This script outputs the credentials in the format git expects
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
                timeout=10,
            )

            # Make it executable
            await self.exec_command(
                workspace_id,
                "chmod +x ~/.local/bin/git-credential-github-token",
                timeout=10,
            )

            # Configure git to use this credential helper for github.com
            # This is added as a lower-priority helper, so explicit credentials take precedence
            helper_cmd = (
                "git config --global credential.https://github.com.helper "
                "'!~/.local/bin/git-credential-github-token'"
            )
            await self.exec_command(
                workspace_id,
                helper_cmd,
                timeout=10,
            )

            logger.info("GitHub token authentication configured", workspace_id=workspace_id)

        except Exception:
            # Non-fatal: log warning but continue workspace creation
            logger.warning(
                "Failed to configure GitHub token authentication",
                workspace_id=workspace_id,
                exc_info=True,
            )

    async def _clone_repos(  # noqa: PLR0912
        self,
        workspace_id: str,
        repos: list[str],
        git_credentials: str | None,
    ) -> None:
        """Clone repositories into the workspace."""
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
                # Set up git credential helper in container before cloning
                username, token = validated_credentials
                cred_url = f"https://{shlex.quote(username)}:{shlex.quote(token)}@github.com"
                setup_cmd = (
                    f"git config --global credential.helper store && "
                    f"echo '{cred_url}' > ~/.git-credentials && "
                    f"chmod 600 ~/.git-credentials"
                )
                try:
                    await self.exec_command(workspace_id, setup_cmd, timeout=10)
                except Exception:
                    logger.warning("Failed to set up git credentials", workspace_id=workspace_id)

            clone_cmd = f"git clone {shlex.quote(repo_url)} {safe_dest}"

            try:
                await self.exec_command(workspace_id, clone_cmd, timeout=120)
                logger.info("Cloned repository", workspace_id=workspace_id, repo=repo_name)
            except Exception:
                logger.exception("Failed to clone repository", repo=repo_url)
            finally:
                # Clean up git credentials after cloning to prevent credential leakage
                if validated_credentials:
                    try:
                        cleanup_cmd = (
                            "rm -f ~/.git-credentials && "
                            "git config --global --unset credential.helper"
                        )
                        await self.exec_command(workspace_id, cleanup_cmd, timeout=10)
                    except Exception:
                        logger.warning(
                            "Failed to clean up git credentials", workspace_id=workspace_id
                        )

    async def _calculate_compute_duration(self, workspace: Any) -> int:
        """Calculate compute usage duration for billing."""
        stop_time = datetime.now(UTC)
        duration_seconds = 0
        last_billing_str = workspace.metadata.get("last_billing_timestamp")
        if last_billing_str:
            try:
                last_billing = datetime.fromisoformat(last_billing_str)
                if last_billing.tzinfo is None:
                    last_billing = last_billing.replace(tzinfo=UTC)
                delta_seconds = (stop_time - last_billing).total_seconds()
                if delta_seconds > 0:
                    duration_seconds = int(delta_seconds)
            except ValueError:
                logger.warning(
                    "Invalid last_billing_timestamp on stop, skipping compute billing",
                    workspace_id=workspace.id,
                    last_billing_timestamp=last_billing_str,
                )
        else:
            logger.warning(
                "Missing last_billing_timestamp on stop, skipping compute billing",
                workspace_id=workspace.id,
            )

        workspace.metadata["last_billing_timestamp"] = stop_time.isoformat()
        return duration_seconds

    async def _sync_files_before_stop(self, workspace: Any) -> Exception | None:
        """Sync files to GCS and save dotfiles before stopping workspace."""
        sync_error: Exception | None = None

        # Sync files to GCS (stop background sync first)
        try:
            await self._file_sync.stop_background_sync(workspace.id)
            await self._file_sync.sync_to_gcs(workspace.id)
            workspace.metadata["gcs_sync_status"] = "success"
        except Exception as e:
            logger.exception(
                "Failed to sync files to GCS before stop",
                workspace_id=workspace.id,
            )
            workspace.metadata["gcs_sync_status"] = "error"
            workspace.metadata["gcs_sync_error"] = str(e)
            sync_error = e

        # Save user dotfiles if enabled
        sync_dotfiles = workspace.metadata.get("sync_dotfiles", True)
        if sync_dotfiles:
            try:
                dotfiles_paths = workspace.metadata.get("dotfiles_paths")
                await self._file_sync.save_user_dotfiles(
                    workspace_id=workspace.id,
                    user_id=workspace.user_id,
                    dotfiles_paths=dotfiles_paths,
                )
                workspace.metadata["dotfiles_sync_status"] = "success"
                logger.info(
                    "Saved user dotfiles before workspace stop",
                    workspace_id=workspace.id,
                    user_id=workspace.user_id,
                )
            except Exception as e:
                logger.exception(
                    "Failed to save user dotfiles before stop",
                    workspace_id=workspace.id,
                    user_id=workspace.user_id,
                )
                workspace.metadata["dotfiles_sync_status"] = "error"
                workspace.metadata["dotfiles_sync_error"] = str(e)

        return sync_error

    async def _stop_container(
        self,
        workspace: Any,
        duration_seconds: int,
        sync_error: Exception | None,
    ) -> None:
        """Stop the workspace container and handle post-stop operations."""
        stop_time = datetime.now(UTC)

        try:
            container = await asyncio.to_thread(
                self.client.containers.get,
                workspace.container_id,
            )
            await asyncio.to_thread(container.stop, timeout=10)

            workspace.status = WorkspaceStatus.STOPPED
            workspace.last_activity = stop_time
            await self._save_workspace(workspace)

            # Track compute usage for billing
            if duration_seconds > 0:
                await self._track_compute_usage(workspace, duration_seconds)

            # Warn if sync failed but stop succeeded
            if sync_error:
                logger.warning(
                    "Workspace stopped but GCS sync failed - data may be lost",
                    workspace_id=workspace.id,
                )
            else:
                logger.info("Workspace stopped", workspace_id=workspace.id)
        except NotFound:
            logger.warning("Container not found", workspace_id=workspace.id)
            workspace.status = WorkspaceStatus.ERROR
            await self._save_workspace(workspace)

    async def stop_workspace(self, workspace_id: str) -> None:
        """Stop a running workspace container."""
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            logger.warning("Workspace not found", workspace_id=workspace_id)
            return

        if not workspace.container_id:
            return

        # Calculate compute usage duration
        duration_seconds = await self._calculate_compute_duration(workspace)

        # Sync files before stopping
        sync_error = await self._sync_files_before_stop(workspace)

        # Stop the container
        await self._stop_container(workspace, duration_seconds, sync_error)

    async def restart_workspace(self, workspace_id: str) -> None:
        """Restart a stopped workspace container."""
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            logger.warning("Workspace not found for restart", workspace_id=workspace_id)
            raise ValueError(f"Workspace {workspace_id} not found")

        if not workspace.container_id:
            logger.warning("No container ID for restart", workspace_id=workspace_id)
            raise ValueError(f"Workspace {workspace_id} has no container")

        try:
            container = await asyncio.to_thread(
                self.client.containers.get,
                workspace.container_id,
            )

            # Check if container is already running
            container_status = container.status
            if container_status == "running":
                logger.info("Container already running", workspace_id=workspace_id)
                workspace.status = WorkspaceStatus.RUNNING
                workspace.last_activity = datetime.now(UTC)
                await self._save_workspace(workspace)
                return

            # Start the stopped container
            await asyncio.to_thread(container.start)

            workspace.status = WorkspaceStatus.RUNNING
            workspace.last_activity = datetime.now(UTC)
            await self._save_workspace(workspace)

            # Resume file sync
            try:
                await self._file_sync.start_background_sync(
                    workspace_id=workspace_id,
                    user_id=workspace.user_id,
                    dotfiles_paths=workspace.metadata.get("dotfiles_paths"),
                )
            except Exception as e:
                logger.warning(
                    "Failed to resume file sync after restart",
                    workspace_id=workspace_id,
                    error=str(e),
                )

            # Start MCP gateway after restart
            try:
                mcp_result = await self.exec_command(
                    workspace_id,
                    "/home/dev/.local/bin/start-mcp-gateway.sh",
                    timeout=30,
                )
                if mcp_result.exit_code == 0:
                    logger.info(
                        "MCP gateway started after restart",
                        workspace_id=workspace_id,
                    )
            except Exception:
                logger.warning(
                    "Failed to start MCP gateway after restart",
                    workspace_id=workspace_id,
                    exc_info=True,
                )

            logger.info("Workspace restarted", workspace_id=workspace_id)
        except NotFound:
            logger.warning("Container not found for restart", workspace_id=workspace_id)
            workspace.status = WorkspaceStatus.ERROR
            await self._save_workspace(workspace)
            raise ValueError(f"Container for workspace {workspace_id} not found") from None

    async def _track_compute_usage(
        self,
        workspace: WorkspaceInfo,
        duration_seconds: int,
    ) -> None:
        """Track compute usage for billing."""
        tracker = get_usage_tracker()
        if not tracker:
            logger.debug("Usage tracker not initialized, skipping compute usage recording")
            return

        try:
            # Get hourly rate for this tier
            tier_enum = SharedTier(workspace.tier.value)
            hardware_spec = HARDWARE_SPECS.get(tier_enum)
            # Default to $0.05/hr if hardware spec not found
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
                    "container_id": workspace.container_id,
                },
            )
            await tracker.record_compute_usage(params)
            logger.debug(
                "Recorded compute usage",
                workspace_id=workspace.id,
                duration_seconds=duration_seconds,
                tier=workspace.tier.value,
            )
        except Exception:
            # Don't fail the stop if usage tracking fails
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
                    # Get last billing timestamp from metadata
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

                    # Only track if at least 10 minutes have passed to avoid too many small entries
                    # This also helps with cost precision since per-minute billing at low rates
                    # results in sub-cent costs that round to $0
                    if duration >= 600:  # noqa: PLR2004
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
        """Delete a workspace and its container.

        Args:
            workspace_id: The workspace to delete
            preserve_files: If True, sync to GCS before deletion. If False, also delete GCS files.
        """
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            return

        # Sync files to GCS before deletion (with timeout to prevent shutdown hangs)
        try:
            await self._file_sync.stop_background_sync(workspace_id)
            if preserve_files:
                await asyncio.wait_for(
                    self._file_sync.sync_to_gcs(workspace_id),
                    timeout=30.0,  # 30 second timeout to prevent shutdown hangs
                )
            else:
                # Optionally delete GCS files too
                await asyncio.wait_for(
                    self._file_sync.delete_workspace_files(workspace_id),
                    timeout=30.0,
                )
        except TimeoutError:
            logger.warning(
                "GCS sync timed out during workspace deletion",
                workspace_id=workspace_id,
            )
        except Exception:
            logger.exception(
                "Failed to handle GCS files before delete",
                workspace_id=workspace_id,
            )

        if workspace.container_id:
            try:
                container = await asyncio.to_thread(
                    self.client.containers.get,
                    workspace.container_id,
                )
                await asyncio.to_thread(container.remove, force=True)
                logger.info("Workspace container removed", workspace_id=workspace_id)
            except NotFound:
                pass

        await self._delete_workspace(workspace_id)

    async def get_workspace(self, workspace_id: str) -> WorkspaceInfo | None:
        """Get workspace information."""
        workspace = await self._get_workspace(workspace_id)

        # If not in registry, try to find container directly and re-register
        if not workspace:
            workspace = await self._discover_workspace_by_id(workspace_id)

        if not workspace:
            return None

        # Update status from container
        if workspace.container_id:
            try:
                container = await asyncio.to_thread(
                    self.client.containers.get,
                    workspace.container_id,
                )
                if container.status == "running":
                    workspace.status = WorkspaceStatus.RUNNING
                elif container.status == "exited":
                    workspace.status = WorkspaceStatus.STOPPED
                await self._save_workspace(workspace)
            except NotFound:
                workspace.status = WorkspaceStatus.ERROR
                await self._save_workspace(workspace)

        return workspace

    async def _discover_workspace_by_id(self, workspace_id: str) -> WorkspaceInfo | None:
        """Try to find and re-register a workspace container by ID.

        This handles cases where the compute service was restarted but the
        container is still running.
        """
        try:
            container_name = f"podex-workspace-{workspace_id}"
            container = await asyncio.to_thread(
                self.client.containers.get,
                container_name,
            )

            # Get labels
            labels = container.labels
            user_id = labels.get("podex.user_id")
            session_id = labels.get("podex.session_id")
            tier_str = labels.get("podex.tier", "starter")

            if not user_id or not session_id:
                logger.warning(
                    "Container missing required labels, cannot re-register",
                    workspace_id=workspace_id,
                )
                return None

            # Parse tier
            try:
                tier = WorkspaceTier(tier_str)
            except ValueError:
                tier = WorkspaceTier.STARTER

            # Get container IP
            container.reload()
            container_ip = self._get_container_ip(container)

            # Create workspace info
            now = datetime.now(UTC)
            workspace_info = WorkspaceInfo(
                id=workspace_id,
                user_id=user_id,
                session_id=session_id,
                status=WorkspaceStatus.RUNNING
                if container.status == "running"
                else WorkspaceStatus.STOPPED,
                tier=tier,
                host=container_ip or container.name or "localhost",
                port=3000,
                container_id=container.id or "",
                repos=[],
                created_at=now,
                last_activity=now,
                metadata={
                    "container_name": container.name or "",
                    "last_billing_timestamp": now.isoformat(),
                    "rediscovered": True,
                },
            )

            # Re-register in store
            await self._save_workspace(workspace_info)

            logger.info(
                "Re-discovered workspace container on-demand",
                workspace_id=workspace_id,
                container_id=container.id[:12] if container.id else "unknown",
            )

            # Notify API service about the rediscovered workspace
            await sync_workspace_status_to_api(
                workspace_id=workspace_id,
                status=workspace_info.status.value,
                container_id=container.id,
            )

            return workspace_info

        except NotFound:
            return None
        except Exception as e:
            logger.warning(
                "Failed to discover workspace container",
                workspace_id=workspace_id,
                error=str(e),
            )
            return None

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
        """Execute a command in the workspace container.

        Args:
            workspace_id: The workspace to execute in
            command: The command to run
            working_dir: Working directory for the command
            timeout: Command timeout in seconds (default 30)

        Returns:
            WorkspaceExecResponse with exit_code, stdout, stderr

        Raises:
            ValueError: If workspace not found
            TimeoutError: If command exceeds timeout
        """
        # Use get_workspace which handles on-demand discovery of containers
        workspace = await self.get_workspace(workspace_id)
        if not workspace or not workspace.container_id:
            msg = f"Workspace {workspace_id} not found"
            raise ValueError(msg)

        try:
            container = await asyncio.to_thread(
                self.client.containers.get,
                workspace.container_id,
            )

            # Auto-restart if container is not running
            if container.status != "running":
                logger.info(
                    "Container not running, auto-restarting",
                    workspace_id=workspace_id,
                    container_status=container.status,
                )
                await self.restart_workspace(workspace_id)
                # Re-fetch the container after restart
                container = await asyncio.to_thread(
                    self.client.containers.get,
                    workspace.container_id,
                )

            # Execute command with timeout
            # Docker exec_run is synchronous, so wrap with asyncio timeout
            try:
                exec_result = await asyncio.wait_for(
                    asyncio.to_thread(
                        container.exec_run,
                        cmd=["bash", "-c", command],
                        workdir=working_dir or "/home/dev",
                        demux=True,  # Separate stdout/stderr
                    ),
                    timeout=float(timeout),
                )
            except TimeoutError:
                logger.warning(
                    "Command timed out",
                    workspace_id=workspace_id,
                    command=command[:100],
                    timeout=timeout,
                )
                return WorkspaceExecResponse(
                    exit_code=-1,
                    stdout="",
                    stderr=f"Command timed out after {timeout} seconds",
                )

            exit_code = exec_result.exit_code
            stdout_bytes, stderr_bytes = exec_result.output

            return WorkspaceExecResponse(
                exit_code=exit_code,
                stdout=stdout_bytes.decode() if stdout_bytes else "",
                stderr=stderr_bytes.decode() if stderr_bytes else "",
            )
        except NotFound as e:
            msg = f"Container not found for workspace {workspace_id}"
            raise ValueError(msg) from e

    async def exec_command_stream(  # noqa: PLR0915, PLR0912
        self,
        workspace_id: str,
        command: str,
        working_dir: str | None = None,
        timeout: int = 60,
    ) -> AsyncGenerator[str, None]:
        """Execute a command using PTY and stream output chunks.

        Uses a pseudo-terminal (PTY) to execute the command, which is
        necessary for interactive commands like authentication flows
        that display URLs and wait for user input.

        Args:
            workspace_id: The workspace ID
            command: Shell command to execute
            working_dir: Working directory (default: /home/dev)
            timeout: Command timeout in seconds

        Yields:
            Output chunks as strings
        """
        workspace = await self.get_workspace(workspace_id)
        if not workspace or not workspace.container_id:
            msg = f"Workspace {workspace_id} not found"
            raise ValueError(msg)

        try:
            container = await asyncio.to_thread(
                self.client.containers.get,
                workspace.container_id,
            )

            # Auto-restart if container is not running
            if container.status != "running":
                logger.info(
                    "Container not running, auto-restarting for stream exec",
                    workspace_id=workspace_id,
                    container_status=container.status,
                )
                await self.restart_workspace(workspace_id)
                container = await asyncio.to_thread(
                    self.client.containers.get,
                    workspace.container_id,
                )

            # Create exec WITHOUT PTY - CLI tools will output plain text
            # instead of fancy ncurses-style terminal UI
            exec_instance = await asyncio.to_thread(
                self.client.api.exec_create,
                workspace.container_id,
                cmd=["bash", "-c", command],
                stdin=False,
                stdout=True,
                stderr=True,
                tty=False,  # No PTY - get plain text output
                workdir=working_dir or "/home/dev",
            )
            exec_id = exec_instance["Id"]

            # Start exec with stream=True for automatic demuxing
            # (socket=True gives raw multiplexed bytes that need manual header parsing)
            output_generator = cast(
                "Iterator[tuple[bytes | None, bytes | None]]",
                await asyncio.to_thread(
                    self.client.api.exec_start,
                    exec_id,
                    stream=True,
                    demux=True,  # Separate stdout/stderr
                ),
            )

            start_time = asyncio.get_event_loop().time()
            buffer = ""

            # Iterate over the output generator
            for stdout_chunk, stderr_chunk in output_generator:
                # Check overall timeout
                elapsed = asyncio.get_event_loop().time() - start_time
                if elapsed > timeout:
                    logger.warning(
                        "Streaming exec timed out",
                        workspace_id=workspace_id,
                        timeout=timeout,
                    )
                    yield "\n⏱️ Command timed out\n"
                    break

                # Process stdout
                if stdout_chunk:
                    chunk = stdout_chunk.decode("utf-8", errors="replace")

                    # Strip ANSI escape codes (terminal control sequences)
                    chunk = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", chunk)
                    chunk = re.sub(r"\x1b\][^\x07]*\x07", "", chunk)  # OSC sequences
                    chunk = re.sub(r"\x1b[PX^_][^\x1b]*\x1b\\", "", chunk)  # DCS/SOS/PM/APC
                    chunk = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", chunk)  # Control chars

                    if chunk:
                        buffer += chunk
                        # Yield on newlines (end of JSON lines) for real-time streaming
                        # SSE layer uses null bytes for line separation, so this is safe
                        if "\n" in buffer:
                            yield buffer
                            buffer = ""

                # Process stderr (also yield it for visibility)
                if stderr_chunk:
                    chunk = stderr_chunk.decode("utf-8", errors="replace")
                    chunk = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", chunk)
                    chunk = re.sub(r"\x1b\][^\x07]*\x07", "", chunk)
                    chunk = re.sub(r"\x1b[PX^_][^\x1b]*\x1b\\", "", chunk)
                    chunk = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", chunk)

                    if chunk:
                        buffer += chunk
                        if "\n" in buffer:
                            yield buffer
                            buffer = ""

            # Yield any remaining buffer
            if buffer:
                yield buffer

        except NotFound as e:
            msg = f"Container not found for workspace {workspace_id}"
            raise ValueError(msg) from e
        except Exception as e:
            logger.exception(
                "Streaming exec failed",
                workspace_id=workspace_id,
                error=str(e),
            )
            yield f"\n❌ Error: {e}\n"

    async def read_file(self, workspace_id: str, path: str) -> str:
        """Read a file from the workspace."""
        # Escape path to prevent command injection
        safe_path = shlex.quote(path)
        result = await self.exec_command(workspace_id, f"cat {safe_path}")
        if result.exit_code != 0:
            msg = "Failed to read file"
            raise ValueError(msg)
        stdout: str = result.stdout
        return stdout

    async def write_file(self, workspace_id: str, path: str, content: str) -> None:
        """Write a file to the workspace."""
        # Validate path to prevent command injection
        safe_path = shlex.quote(path)
        # Use base64 encoding to safely transfer content without shell escaping issues
        encoded_content = base64.b64encode(content.encode()).decode()
        safe_encoded = shlex.quote(encoded_content)
        cmd = f"mkdir -p $(dirname {safe_path}) && echo {safe_encoded} | base64 -d > {safe_path}"
        result = await self.exec_command(workspace_id, cmd)
        if result.exit_code != 0:
            msg = "Failed to write file"
            raise ValueError(msg)

    async def list_files(
        self,
        workspace_id: str,
        path: str = ".",
    ) -> list[dict[str, str]]:
        """List files in a workspace directory."""
        # Escape path to prevent command injection
        safe_path = shlex.quote(path)
        result = await self.exec_command(
            workspace_id,
            f"ls -la {safe_path} | tail -n +2",  # Skip "total" line
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
                        "permissions": parts[0],
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
                "Starting workspace cleanup",
                total_to_cleanup=len(workspaces_to_cleanup),
                timeout_seconds=timeout_seconds,
            )

        for i, (workspace, idle_time) in enumerate(workspaces_to_cleanup, 1):
            logger.info(
                "Cleaning up workspace",
                progress=f"{i}/{len(workspaces_to_cleanup)}",
                workspace_id=workspace.id[:12],
                idle_seconds=int(idle_time),
            )
            try:
                await self.delete_workspace(workspace.id)
                cleaned_up.append(workspace.id)
            except Exception:
                logger.exception(
                    "Failed to cleanup workspace, continuing with others",
                    workspace_id=workspace.id,
                )

        if workspaces_to_cleanup:
            logger.info(
                "Workspace cleanup completed",
                cleaned_up_count=len(cleaned_up),
                total_attempted=len(workspaces_to_cleanup),
            )

        return cleaned_up

    async def get_preview_url(self, workspace_id: str, port: int) -> str | None:
        """Get the URL to access a dev server running in the workspace.

        For Docker, returns the container's internal IP on the Docker network.
        """
        workspace = await self._get_workspace(workspace_id)
        if not workspace or workspace.status != WorkspaceStatus.RUNNING:
            return None

        # Use container hostname (container name) since we're on the same Docker network
        # This works because the API service is also on the same Docker network
        if workspace.host:
            return f"http://{workspace.host}:{port}"

        return None

    async def proxy_request(
        self,
        request: ProxyRequest,
    ) -> tuple[int, dict[str, str], bytes]:
        """Proxy an HTTP request to a workspace container."""
        workspace = await self._get_workspace(request.workspace_id)
        if not workspace:
            raise ValueError(f"Workspace {request.workspace_id} not found")

        if workspace.status != WorkspaceStatus.RUNNING:
            raise ValueError(f"Workspace {request.workspace_id} is not running")

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
            "Proxying request",
            workspace_id=request.workspace_id,
            port=request.port,
            method=request.method,
            path=request.path,
            target_url=target_url,
        )

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.request(
                    method=request.method,
                    url=target_url,
                    headers=filtered_headers,
                    content=request.body,
                    follow_redirects=False,  # Let the client handle redirects
                )

                # Filter response headers
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
                "Failed to connect to workspace service",
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
                "Request to workspace timed out",
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
        """Get list of ports with active services in the workspace.

        Uses netstat/ss to detect listening ports inside the container.
        """
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            return []

        try:
            # Use ss (socket statistics) to find listening ports
            # Format: State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
            result = await self.exec_command(
                workspace_id,
                "ss -tlnp 2>/dev/null | tail -n +2",
            )

            if result.exit_code != 0:
                # Try netstat as fallback
                result = await self.exec_command(
                    workspace_id,
                    "netstat -tlnp 2>/dev/null | tail -n +3",
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

            # Deduplicate by port
            seen_ports: set[int] = set()
            unique_ports = []
            for p in ports:
                if p["port"] not in seen_ports:
                    seen_ports.add(p["port"])
                    unique_ports.append(p)

            logger.debug(
                "Found active ports",
                workspace_id=workspace_id,
                ports=unique_ports,
            )

            return unique_ports

        except Exception:
            logger.exception("Failed to get active ports", workspace_id=workspace_id)
            return []

    async def scale_workspace(
        self,
        workspace_id: str,
        new_tier: WorkspaceTier,
    ) -> WorkspaceScaleResponse:
        """Scale a Docker workspace to a new compute tier.

        For Docker, this involves:
        1. Saving any unsaved changes to GCS (dotfiles)
        2. Stopping the current container
        3. Creating a new container with the new resource limits
        4. The new container will restore from GCS on startup
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

        logger.info(
            "Scaling Docker workspace",
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
            # For now, we'll use a minimal config - in production this should be stored
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
            # We need to get the original creation parameters
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

            spec = HARDWARE_SPECS.get(new_tier)
            return WorkspaceScaleResponse(
                success=True,
                message=f"Successfully scaled workspace to {new_tier.value} tier",
                new_tier=new_tier,
                estimated_cost_per_hour=spec.hourly_rate if spec else None,
                requires_restart=True,
            )

        except Exception as e:
            logger.exception(
                "Failed to scale Docker workspace",
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
