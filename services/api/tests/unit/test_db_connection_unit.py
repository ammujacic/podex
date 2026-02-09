"""Unit tests for src.database.connection helpers using fake sessions/pool."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.database import connection as conn_module


class FakeSession:
    def __init__(self, should_fail_state: bool = False) -> None:
        self.new: set[Any] = set()
        self.dirty: set[Any] = set()
        self.deleted: set[Any] = set()
        self.should_fail_state = should_fail_state
        self.committed = False
        self.rolled_back = False
        self.closed = False

    async def commit(self) -> None:
        self.committed = True

    async def rollback(self) -> None:
        self.rolled_back = True

    async def close(self) -> None:
        self.closed = True

    async def __aenter__(self) -> "FakeSession":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:  # noqa: ANN001
        await self.close()


@pytest.mark.asyncio
async def test_get_pool_status_uses_engine_pool(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_pool_status returns dict from engine.sync_engine.pool."""
    fake_pool = MagicMock()
    fake_pool.size.return_value = 10
    fake_pool.checkedout.return_value = 3
    fake_pool.overflow.return_value = 1
    fake_pool.checkedin.return_value = 7

    fake_engine = MagicMock()
    fake_engine.sync_engine.pool = fake_pool

    monkeypatch.setattr(conn_module, "engine", fake_engine)

    status = conn_module.get_pool_status()
    assert status == {
        "pool_size": 10,
        "checked_out": 3,
        "overflow": 1,
        "checked_in": 7,
    }


@pytest.mark.asyncio
async def test_get_db_commits_when_there_are_changes(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_db commits when session has new/dirty/deleted objects."""
    fake_session = FakeSession()
    fake_session.new.add(object())

    # async_session_factory() in production returns an async context manager;
    # here we return our FakeSession which implements __aenter__/__aexit__.
    monkeypatch.setattr(conn_module, "async_session_factory", lambda: fake_session)

    # Consume generator
    gen = conn_module.get_db()
    session = await gen.__anext__()
    assert session is fake_session
    with pytest.raises(StopAsyncIteration):
        await gen.__anext__()

    assert fake_session.committed is True
    assert fake_session.rolled_back is False
    assert fake_session.closed is True


@pytest.mark.asyncio
async def test_get_db_context_commits_when_changes(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_db_context commits when there are pending changes."""
    fake_session = FakeSession()
    fake_session.dirty.add(object())

    monkeypatch.setattr(conn_module, "async_session_factory", lambda: fake_session)

    async with conn_module.get_db_context() as session:
        assert session is fake_session

    assert fake_session.committed is True
    assert fake_session.rolled_back is False
    assert fake_session.closed is True
