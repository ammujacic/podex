"""Terminal WebSocket endpoint for interactive shell sessions in workspace containers."""

import asyncio
import contextlib
import struct
from typing import Annotated, Any

import docker
import structlog
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, status

from src.deps import get_compute_manager
from src.managers.base import ComputeManager
from src.models.workspace import WorkspaceStatus

logger = structlog.get_logger()

router = APIRouter(prefix="/terminal", tags=["terminal"])


class DockerTerminalSession:
    """Manages an interactive terminal session in a Docker container."""

    def __init__(self, container_id: str, workspace_id: str) -> None:
        self.container_id = container_id
        self.workspace_id = workspace_id
        self.client = docker.from_env()
        self.exec_id: str | None = None
        self.socket: Any = None
        self._running = False

    async def start(self) -> bool:
        """Start the terminal session by creating an exec instance."""
        try:
            # Create exec instance with TTY
            exec_instance = await asyncio.to_thread(
                self.client.api.exec_create,
                self.container_id,
                cmd="/bin/bash",
                stdin=True,
                stdout=True,
                stderr=True,
                tty=True,
                workdir="/home/dev",
            )
            self.exec_id = exec_instance["Id"]

            # Start the exec and get the socket
            self.socket = await asyncio.to_thread(
                self.client.api.exec_start,
                self.exec_id,
                socket=True,
                tty=True,
            )

            self._running = True
            logger.info(
                "Terminal session started",
                workspace_id=self.workspace_id,
                exec_id=self.exec_id[:12] if self.exec_id else None,
            )
            return True
        except Exception as e:
            logger.exception(
                "Failed to start terminal session",
                workspace_id=self.workspace_id,
                error=str(e),
            )
            return False

    async def write(self, data: bytes) -> bool:
        """Write data to the terminal."""
        if not self.socket or not self._running:
            return False
        try:
            # Access the underlying socket
            sock = self.socket._sock
            await asyncio.to_thread(sock.sendall, data)
            return True
        except Exception as e:
            logger.warning(
                "Failed to write to terminal",
                workspace_id=self.workspace_id,
                error=str(e),
            )
            return False

    async def read(self, size: int = 4096) -> bytes | None:
        """Read data from the terminal."""
        if not self.socket or not self._running:
            return None
        try:
            sock = self.socket._sock
            # Make socket non-blocking for async read
            sock.setblocking(False)
            try:
                data = await asyncio.get_event_loop().run_in_executor(None, lambda: sock.recv(size))
                return data if data else None
            except BlockingIOError:
                return b""
        except Exception as e:
            logger.warning(
                "Failed to read from terminal",
                workspace_id=self.workspace_id,
                error=str(e),
            )
            return None

    async def resize(self, rows: int, cols: int) -> bool:
        """Resize the terminal."""
        if not self.exec_id or not self._running:
            return False
        try:
            await asyncio.to_thread(
                self.client.api.exec_resize,
                self.exec_id,
                height=rows,
                width=cols,
            )
            logger.debug(
                "Terminal resized",
                workspace_id=self.workspace_id,
                rows=rows,
                cols=cols,
            )
            return True
        except Exception as e:
            logger.warning(
                "Failed to resize terminal",
                workspace_id=self.workspace_id,
                error=str(e),
            )
            return False

    async def close(self) -> None:
        """Close the terminal session."""
        self._running = False
        if self.socket:
            with contextlib.suppress(Exception):
                self.socket._sock.close()
        logger.info("Terminal session closed", workspace_id=self.workspace_id)

    @property
    def running(self) -> bool:
        return self._running


