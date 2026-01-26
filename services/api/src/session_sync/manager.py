"""Session Sync Manager - Redis Pub/Sub for cross-instance synchronization."""

import asyncio
import contextlib
import json
from collections.abc import Callable, Coroutine
from datetime import UTC, datetime
from typing import Any

import redis.asyncio as redis
import structlog

from src.config import settings
from src.session_sync.models import (
    AgentState,
    SessionLayout,
    SessionState,
    SessionViewer,
    SharingMode,
    SyncAction,
    SyncActionType,
    WorkspaceState,
)

logger = structlog.get_logger()

# Type for broadcast callback
BroadcastCallback = Callable[[str, str, dict[str, Any]], Coroutine[Any, Any, None]]


def _apply_file_open(session: SessionState, payload: dict[str, Any]) -> None:
    """Apply file open action to session state."""
    ws_id = payload.get("workspace_id")
    file_path = payload.get("file_path")
    for ws in session.workspaces:
        if ws.workspace_id == ws_id and file_path and file_path not in ws.open_files:
            ws.open_files.append(file_path)
            ws.active_file = file_path


def _apply_file_close(session: SessionState, payload: dict[str, Any]) -> None:
    """Apply file close action to session state."""
    ws_id = payload.get("workspace_id")
    file_path = payload.get("file_path")
    for ws in session.workspaces:
        if ws.workspace_id == ws_id and file_path in ws.open_files:
            ws.open_files.remove(file_path)
            if ws.active_file == file_path:
                ws.active_file = ws.open_files[0] if ws.open_files else None


def _apply_layout_change(session: SessionState, payload: dict[str, Any]) -> None:
    """Apply layout change action to session state."""
    layout_data = payload.get("layout", {})
    session.layout = SessionLayout(**layout_data)


def _apply_agent_status(session: SessionState, payload: dict[str, Any]) -> None:
    """Apply agent status action to session state."""
    agent_id = payload.get("agent_id")
    status = payload.get("status")
    for agent in session.agents:
        if agent.agent_id == agent_id and status:
            agent.status = status
            if payload.get("current_task"):
                agent.current_task = payload["current_task"]


# Dispatch table for sync action handlers
_ACTION_HANDLERS: dict[
    SyncActionType,
    Callable[[SessionState, dict[str, Any]], None],
] = {
    SyncActionType.FILE_OPEN: _apply_file_open,
    SyncActionType.FILE_CLOSE: _apply_file_close,
    SyncActionType.LAYOUT_CHANGE: _apply_layout_change,
    SyncActionType.AGENT_STATUS: _apply_agent_status,
}


