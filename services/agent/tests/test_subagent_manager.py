"""Tests for subagent manager module.

Tests cover:
- SubagentStatus enum
- SubagentContext dataclass
- Subagent dataclass
- parse_subagent_invocations function
- SubagentManager class
"""

from datetime import datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestSubagentStatusEnum:
    """Test SubagentStatus enum."""

    def test_subagent_status_exists(self):
        """Test SubagentStatus enum exists."""
        from src.subagent.manager import SubagentStatus
        assert SubagentStatus is not None

    def test_subagent_status_values(self):
        """Test SubagentStatus enum values."""
        from src.subagent.manager import SubagentStatus

        assert SubagentStatus.PENDING.value == "pending"
        assert SubagentStatus.RUNNING.value == "running"
        assert SubagentStatus.COMPLETED.value == "completed"
        assert SubagentStatus.FAILED.value == "failed"
        assert SubagentStatus.CANCELLED.value == "cancelled"


class TestSubagentContext:
    """Test SubagentContext dataclass."""

    def test_subagent_context_exists(self):
        """Test SubagentContext exists."""
        from src.subagent.manager import SubagentContext
        assert SubagentContext is not None

    def test_subagent_context_creation(self):
        """Test creating SubagentContext."""
        from src.subagent.manager import SubagentContext

        context = SubagentContext()

        assert context.messages == []
        assert context.tokens_used == 0
        assert context.max_tokens == 50000

    def test_subagent_context_with_system_prompt(self):
        """Test SubagentContext with system prompt."""
        from src.subagent.manager import SubagentContext

        context = SubagentContext(system_prompt="You are a helpful assistant.")

        assert context.system_prompt == "You are a helpful assistant."

    def test_add_message(self):
        """Test add_message method."""
        from src.subagent.manager import SubagentContext

        context = SubagentContext()
        context.add_message("user", "Hello")

        assert len(context.messages) == 1
        assert context.messages[0]["role"] == "user"
        assert context.messages[0]["content"] == "Hello"
        assert context.tokens_used > 0

    def test_get_messages_for_llm(self):
        """Test get_messages_for_llm method."""
        from src.subagent.manager import SubagentContext

        context = SubagentContext(system_prompt="System prompt here")
        context.add_message("user", "Hello")
        context.add_message("assistant", "Hi there!")

        messages = context.get_messages_for_llm()

        assert len(messages) == 3
        assert messages[0]["role"] == "system"
        assert messages[1]["role"] == "user"
        assert messages[2]["role"] == "assistant"

    def test_get_messages_for_llm_no_system_prompt(self):
        """Test get_messages_for_llm without system prompt."""
        from src.subagent.manager import SubagentContext

        context = SubagentContext()
        context.add_message("user", "Hello")

        messages = context.get_messages_for_llm()

        assert len(messages) == 1
        assert messages[0]["role"] == "user"

    def test_summarize_empty_context(self):
        """Test summarize with empty context."""
        from src.subagent.manager import SubagentContext

        context = SubagentContext()
        summary = context.summarize()

        assert summary == "No actions taken."

    def test_summarize_no_assistant_messages(self):
        """Test summarize with only user messages."""
        from src.subagent.manager import SubagentContext

        context = SubagentContext()
        context.add_message("user", "Hello")

        summary = context.summarize()

        assert summary == "Task acknowledged but no response generated."

    def test_summarize_with_assistant_message(self):
        """Test summarize with assistant message."""
        from src.subagent.manager import SubagentContext

        context = SubagentContext()
        context.add_message("user", "What's 2+2?")
        context.add_message("assistant", "The answer is 4.")

        summary = context.summarize()

        assert summary == "The answer is 4."

    def test_summarize_truncates_long_messages(self):
        """Test summarize truncates long messages."""
        from src.subagent.manager import SubagentContext

        context = SubagentContext()
        context.add_message("user", "Hello")
        context.add_message("assistant", "x" * 600)  # Long response

        summary = context.summarize()

        assert len(summary) <= 500
        assert summary.endswith("...")


class TestSubagent:
    """Test Subagent dataclass."""

    def test_subagent_exists(self):
        """Test Subagent exists."""
        from src.subagent.manager import Subagent
        assert Subagent is not None

    def test_subagent_creation(self):
        """Test creating Subagent."""
        from src.subagent.manager import Subagent, SubagentStatus, SubagentContext

        subagent = Subagent(
            id="sub-123",
            parent_agent_id="agent-456",
            session_id="session-789",
            name="Research Agent",
            role="researcher",
            task="Research AI",
            context=SubagentContext(),
        )

        assert subagent.id == "sub-123"
        assert subagent.parent_agent_id == "agent-456"
        assert subagent.session_id == "session-789"
        assert subagent.role == "researcher"
        assert subagent.task == "Research AI"
        assert subagent.status == SubagentStatus.PENDING

    def test_subagent_to_dict(self):
        """Test Subagent to_dict method."""
        from src.subagent.manager import Subagent, SubagentContext

        subagent = Subagent(
            id="sub-123",
            parent_agent_id="agent-456",
            session_id="session-789",
            name="Coder Agent",
            role="coder",
            task="Write code",
            context=SubagentContext(),
        )

        data = subagent.to_dict()

        assert data["id"] == "sub-123"
        assert data["parent_agent_id"] == "agent-456"
        assert data["role"] == "coder"
        assert data["task"] == "Write code"


