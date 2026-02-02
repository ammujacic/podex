"""Unit tests for JSONB schemas (EnvVarsSchema, validate_env_vars, MCPToolSchema, etc.)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.schemas import jsonb_schemas as js


# --- EnvVarsSchema & validate_env_vars ---


def test_env_vars_schema_valid() -> None:
    """EnvVarsSchema accepts valid env var keys and values."""
    schema = js.EnvVarsSchema(vars={"FOO": "bar", "API_KEY": "secret123", "_PRIVATE": "x"})
    assert schema.vars["FOO"] == "bar"
    assert schema.vars["API_KEY"] == "secret123"
    assert schema.vars["_PRIVATE"] == "x"


def test_env_vars_schema_invalid_key_starts_with_number() -> None:
    """EnvVarsSchema rejects keys that start with a number."""
    with pytest.raises(ValidationError) as exc:
        js.EnvVarsSchema(vars={"1INVALID": "value"})
    assert "Invalid" in str(exc.value) or "letter" in str(exc.value).lower()


def test_env_vars_schema_invalid_key_special_char() -> None:
    """EnvVarsSchema rejects keys with special characters."""
    with pytest.raises(ValidationError):
        js.EnvVarsSchema(vars={"FOO-BAR": "value"})


def test_env_vars_schema_too_many_vars() -> None:
    """EnvVarsSchema rejects more than MAX_ENV_VARS."""
    too_many = {f"VAR_{i}": "x" for i in range(js.MAX_ENV_VARS + 1)}
    with pytest.raises(ValidationError) as exc:
        js.EnvVarsSchema(vars=too_many)
    assert "Maximum" in str(exc.value)


def test_env_vars_schema_newline_in_value() -> None:
    """EnvVarsSchema rejects values containing newlines."""
    with pytest.raises(ValidationError) as exc:
        js.EnvVarsSchema(vars={"FOO": "line1\nline2"})
    assert "newline" in str(exc.value).lower()


def test_validate_env_vars_none_returns_empty() -> None:
    """validate_env_vars(None) returns {}."""
    assert js.validate_env_vars(None) == {}


def test_validate_env_vars_empty_dict() -> None:
    """validate_env_vars({}) returns {}."""
    assert js.validate_env_vars({}) == {}


def test_validate_env_vars_valid() -> None:
    """validate_env_vars returns validated dict."""
    result = js.validate_env_vars({"KEY": "value"})
    assert result == {"KEY": "value"}


# --- MCPToolSchema ---


def test_mcp_tool_schema_valid() -> None:
    """MCPToolSchema accepts valid tool definition."""
    schema = js.MCPToolSchema(name="run_command", description="Run a command", input_schema={})
    assert schema.name == "run_command"
    assert schema.description == "Run a command"


def test_mcp_tool_schema_name_stripped() -> None:
    """MCPToolSchema strips whitespace from name."""
    schema = js.MCPToolSchema(name="  tool  ", description=None, input_schema={})
    assert schema.name == "tool"


def test_mcp_tool_schema_name_empty_raises() -> None:
    """MCPToolSchema rejects empty or whitespace name."""
    with pytest.raises(ValidationError):
        js.MCPToolSchema(name="   ", description=None, input_schema={})


# --- SessionSettingsSchema ---


def test_session_settings_schema_defaults() -> None:
    """SessionSettingsSchema has expected defaults."""
    schema = js.SessionSettingsSchema()
    assert schema.tier == "starter"
    assert schema.auto_save is True
    assert schema.standby_timeout_minutes is None


def test_session_settings_schema_valid_tier() -> None:
    """SessionSettingsSchema accepts valid tier values."""
    for tier in ("starter", "pro", "enterprise"):
        schema = js.SessionSettingsSchema(tier=tier)
        assert schema.tier == tier


def test_session_settings_schema_invalid_tier() -> None:
    """SessionSettingsSchema rejects invalid tier."""
    with pytest.raises(ValidationError):
        js.SessionSettingsSchema(tier="invalid")


def test_validate_session_settings_none_returns_empty() -> None:
    """validate_session_settings(None) returns {}."""
    assert js.validate_session_settings(None) == {}


def test_validate_session_settings_valid() -> None:
    """validate_session_settings returns validated dict."""
    result = js.validate_session_settings({"tier": "pro", "auto_save": False})
    assert result["tier"] == "pro"
    assert result["auto_save"] is False


# --- CommandAllowlistSchema ---


def test_command_allowlist_schema_valid() -> None:
    """CommandAllowlistSchema accepts valid patterns."""
    schema = js.CommandAllowlistSchema(patterns=["*.py", "src/**"])
    assert schema.patterns == ["*.py", "src/**"]


def test_command_allowlist_schema_strips_empty() -> None:
    """CommandAllowlistSchema strips empty patterns."""
    schema = js.CommandAllowlistSchema(patterns=["  *.py  ", "  ", ""])
    assert schema.patterns == ["*.py"]


def test_command_allowlist_schema_dangerous_chars_raises() -> None:
    """CommandAllowlistSchema rejects patterns with dangerous shell chars."""
    with pytest.raises(ValidationError):
        js.CommandAllowlistSchema(patterns=["*.py; rm -rf /"])


# --- ToolCallSchema ---


def test_tool_call_schema_valid() -> None:
    """ToolCallSchema accepts valid tool call."""
    schema = js.ToolCallSchema(id="call_1", name="run", arguments={"path": "/tmp"})
    assert schema.id == "call_1"
    assert schema.name == "run"
    assert schema.arguments == {"path": "/tmp"}


def test_tool_call_schema_arguments_size_limit() -> None:
    """ToolCallSchema rejects arguments exceeding MAX_TOOL_CALL_ARGS_SIZE (100KB)."""
    # JSON serialization of arguments must exceed MAX_TOOL_CALL_ARGS_SIZE
    huge = {"payload": "x" * (js.MAX_TOOL_CALL_ARGS_SIZE + 1)}
    with pytest.raises(ValidationError) as exc:
        js.ToolCallSchema(id="1", name="n", arguments=huge)
    assert "exceed" in str(exc.value).lower() or "size" in str(exc.value).lower()


# --- AgentConfigSchema ---


def test_agent_config_schema_tool_lists_strip_empty() -> None:
    """AgentConfigSchema strips empty strings from enabled_tools."""
    schema = js.AgentConfigSchema(enabled_tools=["a", "  ", "", "b"])
    assert schema.enabled_tools == ["a", "b"]


def test_agent_config_schema_temperature_range() -> None:
    """AgentConfigSchema accepts temperature in [0, 2]."""
    schema = js.AgentConfigSchema(temperature=1.0)
    assert schema.temperature == 1.0
    schema2 = js.AgentConfigSchema(temperature=0.0)
    assert schema2.temperature == 0.0


def test_agent_config_schema_temperature_out_of_range() -> None:
    """AgentConfigSchema rejects temperature outside [0, 2]."""
    with pytest.raises(ValidationError):
        js.AgentConfigSchema(temperature=3.0)
