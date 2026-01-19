"""CLI config translators for syncing skills and MCPs.

This module provides translators for converting between Podex skills/MCPs
and CLI-specific configuration formats:
- Claude Code (~/.claude/)
- OpenAI Codex (~/.codex/)
- Gemini CLI (~/.gemini/)

Usage:
    from services.cli_translators import ClaudeCodeTranslator

    translator = ClaudeCodeTranslator()
    translated = translator.translate_skill(skill_dict)
    # Write translated.cli_format to translated.file_path
"""

from .base import CLITranslator, TranslatedMCP, TranslatedSkill
from .claude_code import ClaudeCodeTranslator
from .codex import CodexTranslator
from .gemini_cli import GeminiCLITranslator

# Registry of all available translators by CLI name
TRANSLATORS: dict[str, type[CLITranslator]] = {
    "claude_code": ClaudeCodeTranslator,
    "codex": CodexTranslator,
    "gemini_cli": GeminiCLITranslator,
}


def get_translator(cli_name: str) -> CLITranslator:
    """Get a translator instance for the specified CLI.

    Args:
        cli_name: CLI identifier ("claude_code", "codex", "gemini_cli")

    Returns:
        CLITranslator instance

    Raises:
        ValueError: If cli_name is not recognized
    """
    if cli_name not in TRANSLATORS:
        raise ValueError(f"Unknown CLI: {cli_name}. Available: {list(TRANSLATORS.keys())}")  # noqa: TRY003
    return TRANSLATORS[cli_name]()


__all__ = [
    "TRANSLATORS",
    "CLITranslator",
    "ClaudeCodeTranslator",
    "CodexTranslator",
    "GeminiCLITranslator",
    "TranslatedMCP",
    "TranslatedSkill",
    "get_translator",
]
