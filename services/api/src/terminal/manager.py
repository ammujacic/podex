"""Terminal manager that proxies to compute service containers or local pods.

Supports tmux session persistence - sessions survive disconnections
and can be reconnected.

For cloud workspaces: Uses WebSocket to compute service
For local pod workspaces: Uses RPC via Socket.IO
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
    is_local_pod: bool = False  # True if this is a local pod session
    _websocket: ClientConnection | None = field(default=None, repr=False)
    _read_task: asyncio.Task[None] | None = field(default=None, repr=False)
    # Track session activity for cleanup
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    last_activity: datetime = field(default_factory=lambda: datetime.now(UTC))
    # Local pod specific fields
    working_dir: str | None = None  # Actual working directory for local pods


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
        command: str | None = None,
    ) -> TerminalSession:
        """Create or reconnect to a terminal session.

        Args:
            workspace_id: ID of the workspace.
            on_output: Callback function for terminal output.
            session_id: Optional unique session ID. If provided, creates a named
                       tmux session that can be reconnected. If not provided,
                       uses workspace_id as session ID.
            shell: Shell to use for the terminal (bash, zsh, fish).
            command: Optional command to run instead of interactive shell.
                    If provided, tmux starts directly running this command.

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
                if session.running:
                    # For cloud workspaces, check if websocket is active
                    if not session.is_local_pod and session._websocket:
                        session.on_output = on_output
                        logger.info(
                            "Reusing existing terminal connection (cloud)",
                            workspace_id=workspace_id,
                            session_id=effective_session_id,
                        )
                        return session
                    # For local pods, always re-call terminal.create to ensure
                    # the output streaming loop is running on the pod
                    if session.is_local_pod:
                        session.on_output = on_output
                        logger.info(
                            "Re-activating local pod terminal session",
                            workspace_id=workspace_id,
                            session_id=effective_session_id,
                        )
                        # Call terminal.create on local pod to restart output loop
                        await self._ensure_local_pod_output_loop(session, shell)
                        return session
                # Session exists but not running, clean up
                await self._cleanup_session(session)
                del self.sessions[effective_session_id]

            # Check if workspace is on a local pod
            is_local_pod = await self._check_is_local_pod(workspace_id)

            if is_local_pod:
                return await self._create_local_pod_session(
                    workspace_id, effective_session_id, on_output, shell, command
                )

            # Connect to compute service terminal WebSocket (cloud workspaces)
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
                if settings.INTERNAL_SERVICE_TOKEN:
                    headers["X-Internal-Service-Token"] = settings.INTERNAL_SERVICE_TOKEN

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
                is_local_pod=False,
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

    async def _check_is_local_pod(self, workspace_id: str) -> bool:
        """Check if a workspace is running on a local pod."""
        # Import here to avoid circular imports
        from src.services.workspace_router import workspace_router  # noqa: PLC0415

        return await workspace_router.is_local_pod_workspace(workspace_id)

    async def _create_local_pod_session(
        self,
        workspace_id: str,
        session_id: str,
        on_output: Callable[[str, str], Any],
        shell: str,
        command: str | None = None,
    ) -> TerminalSession:
        """Create a terminal session for a local pod workspace.

        Uses RPC to create a tmux session on the local pod.
        Terminal output is streamed via Socket.IO events.

        Args:
            workspace_id: ID of the workspace.
            session_id: Unique session ID for tmux.
            on_output: Callback for terminal output.
            shell: Shell to use (if command not provided).
            command: Optional command to run instead of interactive shell.
        """
        # Import here to avoid circular imports
        from src.services.workspace_router import workspace_router  # noqa: PLC0415

        logger.info(
            "Creating local pod terminal session",
            workspace_id=workspace_id,
            session_id=session_id,
            shell=shell,
            has_command=command is not None,
        )

        try:
            # Create terminal session via RPC
            result = await workspace_router.terminal_create(
                workspace_id=workspace_id,
                user_id="",  # Not needed for local pod
                session_id=session_id,
                shell=shell,
                command=command,  # Pass command to run directly
            )

            working_dir = result.get("working_dir", ".")

            session = TerminalSession(
                workspace_id=workspace_id,
                session_id=session_id,
                on_output=on_output,
                is_local_pod=True,
                running=True,
                working_dir=working_dir,
            )

            self.sessions[session_id] = session

            logger.info(
                "Local pod terminal session created",
                workspace_id=workspace_id,
                session_id=session_id,
                working_dir=working_dir,
            )

            return session  # noqa: TRY300

        except Exception as e:
            logger.exception(
                "Failed to create local pod terminal session",
                workspace_id=workspace_id,
                session_id=session_id,
                error=str(e),
            )
            raise RuntimeError("Local pod terminal connection failed") from e  # noqa: TRY003

    async def _ensure_local_pod_output_loop(self, session: TerminalSession, shell: str) -> None:
        """Ensure the output streaming loop is running on the local pod.

        Called when re-activating an existing local pod session to make sure
        the pod is streaming terminal output. This handles cases where:
        - The pod was restarted
        - The output loop ended due to inactivity
        - The client reconnected after disconnect
        """
        from src.services.workspace_router import workspace_router  # noqa: PLC0415

        try:
            # Call terminal.create on local pod - it handles idempotently:
            # - If tmux session exists, it just restarts the output loop
            # - If tmux session doesn't exist, it creates it
            await workspace_router.terminal_create(
                workspace_id=session.workspace_id,
                user_id="",
                session_id=session.session_id,
                shell=shell,
            )
            logger.info(
                "Local pod output loop re-activated",
                workspace_id=session.workspace_id,
                session_id=session.session_id,
            )
        except Exception as e:
            logger.warning(
                "Failed to re-activate local pod output loop",
                workspace_id=session.workspace_id,
                session_id=session.session_id,
                error=str(e),
            )

    async def register_local_pod_session(
        self,
        workspace_id: str,
        session_id: str,
        working_dir: str | None = None,
        on_output: Callable[[str, str], Any] | None = None,
    ) -> TerminalSession:
        """Register an existing local pod terminal session for output routing.

        Used when a terminal session is created directly on the local pod (e.g., via
        Claude resume) rather than through the normal terminal_manager.create_session
        flow. This allows the terminal manager to route output from the pod to clients.

        Args:
            workspace_id: ID of the workspace.
            session_id: Unique session ID for the tmux session on the pod.
            working_dir: Working directory of the session.
            on_output: Optional callback for terminal output.

        Returns:
            The registered TerminalSession.
        """
        async with self._lock:
            # Check if session already exists
            if session_id in self.sessions:
                existing = self.sessions[session_id]
                if existing.running:
                    logger.info(
                        "Local pod session already registered",
                        workspace_id=workspace_id,
                        session_id=session_id,
                    )
                    if on_output:
                        existing.on_output = on_output
                    return existing
                # Session exists but not running, clean it up
                await self._cleanup_session(existing)
                del self.sessions[session_id]

            session = TerminalSession(
                workspace_id=workspace_id,
                session_id=session_id,
                on_output=on_output,
                is_local_pod=True,
                running=True,
                working_dir=working_dir,
            )

            self.sessions[session_id] = session

            logger.info(
                "Registered local pod terminal session",
                workspace_id=workspace_id,
                session_id=session_id,
                working_dir=working_dir,
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
        if not session or not session.running:
            logger.warning("No active terminal session", session_id=session_id)
            return False

        # Handle local pod sessions via RPC
        if session.is_local_pod:
            return await self._write_input_local_pod(session, data)

        # Cloud workspace: use WebSocket
        if not session._websocket:
            logger.warning("No WebSocket for terminal session", session_id=session_id)
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

    async def _write_input_local_pod(self, session: TerminalSession, data: str) -> bool:
        """Write input to a local pod terminal session via RPC."""
        # Import here to avoid circular imports
        from src.services.workspace_router import workspace_router  # noqa: PLC0415

        try:
            await workspace_router.terminal_input(
                workspace_id=session.workspace_id,
                user_id="",  # Not needed for local pod
                session_id=session.session_id,
                data=data,
            )
            session.last_activity = datetime.now(UTC)
            return True  # noqa: TRY300
        except Exception as e:
            logger.exception(
                "Failed to write to local pod terminal",
                session_id=session.session_id,
                error=str(e),
            )
            return False

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
        if not session or not session.running:
            return False

        # Handle local pod sessions via RPC
        if session.is_local_pod:
            return await self._resize_local_pod(session, rows, cols)

        # Cloud workspace: use WebSocket
        if not session._websocket:
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

    async def _resize_local_pod(self, session: TerminalSession, rows: int, cols: int) -> bool:
        """Resize a local pod terminal session via RPC."""
        # Import here to avoid circular imports
        from src.services.workspace_router import workspace_router  # noqa: PLC0415

        try:
            await workspace_router.terminal_resize(
                workspace_id=session.workspace_id,
                user_id="",
                session_id=session.session_id,
                rows=rows,
                cols=cols,
            )
            return True  # noqa: TRY300
        except Exception as e:
            logger.exception(
                "Failed to resize local pod terminal",
                session_id=session.session_id,
                error=str(e),
            )
            return False

    async def close_session(self, session_id: str, kill_tmux: bool = False) -> bool:
        """Close a terminal session.

        For cloud workspaces: Closes WebSocket but tmux keeps running.
        For local pods: Closes the session via RPC.

        Args:
            session_id: Session ID.
            kill_tmux: If True, also kill the tmux session.

        Returns:
            True if successful, False otherwise.
        """
        async with self._lock:
            session = self.sessions.get(session_id)
            if not session:
                return False

            # For local pods, close the tmux session via RPC
            if session.is_local_pod and kill_tmux:
                await self._close_local_pod_session(session)

            await self._cleanup_session(session)
            del self.sessions[session_id]

            logger.info(
                "Terminal session closed",
                session_id=session_id,
                workspace_id=session.workspace_id,
                is_local_pod=session.is_local_pod,
                tmux_killed=kill_tmux,
            )
            return True

    async def _close_local_pod_session(self, session: TerminalSession) -> None:
        """Close a local pod terminal session via RPC."""
        # Import here to avoid circular imports
        from src.services.workspace_router import workspace_router  # noqa: PLC0415

        try:
            await workspace_router.terminal_close(
                workspace_id=session.workspace_id,
                user_id="",
                session_id=session.session_id,
            )
        except Exception as e:
            logger.warning(
                "Failed to close local pod terminal",
                session_id=session.session_id,
                error=str(e),
            )

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
