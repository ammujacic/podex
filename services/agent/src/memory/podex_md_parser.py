"""Parser and manager for PODEX.md project memory files."""

import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger()


@dataclass
class ProjectContext:
    """Structured project context from PODEX.md."""

    project_name: str = ""
    description: str = ""
    tech_stack: list[str] = field(default_factory=list)
    architecture: str = ""
    key_patterns: list[str] = field(default_factory=list)
    important_files: list[str] = field(default_factory=list)
    coding_conventions: list[str] = field(default_factory=list)
    common_commands: dict[str, str] = field(default_factory=dict)
    known_issues: list[str] = field(default_factory=list)
    recent_changes: list[str] = field(default_factory=list)
    custom_instructions: str = ""
    raw_content: str = ""
    last_modified: datetime | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "project_name": self.project_name,
            "description": self.description,
            "tech_stack": self.tech_stack,
            "architecture": self.architecture,
            "key_patterns": self.key_patterns,
            "important_files": self.important_files,
            "coding_conventions": self.coding_conventions,
            "common_commands": self.common_commands,
            "known_issues": self.known_issues,
            "recent_changes": self.recent_changes,
            "custom_instructions": self.custom_instructions,
            "last_modified": self.last_modified.isoformat() if self.last_modified else None,
        }

    def to_system_prompt(self) -> str:
        """Convert to a system prompt for the agent."""
        parts = []

        if self.project_name:
            parts.append(f"# Project: {self.project_name}")

        if self.description:
            parts.append(f"\n## Description\n{self.description}")

        if self.tech_stack:
            parts.append("\n## Tech Stack\n- " + "\n- ".join(self.tech_stack))

        if self.architecture:
            parts.append(f"\n## Architecture\n{self.architecture}")

        if self.key_patterns:
            parts.append("\n## Key Patterns\n- " + "\n- ".join(self.key_patterns))

        if self.important_files:
            parts.append("\n## Important Files\n- " + "\n- ".join(self.important_files))

        if self.coding_conventions:
            parts.append("\n## Coding Conventions\n- " + "\n- ".join(self.coding_conventions))

        if self.common_commands:
            cmds = [f"- `{k}`: {v}" for k, v in self.common_commands.items()]
            parts.append("\n## Common Commands\n" + "\n".join(cmds))

        if self.known_issues:
            parts.append("\n## Known Issues\n- " + "\n- ".join(self.known_issues))

        if self.recent_changes:
            parts.append("\n## Recent Changes\n- " + "\n- ".join(self.recent_changes[-5:]))

        if self.custom_instructions:
            parts.append(f"\n## Custom Instructions\n{self.custom_instructions}")

        return "\n".join(parts)


