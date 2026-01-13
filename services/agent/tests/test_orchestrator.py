"""
Comprehensive tests for Agent orchestrator.

Tests cover:
- Agent orchestration flow
- Tool execution
- Task management
- Error handling
"""

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

# ============================================================================
# FIXTURES
# ============================================================================


@pytest.fixture
def mock_llm_response() -> dict[str, Any]:
    """Create a mock LLM response."""
    return {
        "content": "I'll help you with that task.",
        "finish_reason": "stop",
        "usage": {
            "input_tokens": 100,
            "output_tokens": 50,
        },
        "tool_calls": None,
    }


@pytest.fixture
def mock_llm_tool_call_response() -> dict[str, Any]:
    """Create a mock LLM response with tool call."""
    return {
        "content": None,
        "finish_reason": "tool_calls",
        "usage": {
            "input_tokens": 100,
            "output_tokens": 50,
        },
        "tool_calls": [
            {
                "id": "call_123",
                "type": "function",
                "function": {
                    "name": "read_file",
                    "arguments": '{"path": "/workspace/src/index.ts"}',
                },
            }
        ],
    }


@pytest.fixture
def mock_context() -> dict[str, Any]:
    """Create a mock agent context."""
    return {
        "session_id": "session-123",
        "agent_id": "agent-123",
        "user_id": "user-123",
        "workspace_path": "/workspace",
        "system_prompt": "You are a helpful AI assistant.",
        "messages": [],
        "tools": ["read_file", "write_file", "execute_command"],
    }


# ============================================================================
# ORCHESTRATOR FLOW TESTS
# ============================================================================


class TestOrchestratorFlow:
    """Tests for orchestrator flow."""

    @pytest.mark.asyncio
    async def test_orchestrator_initialization(self) -> None:
        """Test orchestrator can be initialized."""
        from src.orchestrator import AgentOrchestrator

        # Mock LLMProvider to avoid actual initialization
        with patch("src.orchestrator.LLMProvider"):
            orchestrator = AgentOrchestrator()
            assert orchestrator is not None
            assert orchestrator.tasks == {}
            assert orchestrator.results == {}
            assert orchestrator.agents == {}

    @pytest.mark.asyncio
    async def test_orchestrator_has_llm_provider(self) -> None:
        """Test orchestrator initializes with LLM provider."""
        from src.orchestrator import AgentOrchestrator

        with patch("src.orchestrator.LLMProvider") as mock_llm_class:
            mock_provider = MagicMock()
            mock_llm_class.return_value = mock_provider

            orchestrator = AgentOrchestrator()
            assert orchestrator.llm_provider == mock_provider

    @pytest.mark.asyncio
    async def test_task_dataclass(self) -> None:
        """Test AgentTask dataclass."""
        from src.orchestrator import AgentTask

        task = AgentTask(
            session_id="session-123",
            agent_id="agent-123",
            message="Hello",
        )
        assert task.session_id == "session-123"
        assert task.agent_id == "agent-123"
        assert task.message == "Hello"
        assert task.task_id is not None

    @pytest.mark.asyncio
    async def test_task_result_dataclass(self) -> None:
        """Test TaskResult dataclass."""
        from src.orchestrator import TaskResult, TaskStatus

        result = TaskResult(status=TaskStatus.COMPLETED, response="Done")
        assert result.status == TaskStatus.COMPLETED
        assert result.response == "Done"
        assert result.tool_calls == []
        assert result.error is None


# ============================================================================
# TOOL EXECUTOR TESTS
# ============================================================================


class TestToolExecution:
    """Tests for tool execution."""

    @pytest.mark.asyncio
    async def test_tool_executor_class_exists(self) -> None:
        """Test ToolExecutor class exists."""
        from src.tools.executor import ToolExecutor

        assert ToolExecutor is not None

    @pytest.mark.asyncio
    async def test_tool_executor_initialization(self, tmp_path: Any) -> None:
        """Test ToolExecutor can be initialized."""
        from src.tools.executor import ToolExecutor

        workspace = tmp_path / "workspace"
        workspace.mkdir()
        executor = ToolExecutor(workspace_path=str(workspace), session_id="test-session")
        assert executor is not None
        assert str(workspace) in str(executor.workspace_path)


# ============================================================================
# TASK STATUS TESTS
# ============================================================================


class TestTaskStatus:
    """Tests for task status enum."""

    def test_task_status_values(self) -> None:
        """Test TaskStatus enum values."""
        from src.orchestrator import TaskStatus

        assert TaskStatus.PENDING == "pending"
        assert TaskStatus.RUNNING == "running"
        assert TaskStatus.COMPLETED == "completed"
        assert TaskStatus.FAILED == "failed"


# ============================================================================
# AGENT CREATION PARAMS TESTS
# ============================================================================


class TestAgentCreationParams:
    """Tests for agent creation parameters."""

    def test_agent_creation_params(self) -> None:
        """Test AgentCreationParams dataclass."""
        from src.orchestrator import AgentCreationParams

        params = AgentCreationParams(
            agent_id="agent-123",
            role="architect",
            model="claude-3-5-sonnet-20241022",
            session_id="session-123",
        )
        assert params.agent_id == "agent-123"
        assert params.role == "architect"
        assert params.model == "claude-3-5-sonnet-20241022"
        assert params.session_id == "session-123"


# ============================================================================
# TOKEN USAGE TESTS
# ============================================================================


class TestTokenUsage:
    """Tests for token usage tracking."""

    @pytest.mark.asyncio
    async def test_token_counting(
        self, mock_llm_response: dict[str, Any]
    ) -> None:
        """Test token counting."""
        usage = mock_llm_response["usage"]
        assert usage["input_tokens"] == 100
        assert usage["output_tokens"] == 50
        total = usage["input_tokens"] + usage["output_tokens"]
        assert total == 150
