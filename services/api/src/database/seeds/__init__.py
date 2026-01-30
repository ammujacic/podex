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
from src.database.seeds.workspace_servers import DEV_WORKSPACE_SERVERS

__all__ = [
    "DEFAULT_AGENT_ROLES",
    "DEFAULT_AGENT_TOOLS",
    "DEFAULT_GLOBAL_COMMANDS",
    "DEFAULT_HARDWARE_SPECS",
    "DEFAULT_HEALTH_CHECKS",
    "DEFAULT_MCP_SERVERS",
    "DEFAULT_MODELS",
    "DEFAULT_PLANS",
    "DEFAULT_PROVIDERS",
    "DEFAULT_SETTINGS",
    "DEFAULT_SKILL_TEMPLATES",
    "DEFAULT_SYSTEM_SKILLS",
    "DEV_WORKSPACE_SERVERS",
    "OFFICIAL_TEMPLATES",
    "AgentRoleData",
    "AgentToolData",
    "GlobalCommandData",
    "HealthCheckData",
    "LLMProviderData",
    "MCPCategory",
]
