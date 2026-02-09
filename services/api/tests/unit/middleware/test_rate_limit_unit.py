"""Unit tests for rate limit middleware helpers."""

from __future__ import annotations

import pytest
from starlette.requests import Request

from src.middleware import rate_limit as rl


def _make_request(
    path: str = "/",
    *,
    user_id: str | None = None,
    forwarded_for: str | None = None,
    client_host: str = "127.0.0.1",
) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if forwarded_for is not None:
        headers.append((b"x-forwarded-for", forwarded_for.encode()))
    scope = {
        "type": "http",
        "path": path,
        "method": "GET",
        "headers": headers,
        "client": (client_host, 0),
    }
    request = Request(scope)
    if user_id is not None:
        request.state.user_id = user_id  # type: ignore[attr-defined]
    return request


def test_get_client_identifier_uses_user_id() -> None:
    request = _make_request(user_id="user-123")
    assert rl.get_client_identifier(request) == "user:user-123"


def test_get_client_identifier_uses_ip_when_no_user() -> None:
    request = _make_request(client_host="192.168.1.1")
    # get_remote_address from slowapi uses request.client
    ident = rl.get_client_identifier(request)
    assert ident.startswith("ip:")
    assert "192.168.1.1" in ident or "127.0.0.1" in ident


@pytest.mark.asyncio
async def test_store_oauth_state_and_validate_oauth_state(monkeypatch: pytest.MonkeyPatch) -> None:
    storage: dict[str, str] = {}

    class FakeRedis:
        async def setex(self, key: str, ttl: int, value: str) -> None:  # noqa: ARG002
            storage[key] = value

        async def getdel(self, key: str) -> str | None:
            return storage.pop(key, None)

    fake_redis = FakeRedis()

    async def fake_get_redis() -> FakeRedis:
        return fake_redis

    monkeypatch.setattr(rl, "get_redis_client", fake_get_redis)

    await rl.store_oauth_state("state-abc", "github")

    key = f"{rl.OAUTH_STATE_PREFIX}state-abc"
    assert key in storage
    assert storage[key] == "github"

    valid = await rl.validate_oauth_state("state-abc", "github")
    assert valid is True
    assert key not in storage

    invalid = await rl.validate_oauth_state("state-abc", "github")
    assert invalid is False


@pytest.mark.asyncio
async def test_validate_oauth_link_state(monkeypatch: pytest.MonkeyPatch) -> None:
    import json

    storage: dict[str, str] = {}
    link_key = f"{rl.OAUTH_LINK_STATE_PREFIX}link-state-xyz"
    storage[link_key] = json.dumps({"provider": "google", "user_id": "u-99"})

    class FakeRedis:
        async def getdel(self, key: str) -> str | None:
            return storage.pop(key, None)

    async def fake_get_redis() -> FakeRedis:
        return FakeRedis()

    monkeypatch.setattr(rl, "get_redis_client", fake_get_redis)

    user_id = await rl.validate_oauth_link_state("link-state-xyz", "google")
    assert user_id == "u-99"
    assert link_key not in storage

    no_user = await rl.validate_oauth_link_state("link-state-xyz", "google")
    assert no_user is None
