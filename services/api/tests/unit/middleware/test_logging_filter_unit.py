"""Unit tests for logging filter redaction helpers."""

from __future__ import annotations

import pytest

from src.middleware import logging_filter as lf


def test_is_sensitive_field() -> None:
    assert lf._is_sensitive_field("password") is True
    assert lf._is_sensitive_field("api_key") is True
    assert lf._is_sensitive_field("Authorization") is True
    assert lf._is_sensitive_field("message") is False
    assert lf._is_sensitive_field("user_id") is False
    assert lf._is_sensitive_field("client_secret") is True


def test_redact_sensitive_value_jwt() -> None:
    value = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
    assert lf._redact_sensitive_value(value) == lf.REDACTED


def test_redact_sensitive_value_bearer() -> None:
    assert lf._redact_sensitive_value("Bearer sk-abc123xyz") == lf.REDACTED


def test_redact_sensitive_value_plain() -> None:
    assert lf._redact_sensitive_value("hello world") == "hello world"


def test_redact_dict_key_redaction() -> None:
    data = {"user": "alice", "password": "secret", "email": "a@b.com"}
    result = lf._redact_dict(data)
    assert result["user"] == "alice"
    assert result["password"] == lf.REDACTED
    assert result["email"] == "a@b.com"


def test_redact_dict_nested() -> None:
    data = {"nested": {"api_key": "sk-12345678901234567890"}}
    result = lf._redact_dict(data)
    assert result["nested"]["api_key"] == lf.REDACTED


def test_redact_sensitive_data_processor() -> None:
    event_dict = {"msg": "login", "password": "secret"}
    result = lf.redact_sensitive_data(None, "info", event_dict)  # type: ignore[arg-type]
    assert result["password"] == lf.REDACTED
    assert result["msg"] == "login"
