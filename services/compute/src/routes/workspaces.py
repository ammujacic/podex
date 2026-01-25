"""Workspace management routes."""

from collections.abc import AsyncGenerator
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from src.deps import AuthenticatedUser, InternalAuth, get_compute_manager
from src.managers.base import ComputeManager
from src.models.workspace import (
    WorkspaceCreateRequest,
    WorkspaceExecRequest,
    WorkspaceExecResponse,
    WorkspaceFileRequest,
    WorkspaceInfo,
    WorkspaceScaleRequest,
    WorkspaceScaleResponse,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


async def verify_workspace_ownership(
    workspace_id: str,
    user_id: str,
    compute: ComputeManager,
) -> WorkspaceInfo:
    """Verify user owns the workspace.

    Args:
        workspace_id: The workspace to check.
        user_id: The user making the request.
        compute: The compute manager.

    Returns:
        The workspace info if access is granted.

    Raises:
        HTTPException: If workspace not found or user doesn't own it.
    """
    workspace = await compute.get_workspace(workspace_id)

    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace not found",
        )

    if workspace.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access this workspace",
        )

    return workspace


@router.post("", response_model=WorkspaceInfo, status_code=status.HTTP_201_CREATED)
async def create_workspace(
    request: WorkspaceCreateRequest,
    user_id: AuthenticatedUser,
    _auth: InternalAuth,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> WorkspaceInfo:
    """Create a new workspace."""
    logger = structlog.get_logger()

    try:
        return await compute.create_workspace(
            user_id=user_id,
            session_id=request.session_id,
            config=request.config,
            workspace_id=request.workspace_id,
        )
    except RuntimeError as e:
        logger.warning(
            "Workspace creation runtime error",
            workspace_id=request.workspace_id,
            error=str(e),
        )
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e)) from e
    except Exception as e:
        # Log the actual exception for debugging
        logger.exception(
            "Failed to create workspace",
            workspace_id=request.workspace_id,
            session_id=request.session_id,
            user_id=user_id,
            error_type=type(e).__name__,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create workspace: {type(e).__name__}: {e}",
        ) from e


