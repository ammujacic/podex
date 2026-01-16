"""Custom agent that loads configuration from a template."""

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from src.agents.base import AgentConfig, BaseAgent, Tool
from src.mcp.registry import MCPToolRegistry

if TYPE_CHECKING:
    from src.providers.llm import LLMProvider


# Registry of all available tools that can be assigned to custom agents
AVAILABLE_TOOLS: dict[str, Tool] = {
    "read_file": Tool(
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
    "write_file": Tool(
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
    "search_code": Tool(
        name="search_code",
        description="Search for code patterns in the workspace",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "file_pattern": {"type": "string", "description": "File pattern to filter"},
            },
            "required": ["query"],
        },
    ),
    "run_command": Tool(
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
    "list_directory": Tool(
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
    "create_task": Tool(
        name="create_task",
        description="Create a task for another agent to handle",
        parameters={
            "type": "object",
            "properties": {
                "agent_role": {
                    "type": "string",
                    "description": "Target agent role (coder, reviewer, tester, architect, agent_builder, orchestrator)",  # noqa: E501
                },
                "description": {
                    "type": "string",
                    "description": "Task description",
                },
                "priority": {
                    "type": "string",
                    "enum": ["high", "medium", "low"],
                    "description": "Task priority",
                },
            },
            "required": ["agent_role", "description"],
        },
    ),
    # Delegation tools - allow custom agents to coordinate other agents
    "delegate_task": Tool(
        name="delegate_task",
        description="Delegate a task to a specific agent role. The task is enqueued and processed asynchronously.",  # noqa: E501
        parameters={
            "type": "object",
            "properties": {
                "agent_role": {
                    "type": "string",
                    "enum": [
                        "architect",
                        "coder",
                        "reviewer",
                        "tester",
                        "agent_builder",
                        "orchestrator",
                    ],
                    "description": "Target agent role",
                },
                "description": {
                    "type": "string",
                    "description": "Clear task description with requirements",
                },
                "priority": {
                    "type": "string",
                    "enum": ["high", "medium", "low"],
                    "description": "Task priority level",
                    "default": "medium",
                },
                "context": {
                    "type": "object",
                    "description": "Additional context data for the agent",
                },
            },
            "required": ["agent_role", "description"],
        },
    ),
    "get_task_status": Tool(
        name="get_task_status",
        description="Get the current status and result of a delegated task.",
        parameters={
            "type": "object",
            "properties": {
                "task_id": {
                    "type": "string",
                    "description": "Task ID to check",
                },
            },
            "required": ["task_id"],
        },
    ),
    "wait_for_tasks": Tool(
        name="wait_for_tasks",
        description=(
            "Wait for multiple tasks to complete. Returns when all tasks finish or timeout."
        ),
        parameters={
            "type": "object",
            "properties": {
                "task_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of task IDs to wait for",
                },
                "timeout_seconds": {
                    "type": "integer",
                    "description": "Maximum seconds to wait",
                    "default": 300,
                },
            },
            "required": ["task_ids"],
        },
    ),
    "get_all_pending_tasks": Tool(
        name="get_all_pending_tasks",
        description="Get all pending and active tasks in the current session.",
        parameters={
            "type": "object",
            "properties": {},
            "required": [],
        },
    ),
    # Git tools
    "git_status": Tool(
        name="git_status",
        description="Get git repository status",
        parameters={
            "type": "object",
            "properties": {},
            "required": [],
        },
    ),
    "git_diff": Tool(
        name="git_diff",
        description="Show git diff of changes",
        parameters={
            "type": "object",
            "properties": {
                "staged": {
                    "type": "boolean",
                    "description": "Show only staged changes",
                    "default": False,
                },
                "file": {
                    "type": "string",
                    "description": "Specific file to diff",
                },
            },
            "required": [],
        },
    ),
    "git_commit": Tool(
        name="git_commit",
        description="Create a git commit",
        parameters={
            "type": "object",
            "properties": {
                "message": {
                    "type": "string",
                    "description": "Commit message",
                },
                "files": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Specific files to commit",
                },
                "all_changes": {
                    "type": "boolean",
                    "description": "Commit all changes",
                    "default": False,
                },
            },
            "required": ["message"],
        },
    ),
    "git_push": Tool(
        name="git_push",
        description="Push commits to remote",
        parameters={
            "type": "object",
            "properties": {
                "remote": {
                    "type": "string",
                    "description": "Remote name",
                    "default": "origin",
                },
                "branch": {
                    "type": "string",
                    "description": "Branch to push",
                },
                "set_upstream": {
                    "type": "boolean",
                    "description": "Set upstream tracking",
                    "default": False,
                },
            },
            "required": [],
        },
    ),
    "git_branch": Tool(
        name="git_branch",
        description="Manage git branches",
        parameters={
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["list", "create", "delete", "checkout"],
                    "description": "Branch action",
                    "default": "list",
                },
                "name": {
                    "type": "string",
                    "description": "Branch name for create/delete/checkout",
                },
            },
            "required": [],
        },
    ),
    "git_log": Tool(
        name="git_log",
        description="Show git commit history",
        parameters={
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Number of commits to show",
                    "default": 10,
                },
                "oneline": {
                    "type": "boolean",
                    "description": "One line per commit",
                    "default": True,
                },
            },
            "required": [],
        },
    ),
    # File pattern matching
    "glob_files": Tool(
        name="glob_files",
        description="Find files matching a glob pattern (e.g., '**/*.py', 'src/**/*.ts')",
        parameters={
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Glob pattern to match (e.g., '**/*.py', 'src/*.ts')",
                },
                "path": {
                    "type": "string",
                    "description": "Base directory to search from (relative to workspace root)",
                    "default": ".",
                },
                "include_hidden": {
                    "type": "boolean",
                    "description": "Include hidden files (starting with .)",
                    "default": False,
                },
            },
            "required": ["pattern"],
        },
    ),
    # Patch application
    "apply_patch": Tool(
        name="apply_patch",
        description="Apply a unified diff patch to a file",
        parameters={
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "File path to apply patch to",
                },
                "patch": {
                    "type": "string",
                    "description": "Unified diff patch content",
                },
                "reverse": {
                    "type": "boolean",
                    "description": "Reverse the patch (undo changes)",
                    "default": False,
                },
            },
            "required": ["path", "patch"],
        },
    ),
    # URL fetching
    "fetch_url": Tool(
        name="fetch_url",
        description="Fetch content from a URL (HTML is converted to markdown)",
        parameters={
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "URL to fetch",
                },
                "extract_text": {
                    "type": "boolean",
                    "description": "Extract and clean text content (default: True)",
                    "default": True,
                },
                "max_length": {
                    "type": "integer",
                    "description": "Maximum content length in characters",
                    "default": 50000,
                },
            },
            "required": ["url"],
        },
    ),
    # Grep-style content search
    "grep": Tool(
        name="grep",
        description="Search for text patterns in files using regex",
        parameters={
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Regex pattern to search for",
                },
                "path": {
                    "type": "string",
                    "description": "File or directory to search in",
                    "default": ".",
                },
                "file_pattern": {
                    "type": "string",
                    "description": "Glob pattern to filter files (e.g., '*.py')",
                },
                "ignore_case": {
                    "type": "boolean",
                    "description": "Case-insensitive search",
                    "default": False,
                },
                "context_lines": {
                    "type": "integer",
                    "description": "Number of context lines around matches",
                    "default": 2,
                },
            },
            "required": ["pattern"],
        },
    ),
}


