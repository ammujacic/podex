"""Unit tests for Base Agent.

Tests agent logic with mocks:
- Mode switching (ask → auto → plan)
- Auto-revert logic
- Tool execution flow
- JSON tool call extraction from content
- Memory context retrieval
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.agents.base import (
    AgentConfig,
    BaseAgent,
    Tool,
    _extract_json_tool_calls,
    _find_json_objects,
)
from src.mode_detection import IntendedMode, IntentResult


class ConcreteTestAgent(BaseAgent):
    """Concrete test implementation of BaseAgent for testing."""

    def _get_system_prompt(self) -> str:
        """Return test system prompt."""
        return "You are a test agent."

    def _get_mode_instructions(self) -> str | None:
        """Return mode-specific instructions."""
        return f"Current mode: {self.mode}"

    def _get_tools(self) -> list[Tool]:
        """Return test tools as Tool objects."""
        return [
            Tool(
                name="test_tool",
                description="A test tool",
                parameters={
                    "type": "object",
                    "properties": {"arg": {"type": "string"}},
                    "required": ["arg"],
                },
            )
        ]


class TestJSONExtraction:
    """Test JSON object and tool call extraction."""

    def test_find_json_objects_single_object(self):
        """Test finding a single JSON object."""
        content = 'Some text {"name": "value", "number": 42} more text'
        results = _find_json_objects(content)

        assert len(results) == 1
        start, end, obj = results[0]
        assert obj == {"name": "value", "number": 42}
        assert content[start:end] == '{"name": "value", "number": 42}'

    def test_find_json_objects_multiple_objects(self):
        """Test finding multiple JSON objects."""
        content = '{"first": 1} some text {"second": 2}'
        results = _find_json_objects(content)

        assert len(results) == 2
        assert results[0][2] == {"first": 1}
        assert results[1][2] == {"second": 2}

    def test_find_json_objects_nested(self):
        """Test finding nested JSON objects."""
        content = '{"outer": {"inner": "value"}}'
        results = _find_json_objects(content)

        assert len(results) == 1
        assert results[0][2] == {"outer": {"inner": "value"}}

    def test_find_json_objects_with_escaped_quotes(self):
        """Test JSON with escaped quotes."""
        content = r'{"text": "He said \"hello\""}'
        results = _find_json_objects(content)

        assert len(results) == 1
        assert results[0][2] == {"text": 'He said "hello"'}

    def test_extract_json_tool_calls_basic(self):
        """Test extracting basic tool calls from content."""
        content = '''Let me read the file:
{"name": "read_file", "arguments": {"path": "/workspace/main.py"}}'''

        tool_calls, cleaned = _extract_json_tool_calls(content)

        assert len(tool_calls) == 1
        assert tool_calls[0]["name"] == "read_file"
        assert tool_calls[0]["arguments"] == {"path": "/workspace/main.py"}
        assert "Let me read the file:" in cleaned
        assert '{"name"' not in cleaned

    def test_extract_json_tool_calls_code_block(self):
        """Test extracting tool calls from markdown code blocks."""
        content = '''I'll use this tool:
```json
{"name": "write_file", "arguments": {"path": "/workspace/test.py", "content": "print('hi')"}}
```'''

        tool_calls, cleaned = _extract_json_tool_calls(content)

        assert len(tool_calls) == 1
        assert tool_calls[0]["name"] == "write_file"
        assert '```json' not in cleaned

    def test_extract_json_tool_calls_multiple(self):
        """Test extracting multiple tool calls."""
        content = '''First tool: {"name": "read_file", "arguments": {"path": "a.py"}}
Second tool: {"name": "write_file", "arguments": {"path": "b.py", "content": "x"}}'''

        tool_calls, cleaned = _extract_json_tool_calls(content)

        assert len(tool_calls) == 2
        # Check both tool names are present (order may vary based on implementation)
        tool_names = {tc["name"] for tc in tool_calls}
        assert "read_file" in tool_names
        assert "write_file" in tool_names

    def test_extract_json_tool_calls_invalid_schema(self):
        """Test that invalid tool call schemas are ignored."""
        content = '''Invalid tool (missing name):
{"arguments": {"path": "file.py"}}

Valid tool:
{"name": "read_file", "arguments": {"path": "file.py"}}'''

        tool_calls, cleaned = _extract_json_tool_calls(content)

        assert len(tool_calls) == 1
        assert tool_calls[0]["name"] == "read_file"


class TestAgentModeSwitching:
    """Test agent mode switching logic."""

    @pytest.fixture
    def mock_llm_provider(self) -> MagicMock:
        """Create mock LLM provider."""
        mock = MagicMock()
        mock.complete = AsyncMock()
        return mock

    @pytest.fixture
    def agent_ask_mode(self, mock_llm_provider: MagicMock) -> ConcreteTestAgent:
        """Create test agent in ask mode."""
        config = AgentConfig(
            agent_id="agent-123",
            model="claude-3-5-sonnet-20241022",
            llm_provider=mock_llm_provider,
            mode="ask",
        )
        return ConcreteTestAgent(config)

    async def test_mode_switch_from_ask_to_auto_on_intent(
        self,
        agent_ask_mode: ConcreteTestAgent,
    ):
        """Test mode switches from ask to auto when intent is detected."""
        message = "go ahead and implement it"

        with patch.object(
            agent_ask_mode._intent_detector,
            "should_switch",
            return_value=(
                True,
                IntentResult(
                    intended_mode=IntendedMode.AUTO,
                    confidence=0.95,
                    trigger_phrase="go ahead",
                    reason="Detected auto mode intent",
                ),
            ),
        ):
            switched, announcement = await agent_ask_mode._check_and_switch_mode(message)

        assert switched is True
        assert announcement is not None
        assert agent_ask_mode.mode == "auto"
        assert agent_ask_mode.previous_mode == "ask"

    async def test_mode_switch_from_ask_to_plan_on_intent(
        self,
        agent_ask_mode: ConcreteTestAgent,
    ):
        """Test mode switches from ask to plan when intent is detected."""
        message = "let's plan this out first"

        with patch.object(
            agent_ask_mode._intent_detector,
            "should_switch",
            return_value=(
                True,
                IntentResult(
                    intended_mode=IntendedMode.PLAN,
                    confidence=0.92,
                    trigger_phrase="plan this out",
                    reason="Detected plan mode intent",
                ),
            ),
        ):
            switched, announcement = await agent_ask_mode._check_and_switch_mode(message)

        assert switched is True
        assert agent_ask_mode.mode == "plan"
        assert agent_ask_mode.previous_mode == "ask"

    async def test_blocks_sovereign_mode_switch(
        self,
        agent_ask_mode: ConcreteTestAgent,
    ):
        """Test that code path blocks sovereign mode switch."""
        # This tests the sovereign blocking code path by directly calling
        # _check_and_switch_mode with a mock that would return "sovereign"
        # Since IntendedMode enum doesn't have SOVEREIGN (by design), we
        # need to mock at a lower level.
        original_mode = agent_ask_mode.mode

        # Create a mock result that would return "sovereign" as the value
        mock_result = MagicMock()
        mock_result.intended_mode.value = "sovereign"
        mock_result.trigger_phrase = "do anything"
        mock_result.reason = "test"

        with patch.object(
            agent_ask_mode._intent_detector,
            "should_switch",
            return_value=(True, mock_result),
        ):
            switched, announcement = await agent_ask_mode._check_and_switch_mode(
                "do whatever you want"
            )

        # Should block switch to sovereign
        assert switched is False
        assert agent_ask_mode.mode == original_mode  # Mode unchanged

    async def test_no_switch_without_intent(
        self,
        agent_ask_mode: ConcreteTestAgent,
    ):
        """Test that mode doesn't switch without clear intent."""
        message = "please help me with this code"

        with patch.object(
            agent_ask_mode._intent_detector,
            "should_switch",
            return_value=(False, None),
        ):
            switched, announcement = await agent_ask_mode._check_and_switch_mode(message)

        assert switched is False
        assert agent_ask_mode.mode == "ask"

    async def test_mode_switch_updates_system_prompt(
        self,
        agent_ask_mode: ConcreteTestAgent,
    ):
        """Test that mode switch updates system prompt."""
        original_prompt = agent_ask_mode.system_prompt
        assert "ask" in original_prompt.lower()

        with patch.object(
            agent_ask_mode._intent_detector,
            "should_switch",
            return_value=(
                True,
                IntentResult(
                    intended_mode=IntendedMode.AUTO,
                    confidence=0.95,
                    trigger_phrase="go ahead",
                ),
            ),
        ):
            await agent_ask_mode._check_and_switch_mode("go ahead")

        # System prompt should be updated
        assert agent_ask_mode.system_prompt != original_prompt
        assert "auto" in agent_ask_mode.system_prompt.lower()

    async def test_mode_switch_callback_triggered(
        self,
        agent_ask_mode: ConcreteTestAgent,
    ):
        """Test that mode switch callback is triggered."""
        callback = AsyncMock()
        agent_ask_mode.set_mode_switch_callback(callback)

        with patch.object(
            agent_ask_mode._intent_detector,
            "should_switch",
            return_value=(
                True,
                IntentResult(
                    intended_mode=IntendedMode.AUTO,
                    confidence=0.95,
                    trigger_phrase="go ahead",
                ),
            ),
        ):
            await agent_ask_mode._check_and_switch_mode("go ahead")

        # Callback should be called
        callback.assert_called_once()
        event = callback.call_args[0][0]
        assert event.old_mode == "ask"
        assert event.new_mode == "auto"
        assert event.trigger_phrase == "go ahead"


