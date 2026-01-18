"""Dependency injection for compute service."""

import asyncio
import secrets
from typing import Annotated

import structlog
from fastapi import Depends, Header, HTTPException, status

from src.config import settings
from src.managers.base import ComputeManager
from src.managers.docker_manager import DockerComputeManager
from src.managers.gcp_manager import GCPComputeManager
from src.sync.file_sync import FileSync

logger = structlog.get_logger()


def verify_internal_api_key(
    x_internal_api_key: Annotated[str | None, Header(alias="X-Internal-API-Key")] = None,
) -> None:
    """Verify internal service-to-service API key.

    In production, this ensures only authorized internal services
    (like the API service) can call compute endpoints.
    """
    # In development with no key configured, allow requests
    if not settings.internal_api_key:
        if settings.environment == "production":
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal API key not configured",
            )
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

# Dependency that verifies internal API key
InternalAuth = Annotated[None, Depends(verify_internal_api_key)]


class ComputeManagerSingleton:
    """Singleton holder for the compute manager instance."""

    _instance: ComputeManager | None = None

    @classmethod
    def get_instance(cls) -> ComputeManager:
        """Get or create the compute manager instance."""
        if cls._instance is None:
            if settings.compute_mode == "docker":
                cls._instance = DockerComputeManager()
            else:
                cls._instance = GCPComputeManager()
        return cls._instance

    @classmethod
    def clear_instance(cls) -> None:
        """Clear the singleton instance."""
        cls._instance = None


def get_compute_manager() -> ComputeManager:
    """Get the compute manager instance.

    Returns DockerComputeManager for local development,
    GCPComputeManager for production.
    """
    return ComputeManagerSingleton.get_instance()


async def init_compute_manager() -> None:
    """Initialize the compute manager on startup."""
    manager = get_compute_manager()

    # Initialize FileSync for GCS dotfiles/workspace file sync
    try:
        file_sync = FileSync(compute_manager=manager)
        manager.set_file_sync(file_sync)
        logger.info(
            "FileSync initialized",
            bucket=settings.gcs_bucket,
            compute_mode=settings.compute_mode,
        )
    except Exception as e:
        # Log but don't fail startup - sync is optional in development
        logger.warning(
            "Failed to initialize FileSync - dotfiles sync will be disabled",
            error=str(e),
        )


async def cleanup_compute_manager() -> None:
    """Cleanup compute manager on shutdown.

    Saves dotfiles for all running workspaces before clearing the manager.
    This ensures user data is persisted even during hot-reload or restart.
    """
    instance = ComputeManagerSingleton._instance
    if instance is not None:
        # Save dotfiles for all running workspaces before shutting down
        file_sync = instance.get_file_sync()
        if file_sync:
            workspaces = await instance.list_workspaces()
            for workspace in workspaces:
                if workspace.status.value == "running":
                    try:
                        # Get dotfiles_paths from metadata (if configured by user)
                        dotfiles_paths = workspace.metadata.get("dotfiles_paths")
                        # Timeout to prevent blocking shutdown
                        await asyncio.wait_for(
                            file_sync.save_user_dotfiles(
                                workspace_id=workspace.id,
                                user_id=workspace.user_id,
                                dotfiles_paths=dotfiles_paths,
                            ),
                            timeout=30.0,  # 30 seconds for larger dotfiles directories
                        )
                        logger.info(
                            "Saved dotfiles on shutdown",
                            workspace_id=workspace.id,
                            user_id=workspace.user_id,
                        )
                    except TimeoutError:
                        logger.warning(
                            "Timeout saving dotfiles on shutdown",
                            workspace_id=workspace.id,
                        )
                    except Exception as e:
                        logger.warning(
                            "Failed to save dotfiles on shutdown",
                            workspace_id=workspace.id,
                            error=str(e),
                        )

        # Cleanup idle workspaces
        await instance.cleanup_idle_workspaces(0)
        ComputeManagerSingleton.clear_instance()
