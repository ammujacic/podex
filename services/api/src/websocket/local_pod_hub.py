"""Socket.IO WebSocket hub for local pod connections.

This module handles WebSocket connections from self-hosted local pod agents.
Pods connect via outbound WebSocket and receive RPC commands for workspace management.

Multi-Worker Architecture:
- Pod connection state is stored in Redis for cross-worker visibility
- Each worker tracks its own socket connections locally (_sid_to_pod)
- RPC requests are routed via Redis pub/sub to the worker owning the pod connection
- RPC responses are routed back via Redis pub/sub to the requesting worker
"""

import asyncio
import contextlib
import hashlib
import json
import os
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import redis.asyncio as aioredis
import socketio
import structlog
from sqlalchemy import select, update

from src.config import settings
from src.database.connection import async_session_factory
from src.database.models import LocalPod

logger = structlog.get_logger()

# Redis keys for pod state
POD_CONNECTION_KEY = "podex:pod:connection:{pod_id}"
POD_CONNECTION_TTL = 300  # 5 minutes, refreshed on heartbeat
POD_RPC_REQUEST_CHANNEL = "podex:pod:rpc:request"
POD_RPC_RESPONSE_CHANNEL = "podex:pod:rpc:response:{worker_id}"

# Worker ID for this process (used for RPC response routing)
WORKER_ID = f"worker-{os.getpid()}-{uuid4().hex[:8]}"

# Local tracking (worker-local, not shared)
# sid -> pod_id (for this worker's socket connections only)
_sid_to_pod: dict[str, str] = {}

# Pending RPC calls on this worker: call_id -> {future, timeout_task, pod_id}
_pending_calls: dict[str, dict[str, Any]] = {}

# Background tasks that should be kept alive (to avoid RUF006 warning)
_background_tasks: set[asyncio.Task[None]] = set()

# Redis client and pubsub for RPC routing
_redis: aioredis.Redis | None = None  # type: ignore[type-arg]
_rpc_pubsub: aioredis.client.PubSub | None = None
_rpc_listener_task: asyncio.Task[None] | None = None

# RPC timeout in seconds
DEFAULT_RPC_TIMEOUT = 30.0


async def _get_redis() -> aioredis.Redis:  # type: ignore[type-arg]
    """Get or create Redis client."""
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis


async def _store_pod_connection(pod_id: str, user_id: str, name: str, sid: str) -> None:
    """Store pod connection info in Redis."""
    try:
        redis = await _get_redis()
        key = POD_CONNECTION_KEY.format(pod_id=pod_id)
        data = json.dumps(
            {
                "worker_id": WORKER_ID,
                "user_id": user_id,
                "name": name,
                "sid": sid,
                "connected_at": datetime.now(UTC).isoformat(),
            }
        )
        await redis.setex(key, POD_CONNECTION_TTL, data)
    except Exception as e:
        logger.warning("Failed to store pod connection in Redis", error=str(e))


async def _remove_pod_connection(pod_id: str) -> None:
    """Remove pod connection info from Redis."""
    try:
        redis = await _get_redis()
        key = POD_CONNECTION_KEY.format(pod_id=pod_id)
        await redis.delete(key)
    except Exception as e:
        logger.warning("Failed to remove pod connection from Redis", error=str(e))


async def _refresh_pod_connection(pod_id: str) -> None:
    """Refresh TTL on pod connection in Redis (called on heartbeat)."""
    try:
        redis = await _get_redis()
        key = POD_CONNECTION_KEY.format(pod_id=pod_id)
        await redis.expire(key, POD_CONNECTION_TTL)
    except Exception as e:
        logger.warning("Failed to refresh pod connection TTL", error=str(e))


async def _get_pod_connection(pod_id: str) -> dict[str, Any] | None:
    """Get pod connection info from Redis."""
    try:
        redis = await _get_redis()
        key = POD_CONNECTION_KEY.format(pod_id=pod_id)
        data = await redis.get(key)
        if data:
            result: dict[str, Any] = json.loads(data)
            return result
    except Exception as e:
        logger.warning("Failed to get pod connection from Redis", error=str(e))
    return None


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


