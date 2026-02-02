"""Unit tests for NotificationService preference logic (no real email/push)."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

from src.services.notifications import NotificationService, NotificationType


class FakeScalarResult:
    def __init__(self, value: Any) -> None:
        self._value = value

    def scalar_one_or_none(self) -> Any:
        return self._value


class FakeUserResult:
    def __init__(self, row: Any) -> None:
        self._row = row

    def one_or_none(self) -> Any:
        return self._row


class FakeDB:
    def __init__(self, ui_prefs: Any, user_row: Any = None) -> None:
        self._ui_prefs = ui_prefs
        self._user_row = user_row
        self.executed = 0

    async def execute(self, _query: Any) -> Any:  # noqa: ARG002
        # First call: user config; second call: user row for send_notification
        self.executed += 1
        if self.executed == 1:
            return FakeScalarResult(self._ui_prefs)
        return FakeUserResult(self._user_row)


@pytest.mark.asyncio
async def test_get_user_preferences_handles_missing_and_invalid() -> None:
    svc = NotificationService(db=FakeDB(ui_prefs=None))  # type: ignore[arg-type]
    prefs = await svc._get_user_preferences("user-1")
    assert prefs == {}

    svc2 = NotificationService(db=FakeDB(ui_prefs={"notifications": "not-a-dict"}))  # type: ignore[arg-type]
    prefs2 = await svc2._get_user_preferences("user-1")
    assert prefs2 == {}


@pytest.mark.asyncio
async def test_get_channel_enabled_uses_user_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    svc = NotificationService(db=AsyncMock())  # type: ignore[arg-type]

    async def fake_get_prefs(user_id: str) -> dict[str, Any]:  # noqa: ARG001
        return {
            "settings": [
                {
                    "id": NotificationType.BILLING.value,
                    "email": False,
                    "push": True,
                    "inApp": False,
                }
            ]
        }

    monkeypatch.setattr(svc, "_get_user_preferences", fake_get_prefs)

    assert await svc._get_channel_enabled("u1", NotificationType.BILLING, "email") is False
    assert await svc._get_channel_enabled("u1", NotificationType.BILLING, "push") is True
    assert await svc._get_channel_enabled("u1", NotificationType.BILLING, "inApp") is False


@pytest.mark.asyncio
async def test_get_channel_enabled_defaults_when_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    svc = NotificationService(db=AsyncMock())  # type: ignore[arg-type]

    async def fake_get_prefs(_user_id: str) -> dict[str, Any]:
        return {"settings": []}

    monkeypatch.setattr(svc, "_get_user_preferences", fake_get_prefs)

    # UPDATES default: email False, push False, inApp True
    assert await svc._get_channel_enabled("u1", NotificationType.UPDATES, "email") is False
    assert await svc._get_channel_enabled("u1", NotificationType.UPDATES, "push") is False
    assert await svc._get_channel_enabled("u1", NotificationType.UPDATES, "inApp") is True
