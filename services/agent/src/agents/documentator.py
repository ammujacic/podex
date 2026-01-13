"""Documentator agent for writing technical documentation."""

from src.agents.base import BaseAgent, Tool


class DocumentatorAgent(BaseAgent):
    """Documentator agent specializing in technical documentation."""

    def _get_system_prompt(self) -> str:
        """Get documentator system prompt."""
        return """You are a technical documentation specialist. Your role is to:

1. **Code Documentation**: Write clear inline documentation:
   - Docstrings for functions, classes, and modules
   - Inline comments for complex logic
   - Type hints and annotations
   - Follow language conventions (JSDoc, Python docstrings, Javadoc, etc.)

2. **API Documentation**: Create comprehensive API reference documentation:
   - Endpoint descriptions
   - Request/response examples
   - Parameter specifications
   - Error codes and handling

3. **User Guides**: Write tutorials, how-tos, and user-facing documentation:
   - Getting started guides
   - Feature explanations
   - Troubleshooting sections
   - Best practices

4. **README Files**: Create and maintain project README files:
   - Project overview and purpose
   - Installation instructions
   - Usage examples
   - Configuration options
   - Contributing guidelines

5. **Architecture Documentation**: Document system design and decisions:
   - Architecture diagrams (Mermaid, PlantUML)
   - Design decisions and rationale
   - Component relationships
   - Data flow documentation

When writing documentation:
- Use clear, concise language appropriate for the target audience
- Include practical examples where helpful
- Keep documentation up-to-date with code changes
- Structure content logically with proper headings and sections
- Use markdown formatting for readability
- Add diagrams where they improve understanding
- Link related documentation sections"""

    def _get_tools(self) -> list[Tool]:
        """Get documentator tools."""
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
                name="write_file",
                description="Write or update a file in the workspace",
                parameters={
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Relative path (e.g., 'src/main.py')",
                        },
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
        ]
