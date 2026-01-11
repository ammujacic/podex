"""Session sync models shared across services."""

from datetime import UTC, datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class SyncActionType(str, Enum):
    """Types of sync actions."""

    # Cursor and selection
    CURSOR_MOVE = "cursor:move"
    SELECTION_CHANGE = "selection:change"

    # Files
    FILE_OPEN = "file:open"
    FILE_CLOSE = "file:close"
    FILE_EDIT = "file:edit"
    FILE_SAVE = "file:save"

    # Layout
    LAYOUT_CHANGE = "layout:change"
    PANEL_RESIZE = "panel:resize"
    PANEL_FOCUS = "panel:focus"

    # Agents
    AGENT_STATUS = "agent:status"
    AGENT_MESSAGE = "agent:message"
    AGENT_TOOL_CALL = "agent:tool_call"

    # Terminal
    TERMINAL_OUTPUT = "terminal:output"
    TERMINAL_RESIZE = "terminal:resize"

    # Viewers
    VIEWER_JOIN = "viewer:join"
    VIEWER_LEAVE = "viewer:leave"
    VIEWER_CURSOR = "viewer:cursor"

    # Session
    SESSION_STATE = "session:state"
    SESSION_FULL_SYNC = "session:full_sync"


class SharingMode(str, Enum):
    """Session sharing permission levels."""

    VIEW_ONLY = "view_only"  # Can only watch
    CAN_EDIT = "can_edit"  # Can edit files and use terminal
    FULL_CONTROL = "full_control"  # Can also control agents and settings


class SessionViewer(BaseModel):
    """A user viewing a session."""

    user_id: str
    username: str
    device_id: str  # Unique per device/browser
    cursor_position: dict[str, Any] | None = None  # {file, line, column}
    is_online: bool = True
    sharing_mode: SharingMode = SharingMode.CAN_EDIT
    joined_at: datetime
    last_activity: datetime

    model_config = {"from_attributes": True}


class GridSpan(BaseModel):
    """Grid span for agents and file previews."""

    col_span: int = 1  # 1-3 columns
    row_span: int = 1  # 1-2 rows


class Position(BaseModel):
    """Position for freeform mode."""

    x: float = 0
    y: float = 0
    width: float = 400
    height: float = 300
    z_index: int = 1


class AgentLayout(BaseModel):
    """Layout state for a single agent."""

    agent_id: str
    grid_span: GridSpan = Field(default_factory=GridSpan)
    position: Position = Field(default_factory=Position)


class FilePreviewLayout(BaseModel):
    """Layout state for a file preview."""

    preview_id: str
    path: str
    grid_span: GridSpan = Field(default_factory=GridSpan)
    position: Position = Field(default_factory=Position)
    docked: bool = False
    pinned: bool = False


class SessionLayout(BaseModel):
    """Session layout state."""

    # View mode: grid, focus, or freeform
    view_mode: str = "grid"
    # Active agent in focus mode
    active_agent_id: str | None = None
    # Agent layouts (keyed by agent_id)
    agent_layouts: dict[str, AgentLayout] = Field(default_factory=dict)
    # File preview layouts (keyed by preview_id)
    file_preview_layouts: dict[str, FilePreviewLayout] = Field(default_factory=dict)
    # Active panels and their positions (legacy, kept for compatibility)
    panels: list[dict[str, Any]] = Field(default_factory=list)
    # Window positions and sizes (legacy, kept for compatibility)
    windows: dict[str, dict[str, Any]] = Field(default_factory=dict)
    # Focus state
    focused_panel: str | None = None
    # Sidebar state
    sidebar_open: bool = True
    sidebar_width: int = 280


class AgentState(BaseModel):
    """State of an agent in a session."""

    agent_id: str
    agent_type: str
    model: str
    status: str  # idle, working, waiting, error
    current_task: str | None = None
    workspace_id: str | None = None
    last_message_at: datetime | None = None


class WorkspaceSessionState(BaseModel):
    """State of a workspace within a session (for sync purposes)."""

    workspace_id: str
    repo_url: str | None = None
    open_files: list[str] = Field(default_factory=list)
    active_file: str | None = None
    cursor_positions: dict[str, dict[str, int]] = Field(
        default_factory=dict,
    )  # file_path -> {line, col}


class SessionState(BaseModel):
    """Complete session state - stored in DynamoDB."""

    session_id: str
    user_id: str  # Owner
    name: str

    # Workspaces in this session
    workspaces: list[WorkspaceSessionState] = Field(default_factory=list)

    # Agents in this session
    agents: list[AgentState] = Field(default_factory=list)

    # Layout
    layout: SessionLayout = Field(default_factory=SessionLayout)

    # Active viewers
    viewers: list[SessionViewer] = Field(default_factory=list)

    # Sharing settings
    shared_with: list[str] = Field(default_factory=list)  # User IDs
    share_link: str | None = None
    default_sharing_mode: SharingMode = SharingMode.CAN_EDIT

    # Timestamps
    created_at: datetime
    updated_at: datetime
    last_activity: datetime

    # State versioning for OT
    version: int = 0

    model_config = {"from_attributes": True}


class SyncAction(BaseModel):
    """A sync action to be broadcast to all session viewers."""

    type: SyncActionType
    session_id: str
    payload: dict[str, Any]
    sender_id: str  # User ID who initiated the action
    sender_device: str  # Device ID
    client_seq: int = 0  # For OT conflict resolution
    server_seq: int = 0  # Server-assigned sequence number
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))

    model_config = {"from_attributes": True}


class SyncBroadcast(BaseModel):
    """A broadcast message to session viewers."""

    type: str  # "state_patch" or "full_sync"
    patch: list[dict[str, Any]] | None = None  # RFC 6902 JSON patches
    state: SessionState | None = None  # Full state for reconnection
    server_seq: int
