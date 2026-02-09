"""Unit tests for push route helpers and Pydantic models."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response

from src.routes import push as push_module


class TestPushPydanticModels:
    """Pydantic model validation."""

    def test_push_subscription_keys(self) -> None:
        """PushSubscriptionKeys holds p256dh and auth."""
        keys = push_module.PushSubscriptionKeys(p256dh="key", auth="secret")
        assert keys.p256dh == "key"
        assert keys.auth == "secret"

    def test_push_subscription_payload_alias(self) -> None:
        """PushSubscriptionPayload accepts expirationTime alias."""
        payload = push_module.PushSubscriptionPayload(
            endpoint="https://push.example.com",
            keys=push_module.PushSubscriptionKeys(p256dh="k", auth="a"),
            expirationTime=12345,
        )
        assert payload.endpoint == "https://push.example.com"
        assert payload.expiration_time == 12345

    def test_subscribe_request(self) -> None:
        """SubscribeRequest holds subscription payload."""
        sub = push_module.PushSubscriptionPayload(
            endpoint="https://push.example.com",
            keys=push_module.PushSubscriptionKeys(p256dh="k", auth="a"),
        )
        req = push_module.SubscribeRequest(subscription=sub)
        assert req.subscription.endpoint == "https://push.example.com"

    def test_unsubscribe_request(self) -> None:
        """UnsubscribeRequest holds endpoint."""
        req = push_module.UnsubscribeRequest(endpoint="https://push.example.com")
        assert req.endpoint == "https://push.example.com"

    def test_push_subscription_response(self) -> None:
        """PushSubscriptionResponse holds id, endpoint, is_active, created_at."""
        resp = push_module.PushSubscriptionResponse(
            id="sub-1",
            endpoint="https://push.example.com",
            is_active=True,
            created_at="2025-01-01T00:00:00Z",
        )
        assert resp.id == "sub-1"
        assert resp.is_active is True


def _push_request(
    path: str = "/push/subscribe",
    user_id: str | None = "u1",
    user_agent: str | None = None,
) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if user_agent is not None:
        headers.append((b"user-agent", user_agent.encode()))
    scope = {"type": "http", "method": "POST", "path": path, "headers": headers}
    req = Request(scope)
    if user_id is not None:
        req.state.user_id = user_id  # type: ignore[attr-defined]
    return req


@pytest.mark.asyncio
async def test_subscribe_to_push_401(monkeypatch: pytest.MonkeyPatch) -> None:
    """subscribe_to_push raises 401 when not authenticated."""
    monkeypatch.setattr(push_module.limiter, "enabled", False, raising=False)
    req = _push_request(user_id=None)
    if hasattr(req.state, "user_id"):
        delattr(req.state, "user_id")
    payload = push_module.SubscribeRequest(
        subscription=push_module.PushSubscriptionPayload(
            endpoint="https://push.example.com",
            keys=push_module.PushSubscriptionKeys(p256dh="k", auth="a"),
        )
    )

    with pytest.raises(HTTPException) as exc:
        await push_module.subscribe_to_push(
            request=req,
            response=Response(),
            payload=payload,
            db=AsyncMock(),
        )
    assert exc.value.status_code == 401
    assert "authenticated" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_subscribe_to_push_200_new(monkeypatch: pytest.MonkeyPatch) -> None:
    """subscribe_to_push creates new subscription and returns PushSubscriptionResponse."""
    monkeypatch.setattr(push_module.limiter, "enabled", False, raising=False)
    req = _push_request(user_agent="Mozilla/5.0")
    payload = push_module.SubscribeRequest(
        subscription=push_module.PushSubscriptionPayload(
            endpoint="https://push.example.com/s1",
            keys=push_module.PushSubscriptionKeys(p256dh="k", auth="a"),
        )
    )
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=execute_result)
    db.add = MagicMock()
    db.commit = AsyncMock()

    def refresh_sub(instance: object) -> None:
        setattr(instance, "id", "sub-new")
        setattr(instance, "created_at", datetime.now(UTC))
        setattr(instance, "is_active", True)
        setattr(instance, "user_agent", "Mozilla/5.0")

    db.refresh = AsyncMock(side_effect=refresh_sub)

    result = await push_module.subscribe_to_push(
        request=req,
        response=Response(),
        payload=payload,
        db=db,
    )
    assert result.endpoint == "https://push.example.com/s1"
    assert result.id == "sub-new"
    db.add.assert_called_once()
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_subscribe_to_push_200_update_existing(monkeypatch: pytest.MonkeyPatch) -> None:
    """subscribe_to_push updates existing subscription by endpoint."""
    monkeypatch.setattr(push_module.limiter, "enabled", False, raising=False)
    req = _push_request(user_agent=None)  # no User-Agent header
    payload = push_module.SubscribeRequest(
        subscription=push_module.PushSubscriptionPayload(
            endpoint="https://push.example.com/s1",
            keys=push_module.PushSubscriptionKeys(p256dh="k2", auth="a2"),
        )
    )
    existing = MagicMock()
    existing.id = "sub-existing"
    existing.endpoint = "https://push.example.com/s1"
    existing.created_at = datetime.now(UTC)
    existing.is_active = True
    existing.user_agent = None
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = existing
    db.execute = AsyncMock(return_value=execute_result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    result = await push_module.subscribe_to_push(
        request=req,
        response=Response(),
        payload=payload,
        db=db,
    )
    assert result.id == "sub-existing"
    assert existing.user_id == "u1"
    assert existing.p256dh_key == "k2"
    assert existing.auth_key == "a2"
    assert existing.is_active is True
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_unsubscribe_from_push_401(monkeypatch: pytest.MonkeyPatch) -> None:
    """unsubscribe_from_push raises 401 when not authenticated."""
    monkeypatch.setattr(push_module.limiter, "enabled", False, raising=False)
    req = _push_request(path="/push/unsubscribe", user_id=None)
    if hasattr(req.state, "user_id"):
        delattr(req.state, "user_id")
    payload = push_module.UnsubscribeRequest(endpoint="https://push.example.com")

    with pytest.raises(HTTPException) as exc:
        await push_module.unsubscribe_from_push(
            request=req,
            response=Response(),
            payload=payload,
            db=AsyncMock(),
        )
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_unsubscribe_from_push_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """unsubscribe_from_push returns status ok."""
    monkeypatch.setattr(push_module.limiter, "enabled", False, raising=False)
    req = _push_request(path="/push/unsubscribe")
    payload = push_module.UnsubscribeRequest(endpoint="https://push.example.com")
    db = AsyncMock()
    result_mock = MagicMock()
    result_mock.rowcount = 1
    db.execute = AsyncMock(return_value=result_mock)
    db.commit = AsyncMock()

    result = await push_module.unsubscribe_from_push(
        request=req,
        response=Response(),
        payload=payload,
        db=db,
    )
    assert result["status"] == "ok"
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_get_push_subscriptions_401(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_push_subscriptions raises 401 when not authenticated."""
    monkeypatch.setattr(push_module.limiter, "enabled", False, raising=False)
    req = _push_request(path="/push/subscriptions", user_id=None)
    if hasattr(req.state, "user_id"):
        delattr(req.state, "user_id")

    with pytest.raises(HTTPException) as exc:
        await push_module.get_push_subscriptions(
            request=req,
            response=Response(),
            db=AsyncMock(),
        )
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_get_push_subscriptions_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_push_subscriptions returns list of PushSubscriptionResponse."""
    monkeypatch.setattr(push_module.limiter, "enabled", False, raising=False)
    req = _push_request(path="/push/subscriptions")
    sub = MagicMock()
    sub.id = "sub-1"
    sub.endpoint = "https://push.example.com"
    sub.is_active = True
    sub.created_at = datetime.now(UTC)
    sub.user_agent = "Mozilla/5.0"
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalars.return_value.all.return_value = [sub]
    db.execute = AsyncMock(return_value=execute_result)

    result = await push_module.get_push_subscriptions(
        request=req,
        response=Response(),
        db=db,
    )
    assert len(result) == 1
    assert result[0].id == "sub-1"
    assert result[0].endpoint == "https://push.example.com"
