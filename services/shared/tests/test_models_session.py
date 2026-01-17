"""Comprehensive tests for session sync models."""

from datetime import UTC, datetime

from podex_shared.models.session import (
    AgentLayout,
    AgentState,
    FilePreviewLayout,
    GridSpan,
    Position,
    SessionLayout,
    SessionState,
    SessionViewer,
    SharingMode,
    SyncAction,
    SyncActionType,
    SyncBroadcast,
    WorkspaceSessionState,
)


class TestSyncActionType:
    """Tests for SyncActionType enum."""

    def test_cursor_actions(self) -> None:
        """Test cursor action types."""
        assert SyncActionType.CURSOR_MOVE == "cursor:move"
        assert SyncActionType.SELECTION_CHANGE == "selection:change"

    def test_file_actions(self) -> None:
        """Test file action types."""
        assert SyncActionType.FILE_OPEN == "file:open"
        assert SyncActionType.FILE_CLOSE == "file:close"
        assert SyncActionType.FILE_EDIT == "file:edit"
        assert SyncActionType.FILE_SAVE == "file:save"

    def test_layout_actions(self) -> None:
        """Test layout action types."""
        assert SyncActionType.LAYOUT_CHANGE == "layout:change"
        assert SyncActionType.PANEL_RESIZE == "panel:resize"
        assert SyncActionType.PANEL_FOCUS == "panel:focus"

    def test_agent_actions(self) -> None:
        """Test agent action types."""
        assert SyncActionType.AGENT_STATUS == "agent:status"
        assert SyncActionType.AGENT_MESSAGE == "agent:message"
        assert SyncActionType.AGENT_TOOL_CALL == "agent:tool_call"

    def test_terminal_actions(self) -> None:
        """Test terminal action types."""
        assert SyncActionType.TERMINAL_OUTPUT == "terminal:output"
        assert SyncActionType.TERMINAL_RESIZE == "terminal:resize"

    def test_viewer_actions(self) -> None:
        """Test viewer action types."""
        assert SyncActionType.VIEWER_JOIN == "viewer:join"
        assert SyncActionType.VIEWER_LEAVE == "viewer:leave"
        assert SyncActionType.VIEWER_CURSOR == "viewer:cursor"

    def test_session_actions(self) -> None:
        """Test session action types."""
        assert SyncActionType.SESSION_STATE == "session:state"
        assert SyncActionType.SESSION_FULL_SYNC == "session:full_sync"


class TestSharingMode:
    """Tests for SharingMode enum."""

    def test_sharing_modes(self) -> None:
        """Test sharing mode values."""
        assert SharingMode.VIEW_ONLY == "view_only"
        assert SharingMode.CAN_EDIT == "can_edit"
        assert SharingMode.FULL_CONTROL == "full_control"


class TestSessionViewer:
    """Tests for SessionViewer model."""

    def test_session_viewer(self) -> None:
        """Test creating SessionViewer."""
        now = datetime.now(UTC)
        viewer = SessionViewer(
            user_id="user-123",
            username="testuser",
            device_id="device-abc",
            joined_at=now,
            last_activity=now,
        )
        assert viewer.user_id == "user-123"
        assert viewer.username == "testuser"
        assert viewer.device_id == "device-abc"
        assert viewer.is_online is True
        assert viewer.sharing_mode == SharingMode.CAN_EDIT
        assert viewer.cursor_position is None

    def test_session_viewer_with_cursor(self) -> None:
        """Test SessionViewer with cursor position."""
        now = datetime.now(UTC)
        viewer = SessionViewer(
            user_id="user-123",
            username="testuser",
            device_id="device-abc",
            cursor_position={"file": "main.py", "line": 42, "column": 10},
            joined_at=now,
            last_activity=now,
        )
        assert viewer.cursor_position is not None
        assert viewer.cursor_position["line"] == 42


class TestGridSpan:
    """Tests for GridSpan model."""

    def test_grid_span_defaults(self) -> None:
        """Test GridSpan default values."""
        span = GridSpan()
        assert span.col_span == 1
        assert span.row_span == 1

    def test_grid_span_custom(self) -> None:
        """Test GridSpan with custom values."""
        span = GridSpan(col_span=2, row_span=2)
        assert span.col_span == 2
        assert span.row_span == 2


