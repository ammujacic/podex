"""Comprehensive tests for voice command parser."""

import pytest

from podex_shared.voice_commands import (
    AGENT_PREFIXES,
    AGENT_ROLES,
    CommandType,
    ParsedCommand,
    get_command_description,
    parse_voice_command,
)


class TestCommandType:
    """Tests for CommandType enum."""

    def test_command_type_values(self) -> None:
        """Test CommandType enum values."""
        assert CommandType.OPEN_FILE == "open_file"
        assert CommandType.CLOSE_FILE == "close_file"
        assert CommandType.SEARCH_FILES == "search_files"
        assert CommandType.TALK_TO_AGENT == "talk_to_agent"
        assert CommandType.CREATE_AGENT == "create_agent"
        assert CommandType.DELETE_AGENT == "delete_agent"
        assert CommandType.SHOW_TERMINAL == "show_terminal"
        assert CommandType.SHOW_PREVIEW == "show_preview"
        assert CommandType.TOGGLE_SIDEBAR == "toggle_sidebar"
        assert CommandType.RUN_COMMAND == "run_command"
        assert CommandType.CREATE_SESSION == "create_session"
        assert CommandType.UNKNOWN == "unknown"

    def test_command_type_is_str_enum(self) -> None:
        """Test that CommandType is a string enum."""
        assert isinstance(CommandType.OPEN_FILE, str)


class TestParsedCommand:
    """Tests for ParsedCommand dataclass."""

    def test_parsed_command_defaults(self) -> None:
        """Test ParsedCommand default values."""
        cmd = ParsedCommand(type=CommandType.UNKNOWN)
        assert cmd.target is None
        assert cmd.message is None
        assert cmd.confidence == 1.0
        assert cmd.raw_text == ""
        assert cmd.metadata is None

    def test_parsed_command_full(self) -> None:
        """Test ParsedCommand with all fields."""
        cmd = ParsedCommand(
            type=CommandType.TALK_TO_AGENT,
            target="coder",
            message="analyze this code",
            confidence=0.9,
            raw_text="Hey coder, analyze this code",
            metadata={"extra": "info"},
        )
        assert cmd.type == CommandType.TALK_TO_AGENT
        assert cmd.target == "coder"
        assert cmd.message == "analyze this code"
        assert cmd.confidence == 0.9
        assert cmd.metadata == {"extra": "info"}


class TestAgentRolesAndPrefixes:
    """Tests for agent role and prefix constants."""

    def test_agent_roles(self) -> None:
        """Test agent roles list."""
        assert "architect" in AGENT_ROLES
        assert "coder" in AGENT_ROLES
        assert "reviewer" in AGENT_ROLES
        assert "tester" in AGENT_ROLES
        assert "orchestrator" in AGENT_ROLES
        assert "builder" in AGENT_ROLES

    def test_agent_prefixes(self) -> None:
        """Test agent prefixes list contains common greetings."""
        prefix_patterns = "".join(AGENT_PREFIXES)
        assert "hey" in prefix_patterns
        assert "hi" in prefix_patterns
        assert "hello" in prefix_patterns


class TestParseVoiceCommandEmpty:
    """Tests for parsing empty/invalid input."""

    def test_empty_string(self) -> None:
        """Test parsing empty string."""
        result = parse_voice_command("")
        assert result.type == CommandType.UNKNOWN
        assert result.confidence == 0.0

    def test_none_like_string(self) -> None:
        """Test parsing whitespace-only string."""
        result = parse_voice_command("   ")
        assert result.type == CommandType.UNKNOWN
        assert result.confidence == 0.0


class TestParseVoiceCommandAgentCommands:
    """Tests for parsing agent-directed commands."""

    @pytest.mark.parametrize(
        "text,expected_agent",
        [
            ("hey coder, help me debug this", "coder"),
            ("Hi architect, design a system", "architect"),
            ("hello reviewer, check my code", "reviewer"),
            ("Hey tester, write some tests", "tester"),
            ("Ok orchestrator, coordinate the agents", "orchestrator"),
            ("Yo builder, build the project", "builder"),
        ],
    )
    def test_agent_with_greeting_prefix(self, text: str, expected_agent: str) -> None:
        """Test parsing commands with greeting prefix."""
        result = parse_voice_command(text)
        assert result.type == CommandType.TALK_TO_AGENT
        assert result.target == expected_agent
        assert result.message is not None

    @pytest.mark.parametrize(
        "text,expected_agent",
        [
            ("coder agent, analyze this file", "coder"),
            ("architect agent, create a plan", "architect"),
            ("reviewer agent, review the PR", "reviewer"),
        ],
    )
    def test_agent_with_agent_suffix(self, text: str, expected_agent: str) -> None:
        """Test parsing commands with 'agent' suffix."""
        result = parse_voice_command(text)
        assert result.type == CommandType.TALK_TO_AGENT
        assert result.target == expected_agent

    @pytest.mark.parametrize(
        "text,expected_agent",
        [
            ("coder, help me", "coder"),
            ("architect, design this", "architect"),
        ],
    )
    def test_agent_direct_address(self, text: str, expected_agent: str) -> None:
        """Test parsing commands with direct agent address."""
        result = parse_voice_command(text)
        assert result.type == CommandType.TALK_TO_AGENT
        assert result.target == expected_agent


