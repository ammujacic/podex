"""Socket.IO WebSocket hub for real-time communication."""

import asyncio
import base64
from dataclasses import dataclass
from datetime import UTC, datetime
from http.cookies import SimpleCookie
from typing import Any
from uuid import uuid4

import socketio
import structlog
from jose import JWTError, jwt
from sqlalchemy import select, update

from src.auth_constants import COOKIE_ACCESS_TOKEN
from src.config import settings
from src.database.connection import async_session_factory
from src.database.models import AgentAttention, SessionShare
from src.database.models import Session as SessionModel
from src.session_sync.manager import session_sync_manager
from src.session_sync.models import SharingMode, SyncAction, SyncActionType
from src.terminal.manager import terminal_manager
from src.websocket.local_pod_hub import local_pod_namespace

logger = structlog.get_logger()


@dataclass
class AgentAttentionInfo:
    """Information for an agent attention notification."""

    session_id: str
    agent_id: str
    agent_name: str
    attention_type: str
    title: str
    message: str
    priority: str = "medium"
    metadata: dict[str, Any] | None = None
    attention_id: str | None = None


async def _verify_auth_token(token: str | None) -> str | None:
    """Verify auth token and extract user ID.

    Supports two token types:
    1. JWT access tokens (from httpOnly cookies) - standard JWT validation
    2. WebSocket tokens (wst_*) - short-lived tokens from /api/auth/ws-token endpoint

    SECURITY: Also checks token blacklist to ensure revoked tokens
    (from logout, password change, etc.) cannot be used for WebSocket connections.

    Args:
        token: JWT token or WebSocket token to verify

    Returns:
        User ID if valid and not revoked, None otherwise
    """
    if not token:
        return None

    # Check for WebSocket token (wst_*) - short-lived token from /api/auth/ws-token
    if token.startswith("wst_"):
        from src.routes.auth import validate_ws_token

        user_id = await validate_ws_token(token)
        if user_id:
            logger.debug("WebSocket token validated", user_id=user_id[:8] + "...")
        return user_id

    # Standard JWT validation
    try:
        payload: dict[str, Any] = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=["HS256"])

        # SECURITY: Only accept access tokens, not refresh tokens
        # This prevents refresh token reuse as access tokens
        token_type = payload.get("type")
        if token_type and token_type != "access":
            logger.warning("Non-access token used for WebSocket auth", token_type=token_type)
            return None

        user_id_jwt: str | None = payload.get("sub") or payload.get("user_id")

        if not user_id_jwt:
            return None

        # SECURITY: Check token blacklist using jti claim
        # This ensures revoked tokens (logout, password change) cannot be used
        token_jti = payload.get("jti")
        if token_jti:
            from src.services.token_blacklist import is_token_revoked

            if await is_token_revoked(token_jti):
                logger.warning(
                    "Revoked token used for WebSocket auth",
                    user_id=user_id_jwt,
                    jti=token_jti[:8] + "...",
                )
                return None

    except JWTError:
        return None
    else:
        return user_id_jwt


def _extract_cookie_token(environ: dict[str, Any]) -> str | None:
    """Extract access token from Cookie header in the initial socket handshake."""
    headers = environ.get("headers") or []
    cookie_header = None
    for key, value in headers:
        header_key = (
            key.decode("utf-8", errors="ignore").lower()
            if isinstance(key, bytes)
            else str(key).lower()
        )
        if header_key == "cookie":
            cookie_header = (
                value.decode("utf-8", errors="ignore") if isinstance(value, bytes) else str(value)
            )
            break
    if not cookie_header:
        return None
    cookie = SimpleCookie()
    cookie.load(cookie_header)
    if COOKIE_ACCESS_TOKEN in cookie:
        return cookie[COOKIE_ACCESS_TOKEN].value
    return None


async def _get_auth_token(sid: str, data: dict[str, str]) -> str | None:
    """Get auth token from payload or stored socket session."""
    token = data.get("auth_token")
    if token:
        return token
    session = await sio.get_session(sid)
    return session.get("auth_token") if session else None


async def _get_cached_user_id(sid: str) -> str | None:
    """Get cached user_id from socket session (set after successful auth)."""
    session = await sio.get_session(sid)
    return session.get("user_id") if session else None


async def _cache_user_id(sid: str, user_id: str) -> None:
    """Cache user_id in socket session for subsequent requests."""
    session = await sio.get_session(sid) or {}
    session["user_id"] = user_id
    await sio.save_session(sid, session)


async def _verify_session_access(session_id: str, user_id: str) -> bool:
    """Verify user has access to the session.

    Args:
        session_id: Session to check
        user_id: User requesting access

    Returns:
        True if user has access (owner or shared with)
    """
    async with async_session_factory() as db:
        result = await db.execute(select(SessionModel).where(SessionModel.id == session_id))
        session = result.scalar_one_or_none()

        if not session:
            return False

        # Check if owner
        if session.owner_id == user_id:
            return True

        # Check if shared with user
        share_result = await db.execute(
            select(SessionShare).where(
                SessionShare.session_id == session_id,
                SessionShare.shared_with_id == user_id,
            ),
        )
        return share_result.scalar_one_or_none() is not None


async def _verify_workspace_access(workspace_id: str, user_id: str) -> bool:
    """Verify user has access to the workspace via its session.

    Args:
        workspace_id: Workspace to check
        user_id: User requesting access

    Returns:
        True if user has access
    """
    async with async_session_factory() as db:
        result = await db.execute(
            select(SessionModel).where(SessionModel.workspace_id == workspace_id),
        )
        session = result.scalar_one_or_none()

        if not session:
            return False

        return session.owner_id == user_id


# Maximum bytes allowed per terminal input to prevent DoS
MAX_TERMINAL_INPUT_BYTES = 8192

# Track client info (sid -> {user_id, device_id, session_id, voice state, etc.})
# SECURITY: Bounded by MAX_CLIENTS to prevent memory exhaustion if disconnect events are missed
MAX_CLIENTS = 50000  # Safety limit - should match max concurrent WebSocket connections
_client_info: dict[str, dict[str, Any]] = {}
# Track last cleanup time for periodic maintenance
_last_client_cleanup: datetime = datetime.now(UTC)
# Cleanup interval in seconds
CLIENT_CLEANUP_INTERVAL = 300  # 5 minutes

# Maximum updates to store before forcing merge (prevents memory bloat)
MAX_YJS_UPDATES_PER_DOC = 100
# Maximum bytes per session's Yjs data before cleanup warning
MAX_YJS_BYTES_PER_SESSION = 10 * 1024 * 1024  # 10MB
# Maximum number of Yjs sessions to track in memory
MAX_YJS_SESSIONS = 1000
# Maximum number of documents per Yjs session
MAX_YJS_DOCS_PER_SESSION = 100
# MEDIUM FIX: Maximum total Yjs bytes across all sessions to prevent memory exhaustion
MAX_YJS_TOTAL_BYTES = MAX_YJS_BYTES_PER_SESSION * MAX_YJS_SESSIONS  # ~10GB theoretical max
# Practical limit - 1GB total
MAX_YJS_TOTAL_BYTES_LIMIT = 1024 * 1024 * 1024  # 1GB

# Yjs state is stored exclusively in Redis via yjs_storage
# This ensures consistency across multiple API workers

# Yjs Redis key prefixes
YJS_DOC_KEY = "yjs:doc:{session_id}:{doc_name}"
YJS_UPDATES_KEY = "yjs:updates:{session_id}:{doc_name}"
YJS_TTL = 86400 * 7  # 7 days TTL for Yjs data

# Error messages for Yjs storage
YJS_REDIS_URL_ERROR = "Redis URL not configured. Yjs collaborative editing requires Redis."
YJS_REDIS_CONNECTION_ERROR = "Redis connection failed for Yjs storage"


class YjsStorageError(Exception):
    """Error raised when Yjs storage operations fail."""

    def __init__(self, message: str, *args: Any, **kwargs: Any) -> None:
        super().__init__(message, *args, **kwargs)