class TestPosition:
    """Tests for Position model."""

    def test_position_defaults(self) -> None:
        """Test Position default values."""
        pos = Position()
        assert pos.x == 0
        assert pos.y == 0
        assert pos.width == 400
        assert pos.height == 300
        assert pos.z_index == 1

    def test_position_custom(self) -> None:
        """Test Position with custom values."""
        pos = Position(x=100, y=200, width=500, height=400, z_index=10)
        assert pos.x == 100
        assert pos.y == 200
        assert pos.width == 500
        assert pos.height == 400
        assert pos.z_index == 10


class TestAgentLayout:
    """Tests for AgentLayout model."""

    def test_agent_layout_defaults(self) -> None:
        """Test AgentLayout default values."""
        layout = AgentLayout(agent_id="agent-123")
        assert layout.agent_id == "agent-123"
        assert layout.grid_span.col_span == 1
        assert layout.position.x == 0

    def test_agent_layout_custom(self) -> None:
        """Test AgentLayout with custom values."""
        layout = AgentLayout(
            agent_id="agent-123",
            grid_span=GridSpan(col_span=2, row_span=1),
            position=Position(x=100, y=50),
        )
        assert layout.grid_span.col_span == 2
        assert layout.position.x == 100


class TestFilePreviewLayout:
    """Tests for FilePreviewLayout model."""

    def test_file_preview_layout_defaults(self) -> None:
        """Test FilePreviewLayout default values."""
        layout = FilePreviewLayout(
            preview_id="preview-123",
            path="/src/main.py",
        )
        assert layout.preview_id == "preview-123"
        assert layout.path == "/src/main.py"
        assert layout.docked is False
        assert layout.pinned is False

    def test_file_preview_layout_docked(self) -> None:
        """Test FilePreviewLayout docked state."""
        layout = FilePreviewLayout(
            preview_id="preview-123",
            path="/src/main.py",
            docked=True,
            pinned=True,
        )
        assert layout.docked is True
        assert layout.pinned is True


class TestSessionLayout:
    """Tests for SessionLayout model."""

    def test_session_layout_defaults(self) -> None:
        """Test SessionLayout default values."""
        layout = SessionLayout()
        assert layout.view_mode == "grid"
        assert layout.active_agent_id is None
        assert layout.agent_layouts == {}
        assert layout.file_preview_layouts == {}
        assert layout.panels == []
        assert layout.windows == {}
        assert layout.focused_panel is None
        assert layout.sidebar_open is True
        assert layout.sidebar_width == 280

    def test_session_layout_with_agents(self) -> None:
        """Test SessionLayout with agent layouts."""
        layout = SessionLayout(
            view_mode="focus",
            active_agent_id="agent-1",
            agent_layouts={
                "agent-1": AgentLayout(agent_id="agent-1"),
                "agent-2": AgentLayout(agent_id="agent-2"),
            },
        )
        assert layout.view_mode == "focus"
        assert layout.active_agent_id == "agent-1"
        assert len(layout.agent_layouts) == 2


class TestAgentState:
    """Tests for AgentState model."""

    def test_agent_state(self) -> None:
        """Test creating AgentState."""
        state = AgentState(
            agent_id="agent-123",
            agent_type="coder",
            model="claude-sonnet-4-20250514",
            status="working",
            current_task="Implementing feature",
        )
        assert state.agent_id == "agent-123"
        assert state.agent_type == "coder"
        assert state.model == "claude-sonnet-4-20250514"
        assert state.status == "working"
        assert state.current_task == "Implementing feature"

    def test_agent_state_minimal(self) -> None:
        """Test AgentState with minimal fields."""
        state = AgentState(
            agent_id="agent-123",
            agent_type="reviewer",
            model="claude-haiku",
            status="idle",
        )
        assert state.current_task is None
        assert state.workspace_id is None
        assert state.last_message_at is None


class TestWorkspaceSessionState:
    """Tests for WorkspaceSessionState model."""

    def test_workspace_session_state_defaults(self) -> None:
        """Test WorkspaceSessionState default values."""
        state = WorkspaceSessionState(workspace_id="ws-123")
        assert state.workspace_id == "ws-123"
        assert state.repo_url is None
        assert state.open_files == []
        assert state.active_file is None
        assert state.cursor_positions == {}

    def test_workspace_session_state_with_files(self) -> None:
        """Test WorkspaceSessionState with open files."""
        state = WorkspaceSessionState(
            workspace_id="ws-123",
            repo_url="https://github.com/user/repo",
            open_files=["src/main.py", "src/utils.py"],
            active_file="src/main.py",
            cursor_positions={
                "src/main.py": {"line": 10, "col": 5},
            },
        )
        assert len(state.open_files) == 2
        assert state.active_file == "src/main.py"
        assert state.cursor_positions["src/main.py"]["line"] == 10


