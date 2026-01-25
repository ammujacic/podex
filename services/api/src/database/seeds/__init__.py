"""Centralized seed data for database initialization.

All default/initial data for the platform is defined here.
This data is automatically seeded when the database is initialized.
"""

from src.database.seeds.agent_roles import DEFAULT_AGENT_ROLES, AgentRoleData
from src.database.seeds.agent_tools import DEFAULT_AGENT_TOOLS, AgentToolData
from src.database.seeds.commands import DEFAULT_GLOBAL_COMMANDS, GlobalCommandData
from src.database.seeds.hardware import DEFAULT_HARDWARE_SPECS
from src.database.seeds.health_checks import DEFAULT_HEALTH_CHECKS, HealthCheckData
from src.database.seeds.mcp_servers import DEFAULT_MCP_SERVERS, MCPCategory
from src.database.seeds.models import DEFAULT_MODELS
from src.database.seeds.plans import DEFAULT_PLANS
from src.database.seeds.providers import DEFAULT_PROVIDERS, LLMProviderData
from src.database.seeds.settings import DEFAULT_SETTINGS
from src.database.seeds.skill_templates import DEFAULT_SKILL_TEMPLATES
from src.database.seeds.skills import DEFAULT_SYSTEM_SKILLS
from src.database.seeds.templates import OFFICIAL_TEMPLATES
from src.database.seeds.terminal_agents import DEFAULT_TERMINAL_AGENTS, TerminalAgentData

__all__ = [
    # Agent Role Configurations
    "DEFAULT_AGENT_ROLES",
    # Agent Tools
    "DEFAULT_AGENT_TOOLS",
    # Global Slash Commands
    "DEFAULT_GLOBAL_COMMANDS",
    # Hardware Specifications
    "DEFAULT_HARDWARE_SPECS",
    # Health Checks
    "DEFAULT_HEALTH_CHECKS",
    # MCP Servers
    "DEFAULT_MCP_SERVERS",
    # LLM Models
    "DEFAULT_MODELS",
    # Subscription Plans
    "DEFAULT_PLANS",
    # LLM Providers
    "DEFAULT_PROVIDERS",
    # Platform Settings
    "DEFAULT_SETTINGS",
    # Skill Templates
    "DEFAULT_SKILL_TEMPLATES",
    # System Skills
    "DEFAULT_SYSTEM_SKILLS",
    # Terminal-Integrated Agents
    "DEFAULT_TERMINAL_AGENTS",
    # Pod Templates
    "OFFICIAL_TEMPLATES",
    "AgentRoleData",
    "AgentToolData",
    "GlobalCommandData",
    "HealthCheckData",
    "LLMProviderData",
    "MCPCategory",
    "TerminalAgentData",
]
