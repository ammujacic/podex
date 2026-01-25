"""Tests for executor modules.

Tests cover:
- Claude Code Executor (dataclasses and basic functionality)
- Gemini CLI Executor
- OpenAI Codex Executor
"""

import pytest
from datetime import datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch


class TestToolCallDataclass:
    """Test ToolCall dataclass from Claude Code executor."""

    def test_tool_call_creation(self):
        """Test ToolCall creation."""
        from src.executors.claude_code_executor import ToolCall

        tc = ToolCall(
            id="call-123",
            name="read_file",
            status="pending",
        )

        assert tc.id == "call-123"
        assert tc.name == "read_file"
        assert tc.status == "pending"
        assert tc.args is None
        assert tc.result is None

    def test_tool_call_with_args_and_result(self):
        """Test ToolCall with args and result."""
        from src.executors.claude_code_executor import ToolCall

        tc = ToolCall(
            id="call-123",
            name="read_file",
            status="completed",
            args={"path": "/tmp/test.txt"},
            result="File content here",
        )

        assert tc.args == {"path": "/tmp/test.txt"}
        assert tc.result == "File content here"

    def test_tool_call_status_values(self):
        """Test various ToolCall status values."""
        from src.executors.claude_code_executor import ToolCall

        statuses = ["pending", "running", "completed", "error"]
        for status in statuses:
            tc = ToolCall(id="id", name="name", status=status)
            assert tc.status == status


class TestAgentMessageDataclass:
    """Test AgentMessage dataclass from Claude Code executor."""

    def test_agent_message_defaults(self):
        """Test AgentMessage with defaults."""
        from src.executors.claude_code_executor import AgentMessage

        msg = AgentMessage(role="assistant")

        assert msg.role == "assistant"
        assert msg.content == ""
        assert msg.thinking is None
        assert msg.tool_calls == []
        assert msg.timestamp is not None

    def test_agent_message_full(self):
        """Test AgentMessage with all fields."""
        from src.executors.claude_code_executor import AgentMessage, ToolCall

        tc = ToolCall(id="call-1", name="read_file", status="completed")
        msg = AgentMessage(
            role="assistant",
            content="I'll read that file.",
            thinking="Let me think...",
            tool_calls=[tc],
        )

        assert msg.content == "I'll read that file."
        assert msg.thinking == "Let me think..."
        assert len(msg.tool_calls) == 1

    def test_agent_message_to_dict(self):
        """Test AgentMessage to_dict method."""
        from src.executors.claude_code_executor import AgentMessage, ToolCall

        tc = ToolCall(
            id="call-1",
            name="read_file",
            status="completed",
            args={"path": "test.py"},
            result="content",
        )
        msg = AgentMessage(
            role="assistant",
            content="Done",
            thinking="Thinking",
            tool_calls=[tc],
        )

        result = msg.to_dict()

        assert result["role"] == "assistant"
        assert result["content"] == "Done"
        assert result["thinking"] == "Thinking"
        assert len(result["tool_calls"]) == 1
        assert result["tool_calls"][0]["id"] == "call-1"
        assert result["tool_calls"][0]["name"] == "read_file"
        assert "timestamp" in result


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

    def test_claude_code_event_various_types(self):
        """Test various event types."""
        from src.executors.claude_code_executor import ClaudeCodeEvent

        event_types = [
            ("text", {"text": "output"}),
            ("tool_use", {"name": "read_file", "id": "123"}),
            ("tool_result", {"content": "result"}),
            ("thinking", {"content": "thinking..."}),
        ]

        for event_type, content in event_types:
            event = ClaudeCodeEvent(type=event_type, content=content)
            assert event.type == event_type
            assert event.content == content


class TestClaudeCodeExecutor:
    """Test ClaudeCodeExecutor class."""

    def test_executor_module_exists(self):
        """Test executor module can be imported."""
        from src.executors import claude_code_executor
        assert claude_code_executor is not None

    def test_executor_class_exists(self):
        """Test ClaudeCodeExecutor class exists."""
        from src.executors.claude_code_executor import ClaudeCodeExecutor
        assert ClaudeCodeExecutor is not None


