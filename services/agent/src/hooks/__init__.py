"""Hooks system for user-defined automation."""

from .executor import HookExecutor, get_hook_executor, run_hooks
from .registry import HookRegistry, get_hook_registry
from .types import (
    HookCondition,
    HookContext,
    HookDefinition,
    HookResult,
    HookTrigger,
    HookType,
)

__all__ = [
    "HookCondition",
    "HookContext",
    "HookDefinition",
    "HookExecutor",
    "HookRegistry",
    "HookResult",
    "HookTrigger",
    "HookType",
    "get_hook_executor",
    "get_hook_registry",
    "run_hooks",
]
