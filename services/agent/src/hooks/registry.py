"""Hook registry for managing user-defined hooks."""

import uuid
from datetime import datetime
from typing import Any

import structlog

from .types import HookCondition, HookDefinition, HookTrigger, HookType

logger = structlog.get_logger()


class HookRegistry:
    """
    Registry for managing user-defined hooks.

    Hooks are user-configurable scripts that run at specific points
    in the agent lifecycle (before/after tool calls, compaction, etc.).
    """

    def __init__(self) -> None:
        # user_id -> list of hooks
        self._hooks: dict[str, list[HookDefinition]] = {}
        # hook_id -> hook
        self._hooks_by_id: dict[str, HookDefinition] = {}

    def register_hook(
        self,
        user_id: str,
        name: str,
        hook_type: HookType,
        command: str,
        description: str | None = None,
        condition: HookCondition | None = None,
        timeout_ms: int = 30000,
        run_async: bool = False,
    ) -> HookDefinition:
        """Register a new hook for a user."""
        hook = HookDefinition(
            id=str(uuid.uuid4()),
            user_id=user_id,
            name=name,
            description=description,
            hook_type=hook_type,
            command=command,
            condition=condition or HookCondition(),
            timeout_ms=timeout_ms,
            run_async=run_async,
        )

        if user_id not in self._hooks:
            self._hooks[user_id] = []
        self._hooks[user_id].append(hook)
        self._hooks_by_id[hook.id] = hook

        logger.info(
            "hook_registered",
            hook_id=hook.id,
            user_id=user_id,
            hook_type=hook_type.value,
        )

        return hook

    def get_hook(self, hook_id: str) -> HookDefinition | None:
        """Get a hook by ID."""
        return self._hooks_by_id.get(hook_id)

    def get_user_hooks(
        self,
        user_id: str,
        hook_type: HookType | None = None,
        enabled_only: bool = True,
    ) -> list[HookDefinition]:
        """Get all hooks for a user, optionally filtered by type."""
        hooks = self._hooks.get(user_id, [])

        if enabled_only:
            hooks = [h for h in hooks if h.enabled]

        if hook_type:
            hooks = [h for h in hooks if h.hook_type == hook_type]

        return hooks

    def update_hook(
        self,
        hook_id: str,
        **updates: Any,
    ) -> HookDefinition | None:
        """Update a hook's properties."""
        hook = self._hooks_by_id.get(hook_id)
        if not hook:
            return None

        # Update allowed fields
        allowed_fields = {
            "name",
            "description",
            "command",
            "condition",
            "enabled",
            "timeout_ms",
            "run_async",
        }

        for key, value in updates.items():
            if key in allowed_fields and hasattr(hook, key):
                setattr(hook, key, value)

        hook.updated_at = datetime.utcnow()

        logger.info("hook_updated", hook_id=hook_id)
        return hook

    def delete_hook(self, hook_id: str) -> bool:
        """Delete a hook."""
        hook = self._hooks_by_id.get(hook_id)
        if not hook:
            return False

        # Remove from user's list
        user_hooks = self._hooks.get(hook.user_id, [])
        self._hooks[hook.user_id] = [h for h in user_hooks if h.id != hook_id]

        # Remove from ID map
        del self._hooks_by_id[hook_id]

        logger.info("hook_deleted", hook_id=hook_id)
        return True

    def enable_hook(self, hook_id: str) -> bool:
        """Enable a hook."""
        hook = self._hooks_by_id.get(hook_id)
        if hook:
            hook.enabled = True
            hook.updated_at = datetime.utcnow()
            return True
        return False

    def disable_hook(self, hook_id: str) -> bool:
        """Disable a hook."""
        hook = self._hooks_by_id.get(hook_id)
        if hook:
            hook.enabled = False
            hook.updated_at = datetime.utcnow()
            return True
        return False

    def get_hooks_for_event(
        self,
        user_id: str,
        hook_type: HookType,
        tool_name: str | None = None,
        file_path: str | None = None,
    ) -> list[HookDefinition]:
        """
        Get hooks that should run for a specific event.

        Filters based on hook type and conditions.
        """
        hooks = self.get_user_hooks(user_id, hook_type=hook_type)
        matching = []

        for hook in hooks:
            if self._matches_condition(hook.condition, tool_name, file_path):
                matching.append(hook)

        return matching

    def _matches_condition(
        self,
        condition: HookCondition,
        tool_name: str | None,
        file_path: str | None,
    ) -> bool:
        """Check if a hook condition matches the current context."""
        import re

        if condition.trigger == HookTrigger.ALWAYS:
            return True

        if condition.trigger == HookTrigger.ON_TOOL:
            if tool_name and condition.tool_names:
                return tool_name in condition.tool_names
            return False

        if condition.trigger == HookTrigger.ON_FILE_TYPE:
            if file_path and condition.file_extensions:
                ext = file_path.rsplit(".", 1)[-1] if "." in file_path else ""
                return ext in condition.file_extensions
            return False

        if condition.trigger == HookTrigger.ON_PATTERN:
            if condition.pattern:
                # Check against tool name or file path
                target = tool_name or file_path or ""
                try:
                    return bool(re.match(condition.pattern, target))
                except re.error:
                    return False
            return False

        return False

    def clear_user_hooks(self, user_id: str) -> int:
        """Clear all hooks for a user. Returns count deleted."""
        hooks = self._hooks.pop(user_id, [])
        for hook in hooks:
            if hook.id in self._hooks_by_id:
                del self._hooks_by_id[hook.id]
        return len(hooks)


# Global instance
_registry: HookRegistry | None = None


def get_hook_registry() -> HookRegistry:
    """Get or create the global hook registry instance."""
    global _registry
    if _registry is None:
        _registry = HookRegistry()
    return _registry
