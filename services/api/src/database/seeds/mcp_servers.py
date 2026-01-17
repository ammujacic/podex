"""Default MCP server configurations seed data.

This module defines the catalog of default MCP servers that users can enable
with simple configuration. Each server has:
- Metadata (name, description, category, icon)
- Transport configuration (stdio command or URL)
- Required environment variables (secrets the user must provide)
- Built-in flag (cannot be disabled, always available)
"""

from enum import Enum
from typing import Any


class MCPCategory(str, Enum):
    """Categories for organizing MCP servers in the UI."""

    FILESYSTEM = "filesystem"
    VERSION_CONTROL = "version_control"
    DATABASE = "database"
    WEB = "web"
    COMMUNICATION = "communication"
    CONTAINERS = "containers"
    MEMORY = "memory"
    MONITORING = "monitoring"


# Default MCP servers - full productivity suite
# These can be enabled by users with one click (after providing required secrets)
DEFAULT_MCP_SERVERS: list[dict[str, Any]] = [
    # ============== Core (built-in, cannot disable) ==============
    {
        "slug": "filesystem",
        "name": "Filesystem",
        "description": "Read, write, and navigate files in the workspace",
        "category": MCPCategory.FILESYSTEM,
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
        "env_vars": {},
        "required_env": [],
        "icon": "folder",
        "is_builtin": True,
    },
    {
        "slug": "git",
        "name": "Git",
        "description": "Git operations: status, diff, commit, branch management",
        "category": MCPCategory.VERSION_CONTROL,
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-git"],
        "env_vars": {},
        "required_env": [],
        "icon": "git-branch",
        "is_builtin": True,
    },
    # ============== Version Control ==============
    {
        "slug": "github",
        "name": "GitHub",
        "description": "GitHub API: issues, PRs, repos, actions, and code search",
        "category": MCPCategory.VERSION_CONTROL,
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env_vars": {},
        "required_env": ["GITHUB_TOKEN"],
        "icon": "github",
        "is_builtin": False,
        "docs_url": "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
    },
    # ============== Web ==============
    {
        "slug": "fetch",
        "name": "Web Fetch",
        "description": "Fetch and parse web pages, APIs, and documentation",
        "category": MCPCategory.WEB,
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-fetch"],
        "env_vars": {},
        "required_env": [],
        "icon": "globe",
        "is_builtin": False,
        "docs_url": "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
    },
    {
        "slug": "brave-search",
        "name": "Brave Search",
        "description": "Web and news search via Brave Search API",
        "category": MCPCategory.WEB,
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-brave-search"],
        "env_vars": {},
        "required_env": ["BRAVE_API_KEY"],
        "icon": "search",
        "is_builtin": False,
        "docs_url": "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
    },
    {
        "slug": "puppeteer",
        "name": "Puppeteer",
        "description": "Browser automation, screenshots, and web scraping",
        "category": MCPCategory.WEB,
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-puppeteer"],
        "env_vars": {},
        "required_env": [],
        "icon": "chrome",
        "is_builtin": False,
        "docs_url": "https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer",
    },
    # ============== Memory & AI ==============
    {
        "slug": "memory",
        "name": "Memory",
        "description": "Persistent memory and knowledge graph for context retention",
        "category": MCPCategory.MEMORY,
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-memory"],
        "env_vars": {},
        "required_env": [],
        "icon": "brain",
        "is_builtin": False,
        "docs_url": "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    },
    # ============== Databases ==============
    {
        "slug": "postgres",
        "name": "PostgreSQL",
        "description": "Query and manage PostgreSQL databases",
        "category": MCPCategory.DATABASE,
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-postgres"],
        "env_vars": {},
        "required_env": ["POSTGRES_CONNECTION_STRING"],
        "icon": "database",
        "is_builtin": False,
        "docs_url": "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
    },
    {
        "slug": "sqlite",
        "name": "SQLite",
        "description": "Query and manage SQLite databases in workspace",
        "category": MCPCategory.DATABASE,
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-sqlite"],
        "env_vars": {},
        "required_env": [],  # Path passed as arg, defaults to workspace
        "icon": "database",
        "is_builtin": False,
        "docs_url": "https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite",
    },
    # ============== Communication ==============
    {
        "slug": "slack",
        "name": "Slack",
        "description": "Read and send Slack messages, manage channels",
        "category": MCPCategory.COMMUNICATION,
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-slack"],
        "env_vars": {},
        "required_env": ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"],
        "icon": "slack",
        "is_builtin": False,
        "docs_url": "https://github.com/modelcontextprotocol/servers/tree/main/src/slack",
    },
    # ============== Containers ==============
    {
        "slug": "docker",
        "name": "Docker",
        "description": "Manage Docker containers, images, and volumes",
        "category": MCPCategory.CONTAINERS,
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "mcp-server-docker"],
        "env_vars": {},
        "required_env": [],  # Uses docker socket
        "icon": "docker",
        "is_builtin": False,
        "docs_url": "https://github.com/modelcontextprotocol/servers/tree/main/src/docker",
    },
    {
        "slug": "kubernetes",
        "name": "Kubernetes",
        "description": "Manage Kubernetes clusters, pods, and deployments",
        "category": MCPCategory.CONTAINERS,
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "mcp-server-kubernetes"],
        "env_vars": {},
        "required_env": [],  # Uses kubeconfig
        "icon": "kubernetes",
        "is_builtin": False,
        "docs_url": "https://github.com/modelcontextprotocol/servers/tree/main/src/kubernetes",
    },
    # ============== Monitoring ==============
    {
        "slug": "sentry",
        "name": "Sentry",
        "description": "Error tracking and performance monitoring via Sentry API",
        "category": MCPCategory.MONITORING,
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-sentry"],
        "env_vars": {},
        "required_env": ["SENTRY_AUTH_TOKEN"],
        "icon": "sentry",
        "is_builtin": False,
        "docs_url": "https://github.com/modelcontextprotocol/servers/tree/main/src/sentry",
    },
]