class YjsStorage:
    """Yjs document storage using Redis persistence only.

    Redis is required for Yjs collaborative editing - no in-memory fallback.
    This ensures consistency across API instances and prevents data loss.

    CRITICAL FIX: Redis is initialized at startup (init_redis) rather than lazily
    to ensure deterministic failure if Redis is unavailable.
    """

    def __init__(self) -> None:
        self._redis: Any = None
        self._initialized: bool = False

    async def init_redis(self) -> None:
        """Initialize Redis connection at startup.

        CRITICAL FIX: Called during app startup instead of lazy initialization.
        This ensures Redis availability is verified at startup, providing
        deterministic failure rather than non-deterministic failures later.

        Raises:
            YjsStorageError: If Redis is not configured or unavailable.
        """
        if self._initialized:
            return

        if not settings.REDIS_URL:
            raise YjsStorageError(YJS_REDIS_URL_ERROR)

        try:
            import redis.asyncio as aioredis

            self._redis = aioredis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=False,  # Keep bytes for Yjs data
            )
            # Test connection with ping
            await self._redis.ping()
            self._initialized = True
            logger.info("Yjs storage connected to Redis")
        except Exception as e:
            self._redis = None
            self._initialized = False
            raise YjsStorageError(f"{YJS_REDIS_CONNECTION_ERROR}: {e}") from e  # noqa: TRY003

    async def _get_redis(self) -> Any:
        """Get Redis client.

        Raises:
            YjsStorageError: If Redis is not initialized.
        """
        if not self._initialized or self._redis is None:
            # Attempt to initialize if not done (fallback for edge cases)
            await self.init_redis()

        return self._redis

    async def close(self) -> None:
        """Close Redis connection during shutdown."""
        if self._redis is not None:
            try:
                await self._redis.close()
                logger.info("Yjs storage Redis connection closed")
            except Exception as e:
                logger.warning("Error closing Yjs Redis connection", error=str(e))
            finally:
                self._redis = None
                self._initialized = False

    async def get_doc(self, session_id: str, doc_name: str) -> bytes | None:
        """Get document state vector from Redis."""
        redis = await self._get_redis()
        key = YJS_DOC_KEY.format(session_id=session_id, doc_name=doc_name)
        result = await redis.get(key)
        return bytes(result) if result else None

    async def set_doc(self, session_id: str, doc_name: str, state_vector: bytes) -> None:
        """Set document state vector in Redis."""
        redis = await self._get_redis()
        key = YJS_DOC_KEY.format(session_id=session_id, doc_name=doc_name)
        await redis.setex(key, YJS_TTL, state_vector)

    async def get_updates(self, session_id: str, doc_name: str) -> list[bytes]:
        """Get pending updates for a document from Redis."""
        redis = await self._get_redis()
        key = YJS_UPDATES_KEY.format(session_id=session_id, doc_name=doc_name)
        updates = await redis.lrange(key, 0, -1)
        return updates or []

    async def add_update(self, session_id: str, doc_name: str, update: bytes) -> int:
        """Add an update to Redis and return current update count."""
        redis = await self._get_redis()
        key = YJS_UPDATES_KEY.format(session_id=session_id, doc_name=doc_name)
        count = await redis.rpush(key, update)
        await redis.expire(key, YJS_TTL)
        return int(count)

    async def clear_updates(self, session_id: str, doc_name: str) -> None:
        """Clear updates after merge."""
        redis = await self._get_redis()
        key = YJS_UPDATES_KEY.format(session_id=session_id, doc_name=doc_name)
        await redis.delete(key)

    async def cleanup_session(self, session_id: str) -> None:
        """Clean up all Yjs data for a session from Redis."""
        redis = await self._get_redis()
        # Find and delete all keys for this session
        pattern = f"yjs:*:{session_id}:*"
        cursor = 0
        while True:
            cursor, keys = await redis.scan(cursor, match=pattern, count=100)
            if keys:
                await redis.delete(*keys)
            if cursor == 0:
                break
        logger.info("Cleaned up Yjs Redis data for session", session_id=session_id)


# Global Yjs storage instance
yjs_storage = YjsStorage()

# Grace period for cleanup (seconds) to avoid race conditions
CLEANUP_GRACE_PERIOD = 5.0

# Redis keys for cleanup coordination across workers
CLEANUP_PENDING_SESSION_KEY = "podex:cleanup:session:{session_id}"
CLEANUP_PENDING_TERMINAL_KEY = "podex:cleanup:terminal:{workspace_id}"

# Local pending cleanup tasks (for cancellation within this worker)
_pending_session_cleanup: dict[str, asyncio.Task[None]] = {}
_pending_terminal_cleanup: dict[str, asyncio.Task[None]] = {}


async def _cancel_session_cleanup(session_id: str) -> None:
    """Cancel any pending cleanup for a session (called when client joins).

    Multi-Worker: Clears Redis flag so other workers know to skip cleanup.
    """
    import redis.asyncio as aioredis

    # Cancel local task if exists
    task = _pending_session_cleanup.pop(session_id, None)
    if task and not task.done():
        task.cancel()

    # Clear Redis flag for cross-worker coordination
    try:
        redis: aioredis.Redis = aioredis.from_url(  # type: ignore[type-arg]
            settings.REDIS_URL, decode_responses=True
        )
        key = CLEANUP_PENDING_SESSION_KEY.format(session_id=session_id)
        await redis.delete(key)
        await redis.close()
    except Exception as e:
        logger.warning("Failed to clear session cleanup flag", error=str(e))


async def _cancel_terminal_cleanup(workspace_id: str) -> None:
    """Cancel any pending cleanup for a terminal (called when client attaches).

    Multi-Worker: Clears Redis flag so other workers know to skip cleanup.
    """
    import redis.asyncio as aioredis

    # Cancel local task if exists
    task = _pending_terminal_cleanup.pop(workspace_id, None)
    if task and not task.done():
        task.cancel()

    # Clear Redis flag for cross-worker coordination
    try:
        redis: aioredis.Redis = aioredis.from_url(  # type: ignore[type-arg]
            settings.REDIS_URL, decode_responses=True
        )
        key = CLEANUP_PENDING_TERMINAL_KEY.format(workspace_id=workspace_id)
        await redis.delete(key)
        await redis.close()
    except Exception as e:
        logger.warning("Failed to clear terminal cleanup flag", error=str(e))


async def _deferred_session_cleanup(session_id: str) -> None:
    """Clean up Yjs data after a grace period if session is still empty.

    Multi-Worker: Uses Redis flag to coordinate with other workers.
    """
    import redis.asyncio as aioredis

    try:
        await asyncio.sleep(CLEANUP_GRACE_PERIOD)

        # Check if cleanup was cancelled via Redis (client joined on another worker)
        redis: aioredis.Redis = aioredis.from_url(  # type: ignore[type-arg]
            settings.REDIS_URL, decode_responses=True
        )
        key = CLEANUP_PENDING_SESSION_KEY.format(session_id=session_id)
        if not await redis.exists(key):
            # Cleanup was cancelled by another worker
            logger.debug("Session cleanup cancelled via Redis flag", session_id=session_id)
            await redis.close()
            return

        # Double-check room is still empty after grace period (local check)
        room = sio.manager.rooms.get("/", {}).get(f"session:{session_id}", set())
        if not room:
            logger.info("Cleaning up Yjs data for empty session", session_id=session_id)
            # Clean up Yjs data from Redis
            await yjs_storage.cleanup_session(session_id)

        # Clean up the flag
        await redis.delete(key)
        await redis.close()

    except asyncio.CancelledError:
        # Cleanup was cancelled because someone joined
        logger.debug("Session cleanup cancelled - client rejoined", session_id=session_id)
    finally:
        _pending_session_cleanup.pop(session_id, None)


async def _deferred_terminal_cleanup(workspace_id: str) -> None:
    """Clean up terminal session after a grace period if still empty.

    Multi-Worker: Uses Redis flag to coordinate with other workers.
    """
    import redis.asyncio as aioredis

    try:
        await asyncio.sleep(CLEANUP_GRACE_PERIOD)

        # Check if cleanup was cancelled via Redis (client attached on another worker)
        redis: aioredis.Redis = aioredis.from_url(  # type: ignore[type-arg]
            settings.REDIS_URL, decode_responses=True
        )
        key = CLEANUP_PENDING_TERMINAL_KEY.format(workspace_id=workspace_id)
        if not await redis.exists(key):
            # Cleanup was cancelled by another worker
            logger.debug("Terminal cleanup cancelled via Redis flag", workspace_id=workspace_id)
            await redis.close()
            return

        # Double-check room is still empty after grace period (local check)
        room = sio.manager.rooms.get("/", {}).get(f"terminal:{workspace_id}", set())
        if not room:
            # kill_tmux=True ensures local pod tmux sessions are properly cleaned up
            await terminal_manager.close_session(workspace_id, kill_tmux=True)
            logger.info("Terminal session closed (no clients)", workspace_id=workspace_id)

        # Clean up the flag
        await redis.delete(key)
        await redis.close()

    except asyncio.CancelledError:
        # Cleanup was cancelled because someone attached
        logger.debug("Terminal cleanup cancelled - client attached", workspace_id=workspace_id)
    finally:
        _pending_terminal_cleanup.pop(workspace_id, None)


async def _schedule_session_cleanup(session_id: str) -> None:
    """Schedule session cleanup with Redis coordination."""
    import redis.asyncio as aioredis

    if session_id in _pending_session_cleanup:
        return

    # Set Redis flag to indicate cleanup is pending
    try:
        redis: aioredis.Redis = aioredis.from_url(  # type: ignore[type-arg]
            settings.REDIS_URL, decode_responses=True
        )
        key = CLEANUP_PENDING_SESSION_KEY.format(session_id=session_id)
        await redis.setex(key, int(CLEANUP_GRACE_PERIOD + 5), "pending")
        await redis.close()
    except Exception as e:
        logger.warning("Failed to set session cleanup flag", error=str(e))

    # Schedule local cleanup task
    cleanup_task = asyncio.create_task(_deferred_session_cleanup(session_id))
    _pending_session_cleanup[session_id] = cleanup_task


