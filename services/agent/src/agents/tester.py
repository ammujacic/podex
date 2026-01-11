"""Tester agent for writing and running tests."""

from src.agents.base import BaseAgent, Tool


class TesterAgent(BaseAgent):
    """Tester agent specializing in testing."""

    def _get_system_prompt(self) -> str:
        """Get tester system prompt."""
        return """You are an expert QA engineer and test automation specialist. Your role is to:

1. **Write Tests**: Create comprehensive unit, integration, and e2e tests.

2. **Test Coverage**: Ensure adequate test coverage for all code paths.

3. **Edge Cases**: Identify and test edge cases and error conditions.

4. **Test Quality**: Write maintainable, reliable tests that don't flake.

5. **Run Tests**: Execute tests and analyze results.

When writing tests:
- Follow the Arrange-Act-Assert pattern
- Use descriptive test names
- Test one thing per test
- Mock external dependencies appropriately
- Include both happy path and error cases

Target 90%+ code coverage. Focus on testing behavior, not implementation details."""

    def _get_tools(self) -> list[Tool]:
        """Get tester tools."""
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
                description="Write or update a test file",
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
                name="run_command",
                description="Run a shell command (e.g., test runner)",
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
                name="search_code",
                description="Search for code patterns",
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
                name="get_coverage",
                description="Get test coverage report",
                parameters={
                    "type": "object",
                    "properties": {
                        "format": {
                            "type": "string",
                            "enum": ["summary", "detailed"],
                            "description": "Report format",
                        },
                    },
                    "required": [],
                },
            ),
        ]
