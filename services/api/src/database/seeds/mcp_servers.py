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

    VERSION_CONTROL = "version_control"
    WEB = "web"
    MONITORING = "monitoring"
    PRODUCTIVITY = "productivity"


# Default MCP servers
# These can be enabled by users with one click (after providing required secrets)
#
# NOTE: Filesystem and Git MCP servers have been REMOVED.
# Native agents use built-in tools (read_file, write_file, git_status, etc.)
# that execute directly on the workspace container via the compute service.
# This is more reliable and doesn't require MCP server processes.
#
# Web Fetch, Puppeteer, and GitHub servers were also removed:
# - GitHub: Package mismatch issues and requires OAuth integration
# - Puppeteer: Requires Chrome/Chromium in the container environment
# - Web Fetch: Not essential, can be added back if needed
DEFAULT_MCP_SERVERS: list[dict[str, Any]] = [
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
        # SENTRY_ACCESS_TOKEN is required
        # SENTRY_HOST is optional for self-hosted instances
        # OPENAI_API_KEY is optional for AI-powered search (Seer)
        "required_env": ["SENTRY_ACCESS_TOKEN"],
        "optional_env": ["SENTRY_HOST", "OPENAI_API_KEY"],
        "icon": "sentry",
        "is_builtin": False,
        "docs_url": "https://docs.sentry.io/product/sentry-mcp/",
    },
]