class TestParseVoiceCommandFileOperations:
    """Tests for parsing file operation commands."""

    @pytest.mark.parametrize(
        "text,expected_file",
        [
            ("open file main.py", "main.py"),
            ("show file app.tsx", "app.tsx"),
            ("display config.json", "config.json"),
            ("view utils.ts", "utils.ts"),
            ("open index.html", "index.html"),
        ],
    )
    def test_open_file(self, text: str, expected_file: str) -> None:
        """Test parsing open file commands."""
        result = parse_voice_command(text)
        assert result.type == CommandType.OPEN_FILE
        assert result.target == expected_file

    @pytest.mark.parametrize(
        "text,expected_file",
        [
            ("close file main.py", "main.py"),
            ("close app.tsx", "app.tsx"),
            ("hide file config.json", "config.json"),
        ],
    )
    def test_close_file(self, text: str, expected_file: str) -> None:
        """Test parsing close file commands."""
        result = parse_voice_command(text)
        assert result.type == CommandType.CLOSE_FILE
        assert result.target == expected_file

    @pytest.mark.parametrize(
        "text",
        [
            "search for utils",
            "find files named config",
            "look for authentication",
            "search files",
        ],
    )
    def test_search_files(self, text: str) -> None:
        """Test parsing search files commands."""
        result = parse_voice_command(text)
        assert result.type == CommandType.SEARCH_FILES


class TestParseVoiceCommandNavigation:
    """Tests for parsing navigation commands."""

    @pytest.mark.parametrize(
        "text",
        [
            "show terminal",
            "open terminal",
            "toggle terminal",
            "show the terminal",
            "open the terminal",
        ],
    )
    def test_show_terminal(self, text: str) -> None:
        """Test parsing show terminal commands."""
        result = parse_voice_command(text)
        assert result.type == CommandType.SHOW_TERMINAL

    @pytest.mark.parametrize(
        "text",
        [
            "show preview",
            "open preview",
            "toggle preview",
            "show the preview",
        ],
    )
    def test_show_preview(self, text: str) -> None:
        """Test parsing show preview commands."""
        result = parse_voice_command(text)
        assert result.type == CommandType.SHOW_PREVIEW

    @pytest.mark.parametrize(
        "text",
        [
            "toggle sidebar",
            "show sidebar",
            "hide sidebar",
            "toggle the sidebar",
        ],
    )
    def test_toggle_sidebar(self, text: str) -> None:
        """Test parsing toggle sidebar commands."""
        result = parse_voice_command(text)
        assert result.type == CommandType.TOGGLE_SIDEBAR


class TestParseVoiceCommandAgentCreation:
    """Tests for parsing agent creation commands."""

    @pytest.mark.parametrize(
        "text,expected_role",
        [
            ("create a new coder agent", "coder"),
            ("add architect agent", "architect"),
            ("new tester agent", "tester"),
            ("create reviewer agent", "reviewer"),
        ],
    )
    def test_create_agent_with_role(self, text: str, expected_role: str) -> None:
        """Test parsing create agent commands with valid roles."""
        result = parse_voice_command(text)
        assert result.type == CommandType.CREATE_AGENT
        assert result.target == expected_role
        assert result.metadata is not None
        assert result.metadata.get("role") == expected_role

    def test_create_agent_defaults_to_coder(self) -> None:
        """Test that unknown role defaults to coder."""
        result = parse_voice_command("create a new custom agent")
        assert result.type == CommandType.CREATE_AGENT
        assert result.target == "coder"


class TestParseVoiceCommandTerminal:
    """Tests for parsing terminal commands."""

    @pytest.mark.parametrize(
        "text,expected_command",
        [
            ("run npm install", "npm install"),
            ("execute command ls -la", "ls -la"),
            ("run pytest tests/", "pytest tests/"),
            ("execute git status", "git status"),
        ],
    )
    def test_run_command(self, text: str, expected_command: str) -> None:
        """Test parsing run command commands."""
        result = parse_voice_command(text)
        assert result.type == CommandType.RUN_COMMAND
        assert result.message == expected_command


