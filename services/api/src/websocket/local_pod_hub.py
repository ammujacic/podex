"""Socket.IO WebSocket hub for local pod connections.

This module handles WebSocket connections from self-hosted local pod agents.
Pods connect via outbound WebSocket and receive RPC commands for workspace management.
"""

import asyncio
import contextlib
import hashlib
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import socketio
import structlog
from sqlalchemy import select, update

from src.database.connection import async_session_factory
from src.database.models import LocalPod

logger = structlog.get_logger()

# Track connected pods: pod_id -> {sid, user_id, name, connected_at}
_connected_pods: dict[str, dict[str, Any]] = {}

# Reverse mapping: sid -> pod_id
_sid_to_pod: dict[str, str] = {}

# Pending RPC calls: call_id -> {future, timeout_task}
_pending_calls: dict[str, dict[str, Any]] = {}

# RPC timeout in seconds
DEFAULT_RPC_TIMEOUT = 30.0


async def _verify_pod_token(token: str) -> LocalPod | None:
    """Verify pod token and return the pod if valid."""
    if not token or not token.startswith("pdx_pod_"):
        return None

    token_hash = hashlib.sha256(token.encode()).hexdigest()

    async with async_session_factory() as db:
        result = await db.execute(
            select(LocalPod).where(LocalPod.token_hash == token_hash),
        )
        return result.scalar_one_or_none()


async def _update_pod_status(
    pod_id: str,
    status: str,
    *,
    last_error: str | None = None,
) -> None:
    """Update pod status in database."""
    async with async_session_factory() as db:
        values: dict[str, Any] = {
            "status": status,
            "updated_at": datetime.now(UTC),
        }
        if status == "online":
            values["last_heartbeat"] = datetime.now(UTC)
            values["last_error"] = None
        elif last_error:
            values["last_error"] = last_error

        await db.execute(
            update(LocalPod).where(LocalPod.id == pod_id).values(**values),
        )
        await db.commit()


async def _update_pod_capabilities(
    pod_id: str,
    capabilities: dict[str, Any],
) -> None:
    """Update pod capabilities in database.

    Args:
        pod_id: Pod ID to update.
        capabilities: System capabilities (os_info, architecture, etc.).
    """
    values: dict[str, Any] = {
        "os_info": capabilities.get("os_info"),
        "architecture": capabilities.get("architecture"),
        "total_memory_mb": capabilities.get("total_memory_mb"),
        "total_cpu_cores": capabilities.get("cpu_cores"),
        "updated_at": datetime.now(UTC),
    }

    async with async_session_factory() as db:
        await db.execute(
            update(LocalPod).where(LocalPod.id == pod_id).values(**values),
        )
        await db.commit()


async def _update_pod_heartbeat(pod_id: str, current_workspaces: int) -> None:
    """Update pod heartbeat in database."""
    async with async_session_factory() as db:
        await db.execute(
            update(LocalPod)
            .where(LocalPod.id == pod_id)
            .values(
                last_heartbeat=datetime.now(UTC),
                current_workspaces=current_workspaces,
                updated_at=datetime.now(UTC),
            ),
        )
        await db.commit()


async def _update_local_pod_workspaces_status(pod_id: str, status: str) -> None:
    """Update status of all workspaces on a local pod and emit events to connected clients.

    Local workspaces should never go to standby - they reflect the pod connection status:
    - 'running' when pod is connected
    - 'offline' when pod is disconnected

    Args:
        pod_id: The local pod ID.
        status: The new status to set ('running' or 'offline').
    """
    from src.database.models import Session, Workspace
    from src.websocket.hub import emit_to_session

    async with async_session_factory() as db:
        # Find all workspaces on this pod with their sessions
        result = await db.execute(
            select(Workspace, Session)
            .join(Session, Session.workspace_id == Workspace.id)
            .where(Workspace.local_pod_id == pod_id)
        )
        workspace_sessions = result.all()

        for workspace, session in workspace_sessions:
            old_status = workspace.status
            # Don't update if already in the target status or if stopped.
            # IMPORTANT: allow recovering from 'error' back to 'running' when the pod is healthy.
            if old_status in (status, "stopped"):
                continue

            # If the pod reports 'offline', keep existing 'error' (it already indicates a problem).
            # If the pod reports 'running', treat as heartbeat: workspace healthy again,
            # so we can safely move from 'error' -> 'running'.
            if status == "offline" and old_status == "error":
                continue

            workspace.status = status
            workspace.updated_at = datetime.now(UTC)

            logger.info(
                "Local pod workspace status changed",
                workspace_id=workspace.id,
                session_id=session.id,
                old_status=old_status,
                new_status=status,
                pod_id=pod_id,
            )

            # Emit workspace status event to connected clients
            await emit_to_session(
                session.id,
                "workspace_status",
                {
                    "workspace_id": workspace.id,
                    "status": status,
                },
            )

        await db.commit()


