"""Unit tests for waitlist route helpers and Pydantic models."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from starlette.requests import Request
from starlette.responses import Response

from src.routes import waitlist as waitlist_module


class TestWaitlistPydanticModels:
    """Pydantic model validation and defaults."""

    def test_waitlist_join_request_defaults(self) -> None:
        """WaitlistJoinRequest has source default and accepts valid email."""
        req = waitlist_module.WaitlistJoinRequest(email="user@example.com")
        assert req.source == "coming_soon"
        assert req.referral_code is None

    def test_waitlist_join_request_invalid_email(self) -> None:
        """WaitlistJoinRequest rejects invalid email."""
        with pytest.raises(ValidationError):
            waitlist_module.WaitlistJoinRequest(email="not-an-email")

    def test_waitlist_join_response_shape(self) -> None:
        """WaitlistJoinResponse serializes with expected fields."""
        resp = waitlist_module.WaitlistJoinResponse(
            success=True,
            message="You're on the list!",
            position=1,
            already_registered=False,
        )
        dumped = resp.model_dump()
        assert dumped["success"] is True
        assert dumped["position"] == 1
        assert dumped["already_registered"] is False


@pytest.mark.asyncio
async def test_join_waitlist_already_registered(monkeypatch: pytest.MonkeyPatch) -> None:
    """join_waitlist returns 200 with already_registered=True when email exists."""
    monkeypatch.setattr(waitlist_module.limiter, "enabled", False, raising=False)
    existing = MagicMock()
    existing.position = 5
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = existing
    db.execute.return_value = execute_result

    data = waitlist_module.WaitlistJoinRequest(email="existing@example.com")
    result = await waitlist_module.join_waitlist(
        data=data,
        request=Request({"type": "http", "method": "POST", "path": "/waitlist", "headers": []}),
        response=Response(),
        db=db,
    )
    assert result.success is True
    assert result.already_registered is True
    assert result.position == 5
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_join_waitlist_new_signup(monkeypatch: pytest.MonkeyPatch) -> None:
    """join_waitlist creates entry and returns position when email is new."""
    monkeypatch.setattr(waitlist_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    db.add = MagicMock()  # sync in real SQLAlchemy
    existing_result = MagicMock()
    existing_result.scalar_one_or_none.return_value = None
    count_result = MagicMock()
    count_result.scalar.return_value = 10
    db.execute.side_effect = [existing_result, count_result]

    # Mock EmailService so we don't send real email
    monkeypatch.setattr(
        waitlist_module,
        "EmailService",
        MagicMock(return_value=MagicMock(send_email=AsyncMock())),
    )

    data = waitlist_module.WaitlistJoinRequest(email="new@example.com")
    result = await waitlist_module.join_waitlist(
        data=data,
        request=Request({"type": "http", "method": "POST", "path": "/waitlist", "headers": []}),
        response=Response(),
        db=db,
    )
    assert result.success is True
    assert result.already_registered is False
    assert result.position == 11
    db.add.assert_called_once()
    db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_check_position_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """check_position raises 404 when email not on waitlist."""
    monkeypatch.setattr(waitlist_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute.return_value = execute_result

    with pytest.raises(HTTPException) as exc:
        await waitlist_module.check_position(
            email="unknown@example.com",
            request=Request({"type": "http", "method": "GET", "path": "/waitlist/position/x", "headers": []}),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_check_position_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """check_position returns position and status when email found."""
    monkeypatch.setattr(waitlist_module.limiter, "enabled", False, raising=False)
    entry = MagicMock()
    entry.position = 3
    entry.status = "waiting"
    entry.created_at = datetime.now(UTC)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = entry
    db.execute.return_value = execute_result

    result = await waitlist_module.check_position(
        email="user@example.com",
        request=Request({"type": "http", "method": "GET", "path": "/waitlist/position/user@example.com", "headers": []}),
        response=Response(),
        db=db,
    )
    assert result["email"] == "user@example.com"
    assert result["position"] == 3
    assert result["status"] == "waiting"
    assert "joined_at" in result