class TestAgentToolExecution:
    """Test tool execution flow."""

    @pytest.fixture
    def mock_llm_provider(self) -> MagicMock:
        """Create mock LLM provider."""
        mock = MagicMock()
        mock.complete = AsyncMock(return_value={
            "content": "Task completed",
            "finish_reason": "stop",
            "usage": {"input_tokens": 100, "output_tokens": 50},
            "tool_calls": [],
        })
        return mock

    @pytest.fixture
    def agent_with_tools(self, mock_llm_provider: MagicMock, tmp_path: Any) -> ConcreteTestAgent:
        """Create agent with tool executor."""
        config = AgentConfig(
            agent_id="agent-123",
            model="claude-3-5-sonnet-20241022",
            llm_provider=mock_llm_provider,
            mode="auto",
            workspace_path=tmp_path,
        )
        return ConcreteTestAgent(config)

    async def test_execute_calls_llm_provider(
        self,
        agent_with_tools: ConcreteTestAgent,
        mock_llm_provider: MagicMock,
    ):
        """Test that execute calls LLM provider."""
        result = await agent_with_tools.execute("Test message")

        assert mock_llm_provider.complete.called
        assert result["content"] == "Task completed"

    async def test_tool_executor_initialized_with_workspace(
        self,
        agent_with_tools: ConcreteTestAgent,
    ):
        """Test that tool executor is initialized when workspace is provided."""
        assert agent_with_tools.tool_executor is not None
        assert agent_with_tools.tool_executor.agent_mode == "auto"

    async def test_approval_callback_set_on_tool_executor(
        self,
        agent_with_tools: ConcreteTestAgent,
    ):
        """Test that approval callback is set on tool executor."""
        callback = AsyncMock()
        agent_with_tools.set_approval_callback(callback)

        # Tool executor should have access to approval callback
        assert agent_with_tools._approval_callback == callback


class TestAgentMemoryIntegration:
    """Test memory context retrieval and integration."""

    @pytest.fixture
    def mock_llm_provider(self) -> MagicMock:
        """Create mock LLM provider."""
        mock = MagicMock()
        mock.provider = "anthropic"
        mock.complete = AsyncMock(return_value={
            "content": "Response with memory",
            "finish_reason": "stop",
            "usage": {"input_tokens": 100, "output_tokens": 50, "total_tokens": 150},
            "tool_calls": [],
        })
        return mock

    @pytest.fixture
    def agent(self, mock_llm_provider: MagicMock) -> ConcreteTestAgent:
        """Create test agent."""
        config = AgentConfig(
            agent_id="agent-123",
            model="claude-3-5-sonnet-20241022",
            llm_provider=mock_llm_provider,
            session_id="session-123",
            user_id="user-456",
        )
        return ConcreteTestAgent(config)

    async def test_memory_context_retrieved_from_knowledge_base(
        self,
        agent: ConcreteTestAgent,
    ):
        """Test that memory context is retrieved from knowledge base during execute."""
        with patch("src.agents.base.get_db_context"), \
             patch("src.agents.base.update_agent_status", new_callable=AsyncMock), \
             patch("src.agents.base.save_message", new_callable=AsyncMock), \
             patch("src.agents.base.create_context_manager_with_settings", new_callable=AsyncMock, return_value=None), \
             patch("src.agents.base.get_knowledge_base") as mock_kb, \
             patch("src.agents.base.get_retriever") as mock_retriever, \
             patch("src.agents.base.get_usage_tracker", return_value=None):

            mock_kb.return_value.get_relevant_context = AsyncMock(return_value=[])
            mock_retriever.return_value.auto_extract_memories = AsyncMock(return_value=[])

            await agent.execute("Test message", persist=False)

            # Should retrieve memories for context via get_knowledge_base
            mock_kb.assert_called_once()


