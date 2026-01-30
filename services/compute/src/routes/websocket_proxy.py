"""WebSocket proxy for workspace HMR and dev server connections.

This module handles WebSocket proxying for:
- Hot Module Replacement (HMR) from Vite, webpack, etc.
- Live reload connections
- Any WebSocket-based dev server features
"""

import asyncio
import contextlib
from typing import Annotated

import structlog
import websockets
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, status
from websockets.asyncio.client import ClientConnection

from src.deps import get_compute_manager, verify_internal_api_key
from src.managers.base import ComputeManager
from src.models.workspace import WorkspaceStatus
from src.validation import ValidationError, validate_workspace_id

logger = structlog.get_logger()

router = APIRouter(
    prefix="/ws",
    tags=["websocket"],
    dependencies=[Depends(verify_internal_api_key)],
)


async def _forward_client_to_upstream(
    websocket: WebSocket,
    upstream: ClientConnection,
) -> None:
    """Forward messages from client to upstream."""
    try:
        while True:
            data = await websocket.receive()
            if "text" in data:
                await upstream.send(data["text"])
            elif "bytes" in data:
                await upstream.send(data["bytes"])
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug("Client to upstream error", error=str(e))


async def _forward_upstream_to_client(
    websocket: WebSocket,
    upstream: ClientConnection,
) -> None:
    """Forward messages from upstream to client."""
    try:
        async for message in upstream:
            if isinstance(message, str):
                await websocket.send_text(message)
            else:
                await websocket.send_bytes(message)
    except websockets.ConnectionClosed:
        pass
    except Exception as e:
        logger.debug("Upstream to client error", error=str(e))


async def _run_bidirectional_proxy(
    websocket: WebSocket,
    upstream: ClientConnection,
) -> None:
    """Run bidirectional WebSocket proxy."""
    client_task = asyncio.create_task(_forward_client_to_upstream(websocket, upstream))
    upstream_task = asyncio.create_task(_forward_upstream_to_client(websocket, upstream))

    _done, pending = await asyncio.wait(
        [client_task, upstream_task],
        return_when=asyncio.FIRST_COMPLETED,
    )

    for task in pending:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


async def _validate_workspace(
    compute: ComputeManager,
    websocket: WebSocket,
    workspace_id: str,
) -> bool:
    """Validate workspace exists and is running. Returns True if valid."""
    # Validate workspace_id to prevent path traversal and injection attacks
    try:
        validate_workspace_id(workspace_id)
    except ValidationError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid workspace ID")
        return False

    workspace = await compute.get_workspace(workspace_id)
    if not workspace:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Workspace not found")
        return False

    if workspace.status != WorkspaceStatus.RUNNING:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Workspace is not running",
        )
        return False

    return True


async def _handle_websocket_errors(
    websocket: WebSocket,
    workspace_id: str,
    port: int,
    error: Exception,
) -> None:
    """Handle WebSocket connection errors."""
    if isinstance(error, websockets.InvalidURI):
        logger.warning("Invalid WebSocket URI", workspace_id=workspace_id)
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid target URI")
    elif isinstance(error, websockets.InvalidHandshake):
        logger.warning("WebSocket handshake failed", error=str(error))
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Handshake failed")
    elif isinstance(error, ConnectionRefusedError):
        logger.warning(
            "WebSocket connection refused",
            workspace_id=workspace_id,
            port=port,
        )
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason=f"Could not connect to port {port}",
        )
    else:
        logger.exception("WebSocket proxy error", workspace_id=workspace_id, port=port)
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR, reason=str(error))


@router.websocket("/{workspace_id}/{port:int}")
async def websocket_proxy(
    websocket: WebSocket,
    workspace_id: str,
    port: int,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> None:
    """Proxy WebSocket connections to a workspace container.

    This enables HMR (Hot Module Replacement) and other real-time
    dev server features to work through the preview proxy.

    Common use cases:
    - Vite HMR (ws://localhost:5173)
    - webpack-dev-server HMR
    - Next.js Fast Refresh
    - Create React App live reload
    """
    await websocket.accept()

    if not await _validate_workspace(compute, websocket, workspace_id):
        return

    workspace = await compute.get_workspace(workspace_id)
    if not workspace or not workspace.host:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION, reason="Workspace not available"
        )
        return

    ws_url = f"ws://{workspace.host}:{port}"

    logger.info(
        "Establishing WebSocket proxy",
        workspace_id=workspace_id,
        port=port,
        target_url=ws_url,
    )

    try:
        async with websockets.connect(ws_url) as upstream:
            await _run_bidirectional_proxy(websocket, upstream)
    except Exception as e:
        await _handle_websocket_errors(websocket, workspace_id, port, e)
    finally:
        logger.debug(
            "WebSocket proxy closed",
            workspace_id=workspace_id,
            port=port,
        )


@router.websocket("/{workspace_id}/{port:int}/{path:path}")
async def websocket_proxy_with_path(
    websocket: WebSocket,
    workspace_id: str,
    port: int,
    path: str,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> None:
    """Proxy WebSocket connections with a specific path.

    Some dev servers use specific WebSocket paths:
    - Vite: /__vite_hmr or /_hmr
    - webpack: /ws
    - Next.js: /_next/webpack-hmr
    """
    await websocket.accept()

    if not await _validate_workspace(compute, websocket, workspace_id):
        return

    workspace = await compute.get_workspace(workspace_id)
    if not workspace or not workspace.host:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION, reason="Workspace not available"
        )
        return

    ws_url = f"ws://{workspace.host}:{port}/{path}"

    logger.info(
        "Establishing WebSocket proxy with path",
        workspace_id=workspace_id,
        port=port,
        path=path,
        target_url=ws_url,
    )

    try:
        async with websockets.connect(ws_url) as upstream:
            await _run_bidirectional_proxy(websocket, upstream)
    except Exception as e:
        await _handle_websocket_errors(websocket, workspace_id, port, e)
