"""Preview proxy routes for workspace applications."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from podex_shared import PortInfo, PreviewInfo
from src.deps import get_compute_manager, verify_internal_auth
from src.managers.base import ComputeManager, ProxyRequest

router = APIRouter(
    prefix="/preview",
    tags=["preview"],
    dependencies=[Depends(verify_internal_auth)],
)


@router.get("/{workspace_id}", response_model=PreviewInfo)
async def get_preview_info(
    workspace_id: str,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> PreviewInfo:
    """Get preview information for a workspace.

    Returns list of active ports and preview URL.
    """
    workspace = await compute.get_workspace(workspace_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace not found",
        )

    # Get active ports
    active_ports = await compute.get_active_ports(workspace_id)

    return PreviewInfo(
        workspace_id=workspace_id,
        status=workspace.status.value,
        active_ports=[PortInfo(**p) for p in active_ports],
        preview_base_url=f"/preview/{workspace_id}/proxy",
    )


@router.get("/{workspace_id}/ports", response_model=list[PortInfo])
async def get_active_ports(
    workspace_id: str,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> list[PortInfo]:
    """Get list of active ports in a workspace.

    This endpoint allows agents and debugging tools to discover
    running services in the workspace.
    """
    workspace = await compute.get_workspace(workspace_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace not found",
        )

    ports = await compute.get_active_ports(workspace_id)
    return [PortInfo(**p) for p in ports]


@router.api_route(
    "/{workspace_id}/proxy/{port:int}/{path:path}",
    methods=["GET", "HEAD", "OPTIONS"],
)
async def proxy_get_request(
    workspace_id: str,
    port: int,
    path: str,
    request: Request,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> Response:
    """Proxy GET/HEAD/OPTIONS requests to a workspace container port.

    This allows the frontend preview panel, agents, and debugging tools
    to access applications running in the workspace without CORS issues.

    Supports:
    - Web applications (React, Vue, etc.)
    - API endpoints for debugging
    - Static file serving
    - Any HTTP-based service
    """
    return await _proxy_request(workspace_id, port, path, request, compute)


@router.api_route(
    "/{workspace_id}/proxy/{port:int}/{path:path}",
    methods=["POST", "PUT", "PATCH", "DELETE"],
)
async def proxy_mutation_request(
    workspace_id: str,
    port: int,
    path: str,
    request: Request,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> Response:
    """Proxy POST/PUT/PATCH/DELETE requests to a workspace container port.

    This enables agents to interact with APIs running in the workspace
    for testing and debugging purposes.
    """
    return await _proxy_request(workspace_id, port, path, request, compute)


async def _proxy_request(
    workspace_id: str,
    port: int,
    path: str,
    request: Request,
    compute: ComputeManager,
) -> Response:
    """Internal proxy implementation."""
    # Convert headers to dict
    headers = dict(request.headers.items())

    # Get request body for POST/PUT/PATCH
    body = None
    if request.method in ("POST", "PUT", "PATCH"):
        body = await request.body()

    # Get query string
    query_string = str(request.url.query) if request.url.query else None

    try:
        proxy_req = ProxyRequest(
            workspace_id=workspace_id,
            port=port,
            method=request.method,
            path=path,
            headers=headers,
            body=body,
            query_string=query_string,
        )
        status_code, response_headers, response_body = await compute.proxy_request(proxy_req)

        return Response(
            content=response_body,
            status_code=status_code,
            headers=response_headers,
            media_type=response_headers.get("content-type"),
        )

    except ValueError as e:
        error_message = str(e)
        if "not found" in error_message.lower():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=error_message,
            ) from e
        if "not running" in error_message.lower():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=error_message,
            ) from e
        if "could not connect" in error_message.lower():
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=error_message,
            ) from e
        if "timed out" in error_message.lower():
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=error_message,
            ) from e
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=error_message,
        ) from e


# Also expose a root proxy endpoint for the default port (3000)
@router.api_route(
    "/{workspace_id}/app/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
)
async def proxy_default_port(
    workspace_id: str,
    path: str,
    request: Request,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> Response:
    """Proxy requests to the default dev server port (3000).

    Convenience endpoint for common development servers.
    """
    return await _proxy_request(workspace_id, 3000, path, request, compute)
