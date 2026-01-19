"""Preview proxy routes for workspace applications.

This module proxies requests from the frontend to workspace containers
via the compute service. This allows:
- Frontend preview panels to render running applications
- Agents to access APIs for testing/debugging
- Full HTTP support for dev servers
"""

from http import HTTPStatus

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import Session, Workspace
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter
from src.routes.dependencies import DbSession

router = APIRouter()


class PreviewPortConfig(BaseModel):
    """Preview port configuration."""

    port: int
    label: str
    protocol: str = "http"
    process_name: str | None = None


class WorkspacePreviewInfo(BaseModel):
    """Workspace preview information."""

    workspace_id: str
    container_id: str | None
    status: str
    ports: list[PreviewPortConfig]
    active_ports: list[PreviewPortConfig]
    preview_url: str


# Default development ports
DEFAULT_PORTS = [
    PreviewPortConfig(port=3000, label="Dev Server", protocol="http"),
    PreviewPortConfig(port=5173, label="Vite", protocol="http"),
    PreviewPortConfig(port=8080, label="Backend API", protocol="http"),
    PreviewPortConfig(port=4000, label="GraphQL", protocol="http"),
]

# Compute service URL (from settings or default for Docker network)
COMPUTE_SERVICE_URL = getattr(settings, "COMPUTE_SERVICE_URL", "http://compute:3003")

# Valid port range for preview proxy
MIN_PORT = 1024  # Exclude privileged ports
MAX_PORT = 65535


def validate_port(port: int) -> None:
    """Validate port number is in allowed range.

    Args:
        port: Port number to validate.

    Raises:
        HTTPException: If port is outside valid range.
    """
    if port < MIN_PORT or port > MAX_PORT:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid port number. Must be between {MIN_PORT} and {MAX_PORT}",
        )


def _get_compute_client(user_id: str | None = None) -> httpx.AsyncClient:
    """Get HTTP client for compute service.

    Args:
        user_id: User ID to pass in X-User-ID header for authorization.
    """
    headers = {}
    if user_id:
        headers["X-User-ID"] = user_id
    # Add internal API key for service-to-service auth
    if settings.COMPUTE_INTERNAL_API_KEY:
        headers["X-Internal-API-Key"] = settings.COMPUTE_INTERNAL_API_KEY
    return httpx.AsyncClient(base_url=COMPUTE_SERVICE_URL, timeout=30.0, headers=headers)


async def _verify_workspace_access(
    workspace_id: str,
    request: Request,
    db: AsyncSession,
) -> tuple[Workspace, str]:
    """Verify user has access to workspace via its associated session.

    Args:
        workspace_id: The workspace ID to check.
        request: The FastAPI request object.
        db: Database session.

    Returns:
        Tuple of (workspace, user_id) if access is granted.

    Raises:
        HTTPException: If workspace not found, user not authenticated, or access denied.
    """
    # Require authentication first
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    workspace = result.scalar_one_or_none()

    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Check authorization via session - session MUST exist and user MUST own it
    session_result = await db.execute(select(Session).where(Session.workspace_id == workspace_id))
    session = session_result.scalar_one_or_none()

    if not session:
        # Orphaned workspace - no access without a session
        raise HTTPException(status_code=403, detail="Workspace has no associated session")

    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")

    return workspace, str(user_id)


