"""Terminal manager that proxies to compute service containers.

Supports tmux session persistence - sessions survive disconnections
and can be reconnected.
"""

import asyncio
import contextlib
import inspect
import ssl
import struct
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import structlog
import websockets
from websockets.asyncio.client import ClientConnection

from src.config import settings

logger = structlog.get_logger()

# Session cleanup configuration
SESSION_MAX_IDLE_HOURS = 24  # Clean up sessions idle for more than 24 hours
SESSION_CLEANUP_INTERVAL = 3600  # Run cleanup every hour


@dataclass
class TerminalSession:
    """Represents a proxied terminal session to the compute service."""

    workspace_id: str
    session_id: str  # Unique session identifier for tmux
    on_output: Callable[[str, str], Any] | None = None
    running: bool = True
    _websocket: ClientConnection | None = field(default=None, repr=False)
    _read_task: asyncio.Task[None] | None = field(default=None, repr=False)
    # Track session activity for cleanup
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    last_activity: datetime = field(default_factory=lambda: datetime.now(UTC))


class TerminalManager:
    """Manages terminal sessions by proxying to compute service containers.

    Each session is identified by a unique session_id, which maps to a tmux
    session in the workspace container. This allows:
    - Multiple independent terminal sessions per workspace
    - Session persistence across WebSocket reconnections
    - Running processes survive brief disconnections
    """

    def __init__(self) -> None:
        """Initialize terminal manager."""
        # Key is session_id (not workspace_id) to support multiple sessions per workspace
        self.sessions: dict[str, TerminalSession] = {}
        self._lock = asyncio.Lock()
        self._cleanup_task: asyncio.Task[None] | None = None

    async def start_cleanup_task(self) -> None:
        """Start the background cleanup task for stale sessions.

        Call this during application startup.
        """
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())
            logger.info("Terminal session cleanup task started")

    async def stop_cleanup_task(self) -> None:
        """Stop the background cleanup task.

        Call this during application shutdown.
        """
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._cleanup_task
            logger.info("Terminal session cleanup task stopped")

    async def _cleanup_loop(self) -> None:
        """Background loop that periodically cleans up stale sessions."""
        while True:
            try:
                await asyncio.sleep(SESSION_CLEANUP_INTERVAL)
                await self._cleanup_stale_sessions()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.exception("Error in terminal cleanup loop", error=str(e))

    async def _cleanup_stale_sessions(self) -> None:
        """Clean up sessions that have been idle for too long.

        SECURITY/PERFORMANCE: Prevents memory leaks from accumulated
        abandoned sessions.
        """
        now = datetime.now(UTC)
        max_idle = timedelta(hours=SESSION_MAX_IDLE_HOURS)
        stale_sessions: list[str] = []

        async with self._lock:
            for session_id, session in self.sessions.items():
                # Check if session is stale
                idle_time = now - session.last_activity
                if idle_time > max_idle or not session.running:
                    stale_sessions.append(session_id)

            # Clean up stale sessions
            for session_id in stale_sessions:
                terminal_session = self.sessions.get(session_id)
                if terminal_session:
                    await self._cleanup_session(terminal_session)
                    del self.sessions[session_id]
                    logger.info(
                        "Cleaned up stale terminal session",
                        session_id=session_id,
                        workspace_id=terminal_session.workspace_id,
                        idle_hours=(now - terminal_session.last_activity).total_seconds() / 3600,
                    )

        if stale_sessions:
            logger.info(
                "Terminal cleanup completed",
                cleaned_sessions=len(stale_sessions),
                remaining_sessions=len(self.sessions),
            )

    def _get_compute_terminal_url(
        self, workspace_id: str, session_id: str | None = None, shell: str = "bash"
    ) -> str:
        """Get the WebSocket URL for the compute service terminal.

        Args:
            workspace_id: ID of the workspace container.
            session_id: Optional session ID for tmux session persistence.
            shell: Shell to use for the terminal (bash, zsh, fish).

        Returns:
            WebSocket URL for the terminal endpoint.
        """
        # Convert HTTP URL to WebSocket URL
        compute_url = settings.COMPUTE_SERVICE_URL
        if compute_url.startswith("https://"):
            ws_url = compute_url.replace("https://", "wss://")
        else:
            ws_url = compute_url.replace("http://", "ws://")

        url = f"{ws_url}/terminal/{workspace_id}"

        # Build query parameters
        params = {"shell": shell}
        if session_id:
            params["session_id"] = session_id
        return f"{url}?{urlencode(params)}"

    async def create_session(
        self,
        workspace_id: str,
        on_output: Callable[[str, str], Any],
        session_id: str | None = None,
        shell: str = "bash",
    ) -> TerminalSession:
        """Create or reconnect to a terminal session.

        Args:
            workspace_id: ID of the workspace.
            on_output: Callback function for terminal output.
            session_id: Optional unique session ID. If provided, creates a named
                       tmux session that can be reconnected. If not provided,
                       uses workspace_id as session ID.
            shell: Shell to use for the terminal (bash, zsh, fish).

        Returns:
            The created or reconnected terminal session.

        Raises:
            RuntimeError: If connection to compute service fails.
        """
        # Use session_id if provided, otherwise use workspace_id
        effective_session_id = session_id or workspace_id

        async with self._lock:
            # Check if we already have a connection for this session
            if effective_session_id in self.sessions:
                session = self.sessions[effective_session_id]
                if session.running and session._websocket:
                    session.on_output = on_output
                    logger.info(
                        "Reusing existing terminal connection",
                        workspace_id=workspace_id,
                        session_id=effective_session_id,
                    )
                    return session
                # Session exists but not running, clean up
                await self._cleanup_session(session)
                del self.sessions[effective_session_id]

            # Connect to compute service terminal WebSocket
            terminal_url = self._get_compute_terminal_url(workspace_id, effective_session_id, shell)
            logger.info(
                "Connecting to compute terminal",
                workspace_id=workspace_id,
                session_id=effective_session_id,
                url=terminal_url,
            )

            try:
                # SECURITY: Add SSL context for TLS verification on HTTPS/WSS connections
                ssl_context = None
                if terminal_url.startswith("wss://"):
                    ssl_context = ssl.create_default_context()
                    # In production, verify certificates; in dev, may use self-signed
                    if settings.ENVIRONMENT != "development":
                        ssl_context.verify_mode = ssl.CERT_REQUIRED

                headers: dict[str, str] = {}
                if settings.COMPUTE_INTERNAL_API_KEY:
                    headers["X-Internal-API-Key"] = settings.COMPUTE_INTERNAL_API_KEY

                connect_kwargs: dict[str, Any] = {
                    "ping_interval": 20,
                    "ping_timeout": 10,
                    "close_timeout": 5,
                    "ssl": ssl_context,
                }
                if headers:
                    connect_params = inspect.signature(websockets.connect).parameters
                    if "additional_headers" in connect_params:
                        connect_kwargs["additional_headers"] = headers
                    else:
                        connect_kwargs["extra_headers"] = headers

                websocket = await websockets.connect(
                    terminal_url,
                    **connect_kwargs,
                )
            except Exception as e:
                logger.exception(
                    "Failed to connect to compute terminal",
                    workspace_id=workspace_id,
                    session_id=effective_session_id,
                    error=str(e),
                )
                raise RuntimeError("Terminal connection failed") from e  # noqa: TRY003

            session = TerminalSession(
                workspace_id=workspace_id,
                session_id=effective_session_id,
                on_output=on_output,
                _websocket=websocket,
            )

            # Start read task to forward output from compute service
            session._read_task = asyncio.create_task(self._read_loop(session))

            self.sessions[effective_session_id] = session

            logger.info(
                "Terminal session connected to compute (tmux)",
                workspace_id=workspace_id,
                session_id=effective_session_id,
            )

            return session

    async def _cleanup_session(self, session: TerminalSession) -> None:
        """Clean up a terminal session without removing from dict."""
        session.running = False
        if session._read_task:
            session._read_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await session._read_task
        if session._websocket:
            with contextlib.suppress(Exception):
                await session._websocket.close()

    async def write_input(self, session_id: str, data: str) -> bool:
        """Write input to a terminal session.

        Args:
            session_id: Session ID (or workspace_id if no session_id was provided).
            data: Input data to write.

        Returns:
            True if successful, False otherwise.
        """
        session = self.sessions.get(session_id)
        if not session or not session.running or not session._websocket:
            logger.warning("No active terminal session", session_id=session_id)
            return False

        try:
            await session._websocket.send(data)
            # Update last activity time
            session.last_activity = datetime.now(UTC)
        except Exception as e:
            logger.exception(
                "Failed to write to terminal",
                session_id=session_id,
                error=str(e),
            )
            return False
        else:
            return True

    async def resize(self, session_id: str, rows: int, cols: int) -> bool:
        """Resize a terminal session.

        Args:
            session_id: Session ID.
            rows: Number of rows.
            cols: Number of columns.

        Returns:
            True if successful, False otherwise.
        """
        session = self.sessions.get(session_id)
        if not session or not session.running or not session._websocket:
            return False

        try:
            # Send resize command as binary: b'r' + rows (2 bytes) + cols (2 bytes)
            resize_cmd = b"r" + struct.pack(">H", rows) + struct.pack(">H", cols)
            await session._websocket.send(resize_cmd)
            logger.debug(
                "Terminal resize sent",
                session_id=session_id,
                rows=rows,
                cols=cols,
            )
        except Exception as e:
            logger.exception(
                "Failed to resize terminal",
                session_id=session_id,
                error=str(e),
            )
            return False
        else:
            return True

    async def close_session(self, session_id: str) -> bool:
        """Close a terminal session (WebSocket only - tmux keeps running).

        This closes the WebSocket connection but the tmux session in the
        container keeps running. Call kill_session to fully terminate.

        Args:
            session_id: Session ID.

        Returns:
            True if successful, False otherwise.
        """
        async with self._lock:
            session = self.sessions.get(session_id)
            if not session:
                return False

            await self._cleanup_session(session)
            del self.sessions[session_id]

            logger.info(
                "Terminal session closed (tmux persists)",
                session_id=session_id,
                workspace_id=session.workspace_id,
            )
            return True

    async def _read_loop(self, session: TerminalSession) -> None:
        """Read output from compute terminal and send to callback.

        Args:
            session: The terminal session to read from.
        """
        if not session._websocket:
            return

        try:
            async for message in session._websocket:
                if not session.running:
                    break

                # Call output callback
                if session.on_output:
                    try:
                        if isinstance(message, bytes):
                            output = message.decode("utf-8", errors="replace")
                        else:
                            output = message
                        await session.on_output(session.session_id, output)
                    except Exception as e:
                        logger.exception("Output callback failed", error=str(e))

        except websockets.ConnectionClosed:
            logger.info(
                "Terminal WebSocket closed",
                session_id=session.session_id,
                workspace_id=session.workspace_id,
            )
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.exception(
                "Terminal read loop error",
                session_id=session.session_id,
                error=str(e),
            )
        finally:
            session.running = False


# Global terminal manager instance
terminal_manager = TerminalManager()
