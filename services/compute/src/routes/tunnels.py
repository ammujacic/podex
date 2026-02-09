"""Tunnel management routes for workspace cloudflared tunnels."""

from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, status

from src.deps import AuthenticatedUser, InternalAuth, get_compute_manager
from src.managers.base import ComputeManager
from src.models.tunnel import (
    TunnelStartRequest,
    TunnelStartResponse,
    TunnelStatusResponse,
    TunnelStopRequest,
)
from src.routes.workspaces import verify_workspace_ownership

router = APIRouter(prefix="/workspaces/{workspace_id}/tunnels", tags=["tunnels"])
logger = structlog.get_logger()


@router.post("/start", response_model=TunnelStartResponse)
async def start_tunnel(
    workspace_id: str,
    request: TunnelStartRequest,
    user_id: AuthenticatedUser,
    _auth: InternalAuth,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> TunnelStartResponse:
    """Start a cloudflared tunnel for a workspace port."""
    await verify_workspace_ownership(workspace_id, user_id, compute)

    try:
        result = await compute.start_tunnel(
            workspace_id=workspace_id,
            token=request.token,
            port=request.port,
            service_type=request.service_type,
        )
        return TunnelStartResponse(
            status=result.get("status", "running"),
            pid=result.get("pid"),
        )
    except Exception as e:
        logger.error(
            "Failed to start tunnel",
            workspace_id=workspace_id,
            port=request.port,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to start tunnel: {e}",
        ) from e


@router.post("/stop", response_model=TunnelStatusResponse)
async def stop_tunnel(
    workspace_id: str,
    request: TunnelStopRequest,
    user_id: AuthenticatedUser,
    _auth: InternalAuth,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> TunnelStatusResponse:
    """Stop a cloudflared tunnel."""
    await verify_workspace_ownership(workspace_id, user_id, compute)

    try:
        result = await compute.stop_tunnel(
            workspace_id=workspace_id,
            port=request.port,
        )
        return TunnelStatusResponse(
            status=result.get("status", "stopped"),
            pid=result.get("pid"),
        )
    except Exception as e:
        logger.error(
            "Failed to stop tunnel",
            workspace_id=workspace_id,
            port=request.port,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to stop tunnel: {e}",
        ) from e


@router.get("/status", response_model=dict[str, object])
async def get_tunnel_status(
    workspace_id: str,
    user_id: AuthenticatedUser,
    _auth: InternalAuth,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> dict[str, object]:
    """Get status of all tunnels for a workspace."""
    await verify_workspace_ownership(workspace_id, user_id, compute)

    try:
        return await compute.get_tunnel_status(workspace_id=workspace_id)
    except Exception as e:
        logger.error(
            "Failed to get tunnel status",
            workspace_id=workspace_id,
            error=str(e),
        )
        return {"status": "error", "error": str(e)}