class PodexMdParser:
    """
    Parser for PODEX.md project memory files.

    PODEX.md is a markdown file in the workspace root that contains
    project-specific context, conventions, and instructions for the agent.
    """

    FILENAME = "PODEX.md"

    # Section headers we recognize
    SECTIONS = {
        "description": ["description", "about", "overview"],
        "tech_stack": ["tech stack", "technologies", "stack", "dependencies"],
        "architecture": ["architecture", "structure", "design"],
        "key_patterns": ["patterns", "key patterns", "design patterns"],
        "important_files": ["important files", "key files", "main files"],
        "coding_conventions": ["conventions", "coding conventions", "style guide", "code style"],
        "common_commands": ["commands", "common commands", "scripts", "npm scripts"],
        "known_issues": ["known issues", "issues", "bugs", "problems"],
        "recent_changes": ["recent changes", "changelog", "changes", "updates"],
        "custom_instructions": ["instructions", "custom instructions", "notes", "agent notes"],
    }

    def __init__(self, workspace_path: str | None = None):
        self._workspace_path = workspace_path
        self._cached_context: ProjectContext | None = None
        self._cache_time: datetime | None = None

    def parse(self, content: str) -> ProjectContext:
        """
        Parse PODEX.md content into structured ProjectContext.

        Args:
            content: Raw markdown content

        Returns:
            ProjectContext with extracted information
        """
        context = ProjectContext(raw_content=content)

        # Extract project name from H1
        h1_match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
        if h1_match:
            context.project_name = h1_match.group(1).strip()

        # Split into sections
        sections = self._split_sections(content)

        for section_name, section_content in sections.items():
            self._parse_section(context, section_name, section_content)

        return context

    def _split_sections(self, content: str) -> dict[str, str]:
        """Split content into sections by H2 headers."""
        sections: dict[str, str] = {}
        current_section = "preamble"
        current_content: list[str] = []

        for line in content.split("\n"):
            if line.startswith("## "):
                # Save previous section
                if current_content:
                    sections[current_section] = "\n".join(current_content).strip()

                # Start new section
                header = line[3:].strip().lower()
                current_section = self._normalize_section_name(header)
                current_content = []
            else:
                current_content.append(line)

        # Save last section
        if current_content:
            sections[current_section] = "\n".join(current_content).strip()

        return sections

    def _normalize_section_name(self, header: str) -> str:
        """Normalize section header to known section name."""
        header_lower = header.lower()
        for section_name, aliases in self.SECTIONS.items():
            if header_lower in aliases or any(alias in header_lower for alias in aliases):
                return section_name
        return header_lower.replace(" ", "_")

    def _parse_section(
        self,
        context: ProjectContext,
        section_name: str,
        content: str,
    ) -> None:
        """Parse a section and update context."""
        if section_name == "description":
            context.description = content

        elif section_name == "tech_stack":
            context.tech_stack = self._extract_list(content)

        elif section_name == "architecture":
            context.architecture = content

        elif section_name == "key_patterns":
            context.key_patterns = self._extract_list(content)

        elif section_name == "important_files":
            context.important_files = self._extract_list(content)

        elif section_name == "coding_conventions":
            context.coding_conventions = self._extract_list(content)

        elif section_name == "common_commands":
            context.common_commands = self._extract_commands(content)

        elif section_name == "known_issues":
            context.known_issues = self._extract_list(content)

        elif section_name == "recent_changes":
            context.recent_changes = self._extract_list(content)

        elif section_name == "custom_instructions":
            context.custom_instructions = content

    def _extract_list(self, content: str) -> list[str]:
        """Extract list items from content."""
        items = []
        for line in content.split("\n"):
            line = line.strip()
            if line.startswith("- ") or line.startswith("* ") or line.startswith("• "):
                items.append(line[2:].strip())
            elif re.match(r"^\d+\.?\s+", line):
                # Numbered list
                items.append(re.sub(r"^\d+\.?\s+", "", line).strip())
        return items

    def _extract_commands(self, content: str) -> dict[str, str]:
        """Extract command definitions from content."""
        commands = {}
        # Look for patterns like `command`: description or - `command` - description
        patterns = [
            r'[`"]([^`"]+)[`"]\s*[:-]\s*(.+)',
            r'-\s+[`"]([^`"]+)[`"]\s*[:-]?\s*(.+)',
        ]

        for line in content.split("\n"):
            line = line.strip()
            for pattern in patterns:
                match = re.match(pattern, line)
                if match:
                    commands[match.group(1)] = match.group(2).strip()
                    break

        return commands

    async def load_from_workspace(self, workspace_path: str | None = None) -> ProjectContext | None:
        """
        Load and parse PODEX.md from workspace.

        Args:
            workspace_path: Path to workspace root

        Returns:
            ProjectContext or None if file doesn't exist
        """
        path = workspace_path or self._workspace_path
        if not path:
            return None

        podex_path = Path(path) / self.FILENAME
        if not podex_path.exists():
            return None

        try:
            content = podex_path.read_text()
            context = self.parse(content)
            context.last_modified = datetime.fromtimestamp(podex_path.stat().st_mtime)

            self._cached_context = context
            self._cache_time = datetime.utcnow()

            logger.info("podex_md_loaded", path=str(podex_path))
            return context

        except Exception as e:
            logger.error("podex_md_load_failed", path=str(podex_path), error=str(e))
            return None

    async def save_to_workspace(
        self,
        context: ProjectContext,
        workspace_path: str | None = None,
    ) -> bool:
        """
        Save ProjectContext back to PODEX.md.

        Args:
            context: The context to save
            workspace_path: Path to workspace root

        Returns:
            True if saved successfully
        """
        path = workspace_path or self._workspace_path
        if not path:
            return False

        try:
            content = self._generate_markdown(context)
            podex_path = Path(path) / self.FILENAME
            podex_path.write_text(content)

            self._cached_context = context
            self._cache_time = datetime.utcnow()

            logger.info("podex_md_saved", path=str(podex_path))
            return True

        except Exception as e:
            logger.error("podex_md_save_failed", error=str(e))
            return False

    def _generate_markdown(self, context: ProjectContext) -> str:
        """Generate PODEX.md content from context."""
        lines = []

        # Header
        lines.append(f"# {context.project_name or 'Project'}\n")

        if context.description:
            lines.append("## Description\n")
            lines.append(f"{context.description}\n")

        if context.tech_stack:
            lines.append("## Tech Stack\n")
            for item in context.tech_stack:
                lines.append(f"- {item}")
            lines.append("")

        if context.architecture:
            lines.append("## Architecture\n")
            lines.append(f"{context.architecture}\n")

        if context.key_patterns:
            lines.append("## Key Patterns\n")
            for item in context.key_patterns:
                lines.append(f"- {item}")
            lines.append("")

        if context.important_files:
            lines.append("## Important Files\n")
            for item in context.important_files:
                lines.append(f"- {item}")
            lines.append("")

        if context.coding_conventions:
            lines.append("## Coding Conventions\n")
            for item in context.coding_conventions:
                lines.append(f"- {item}")
            lines.append("")

        if context.common_commands:
            lines.append("## Common Commands\n")
            for cmd, desc in context.common_commands.items():
                lines.append(f"- `{cmd}`: {desc}")
            lines.append("")

        if context.known_issues:
            lines.append("## Known Issues\n")
            for item in context.known_issues:
                lines.append(f"- {item}")
            lines.append("")

        if context.recent_changes:
            lines.append("## Recent Changes\n")
            for item in context.recent_changes:
                lines.append(f"- {item}")
            lines.append("")

        if context.custom_instructions:
            lines.append("## Custom Instructions\n")
            lines.append(f"{context.custom_instructions}\n")

        return "\n".join(lines)

    def create_template(self, project_name: str = "My Project") -> str:
        """Create a template PODEX.md file."""
        return f"""# {project_name}

## Description
Brief description of your project and its purpose.

## Tech Stack
- Language/Framework
- Database
- Key libraries

## Architecture
Describe the high-level architecture of your project.

## Key Patterns
- Pattern 1: Description
- Pattern 2: Description

## Important Files
- `src/main.py` - Entry point
- `config/settings.py` - Configuration

## Coding Conventions
- Use descriptive variable names
- Follow PEP 8 / ESLint rules
- Write docstrings for public functions

## Common Commands
- `npm start`: Run development server
- `npm test`: Run tests
- `npm run build`: Build for production

## Known Issues
- Issue 1: Description and workaround
- Issue 2: Description and workaround

## Recent Changes
- Added feature X
- Fixed bug in Y

## Custom Instructions
Add any specific instructions for the AI agent here.
For example: "Always use TypeScript", "Prefer functional components", etc.
"""


# Global instance
_parser: PodexMdParser | None = None


def get_podex_parser(workspace_path: str | None = None) -> PodexMdParser:
    """Get or create a PODEX.md parser."""
    global _parser
    if _parser is None or workspace_path:
        _parser = PodexMdParser(workspace_path)
    return _parser
