"""Default agent tools seed data.

This defines the complete registry of available tools that can be assigned to agents.
Each tool includes:
- Name and description
- Full JSON Schema parameters
- Category for organization

These are synced to the database on startup and can be customized by admins.
"""

from typing import Any, TypedDict


class AgentToolData(TypedDict, total=False):
    """Type definition for agent tool seed data."""

    name: str
    description: str
    parameters: dict[str, Any]
    category: str  # file, git, delegation, search, etc.
    sort_order: int
    is_enabled: bool
    is_system: bool
    # Permission flags for mode-based access control
    is_read_operation: bool  # Read-only (allowed in Plan mode) - defaults to True
    is_write_operation: bool  # Modifies files (blocked in Plan, needs approval in Ask)
    is_command_operation: bool  # Executes shell commands (needs allowlist in Auto)
    is_deploy_operation: bool  # Deployment ops (always needs approval except Sovereign)


# Default agent tools - the complete registry
# These define all available tools that can be assigned to agent roles
DEFAULT_AGENT_TOOLS: list[AgentToolData] = [
    # ==================== File Operations ====================
    {
        "name": "read_file",
        "description": "Read a file from the workspace",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative path (e.g., 'src/main.py')",
                },
            },
            "required": ["path"],
        },
        "category": "file",
        "sort_order": 10,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    {
        "name": "write_file",
        "description": "Write or update a file in the workspace",
        "parameters": {
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
        "category": "file",
        "sort_order": 20,
        "is_enabled": True,
        "is_system": True,
        "is_write_operation": True,
    },
    {
        "name": "list_directory",
        "description": "List files in a directory",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative directory path (e.g., 'src')",
                },
            },
            "required": ["path"],
        },
        "category": "file",
        "sort_order": 30,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    {
        "name": "glob_files",
        "description": "Find files matching a glob pattern (e.g., '**/*.py', 'src/**/*.ts')",
        "parameters": {
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
        "category": "file",
        "sort_order": 40,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    {
        "name": "apply_patch",
        "description": "Apply a unified diff patch to a file",
        "parameters": {
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
        "category": "file",
        "sort_order": 50,
        "is_enabled": True,
        "is_system": True,
        "is_write_operation": True,
    },
    # ==================== Search Operations ====================
    {
        "name": "search_code",
        "description": "Search for code patterns in the workspace",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "file_pattern": {
                    "type": "string",
                    "description": "File pattern to filter (e.g., '*.ts')",
                },
            },
            "required": ["query"],
        },
        "category": "search",
        "sort_order": 60,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    {
        "name": "grep",
        "description": "Search for text patterns in files using regex",
        "parameters": {
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
        "category": "search",
        "sort_order": 70,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    # ==================== Command Execution ====================
    {
        "name": "run_command",
        "description": "Run a shell command in the workspace",
        "parameters": {
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "Command to run"},
                "cwd": {"type": "string", "description": "Working directory"},
            },
            "required": ["command"],
        },
        "category": "command",
        "sort_order": 80,
        "is_enabled": True,
        "is_system": True,
        "is_command_operation": True,
    },
    # ==================== Git Operations ====================
    {
        "name": "git_status",
        "description": "Get git repository status",
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
        "category": "git",
        "sort_order": 100,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    {
        "name": "git_diff",
        "description": "Show git diff of changes",
        "parameters": {
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
                "base": {"type": "string", "description": "Base commit/branch"},
                "head": {"type": "string", "description": "Head commit/branch"},
            },
            "required": [],
        },
        "category": "git",
        "sort_order": 110,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    {
        "name": "git_commit",
        "description": "Create a git commit",
        "parameters": {
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
        "category": "git",
        "sort_order": 120,
        "is_enabled": True,
        "is_system": True,
        "is_write_operation": True,
    },
    {
        "name": "git_push",
        "description": "Push commits to remote",
        "parameters": {
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
        "category": "git",
        "sort_order": 130,
        "is_enabled": True,
        "is_system": True,
        "is_write_operation": True,
    },
    {
        "name": "git_branch",
        "description": "Manage git branches",
        "parameters": {
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
        "category": "git",
        "sort_order": 140,
        "is_enabled": True,
        "is_system": True,
        # Can both read (list) and write (create/delete/checkout) - mark as write for safety
        "is_write_operation": True,
    },
    {
        "name": "git_log",
        "description": "Show git commit history",
        "parameters": {
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
        "category": "git",
        "sort_order": 150,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    # ==================== Delegation Tools ====================
    # Delegation tools are internal orchestration - no file/command restrictions
    {
        "name": "create_task",
        "description": "Create a task for another agent to handle",
        "parameters": {
            "type": "object",
            "properties": {
                "agent_role": {
                    "type": "string",
                    "description": "Target agent role (coder, reviewer, tester, architect, etc.)",
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
        "category": "delegation",
        "sort_order": 200,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,  # No file/command restrictions
    },
    {
        "name": "delegate_task",
        "description": "Delegate a task to a specific agent role. Processed asynchronously.",
        "parameters": {
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
        "category": "delegation",
        "sort_order": 210,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    {
        "name": "get_task_status",
        "description": "Get the current status and result of a delegated task.",
        "parameters": {
            "type": "object",
            "properties": {
                "task_id": {
                    "type": "string",
                    "description": "Task ID to check",
                },
            },
            "required": ["task_id"],
        },
        "category": "delegation",
        "sort_order": 220,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    {
        "name": "wait_for_tasks",
        "description": "Wait for multiple tasks to complete. Returns when done or timeout.",
        "parameters": {
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
        "category": "delegation",
        "sort_order": 230,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    {
        "name": "get_all_pending_tasks",
        "description": "Get all pending and active tasks in the current session.",
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
        "category": "delegation",
        "sort_order": 240,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    # ==================== Orchestration Tools ====================
    # Orchestration tools are internal coordination - no file/command restrictions
    {
        "name": "create_execution_plan",
        "description": "Create a detailed execution plan for a complex task.",
        "parameters": {
            "type": "object",
            "properties": {
                "task_description": {
                    "type": "string",
                    "description": "Description of the task to plan",
                },
                "context": {
                    "type": "string",
                    "description": "Additional context for planning (codebase info, etc.)",
                },
            },
            "required": ["task_description"],
        },
        "category": "orchestration",
        "sort_order": 300,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    {
        "name": "create_custom_agent",
        "description": "Create a specialized custom agent for unique tasks.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Descriptive name for the agent",
                },
                "system_prompt": {
                    "type": "string",
                    "description": "System prompt defining agent behavior and expertise",
                },
                "tools": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Tools to enable for this agent",
                },
                "model": {
                    "type": "string",
                    "description": "LLM model to use",
                    "default": "claude-sonnet-4-20250514",
                },
            },
            "required": ["name", "system_prompt", "tools"],
        },
        "category": "orchestration",
        "sort_order": 310,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    {
        "name": "delegate_to_custom_agent",
        "description": "Send a task to a previously created custom agent and get the response.",
        "parameters": {
            "type": "object",
            "properties": {
                "agent_id": {
                    "type": "string",
                    "description": "ID of the custom agent (returned from create_custom_agent)",
                },
                "message": {
                    "type": "string",
                    "description": "Task message for the agent",
                },
            },
            "required": ["agent_id", "message"],
        },
        "category": "orchestration",
        "sort_order": 320,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    {
        "name": "synthesize_results",
        "description": "Gather results from completed tasks for final synthesis.",
        "parameters": {
            "type": "object",
            "properties": {
                "task_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Task IDs to gather results from",
                },
                "synthesis_instructions": {
                    "type": "string",
                    "description": "How to combine/summarize the results",
                },
            },
            "required": ["task_ids"],
        },
        "category": "orchestration",
        "sort_order": 330,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    # ==================== Agent Builder Tools ====================
    {
        "name": "create_agent_template",
        "description": "Create and save a new custom agent template.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Display name for the agent template",
                },
                "slug": {
                    "type": "string",
                    "description": "URL-friendly identifier (lowercase, numbers, hyphens only)",
                },
                "description": {
                    "type": "string",
                    "description": "Brief description of what this agent does",
                },
                "system_prompt": {
                    "type": "string",
                    "description": "System prompt defining agent behavior and personality",
                },
                "allowed_tools": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of tool names this agent can use",
                },
                "model": {
                    "type": "string",
                    "description": "LLM model to use",
                    "default": "claude-sonnet-4-20250514",
                },
                "temperature": {
                    "type": "number",
                    "description": "Temperature setting (0.0-1.0), omit for default",
                    "minimum": 0,
                    "maximum": 1,
                },
                "icon": {
                    "type": "string",
                    "description": "Emoji or icon identifier for the agent",
                },
            },
            "required": ["name", "slug", "system_prompt", "allowed_tools"],
        },
        "category": "agent_builder",
        "sort_order": 400,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,  # Creates DB record, not file operation
    },
    {
        "name": "list_available_tools",
        "description": "List all available tools for custom agents with descriptions.",
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
        "category": "agent_builder",
        "sort_order": 410,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    {
        "name": "preview_agent_template",
        "description": "Show a preview of the agent template configuration before creating it",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Agent name",
                },
                "description": {
                    "type": "string",
                    "description": "Agent description",
                },
                "system_prompt": {
                    "type": "string",
                    "description": "System prompt",
                },
                "allowed_tools": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Selected tools",
                },
                "model": {
                    "type": "string",
                    "description": "Selected model",
                },
                "temperature": {
                    "type": "number",
                    "description": "Temperature setting",
                },
                "icon": {
                    "type": "string",
                    "description": "Icon/emoji",
                },
            },
            "required": ["name", "system_prompt", "allowed_tools"],
        },
        "category": "agent_builder",
        "sort_order": 420,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    # ==================== Review Tools ====================
    {
        "name": "add_comment",
        "description": "Add a review comment to a file",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative path (e.g., 'src/main.py')",
                },
                "line": {"type": "integer", "description": "Line number"},
                "comment": {"type": "string", "description": "Review comment"},
                "severity": {
                    "type": "string",
                    "enum": ["critical", "important", "suggestion"],
                },
            },
            "required": ["path", "line", "comment"],
        },
        "category": "review",
        "sort_order": 500,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,  # Adds metadata, doesn't modify file content
    },
    {
        "name": "get_coverage",
        "description": "Get test coverage report",
        "parameters": {
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
        "category": "testing",
        "sort_order": 510,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    # ==================== Web/Network Tools ====================
    {
        "name": "fetch_url",
        "description": "Fetch content from a URL (HTML is converted to markdown)",
        "parameters": {
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
        "category": "web",
        "sort_order": 600,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    # ==================== Memory Tools ====================
    # Memory tools modify DB records, not workspace files - no file/command restrictions
    {
        "name": "store_memory",
        "description": (
            "Store a fact or insight for later recall. Use this to remember user preferences, "
            "project patterns, decisions made, or solutions discovered."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "The information to remember",
                },
                "memory_type": {
                    "type": "string",
                    "enum": ["fact", "preference", "context", "code_pattern", "error_solution"],
                    "description": "Type of memory",
                    "default": "fact",
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Tags for categorization",
                },
                "importance": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "description": "Importance score (0-1)",
                    "default": 0.5,
                },
            },
            "required": ["content"],
        },
        "category": "memory",
        "sort_order": 700,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    {
        "name": "recall_memory",
        "description": (
            "Search memories for relevant information. Use this to recall user preferences, "
            "patterns, or solutions from previous interactions."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query describing what you're looking for",
                },
                "memory_type": {
                    "type": "string",
                    "enum": ["fact", "preference", "context", "code_pattern", "error_solution"],
                    "description": "Filter by memory type",
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Filter by tags",
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 20,
                    "description": "Maximum results to return",
                    "default": 5,
                },
            },
            "required": ["query"],
        },
        "category": "memory",
        "sort_order": 710,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    {
        "name": "update_memory",
        "description": "Update an existing memory's content, tags, or importance.",
        "parameters": {
            "type": "object",
            "properties": {
                "memory_id": {
                    "type": "string",
                    "description": "ID of the memory to update",
                },
                "content": {
                    "type": "string",
                    "description": "New content for the memory",
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "New tags for the memory",
                },
                "importance": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "description": "New importance score (0-1)",
                },
            },
            "required": ["memory_id"],
        },
        "category": "memory",
        "sort_order": 720,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    {
        "name": "delete_memory",
        "description": "Delete a memory by its ID.",
        "parameters": {
            "type": "object",
            "properties": {
                "memory_id": {
                    "type": "string",
                    "description": "ID of the memory to delete",
                },
            },
            "required": ["memory_id"],
        },
        "category": "memory",
        "sort_order": 730,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
    {
        "name": "get_session_memories",
        "description": "Get all memories stored in the current session.",
        "parameters": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 50,
                    "description": "Maximum memories to return",
                    "default": 20,
                },
            },
            "required": [],
        },
        "category": "memory",
        "sort_order": 740,
        "is_enabled": True,
        "is_system": True,
        "is_read_operation": True,
    },
]
