"""Hook type definitions for the agent hooks system."""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from typing import Any


class HookType(str, Enum):
    """Types of hooks that can be registered."""

    PRE_TOOL_CALL = "pre_tool_call"
    POST_TOOL_CALL = "post_tool_call"
    PRE_COMPACT = "pre_compact"
    POST_COMPACT = "post_compact"
    SESSION_START = "session_start"
    SESSION_END = "session_end"
    SUBAGENT_START = "subagent_start"
    SUBAGENT_STOP = "subagent_stop"
    MESSAGE_RECEIVED = "message_received"
    RESPONSE_GENERATED = "response_generated"


class HookTrigger(str, Enum):
    """When a hook should be triggered."""

    ALWAYS = "always"
    ON_TOOL = "on_tool"  # Specific tool names
    ON_FILE_TYPE = "on_file_type"  # Specific file extensions
    ON_PATTERN = "on_pattern"  # Regex pattern match


@dataclass
class HookCondition:
    """Condition for when a hook should execute."""

    trigger: HookTrigger = HookTrigger.ALWAYS
    tool_names: list[str] = field(default_factory=list)
    file_extensions: list[str] = field(default_factory=list)
    pattern: str | None = None


@dataclass
class HookDefinition:
    """Definition of a user-defined hook."""

    id: str
    user_id: str
    name: str
    description: str | None
    hook_type: HookType
    command: str  # Shell command to execute
    condition: HookCondition
    enabled: bool = True
    timeout_ms: int = 30000  # 30 second default
    run_async: bool = False
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "user_id": self.user_id,
            "name": self.name,
            "description": self.description,
            "hook_type": self.hook_type.value,
            "command": self.command,
            "condition": {
                "trigger": self.condition.trigger.value,
                "tool_names": self.condition.tool_names,
                "file_extensions": self.condition.file_extensions,
                "pattern": self.condition.pattern,
            },
            "enabled": self.enabled,
            "timeout_ms": self.timeout_ms,
            "run_async": self.run_async,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


@dataclass
class HookContext:
    """Context passed to hook execution."""

    hook_type: HookType
    session_id: str
    agent_id: str
    tool_name: str | None = None
    tool_args: dict[str, Any] | None = None
    tool_result: str | None = None
    file_path: str | None = None
    message_content: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class HookResult:
    """Result of hook execution."""

    hook_id: str
    success: bool
    output: str | None = None
    error: str | None = None
    duration_ms: int = 0
    skipped: bool = False
    skip_reason: str | None = None
