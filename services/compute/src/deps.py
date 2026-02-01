"""Dependency injection for compute service."""

import asyncio
import contextlib
import secrets
from typing import Annotated, Any

import httpx
import structlog
from fastapi import Depends, Header, HTTPException, status

from src.config import settings
from src.managers.base import ComputeManager
from src.managers.multi_server_compute_manager import MultiServerComputeManager
from src.managers.multi_server_docker import MultiServerDockerManager
from src.managers.placement import PlacementService
from src.managers.workspace_orchestrator import WorkspaceOrchestrator
from src.storage.workspace_store import WorkspaceStore

logger = structlog.get_logger()


def validate_internal_auth(
    x_internal_service_token: str | None = None,
    authorization: str | None = None,
) -> None:
    """Validate internal service-to-service authentication.

    Validates token in X-Internal-Service-Token header or Authorization: Bearer header.

    SECURITY: Token is always required - no bypass for development mode.

    Args:
        x_internal_service_token: Service token header
        authorization: Bearer token header (alternative)
    """
    if not settings.internal_service_token:
        # SECURITY: Fail closed - if no token configured, reject all requests
        logger.error("INTERNAL_SERVICE_TOKEN not configured - rejecting request")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Service authentication not configured",
        )

    # Extract token from either header
    token = None
    if x_internal_service_token:
        token = x_internal_service_token
    elif authorization and authorization.startswith("Bearer "):
        token = authorization[7:]

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing service token",
        )

    # SECURITY: Use constant-time comparison to prevent timing attacks
    if not secrets.compare_digest(token, settings.internal_service_token):
        logger.warning("Invalid internal service token received")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid service token",
        )

    logger.debug("Request authenticated via service token")


def verify_internal_auth(
    x_internal_service_token: Annotated[
        str | None, Header(alias="X-Internal-Service-Token")
    ] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """Verify internal service-to-service authentication.

    Supports dual-mode authentication:
    - Bearer token in Authorization header
    - Token in X-Internal-Service-Token header
    """
    validate_internal_auth(x_internal_service_token, authorization)


def get_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-ID")] = None,
) -> str:
    """Extract user ID from internal request header.

    The API service must pass the authenticated user's ID in this header.
    """
    if not x_user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing user ID header",
        )
    return x_user_id


# Type alias for authenticated user dependency
AuthenticatedUser = Annotated[str, Depends(get_user_id)]

# Dependency that verifies internal service auth (supports both API key and IAM)
InternalAuth = Annotated[None, Depends(verify_internal_auth)]


class OrchestratorSingleton:
    """Singleton holder for the workspace orchestrator instance."""

    _orchestrator: WorkspaceOrchestrator | None = None
    _docker_manager: MultiServerDockerManager | None = None
    _workspace_store: WorkspaceStore | None = None
    _placement_service: PlacementService | None = None
    _compute_manager: MultiServerComputeManager | None = None

    @classmethod
    def get_workspace_store(cls) -> WorkspaceStore:
        """Get or create the workspace store instance."""
        if cls._workspace_store is None:
            cls._workspace_store = WorkspaceStore()
        return cls._workspace_store

    @classmethod
    def get_docker_manager(cls) -> MultiServerDockerManager:
        """Get or create the multi-server Docker manager."""
        if cls._docker_manager is None:
            cls._docker_manager = MultiServerDockerManager()
        return cls._docker_manager

    @classmethod
    def get_placement_service(cls) -> PlacementService:
        """Get or create the placement service."""
        if cls._placement_service is None:
            cls._placement_service = PlacementService()
        return cls._placement_service

    @classmethod
    def get_orchestrator(cls) -> WorkspaceOrchestrator:
        """Get or create the workspace orchestrator."""
        if cls._orchestrator is None:
            cls._orchestrator = WorkspaceOrchestrator(
                docker_manager=cls.get_docker_manager(),
                workspace_store=cls.get_workspace_store(),
                placement_service=cls.get_placement_service(),
            )
        return cls._orchestrator

    @classmethod
    def get_compute_manager(cls) -> MultiServerComputeManager:
        """Get or create the multi-server compute manager.

        This provides the ComputeManager interface expected by routes,
        backed by the orchestrator for multi-server support.
        """
        if cls._compute_manager is None:
            cls._compute_manager = MultiServerComputeManager(
                orchestrator=cls.get_orchestrator(),
                docker_manager=cls.get_docker_manager(),
                workspace_store=cls.get_workspace_store(),
            )
        return cls._compute_manager

    @classmethod
    def clear_instance(cls) -> None:
        """Clear the singleton instances."""
        cls._orchestrator = None
        cls._docker_manager = None
        cls._workspace_store = None
        cls._placement_service = None
        cls._compute_manager = None


def get_orchestrator() -> WorkspaceOrchestrator:
    """Get the workspace orchestrator instance."""
    return OrchestratorSingleton.get_orchestrator()


def get_docker_manager() -> MultiServerDockerManager:
    """Get the multi-server Docker manager instance."""
    return OrchestratorSingleton.get_docker_manager()


def get_compute_manager() -> ComputeManager:
    """Get the compute manager instance.

    Returns a ComputeManager that uses the multi-server orchestrator backend.
    This is the primary interface used by workspace routes.
    """
    return OrchestratorSingleton.get_compute_manager()


# Background task handle for server sync
_server_sync_task: asyncio.Task[None] | None = None