async def _update_pod_heartbeat(pod_id: str, _reported_workspaces: int) -> None:
    """Update pod heartbeat in database.

    Note: We count active workspaces from the database rather than using the
    reported count from the local pod, since native mode pods are stateless
    and don't track workspace state locally.
    """
    from sqlalchemy import func

    from src.database.models import Workspace

    async with async_session_factory() as db:
        # Count active workspaces on this pod from the database
        result = await db.execute(
            select(func.count())
            .select_from(Workspace)
            .where(
                Workspace.local_pod_id == pod_id,
                Workspace.status.in_(["pending", "running", "starting"]),
            )
        )
        workspace_count = result.scalar() or 0

        await db.execute(
            update(LocalPod)
            .where(LocalPod.id == pod_id)
            .values(
                last_heartbeat=datetime.now(UTC),
                current_workspaces=workspace_count,
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

        # Check if pod is already connected on this worker (prevent duplicate connections)
        existing_conn = await _get_pod_connection(pod.id)
        if existing_conn and existing_conn.get("worker_id") == WORKER_ID:
            old_sid = existing_conn.get("sid")
            if old_sid:
                logger.info(
                    "Local pod reconnecting on same worker, disconnecting old session",
                    pod_id=pod.id,
                    old_sid=old_sid,
                )
                _sid_to_pod.pop(old_sid, None)
                with contextlib.suppress(Exception):
                    await self.disconnect(old_sid)
        elif existing_conn:
            # Pod is connected on another worker - that's ok, it will disconnect
            logger.info(
                "Local pod reconnecting from different worker",
                pod_id=pod.id,
                old_worker=existing_conn.get("worker_id"),
            )

        # Register pod connection in Redis
        await _store_pod_connection(pod.id, pod.user_id, pod.name, sid)
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

        if pod_id:
            # Get pod info from Redis before removing
            pod_info = await _get_pod_connection(pod_id)

            # Only clean up if this worker owns the connection
            if pod_info and pod_info.get("worker_id") == WORKER_ID:
                # Remove from Redis
                await _remove_pod_connection(pod_id)

                # Update pod status in database
                await _update_pod_status(pod_id, "offline")

                # Update all workspaces on this pod to 'offline' status
                await _update_local_pod_workspaces_status(pod_id, "offline")

                # Cancel any pending RPC calls to this pod on this worker
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
                    name=pod_info.get("name") if pod_info else "unknown",
                    sid=sid,
                    worker_id=WORKER_ID,
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

        # Refresh Redis TTL to keep connection alive
        await _refresh_pod_connection(pod_id)

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
    """Check if a pod is currently connected (sync version).

    Note: This uses a sync check that may be slightly stale.
    For accurate results, use is_pod_online_async.
    """
    # Check if this worker has the pod connected locally
    return pod_id in _sid_to_pod.values()


async def is_pod_online_async(pod_id: str) -> bool:
    """Check if a pod is currently connected (async, checks Redis)."""
    conn = await _get_pod_connection(pod_id)
    return conn is not None


async def get_online_pods_for_user(user_id: str) -> list[str]:
    """Get list of connected pod IDs for a user.

    Multi-Worker: Queries Redis for pods connected across all workers.
    """
    try:
        redis = await _get_redis()
        # Scan for all pod connection keys
        online_pods = []
        cursor = 0
        while True:
            cursor, keys = await redis.scan(cursor, match="podex:pod:connection:*", count=100)
            for key in keys:
                data = await redis.get(key)
                if data:
                    conn = json.loads(data)
                    if conn.get("user_id") == user_id:
                        # Extract pod_id from key
                        pod_id = key.replace("podex:pod:connection:", "")
                        online_pods.append(pod_id)
            if cursor == 0:
                break
        return online_pods  # noqa: TRY300
    except Exception as e:
        logger.warning("Failed to get online pods from Redis", error=str(e))
        return []


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

    Multi-Worker: If pod is connected to this worker, sends directly.
    Otherwise, routes via Redis pub/sub to the worker owning the connection.

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
    # Check Redis for pod connection
    conn = await _get_pod_connection(pod_id)
    if not conn:
        raise PodNotConnectedError(pod_id)

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

    # Check if pod is connected to this worker
    target_worker = conn.get("worker_id")
    if target_worker == WORKER_ID:
        # Pod is on this worker - send directly
        sid = conn.get("sid")
        if not sid:
            _pending_calls.pop(call_id, None)
            rpc_timeout_task.cancel()
            raise PodNotConnectedError(pod_id)

        await local_pod_namespace.emit(
            "rpc_request",
            {"call_id": call_id, "method": method, "params": params},
            to=sid,
        )
        logger.debug(
            "RPC call sent directly to pod",
            pod_id=pod_id,
            method=method,
            call_id=call_id,
        )
    else:
        # Pod is on another worker - route via Redis pub/sub
        redis = await _get_redis()
        rpc_request = json.dumps(
            {
                "call_id": call_id,
                "pod_id": pod_id,
                "method": method,
                "params": params,
                "requesting_worker": WORKER_ID,
            }
        )
        await redis.publish(POD_RPC_REQUEST_CHANNEL, rpc_request)
        logger.debug(
            "RPC call routed via Redis",
            pod_id=pod_id,
            method=method,
            call_id=call_id,
            target_worker=target_worker,
        )

    return await future


async def broadcast_to_pod(pod_id: str, event: str, data: dict[str, Any]) -> None:
    """Send an event to a pod without waiting for response.

    Multi-Worker: If pod is on this worker, sends directly.
    Otherwise, routes via Redis pub/sub to the worker owning the connection.

    Args:
        pod_id: ID of the pod
        event: Event name
        data: Event data
    """
    conn = await _get_pod_connection(pod_id)
    if not conn:
        return

    target_worker = conn.get("worker_id")
    if target_worker == WORKER_ID:
        # Pod is on this worker - send directly
        sid = conn.get("sid")
        if sid:
            await local_pod_namespace.emit(event, data, to=sid)
    else:
        # Pod is on another worker - route via Redis pub/sub
        redis = await _get_redis()
        broadcast_msg = json.dumps(
            {
                "type": "broadcast",
                "pod_id": pod_id,
                "event": event,
                "data": data,
            }
        )
        await redis.publish(POD_RPC_REQUEST_CHANNEL, broadcast_msg)


# ============== Cross-Worker RPC Listener ==============


async def _handle_rpc_request(message: dict[str, Any]) -> None:
    """Handle an RPC request routed from another worker.

    If this worker owns the pod connection, forwards the request and
    routes the response back to the requesting worker.
    """
    pod_id = message.get("pod_id")
    call_id = message.get("call_id")
    method = message.get("method")
    params = message.get("params", {})
    requesting_worker = message.get("requesting_worker")

    if (
        not isinstance(pod_id, str)
        or not isinstance(call_id, str)
        or not method
        or not isinstance(requesting_worker, str)
    ):
        logger.warning("Invalid RPC request message", message=message)
        return

    # Check if this worker owns the pod connection
    conn = await _get_pod_connection(pod_id)
    if not conn or conn.get("worker_id") != WORKER_ID:
        # Not our pod, ignore
        return

    sid = conn.get("sid")
    if not sid:
        # Send error response back
        await _send_rpc_response(requesting_worker, call_id, error="Pod not connected")
        return

    # Forward the request to the pod
    # Create a local future to capture the response
    loop = asyncio.get_event_loop()
    future: asyncio.Future[object] = loop.create_future()

    async def handle_timeout() -> None:
        await asyncio.sleep(DEFAULT_RPC_TIMEOUT)
        if call_id in _pending_calls:
            _pending_calls.pop(call_id)
            if not future.done():
                future.set_exception(TimeoutError(f"RPC call {method} timed out"))

    timeout_task = asyncio.create_task(handle_timeout())

    _pending_calls[call_id] = {
        "future": future,
        "pod_id": pod_id,
        "timeout_task": timeout_task,
        "requesting_worker": requesting_worker,  # Track where to send response
    }

    await local_pod_namespace.emit(
        "rpc_request",
        {"call_id": call_id, "method": method, "params": params},
        to=sid,
    )

    logger.debug(
        "Forwarded RPC request to pod",
        pod_id=pod_id,
        method=method,
        call_id=call_id,
        requesting_worker=requesting_worker,
    )

    # Wait for response and route it back
    try:
        result = await future
        await _send_rpc_response(requesting_worker, call_id, result=result)
    except Exception as e:
        await _send_rpc_response(requesting_worker, call_id, error=str(e))


async def _handle_broadcast(message: dict[str, Any]) -> None:
    """Handle a broadcast request routed from another worker."""
    pod_id = message.get("pod_id")
    event = message.get("event")
    data = message.get("data", {})

    if not isinstance(pod_id, str) or not event:
        return

    # Check if this worker owns the pod connection
    conn = await _get_pod_connection(pod_id)
    if not conn or conn.get("worker_id") != WORKER_ID:
        return

    sid = conn.get("sid")
    if sid:
        await local_pod_namespace.emit(event, data, to=sid)


async def _send_rpc_response(
    target_worker: str,
    call_id: str,
    result: object = None,
    error: str | None = None,
) -> None:
    """Send an RPC response to a specific worker via Redis pub/sub."""
    redis = await _get_redis()
    channel = POD_RPC_RESPONSE_CHANNEL.format(worker_id=target_worker)
    response = json.dumps(
        {
            "call_id": call_id,
            "result": result,
            "error": error,
        }
    )
    await redis.publish(channel, response)


async def _handle_rpc_response(message: dict[str, Any]) -> None:
    """Handle an RPC response routed from another worker."""
    call_id = message.get("call_id")
    if not call_id or call_id not in _pending_calls:
        return

    pending = _pending_calls.pop(call_id)
    pending["timeout_task"].cancel()

    if message.get("error"):
        pending["future"].set_exception(Exception(message["error"]))
    else:
        pending["future"].set_result(message.get("result"))


async def _rpc_listener() -> None:
    """Listen for RPC requests and responses via Redis pub/sub.

    This task runs on each worker to:
    1. Receive RPC requests from other workers (for pods we own)
    2. Receive RPC responses from other workers (for calls we initiated)
    """
    global _rpc_pubsub

    try:
        redis = await _get_redis()
        _rpc_pubsub = redis.pubsub()

        # Subscribe to RPC request channel and our worker's response channel
        await _rpc_pubsub.subscribe(POD_RPC_REQUEST_CHANNEL)
        await _rpc_pubsub.subscribe(POD_RPC_RESPONSE_CHANNEL.format(worker_id=WORKER_ID))

        logger.info(
            "RPC listener started",
            worker_id=WORKER_ID,
            request_channel=POD_RPC_REQUEST_CHANNEL,
            response_channel=POD_RPC_RESPONSE_CHANNEL.format(worker_id=WORKER_ID),
        )

        while True:
            message = await _rpc_pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message is None:
                continue

            if message["type"] != "message":
                continue

            try:
                data = json.loads(message["data"])
                channel = message["channel"]

                if channel == POD_RPC_REQUEST_CHANNEL:
                    # Handle broadcast vs RPC request
                    if data.get("type") == "broadcast":
                        task = asyncio.create_task(_handle_broadcast(data))
                    else:
                        task = asyncio.create_task(_handle_rpc_request(data))
                    _background_tasks.add(task)
                    task.add_done_callback(_background_tasks.discard)
                elif channel == POD_RPC_RESPONSE_CHANNEL.format(worker_id=WORKER_ID):
                    await _handle_rpc_response(data)
            except json.JSONDecodeError:
                logger.warning("Invalid JSON in RPC message", data=message["data"])
            except Exception as e:
                logger.warning("Error handling RPC message", error=str(e))

    except asyncio.CancelledError:
        logger.info("RPC listener cancelled", worker_id=WORKER_ID)
        raise
    except Exception as e:
        logger.exception("RPC listener error", worker_id=WORKER_ID, error=str(e))
    finally:
        if _rpc_pubsub:
            await _rpc_pubsub.unsubscribe()
            await _rpc_pubsub.close()
            _rpc_pubsub = None


async def start_rpc_listener() -> None:
    """Start the RPC listener task for this worker."""
    global _rpc_listener_task

    if _rpc_listener_task is not None:
        return

    _rpc_listener_task = asyncio.create_task(_rpc_listener())
    logger.info("RPC listener task started", worker_id=WORKER_ID)


async def stop_rpc_listener() -> None:
    """Stop the RPC listener task."""
    global _rpc_listener_task

    if _rpc_listener_task is not None:
        _rpc_listener_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _rpc_listener_task
        _rpc_listener_task = None
        logger.info("RPC listener task stopped", worker_id=WORKER_ID)


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
