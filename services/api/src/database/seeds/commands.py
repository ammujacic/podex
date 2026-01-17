"""Default global slash commands seed data."""

from typing import TypedDict


class GlobalCommandData(TypedDict, total=False):
    """Type definition for global slash command seed data."""

    name: str
    description: str
    prompt_template: str
    arguments: list[dict[str, str | bool | None]]
    category: str
    sort_order: int


# Global slash commands available to all users
DEFAULT_GLOBAL_COMMANDS: list[GlobalCommandData] = [
    # Development commands
    {
        "name": "review",
        "description": "Review code for bugs, performance issues, and best practices",
        "prompt_template": (
            "Please review the following code for bugs, performance issues, "
            "security vulnerabilities, and adherence to best practices. "
            "Provide specific suggestions for improvement:\n\n{{code}}"
        ),
        "arguments": [
            {
                "name": "code",
                "type": "string",
                "required": True,
                "default": None,
                "description": "Code to review",
            }
        ],
        "category": "development",
        "sort_order": 10,
    },
    {
        "name": "debug",
        "description": "Help debug an error or unexpected behavior",
        "prompt_template": (
            "I'm encountering the following error or unexpected behavior. "
            "Please help me understand what's causing it and how to fix it:"
            "\n\n{{error}}\n\nContext: {{context}}"
        ),
        "arguments": [
            {
                "name": "error",
                "type": "string",
                "required": True,
                "default": None,
                "description": "Error message or description",
            },
            {
                "name": "context",
                "type": "string",
                "required": False,
                "default": "",
                "description": "Additional context",
            },
        ],
        "category": "development",
        "sort_order": 11,
    },
    {
        "name": "optimize",
        "description": "Optimize code for performance",
        "prompt_template": (
            "Please analyze and optimize the following code for better "
            "performance. Explain what changes you made and why:\n\n{{code}}"
        ),
        "arguments": [
            {
                "name": "code",
                "type": "string",
                "required": True,
                "default": None,
                "description": "Code to optimize",
            }
        ],
        "category": "development",
        "sort_order": 12,
    },
    {
        "name": "document",
        "description": "Generate documentation for code",
        "prompt_template": (
            "Please generate comprehensive documentation for the following "
            "code, including JSDoc/docstrings, usage examples, and parameter "
            "descriptions:\n\n{{code}}"
        ),
        "arguments": [
            {
                "name": "code",
                "type": "string",
                "required": True,
                "default": None,
                "description": "Code to document",
            }
        ],
        "category": "development",
        "sort_order": 13,
    },
    {
        "name": "tests",
        "description": "Generate unit tests for code",
        "prompt_template": (
            "Please generate comprehensive unit tests for the following code. "
            "Include edge cases, error handling, and mock setup where needed:"
            "\n\n{{code}}"
        ),
        "arguments": [
            {
                "name": "code",
                "type": "string",
                "required": True,
                "default": None,
                "description": "Code to test",
            }
        ],
        "category": "test",
        "sort_order": 20,
    },
    # Git commands
    {
        "name": "changelog",
        "description": "Generate a changelog from recent commits",
        "prompt_template": (
            "Please analyze the recent git commits and generate a "
            "well-formatted changelog entry. Group changes by type "
            "(features, fixes, improvements) and write user-friendly "
            "descriptions."
        ),
        "arguments": [],
        "category": "git",
        "sort_order": 30,
    },
    {
        "name": "pr-description",
        "description": "Generate a pull request description",
        "prompt_template": (
            "Please analyze the changes in this branch and generate a "
            "comprehensive pull request description. Include:\n"
            "- Summary of changes\n- Motivation/context\n- Testing done\n"
            "- Screenshots if applicable\n\nFocus: {{focus}}"
        ),
        "arguments": [
            {
                "name": "focus",
                "type": "string",
                "required": False,
                "default": "all changes",
                "description": "What to focus on",
            }
        ],
        "category": "git",
        "sort_order": 31,
    },
    # Code generation
    {
        "name": "component",
        "description": "Generate a React/Vue/Svelte component",
        "prompt_template": (
            "Please create a {{framework}} component with the following "
            "specifications:\n\nName: {{name}}\nDescription: {{description}}"
            "\n\nInclude proper TypeScript types, styling, and any necessary "
            "hooks or state management."
        ),
        "arguments": [
            {
                "name": "framework",
                "type": "string",
                "required": False,
                "default": "React",
                "description": "Framework (React/Vue/Svelte)",
            },
            {
                "name": "name",
                "type": "string",
                "required": True,
                "default": None,
                "description": "Component name",
            },
            {
                "name": "description",
                "type": "string",
                "required": True,
                "default": None,
                "description": "What the component should do",
            },
        ],
        "category": "code",
        "sort_order": 40,
    },
    {
        "name": "api",
        "description": "Generate an API endpoint",
        "prompt_template": (
            "Please create a {{method}} API endpoint for {{purpose}}. "
            "Include:\n- Request validation\n- Error handling\n"
            "- Response types\n- Database operations if needed\n\n"
            "Framework: {{framework}}"
        ),
        "arguments": [
            {
                "name": "method",
                "type": "string",
                "required": False,
                "default": "POST",
                "description": "HTTP method",
            },
            {
                "name": "purpose",
                "type": "string",
                "required": True,
                "default": None,
                "description": "What the endpoint does",
            },
            {
                "name": "framework",
                "type": "string",
                "required": False,
                "default": "auto-detect",
                "description": "Backend framework",
            },
        ],
        "category": "code",
        "sort_order": 41,
    },
    {
        "name": "migrate",
        "description": "Generate a database migration",
        "prompt_template": (
            "Please generate a database migration for the following changes:"
            "\n\n{{changes}}\n\nInclude both up and down migrations with "
            "proper data preservation."
        ),
        "arguments": [
            {
                "name": "changes",
                "type": "string",
                "required": True,
                "default": None,
                "description": "Schema changes needed",
            }
        ],
        "category": "code",
        "sort_order": 42,
    },
]