class LocalPodNamespace(socketio.AsyncNamespace):
    """Socket.IO namespace for local pod connections."""

    def __init__(self) -> None:
        super().__init__("/local-pod")

    async def on_connect(
        self,
        sid: str,
        _environ: dict[str, Any],
        auth: dict[str, str] | None,
    ) -> bool:
        """Handle pod connection with token authentication.

        Args:
            sid: Socket ID
            environ: WSGI environ dict
            auth: Authentication data containing 'token'

        Returns:
            True if connection is accepted, False to reject
        """
        token = auth.get("token") if auth else None
        if not token:
            logger.warning("Local pod connection without token", sid=sid)
            return False

        pod = await _verify_pod_token(token)
        if not pod:
            logger.warning("Invalid local pod token", sid=sid)
            return False

        # Check if pod is already connected (prevent duplicate connections)
        if pod.id in _connected_pods:
            old_sid = _connected_pods[pod.id]["sid"]
            logger.info(
                "Local pod reconnecting, disconnecting old session",
                pod_id=pod.id,
                old_sid=old_sid,
            )
            # Clean up old connection
            _sid_to_pod.pop(old_sid, None)
            with contextlib.suppress(Exception):
                await self.disconnect(old_sid)

        # Register pod connection
        _connected_pods[pod.id] = {
            "sid": sid,
            "user_id": pod.user_id,
            "name": pod.name,
            "connected_at": datetime.now(UTC),
        }
        _sid_to_pod[sid] = pod.id

        # Update pod status in database
        await _update_pod_status(pod.id, "online")

        # Update all workspaces on this pod to 'running' status
        # (they may have been 'offline' if pod was disconnected)
        await _update_local_pod_workspaces_status(pod.id, "running")

        # Store pod_id in session for later use
        await self.save_session(sid, {"pod_id": pod.id, "user_id": pod.user_id})

        logger.info("Local pod connected", pod_id=pod.id, name=pod.name, sid=sid)
        return True

    async def on_disconnect(self, sid: str) -> None:
        """Handle pod disconnection."""
        pod_id = _sid_to_pod.pop(sid, None)

        if pod_id and pod_id in _connected_pods:
            pod_info = _connected_pods.pop(pod_id)

            # Update pod status in database
            await _update_pod_status(pod_id, "offline")

            # Update all workspaces on this pod to 'offline' status
            await _update_local_pod_workspaces_status(pod_id, "offline")

            # Cancel any pending RPC calls to this pod
            for call_id, pending in list(_pending_calls.items()):
                if pending.get("pod_id") == pod_id:
                    pending["timeout_task"].cancel()
                    pending["future"].set_exception(
                        ConnectionError(f"Pod {pod_id} disconnected"),
                    )
                    _pending_calls.pop(call_id, None)

            logger.info(
                "Local pod disconnected",
                pod_id=pod_id,
                name=pod_info.get("name"),
                sid=sid,
            )

    async def on_capabilities(self, sid: str, data: dict[str, Any]) -> None:
        """Handle pod capabilities report (sent on connect).

        Pods send their system capabilities after connecting.
        Data format:
        {
            "capabilities": {"os_info": ..., "architecture": ..., ...}
        }
        """
        pod_id = _sid_to_pod.get(sid)
        if not pod_id:
            return

        # Handle both old format (flat capabilities) and new format (nested)
        capabilities = data.get("capabilities", data)
        await _update_pod_capabilities(pod_id, capabilities)
        logger.info("Local pod capabilities received", pod_id=pod_id)

    async def on_heartbeat(self, sid: str, data: dict[str, Any]) -> None:
        """Handle pod heartbeat with system stats.

        Pods send heartbeats every 30 seconds with their current stats.
        """
        pod_id = _sid_to_pod.get(sid)
        if not pod_id:
            return

        current_workspaces = data.get("active_workspaces", 0)
        await _update_pod_heartbeat(pod_id, current_workspaces)

        # Update in-memory tracking
        if pod_id in _connected_pods:
            _connected_pods[pod_id]["last_heartbeat"] = datetime.now(UTC)
            _connected_pods[pod_id]["active_workspaces"] = current_workspaces

    async def on_rpc_response(self, _sid: str, data: dict[str, Any]) -> None:
        """Handle RPC response from pod.

        Pods send responses to RPC calls initiated by the cloud.
        """
        call_id = data.get("call_id")
        if not call_id or call_id not in _pending_calls:
            logger.warning("Received response for unknown RPC call", call_id=call_id)
            return

        pending = _pending_calls.pop(call_id)
        pending["timeout_task"].cancel()

        if data.get("error"):
            pending["future"].set_exception(Exception(data["error"]))
        else:
            pending["future"].set_result(data.get("result"))

    async def on_workspace_event(self, sid: str, data: dict[str, Any]) -> None:
        """Handle workspace event from pod.

        Pods can emit events like workspace status changes, errors, etc.
        """
        pod_id = _sid_to_pod.get(sid)
        if not pod_id:
            return

        event_type = data.get("type")
        workspace_id = data.get("workspace_id")

        logger.info(
            "Workspace event from local pod",
            pod_id=pod_id,
            event_type=event_type,
            workspace_id=workspace_id,
            data=data,
        )

        # Forward events to session/workspace subscribers
        if workspace_id and event_type:
            # Import here to avoid circular imports
            from src.websocket.hub import emit_to_session

            # Get session ID for this workspace from the database
            async with async_session_factory() as db:
                from src.database.models import Session as SessionModel

                result = await db.execute(
                    select(SessionModel.id).where(SessionModel.workspace_id == workspace_id)
                )
                session_id = result.scalar_one_or_none()

                if session_id:
                    # Forward to all clients subscribed to this session
                    await emit_to_session(
                        session_id,
                        "workspace_event",
                        {
                            "workspace_id": workspace_id,
                            "event_type": event_type,
                            "pod_id": pod_id,
                            **data,
                        },
                    )
                    logger.debug(
                        "Forwarded workspace event to session",
                        session_id=session_id,
                        workspace_id=workspace_id,
                        event_type=event_type,
                    )

    async def on_ping(self, sid: str, data: dict[str, Any]) -> dict[str, Any]:
        """Simple ping handler to test call() mechanism."""
        logger.info("ping received", sid=sid, data=data)
        return {"pong": True, "received": data}

    async def on_terminal_output(self, sid: str, data: dict[str, Any]) -> None:
        """Handle terminal output from pod.

        Pods stream terminal output for local pod terminals.
        Forward to the terminal manager which will send to connected clients.
        """
        pod_id = _sid_to_pod.get(sid)
        if not pod_id:
            logger.warning("terminal_output from unknown pod", sid=sid)
            return

        session_id = data.get("session_id")
        workspace_id = data.get("workspace_id")
        output_data = data.get("data", "")
        output_type = data.get("type")  # "incremental" or "full"

        logger.info(
            "Received terminal_output from pod",
            pod_id=pod_id,
            session_id=session_id,
            workspace_id=workspace_id,
            output_type=output_type,
            data_length=len(output_data) if output_data else 0,
        )

        if not output_data:
            return

        # Forward to terminal manager which handles client connections
        from src.terminal.manager import terminal_manager

        # Log available sessions for debugging
        logger.debug(
            "Looking up terminal session",
            session_id=session_id,
            workspace_id=workspace_id,
            available_sessions=list(terminal_manager.sessions.keys()),
        )

        # Try to find session by session_id first, then by workspace_id
        session = terminal_manager.sessions.get(session_id) if session_id else None
        if not session and workspace_id:
            session = terminal_manager.sessions.get(workspace_id)

        if session and session.on_output:
            try:
                # Call the output callback (handles both sync and async)
                # The callback expects workspace_id as first param (for room targeting)
                import inspect

                # Use workspace_id for the callback (it's used to target the room)
                callback_id = workspace_id or session.workspace_id

                if inspect.iscoroutinefunction(session.on_output):
                    await session.on_output(callback_id, output_data)
                else:
                    session.on_output(callback_id, output_data)

                logger.info(
                    "Terminal output forwarded to client",
                    session_id=session_id,
                    workspace_id=workspace_id,
                    output_type=output_type,
                    data_length=len(output_data),
                )
            except Exception as e:
                logger.warning(
                    "Failed to forward terminal output",
                    session_id=session_id,
                    error=str(e),
                )
        else:
            logger.warning(
                "No active terminal session for output",
                session_id=session_id,
                workspace_id=workspace_id,
                available_sessions=list(terminal_manager.sessions.keys()),
            )