@router.get("/{workspace_id}", response_model=WorkspacePreviewInfo)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_preview_info(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> WorkspacePreviewInfo:
    """Get preview information for a workspace.

    Returns both default ports and actively listening ports detected
    from the running workspace container.
    """
    # Verify workspace exists and user has access
    workspace, user_id = await _verify_workspace_access(workspace_id, request, db)

    # Get active ports from compute service
    active_ports: list[PreviewPortConfig] = []
    try:
        async with _get_compute_client(user_id) as client:
            compute_response = await client.get(f"/preview/{workspace_id}/ports")
            if compute_response.status_code == HTTPStatus.OK:
                ports_data = compute_response.json()
                active_ports = [
                    PreviewPortConfig(
                        port=p["port"],
                        label=p.get("process_name", "Unknown"),
                        protocol="http",
                        process_name=p.get("process_name"),
                    )
                    for p in ports_data
                ]
    except httpx.RequestError:
        # Compute service unavailable, continue with empty active ports
        pass

    return WorkspacePreviewInfo(
        workspace_id=workspace.id,
        container_id=workspace.container_id,
        status=workspace.status,
        ports=DEFAULT_PORTS,
        active_ports=active_ports,
        preview_url=f"/api/preview/{workspace_id}/proxy",
    )


@router.get("/{workspace_id}/ports")
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_active_ports(
    workspace_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> list[PreviewPortConfig]:
    """Get list of actively listening ports in a workspace.

    This endpoint allows agents and debugging tools to discover
    what services are running in the workspace.
    """
    # Verify workspace exists and user has access
    _workspace, user_id = await _verify_workspace_access(workspace_id, request, db)

    # Get active ports from compute service
    try:
        async with _get_compute_client(user_id) as client:
            compute_response = await client.get(f"/preview/{workspace_id}/ports")
            if compute_response.status_code == HTTPStatus.OK:
                ports_data = compute_response.json()
                return [
                    PreviewPortConfig(
                        port=p["port"],
                        label=p.get("process_name", "Unknown"),
                        protocol="http",
                        process_name=p.get("process_name"),
                    )
                    for p in ports_data
                ]
            if response.status_code == HTTPStatus.NOT_FOUND:
                raise HTTPException(status_code=404, detail="Workspace not found")
    except httpx.RequestError:
        # Don't leak internal error details to clients
        raise HTTPException(
            status_code=503,
            detail="Compute service unavailable",
        ) from None

    return []


@router.api_route(
    "/{workspace_id}/proxy/{port:int}/{path:path}",
    methods=["GET", "HEAD", "OPTIONS"],
)
@limiter.limit(RATE_LIMIT_STANDARD)
async def proxy_get_request(
    workspace_id: str,
    port: int,
    path: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> Response:
    """Proxy GET/HEAD/OPTIONS requests to a workspace container port.

    This allows the frontend preview panel, agents, and debugging tools
    to access applications running in the workspace without CORS issues.

    Supports:
    - Web applications (React, Vue, Next.js, etc.)
    - API endpoints for debugging
    - Static file serving
    - Any HTTP-based service
    """
    return await _proxy_to_compute(workspace_id, port, path, request, db)


@router.api_route(
    "/{workspace_id}/proxy/{port:int}/{path:path}",
    methods=["POST", "PUT", "PATCH", "DELETE"],
)
@limiter.limit(RATE_LIMIT_STANDARD)
async def proxy_mutation_request(
    workspace_id: str,
    port: int,
    path: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> Response:
    """Proxy POST/PUT/PATCH/DELETE requests to a workspace container port.

    This enables agents to interact with APIs running in the workspace
    for testing and debugging purposes.
    """
    return await _proxy_to_compute(workspace_id, port, path, request, db)


async def _proxy_to_compute(
    workspace_id: str,
    port: int,
    path: str,
    request: Request,
    db: AsyncSession,
) -> Response:
    """Proxy request to compute service which forwards to the workspace container."""
    # Validate port number
    validate_port(port)

    # Verify workspace exists and user has access
    _workspace, user_id = await _verify_workspace_access(workspace_id, request, db)

    # Build target URL on compute service
    compute_path = f"/preview/{workspace_id}/proxy/{port}/{path}"
    if request.url.query:
        compute_path += f"?{request.url.query}"

    # Get request body for mutation requests
    body = None
    if request.method in ("POST", "PUT", "PATCH"):
        body = await request.body()

    # Filter headers to forward
    forward_headers = {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in ("host", "connection", "content-length")
    }

    try:
        async with _get_compute_client(user_id) as client:
            response = await client.request(
                method=request.method,
                url=compute_path,
                headers=forward_headers,
                content=body,
            )

            # Return the response from compute service
            return Response(
                content=response.content,
                status_code=response.status_code,
                headers={
                    key: value
                    for key, value in response.headers.items()
                    if key.lower() not in ("content-encoding", "transfer-encoding", "connection")
                },
            )

    except httpx.ConnectError as e:
        raise HTTPException(
            status_code=502,
            detail="Could not connect to compute service. Is it running?",
        ) from e
    except httpx.TimeoutException as e:
        raise HTTPException(status_code=504, detail="Request to compute service timed out") from e
    except Exception:
        # Don't leak internal error details to clients
        raise HTTPException(status_code=500, detail="Internal proxy error") from None


# Convenience endpoint for default dev server port
@router.api_route(
    "/{workspace_id}/app/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
)
@limiter.limit(RATE_LIMIT_STANDARD)
async def proxy_default_port(
    workspace_id: str,
    path: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> Response:
    """Proxy requests to the default dev server port (3000).

    Convenience endpoint for common development servers.
    """
    return await _proxy_to_compute(workspace_id, 3000, path, request, db)
