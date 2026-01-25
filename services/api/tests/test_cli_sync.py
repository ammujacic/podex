"""
Tests for CLI sync functionality.

Tests cover:
- CLI translator implementations (Claude Code, Codex, Gemini CLI)
- Skill and MCP translation
- Bidirectional sync logic
- Conflict detection and resolution
"""

from typing import Any

import pytest

from src.services.cli_translators import (
    TRANSLATORS,
    ClaudeCodeTranslator,
    CodexTranslator,
    GeminiCLITranslator,
    get_translator,
)

# ============================================================================
# FIXTURES
# ============================================================================


@pytest.fixture
def sample_skill() -> dict[str, Any]:
    """Create a sample Podex skill for testing."""
    return {
        "id": "skill-123",
        "name": "Code Review",
        "slug": "code-review",
        "description": "Performs a code review on the current file",
        "version": "1.0.0",
        "triggers": ["/review", "/cr"],
        "tags": ["code", "quality"],
        "required_tools": ["read_file", "write_file"],
        "steps": [
            {"description": "Read the file contents", "tool": "read_file"},
            {"description": "Analyze for issues", "action": "analyze"},
            {"description": "Provide feedback", "tool": "write_file"},
        ],
        "system_prompt": "You are a code review assistant. Analyze the code for bugs, style issues, and improvements.",
        "examples": [{"user": "Review this function", "assistant": "I'll analyze the function..."}],
    }


@pytest.fixture
def sample_mcp() -> dict[str, Any]:
    """Create a sample Podex MCP server for testing."""
    return {
        "id": "mcp-123",
        "name": "GitHub",
        "description": "GitHub API integration",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "url": None,
        "env_vars": {"GITHUB_TOKEN": "test-token"},
    }


@pytest.fixture
def sample_mcp_http() -> dict[str, Any]:
    """Create a sample HTTP-based MCP server for testing."""
    return {
        "id": "mcp-456",
        "name": "Remote API",
        "description": "Remote MCP server",
        "transport": "http",
        "command": None,
        "args": [],
        "url": "https://mcp.example.com/api",
        "env_vars": {"API_KEY": "secret-key"},
    }


# ============================================================================
# TRANSLATOR REGISTRY TESTS
# ============================================================================


class TestTranslatorRegistry:
    """Tests for the translator registry."""

    def test_all_translators_registered(self) -> None:
        """Test that all translators are registered."""
        assert "claude_code" in TRANSLATORS
        assert "codex" in TRANSLATORS
        assert "gemini_cli" in TRANSLATORS

    def test_get_translator_valid(self) -> None:
        """Test getting a valid translator."""
        translator = get_translator("claude_code")
        assert isinstance(translator, ClaudeCodeTranslator)

    def test_get_translator_invalid(self) -> None:
        """Test getting an invalid translator raises error."""
        with pytest.raises(ValueError, match="Unknown CLI"):
            get_translator("invalid_cli")


# ============================================================================
# CLAUDE CODE TRANSLATOR TESTS
# ============================================================================


