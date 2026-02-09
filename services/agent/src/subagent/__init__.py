"""Subagent management with context isolation.

Subagent roles are now defined in the database and synced to Redis.
Use ConfigReader to get role definitions including system prompts.
"""

from .manager import (
    Subagent,
    SubagentContext,
    SubagentManager,
    SubagentStatus,
    get_subagent_manager,
    parse_subagent_invocations,
)

__all__ = [
    "Subagent",
    "SubagentContext",
    "SubagentManager",
    "SubagentStatus",
    "get_subagent_manager",
    "parse_subagent_invocations",
]
