"""Tests for terminal tools module.

Tests cover:
- AgentTerminalSession class
- run_terminal_command function
- WebSocket connection handling
- Command execution with output capture
"""

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock

import pytest
import websockets

from src.tools.terminal_tools import (
    AgentTerminalSession,
    run_terminal_command,
)


class TestTerminalToolsModule:
    """Test terminal tools module exists."""

    def test_terminal_tools_module_exists(self):
        """Test terminal tools module can be imported."""
        from src.tools import terminal_tools
        assert terminal_tools is not None


class TestAgentTerminalSession:
    """Test AgentTerminalSession class."""

    def test_agent_terminal_session_class_exists(self):
        """Test AgentTerminalSession class exists."""
        assert AgentTerminalSession is not None

    def test_initialization(self):
        """Test session initialization."""
        session = AgentTerminalSession(
            workspace_id="ws-123",
            session_id="session-456",
            agent_id="agent-789",
        )

        assert session.workspace_id == "ws-123"
        assert session.session_id == "session-456"
        assert session.agent_id == "agent-789"
        assert session._websocket is None
        assert session._running is False
        assert session._output_buffer == []
        assert session._read_task is None

    def test_is_connected_property_false_initially(self):
        """Test is_connected property returns False initially."""
        session = AgentTerminalSession(
            workspace_id="ws-123",
            session_id="session-456",
            agent_id="agent-789",
        )

        assert session.is_connected is False

    def test_is_connected_property_when_running(self):
        """Test is_connected property when running."""
        session = AgentTerminalSession(
            workspace_id="ws-123",
            session_id="session-456",
            agent_id="agent-789",
        )
        session._running = True
        session._websocket = MagicMock()

        assert session.is_connected is True

    def test_is_connected_property_when_no_websocket(self):
        """Test is_connected property when no websocket."""
        session = AgentTerminalSession(
            workspace_id="ws-123",
            session_id="session-456",
            agent_id="agent-789",
        )
        session._running = True
        session._websocket = None

        assert session.is_connected is False

    async def test_connect_success(self):
        """Test successful connection."""
        session = AgentTerminalSession(
            workspace_id="ws-123",
            session_id="session-456",
            agent_id="agent-789",
        )

        mock_websocket = AsyncMock()
        mock_websocket.__aiter__ = MagicMock(return_value=iter([]))

        with patch("src.tools.terminal_tools.settings") as mock_settings, \
             patch("websockets.connect", new_callable=AsyncMock) as mock_connect:
            mock_settings.COMPUTE_SERVICE_URL = "http://localhost:8080"
            mock_connect.return_value = mock_websocket

            result = await session.connect()

            assert result is True
            assert session._running is True
            assert session._websocket == mock_websocket
            mock_connect.assert_called_once()

        # Cleanup
        await session.close()

    async def test_connect_failure(self):
        """Test connection failure."""
        session = AgentTerminalSession(
            workspace_id="ws-123",
            session_id="session-456",
            agent_id="agent-789",
        )

        with patch("src.tools.terminal_tools.settings") as mock_settings, \
             patch("websockets.connect", new_callable=AsyncMock) as mock_connect:
            mock_settings.COMPUTE_SERVICE_URL = "http://localhost:8080"
            mock_connect.side_effect = Exception("Connection refused")

            result = await session.connect()

            assert result is False
            assert session._running is False

    async def test_execute_command_not_connected(self):
        """Test command execution when not connected."""
        session = AgentTerminalSession(
            workspace_id="ws-123",
            session_id="session-456",
            agent_id="agent-789",
        )

        result = await session.execute_command("ls -la")

        assert result["success"] is False
        assert result["error"] == "Terminal not connected"
        assert result["command"] == "ls -la"

    async def test_execute_command_success(self):
        """Test successful command execution."""
        session = AgentTerminalSession(
            workspace_id="ws-123",
            session_id="session-456",
            agent_id="agent-789",
        )
        session._running = True
        session._websocket = AsyncMock()

        # Mock send to add data to buffer (simulating response)
        async def mock_send(cmd):
            # Simulate response arriving after send
            session._output_buffer.append("file1.py\nfile2.py\n")

        session._websocket.send = mock_send

        with patch("asyncio.sleep", new_callable=AsyncMock):
            with patch("asyncio.get_event_loop") as mock_loop:
                mock_time = MagicMock()
                mock_time.time.side_effect = [0, 0.5, 1.0]
                mock_loop.return_value = mock_time

                result = await session.execute_command("ls -la", timeout=1)

        assert result["success"] is True
        assert result["command"] == "ls -la"
        assert "file1.py" in result["output"]

    async def test_execute_command_without_waiting(self):
        """Test command execution without waiting for output."""
        session = AgentTerminalSession(
            workspace_id="ws-123",
            session_id="session-456",
            agent_id="agent-789",
        )
        session._running = True
        session._websocket = AsyncMock()
        session._websocket.send = AsyncMock()

        result = await session.execute_command("ls -la", wait_for_output=False)

        assert result["success"] is True
        assert result["command"] == "ls -la"
        session._websocket.send.assert_called_once_with("ls -la\n")

    async def test_execute_command_exception(self):
        """Test command execution exception."""
        session = AgentTerminalSession(
            workspace_id="ws-123",
            session_id="session-456",
            agent_id="agent-789",
        )
        session._running = True
        session._websocket = AsyncMock()
        session._websocket.send = AsyncMock(side_effect=Exception("Send failed"))

        result = await session.execute_command("ls -la")

        assert result["success"] is False
        assert "Send failed" in result["error"]

    async def test_read_output_bytes(self):
        """Test reading byte output."""
        session = AgentTerminalSession(
            workspace_id="ws-123",
            session_id="session-456",
            agent_id="agent-789",
        )
        session._running = True

        # Create mock websocket that yields bytes
        async def mock_receive():
            yield b"output line 1"
            yield b"output line 2"
            session._running = False  # Stop after messages

        mock_websocket = MagicMock()
        mock_websocket.__aiter__ = lambda self: mock_receive()
        session._websocket = mock_websocket

        await session._read_output()

        assert "output line 1" in session._output_buffer
        assert "output line 2" in session._output_buffer

    async def test_read_output_string(self):
        """Test reading string output."""
        session = AgentTerminalSession(
            workspace_id="ws-123",
            session_id="session-456",
            agent_id="agent-789",
        )
        session._running = True

        # Create mock websocket that yields strings
        async def mock_receive():
            yield "string output"
            session._running = False

        mock_websocket = MagicMock()
        mock_websocket.__aiter__ = lambda self: mock_receive()
        session._websocket = mock_websocket

        await session._read_output()

        assert "string output" in session._output_buffer

    async def test_read_output_connection_closed(self):
        """Test handling connection closed during read."""
        session = AgentTerminalSession(
            workspace_id="ws-123",
            session_id="session-456",
            agent_id="agent-789",
        )
        session._running = True

        async def mock_receive():
            raise websockets.exceptions.ConnectionClosed(None, None)

        mock_websocket = MagicMock()
        mock_websocket.__aiter__ = lambda self: mock_receive()
        session._websocket = mock_websocket

        await session._read_output()

        assert session._running is False

    async def test_read_output_no_websocket(self):
        """Test read output returns early when no websocket."""
        session = AgentTerminalSession(
            workspace_id="ws-123",
            session_id="session-456",
            agent_id="agent-789",
        )
        session._websocket = None

        await session._read_output()

        assert session._output_buffer == []

    async def test_close_session(self):
        """Test closing session."""
        session = AgentTerminalSession(
            workspace_id="ws-123",
            session_id="session-456",
            agent_id="agent-789",
        )
        session._running = True
        session._websocket = AsyncMock()
        session._websocket.close = AsyncMock()

        # Create an actual asyncio task to cancel
        async def dummy_task():
            try:
                await asyncio.sleep(100)
            except asyncio.CancelledError:
                pass

        session._read_task = asyncio.create_task(dummy_task())

        await session.close()

        assert session._running is False
        assert session._read_task.cancelled() or session._read_task.done()

    async def test_close_session_no_read_task(self):
        """Test closing session without read task."""
        session = AgentTerminalSession(
            workspace_id="ws-123",
            session_id="session-456",
            agent_id="agent-789",
        )
        session._running = True
        session._websocket = AsyncMock()
        session._websocket.close = AsyncMock()
        session._read_task = None

        await session.close()

        assert session._running is False

    async def test_close_session_no_websocket(self):
        """Test closing session without websocket."""
        session = AgentTerminalSession(
            workspace_id="ws-123",
            session_id="session-456",
            agent_id="agent-789",
        )
        session._running = True
        session._websocket = None
        session._read_task = None

        await session.close()

        assert session._running is False