async def _schedule_terminal_cleanup(workspace_id: str) -> None:
    """Schedule terminal cleanup with Redis coordination."""
    import redis.asyncio as aioredis

    if workspace_id in _pending_terminal_cleanup:
        return

    # Set Redis flag to indicate cleanup is pending
    try:
        redis: aioredis.Redis = aioredis.from_url(  # type: ignore[type-arg]
            settings.REDIS_URL, decode_responses=True
        )
        key = CLEANUP_PENDING_TERMINAL_KEY.format(workspace_id=workspace_id)
        await redis.setex(key, int(CLEANUP_GRACE_PERIOD + 5), "pending")
        await redis.close()
    except Exception as e:
        logger.warning("Failed to set terminal cleanup flag", error=str(e))

    # Schedule local cleanup task
    cleanup_task = asyncio.create_task(_deferred_terminal_cleanup(workspace_id))
    _pending_terminal_cleanup[workspace_id] = cleanup_task


# Create Socket.IO server with Redis adapter for horizontal scaling
# Redis enables cross-instance message broadcasting (pub/sub)
# CORS is configured via settings.CORS_ORIGINS environment variable
# max_http_buffer_size increased from default 1MB to 50MB to handle large session responses
_redis_manager = socketio.AsyncRedisManager(settings.REDIS_URL)
sio = socketio.AsyncServer(
    async_mode="asgi",
    client_manager=_redis_manager,
    cors_allowed_origins=settings.CORS_ORIGINS if settings.CORS_ORIGINS else "*",
    cors_credentials=True,  # Required to send cookies cross-origin
    logger=False,
    engineio_logger=False,
    max_http_buffer_size=50 * 1024 * 1024,  # 50MB for large session data
)

# Register local pod namespace for self-hosted runner connections
sio.register_namespace(local_pod_namespace)


@sio.event
async def connect(sid: str, _environ: dict[str, Any]) -> None:
    """Handle client connection."""
    token = _extract_cookie_token(_environ)
    if token:
        await sio.save_session(sid, {"auth_token": token})
    logger.info("Client connected", sid=sid)


async def _cleanup_stale_clients() -> None:
    """HIGH FIX: Periodic cleanup of stale client entries to prevent memory leak.

    This function removes client info entries that are no longer connected.
    Called periodically during connect/disconnect events.
    """
    global _last_client_cleanup

    now = datetime.now(UTC)
    if (now - _last_client_cleanup).total_seconds() < CLIENT_CLEANUP_INTERVAL:
        return

    _last_client_cleanup = now

    # Get all currently connected sids from socket.io
    try:
        connected_sids = set()
        rooms = sio.manager.rooms.get("/", {})
        for room_sids in rooms.values():
            connected_sids.update(room_sids)

        # Find stale entries (in _client_info but not connected)
        stale_sids = [sid for sid in _client_info if sid not in connected_sids]

        if stale_sids:
            for sid in stale_sids:
                _client_info.pop(sid, None)
            logger.info("Cleaned up stale client entries", count=len(stale_sids))
    except Exception as e:
        logger.warning("Failed to cleanup stale clients", error=str(e))


@sio.event
async def disconnect(sid: str) -> None:
    """Handle client disconnection."""
    logger.info("Client disconnected", sid=sid)

    # Clean up viewer from session sync
    client = _client_info.pop(sid, None)
    if client and client.get("session_id"):
        await session_sync_manager.remove_viewer(
            session_id=client["session_id"],
            user_id=client.get("user_id", "unknown"),
            device_id=client.get("device_id", sid),
        )

    # Periodic cleanup of stale entries
    await _cleanup_stale_clients()


@sio.event
async def session_join(sid: str, data: dict[str, str]) -> None:
    """Join a session room with authentication and authorization."""
    session_id = data.get("session_id")
    auth_token = await _get_auth_token(sid, data)
    username = data.get("username", "Anonymous")
    device_id = data.get("device_id", sid)

    if not session_id:
        await sio.emit("error", {"error": "session_id required"}, to=sid)
        return

    # Verify auth token and get user ID (also checks token blacklist)
    user_id = await _verify_auth_token(auth_token)
    if not user_id:
        await sio.emit("error", {"error": "Authentication required"}, to=sid)
        return

    # Cache user_id in socket session for subsequent events (e.g., terminal_attach)
    await _cache_user_id(sid, user_id)

    # Verify user has access to this session
    has_access = await _verify_session_access(session_id, user_id)
    if not has_access:
        await sio.emit("error", {"error": "Access denied to session"}, to=sid)
        return

    # Cancel any pending cleanup for this session (Redis-coordinated)
    await _cancel_session_cleanup(session_id)

    # Store client info for disconnect handling
    # SECURITY: Check bounds to prevent memory exhaustion
    if len(_client_info) >= MAX_CLIENTS:
        logger.error("Client info cache at capacity, rejecting connection", max=MAX_CLIENTS)
        await sio.emit("error", {"error": "Server at capacity, please retry later"}, to=sid)
        return

    _client_info[sid] = {
        "session_id": session_id,
        "user_id": user_id,
        "device_id": device_id,
        "username": username,
        "session_join_time": datetime.now(UTC),  # For productivity tracking
    }

    # Subscribe to agent streaming events BEFORE joining room
    # This prevents race condition where tokens are published before subscription is active
    from src.streaming import get_stream_subscriber

    stream_subscriber = get_stream_subscriber()
    await stream_subscriber.subscribe_session(session_id)

    # Now join the session room (client can start receiving events)
    await sio.enter_room(sid, f"session:{session_id}")
    logger.info("User joined session", sid=sid, session_id=session_id, user_id=user_id)

    # Add viewer to session sync (broadcasts to other instances)
    await session_sync_manager.add_viewer(
        session_id=session_id,
        user_id=user_id,
        username=username,
        device_id=device_id,
        sharing_mode=SharingMode.CAN_EDIT,
    )

    # Send full session state to the joining client
    full_sync = await session_sync_manager.get_full_sync(session_id)
    if full_sync:
        await sio.emit("session_sync", full_sync, to=sid)


@sio.event
async def session_leave(sid: str, data: dict[str, str]) -> None:
    """Leave a session room."""
    session_id = data.get("session_id")
    user_id = data.get("user_id")
    device_id = data.get("device_id", sid)

    if not session_id:
        return

    # Track session activity for productivity metrics before removing client info
    client = _client_info.get(sid)
    if client and client.get("user_id") and client.get("session_join_time"):
        try:
            join_time = client["session_join_time"]
            leave_time = datetime.now(UTC)
            active_minutes = int((leave_time - join_time).total_seconds() / 60)

            if active_minutes > 0:
                from src.database.connection import async_session_factory
                from src.services.productivity_tracking_service import (
                    ProductivityTrackingService,
                )

                async with async_session_factory() as db:
                    tracker = ProductivityTrackingService(db)
                    await tracker.track_session_activity(
                        user_id=client["user_id"],
                        active_minutes=active_minutes,
                    )
        except Exception as e:
            logger.warning("Failed to track session activity", error=str(e))

    # Remove from client tracking
    _client_info.pop(sid, None)

    # Leave the session room
    await sio.leave_room(sid, f"session:{session_id}")
    logger.info("User left session", sid=sid, session_id=session_id, user_id=user_id)

    # Remove viewer from session sync (broadcasts to other instances)
    await session_sync_manager.remove_viewer(
        session_id=session_id,
        user_id=user_id or "unknown",
        device_id=device_id,
    )

    # Decrement streaming subscription count (Redis-based tracking across all workers)
    # This is safe to call on every leave - it only unsubscribes when count reaches 0
    from src.streaming import get_stream_subscriber

    stream_subscriber = get_stream_subscriber()
    await stream_subscriber.unsubscribe_session(session_id)

    # Schedule deferred cleanup for Yjs data to handle race conditions
    # The cleanup will be cancelled if someone joins during the grace period
    # Multi-Worker: Uses Redis coordination to cancel cleanup across workers
    room = sio.manager.rooms.get("/", {}).get(f"session:{session_id}", set())
    if not room:
        await _schedule_session_cleanup(session_id)


@sio.event
async def cursor_update(sid: str, data: dict[str, Any]) -> None:
    """Broadcast cursor position updates."""
    session_id = data.get("session_id")
    if not session_id:
        return

    # Verify sender is authenticated and in the session room
    client = _client_info.get(sid)
    if not client or client.get("session_id") != session_id:
        logger.warning("Cursor update from unauthenticated client", sid=sid, session_id=session_id)
        return

    await sio.emit(
        "cursor_update",
        data,
        room=f"session:{session_id}",
        skip_sid=sid,
    )


@sio.event
async def file_change(sid: str, data: dict[str, Any]) -> None:
    """Broadcast file change events."""
    session_id = data.get("session_id")
    if not session_id:
        return

    # Verify sender is authenticated and in the session room
    client = _client_info.get(sid)
    if not client or client.get("session_id") != session_id:
        logger.warning("File change from unauthenticated client", sid=sid, session_id=session_id)
        return

    await sio.emit(
        "file_change",
        data,
        room=f"session:{session_id}",
        skip_sid=sid,
    )


@sio.event
async def agent_message(sid: str, data: dict[str, Any]) -> None:
    """Handle agent message events."""
    session_id = data.get("session_id")
    if not session_id:
        return

    # Verify sender is authenticated and in the session room
    client = _client_info.get(sid)
    if not client or client.get("session_id") != session_id:
        logger.warning("Agent message from unauthenticated client", sid=sid, session_id=session_id)
        return

    # Broadcast agent message to all users in session
    await sio.emit(
        "agent_message",
        data,
        room=f"session:{session_id}",
    )


