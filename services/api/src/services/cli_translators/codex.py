"""OpenAI Codex translator for syncing skills and MCPs.

Codex configuration:
- Config file: ~/.codex/config.toml
- MCPs: [mcp_servers.<name>] sections
- Custom commands: [commands.<name>] sections
"""

import re
from typing import Any

from .base import CLITranslator, TranslatedMCP, TranslatedSkill


class CodexTranslator(CLITranslator):
    """Translate between Podex and OpenAI Codex (~/.codex/) format.

    Codex stores configuration in TOML format:
        [commands.my-command]
        description = "Command description"
        prompt = "Full prompt template..."
        triggers = ["/cmd", "/c"]

        [mcp_servers.github]
        transport = "stdio"
        command = "npx"
        args = ["-y", "@modelcontextprotocol/server-github"]

        [mcp_servers.github.env_vars]
        GITHUB_TOKEN = "..."
    """

    @property
    def cli_name(self) -> str:
        return "codex"

    @property
    def config_directory(self) -> str:
        return ".codex"

    @property
    def supports_mcp(self) -> bool:
        return True

    @property
    def config_file_name(self) -> str:
        return "config.toml"

    def get_skills_directory(self) -> str:
        # Codex uses config.toml sections, not separate files
        return ""

    def translate_skill(self, skill: dict[str, Any]) -> TranslatedSkill:
        """Convert Podex skill to Codex config.toml [commands.*] format."""
        slug = self.sanitize_name(skill.get("slug", skill.get("name", "skill")))
        name = skill.get("name", slug)
        description = skill.get("description", "")
        triggers = skill.get("triggers", [f"/{slug}"])
        tags = skill.get("tags", [])
        required_tools = skill.get("required_tools", [])
        system_prompt = skill.get("system_prompt", "")
        steps = skill.get("steps", [])

        # Build the prompt from system_prompt and steps
        prompt_parts = []

        if system_prompt:
            prompt_parts.append(system_prompt)

        if steps:
            steps_text = self._format_steps(steps)
            prompt_parts.append(f"\nSteps to follow:\n{steps_text}")

        # Build TOML config dictionary
        cli_config: dict[str, Any] = {
            "name": name,
            "description": description,
            "prompt": "\n\n".join(prompt_parts),
        }

        if triggers:
            cli_config["triggers"] = triggers

        if tags:
            cli_config["tags"] = tags

        if required_tools:
            cli_config["required_tools"] = required_tools

        # Add source tracking for bidirectional sync
        cli_config["_podex_source"] = True
        if skill.get("id"):
            cli_config["_podex_id"] = skill["id"]

        return TranslatedSkill(
            name=slug,
            cli_format=cli_config,
            file_path=f"commands.{slug}",  # TOML section key
        )

    def translate_mcp(self, mcp: dict[str, Any]) -> TranslatedMCP:
        """Convert Podex MCP to Codex config.toml [mcp_servers.*] format."""
        name = self.sanitize_name(mcp.get("name", "server"))

        cli_config: dict[str, Any] = {
            "transport": mcp.get("transport", "stdio"),
        }

        if mcp.get("transport") == "stdio":
            cli_config["command"] = mcp.get("command", "")
            if mcp.get("args"):
                cli_config["args"] = mcp["args"]
        elif mcp.get("transport") in ("sse", "http"):
            cli_config["url"] = mcp.get("url", "")

        if mcp.get("env_vars"):
            cli_config["env_vars"] = mcp["env_vars"]

        # Add source tracking
        cli_config["_podex_source"] = True
        if mcp.get("id"):
            cli_config["_podex_id"] = mcp["id"]

        return TranslatedMCP(
            name=name,
            cli_format=cli_config,
            config_key=f"mcp_servers.{name}",
        )

    def parse_cli_skill(self, cli_config: dict[str, Any], file_path: str) -> dict[str, Any]:
        """Parse Codex [commands.*] config back to Podex skill format."""
        # file_path here is the TOML key, e.g., "commands.my-skill"
        slug = file_path.replace("commands.", "")

        prompt = cli_config.get("prompt", "")
        description = cli_config.get("description", "")
        name = cli_config.get("name", slug.replace("-", " ").title())

        # Try to extract steps from prompt
        steps = self._parse_steps_from_prompt(prompt)

        # The remaining prompt after steps extraction is the system_prompt
        system_prompt = self._extract_system_prompt(prompt)

        skill = {
            "name": name,
            "slug": slug,
            "description": description,
            "triggers": cli_config.get("triggers", [f"/{slug}"]),
            "tags": cli_config.get("tags", []),
            "required_tools": cli_config.get("required_tools", []),
            "system_prompt": system_prompt,
            "source": "codex",
        }

        if steps:
            skill["steps"] = steps

        # Check if this came from Podex originally
        if cli_config.get("_podex_source") and cli_config.get("_podex_id"):
            skill["podex_id"] = cli_config["_podex_id"]

        return skill

    def parse_cli_mcp(self, cli_config: dict[str, Any], key: str) -> dict[str, Any]:
        """Parse Codex [mcp_servers.*] config back to Podex format."""
        name = key.replace("mcp_servers.", "")

        result: dict[str, Any] = {
            "name": name,
            "transport": cli_config.get("transport", "stdio"),
            "source": "codex",
        }

        if result["transport"] == "stdio":
            result["command"] = cli_config.get("command", "")
            if cli_config.get("args"):
                result["args"] = cli_config["args"]
        elif result["transport"] in ("sse", "http"):
            result["url"] = cli_config.get("url", "")

        if cli_config.get("env_vars"):
            result["env_vars"] = cli_config["env_vars"]

        # Check if this came from Podex originally
        if cli_config.get("_podex_source") and cli_config.get("_podex_id"):
            result["podex_id"] = cli_config["_podex_id"]

        return result

    def _format_steps(self, steps: list[dict[str, Any]]) -> str:
        """Format steps list for Codex prompt."""
        lines = []
        for i, step in enumerate(steps, 1):
            description = step.get("description", step.get("action", ""))
            tool = step.get("tool")
            skill = step.get("skill")

            line = f"{i}. {description}"

            if tool:
                line += f" [Tool: {tool}]"
            elif skill:
                line += f" [Skill: {skill}]"

            lines.append(line)

        return "\n".join(lines)

    def _parse_steps_from_prompt(self, prompt: str) -> list[dict[str, Any]]:
        """Parse steps from a Codex prompt."""
        steps: list[dict[str, Any]] = []

        # Look for "Steps to follow:" section
        steps_match = re.search(r"Steps to follow:\n(.*?)(?:\n\n|\Z)", prompt, re.DOTALL)
        if not steps_match:
            return steps

        steps_text = steps_match.group(1)

        # Parse numbered list items
        pattern = r"^\d+\.\s+(.+?)(?:\s+\[Tool:\s*([^\]]+)\])?(?:\s+\[Skill:\s*([^\]]+)\])?\s*$"
        for line in steps_text.split("\n"):
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

        return steps

    def _extract_system_prompt(self, prompt: str) -> str:
        """Extract the system prompt part (before any Steps section)."""
        # Remove the "Steps to follow:" section
        prompt = re.sub(r"\n?Steps to follow:\n.*?(?:\n\n|\Z)", "", prompt, flags=re.DOTALL)
        return prompt.strip()

    def merge_config(
        self,
        existing_config: dict[str, Any],
        new_commands: dict[str, Any],
        new_mcps: dict[str, Any],
    ) -> dict[str, Any]:
        """Merge new commands and MCPs into existing config.toml content.

        Preserves existing items that aren't from Podex, updates Podex ones.
        """
        # Merge commands
        if "commands" not in existing_config:
            existing_config["commands"] = {}

        for name, config in new_commands.items():
            existing_config["commands"][name] = config

        # Merge MCPs
        if "mcp_servers" not in existing_config:
            existing_config["mcp_servers"] = {}

        for name, config in new_mcps.items():
            existing_config["mcp_servers"][name] = config

        return existing_config

    def extract_commands(self, config: dict[str, Any]) -> dict[str, dict[str, Any]]:
        """Extract all command configs from a config.toml."""
        commands = config.get("commands", {})
        return dict(commands) if commands else {}

    def extract_mcp_configs(self, config: dict[str, Any]) -> dict[str, dict[str, Any]]:
        """Extract all MCP server configs from a config.toml."""
        mcps = config.get("mcp_servers", {})
        return dict(mcps) if mcps else {}