class TestAgentConversationManagement:
    """Test conversation history persistence and loading."""

    @pytest.fixture
    def mock_llm_provider(self) -> MagicMock:
        """Create mock LLM provider."""
        mock = MagicMock()
        mock.provider = "anthropic"
        mock.complete = AsyncMock(return_value={
            "content": "Response",
            "finish_reason": "stop",
            "usage": {"input_tokens": 100, "output_tokens": 50, "total_tokens": 150},
            "tool_calls": [],
        })
        return mock

    @pytest.fixture
    def agent(self, mock_llm_provider: MagicMock) -> ConcreteTestAgent:
        """Create test agent."""
        config = AgentConfig(
            agent_id="agent-123",
            model="claude-3-5-sonnet-20241022",
            llm_provider=mock_llm_provider,
            session_id="session-123",
            user_id="user-456",
        )
        return ConcreteTestAgent(config)

    async def test_load_conversation_history_method(
        self,
        agent: ConcreteTestAgent,
    ):
        """Test load_conversation_history loads from database."""
        mock_history = [
            {"role": "user", "content": "Previous message"},
            {"role": "assistant", "content": "Previous response"},
        ]

        with patch("src.agents.base.get_db_context") as mock_db_context, \
             patch("src.agents.base.load_conversation_history", new_callable=AsyncMock) as mock_load:
            mock_db_context.return_value.__aenter__ = AsyncMock(return_value=MagicMock())
            mock_db_context.return_value.__aexit__ = AsyncMock()
            mock_load.return_value = mock_history

            await agent.load_conversation_history()

            mock_load.assert_called_once()
            assert agent.conversation_history == mock_history

    async def test_message_saved_to_db_after_execution(
        self,
        agent: ConcreteTestAgent,
    ):
        """Test that agent updates status when persist=True.

        Note: User messages are saved by the API service, not by the agent.
        The agent only updates status, not message persistence.
        """
        with patch("src.agents.base.get_db_context") as mock_db_context, \
             patch("src.agents.base.update_agent_status", new_callable=AsyncMock) as mock_update, \
             patch("src.agents.base.save_message", new_callable=AsyncMock) as mock_save, \
             patch("src.agents.base.create_context_manager_with_settings", new_callable=AsyncMock, return_value=None), \
             patch("src.agents.base.get_knowledge_base") as mock_kb, \
             patch("src.agents.base.get_retriever") as mock_retriever, \
             patch("src.agents.base.get_usage_tracker", return_value=None):

            mock_db_context.return_value.__aenter__ = AsyncMock(return_value=MagicMock())
            mock_db_context.return_value.__aexit__ = AsyncMock()
            mock_kb.return_value.get_relevant_context = AsyncMock(return_value=[])
            mock_retriever.return_value.auto_extract_memories = AsyncMock(return_value=[])
            mock_save.return_value = MagicMock(id="msg-123")

            await agent.execute("Test message", persist=True)

            # Agent should update status to active when persist=True
            mock_update.assert_called_once()
            # update_agent_status(db, agent_id, status)
            call_args = mock_update.call_args[0]
            assert call_args[2] == "active"  # Status is the 3rd argument

    async def test_agent_status_updated_during_execution(
        self,
        agent: ConcreteTestAgent,
    ):
        """Test that agent status is updated to active during execution."""
        with patch("src.agents.base.get_db_context") as mock_db_context, \
             patch("src.agents.base.update_agent_status", new_callable=AsyncMock) as mock_update, \
             patch("src.agents.base.save_message", new_callable=AsyncMock) as mock_save, \
             patch("src.agents.base.create_context_manager_with_settings", new_callable=AsyncMock, return_value=None), \
             patch("src.agents.base.get_knowledge_base") as mock_kb, \
             patch("src.agents.base.get_retriever") as mock_retriever, \
             patch("src.agents.base.get_usage_tracker", return_value=None):

            mock_db_context.return_value.__aenter__ = AsyncMock(return_value=MagicMock())
            mock_db_context.return_value.__aexit__ = AsyncMock()
            mock_kb.return_value.get_relevant_context = AsyncMock(return_value=[])
            mock_retriever.return_value.auto_extract_memories = AsyncMock(return_value=[])
            mock_save.return_value = MagicMock(id="msg-123")

            await agent.execute("Test message", persist=True)

            # Should update status to 'active' once
            mock_update.assert_called_once()
            # update_agent_status(db, agent_id, status)
            call_args = mock_update.call_args[0]
            assert call_args[2] == "active"  # Status is the 3rd argument


class TestAgentErrorHandling:
    """Test error handling in agent execution."""

    @pytest.fixture
    def mock_llm_provider(self) -> MagicMock:
        """Create mock LLM provider."""
        mock = MagicMock()
        mock.complete = AsyncMock()
        return mock

    @pytest.fixture
    def agent(self, mock_llm_provider: MagicMock) -> ConcreteTestAgent:
        """Create test agent."""
        config = AgentConfig(
            agent_id="agent-123",
            model="claude-3-5-sonnet-20241022",
            llm_provider=mock_llm_provider,
        )
        return ConcreteTestAgent(config)

    async def test_llm_error_handled_gracefully(
        self,
        agent: ConcreteTestAgent,
        mock_llm_provider: MagicMock,
    ):
        """Test that LLM errors are handled gracefully."""
        mock_llm_provider.complete.side_effect = Exception("LLM API error")

        # Should raise exception (agents don't swallow errors)
        with pytest.raises(Exception, match="LLM API error"):
            await agent.execute("Test message")


class TestModeRevertLogic:
    """Test auto-revert mode logic."""

    @pytest.fixture
    def mock_llm_provider(self) -> MagicMock:
        """Create mock LLM provider."""
        mock = MagicMock()
        mock.complete = AsyncMock()
        return mock

    @pytest.fixture
    def agent_in_plan_mode(self, mock_llm_provider: MagicMock) -> ConcreteTestAgent:
        """Create test agent in plan mode with previous mode set."""
        config = AgentConfig(
            agent_id="agent-123",
            model="claude-3-5-sonnet-20241022",
            llm_provider=mock_llm_provider,
            mode="plan",
            previous_mode="ask",
        )
        return ConcreteTestAgent(config)

    @pytest.fixture
    def agent_in_auto_mode(self, mock_llm_provider: MagicMock) -> ConcreteTestAgent:
        """Create test agent in auto mode with previous mode set."""
        config = AgentConfig(
            agent_id="agent-123",
            model="claude-3-5-sonnet-20241022",
            llm_provider=mock_llm_provider,
            mode="auto",
            previous_mode="ask",
        )
        return ConcreteTestAgent(config)

    def test_should_revert_false_without_previous_mode(
        self,
        mock_llm_provider: MagicMock,
    ):
        """Test that revert is skipped if no previous mode."""
        config = AgentConfig(
            agent_id="agent-123",
            model="claude-3-5-sonnet-20241022",
            llm_provider=mock_llm_provider,
            mode="plan",
            previous_mode=None,
        )
        agent = ConcreteTestAgent(config)

        result = agent._should_revert_mode("Here's my plan for implementation...")
        assert result is False

    def test_should_revert_plan_mode_on_plan_presentation(
        self,
        agent_in_plan_mode: ConcreteTestAgent,
    ):
        """Test that plan mode reverts when plan is presented."""
        # Test various plan presentation phrases that match the actual patterns
        plan_responses = [
            "Here's my plan for implementing the feature:",  # Matches "here's ... plan"
            "Here is the plan for the implementation:",  # Matches "here is ... plan"
            "I propose the following solution:",  # Matches "i propose the following"
            "\nStep 1: First, we need to...",  # Matches "Step 1:"
            "\n## Plan\nThe implementation steps are:",  # Matches markdown header
        ]

        for response in plan_responses:
            result = agent_in_plan_mode._should_revert_mode(response)
            assert result is True, f"Should revert on: {response}"

    def test_should_not_revert_plan_mode_on_normal_response(
        self,
        agent_in_plan_mode: ConcreteTestAgent,
    ):
        """Test that plan mode doesn't revert on normal response."""
        normal_responses = [
            "I'm analyzing the codebase...",
            "Let me look at the architecture...",
            "I need more information about the requirements.",
        ]

        for response in normal_responses:
            result = agent_in_plan_mode._should_revert_mode(response)
            assert result is False, f"Should not revert on: {response}"

    def test_should_revert_auto_mode_on_completion(
        self,
        agent_in_auto_mode: ConcreteTestAgent,
    ):
        """Test that auto mode reverts when implementation is complete."""
        # Test phrases that match the actual patterns (anchored to sentence start)
        completion_responses = [
            "The changes have been made.",  # Matches "changes have been made"
            "Implementation complete!",  # Matches "implementation complete"
            "Successfully implemented the changes.",  # Matches "successfully implemented"
            "All done!",  # Matches "all done"
            "I've made the changes.",  # Matches "i've made ... changes"
            "Finished implementing the feature.",  # Matches "finished implementing"
        ]

        for response in completion_responses:
            result = agent_in_auto_mode._should_revert_mode(response)
            assert result is True, f"Should revert on: {response}"

    def test_should_not_revert_auto_mode_during_work(
        self,
        agent_in_auto_mode: ConcreteTestAgent,
    ):
        """Test that auto mode doesn't revert while still working."""
        working_responses = [
            "I'm now modifying the file...",
            "Let me run the tests...",
            "Making changes to the auth module...",
        ]

        for response in working_responses:
            result = agent_in_auto_mode._should_revert_mode(response)
            assert result is False, f"Should not revert on: {response}"

    async def test_maybe_revert_mode_performs_revert(
        self,
        agent_in_plan_mode: ConcreteTestAgent,
    ):
        """Test that _maybe_revert_mode actually reverts."""
        reverted, announcement = await agent_in_plan_mode._maybe_revert_mode(
            "Here's my plan for the implementation:"
        )

        assert reverted is True
        assert announcement is not None
        assert agent_in_plan_mode.mode == "ask"
        assert agent_in_plan_mode.previous_mode is None

    async def test_maybe_revert_mode_no_revert_when_not_needed(
        self,
        agent_in_plan_mode: ConcreteTestAgent,
    ):
        """Test that _maybe_revert_mode skips when not needed."""
        reverted, announcement = await agent_in_plan_mode._maybe_revert_mode(
            "I'm still analyzing the code..."
        )

        assert reverted is False
        assert announcement is None
        assert agent_in_plan_mode.mode == "plan"
        assert agent_in_plan_mode.previous_mode == "ask"


