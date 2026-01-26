"""Claude Code session file watcher for real-time sync.

Monitors Claude Code session files and pushes new messages to Podex backend
for bi-directional sync across devices.

Session files are stored in:
  ~/.claude/projects/{encoded-project-path}/{session-id}.jsonl
"""

import asyncio
import contextlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

import structlog
from watchdog.events import FileModifiedEvent, FileSystemEventHandler
from watchdog.observers import Observer

if TYPE_CHECKING:
    import socketio

logger = structlog.get_logger()

# Debounce interval in seconds (file changes within this window are batched)
DEBOUNCE_INTERVAL = 0.5

# Directory where Claude Code stores sessions
CLAUDE_PROJECTS_DIR = Path.home() / ".claude" / "projects"


@dataclass
class WatchedSession:
    """Tracks sync state for a single Claude session."""

    session_id: str
    project_path: str
    encoded_project_path: str
    last_synced_uuid: str | None = None
    last_sync_time: float = 0.0
    # Podex session/agent IDs (set when session is linked)
    podex_session_id: str | None = None
    podex_agent_id: str | None = None


@dataclass
class SyncEvent:
    """Queued sync event from file watcher."""

    session_path: Path
    timestamp: float


class ClaudeSessionEventHandler(FileSystemEventHandler):
    """Handles file system events for Claude session files."""

    def __init__(self, watcher: "ClaudeSessionWatcher") -> None:
        super().__init__()
        self.watcher = watcher

    def on_modified(self, event: FileModifiedEvent) -> None:  # type: ignore[override]
        """Handle file modification events."""
        if event.is_directory:
            return

        path = Path(str(event.src_path))

        # Only watch .jsonl files (Claude session files)
        if path.suffix != ".jsonl":
            return

        # Queue the sync event
        self.watcher.queue_sync(path)


