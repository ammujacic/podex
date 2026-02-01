"""Terminal WebSocket endpoint for interactive shell sessions in workspace containers.

Uses tmux for session persistence - sessions survive disconnections and can be reconnected.
"""

from __future__ import annotations

import asyncio
import contextlib
import struct
import time
from typing import Annotated, Any, ClassVar

import docker
import structlog
from docker import DockerClient
from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect, status

from podex_shared.redis_client import RedisClient, get_redis_client
from podex_shared.sentry import track_terminal_command
from src.config import settings
from src.deps import OrchestratorSingleton, get_compute_manager, verify_internal_auth
from src.managers.base import (
    ComputeManager,  # noqa: TC001 - FastAPI needs this at runtime for Depends()
)
from src.models.workspace import WorkspaceInfo, WorkspaceStatus
from src.validation import ValidationError, validate_workspace_id

logger = structlog.get_logger()

router = APIRouter(
    prefix="/terminal",
    tags=["terminal"],
    dependencies=[Depends(verify_internal_auth)],
)


class TmuxSessionManager:
    """Redis-backed tmux session manager for horizontal scaling.

    Tracks tmux session client counts in Redis so multiple compute instances
    can share session state. Local WebSocket connections are tracked in memory
    for graceful shutdown.
    """

    _instance: TmuxSessionManager | None = None
    REDIS_KEY_PREFIX = "compute:terminal:session:"
    SESSION_TTL_SECONDS = 86400  # 24 hours

    def __init__(self) -> None:
        # Local tracking of WebSocket connections for graceful shutdown
        self._local_sessions: set[TmuxTerminalSession] = set()
        self._lock = asyncio.Lock()
        self._shutdown_event = asyncio.Event()
        self._redis_client: RedisClient | None = None

    @classmethod
    def get_instance(cls) -> TmuxSessionManager:
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def _get_redis(self) -> RedisClient:
        """Get or create the Redis client."""
        if self._redis_client is None:
            self._redis_client = get_redis_client(settings.redis_url)
        await self._redis_client.connect()
        return self._redis_client

    def _make_redis_key(self, container_id: str, session_name: str) -> str:
        """Create Redis key for a session."""
        return f"{self.REDIS_KEY_PREFIX}{container_id}:{session_name}"

    async def register_client(self, container_id: str, session_name: str) -> None:
        """Register a new client connection to a tmux session (Redis-backed)."""
        try:
            client = await self._get_redis()
            key = self._make_redis_key(container_id, session_name)
            count = await client.client.hincrby(key, "client_count", 1)
            await client.client.expire(key, self.SESSION_TTL_SECONDS)
            logger.info(
                "Client registered to tmux session",
                container_id=container_id[:12],
                session_name=session_name,
                client_count=count,
            )
        except Exception as e:
            logger.warning(
                "Failed to register client in Redis, continuing anyway",
                container_id=container_id[:12],
                session_name=session_name,
                error=str(e),
            )

    async def unregister_client(self, container_id: str, session_name: str) -> int:
        """Unregister a client from a tmux session. Returns remaining client count."""
        try:
            client = await self._get_redis()
            key = self._make_redis_key(container_id, session_name)
            raw_count = await client.client.hincrby(key, "client_count", -1)
            count: int = max(0, int(raw_count))
            logger.info(
                "Client unregistered from tmux session",
                container_id=container_id[:12],
                session_name=session_name,
                remaining_clients=count,
            )
            return count
        except Exception as e:
            logger.warning(
                "Failed to unregister client in Redis",
                container_id=container_id[:12],
                session_name=session_name,
                error=str(e),
            )
            return 0

    async def get_client_count(self, container_id: str, session_name: str) -> int:
        """Get current client count for a session."""
        try:
            client = await self._get_redis()
            key = self._make_redis_key(container_id, session_name)
            count = await client.client.hget(key, "client_count")
            return int(count) if count else 0
        except Exception as e:
            logger.warning(
                "Failed to get client count from Redis",
                container_id=container_id[:12],
                session_name=session_name,
                error=str(e),
            )
            return 0

    async def register_active_session(self, session: TmuxTerminalSession) -> None:
        """Register an active terminal session for local shutdown tracking."""
        async with self._lock:
            self._local_sessions.add(session)

    async def unregister_active_session(self, session: TmuxTerminalSession) -> None:
        """Unregister a terminal session from local tracking."""
        async with self._lock:
            self._local_sessions.discard(session)

    def is_shutting_down(self) -> bool:
        """Check if shutdown is in progress."""
        return self._shutdown_event.is_set()

    async def shutdown_all_sessions(self) -> None:
        """Close all active terminal sessions on THIS instance during shutdown."""
        self._shutdown_event.set()
        async with self._lock:
            sessions = list(self._local_sessions)

        if sessions:
            logger.info("Closing active terminal sessions", count=len(sessions))
            for session in sessions:
                try:
                    session._running = False
                    # Close the Docker socket to unblock read operations
                    if session.socket:
                        with contextlib.suppress(Exception):
                            sock = getattr(session.socket, "_sock", session.socket)
                            sock.close()
                    # Close the WebSocket to unblock websocket.receive()
                    if session.websocket:
                        with contextlib.suppress(Exception):
                            await session.websocket.close(code=1001, reason="Server shutting down")
                except Exception as e:
                    logger.warning("Error closing terminal session", error=str(e))

            # Give WebSocket handlers time to exit cleanly
            await asyncio.sleep(0.5)
            logger.info("Terminal sessions signaled to close")

    def reset(self) -> None:
        """Reset the manager state - called on startup to clear any stale state."""
        self._shutdown_event.clear()
        logger.info("Terminal session manager reset")