@sio.event
async def terminal_attach(sid: str, data: dict[str, str]) -> None:
    """Attach to terminal session with authentication and authorization."""
    workspace_id = data.get("workspace_id")
    terminal_id = data.get("terminal_id")  # Unique ID for this terminal instance
    shell = data.get("shell", "bash")  # Default to bash if not specified

    if not workspace_id:
        await sio.emit("terminal_error", {"error": "workspace_id required"}, to=sid)
        return

    if not terminal_id:
        await sio.emit("terminal_error", {"error": "terminal_id required"}, to=sid)
        return

    # Validate shell option
    valid_shells = {"bash", "zsh", "fish"}
    if shell not in valid_shells:
        shell = "bash"

    # Try cached user_id first (set during session_join), fall back to token verification
    user_id = await _get_cached_user_id(sid)
    if not user_id:
        auth_token = await _get_auth_token(sid, data)
        user_id = await _verify_auth_token(auth_token)
    if not user_id:
        await sio.emit("terminal_error", {"error": "Authentication required"}, to=sid)
        return

    # Verify user has access to this workspace
    has_access = await _verify_workspace_access(workspace_id, user_id)
    if not has_access:
        await sio.emit("terminal_error", {"error": "Access denied to workspace"}, to=sid)
        return

    # Cancel any pending cleanup for this terminal (Redis-coordinated)
    # Use terminal_id as the session key for per-terminal isolation
    session_key = f"{workspace_id}:{terminal_id}"
    await _cancel_terminal_cleanup(session_key)

    # Ensure workspace is provisioned before connecting to terminal
    try:
        # Import here to avoid circular import with sessions.py
        from src.routes.sessions import ensure_workspace_provisioned

        async with async_session_factory() as db:
            result = await db.execute(
                select(SessionModel).where(SessionModel.workspace_id == workspace_id)
            )
            session = result.scalar_one_or_none()
            if session:
                await ensure_workspace_provisioned(session, user_id, db)
            else:
                logger.warning(
                    "No session found for workspace",
                    workspace_id=workspace_id,
                )
    except Exception as e:
        logger.warning(
            "Failed to ensure workspace provisioned",
            workspace_id=workspace_id,
            error=str(e),
        )
        await sio.emit(
            "terminal_error",
            {"error": "Workspace not available. Please wait or refresh."},
            to=sid,
        )
        return

    # Join terminal room - per-terminal room for isolation
    terminal_room = f"terminal:{workspace_id}:{terminal_id}"
    await sio.enter_room(sid, terminal_room)

    # Create or get terminal session - each terminal gets its own tmux session
    async def on_output(_session_id: str, output: str) -> None:
        """Send terminal output to the specific terminal's room."""
        await sio.emit(
            "terminal_data",
            {"workspace_id": workspace_id, "terminal_id": terminal_id, "data": output},
            room=terminal_room,
        )

    try:
        # Pass terminal_id as session_id for per-terminal tmux sessions
        _session = await terminal_manager.create_session(
            workspace_id, on_output, session_id=terminal_id, shell=shell
        )
        logger.info(
            "Client attached to terminal",
            sid=sid,
            workspace_id=workspace_id,
            terminal_id=terminal_id,
            shell=shell,
            is_local_pod=_session.is_local_pod if _session else False,
        )

        # Get working directory - use session's working_dir for local pods, /home/dev for cloud
        cwd = "/home/dev"
        if _session and _session.is_local_pod and _session.working_dir:
            cwd = _session.working_dir

        # Send welcome message
        await sio.emit(
            "terminal_ready",
            {"workspace_id": workspace_id, "terminal_id": terminal_id, "cwd": cwd, "shell": shell},
            to=sid,
        )
    except Exception as e:
        logger.exception("Failed to create terminal session", error=str(e))
        # Don't leak internal error details - use generic message
        await sio.emit("terminal_error", {"error": "Failed to create terminal session"}, to=sid)


@sio.event
async def terminal_detach(sid: str, data: dict[str, str]) -> None:
    """Detach from terminal session."""
    workspace_id = data.get("workspace_id")
    terminal_id = data.get("terminal_id")
    if not workspace_id or not terminal_id:
        return

    terminal_room = f"terminal:{workspace_id}:{terminal_id}"
    await sio.leave_room(sid, terminal_room)
    logger.info(
        "Client detached from terminal",
        sid=sid,
        workspace_id=workspace_id,
        terminal_id=terminal_id,
    )

    # Schedule deferred cleanup to handle race conditions
    # The cleanup will be cancelled if someone attaches during the grace period
    # Multi-Worker: Uses Redis coordination to cancel cleanup across workers
    session_key = f"{workspace_id}:{terminal_id}"
    room = sio.manager.rooms.get("/", {}).get(terminal_room, set())
    if not room:
        await _schedule_terminal_cleanup(session_key)


@sio.event
async def terminal_input(sid: str, data: dict[str, str]) -> None:
    """Handle terminal input with authorization check."""
    workspace_id = data.get("workspace_id")
    terminal_id = data.get("terminal_id")
    input_data = data.get("data")

    if not workspace_id or not terminal_id or input_data is None:
        return

    # Verify client is in the terminal room (must have successfully attached)
    terminal_room = f"terminal:{workspace_id}:{terminal_id}"
    room = sio.manager.rooms.get("/", {}).get(terminal_room, set())
    if sid not in room:
        logger.warning(
            "Terminal input from unauthenticated client",
            sid=sid,
            workspace_id=workspace_id,
            terminal_id=terminal_id,
        )
        return

    # Validate input size to prevent DoS
    if len(input_data) > MAX_TERMINAL_INPUT_BYTES:
        logger.warning(
            "Terminal input too large",
            workspace_id=workspace_id,
            terminal_id=terminal_id,
            size=len(input_data),
        )
        return

    # Write input to terminal - use terminal_id as session_id
    success = await terminal_manager.write_input(terminal_id, input_data)
    if not success:
        logger.warning(
            "Failed to write terminal input",
            workspace_id=workspace_id,
            terminal_id=terminal_id,
        )


@sio.event
async def terminal_resize(sid: str, data: dict[str, Any]) -> None:
    """Handle terminal resize with authorization check."""
    workspace_id = data.get("workspace_id")
    terminal_id = data.get("terminal_id")
    rows = data.get("rows", 24)
    cols = data.get("cols", 80)

    if not workspace_id or not terminal_id:
        return

    # Verify client is in the terminal room (must have successfully attached)
    terminal_room = f"terminal:{workspace_id}:{terminal_id}"
    room = sio.manager.rooms.get("/", {}).get(terminal_room, set())
    if sid not in room:
        logger.warning(
            "Terminal resize from unauthenticated client",
            sid=sid,
            workspace_id=workspace_id,
            terminal_id=terminal_id,
        )
        return

    # Validate and clamp resize values to prevent invalid ioctl calls
    # Reasonable bounds: 1-500 for both rows and cols
    try:
        rows = max(1, min(500, int(rows)))
        cols = max(1, min(500, int(cols)))
    except (ValueError, TypeError):
        rows, cols = 24, 80  # Use defaults for invalid values

    # Use terminal_id as session_id
    await terminal_manager.resize(terminal_id, rows, cols)
    logger.debug(
        "Terminal resized",
        workspace_id=workspace_id,
        terminal_id=terminal_id,
        rows=rows,
        cols=cols,
    )


async def emit_to_session(session_id: str, event: str, data: dict[str, Any]) -> None:
    """Emit event to all users in a session."""
    room_name = f"session:{session_id}"
    # Check how many clients are in the room
    room = sio.manager.rooms.get("/", {}).get(room_name, set())
    logger.info(
        "emit_to_session DEBUG",
        room_name=room_name,
        event_name=event,
        room_client_count=len(room),
        room_sids=list(room)[:5],  # First 5 SIDs
        podex_sid_last4=session_id[-4:] if session_id else "None",
    )
    await sio.emit(event, data, room=room_name)


# ============== Agent Streaming & Tool Visibility ==============


async def emit_agent_token(
    session_id: str,
    agent_id: str,
    token: str,
    message_id: str | None = None,
) -> None:
    """Emit a streaming token from an agent response.

    This allows real-time display of agent responses as they are generated.
    """
    # Note: room check shows LOCAL workers only, actual delivery uses Redis adapter
    room_name = f"session:{session_id}"
    room = sio.manager.rooms.get("/", {}).get(room_name, set())
    logger.debug(
        "emit_agent_token",
        session_id=session_id[-8:] if session_id else "None",
        token_len=len(token),
        local_room_clients=len(room),
    )
    await sio.emit(
        "agent_token",
        {
            "session_id": session_id,
            "agent_id": agent_id,
            "token": token,
            "message_id": message_id,
            "timestamp": datetime.now(UTC).isoformat(),
        },
        room=f"session:{session_id}",
    )


async def emit_agent_thinking_token(
    session_id: str,
    agent_id: str,
    thinking: str,
    message_id: str | None = None,
) -> None:
    """Emit a thinking token from an agent's reasoning process.

    This allows real-time display of agent thinking in a collapsible UI.
    """
    await sio.emit(
        "agent_thinking_token",
        {
            "session_id": session_id,
            "agent_id": agent_id,
            "thinking": thinking,
            "message_id": message_id,
            "timestamp": datetime.now(UTC).isoformat(),
        },
        room=f"session:{session_id}",
    )