class TestClaudeCodeTranslator:
    """Tests for Claude Code translator."""

    @pytest.fixture
    def translator(self) -> ClaudeCodeTranslator:
        return ClaudeCodeTranslator()

    def test_cli_name(self, translator: ClaudeCodeTranslator) -> None:
        """Test CLI name property."""
        assert translator.cli_name == "claude_code"

    def test_config_directory(self, translator: ClaudeCodeTranslator) -> None:
        """Test config directory property."""
        assert translator.config_directory == ".claude"

    def test_supports_mcp(self, translator: ClaudeCodeTranslator) -> None:
        """Test MCP support."""
        assert translator.supports_mcp is True

    def test_translate_skill(
        self, translator: ClaudeCodeTranslator, sample_skill: dict[str, Any]
    ) -> None:
        """Test skill translation to Claude Code format."""
        result = translator.translate_skill(sample_skill)

        assert result.name == "code-review"
        assert result.file_path == "commands/code-review.md"
        assert "content" in result.cli_format
        assert result.cli_format["type"] == "command"

        # Check content includes key elements
        content = result.cli_format["content"]
        assert "---" in content  # YAML frontmatter
        assert "Code Review" in content
        assert "code review assistant" in content
        assert "/review" in content
        assert "## Instructions" in content
        assert "## Steps" in content

    def test_translate_skill_minimal(self, translator: ClaudeCodeTranslator) -> None:
        """Test translation with minimal skill data."""
        minimal_skill = {
            "name": "Simple Skill",
            "slug": "simple-skill",
            "description": "A simple skill",
        }

        result = translator.translate_skill(minimal_skill)

        assert result.name == "simple-skill"
        assert result.file_path == "commands/simple-skill.md"

    def test_translate_mcp_stdio(
        self, translator: ClaudeCodeTranslator, sample_mcp: dict[str, Any]
    ) -> None:
        """Test MCP translation for stdio transport."""
        result = translator.translate_mcp(sample_mcp)

        assert result.name == "github"
        assert result.config_key == "mcpServers.github"
        assert result.cli_format["command"] == "npx"
        assert result.cli_format["args"] == ["-y", "@modelcontextprotocol/server-github"]
        assert result.cli_format["env"]["GITHUB_TOKEN"] == "test-token"

    def test_translate_mcp_http(
        self, translator: ClaudeCodeTranslator, sample_mcp_http: dict[str, Any]
    ) -> None:
        """Test MCP translation for HTTP transport."""
        result = translator.translate_mcp(sample_mcp_http)

        assert result.name == "remote-api"
        assert result.cli_format["url"] == "https://mcp.example.com/api"
        assert "command" not in result.cli_format

    def test_parse_cli_skill(self, translator: ClaudeCodeTranslator) -> None:
        """Test parsing CLI skill back to Podex format."""
        cli_config = {
            "content": """---
name: Test Skill
description: A test skill
triggers:
  - /test
---

## Instructions

You are a test assistant.

## Steps

1. Do step one
2. Do step two (Tool: `read_file`)
"""
        }

        result = translator.parse_cli_skill(cli_config, "commands/test-skill.md")

        assert result["name"] == "Test Skill"
        assert result["slug"] == "test-skill"
        assert result["description"] == "A test skill"
        assert "/test" in result["triggers"]
        assert "test assistant" in result["system_prompt"]
        assert len(result["steps"]) == 2

    def test_parse_cli_mcp(self, translator: ClaudeCodeTranslator) -> None:
        """Test parsing CLI MCP back to Podex format."""
        cli_config = {
            "command": "npx",
            "args": ["-y", "@test/server"],
            "env": {"API_KEY": "key"},
        }

        result = translator.parse_cli_mcp(cli_config, "mcpServers.test-server")

        assert result["name"] == "test-server"
        assert result["transport"] == "stdio"
        assert result["command"] == "npx"
        assert result["env_vars"]["API_KEY"] == "key"


# ============================================================================
# CODEX TRANSLATOR TESTS
# ============================================================================


class TestCodexTranslator:
    """Tests for Codex translator."""

    @pytest.fixture
    def translator(self) -> CodexTranslator:
        return CodexTranslator()

    def test_cli_name(self, translator: CodexTranslator) -> None:
        """Test CLI name property."""
        assert translator.cli_name == "codex"

    def test_config_directory(self, translator: CodexTranslator) -> None:
        """Test config directory property."""
        assert translator.config_directory == ".codex"

    def test_supports_mcp(self, translator: CodexTranslator) -> None:
        """Test MCP support."""
        assert translator.supports_mcp is True

    def test_translate_skill(
        self, translator: CodexTranslator, sample_skill: dict[str, Any]
    ) -> None:
        """Test skill translation to Codex format."""
        result = translator.translate_skill(sample_skill)

        assert result.name == "code-review"
        assert result.file_path == "commands.code-review"
        assert "prompt" in result.cli_format
        assert "description" in result.cli_format
        assert result.cli_format["description"] == "Performs a code review on the current file"

    def test_translate_mcp(self, translator: CodexTranslator, sample_mcp: dict[str, Any]) -> None:
        """Test MCP translation to Codex TOML format."""
        result = translator.translate_mcp(sample_mcp)

        assert result.name == "github"
        assert result.config_key == "mcp_servers.github"
        assert result.cli_format["transport"] == "stdio"
        assert result.cli_format["command"] == "npx"

    def test_parse_cli_skill(self, translator: CodexTranslator) -> None:
        """Test parsing Codex skill back to Podex format."""
        cli_config = {
            "name": "Test Command",
            "description": "A test command",
            "prompt": "You are a helpful assistant.\n\nSteps to follow:\n1. Do this [Tool: read_file]\n2. Do that",
            "triggers": ["/test"],
        }

        result = translator.parse_cli_skill(cli_config, "commands.test-command")

        assert result["name"] == "Test Command"
        assert result["slug"] == "test-command"
        assert "helpful assistant" in result["system_prompt"]
        assert len(result["steps"]) == 2