class TestModeSwitchAnnouncements:
    """Test mode switch announcement generation."""

    @pytest.fixture
    def mock_llm_provider(self) -> MagicMock:
        """Create mock LLM provider."""
        return MagicMock()

    @pytest.fixture
    def agent(self, mock_llm_provider: MagicMock) -> ConcreteTestAgent:
        """Create test agent."""
        config = AgentConfig(
            agent_id="agent-123",
            model="claude-3-5-sonnet-20241022",
            llm_provider=mock_llm_provider,
            mode="ask",
        )
        return ConcreteTestAgent(config)

    def test_plan_mode_announcement(self, agent: ConcreteTestAgent):
        """Test plan mode announcement generation."""
        announcement = agent._generate_mode_switch_announcement("ask", "plan")
        assert "Plan mode" in announcement

    def test_ask_mode_announcement(self, agent: ConcreteTestAgent):
        """Test ask mode announcement generation."""
        announcement = agent._generate_mode_switch_announcement("auto", "ask")
        assert "Ask mode" in announcement

    def test_auto_mode_announcement(self, agent: ConcreteTestAgent):
        """Test auto mode announcement generation."""
        announcement = agent._generate_mode_switch_announcement("ask", "auto")
        assert "Auto mode" in announcement

    def test_unknown_mode_announcement(self, agent: ConcreteTestAgent):
        """Test unknown mode announcement generation."""
        announcement = agent._generate_mode_switch_announcement("ask", "custom")
        assert "Custom mode" in announcement


class TestAgentDataclasses:
    """Test agent dataclasses and initialization."""

    def test_agent_config_defaults(self):
        """Test AgentConfig default values."""
        mock_provider = MagicMock()
        config = AgentConfig(
            agent_id="test-agent",
            model="test-model",
            llm_provider=mock_provider,
        )

        assert config.agent_id == "test-agent"
        assert config.model == "test-model"
        assert config.workspace_path is None
        assert config.session_id is None
        assert config.mcp_registry is None
        assert config.mode == "ask"
        assert config.previous_mode is None
        assert config.command_allowlist is None
        assert config.user_id is None
        assert config.workspace_id is None

    def test_tool_dataclass(self):
        """Test Tool dataclass."""
        tool = Tool(
            name="test_tool",
            description="A test tool",
            parameters={"type": "object", "properties": {}},
        )

        assert tool.name == "test_tool"
        assert tool.description == "A test tool"
        assert tool.parameters == {"type": "object", "properties": {}}

    def test_agent_initialization_with_all_config(self):
        """Test agent initialization with all config options."""
        mock_provider = MagicMock()
        mock_mcp_registry = MagicMock()

        config = AgentConfig(
            agent_id="test-agent",
            model="test-model",
            llm_provider=mock_provider,
            workspace_path="/tmp/workspace",
            session_id="session-123",
            mcp_registry=mock_mcp_registry,
            mode="auto",
            previous_mode="ask",
            command_allowlist=["ls", "cat"],
            user_id="user-123",
            workspace_id="workspace-123",
        )

        agent = ConcreteTestAgent(config)

        assert agent.agent_id == "test-agent"
        assert agent.model == "test-model"
        assert agent.session_id == "session-123"
        assert agent.mode == "auto"
        assert agent.previous_mode == "ask"
        assert agent.command_allowlist == ["ls", "cat"]
        assert agent.user_id == "user-123"
        assert agent.workspace_id == "workspace-123"


class TestAgentToolCollection:
    """Test agent tool collection and MCP integration."""

    @pytest.fixture
    def mock_llm_provider(self) -> MagicMock:
        """Create mock LLM provider."""
        return MagicMock()

    def test_get_tools_returns_tool_list(self, mock_llm_provider: MagicMock):
        """Test that _get_tools returns list of Tool objects."""
        config = AgentConfig(
            agent_id="test-agent",
            model="test-model",
            llm_provider=mock_llm_provider,
        )
        agent = ConcreteTestAgent(config)

        tools = agent._get_tools()
        assert isinstance(tools, list)
        assert len(tools) > 0
        assert all(isinstance(t, Tool) for t in tools)

    def test_tools_initialized_at_creation(self, mock_llm_provider: MagicMock):
        """Test that tools are initialized when agent is created."""
        config = AgentConfig(
            agent_id="test-agent",
            model="test-model",
            llm_provider=mock_llm_provider,
        )
        agent = ConcreteTestAgent(config)

        assert agent.tools is not None
        assert len(agent.tools) > 0

    def test_tools_refreshed_on_mode_update(self, mock_llm_provider: MagicMock):
        """Test that tools are refreshed when mode is updated."""
        config = AgentConfig(
            agent_id="test-agent",
            model="test-model",
            llm_provider=mock_llm_provider,
            mode="ask",
        )
        agent = ConcreteTestAgent(config)
        original_tools = agent.tools

        # Update mode
        agent.mode = "auto"
        agent._update_mode_context()

        # Tools should be refreshed
        assert agent.tools is not None