async def _validate_workspace_for_terminal(  # noqa: PLR0911
    compute: ComputeManager,
    websocket: WebSocket,
    workspace_id: str,
) -> tuple[bool, str | None]:
    """Validate workspace exists and is running. Returns (valid, container_id)."""
    # First try to get workspace from compute manager's registry
    workspace = await compute.get_workspace(workspace_id)
    if workspace:
        if workspace.status != WorkspaceStatus.RUNNING:
            logger.warning(
                "Workspace not running",
                workspace_id=workspace_id,
                status=workspace.status,
            )
            await websocket.close(
                code=status.WS_1008_POLICY_VIOLATION,
                reason="Workspace is not running",
            )
            return False, None

        if not workspace.container_id:
            logger.warning("Workspace has no container", workspace_id=workspace_id)
            await websocket.close(
                code=status.WS_1008_POLICY_VIOLATION,
                reason="Workspace has no container",
            )
            return False, None

        return True, workspace.container_id

    # Workspace not in registry - try to find container by name directly
    # This handles cases where compute service restarted but container is still running
    try:
        client = docker.from_env()
        container_name = f"podex-workspace-{workspace_id}"
        container = client.containers.get(container_name)

        if container.status != "running":
            logger.warning(
                "Container not running",
                workspace_id=workspace_id,
                container_status=container.status,
            )
            await websocket.close(
                code=status.WS_1008_POLICY_VIOLATION,
                reason="Workspace container is not running",
            )
            return False, None

        logger.info(
            "Found container directly (not in registry)",
            workspace_id=workspace_id,
            container_id=container.id[:12] if container.id else None,
        )
        return True, container.id

    except docker.errors.NotFound:
        logger.warning("Workspace container not found", workspace_id=workspace_id)
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Workspace not found")
        return False, None
    except Exception as e:
        logger.exception(
            "Error finding workspace container",
            workspace_id=workspace_id,
            error=str(e),
        )
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR, reason="Failed to find workspace")
        return False, None


@router.websocket("/{workspace_id}")
async def terminal_websocket(  # noqa: PLR0915
    websocket: WebSocket,
    workspace_id: str,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> None:
    """Interactive terminal WebSocket endpoint.

    Protocol:
    - Text messages: Terminal input (sent to container)
    - Binary messages with prefix:
      - b'r' + JSON: Resize command {"rows": N, "cols": M}
    - Server sends text messages with terminal output
    """
    await websocket.accept()

    valid, container_id = await _validate_workspace_for_terminal(compute, websocket, workspace_id)
    if not valid or not container_id:
        return

    logger.info(
        "Terminal WebSocket connected",
        workspace_id=workspace_id,
        container_id=container_id[:12],
    )

    # Create terminal session
    session = DockerTerminalSession(container_id, workspace_id)
    if not await session.start():
        await websocket.close(
            code=status.WS_1011_INTERNAL_ERROR,
            reason="Failed to start terminal session",
        )
        return

    async def read_from_container() -> None:
        """Read output from container and send to websocket."""
        while session.running:
            try:
                data = await session.read()
                if data is None:
                    break
                if data:
                    await websocket.send_bytes(data)
                else:
                    # No data available, brief sleep
                    await asyncio.sleep(0.01)
            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.debug("Read error", error=str(e))
                break

    async def write_to_container() -> None:
        """Read from websocket and write to container."""
        while session.running:
            try:
                message = await websocket.receive()

                if "text" in message:
                    # Text input from terminal
                    data = message["text"].encode("utf-8")
                    await session.write(data)
                elif "bytes" in message:
                    raw = message["bytes"]
                    if raw and raw[0:1] == b"r":
                        # Resize command: b'r' + 4 bytes rows (uint16) + 4 bytes cols (uint16)
                        resize_cmd_min_len = 5
                        if len(raw) >= resize_cmd_min_len:
                            rows = struct.unpack(">H", raw[1:3])[0]
                            cols = struct.unpack(">H", raw[3:5])[0]
                            await session.resize(rows, cols)
                    else:
                        # Raw binary input
                        await session.write(raw)
            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.debug("Write error", error=str(e))
                break

    # Run read and write tasks concurrently
    read_task = asyncio.create_task(read_from_container())
    write_task = asyncio.create_task(write_to_container())

    try:
        await asyncio.gather(read_task, write_task, return_exceptions=True)
    finally:
        # Cancel any pending tasks
        for task in [read_task, write_task]:
            if not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

        await session.close()
        logger.info("Terminal WebSocket closed", workspace_id=workspace_id)