class SessionSyncManager:
    """Manages session state synchronization across instances.

    Uses Redis Pub/Sub for real-time broadcasting across server instances.
    Uses Redis hashes for session state caching.
    DynamoDB is used for durable storage (accessed via API routes).
    """

    # PERFORMANCE: Maximum sessions to keep in local cache
    # Prevents unbounded memory growth
    MAX_LOCAL_SESSIONS = 1000
    MAX_SEQUENCES = 5000

    def __init__(self) -> None:
        """Initialize the session sync manager."""
        self._redis: Any = None
        self._pubsub: Any = None
        self._broadcast_callback: BroadcastCallback | None = None
        self._running = False
        self._listen_task: asyncio.Task[None] | None = None

        # Local cache of session states (bounded)
        self._sessions: dict[str, SessionState] = {}
        # Sequence numbers per session (bounded)
        self._sequences: dict[str, int] = {}

    def _maybe_evict_cache(self) -> None:
        """Evict oldest entries from cache if at capacity.

        PERFORMANCE: Prevents unbounded memory growth by removing
        least recently accessed sessions when cache is full.
        """
        # Evict sessions if over limit
        if len(self._sessions) > self.MAX_LOCAL_SESSIONS:
            # Sort by last_activity and keep most recent
            sorted_sessions = sorted(
                self._sessions.items(),
                key=lambda x: x[1].last_activity,
                reverse=True,
            )
            # Keep only MAX_LOCAL_SESSIONS entries
            self._sessions = dict(sorted_sessions[: self.MAX_LOCAL_SESSIONS])
            logger.info(
                "Evicted old sessions from local cache",
                remaining=len(self._sessions),
                max=self.MAX_LOCAL_SESSIONS,
            )

        # Evict sequences if over limit
        if len(self._sequences) > self.MAX_SEQUENCES:
            # Keep sequences only for sessions still in cache
            self._sequences = {k: v for k, v in self._sequences.items() if k in self._sessions}
            # If still over limit, just clear old ones
            if len(self._sequences) > self.MAX_SEQUENCES:
                # Keep first MAX_SEQUENCES items (arbitrary but consistent)
                items = list(self._sequences.items())[: self.MAX_SEQUENCES]
                self._sequences = dict(items)

    async def start(self, broadcast_callback: BroadcastCallback) -> None:
        """Start the session sync manager.

        Args:
            broadcast_callback: Async function to broadcast to Socket.IO rooms
                               Signature: (room: str, event: str, data: dict) -> None
        """
        self._broadcast_callback = broadcast_callback
        self._redis = redis.from_url(settings.REDIS_URL, decode_responses=True)
        self._pubsub = self._redis.pubsub()

        # Subscribe to the session sync channel
        await self._pubsub.subscribe("podex:session:sync")
        self._running = True
        self._listen_task = asyncio.create_task(self._listen_for_messages())

        logger.info("SessionSyncManager started", redis_url=settings.REDIS_URL)

    async def stop(self) -> None:
        """Stop the session sync manager."""
        self._running = False

        if self._listen_task:
            self._listen_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._listen_task

        if self._pubsub:
            await self._pubsub.unsubscribe("podex:session:sync")
            await self._pubsub.close()

        if self._redis:
            await self._redis.close()

        logger.info("SessionSyncManager stopped")

    async def _listen_for_messages(self) -> None:
        """Listen for Redis Pub/Sub messages and broadcast to local clients."""
        if not self._pubsub:
            return

        try:
            async for message in self._pubsub.listen():
                if not self._running:
                    break

                if message["type"] != "message":
                    continue

                try:
                    data = json.loads(message["data"])
                    await self._handle_pubsub_message(data)
                except json.JSONDecodeError:
                    logger.warning("Invalid JSON in pubsub message")
                except Exception:
                    logger.exception("Error handling pubsub message")

        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("Pubsub listener error")

    async def _handle_pubsub_message(self, data: dict[str, Any]) -> None:
        """Handle a message from Redis Pub/Sub."""
        session_id = data.get("session_id")
        event = data.get("event")
        payload = data.get("payload", {})

        if not session_id or not event or not self._broadcast_callback:
            return

        # Broadcast to local Socket.IO clients
        room = f"session:{session_id}"
        await self._broadcast_callback(room, event, payload)

        logger.debug("Broadcasted pubsub message", session_id=session_id, event_name=event)

    async def publish_action(self, action: SyncAction) -> None:
        """Publish a sync action to all instances via Redis Pub/Sub.

        Args:
            action: The sync action to publish
        """
        if not self._redis:
            return

        # Increment server sequence
        seq = self._sequences.get(action.session_id, 0) + 1
        self._sequences[action.session_id] = seq
        action.server_seq = seq

        # Publish to Redis
        message = {
            "session_id": action.session_id,
            "event": action.type.value,
            "payload": {
                "type": action.type.value,
                "payload": action.payload,
                "sender_id": action.sender_id,
                "sender_device": action.sender_device,
                "client_seq": action.client_seq,
                "server_seq": action.server_seq,
                "timestamp": action.timestamp.isoformat(),
            },
        }

        await self._redis.publish("podex:session:sync", json.dumps(message))

        # Also update local cache if it's a state-modifying action
        await self._apply_action_to_cache(action)

    async def _apply_action_to_cache(self, action: SyncAction) -> None:
        """Apply a sync action to the local session cache."""
        session = self._sessions.get(action.session_id)
        if not session:
            return

        # Update session metadata
        now = datetime.now(UTC)
        session.last_activity = now
        session.updated_at = now
        session.version = action.server_seq

        # Use dispatch table to apply action
        handler = _ACTION_HANDLERS.get(action.type)
        if handler:
            handler(session, action.payload)

        # Save to Redis cache
        await self._save_session_to_cache(session)

    async def _save_session_to_cache(self, session: SessionState) -> None:
        """Save session state to Redis cache."""
        if not self._redis:
            return

        key = f"podex:session:{session.session_id}"
        await self._redis.set(key, session.model_dump_json(), ex=3600)  # 1 hour TTL

    async def _load_session_from_cache(self, session_id: str) -> SessionState | None:
        """Load session state from Redis cache."""
        if not self._redis:
            return None

        key = f"podex:session:{session_id}"
        data = await self._redis.get(key)
        if data:
            return SessionState.model_validate_json(data)
        return None

    async def get_session_state(self, session_id: str) -> SessionState | None:
        """Get the current session state.

        First checks local cache, then Redis cache.
        """
        # Check local cache
        if session_id in self._sessions:
            return self._sessions[session_id]

        # Check Redis cache
        session = await self._load_session_from_cache(session_id)
        if session:
            self._maybe_evict_cache()  # Evict before adding to prevent unbounded growth
            self._sessions[session_id] = session
            return session

        return None

    async def create_session_state(
        self,
        session_id: str,
        user_id: str,
        name: str,
    ) -> SessionState:
        """Create a new session state."""
        now = datetime.now(UTC)
        session = SessionState(
            session_id=session_id,
            user_id=user_id,
            name=name,
            created_at=now,
            updated_at=now,
            last_activity=now,
        )

        self._maybe_evict_cache()  # Evict before adding to prevent unbounded growth
        self._sessions[session_id] = session
        await self._save_session_to_cache(session)

        return session

    async def add_viewer(
        self,
        session_id: str,
        user_id: str,
        username: str,
        device_id: str,
        sharing_mode: SharingMode = SharingMode.CAN_EDIT,
    ) -> SessionViewer | None:
        """Add a viewer to a session."""
        session = await self.get_session_state(session_id)
        if not session:
            return None

        now = datetime.now(UTC)
        viewer = SessionViewer(
            user_id=user_id,
            username=username,
            device_id=device_id,
            sharing_mode=sharing_mode,
            joined_at=now,
            last_activity=now,
        )

        # Remove existing viewer with same device_id
        session.viewers = [v for v in session.viewers if v.device_id != device_id]
        session.viewers.append(viewer)
        session.last_activity = now

        await self._save_session_to_cache(session)

        # Broadcast viewer joined
        await self.publish_action(
            SyncAction(
                type=SyncActionType.VIEWER_JOIN,
                session_id=session_id,
                payload={
                    "user_id": user_id,
                    "username": username,
                    "device_id": device_id,
                    "sharing_mode": sharing_mode.value,
                },
                sender_id=user_id,
                sender_device=device_id,
            ),
        )

        return viewer

    async def remove_viewer(
        self,
        session_id: str,
        user_id: str,
        device_id: str,
    ) -> None:
        """Remove a viewer from a session."""
        session = await self.get_session_state(session_id)
        if not session:
            return

        session.viewers = [
            v for v in session.viewers if not (v.user_id == user_id and v.device_id == device_id)
        ]
        session.last_activity = datetime.now(UTC)

        await self._save_session_to_cache(session)

        # Broadcast viewer left
        await self.publish_action(
            SyncAction(
                type=SyncActionType.VIEWER_LEAVE,
                session_id=session_id,
                payload={
                    "user_id": user_id,
                    "device_id": device_id,
                },
                sender_id=user_id,
                sender_device=device_id,
            ),
        )

    async def update_viewer_cursor(
        self,
        session_id: str,
        user_id: str,
        device_id: str,
        cursor_position: dict[str, Any],
    ) -> None:
        """Update a viewer's cursor position."""
        session = await self.get_session_state(session_id)
        if not session:
            return

        for viewer in session.viewers:
            if viewer.user_id == user_id and viewer.device_id == device_id:
                viewer.cursor_position = cursor_position
                viewer.last_activity = datetime.now(UTC)
                break

        # Broadcast cursor update
        await self.publish_action(
            SyncAction(
                type=SyncActionType.VIEWER_CURSOR,
                session_id=session_id,
                payload={
                    "user_id": user_id,
                    "device_id": device_id,
                    "cursor": cursor_position,
                },
                sender_id=user_id,
                sender_device=device_id,
            ),
        )

    async def add_workspace(
        self,
        session_id: str,
        workspace_id: str,
        repo_url: str | None = None,
    ) -> None:
        """Add a workspace to a session."""
        session = await self.get_session_state(session_id)
        if not session:
            return

        workspace = WorkspaceState(
            workspace_id=workspace_id,
            repo_url=repo_url,
        )
        session.workspaces.append(workspace)
        session.last_activity = datetime.now(UTC)

        await self._save_session_to_cache(session)

    async def add_agent(
        self,
        session_id: str,
        agent_id: str,
        agent_type: str,
        model: str,
        workspace_id: str | None = None,
    ) -> None:
        """Add an agent to a session."""
        session = await self.get_session_state(session_id)
        if not session:
            return

        agent = AgentState(
            agent_id=agent_id,
            agent_type=agent_type,
            model=model,
            status="idle",
            workspace_id=workspace_id,
        )
        session.agents.append(agent)
        session.last_activity = datetime.now(UTC)

        await self._save_session_to_cache(session)

    async def update_agent_status(
        self,
        session_id: str,
        agent_id: str,
        status: str,
        *,
        current_task: str | None = None,
        sender_id: str = "system",
    ) -> None:
        """Update an agent's status and broadcast to viewers."""
        await self.publish_action(
            SyncAction(
                type=SyncActionType.AGENT_STATUS,
                session_id=session_id,
                payload={
                    "agent_id": agent_id,
                    "status": status,
                    "current_task": current_task,
                },
                sender_id=sender_id,
                sender_device="server",
            ),
        )

    async def broadcast_terminal_output(
        self,
        session_id: str,
        workspace_id: str,
        output: str,
    ) -> None:
        """Broadcast terminal output to all session viewers."""
        await self.publish_action(
            SyncAction(
                type=SyncActionType.TERMINAL_OUTPUT,
                session_id=session_id,
                payload={
                    "workspace_id": workspace_id,
                    "output": output,
                },
                sender_id="system",
                sender_device="server",
            ),
        )

    async def get_full_sync(self, session_id: str) -> dict[str, Any] | None:
        """Get full session state for reconnection/initial sync."""
        session = await self.get_session_state(session_id)
        if not session:
            return None

        return {
            "type": "full_sync",
            "state": session.model_dump(mode="json"),
            "server_seq": self._sequences.get(session_id, 0),
        }


# Global instance
session_sync_manager = SessionSyncManager()
