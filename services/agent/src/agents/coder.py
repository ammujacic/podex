"""Coder agent for writing and modifying code."""

from src.agents.base import BaseAgent, Tool


class CoderAgent(BaseAgent):
    """Coder agent specializing in writing code."""

    def _get_system_prompt(self) -> str:
        """Get coder system prompt."""
        return """You are an expert software developer. Your role is to:

1. **Write Clean Code**: Produce well-structured, readable, and maintainable code.

2. **Follow Best Practices**: Adhere to language-specific conventions and project guidelines.

3. **Implement Features**: Build features based on specifications from the Architect.

4. **Refactor**: Improve existing code without changing its behavior.

5. **Document**: Add appropriate comments and documentation.

When writing code:
- Use meaningful variable and function names
- Keep functions small and focused
- Handle errors appropriately
- Consider edge cases
- Write code that is easy to test

Always explain your changes and reasoning. If you're unsure about something,
ask for clarification rather than making assumptions."""

    def _get_tools(self) -> list[Tool]:
        """Get coder tools."""
        return [
            Tool(
                name="read_file",
                description="Read a file from the workspace",
                parameters={
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "File path to read"},
                    },
                    "required": ["path"],
                },
            ),
            Tool(
                name="write_file",
                description="Write or update a file in the workspace",
                parameters={
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "File path to write"},
                        "content": {"type": "string", "description": "File content"},
                    },
                    "required": ["path", "content"],
                },
            ),
            Tool(
                name="search_code",
                description="Search for code patterns in the workspace",
                parameters={
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query"},
                        "file_pattern": {"type": "string", "description": "File pattern"},
                    },
                    "required": ["query"],
                },
            ),
            Tool(
                name="run_command",
                description="Run a shell command in the workspace",
                parameters={
                    "type": "object",
                    "properties": {
                        "command": {"type": "string", "description": "Command to run"},
                        "cwd": {"type": "string", "description": "Working directory"},
                    },
                    "required": ["command"],
                },
            ),
            Tool(
                name="list_directory",
                description="List files in a directory",
                parameters={
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Directory path"},
                    },
                    "required": ["path"],
                },
            ),
        ]
