"""Tests for custom agent module.

Tests cover:
- AVAILABLE_TOOLS registry
- AgentTemplateConfig dataclass
- CustomAgentContext dataclass
- CustomAgentInitConfig dataclass
- CustomAgent class
"""

import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch

from src.agents.custom import (
    AVAILABLE_TOOLS,
    AgentTemplateConfig,
    CustomAgent,
    CustomAgentContext,
    CustomAgentInitConfig,
)
from src.agents.base import Tool


class TestAvailableToolsRegistry:
    """Test AVAILABLE_TOOLS registry."""

    def test_available_tools_is_dict(self):
        """Test that AVAILABLE_TOOLS is a dictionary."""
        assert isinstance(AVAILABLE_TOOLS, dict)

    def test_available_tools_not_empty(self):
        """Test that AVAILABLE_TOOLS has tools."""
        assert len(AVAILABLE_TOOLS) > 0

    def test_all_tools_are_tool_instances(self):
        """Test that all values are Tool instances."""
        for name, tool in AVAILABLE_TOOLS.items():
            assert isinstance(tool, Tool), f"{name} is not a Tool instance"
            assert tool.name == name, f"Tool name mismatch: {tool.name} != {name}"

    def test_read_file_tool_exists(self):
        """Test read_file tool is registered."""
        assert "read_file" in AVAILABLE_TOOLS
        tool = AVAILABLE_TOOLS["read_file"]
        assert tool.name == "read_file"
        assert "path" in tool.parameters["properties"]

    def test_write_file_tool_exists(self):
        """Test write_file tool is registered."""
        assert "write_file" in AVAILABLE_TOOLS
        tool = AVAILABLE_TOOLS["write_file"]
        assert tool.name == "write_file"
        assert "path" in tool.parameters["properties"]
        assert "content" in tool.parameters["properties"]

    def test_search_code_tool_exists(self):
        """Test search_code tool is registered."""
        assert "search_code" in AVAILABLE_TOOLS
        tool = AVAILABLE_TOOLS["search_code"]
        assert "query" in tool.parameters["properties"]

    def test_run_command_tool_exists(self):
        """Test run_command tool is registered."""
        assert "run_command" in AVAILABLE_TOOLS
        tool = AVAILABLE_TOOLS["run_command"]
        assert "command" in tool.parameters["properties"]

    def test_list_directory_tool_exists(self):
        """Test list_directory tool is registered."""
        assert "list_directory" in AVAILABLE_TOOLS
        tool = AVAILABLE_TOOLS["list_directory"]
        assert "path" in tool.parameters["properties"]

    def test_create_task_tool_exists(self):
        """Test create_task tool is registered."""
        assert "create_task" in AVAILABLE_TOOLS
        tool = AVAILABLE_TOOLS["create_task"]
        assert "agent_role" in tool.parameters["properties"]
        assert "description" in tool.parameters["properties"]

    def test_delegate_task_tool_exists(self):
        """Test delegate_task tool is registered."""
        assert "delegate_task" in AVAILABLE_TOOLS
        tool = AVAILABLE_TOOLS["delegate_task"]
        assert "agent_role" in tool.parameters["properties"]
        enum_values = tool.parameters["properties"]["agent_role"]["enum"]
        assert "coder" in enum_values
        assert "reviewer" in enum_values
        assert "tester" in enum_values

    def test_get_task_status_tool_exists(self):
        """Test get_task_status tool is registered."""
        assert "get_task_status" in AVAILABLE_TOOLS
        tool = AVAILABLE_TOOLS["get_task_status"]
        assert "task_id" in tool.parameters["properties"]

    def test_wait_for_tasks_tool_exists(self):
        """Test wait_for_tasks tool is registered."""
        assert "wait_for_tasks" in AVAILABLE_TOOLS
        tool = AVAILABLE_TOOLS["wait_for_tasks"]
        assert "task_ids" in tool.parameters["properties"]

    def test_git_tools_exist(self):
        """Test git tools are registered."""
        git_tools = ["git_status", "git_diff", "git_commit", "git_push", "git_branch", "git_log"]
        for tool_name in git_tools:
            assert tool_name in AVAILABLE_TOOLS, f"{tool_name} not found"

    def test_glob_files_tool_exists(self):
        """Test glob_files tool is registered."""
        assert "glob_files" in AVAILABLE_TOOLS
        tool = AVAILABLE_TOOLS["glob_files"]
        assert "pattern" in tool.parameters["properties"]

    def test_apply_patch_tool_exists(self):
        """Test apply_patch tool is registered."""
        assert "apply_patch" in AVAILABLE_TOOLS
        tool = AVAILABLE_TOOLS["apply_patch"]
        assert "path" in tool.parameters["properties"]
        assert "patch" in tool.parameters["properties"]

    def test_fetch_url_tool_exists(self):
        """Test fetch_url tool is registered."""
        assert "fetch_url" in AVAILABLE_TOOLS
        tool = AVAILABLE_TOOLS["fetch_url"]
        assert "url" in tool.parameters["properties"]

    def test_grep_tool_exists(self):
        """Test grep tool is registered."""
        assert "grep" in AVAILABLE_TOOLS
        tool = AVAILABLE_TOOLS["grep"]
        assert "pattern" in tool.parameters["properties"]

    def test_skill_tools_exist(self):
        """Test skill management tools are registered."""
        skill_tools = ["list_skills", "get_skill", "match_skills", "execute_skill", "recommend_skills"]
        for tool_name in skill_tools:
            assert tool_name in AVAILABLE_TOOLS, f"{tool_name} not found"


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

    def test_agent_initialization(self, init_config):
        """Test agent initialization."""
        with patch("src.agents.base.ToolExecutor"):
            agent = CustomAgent(init_config)

            assert agent._template_config == init_config.template_config
            # Agent should use template's model
            assert agent.model == "claude-3-5-sonnet"
            assert agent.agent_id == "agent-123"

    def test_get_system_prompt(self, init_config):
        """Test _get_system_prompt returns template prompt."""
        with patch("src.agents.base.ToolExecutor"):
            agent = CustomAgent(init_config)

            prompt = agent._get_system_prompt()

            assert prompt == "You are a test assistant."

    def test_get_tools_filters_by_allowed(self, init_config):
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

    def test_get_tools_with_unknown_tool(self, mock_llm_provider):
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

    def test_temperature_property(self, init_config):
        """Test temperature property returns template value."""
        with patch("src.agents.base.ToolExecutor"):
            agent = CustomAgent(init_config)

            assert agent.temperature == 0.7

    def test_max_tokens_property(self, init_config):
        """Test max_tokens property returns template value."""
        with patch("src.agents.base.ToolExecutor"):
            agent = CustomAgent(init_config)

            assert agent.max_tokens == 2000

    def test_temperature_none_when_not_set(self, mock_llm_provider):
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

    def test_uses_template_model_when_specified(self, mock_llm_provider):
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

    def test_uses_init_model_when_template_empty(self, mock_llm_provider):
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

    def test_user_id_from_init_config(self, mock_llm_provider):
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

    def test_user_id_from_context(self, mock_llm_provider):
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

    def test_empty_allowed_tools(self, mock_llm_provider):
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
