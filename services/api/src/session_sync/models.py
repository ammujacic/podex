"""Session sync models - re-exported from podex_shared for backward compatibility."""

from podex_shared import (
    AgentState,
    SessionLayout,
    SessionState,
    SessionViewer,
    SharingMode,
    SyncAction,
    SyncActionType,
    SyncBroadcast,
    WorkspaceSessionState,
)

# Re-export with original name for backward compatibility
WorkspaceState = WorkspaceSessionState

__all__ = [
    "AgentState",
    "SessionLayout",
    "SessionState",
    "SessionViewer",
    "SharingMode",
    "SyncAction",
    "SyncActionType",
    "SyncBroadcast",
    "WorkspaceState",
]