class TestRunTerminalCommand:
    """Test run_terminal_command function."""

    def test_run_terminal_command_exists(self):
        """Test function exists."""
        assert run_terminal_command is not None
        assert callable(run_terminal_command)

    async def test_run_command_connection_failure(self):
        """Test command when connection fails."""
        with patch.object(AgentTerminalSession, "connect", new_callable=AsyncMock) as mock_connect, \
             patch.object(AgentTerminalSession, "close", new_callable=AsyncMock):
            mock_connect.return_value = False

            result = await run_terminal_command(
                workspace_id="ws-123",
                session_id="session-456",
                agent_id="agent-789",
                command="ls -la",
            )

            assert result["success"] is False
            assert "Failed to connect" in result["error"]

    async def test_run_command_success(self):
        """Test successful command execution."""
        with patch.object(AgentTerminalSession, "connect", new_callable=AsyncMock) as mock_connect, \
             patch.object(AgentTerminalSession, "execute_command", new_callable=AsyncMock) as mock_exec, \
             patch.object(AgentTerminalSession, "close", new_callable=AsyncMock):
            mock_connect.return_value = True
            mock_exec.return_value = {
                "success": True,
                "output": "file1.py\nfile2.py",
                "command": "ls -la",
            }

            result = await run_terminal_command(
                workspace_id="ws-123",
                session_id="session-456",
                agent_id="agent-789",
                command="ls -la",
                timeout=30,
            )

            assert result["success"] is True
            assert "file1.py" in result["output"]
            mock_exec.assert_called_once_with("ls -la", 30)

    async def test_run_command_always_closes(self):
        """Test that session is always closed even on error."""
        with patch.object(AgentTerminalSession, "connect", new_callable=AsyncMock) as mock_connect, \
             patch.object(AgentTerminalSession, "execute_command", new_callable=AsyncMock) as mock_exec, \
             patch.object(AgentTerminalSession, "close", new_callable=AsyncMock) as mock_close:
            mock_connect.return_value = True
            mock_exec.side_effect = Exception("Command failed")

            try:
                await run_terminal_command(
                    workspace_id="ws-123",
                    session_id="session-456",
                    agent_id="agent-789",
                    command="ls -la",
                )
            except Exception:
                pass

            mock_close.assert_called_once()
