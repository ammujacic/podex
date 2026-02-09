"""Voice Command Parser for Podex.

Parses natural language voice commands into structured actions.
Supports commands like:
- "Open file abc.py"
- "Coder agent, analyze this file for bugs"
- "Hey architect, create a plan for user authentication"
- "Create a new tester agent"
- "Show terminal"
- "Run npm install"
"""

import re
from dataclasses import dataclass
from enum import Enum
from typing import Any


class CommandType(str, Enum):
    """Types of voice commands."""

    # File operations
    OPEN_FILE = "open_file"
    CLOSE_FILE = "close_file"
    SEARCH_FILES = "search_files"

    # Agent operations
    TALK_TO_AGENT = "talk_to_agent"
    CREATE_AGENT = "create_agent"
    DELETE_AGENT = "delete_agent"

    # Navigation
    SHOW_TERMINAL = "show_terminal"
    SHOW_PREVIEW = "show_preview"
    TOGGLE_SIDEBAR = "toggle_sidebar"

    # Terminal operations
    RUN_COMMAND = "run_command"

    # Session operations
    CREATE_SESSION = "create_session"

    # Unknown/fallback
    UNKNOWN = "unknown"


@dataclass
class ParsedCommand:
    """Parsed voice command result."""

    type: CommandType
    target: str | None = None  # Agent name, file path, etc.
    message: str | None = None  # Message to agent, command to run, etc.
    confidence: float = 1.0
    raw_text: str = ""
    metadata: dict[str, Any] | None = None


# Agent role keywords for detection
AGENT_ROLES = ["architect", "coder", "reviewer", "tester", "orchestrator", "builder"]

# Common agent prefixes in speech
AGENT_PREFIXES = [
    r"hey\s+",
    r"hi\s+",
    r"hello\s+",
    r"dear\s+",
    r"yo\s+",
    r"ok\s+",
    r"okay\s+",
]

# File operation patterns
FILE_PATTERNS = [
    # "open file X" or "open X"
    (r"(?:open|show|display|view)\s+(?:file\s+)?(.+\.[\w]+)", CommandType.OPEN_FILE),
    # "close file X" or "close X"
    (r"(?:close|hide)\s+(?:file\s+)?(.+\.[\w]+)", CommandType.CLOSE_FILE),
    # "search for X" or "find X"
    (
        r"(?:search|find|look)\s+(?:for\s+)?(?:files?\s+)?(?:named?\s+)?(.+)",
        CommandType.SEARCH_FILES,
    ),
]

# Navigation patterns
NAV_PATTERNS = [
    (r"(?:show|open|toggle)\s+(?:the\s+)?terminal", CommandType.SHOW_TERMINAL),
    (r"(?:show|open|toggle)\s+(?:the\s+)?preview", CommandType.SHOW_PREVIEW),
    (r"(?:show|hide|toggle)\s+(?:the\s+)?sidebar", CommandType.TOGGLE_SIDEBAR),
]

# Terminal command patterns
TERMINAL_PATTERNS = [
    (r"(?:run|execute)\s+(?:command\s+)?(.+)", CommandType.RUN_COMMAND),
]

# Agent creation patterns
AGENT_CREATE_PATTERNS = [
    (r"(?:create|add|new)\s+(?:a\s+)?(?:new\s+)?(\w+)\s+agent", CommandType.CREATE_AGENT),
    (
        r"(?:create|add|new)\s+(?:a\s+)?(?:new\s+)?agent\s+(?:named?\s+)?(\w+)",
        CommandType.CREATE_AGENT,
    ),
]


def _normalize_text(text: str) -> str:
    """Normalize text for parsing."""
    # Lowercase
    text = text.lower().strip()
    # Remove extra whitespace
    text = re.sub(r"\s+", " ", text)
    # Remove common filler words at start
    text = re.sub(r"^(um|uh|like|so|well|please|can you|could you|would you)\s+", "", text)
    return text


def _extract_agent_target(text: str) -> tuple[str | None, str]:
    """Extract agent name from text and return remaining text.

    Returns:
        Tuple of (agent_name, remaining_text)
    """
    normalized = _normalize_text(text)

    # Check for "hey/hi [agent]" pattern
    for prefix in AGENT_PREFIXES:
        for role in AGENT_ROLES:
            pattern = rf"^{prefix}({role})\s*(?:agent)?\s*[,.]?\s*(.*)$"
            match = re.match(pattern, normalized, re.IGNORECASE)
            if match:
                return match.group(1), match.group(2).strip()

    # Check for "[agent] agent, ..." pattern
    for role in AGENT_ROLES:
        pattern = rf"^({role})\s+agent\s*[,.]?\s*(.*)$"
        match = re.match(pattern, normalized, re.IGNORECASE)
        if match:
            return match.group(1), match.group(2).strip()

    # Check for just "[agent], ..." pattern
    for role in AGENT_ROLES:
        pattern = rf"^({role})\s*[,.]?\s+(.+)$"
        match = re.match(pattern, normalized, re.IGNORECASE)
        if match:
            return match.group(1), match.group(2).strip()

    return None, normalized


