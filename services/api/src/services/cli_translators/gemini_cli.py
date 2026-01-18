"""Gemini CLI translator for syncing skills.

Gemini CLI configuration:
- Config file: ~/.gemini/settings.json
- Skills: ~/.gemini/skills/*.md (custom format)
- Note: Gemini CLI does NOT support MCP natively
"""

import re
from typing import Any

from .base import CLITranslator, TranslatedMCP, TranslatedSkill


class GeminiCLITranslator(CLITranslator):
    """Translate between Podex and Gemini CLI (~/.gemini/) format.

    Gemini CLI uses GEMINI.md for instructions and settings.json for config.
    Skills are stored as markdown files in ~/.gemini/skills/:
        # Skill Name

        > Description

        **Triggers:** /trigger1, /trigger2

        ## Instructions
        ...

        ## Steps
        1. Step one
        2. Step two

    Note: Gemini CLI does not support MCP natively, so translate_mcp returns None.
    """

    @property
    def cli_name(self) -> str:
        return "gemini_cli"

    @property
    def config_directory(self) -> str:
        return ".gemini"

    @property
    def supports_mcp(self) -> bool:
        return False

    @property
    def config_file_name(self) -> str:
        return "settings.json"

    def get_skills_directory(self) -> str:
        return "skills"

    def translate_skill(self, skill: dict[str, Any]) -> TranslatedSkill:
        """Convert Podex skill to Gemini CLI markdown format.

        Creates a markdown file in ~/.gemini/skills/ with a structured format
        that can be referenced or loaded by Gemini CLI.
        """
        slug = self.sanitize_name(skill.get("slug", skill.get("name", "skill")))
        name = skill.get("name", slug)
        description = skill.get("description", "")
        triggers = skill.get("triggers", [f"/{slug}"])
        tags = skill.get("tags", [])
        required_tools = skill.get("required_tools", [])
        system_prompt = skill.get("system_prompt", "")
        steps = skill.get("steps", [])

        # Build markdown content
        content_parts = []

        # Title
        content_parts.append(f"# {name}\n")

        # Description as blockquote
        if description:
            content_parts.append(f"> {description}\n")

        # Metadata section
        metadata_lines = []
        if triggers:
            metadata_lines.append(f"**Triggers:** {', '.join(triggers)}")
        if tags:
            metadata_lines.append(f"**Tags:** {', '.join(tags)}")
        if required_tools:
            metadata_lines.append(f"**Required Tools:** {', '.join(required_tools)}")

        # Source tracking
        metadata_lines.append("**Source:** podex")
        if skill.get("id"):
            metadata_lines.append(f"**Podex ID:** {skill['id']}")

        if metadata_lines:
            content_parts.append("\n".join(metadata_lines) + "\n")

        # Instructions section
        if system_prompt:
            content_parts.append(f"## Instructions\n\n{system_prompt}\n")

        # Steps section
        if steps:
            steps_content = self._format_steps(steps)
            content_parts.append(f"## Steps\n\n{steps_content}\n")

        # Examples section
        if skill.get("examples"):
            examples_content = self._format_examples(skill["examples"])
            content_parts.append(f"## Examples\n\n{examples_content}\n")

        md_content = "\n".join(content_parts)

        return TranslatedSkill(
            name=slug,
            cli_format={"content": md_content, "type": "skill"},
            file_path=f"skills/{slug}.md",
        )

    def translate_mcp(self, mcp: dict[str, Any]) -> TranslatedMCP | None:  # noqa: ARG002
        """Gemini CLI doesn't support MCP natively."""
        return None

    def parse_cli_skill(self, cli_config: dict[str, Any], file_path: str) -> dict[str, Any]:
        """Parse Gemini CLI skill file back to Podex skill format."""
        content = cli_config.get("content", "")

        # Extract slug from file path
        slug = file_path.replace("skills/", "").replace(".md", "")

        # Parse title
        title_match = re.search(r"^# (.+)$", content, re.MULTILINE)
        name = title_match.group(1).strip() if title_match else slug.replace("-", " ").title()

        # Parse description (blockquote)
        desc_match = re.search(r"^> (.+)$", content, re.MULTILINE)
        description = desc_match.group(1).strip() if desc_match else ""

        # Parse metadata
        triggers = self._extract_metadata_list(content, "Triggers")
        tags = self._extract_metadata_list(content, "Tags")
        required_tools = self._extract_metadata_list(content, "Required Tools")
        source = self._extract_metadata_value(content, "Source")
        podex_id = self._extract_metadata_value(content, "Podex ID")

        # Parse sections
        system_prompt = self._extract_section(content, "Instructions")
        steps = self._parse_steps_section(content)
        examples = self._parse_examples_section(content)

        skill: dict[str, Any] = {
            "name": name,
            "slug": slug,
            "description": description,
            "triggers": triggers if triggers else [f"/{slug}"],
            "tags": tags,
            "required_tools": required_tools,
            "system_prompt": system_prompt,
            "source": source if source else "gemini_cli",
        }

        if steps:
            skill["steps"] = steps

        if examples:
            skill["examples"] = examples

        # Check if this came from Podex originally
        if source == "podex" and podex_id:
            skill["podex_id"] = podex_id

        return skill

    def parse_cli_mcp(self, _cli_config: dict[str, Any], _key: str) -> dict[str, Any] | None:
        """Gemini CLI doesn't support MCP natively."""
        return None

    def _format_steps(self, steps: list[dict[str, Any]]) -> str:
        """Format steps list as numbered markdown list."""
        lines = []
        for i, step in enumerate(steps, 1):
            description = step.get("description", step.get("action", ""))
            tool = step.get("tool")
            skill = step.get("skill")

            line = f"{i}. {description}"

            if tool:
                line += f" *(Tool: `{tool}`)*"
            elif skill:
                line += f" *(Skill: `{skill}`)*"

            lines.append(line)

        return "\n".join(lines)

    def _format_examples(self, examples: list[dict[str, Any]]) -> str:
        """Format examples as markdown."""
        parts = []
        for example in examples:
            if isinstance(example, dict):
                user = example.get("user", "")
                assistant = example.get("assistant", "")
                parts.append(f"**User:** {user}\n\n**Assistant:** {assistant}")
            else:
                parts.append(str(example))
        return "\n\n---\n\n".join(parts)

    def _extract_metadata_list(self, content: str, key: str) -> list[str]:
        """Extract a comma-separated list from metadata."""
        pattern = rf"\*\*{key}:\*\*\s*(.+)$"
        match = re.search(pattern, content, re.MULTILINE)
        if match:
            return [item.strip() for item in match.group(1).split(",")]
        return []

    def _extract_metadata_value(self, content: str, key: str) -> str:
        """Extract a single value from metadata."""
        pattern = rf"\*\*{key}:\*\*\s*(.+)$"
        match = re.search(pattern, content, re.MULTILINE)
        return match.group(1).strip() if match else ""

    def _extract_section(self, content: str, section_name: str) -> str:
        """Extract content from a markdown section."""
        pattern = rf"## {section_name}\n\n(.*?)(?=\n## |\Z)"
        match = re.search(pattern, content, re.DOTALL)
        if match:
            return match.group(1).strip()
        return ""

    def _parse_steps_section(self, content: str) -> list[dict[str, Any]]:
        """Parse the Steps section back into a list of step dictionaries."""
        steps_content = self._extract_section(content, "Steps")
        if not steps_content:
            return []

        steps = []
        # Parse numbered list items with optional tool/skill annotations
        pattern = (
            r"^\d+\.\s+(.+?)(?:\s+\*\(Tool:\s*`([^`]+)`\)\*)?(?:\s+\*\(Skill:\s*`([^`]+)`\)\*)?\s*$"
        )
        for line in steps_content.split("\n"):
            line = line.strip()
            if not line:
                continue

            match = re.match(pattern, line)
            if match:
                step: dict[str, Any] = {"description": match.group(1).strip()}
                if match.group(2):
                    step["tool"] = match.group(2)
                if match.group(3):
                    step["skill"] = match.group(3)
                steps.append(step)
            elif line.startswith(("- ", "* ")):
                # Also handle bullet points
                steps.append({"description": line[2:].strip()})

        return steps

    def _parse_examples_section(self, content: str) -> list[dict[str, Any]]:
        """Parse the Examples section back into a list of example dictionaries."""
        examples_content = self._extract_section(content, "Examples")
        if not examples_content:
            return []

        examples = []
        # Split by horizontal rules
        parts = re.split(r"\n---\n", examples_content)
        for part in parts:
            part = part.strip()
            if not part:
                continue

            # Try to extract user/assistant format
            user_match = re.search(
                r"\*\*User:\*\*\s*(.+?)(?=\*\*Assistant:\*\*|\Z)", part, re.DOTALL
            )
            assistant_match = re.search(r"\*\*Assistant:\*\*\s*(.+?)$", part, re.DOTALL)

            if user_match and assistant_match:
                examples.append(
                    {
                        "user": user_match.group(1).strip(),
                        "assistant": assistant_match.group(1).strip(),
                    }
                )

        return examples
