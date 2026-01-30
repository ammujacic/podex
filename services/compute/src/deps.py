"""Dependency injection for compute service."""

import secrets
from typing import Annotated

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
    x_internal_api_key: str | None = None,
    authorization: str | None = None,
) -> None:
    """Validate internal service-to-service authentication.

    Validates API key in X-Internal-API-Key header or Authorization: Bearer header.

    SECURITY: API key is always required - no bypass for development mode.

    Args:
        x_internal_api_key: API key header
        authorization: Bearer token header (alternative)
    """
    if not settings.internal_api_key:
        # SECURITY: Fail closed - if no API key configured, reject all requests
        logger.error("COMPUTE_INTERNAL_API_KEY not configured - rejecting request")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Service authentication not configured",
        )

    # Extract token from either header
    token = None
    if x_internal_api_key:
        token = x_internal_api_key
    elif authorization and authorization.startswith("Bearer "):
        token = authorization[7:]

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing API key",
        )

    # SECURITY: Use constant-time comparison to prevent timing attacks
    if not secrets.compare_digest(token, settings.internal_api_key):
        logger.warning("Invalid internal API key received")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal API key",
        )

    logger.debug("Request authenticated via API key")


def verify_internal_auth(
    x_internal_api_key: Annotated[str | None, Header(alias="X-Internal-API-Key")] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """Verify internal service-to-service authentication.

    Supports dual-mode authentication:
    - Bearer token in Authorization header
    - API key in X-Internal-API-Key header
    """
    validate_internal_auth(x_internal_api_key, authorization)


# Keep legacy function name for backward compatibility
def verify_internal_api_key(
    x_internal_api_key: Annotated[str | None, Header(alias="X-Internal-API-Key")] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """Verify internal service-to-service API key.

    Deprecated: Use verify_internal_auth instead.
    This function is kept for backward compatibility.
    """
    validate_internal_auth(x_internal_api_key, authorization)


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


async def init_compute_manager() -> None:
    """Initialize the compute service on startup.

    Connects to Redis and registers all configured workspace servers.
    """
    # Initialize WorkspaceStore (connects to Redis)
    workspace_store = OrchestratorSingleton.get_workspace_store()
    await workspace_store._get_client()
    logger.info("WorkspaceStore initialized", redis_url=settings.redis_url)

    # Get Docker manager and register servers from config
    docker_manager = OrchestratorSingleton.get_docker_manager()

    servers = settings.workspace_servers
    if not servers:
        logger.warning(
            "No workspace servers configured. "
            "Set COMPUTE_WORKSPACE_SERVERS env var with JSON array of servers."
        )
    else:
        for server in servers:
            success = await docker_manager.add_server(
                server_id=server.server_id,
                hostname=server.host,
                ip_address=server.host,  # hostname and ip_address are the same for Docker
                docker_port=server.docker_port,
                architecture=server.architecture,
                region=server.region,
                tls_enabled=server.tls_enabled,
                cert_path=server.cert_path,
            )
            if success:
                logger.info(
                    "Registered workspace server",
                    server_id=server.server_id,
                    host=server.host,
                    port=server.docker_port,
                    architecture=server.architecture,
                    region=server.region,
                    tls=server.tls_enabled,
                )
            else:
                logger.error(
                    "Failed to register workspace server",
                    server_id=server.server_id,
                    host=server.host,
                )

    # Initialize orchestrator
    OrchestratorSingleton.get_orchestrator()
    logger.info(
        "WorkspaceOrchestrator initialized",
        servers_registered=len(docker_manager.get_healthy_servers()),
        total_servers=len(servers) if servers else 0,
    )


async def cleanup_compute_manager() -> None:
    """Cleanup compute service on shutdown."""
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
