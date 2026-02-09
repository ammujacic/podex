"""Tests for custom agent module.

Tests cover:
- Tool loading functions
- AgentTemplateConfig dataclass
- CustomAgentContext dataclass
- CustomAgentInitConfig dataclass
- CustomAgent class
"""

import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from src.agents.custom import (
    AgentTemplateConfig,
    CustomAgent,
    CustomAgentContext,
    CustomAgentInitConfig,
    _get_cached_tools,
)
from src.agents.base import Tool


class TestToolLoadingFunctions:
    """Test tool loading functions."""

    def test_get_cached_tools_returns_dict(self):
        """Test _get_cached_tools returns a dictionary."""
        result = _get_cached_tools()
        assert isinstance(result, dict)

    def test_get_cached_tools_empty_when_not_loaded(self):
        """Test _get_cached_tools returns empty dict when cache is None."""
        import src.agents.custom as custom_module
        original_cache = custom_module._tools_cache

        try:
            custom_module._tools_cache = None
            result = _get_cached_tools()
            assert result == {}
        finally:
            custom_module._tools_cache = original_cache

    def test_get_cached_tools_returns_cache(self):
        """Test _get_cached_tools returns cached tools."""
        import src.agents.custom as custom_module
        original_cache = custom_module._tools_cache

        try:
            custom_module._tools_cache = {
                "read_file": Tool(
                    name="read_file",
                    description="Read file",
                    parameters={"type": "object", "properties": {"path": {"type": "string"}}},
                )
            }
            result = _get_cached_tools()
            assert "read_file" in result
            assert result["read_file"].name == "read_file"
        finally:
            custom_module._tools_cache = original_cache

    async def test_load_tools_from_config(self):
        """Test _load_tools_from_config loads tools from Redis."""
        from src.agents.custom import _load_tools_from_config
        import src.agents.custom as custom_module

        original_cache = custom_module._tools_cache

        try:
            custom_module._tools_cache = None

            mock_tool_def = MagicMock()
            mock_tool_def.name = "test_tool"
            mock_tool_def.description = "A test tool"
            mock_tool_def.parameters = {"type": "object", "properties": {}}

            with patch("src.agents.custom.get_config_reader") as mock_reader:
                mock_config_reader = MagicMock()
                mock_config_reader.get_all_tools = AsyncMock(return_value=[mock_tool_def])
                mock_reader.return_value = mock_config_reader

                result = await _load_tools_from_config()

                assert "test_tool" in result
                assert result["test_tool"].name == "test_tool"
        finally:
            custom_module._tools_cache = original_cache


class TestAgentTemplateConfig:
    """Test AgentTemplateConfig dataclass."""

    def test_basic_creation(self):
        """Test creating basic config."""
        config = AgentTemplateConfig(
            name="test-agent",
            system_prompt="You are a helpful assistant.",
            allowed_tools=["read_file", "write_file"],
            model="claude-3-5-sonnet",
        )

        assert config.name == "test-agent"
        assert config.system_prompt == "You are a helpful assistant."
        assert config.allowed_tools == ["read_file", "write_file"]
        assert config.model == "claude-3-5-sonnet"
        assert config.temperature is None
        assert config.max_tokens is None
        assert config.config is None

    def test_with_optional_fields(self):
        """Test creating config with optional fields."""
        config = AgentTemplateConfig(
            name="test-agent",
            system_prompt="You are a helpful assistant.",
            allowed_tools=["read_file"],
            model="claude-3-5-sonnet",
            temperature=0.5,
            max_tokens=1000,
            config={"custom_key": "custom_value"},
        )

        assert config.temperature == 0.5
        assert config.max_tokens == 1000
        assert config.config == {"custom_key": "custom_value"}

    def test_empty_tools_list(self):
        """Test config with empty tools list."""
        config = AgentTemplateConfig(
            name="readonly-agent",
            system_prompt="You are a readonly assistant.",
            allowed_tools=[],
            model="claude-3-5-sonnet",
        )

        assert config.allowed_tools == []


class TestCustomAgentContext:
    """Test CustomAgentContext dataclass."""

    def test_default_values(self):
        """Test default values."""
        context = CustomAgentContext()

        assert context.workspace_path is None
        assert context.session_id is None
        assert context.user_id is None

    def test_with_string_workspace_path(self):
        """Test with string workspace path."""
        context = CustomAgentContext(
            workspace_path="/home/user/workspace",
            session_id="session-123",
            user_id="user-456",
        )

        assert context.workspace_path == "/home/user/workspace"
        assert context.session_id == "session-123"
        assert context.user_id == "user-456"

    def test_with_path_workspace_path(self):
        """Test with Path workspace path."""
        context = CustomAgentContext(
            workspace_path=Path("/home/user/workspace"),
        )

        assert context.workspace_path == Path("/home/user/workspace")