# Create namespace instance
local_pod_namespace = LocalPodNamespace()


# ============== Public API for calling pods ==============


def is_pod_online(pod_id: str) -> bool:
    """Check if a pod is currently connected."""
    return pod_id in _connected_pods


def get_online_pods_for_user(user_id: str) -> list[str]:
    """Get list of connected pod IDs for a user."""
    return [pid for pid, info in _connected_pods.items() if info.get("user_id") == user_id]


class PodNotConnectedError(ValueError):
    """Raised when attempting to call a pod that is not connected."""

    def __init__(self, pod_id: str) -> None:
        super().__init__(f"Pod {pod_id} is not connected")
        self.pod_id = pod_id


async def call_pod(
    pod_id: str,
    method: str,
    params: dict[str, Any],
    rpc_timeout: float = DEFAULT_RPC_TIMEOUT,
) -> object:
    """Make an RPC call to a pod and wait for response.

    Args:
        pod_id: ID of the pod to call
        method: RPC method name (e.g., "workspace.create")
        params: Parameters to pass to the method
        rpc_timeout: Timeout in seconds

    Returns:
        The result from the pod

    Raises:
        PodNotConnectedError: If pod is not connected
        TimeoutError: If call times out
        Exception: If pod returns an error
    """
    if pod_id not in _connected_pods:
        raise PodNotConnectedError(pod_id)

    sid = _connected_pods[pod_id]["sid"]
    call_id = f"{pod_id}:{method}:{uuid4().hex[:8]}"

    # Create future for response
    loop = asyncio.get_event_loop()
    future: asyncio.Future[object] = loop.create_future()

    # Setup timeout
    async def handle_rpc_timeout() -> None:
        await asyncio.sleep(rpc_timeout)
        if call_id in _pending_calls:
            _pending_calls.pop(call_id)
            if not future.done():
                future.set_exception(TimeoutError(f"RPC call {method} timed out"))

    rpc_timeout_task = asyncio.create_task(handle_rpc_timeout())

    _pending_calls[call_id] = {
        "future": future,
        "pod_id": pod_id,
        "timeout_task": rpc_timeout_task,
    }

    # Send RPC request to pod
    await local_pod_namespace.emit(
        "rpc_request",
        {"call_id": call_id, "method": method, "params": params},
        to=sid,
    )

    logger.debug("RPC call sent to pod", pod_id=pod_id, method=method, call_id=call_id)

    return await future


