"""Docker-based compute manager for local development."""

from __future__ import annotations

import asyncio
import base64
import re
import shlex
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

import docker
import httpx
import structlog
from docker.errors import ContainerError, ImageNotFound, NotFound

from podex_shared import ComputeUsageParams, get_usage_tracker
from podex_shared.models.workspace import HARDWARE_SPECS
from podex_shared.models.workspace import WorkspaceTier as SharedTier
from src.config import settings
from src.managers.base import ComputeManager, ProxyRequest
from src.models.workspace import (
    WorkspaceConfig,
    WorkspaceExecResponse,
    WorkspaceInfo,
    WorkspaceStatus,
    WorkspaceTier,
)

if TYPE_CHECKING:
    from docker.models.containers import Container

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

    def __init__(self) -> None:
        """Initialize Docker client and workspace tracking."""
        self.client = docker.from_env()
        self._workspaces: dict[str, WorkspaceInfo] = {}
        self._warm_pool: list[Container] = []
        self._file_sync: FileSync | None = None
        logger.info(
            "DockerComputeManager initialized",
            docker_host=settings.docker_host,
            workspace_image=settings.workspace_image,
        )

    def set_file_sync(self, file_sync: FileSync) -> None:
        """Set the file sync service for S3 synchronization."""
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
        active_count = len(
            [w for w in self._workspaces.values() if w.status == WorkspaceStatus.RUNNING]
        )
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
            container: Container = await asyncio.to_thread(  # type: ignore[arg-type]
                self.client.containers.run,
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
                created_at=datetime.now(UTC),
                last_activity=datetime.now(UTC),
                metadata={"container_name": container.name or ""},
            )

            self._workspaces[workspace_id] = workspace_info

            # Sync files from S3 (restore workspace state)
            if self._file_sync:
                try:
                    await self._file_sync.sync_from_s3(workspace_id)
                    # Start background sync
                    await self._file_sync.start_background_sync(workspace_id)
                    workspace_info.metadata["s3_sync_status"] = "success"
                except Exception as e:
                    logger.exception(
                        "Failed to sync files from S3",
                        workspace_id=workspace_id,
                    )
                    # Store sync error in metadata for visibility
                    workspace_info.metadata["s3_sync_status"] = "error"
                    workspace_info.metadata["s3_sync_error"] = str(e)

            # Ensure projects directory exists
            await self.exec_command(workspace_id, "mkdir -p /home/dev/projects", timeout=10)

            # Clone repos if specified (only if no S3 files were synced)
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

    async def stop_workspace(self, workspace_id: str) -> None:
        """Stop a running workspace container."""
        workspace = self._workspaces.get(workspace_id)
        if not workspace:
            logger.warning("Workspace not found", workspace_id=workspace_id)
            return

        if not workspace.container_id:
            return

        # Calculate compute usage before stopping
        stop_time = datetime.now(UTC)
        duration_seconds = int((stop_time - workspace.created_at).total_seconds())

        # Sync files to S3 before stopping (stop background sync first)
        sync_error: Exception | None = None
        if self._file_sync:
            try:
                await self._file_sync.stop_background_sync(workspace_id)
                await self._file_sync.sync_to_s3(workspace_id)
                workspace.metadata["s3_sync_status"] = "success"
            except Exception as e:
                logger.exception(
                    "Failed to sync files to S3 before stop",
                    workspace_id=workspace_id,
                )
                # Store sync error - this is important as data may be lost
                workspace.metadata["s3_sync_status"] = "error"
                workspace.metadata["s3_sync_error"] = str(e)
                sync_error = e

        try:
            container = await asyncio.to_thread(
                self.client.containers.get,
                workspace.container_id,
            )
            await asyncio.to_thread(container.stop, timeout=10)

            workspace.status = WorkspaceStatus.STOPPED
            workspace.last_activity = stop_time

            # Track compute usage for billing
            await self._track_compute_usage(workspace, duration_seconds)

            # Warn if sync failed but stop succeeded
            if sync_error:
                logger.warning(
                    "Workspace stopped but S3 sync failed - data may be lost",
                    workspace_id=workspace_id,
                )
            else:
                logger.info("Workspace stopped", workspace_id=workspace_id)
        except NotFound:
            logger.warning("Container not found", workspace_id=workspace_id)
            workspace.status = WorkspaceStatus.ERROR

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

    async def delete_workspace(self, workspace_id: str, preserve_files: bool = True) -> None:
        """Delete a workspace and its container.

        Args:
            workspace_id: The workspace to delete
            preserve_files: If True, sync to S3 before deletion. If False, also delete S3 files.
        """
        workspace = self._workspaces.get(workspace_id)
        if not workspace:
            return

        # Sync files to S3 before deletion
        if self._file_sync:
            try:
                await self._file_sync.stop_background_sync(workspace_id)
                if preserve_files:
                    await self._file_sync.sync_to_s3(workspace_id)
                else:
                    # Optionally delete S3 files too
                    await self._file_sync.delete_workspace_files(workspace_id)
            except Exception:
                logger.exception(
                    "Failed to handle S3 files before delete",
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

        del self._workspaces[workspace_id]

    async def get_workspace(self, workspace_id: str) -> WorkspaceInfo | None:
        """Get workspace information."""
        workspace = self._workspaces.get(workspace_id)
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
            except NotFound:
                workspace.status = WorkspaceStatus.ERROR

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
        timeout: int = 30,  # noqa: ARG002
    ) -> WorkspaceExecResponse:
        """Execute a command in the workspace container."""
        workspace = self._workspaces.get(workspace_id)
        if not workspace or not workspace.container_id:
            msg = f"Workspace {workspace_id} not found"
            raise ValueError(msg)

        try:
            container = await asyncio.to_thread(
                self.client.containers.get,
                workspace.container_id,
            )

            # Execute command
            exec_result = await asyncio.to_thread(
                container.exec_run,
                cmd=["bash", "-c", command],
                workdir=working_dir or "/home/dev",
                demux=True,  # Separate stdout/stderr
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
                    "Cleaning up idle workspace",
                    workspace_id=workspace_id,
                    idle_seconds=idle_time,
                )
                await self.delete_workspace(workspace_id)
                cleaned_up.append(workspace_id)

        return cleaned_up

    async def warm_pool_fill(self) -> None:
        """Fill the warm pool with pre-created containers."""
        current_size = len(self._warm_pool)
        needed = settings.warm_pool_size - current_size

        if needed <= 0:
            return

        logger.info("Filling warm pool", needed=needed, current=current_size)

        for _ in range(needed):
            try:
                container: Container = await asyncio.to_thread(  # type: ignore[arg-type]
                    self.client.containers.run,
                    settings.workspace_image,
                    detach=True,
                    name=f"podex-warm-{uuid.uuid4().hex[:8]}",
                    labels={"podex.warm_pool": "true"},
                    network=settings.docker_network,
                    **self._get_resource_limits(WorkspaceTier.STARTER),
                    stdin_open=True,
                    tty=True,
                )
                self._warm_pool.append(container)
            except Exception:
                logger.exception("Failed to create warm pool container")
                break

    async def warm_pool_get(self) -> Container | None:
        """Get a container from the warm pool."""
        if not self._warm_pool:
            return None
        return self._warm_pool.pop(0)

    async def get_preview_url(self, workspace_id: str, port: int) -> str | None:
        """Get the URL to access a dev server running in the workspace.

        For Docker, returns the container's internal IP on the Docker network.
        """
        workspace = self._workspaces.get(workspace_id)
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
        workspace = self._workspaces.get(request.workspace_id)
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
        workspace = self._workspaces.get(workspace_id)
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