class TestCustomAgentInitConfig:
    """Test CustomAgentInitConfig dataclass."""

    def test_basic_creation(self):
        """Test creating basic init config."""
        mock_llm_provider = MagicMock()
        template_config = AgentTemplateConfig(
            name="test-agent",
            system_prompt="You are helpful.",
            allowed_tools=["read_file"],
            model="claude-3-5-sonnet",
        )

        init_config = CustomAgentInitConfig(
            agent_id="agent-123",
            model="claude-3-5-sonnet",
            llm_provider=mock_llm_provider,
            template_config=template_config,
        )

        assert init_config.agent_id == "agent-123"
        assert init_config.model == "claude-3-5-sonnet"
        assert init_config.llm_provider == mock_llm_provider
        assert init_config.template_config == template_config
        assert init_config.context is None
        assert init_config.mcp_registry is None
        assert init_config.user_id is None

    def test_with_all_fields(self):
        """Test creating init config with all fields."""
        mock_llm_provider = MagicMock()
        mock_mcp_registry = MagicMock()
        template_config = AgentTemplateConfig(
            name="test-agent",
            system_prompt="You are helpful.",
            allowed_tools=["read_file"],
            model="claude-3-5-sonnet",
        )
        context = CustomAgentContext(
            workspace_path="/workspace",
            session_id="session-123",
            user_id="user-456",
        )

        init_config = CustomAgentInitConfig(
            agent_id="agent-123",
            model="claude-3-5-sonnet",
            llm_provider=mock_llm_provider,
            template_config=template_config,
            context=context,
            mcp_registry=mock_mcp_registry,
            user_id="user-789",
        )

        assert init_config.context == context
        assert init_config.mcp_registry == mock_mcp_registry
        assert init_config.user_id == "user-789"


