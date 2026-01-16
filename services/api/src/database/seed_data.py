"""Default seed data for terminal-integrated agent types and global commands."""

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


class TerminalAgentData(TypedDict, total=False):
    """Type definition for terminal agent seed data."""

    name: str
    slug: str
    logo_url: str
    description: str
    check_installed_command: list[str] | None
    version_command: list[str] | None
    install_command: list[str] | None
    update_command: list[str] | None
    run_command: list[str]
    default_env_template: dict[str, str]
    is_enabled: bool


# Terminal agent types that can be installed automatically
# Only includes agents with install_command defined
DEFAULT_TERMINAL_AGENTS: list[TerminalAgentData] = [
    {
        "name": "Claude Code",
        "slug": "claude-code",
        "logo_url": "/assets/agents/claude-code.svg",
        "description": "Anthropic's official agentic CLI for Claude - autonomous coding assistant",
        "check_installed_command": ["bash", "-lc", "command -v claude"],
        "version_command": ["claude", "--version"],
        "install_command": ["bash", "-lc", "npm install -g @anthropic-ai/claude-code"],
        "update_command": ["bash", "-lc", "npm update -g @anthropic-ai/claude-code"],
        "run_command": ["claude"],
        "default_env_template": {
            "ANTHROPIC_API_KEY": "",
        },
        "is_enabled": True,
    },
    {
        "name": "Aider",
        "slug": "aider",
        "logo_url": "/assets/agents/aider.svg",
        "description": "AI pair programming in your terminal - edit code with GPT-4 and Claude",
        "check_installed_command": ["bash", "-lc", "command -v aider"],
        "version_command": ["aider", "--version"],
        "install_command": ["bash", "-lc", "pip install -U aider-chat"],
        "update_command": ["bash", "-lc", "pip install -U aider-chat"],
        "run_command": ["aider"],
        "default_env_template": {
            "OPENAI_API_KEY": "",
            "ANTHROPIC_API_KEY": "",
            "DEEPSEEK_API_KEY": "",
        },
        "is_enabled": True,
    },
    {
        "name": "OpenCode",
        "slug": "opencode",
        "logo_url": "/assets/agents/opencode.svg",
        "description": "Open-source AI coding agent with terminal interface",
        "check_installed_command": ["bash", "-lc", "command -v opencode"],
        "version_command": ["opencode", "--version"],
        "install_command": ["bash", "-lc", "curl -fsSL https://opencode.ai/install | bash"],
        "update_command": None,
        "run_command": ["opencode"],
        "default_env_template": {
            "OPENAI_API_KEY": "",
            "ANTHROPIC_API_KEY": "",
            "OPENROUTER_API_KEY": "",
        },
        "is_enabled": True,
    },
    {
        "name": "Open Interpreter",
        "slug": "open-interpreter",
        "logo_url": "/assets/agents/open-interpreter.png",
        "description": "Let language models run code locally - a natural language interface",
        "check_installed_command": ["bash", "-lc", "command -v interpreter"],
        "version_command": ["interpreter", "--version"],
        "install_command": ["bash", "-lc", "pip install -U open-interpreter"],
        "update_command": ["bash", "-lc", "pip install -U open-interpreter"],
        "run_command": ["interpreter"],
        "default_env_template": {
            "OPENAI_API_KEY": "",
            "ANTHROPIC_API_KEY": "",
            "OLLAMA_BASE_URL": "",
        },
        "is_enabled": True,
    },
    {
        "name": "GitHub Copilot CLI",
        "slug": "github-copilot",
        "logo_url": "/assets/agents/github-copilot.svg",
        "description": "GitHub's AI coding assistant for the command line",
        "check_installed_command": ["bash", "-lc", "command -v gh && gh copilot --help"],
        "version_command": ["gh", "copilot", "--version"],
        "install_command": ["bash", "-lc", "gh extension install github/gh-copilot"],
        "update_command": ["bash", "-lc", "gh extension upgrade gh-copilot"],
        "run_command": ["gh", "copilot"],
        "default_env_template": {
            "GITHUB_TOKEN": "",
        },
        "is_enabled": True,
    },
    {
        "name": "Cody CLI",
        "slug": "cody",
        "logo_url": "/assets/agents/cody.svg",
        "description": "Sourcegraph's AI coding assistant with codebase context",
        "check_installed_command": ["bash", "-lc", "command -v cody"],
        "version_command": ["cody", "version"],
        "install_command": ["bash", "-lc", "npm install -g @sourcegraph/cody"],
        "update_command": ["bash", "-lc", "npm update -g @sourcegraph/cody"],
        "run_command": ["cody", "chat"],
        "default_env_template": {
            "SRC_ACCESS_TOKEN": "",
            "SRC_ENDPOINT": "https://sourcegraph.com",
        },
        "is_enabled": True,
    },
    {
        "name": "Continue",
        "slug": "continue",
        "logo_url": "/assets/agents/continue.png",
        "description": "Open-source AI code assistant - works with any LLM",
        "check_installed_command": ["bash", "-lc", "command -v continue"],
        "version_command": ["continue", "--version"],
        "install_command": ["bash", "-lc", "pip install -U continuedev"],
        "update_command": ["bash", "-lc", "pip install -U continuedev"],
        "run_command": ["continue"],
        "default_env_template": {
            "OPENAI_API_KEY": "",
            "ANTHROPIC_API_KEY": "",
        },
        "is_enabled": True,
    },
    {
        "name": "GPT Pilot",
        "slug": "gpt-pilot",
        "logo_url": "/assets/agents/gpt-pilot.svg",
        "description": "AI developer that writes scalable apps from scratch",
        "check_installed_command": ["bash", "-lc", "command -v gpt-pilot"],
        "version_command": ["gpt-pilot", "--version"],
        "install_command": ["bash", "-lc", "pip install -U gpt-pilot"],
        "update_command": ["bash", "-lc", "pip install -U gpt-pilot"],
        "run_command": ["gpt-pilot"],
        "default_env_template": {
            "OPENAI_API_KEY": "",
            "ANTHROPIC_API_KEY": "",
        },
        "is_enabled": True,
    },
    {
        "name": "Mentat",
        "slug": "mentat",
        "logo_url": "/assets/agents/mentat.svg",
        "description": "AI coding assistant that understands your entire codebase",
        "check_installed_command": ["bash", "-lc", "command -v mentat"],
        "version_command": ["mentat", "--version"],
        "install_command": ["bash", "-lc", "pip install -U mentat"],
        "update_command": ["bash", "-lc", "pip install -U mentat"],
        "run_command": ["mentat"],
        "default_env_template": {
            "OPENAI_API_KEY": "",
            "ANTHROPIC_API_KEY": "",
        },
        "is_enabled": True,
    },
    {
        "name": "Plandex",
        "slug": "plandex",
        "logo_url": "/assets/agents/plandex.png",
        "description": "AI coding engine for complex, multi-file tasks",
        "check_installed_command": ["bash", "-lc", "command -v plandex"],
        "version_command": ["plandex", "version"],
        "install_command": ["bash", "-lc", "curl -sL https://plandex.ai/install.sh | bash"],
        "update_command": ["bash", "-lc", "plandex upgrade"],
        "run_command": ["plandex"],
        "default_env_template": {
            "OPENAI_API_KEY": "",
            "PLANDEX_API_KEY": "",
        },
        "is_enabled": True,
    },
    {
        "name": "Goose",
        "slug": "goose",
        "logo_url": "/assets/agents/goose.png",
        "description": "AI programming assistant from Block - autonomous developer agent",
        "check_installed_command": ["bash", "-lc", "command -v goose"],
        "version_command": ["goose", "--version"],
        "install_command": ["bash", "-lc", "pip install -U goose-ai"],
        "update_command": ["bash", "-lc", "pip install -U goose-ai"],
        "run_command": ["goose", "session", "start"],
        "default_env_template": {
            "OPENAI_API_KEY": "",
            "ANTHROPIC_API_KEY": "",
        },
        "is_enabled": True,
    },
    {
        "name": "Cline",
        "slug": "cline",
        "logo_url": "/assets/agents/cline.svg",
        "description": "Autonomous coding agent (formerly Claude Dev) - can use tools",
        "check_installed_command": ["bash", "-lc", "command -v cline"],
        "version_command": ["cline", "--version"],
        "install_command": ["bash", "-lc", "npm install -g cline"],
        "update_command": ["bash", "-lc", "npm update -g cline"],
        "run_command": ["cline"],
        "default_env_template": {
            "ANTHROPIC_API_KEY": "",
            "OPENAI_API_KEY": "",
        },
        "is_enabled": True,
    },
    {
        "name": "SWE-agent",
        "slug": "swe-agent",
        "logo_url": "/assets/agents/swe-agent.png",
        "description": "Princeton's software engineering agent for GitHub issues",
        "check_installed_command": ["bash", "-lc", "command -v sweagent"],
        "version_command": ["sweagent", "--version"],
        "install_command": ["bash", "-lc", "pip install -U sweagent"],
        "update_command": ["bash", "-lc", "pip install -U sweagent"],
        "run_command": ["sweagent", "run"],
        "default_env_template": {
            "OPENAI_API_KEY": "",
            "ANTHROPIC_API_KEY": "",
            "GITHUB_TOKEN": "",
        },
        "is_enabled": True,
    },
    {
        "name": "Codex CLI",
        "slug": "codex-cli",
        "logo_url": "/assets/agents/codex.svg",
        "description": "OpenAI's lightweight coding agent that runs in your terminal",
        "check_installed_command": ["bash", "-lc", "command -v codex"],
        "version_command": ["codex", "--version"],
        "install_command": ["bash", "-lc", "npm install -g @openai/codex"],
        "update_command": ["bash", "-lc", "npm update -g @openai/codex"],
        "run_command": ["codex"],
        "default_env_template": {
            "OPENAI_API_KEY": "",
        },
        "is_enabled": True,
    },
    {
        "name": "Tabby",
        "slug": "tabby",
        "logo_url": "/assets/agents/tabby.png",
        "description": "Self-hosted AI coding assistant - privacy-first code completion",
        "check_installed_command": ["bash", "-lc", "command -v tabby"],
        "version_command": ["tabby", "--version"],
        "install_command": [
            "bash",
            "-lc",
            "curl -fsSL https://tabby.tabbyml.com/install.sh | bash",
        ],
        "update_command": None,
        "run_command": ["tabby", "serve"],
        "default_env_template": {
            "TABBY_MODEL": "StarCoder-1B",
        },
        "is_enabled": True,
    },
]
