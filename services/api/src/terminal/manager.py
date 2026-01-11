"""Terminal manager that proxies to compute service containers."""

import asyncio
import contextlib
import struct
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import structlog
import websockets
from websockets.asyncio.client import ClientConnection

from src.config import settings

logger = structlog.get_logger()


@dataclass
class TerminalSession:
    """Represents a proxied terminal session to the compute service."""

    workspace_id: str
    on_output: Callable[[str, str], Any] | None = None
    running: bool = True
    _websocket: ClientConnection | None = field(default=None, repr=False)
    _read_task: asyncio.Task[None] | None = field(default=None, repr=False)


class TerminalManager:
    """Manages terminal sessions by proxying to compute service containers."""

    def __init__(self) -> None:
        """Initialize terminal manager."""
        self.sessions: dict[str, TerminalSession] = {}
        self._lock = asyncio.Lock()

    def _get_compute_terminal_url(self, workspace_id: str) -> str:
        """Get the WebSocket URL for the compute service terminal."""
        # Convert HTTP URL to WebSocket URL
        compute_url = settings.COMPUTE_SERVICE_URL
        if compute_url.startswith("https://"):
            ws_url = compute_url.replace("https://", "wss://")
        else:
            ws_url = compute_url.replace("http://", "ws://")
        return f"{ws_url}/terminal/{workspace_id}"

    async def create_session(
        self,
        workspace_id: str,
        on_output: Callable[[str, str], Any],
    ) -> TerminalSession:
        """Create a new terminal session proxied to the compute service.

        Args:
            workspace_id: ID of the workspace.
            on_output: Callback function for terminal output.

        Returns:
            The created terminal session.

        Raises:
            RuntimeError: If connection to compute service fails.
        """
        async with self._lock:
            # Check if session already exists
            if workspace_id in self.sessions:
                session = self.sessions[workspace_id]
                session.on_output = on_output
                return session

            # Connect to compute service terminal WebSocket
            terminal_url = self._get_compute_terminal_url(workspace_id)
            logger.info(
                "Connecting to compute terminal",
                workspace_id=workspace_id,
                url=terminal_url,
            )

            try:
                websocket = await websockets.connect(
                    terminal_url,
                    ping_interval=20,
                    ping_timeout=10,
                    close_timeout=5,
                )
            except Exception as e:
                logger.exception(
                    "Failed to connect to compute terminal",
                    workspace_id=workspace_id,
                    error=str(e),
                )
                raise RuntimeError(f"Failed to connect to workspace terminal: {e}") from e  # noqa: TRY003

            session = TerminalSession(
                workspace_id=workspace_id,
                on_output=on_output,
                _websocket=websocket,
            )

            # Start read task to forward output from compute service
            session._read_task = asyncio.create_task(self._read_loop(session))  # noqa: SLF001

            self.sessions[workspace_id] = session

            logger.info(
                "Terminal session connected to compute",
                workspace_id=workspace_id,
            )

            return session

    async def write_input(self, workspace_id: str, data: str) -> bool:
        """Write input to a terminal session.

        Args:
            workspace_id: ID of the workspace.
            data: Input data to write.

        Returns:
            True if successful, False otherwise.
        """
        session = self.sessions.get(workspace_id)
        if not session or not session.running or not session._websocket:  # noqa: SLF001
            logger.warning("No active terminal session", workspace_id=workspace_id)
            return False

        try:
            await session._websocket.send(data)  # noqa: SLF001
        except Exception as e:
            logger.exception(
                "Failed to write to terminal",
                workspace_id=workspace_id,
                error=str(e),
            )
            return False
        else:
            return True

    async def resize(self, workspace_id: str, rows: int, cols: int) -> bool:
        """Resize a terminal session.

        Args:
            workspace_id: ID of the workspace.
            rows: Number of rows.
            cols: Number of columns.

        Returns:
            True if successful, False otherwise.
        """
        session = self.sessions.get(workspace_id)
        if not session or not session.running or not session._websocket:  # noqa: SLF001
            return False

        try:
            # Send resize command as binary: b'r' + rows (2 bytes) + cols (2 bytes)
            resize_cmd = b"r" + struct.pack(">H", rows) + struct.pack(">H", cols)
            await session._websocket.send(resize_cmd)  # noqa: SLF001
            logger.debug(
                "Terminal resize sent",
                workspace_id=workspace_id,
                rows=rows,
                cols=cols,
            )
        except Exception as e:
            logger.exception(
                "Failed to resize terminal",
                workspace_id=workspace_id,
                error=str(e),
            )
            return False
        else:
            return True

    async def close_session(self, workspace_id: str) -> bool:
        """Close a terminal session.

        Args:
            workspace_id: ID of the workspace.

        Returns:
            True if successful, False otherwise.
        """
        async with self._lock:
            session = self.sessions.get(workspace_id)
            if not session:
                return False

            session.running = False

            # Cancel read task
            if session._read_task:  # noqa: SLF001
                session._read_task.cancel()  # noqa: SLF001
                with contextlib.suppress(asyncio.CancelledError):
                    await session._read_task  # noqa: SLF001

            # Close WebSocket connection
            if session._websocket:  # noqa: SLF001
                with contextlib.suppress(Exception):
                    await session._websocket.close()  # noqa: SLF001

            del self.sessions[workspace_id]

            logger.info("Terminal session closed", workspace_id=workspace_id)
            return True

    async def _read_loop(self, session: TerminalSession) -> None:
        """Read output from compute terminal and send to callback.

        Args:
            session: The terminal session to read from.
        """
        if not session._websocket:  # noqa: SLF001
            return

        try:
            async for message in session._websocket:  # noqa: SLF001
                if not session.running:
                    break

                # Call output callback
                if session.on_output:
                    try:
                        if isinstance(message, bytes):
                            output = message.decode("utf-8", errors="replace")
                        else:
                            output = message
                        await session.on_output(session.workspace_id, output)
                    except Exception as e:
                        logger.exception("Output callback failed", error=str(e))

        except websockets.ConnectionClosed:
            logger.info("Terminal WebSocket closed", workspace_id=session.workspace_id)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.exception(
                "Terminal read loop error",
                workspace_id=session.workspace_id,
                error=str(e),
            )
        finally:
            session.running = False


# Global terminal manager instance
terminal_manager = TerminalManager()
