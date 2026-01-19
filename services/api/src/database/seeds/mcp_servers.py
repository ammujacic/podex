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
    WEB = "web"
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
        "description": "Git operations: clone, commit, branch, diff, log, status, push, pull",
        "category": MCPCategory.VERSION_CONTROL,
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@mseep/git-mcp-server"],
        "env_vars": {},
        "required_env": [],
        "icon": "git-branch",
        "is_builtin": True,
        "docs_url": "https://github.com/mseep/git-mcp-server",
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
        "required_env": ["GITHUB_PERSONAL_ACCESS_TOKEN"],
        "icon": "github",
        "is_builtin": False,
        "docs_url": "https://github.com/github/github-mcp-server",
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
    # ============== Monitoring ==============
    {
        "slug": "sentry",
        "name": "Sentry",
        "description": "Error tracking and performance monitoring via Sentry API",
        "category": MCPCategory.MONITORING,
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@sentry/mcp-server@latest"],
        "env_vars": {},
        # SENTRY_ACCESS_TOKEN is required; SENTRY_HOST is optional for self-hosted
        "required_env": ["SENTRY_ACCESS_TOKEN"],
        "optional_env": ["SENTRY_HOST"],
        "icon": "sentry",
        "is_builtin": False,
        "docs_url": "https://docs.sentry.io/product/sentry-mcp/",
    },
]