def _match_patterns(
    text: str,
    patterns: list[tuple[str, CommandType]],
) -> tuple[CommandType | None, str | None]:
    """Try to match text against a list of patterns.

    Returns:
        Tuple of (command_type, captured_group)
    """
    for pattern, cmd_type in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            captured = match.group(1) if match.groups() else None
            return cmd_type, captured
    return None, None


def _try_parse_agent_command(
    normalized: str,
    raw_text: str,
) -> ParsedCommand | None:
    """Try to parse as an agent-directed command."""
    agent_target, remaining_text = _extract_agent_target(normalized)
    if agent_target:
        return ParsedCommand(
            type=CommandType.TALK_TO_AGENT,
            target=agent_target,
            message=remaining_text if remaining_text else None,
            raw_text=raw_text,
            confidence=0.9,
        )
    return None


def _try_parse_file_command(
    normalized: str,
    raw_text: str,
) -> ParsedCommand | None:
    """Try to parse as a file operation command."""
    cmd_type, captured = _match_patterns(normalized, FILE_PATTERNS)
    if cmd_type:
        return ParsedCommand(
            type=cmd_type,
            target=captured,
            raw_text=raw_text,
            confidence=0.85,
        )
    return None


def _try_parse_nav_command(
    normalized: str,
    raw_text: str,
) -> ParsedCommand | None:
    """Try to parse as a navigation command."""
    cmd_type, _ = _match_patterns(normalized, NAV_PATTERNS)
    if cmd_type:
        return ParsedCommand(
            type=cmd_type,
            raw_text=raw_text,
            confidence=0.9,
        )
    return None


def _try_parse_agent_create_command(
    normalized: str,
    raw_text: str,
) -> ParsedCommand | None:
    """Try to parse as an agent creation command."""
    cmd_type, captured = _match_patterns(normalized, AGENT_CREATE_PATTERNS)
    if cmd_type:
        role = captured.lower() if captured else None
        if role and role not in AGENT_ROLES:
            role = "coder"  # Default role
        return ParsedCommand(
            type=cmd_type,
            target=role,
            raw_text=raw_text,
            confidence=0.85,
            metadata={"role": role},
        )
    return None


def _try_parse_terminal_command(
    normalized: str,
    raw_text: str,
) -> ParsedCommand | None:
    """Try to parse as a terminal command."""
    cmd_type, captured = _match_patterns(normalized, TERMINAL_PATTERNS)
    if cmd_type:
        return ParsedCommand(
            type=cmd_type,
            message=captured,
            raw_text=raw_text,
            confidence=0.8,
        )
    return None


def parse_voice_command(text: str) -> ParsedCommand:
    """Parse a voice command into a structured action.

    Args:
        text: Raw transcribed text from speech-to-text

    Returns:
        ParsedCommand with type, target, and message
    """
    if not text or not text.strip():
        return ParsedCommand(
            type=CommandType.UNKNOWN,
            raw_text=text or "",
            confidence=0.0,
        )

    raw_text = text
    normalized = _normalize_text(text)

    # Try each parser in order of priority
    parsers = [
        _try_parse_agent_command,
        _try_parse_file_command,
        _try_parse_nav_command,
        _try_parse_agent_create_command,
        _try_parse_terminal_command,
    ]

    for parser in parsers:
        result = parser(normalized, raw_text)
        if result is not None:
            return result

    # If no pattern matched, return unknown
    return ParsedCommand(
        type=CommandType.UNKNOWN,
        message=normalized,
        raw_text=raw_text,
        confidence=0.5,
    )


def _get_talk_to_agent_description(command: ParsedCommand) -> str:
    """Get description for talk to agent command."""
    msg = f' - "{command.message}"' if command.message else ""
    return f"Talk to {command.target} agent{msg}"


# Mapping of command types to description formatters
_COMMAND_DESCRIPTIONS: dict[CommandType, str | None] = {
    CommandType.OPEN_FILE: "Open file: {target}",
    CommandType.CLOSE_FILE: "Close file: {target}",
    CommandType.SEARCH_FILES: "Search for: {target}",
    CommandType.CREATE_AGENT: "Create new {target} agent",
    CommandType.SHOW_TERMINAL: "Show terminal",
    CommandType.SHOW_PREVIEW: "Show preview",
    CommandType.TOGGLE_SIDEBAR: "Toggle sidebar",
    CommandType.RUN_COMMAND: "Run: {message}",
}


def get_command_description(command: ParsedCommand) -> str:
    """Get a human-readable description of the parsed command."""
    # Handle special case for TALK_TO_AGENT
    if command.type == CommandType.TALK_TO_AGENT:
        return _get_talk_to_agent_description(command)

    # Use template lookup for standard commands
    template = _COMMAND_DESCRIPTIONS.get(command.type)
    if template is not None:
        return template.format(target=command.target, message=command.message)

    return f"Unknown command: {command.raw_text}"
