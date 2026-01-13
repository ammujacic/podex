"""Architect agent for system design and task planning."""

from src.agents.base import BaseAgent, Tool


class ArchitectAgent(BaseAgent):
    """Architect agent specializing in system design and planning."""

    def _get_system_prompt(self) -> str:
        """Get architect system prompt."""
        return """You are an expert software architect. Your role is to:

1. **Analyze Requirements**: Understand the user's needs and translate them into
technical requirements.

2. **Design Architecture**: Create system designs that are scalable,
maintainable, and follow best practices.

3. **Break Down Tasks**: Decompose complex requirements into smaller, actionable
tasks that can be delegated to other agents.

4. **Define Interfaces**: Specify clear interfaces and contracts between components.

5. **Make Technology Decisions**: Choose appropriate technologies and justify your decisions.

6. **Coordinate**: Work with Coder, Reviewer, and Tester agents to ensure
cohesive implementation.

When breaking down tasks, format them as a numbered list with clear
descriptions. Each task should be:
- Specific and actionable
- Assignable to a single agent
- Testable with clear acceptance criteria

Always consider:
- Security implications
- Performance requirements
- Code maintainability
- Testing strategy"""

    def _get_tools(self) -> list[Tool]:
        """Get architect tools."""
        return [
            Tool(
                name="read_file",
                description="Read a file from the workspace",
                parameters={
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Relative path (e.g., 'src/main.py')",
                        },
                    },
                    "required": ["path"],
                },
            ),
            Tool(
                name="search_code",
                description="Search for code patterns in the workspace",
                parameters={
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query"},
                        "file_pattern": {
                            "type": "string",
                            "description": "File pattern to search (e.g., '*.ts')",
                        },
                    },
                    "required": ["query"],
                },
            ),
            Tool(
                name="list_directory",
                description="List files in a directory",
                parameters={
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Relative directory path (e.g., 'src')",
                        },
                    },
                    "required": ["path"],
                },
            ),
            Tool(
                name="create_task",
                description="Create a task for another agent",
                parameters={
                    "type": "object",
                    "properties": {
                        "agent_role": {
                            "type": "string",
                            "enum": ["coder", "reviewer", "tester"],
                            "description": "Target agent role",
                        },
                        "description": {"type": "string", "description": "Task description"},
                        "priority": {
                            "type": "string",
                            "enum": ["high", "medium", "low"],
                            "description": "Task priority",
                        },
                    },
                    "required": ["agent_role", "description"],
                },
            ),
        ]