@dataclass
class AgentTemplateConfig:
    """Configuration loaded from agent_templates table."""

    name: str
    system_prompt: str
    allowed_tools: list[str]
    model: str
    temperature: float | None = None
    max_tokens: int | None = None
    config: dict[str, Any] | None = None


@dataclass
class CustomAgentContext:
    """Context for custom agent initialization."""

    workspace_path: str | Path | None = None
    session_id: str | None = None
    user_id: str | None = None


@dataclass
class CustomAgentInitConfig:
    """Configuration for initializing a CustomAgent."""

    agent_id: str
    model: str
    llm_provider: "LLMProvider"
    template_config: AgentTemplateConfig
    context: CustomAgentContext | None = None
    mcp_registry: MCPToolRegistry | None = None
    user_id: str | None = None


class CustomAgent(BaseAgent):
    """Agent that loads its configuration from a template."""

    def __init__(self, init_config: CustomAgentInitConfig) -> None:
        """Initialize custom agent with template configuration.

        Args:
            init_config: Configuration containing agent_id, model, llm_provider,
                template_config, context, and mcp_registry.
        """
        self._template_config = init_config.template_config
        context = init_config.context or CustomAgentContext()
        # Use template's model if specified, otherwise use provided model
        effective_model = init_config.template_config.model or init_config.model
        # Get user_id from init_config or context (prefer init_config)
        user_id = init_config.user_id or context.user_id
        config = AgentConfig(
            agent_id=init_config.agent_id,
            model=effective_model,
            llm_provider=init_config.llm_provider,
            workspace_path=context.workspace_path,
            session_id=context.session_id,
            mcp_registry=init_config.mcp_registry,
            user_id=user_id,
        )
        super().__init__(config)

    def _get_system_prompt(self) -> str:
        """Get system prompt from template config."""
        return self._template_config.system_prompt

    def _get_tools(self) -> list[Tool]:
        """Get tools based on allowed_tools from template config."""
        tools = []
        for tool_name in self._template_config.allowed_tools:
            if tool_name in AVAILABLE_TOOLS:
                tools.append(AVAILABLE_TOOLS[tool_name])
        return tools

    @property
    def temperature(self) -> float | None:
        """Get temperature setting from template config."""
        return self._template_config.temperature

    @property
    def max_tokens(self) -> int | None:
        """Get max_tokens setting from template config."""
        return self._template_config.max_tokens
