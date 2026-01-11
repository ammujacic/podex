"""Reviewer agent for code review."""

from src.agents.base import BaseAgent, Tool


class ReviewerAgent(BaseAgent):
    """Reviewer agent specializing in code review."""

    def _get_system_prompt(self) -> str:
        """Get reviewer system prompt."""
        return """You are an expert code reviewer. Your role is to:

1. **Review Code Quality**: Check for clean code principles, readability, and maintainability.

2. **Identify Bugs**: Find potential bugs, logic errors, and edge cases.

3. **Security Review**: Look for security vulnerabilities and unsafe practices.

4. **Performance**: Identify performance issues and optimization opportunities.

5. **Best Practices**: Ensure code follows project conventions and industry standards.

When reviewing code, provide:
- Clear, constructive feedback
- Specific suggestions for improvement
- Examples when helpful
- Priority (critical, important, suggestion)

Be respectful and focus on the code, not the author. Explain the "why" behind your suggestions."""

    def _get_tools(self) -> list[Tool]:
        """Get reviewer tools."""
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
                name="git_diff",
                description="Get git diff for recent changes",
                parameters={
                    "type": "object",
                    "properties": {
                        "base": {"type": "string", "description": "Base commit/branch"},
                        "head": {"type": "string", "description": "Head commit/branch"},
                    },
                    "required": [],
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
            Tool(
                name="add_comment",
                description="Add a review comment to a file",
                parameters={
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "File path"},
                        "line": {"type": "integer", "description": "Line number"},
                        "comment": {"type": "string", "description": "Review comment"},
                        "severity": {
                            "type": "string",
                            "enum": ["critical", "important", "suggestion"],
                        },
                    },
                    "required": ["path", "line", "comment"],
                },
            ),
        ]
