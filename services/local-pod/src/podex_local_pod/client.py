"""WebSocket client for Podex cloud connection."""

import asyncio
import contextlib
import platform
from datetime import UTC, datetime
from typing import Any, Protocol

import psutil
import socketio
import structlog

from .config import LocalPodConfig
from .docker_manager import LocalDockerManager
from .native_manager import NativeManager
from .rpc_handler import RPCHandler

logger = structlog.get_logger()


class WorkspaceManager(Protocol):
    """Protocol for workspace managers (Docker or Native)."""

    @property
    def workspaces(self) -> dict[str, dict[str, Any]]: ...

    # Lifecycle methods
    async def initialize(self) -> None: ...
    async def shutdown(self) -> None: ...
    async def create_workspace(
        self,
        workspace_id: str | None,
        user_id: str,
        session_id: str,
        config: dict[str, Any],
    ) -> dict[str, Any]: ...
    async def stop_workspace(self, workspace_id: str) -> None: ...
    async def delete_workspace(self, workspace_id: str, preserve_files: bool = True) -> None: ...
    async def get_workspace(self, workspace_id: str) -> dict[str, Any] | None: ...
    async def list_workspaces(
        self, user_id: str | None = None, session_id: str | None = None
    ) -> list[dict[str, Any]]: ...
    async def heartbeat(self, workspace_id: str) -> None: ...

    # Command execution
    async def exec_command(
        self,
        workspace_id: str,
        command: str,
        working_dir: str | None = None,
        timeout: int = 30,
    ) -> dict[str, Any]: ...

    # File operations
    async def read_file(self, workspace_id: str, path: str) -> str: ...
    async def write_file(self, workspace_id: str, path: str, content: str) -> None: ...
    async def list_files(self, workspace_id: str, path: str = ".") -> list[dict[str, Any]]: ...

    # Ports
    async def get_active_ports(self, workspace_id: str) -> list[dict[str, Any]]: ...

    # Proxy
    async def proxy_request(
        self,
        workspace_id: str,
        port: int,
        method: str,
        path: str,
        headers: dict[str, str],
        body: bytes | None,
        query_string: str | None,
    ) -> dict[str, Any]: ...

    # Terminal
    async def terminal_write(self, workspace_id: str, data: str) -> None: ...


