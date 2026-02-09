"""Unit tests for pure-Python pieces of SessionSyncManager."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.session_sync import manager as sync_module
from src.session_sync.models import SessionState, WorkspaceState


def make_session(session_id: str = "s1") -> SessionState:
    now = datetime.now(UTC)
    return SessionState(
        session_id=session_id,
        user_id="u1",
        name="Test",
        created_at=now,
        updated_at=now,
        last_activity=now,
    )


def test_apply_file_open_adds_file() -> None:
    session = make_session()
    ws = WorkspaceState(workspace_id="ws1", repo_url=None)
    session.workspaces.append(ws)

    sync_module._apply_file_open(session, {"workspace_id": "ws1", "file_path": "a.py"})

    assert ws.open_files == ["a.py"]
    assert ws.active_file == "a.py"


def test_apply_file_close_removes_file_and_updates_active() -> None:
    session = make_session()
    ws = WorkspaceState(workspace_id="ws1", repo_url=None, open_files=["a.py", "b.py"], active_file="a.py")
    session.workspaces.append(ws)

    sync_module._apply_file_close(session, {"workspace_id": "ws1", "file_path": "a.py"})

    assert ws.open_files == ["b.py"]
    assert ws.active_file == "b.py"


@pytest.mark.asyncio
async def test_create_session_state_saves_and_returns(monkeypatch: pytest.MonkeyPatch) -> None:
    """create_session_state builds a SessionState and saves via _save_session_to_redis."""
    mgr = sync_module.SessionSyncManager()
    saved: dict[str, Any] = {}

    async def fake_save(session: SessionState) -> None:
        saved["id"] = session.session_id
        saved["user_id"] = session.user_id

    monkeypatch.setattr(mgr, "_save_session_to_redis", fake_save)

    session = await mgr.create_session_state("s123", "u123", "Project")
    assert session.session_id == "s123"
    assert session.user_id == "u123"
    assert saved["id"] == "s123"


@pytest.mark.asyncio
async def test_add_workspace_appends_workspace_and_updates_last_activity(monkeypatch: pytest.MonkeyPatch) -> None:
    mgr = sync_module.SessionSyncManager()

    session = make_session("s1")
    mgr.get_session_state = AsyncMock(return_value=session)  # type: ignore[assignment]
    mgr._save_session_to_redis = AsyncMock()  # type: ignore[assignment]

    await mgr.add_workspace("s1", "ws1", repo_url="https://example.com/repo.git")

    assert len(session.workspaces) == 1
    ws = session.workspaces[0]
    assert ws.workspace_id == "ws1"
    assert ws.repo_url == "https://example.com/repo.git"
    assert session.last_activity <= datetime.now(UTC)