async def emit_agent_stream_start(
    session_id: str,
    agent_id: str,
    message_id: str,
) -> None:
    """Emit event when agent starts streaming a response."""
    room_name = f"session:{session_id}"
    room = sio.manager.rooms.get("/", {}).get(room_name, set())
    logger.info(
        "emit_agent_stream_start",
        session_id=session_id[-8:] if session_id else "None",
        agent_id=agent_id[-8:] if agent_id else "None",
        room_client_count=len(room),
    )
    await sio.emit(
        "agent_stream_start",
        {
            "session_id": session_id,
            "agent_id": agent_id,
            "message_id": message_id,
            "timestamp": datetime.now(UTC).isoformat(),
        },
        room=f"session:{session_id}",
    )


async def emit_agent_stream_end(
    session_id: str,
    agent_id: str,
    message_id: str,
    full_content: str | None = None,
    tool_calls: list[dict[str, Any]] | None = None,
) -> None:
    """Emit event when agent finishes streaming a response."""
    room_name = f"session:{session_id}"
    room = sio.manager.rooms.get("/", {}).get(room_name, set())
    logger.info(
        "emit_agent_stream_end",
        session_id=session_id[-8:] if session_id else "None",
        agent_id=agent_id[-8:] if agent_id else "None",
        room_client_count=len(room),
        content_length=len(full_content) if full_content else 0,
    )
    # Format tool calls for frontend
    formatted_tool_calls = None
    if tool_calls:
        formatted_tool_calls = [
            {
                "id": tc.get("id", f"tc-{i}"),
                "name": tc.get("name", "unknown"),
                "args": tc.get("arguments", tc.get("args", {})),
                "result": tc.get("result"),
                "status": "completed" if tc.get("result") else "pending",
            }
            for i, tc in enumerate(tool_calls)
        ]
    await sio.emit(
        "agent_stream_end",
        {
            "session_id": session_id,
            "agent_id": agent_id,
            "message_id": message_id,
            "full_content": full_content,
            "tool_calls": formatted_tool_calls,
            "timestamp": datetime.now(UTC).isoformat(),
        },
        room=f"session:{session_id}",
    )


async def emit_tool_call_start(
    session_id: str,
    agent_id: str,
    tool_call_id: str,
    tool_name: str,
    tool_args: dict[str, Any] | None = None,
) -> None:
    """Emit event when agent starts executing a tool.

    This provides real-time visibility into what tools agents are using.
    """
    await sio.emit(
        "tool_call_start",
        {
            "session_id": session_id,
            "agent_id": agent_id,
            "tool_call_id": tool_call_id,
            "tool_name": tool_name,
            "tool_args": tool_args,
            "status": "running",
            "timestamp": datetime.now(UTC).isoformat(),
        },
        room=f"session:{session_id}",
    )


async def emit_tool_call_end(
    session_id: str,
    agent_id: str,
    tool_call_id: str,
    tool_name: str,
    result: Any = None,
    error: str | None = None,
    duration_ms: int | None = None,
) -> None:
    """Emit event when agent finishes executing a tool."""
    await sio.emit(
        "tool_call_end",
        {
            "session_id": session_id,
            "agent_id": agent_id,
            "tool_call_id": tool_call_id,
            "tool_name": tool_name,
            "result": result,
            "error": error,
            "status": "error" if error else "completed",
            "duration_ms": duration_ms,
            "timestamp": datetime.now(UTC).isoformat(),
        },
        room=f"session:{session_id}",
    )


async def emit_tool_call_progress(
    session_id: str,
    agent_id: str,
    tool_call_id: str,
    tool_name: str,
    progress: int,
    message: str | None = None,
) -> None:
    """Emit progress update for long-running tool calls."""
    await sio.emit(
        "tool_call_progress",
        {
            "session_id": session_id,
            "agent_id": agent_id,
            "tool_call_id": tool_call_id,
            "tool_name": tool_name,
            "progress": progress,  # 0-100
            "message": message,
            "timestamp": datetime.now(UTC).isoformat(),
        },
        room=f"session:{session_id}",
    )


# ============== Terminal History ==============
# Multi-Worker Architecture: Terminal history stored in Redis for consistency

# Redis key patterns for terminal history
TERMINAL_HISTORY_KEY = "podex:terminal:history:{workspace_id}"
TERMINAL_HISTORY_TTL = 3600  # 1 hour TTL
MAX_TERMINAL_HISTORY_LINES = 1000


async def _add_to_terminal_history(workspace_id: str, output: str) -> None:
    """Add terminal output to history buffer in Redis."""
    import json

    import redis.asyncio as aioredis

    try:
        redis: aioredis.Redis = aioredis.from_url(  # type: ignore[type-arg]
            settings.REDIS_URL, decode_responses=True
        )
        key = TERMINAL_HISTORY_KEY.format(workspace_id=workspace_id)

        # Add entry to list
        entry = json.dumps({"output": output, "timestamp": datetime.now(UTC).isoformat()})
        await redis.rpush(key, entry)

        # Trim to max size
        await redis.ltrim(key, -MAX_TERMINAL_HISTORY_LINES, -1)

        # Refresh TTL
        await redis.expire(key, TERMINAL_HISTORY_TTL)

        await redis.close()
    except Exception as e:
        logger.warning("Failed to add terminal history to Redis", error=str(e))


async def get_terminal_history(workspace_id: str, limit: int = 100) -> list[dict[str, Any]]:
    """Get terminal output history for a workspace from Redis.

    Args:
        workspace_id: The workspace ID
        limit: Maximum number of history entries to return

    Returns:
        List of terminal history entries with output and timestamps
    """
    import json

    import redis.asyncio as aioredis

    try:
        redis: aioredis.Redis = aioredis.from_url(  # type: ignore[type-arg]
            settings.REDIS_URL, decode_responses=True
        )
        key = TERMINAL_HISTORY_KEY.format(workspace_id=workspace_id)

        # Get last 'limit' entries
        entries = await redis.lrange(key, -limit, -1)
        await redis.close()

        return [json.loads(e) for e in entries]
    except Exception as e:
        logger.warning("Failed to get terminal history from Redis", error=str(e))
        return []


async def clear_terminal_history(workspace_id: str) -> None:
    """Clear terminal history for a workspace from Redis."""
    import redis.asyncio as aioredis

    try:
        redis: aioredis.Redis = aioredis.from_url(  # type: ignore[type-arg]
            settings.REDIS_URL, decode_responses=True
        )
        key = TERMINAL_HISTORY_KEY.format(workspace_id=workspace_id)
        await redis.delete(key)
        await redis.close()
    except Exception as e:
        logger.warning("Failed to clear terminal history from Redis", error=str(e))


async def emit_to_terminal(workspace_id: str, data: str) -> None:
    """Emit terminal data to attached clients and store in history."""
    # Store in history buffer (Redis)
    await _add_to_terminal_history(workspace_id, data)

    await sio.emit(
        "terminal_data",
        {"workspace_id": workspace_id, "data": data},
        room=f"terminal:{workspace_id}",
    )


# ============== Yjs Real-time Collaboration ==============


@sio.event
async def yjs_subscribe(sid: str, data: dict[str, str]) -> None:
    """Subscribe to a Yjs document for real-time sync."""
    session_id = data.get("session_id")
    doc_name = data.get("doc_name")  # e.g., "file:/workspace/src/app.tsx" or "agent:agent-123"

    if not session_id or not doc_name:
        return

    room_name = f"yjs:{session_id}:{doc_name}"
    await sio.enter_room(sid, room_name)
    logger.info("Client subscribed to Yjs doc", sid=sid, session_id=session_id, doc_name=doc_name)

    # Send existing state from Redis if available
    try:
        state = await yjs_storage.get_doc(session_id, doc_name)
        if state:
            await sio.emit(
                "yjs_sync",
                {
                    "session_id": session_id,
                    "doc_name": doc_name,
                    "state": base64.b64encode(state).decode("utf-8"),
                    "type": "state",
                },
                to=sid,
            )
    except YjsStorageError as e:
        logger.warning("Failed to get Yjs doc from Redis", error=str(e))


@sio.event
async def yjs_unsubscribe(sid: str, data: dict[str, str]) -> None:
    """Unsubscribe from a Yjs document."""
    session_id = data.get("session_id")
    doc_name = data.get("doc_name")

    if not session_id or not doc_name:
        return

    room_name = f"yjs:{session_id}:{doc_name}"
    await sio.leave_room(sid, room_name)
    logger.info(
        "Client unsubscribed from Yjs doc",
        sid=sid,
        session_id=session_id,
        doc_name=doc_name,
    )