class ClaudeSessionWatcher:
    """Watches Claude Code session files and syncs changes to Podex.

    Uses watchdog for cross-platform file monitoring and debounces
    rapid changes to avoid excessive syncing.
    """

    def __init__(self, sio: "socketio.AsyncClient | None" = None) -> None:
        """Initialize the session watcher.

        Args:
            sio: Socket.IO client for emitting sync events to backend
        """
        self.sio = sio
        self.observer: Any = None  # Observer type not recognized by mypy
        self._running = False
        self._sync_task: asyncio.Task[None] | None = None

        # Tracked sessions: encoded_project_path/session_id -> WatchedSession
        self._watched_sessions: dict[str, WatchedSession] = {}

        # Pending sync events (debounced): session_path -> SyncEvent
        self._pending_syncs: dict[Path, SyncEvent] = {}
        self._sync_lock = asyncio.Lock()

        # Event loop reference for thread-safe queue operations
        self._loop: asyncio.AbstractEventLoop | None = None

    def queue_sync(self, session_path: Path) -> None:
        """Queue a sync event for a session file.

        Called from watchdog thread, so we use thread-safe queueing.
        """
        import time

        event = SyncEvent(session_path=session_path, timestamp=time.time())

        # Thread-safe: schedule on event loop
        if self._loop and self._running:
            self._loop.call_soon_threadsafe(self._add_pending_sync, event)

    def _add_pending_sync(self, event: SyncEvent) -> None:
        """Add a sync event to the pending queue (must be called from event loop)."""
        self._pending_syncs[event.session_path] = event
        logger.debug(
            "Queued sync event",
            session_path=str(event.session_path),
            pending_count=len(self._pending_syncs),
        )

    async def start(self) -> None:
        """Start watching Claude session directories."""
        if self._running:
            return

        # Check if Claude projects directory exists
        if not CLAUDE_PROJECTS_DIR.exists():
            logger.info(
                "Claude projects directory does not exist, skipping watcher",
                path=str(CLAUDE_PROJECTS_DIR),
            )
            return

        self._running = True
        self._loop = asyncio.get_running_loop()

        # Set up watchdog observer
        self.observer = Observer()
        event_handler = ClaudeSessionEventHandler(self)

        # Watch the entire projects directory recursively
        self.observer.schedule(
            event_handler,
            str(CLAUDE_PROJECTS_DIR),
            recursive=True,
        )
        self.observer.start()

        logger.info(
            "Started Claude session watcher",
            path=str(CLAUDE_PROJECTS_DIR),
        )

        # Start the sync processing task
        self._sync_task = asyncio.create_task(self._process_sync_queue())

    async def stop(self) -> None:
        """Stop watching and clean up resources."""
        self._running = False

        # Stop the sync task
        if self._sync_task and not self._sync_task.done():
            self._sync_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._sync_task

        # Stop watchdog observer
        if self.observer:
            self.observer.stop()
            self.observer.join(timeout=5.0)
            self.observer = None

        logger.info("Claude session watcher stopped")

    def register_session(
        self,
        claude_session_id: str,
        project_path: str,
        podex_session_id: str,
        podex_agent_id: str,
    ) -> None:
        """Register a Claude session for sync tracking.

        Called when a user links a Claude session to a Podex agent.

        Args:
            claude_session_id: Claude Code session UUID
            project_path: Original project path (e.g., /Users/foo/myproject)
            podex_session_id: Podex session ID
            podex_agent_id: Podex agent ID
        """
        encoded = self._encode_project_path(project_path)
        key = f"{encoded}/{claude_session_id}"

        session = WatchedSession(
            session_id=claude_session_id,
            project_path=project_path,
            encoded_project_path=encoded,
            podex_session_id=podex_session_id,
            podex_agent_id=podex_agent_id,
        )
        self._watched_sessions[key] = session

        logger.info(
            "Registered session for sync",
            claude_session_id=claude_session_id,
            project_path=project_path,
            podex_session_id=podex_session_id,
            podex_agent_id=podex_agent_id,
        )

    def unregister_session(self, claude_session_id: str, project_path: str) -> None:
        """Unregister a Claude session from sync tracking.

        Args:
            claude_session_id: Claude Code session UUID
            project_path: Original project path
        """
        encoded = self._encode_project_path(project_path)
        key = f"{encoded}/{claude_session_id}"
        self._watched_sessions.pop(key, None)

        logger.info(
            "Unregistered session from sync",
            claude_session_id=claude_session_id,
        )

    def update_last_synced_uuid(self, claude_session_id: str, project_path: str, uuid: str) -> None:
        """Update the last synced message UUID for a session.

        Args:
            claude_session_id: Claude Code session UUID
            project_path: Original project path
            uuid: UUID of the last synced message
        """
        encoded = self._encode_project_path(project_path)
        key = f"{encoded}/{claude_session_id}"
        session = self._watched_sessions.get(key)
        if session:
            session.last_synced_uuid = uuid

    async def _process_sync_queue(self) -> None:
        """Process pending sync events with debouncing."""
        import time

        while self._running:
            try:
                await asyncio.sleep(DEBOUNCE_INTERVAL)

                # Get events ready to process (older than debounce interval)
                now = time.time()
                ready_events: list[SyncEvent] = []

                async with self._sync_lock:
                    paths_to_remove = []
                    for path, event in self._pending_syncs.items():
                        if now - event.timestamp >= DEBOUNCE_INTERVAL:
                            ready_events.append(event)
                            paths_to_remove.append(path)

                    for path in paths_to_remove:
                        del self._pending_syncs[path]

                # Process ready events
                for event in ready_events:
                    await self._process_sync_event(event)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.exception("Error processing sync queue", error=str(e))
                await asyncio.sleep(1.0)

    async def _process_sync_event(self, event: SyncEvent) -> None:
        """Process a single sync event.

        Reads the session file, finds new messages since last sync,
        and emits them to the backend.

        Now queries the backend to find watchers instead of relying on
        local registration state (which is lost on restart).
        """
        session_path = event.session_path

        # Extract session info from path
        # Path format: ~/.claude/projects/{encoded-project}/{session-id}.jsonl
        try:
            encoded_project = session_path.parent.name
            session_id = session_path.stem
            key = f"{encoded_project}/{session_id}"
        except Exception:
            logger.debug("Could not parse session path", path=str(session_path))
            return

        # Decode project path from directory name
        project_path = self._decode_project_path(encoded_project)

        # Query backend for watchers (this survives local pod restarts)
        watchers = await self._lookup_watchers(project_path, session_id)

        if not watchers:
            # No one is watching this session
            logger.debug(
                "No watchers for session",
                session_id=session_id,
                project_path=project_path,
            )
            return

        # Get or create tracked session state for last_synced_uuid
        watched_session = self._watched_sessions.get(key)
        if not watched_session:
            # Create a local tracking entry (for last_synced_uuid only)
            watched_session = WatchedSession(
                session_id=session_id,
                project_path=project_path,
                encoded_project_path=encoded_project,
            )
            self._watched_sessions[key] = watched_session

        # Read new messages from the session file
        new_messages = self._read_new_messages(session_path, watched_session.last_synced_uuid)

        if not new_messages:
            logger.debug("No new messages to sync", session_id=session_id)
            return

        # Update last synced UUID
        last_msg = new_messages[-1]
        if last_msg.get("uuid"):
            watched_session.last_synced_uuid = last_msg["uuid"]

        # Emit sync events to all watchers
        for watcher in watchers:
            await self._emit_sync_to_watcher(
                session_id=session_id,
                project_path=project_path,
                podex_session_id=watcher["podex_session_id"],
                podex_agent_id=watcher["podex_agent_id"],
                messages=new_messages,
            )

    def _read_new_messages(
        self, session_path: Path, last_synced_uuid: str | None
    ) -> list[dict[str, Any]]:
        """Read all entries from a session file that are newer than last sync.

        Syncs ALL entry types including:
        - user/assistant messages
        - progress events (thinking, hooks, etc.)
        - tool results
        - file history snapshots
        - queue operations
        - mode changes

        Args:
            session_path: Path to the session JSONL file
            last_synced_uuid: UUID of the last synced entry (None = sync all)

        Returns:
            List of new entries
        """
        if not session_path.exists():
            return []

        entries: list[dict[str, Any]] = []
        found_last_synced = last_synced_uuid is None  # If no UUID, sync from start

        try:
            with open(session_path) as f:
                for line in f:
                    if not line.strip():
                        continue

                    try:
                        entry = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    entry_uuid = entry.get("uuid")

                    # If we haven't found the last synced entry yet, check for it
                    if not found_last_synced:
                        if entry_uuid == last_synced_uuid:
                            found_last_synced = True
                        continue

                    entry_type = entry.get("type")

                    # Build a normalized entry with common fields
                    normalized: dict[str, Any] = {
                        "uuid": entry_uuid,
                        "parent_uuid": entry.get("parentUuid"),
                        "type": entry_type,
                        "timestamp": entry.get("timestamp"),
                        "session_id": entry.get("sessionId"),
                        "is_sidechain": entry.get("isSidechain", False),
                    }

                    # Handle user/assistant messages specially
                    if entry_type in ("user", "assistant"):
                        message_data = entry.get("message", {})
                        # Content can be in message.content or directly on entry
                        content = message_data.get("content") or entry.get("content", [])

                        text_content = ""
                        thinking_content = ""
                        tool_calls = None
                        tool_results = None

                        if isinstance(content, list):
                            for block in content:
                                if isinstance(block, dict):
                                    block_type = block.get("type")
                                    if block_type == "text":
                                        text_content += block.get("text", "")
                                    elif block_type == "thinking":
                                        # Extract thinking content from extended thinking
                                        thinking_content += block.get("thinking", "")
                                    elif block_type == "tool_result":
                                        if tool_results is None:
                                            tool_results = []
                                        tool_results.append(
                                            {
                                                "tool_use_id": block.get("tool_use_id"),
                                                "content": block.get("content"),
                                                "is_error": block.get("is_error", False),
                                            }
                                        )
                            # Extract tool_use blocks
                            tool_calls = [
                                {
                                    "id": block.get("id"),
                                    "name": block.get("name"),
                                    "input": block.get("input"),
                                }
                                for block in content
                                if isinstance(block, dict) and block.get("type") == "tool_use"
                            ]
                            if not tool_calls:
                                tool_calls = None
                        elif isinstance(content, str):
                            text_content = content

                        normalized.update(
                            {
                                "role": message_data.get("role", entry_type),
                                "content": text_content,
                                "thinking": thinking_content if thinking_content else None,
                                "model": message_data.get("model"),
                                "tool_calls": tool_calls,
                                "tool_results": tool_results,
                                "stop_reason": message_data.get("stop_reason"),
                                "usage": message_data.get("usage"),
                            }
                        )

                    # Handle progress events
                    elif entry_type == "progress":
                        data = entry.get("data", {})
                        normalized.update(
                            {
                                "progress_type": data.get("type"),
                                "data": data,
                                "tool_use_id": entry.get("toolUseID"),
                                "parent_tool_use_id": entry.get("parentToolUseID"),
                            }
                        )

                    # Handle summary entries
                    elif entry_type == "summary":
                        normalized.update(
                            {
                                "summary": entry.get("summary"),
                                "leaf_uuid": entry.get("leafUuid"),
                            }
                        )

                    # Handle config/mode change entries
                    elif entry_type in ("config", "config_change", "system", "init"):
                        normalized.update(
                            {
                                "model": entry.get("model"),
                                "mode": entry.get("mode"),
                                "config_data": {
                                    k: v
                                    for k, v in entry.items()
                                    if k
                                    not in (
                                        "uuid",
                                        "parentUuid",
                                        "type",
                                        "timestamp",
                                        "sessionId",
                                        "isSidechain",
                                    )
                                },
                            }
                        )

                    # For all other types, include raw data
                    else:
                        for key, value in entry.items():
                            if key not in normalized:
                                normalized[key] = value

                    entries.append(normalized)

        except OSError as e:
            logger.error(
                "Failed to read session file",
                path=str(session_path),
                error=str(e),
            )

        return entries

    async def _emit_sync_event(
        self, session: WatchedSession, messages: list[dict[str, Any]]
    ) -> None:
        """Emit a sync event to the Podex backend.

        Args:
            session: The watched session info
            messages: List of new messages to sync
        """
        if not self.sio or not self.sio.connected:
            logger.warning(
                "Cannot emit sync - Socket.IO not connected",
                session_id=session.session_id,
            )
            return

        payload = {
            "podex_session_id": session.podex_session_id,
            "podex_agent_id": session.podex_agent_id,
            "claude_session_id": session.session_id,
            "project_path": session.project_path,
            "messages": messages,
            "sync_type": "incremental",
        }

        try:
            await self.sio.emit(
                "claude_session_sync",  # Use underscores to match handler on_claude_session_sync
                payload,
                namespace="/local-pod",
            )
            logger.info(
                "Emitted session sync",
                session_id=session.session_id,
                message_count=len(messages),
                podex_session_id=session.podex_session_id,
            )
        except Exception as e:
            logger.error(
                "Failed to emit sync event",
                session_id=session.session_id,
                error=str(e),
            )

    @staticmethod
    def _encode_project_path(project_path: str) -> str:
        """Encode a project path to Claude Code's directory naming scheme.

        Claude Code encodes paths by replacing '/' with '-'.
        Example: /Users/foo/bar -> -Users-foo-bar
        """
        normalized = os.path.normpath(project_path)
        return normalized.replace("/", "-")

    @staticmethod
    def _decode_project_path(encoded_path: str) -> str:
        """Decode a Claude Code encoded project path back to original.

        Example: -Users-foo-bar -> /Users/foo/bar
        """
        # The encoded path starts with '-' which represents the leading '/'
        # Then all other '-' characters represent '/'
        if encoded_path.startswith("-"):
            return encoded_path.replace("-", "/")
        return "/" + encoded_path.replace("-", "/")

    async def _test_call_mechanism(self) -> bool:
        """Test that the socket.io call() mechanism works."""
        if not self.sio or not self.sio.connected:
            return False

        try:
            response = await self.sio.call(
                "ping",
                {"test": "data"},
                namespace="/local-pod",
                timeout=5.0,
            )
            logger.info("Ping test response", response=response)
            return bool(
                response is not None and isinstance(response, dict) and response.get("pong")
            )
        except Exception as e:
            logger.error("Ping test failed", error=str(e))
            return False

    async def _lookup_watchers(
        self, project_path: str, claude_session_id: str
    ) -> list[dict[str, str]]:
        """Query backend for agents watching this Claude session.

        This enables sync to work even after local pod restarts, since
        the watcher info is stored in the backend database.

        Args:
            project_path: Original project path (e.g., /Users/foo/myproject)
            claude_session_id: Claude Code session UUID

        Returns:
            List of watchers: [{"podex_session_id": str, "podex_agent_id": str}, ...]
        """
        if not self.sio:
            logger.warning("Cannot lookup watchers - Socket.IO client is None")
            return []

        if not self.sio.connected:
            logger.warning(
                "Cannot lookup watchers - Socket.IO not connected",
                sio_state=getattr(self.sio, "connection_url", "unknown"),
            )
            return []

        try:
            # First, test if call() mechanism works at all
            ping_ok = await self._test_call_mechanism()
            if not ping_ok:
                logger.error("Socket.IO call() mechanism not working - ping test failed")
                return []

            logger.info(
                "Calling backend for watcher lookup via sio.call()",
                project_path=project_path,
                claude_session_id=claude_session_id,
                connected=self.sio.connected,
                namespace="/local-pod",
            )
            # Call backend with callback to get response
            # Note: event name uses underscores to match handler method on_claude_lookup_watchers
            response = await self.sio.call(
                "claude_lookup_watchers",
                {
                    "project_path": project_path,
                    "claude_session_id": claude_session_id,
                },
                namespace="/local-pod",
                timeout=5.0,
            )

            logger.info(
                "Backend watcher lookup response received",
                response=response,
                response_type=type(response).__name__,
                project_path=project_path,
            )

            if isinstance(response, dict):
                watchers: list[dict[str, str]] = response.get("watchers", [])
                if response.get("error"):
                    logger.warning("Backend returned error", error=response.get("error"))
                return watchers
            return []

        except TimeoutError:
            logger.warning(
                "Watcher lookup timed out",
                project_path=project_path,
                session_id=claude_session_id,
            )
            return []
        except Exception as e:
            logger.warning(
                "Failed to lookup watchers",
                project_path=project_path,
                session_id=claude_session_id,
                error=str(e),
                error_type=type(e).__name__,
            )
            return []

    async def _emit_sync_to_watcher(
        self,
        session_id: str,
        project_path: str,
        podex_session_id: str,
        podex_agent_id: str,
        messages: list[dict[str, Any]],
    ) -> None:
        """Emit sync event to a specific watcher.

        Args:
            session_id: Claude session ID
            project_path: Project path
            podex_session_id: Podex session ID
            podex_agent_id: Podex agent ID
            messages: Messages to sync
        """
        if not self.sio or not self.sio.connected:
            logger.warning(
                "Cannot emit sync - Socket.IO not connected",
                session_id=session_id,
            )
            return

        payload = {
            "podex_session_id": podex_session_id,
            "podex_agent_id": podex_agent_id,
            "claude_session_id": session_id,
            "project_path": project_path,
            "messages": messages,
            "sync_type": "incremental",
        }

        try:
            await self.sio.emit(
                "claude_session_sync",  # Use underscores to match handler on_claude_session_sync
                payload,
                namespace="/local-pod",
            )
            logger.info(
                "Emitted session sync to watcher",
                session_id=session_id,
                message_count=len(messages),
                podex_session_id=podex_session_id,
                podex_agent_id=podex_agent_id,
            )
        except Exception as e:
            logger.error(
                "Failed to emit sync event",
                session_id=session_id,
                error=str(e),
            )


# Global watcher instance (created on demand)
_watcher: ClaudeSessionWatcher | None = None


def get_session_watcher(sio: "socketio.AsyncClient | None" = None) -> ClaudeSessionWatcher:
    """Get or create the global session watcher instance.

    Args:
        sio: Socket.IO client (required on first call)

    Returns:
        The session watcher instance
    """
    global _watcher
    if _watcher is None:
        _watcher = ClaudeSessionWatcher(sio)
    elif sio is not None:
        _watcher.sio = sio
    return _watcher
