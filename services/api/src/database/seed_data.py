"""Default seed data for terminal-integrated agent types."""

from typing import TypedDict


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
