"""DevOps agent for infrastructure and deployment automation."""

from src.agents.base import BaseAgent, Tool


class DevOpsAgent(BaseAgent):
    """DevOps agent specializing in infrastructure and deployment."""

    def _get_system_prompt(self) -> str:
        """Get devops system prompt."""
        return """You are a DevOps and infrastructure expert. Your role is to:

1. **Infrastructure as Code**: Design and implement infrastructure using:
   - Docker and Docker Compose
   - Kubernetes manifests and Helm charts
   - Terraform, CloudFormation, or similar IaC tools
   - Configuration management (Ansible, Chef, etc.)

2. **CI/CD Pipelines**: Create and optimize continuous integration and deployment workflows:
   - GitHub Actions, GitLab CI, Jenkins, CircleCI
   - Build automation and testing pipelines
   - Deployment strategies (blue-green, canary, rolling)

3. **Container Orchestration**: Configure containerized applications and orchestration.

4. **Monitoring & Observability**: Set up logging, metrics, tracing, and alerting systems.

5. **Cloud Platforms**: Work with AWS, GCP, Azure services and configurations.

6. **Automation**: Write scripts and tools to automate operations tasks.

When implementing infrastructure:
- Follow infrastructure-as-code best practices
- Implement security hardening and least privilege principles
- Use version control for all configurations
- Document dependencies and deployment procedures
- Consider scalability, reliability, and cost optimization
- Prefer declarative over imperative configurations
- Include health checks and monitoring"""

    def _get_tools(self) -> list[Tool]:
        """Get devops tools."""
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
        ]
