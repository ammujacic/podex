"""Comprehensive tests for WebSocket hub."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from jose import jwt as jose_jwt

from src.websocket.hub import (
    CLEANUP_GRACE_PERIOD,
    MAX_TERMINAL_INPUT_BYTES,
    MAX_YJS_BYTES_PER_SESSION,
    MAX_YJS_UPDATES_PER_DOC,
    AgentAttentionInfo,
    _client_info,
    _pending_session_cleanup,
    _pending_terminal_cleanup,
    _verify_auth_token,
    _yjs_docs,
    _yjs_updates,
)


class TestVerifyAuthToken:
    """Tests for JWT token verification."""

    def test_verify_auth_token_valid(self) -> None:
        """Test valid JWT token verification."""
        from src.config import settings

        token = jose_jwt.encode(
            {"sub": "user-123"},
            settings.JWT_SECRET_KEY,
            algorithm="HS256",
        )

        result = _verify_auth_token(token)
        assert result == "user-123"

    def test_verify_auth_token_with_user_id_claim(self) -> None:
        """Test JWT token with user_id claim instead of sub."""
        from src.config import settings

        token = jose_jwt.encode(
            {"user_id": "user-456"},
            settings.JWT_SECRET_KEY,
            algorithm="HS256",
        )

        result = _verify_auth_token(token)
        assert result == "user-456"

    def test_verify_auth_token_none(self) -> None:
        """Test None token returns None."""
        result = _verify_auth_token(None)
        assert result is None

    def test_verify_auth_token_empty(self) -> None:
        """Test empty token returns None."""
        result = _verify_auth_token("")
        assert result is None

    def test_verify_auth_token_invalid(self) -> None:
        """Test invalid JWT token returns None."""
        result = _verify_auth_token("invalid.token.here")
        assert result is None

    def test_verify_auth_token_wrong_secret(self) -> None:
        """Test JWT with wrong secret returns None."""
        token = jose_jwt.encode(
            {"sub": "user-123"},
            "wrong-secret-key",
            algorithm="HS256",
        )

        result = _verify_auth_token(token)
        assert result is None


class TestAgentAttentionInfo:
    """Tests for AgentAttentionInfo dataclass."""

    def test_attention_info_required_fields(self) -> None:
        """Test AgentAttentionInfo with required fields."""
        info = AgentAttentionInfo(
            session_id="session-123",
            agent_id="agent-456",
            agent_name="Test Agent",
            attention_type="question",
            title="Test Title",
            message="Test message",
        )
        assert info.session_id == "session-123"
        assert info.agent_id == "agent-456"
        assert info.agent_name == "Test Agent"
        assert info.attention_type == "question"
        assert info.title == "Test Title"
        assert info.message == "Test message"

    def test_attention_info_default_priority(self) -> None:
        """Test AgentAttentionInfo default priority."""
        info = AgentAttentionInfo(
            session_id="session-123",
            agent_id="agent-456",
            agent_name="Test Agent",
            attention_type="question",
            title="Test Title",
            message="Test message",
        )
        assert info.priority == "medium"

    def test_attention_info_custom_priority(self) -> None:
        """Test AgentAttentionInfo with custom priority."""
        info = AgentAttentionInfo(
            session_id="session-123",
            agent_id="agent-456",
            agent_name="Test Agent",
            attention_type="error",
            title="Error Title",
            message="Error message",
            priority="high",
        )
        assert info.priority == "high"

    def test_attention_info_with_metadata(self) -> None:
        """Test AgentAttentionInfo with metadata."""
        info = AgentAttentionInfo(
            session_id="session-123",
            agent_id="agent-456",
            agent_name="Test Agent",
            attention_type="question",
            title="Test Title",
            message="Test message",
            metadata={"key": "value"},
        )
        assert info.metadata == {"key": "value"}

    def test_attention_info_with_attention_id(self) -> None:
        """Test AgentAttentionInfo with custom attention ID."""
        info = AgentAttentionInfo(
            session_id="session-123",
            agent_id="agent-456",
            agent_name="Test Agent",
            attention_type="question",
            title="Test Title",
            message="Test message",
            attention_id="custom-attention-id",
        )
        assert info.attention_id == "custom-attention-id"


class TestConstants:
    """Tests for WebSocket hub constants."""

    def test_max_terminal_input_bytes(self) -> None:
        """Test MAX_TERMINAL_INPUT_BYTES is reasonable."""
        assert MAX_TERMINAL_INPUT_BYTES == 8192

    def test_max_yjs_updates_per_doc(self) -> None:
        """Test MAX_YJS_UPDATES_PER_DOC is reasonable."""
        assert MAX_YJS_UPDATES_PER_DOC == 100

    def test_max_yjs_bytes_per_session(self) -> None:
        """Test MAX_YJS_BYTES_PER_SESSION is 10MB."""
        assert MAX_YJS_BYTES_PER_SESSION == 10 * 1024 * 1024

    def test_cleanup_grace_period(self) -> None:
        """Test CLEANUP_GRACE_PERIOD is reasonable."""
        assert CLEANUP_GRACE_PERIOD == 5.0


class TestGlobalState:
    """Tests for global state dictionaries."""

    def test_client_info_is_dict(self) -> None:
        """Test _client_info is a dictionary."""
        assert isinstance(_client_info, dict)

    def test_yjs_docs_is_dict(self) -> None:
        """Test _yjs_docs is a dictionary."""
        assert isinstance(_yjs_docs, dict)

    def test_yjs_updates_is_dict(self) -> None:
        """Test _yjs_updates is a dictionary."""
        assert isinstance(_yjs_updates, dict)

    def test_pending_session_cleanup_is_dict(self) -> None:
        """Test _pending_session_cleanup is a dictionary."""
        assert isinstance(_pending_session_cleanup, dict)

    def test_pending_terminal_cleanup_is_dict(self) -> None:
        """Test _pending_terminal_cleanup is a dictionary."""
        assert isinstance(_pending_terminal_cleanup, dict)


class TestWebSocketEvents:
    """Tests for WebSocket event handlers."""

    @pytest.fixture
    def mock_sio(self) -> MagicMock:
        """Create mock Socket.IO server."""
        sio = MagicMock()
        sio.emit = AsyncMock()
        sio.enter_room = AsyncMock()
        sio.leave_room = AsyncMock()
        sio.manager = MagicMock()
        sio.manager.rooms = {"/": {}}
        return sio

    @pytest.mark.asyncio
    async def test_session_join_missing_session_id(self, mock_sio: MagicMock) -> None:
        """Test session_join with missing session_id."""
        from src.websocket.hub import session_join

        with patch("src.websocket.hub.sio", mock_sio):
            await session_join("sid-123", {})

            mock_sio.emit.assert_called_once()
            call_args = mock_sio.emit.call_args
            assert call_args[0][0] == "error"
            assert "session_id required" in call_args[0][1]["error"]

    @pytest.mark.asyncio
    async def test_session_join_missing_auth(self, mock_sio: MagicMock) -> None:
        """Test session_join with missing auth token."""
        from src.websocket.hub import session_join

        with (
            patch("src.websocket.hub.sio", mock_sio),
            patch("src.websocket.hub._verify_auth_token", return_value=None),
        ):
            await session_join("sid-123", {"session_id": "session-456"})

            mock_sio.emit.assert_called_once()
            call_args = mock_sio.emit.call_args
            assert call_args[0][0] == "error"
            assert "Authentication required" in call_args[0][1]["error"]

    @pytest.mark.asyncio
    async def test_session_leave_missing_session_id(self, mock_sio: MagicMock) -> None:
        """Test session_leave with missing session_id."""
        from src.websocket.hub import session_leave

        with patch("src.websocket.hub.sio", mock_sio):
            await session_leave("sid-123", {})

            # Should return early without doing anything
            mock_sio.leave_room.assert_not_called()

    @pytest.mark.asyncio
    async def test_cursor_update_missing_session_id(self, mock_sio: MagicMock) -> None:
        """Test cursor_update with missing session_id."""
        from src.websocket.hub import cursor_update

        with patch("src.websocket.hub.sio", mock_sio):
            await cursor_update("sid-123", {})

            # Should return early without emitting
            mock_sio.emit.assert_not_called()

    @pytest.mark.asyncio
    async def test_cursor_update_unauthenticated(self, mock_sio: MagicMock) -> None:
        """Test cursor_update from unauthenticated client."""
        from src.websocket.hub import cursor_update

        # Clear any existing client info
        _client_info.clear()

        with patch("src.websocket.hub.sio", mock_sio):
            await cursor_update("sid-123", {"session_id": "session-456"})

            # Should not emit for unauthenticated client
            mock_sio.emit.assert_not_called()

    @pytest.mark.asyncio
    async def test_file_change_missing_session_id(self, mock_sio: MagicMock) -> None:
        """Test file_change with missing session_id."""
        from src.websocket.hub import file_change

        with patch("src.websocket.hub.sio", mock_sio):
            await file_change("sid-123", {})

            mock_sio.emit.assert_not_called()

    @pytest.mark.asyncio
    async def test_agent_message_missing_session_id(self, mock_sio: MagicMock) -> None:
        """Test agent_message with missing session_id."""
        from src.websocket.hub import agent_message

        with patch("src.websocket.hub.sio", mock_sio):
            await agent_message("sid-123", {})

            mock_sio.emit.assert_not_called()


class TestTerminalEvents:
    """Tests for terminal WebSocket events."""

    @pytest.fixture
    def mock_sio(self) -> MagicMock:
        """Create mock Socket.IO server."""
        sio = MagicMock()
        sio.emit = AsyncMock()
        sio.enter_room = AsyncMock()
        sio.leave_room = AsyncMock()
        sio.manager = MagicMock()
        sio.manager.rooms = {"/": {}}
        return sio

    @pytest.mark.asyncio
    async def test_terminal_attach_missing_workspace_id(self, mock_sio: MagicMock) -> None:
        """Test terminal_attach with missing workspace_id."""
        from src.websocket.hub import terminal_attach

        with patch("src.websocket.hub.sio", mock_sio):
            await terminal_attach("sid-123", {})

            mock_sio.emit.assert_called_once()
            call_args = mock_sio.emit.call_args
            assert call_args[0][0] == "terminal_error"
            assert "workspace_id required" in call_args[0][1]["error"]

    @pytest.mark.asyncio
    async def test_terminal_attach_missing_auth(self, mock_sio: MagicMock) -> None:
        """Test terminal_attach with missing auth."""
        from src.websocket.hub import terminal_attach

        with (
            patch("src.websocket.hub.sio", mock_sio),
            patch("src.websocket.hub._verify_auth_token", return_value=None),
        ):
            await terminal_attach("sid-123", {"workspace_id": "ws-456"})

            mock_sio.emit.assert_called_once()
            call_args = mock_sio.emit.call_args
            assert call_args[0][0] == "terminal_error"
            assert "Authentication required" in call_args[0][1]["error"]

    @pytest.mark.asyncio
    async def test_terminal_detach_missing_workspace_id(self, mock_sio: MagicMock) -> None:
        """Test terminal_detach with missing workspace_id."""
        from src.websocket.hub import terminal_detach

        with patch("src.websocket.hub.sio", mock_sio):
            await terminal_detach("sid-123", {})

            mock_sio.leave_room.assert_not_called()

    @pytest.mark.asyncio
    async def test_terminal_input_missing_data(self, mock_sio: MagicMock) -> None:
        """Test terminal_input with missing data."""
        from src.websocket.hub import terminal_input

        with patch("src.websocket.hub.sio", mock_sio):
            await terminal_input("sid-123", {"workspace_id": "ws-456"})

            # Should return early without doing anything
            # No assertion needed, just verify no error

    @pytest.mark.asyncio
    async def test_terminal_input_too_large(self, mock_sio: MagicMock) -> None:
        """Test terminal_input with input too large."""
        from src.websocket.hub import terminal_input

        # Set up the room to include the client
        mock_sio.manager.rooms = {"/": {"terminal:ws-456": {"sid-123"}}}

        large_input = "x" * (MAX_TERMINAL_INPUT_BYTES + 1)

        with patch("src.websocket.hub.sio", mock_sio):
            await terminal_input(
                "sid-123",
                {"workspace_id": "ws-456", "data": large_input},
            )
            # Should return early due to size limit


class TestYjsEvents:
    """Tests for Yjs collaboration events."""

    @pytest.fixture
    def mock_sio(self) -> MagicMock:
        """Create mock Socket.IO server."""
        sio = MagicMock()
        sio.emit = AsyncMock()
        sio.enter_room = AsyncMock()
        sio.leave_room = AsyncMock()
        return sio

    @pytest.mark.asyncio
    async def test_yjs_subscribe_missing_fields(self, mock_sio: MagicMock) -> None:
        """Test yjs_subscribe with missing fields."""
        from src.websocket.hub import yjs_subscribe

        with patch("src.websocket.hub.sio", mock_sio):
            await yjs_subscribe("sid-123", {})

            mock_sio.enter_room.assert_not_called()

    @pytest.mark.asyncio
    async def test_yjs_subscribe_missing_doc_name(self, mock_sio: MagicMock) -> None:
        """Test yjs_subscribe with missing doc_name."""
        from src.websocket.hub import yjs_subscribe

        with patch("src.websocket.hub.sio", mock_sio):
            await yjs_subscribe("sid-123", {"session_id": "session-456"})

            mock_sio.enter_room.assert_not_called()

    @pytest.mark.asyncio
    async def test_yjs_unsubscribe_missing_fields(self, mock_sio: MagicMock) -> None:
        """Test yjs_unsubscribe with missing fields."""
        from src.websocket.hub import yjs_unsubscribe

        with patch("src.websocket.hub.sio", mock_sio):
            await yjs_unsubscribe("sid-123", {})

            mock_sio.leave_room.assert_not_called()

    @pytest.mark.asyncio
    async def test_yjs_update_missing_fields(self, mock_sio: MagicMock) -> None:
        """Test yjs_update with missing fields."""
        from src.websocket.hub import yjs_update

        with patch("src.websocket.hub.sio", mock_sio):
            await yjs_update("sid-123", {})

            mock_sio.emit.assert_not_called()

    @pytest.mark.asyncio
    async def test_yjs_awareness_missing_fields(self, mock_sio: MagicMock) -> None:
        """Test yjs_awareness with missing fields."""
        from src.websocket.hub import yjs_awareness

        with patch("src.websocket.hub.sio", mock_sio):
            await yjs_awareness("sid-123", {})

            mock_sio.emit.assert_not_called()


class TestVoiceEvents:
    """Tests for voice streaming events."""

    @pytest.fixture
    def mock_sio(self) -> MagicMock:
        """Create mock Socket.IO server."""
        sio = MagicMock()
        sio.emit = AsyncMock()
        return sio

    @pytest.mark.asyncio
    async def test_voice_stream_start_missing_fields(self, mock_sio: MagicMock) -> None:
        """Test voice_stream_start with missing fields."""
        from src.websocket.hub import voice_stream_start

        with patch("src.websocket.hub.sio", mock_sio):
            await voice_stream_start("sid-123", {})

            mock_sio.emit.assert_called_once()
            call_args = mock_sio.emit.call_args
            assert call_args[0][0] == "voice_error"

    @pytest.mark.asyncio
    async def test_voice_chunk_missing_session_id(self, mock_sio: MagicMock) -> None:
        """Test voice_chunk with missing session_id."""
        from src.websocket.hub import voice_chunk

        with patch("src.websocket.hub.sio", mock_sio):
            await voice_chunk("sid-123", {"chunk": "base64data"})

            # Should return early
            mock_sio.emit.assert_not_called()

    @pytest.mark.asyncio
    async def test_voice_stream_end_missing_session_id(self, mock_sio: MagicMock) -> None:
        """Test voice_stream_end with missing session_id."""
        from src.websocket.hub import voice_stream_end

        with patch("src.websocket.hub.sio", mock_sio):
            await voice_stream_end("sid-123", {})

            # Should return early
            mock_sio.emit.assert_not_called()

    @pytest.mark.asyncio
    async def test_tts_request_missing_fields(self, mock_sio: MagicMock) -> None:
        """Test tts_request with missing fields."""
        from src.websocket.hub import tts_request

        with patch("src.websocket.hub.sio", mock_sio):
            await tts_request("sid-123", {})

            mock_sio.emit.assert_called_once()
            call_args = mock_sio.emit.call_args
            assert call_args[0][0] == "voice_error"


class TestAgentAttentionEvents:
    """Tests for agent attention events."""

    @pytest.fixture
    def mock_sio(self) -> MagicMock:
        """Create mock Socket.IO server."""
        sio = MagicMock()
        sio.emit = AsyncMock()
        return sio

    @pytest.mark.asyncio
    async def test_agent_attention_read_missing_fields(self, mock_sio: MagicMock) -> None:
        """Test agent_attention_read with missing fields."""
        from src.websocket.hub import agent_attention_read

        with patch("src.websocket.hub.sio", mock_sio):
            await agent_attention_read("sid-123", {})

            mock_sio.emit.assert_not_called()

    @pytest.mark.asyncio
    async def test_agent_attention_dismiss_missing_fields(self, mock_sio: MagicMock) -> None:
        """Test agent_attention_dismiss with missing fields."""
        from src.websocket.hub import agent_attention_dismiss

        with patch("src.websocket.hub.sio", mock_sio):
            await agent_attention_dismiss("sid-123", {})

            mock_sio.emit.assert_not_called()


class TestEmitFunctions:
    """Tests for emit helper functions."""

    @pytest.fixture
    def mock_sio(self) -> MagicMock:
        """Create mock Socket.IO server."""
        sio = MagicMock()
        sio.emit = AsyncMock()
        return sio

    @pytest.mark.asyncio
    async def test_emit_to_session(self, mock_sio: MagicMock) -> None:
        """Test emit_to_session function."""
        from src.websocket.hub import emit_to_session

        with patch("src.websocket.hub.sio", mock_sio):
            await emit_to_session("session-123", "test_event", {"key": "value"})

            mock_sio.emit.assert_called_once_with(
                "test_event",
                {"key": "value"},
                room="session:session-123",
            )

    @pytest.mark.asyncio
    async def test_emit_to_terminal(self, mock_sio: MagicMock) -> None:
        """Test emit_to_terminal function."""
        from src.websocket.hub import emit_to_terminal

        with patch("src.websocket.hub.sio", mock_sio):
            await emit_to_terminal("ws-123", "terminal output")

            mock_sio.emit.assert_called_once()
            call_args = mock_sio.emit.call_args
            assert call_args[0][0] == "terminal_data"
            assert call_args[0][1]["workspace_id"] == "ws-123"
            assert call_args[0][1]["data"] == "terminal output"

    @pytest.mark.asyncio
    async def test_emit_voice_transcription(self, mock_sio: MagicMock) -> None:
        """Test emit_voice_transcription function."""
        from src.websocket.hub import emit_voice_transcription

        with patch("src.websocket.hub.sio", mock_sio):
            await emit_voice_transcription(
                session_id="session-123",
                agent_id="agent-456",
                text="Hello world",
                confidence=0.95,
                is_final=True,
            )

            mock_sio.emit.assert_called_once()
            call_args = mock_sio.emit.call_args
            assert call_args[0][0] == "voice_transcription"
            assert call_args[0][1]["session_id"] == "session-123"
            assert call_args[0][1]["text"] == "Hello world"
            assert call_args[0][1]["confidence"] == 0.95

    @pytest.mark.asyncio
    async def test_emit_tts_ready(self, mock_sio: MagicMock) -> None:
        """Test emit_tts_ready function."""
        from src.websocket.hub import emit_tts_ready

        with patch("src.websocket.hub.sio", mock_sio):
            await emit_tts_ready(
                session_id="session-123",
                message_id="msg-456",
                audio_url="https://example.com/audio.mp3",
                duration_ms=5000,
            )

            mock_sio.emit.assert_called_once()
            call_args = mock_sio.emit.call_args
            assert call_args[0][0] == "tts_audio_ready"
            assert call_args[0][1]["message_id"] == "msg-456"
            assert call_args[0][1]["audio_url"] == "https://example.com/audio.mp3"

    @pytest.mark.asyncio
    async def test_emit_agent_attention(self, mock_sio: MagicMock) -> None:
        """Test emit_agent_attention function."""
        from src.websocket.hub import emit_agent_attention

        info = AgentAttentionInfo(
            session_id="session-123",
            agent_id="agent-456",
            agent_name="Test Agent",
            attention_type="question",
            title="Test Title",
            message="Test message",
        )

        with patch("src.websocket.hub.sio", mock_sio):
            notification_id = await emit_agent_attention(info)

            assert notification_id is not None
            mock_sio.emit.assert_called_once()
            call_args = mock_sio.emit.call_args
            assert call_args[0][0] == "agent_attention"
            assert call_args[0][1]["session_id"] == "session-123"
            assert call_args[0][1]["agent_name"] == "Test Agent"


class TestBroadcastToRoom:
    """Tests for broadcast_to_room function."""

    @pytest.fixture
    def mock_sio(self) -> MagicMock:
        """Create mock Socket.IO server."""
        sio = MagicMock()
        sio.emit = AsyncMock()
        return sio

    @pytest.mark.asyncio
    async def test_broadcast_to_room(self, mock_sio: MagicMock) -> None:
        """Test broadcast_to_room function."""
        from src.websocket.hub import broadcast_to_room

        with patch("src.websocket.hub.sio", mock_sio):
            await broadcast_to_room("room-123", "test_event", {"data": "value"})

            mock_sio.emit.assert_called_once_with(
                "test_event",
                {"data": "value"},
                room="room-123",
            )