@sio.event
async def yjs_update(sid: str, data: dict[str, Any]) -> None:
    """Handle Yjs update from a client and broadcast to others.

    Multi-Worker Architecture: Updates are stored in Redis and broadcasted
    via Socket.IO Redis adapter to ensure consistency across workers.
    """
    session_id = data.get("session_id")
    doc_name = data.get("doc_name")
    update_b64 = data.get("update")  # Base64 encoded Yjs update

    if not session_id or not doc_name or not update_b64:
        return

    try:
        update = base64.b64decode(update_b64)

        # SECURITY: Limit update size to prevent DoS
        if len(update) > 1024 * 1024:  # 1MB max per update
            logger.warning(
                "Yjs update exceeds size limit",
                session_id=session_id,
                doc_name=doc_name,
                size=len(update),
            )
            return

        # Store update in Redis
        try:
            update_count = await yjs_storage.add_update(session_id, doc_name, update)

            # Trim updates if too many (Redis handles this with TTL but we also limit count)
            if update_count > MAX_YJS_UPDATES_PER_DOC:
                # Clear and keep only the merged state
                logger.info(
                    "Compacting Yjs updates in Redis",
                    session_id=session_id,
                    doc_name=doc_name,
                    update_count=update_count,
                )
                # Get current doc state, clear updates
                await yjs_storage.clear_updates(session_id, doc_name)
        except YjsStorageError as e:
            logger.warning("Failed to store Yjs update in Redis", error=str(e))
            # Continue to broadcast even if storage fails

        # Broadcast to other subscribers via Socket.IO Redis adapter
        room_name = f"yjs:{session_id}:{doc_name}"
        await sio.emit(
            "yjs_update",
            {
                "session_id": session_id,
                "doc_name": doc_name,
                "update": update_b64,
            },
            room=room_name,
            skip_sid=sid,
        )

        logger.debug("Yjs update broadcasted", session_id=session_id, doc_name=doc_name)

    except Exception as e:
        logger.exception("Failed to process Yjs update", error=str(e))


@sio.event
async def yjs_awareness(sid: str, data: dict[str, Any]) -> None:
    """Handle Yjs awareness updates (cursor positions, user presence)."""
    session_id = data.get("session_id")
    doc_name = data.get("doc_name")
    awareness_b64 = data.get("awareness")  # Base64 encoded awareness state

    if not session_id or not doc_name or not awareness_b64:
        return

    # Broadcast awareness to other subscribers
    room_name = f"yjs:{session_id}:{doc_name}"
    await sio.emit(
        "yjs_awareness",
        {
            "session_id": session_id,
            "doc_name": doc_name,
            "awareness": awareness_b64,
            "client_id": sid,
        },
        room=room_name,
        skip_sid=sid,
    )


@sio.event
async def agent_status_update(sid: str, data: dict[str, Any]) -> None:
    """Broadcast agent status updates to all session users."""
    session_id = data.get("session_id")
    agent_id = data.get("agent_id")
    status = data.get("status")

    if not session_id or not agent_id:
        return

    await sio.emit(
        "agent_status_update",
        {
            "session_id": session_id,
            "agent_id": agent_id,
            "status": status,
        },
        room=f"session:{session_id}",
        skip_sid=sid,
    )


@sio.event
async def agent_typing(sid: str, data: dict[str, Any]) -> None:
    """Broadcast when a user is typing to an agent."""
    session_id = data.get("session_id")
    agent_id = data.get("agent_id")
    user_id = data.get("user_id")
    is_typing = data.get("is_typing", False)

    if not session_id or not agent_id:
        return

    await sio.emit(
        "agent_typing",
        {
            "session_id": session_id,
            "agent_id": agent_id,
            "user_id": user_id,
            "is_typing": is_typing,
        },
        room=f"session:{session_id}",
        skip_sid=sid,
    )


# ============== Session Sync Events ==============


@sio.event
async def layout_change(sid: str, data: dict[str, Any]) -> None:
    """Handle layout changes and sync across devices."""
    session_id = data.get("session_id")
    layout = data.get("layout")

    if not session_id or not layout:
        return

    client = _client_info.get(sid, {})

    # Publish via session sync (Redis Pub/Sub for cross-instance)
    await session_sync_manager.publish_action(
        SyncAction(
            type=SyncActionType.LAYOUT_CHANGE,
            session_id=session_id,
            payload={"layout": layout},
            sender_id=client.get("user_id", "unknown"),
            sender_device=client.get("device_id", sid),
        ),
    )


@sio.event
async def file_open(sid: str, data: dict[str, Any]) -> None:
    """Handle file open events and sync across devices."""
    session_id = data.get("session_id")
    workspace_id = data.get("workspace_id")
    file_path = data.get("file_path")

    if not session_id or not file_path:
        return

    client = _client_info.get(sid, {})

    await session_sync_manager.publish_action(
        SyncAction(
            type=SyncActionType.FILE_OPEN,
            session_id=session_id,
            payload={
                "workspace_id": workspace_id,
                "file_path": file_path,
            },
            sender_id=client.get("user_id", "unknown"),
            sender_device=client.get("device_id", sid),
        ),
    )


@sio.event
async def file_close(sid: str, data: dict[str, Any]) -> None:
    """Handle file close events and sync across devices."""
    session_id = data.get("session_id")
    workspace_id = data.get("workspace_id")
    file_path = data.get("file_path")

    if not session_id or not file_path:
        return

    client = _client_info.get(sid, {})

    await session_sync_manager.publish_action(
        SyncAction(
            type=SyncActionType.FILE_CLOSE,
            session_id=session_id,
            payload={
                "workspace_id": workspace_id,
                "file_path": file_path,
            },
            sender_id=client.get("user_id", "unknown"),
            sender_device=client.get("device_id", sid),
        ),
    )


@sio.event
async def request_full_sync(sid: str, data: dict[str, str]) -> None:
    """Handle request for full session state sync (reconnection)."""
    session_id = data.get("session_id")
    if not session_id:
        return

    full_sync = await session_sync_manager.get_full_sync(session_id)
    if full_sync:
        await sio.emit("session_sync", full_sync, to=sid)


# ============== Session Sync Manager Integration ==============


async def broadcast_to_room(room: str, event: str, data: dict[str, Any]) -> None:
    """Broadcast callback for session sync manager."""
    await sio.emit(event, data, room=room)


async def init_session_sync() -> None:
    """Initialize session sync manager with broadcast callback.

    CRITICAL FIX: Also initializes Yjs Redis storage at startup to ensure
    deterministic failure if Redis is unavailable.
    """
    # Initialize Yjs storage Redis connection at startup (not lazily)
    try:
        await yjs_storage.init_redis()
    except YjsStorageError as e:
        logger.warning(
            "Yjs storage Redis initialization failed - collaborative editing may not work",
            error=str(e),
        )
        # Don't fail startup, but log prominently

    await session_sync_manager.start(broadcast_to_room)


async def cleanup_session_sync() -> None:
    """Cleanup session sync manager and Yjs storage."""
    await session_sync_manager.stop()
    await yjs_storage.close()


# ============== Voice/Audio Events ==============


async def _transcribe_audio_chunks(chunks: list[str], language: str = "en-US") -> dict[str, Any]:
    """Transcribe audio chunks using OpenAI Whisper API.

    Args:
        chunks: List of base64-encoded audio chunks
        language: Language code for transcription (default: en-US)

    Returns:
        Dict with 'text' and 'confidence' keys
    """
    import httpx

    if not chunks:
        return {"text": "", "confidence": 0.0}

    # Combine all chunks into a single audio file
    combined_audio = b""
    for chunk_b64 in chunks:
        combined_audio += base64.b64decode(chunk_b64)

    # Validate minimum audio length (100 bytes minimum)
    if len(combined_audio) < 100:
        return {"text": "", "confidence": 0.0}

    api_key = getattr(settings, "OPENAI_API_KEY", None)
    if not api_key:
        logger.warning("OpenAI API key not configured, returning empty transcription")
        return {"text": "", "confidence": 0.0}

    try:
        # Extract language code (e.g., "en" from "en-US")
        lang_code = language.split("-")[0] if language else "en"

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {api_key}"},
                files={"file": ("audio.webm", combined_audio, "audio/webm")},
                data={
                    "model": "whisper-1",
                    "language": lang_code,
                    "response_format": "verbose_json",
                },
            )
            response.raise_for_status()
            result = response.json()

        return {
            "text": result.get("text", ""),
            "confidence": 0.95,  # Whisper doesn't provide confidence, use high default
        }

    except Exception as e:
        logger.exception("OpenAI Whisper transcription error", error=str(e))
        raise


@sio.event
async def voice_stream_start(sid: str, data: dict[str, Any]) -> None:
    """Client starts streaming voice input."""
    session_id = data.get("session_id")
    agent_id = data.get("agent_id")
    language = data.get("language", "en-US")

    if not session_id or not agent_id:
        await sio.emit("voice_error", {"error": "session_id and agent_id required"}, to=sid)
        return

    # Store streaming state for this client
    client = _client_info.get(sid, {})
    client["voice_streaming"] = True
    client["voice_agent_id"] = agent_id
    client["voice_language"] = language
    client["voice_chunks"] = []
    _client_info[sid] = client

    logger.info("Voice stream started", sid=sid, agent_id=agent_id, language=language)
    await sio.emit("voice_stream_ready", {"agent_id": agent_id}, to=sid)


@sio.event
async def voice_chunk(sid: str, data: dict[str, Any]) -> None:
    """Handle voice audio chunk from client."""
    session_id = data.get("session_id")
    chunk_b64 = data.get("chunk")  # Base64 encoded audio chunk

    if not session_id or not chunk_b64:
        return

    client = _client_info.get(sid, {})
    if not client.get("voice_streaming"):
        return

    # Store the chunk for processing when stream ends
    if "voice_chunks" not in client:
        client["voice_chunks"] = []
    client["voice_chunks"].append(chunk_b64)

    # Send progress indicator to client
    await sio.emit(
        "voice_transcription_progress",
        {
            "session_id": session_id,
            "agent_id": client.get("voice_agent_id"),
            "chunks_received": len(client["voice_chunks"]),
        },
        to=sid,
    )


