"""Pydantic schemas for validating JSONB field data structures.

These schemas provide type safety and validation for data stored in
PostgreSQL JSONB columns. They help prevent malformed data and ensure
consistency across the application.
"""

import json
import re
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

# Custom error message prefix for environment variable validation
_ENV_VAR_INVALID_NAME_MSG = "Must start with letter or underscore, contain only alphanumeric."

# Environment variable name pattern (standard shell variable naming)
ENV_VAR_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

# Maximum limits for env vars
MAX_ENV_VARS = 50
MAX_ENV_VAR_NAME_LENGTH = 128
MAX_ENV_VAR_VALUE_LENGTH = 8192  # 8KB per value

# Maximum limits for other schemas
MAX_PATTERN_LENGTH = 256
MAX_TOOL_CALL_ARGS_SIZE = 100000  # 100KB


class EnvVarsSchema(BaseModel):
    """Schema for validating environment variables in MCP servers and agent profiles.

    Validates:
    - Variable names follow shell naming conventions
    - Maximum number of variables
    - Maximum value lengths
    - No dangerous characters that could cause injection
    """

    vars: dict[str, str] = Field(
        default_factory=dict, description="Environment variable key-value pairs"
    )

    @field_validator("vars")
    @classmethod
    def validate_env_vars(cls, v: dict[str, str]) -> dict[str, str]:
        """Validate environment variables."""
        if len(v) > MAX_ENV_VARS:
            msg = f"Maximum {MAX_ENV_VARS} environment variables allowed, got {len(v)}"
            raise ValueError(msg)

        for key, value in v.items():
            # Validate key format
            if not ENV_VAR_NAME_PATTERN.match(key):
                msg = f"Invalid environment variable name '{key}'. {_ENV_VAR_INVALID_NAME_MSG}"
                raise ValueError(msg)

            if len(key) > MAX_ENV_VAR_NAME_LENGTH:
                msg = f"Env var name '{key}' exceeds max length of {MAX_ENV_VAR_NAME_LENGTH}"
                raise ValueError(msg)

            # Validate value
            if len(value) > MAX_ENV_VAR_VALUE_LENGTH:
                msg = f"Env var '{key}' value exceeds max length of {MAX_ENV_VAR_VALUE_LENGTH}"
                raise ValueError(msg)

            # No newlines in values (could cause issues in shell commands)
            if "\n" in value or "\r" in value:
                msg = f"Environment variable '{key}' contains newline characters"
                raise ValueError(msg)

        return v


def validate_env_vars(data: dict[str, str] | None) -> dict[str, str]:
    """Validate environment variables data.

    Args:
        data: Dictionary of environment variables, or None.

    Returns:
        Validated dictionary (or empty dict if None).

    Raises:
        ValueError: If validation fails.
    """
    if not data:
        return {}
    schema = EnvVarsSchema(vars=data)
    return schema.vars


class MCPToolSchema(BaseModel):
    """Schema for MCP tool definitions discovered from servers."""

    name: str = Field(min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=2048)
    input_schema: dict[str, Any] = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        """Validate tool name."""
        if not v.strip():
            msg = "Tool name cannot be empty or whitespace"
            raise ValueError(msg)
        return v.strip()


class SessionSettingsSchema(BaseModel):
    """Schema for session settings JSONB field."""

    standby_timeout_minutes: int | None = Field(default=None, ge=1, le=1440)  # Max 24 hours
    tier: str = Field(default="starter", pattern=r"^(starter|pro|enterprise)$")
    auto_save: bool = Field(default=True)
    theme: str | None = Field(default=None, max_length=50)

    # Git settings
    auto_commit: bool = Field(default=False)
    commit_message_prefix: str | None = Field(default=None, max_length=100)

    # Agent defaults
    default_agent_model: str | None = Field(default=None, max_length=100)
    default_agent_mode: str | None = Field(default=None, pattern=r"^(plan|ask|auto|sovereign)$")


def validate_session_settings(data: dict[str, Any] | None) -> dict[str, Any]:
    """Validate session settings data.

    Args:
        data: Session settings dictionary, or None.

    Returns:
        Validated settings dictionary.

    Raises:
        ValueError: If validation fails.
    """
    if not data:
        return {}
    schema = SessionSettingsSchema(**data)
    return schema.model_dump(exclude_none=True)


class AgentConfigSchema(BaseModel):
    """Schema for agent configuration JSONB field."""

    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    max_tokens: int | None = Field(default=None, ge=1, le=200000)
    system_prompt_override: str | None = Field(default=None, max_length=50000)

    # Tool configuration
    enabled_tools: list[str] | None = Field(default=None, max_length=100)
    disabled_tools: list[str] | None = Field(default=None, max_length=100)

    # Voice configuration
    voice_enabled: bool = Field(default=False)
    voice_id: str | None = Field(default=None, max_length=100)

    @field_validator("enabled_tools", "disabled_tools")
    @classmethod
    def validate_tool_lists(cls, v: list[str] | None) -> list[str] | None:
        """Validate tool lists."""
        if v is None:
            return None
        # Ensure no empty strings
        return [tool.strip() for tool in v if tool.strip()]


class CommandAllowlistSchema(BaseModel):
    """Schema for agent command allowlist (glob patterns)."""

    patterns: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("patterns")
    @classmethod
    def validate_patterns(cls, v: list[str]) -> list[str]:
        """Validate glob patterns."""
        validated = []
        for raw_pattern in v:
            pattern = raw_pattern.strip()
            if not pattern:
                continue
            # Max length per pattern
            if len(pattern) > MAX_PATTERN_LENGTH:
                msg = f"Pattern '{pattern[:50]}...' exceeds maximum length of {MAX_PATTERN_LENGTH}"
                raise ValueError(msg)
            # Basic safety check - no shell metacharacters that could be exploited
            # Glob patterns should only use *, ?, [, ], {, }
            dangerous_chars = set(";|&$`<>()'\"\\\n\r")
            if any(c in pattern for c in dangerous_chars):
                msg = f"Pattern '{pattern}' contains dangerous characters"
                raise ValueError(msg)
            validated.append(pattern)
        return validated


class ToolCallSchema(BaseModel):
    """Schema for tool call data in messages."""

    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=128)
    arguments: dict[str, Any] = Field(default_factory=dict)
    result: Any = None

    @model_validator(mode="after")
    def validate_arguments_size(self) -> "ToolCallSchema":
        """Validate total arguments size."""
        args_str = json.dumps(self.arguments)
        if len(args_str) > MAX_TOOL_CALL_ARGS_SIZE:
            msg = f"Tool call arguments exceed maximum size of {MAX_TOOL_CALL_ARGS_SIZE // 1000}KB"
            raise ValueError(msg)
        return self