class TestGeminiCliExecutor:
    """Test Gemini CLI Executor."""

    def test_gemini_module_exists(self):
        """Test gemini_cli_executor module can be imported."""
        from src.executors import gemini_cli_executor
        assert gemini_cli_executor is not None

    def test_gemini_executor_class_exists(self):
        """Test GeminiCliExecutor class exists."""
        from src.executors.gemini_cli_executor import GeminiCliExecutor
        assert GeminiCliExecutor is not None

    def test_gemini_tool_call_dataclass(self):
        """Test ToolCall dataclass from Gemini executor."""
        from src.executors.gemini_cli_executor import ToolCall

        tc = ToolCall(
            id="call-123",
            name="shell",
            status="pending",
        )

        assert tc.id == "call-123"
        assert tc.name == "shell"
        assert tc.status == "pending"

    def test_gemini_agent_message_dataclass(self):
        """Test AgentMessage dataclass from Gemini executor."""
        from src.executors.gemini_cli_executor import AgentMessage

        msg = AgentMessage(role="assistant")

        assert msg.role == "assistant"
        assert msg.content == ""
        assert msg.tool_calls == []

    def test_gemini_agent_message_to_dict(self):
        """Test AgentMessage to_dict method from Gemini executor."""
        from src.executors.gemini_cli_executor import AgentMessage, ToolCall

        tc = ToolCall(
            id="call-1",
            name="shell",
            status="completed",
            args={"command": "ls"},
            result="file.txt",
        )
        msg = AgentMessage(
            role="assistant",
            content="Listed files",
            tool_calls=[tc],
        )

        result = msg.to_dict()

        assert result["role"] == "assistant"
        assert result["content"] == "Listed files"
        assert len(result["tool_calls"]) == 1

    def test_gemini_event_dataclass(self):
        """Test GeminiEvent dataclass."""
        from src.executors.gemini_cli_executor import GeminiEvent

        event = GeminiEvent(type="text", content={"text": "hello"})
        assert event.type == "text"


class TestOpenAICodexExecutor:
    """Test OpenAI Codex Executor."""

    def test_codex_module_exists(self):
        """Test openai_codex_executor module can be imported."""
        from src.executors import openai_codex_executor
        assert openai_codex_executor is not None

    def test_codex_executor_class_exists(self):
        """Test OpenAICodexExecutor class exists."""
        from src.executors.openai_codex_executor import OpenAICodexExecutor
        assert OpenAICodexExecutor is not None

    def test_codex_tool_call_dataclass(self):
        """Test ToolCall dataclass from Codex executor."""
        from src.executors.openai_codex_executor import ToolCall

        tc = ToolCall(
            id="call-123",
            name="python",
            status="running",
        )

        assert tc.id == "call-123"
        assert tc.name == "python"
        assert tc.status == "running"

    def test_codex_agent_message_dataclass(self):
        """Test AgentMessage dataclass from Codex executor."""
        from src.executors.openai_codex_executor import AgentMessage

        msg = AgentMessage(role="assistant")

        assert msg.role == "assistant"
        assert msg.content == ""

    def test_codex_agent_message_to_dict(self):
        """Test AgentMessage to_dict method from Codex executor."""
        from src.executors.openai_codex_executor import AgentMessage, ToolCall

        tc = ToolCall(
            id="call-1",
            name="python",
            status="completed",
            args={"code": "print('hi')"},
            result="hi",
        )
        msg = AgentMessage(
            role="assistant",
            content="Executed code",
            tool_calls=[tc],
        )

        result = msg.to_dict()

        assert result["role"] == "assistant"
        assert len(result["tool_calls"]) == 1

    def test_codex_event_dataclass(self):
        """Test CodexEvent dataclass."""
        from src.executors.openai_codex_executor import CodexEvent

        event = CodexEvent(type="text", content={"text": "hello"})
        assert event.type == "text"


class TestExecutorModuleInit:
    """Test executors __init__ module."""

    def test_executors_init_imports(self):
        """Test executors module can be imported."""
        from src import executors
        assert executors is not None