class TestAgentCallbacks:
    """Test agent callback functionality."""

    @pytest.fixture
    def mock_llm_provider(self) -> MagicMock:
        """Create mock LLM provider."""
        return MagicMock()

    @pytest.fixture
    def agent(self, mock_llm_provider: MagicMock) -> ConcreteTestAgent:
        """Create test agent."""
        config = AgentConfig(
            agent_id="test-agent",
            model="test-model",
            llm_provider=mock_llm_provider,
        )
        return ConcreteTestAgent(config)

    def test_set_approval_callback(self, agent: ConcreteTestAgent):
        """Test setting approval callback."""
        callback = AsyncMock()
        agent.set_approval_callback(callback)
        assert agent._approval_callback == callback

    def test_set_mode_switch_callback(self, agent: ConcreteTestAgent):
        """Test setting mode switch callback."""
        callback = AsyncMock()
        agent.set_mode_switch_callback(callback)
        assert agent._mode_switch_callback == callback

    async def test_mode_switch_callback_error_handled(self, agent: ConcreteTestAgent):
        """Test that mode switch callback errors are handled gracefully."""
        callback = AsyncMock(side_effect=Exception("Callback error"))
        agent.set_mode_switch_callback(callback)

        with patch.object(
            agent._intent_detector,
            "should_switch",
            return_value=(
                True,
                IntentResult(
                    intended_mode=IntendedMode.AUTO,
                    confidence=0.95,
                    trigger_phrase="go ahead",
                ),
            ),
        ):
            # Should not raise despite callback error
            switched, _ = await agent._check_and_switch_mode("go ahead")
            assert switched is True


class TestJSONExtractionEdgeCases:
    """Test edge cases in JSON extraction."""

    def test_find_json_objects_empty_string(self):
        """Test finding JSON in empty string."""
        results = _find_json_objects("")
        assert results == []

    def test_find_json_objects_no_json(self):
        """Test finding JSON in string without JSON."""
        results = _find_json_objects("This is just plain text without any JSON")
        assert results == []

    def test_find_json_objects_invalid_json(self):
        """Test finding invalid JSON objects."""
        content = '{"incomplete": "json'
        results = _find_json_objects(content)
        assert results == []

    def test_find_json_objects_array_ignored(self):
        """Test that JSON arrays are ignored."""
        content = '[1, 2, 3]'
        results = _find_json_objects(content)
        # Arrays are not matched (only objects)
        assert results == []

    def test_extract_json_tool_calls_empty_content(self):
        """Test extracting tool calls from empty content."""
        tool_calls, remaining = _extract_json_tool_calls("")
        assert tool_calls == []
        assert remaining == ""

    def test_extract_json_tool_calls_with_input_field(self):
        """Test extracting tool calls using 'input' instead of 'arguments'."""
        content = '{"name": "test_tool", "input": {"key": "value"}}'
        tool_calls, _ = _extract_json_tool_calls(content)

        assert len(tool_calls) == 1
        assert tool_calls[0]["arguments"] == {"key": "value"}

    def test_extract_json_tool_calls_cleans_empty_blocks(self):
        """Test that empty code blocks are cleaned up."""
        content = "Some text ```json``` more text"
        _, remaining = _extract_json_tool_calls(content)
        assert "```json```" not in remaining


class TestAgentExecution:
    """Test agent execute() method."""

    @pytest.fixture
    def mock_llm_provider(self) -> MagicMock:
        """Create mock LLM provider."""
        mock = MagicMock()
        mock.provider = "anthropic"
        mock.complete = AsyncMock(return_value={
            "content": "Task completed successfully",
            "tool_calls": [],
            "usage": {"input_tokens": 100, "output_tokens": 50, "total_tokens": 150},
        })
        return mock

    @pytest.fixture
    def agent(self, mock_llm_provider: MagicMock) -> ConcreteTestAgent:
        """Create test agent with mocked dependencies."""
        config = AgentConfig(
            agent_id="test-agent",
            model="claude-3-5-sonnet",
            llm_provider=mock_llm_provider,
            mode="auto",
            user_id="user-123",
            session_id="session-456",
        )
        return ConcreteTestAgent(config)

    async def test_execute_returns_agent_response(self, agent: ConcreteTestAgent):
        """Test execute returns AgentResponse with content."""
        with patch("src.agents.base.get_db_context"), \
             patch("src.agents.base.update_agent_status", new_callable=AsyncMock), \
             patch("src.agents.base.save_message", new_callable=AsyncMock), \
             patch("src.agents.base.create_context_manager_with_settings", new_callable=AsyncMock, return_value=None), \
             patch("src.agents.base.get_knowledge_base") as mock_kb, \
             patch("src.agents.base.get_retriever") as mock_retriever, \
             patch("src.agents.base.get_usage_tracker", return_value=None):

            mock_kb.return_value.get_relevant_context = AsyncMock(return_value=[])
            mock_retriever.return_value.auto_extract_memories = AsyncMock(return_value=[])

            response = await agent.execute("Test message", persist=False)

            from src.agents.base import AgentResponse
            assert isinstance(response, AgentResponse)
            assert response.content == "Task completed successfully"
            assert response.tokens_used == 150

    async def test_execute_adds_message_to_conversation_history(self, agent: ConcreteTestAgent):
        """Test execute adds user message to history."""
        with patch("src.agents.base.get_db_context"), \
             patch("src.agents.base.update_agent_status", new_callable=AsyncMock), \
             patch("src.agents.base.save_message", new_callable=AsyncMock), \
             patch("src.agents.base.create_context_manager_with_settings", new_callable=AsyncMock, return_value=None), \
             patch("src.agents.base.get_knowledge_base") as mock_kb, \
             patch("src.agents.base.get_retriever") as mock_retriever, \
             patch("src.agents.base.get_usage_tracker", return_value=None):

            mock_kb.return_value.get_relevant_context = AsyncMock(return_value=[])
            mock_retriever.return_value.auto_extract_memories = AsyncMock(return_value=[])

            await agent.execute("Hello world", persist=False)

            # Check that user message was added
            assert any(
                msg["role"] == "user" and msg["content"] == "Hello world"
                for msg in agent.conversation_history
            )
            # Check that assistant response was added
            assert any(
                msg["role"] == "assistant" and "Task completed" in msg["content"]
                for msg in agent.conversation_history
            )

    async def test_execute_with_tool_calls(self, agent: ConcreteTestAgent, mock_llm_provider: MagicMock):
        """Test execute processes tool calls."""
        mock_llm_provider.complete.return_value = {
            "content": "",
            "tool_calls": [
                {"id": "tc-1", "name": "read_file", "arguments": {"path": "/test.py"}}
            ],
            "usage": {"input_tokens": 100, "output_tokens": 50, "total_tokens": 150},
        }

        with patch("src.agents.base.get_db_context"), \
             patch("src.agents.base.update_agent_status", new_callable=AsyncMock), \
             patch("src.agents.base.save_message", new_callable=AsyncMock), \
             patch("src.agents.base.create_context_manager_with_settings", new_callable=AsyncMock, return_value=None), \
             patch("src.agents.base.get_knowledge_base") as mock_kb, \
             patch("src.agents.base.get_retriever") as mock_retriever, \
             patch("src.agents.base.get_usage_tracker", return_value=None):

            mock_kb.return_value.get_relevant_context = AsyncMock(return_value=[])
            mock_retriever.return_value.auto_extract_memories = AsyncMock(return_value=[])

            # Agent has no tool executor, so tool call returns error
            response = await agent.execute("Read file", persist=False)

            assert len(response.tool_calls) == 1
            assert response.tool_calls[0]["name"] == "read_file"

    async def test_execute_extracts_json_tool_calls_from_content(
        self,
        agent: ConcreteTestAgent,
        mock_llm_provider: MagicMock,
    ):
        """Test execute extracts JSON tool calls from content (Ollama-style)."""
        mock_llm_provider.complete.return_value = {
            "content": 'I will read the file: {"name": "read_file", "arguments": {"path": "/test.py"}}',
            "tool_calls": [],
            "usage": {"input_tokens": 100, "output_tokens": 50, "total_tokens": 150},
        }

        with patch("src.agents.base.get_db_context"), \
             patch("src.agents.base.update_agent_status", new_callable=AsyncMock), \
             patch("src.agents.base.save_message", new_callable=AsyncMock), \
             patch("src.agents.base.create_context_manager_with_settings", new_callable=AsyncMock, return_value=None), \
             patch("src.agents.base.get_knowledge_base") as mock_kb, \
             patch("src.agents.base.get_retriever") as mock_retriever, \
             patch("src.agents.base.get_usage_tracker", return_value=None):

            mock_kb.return_value.get_relevant_context = AsyncMock(return_value=[])
            mock_retriever.return_value.auto_extract_memories = AsyncMock(return_value=[])

            response = await agent.execute("Read file", persist=False)

            # Should extract JSON tool call
            assert len(response.tool_calls) == 1
            assert response.tool_calls[0]["name"] == "read_file"

    async def test_execute_with_persist_saves_to_db(self, agent: ConcreteTestAgent):
        """Test execute with persist=True updates agent status.

        Note: User messages are saved by the API service, not by the agent.
        The agent only updates status to 'active' when persist=True.
        """
        with patch("src.agents.base.get_db_context") as mock_db_context, \
             patch("src.agents.base.update_agent_status", new_callable=AsyncMock) as mock_update, \
             patch("src.agents.base.save_message", new_callable=AsyncMock) as mock_save, \
             patch("src.agents.base.create_context_manager_with_settings", new_callable=AsyncMock, return_value=None), \
             patch("src.agents.base.get_knowledge_base") as mock_kb, \
             patch("src.agents.base.get_retriever") as mock_retriever, \
             patch("src.agents.base.get_usage_tracker", return_value=None):

            mock_db_context.return_value.__aenter__ = AsyncMock()
            mock_db_context.return_value.__aexit__ = AsyncMock()
            mock_kb.return_value.get_relevant_context = AsyncMock(return_value=[])
            mock_retriever.return_value.auto_extract_memories = AsyncMock(return_value=[])
            mock_save.return_value = MagicMock(id="msg-123")

            await agent.execute("Test", persist=True)

            # Should update status to active
            mock_update.assert_called_once()
            # update_agent_status(db, agent_id, status)
            call_args = mock_update.call_args[0]
            assert call_args[2] == "active"  # Status is the 3rd argument


