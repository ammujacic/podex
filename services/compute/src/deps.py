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
from src.storage.workspace_store import WorkspaceStore
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

    Raises:
        RuntimeError: If WorkspaceStore (Redis) or FileSync (GCS) fails to initialize.
            These are required services and the compute service cannot operate without them.
    """
    # Initialize WorkspaceStore first (connects to Redis) - required
    workspace_store = ComputeManagerSingleton.get_workspace_store()
    await workspace_store._get_client()
    logger.info("WorkspaceStore initialized", redis_url=settings.redis_url)

    manager = get_compute_manager()

    # Initialize FileSync for GCS dotfiles/workspace file sync (required)
    file_sync = FileSync(compute_manager=manager)
    manager.set_file_sync(file_sync)
    logger.info(
        "FileSync initialized",
        bucket=settings.gcs_bucket,
        compute_mode=settings.compute_mode,
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
        workspaces = await instance.list_workspaces()
        running_workspaces = [w for w in workspaces if w.status.value == "running"]

        logger.info(
            "Starting workspace cleanup during shutdown",
            total_workspaces=len(workspaces),
            running_workspaces=len(running_workspaces),
        )

        if running_workspaces:
            logger.info("Saving dotfiles for running workspaces before shutdown")
            for i, workspace in enumerate(running_workspaces, 1):
                logger.info(
                    "Saving dotfiles for workspace",
                    progress=f"{i}/{len(running_workspaces)}",
                    workspace_id=workspace.id[:12],
                    user_id=workspace.user_id,
                )
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

            logger.info("Dotfiles saved for all running workspaces")

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
