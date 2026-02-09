"""API service client for compute-to-API communication."""

from http import HTTPStatus

import httpx
import structlog

from src.config import settings

logger = structlog.get_logger()


class APIClientSingleton:
    """Singleton holder for the shared API HTTP client."""

    _instance: httpx.AsyncClient | None = None

    @classmethod
    def get(cls) -> httpx.AsyncClient:
        """Get or create the shared HTTP client for API service."""
        if cls._instance is None:
            headers = {}
            if settings.internal_service_token:
                headers["X-Internal-Service-Token"] = settings.internal_service_token

            cls._instance = httpx.AsyncClient(
                base_url=settings.api_base_url,
                timeout=httpx.Timeout(30.0, connect=10.0),
                headers=headers,
            )
        return cls._instance

    @classmethod
    async def close(cls) -> None:
        """Close the HTTP client."""
        if cls._instance is not None:
            await cls._instance.aclose()
            cls._instance = None


async def sync_workspace_status_to_api(
    workspace_id: str,
    status: str,
    container_id: str | None = None,
) -> bool:
    """Notify API service about workspace status change.

    This is called when compute service rediscovers a workspace or when
    status changes outside of a user-initiated API call.

    Args:
        workspace_id: The workspace ID
        status: New status (running, standby, stopped, error)
        container_id: Optional container ID

    Returns:
        True if API was successfully notified, False otherwise
    """
    client = APIClientSingleton.get()

    try:
        response = await client.post(
            f"/api/workspaces/{workspace_id}/internal/sync-status",
            json={
                "status": status,
                "container_id": container_id,
            },
        )

        if response.status_code == HTTPStatus.OK:
            data = response.json()
            logger.info(
                "Synced workspace status to API",
                workspace_id=workspace_id,
                status=status,
                updated=data.get("updated", False),
                session_id=data.get("session_id"),
            )
            return True
        elif response.status_code == HTTPStatus.NOT_FOUND:
            # Workspace not found in API database - this can happen for
            # orphaned containers. Log but don't treat as error.
            logger.warning(
                "Workspace not found in API during sync",
                workspace_id=workspace_id,
                status=status,
            )
            return False
        else:
            logger.warning(
                "Failed to sync workspace status to API",
                workspace_id=workspace_id,
                status=status,
                status_code=response.status_code,
                response=response.text[:200] if response.text else None,
            )
            return False

    except httpx.TimeoutException:
        logger.warning(
            "Timeout syncing workspace status to API",
            workspace_id=workspace_id,
            status=status,
        )
        return False
    except httpx.ConnectError:
        logger.warning(
            "Could not connect to API service for status sync",
            workspace_id=workspace_id,
            status=status,
            api_url=settings.api_base_url,
        )
        return False
    except Exception as e:
        logger.exception(
            "Error syncing workspace status to API",
            workspace_id=workspace_id,
            status=status,
            error=str(e),
        )
        return False