class TestAgentToolExecution:
    """Test _execute_tool method."""

    @pytest.fixture
    def mock_llm_provider(self) -> MagicMock:
        """Create mock LLM provider."""
        return MagicMock()

    @pytest.fixture
    def agent_with_executor(self, mock_llm_provider: MagicMock, tmp_path) -> ConcreteTestAgent:
        """Create agent with tool executor."""
        config = AgentConfig(
            agent_id="test-agent",
            model="claude-3-5-sonnet",
            llm_provider=mock_llm_provider,
            mode="auto",
            workspace_path=tmp_path,
        )
        return ConcreteTestAgent(config)

    @pytest.fixture
    def agent_without_executor(self, mock_llm_provider: MagicMock) -> ConcreteTestAgent:
        """Create agent without tool executor."""
        config = AgentConfig(
            agent_id="test-agent",
            model="claude-3-5-sonnet",
            llm_provider=mock_llm_provider,
            mode="auto",
        )
        return ConcreteTestAgent(config)

    async def test_execute_tool_with_executor(self, agent_with_executor: ConcreteTestAgent):
        """Test _execute_tool delegates to tool executor."""
        agent_with_executor.tool_executor.execute = AsyncMock(return_value='{"success": true}')

        result = await agent_with_executor._execute_tool({
            "name": "read_file",
            "arguments": {"path": "/test.py"},
        })

        agent_with_executor.tool_executor.execute.assert_called_once_with(
            "read_file",
            {"path": "/test.py"},
        )
        assert result == '{"success": true}'

    async def test_execute_tool_without_executor(self, agent_without_executor: ConcreteTestAgent):
        """Test _execute_tool returns error without executor."""
        result = await agent_without_executor._execute_tool({
            "name": "read_file",
            "arguments": {"path": "/test.py"},
        })

        assert "Tool executor not configured" in result


class TestAgentToolResponseGeneration:
    """Test _generate_tool_response method."""

    @pytest.fixture
    def mock_llm_provider(self) -> MagicMock:
        """Create mock LLM provider."""
        return MagicMock()

    @pytest.fixture
    def agent(self, mock_llm_provider: MagicMock) -> ConcreteTestAgent:
        """Create test agent."""
        config = AgentConfig(
            agent_id="test-agent",
            model="claude-3-5-sonnet",
            llm_provider=mock_llm_provider,
        )
        return ConcreteTestAgent(config)

    def test_generate_tool_response_empty_calls(self, agent: ConcreteTestAgent):
        """Test _generate_tool_response with no tool calls."""
        result = agent._generate_tool_response([])
        assert result == "I've processed your request."

    def test_generate_tool_response_read_file(self, agent: ConcreteTestAgent):
        """Test _generate_tool_response for read_file."""
        tool_calls = [
            {
                "name": "read_file",
                "arguments": {"path": "/workspace/main.py"},
                "result": '{"success": true, "content": "..."}',
            }
        ]

        result = agent._generate_tool_response(tool_calls)

        assert "Read the contents of /workspace/main.py" in result

    def test_generate_tool_response_write_file(self, agent: ConcreteTestAgent):
        """Test _generate_tool_response for write_file."""
        tool_calls = [
            {
                "name": "write_file",
                "arguments": {"path": "/workspace/test.py", "content": "..."},
                "result": '{"success": true}',
            }
        ]

        result = agent._generate_tool_response(tool_calls)

        assert "Wrote to /workspace/test.py" in result

    def test_generate_tool_response_execute_command(self, agent: ConcreteTestAgent):
        """Test _generate_tool_response for execute_command."""
        tool_calls = [
            {
                "name": "execute_command",
                "arguments": {"command": "npm test"},
                "result": '{"success": true, "output": "..."}',
            }
        ]

        result = agent._generate_tool_response(tool_calls)

        assert "Executed: npm test" in result

    def test_generate_tool_response_search(self, agent: ConcreteTestAgent):
        """Test _generate_tool_response for search tool."""
        tool_calls = [
            {
                "name": "search_files",
                "arguments": {"query": "error handling"},
                "result": '{"success": true, "results": []}',
            }
        ]

        result = agent._generate_tool_response(tool_calls)

        assert "Searched for: error handling" in result

    def test_generate_tool_response_error(self, agent: ConcreteTestAgent):
        """Test _generate_tool_response with error."""
        tool_calls = [
            {
                "name": "read_file",
                "arguments": {"path": "/nonexistent.py"},
                "result": '{"success": false, "error": "File not found"}',
            }
        ]

        result = agent._generate_tool_response(tool_calls)

        assert "error" in result.lower()
        assert "File not found" in result

    def test_generate_tool_response_multiple_calls(self, agent: ConcreteTestAgent):
        """Test _generate_tool_response with multiple tool calls."""
        tool_calls = [
            {
                "name": "read_file",
                "arguments": {"path": "/test.py"},
                "result": '{"success": true}',
            },
            {
                "name": "write_file",
                "arguments": {"path": "/out.py"},
                "result": '{"success": true}',
            },
        ]

        result = agent._generate_tool_response(tool_calls)

        assert "I've completed the following:" in result
        assert "•" in result  # Bullet points


