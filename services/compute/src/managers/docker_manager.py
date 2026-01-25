"""Docker-based compute manager for local development."""

from __future__ import annotations

import asyncio
import base64
import re
import secrets
import shlex
import shutil
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, cast

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Iterator

import docker
import httpx
import structlog
from docker.errors import APIError, ContainerError, ImageNotFound, NotFound

from podex_shared import ComputeUsageParams, get_usage_tracker
from podex_shared.models.workspace import HARDWARE_SPECS
from podex_shared.models.workspace import WorkspaceTier as SharedTier
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

if TYPE_CHECKING:
    from docker.models.containers import Container

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


class DockerComputeManager(ComputeManager):
    """Local development implementation using Docker containers.

    Features:
    - Creates isolated Docker containers for each workspace
    - Supports warm pool for faster startup
    - Tier-based resource limits
    - Automatic cleanup of idle workspaces
    - Per-user local storage mounted as volumes (emulates GCS bucket mounting)
    """

    def __init__(self, workspace_store: WorkspaceStore | None = None) -> None:
        """Initialize Docker client and workspace tracking."""
        self.client = docker.from_env()
        self._workspace_store = workspace_store
        # Lock for billing operations to prevent race conditions
        self._billing_lock = asyncio.Lock()
        # Lock for workspace operations to prevent TOCTOU issues
        self._workspace_locks: dict[str, asyncio.Lock] = {}
        # Local storage path for per-user directories (direct filesystem, no GCS)
        self._local_storage_path = Path(settings.local_storage_path)
        # Shared HTTP client for connection pooling
        self._http_client: httpx.AsyncClient | None = None
        logger.info(
            "DockerComputeManager initialized",
            docker_host=settings.docker_host,
            workspace_image=settings.workspace_image,
            has_workspace_store=workspace_store is not None,
            local_storage_path=str(self._local_storage_path),
        )

    def _get_workspace_lock(self, workspace_id: str) -> asyncio.Lock:
        """Get or create a lock for workspace operations to prevent TOCTOU issues."""
        if workspace_id not in self._workspace_locks:
            self._workspace_locks[workspace_id] = asyncio.Lock()
        return self._workspace_locks[workspace_id]

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

    async def discover_existing_workspaces(self) -> None:  # noqa: PLR0912, PLR0915
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

            # Track failed rediscoveries for reporting
            failed_count = 0

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

                    # Create workspace info with new auth token for rediscovered workspace
                    now = datetime.now(UTC)
                    auth_token = (
                        secrets.token_urlsafe(32) if settings.workspace_auth_enabled else None
                    )
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
                        auth_token=auth_token,
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

                    # Notify API service about the rediscovered workspace
                    # This ensures database is synced with actual container state
                    await sync_workspace_status_to_api(
                        workspace_id=workspace_id,
                        status="running",
                        container_id=container.id,
                    )
                except Exception as e:
                    failed_count += 1
                    # Classify the error for better diagnostics
                    error_str = str(e).lower()
                    if "permission" in error_str or "access denied" in error_str:
                        logger.error(
                            "Permission error during workspace rediscovery",
                            container_id=container.id[:12] if container.id else "unknown",
                            error=str(e),
                            hint="Check Docker permissions",
                        )
                    elif "network" in error_str or "connection" in error_str:
                        logger.error(
                            "Network error during workspace rediscovery - check Docker daemon",
                            container_id=container.id[:12] if container.id else "unknown",
                            error=str(e),
                        )
                    else:
                        logger.exception(
                            "Failed to rediscover workspace container",
                            container_id=container.id[:12] if container.id else "unknown",
                            error=str(e),
                        )

            # Reconcile: Workspaces in Redis but not in containers are stale
            # Mark them as stopped
            stale_count = 0
            for workspace_id, workspace in redis_workspaces.items():
                if workspace.status == WorkspaceStatus.RUNNING:
                    logger.warning(
                        "Workspace in Redis but container not found, marking as stopped",
                        workspace_id=workspace_id,
                    )
                    workspace.status = WorkspaceStatus.STOPPED
                    workspace.metadata["stale_discovery"] = True
                    await self._save_workspace(workspace)
                    stale_count += 1

            # Count rediscovered workspaces
            rediscovered_count = 0
            if self._workspace_store:
                all_workspaces = await self._workspace_store.list_all()
                rediscovered_count = len(
                    [w for w in all_workspaces if w.metadata.get("rediscovered")]
                )

            # Log final summary with failure count
            if failed_count > 0:
                logger.warning(
                    "Workspace discovery completed with errors",
                    rediscovered_count=rediscovered_count,
                    stale_count=stale_count,
                    failed_count=failed_count,
                )
            else:
                logger.info(
                    "Workspace discovery complete",
                    rediscovered_count=rediscovered_count,
                    stale_count=stale_count,
                )
        except Exception:
            logger.exception("Failed to discover existing workspaces")

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

        # Check workspace limit - require workspace store for proper limit enforcement
        if not self._workspace_store:
            logger.error(
                "Workspace store not available, cannot enforce workspace limits",
                workspace_id=workspace_id,
            )
            raise RuntimeError("Workspace store not available - cannot create workspace safely")

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

        # Add git config to environment for entrypoint script
        if config.git_name:
            env_vars["GIT_AUTHOR_NAME"] = config.git_name
            env_vars["GIT_COMMITTER_NAME"] = config.git_name
        if config.git_email:
            env_vars["GIT_AUTHOR_EMAIL"] = config.git_email
            env_vars["GIT_COMMITTER_EMAIL"] = config.git_email

        # Add dotfiles settings for entrypoint script
        env_vars["SYNC_DOTFILES"] = "true" if config.sync_dotfiles else "false"
        if config.dotfiles_paths:
            env_vars["DOTFILES_PATHS"] = ",".join(config.dotfiles_paths)

        # Create local storage directories for per-user volume mount
        # This emulates the GCS bucket structure locally
        user_storage_path = self._local_storage_path / user_id
        dotfiles_path = user_storage_path / "dotfiles"
        workspace_storage_path = user_storage_path / "workspaces" / workspace_id
        dotfiles_path.mkdir(parents=True, exist_ok=True)
        workspace_storage_path.mkdir(parents=True, exist_ok=True)

        logger.debug(
            "Created local storage directories",
            workspace_id=workspace_id,
            user_storage_path=str(user_storage_path),
        )

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

        # Track container for cleanup on failure
        container: Container | None = None

        try:
            # Volume mount for per-user storage (emulates GCS bucket mount)
            volumes = {
                str(user_storage_path): {
                    "bind": "/mnt/gcs",
                    "mode": "rw",
                },
            }

            # Run container with volume mount
            # The entrypoint script handles workspace initialization (symlinks, etc.)
            container = await asyncio.to_thread(
                self.client.containers.run,  # type: ignore[arg-type]
                container_image,
                detach=True,
                name=container_name,
                environment=env_vars,
                labels=labels,
                network=settings.docker_network,
                volumes=volumes,
                **limits,
                # Keep container running - shell waits for input
                stdin_open=True,
                tty=True,
                # Working directory
                working_dir="/home/dev",
            )

            # Ensure container was created successfully
            if container is None:
                raise RuntimeError("Failed to create container")

            # Get container info
            container.reload()
            container_ip = self._get_container_ip(container)

            now = datetime.now(UTC)
            # Generate a secure auth token for workspace API authentication
            auth_token = secrets.token_urlsafe(32) if settings.workspace_auth_enabled else None
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
                auth_token=auth_token,
                metadata={
                    "container_name": container.name or "",
                    "last_billing_timestamp": now.isoformat(),
                    # User preferences (from API)
                    "sync_dotfiles": config.sync_dotfiles,
                    "dotfiles_paths": config.dotfiles_paths,
                },
            )

            await self._save_workspace(workspace_info)

            # With volume mounts, files are directly available - no sync needed
            # The entrypoint script handles symlinks and git config setup
            workspace_info.metadata["storage_mode"] = "volume_mount"
            workspace_info.metadata["user_storage_path"] = str(user_storage_path)

            # Wait for entrypoint to complete before doing any setup
            # The entrypoint creates /home/dev/projects as a symlink to /mnt/gcs/workspaces/...
            # We need to wait for this to avoid race conditions where we clone into a
            # temporary directory that gets replaced by the symlink
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
                    "Entrypoint may not have completed, projects symlink not detected",
                    workspace_id=workspace_id,
                )
                # Fall back to creating projects directory manually
                await self.exec_command(workspace_id, "mkdir -p /home/dev/projects", timeout=10)

            # Git identity is handled by entrypoint script via env vars
            # For custom base images without entrypoint, run setup manually
            if config.base_image and (config.git_name or config.git_email):
                await self._setup_git_identity(workspace_id, config.git_name, config.git_email)

            # Set up GitHub token authentication if GITHUB_TOKEN is in environment
            if config.environment.get("GITHUB_TOKEN"):
                await self._setup_github_token_auth(
                    workspace_id, config.environment["GITHUB_TOKEN"]
                )

            # Clone repos if specified (only if no GCS files were synced)
            if config.repos:
                await self._clone_repos(
                    workspace_id, config.repos, config.git_credentials, config.git_branch
                )

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
        except Exception as e:
            # Clean up container on any failure after container creation
            logger.exception(
                "Workspace creation failed, cleaning up",
                workspace_id=workspace_id,
                error=str(e),
            )
            if container is not None:
                try:
                    await asyncio.to_thread(container.remove, force=True)
                    logger.info(
                        "Cleaned up container after failed workspace creation",
                        workspace_id=workspace_id,
                    )
                except Exception as cleanup_error:
                    logger.warning(
                        "Failed to clean up container after workspace creation failure",
                        workspace_id=workspace_id,
                        cleanup_error=str(cleanup_error),
                    )
            # Also clean up from Redis if it was saved
            try:
                await self._delete_workspace(workspace_id)
            except Exception as redis_cleanup_error:
                logger.debug(
                    "Failed to clean up workspace from Redis during error recovery",
                    workspace_id=workspace_id,
                    error=str(redis_cleanup_error),
                )
            raise

    def _get_container_ip(self, container: Container) -> str | None:
        """Get container IP address on the Docker network."""
        networks = container.attrs.get("NetworkSettings", {}).get("Networks", {})

        # Check if container is on the expected network
        if settings.docker_network not in networks:
            available_networks = list(networks.keys())
            logger.warning(
                "Container not on expected Docker network",
                container_id=container.id[:12] if container.id else "unknown",
                expected_network=settings.docker_network,
                available_networks=available_networks,
            )
            # Try to get IP from any available network as fallback
            for net_name, net_info in networks.items():
                ip = net_info.get("IPAddress")
                if ip:
                    logger.info(
                        "Using IP from fallback network",
                        container_id=container.id[:12] if container.id else "unknown",
                        network=net_name,
                        ip=ip,
                    )
                    return ip
            return None

        network_info = networks.get(settings.docker_network, {})
        ip_address: str | None = network_info.get("IPAddress")

        if not ip_address:
            logger.warning(
                "Container has no IP address on Docker network",
                container_id=container.id[:12] if container.id else "unknown",
                network=settings.docker_network,
            )

        return ip_address

    async def _setup_git_identity(
        self,
        workspace_id: str,
        git_name: str | None,
        git_email: str | None,
    ) -> None:
        """Set up git identity (user.name and user.email) in the workspace.

        HIGH FIX: Uses shlex.quote for proper shell escaping to prevent
        command injection from malicious git name/email values.

        Args:
            workspace_id: The workspace ID
            git_name: Git user.name for commits
            git_email: Git user.email for commits
        """
        try:
            if git_name:
                # HIGH FIX: Use shlex.quote for proper shell escaping
                safe_name = shlex.quote(git_name)
                await self.exec_command(
                    workspace_id,
                    f"git config --global user.name {safe_name}",
                    timeout=10,
                )
                logger.debug("Set git user.name", workspace_id=workspace_id)

            if git_email:
                # HIGH FIX: Use shlex.quote for proper shell escaping
                safe_email = shlex.quote(git_email)
                await self.exec_command(
                    workspace_id,
                    f"git config --global user.email {safe_email}",
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

    async def _setup_github_token_auth(self, workspace_id: str, github_token: str) -> None:
        """Configure git to use GITHUB_TOKEN environment variable for GitHub authentication.

        This sets up a credential helper that reads the token from the GITHUB_TOKEN
        environment variable, enabling git push/pull/fetch operations to GitHub
        without requiring manual authentication.

        Also exports GITHUB_TOKEN in .zshrc and .bashrc so it's available in interactive shells.

        Args:
            workspace_id: The workspace ID.
            github_token: The GitHub access token to use.
        """
        try:
            if not github_token:
                logger.warning(
                    "GITHUB_TOKEN is empty, skipping GitHub auth setup",
                    workspace_id=workspace_id,
                )
                return

            # HIGH FIX: Use base64 encoding to safely pass token without shell escaping issues
            # This prevents command injection from malicious token values
            encoded_token = base64.b64encode(github_token.encode()).decode()

            # Export GITHUB_TOKEN in .zshrc and .bashrc so it's available in interactive shells
            # HIGH FIX: Decode the base64 token in the shell to avoid escaping issues
            export_cmd = f'export GITHUB_TOKEN="$(echo {shlex.quote(encoded_token)} | base64 -d)"'

            # Add to .bashrc if not already present
            bashrc_cmd = (
                f'grep -q "GITHUB_TOKEN" ~/.bashrc 2>/dev/null || '
                f"echo {shlex.quote(export_cmd)} >> ~/.bashrc"
            )
            await self.exec_command(
                workspace_id,
                bashrc_cmd,
                timeout=10,
            )

            # Add to .zshrc if not already present
            zshrc_cmd = (
                f'grep -q "GITHUB_TOKEN" ~/.zshrc 2>/dev/null || '
                f"echo {shlex.quote(export_cmd)} >> ~/.zshrc"
            )
            await self.exec_command(
                workspace_id,
                zshrc_cmd,
                timeout=10,
            )

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
                # Set up git credential helper in container before cloning
                # Use base64 encoding to safely pass credentials without shell escaping issues
                username, token = validated_credentials
                cred_url = f"https://{username}:{token}@github.com"
                encoded_creds = base64.b64encode(cred_url.encode()).decode()
                setup_cmd = (
                    f"git config --global credential.helper store && "
                    f"echo {shlex.quote(encoded_creds)} | base64 -d > ~/.git-credentials && "
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

    async def _stop_container(
        self,
        workspace: Any,
        duration_seconds: int,
    ) -> None:
        """Stop the workspace container and handle post-stop operations."""
        stop_time = datetime.now(UTC)

        try:
            container = await asyncio.to_thread(
                self.client.containers.get,
                workspace.container_id,
            )

            # Stop container with explicit error handling
            try:
                await asyncio.to_thread(container.stop, timeout=10)
            except Exception as stop_error:
                # Container stop failed - check if it's already stopped
                await asyncio.to_thread(container.reload)
                if container.status not in ("exited", "dead", "removing"):
                    logger.error(
                        "Failed to stop container",
                        workspace_id=workspace.id,
                        container_status=container.status,
                        error=str(stop_error),
                    )
                    workspace.status = WorkspaceStatus.ERROR
                    await self._save_workspace(workspace)
                    raise RuntimeError(f"Failed to stop container: {stop_error}") from stop_error
                else:
                    logger.info(
                        "Container already stopped",
                        workspace_id=workspace.id,
                        container_status=container.status,
                    )

            workspace.status = WorkspaceStatus.STOPPED
            workspace.last_activity = stop_time
            await self._save_workspace(workspace)

            # Track compute usage for billing
            if duration_seconds > 0:
                await self._track_compute_usage(workspace, duration_seconds)

            logger.info("Workspace stopped", workspace_id=workspace.id)
        except NotFound:
            logger.warning("Container not found", workspace_id=workspace.id)
            workspace.status = WorkspaceStatus.ERROR
            await self._save_workspace(workspace)

    async def stop_workspace(self, workspace_id: str) -> None:
        """Stop a running workspace container."""
        # Use lock to prevent TOCTOU issues with concurrent stop requests
        async with self._get_workspace_lock(workspace_id):
            workspace = await self._get_workspace(workspace_id)
            if not workspace:
                logger.warning("Workspace not found", workspace_id=workspace_id)
                return

            if not workspace.container_id:
                return

            # Check if already stopped
            if workspace.status == WorkspaceStatus.STOPPED:
                logger.debug("Workspace already stopped", workspace_id=workspace_id)
                return

            # Calculate compute usage duration
            duration_seconds = await self._calculate_compute_duration(workspace)

            # Stop the container (files are auto-persisted via volume mounts)
            await self._stop_container(workspace, duration_seconds)

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

            # Wait for container to be fully running before proceeding
            # container.start() is async - it sends the signal but doesn't wait
            max_wait_seconds = 30
            poll_interval = 0.5
            waited = 0.0
            while waited < max_wait_seconds:
                await asyncio.to_thread(container.reload)
                if container.status == "running":
                    break
                # Check for dead/exited state (won't recover)
                if container.status in ("exited", "dead"):
                    logger.error(
                        "Container failed to start - container exited",
                        workspace_id=workspace_id,
                        container_status=container.status,
                    )
                    workspace.status = WorkspaceStatus.ERROR
                    await self._save_workspace(workspace)
                    raise ValueError(f"Container failed to start: status is {container.status}")
                await asyncio.sleep(poll_interval)
                waited += poll_interval
            else:
                # Timeout - container didn't reach running state
                logger.error(
                    "Container did not reach running state after start",
                    workspace_id=workspace_id,
                    container_status=container.status,
                    waited_seconds=waited,
                )
                workspace.status = WorkspaceStatus.ERROR
                await self._save_workspace(workspace)
                raise ValueError(
                    f"Container failed to start within {max_wait_seconds}s: "
                    f"status is {container.status}"
                )

            workspace.status = WorkspaceStatus.RUNNING
            workspace.last_activity = datetime.now(UTC)
            await self._save_workspace(workspace)

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

        # Handle file cleanup - volume mount mode, files are in local storage
        if not preserve_files:
            # Delete workspace files from local storage
            workspace_storage = (
                self._local_storage_path / workspace.user_id / "workspaces" / workspace_id
            )
            if workspace_storage.exists():
                shutil.rmtree(workspace_storage, ignore_errors=True)
                logger.info(
                    "Deleted workspace local storage",
                    workspace_id=workspace_id,
                    path=str(workspace_storage),
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

            # Create workspace info with new auth token for rediscovered workspace
            now = datetime.now(UTC)
            auth_token = secrets.token_urlsafe(32) if settings.workspace_auth_enabled else None
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
                auth_token=auth_token,
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

    # Note: list_workspaces is inherited from base class

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
                # Verify container is running after restart
                if container.status != "running":
                    logger.error(
                        "Container not running after restart attempt",
                        workspace_id=workspace_id,
                        container_status=container.status,
                    )
                    return WorkspaceExecResponse(
                        exit_code=-1,
                        stdout="",
                        stderr="Container failed to start",
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
        except APIError as e:
            # Handle broken pipe / corrupted container runtime
            error_str = str(e).lower()
            if "broken pipe" in error_str or "not running" in error_str:
                logger.warning(
                    "Container runtime error, container may need recreation",
                    workspace_id=workspace_id,
                    error=str(e)[:200],
                )
                return WorkspaceExecResponse(
                    exit_code=-1,
                    stdout="",
                    stderr="Container runtime error. Please restart the workspace.",
                )
            raise

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

            loop = asyncio.get_running_loop()
            start_time = loop.time()
            buffer = ""

            # Iterate over the output generator
            for stdout_chunk, stderr_chunk in output_generator:
                # Check overall timeout
                elapsed = loop.time() - start_time
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

    # Note: read_file and write_file are inherited from base class

    async def list_files(
        self,
        workspace_id: str,
        path: str = ".",
    ) -> list[dict[str, str]]:
        """List files in a workspace directory."""
        # Escape path to prevent command injection
        safe_path = shlex.quote(path)
        # Use -L to follow symlinks so symlinks to directories show as directories
        result = await self.exec_command(
            workspace_id,
            f"ls -laL {safe_path} | tail -n +2",  # Skip "total" line
        )
        if result.exit_code != 0:
            return []

        files = []
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            parts = line.split()
            if len(parts) >= MIN_LS_PARTS:
                name = " ".join(parts[8:])
                file_type = "directory" if parts[0].startswith("d") else "file"

                files.append(
                    {
                        "name": name,
                        "type": file_type,
                        "size": parts[4],
                        "permissions": parts[0],
                    }
                )

        return files

    # Note: heartbeat and cleanup_idle_workspaces are inherited from base class

    async def check_workspace_health(self, workspace_id: str) -> bool:  # noqa: PLR0911
        """Check if a workspace container is healthy and running.

        Returns True if the container is running and can execute commands.
        Updates workspace status if the container is in a bad state.
        """
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            return False

        if not workspace.container_id:
            return False

        try:
            container = await asyncio.to_thread(
                self.client.containers.get,
                workspace.container_id,
            )

            # Check container status
            if container.status != "running":
                logger.warning(
                    "Workspace container not running",
                    workspace_id=workspace_id,
                    container_status=container.status,
                )
                workspace.status = WorkspaceStatus.STOPPED
                await self._save_workspace(workspace)
                # Notify API of status change
                await sync_workspace_status_to_api(
                    workspace_id=workspace_id,
                    status="stopped",
                    container_id=workspace.container_id,
                )
                return False

            # Try a simple command to verify container runtime is working
            try:
                exec_result = await asyncio.wait_for(
                    asyncio.to_thread(
                        container.exec_run,
                        cmd=["echo", "health"],
                        timeout=5,
                    ),
                    timeout=10.0,
                )
                if exec_result.exit_code != 0:
                    logger.warning(
                        "Workspace container health check failed",
                        workspace_id=workspace_id,
                        exit_code=exec_result.exit_code,
                    )
                    return False
            except (TimeoutError, APIError) as e:
                logger.warning(
                    "Workspace container health check timed out or failed",
                    workspace_id=workspace_id,
                    error=str(e)[:100],
                )
                workspace.status = WorkspaceStatus.ERROR
                await self._save_workspace(workspace)
                await sync_workspace_status_to_api(
                    workspace_id=workspace_id,
                    status="error",
                    container_id=workspace.container_id,
                )
                return False

            return True

        except NotFound:
            logger.warning(
                "Workspace container not found during health check",
                workspace_id=workspace_id,
            )
            workspace.status = WorkspaceStatus.ERROR
            await self._save_workspace(workspace)
            return False

    # Note: check_all_workspaces_health is inherited from base class

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
            # Use shared HTTP client with connection pooling
            client = await self._get_http_client()
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

            # Inject DevTools bridge script into HTML responses
            content_type = response_headers.get("content-type", "")
            response_body = inject_devtools_script(response.content, content_type)

            # Update content-length if script was injected
            if len(response_body) != len(response.content):
                response_headers["content-length"] = str(len(response_body))

            return response.status_code, response_headers, response_body

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

    async def scale_workspace(  # noqa: PLR0912, PLR0915
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

        # Use lock to prevent concurrent scaling operations
        async with self._get_workspace_lock(workspace_id):
            # Store old workspace data for rollback
            old_container_id = workspace.container_id
            old_metadata = workspace.metadata.copy()
            session_id = workspace.session_id
            user_id = workspace.user_id

            try:
                # With volume mounts, dotfiles are already persisted - no sync needed

                # Step 1: Stop the current workspace (but keep Redis data)
                if old_container_id:
                    try:
                        container = await asyncio.to_thread(
                            self.client.containers.get,
                            old_container_id,
                        )
                        await asyncio.to_thread(container.stop, timeout=10)
                    except NotFound:
                        pass  # Container already gone
                    except Exception as e:
                        logger.warning(
                            "Failed to stop old container during scaling",
                            workspace_id=workspace_id,
                            error=str(e),
                        )

                # Step 2: Create new workspace config with the new tier
                new_config = WorkspaceConfig(tier=new_tier)

                # Copy over important config from workspace metadata if available
                if "git_name" in old_metadata:
                    new_config.git_name = old_metadata["git_name"]
                if "git_email" in old_metadata:
                    new_config.git_email = old_metadata["git_email"]
                if "sync_dotfiles" in old_metadata:
                    new_config.sync_dotfiles = old_metadata["sync_dotfiles"]
                if "dotfiles_paths" in old_metadata:
                    new_config.dotfiles_paths = old_metadata["dotfiles_paths"]

                # Step 3: Remove the old container only (keep Redis for now)
                if old_container_id:
                    try:
                        container = await asyncio.to_thread(
                            self.client.containers.get,
                            old_container_id,
                        )
                        await asyncio.to_thread(container.remove, force=True)
                    except NotFound:
                        pass

                # Step 4: Create new workspace with the same ID but new tier
                # This will update Redis on success
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
                    if "git_name" in old_metadata:
                        original_config.git_name = old_metadata["git_name"]
                    if "git_email" in old_metadata:
                        original_config.git_email = old_metadata["git_email"]
                    if "sync_dotfiles" in old_metadata:
                        original_config.sync_dotfiles = old_metadata["sync_dotfiles"]
                    if "dotfiles_paths" in old_metadata:
                        original_config.dotfiles_paths = old_metadata["dotfiles_paths"]

                    await self.create_workspace(
                        user_id=user_id,
                        session_id=session_id,
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
