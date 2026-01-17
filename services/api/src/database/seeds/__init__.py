"""Centralized seed data for database initialization.

All default/initial data for the platform is defined here.
This data is automatically seeded when the database is initialized.
"""

from src.database.seeds.commands import DEFAULT_GLOBAL_COMMANDS, GlobalCommandData
from src.database.seeds.hardware import DEFAULT_HARDWARE_SPECS
from src.database.seeds.mcp_servers import DEFAULT_MCP_SERVERS, MCPCategory
from src.database.seeds.models import DEFAULT_MODELS
from src.database.seeds.plans import DEFAULT_PLANS
from src.database.seeds.settings import DEFAULT_SETTINGS
from src.database.seeds.templates import OFFICIAL_TEMPLATES
from src.database.seeds.terminal_agents import DEFAULT_TERMINAL_AGENTS, TerminalAgentData

__all__ = [
    # Global Slash Commands
    "DEFAULT_GLOBAL_COMMANDS",
    # Hardware Specifications
    "DEFAULT_HARDWARE_SPECS",
    # MCP Servers
    "DEFAULT_MCP_SERVERS",
    # LLM Models
    "DEFAULT_MODELS",
    # Subscription Plans
    "DEFAULT_PLANS",
    # Platform Settings
    "DEFAULT_SETTINGS",
    # Terminal-Integrated Agents
    "DEFAULT_TERMINAL_AGENTS",
    # Pod Templates
    "OFFICIAL_TEMPLATES",
    "GlobalCommandData",
    "MCPCategory",
    "TerminalAgentData",
]