class TestAgentResetConversation:
    """Test reset_conversation method."""

    @pytest.fixture
    def mock_llm_provider(self) -> MagicMock:
        """Create mock LLM provider."""
        return MagicMock()

    @pytest.fixture
    def agent(self, mock_llm_provider: MagicMock) -> ConcreteTestAgent:
        """Create test agent."""
        config = AgentConfig(
            agent_id="test-agent",
            model="claude-3-5-sonnet",
            llm_provider=mock_llm_provider,
        )
        return ConcreteTestAgent(config)

    def test_reset_conversation(self, agent: ConcreteTestAgent):
        """Test reset_conversation clears history."""
        agent.conversation_history = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi"},
        ]

        agent.reset_conversation()

        assert agent.conversation_history == []


class TestAgentModeInstructions:
    """Test _get_mode_instructions method."""

    @pytest.fixture
    def mock_llm_provider(self) -> MagicMock:
        """Create mock LLM provider."""
        return MagicMock()

    def test_plan_mode_instructions(self, mock_llm_provider: MagicMock):
        """Test plan mode instructions."""
        config = AgentConfig(
            agent_id="test-agent",
            model="claude-3-5-sonnet",
            llm_provider=mock_llm_provider,
            mode="plan",
        )
        agent = ConcreteTestAgent(config)

        # Plan mode instructions are included in system prompt
        assert "Plan" in agent.system_prompt or "plan" in agent.system_prompt

    def test_ask_mode_instructions(self, mock_llm_provider: MagicMock):
        """Test ask mode instructions."""
        config = AgentConfig(
            agent_id="test-agent",
            model="claude-3-5-sonnet",
            llm_provider=mock_llm_provider,
            mode="ask",
        )
        agent = ConcreteTestAgent(config)

        assert "ask" in agent.system_prompt.lower() or "Ask" in agent.system_prompt

    def test_auto_mode_instructions(self, mock_llm_provider: MagicMock):
        """Test auto mode instructions."""
        config = AgentConfig(
            agent_id="test-agent",
            model="claude-3-5-sonnet",
            llm_provider=mock_llm_provider,
            mode="auto",
        )
        agent = ConcreteTestAgent(config)

        assert "auto" in agent.system_prompt.lower() or "Auto" in agent.system_prompt

    def test_sovereign_mode_instructions(self, mock_llm_provider: MagicMock):
        """Test sovereign mode instructions."""
        config = AgentConfig(
            agent_id="test-agent",
            model="claude-3-5-sonnet",
            llm_provider=mock_llm_provider,
            mode="sovereign",
        )
        agent = ConcreteTestAgent(config)

        assert "sovereign" in agent.system_prompt.lower() or "Sovereign" in agent.system_prompt


class TestAgentToolFiltering:
    """Test tool filtering based on mode."""

    @pytest.fixture
    def mock_llm_provider(self) -> MagicMock:
        """Create mock LLM provider."""
        return MagicMock()

    def test_plan_mode_filters_write_tools(self, mock_llm_provider: MagicMock):
        """Test that plan mode filters out write tools."""
        # Create a custom agent with write tools
        class AgentWithWriteTools(BaseAgent):
            def _get_system_prompt(self) -> str:
                return "Test"

            def _get_tools(self) -> list[Tool]:
                return [
                    Tool(name="read_file", description="Read", parameters={}),
                    Tool(name="write_file", description="Write", parameters={}),
                    Tool(name="create_file", description="Create", parameters={}),
                    Tool(name="execute_command", description="Run", parameters={}),
                ]

        config = AgentConfig(
            agent_id="test-agent",
            model="claude-3-5-sonnet",
            llm_provider=mock_llm_provider,
            mode="plan",
        )
        agent = AgentWithWriteTools(config)

        # Should only have read_file
        tool_names = [t.name for t in agent.tools]
        assert "read_file" in tool_names
        assert "write_file" not in tool_names
        assert "create_file" not in tool_names
        assert "execute_command" not in tool_names

    def test_auto_mode_keeps_all_tools(self, mock_llm_provider: MagicMock):
        """Test that auto mode keeps all tools."""

        class AgentWithAllTools(BaseAgent):
            def _get_system_prompt(self) -> str:
                return "Test"

            def _get_tools(self) -> list[Tool]:
                return [
                    Tool(name="read_file", description="Read", parameters={}),
                    Tool(name="write_file", description="Write", parameters={}),
                    Tool(name="execute_command", description="Run", parameters={}),
                ]

        config = AgentConfig(
            agent_id="test-agent",
            model="claude-3-5-sonnet",
            llm_provider=mock_llm_provider,
            mode="auto",
        )
        agent = AgentWithAllTools(config)

        # Should have all tools
        tool_names = [t.name for t in agent.tools]
        assert "read_file" in tool_names
        assert "write_file" in tool_names
        assert "execute_command" in tool_names


class TestAgentMemoryContext:
    """Test _get_memory_context method."""

    @pytest.fixture
    def mock_llm_provider(self) -> MagicMock:
        """Create mock LLM provider."""
        return MagicMock()

    @pytest.fixture
    def agent(self, mock_llm_provider: MagicMock) -> ConcreteTestAgent:
        """Create test agent with session and user."""
        config = AgentConfig(
            agent_id="test-agent",
            model="claude-3-5-sonnet",
            llm_provider=mock_llm_provider,
            session_id="session-123",
            user_id="user-456",
        )
        return ConcreteTestAgent(config)

    async def test_get_memory_context_returns_formatted_memories(
        self, agent: ConcreteTestAgent
    ):
        """Test _get_memory_context returns formatted string."""
        mock_memory = MagicMock()
        mock_memory.memory_type = "fact"
        mock_memory.content = "User prefers Python"

        with patch("src.agents.base.get_knowledge_base") as mock_kb:
            mock_kb.return_value.get_relevant_context = AsyncMock(
                return_value=[mock_memory]
            )

            result = await agent._get_memory_context("test message")

            assert result is not None
            assert "Relevant Memories" in result
            assert "User prefers Python" in result

    async def test_get_memory_context_returns_none_without_session(
        self, mock_llm_provider: MagicMock
    ):
        """Test _get_memory_context returns None without session."""
        config = AgentConfig(
            agent_id="test-agent",
            model="claude-3-5-sonnet",
            llm_provider=mock_llm_provider,
            # No session_id or user_id
        )
        agent = ConcreteTestAgent(config)

        result = await agent._get_memory_context("test message")

        assert result is None

    async def test_get_memory_context_returns_none_on_empty_memories(
        self, agent: ConcreteTestAgent
    ):
        """Test _get_memory_context returns None when no memories found."""
        with patch("src.agents.base.get_knowledge_base") as mock_kb:
            mock_kb.return_value.get_relevant_context = AsyncMock(return_value=[])

            result = await agent._get_memory_context("test message")

            assert result is None

    async def test_get_memory_context_handles_error_gracefully(
        self, agent: ConcreteTestAgent
    ):
        """Test _get_memory_context handles errors gracefully."""
        with patch("src.agents.base.get_knowledge_base") as mock_kb:
            mock_kb.return_value.get_relevant_context = AsyncMock(
                side_effect=Exception("DB error")
            )

            result = await agent._get_memory_context("test message")

            # Should return None, not raise
            assert result is None


