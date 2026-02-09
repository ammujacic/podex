"""Multi-server compute manager implementing ComputeManager interface.

This adapter wraps the WorkspaceOrchestrator to provide the ComputeManager
interface expected by routes, while using the multi-server Docker backend.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any

import httpx
import structlog

from podex_shared import ComputeUsageParams, get_usage_tracker
from src.managers.base import ComputeManager, ProxyRequest
from src.managers.hardware_specs_provider import get_hardware_specs_provider
from src.middleware.script_injector import inject_devtools_script
from src.models.workspace import (
    WorkspaceConfig,
    WorkspaceExecResponse,
    WorkspaceInfo,
    WorkspaceScaleResponse,
    WorkspaceStatus,
)
from src.utils.task_lock import release_task_lock, try_acquire_task_lock

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    from src.managers.multi_server_docker import MultiServerDockerManager
    from src.managers.workspace_orchestrator import WorkspaceOrchestrator
    from src.storage.workspace_store import WorkspaceStore

logger = structlog.get_logger()


class MultiServerComputeManager(ComputeManager):
    """Multi-server compute manager that uses WorkspaceOrchestrator internally.

    This class implements the ComputeManager interface required by routes,
    while delegating actual work to the WorkspaceOrchestrator and
    MultiServerDockerManager for multi-server support.
    """

    def __init__(
        self,
        orchestrator: WorkspaceOrchestrator,
        docker_manager: MultiServerDockerManager,
        workspace_store: WorkspaceStore | None = None,
    ) -> None:
        """Initialize the multi-server compute manager.

        Args:
            orchestrator: The workspace orchestrator for lifecycle management
            docker_manager: The multi-server Docker manager
            workspace_store: Optional workspace persistence store
        """
        self._orchestrator = orchestrator
        self._docker = docker_manager
        self._workspace_store = workspace_store
        self._http_client: httpx.AsyncClient | None = None

        logger.info(
            "MultiServerComputeManager initialized",
            has_workspace_store=workspace_store is not None,
            server_count=len(docker_manager.servers),
        )

    @property
    def managed_server_ids(self) -> set[str]:
        """Return the set of server IDs this compute instance manages."""
        return set(self._docker.servers.keys())

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

    async def create_workspace(
        self,
        user_id: str,
        session_id: str,
        config: WorkspaceConfig,
        workspace_id: str | None = None,
    ) -> WorkspaceInfo:
        """Create a new workspace using the orchestrator."""
        # Extract region preference for strict placement enforcement
        required_region = getattr(config, "region_preference", None)

        result = await self._orchestrator.create_workspace(
            user_id=user_id,
            session_id=session_id,
            config=config,
            workspace_id=workspace_id,
            required_region=required_region,
        )

        if not result.success:
            raise RuntimeError(result.message)

        # Fetch the workspace info from store
        workspace = await self._get_workspace(result.workspace_id or "")
        if not workspace:
            raise RuntimeError(f"Workspace created but not found: {result.workspace_id}")

        return workspace

    async def stop_workspace(self, workspace_id: str) -> None:
        """Stop a running workspace."""
        result = await self._orchestrator.stop_workspace(workspace_id)
        if not result.success:
            logger.warning(
                "Failed to stop workspace",
                workspace_id=workspace_id,
                message=result.message,
            )

    async def restart_workspace(self, workspace_id: str) -> None:
        """Restart a stopped workspace."""
        result = await self._orchestrator.start_workspace(workspace_id)
        if not result.success:
            raise ValueError(result.message)

    async def delete_workspace(self, workspace_id: str, preserve_files: bool = True) -> None:
        """Delete a workspace and clean up resources."""
        result = await self._orchestrator.delete_workspace(
            workspace_id,
            preserve_data=preserve_files,
        )
        if not result.success:
            logger.warning(
                "Failed to delete workspace",
                workspace_id=workspace_id,
                message=result.message,
            )

    async def cleanup_orphaned_directories(self) -> list[str]:
        """Clean up workspace directories that have no corresponding Redis entry.

        This handles cases where:
        - The Redis entry was deleted but directory removal failed
        - The stale cleanup removed Redis entries without directory cleanup

        Returns:
            List of workspace IDs whose directories were cleaned up
        """
        cleaned_up = []
        managed_servers = self.managed_server_ids

        # Get all known workspace IDs from Redis
        known_workspaces: set[str] = set()
        if self._workspace_store:
            workspaces = await self._workspace_store.list_all()
            known_workspaces = {ws.id for ws in workspaces}

        # Check each managed server for orphaned directories
        for server_id in managed_servers:
            try:
                dir_ids = await self._docker.list_workspace_directories(server_id)
                orphaned = [d for d in dir_ids if d not in known_workspaces]

                if orphaned:
                    logger.info(
                        "Found orphaned workspace directories",
                        server_id=server_id,
                        count=len(orphaned),
                    )

                for workspace_id in orphaned:
                    try:
                        await self._docker.remove_workspace_directory(server_id, workspace_id)
                        cleaned_up.append(workspace_id)
                        logger.info(
                            "Removed orphaned workspace directory",
                            workspace_id=workspace_id[:12],
                            server_id=server_id,
                        )
                    except Exception:
                        logger.exception(
                            "Failed to remove orphaned workspace directory",
                            workspace_id=workspace_id[:12],
                            server_id=server_id,
                        )
            except Exception:
                logger.exception(
                    "Failed to list workspace directories on server",
                    server_id=server_id,
                )

        return cleaned_up

    async def get_workspace(self, workspace_id: str) -> WorkspaceInfo | None:
        """Get workspace information."""
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            return None

        # Sync status with actual container if we have server/container info
        if workspace.server_id and workspace.container_id:
            try:
                container_info = await self._docker.get_container_status(
                    workspace.server_id,
                    workspace.container_id,
                )
                if container_info:
                    container_status = container_info.get("status", "")
                    if container_status == "running":
                        workspace.status = WorkspaceStatus.RUNNING
                    elif container_status in ("exited", "stopped"):
                        workspace.status = WorkspaceStatus.STOPPED
                    elif container_status in ("dead", "removing"):
                        workspace.status = WorkspaceStatus.ERROR
                    await self._save_workspace(workspace)
            except Exception:
                logger.exception(
                    "Failed to sync workspace status with container",
                    workspace_id=workspace_id,
                )

        return workspace

    async def exec_command(
        self,
        workspace_id: str,
        command: str,
        working_dir: str | None = None,
        timeout: int = 30,
    ) -> WorkspaceExecResponse:
        """Execute a command in the workspace container."""
        return await self._orchestrator.exec_command(
            workspace_id=workspace_id,
            command=command,
            working_dir=working_dir,
            timeout=timeout,
        )

    async def exec_command_stream(
        self,
        workspace_id: str,
        command: str,
        working_dir: str | None = None,
        timeout: int = 60,
    ) -> AsyncGenerator[str, None]:
        """Execute a command and stream output chunks.

        This implementation uses the non-streaming exec and yields the full output.
        A future enhancement could add proper streaming support.
        """
        result = await self.exec_command(workspace_id, command, working_dir, timeout)
        if result.stdout:
            yield result.stdout
        if result.stderr:
            yield result.stderr

    async def check_workspace_health(self, workspace_id: str) -> bool:
        """Check if a workspace is healthy and can execute commands."""
        return await self._orchestrator.check_workspace_health(workspace_id)

    async def get_preview_url(self, workspace_id: str, port: int) -> str | None:
        """Get the URL to access a dev server running in the workspace."""
        workspace = await self._get_workspace(workspace_id)
        if not workspace or workspace.status != WorkspaceStatus.RUNNING:
            return None

        # The workspace host is the server where the container runs
        # For multi-server setup, we need to route through the server
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

        # Build target URL using workspace host
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
            server_id=workspace.server_id,
            port=request.port,
            method=request.method,
            path=request.path,
        )

        try:
            client = await self._get_http_client()
            response = await client.request(
                method=request.method,
                url=target_url,
                headers=filtered_headers,
                content=request.body,
                follow_redirects=False,
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

    async def track_running_workspaces_usage(self) -> None:
        """Track compute usage for all running workspaces.

        Uses distributed locking to prevent duplicate billing across instances.
        """
        # Distributed lock to prevent duplicate billing from multiple instances
        if not await try_acquire_task_lock("billing_usage_tracking", ttl_seconds=120):
            logger.debug("Another instance is handling usage tracking, skipping")
            return

        try:
            now = datetime.now(UTC)

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
                        continue

                    last_billing = datetime.fromisoformat(last_billing_str)
                    if last_billing.tzinfo is None:
                        last_billing = last_billing.replace(tzinfo=UTC)

                    duration = (now - last_billing).total_seconds()
                    if duration <= 0:
                        workspace.metadata["last_billing_timestamp"] = now.isoformat()
                        await self._save_workspace(workspace)
                        continue

                    # Track if at least 10 minutes have passed
                    if duration >= 600:
                        duration_seconds = int(duration)
                        old_timestamp = workspace.metadata.get("last_billing_timestamp")
                        workspace.metadata["last_billing_timestamp"] = now.isoformat()

                        try:
                            await self._track_compute_usage(workspace, duration_seconds)
                            await self._save_workspace(workspace)
                        except Exception:
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
        finally:
            await release_task_lock("billing_usage_tracking")

    async def _track_compute_usage(
        self,
        workspace: WorkspaceInfo,
        duration_seconds: int,
    ) -> None:
        """Track compute usage for billing.

        Note: Only usage data (tier, duration) is sent. The API calculates
        pricing server-side based on the tier's hourly rate in the database.
        """
        tracker = get_usage_tracker()
        if not tracker:
            return

        try:
            params = ComputeUsageParams(
                user_id=workspace.user_id,
                tier=workspace.tier,
                duration_seconds=duration_seconds,
                session_id=workspace.session_id,
                workspace_id=workspace.id,
                metadata={
                    "container_id": workspace.container_id,
                    "server_id": workspace.server_id,
                },
            )
            await tracker.record_compute_usage(params)
        except Exception:
            logger.exception("Failed to track compute usage")

    async def scale_workspace(
        self,
        workspace_id: str,
        new_tier: str,
    ) -> WorkspaceScaleResponse:
        """Scale a workspace to a new compute tier.

        Live scaling: Updates CPU, memory, bandwidth, and disk quota without
        stopping the container. Same-server only - fails if current server
        doesn't have capacity for the new tier.
        """
        from src.managers.workspace_orchestrator import get_tier_requirements  # noqa: PLC0415

        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            raise ValueError(f"Workspace {workspace_id} not found")

        old_tier = workspace.tier
        server_id = workspace.server_id

        if not server_id:
            raise ValueError("Workspace has no server assignment")

        provider = get_hardware_specs_provider()

        if old_tier == new_tier:
            spec = await provider.get_spec(new_tier)
            hourly_rate = Decimal(spec.hourly_rate_cents) / 100 if spec else None
            return WorkspaceScaleResponse(
                success=False,
                message=f"Workspace is already on {new_tier} tier",
                new_tier=new_tier,
                estimated_cost_per_hour=hourly_rate,
            )

        # Get current and new requirements
        old_requirements = await get_tier_requirements(old_tier)
        new_requirements = await get_tier_requirements(new_tier)

        # Check capacity on CURRENT server only (same-server scaling)
        capacities = await self._orchestrator.get_server_capacities()
        server_capacity = next((c for c in capacities if c.server_id == server_id), None)

        if not server_capacity:
            raise ValueError(f"Server {server_id} not found or unhealthy")

        # Calculate delta (how much MORE we need)
        delta_cpu = new_requirements.cpu - old_requirements.cpu
        delta_memory = new_requirements.memory_mb - old_requirements.memory_mb
        delta_disk = new_requirements.disk_gb - old_requirements.disk_gb

        # Check if server can fit the delta
        can_fit = (
            server_capacity.available_cpu >= delta_cpu
            and server_capacity.available_memory_mb >= delta_memory
            and server_capacity.available_disk_gb >= delta_disk
        )

        if not can_fit:
            return WorkspaceScaleResponse(
                success=False,
                message=f"Insufficient capacity on server {server_id} for {new_tier} tier",
                new_tier=new_tier,
            )

        logger.info(
            "Live scaling workspace",
            workspace_id=workspace_id[:12],
            old_tier=old_tier,
            new_tier=new_tier,
            server_id=server_id,
        )

        try:
            container_id = workspace.container_id
            if not container_id:
                raise ValueError("Workspace has no container")

            # Scale CPU and memory (live via docker update)
            await self._docker.update_container(
                server_id=server_id,
                container_id=container_id,
                cpu_limit=new_requirements.cpu,
                memory_limit_mb=new_requirements.memory_mb,
            )

            # Scale bandwidth (live via tc)
            await self._docker.apply_bandwidth_limit(
                server_id=server_id,
                container_id=container_id,
                bandwidth_mbps=new_requirements.bandwidth_mbps,
            )

            # Scale disk quota (live via xfs_quota)
            await self._docker.update_xfs_quota(
                server_id=server_id,
                workspace_id=workspace_id,
                storage_gb=new_requirements.disk_gb,
            )

            # Update workspace metadata
            workspace.tier = new_tier
            await self._save_workspace(workspace)

            spec = await provider.get_spec(new_tier)
            hourly_rate = Decimal(spec.hourly_rate_cents) / 100 if spec else None

            return WorkspaceScaleResponse(
                success=True,
                message=f"Successfully scaled workspace to {new_tier} tier",
                new_tier=new_tier,
                estimated_cost_per_hour=hourly_rate,
                requires_restart=False,  # Live scaling!
            )

        except Exception as e:
            logger.exception(
                "Failed to scale workspace",
                workspace_id=workspace_id,
                error=str(e),
            )
            raise ValueError(f"Failed to scale workspace: {e}") from e

    async def discover_existing_workspaces(self) -> None:
        """Discover and re-register existing workspace containers.

        For multi-server setup, this queries all registered servers for
        workspace containers.
        """
        try:
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
                        "Failed to load workspaces from Redis",
                        error=str(e),
                    )

            # Query all servers for workspace containers
            rediscovered_count = 0
            for server_id in self._docker.servers:
                try:
                    containers = await self._docker.list_containers(
                        server_id,
                        filters={"label": "podex.workspace=true"},
                    )

                    for container in containers:
                        workspace_id = container.get("labels", {}).get("podex.workspace_id")
                        if workspace_id:
                            redis_workspaces.pop(workspace_id, None)
                            rediscovered_count += 1

                except Exception:
                    logger.exception(
                        "Failed to discover containers on server",
                        server_id=server_id,
                    )

            # Mark stale workspaces as stopped
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

            logger.info(
                "Workspace discovery complete",
                rediscovered_count=rediscovered_count,
                stale_count=stale_count,
            )

        except Exception:
            logger.exception("Failed to discover existing workspaces")

    async def get_cluster_status(self) -> dict[str, Any]:
        """Get overall cluster status including all servers."""
        return await self._orchestrator.get_cluster_status()

    # --- Tunnel Management Methods ---

    async def start_tunnel(
        self,
        workspace_id: str,
        token: str,
        port: int,
        service_type: str = "http",
    ) -> dict[str, Any]:
        """Start cloudflared tunnel inside the workspace container."""
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            raise ValueError(f"Workspace {workspace_id} not found")

        if not workspace.container_id or not workspace.server_id:
            raise ValueError(f"Workspace {workspace_id} has no container/server")

        # Build cloudflared command based on service type
        if service_type == "ssh":
            # SSH tunnels: config managed via Cloudflare API
            cmd = f"cloudflared tunnel run --token {token}"
        else:
            # HTTP tunnels: use --url flag for local service
            cmd = f"cloudflared tunnel run --token {token} --url http://localhost:{port}"

        # Start cloudflared in background, capture PID
        # Use nohup and redirect output to avoid blocking
        full_cmd = f"nohup {cmd} > /tmp/cloudflared-{port}.log 2>&1 & echo $!"

        _exit_code, stdout, _stderr = await self._docker.run_in_container(
            workspace.server_id,
            workspace.container_id,
            full_cmd,
        )

        stdout = stdout.strip()
        try:
            pid = int(stdout)
            logger.info(
                "Started cloudflared tunnel",
                workspace_id=workspace_id,
                port=port,
                service_type=service_type,
                pid=pid,
            )
            return {"status": "running", "pid": pid}
        except ValueError:
            return {"status": "error", "error": f"Failed to get PID: {stdout}"}

    async def stop_tunnel(
        self,
        workspace_id: str,
        port: int,
    ) -> dict[str, Any]:
        """Stop cloudflared tunnel by killing the process."""
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            raise ValueError(f"Workspace {workspace_id} not found")

        if not workspace.container_id or not workspace.server_id:
            raise ValueError(f"Workspace {workspace_id} has no container/server")

        # Find and kill cloudflared process for this port
        # Use pkill with pattern matching on the port argument
        cmd = f"pkill -f 'cloudflared.*localhost:{port}' || pkill -f 'cloudflared.*--token' || true"

        await self._docker.run_in_container(
            workspace.server_id,
            workspace.container_id,
            cmd,
        )

        logger.info("Stopped cloudflared tunnel", workspace_id=workspace_id, port=port)
        return {"status": "stopped"}

    async def get_tunnel_status(
        self,
        workspace_id: str,
    ) -> dict[str, Any]:
        """Get status of cloudflared processes in container."""
        workspace = await self._get_workspace(workspace_id)
        if not workspace:
            raise ValueError(f"Workspace {workspace_id} not found")

        if not workspace.container_id or not workspace.server_id:
            return {"status": "error", "error": "No container/server"}

        # Check for running cloudflared processes
        cmd = "pgrep -a cloudflared || echo 'none'"

        _exit_code, stdout, _stderr = await self._docker.run_in_container(
            workspace.server_id,
            workspace.container_id,
            cmd,
        )

        stdout = stdout.strip()
        if stdout == "none" or not stdout:
            return {"status": "stopped", "processes": []}

        # Parse process list
        processes = []
        for line in stdout.split("\n"):
            if line.strip():
                parts = line.split(None, 1)
                if len(parts) >= 2:
                    processes.append({"pid": int(parts[0]), "cmd": parts[1]})

        return {"status": "running", "processes": processes}