class TestParseVoiceCommandFillerWords:
    """Tests for handling filler words."""

    @pytest.mark.parametrize(
        "text",
        [
            "um show terminal",
            "uh open preview",
            "like show the terminal",
            "so toggle sidebar",
            "well show terminal",
            "please show terminal",
            "can you show terminal",
            "could you show terminal",
            "would you show terminal",
        ],
    )
    def test_filler_words_removed(self, text: str) -> None:
        """Test that filler words are handled correctly."""
        result = parse_voice_command(text)
        assert result.type in [
            CommandType.SHOW_TERMINAL,
            CommandType.SHOW_PREVIEW,
            CommandType.TOGGLE_SIDEBAR,
        ]


class TestParseVoiceCommandUnknown:
    """Tests for unknown commands."""

    def test_unknown_command(self) -> None:
        """Test that unrecognized input returns UNKNOWN."""
        result = parse_voice_command("blah blah random words")
        assert result.type == CommandType.UNKNOWN
        assert result.confidence == 0.5


class TestGetCommandDescription:
    """Tests for get_command_description function."""

    def test_open_file_description(self) -> None:
        """Test description for open file command."""
        cmd = ParsedCommand(
            type=CommandType.OPEN_FILE,
            target="main.py",
            raw_text="open main.py",
        )
        desc = get_command_description(cmd)
        assert desc == "Open file: main.py"

    def test_close_file_description(self) -> None:
        """Test description for close file command."""
        cmd = ParsedCommand(
            type=CommandType.CLOSE_FILE,
            target="app.tsx",
            raw_text="close app.tsx",
        )
        desc = get_command_description(cmd)
        assert desc == "Close file: app.tsx"

    def test_search_files_description(self) -> None:
        """Test description for search files command."""
        cmd = ParsedCommand(
            type=CommandType.SEARCH_FILES,
            target="config",
            raw_text="search for config",
        )
        desc = get_command_description(cmd)
        assert desc == "Search for: config"

    def test_talk_to_agent_description(self) -> None:
        """Test description for talk to agent command."""
        cmd = ParsedCommand(
            type=CommandType.TALK_TO_AGENT,
            target="coder",
            message="help me debug",
            raw_text="hey coder, help me debug",
        )
        desc = get_command_description(cmd)
        assert desc == 'Talk to coder agent - "help me debug"'

    def test_talk_to_agent_no_message(self) -> None:
        """Test description for talk to agent without message."""
        cmd = ParsedCommand(
            type=CommandType.TALK_TO_AGENT,
            target="architect",
            raw_text="hey architect",
        )
        desc = get_command_description(cmd)
        assert desc == "Talk to architect agent"

    def test_create_agent_description(self) -> None:
        """Test description for create agent command."""
        cmd = ParsedCommand(
            type=CommandType.CREATE_AGENT,
            target="tester",
            raw_text="create tester agent",
        )
        desc = get_command_description(cmd)
        assert desc == "Create new tester agent"

    def test_show_terminal_description(self) -> None:
        """Test description for show terminal command."""
        cmd = ParsedCommand(type=CommandType.SHOW_TERMINAL, raw_text="show terminal")
        desc = get_command_description(cmd)
        assert desc == "Show terminal"

    def test_show_preview_description(self) -> None:
        """Test description for show preview command."""
        cmd = ParsedCommand(type=CommandType.SHOW_PREVIEW, raw_text="show preview")
        desc = get_command_description(cmd)
        assert desc == "Show preview"

    def test_toggle_sidebar_description(self) -> None:
        """Test description for toggle sidebar command."""
        cmd = ParsedCommand(type=CommandType.TOGGLE_SIDEBAR, raw_text="toggle sidebar")
        desc = get_command_description(cmd)
        assert desc == "Toggle sidebar"

    def test_run_command_description(self) -> None:
        """Test description for run command."""
        cmd = ParsedCommand(
            type=CommandType.RUN_COMMAND,
            message="npm install",
            raw_text="run npm install",
        )
        desc = get_command_description(cmd)
        assert desc == "Run: npm install"

    def test_unknown_command_description(self) -> None:
        """Test description for unknown command."""
        cmd = ParsedCommand(
            type=CommandType.UNKNOWN,
            raw_text="random text",
        )
        desc = get_command_description(cmd)
        assert desc == "Unknown command: random text"


class TestNormalizeText:
    """Tests for text normalization in parsing."""

    def test_case_insensitive(self) -> None:
        """Test that parsing is case insensitive."""
        result1 = parse_voice_command("SHOW TERMINAL")
        result2 = parse_voice_command("show terminal")
        result3 = parse_voice_command("Show Terminal")

        assert result1.type == result2.type == result3.type == CommandType.SHOW_TERMINAL

    def test_extra_whitespace_handled(self) -> None:
        """Test that extra whitespace is handled."""
        result = parse_voice_command("  show    terminal  ")
        assert result.type == CommandType.SHOW_TERMINAL
