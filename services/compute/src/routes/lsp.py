"""LSP (Language Server Protocol) routes for workspace containers.

Provides endpoints for getting code diagnostics and other LSP features.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from src.deps import OrchestratorSingleton, get_compute_manager, verify_internal_api_key
from src.managers.lsp_manager import (
    LSP_SERVER_COMMANDS,
    LSPDiagnostic,
    get_lsp_manager,
)
from src.models.workspace import WorkspaceStatus

if TYPE_CHECKING:
    from docker.models.containers import Container

    from src.managers.base import ComputeManager

logger = structlog.get_logger()

router = APIRouter(
    prefix="/lsp",
    tags=["lsp"],
    dependencies=[Depends(verify_internal_api_key)],
)


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


def _diagnostic_to_response(diag: LSPDiagnostic) -> DiagnosticResponse:
    """Convert LSPDiagnostic to DiagnosticResponse."""
    return DiagnosticResponse(
        file_path=diag.file_path,
        line=diag.line,
        column=diag.column,
        end_line=diag.end_line,
        end_column=diag.end_column,
        message=diag.message,
        severity=diag.severity,
        source=diag.source,
        code=diag.code,
    )


async def _get_workspace_container(
    workspace_id: str,
    compute_manager: ComputeManager,
) -> Container:
    """Get the Docker container for a workspace.

    Uses the workspace's server_id to get the correct Docker client from
    the MultiServerDockerManager, then retrieves the container.

    Args:
        workspace_id: The workspace ID
        compute_manager: The compute manager

    Returns:
        The Docker container object

    Raises:
        HTTPException: If workspace not found, not running, or container unavailable
    """
    workspace = await compute_manager.get_workspace(workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    if workspace.status != WorkspaceStatus.RUNNING:
        raise HTTPException(
            status_code=400,
            detail=f"Workspace is not running (status: {workspace.status})",
        )

    if not workspace.server_id or not workspace.container_id:
        raise HTTPException(
            status_code=404,
            detail="Workspace has no server or container assigned",
        )

    # Get Docker client for the workspace's server
    docker_manager = OrchestratorSingleton.get_docker_manager()
    docker_client = docker_manager.get_client(workspace.server_id)
    if not docker_client:
        logger.error(
            "No Docker client available for server",
            workspace_id=workspace_id,
            server_id=workspace.server_id,
        )
        raise HTTPException(
            status_code=503,
            detail="Workspace server not available",
        )

    try:
        container = await asyncio.to_thread(
            docker_client.containers.get,
            workspace.container_id,
        )
        return container
    except Exception as e:
        logger.error(
            "Failed to get container",
            workspace_id=workspace_id,
            container_id=workspace.container_id,
            error=str(e),
        )
        raise HTTPException(
            status_code=404,
            detail="Workspace container not found",
        ) from e


@router.get("/workspaces/{workspace_id}/diagnostics", response_model=DiagnosticsResponse)
async def get_file_diagnostics(
    workspace_id: str,
    file_path: Annotated[str, Query(description="Path to the file relative to workspace root")],
    compute_manager: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> DiagnosticsResponse:
    """Get diagnostics for a single file.

    Returns linting errors, warnings, and other diagnostics for the specified file.
    Supports TypeScript, JavaScript, Python, and Go.

    Args:
        workspace_id: The workspace ID
        file_path: Path to the file (relative to workspace root, e.g., "src/index.ts")
        compute_manager: Injected compute manager

    Returns:
        Diagnostics for the file
    """
    container = await _get_workspace_container(workspace_id, compute_manager)

    lsp_manager = get_lsp_manager()
    language = lsp_manager.get_language_for_file(file_path)

    diagnostics = await lsp_manager.get_diagnostics(
        workspace_id=workspace_id,
        container=container,
        file_path=file_path,
    )

    return DiagnosticsResponse(
        file_path=file_path,
        diagnostics=[_diagnostic_to_response(d) for d in diagnostics],
        language=language,
    )


@router.post(
    "/workspaces/{workspace_id}/diagnostics/batch", response_model=BatchDiagnosticsResponse
)
async def get_batch_diagnostics(
    workspace_id: str,
    request: BatchDiagnosticsRequest,
    compute_manager: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> BatchDiagnosticsResponse:
    """Get diagnostics for multiple files.

    Args:
        workspace_id: The workspace ID
        request: Request containing list of file paths
        compute_manager: Injected compute manager

    Returns:
        Diagnostics for all requested files
    """
    container = await _get_workspace_container(workspace_id, compute_manager)

    lsp_manager = get_lsp_manager()
    results: list[DiagnosticsResponse] = []
    total_diagnostics = 0

    for file_path in request.file_paths:
        language = lsp_manager.get_language_for_file(file_path)
        diagnostics = await lsp_manager.get_diagnostics(
            workspace_id=workspace_id,
            container=container,
            file_path=file_path,
        )
        total_diagnostics += len(diagnostics)
        results.append(
            DiagnosticsResponse(
                file_path=file_path,
                diagnostics=[_diagnostic_to_response(d) for d in diagnostics],
                language=language,
            )
        )

    return BatchDiagnosticsResponse(
        results=results,
        total_diagnostics=total_diagnostics,
    )


class StartWatchingRequest(BaseModel):
    """Request to start file watching."""

    patterns: list[str] | None = None
    debounce_ms: int = 500


class WatchStatusResponse(BaseModel):
    """Response with file watcher status."""

    workspace_id: str
    watching: bool
    patterns: list[str] | None = None


@router.post("/workspaces/{workspace_id}/watch", response_model=WatchStatusResponse)
async def start_file_watching(
    workspace_id: str,
    request: StartWatchingRequest,
    compute_manager: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> WatchStatusResponse:
    """Start watching files for changes in a workspace.

    When files change, diagnostics will be automatically refreshed.

    Args:
        workspace_id: The workspace ID
        request: Watch configuration (patterns, debounce)
        compute_manager: Injected compute manager

    Returns:
        Watch status with active patterns
    """
    container = await _get_workspace_container(workspace_id, compute_manager)

    lsp_manager = get_lsp_manager()

    watcher = await lsp_manager.start_file_watching(
        workspace_id=workspace_id,
        container=container,
        patterns=request.patterns,
    )

    return WatchStatusResponse(
        workspace_id=workspace_id,
        watching=True,
        patterns=watcher.watch_patterns,
    )


@router.delete("/workspaces/{workspace_id}/watch", response_model=WatchStatusResponse)
async def stop_file_watching(
    workspace_id: str,
    compute_manager: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> WatchStatusResponse:
    """Stop watching files for changes in a workspace.

    Args:
        workspace_id: The workspace ID
        compute_manager: Injected compute manager

    Returns:
        Watch status
    """
    # Get workspace info (even if not running, allow stopping watch)
    workspace = await compute_manager.get_workspace(workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    lsp_manager = get_lsp_manager()
    await lsp_manager.stop_file_watching(workspace_id)

    return WatchStatusResponse(
        workspace_id=workspace_id,
        watching=False,
        patterns=None,
    )


@router.get("/workspaces/{workspace_id}/watch/status", response_model=WatchStatusResponse)
async def get_watch_status(
    workspace_id: str,
    compute_manager: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> WatchStatusResponse:
    """Get file watcher status for a workspace.

    Args:
        workspace_id: The workspace ID
        compute_manager: Injected compute manager

    Returns:
        Current watch status
    """
    workspace = await compute_manager.get_workspace(workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    lsp_manager = get_lsp_manager()
    watcher = lsp_manager.file_watcher._watchers.get(workspace_id)

    if watcher and watcher._running:
        return WatchStatusResponse(
            workspace_id=workspace_id,
            watching=True,
            patterns=watcher.watch_patterns,
        )

    return WatchStatusResponse(
        workspace_id=workspace_id,
        watching=False,
        patterns=None,
    )


@router.get("/workspaces/{workspace_id}/supported-languages")
async def get_supported_languages(
    workspace_id: str,
    compute_manager: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> dict[str, Any]:
    """Get list of supported languages for LSP features.

    Also checks which LSP servers are installed in the workspace.

    Args:
        workspace_id: The workspace ID
        compute_manager: Injected compute manager

    Returns:
        Dictionary with supported languages and their installation status
    """
    container = await _get_workspace_container(workspace_id, compute_manager)

    # Check which LSP servers are installed
    languages: dict[str, dict[str, Any]] = {}

    for language, command in LSP_SERVER_COMMANDS.items():
        check_cmd = f"which {command[0]} 2>/dev/null && echo 'installed' || echo 'not_installed'"
        result = await asyncio.to_thread(
            container.exec_run,
            ["sh", "-c", check_cmd],
            demux=True,
        )
        stdout = (result.output[0] or b"").decode("utf-8", errors="replace").strip()
        installed = "installed" in stdout

        languages[language] = {
            "command": command[0],
            "installed": installed,
            "extensions": [
                ext
                for ext, lang in __import__(
                    "src.managers.lsp_manager", fromlist=["EXTENSION_TO_LANGUAGE"]
                ).EXTENSION_TO_LANGUAGE.items()
                if lang == language
            ],
        }

    return {
        "workspace_id": workspace_id,
        "languages": languages,
    }
