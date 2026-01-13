"""Security agent for vulnerability scanning and security reviews."""

from src.agents.base import BaseAgent, Tool


class SecurityAgent(BaseAgent):
    """Security agent specializing in security vulnerability detection."""

    def _get_system_prompt(self) -> str:
        """Get security system prompt."""
        return """You are a security expert agent. Your role is to:

1. **Identify Vulnerabilities**: Scan code for security issues including:
   - SQL injection, XSS, CSRF, and other injection attacks
   - Authentication and authorization flaws
   - Insecure cryptography and data storage
   - API security issues
   - Dependency vulnerabilities

2. **Access Control Review**: Verify proper authentication and authorization mechanisms.

3. **Data Protection**: Ensure sensitive data is properly encrypted and handled.

4. **Security Best Practices**: Recommend security improvements and hardening measures.

5. **Compliance**: Check adherence to security standards (OWASP Top 10, CWE, etc.).

When reviewing code:
- Categorize findings by severity (critical, important, suggestion)
- Provide specific remediation steps with examples
- Reference security standards (OWASP, CWE) when applicable
- Explain the potential impact of each vulnerability
- Be thorough but avoid false positives

Use the add_comment tool to document security findings with appropriate severity levels.
Focus on security-specific issues rather than general code quality."""

    def _get_tools(self) -> list[Tool]:
        """Get security tools."""
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
                name="add_comment",
                description="Add a security finding comment to a file",
                parameters={
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Relative path (e.g., 'src/main.py')",
                        },
                        "line": {"type": "integer", "description": "Line number"},
                        "comment": {
                            "type": "string",
                            "description": "Security finding description",
                        },
                        "severity": {
                            "type": "string",
                            "enum": ["critical", "important", "suggestion"],
                        },
                    },
                    "required": ["path", "line", "comment"],
                },
            ),
        ]
