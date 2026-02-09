"""Unit tests for dependencies route helpers (get_current_user_id, get_optional_user_id)."""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from src.routes import dependencies as deps_module


def _make_request(user_id: str | None = None) -> Request:
    scope = {"type": "http", "path": "/", "method": "GET", "headers": []}
    request = Request(scope)
    if user_id is not None:
        request.state.user_id = user_id  # type: ignore[attr-defined]
    return request


def test_get_current_user_id_returns_id_when_authenticated() -> None:
    """get_current_user_id returns user_id when request.state.user_id is set."""
    request = _make_request(user_id="user-123")
    assert deps_module.get_current_user_id(request) == "user-123"


def test_get_current_user_id_raises_401_when_not_authenticated() -> None:
    """get_current_user_id raises 401 when request.state has no user_id."""
    request = _make_request(user_id=None)
    with pytest.raises(HTTPException) as exc:
        deps_module.get_current_user_id(request)
    assert exc.value.status_code == 401
    assert "authenticated" in exc.value.detail.lower()


def test_get_current_user_id_raises_when_state_has_no_user_id() -> None:
    """get_current_user_id raises when state exists but user_id attribute missing."""
    request = _make_request(user_id=None)
    # Ensure state exists but no user_id
    if not hasattr(request.state, "user_id"):
        pass  # getattr(request.state, "user_id", None) returns None
    with pytest.raises(HTTPException):
        deps_module.get_current_user_id(request)


def test_get_optional_user_id_returns_none_when_not_authenticated() -> None:
    """get_optional_user_id returns None when no user_id."""
    request = _make_request(user_id=None)
    assert deps_module.get_optional_user_id(request) is None


def test_get_optional_user_id_returns_id_when_authenticated() -> None:
    """get_optional_user_id returns user_id when set."""
    request = _make_request(user_id="user-456")
    assert deps_module.get_optional_user_id(request) == "user-456"


def test_get_optional_user_id_returns_string() -> None:
    """get_optional_user_id returns str (e.g. UUID string)."""
    request = _make_request(user_id="550e8400-e29b-41d4-a716-446655440000")
    result = deps_module.get_optional_user_id(request)
    assert result is not None
    assert isinstance(result, str)