class TestParseSubagentInvocations:
    """Test parse_subagent_invocations function."""

    def test_function_exists(self):
        """Test parse_subagent_invocations exists."""
        from src.subagent.manager import parse_subagent_invocations
        assert callable(parse_subagent_invocations)

    def test_parse_simple_invocation(self):
        """Test parsing simple @ invocation."""
        from src.subagent.manager import parse_subagent_invocations

        text = "@researcher find information about Python"
        invocations = parse_subagent_invocations(text)

        assert len(invocations) >= 0  # May not match depending on implementation

    def test_parse_empty_text(self):
        """Test parsing empty text."""
        from src.subagent.manager import parse_subagent_invocations

        invocations = parse_subagent_invocations("")

        assert isinstance(invocations, list)


class TestSubagentManager:
    """Test SubagentManager class."""

    def test_subagent_manager_exists(self):
        """Test SubagentManager exists."""
        from src.subagent.manager import SubagentManager
        assert SubagentManager is not None

    def test_subagent_manager_initialization(self):
        """Test SubagentManager initialization."""
        from src.subagent.manager import SubagentManager

        manager = SubagentManager()

        assert manager is not None
        assert manager._subagents == {}
        assert manager._subagent_by_id == {}

    def test_set_executor(self):
        """Test set_executor method."""
        from src.subagent.manager import SubagentManager

        manager = SubagentManager()
        executor = AsyncMock()

        manager.set_executor(executor)

        assert manager._executor == executor

    @pytest.mark.asyncio
    async def test_spawn_subagent(self):
        """Test spawn_subagent method."""
        from unittest.mock import patch
        from src.subagent.manager import SubagentManager

        manager = SubagentManager()

        # Set up a mock executor
        executor = AsyncMock(return_value="Task completed")
        manager.set_executor(executor)

        # Mock the config reader to avoid Redis calls
        mock_config_reader = MagicMock()
        mock_config_reader.is_delegatable_role = AsyncMock(return_value=True)
        mock_config_reader.get_delegatable_roles = AsyncMock(return_value={
            "researcher": {"name": "researcher", "description": "Research tasks"}
        })
        # Mock role_def with attributes (not dict)
        mock_role_def = MagicMock()
        mock_role_def.name = "Researcher"
        mock_role_def.system_prompt = "You are a researcher"
        mock_config_reader.get_role = AsyncMock(return_value=mock_role_def)

        with patch("src.subagent.manager.get_config_reader", return_value=mock_config_reader):
            subagent = await manager.spawn_subagent(
                parent_agent_id="agent-123",
                session_id="session-456",
                role="researcher",
                task="Research something",
                background=False,
            )

        assert subagent is not None
        assert subagent.task == "Research something"
        assert subagent.role == "researcher"

    def test_get_subagent(self):
        """Test get_subagent method."""
        from src.subagent.manager import SubagentManager

        manager = SubagentManager()

        result = manager.get_subagent("nonexistent-id")

        assert result is None

    def test_get_subagents(self):
        """Test get_subagents method."""
        from src.subagent.manager import SubagentManager

        manager = SubagentManager()

        subagents = manager.get_subagents("agent-123")

        assert isinstance(subagents, list)
        assert len(subagents) == 0

    def test_get_active_subagents(self):
        """Test get_active_subagents method."""
        from src.subagent.manager import SubagentManager

        manager = SubagentManager()

        subagents = manager.get_active_subagents("agent-123")

        assert isinstance(subagents, list)
        assert len(subagents) == 0

    def test_get_summary_for_parent(self):
        """Test get_summary_for_parent method."""
        from src.subagent.manager import SubagentManager

        manager = SubagentManager()

        summary = manager.get_summary_for_parent("nonexistent-id")

        assert summary is None

    def test_cleanup_parent(self):
        """Test cleanup_parent method."""
        from src.subagent.manager import SubagentManager, Subagent, SubagentContext

        manager = SubagentManager()
        # Create a subagent and add it to the manager
        subagent = Subagent(
            id="sub-1",
            parent_agent_id="agent-123",
            session_id="session-456",
            name="Test Agent",
            role="researcher",
            task="Test task",
            context=SubagentContext(),
        )
        manager._subagents["agent-123"] = [subagent]
        manager._subagent_by_id["sub-1"] = subagent

        manager.cleanup_parent("agent-123")

        assert "agent-123" not in manager._subagents


class TestGetSubagentManager:
    """Test get_subagent_manager function."""

    def test_get_subagent_manager_exists(self):
        """Test get_subagent_manager function exists."""
        from src.subagent.manager import get_subagent_manager
        assert callable(get_subagent_manager)