async def fetch_servers_from_api() -> list[dict[str, Any]]:
    """Fetch workspace servers from API service.

    Returns list of server configurations from the API's internal endpoint.
    """
    if not settings.internal_service_token:
        logger.warning("No internal service token configured, cannot fetch servers from API")
        return []

    try:
        # Build query params with optional region filter
        params: dict[str, str] = {}
        if settings.compute_region:
            params["region"] = settings.compute_region

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{settings.api_base_url}/api/servers/internal/list",
                headers={"X-Internal-Service-Token": settings.internal_service_token},
                params=params,
                timeout=10.0,
            )
            response.raise_for_status()
            data: list[dict[str, Any]] = response.json()
            return data
    except httpx.HTTPStatusError as e:
        logger.error(
            "Failed to fetch servers from API",
            status_code=e.response.status_code,
            detail=e.response.text[:200] if e.response.text else None,
        )
        return []
    except httpx.RequestError as e:
        logger.error("Failed to connect to API service", error=str(e))
        return []


async def sync_servers() -> int:
    """Sync servers from API to Docker manager.

    Returns number of servers successfully registered.
    """
    docker_manager = OrchestratorSingleton.get_docker_manager()
    servers = await fetch_servers_from_api()

    if not servers:
        logger.debug("No servers returned from API")
        return 0

    registered_count = 0
    for server in servers:
        # Log server config received from API (info level to ensure visibility)
        logger.info(
            "Server config received from API",
            server_id=server["id"],
            tls_enabled=server.get("tls_enabled"),
            tls_cert_path=server.get("tls_cert_path"),
            tls_key_path=server.get("tls_key_path"),
            tls_ca_path=server.get("tls_ca_path"),
        )
        success = await docker_manager.add_server(
            server_id=server["id"],
            hostname=server["hostname"],
            ip_address=server["ip_address"],
            docker_port=server["docker_port"],
            architecture=server["architecture"],
            region=server.get("region"),
            tls_enabled=server["tls_enabled"],
            tls_cert_path=server.get("tls_cert_path"),
            tls_key_path=server.get("tls_key_path"),
            tls_ca_path=server.get("tls_ca_path"),
            workspace_image=server.get("workspace_image", "ghcr.io/mujacica/workspace:latest"),
            workspace_image_arm64=server.get("workspace_image_arm64"),
            workspace_image_amd64=server.get("workspace_image_amd64"),
            workspace_image_gpu=server.get("workspace_image_gpu"),
        )
        if success:
            logger.info(
                "Registered workspace server",
                server_id=server["id"],
                hostname=server["hostname"],
                ip_address=server["ip_address"],
                port=server["docker_port"],
                architecture=server["architecture"],
                region=server.get("region"),
                tls=server["tls_enabled"],
            )
            registered_count += 1
        else:
            logger.debug(
                "Server already registered or failed to connect",
                server_id=server["id"],
                hostname=server["hostname"],
            )

    return registered_count


async def _periodic_server_sync() -> None:
    """Background task to periodically sync servers from API."""
    while True:
        try:
            await asyncio.sleep(settings.server_sync_interval)
            count = await sync_servers()
            if count > 0:
                logger.info("Periodic server sync completed", new_servers=count)
        except asyncio.CancelledError:
            logger.info("Server sync task cancelled")
            break
        except Exception as e:
            logger.error("Error in periodic server sync", error=str(e))


async def init_compute_manager() -> None:
    """Initialize the compute service on startup.

    Connects to Redis and fetches workspace servers from API service.
    """
    global _server_sync_task

    # Initialize WorkspaceStore (connects to Redis)
    workspace_store = OrchestratorSingleton.get_workspace_store()
    await workspace_store._get_client()
    logger.info("WorkspaceStore initialized", redis_url=settings.redis_url)

    # Get Docker manager
    docker_manager = OrchestratorSingleton.get_docker_manager()

    # Sync servers from API at startup
    registered_count = await sync_servers()
    if registered_count == 0:
        logger.warning(
            "No workspace servers registered. Ensure servers are configured in the API admin panel."
        )

    # Start periodic sync background task
    _server_sync_task = asyncio.create_task(_periodic_server_sync())
    logger.info(
        "Started periodic server sync task",
        interval_seconds=settings.server_sync_interval,
    )

    # Initialize orchestrator
    OrchestratorSingleton.get_orchestrator()
    logger.info(
        "WorkspaceOrchestrator initialized",
        servers_registered=len(docker_manager.get_healthy_servers()),
    )


async def cleanup_compute_manager() -> None:
    """Cleanup compute service on shutdown."""
    global _server_sync_task

    # Cancel the periodic server sync task
    if _server_sync_task is not None and not _server_sync_task.done():
        _server_sync_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _server_sync_task
        _server_sync_task = None
        logger.info("Cancelled server sync background task")

    docker_manager = OrchestratorSingleton._docker_manager
    if docker_manager is not None:
        await docker_manager.close_all()
        logger.info("Closed all Docker server connections")

    # Disconnect WorkspaceStore
    workspace_store = OrchestratorSingleton._workspace_store
    if workspace_store and workspace_store._client:
        try:
            await workspace_store._client.disconnect()
        except Exception as e:
            logger.warning("Error disconnecting WorkspaceStore", error=str(e))

    OrchestratorSingleton.clear_instance()
    logger.info("Compute service cleanup complete")