@router.get("/{workspace_id}", response_model=WorkspaceInfo)
async def get_workspace(
    workspace_id: str,
    user_id: AuthenticatedUser,
    _auth: InternalAuth,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> WorkspaceInfo:
    """Get workspace information."""
    return await verify_workspace_ownership(workspace_id, user_id, compute)


@router.get("", response_model=list[WorkspaceInfo])
async def list_workspaces(
    user_id: AuthenticatedUser,
    _auth: InternalAuth,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
    session_id: str | None = None,
) -> list[WorkspaceInfo]:
    """List workspaces for the authenticated user, optionally filtered by session."""
    # Always filter by the authenticated user's ID to prevent unauthorized listing
    return await compute.list_workspaces(user_id=user_id, session_id=session_id)


@router.post("/{workspace_id}/stop", status_code=status.HTTP_204_NO_CONTENT)
async def stop_workspace(
    workspace_id: str,
    user_id: AuthenticatedUser,
    _auth: InternalAuth,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> None:
    """Stop a running workspace."""
    await verify_workspace_ownership(workspace_id, user_id, compute)
    await compute.stop_workspace(workspace_id)


@router.post("/{workspace_id}/restart", status_code=status.HTTP_204_NO_CONTENT)
async def restart_workspace(
    workspace_id: str,
    user_id: AuthenticatedUser,
    _auth: InternalAuth,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> None:
    """Restart a stopped workspace."""
    await verify_workspace_ownership(workspace_id, user_id, compute)
    try:
        await compute.restart_workspace(workspace_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace(
    workspace_id: str,
    user_id: AuthenticatedUser,
    _auth: InternalAuth,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> None:
    """Delete a workspace."""
    await verify_workspace_ownership(workspace_id, user_id, compute)
    await compute.delete_workspace(workspace_id)


@router.post("/{workspace_id}/exec", response_model=WorkspaceExecResponse)
async def exec_command(
    workspace_id: str,
    request: WorkspaceExecRequest,
    user_id: AuthenticatedUser,
    _auth: InternalAuth,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> WorkspaceExecResponse:
    """Execute a command in the workspace."""
    await verify_workspace_ownership(workspace_id, user_id, compute)
    try:
        return await compute.exec_command(
            workspace_id=workspace_id,
            command=request.command,
            working_dir=request.working_dir,
            timeout=request.timeout,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e


@router.post("/{workspace_id}/exec-stream")
async def exec_command_stream(
    workspace_id: str,
    request: WorkspaceExecRequest,
    user_id: AuthenticatedUser,
    _auth: InternalAuth,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> StreamingResponse:
    """Execute a command and stream output using Server-Sent Events.

    This is useful for interactive commands like authentication flows
    where output should be displayed in real-time.

    Returns a text/event-stream with output chunks.
    Each chunk is sent as: data: <chunk>\n\n
    """
    await verify_workspace_ownership(workspace_id, user_id, compute)

    async def stream_output() -> AsyncGenerator[str, None]:
        """Generate SSE events from command output."""
        try:
            async for chunk in compute.exec_command_stream(
                workspace_id=workspace_id,
                command=request.command,
                working_dir=request.working_dir,
                timeout=request.timeout,
            ):
                # SSE format: data: <chunk>\n\n
                # Escape newlines for SSE transport
                escaped = chunk.replace("\n", "\\n")
                yield f"data: {escaped}\n\n"
        except ValueError as e:
            yield f"data: ERROR: {e}\n\n"
        except Exception as e:
            yield f"data: ERROR: {e}\n\n"
        # Send end marker
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        stream_output(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )


@router.get("/{workspace_id}/files")
async def list_files(
    workspace_id: str,
    user_id: AuthenticatedUser,
    _auth: InternalAuth,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
    path: str = ".",
) -> list[dict[str, str]]:
    """List files in workspace directory."""
    await verify_workspace_ownership(workspace_id, user_id, compute)
    try:
        return await compute.list_files(workspace_id, path)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e


@router.get("/{workspace_id}/files/content")
async def read_file(
    workspace_id: str,
    path: str,
    user_id: AuthenticatedUser,
    _auth: InternalAuth,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> dict[str, str]:
    """Read a file from the workspace."""
    await verify_workspace_ownership(workspace_id, user_id, compute)
    try:
        content = await compute.read_file(workspace_id, path)
        return {"path": path, "content": content}
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e


@router.put("/{workspace_id}/files/content", status_code=status.HTTP_204_NO_CONTENT)
async def write_file(
    workspace_id: str,
    request: WorkspaceFileRequest,
    user_id: AuthenticatedUser,
    _auth: InternalAuth,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> None:
    """Write a file to the workspace."""
    await verify_workspace_ownership(workspace_id, user_id, compute)
    if request.content is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Content is required",
        )
    try:
        await compute.write_file(workspace_id, request.path, request.content)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e


@router.post("/{workspace_id}/heartbeat", status_code=status.HTTP_204_NO_CONTENT)
async def heartbeat(
    workspace_id: str,
    user_id: AuthenticatedUser,
    _auth: InternalAuth,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> None:
    """Update workspace last activity timestamp."""
    await verify_workspace_ownership(workspace_id, user_id, compute)
    await compute.heartbeat(workspace_id)


@router.get("/{workspace_id}/health")
async def check_workspace_health(
    workspace_id: str,
    user_id: AuthenticatedUser,
    _auth: InternalAuth,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> dict[str, bool | str]:
    """Check if workspace container is healthy and can execute commands."""
    await verify_workspace_ownership(workspace_id, user_id, compute)
    is_healthy = await compute.check_workspace_health(workspace_id)
    workspace = await compute.get_workspace(workspace_id)
    return {
        "healthy": is_healthy,
        "status": workspace.status.value if workspace else "unknown",
    }


@router.post("/{workspace_id}/scale", response_model=WorkspaceScaleResponse)
async def scale_workspace(
    workspace_id: str,
    request: WorkspaceScaleRequest,
    user_id: AuthenticatedUser,
    _auth: InternalAuth,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> WorkspaceScaleResponse:
    """Scale a workspace to a new compute tier."""
    logger = structlog.get_logger()

    workspace = await verify_workspace_ownership(workspace_id, user_id, compute)

    # Check if scaling to the same tier
    if workspace.tier == request.new_tier:
        return WorkspaceScaleResponse(
            success=False,
            message=f"Workspace is already on {request.new_tier.value} tier",
            new_tier=workspace.tier,
        )

    try:
        response = await compute.scale_workspace(workspace_id, request.new_tier)

        logger.info(
            "Workspace scaled successfully",
            workspace_id=workspace_id,
            old_tier=workspace.tier.value,
            new_tier=request.new_tier.value,
        )

        return response
    except Exception as e:
        logger.exception(
            "Failed to scale workspace",
            workspace_id=workspace_id,
            new_tier=request.new_tier.value,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to scale workspace: {e}",
        ) from e
