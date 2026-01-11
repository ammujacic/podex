"""Subagent management with context isolation."""

from .manager import (
    Subagent,
    SubagentContext,
    SubagentManager,
    SubagentStatus,
    SubagentType,
    get_subagent_manager,
    parse_subagent_invocations,
)

__all__ = [
    "Subagent",
    "SubagentContext",
    "SubagentManager",
    "SubagentStatus",
    "SubagentType",
    "get_subagent_manager",
    "parse_subagent_invocations",
]
