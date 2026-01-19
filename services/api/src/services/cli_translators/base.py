"""Base class for CLI config translators.

Defines the interface for translating between Podex skills/MCPs and
CLI-specific configuration formats (Claude Code, Codex, Gemini CLI).
"""

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass
class TranslatedSkill:
    """Skill translated to CLI format.

    Attributes:
        name: The skill name/slug
        cli_format: CLI-specific configuration dictionary
        file_path: Relative path in CLI config directory (e.g., "commands/my-skill.md")
    """

    name: str
    cli_format: dict[str, Any]
    file_path: str


@dataclass
class TranslatedMCP:
    """MCP config translated to CLI format.

    Attributes:
        name: The MCP server name
        cli_format: CLI-specific configuration dictionary
        config_key: Key in CLI config file (e.g., "mcpServers.github")
    """

    name: str
    cli_format: dict[str, Any]
    config_key: str


class CLITranslator(ABC):
    """Base class for CLI config translators.

    Each CLI tool (Claude Code, Codex, Gemini CLI) has different config formats.
    This base class defines the interface for translating Podex skills and MCPs
    to each CLI's native format, and vice versa for bidirectional sync.
    """

    @property
    @abstractmethod
    def cli_name(self) -> str:
        """Return CLI identifier (e.g., 'claude_code', 'codex', 'gemini_cli')."""

    @property
    @abstractmethod
    def config_directory(self) -> str:
        """Return CLI config directory path relative to home (e.g., '.claude')."""

    @property
    @abstractmethod
    def supports_mcp(self) -> bool:
        """Whether this CLI supports MCP natively."""

    @property
    def config_file_name(self) -> str | None:
        """Return the main config file name if applicable (e.g., 'config.json')."""
        return None

    @abstractmethod
    def translate_skill(self, skill: dict[str, Any]) -> TranslatedSkill:
        """Translate a Podex skill to CLI custom command format.

        Args:
            skill: Podex skill dictionary with keys:
                - name: Display name
                - slug: URL-safe identifier
                - description: Brief description
                - triggers: List of trigger keywords
                - tags: List of tags
                - required_tools: List of required tool names
                - steps: List of step dictionaries
                - system_prompt: Optional system prompt

        Returns:
            TranslatedSkill with CLI-specific format and file path
        """

    @abstractmethod
    def translate_mcp(self, mcp: dict[str, Any]) -> TranslatedMCP | None:
        """Translate MCP config to CLI format.

        Args:
            mcp: Podex MCP dictionary with keys:
                - name: Server name
                - description: Brief description
                - transport: "stdio" | "sse" | "http"
                - command: Command to run (for stdio)
                - args: Command arguments
                - url: URL (for sse/http)
                - env_vars: Environment variables

        Returns:
            TranslatedMCP with CLI-specific format, or None if MCP not supported
        """

    @abstractmethod
    def parse_cli_skill(self, cli_config: dict[str, Any], file_path: str) -> dict[str, Any]:
        """Parse CLI skill/command config back to Podex format.

        Args:
            cli_config: CLI-specific configuration
            file_path: Path where the config was found

        Returns:
            Dictionary in Podex skill format
        """

    @abstractmethod
    def parse_cli_mcp(self, cli_config: dict[str, Any], key: str) -> dict[str, Any] | None:
        """Parse CLI MCP config back to Podex format.

        Args:
            cli_config: CLI-specific MCP configuration
            key: Config key where the MCP was found

        Returns:
            Dictionary in Podex MCP format, or None if not applicable
        """

    def get_skills_directory(self) -> str:
        """Return the directory path for skill files relative to config_directory."""
        return "commands"

    def get_mcp_config_path(self) -> str | None:
        """Return the config file path for MCP settings, or None if not supported."""
        return self.config_file_name

    def sanitize_name(self, name: str) -> str:
        """Sanitize a name for use in file names and config keys.

        Converts spaces to hyphens, lowercases, and removes special characters.
        """
        # Convert to lowercase, replace spaces with hyphens
        sanitized = name.lower().replace(" ", "-")
        # Remove any character that isn't alphanumeric or hyphen
        sanitized = re.sub(r"[^a-z0-9-]", "", sanitized)
        # Remove consecutive hyphens
        sanitized = re.sub(r"-+", "-", sanitized)
        # Remove leading/trailing hyphens
        return sanitized.strip("-")