class TestSessionState:
    """Tests for SessionState model."""

    def test_session_state_minimal(self) -> None:
        """Test SessionState with minimal fields."""
        now = datetime.now(UTC)
        state = SessionState(
            session_id="session-123",
            user_id="user-456",
            name="My Session",
            created_at=now,
            updated_at=now,
            last_activity=now,
        )
        assert state.session_id == "session-123"
        assert state.user_id == "user-456"
        assert state.name == "My Session"
        assert state.version == 0
        assert state.workspaces == []
        assert state.agents == []
        assert state.viewers == []
        assert state.shared_with == []
        assert state.share_link is None
        assert state.default_sharing_mode == SharingMode.CAN_EDIT

    def test_session_state_full(self) -> None:
        """Test SessionState with all fields."""
        now = datetime.now(UTC)
        state = SessionState(
            session_id="session-123",
            user_id="user-456",
            name="Full Session",
            workspaces=[WorkspaceSessionState(workspace_id="ws-1")],
            agents=[
                AgentState(
                    agent_id="agent-1",
                    agent_type="coder",
                    model="claude",
                    status="idle",
                )
            ],
            viewers=[
                SessionViewer(
                    user_id="user-789",
                    username="viewer",
                    device_id="device-1",
                    joined_at=now,
                    last_activity=now,
                )
            ],
            shared_with=["user-789", "user-abc"],
            share_link="https://podex.dev/s/abc123",
            default_sharing_mode=SharingMode.VIEW_ONLY,
            created_at=now,
            updated_at=now,
            last_activity=now,
            version=5,
        )
        assert len(state.workspaces) == 1
        assert len(state.agents) == 1
        assert len(state.viewers) == 1
        assert len(state.shared_with) == 2
        assert state.share_link is not None
        assert state.version == 5


class TestSyncAction:
    """Tests for SyncAction model."""

    def test_sync_action(self) -> None:
        """Test creating SyncAction."""
        action = SyncAction(
            type=SyncActionType.FILE_EDIT,
            session_id="session-123",
            payload={"file": "main.py", "content": "new content"},
            sender_id="user-456",
            sender_device="device-abc",
        )
        assert action.type == SyncActionType.FILE_EDIT
        assert action.session_id == "session-123"
        assert action.sender_id == "user-456"
        assert action.client_seq == 0
        assert action.server_seq == 0
        assert action.timestamp is not None

    def test_sync_action_with_sequence(self) -> None:
        """Test SyncAction with sequence numbers."""
        action = SyncAction(
            type=SyncActionType.CURSOR_MOVE,
            session_id="session-123",
            payload={"line": 42},
            sender_id="user-456",
            sender_device="device-abc",
            client_seq=10,
            server_seq=100,
        )
        assert action.client_seq == 10
        assert action.server_seq == 100


class TestSyncBroadcast:
    """Tests for SyncBroadcast model."""

    def test_sync_broadcast_patch(self) -> None:
        """Test SyncBroadcast with patch."""
        broadcast = SyncBroadcast(
            type="state_patch",
            patch=[
                {"op": "replace", "path": "/layout/view_mode", "value": "focus"}
            ],
            server_seq=50,
        )
        assert broadcast.type == "state_patch"
        assert broadcast.patch is not None
        assert len(broadcast.patch) == 1
        assert broadcast.state is None
        assert broadcast.server_seq == 50

    def test_sync_broadcast_full_sync(self) -> None:
        """Test SyncBroadcast with full state."""
        now = datetime.now(UTC)
        state = SessionState(
            session_id="session-123",
            user_id="user-456",
            name="Test",
            created_at=now,
            updated_at=now,
            last_activity=now,
        )
        broadcast = SyncBroadcast(
            type="full_sync",
            state=state,
            server_seq=100,
        )
        assert broadcast.type == "full_sync"
        assert broadcast.state is not None
        assert broadcast.patch is None