class TestAgentUsageTracking:
    """Test token usage tracking."""

    @pytest.fixture
    def mock_llm_provider(self) -> MagicMock:
        """Create mock LLM provider with provider attribute."""
        mock = MagicMock()
        mock.provider = "anthropic"
        mock.complete = AsyncMock(return_value={
            "content": "Response",
            "tool_calls": [],
            "usage": {"input_tokens": 100, "output_tokens": 50, "total_tokens": 150},
        })
        return mock

    async def test_tracks_usage_for_external_provider(
        self, mock_llm_provider: MagicMock
    ):
        """Test usage tracking for external providers (anthropic, openai)."""
        config = AgentConfig(
            agent_id="test-agent",
            model="claude-3-5-sonnet",
            llm_provider=mock_llm_provider,
            user_id="user-123",
        )
        agent = ConcreteTestAgent(config)

        with patch("src.agents.base.get_db_context"), \
             patch("src.agents.base.update_agent_status", new_callable=AsyncMock), \
             patch("src.agents.base.save_message", new_callable=AsyncMock), \
             patch("src.agents.base.create_context_manager_with_settings", new_callable=AsyncMock, return_value=None), \
             patch("src.agents.base.get_knowledge_base") as mock_kb, \
             patch("src.agents.base.get_retriever") as mock_retriever, \
             patch("src.agents.base.get_usage_tracker") as mock_tracker:

            mock_kb.return_value.get_relevant_context = AsyncMock(return_value=[])
            mock_retriever.return_value.auto_extract_memories = AsyncMock(return_value=[])
            mock_tracker.return_value = MagicMock()
            mock_tracker.return_value.record_token_usage = AsyncMock()

            await agent.execute("Test", persist=False)

            # Should track usage
            mock_tracker.return_value.record_token_usage.assert_called_once()
            call_args = mock_tracker.return_value.record_token_usage.call_args[0][0]
            assert call_args.usage_source == "external"

    async def test_tracks_usage_for_local_provider(self, mock_llm_provider: MagicMock):
        """Test usage tracking for local providers (ollama, lmstudio)."""
        mock_llm_provider.provider = "ollama"

        config = AgentConfig(
            agent_id="test-agent",
            model="llama3",
            llm_provider=mock_llm_provider,
            user_id="user-123",
        )
        agent = ConcreteTestAgent(config)

        with patch("src.agents.base.get_db_context"), \
             patch("src.agents.base.update_agent_status", new_callable=AsyncMock), \
             patch("src.agents.base.save_message", new_callable=AsyncMock), \
             patch("src.agents.base.create_context_manager_with_settings", new_callable=AsyncMock, return_value=None), \
             patch("src.agents.base.get_knowledge_base") as mock_kb, \
             patch("src.agents.base.get_retriever") as mock_retriever, \
             patch("src.agents.base.get_usage_tracker") as mock_tracker:

            mock_kb.return_value.get_relevant_context = AsyncMock(return_value=[])
            mock_retriever.return_value.auto_extract_memories = AsyncMock(return_value=[])
            mock_tracker.return_value = MagicMock()
            mock_tracker.return_value.record_token_usage = AsyncMock()

            await agent.execute("Test", persist=False)

            # Should track as local
            call_args = mock_tracker.return_value.record_token_usage.call_args[0][0]
            assert call_args.usage_source == "local"

    async def test_tracks_usage_for_vertex_provider(self, mock_llm_provider: MagicMock):
        """Test usage tracking for vertex provider (included)."""
        mock_llm_provider.provider = "vertex"

        config = AgentConfig(
            agent_id="test-agent",
            model="gemini-pro",
            llm_provider=mock_llm_provider,
            user_id="user-123",
        )
        agent = ConcreteTestAgent(config)

        with patch("src.agents.base.get_db_context"), \
             patch("src.agents.base.update_agent_status", new_callable=AsyncMock), \
             patch("src.agents.base.save_message", new_callable=AsyncMock), \
             patch("src.agents.base.create_context_manager_with_settings", new_callable=AsyncMock, return_value=None), \
             patch("src.agents.base.get_knowledge_base") as mock_kb, \
             patch("src.agents.base.get_retriever") as mock_retriever, \
             patch("src.agents.base.get_usage_tracker") as mock_tracker:

            mock_kb.return_value.get_relevant_context = AsyncMock(return_value=[])
            mock_retriever.return_value.auto_extract_memories = AsyncMock(return_value=[])
            mock_tracker.return_value = MagicMock()
            mock_tracker.return_value.record_token_usage = AsyncMock()

            await agent.execute("Test", persist=False)

            # Should track as included
            call_args = mock_tracker.return_value.record_token_usage.call_args[0][0]
            assert call_args.usage_source == "included"


class TestModeSwitchEvent:
    """Test ModeSwitchEvent dataclass."""

    def test_mode_switch_event_creation(self):
        """Test creating ModeSwitchEvent."""
        from src.agents.base import ModeSwitchEvent

        event = ModeSwitchEvent(
            agent_id="agent-123",
            session_id="session-456",
            old_mode="ask",
            new_mode="auto",
            trigger_phrase="go ahead",
            reason="User requested implementation",
            auto_revert=True,
        )

        assert event.agent_id == "agent-123"
        assert event.session_id == "session-456"
        assert event.old_mode == "ask"
        assert event.new_mode == "auto"
        assert event.trigger_phrase == "go ahead"
        assert event.reason == "User requested implementation"
        assert event.auto_revert is True


class TestAgentResponseDataclass:
    """Test AgentResponse dataclass."""

    def test_agent_response_creation(self):
        """Test creating AgentResponse."""
        from src.agents.base import AgentResponse

        response = AgentResponse(
            content="Hello world",
            tool_calls=[{"id": "tc-1", "name": "test"}],
            tokens_used=100,
            message_id="msg-123",
        )

        assert response.content == "Hello world"
        assert len(response.tool_calls) == 1
        assert response.tokens_used == 100
        assert response.message_id == "msg-123"

    def test_agent_response_defaults(self):
        """Test AgentResponse default values."""
        from src.agents.base import AgentResponse

        response = AgentResponse(content="Test")

        assert response.content == "Test"
        assert response.tool_calls == []
        assert response.tokens_used == 0
        assert response.message_id is None
