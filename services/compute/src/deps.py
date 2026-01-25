"""Dependency injection for compute service."""

import secrets
from typing import Annotated

import structlog
from fastapi import Depends, Header, HTTPException, status

from src.config import settings
from src.managers.base import ComputeManager
from src.managers.docker_manager import DockerComputeManager
from src.managers.gcp_manager import GCPComputeManager
from src.storage.workspace_store import WorkspaceStore

logger = structlog.get_logger()


def validate_internal_auth(
    x_internal_api_key: str | None = None,
    authorization: str | None = None,
) -> None:
    """Validate internal service-to-service authentication.

    Supports two authentication modes:
    - Production (GCP Cloud Run): GCP ID token via Authorization header
      The token is already validated by Cloud Run's IAM layer before reaching here.
      We only check that the header is present.
    - Development (Docker): API key via X-Internal-API-Key header

    Args:
        x_internal_api_key: API key header (development mode)
        authorization: Bearer token header (production mode)
    """
    if settings.environment == "production":
        # In production, Cloud Run validates the ID token via IAM
        # The request only reaches here if IAM allowed it
        # We check for the Authorization header to confirm it went through IAM
        if authorization and authorization.startswith("Bearer "):
            # Token already validated by Cloud Run IAM - allow request
            logger.debug("Request authenticated via GCP IAM")
            return

        # No bearer token - check if API key is present as fallback
        # This allows gradual migration: some services may still use API keys
        if (
            x_internal_api_key
            and settings.internal_api_key
            and secrets.compare_digest(x_internal_api_key, settings.internal_api_key)
        ):
            logger.debug("Request authenticated via API key (production fallback)")
            return

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authentication",
        )

    # Development mode: Use API key authentication
    if not settings.internal_api_key:
        # No key configured in development - allow all requests
        logger.debug("No internal API key configured, allowing request (dev mode)")
        return

    if not x_internal_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing internal API key",
        )

    # Use constant-time comparison to prevent timing attacks
    if not secrets.compare_digest(x_internal_api_key, settings.internal_api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal API key",
        )


def verify_internal_auth(
    x_internal_api_key: Annotated[str | None, Header(alias="X-Internal-API-Key")] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """Verify internal service-to-service authentication.

    Supports dual-mode authentication:
    - Production (GCP): ID token in Authorization header (validated by Cloud Run IAM)
    - Development (Docker): API key in X-Internal-API-Key header
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


class ComputeManagerSingleton:
    """Singleton holder for the compute manager instance."""

    _instance: ComputeManager | None = None
    _workspace_store: WorkspaceStore | None = None

    @classmethod
    def get_workspace_store(cls) -> WorkspaceStore:
        """Get or create the workspace store instance."""
        if cls._workspace_store is None:
            cls._workspace_store = WorkspaceStore()
        return cls._workspace_store

    @classmethod
    def get_instance(cls) -> ComputeManager:
        """Get or create the compute manager instance."""
        if cls._instance is None:
            workspace_store = cls.get_workspace_store()
            if settings.compute_mode == "docker":
                cls._instance = DockerComputeManager(workspace_store=workspace_store)
            else:
                cls._instance = GCPComputeManager(workspace_store=workspace_store)
        return cls._instance

    @classmethod
    def clear_instance(cls) -> None:
        """Clear the singleton instance."""
        cls._instance = None
        # Note: WorkspaceStore disconnect is handled in cleanup_compute_manager
        cls._workspace_store = None


def get_compute_manager() -> ComputeManager:
    """Get the compute manager instance.

    Returns DockerComputeManager for local development,
    GCPComputeManager for production.
    """
    return ComputeManagerSingleton.get_instance()


async def init_compute_manager() -> None:
    """Initialize the compute manager on startup.

    Uses volume mounts for file persistence - no FileSync needed.
    """
    # Initialize WorkspaceStore (connects to Redis)
    workspace_store = ComputeManagerSingleton.get_workspace_store()
    await workspace_store._get_client()
    logger.info("WorkspaceStore initialized", redis_url=settings.redis_url)

    # Get compute manager (uses volume mounts for storage)
    get_compute_manager()
    logger.info(
        "ComputeManager initialized with volume mounts",
        compute_mode=settings.compute_mode,
        local_storage_path=settings.local_storage_path,
    )


async def cleanup_compute_manager() -> None:
    """Cleanup compute manager on shutdown.

    With volume mounts, files are automatically persisted - no sync needed.
    """
    instance = ComputeManagerSingleton._instance
    if instance is not None:
        workspaces = await instance.list_workspaces()
        running_workspaces = [w for w in workspaces if w.status.value == "running"]

        logger.info(
            "Starting workspace cleanup during shutdown",
            total_workspaces=len(workspaces),
            running_workspaces=len(running_workspaces),
        )

        # With volume mounts, all files are already persisted
        if running_workspaces:
            logger.info(
                "Volume mounts active - all files already persisted",
                count=len(running_workspaces),
            )

        # Cleanup idle workspaces
        await instance.cleanup_idle_workspaces(0)

        # Disconnect WorkspaceStore
        workspace_store = ComputeManagerSingleton._workspace_store
        if workspace_store and workspace_store._client:
            try:
                await workspace_store._client.disconnect()
            except Exception as e:
                logger.warning("Error disconnecting WorkspaceStore", error=str(e))

        ComputeManagerSingleton.clear_instance()
