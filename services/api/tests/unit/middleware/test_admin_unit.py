"""Unit tests for admin middleware (require_admin, require_super_admin)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from src.middleware import admin as admin_mw


def _make_request(
    user_id: str | None = None,
    user_role: str = "member",
    user_email: str | None = None,
) -> Request:
    scope = {"type": "http", "path": "/admin", "method": "GET", "headers": []}
    request = Request(scope)
    if user_id is not None:
        request.state.user_id = user_id  # type: ignore[attr-defined]
    request.state.user_role = user_role  # type: ignore[attr-defined]
    if user_email is not None:
        request.state.user_email = user_email  # type: ignore[attr-defined]
    return request


@pytest.mark.asyncio
async def test_require_admin_500_when_no_request() -> None:
    """require_admin raises 500 when request is not in args/kwargs."""
    @admin_mw.require_admin
    async def handler(request: Request) -> str:
        return "ok"

    with pytest.raises(HTTPException) as exc:
        await handler()
    assert exc.value.status_code == 500
    assert "Request not found" in exc.value.detail


@pytest.mark.asyncio
async def test_require_admin_401_when_no_user_id() -> None:
    """require_admin raises 401 when request.state has no user_id."""
    @admin_mw.require_admin
    async def handler(request: Request) -> str:
        return "ok"

    request = _make_request(user_id=None)
    with pytest.raises(HTTPException) as exc:
        await handler(request)
    assert exc.value.status_code == 401
    assert "Authentication" in exc.value.detail


@pytest.mark.asyncio
async def test_require_admin_403_when_not_admin_role() -> None:
    """require_admin raises 403 when user_role is not admin or super_admin."""
    @admin_mw.require_admin
    async def handler(request: Request) -> str:
        return "ok"

    request = _make_request(user_id="u1", user_role="member")
    with pytest.raises(HTTPException) as exc:
        await handler(request)
    assert exc.value.status_code == 403
    assert "Admin" in exc.value.detail


@pytest.mark.asyncio
async def test_require_admin_calls_func_when_admin_role() -> None:
    """require_admin calls the handler when user_role is admin."""
    @admin_mw.require_admin
    async def handler(request: Request) -> str:
        return "ok"

    request = _make_request(user_id="u1", user_role="admin")
    result = await handler(request)
    assert result == "ok"


@pytest.mark.asyncio
async def test_require_admin_calls_func_when_super_admin_role() -> None:
    """require_admin calls the handler when user_role is super_admin."""
    @admin_mw.require_admin
    async def handler(request: Request) -> str:
        return "ok"

    request = _make_request(user_id="u1", user_role="super_admin")
    result = await handler(request)
    assert result == "ok"


@pytest.mark.asyncio
async def test_require_admin_super_user_bypass(monkeypatch: pytest.MonkeyPatch) -> None:
    """require_admin calls the handler when user_email is in ADMIN_SUPER_USER_EMAILS."""
    monkeypatch.setattr(admin_mw.settings, "ADMIN_SUPER_USER_EMAILS", ["super@example.com"])
    request = _make_request(user_id="u1", user_role="member", user_email="super@example.com")

    @admin_mw.require_admin
    async def handler(request: Request) -> str:
        return "ok"

    result = await handler(request)
    assert result == "ok"


@pytest.mark.asyncio
async def test_require_super_admin_403_when_admin_not_super() -> None:
    """require_super_admin raises 403 when user_role is admin but not super_admin."""
    @admin_mw.require_super_admin
    async def handler(request: Request) -> str:
        return "ok"

    request = _make_request(user_id="u1", user_role="admin")
    with pytest.raises(HTTPException) as exc:
        await handler(request)
    assert exc.value.status_code == 403
    assert "Super admin" in exc.value.detail


@pytest.mark.asyncio
async def test_require_super_admin_calls_func_when_super_admin() -> None:
    """require_super_admin calls the handler when user_role is super_admin."""
    @admin_mw.require_super_admin
    async def handler(request: Request) -> str:
        return "ok"

    request = _make_request(user_id="u1", user_role="super_admin")
    result = await handler(request)
    assert result == "ok"


def test_admin_roles_constant() -> None:
    """ADMIN_ROLES contains admin and super_admin."""
    assert admin_mw.ADMIN_ROLES == {"admin", "super_admin"}
