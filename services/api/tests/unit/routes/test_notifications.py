"""Unit tests for notifications route helpers and Pydantic models."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response

from src.routes import notifications as notifications_module


def _make_notification_mock(
    notification_id: str = "n1",
    ntype: str = "info",
    title: str = "Title",
    message: str = "Message",
    read: bool = False,
) -> MagicMock:
    n = MagicMock()
    n.id = notification_id
    n.type = ntype
    n.title = title
    n.message = message
    n.action_url = None
    n.action_label = None
    n.read = read
    n.created_at = datetime.now(UTC)
    return n


class TestNotificationsPydanticModels:
    """Pydantic model validation."""

    def test_notification_response(self) -> None:
        """NotificationResponse holds id, type, title, message, read, created_at."""
        resp = notifications_module.NotificationResponse(
            id="n1",
            type="info",
            title="Test",
            message="Body",
            read=False,
            created_at="2025-01-01T00:00:00Z",
        )
        assert resp.id == "n1"
        assert resp.type == "info"
        assert resp.read is False

    def test_notifications_list_response(self) -> None:
        """NotificationsListResponse holds items and unread_count."""
        resp = notifications_module.NotificationsListResponse(items=[], unread_count=0)
        assert resp.items == []
        assert resp.unread_count == 0


def _notif_request(path: str = "/notifications", user_id: str = "u1") -> Request:
    req = Request({"type": "http", "method": "GET", "path": path, "headers": []})
    req.state.user_id = user_id
    return req


@pytest.mark.asyncio
async def test_get_notifications_401(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_notifications raises 401 when not authenticated."""
    monkeypatch.setattr(notifications_module.limiter, "enabled", False, raising=False)
    req = Request({"type": "http", "method": "GET", "path": "/notifications", "headers": []})
    if hasattr(req.state, "user_id"):
        delattr(req.state, "user_id")

    with pytest.raises(HTTPException) as exc:
        await notifications_module.get_notifications(
            request=req,
            response=Response(),
            db=AsyncMock(),
        )
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_get_notifications_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_notifications returns NotificationsListResponse with items and unread_count."""
    monkeypatch.setattr(notifications_module.limiter, "enabled", False, raising=False)
    n1 = _make_notification_mock("n1", read=False)
    n2 = _make_notification_mock("n2", read=True)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalars.return_value.all.return_value = [n1, n2]
    db.execute = AsyncMock(return_value=execute_result)

    result = await notifications_module.get_notifications(
        request=_notif_request(),
        response=Response(),
        db=db,
    )
    assert len(result.items) == 2
    assert result.unread_count == 1


@pytest.mark.asyncio
async def test_mark_notification_read_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """mark_notification_read raises 404 when notification not found."""
    monkeypatch.setattr(notifications_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    result_mock = MagicMock()
    result_mock.rowcount = 0
    db.execute = AsyncMock(return_value=result_mock)
    db.commit = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await notifications_module.mark_notification_read(
            notification_id="nonexistent",
            request=_notif_request(),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 404
    assert "not found" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_mark_notification_read_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """mark_notification_read returns status ok when update succeeds."""
    monkeypatch.setattr(notifications_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    result_mock = MagicMock()
    result_mock.rowcount = 1
    db.execute = AsyncMock(return_value=result_mock)
    db.commit = AsyncMock()

    result = await notifications_module.mark_notification_read(
        notification_id="n1",
        request=_notif_request(),
        response=Response(),
        db=db,
    )
    assert result["status"] == "ok"


@pytest.mark.asyncio
async def test_mark_all_notifications_read_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """mark_all_notifications_read returns status ok."""
    monkeypatch.setattr(notifications_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()

    result = await notifications_module.mark_all_notifications_read(
        request=_notif_request(),
        response=Response(),
        db=db,
    )
    assert result["status"] == "ok"


@pytest.mark.asyncio
async def test_delete_notification_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """delete_notification raises 404 when notification not found."""
    monkeypatch.setattr(notifications_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    result_mock = MagicMock()
    result_mock.rowcount = 0
    db.execute = AsyncMock(return_value=result_mock)
    db.commit = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await notifications_module.delete_notification(
            notification_id="nonexistent",
            request=_notif_request(),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 404
    assert "not found" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_delete_notification_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """delete_notification returns status ok when delete succeeds."""
    monkeypatch.setattr(notifications_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    result_mock = MagicMock()
    result_mock.rowcount = 1
    db.execute = AsyncMock(return_value=result_mock)
    db.commit = AsyncMock()

    result = await notifications_module.delete_notification(
        notification_id="n1",
        request=_notif_request(),
        response=Response(),
        db=db,
    )
    assert result["status"] == "ok"
