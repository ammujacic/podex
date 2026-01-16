"""LSP (Language Server Protocol) proxy routes.

Proxies LSP requests to the compute service for workspace-specific diagnostics.
"""

from typing import Annotated, Any

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.connection import get_db
from src.database.models import Session, Workspace
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

logger = structlog.get_logger()

router = APIRouter(prefix="/lsp", tags=["lsp"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


async def verify_workspace_access(
    workspace_id: str,
    request: Request,
    db: AsyncSession,
) -> Workspace:
    """Verify user has access to the workspace."""
    result = await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    workspace = result.scalar_one_or_none()

    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Check if user owns the session associated with this workspace
    session_result = await db.execute(select(Session).where(Session.workspace_id == workspace_id))
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found for workspace")

    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return workspace


class DiagnosticResponse(BaseModel):
    """A single diagnostic response."""

    file_path: str
    line: int
    column: int
    end_line: int
    end_column: int
    message: str
    severity: str
    source: str | None = None
    code: str | None = None


class DiagnosticsResponse(BaseModel):
    """Response containing diagnostics for a file."""

    file_path: str
    diagnostics: list[DiagnosticResponse]
    language: str | None = None


class BatchDiagnosticsRequest(BaseModel):
    """Request for batch diagnostics."""

    file_paths: list[str]


class BatchDiagnosticsResponse(BaseModel):
    """Response containing diagnostics for multiple files."""

    results: list[DiagnosticsResponse]
    total_diagnostics: int


class StartWatchingRequest(BaseModel):
    """Request to start file watching."""

    patterns: list[str] | None = None
    debounce_ms: int = 500


class WatchStatusResponse(BaseModel):
    """Response with file watcher status."""

    workspace_id: str
    watching: bool
    patterns: list[str] | None = None


async def _proxy_to_compute(
    method: str,
    path: str,
    json_data: dict[str, Any] | None = None,
    params: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Proxy request to compute service.

    Args:
        method: HTTP method
        path: URL path (without base)
        json_data: JSON body data
        params: Query parameters

    Returns:
        Response data as dict

    Raises:
        HTTPException on error
    """
    url = f"{settings.COMPUTE_SERVICE_URL}{path}"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.request(
                method=method,
                url=url,
                json=json_data,
                params=params,
                headers={"X-Internal-Token": settings.INTERNAL_SERVICE_TOKEN or ""},
            )
            response.raise_for_status()
            result: dict[str, Any] = response.json()
            return result

    except httpx.ConnectError:
        logger.warning("Failed to connect to compute service", url=url)
        raise HTTPException(
            status_code=503,
            detail="Compute service unavailable",
        ) from None
    except httpx.TimeoutException:
        logger.warning("Compute service request timed out", url=url)
        raise HTTPException(
            status_code=504,
            detail="Compute service request timed out",
        ) from None
    except httpx.HTTPStatusError as e:
        logger.warning(
            "Compute service error",
            url=url,
            status=e.response.status_code,
            detail=e.response.text,
        )
        raise HTTPException(
            status_code=e.response.status_code,
            detail=e.response.json().get("detail", "Compute service error"),
        ) from None


@router.get("/workspaces/{workspace_id}/diagnostics", response_model=DiagnosticsResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_file_diagnostics(
    workspace_id: str,
    file_path: Annotated[str, Query(description="Path to the file relative to workspace root")],
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> DiagnosticsResponse:
    """Get diagnostics for a single file.

    Returns linting errors, warnings, and other diagnostics for the specified file.
    Supports TypeScript, JavaScript, Python, and Go.

    Args:
        workspace_id: The workspace ID
        file_path: Path to the file (relative to workspace root)

    Returns:
        Diagnostics for the file
    """
    # Verify access
    await verify_workspace_access(workspace_id, request, db)

    # Proxy to compute service
    result = await _proxy_to_compute(
        method="GET",
        path=f"/lsp/workspaces/{workspace_id}/diagnostics",
        params={"file_path": file_path},
    )

    return DiagnosticsResponse(**result)


@router.post(
    "/workspaces/{workspace_id}/diagnostics/batch", response_model=BatchDiagnosticsResponse
)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_batch_diagnostics(
    workspace_id: str,
    data: BatchDiagnosticsRequest,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> BatchDiagnosticsResponse:
    """Get diagnostics for multiple files.

    Args:
        workspace_id: The workspace ID
        data: Request containing list of file paths

    Returns:
        Diagnostics for all requested files
    """
    # Verify access
    await verify_workspace_access(workspace_id, request, db)

    # Proxy to compute service
    result = await _proxy_to_compute(
        method="POST",
        path=f"/lsp/workspaces/{workspace_id}/diagnostics/batch",
        json_data={"file_paths": data.file_paths},
    )

    return BatchDiagnosticsResponse(**result)


@router.get("/workspaces/{workspace_id}/supported-languages")
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_supported_languages(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, Any]:
    """Get list of supported languages for LSP features.

    Also checks which LSP servers are installed in the workspace.

    Args:
        workspace_id: The workspace ID

    Returns:
        Dictionary with supported languages and their installation status
    """
    # Verify access
    await verify_workspace_access(workspace_id, request, db)

    # Proxy to compute service
    return await _proxy_to_compute(
        method="GET",
        path=f"/lsp/workspaces/{workspace_id}/supported-languages",
    )


@router.post("/workspaces/{workspace_id}/watch", response_model=WatchStatusResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def start_file_watching(
    workspace_id: str,
    data: StartWatchingRequest,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> WatchStatusResponse:
    """Start watching files for changes in a workspace.

    When files change, diagnostics will be automatically refreshed.
    Subscribe to WebSocket events to receive real-time diagnostics updates.

    Args:
        workspace_id: The workspace ID
        data: Watch configuration (patterns, debounce)

    Returns:
        Watch status with active patterns
    """
    # Verify access
    await verify_workspace_access(workspace_id, request, db)

    # Proxy to compute service
    result = await _proxy_to_compute(
        method="POST",
        path=f"/lsp/workspaces/{workspace_id}/watch",
        json_data={"patterns": data.patterns, "debounce_ms": data.debounce_ms},
    )

    return WatchStatusResponse(**result)


@router.delete("/workspaces/{workspace_id}/watch", response_model=WatchStatusResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def stop_file_watching(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> WatchStatusResponse:
    """Stop watching files for changes in a workspace.

    Args:
        workspace_id: The workspace ID

    Returns:
        Watch status
    """
    # Verify access
    await verify_workspace_access(workspace_id, request, db)

    # Proxy to compute service
    result = await _proxy_to_compute(
        method="DELETE",
        path=f"/lsp/workspaces/{workspace_id}/watch",
    )

    return WatchStatusResponse(**result)


@router.get("/workspaces/{workspace_id}/watch/status", response_model=WatchStatusResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_watch_status(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> WatchStatusResponse:
    """Get file watcher status for a workspace.

    Args:
        workspace_id: The workspace ID

    Returns:
        Current watch status
    """
    # Verify access
    await verify_workspace_access(workspace_id, request, db)

    # Proxy to compute service
    result = await _proxy_to_compute(
        method="GET",
        path=f"/lsp/workspaces/{workspace_id}/watch/status",
    )

    return WatchStatusResponse(**result)
