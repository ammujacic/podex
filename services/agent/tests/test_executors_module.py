"""Tests for executors module.

Tests cover:
- Claude Code executor
- Gemini CLI executor
- OpenAI Codex executor
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestExecutorsModuleImports:
    """Test executors modules can be imported."""

    def test_claude_code_executor_module_exists(self):
        """Test Claude Code executor module can be imported."""
        from src.executors import claude_code_executor
        assert claude_code_executor is not None

    def test_gemini_cli_executor_module_exists(self):
        """Test Gemini CLI executor module can be imported."""
        from src.executors import gemini_cli_executor
        assert gemini_cli_executor is not None

    def test_openai_codex_executor_module_exists(self):
        """Test OpenAI Codex executor module can be imported."""
        from src.executors import openai_codex_executor
        assert openai_codex_executor is not None


class TestClaudeCodeExecutor:
    """Test ClaudeCodeExecutor class."""

    def test_claude_code_executor_class_exists(self):
        """Test ClaudeCodeExecutor class exists."""
        from src.executors.claude_code_executor import ClaudeCodeExecutor
        assert ClaudeCodeExecutor is not None

    def test_tool_call_dataclass_exists(self):
        """Test ToolCall dataclass exists in claude executor."""
        from src.executors.claude_code_executor import ToolCall
        assert ToolCall is not None


class TestGeminiCliExecutor:
    """Test GeminiCliExecutor class."""

    def test_gemini_cli_executor_class_exists(self):
        """Test GeminiCliExecutor class exists."""
        from src.executors.gemini_cli_executor import GeminiCliExecutor
        assert GeminiCliExecutor is not None

    def test_gemini_tool_call_dataclass_exists(self):
        """Test ToolCall dataclass exists in gemini executor."""
        from src.executors.gemini_cli_executor import ToolCall
        assert ToolCall is not None


class TestOpenAICodexExecutor:
    """Test OpenAICodexExecutor class."""

    def test_openai_codex_executor_class_exists(self):
        """Test OpenAICodexExecutor class exists."""
        from src.executors.openai_codex_executor import OpenAICodexExecutor
        assert OpenAICodexExecutor is not None

    def test_openai_tool_call_dataclass_exists(self):
        """Test ToolCall dataclass exists in openai executor."""
        from src.executors.openai_codex_executor import ToolCall
        assert ToolCall is not None


class TestToolCallDataclass:
    """Test ToolCall dataclass from claude_code_executor."""

    def test_tool_call_creation(self):
        """Test ToolCall creation."""
        from src.executors.claude_code_executor import ToolCall

        tc = ToolCall(
            id="tool-123",
            name="read_file",
            status="pending",
            args={"path": "test.py"},
            result=None,
        )
        assert tc.id == "tool-123"
        assert tc.name == "read_file"
        assert tc.status == "pending"
        assert tc.args == {"path": "test.py"}
        assert tc.result is None

    def test_tool_call_defaults(self):
        """Test ToolCall default values."""
        from src.executors.claude_code_executor import ToolCall

        tc = ToolCall(
            id="tool-1",
            name="tool_name",
            status="running",
        )
        assert tc.args is None
        assert tc.result is None


class TestAgentMessageDataclass:
    """Test AgentMessage dataclass from claude_code_executor."""

    def test_agent_message_creation(self):
        """Test AgentMessage creation."""
        from src.executors.claude_code_executor import AgentMessage

        msg = AgentMessage(
            role="assistant",
            content="Hello!",
            thinking="I need to help the user...",
        )
        assert msg.role == "assistant"
        assert msg.content == "Hello!"
        assert msg.thinking == "I need to help the user..."
        assert msg.tool_calls == []

    def test_agent_message_to_dict(self):
        """Test AgentMessage to_dict method."""
        from src.executors.claude_code_executor import AgentMessage, ToolCall

        tc = ToolCall(
            id="tc-1",
            name="read_file",
            status="completed",
            args={"path": "test.py"},
            result="file content",
        )
        msg = AgentMessage(
            role="assistant",
            content="Done",
            tool_calls=[tc],
        )

        d = msg.to_dict()
        assert d["role"] == "assistant"
        assert d["content"] == "Done"
        assert len(d["tool_calls"]) == 1
        assert d["tool_calls"][0]["id"] == "tc-1"
        assert d["tool_calls"][0]["result"] == "file content"
        assert "timestamp" in d


class TestClaudeCodeEventDataclass:
    """Test ClaudeCodeEvent dataclass."""

    def test_claude_code_event_creation(self):
        """Test ClaudeCodeEvent creation."""
        from src.executors.claude_code_executor import ClaudeCodeEvent

        event = ClaudeCodeEvent(
            type="text",
            content={"text": "Hello"},
        )
        assert event.type == "text"
        assert event.content == {"text": "Hello"}
        assert event.tool_name is None
        assert event.is_error is False

    def test_claude_code_event_tool(self):
        """Test ClaudeCodeEvent for tool use."""
        from src.executors.claude_code_executor import ClaudeCodeEvent

        event = ClaudeCodeEvent(
            type="tool_use",
            content={"name": "read_file"},
            tool_name="read_file",
            tool_id="tool-123",
            tool_input={"path": "test.py"},
        )
        assert event.tool_name == "read_file"
        assert event.tool_id == "tool-123"
        assert event.tool_input == {"path": "test.py"}

    def test_claude_code_event_error(self):
        """Test ClaudeCodeEvent for error."""
        from src.executors.claude_code_executor import ClaudeCodeEvent

        event = ClaudeCodeEvent(
            type="error",
            content={"error": "Something went wrong"},
            is_error=True,
            error_message="Something went wrong",
        )
        assert event.is_error is True
        assert event.error_message == "Something went wrong"


class TestParseStreamJsonLine:
    """Test parse_stream_json_line function."""

    def test_parse_thinking_event(self):
        """Test parsing thinking event."""
        from src.executors.claude_code_executor import parse_stream_json_line

        line = '{"type": "thinking", "thinking": "I need to..."}'
        event = parse_stream_json_line(line)
        assert event.type == "thinking"
        assert event.content["text"] == "I need to..."

    def test_parse_text_event(self):
        """Test parsing text event."""
        from src.executors.claude_code_executor import parse_stream_json_line

        line = '{"type": "text", "text": "Hello world"}'
        event = parse_stream_json_line(line)
        assert event.type == "text"
        assert event.content["text"] == "Hello world"

    def test_parse_tool_use_event(self):
        """Test parsing tool_use event."""
        from src.executors.claude_code_executor import parse_stream_json_line

        line = '{"type": "tool_use", "id": "tool-1", "name": "read_file", "input": {"path": "test.py"}}'
        event = parse_stream_json_line(line)
        assert event.type == "tool_use"
        assert event.tool_name == "read_file"
        assert event.tool_id == "tool-1"
        assert event.tool_input == {"path": "test.py"}

    def test_parse_tool_result_event(self):
        """Test parsing tool_result event."""
        from src.executors.claude_code_executor import parse_stream_json_line

        line = '{"type": "tool_result", "tool_use_id": "tool-1", "content": "file contents", "is_error": false}'
        event = parse_stream_json_line(line)
        assert event.type == "tool_result"
        assert event.tool_id == "tool-1"
        assert event.is_error is False

    def test_parse_error_event(self):
        """Test parsing error event."""
        from src.executors.claude_code_executor import parse_stream_json_line

        line = '{"type": "error", "error": {"message": "Rate limit exceeded"}}'
        event = parse_stream_json_line(line)
        assert event.type == "error"
        assert event.is_error is True
        assert event.error_message == "Rate limit exceeded"

    def test_parse_message_start_event(self):
        """Test parsing message_start event."""
        from src.executors.claude_code_executor import parse_stream_json_line

        line = '{"type": "message_start", "data": {}}'
        event = parse_stream_json_line(line)
        assert event.type == "message_start"

    def test_parse_config_event(self):
        """Test parsing config/system event."""
        from src.executors.claude_code_executor import parse_stream_json_line

        line = '{"type": "config", "model": "sonnet"}'
        event = parse_stream_json_line(line)
        assert event.type == "config_change"

    def test_parse_unknown_event(self):
        """Test parsing unknown event type."""
        from src.executors.claude_code_executor import parse_stream_json_line

        line = '{"type": "custom_event", "data": "test"}'
        event = parse_stream_json_line(line)
        assert event.type == "custom_event"


class TestClaudeCodeExecutorMethods:
    """Test ClaudeCodeExecutor class methods."""

    @pytest.fixture
    def executor(self, tmp_path):
        """Create executor instance."""
        from src.executors.claude_code_executor import ClaudeCodeExecutor
        return ClaudeCodeExecutor(workspace_path=str(tmp_path))

    def test_executor_initialization(self, executor, tmp_path):
        """Test executor initialization."""
        assert executor.workspace_path == str(tmp_path)
        assert executor.dotfiles is None
        assert executor._process is None

    def test_build_command_basic(self, executor):
        """Test _build_command with basic params."""
        cmd = executor._build_command(
            message="Hello",
            mode="ask",
            model="sonnet",
            allowed_tools=None,
            denied_tools=None,
            max_turns=50,
            thinking_budget=None,
        )
        assert "claude" in cmd
        assert "-p" in cmd
        # Check message is in command (may be quoted differently)
        assert "Hello" in cmd
        assert "--output-format" in cmd
        assert "stream-json" in cmd
        assert "--max-turns" in cmd
        assert "50" in cmd
        assert "--model" in cmd
        assert "sonnet" in cmd

    def test_build_command_plan_mode(self, executor):
        """Test _build_command with plan mode."""
        cmd = executor._build_command(
            message="Test",
            mode="plan",
            model="sonnet",
            allowed_tools=None,
            denied_tools=None,
            max_turns=10,
            thinking_budget=None,
        )
        assert "--plan" in cmd

    def test_build_command_with_allowed_tools(self, executor):
        """Test _build_command with allowed tools."""
        cmd = executor._build_command(
            message="Test",
            mode="ask",
            model="sonnet",
            allowed_tools=["read_file", "write_file"],
            denied_tools=None,
            max_turns=10,
            thinking_budget=None,
        )
        assert "--allowedTools" in cmd
        assert "read_file,write_file" in cmd

    def test_build_command_with_denied_tools(self, executor):
        """Test _build_command with denied tools."""
        cmd = executor._build_command(
            message="Test",
            mode="ask",
            model="sonnet",
            allowed_tools=None,
            denied_tools=["delete_file"],
            max_turns=10,
            thinking_budget=None,
        )
        assert "--disallowedTools" in cmd
        assert "delete_file" in cmd

    def test_build_command_with_thinking_budget(self, executor):
        """Test _build_command with thinking budget."""
        cmd = executor._build_command(
            message="Test",
            mode="ask",
            model="sonnet",
            allowed_tools=None,
            denied_tools=None,
            max_turns=10,
            thinking_budget=5000,
        )
        assert "--thinking-budget" in cmd
        assert "5000" in cmd

    async def test_check_installed_success(self, executor):
        """Test check_installed when claude is installed."""
        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_proc = MagicMock()
            mock_proc.returncode = 0
            mock_proc.wait = AsyncMock()
            mock_exec.return_value = mock_proc

            result = await executor.check_installed()
            assert result is True

    async def test_check_installed_not_found(self, executor):
        """Test check_installed when claude is not installed."""
        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_proc = MagicMock()
            mock_proc.returncode = 1
            mock_proc.wait = AsyncMock()
            mock_exec.return_value = mock_proc

            result = await executor.check_installed()
            assert result is False

    async def test_check_installed_error(self, executor):
        """Test check_installed on error."""
        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_exec.side_effect = Exception("Command not found")

            result = await executor.check_installed()
            assert result is False

    async def test_install_success(self, executor):
        """Test install succeeds."""
        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_proc = MagicMock()
            mock_proc.returncode = 0
            mock_proc.wait = AsyncMock()
            mock_exec.return_value = mock_proc

            result = await executor.install()
            assert result is True

    async def test_install_failure(self, executor):
        """Test install fails."""
        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_proc = MagicMock()
            mock_proc.returncode = 1
            mock_proc.wait = AsyncMock()
            mock_exec.return_value = mock_proc

            result = await executor.install()
            assert result is False

    async def test_check_auth_authenticated(self, executor, tmp_path):
        """Test check_auth when authenticated."""
        # Create credentials file
        claude_dir = tmp_path / ".claude"
        claude_dir.mkdir()
        (claude_dir / "credentials.json").write_text("{}")

        result = await executor.check_auth()
        assert result["authenticated"] is True
        assert result["needs_auth"] is False

    async def test_check_auth_not_authenticated(self, executor):
        """Test check_auth when not authenticated."""
        result = await executor.check_auth()
        # Without credentials file, should not be authenticated
        assert result["authenticated"] is False
        assert result["needs_auth"] is True

    async def test_stop_no_process(self, executor):
        """Test stop when no process is running."""
        result = await executor.stop()
        assert result is False

    async def test_stop_process_running(self, executor):
        """Test stop when process is running."""
        mock_proc = MagicMock()
        mock_proc.returncode = None
        mock_proc.terminate = MagicMock()
        mock_proc.wait = AsyncMock()
        executor._process = mock_proc

        with patch("asyncio.wait_for", new_callable=AsyncMock):
            result = await executor.stop()
            assert result is True
            mock_proc.terminate.assert_called_once()


class TestGeminiCliExecutorMethods:
    """Test GeminiCliExecutor class methods."""

    def test_tool_call_creation(self):
        """Test Gemini ToolCall creation."""
        from src.executors.gemini_cli_executor import ToolCall

        tc = ToolCall(
            id="tool-1",
            name="test_tool",
            status="pending",
        )
        assert tc.id == "tool-1"
        assert tc.name == "test_tool"

    def test_agent_message_creation(self):
        """Test Gemini AgentMessage creation."""
        from src.executors.gemini_cli_executor import AgentMessage

        msg = AgentMessage(
            role="assistant",
            content="Response",
        )
        assert msg.role == "assistant"
        assert msg.content == "Response"

    def test_executor_initialization(self, tmp_path):
        """Test GeminiCliExecutor initialization."""
        from src.executors.gemini_cli_executor import GeminiCliExecutor

        executor = GeminiCliExecutor(workspace_path=str(tmp_path))
        assert executor.workspace_path == str(tmp_path)


class TestOpenAICodexExecutorMethods:
    """Test OpenAICodexExecutor class methods."""

    def test_tool_call_creation(self):
        """Test OpenAI ToolCall creation."""
        from src.executors.openai_codex_executor import ToolCall

        tc = ToolCall(
            id="tool-1",
            name="code_execute",
            status="running",
        )
        assert tc.id == "tool-1"
        assert tc.name == "code_execute"

    def test_agent_message_creation(self):
        """Test OpenAI AgentMessage creation."""
        from src.executors.openai_codex_executor import AgentMessage

        msg = AgentMessage(
            role="assistant",
            content="Code output",
        )
        assert msg.role == "assistant"

    def test_executor_initialization(self, tmp_path):
        """Test OpenAICodexExecutor initialization."""
        from src.executors.openai_codex_executor import OpenAICodexExecutor

        executor = OpenAICodexExecutor(workspace_path=str(tmp_path))
        assert executor.workspace_path == str(tmp_path)
