"""Tests for hooks module.

Tests cover:
- Hook types and dataclasses
- Hook executor
- Hook registry
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestHookTypes:
    """Test hook type definitions."""

    def test_hook_type_enum(self):
        """Test HookType enum."""
        from src.hooks.types import HookType

        assert HookType.PRE_TOOL_CALL is not None
        assert HookType.POST_TOOL_CALL is not None
        assert HookType.SESSION_START is not None
        assert HookType.SESSION_END is not None

    def test_hook_trigger_enum(self):
        """Test HookTrigger enum."""
        from src.hooks.types import HookTrigger

        assert HookTrigger.ALWAYS is not None
        assert HookTrigger.ON_TOOL is not None
        assert HookTrigger.ON_FILE_TYPE is not None
        assert HookTrigger.ON_PATTERN is not None

    def test_hook_condition_dataclass(self):
        """Test HookCondition dataclass."""
        from src.hooks.types import HookCondition, HookTrigger

        condition = HookCondition(
            trigger=HookTrigger.ON_TOOL,
            tool_names=["read_file"],
            pattern=".*\\.py$",
        )

        assert condition.trigger == HookTrigger.ON_TOOL
        assert "read_file" in condition.tool_names
        assert condition.pattern == ".*\\.py$"

    def test_hook_definition_dataclass(self):
        """Test HookDefinition dataclass."""
        from src.hooks.types import HookDefinition, HookType, HookCondition, HookTrigger

        condition = HookCondition(trigger=HookTrigger.ALWAYS)
        hook_def = HookDefinition(
            id="hook-123",
            user_id="user-456",
            name="test-hook",
            description="A test hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 'test'",
            condition=condition,
        )

        assert hook_def.id == "hook-123"
        assert hook_def.name == "test-hook"
        assert hook_def.hook_type == HookType.PRE_TOOL_CALL
        assert hook_def.command == "echo 'test'"
        assert hook_def.enabled is True
        assert hook_def.timeout_ms == 30000

    def test_hook_context_dataclass(self):
        """Test HookContext dataclass."""
        from src.hooks.types import HookContext, HookType

        context = HookContext(
            hook_type=HookType.PRE_TOOL_CALL,
            session_id="session-123",
            agent_id="agent-456",
            tool_name="read_file",
            tool_args={"path": "/tmp/test.txt"},
        )

        assert context.session_id == "session-123"
        assert context.agent_id == "agent-456"
        assert context.tool_name == "read_file"
        assert context.hook_type == HookType.PRE_TOOL_CALL
        assert context.tool_args == {"path": "/tmp/test.txt"}

    def test_hook_result_dataclass(self):
        """Test HookResult dataclass."""
        from src.hooks.types import HookResult

        result = HookResult(
            hook_id="hook-123",
            success=True,
            output="Hook executed",
            duration_ms=100,
        )

        assert result.hook_id == "hook-123"
        assert result.success is True
        assert result.output == "Hook executed"
        assert result.duration_ms == 100
        assert result.error is None

    def test_hook_result_with_error(self):
        """Test HookResult with error."""
        from src.hooks.types import HookResult

        result = HookResult(
            hook_id="hook-123",
            success=False,
            output="",
            error="Command failed",
            duration_ms=50,
        )

        assert result.success is False
        assert result.error == "Command failed"
        assert result.duration_ms == 50

    def test_hook_definition_to_dict(self):
        """Test HookDefinition to_dict method."""
        from src.hooks.types import HookDefinition, HookType, HookCondition, HookTrigger

        condition = HookCondition(trigger=HookTrigger.ALWAYS)
        hook_def = HookDefinition(
            id="hook-123",
            user_id="user-456",
            name="test-hook",
            description="A test hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 'test'",
            condition=condition,
        )

        hook_dict = hook_def.to_dict()

        assert hook_dict["id"] == "hook-123"
        assert hook_dict["name"] == "test-hook"
        assert hook_dict["hook_type"] == "pre_tool_call"


class TestHookExecutor:
    """Test HookExecutor class."""

    def test_hook_executor_class_exists(self):
        """Test HookExecutor class exists."""
        from src.hooks.executor import HookExecutor
        assert HookExecutor is not None

    def test_hook_executor_initialization(self):
        """Test HookExecutor initialization."""
        from src.hooks.executor import HookExecutor

        executor = HookExecutor()
        assert executor is not None


class TestHookRegistry:
    """Test HookRegistry class."""

    def test_hook_registry_class_exists(self):
        """Test HookRegistry class exists."""
        from src.hooks.registry import HookRegistry
        assert HookRegistry is not None

    def test_hook_registry_initialization(self):
        """Test HookRegistry initialization."""
        from src.hooks.registry import HookRegistry

        registry = HookRegistry()
        assert registry is not None
        assert registry._hooks == {}
        assert registry._hooks_by_id == {}

    def test_register_hook(self):
        """Test registering a hook."""
        from src.hooks.registry import HookRegistry
        from src.hooks.types import HookType

        registry = HookRegistry()
        hook = registry.register_hook(
            user_id="user-123",
            name="test-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 'test'",
            description="A test hook",
        )

        assert hook.id is not None
        assert hook.user_id == "user-123"
        assert hook.name == "test-hook"
        assert hook.hook_type == HookType.PRE_TOOL_CALL
        assert hook.command == "echo 'test'"
        assert hook.enabled is True

    def test_register_hook_with_custom_options(self):
        """Test registering a hook with custom options."""
        from src.hooks.registry import HookRegistry
        from src.hooks.types import HookType, HookCondition, HookTrigger

        registry = HookRegistry()
        condition = HookCondition(
            trigger=HookTrigger.ON_TOOL,
            tool_names=["read_file", "write_file"],
        )

        hook = registry.register_hook(
            user_id="user-123",
            name="tool-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="./validate.sh",
            condition=condition,
            timeout_ms=60000,
            run_async=True,
        )

        assert hook.condition.trigger == HookTrigger.ON_TOOL
        assert "read_file" in hook.condition.tool_names
        assert hook.timeout_ms == 60000
        assert hook.run_async is True

    def test_get_hook(self):
        """Test getting a hook by ID."""
        from src.hooks.registry import HookRegistry
        from src.hooks.types import HookType

        registry = HookRegistry()
        hook = registry.register_hook(
            user_id="user-123",
            name="test-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 'test'",
        )

        retrieved = registry.get_hook(hook.id)

        assert retrieved is not None
        assert retrieved.id == hook.id
        assert retrieved.name == "test-hook"

    def test_get_hook_not_found(self):
        """Test getting a non-existent hook."""
        from src.hooks.registry import HookRegistry

        registry = HookRegistry()
        result = registry.get_hook("non-existent-id")

        assert result is None

    def test_get_user_hooks(self):
        """Test getting all hooks for a user."""
        from src.hooks.registry import HookRegistry
        from src.hooks.types import HookType

        registry = HookRegistry()
        registry.register_hook(
            user_id="user-123",
            name="hook-1",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 1",
        )
        registry.register_hook(
            user_id="user-123",
            name="hook-2",
            hook_type=HookType.POST_TOOL_CALL,
            command="echo 2",
        )
        registry.register_hook(
            user_id="user-456",
            name="other-user-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 3",
        )

        hooks = registry.get_user_hooks("user-123")

        assert len(hooks) == 2
        names = [h.name for h in hooks]
        assert "hook-1" in names
        assert "hook-2" in names

    def test_get_user_hooks_filtered_by_type(self):
        """Test getting user hooks filtered by type."""
        from src.hooks.registry import HookRegistry
        from src.hooks.types import HookType

        registry = HookRegistry()
        registry.register_hook(
            user_id="user-123",
            name="pre-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo pre",
        )
        registry.register_hook(
            user_id="user-123",
            name="post-hook",
            hook_type=HookType.POST_TOOL_CALL,
            command="echo post",
        )

        hooks = registry.get_user_hooks("user-123", hook_type=HookType.PRE_TOOL_CALL)

        assert len(hooks) == 1
        assert hooks[0].name == "pre-hook"

    def test_get_user_hooks_enabled_only(self):
        """Test getting only enabled hooks."""
        from src.hooks.registry import HookRegistry
        from src.hooks.types import HookType

        registry = HookRegistry()
        hook1 = registry.register_hook(
            user_id="user-123",
            name="enabled-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 1",
        )
        hook2 = registry.register_hook(
            user_id="user-123",
            name="disabled-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 2",
        )
        registry.disable_hook(hook2.id)

        hooks = registry.get_user_hooks("user-123", enabled_only=True)

        assert len(hooks) == 1
        assert hooks[0].name == "enabled-hook"

    def test_get_user_hooks_include_disabled(self):
        """Test getting all hooks including disabled."""
        from src.hooks.registry import HookRegistry
        from src.hooks.types import HookType

        registry = HookRegistry()
        hook1 = registry.register_hook(
            user_id="user-123",
            name="enabled-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 1",
        )
        hook2 = registry.register_hook(
            user_id="user-123",
            name="disabled-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 2",
        )
        registry.disable_hook(hook2.id)

        hooks = registry.get_user_hooks("user-123", enabled_only=False)

        assert len(hooks) == 2

    def test_update_hook(self):
        """Test updating a hook."""
        from src.hooks.registry import HookRegistry
        from src.hooks.types import HookType

        registry = HookRegistry()
        hook = registry.register_hook(
            user_id="user-123",
            name="test-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 'test'",
        )

        updated = registry.update_hook(
            hook.id,
            name="updated-hook",
            command="echo 'updated'",
            timeout_ms=5000,
        )

        assert updated is not None
        assert updated.name == "updated-hook"
        assert updated.command == "echo 'updated'"
        assert updated.timeout_ms == 5000

    def test_update_hook_not_found(self):
        """Test updating a non-existent hook."""
        from src.hooks.registry import HookRegistry

        registry = HookRegistry()
        result = registry.update_hook("non-existent-id", name="new-name")

        assert result is None

    def test_update_hook_ignores_invalid_fields(self):
        """Test that update ignores invalid fields."""
        from src.hooks.registry import HookRegistry
        from src.hooks.types import HookType

        registry = HookRegistry()
        hook = registry.register_hook(
            user_id="user-123",
            name="test-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 'test'",
        )

        updated = registry.update_hook(
            hook.id,
            invalid_field="should be ignored",
            id="should not change",
        )

        assert updated is not None
        assert updated.id == hook.id  # ID should not change

    def test_delete_hook(self):
        """Test deleting a hook."""
        from src.hooks.registry import HookRegistry
        from src.hooks.types import HookType

        registry = HookRegistry()
        hook = registry.register_hook(
            user_id="user-123",
            name="test-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 'test'",
        )

        result = registry.delete_hook(hook.id)

        assert result is True
        assert registry.get_hook(hook.id) is None

    def test_delete_hook_not_found(self):
        """Test deleting a non-existent hook."""
        from src.hooks.registry import HookRegistry

        registry = HookRegistry()
        result = registry.delete_hook("non-existent-id")

        assert result is False

    def test_enable_hook(self):
        """Test enabling a hook."""
        from src.hooks.registry import HookRegistry
        from src.hooks.types import HookType

        registry = HookRegistry()
        hook = registry.register_hook(
            user_id="user-123",
            name="test-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 'test'",
        )
        registry.disable_hook(hook.id)
        assert registry.get_hook(hook.id).enabled is False

        result = registry.enable_hook(hook.id)

        assert result is True
        assert registry.get_hook(hook.id).enabled is True

    def test_enable_hook_not_found(self):
        """Test enabling a non-existent hook."""
        from src.hooks.registry import HookRegistry

        registry = HookRegistry()
        result = registry.enable_hook("non-existent-id")

        assert result is False

    def test_disable_hook(self):
        """Test disabling a hook."""
        from src.hooks.registry import HookRegistry
        from src.hooks.types import HookType

        registry = HookRegistry()
        hook = registry.register_hook(
            user_id="user-123",
            name="test-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 'test'",
        )

        result = registry.disable_hook(hook.id)

        assert result is True
        assert registry.get_hook(hook.id).enabled is False

    def test_disable_hook_not_found(self):
        """Test disabling a non-existent hook."""
        from src.hooks.registry import HookRegistry

        registry = HookRegistry()
        result = registry.disable_hook("non-existent-id")

        assert result is False

    def test_get_hooks_for_event_always_trigger(self):
        """Test getting hooks for event with ALWAYS trigger."""
        from src.hooks.registry import HookRegistry
        from src.hooks.types import HookType, HookCondition, HookTrigger

        registry = HookRegistry()
        registry.register_hook(
            user_id="user-123",
            name="always-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 'always'",
            condition=HookCondition(trigger=HookTrigger.ALWAYS),
        )

        hooks = registry.get_hooks_for_event(
            user_id="user-123",
            hook_type=HookType.PRE_TOOL_CALL,
            tool_name="any_tool",
        )

        assert len(hooks) == 1
        assert hooks[0].name == "always-hook"

    def test_get_hooks_for_event_tool_trigger(self):
        """Test getting hooks for event with ON_TOOL trigger."""
        from src.hooks.registry import HookRegistry
        from src.hooks.types import HookType, HookCondition, HookTrigger

        registry = HookRegistry()
        registry.register_hook(
            user_id="user-123",
            name="tool-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 'tool'",
            condition=HookCondition(
                trigger=HookTrigger.ON_TOOL,
                tool_names=["read_file", "write_file"],
            ),
        )

        hooks = registry.get_hooks_for_event(
            user_id="user-123",
            hook_type=HookType.PRE_TOOL_CALL,
            tool_name="read_file",
        )

        assert len(hooks) == 1
        assert hooks[0].name == "tool-hook"

    def test_get_hooks_for_event_tool_trigger_no_match(self):
        """Test getting hooks with non-matching tool."""
        from src.hooks.registry import HookRegistry
        from src.hooks.types import HookType, HookCondition, HookTrigger

        registry = HookRegistry()
        registry.register_hook(
            user_id="user-123",
            name="tool-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 'tool'",
            condition=HookCondition(
                trigger=HookTrigger.ON_TOOL,
                tool_names=["read_file"],
            ),
        )

        hooks = registry.get_hooks_for_event(
            user_id="user-123",
            hook_type=HookType.PRE_TOOL_CALL,
            tool_name="delete_file",
        )

        assert len(hooks) == 0

    def test_get_hooks_for_event_file_type_trigger(self):
        """Test getting hooks for event with ON_FILE_TYPE trigger."""
        from src.hooks.registry import HookRegistry
        from src.hooks.types import HookType, HookCondition, HookTrigger

        registry = HookRegistry()
        registry.register_hook(
            user_id="user-123",
            name="python-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="black $FILE",
            condition=HookCondition(
                trigger=HookTrigger.ON_FILE_TYPE,
                file_extensions=["py"],
            ),
        )

        hooks = registry.get_hooks_for_event(
            user_id="user-123",
            hook_type=HookType.PRE_TOOL_CALL,
            file_path="test.py",
        )

        assert len(hooks) == 1
        assert hooks[0].name == "python-hook"

    def test_get_hooks_for_event_file_type_no_match(self):
        """Test getting hooks with non-matching file type."""
        from src.hooks.registry import HookRegistry
        from src.hooks.types import HookType, HookCondition, HookTrigger

        registry = HookRegistry()
        registry.register_hook(
            user_id="user-123",
            name="python-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="black $FILE",
            condition=HookCondition(
                trigger=HookTrigger.ON_FILE_TYPE,
                file_extensions=["py"],
            ),
        )

        hooks = registry.get_hooks_for_event(
            user_id="user-123",
            hook_type=HookType.PRE_TOOL_CALL,
            file_path="test.js",
        )

        assert len(hooks) == 0

    def test_get_hooks_for_event_pattern_trigger(self):
        """Test getting hooks for event with ON_PATTERN trigger."""
        from src.hooks.registry import HookRegistry
        from src.hooks.types import HookType, HookCondition, HookTrigger

        registry = HookRegistry()
        registry.register_hook(
            user_id="user-123",
            name="pattern-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 'pattern'",
            condition=HookCondition(
                trigger=HookTrigger.ON_PATTERN,
                pattern="read.*",
            ),
        )

        hooks = registry.get_hooks_for_event(
            user_id="user-123",
            hook_type=HookType.PRE_TOOL_CALL,
            tool_name="read_file",
        )

        assert len(hooks) == 1
        assert hooks[0].name == "pattern-hook"

    def test_get_hooks_for_event_pattern_no_match(self):
        """Test getting hooks with non-matching pattern."""
        from src.hooks.registry import HookRegistry
        from src.hooks.types import HookType, HookCondition, HookTrigger

        registry = HookRegistry()
        registry.register_hook(
            user_id="user-123",
            name="pattern-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 'pattern'",
            condition=HookCondition(
                trigger=HookTrigger.ON_PATTERN,
                pattern="^write.*",
            ),
        )

        hooks = registry.get_hooks_for_event(
            user_id="user-123",
            hook_type=HookType.PRE_TOOL_CALL,
            tool_name="read_file",
        )

        assert len(hooks) == 0

    def test_get_hooks_for_event_invalid_regex(self):
        """Test getting hooks with invalid regex pattern."""
        from src.hooks.registry import HookRegistry
        from src.hooks.types import HookType, HookCondition, HookTrigger

        registry = HookRegistry()
        registry.register_hook(
            user_id="user-123",
            name="invalid-pattern-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 'pattern'",
            condition=HookCondition(
                trigger=HookTrigger.ON_PATTERN,
                pattern="[invalid(regex",  # Invalid regex
            ),
        )

        hooks = registry.get_hooks_for_event(
            user_id="user-123",
            hook_type=HookType.PRE_TOOL_CALL,
            tool_name="read_file",
        )

        # Invalid regex should not match
        assert len(hooks) == 0

    def test_clear_user_hooks(self):
        """Test clearing all hooks for a user."""
        from src.hooks.registry import HookRegistry
        from src.hooks.types import HookType

        registry = HookRegistry()
        registry.register_hook(
            user_id="user-123",
            name="hook-1",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 1",
        )
        registry.register_hook(
            user_id="user-123",
            name="hook-2",
            hook_type=HookType.POST_TOOL_CALL,
            command="echo 2",
        )
        registry.register_hook(
            user_id="user-456",
            name="other-user-hook",
            hook_type=HookType.PRE_TOOL_CALL,
            command="echo 3",
        )

        deleted_count = registry.clear_user_hooks("user-123")

        assert deleted_count == 2
        assert len(registry.get_user_hooks("user-123", enabled_only=False)) == 0
        assert len(registry.get_user_hooks("user-456", enabled_only=False)) == 1


class TestHookRegistryGlobalInstance:
    """Test global hook registry instance."""

    def test_get_hook_registry(self):
        """Test get_hook_registry function."""
        from src.hooks.registry import get_hook_registry, HookRegistry

        registry = get_hook_registry()
        assert registry is not None
        assert isinstance(registry, HookRegistry)

    def test_get_hook_registry_returns_same_instance(self):
        """Test get_hook_registry returns same instance."""
        from src.hooks.registry import get_hook_registry

        registry1 = get_hook_registry()
        registry2 = get_hook_registry()

        assert registry1 is registry2


class TestHookTypeValues:
    """Test hook type enum values."""

    def test_hook_type_values(self):
        """Test HookType enum values."""
        from src.hooks.types import HookType

        assert HookType.PRE_TOOL_CALL.value == "pre_tool_call"
        assert HookType.POST_TOOL_CALL.value == "post_tool_call"
        assert HookType.SESSION_START.value == "session_start"
        assert HookType.SESSION_END.value == "session_end"

    def test_hook_trigger_values(self):
        """Test HookTrigger enum values."""
        from src.hooks.types import HookTrigger

        assert HookTrigger.ALWAYS.value == "always"
        assert HookTrigger.ON_TOOL.value == "on_tool"
        assert HookTrigger.ON_FILE_TYPE.value == "on_file_type"
        assert HookTrigger.ON_PATTERN.value == "on_pattern"

    def test_all_hook_types(self):
        """Test all HookType values exist."""
        from src.hooks.types import HookType

        expected_types = [
            "pre_tool_call",
            "post_tool_call",
            "pre_compact",
            "post_compact",
            "session_start",
            "session_end",
            "subagent_start",
            "subagent_stop",
            "message_received",
            "response_generated",
        ]

        for type_value in expected_types:
            hook_type = HookType(type_value)
            assert hook_type.value == type_value