@sio.event
async def voice_stream_end(sid: str, data: dict[str, Any]) -> None:
    """Client ends voice streaming - process transcription."""
    session_id = data.get("session_id")

    if not session_id:
        return

    client = _client_info.get(sid, {})
    client["voice_streaming"] = False
    agent_id = client.get("voice_agent_id")
    _language = client.get("voice_language", "en-US")
    chunks: list[str] = client.pop("voice_chunks", [])

    logger.info(
        "Voice stream ended",
        sid=sid,
        agent_id=agent_id,
        chunks_count=len(chunks),
    )

    # Process transcription - in dev mode use mock, in production use GCP Speech-to-Text
    if settings.ENVIRONMENT == "development":
        # Mock transcription for dev mode
        await sio.emit(
            "voice_transcription",
            {
                "session_id": session_id,
                "agent_id": agent_id,
                "text": "[Voice input received - dev mode]",
                "confidence": 0.95,
                "is_final": True,
            },
            to=sid,
        )
    else:
        # Real transcription using GCP Speech-to-Text
        try:
            transcription = await _transcribe_audio_chunks(chunks, _language)
            await sio.emit(
                "voice_transcription",
                {
                    "session_id": session_id,
                    "agent_id": agent_id,
                    "text": transcription.get("text", ""),
                    "confidence": transcription.get("confidence", 0.0),
                    "is_final": True,
                },
                to=sid,
            )
        except Exception as e:
            logger.exception("Transcription failed", error=str(e))
            await sio.emit(
                "voice_transcription",
                {
                    "session_id": session_id,
                    "agent_id": agent_id,
                    "text": "",
                    "confidence": 0.0,
                    "is_final": True,
                    "error": str(e),
                },
                to=sid,
            )


@sio.event
async def tts_request(sid: str, data: dict[str, Any]) -> None:
    """Request TTS synthesis for a message."""
    session_id = data.get("session_id")
    message_id = data.get("message_id")
    voice_id = data.get("voice_id")

    if not session_id or not message_id:
        await sio.emit("voice_error", {"error": "session_id and message_id required"}, to=sid)
        return

    logger.info("TTS requested", sid=sid, message_id=message_id, voice_id=voice_id)

    # TTS synthesis is handled via HTTP API
    # This event is for requesting async synthesis with WebSocket notification
    await sio.emit(
        "tts_status",
        {
            "session_id": session_id,
            "message_id": message_id,
            "status": "processing",
        },
        to=sid,
    )


async def emit_voice_transcription(
    session_id: str,
    agent_id: str,
    text: str,
    confidence: float,
    *,
    is_final: bool = True,
) -> None:
    """Emit transcription result to all session users."""
    await sio.emit(
        "voice_transcription",
        {
            "session_id": session_id,
            "agent_id": agent_id,
            "text": text,
            "confidence": confidence,
            "is_final": is_final,
        },
        room=f"session:{session_id}",
    )


async def emit_tts_ready(
    session_id: str,
    message_id: str,
    audio_url: str,
    duration_ms: int,
) -> None:
    """Emit TTS audio ready notification to session."""
    await sio.emit(
        "tts_audio_ready",
        {
            "session_id": session_id,
            "message_id": message_id,
            "audio_url": audio_url,
            "duration_ms": duration_ms,
        },
        room=f"session:{session_id}",
    )


# ============== Agent Attention Events ==============


async def emit_agent_attention(info: AgentAttentionInfo) -> str:
    """Emit agent attention notification to all users in session.

    Args:
        info: The agent attention information.

    Returns:
        The attention notification ID.
    """
    notification_id = info.attention_id or str(uuid4())

    async with async_session_factory() as db:
        try:
            existing = await db.execute(
                select(AgentAttention.id).where(AgentAttention.id == notification_id)
            )
            if existing.scalar_one_or_none() is None:
                attention = AgentAttention(
                    id=notification_id,
                    agent_id=info.agent_id,
                    session_id=info.session_id,
                    attention_type=info.attention_type,
                    title=info.title,
                    message=info.message,
                    attention_metadata=info.metadata or {},
                    priority=info.priority,
                )
                db.add(attention)
                await db.commit()
        except Exception as e:
            await db.rollback()
            logger.warning(
                "Failed to persist agent attention",
                session_id=info.session_id,
                agent_id=info.agent_id,
                attention_id=notification_id,
                error=str(e),
            )

    await sio.emit(
        "agent_attention",
        {
            "id": notification_id,
            "session_id": info.session_id,
            "agent_id": info.agent_id,
            "agent_name": info.agent_name,
            "type": info.attention_type,
            "title": info.title,
            "message": info.message,
            "priority": info.priority,
            "metadata": info.metadata or {},
            "read": False,
            "dismissed": False,
            "created_at": datetime.now(UTC).isoformat(),
        },
        room=f"session:{info.session_id}",
    )

    logger.info(
        "Agent attention emitted",
        session_id=info.session_id,
        agent_id=info.agent_id,
        attention_type=info.attention_type,
        priority=info.priority,
    )

    return notification_id


@sio.event
async def agent_attention_read(_sid: str, data: dict[str, Any]) -> None:
    """Mark an agent attention notification as read."""
    session_id = data.get("session_id")
    attention_id = data.get("attention_id")

    if not session_id or not attention_id:
        return

    async with async_session_factory() as db:
        try:
            await db.execute(
                update(AgentAttention)
                .where(
                    AgentAttention.id == attention_id,
                    AgentAttention.session_id == session_id,
                )
                .values(is_read=True)
            )
            await db.commit()
        except Exception as e:
            await db.rollback()
            logger.warning(
                "Failed to persist attention read",
                session_id=session_id,
                attention_id=attention_id,
                error=str(e),
            )

    # Broadcast to all session users that this attention was read
    await sio.emit(
        "agent_attention_read",
        {
            "session_id": session_id,
            "attention_id": attention_id,
        },
        room=f"session:{session_id}",
    )

    logger.debug("Agent attention marked as read", attention_id=attention_id)


@sio.event
async def agent_attention_dismiss(_sid: str, data: dict[str, Any]) -> None:
    """Dismiss an agent attention notification."""
    session_id = data.get("session_id")
    attention_id = data.get("attention_id")
    agent_id = data.get("agent_id")

    if not session_id or not attention_id:
        return

    async with async_session_factory() as db:
        try:
            await db.execute(
                update(AgentAttention)
                .where(
                    AgentAttention.id == attention_id,
                    AgentAttention.session_id == session_id,
                )
                .values(is_dismissed=True)
            )
            await db.commit()
        except Exception as e:
            await db.rollback()
            logger.warning(
                "Failed to persist attention dismissal",
                session_id=session_id,
                attention_id=attention_id,
                error=str(e),
            )

    # Broadcast to all session users that this attention was dismissed
    await sio.emit(
        "agent_attention_dismiss",
        {
            "session_id": session_id,
            "attention_id": attention_id,
            "agent_id": agent_id,
        },
        room=f"session:{session_id}",
    )

    logger.debug("Agent attention dismissed", attention_id=attention_id)


# ============== User Notification Events ==============


async def emit_notification_to_user(
    user_id: str,
    notification_id: str,
    title: str,
    message: str,
    notification_type: str,
    action_url: str | None,
) -> None:
    """Emit a notification to a specific user's devices.

    This emits to the user:{user_id} room, which clients join via extension_subscribe.

    Args:
        user_id: The target user ID.
        notification_id: The notification ID from the database.
        title: Notification title.
        message: Notification body.
        notification_type: Type of notification (info, warning, error, success).
        action_url: Optional URL for the notification action.
    """
    await sio.emit(
        "notification",
        {
            "id": notification_id,
            "title": title,
            "message": message,
            "type": notification_type,
            "action_url": action_url,
            "timestamp": datetime.now(UTC).isoformat(),
        },
        room=f"user:{user_id}",
    )

    logger.debug(
        "User notification emitted",
        user_id=user_id,
        notification_id=notification_id,
        notification_type=notification_type,
    )


# ============== Extension Sync Events ==============


async def emit_extension_installed(
    user_id: str,
    extension_id: str,
    namespace: str,
    name: str,
    display_name: str,
    version: str,
    scope: str,
    workspace_id: str | None = None,
    icon_url: str | None = None,
) -> None:
    """Emit extension installed event to all user's devices.

    Args:
        user_id: The user who installed the extension.
        extension_id: The extension ID (namespace.name).
        namespace: Extension namespace.
        name: Extension name.
        display_name: Extension display name.
        version: Installed version.
        scope: Installation scope ('user' or 'workspace').
        workspace_id: Workspace ID if workspace-scoped.
        icon_url: Extension icon URL.
    """
    await sio.emit(
        "extension_installed",
        {
            "extension_id": extension_id,
            "namespace": namespace,
            "name": name,
            "display_name": display_name,
            "version": version,
            "scope": scope,
            "workspace_id": workspace_id,
            "icon_url": icon_url,
            "timestamp": datetime.now(UTC).isoformat(),
        },
        room=f"user:{user_id}",
    )

    logger.info(
        "Extension installed event emitted",
        user_id=user_id,
        extension_id=extension_id,
        scope=scope,
    )