async def broadcast_to_pod(pod_id: str, event: str, data: dict[str, Any]) -> None:
    """Send an event to a pod without waiting for response.

    Args:
        pod_id: ID of the pod
        event: Event name
        data: Event data
    """
    if pod_id not in _connected_pods:
        return

    sid = _connected_pods[pod_id]["sid"]
    await local_pod_namespace.emit(event, data, to=sid)


# ============== RPC Method Names ==============


class RPCMethods:
    """RPC method names for pod communication."""

    # Workspace lifecycle
    WORKSPACE_CREATE = "workspace.create"
    WORKSPACE_STOP = "workspace.stop"
    WORKSPACE_DELETE = "workspace.delete"
    WORKSPACE_GET = "workspace.get"
    WORKSPACE_UPDATE = "workspace.update"
    WORKSPACE_LIST = "workspace.list"
    WORKSPACE_HEARTBEAT = "workspace.heartbeat"

    # Command execution
    WORKSPACE_EXEC = "workspace.exec"

    # File operations
    WORKSPACE_READ_FILE = "workspace.read_file"
    WORKSPACE_WRITE_FILE = "workspace.write_file"
    WORKSPACE_LIST_FILES = "workspace.list_files"

    # Terminal
    TERMINAL_CREATE = "terminal.create"
    TERMINAL_INPUT = "terminal.input"
    TERMINAL_RESIZE = "terminal.resize"
    TERMINAL_CLOSE = "terminal.close"

    # Preview/ports
    WORKSPACE_GET_PORTS = "workspace.get_ports"
    WORKSPACE_PROXY = "workspace.proxy"

    # Health
    HEALTH_CHECK = "health.check"

    # Host filesystem browsing
    HOST_BROWSE = "host.browse"

    TUNNEL_START = "tunnel.start"
    TUNNEL_STOP = "tunnel.stop"
    TUNNEL_STATUS = "tunnel.status"