class TestCustomAgent:
    """Test CustomAgent class."""

    @pytest.fixture
    def mock_llm_provider(self):
        """Create mock LLM provider."""
        return MagicMock()

    @pytest.fixture
    def mock_tools_cache(self):
        """Create mock tools cache and inject it."""
        import src.agents.custom as custom_module

        tools = {
            "read_file": Tool(
                name="read_file",
                description="Read file",
                parameters={"type": "object", "properties": {"path": {"type": "string"}}},
            ),
            "write_file": Tool(
                name="write_file",
                description="Write file",
                parameters={"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}}},
            ),
            "search_code": Tool(
                name="search_code",
                description="Search code",
                parameters={"type": "object", "properties": {"query": {"type": "string"}}},
            ),
            "run_command": Tool(
                name="run_command",
                description="Run command",
                parameters={"type": "object", "properties": {"command": {"type": "string"}}},
            ),
        }

        original_cache = custom_module._tools_cache
        custom_module._tools_cache = tools
        yield tools
        custom_module._tools_cache = original_cache

    @pytest.fixture
    def template_config(self):
        """Create template config."""
        return AgentTemplateConfig(
            name="test-agent",
            system_prompt="You are a test assistant.",
            allowed_tools=["read_file", "write_file", "search_code"],
            model="claude-3-5-sonnet",
            temperature=0.7,
            max_tokens=2000,
        )

    @pytest.fixture
    def init_config(self, mock_llm_provider, template_config, tmp_path):
        """Create init config."""
        return CustomAgentInitConfig(
            agent_id="agent-123",
            model="claude-3-opus",  # Different from template
            llm_provider=mock_llm_provider,
            template_config=template_config,
            context=CustomAgentContext(
                workspace_path=str(tmp_path),  # Use tmp_path for valid directory
                session_id="session-123",
                user_id="user-456",
            ),
        )

    def test_agent_initialization(self, init_config, mock_tools_cache):
        """Test agent initialization."""
        with patch("src.agents.base.ToolExecutor"):
            agent = CustomAgent(init_config)

            assert agent._template_config == init_config.template_config
            # Agent should use template's model
            assert agent.model == "claude-3-5-sonnet"
            assert agent.agent_id == "agent-123"

    def test_get_system_prompt(self, init_config, mock_tools_cache):
        """Test _get_system_prompt returns template prompt."""
        with patch("src.agents.base.ToolExecutor"):
            agent = CustomAgent(init_config)

            prompt = agent._get_system_prompt()

            assert prompt == "You are a test assistant."

    def test_get_tools_filters_by_allowed(self, init_config, mock_tools_cache):
        """Test _get_tools only returns allowed tools."""
        with patch("src.agents.base.ToolExecutor"):
            agent = CustomAgent(init_config)

            tools = agent._get_tools()

            tool_names = [t.name for t in tools]
            assert "read_file" in tool_names
            assert "write_file" in tool_names
            assert "search_code" in tool_names
            assert "run_command" not in tool_names  # Not in allowed_tools
            assert len(tools) == 3

    def test_get_tools_with_unknown_tool(self, mock_llm_provider, mock_tools_cache):
        """Test _get_tools skips unknown tools."""
        template_config = AgentTemplateConfig(
            name="test-agent",
            system_prompt="Test prompt",
            allowed_tools=["read_file", "unknown_tool", "write_file"],
            model="claude-3-5-sonnet",
        )
        init_config = CustomAgentInitConfig(
            agent_id="agent-123",
            model="claude-3-5-sonnet",
            llm_provider=mock_llm_provider,
            template_config=template_config,
        )

        with patch("src.agents.base.ToolExecutor"):
            agent = CustomAgent(init_config)
            tools = agent._get_tools()

            tool_names = [t.name for t in tools]
            assert "read_file" in tool_names
            assert "write_file" in tool_names
            assert "unknown_tool" not in tool_names
            assert len(tools) == 2

    def test_temperature_property(self, init_config, mock_tools_cache):
        """Test temperature property returns template value."""
        with patch("src.agents.base.ToolExecutor"):
            agent = CustomAgent(init_config)

            assert agent.temperature == 0.7

    def test_max_tokens_property(self, init_config, mock_tools_cache):
        """Test max_tokens property returns template value."""
        with patch("src.agents.base.ToolExecutor"):
            agent = CustomAgent(init_config)

            assert agent.max_tokens == 2000

    def test_temperature_none_when_not_set(self, mock_llm_provider, mock_tools_cache):
        """Test temperature returns None when not set in template."""
        template_config = AgentTemplateConfig(
            name="test-agent",
            system_prompt="Test prompt",
            allowed_tools=["read_file"],
            model="claude-3-5-sonnet",
        )
        init_config = CustomAgentInitConfig(
            agent_id="agent-123",
            model="claude-3-5-sonnet",
            llm_provider=mock_llm_provider,
            template_config=template_config,
        )

        with patch("src.agents.base.ToolExecutor"):
            agent = CustomAgent(init_config)

            assert agent.temperature is None
            assert agent.max_tokens is None

    def test_uses_template_model_when_specified(self, mock_llm_provider, mock_tools_cache):
        """Test agent uses template's model over init_config model."""
        template_config = AgentTemplateConfig(
            name="test-agent",
            system_prompt="Test prompt",
            allowed_tools=["read_file"],
            model="claude-3-5-sonnet",  # Template specifies model
        )
        init_config = CustomAgentInitConfig(
            agent_id="agent-123",
            model="claude-3-opus",  # Different model in init_config
            llm_provider=mock_llm_provider,
            template_config=template_config,
        )

        with patch("src.agents.base.ToolExecutor"):
            agent = CustomAgent(init_config)

            # Should use template's model
            assert agent.model == "claude-3-5-sonnet"

    def test_uses_init_model_when_template_empty(self, mock_llm_provider, mock_tools_cache):
        """Test agent uses init_config model when template model is empty."""
        template_config = AgentTemplateConfig(
            name="test-agent",
            system_prompt="Test prompt",
            allowed_tools=["read_file"],
            model="",  # Empty model in template
        )
        init_config = CustomAgentInitConfig(
            agent_id="agent-123",
            model="claude-3-opus",
            llm_provider=mock_llm_provider,
            template_config=template_config,
        )

        with patch("src.agents.base.ToolExecutor"):
            agent = CustomAgent(init_config)

            # Should use init_config's model since template is empty
            assert agent.model == "claude-3-opus"

    def test_user_id_from_init_config(self, mock_llm_provider, mock_tools_cache):
        """Test user_id is taken from init_config when provided."""
        template_config = AgentTemplateConfig(
            name="test-agent",
            system_prompt="Test prompt",
            allowed_tools=["read_file"],
            model="claude-3-5-sonnet",
        )
        context = CustomAgentContext(
            user_id="context-user",  # User ID in context
        )
        init_config = CustomAgentInitConfig(
            agent_id="agent-123",
            model="claude-3-5-sonnet",
            llm_provider=mock_llm_provider,
            template_config=template_config,
            context=context,
            user_id="init-config-user",  # User ID in init_config
        )

        with patch("src.agents.base.ToolExecutor"):
            agent = CustomAgent(init_config)

            # Should prefer init_config's user_id
            assert agent.user_id == "init-config-user"

    def test_user_id_from_context(self, mock_llm_provider, mock_tools_cache):
        """Test user_id is taken from context when not in init_config."""
        template_config = AgentTemplateConfig(
            name="test-agent",
            system_prompt="Test prompt",
            allowed_tools=["read_file"],
            model="claude-3-5-sonnet",
        )
        context = CustomAgentContext(
            user_id="context-user",
        )
        init_config = CustomAgentInitConfig(
            agent_id="agent-123",
            model="claude-3-5-sonnet",
            llm_provider=mock_llm_provider,
            template_config=template_config,
            context=context,
            user_id=None,  # No user_id in init_config
        )

        with patch("src.agents.base.ToolExecutor"):
            agent = CustomAgent(init_config)

            # Should use context's user_id
            assert agent.user_id == "context-user"

    def test_empty_allowed_tools(self, mock_llm_provider, mock_tools_cache):
        """Test agent with no allowed tools."""
        template_config = AgentTemplateConfig(
            name="test-agent",
            system_prompt="Test prompt",
            allowed_tools=[],
            model="claude-3-5-sonnet",
        )
        init_config = CustomAgentInitConfig(
            agent_id="agent-123",
            model="claude-3-5-sonnet",
            llm_provider=mock_llm_provider,
            template_config=template_config,
        )

        with patch("src.agents.base.ToolExecutor"):
            agent = CustomAgent(init_config)
            tools = agent._get_tools()

            assert tools == []