async def emit_extension_uninstalled(
    user_id: str,
    extension_id: str,
    scope: str,
    workspace_id: str | None = None,
) -> None:
    """Emit extension uninstalled event to all user's devices.

    Args:
        user_id: The user who uninstalled the extension.
        extension_id: The extension ID.
        scope: Installation scope ('user' or 'workspace').
        workspace_id: Workspace ID if workspace-scoped.
    """
    await sio.emit(
        "extension_uninstalled",
        {
            "extension_id": extension_id,
            "scope": scope,
            "workspace_id": workspace_id,
            "timestamp": datetime.now(UTC).isoformat(),
        },
        room=f"user:{user_id}",
    )

    logger.info(
        "Extension uninstalled event emitted",
        user_id=user_id,
        extension_id=extension_id,
        scope=scope,
    )


async def emit_extension_toggled(
    user_id: str,
    extension_id: str,
    enabled: bool,
    scope: str,
    workspace_id: str | None = None,
) -> None:
    """Emit extension enabled/disabled event to all user's devices.

    Args:
        user_id: The user who toggled the extension.
        extension_id: The extension ID.
        enabled: Whether extension is now enabled.
        scope: Installation scope ('user' or 'workspace').
        workspace_id: Workspace ID if workspace-scoped.
    """
    await sio.emit(
        "extension_toggled",
        {
            "extension_id": extension_id,
            "enabled": enabled,
            "scope": scope,
            "workspace_id": workspace_id,
            "timestamp": datetime.now(UTC).isoformat(),
        },
        room=f"user:{user_id}",
    )

    logger.info(
        "Extension toggled event emitted",
        user_id=user_id,
        extension_id=extension_id,
        enabled=enabled,
    )


async def emit_extension_settings_changed(
    user_id: str,
    extension_id: str,
    settings: dict[str, Any],
    scope: str,
    workspace_id: str | None = None,
) -> None:
    """Emit extension settings changed event to all user's devices.

    Args:
        user_id: The user who changed the settings.
        extension_id: The extension ID.
        settings: The new settings.
        scope: Installation scope ('user' or 'workspace').
        workspace_id: Workspace ID if workspace-scoped.
    """
    await sio.emit(
        "extension_settings_changed",
        {
            "extension_id": extension_id,
            "settings": settings,
            "scope": scope,
            "workspace_id": workspace_id,
            "timestamp": datetime.now(UTC).isoformat(),
        },
        room=f"user:{user_id}",
    )

    logger.info(
        "Extension settings changed event emitted",
        user_id=user_id,
        extension_id=extension_id,
    )


@sio.event
async def extension_subscribe(sid: str, data: dict[str, str]) -> None:
    """Subscribe to extension sync events for a user."""
    auth_token = data.get("auth_token")

    # Verify auth token and get user ID (also checks token blacklist)
    user_id = await _verify_auth_token(auth_token)
    if not user_id:
        await sio.emit("error", {"error": "Authentication required"}, to=sid)
        return

    # Join user room for extension sync
    await sio.enter_room(sid, f"user:{user_id}")
    logger.info("Client subscribed to extension sync", sid=sid, user_id=user_id)

    # Update client info
    client = _client_info.get(sid, {})
    client["extension_sync_user_id"] = user_id
    _client_info[sid] = client

    await sio.emit("extension_subscribed", {"user_id": user_id}, to=sid)


@sio.event
async def extension_unsubscribe(sid: str, _data: dict[str, str]) -> None:
    """Unsubscribe from extension sync events."""
    client = _client_info.get(sid, {})
    user_id = client.pop("extension_sync_user_id", None)

    if user_id:
        await sio.leave_room(sid, f"user:{user_id}")
        logger.info("Client unsubscribed from extension sync", sid=sid, user_id=user_id)


# ============== Native Agent Approval Events ==============


@sio.event
async def native_approval_response(sid: str, data: dict[str, Any]) -> None:
    """Handle approval response for native Podex agents.

    When a user approves or rejects an action in the frontend approval dialog,
    this handler:
    1. Updates the database record
    2. Calls the agent service to resolve the pending approval

    Args:
        sid: Socket.IO session ID
        data: {
            session_id: str,
            agent_id: str,
            approval_id: str,
            approved: bool,
            add_to_allowlist: bool (optional)
        }
    """
    session_id = data.get("session_id")
    agent_id = data.get("agent_id")
    approval_id = data.get("approval_id")
    approved = data.get("approved", False)
    add_to_allowlist = data.get("add_to_allowlist", False)

    if not session_id or not agent_id or not approval_id:
        logger.warning("Invalid native approval response", data=data)
        return

    # Verify client is in the session room
    client = _client_info.get(sid)
    if not client or client.get("session_id") != session_id:
        logger.warning("Native approval response from unauthenticated client", sid=sid)
        return

    logger.info(
        "Native approval response",
        session_id=session_id,
        agent_id=agent_id,
        approval_id=approval_id,
        approved=approved,
        add_to_allowlist=add_to_allowlist,
    )

    # Update database record
    try:
        from sqlalchemy import update as sql_update

        from src.database.connection import async_session_factory
        from src.database.models import AgentPendingApproval

        async with async_session_factory() as db:
            status = "approved" if approved else "rejected"
            await db.execute(
                sql_update(AgentPendingApproval)
                .where(AgentPendingApproval.id == approval_id)
                .values(status=status)
            )
            await db.commit()

            # Track productivity metrics for suggestion response
            user_id = client.get("user_id") if client else None
            if user_id:
                try:
                    from src.services.productivity_tracking_service import (
                        ProductivityTrackingService,
                    )

                    tracker = ProductivityTrackingService(db)
                    await tracker.track_suggestion_response(
                        user_id=user_id,
                        accepted=approved,
                    )
                except Exception as track_err:
                    logger.warning("Failed to track approval productivity", error=str(track_err))
    except Exception as e:
        logger.exception("Failed to update approval status in DB", error=str(e))

    # Publish approval response to Redis for distributed agent instances
    # This replaces the previous HTTP call to a specific agent instance,
    # enabling horizontal scaling of agent services
    try:
        from src.services.task_queue import get_approval_queue

        approval_queue = get_approval_queue()
        await approval_queue.publish_response(
            approval_id=approval_id,
            approved=approved,
            add_to_allowlist=add_to_allowlist,
        )
        logger.info(
            "Agent approval published to Redis",
            approval_id=approval_id,
            approved=approved,
        )
    except Exception as e:
        logger.exception(
            "Failed to publish approval to Redis", approval_id=approval_id, error=str(e)
        )

    # Broadcast the decision
    await sio.emit(
        "native_approval_decision",
        {
            "session_id": session_id,
            "agent_id": agent_id,
            "approval_id": approval_id,
            "approved": approved,
            "add_to_allowlist": add_to_allowlist,
        },
        room=f"session:{session_id}",
    )


# ============== Agent Mode Switch Events ==============


async def emit_agent_auto_mode_switch(
    session_id: str,
    agent_id: str,
    agent_name: str,
    old_mode: str,
    new_mode: str,
    reason: str,
    trigger_phrase: str | None = None,
    *,
    auto_revert: bool = False,
) -> None:
    """Emit automatic mode switch notification.

    This event is emitted when an agent auto-detects user intent and switches
    modes (e.g., from ask to plan mode when user asks for a design).

    Args:
        session_id: The session ID.
        agent_id: The agent ID.
        agent_name: The agent's display name.
        old_mode: The previous mode.
        new_mode: The new mode.
        reason: Why the switch happened.
        trigger_phrase: The phrase that triggered the switch (if any).
        auto_revert: Whether this switch will auto-revert after task completion.
    """
    await sio.emit(
        "agent_auto_mode_switch",
        {
            "session_id": session_id,
            "agent_id": agent_id,
            "agent_name": agent_name,
            "old_mode": old_mode,
            "new_mode": new_mode,
            "reason": reason,
            "trigger_phrase": trigger_phrase,
            "auto_revert": auto_revert,
            "timestamp": datetime.now(UTC).isoformat(),
        },
        room=f"session:{session_id}",
    )

    logger.info(
        "Agent auto mode switch emitted",
        session_id=session_id,
        agent_id=agent_id,
        old_mode=old_mode,
        new_mode=new_mode,
        auto_revert=auto_revert,
    )


# ============== Agent Config Update Events ==============


async def emit_agent_config_update(
    session_id: str,
    agent_id: str,
    updates: dict[str, Any],
    source: str = "agent",
) -> None:
    """Emit agent configuration update notification.

    This event is emitted when an agent's configuration changes
    (e.g., model switch, context compaction, mode change).
    Enables sync between agents and the Podex UI.

    Args:
        session_id: The session ID.
        agent_id: The agent ID.
        updates: Dictionary of configuration updates (model, mode, thinking, etc.).
        source: Source of the update (agent, user, system).
    """
    await sio.emit(
        "agent_config_update",
        {
            "session_id": session_id,
            "agent_id": agent_id,
            "updates": updates,
            "source": source,
            "timestamp": datetime.now(UTC).isoformat(),
        },
        room=f"session:{session_id}",
    )

    logger.info(
        "Agent config update emitted",
        session_id=session_id,
        agent_id=agent_id,
        updates=updates,
        source=source,
    )