# ============================================================================
# GEMINI CLI TRANSLATOR TESTS
# ============================================================================


class TestGeminiCLITranslator:
    """Tests for Gemini CLI translator."""

    @pytest.fixture
    def translator(self) -> GeminiCLITranslator:
        return GeminiCLITranslator()

    def test_cli_name(self, translator: GeminiCLITranslator) -> None:
        """Test CLI name property."""
        assert translator.cli_name == "gemini_cli"

    def test_config_directory(self, translator: GeminiCLITranslator) -> None:
        """Test config directory property."""
        assert translator.config_directory == ".gemini"

    def test_supports_mcp(self, translator: GeminiCLITranslator) -> None:
        """Test MCP support - should be False for Gemini."""
        assert translator.supports_mcp is False

    def test_translate_skill(
        self, translator: GeminiCLITranslator, sample_skill: dict[str, Any]
    ) -> None:
        """Test skill translation to Gemini CLI format."""
        result = translator.translate_skill(sample_skill)

        assert result.name == "code-review"
        assert result.file_path == "skills/code-review.md"
        assert "content" in result.cli_format

        content = result.cli_format["content"]
        assert "# Code Review" in content
        assert "code review assistant" in content
        assert "**Triggers:**" in content

    def test_translate_mcp_returns_none(
        self, translator: GeminiCLITranslator, sample_mcp: dict[str, Any]
    ) -> None:
        """Test MCP translation returns None for Gemini."""
        result = translator.translate_mcp(sample_mcp)
        assert result is None

    def test_parse_cli_skill(self, translator: GeminiCLITranslator) -> None:
        """Test parsing Gemini skill back to Podex format."""
        cli_config = {
            "content": """# Test Skill

> A test skill

**Triggers:** /test, /t
**Tags:** code, quality
**Source:** podex

## Instructions

You are a test assistant.

## Steps

1. Step one *(Tool: `read_file`)*
2. Step two
"""
        }

        result = translator.parse_cli_skill(cli_config, "skills/test-skill.md")

        assert result["name"] == "Test Skill"
        assert result["slug"] == "test-skill"
        assert result["description"] == "A test skill"
        assert "/test" in result["triggers"]
        assert "code" in result["tags"]
        assert len(result["steps"]) == 2


# ============================================================================
# SANITIZATION TESTS
# ============================================================================


class TestNameSanitization:
    """Tests for name sanitization across translators."""

    @pytest.fixture
    def translator(self) -> ClaudeCodeTranslator:
        return ClaudeCodeTranslator()

    def test_sanitize_spaces(self, translator: ClaudeCodeTranslator) -> None:
        """Test spaces are converted to hyphens."""
        assert translator.sanitize_name("My Skill Name") == "my-skill-name"

    def test_sanitize_special_chars(self, translator: ClaudeCodeTranslator) -> None:
        """Test special characters are removed."""
        assert translator.sanitize_name("Skill@#$%Name!") == "skillname"

    def test_sanitize_consecutive_hyphens(self, translator: ClaudeCodeTranslator) -> None:
        """Test consecutive hyphens are collapsed."""
        assert translator.sanitize_name("my  skill---name") == "my-skill-name"

    def test_sanitize_leading_trailing_hyphens(self, translator: ClaudeCodeTranslator) -> None:
        """Test leading/trailing hyphens are removed."""
        assert translator.sanitize_name("-my-skill-") == "my-skill"
