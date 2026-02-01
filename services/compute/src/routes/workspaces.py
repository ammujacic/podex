"""Workspace management routes."""

from collections.abc import AsyncGenerator
from typing import Annotated, Any, cast

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
from src.storage.workspace_store import WorkspaceStore
from src.validation import ValidationError, validate_workspace_id

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
        HTTPException: If workspace not found, user doesn't own it, or ID is invalid.
    """
    # Validate workspace_id to prevent path traversal and injection attacks
    try:
        validate_workspace_id(workspace_id)
    except ValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e

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
    except ValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
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


@router.post("/{workspace_id}/mark-for-deletion", status_code=status.HTTP_202_ACCEPTED)
async def mark_workspace_for_deletion(
    workspace_id: str,
    user_id: AuthenticatedUser,
    _auth: InternalAuth,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> dict[str, str]:
    """Mark a workspace for deletion by the cleanup task.

    This is used when a session is deleted - the workspace gets marked for
    cleanup rather than deleted immediately. The cleanup task will delete
    the container and storage on its next run (within 60 seconds).
    """
    await verify_workspace_ownership(workspace_id, user_id, compute)
    marked = await compute.mark_for_deletion(workspace_id)
    if not marked:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    return {"status": "marked_for_deletion", "workspace_id": workspace_id}


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


@router.get("/{workspace_id}/scale-options")
async def get_scale_options(
    workspace_id: str,
    user_id: AuthenticatedUser,
    _auth: InternalAuth,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> dict[str, Any]:
    """Get available scaling options for a workspace.

    Returns which tiers the workspace can scale to based on current
    server capacity. Only same-server scaling is supported.
    """
    # Lazy imports to avoid circular dependencies
    from src.managers.hardware_specs_provider import get_hardware_specs_provider  # noqa: PLC0415
    from src.managers.multi_server_compute_manager import MultiServerComputeManager  # noqa: PLC0415
    from src.managers.workspace_orchestrator import get_tier_requirements  # noqa: PLC0415

    logger = structlog.get_logger()
    workspace = await verify_workspace_ownership(workspace_id, user_id, compute)

    current_tier = workspace.tier
    server_id = workspace.server_id

    if not server_id:
        return {
            "current_tier": current_tier,
            "server_id": None,
            "available_tiers": [],
            "error": "Workspace has no server assignment",
        }

    # Get current requirements
    current_requirements = await get_tier_requirements(current_tier)

    # Get server capacity
    if isinstance(compute, MultiServerComputeManager):
        capacities = await compute._orchestrator.get_server_capacities()
        server_capacity = next((c for c in capacities if c.server_id == server_id), None)
    else:
        server_capacity = None

    if not server_capacity:
        return {
            "current_tier": current_tier,
            "server_id": server_id,
            "available_tiers": [],
            "error": "Server not found or unhealthy",
        }

    # Get all hardware specs
    provider = get_hardware_specs_provider()
    all_specs = await provider.get_all_specs()

    # Get current spec for architecture comparison and display
    current_spec = all_specs.get(current_tier)
    current_architecture = current_spec.architecture if current_spec else "x86_64"  # noqa: F841

    # Build current tier info for the response
    current_tier_info = None
    if current_spec:
        current_tier_info = {
            "tier": current_tier,
            "display_name": current_spec.display_name,
            "cpu": current_spec.vcpu,
            "memory_mb": current_spec.memory_mb,
            "storage_gb": current_spec.storage_gb,
            "bandwidth_mbps": current_spec.bandwidth_mbps,
            "hourly_rate_cents": current_spec.hourly_rate_cents,
            "is_gpu": current_spec.is_gpu,
            "gpu_type": current_spec.gpu_type,
        }

    available_tiers = []
    for tier_name, spec in all_specs.items():
        if not spec.is_available:
            continue

        # Skip current tier
        if tier_name == current_tier:
            continue

        # Filter by architecture - must match server architecture
        if spec.architecture != server_capacity.architecture:
            continue

        # Filter by GPU - can only scale to GPU tier if server has GPU
        if spec.is_gpu and not server_capacity.has_gpu:
            continue

        # Filter by GPU type if both require GPU
        if (
            spec.is_gpu
            and spec.gpu_type
            and server_capacity.gpu_type
            and spec.gpu_type != server_capacity.gpu_type
        ):
            continue

        # Get requirements for this tier
        tier_requirements = await get_tier_requirements(tier_name)

        # Calculate delta needed
        delta_cpu = tier_requirements.cpu - current_requirements.cpu
        delta_memory = tier_requirements.memory_mb - current_requirements.memory_mb
        delta_disk = tier_requirements.disk_gb - current_requirements.disk_gb

        # Check if server can fit the delta
        can_scale = (
            server_capacity.available_cpu >= delta_cpu
            and server_capacity.available_memory_mb >= delta_memory
            and server_capacity.available_disk_gb >= delta_disk
        )

        # Determine reason if can't scale
        reason = None
        if not can_scale:
            avail = server_capacity
            if avail.available_cpu < delta_cpu:
                reason = f"Insufficient CPU (need {delta_cpu:.1f}, have {avail.available_cpu:.1f})"
            elif avail.available_memory_mb < delta_memory:
                reason = (
                    f"Insufficient memory (need {delta_memory}MB, "
                    f"have {avail.available_memory_mb}MB)"
                )
            elif avail.available_disk_gb < delta_disk:
                reason = (
                    f"Insufficient disk (need {delta_disk}GB, have {avail.available_disk_gb}GB)"
                )

        available_tiers.append(
            {
                "tier": tier_name,
                "display_name": spec.display_name,
                "can_scale": can_scale,
                "reason": reason,
                "cpu": spec.vcpu,
                "memory_mb": spec.memory_mb,
                "storage_gb": spec.storage_gb,
                "bandwidth_mbps": spec.bandwidth_mbps,
                "hourly_rate_cents": spec.hourly_rate_cents,
                "is_gpu": spec.is_gpu,
                "gpu_type": spec.gpu_type,
            }
        )

    # Sort by sort_order (approximated by hourly_rate)
    available_tiers.sort(key=lambda x: cast("int", x["hourly_rate_cents"]))

    logger.info(
        "Calculated scale options",
        workspace_id=workspace_id[:12],
        current_tier=current_tier,
        available_count=sum(1 for t in available_tiers if t["can_scale"]),
    )

    return {
        "current_tier": current_tier,
        "current_tier_info": current_tier_info,
        "server_id": server_id,
        "available_tiers": available_tiers,
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
            message=f"Workspace is already on {request.new_tier} tier",
            new_tier=workspace.tier,
        )

    try:
        response = await compute.scale_workspace(workspace_id, request.new_tier)

        logger.info(
            "Workspace scaled successfully",
            workspace_id=workspace_id,
            old_tier=workspace.tier,
            new_tier=request.new_tier,
        )

        return response
    except Exception as e:
        logger.exception(
            "Failed to scale workspace",
            workspace_id=workspace_id,
            new_tier=request.new_tier,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to scale workspace: {e}",
        ) from e


@router.get("/{workspace_id}/resources")
async def get_workspace_resources(
    workspace_id: str,
    user_id: AuthenticatedUser,
    _auth: InternalAuth,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> dict[str, Any]:
    """Get current resource usage metrics for a workspace.

    Returns CPU, memory, disk I/O, and network usage statistics
    collected from the container's Docker stats.
    """
    await verify_workspace_ownership(workspace_id, user_id, compute)

    store = WorkspaceStore()
    metrics = await store.get_metrics(workspace_id)

    if not metrics:
        # Return default metrics if none collected yet
        return {
            "cpu_percent": 0.0,
            "cpu_limit_cores": 1.0,
            "memory_used_mb": 0,
            "memory_limit_mb": 1024,
            "memory_percent": 0.0,
            "disk_read_mb": 0.0,
            "disk_write_mb": 0.0,
            "network_rx_mb": 0.0,
            "network_tx_mb": 0.0,
            "collected_at": None,
            "container_uptime_seconds": 0,
        }

    return metrics