# Global session manager
tmux_manager = TmuxSessionManager.get_instance()


async def shutdown_terminal_sessions() -> None:
    """Shutdown hook to close all active terminal sessions."""
    await tmux_manager.shutdown_all_sessions()


def reset_terminal_manager() -> None:
    """Reset terminal manager state on startup."""
    tmux_manager.reset()


class TmuxTerminalSession:
    """Manages an interactive terminal session using tmux in a Docker container.

    Tmux provides:
    - Session persistence across disconnections
    - Multiple clients can attach to the same session
    - Session keeps running even when no clients are attached
    """

    # Supported shells and their paths
    SHELL_PATHS: ClassVar[dict[str, str]] = {
        "bash": "/bin/bash",
        "zsh": "/bin/zsh",
        "fish": "/usr/bin/fish",
    }

    def __init__(
        self,
        container_id: str,
        workspace_id: str,
        session_name: str,
        docker_client: DockerClient,
        shell: str = "bash",
    ) -> None:
        self.container_id = container_id
        self.workspace_id = workspace_id
        self.session_name = session_name  # Unique name for the tmux session
        self.shell = shell if shell in self.SHELL_PATHS else "bash"
        self.client = docker_client
        self.exec_id: str | None = None
        self.socket: Any = None
        self.websocket: WebSocket | None = None  # Reference to client WebSocket for shutdown
        self._running = False
        self._using_tmux = False

    async def _exec_in_container(self, cmd: list[str], tty: bool = False) -> tuple[int, str]:
        """Execute a command in the container and return (exit_code, output)."""
        try:
            container = await asyncio.to_thread(
                self.client.containers.get,
                self.container_id,
            )
            result = await asyncio.to_thread(
                container.exec_run,
                cmd=cmd,
                tty=tty,
            )
            output = result.output.decode("utf-8", errors="replace") if result.output else ""
            return result.exit_code, output
        except Exception as e:
            logger.warning("Exec failed", cmd=cmd, error=str(e))
            return 1, str(e)

    async def _check_tmux_available(self) -> bool:
        """Check if tmux is installed in the container."""
        exit_code, _ = await self._exec_in_container(["which", "tmux"])
        return exit_code == 0

    async def _install_tmux(self) -> bool:
        """Install tmux in the container if not present."""
        logger.info(
            "Installing tmux in container",
            workspace_id=self.workspace_id,
            container_id=self.container_id[:12],
        )

        # Update apt cache and install tmux (dev user has passwordless sudo)
        exit_code, output = await self._exec_in_container(["sudo", "apt-get", "update", "-qq"])
        if exit_code != 0:
            logger.warning("apt-get update failed", exit_code=exit_code, output=output)
            return False

        exit_code, output = await self._exec_in_container(
            ["sudo", "apt-get", "install", "-y", "-qq", "tmux"]
        )
        if exit_code != 0:
            logger.warning("tmux installation failed", exit_code=exit_code, output=output)
            return False

        logger.info(
            "tmux installed successfully",
            workspace_id=self.workspace_id,
        )
        return True

    async def _tmux_session_exists(self) -> bool:
        """Check if the tmux session already exists."""
        exit_code, _ = await self._exec_in_container(
            ["tmux", "has-session", "-t", self.session_name]
        )
        return exit_code == 0

    async def _create_tmux_session(self) -> bool:
        """Create a new tmux session with the configured shell."""
        shell_path = self.SHELL_PATHS.get(self.shell, "/bin/bash")

        # Create detached tmux session with the specified shell
        exit_code, output = await self._exec_in_container(
            [
                "tmux",
                "new-session",
                "-d",  # Detached
                "-s",
                self.session_name,  # Session name
                "-c",
                "/home/dev",  # Start directory
                shell_path,  # Shell to use
            ]
        )
        if exit_code != 0:
            logger.warning(
                "Failed to create tmux session",
                session_name=self.session_name,
                shell=self.shell,
                exit_code=exit_code,
                output=output,
            )
            return False

        logger.info(
            "Created new tmux session",
            workspace_id=self.workspace_id,
            session_name=self.session_name,
            shell=self.shell,
        )
        return True

    async def _enable_tmux_mouse(self) -> None:
        """Enable tmux mouse mode for scrollback and pane interactions."""
        exit_code, output = await self._exec_in_container(
            [
                "tmux",
                "set-option",
                "-t",
                self.session_name,
                "-g",
                "mouse",
                "on",
            ]
        )
        if exit_code != 0:
            logger.warning(
                "Failed to enable tmux mouse mode",
                session_name=self.session_name,
                exit_code=exit_code,
                output=output,
            )

    async def _start_with_tmux(self) -> bool:
        """Start terminal session using tmux for persistence."""
        # Check if tmux session exists
        session_exists = await self._tmux_session_exists()

        if not session_exists:
            # Create new tmux session
            if not await self._create_tmux_session():
                return False
        else:
            logger.info(
                "Attaching to existing tmux session",
                workspace_id=self.workspace_id,
                session_name=self.session_name,
            )

        await self._enable_tmux_mouse()

        # Attach to the tmux session with a new PTY
        exec_instance = await asyncio.to_thread(
            self.client.api.exec_create,
            self.container_id,
            cmd=["tmux", "attach-session", "-t", self.session_name],
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
        self._using_tmux = True

        # Register with session manager
        await tmux_manager.register_client(self.container_id, self.session_name)

        logger.info(
            "Terminal session started (tmux)",
            workspace_id=self.workspace_id,
            session_name=self.session_name,
            exec_id=self.exec_id[:12] if self.exec_id else None,
            reattached=session_exists,
        )
        return True

    async def _start_without_tmux(self) -> bool:
        """Start terminal session without tmux (no persistence)."""
        shell_path = self.SHELL_PATHS.get(self.shell, "/bin/bash")
        logger.warning(
            "tmux not available, starting plain shell session (no persistence)",
            workspace_id=self.workspace_id,
            session_name=self.session_name,
            shell=self.shell,
        )

        exec_instance = await asyncio.to_thread(
            self.client.api.exec_create,
            self.container_id,
            cmd=[shell_path],
            stdin=True,
            stdout=True,
            stderr=True,
            tty=True,
            workdir="/home/dev",
        )
        self.exec_id = exec_instance["Id"]

        self.socket = await asyncio.to_thread(
            self.client.api.exec_start,
            self.exec_id,
            socket=True,
            tty=True,
        )

        self._running = True
        self._using_tmux = False

        logger.info(
            "Terminal session started (no tmux)",
            workspace_id=self.workspace_id,
            session_name=self.session_name,
            shell=self.shell,
            exec_id=self.exec_id[:12] if self.exec_id else None,
        )
        return True

    async def start(self) -> bool:
        """Start the terminal session.

        Uses tmux for session persistence. If tmux is not installed, it will
        be installed automatically. Falls back to plain bash only if installation fails.
        """
        try:
            # Check if tmux is available
            tmux_available = await self._check_tmux_available()

            # If not available, try to install it
            if not tmux_available:
                logger.info(
                    "tmux not found, attempting to install",
                    workspace_id=self.workspace_id,
                )
                installed = await self._install_tmux()
                if installed:
                    tmux_available = True

            if tmux_available:
                return await self._start_with_tmux()
            else:
                # Only fall back to plain bash if tmux installation failed
                logger.warning(
                    "tmux installation failed, falling back to plain bash",
                    workspace_id=self.workspace_id,
                )
                return await self._start_without_tmux()

        except Exception as e:
            logger.exception(
                "Failed to start terminal session",
                workspace_id=self.workspace_id,
                session_name=self.session_name,
                error=str(e),
            )
            return False

    async def write(self, data: bytes) -> bool:
        """Write data to the terminal."""
        if not self.socket or not self._running:
            return False
        try:
            # Get the underlying socket - handle both regular and SSL sockets
            sock = getattr(self.socket, "_sock", self.socket)
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
            # Get the underlying socket - handle both regular and SSL sockets
            # Docker's socket wrapper may have _sock (non-TLS) or be an SSLSocket (TLS)
            sock = getattr(self.socket, "_sock", self.socket)
            # Set a short timeout for non-blocking behavior
            sock.settimeout(0.1)
            try:
                data = await asyncio.to_thread(sock.recv, size)
                return data if data else None
            except TimeoutError:
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
            # Resize the docker exec PTY
            # Note: This may fail if exec process hasn't fully started yet
            await asyncio.to_thread(
                self.client.api.exec_resize,
                self.exec_id,
                height=rows,
                width=cols,
            )

            # Also resize the tmux window to match
            await self._exec_in_container(
                [
                    "tmux",
                    "resize-window",
                    "-t",
                    self.session_name,
                    "-x",
                    str(cols),
                    "-y",
                    str(rows),
                ]
            )

            logger.debug(
                "Terminal resized",
                workspace_id=self.workspace_id,
                rows=rows,
                cols=cols,
            )
            return True
        except docker.errors.APIError as e:
            # Silently ignore "exec process is not started" - this happens when
            # resize is called before the exec process has fully initialized.
            # The frontend will send another resize when the terminal is ready.
            if "exec process is not started" in str(e):
                logger.debug(
                    "Terminal resize skipped - exec not yet started",
                    workspace_id=self.workspace_id,
                )
                return False
            if "process does not exist" in str(e):
                logger.debug(
                    "Terminal resize skipped - exec no longer exists",
                    workspace_id=self.workspace_id,
                    exec_id=self.exec_id[:12] if self.exec_id else None,
                )
                return False
            logger.warning(
                "Failed to resize terminal",
                workspace_id=self.workspace_id,
                error=str(e),
            )
            return False
        except Exception as e:
            logger.warning(
                "Failed to resize terminal",
                workspace_id=self.workspace_id,
                error=str(e),
            )
            return False

    async def close(self) -> None:
        """Close the terminal connection (but tmux session keeps running)."""
        self._running = False

        # Unregister from session manager
        await tmux_manager.unregister_client(self.container_id, self.session_name)

        if self.socket:
            with contextlib.suppress(Exception):
                sock = getattr(self.socket, "_sock", self.socket)
                sock.close()

        # Note: We do NOT kill the tmux session - it keeps running
        logger.info(
            "Terminal connection closed (tmux session persists)",
            workspace_id=self.workspace_id,
            session_name=self.session_name,
        )

    async def kill_session(self) -> bool:
        """Kill the tmux session completely (called when agent is stopped)."""
        try:
            exit_code, _ = await self._exec_in_container(
                ["tmux", "kill-session", "-t", self.session_name]
            )
            if exit_code == 0:
                logger.info(
                    "Killed tmux session",
                    workspace_id=self.workspace_id,
                    session_name=self.session_name,
                )
            return exit_code == 0
        except Exception as e:
            logger.warning(
                "Failed to kill tmux session",
                workspace_id=self.workspace_id,
                session_name=self.session_name,
                error=str(e),
            )
            return False

    @property
    def running(self) -> bool:
        return self._running


async def _validate_workspace_for_terminal(
    compute: ComputeManager,
    websocket: WebSocket,
    workspace_id: str,
) -> tuple[bool, WorkspaceInfo | None]:
    """Validate workspace exists and is running. Returns (valid, workspace_info)."""
    # Validate workspace_id to prevent path traversal and injection attacks
    try:
        validate_workspace_id(workspace_id)
    except ValidationError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid workspace ID")
        return False, None

    # Get workspace from compute manager's registry
    workspace = await compute.get_workspace(workspace_id)
    if not workspace:
        logger.warning("Workspace not found in registry", workspace_id=workspace_id)
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Workspace not found")
        return False, None

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

    if not workspace.server_id:
        logger.warning("Workspace has no server_id", workspace_id=workspace_id)
        await websocket.close(
            code=status.WS_1011_INTERNAL_ERROR,
            reason="Workspace server not available",
        )
        return False, None

    return True, workspace


@router.websocket("/{workspace_id}")
async def terminal_websocket(
    websocket: WebSocket,
    workspace_id: str,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
    session_id: str | None = Query(
        default=None, description="Terminal agent session ID for reconnection"
    ),
    shell: str = Query(default="bash", description="Shell to use (bash, zsh, fish)"),
) -> None:
    """Interactive terminal WebSocket endpoint with tmux session persistence.

    Protocol:
    - Text messages: Terminal input (sent to container)
    - Binary messages with prefix:
      - b'r' + 4 bytes: Resize command (2 bytes rows + 2 bytes cols, big-endian)
    - Server sends bytes messages with terminal output

    Query Parameters:
    - session_id: Optional session identifier for terminal agents. If provided,
                  creates/attaches to a named tmux session that persists across
                  reconnections. If not provided, uses workspace_id as session name.
    - shell: Shell to use for the terminal (bash, zsh, fish). Defaults to bash.
    """
    await websocket.accept()

    valid, workspace = await _validate_workspace_for_terminal(compute, websocket, workspace_id)
    if not valid or not workspace:
        return

    # Get Docker client for the workspace's server
    docker_manager = OrchestratorSingleton.get_docker_manager()
    docker_client = docker_manager.get_client(workspace.server_id)  # type: ignore[arg-type]
    if not docker_client:
        logger.error(
            "No Docker client available for server",
            workspace_id=workspace_id,
            server_id=workspace.server_id,
        )
        await websocket.close(
            code=status.WS_1011_INTERNAL_ERROR,
            reason="Workspace server not available",
        )
        return

    container_id = workspace.container_id  # Already validated in _validate_workspace_for_terminal

    # Use session_id if provided, otherwise use workspace_id
    # This allows multiple independent terminal sessions per workspace
    tmux_session_name = f"podex-{session_id}" if session_id else f"podex-{workspace_id}"

    terminal_start_time = time.perf_counter()

    logger.info(
        "Terminal WebSocket connected",
        workspace_id=workspace_id,
        container_id=container_id[:12] if container_id else "unknown",
        server_id=workspace.server_id,
        session_id=session_id,
        tmux_session=tmux_session_name,
        shell=shell,
    )

    # Check if shutdown is in progress
    if tmux_manager.is_shutting_down():
        await websocket.close(
            code=status.WS_1001_GOING_AWAY,
            reason="Server is shutting down",
        )
        return

    # Create/attach to tmux session with specified shell
    session = TmuxTerminalSession(
        container_id,  # type: ignore[arg-type]
        workspace_id,
        tmux_session_name,
        docker_client=docker_client,
        shell=shell,
    )
    if not await session.start():
        track_terminal_command(workspace_id, 0, success=False, reason="session_start_failed")
        await websocket.close(
            code=status.WS_1011_INTERNAL_ERROR,
            reason="Failed to start terminal session",
        )
        return

    # Store websocket reference for shutdown
    session.websocket = websocket

    # Register session for shutdown tracking
    await tmux_manager.register_active_session(session)

    async def read_from_container() -> None:
        """Read output from container and send to websocket with batching."""
        buffer = bytearray()
        last_send = asyncio.get_event_loop().time()
        batch_interval = 0.016  # 16ms (~60fps) for smooth rendering

        while session.running:
            try:
                data = await session.read()
                if data is None:
                    # Send any remaining buffer before exit
                    if buffer:
                        await websocket.send_bytes(bytes(buffer))
                    break
                if data:
                    buffer.extend(data)
                    now = asyncio.get_event_loop().time()
                    # Send if batch interval passed and buffer has data
                    if (now - last_send) >= batch_interval:
                        await websocket.send_bytes(bytes(buffer))
                        buffer.clear()
                        last_send = now
                else:
                    # Flush any remaining buffer on idle, then sleep
                    if buffer:
                        await websocket.send_bytes(bytes(buffer))
                        buffer.clear()
                        last_send = asyncio.get_event_loop().time()
                    await asyncio.sleep(0.016)  # 16ms idle sleep
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
                    data = message["text"].encode("utf-8")
                    await session.write(data)
                elif "bytes" in message:
                    raw = message["bytes"]
                    if raw and raw[0:1] == b"r":
                        resize_cmd_min_len = 5
                        if len(raw) >= resize_cmd_min_len:
                            rows = struct.unpack(">H", raw[1:3])[0]
                            cols = struct.unpack(">H", raw[3:5])[0]
                            await session.resize(rows, cols)
                    else:
                        await session.write(raw)
            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.debug("Write error", error=str(e))
                break

    read_task = asyncio.create_task(read_from_container())
    write_task = asyncio.create_task(write_to_container())

    try:
        await asyncio.gather(read_task, write_task, return_exceptions=True)
    finally:
        for task in [read_task, write_task]:
            if not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

        # Unregister session from shutdown tracking
        await tmux_manager.unregister_active_session(session)

        await session.close()

        # Track terminal session duration
        session_duration_ms = (time.perf_counter() - terminal_start_time) * 1000
        track_terminal_command(workspace_id, session_duration_ms, success=True)

        logger.info(
            "Terminal WebSocket closed (tmux session persists)",
            workspace_id=workspace_id,
            session_id=session_id,
            duration_ms=session_duration_ms,
        )


@router.delete("/{workspace_id}/session/{session_id}")
async def kill_terminal_session(
    workspace_id: str,
    session_id: str,
    compute: Annotated[ComputeManager, Depends(get_compute_manager)],
) -> dict[str, str]:
    """Kill a tmux session completely.

    Called when a terminal agent is removed/stopped.
    """
    workspace = await compute.get_workspace(workspace_id)
    if not workspace or not workspace.container_id or not workspace.server_id:
        return {"status": "not_found", "message": "Workspace not found"}

    # Get Docker client for the workspace's server
    docker_manager = OrchestratorSingleton.get_docker_manager()
    docker_client = docker_manager.get_client(workspace.server_id)
    if not docker_client:
        logger.error(
            "No Docker client available for server",
            workspace_id=workspace_id,
            server_id=workspace.server_id,
        )
        return {"status": "error", "message": "Workspace server not available"}

    container_id = workspace.container_id
    tmux_session_name = f"podex-{session_id}"

    # Create a temporary session object to kill the tmux session
    session = TmuxTerminalSession(
        container_id, workspace_id, tmux_session_name, docker_client=docker_client
    )
    killed = await session.kill_session()

    if killed:
        return {"status": "killed", "message": f"Session {session_id} killed"}
    return {"status": "not_found", "message": f"Session {session_id} not found or already dead"}
