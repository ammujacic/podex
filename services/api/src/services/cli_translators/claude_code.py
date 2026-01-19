"""Claude Code translator for syncing skills and MCPs.

Claude Code configuration:
- Config file: ~/.claude/config.json
- MCPs: mcpServers object in config.json
- Custom commands: ~/.claude/commands/*.md files with YAML frontmatter
"""

import re
from typing import Any

import yaml

from .base import CLITranslator, TranslatedMCP, TranslatedSkill


class ClaudeCodeTranslator(CLITranslator):
    """Translate between Podex and Claude Code (~/.claude/) format.

    Custom commands are stored as markdown files with YAML frontmatter:
        ---
        description: "Command description"
        triggers:
          - /command-name
        ---
        ## Instructions
        ...

    MCPs are stored in config.json under mcpServers:
        {
            "mcpServers": {
                "server-name": {
                    "command": "npx",
                    "args": ["-y", "@org/server"],
                    "env": {"API_KEY": "..."}
                }
            }
        }
    """

    @property
    def cli_name(self) -> str:
        return "claude_code"

    @property
    def config_directory(self) -> str:
        return ".claude"

    @property
    def supports_mcp(self) -> bool:
        return True

    @property
    def config_file_name(self) -> str:
        return "config.json"

    def get_skills_directory(self) -> str:
        return "commands"

    def translate_skill(self, skill: dict[str, Any]) -> TranslatedSkill:
        """Convert Podex skill to Claude Code custom command markdown.

        Creates a markdown file with YAML frontmatter containing metadata,
        and the body containing instructions and steps.
        """
        slug = self.sanitize_name(skill.get("slug", skill.get("name", "skill")))
        name = skill.get("name", slug)
        description = skill.get("description", "")
        triggers = skill.get("triggers", [f"/{slug}"])
        tags = skill.get("tags", [])
        required_tools = skill.get("required_tools", [])
        system_prompt = skill.get("system_prompt", "")
        steps = skill.get("steps", [])

        # Build YAML frontmatter
        frontmatter: dict[str, Any] = {
            "name": name,
            "description": description,
        }

        if triggers:
            frontmatter["triggers"] = triggers

        if tags:
            frontmatter["tags"] = tags

        if required_tools:
            frontmatter["required_tools"] = required_tools

        # Add source tracking for bidirectional sync
        frontmatter["source"] = "podex"
        if skill.get("id"):
            frontmatter["podex_id"] = skill["id"]

        # Build markdown content
        content_parts = []

        if system_prompt:
            content_parts.append(f"## Instructions\n\n{system_prompt}")

        if steps:
            steps_content = self._format_steps(steps)
            content_parts.append(f"## Steps\n\n{steps_content}")

        # If there's examples, add them
        if skill.get("examples"):
            examples_content = self._format_examples(skill["examples"])
            content_parts.append(f"## Examples\n\n{examples_content}")

        # Format as markdown with YAML frontmatter
        yaml_str = yaml.dump(
            frontmatter, default_flow_style=False, allow_unicode=True, sort_keys=False
        )
        md_content = f"---\n{yaml_str}---\n\n"
        md_content += "\n\n".join(content_parts)

        return TranslatedSkill(
            name=slug,
            cli_format={"content": md_content, "type": "command"},
            file_path=f"commands/{slug}.md",
        )

    def translate_mcp(self, mcp: dict[str, Any]) -> TranslatedMCP:
        """Convert Podex MCP to Claude Code config.json format."""
        name = self.sanitize_name(mcp.get("name", "server"))

        cli_config: dict[str, Any] = {}

        transport = mcp.get("transport", "stdio")

        if transport == "stdio":
            cli_config["command"] = mcp.get("command", "")
            if mcp.get("args"):
                cli_config["args"] = mcp["args"]
        elif transport in ("sse", "http"):
            cli_config["url"] = mcp.get("url", "")

        if mcp.get("env_vars"):
            cli_config["env"] = mcp["env_vars"]

        # Add source tracking
        cli_config["_podex_source"] = True
        if mcp.get("id"):
            cli_config["_podex_id"] = mcp["id"]

        return TranslatedMCP(
            name=name,
            cli_format=cli_config,
            config_key=f"mcpServers.{name}",
        )

    def parse_cli_skill(self, cli_config: dict[str, Any], file_path: str) -> dict[str, Any]:
        """Parse Claude Code command file back to Podex skill format."""
        content = cli_config.get("content", "")

        # Parse YAML frontmatter
        frontmatter_match = re.match(r"^---\n(.*?)\n---\n(.*)$", content, re.DOTALL)
        if not frontmatter_match:
            raise ValueError("Invalid command file format: missing YAML frontmatter")  # noqa: TRY003

        try:
            frontmatter = yaml.safe_load(frontmatter_match.group(1))
        except yaml.YAMLError as e:
            raise ValueError(f"Invalid YAML frontmatter: {e}") from e  # noqa: TRY003

        body = frontmatter_match.group(2).strip()

        # Extract slug from file path
        slug = file_path.replace("commands/", "").replace(".md", "")

        # Parse body sections
        system_prompt = self._extract_section(body, "Instructions")
        steps = self._parse_steps_section(body)
        examples = self._parse_examples_section(body)

        skill = {
            "name": frontmatter.get("name", slug.replace("-", " ").title()),
            "slug": slug,
            "description": frontmatter.get("description", ""),
            "triggers": frontmatter.get("triggers", [f"/{slug}"]),
            "tags": frontmatter.get("tags", []),
            "required_tools": frontmatter.get("required_tools", []),
            "system_prompt": system_prompt,
            "source": "claude_code",
        }

        if steps:
            skill["steps"] = steps

        if examples:
            skill["examples"] = examples

        # Check if this came from Podex originally
        if frontmatter.get("source") == "podex" and frontmatter.get("podex_id"):
            skill["podex_id"] = frontmatter["podex_id"]

        return skill

    def parse_cli_mcp(self, cli_config: dict[str, Any], key: str) -> dict[str, Any]:
        """Parse Claude Code MCP config back to Podex format."""
        name = key.replace("mcpServers.", "")

        result: dict[str, Any] = {
            "name": name,
            "source": "claude_code",
        }

        # Determine transport type
        if "command" in cli_config:
            result["transport"] = "stdio"
            result["command"] = cli_config["command"]
            if cli_config.get("args"):
                result["args"] = cli_config["args"]
        elif "url" in cli_config:
            # Determine if SSE or HTTP based on URL pattern
            result["transport"] = "sse" if "sse" in cli_config["url"].lower() else "http"
            result["url"] = cli_config["url"]

        if cli_config.get("env"):
            result["env_vars"] = cli_config["env"]

        # Check if this came from Podex originally
        if cli_config.get("_podex_source") and cli_config.get("_podex_id"):
            result["podex_id"] = cli_config["_podex_id"]

        return result

    def _format_steps(self, steps: list[dict[str, Any]]) -> str:
        """Format steps list as numbered markdown list."""
        lines = []
        for i, step in enumerate(steps, 1):
            description = step.get("description", step.get("action", ""))
            tool = step.get("tool")
            skill = step.get("skill")

            line = f"{i}. {description}"

            if tool:
                line += f" (Tool: `{tool}`)"
            elif skill:
                line += f" (Skill: `{skill}`)"

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

    def _extract_section(self, body: str, section_name: str) -> str:
        """Extract content from a markdown section."""
        pattern = rf"## {section_name}\n\n(.*?)(?=\n## |\Z)"
        match = re.search(pattern, body, re.DOTALL)
        if match:
            return match.group(1).strip()
        return ""

    def _parse_steps_section(self, body: str) -> list[dict[str, Any]]:
        """Parse the Steps section back into a list of step dictionaries."""
        steps_content = self._extract_section(body, "Steps")
        if not steps_content:
            return []

        steps = []
        # Parse numbered list items
        pattern = r"^\d+\.\s+(.+?)(?:\s+\(Tool:\s*`([^`]+)`\))?(?:\s+\(Skill:\s*`([^`]+)`\))?\s*$"
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

    def _parse_examples_section(self, body: str) -> list[dict[str, Any]]:
        """Parse the Examples section back into a list of example dictionaries."""
        examples_content = self._extract_section(body, "Examples")
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

    def merge_mcp_config(
        self, existing_config: dict[str, Any], new_mcps: dict[str, Any]
    ) -> dict[str, Any]:
        """Merge new MCP configs into existing config.json content.

        Preserves existing MCPs that aren't from Podex, updates Podex ones.
        """
        if "mcpServers" not in existing_config:
            existing_config["mcpServers"] = {}

        for name, config in new_mcps.items():
            existing_config["mcpServers"][name] = config

        return existing_config

    def extract_mcp_configs(self, config: dict[str, Any]) -> dict[str, dict[str, Any]]:
        """Extract all MCP server configs from a config.json."""
        mcps = config.get("mcpServers", {})
        return dict(mcps) if mcps else {}