class LocalPodClient:
    """WebSocket client that connects to Podex cloud.

    Maintains a persistent connection and handles RPC requests
    for workspace management.
    """

    def __init__(self, config: LocalPodConfig) -> None:
        """Initialize the client.

        Args:
            config: Pod configuration
        """
        self.config = config
        self.sio = socketio.AsyncClient(
            reconnection=True,
            reconnection_attempts=0,  # Infinite retries
            reconnection_delay=config.reconnect_delay,
            reconnection_delay_max=config.reconnect_delay_max,
            logger=False,
            engineio_logger=False,
        )

        # Initialize appropriate manager based on mode
        if config.is_native_mode():
            self.manager: WorkspaceManager = NativeManager(config)
            logger.info("Using native execution mode")
        else:
            self.manager = LocalDockerManager(config)
            logger.info("Using Docker execution mode")

        self.rpc_handler = RPCHandler(self.manager)
        self._running = False
        self._heartbeat_task: asyncio.Task[None] | None = None
        self._connected = False

        self._setup_handlers()

    def _setup_handlers(self) -> None:
        """Set up Socket.IO event handlers."""

        @self.sio.on("connect", namespace="/local-pod")
        async def on_connect() -> None:
            self._connected = True
            logger.info("Connected to Podex cloud")

            # Send capabilities
            await self._send_capabilities()

            # Start heartbeat
            if self._heartbeat_task is None or self._heartbeat_task.done():
                self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

        @self.sio.on("disconnect", namespace="/local-pod")
        async def on_disconnect() -> None:
            self._connected = False
            logger.info("Disconnected from Podex cloud")

            # Stop heartbeat
            if self._heartbeat_task and not self._heartbeat_task.done():
                self._heartbeat_task.cancel()

        @self.sio.on("connect_error", namespace="/local-pod")
        async def on_connect_error(data: Any) -> None:
            logger.error("Connection error", error=str(data))

        @self.sio.on("rpc_request", namespace="/local-pod")
        async def on_rpc_request(data: dict[str, Any]) -> None:
            """Handle RPC request from cloud."""
            call_id = data.get("call_id")
            method = data.get("method")
            params = data.get("params", {})

            logger.debug("RPC request received", call_id=call_id, method=method)

            if not isinstance(method, str):
                logger.error("Invalid RPC request: method must be a string")
                await self.sio.emit(
                    "rpc_response",
                    {"call_id": call_id, "error": "method must be a string"},
                    namespace="/local-pod",
                )
                return

            try:
                result = await self.rpc_handler.handle(method, params)
                await self.sio.emit(
                    "rpc_response",
                    {"call_id": call_id, "result": result},
                    namespace="/local-pod",
                )
                logger.debug("RPC response sent", call_id=call_id)
            except Exception as e:
                logger.exception("RPC handler error", method=method, error=str(e))
                await self.sio.emit(
                    "rpc_response",
                    {"call_id": call_id, "error": str(e)},
                    namespace="/local-pod",
                )

        @self.sio.on("terminal_input", namespace="/local-pod")
        async def on_terminal_input(data: dict[str, Any]) -> None:
            """Handle terminal input forwarded from cloud."""
            workspace_id = data.get("workspace_id")
            input_data = data.get("data")
            if workspace_id and input_data:
                await self.manager.terminal_write(workspace_id, input_data)

    async def _send_capabilities(self) -> None:
        """Send system capabilities and configuration to cloud."""
        # Get Docker version if in Docker mode
        docker_version: str | None = None
        if self.config.is_docker_mode():
            try:
                import docker

                docker_client = docker.from_env()
                docker_info = docker_client.info()
                docker_version = docker_info.get("ServerVersion", "unknown")
            except Exception:
                docker_version = "unavailable"

        capabilities = {
            "os_info": f"{platform.system()} {platform.release()}",
            "architecture": platform.machine(),
            "docker_version": docker_version,
            "total_memory_mb": psutil.virtual_memory().total // (1024 * 1024),
            "cpu_cores": psutil.cpu_count(),
            "max_workspaces": self.config.max_workspaces,
            "pod_version": "0.1.0",
        }

        # Include mode and mount configuration
        pod_config: dict[str, Any] = {
            "mode": self.config.mode,
            "mounts": self.config.get_mounts_as_dicts(),
        }

        # Include native settings if in native mode
        if self.config.is_native_mode():
            pod_config["native_security"] = self.config.native.security
            pod_config["native_workspace_dir"] = self.config.native.workspace_dir

        await self.sio.emit(
            "capabilities",
            {"capabilities": capabilities, "config": pod_config},
            namespace="/local-pod",
        )
        logger.info(
            "Capabilities sent",
            mode=self.config.mode,
            mounts=len(self.config.mounts),
        )

    async def _heartbeat_loop(self) -> None:
        """Send periodic heartbeats to cloud."""
        while self._running and self._connected:
            try:
                # Get current workspace count
                active_workspaces = len(self.manager.workspaces)

                # Send heartbeat
                await self.sio.emit(
                    "heartbeat",
                    {
                        "timestamp": datetime.now(UTC).isoformat(),
                        "active_workspaces": active_workspaces,
                        "memory_used_mb": psutil.virtual_memory().used // (1024 * 1024),
                        "memory_percent": psutil.virtual_memory().percent,
                        "cpu_percent": psutil.cpu_percent(),
                    },
                    namespace="/local-pod",
                )

                await asyncio.sleep(self.config.heartbeat_interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning("Heartbeat error", error=str(e))
                await asyncio.sleep(5)

    async def run(self, shutdown_event: asyncio.Event) -> None:
        """Connect and run the client until shutdown.

        Args:
            shutdown_event: Event that signals shutdown
        """
        self._running = True

        # Initialize workspace manager
        await self.manager.initialize()

        # Build WebSocket URL
        ws_url = self.config.cloud_url.replace("https://", "wss://").replace("http://", "ws://")

        logger.info("Connecting to Podex cloud", url=ws_url)

        try:
            await self.sio.connect(
                ws_url,
                namespaces=["/local-pod"],
                auth={"token": self.config.pod_token},
                wait_timeout=30,
            )

            logger.info("Connection established, waiting for commands...")

            # Keep running until shutdown
            while self._running and not shutdown_event.is_set():
                await asyncio.sleep(1)

        except socketio.exceptions.ConnectionError as e:
            logger.error("Failed to connect to Podex cloud", error=str(e))
            raise
        except Exception as e:
            logger.exception("Unexpected error", error=str(e))
            raise

    async def shutdown(self) -> None:
        """Gracefully shut down the client."""
        logger.info("Shutting down local pod...")
        self._running = False

        # Stop heartbeat
        if self._heartbeat_task and not self._heartbeat_task.done():
            self._heartbeat_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._heartbeat_task

        # Stop all workspaces gracefully
        await self.manager.shutdown()

        # Disconnect from cloud
        if self.sio.connected:
            await self.sio.disconnect()

        logger.info("Local pod shutdown complete")
