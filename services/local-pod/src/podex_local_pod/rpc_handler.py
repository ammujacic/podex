"""RPC request handler for local pod.

Handles workspace management commands from Podex cloud.

For native mode, operations are STATELESS - the backend passes working_dir
with each call and the pod doesn't need to track workspace state.
"""

import asyncio
import contextlib
import os
import shlex
import stat
import subprocess
from pathlib import Path
from typing import TYPE_CHECKING, Any

import structlog

if TYPE_CHECKING:
    import socketio

    from .client import WorkspaceManager
    from .config import LocalPodConfig

logger = structlog.get_logger()

# Terminal streaming settings
TERMINAL_PIPE_READ_SIZE = 4096  # Bytes to read at a time from pipe
TERMINAL_FIFO_DIR = "/tmp/podex-terminals"  # Directory for terminal FIFOs


class RPCHandler:
    """Handles RPC requests from Podex cloud.

    For native mode, most operations are stateless and use working_dir
    passed from the backend. The manager's _workspaces dict is only
    used for Docker mode where we need to track container IDs.
    """

    def __init__(
        self,
        manager: "WorkspaceManager",
        config: "LocalPodConfig | None" = None,
        sio: "socketio.AsyncClient | None" = None,
    ) -> None:
        """Initialize the handler.

        Args:
            manager: Workspace manager (Docker or Native) for workspace operations
            config: Local pod configuration for security settings
            sio: Socket.IO client for emitting events to cloud
        """
        self.manager = manager
        self.config = config
        self.sio = sio

        # Track active terminal output streaming tasks: session_id -> task
        self._terminal_output_tasks: dict[str, asyncio.Task[None]] = {}
        # Track terminal FIFOs for cleanup: session_id -> fifo_path
        self._terminal_fifos: dict[str, str] = {}
        # Track cloudflared tunnel processes: f"{workspace_id}:{port}" -> Popen
        self._tunnel_processes: dict[str, subprocess.Popen[bytes]] = {}

        # Method dispatch table
        self._handlers: dict[str, Any] = {
            # Workspace lifecycle (mostly for Docker mode)
            "workspace.create": self._create_workspace,
            "workspace.stop": self._stop_workspace,
            "workspace.delete": self._delete_workspace,
            "workspace.get": self._get_workspace,
            "workspace.update": self._update_workspace,
            "workspace.list": self._list_workspaces,
            "workspace.heartbeat": self._workspace_heartbeat,
            # Command execution (stateless - uses working_dir)
            "workspace.exec": self._exec_command,
            # File operations (stateless - uses working_dir)
            "workspace.read_file": self._read_file,
            "workspace.write_file": self._write_file,
            "workspace.list_files": self._list_files,
            "workspace.delete_file": self._delete_file,
            # Ports/preview
            "workspace.get_ports": self._get_active_ports,
            "workspace.proxy": self._proxy_request,
            # Health
            "health.check": self._health_check,
            # Host filesystem browsing (for workspace setup)
            "host.browse": self._browse_host_directory,
            # Terminal operations (stateless - uses working_dir and session_id)
            "terminal.create": self._terminal_create,
            "terminal.input": self._terminal_input,
            "terminal.resize": self._terminal_resize,
            "terminal.close": self._terminal_close,
            # Tunnel (cloudflared)
            "tunnel.start": self._tunnel_start,
            "tunnel.stop": self._tunnel_stop,
            "tunnel.status": self._tunnel_status,
        }

    async def shutdown(self) -> None:
        """Gracefully shut down the RPC handler.

        Cancels all terminal output streaming tasks and cleans up resources.
        """
        logger.debug("Shutting down RPC handler...")

        # Cancel all terminal output tasks
        for session_id, task in list(self._terminal_output_tasks.items()):
            if not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            logger.debug("Cancelled terminal task", session_id=session_id)

        self._terminal_output_tasks.clear()

        # Clean up FIFOs
        for session_id, fifo_path in list(self._terminal_fifos.items()):
            if os.path.exists(fifo_path):
                with contextlib.suppress(OSError):
                    os.unlink(fifo_path)
            logger.debug("Cleaned up FIFO", session_id=session_id)

        self._terminal_fifos.clear()

        # Stop all tunnel processes
        for key, proc in list(self._tunnel_processes.items()):
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except (subprocess.TimeoutExpired, OSError):
                with contextlib.suppress(Exception):
                    proc.kill()
            logger.debug("Stopped tunnel process", key=key)
        self._tunnel_processes.clear()

        logger.debug("RPC handler shutdown complete")

    async def initialize(self) -> None:
        """Initialize the RPC handler.

        Cleans up any orphaned FIFOs from previous runs (e.g., after unexpected shutdown).
        """
        await self._cleanup_orphaned_fifos()

    async def _cleanup_orphaned_fifos(self) -> None:
        """Clean up orphaned FIFOs from previous runs.

        When the pod restarts unexpectedly, FIFOs may be left behind in /tmp/podex-terminals.
        This scans the directory and removes any stale FIFOs.
        """
        fifo_dir = Path(TERMINAL_FIFO_DIR)
        if not fifo_dir.exists():
            return

        cleaned = 0
        for fifo_path in fifo_dir.glob("*.fifo"):
            try:
                # Check if this FIFO is currently tracked (shouldn't be on startup)
                session_id = fifo_path.stem
                if session_id not in self._terminal_fifos:
                    fifo_path.unlink()
                    cleaned += 1
                    logger.debug("Cleaned orphaned FIFO", fifo=str(fifo_path))
            except OSError as e:
                logger.warning(
                    "Failed to clean orphaned FIFO",
                    fifo=str(fifo_path),
                    error=str(e),
                )

        if cleaned > 0:
            logger.info("Cleaned orphaned FIFOs on startup", count=cleaned)

    def _is_native_mode(self) -> bool:
        """Check if running in native mode."""
        return self.config is not None and self.config.is_native_mode()

    def _get_working_dir(self, params: dict[str, Any]) -> str:
        """Get working directory from params, workspace, or default.

        For native mode, prefers working_dir from params (passed by backend).
        Falls back to workspace lookup for Docker mode or legacy calls.
        """
        # First try: working_dir from params (stateless approach)
        if params.get("working_dir"):
            return str(params["working_dir"])

        # Second try: look up workspace (for Docker mode or legacy)
        workspace_id = params.get("workspace_id")
        if workspace_id:
            workspace = self.manager.workspaces.get(workspace_id)
            if workspace:
                return str(workspace.get("working_dir", os.path.expanduser("~")))

        # Default: home directory
        return os.path.expanduser("~")

    async def handle(self, method: str, params: dict[str, Any]) -> Any:
        """Dispatch RPC method to handler.

        Args:
            method: RPC method name
            params: Method parameters

        Returns:
            Result from the handler

        Raises:
            ValueError: If method is unknown
        """
        handler = self._handlers.get(method)
        if not handler:
            raise ValueError(f"Unknown RPC method: {method}")

        logger.debug("Handling RPC", method=method)
        return await handler(params)

    # ==================== Workspace Lifecycle (mostly for Docker mode) ====================

    async def _create_workspace(self, params: dict[str, Any]) -> dict[str, Any]:
        """Create a new workspace."""
        workspace = await self.manager.create_workspace(
            workspace_id=params.get("workspace_id"),
            user_id=params["user_id"],
            session_id=params["session_id"],
            config=params.get("config", {}),
        )
        return workspace

    async def _stop_workspace(self, params: dict[str, Any]) -> None:
        """Stop a workspace."""
        await self.manager.stop_workspace(params["workspace_id"])

    async def _delete_workspace(self, params: dict[str, Any]) -> None:
        """Delete a workspace."""
        await self.manager.delete_workspace(
            params["workspace_id"],
            preserve_files=params.get("preserve_files", True),
        )

    async def _get_workspace(self, params: dict[str, Any]) -> dict[str, Any] | None:
        """Get workspace info."""
        workspace = await self.manager.get_workspace(params["workspace_id"])
        return workspace

    async def _update_workspace(self, params: dict[str, Any]) -> dict[str, Any] | None:
        """Update workspace configuration (e.g., working directory)."""
        result = await self.manager.update_workspace(
            workspace_id=params["workspace_id"],
            working_dir=params.get("working_dir"),
        )
        return dict(result) if result else None

    async def _list_workspaces(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        """List all workspaces."""
        workspaces = await self.manager.list_workspaces(
            user_id=params.get("user_id"),
            session_id=params.get("session_id"),
        )
        return workspaces

    async def _workspace_heartbeat(self, params: dict[str, Any]) -> None:
        """Update workspace activity timestamp."""
        await self.manager.heartbeat(params["workspace_id"])

    # ==================== Command Execution (Stateless) ====================

    async def _exec_command(self, params: dict[str, Any]) -> dict[str, Any]:
        """Execute command in workspace.

        For native mode, uses working_dir from params (stateless).
        For Docker mode, looks up container from workspace.
        """
        working_dir = self._get_working_dir(params)
        command = params["command"]
        timeout = params.get("timeout", 30)

        if self._is_native_mode():
            # Stateless execution - just run in the directory
            return await self._exec_native(command, working_dir, timeout)

        # Docker mode - delegate to manager (needs workspace for container ID)
        return await self.manager.exec_command(
            workspace_id=params["workspace_id"],
            command=command,
            working_dir=working_dir,
            timeout=timeout,
        )

    async def _exec_native(
        self, command: str, working_dir: str, timeout: int = 30
    ) -> dict[str, Any]:
        """Execute command natively in the specified directory.

        This is stateless - doesn't need workspace state.
        """
        try:
            process = await asyncio.create_subprocess_shell(
                command,
                cwd=working_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env={**os.environ},
            )

            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=timeout,
                )
            except TimeoutError:
                process.kill()
                await process.wait()
                return {
                    "exit_code": 124,
                    "stdout": "",
                    "stderr": f"Command timed out after {timeout} seconds",
                }

            return {
                "exit_code": process.returncode or 0,
                "stdout": stdout.decode("utf-8", errors="replace"),
                "stderr": stderr.decode("utf-8", errors="replace"),
            }

        except Exception as e:
            logger.error("Error executing command", error=str(e))
            return {
                "exit_code": 1,
                "stdout": "",
                "stderr": str(e),
            }

    # ==================== File Operations (Stateless) ====================

    async def _read_file(self, params: dict[str, Any]) -> str:
        """Read file from workspace."""
        working_dir = self._get_working_dir(params)
        path = params["path"]

        # Resolve path relative to working_dir
        full_path = os.path.join(working_dir, path) if not os.path.isabs(path) else path

        with open(full_path) as f:
            return f.read()

    async def _write_file(self, params: dict[str, Any]) -> None:
        """Write file to workspace."""
        working_dir = self._get_working_dir(params)
        path = params["path"]
        content = params["content"]

        # Resolve path relative to working_dir
        full_path = os.path.join(working_dir, path) if not os.path.isabs(path) else path

        # Ensure parent directory exists
        Path(full_path).parent.mkdir(parents=True, exist_ok=True)

        with open(full_path, "w") as f:
            f.write(content)

    async def _list_files(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        """List files in workspace directory."""
        working_dir = self._get_working_dir(params)
        path = params.get("path", ".")

        # Resolve path relative to working_dir
        full_path = os.path.join(working_dir, path) if not os.path.isabs(path) else path

        files = []
        dir_path = Path(full_path)

        if not dir_path.is_dir():
            raise ValueError(f"Not a directory: {path}")

        for entry in dir_path.iterdir():
            stat = entry.stat()
            files.append(
                {
                    "name": entry.name,
                    "type": "directory" if entry.is_dir() else "file",
                    "size": stat.st_size if entry.is_file() else 0,
                    "permissions": oct(stat.st_mode)[-3:],
                }
            )

        return sorted(files, key=lambda f: (f["type"] != "directory", f["name"]))

    async def _delete_file(self, params: dict[str, Any]) -> None:
        """Delete file from workspace."""
        working_dir = self._get_working_dir(params)
        path = params["path"]

        # Resolve path relative to working_dir
        full_path = os.path.join(working_dir, path) if not os.path.isabs(path) else path

        file_path = Path(full_path)
        if file_path.is_dir():
            import shutil

            shutil.rmtree(full_path)
        else:
            file_path.unlink()

    # ==================== Ports/Preview ====================

    async def _get_active_ports(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        """Get active ports in workspace."""
        # For native mode, return empty - ports are on localhost
        if self._is_native_mode():
            return []
        return await self.manager.get_active_ports(params["workspace_id"])

    async def _proxy_request(self, params: dict[str, Any]) -> dict[str, Any]:
        """Proxy HTTP request to workspace."""
        return await self.manager.proxy_request(
            workspace_id=params["workspace_id"],
            port=params["port"],
            method=params["method"],
            path=params["path"],
            headers=params.get("headers", {}),
            body=bytes.fromhex(params["body"]) if params.get("body") else None,
            query_string=params.get("query_string"),
        )

    # ==================== Health ====================

    async def _health_check(self, params: dict[str, Any]) -> dict[str, Any]:
        """Health check."""
        return {
            "status": "healthy",
            "mode": "native" if self._is_native_mode() else "docker",
            "workspaces": len(self.manager.workspaces),
        }

    # ==================== Host Filesystem Browsing ====================

    async def _browse_host_directory(self, params: dict[str, Any]) -> dict[str, Any]:
        """Browse host filesystem directory.

        Returns directory contents for workspace selection.
        Respects security settings (allowlist vs unrestricted).

        Args:
            params: Must contain 'path' (directory to list)

        Returns:
            Dict with 'path', 'entries' (list of files/dirs), and 'parent'
        """
        requested_path = params.get("path", "~")

        # Expand user home directory
        if requested_path.startswith("~"):
            requested_path = os.path.expanduser(requested_path)

        path = Path(requested_path).resolve()

        # Security check for allowlist mode
        if self.config and self.config.native.security == "allowlist":
            # Only allow browsing within configured mount paths
            allowed_paths = []
            if self.config.mounts:
                allowed_paths = [Path(m.path).resolve() for m in self.config.mounts]

            # Also allow browsing parent directories of mounts (to navigate to them)
            # and home directory as a starting point
            home = Path.home()
            is_allowed = path == home or any(
                path == mp or mp.is_relative_to(path) or path.is_relative_to(mp)
                for mp in allowed_paths
            )

            if not is_allowed:
                logger.warning("Access denied to path", path=str(path))
                return {
                    "path": str(path),
                    "parent": str(path.parent) if path.parent != path else None,
                    "entries": [],
                    "error": "Access denied - path not in allowlist",
                    "allowed_paths": [str(p) for p in allowed_paths],
                }

        # Check if path exists and is a directory
        if not path.exists():
            return {
                "path": str(path),
                "parent": str(path.parent) if path.parent != path else None,
                "entries": [],
                "error": "Path does not exist",
            }

        if not path.is_dir():
            return {
                "path": str(path),
                "parent": str(path.parent) if path.parent != path else None,
                "entries": [],
                "error": "Path is not a directory",
            }

        # List directory contents
        entries = []
        try:
            for entry in sorted(path.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
                # Skip hidden files unless explicitly requested
                if entry.name.startswith(".") and not params.get("show_hidden", False):
                    continue

                try:
                    stat = entry.stat()
                    entries.append(
                        {
                            "name": entry.name,
                            "path": str(entry),
                            "is_dir": entry.is_dir(),
                            "is_file": entry.is_file(),
                            "size": stat.st_size if entry.is_file() else None,
                            "modified": stat.st_mtime,
                        }
                    )
                except (PermissionError, OSError):
                    # Skip entries we can't access
                    continue
        except PermissionError:
            return {
                "path": str(path),
                "parent": str(path.parent) if path.parent != path else None,
                "entries": [],
                "error": "Permission denied",
            }

        return {
            "path": str(path),
            "parent": str(path.parent) if path.parent != path else None,
            "entries": entries,
            "is_home": path == Path.home(),
        }

    # ==================== Terminal Operations (Stateless) ====================

    def _get_user_shell(self) -> str:
        """Get user's configured shell from $SHELL environment variable."""
        shell = os.environ.get("SHELL", "/bin/bash")
        # Validate the shell exists
        if os.path.exists(shell):
            return shell
        return "/bin/bash"

    async def _terminal_create(self, params: dict[str, Any]) -> dict[str, Any]:
        """Create a terminal session for a workspace.

        STATELESS: Uses working_dir from params, doesn't need workspace state.
        Creates a tmux session that agents can interact with.
        Starts a background task to stream terminal output back to cloud using pipe-pane.

        Args:
            params: Must contain 'working_dir', optionally 'session_id', 'shell', 'command'
                   If 'command' is provided, tmux starts running that command directly
                   (no interactive shell, cleaner startup for agents).

        Returns:
            Dict with session info including 'session_id' and 'working_dir'
        """
        session_id = params.get("session_id", params.get("workspace_id", "default"))
        workspace_id = params.get("workspace_id", session_id)
        # Use user's configured shell by default (from $SHELL)
        shell = params.get("shell") or self._get_user_shell()
        command = params.get("command")  # Optional: run this instead of shell
        working_dir = self._get_working_dir(params)

        logger.info(
            "Creating terminal session",
            session_id=session_id,
            working_dir=working_dir,
            shell=shell,
            has_command=command is not None,
        )

        # Check if tmux is available
        result = await self._exec_native("which tmux", working_dir, timeout=5)
        has_tmux = result.get("exit_code") == 0

        if has_tmux:
            # Check if tmux session already exists
            check_result = await self._exec_native(
                f"tmux has-session -t {session_id} 2>/dev/null && echo 'exists'",
                working_dir,
                timeout=5,
            )
            session_exists = "exists" in check_result.get("stdout", "")

            if not session_exists:
                # Create new tmux session
                if command:
                    # Start tmux directly with the command (no interactive shell)
                    # Use shlex.quote to properly escape the command for shell
                    # The command already includes cd and env setup from terminal_agents.py
                    create_cmd = (
                        f"tmux new-session -d -s {session_id} -c {working_dir} "
                        f"bash -c {shlex.quote(command)}"
                    )
                else:
                    # Start with interactive shell
                    create_cmd = (
                        f"tmux new-session -d -s {session_id} -c {working_dir} {shlex.quote(shell)}"
                    )

                create_result = await self._exec_native(create_cmd, working_dir, timeout=10)
                if create_result.get("exit_code") != 0:
                    logger.warning(
                        "Failed to create tmux session",
                        session_id=session_id,
                        error=create_result.get("stderr"),
                        command=create_cmd[:200],
                    )

            # Set up FIFO for pipe-pane streaming
            fifo_path = await self._setup_terminal_fifo(session_id)

            # Start output streaming task if we have sio client
            if self.sio:
                # Stop existing task if any
                if session_id in self._terminal_output_tasks:
                    self._terminal_output_tasks[session_id].cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await self._terminal_output_tasks[session_id]

                # Start new output streaming task using pipe-pane
                task = asyncio.create_task(
                    self._terminal_stream_output(session_id, workspace_id, working_dir, fifo_path)
                )
                self._terminal_output_tasks[session_id] = task
                logger.info(
                    "Started terminal output streaming with pipe-pane",
                    session_id=session_id,
                    fifo=fifo_path,
                )

        return {
            "session_id": session_id,
            "workspace_id": workspace_id,
            "working_dir": working_dir,
            "shell": shell,
            "has_tmux": has_tmux,
        }

    def _create_fifo_sync(self, fifo_path: str, session_id: str) -> bool:
        """Create a FIFO synchronously with proper error handling.

        Returns True if FIFO was created successfully.
        """
        try:
            # Ensure FIFO directory exists
            fifo_dir = Path(TERMINAL_FIFO_DIR)
            fifo_dir.mkdir(parents=True, exist_ok=True)

            # Remove existing FIFO if present
            if os.path.exists(fifo_path):
                try:
                    os.unlink(fifo_path)
                except OSError as e:
                    logger.warning(
                        "Failed to remove existing FIFO",
                        fifo=fifo_path,
                        error=str(e),
                    )

            # Create the FIFO
            os.mkfifo(fifo_path, mode=0o600)

            # Verify FIFO was created
            if not os.path.exists(fifo_path):
                logger.error(
                    "FIFO creation failed - file does not exist after mkfifo",
                    fifo=fifo_path,
                    session_id=session_id,
                )
                return False

            # Verify it's actually a FIFO
            mode = os.stat(fifo_path).st_mode
            if not stat.S_ISFIFO(mode):
                logger.error(
                    "Created file is not a FIFO",
                    fifo=fifo_path,
                    mode=oct(mode),
                )
                return False

            logger.info(
                "FIFO created and verified",
                fifo=fifo_path,
                session_id=session_id,
            )
            return True

        except OSError as e:
            logger.exception(
                "Failed to create FIFO",
                fifo=fifo_path,
                session_id=session_id,
                error=str(e),
            )
            return False

    async def _setup_terminal_fifo(self, session_id: str) -> str:
        """Create a FIFO (named pipe) for terminal output streaming.

        Returns the path to the created FIFO.
        """
        fifo_path = str(Path(TERMINAL_FIFO_DIR) / f"{session_id}.fifo")

        if self._create_fifo_sync(fifo_path, session_id):
            self._terminal_fifos[session_id] = fifo_path
        else:
            logger.error(
                "FIFO setup failed",
                session_id=session_id,
                fifo=fifo_path,
            )

        return fifo_path

    async def _terminal_stream_output(
        self, session_id: str, workspace_id: str, working_dir: str, fifo_path: str
    ) -> None:
        """Stream terminal output using tmux pipe-pane.

        This provides real-time streaming by:
        1. Setting up pipe-pane to stream output to a FIFO immediately
        2. Reading from FIFO asynchronously and forwarding to websocket

        Note: We intentionally do NOT use capture-pane for initial content because
        it causes duplicate output. The shell prompt gets captured by both
        capture-pane (initial state) and pipe-pane (streaming), resulting in the
        prompt appearing twice or with extra newlines. By relying solely on
        pipe-pane, we get clean output from session start.
        """
        logger.info(
            "Terminal pipe-pane streaming started",
            session_id=session_id,
            workspace_id=workspace_id,
            fifo=fifo_path,
        )

        fd = None
        try:
            # Small initial delay to let tmux session start
            await asyncio.sleep(0.1)

            # Set up pipe-pane to stream to our FIFO
            pipe_cmd = f"tmux pipe-pane -t {session_id} 'cat >> {fifo_path}'"
            pipe_result = await self._exec_native(pipe_cmd, working_dir, timeout=5)
            if pipe_result.get("exit_code") != 0:
                logger.error(
                    "Failed to set up pipe-pane",
                    session_id=session_id,
                    error=pipe_result.get("stderr"),
                )
                return

            logger.info("pipe-pane configured", session_id=session_id)

            # 3. Open FIFO for reading (non-blocking)
            # First ensure the FIFO exists (recreate if needed)
            if not os.path.exists(fifo_path):
                logger.warning(
                    "FIFO missing before open, recreating",
                    fifo=fifo_path,
                    session_id=session_id,
                )
                if not self._create_fifo_sync(fifo_path, session_id):
                    logger.error(
                        "Failed to recreate FIFO",
                        fifo=fifo_path,
                        session_id=session_id,
                    )
                    return

            # O_RDONLY | O_NONBLOCK so we don't block waiting for writers
            fd = os.open(fifo_path, os.O_RDONLY | os.O_NONBLOCK)

            # 4. Read from FIFO and stream to websocket
            consecutive_empty_reads = 0
            max_empty_reads = 1000  # ~10 seconds of no output before checking session

            while True:
                try:
                    # Try to read data from FIFO
                    data = os.read(fd, TERMINAL_PIPE_READ_SIZE)

                    if data:
                        consecutive_empty_reads = 0
                        # Decode and emit immediately (real-time!)
                        text = data.decode("utf-8", errors="replace")

                        if self.sio and self.sio.connected:
                            await self.sio.emit(
                                "terminal_output",
                                {
                                    "session_id": session_id,
                                    "workspace_id": workspace_id,
                                    "data": text,
                                    "type": "stream",
                                },
                                namespace="/local-pod",
                            )
                        else:
                            logger.warning(
                                "Cannot emit - sio not connected",
                                session_id=session_id,
                            )
                    else:
                        consecutive_empty_reads += 1

                        # Periodically check if tmux session still exists
                        if consecutive_empty_reads >= max_empty_reads:
                            consecutive_empty_reads = 0
                            check = await self._exec_native(
                                f"tmux has-session -t {session_id} 2>/dev/null && echo 'exists'",
                                working_dir,
                                timeout=5,
                            )
                            if "exists" not in check.get("stdout", ""):
                                logger.info(
                                    "tmux session ended",
                                    session_id=session_id,
                                )
                                break

                        # Small sleep when no data (avoid busy loop)
                        await asyncio.sleep(0.01)

                except BlockingIOError:
                    # No data available right now - this is expected
                    await asyncio.sleep(0.01)
                except OSError as e:
                    if e.errno == 9:  # Bad file descriptor - FIFO was deleted
                        # Try to recreate FIFO and continue (lazy-load resilience)
                        logger.info(
                            "FIFO deleted, attempting recreation",
                            session_id=session_id,
                            fifo=fifo_path,
                        )

                        # Check if tmux session still exists before recreating
                        check = await self._exec_native(
                            f"tmux has-session -t {session_id} 2>/dev/null && echo 'exists'",
                            working_dir,
                            timeout=5,
                        )
                        if "exists" not in check.get("stdout", ""):
                            logger.info(
                                "tmux session ended, not recreating FIFO",
                                session_id=session_id,
                            )
                            break

                        # Recreate the FIFO
                        if not self._create_fifo_sync(fifo_path, session_id):
                            logger.error(
                                "Failed to recreate FIFO after deletion",
                                session_id=session_id,
                            )
                            break

                        # Re-establish pipe-pane
                        pipe_cmd = f"tmux pipe-pane -t {session_id} 'cat >> {fifo_path}'"
                        pipe_result = await self._exec_native(pipe_cmd, working_dir, timeout=5)
                        if pipe_result.get("exit_code") != 0:
                            logger.error(
                                "Failed to re-establish pipe-pane",
                                session_id=session_id,
                            )
                            break

                        # Re-open the FIFO
                        try:
                            fd = os.open(fifo_path, os.O_RDONLY | os.O_NONBLOCK)
                            self._terminal_fifos[session_id] = fifo_path
                            logger.info(
                                "FIFO recreated successfully",
                                session_id=session_id,
                            )
                            continue
                        except OSError:
                            logger.error(
                                "Failed to reopen recreated FIFO",
                                session_id=session_id,
                            )
                            break
                    raise

        except asyncio.CancelledError:
            logger.debug("Terminal stream cancelled", session_id=session_id)
        except Exception as e:
            logger.exception(
                "Error in terminal stream",
                session_id=session_id,
                error=str(e),
            )
        finally:
            # Clean up
            if fd is not None:
                with contextlib.suppress(OSError):
                    os.close(fd)

            # Stop pipe-pane
            await self._exec_native(
                f"tmux pipe-pane -t {session_id}",  # Empty command stops pipe-pane
                working_dir,
                timeout=5,
            )

            # Remove FIFO
            fifo = self._terminal_fifos.pop(session_id, None)
            if fifo and os.path.exists(fifo):
                with contextlib.suppress(OSError):
                    os.unlink(fifo)

            self._terminal_output_tasks.pop(session_id, None)
            logger.info("Terminal stream stopped", session_id=session_id)

    async def _terminal_input(self, params: dict[str, Any]) -> None:
        """Send input to a terminal session.

        STATELESS: Just needs session_id (tmux session name).

        Args:
            params: Must contain 'session_id' and 'data'
        """
        session_id = params.get("session_id", params.get("workspace_id", "default"))
        data = params.get("data", "")
        working_dir = self._get_working_dir(params)

        if not data:
            return

        # Send input to tmux session
        # Escape single quotes in data for shell
        escaped_data = data.replace("'", "'\"'\"'")
        await self._exec_native(
            f"tmux send-keys -t {session_id} '{escaped_data}'",
            working_dir,
            timeout=5,
        )

    async def _terminal_resize(self, params: dict[str, Any]) -> None:
        """Resize a terminal session.

        STATELESS: Just needs session_id (tmux session name).

        Args:
            params: Must contain 'session_id', 'rows', and 'cols'
        """
        session_id = params.get("session_id", params.get("workspace_id", "default"))
        rows = params.get("rows", 24)
        cols = params.get("cols", 80)
        working_dir = self._get_working_dir(params)

        # Resize tmux window
        await self._exec_native(
            f"tmux resize-window -t {session_id} -x {cols} -y {rows}",
            working_dir,
            timeout=5,
        )

    async def _terminal_close(self, params: dict[str, Any]) -> None:
        """Close a terminal session.

        STATELESS: Just needs session_id (tmux session name).

        Args:
            params: Must contain 'session_id'
        """
        session_id = params.get("session_id", params.get("workspace_id", "default"))
        working_dir = self._get_working_dir(params)

        # Stop output streaming task if running
        if session_id in self._terminal_output_tasks:
            self._terminal_output_tasks[session_id].cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._terminal_output_tasks[session_id]
            self._terminal_output_tasks.pop(session_id, None)

        # Clean up FIFO if it exists
        fifo = self._terminal_fifos.pop(session_id, None)
        if fifo and os.path.exists(fifo):
            with contextlib.suppress(OSError):
                os.unlink(fifo)

        # Stop pipe-pane before killing session
        await self._exec_native(
            f"tmux pipe-pane -t {session_id} 2>/dev/null || true",
            working_dir,
            timeout=5,
        )

        # Kill tmux session
        await self._exec_native(
            f"tmux kill-session -t {session_id} 2>/dev/null || true",
            working_dir,
            timeout=5,
        )

    # ==================== Tunnel (cloudflared) ====================

    def _tunnel_key(self, workspace_id: str, port: int) -> str:
        return f"{workspace_id}:{port}"

    async def _tunnel_start(self, params: dict[str, Any]) -> dict[str, Any]:
        """Start cloudflared for a workspace tunnel.

        Params: workspace_id, config { token, port, hostname }.
        """
        workspace_id = params["workspace_id"]
        cfg = params.get("config") or {}
        token = cfg.get("token")
        port = cfg.get("port")
        if not token or port is None:
            raise ValueError("tunnel config must include token and port")

        key = self._tunnel_key(workspace_id, port)
        if key in self._tunnel_processes:
            proc = self._tunnel_processes[key]
            if proc.poll() is None:
                return {"status": "running", "pid": proc.pid}
            self._tunnel_processes.pop(key, None)

        from .cloudflared_bundle import get_cloudflared_path

        cloudflared = get_cloudflared_path()
        cmd = [
            cloudflared,
            "tunnel",
            "run",
            "--token",
            token,
            "--url",
            f"http://localhost:{port}",
        ]
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except FileNotFoundError:
            raise ValueError(
                "cloudflared not found; install from https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation"
            ) from None
        except OSError as e:
            raise ValueError(f"Failed to start cloudflared: {e}") from e

        self._tunnel_processes[key] = proc
        logger.info(
            "Started cloudflared tunnel", workspace_id=workspace_id, port=port, pid=proc.pid
        )
        return {"status": "running", "pid": proc.pid}

    async def _tunnel_stop(self, params: dict[str, Any]) -> dict[str, Any]:
        """Stop cloudflared for a workspace tunnel.

        Params: workspace_id, port.
        """
        workspace_id = params["workspace_id"]
        port = params.get("port")
        if port is None:
            raise ValueError("tunnel stop requires port")

        key = self._tunnel_key(workspace_id, port)
        proc = self._tunnel_processes.pop(key, None)
        if not proc:
            return {"status": "stopped"}

        try:
            proc.terminate()
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            with contextlib.suppress(Exception):
                proc.kill()
            with contextlib.suppress(subprocess.TimeoutExpired, OSError):
                proc.wait(timeout=5)
        except OSError:
            pass
        logger.info("Stopped cloudflared tunnel", workspace_id=workspace_id, port=port)
        return {"status": "stopped"}

    async def _tunnel_status(self, params: dict[str, Any]) -> dict[str, Any]:
        """Report tunnel daemon health.

        Params: workspace_id. Returns status, connected for any tunnels for this workspace.
        """
        workspace_id = params["workspace_id"]
        connected = False
        for key in list(self._tunnel_processes):
            if key.startswith(f"{workspace_id}:"):
                proc = self._tunnel_processes.get(key)
                if proc and proc.poll() is None:
                    connected = True
                    break
        return {"status": "running" if connected else "stopped", "connected": connected}
