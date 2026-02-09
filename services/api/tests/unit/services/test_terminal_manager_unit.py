"""Unit tests for pure-Python parts of TerminalManager (no real sockets/redis)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.terminal import manager as term_module


def test_get_compute_terminal_url_builds_ws_url() -> None:
    mgr = term_module.TerminalManager()
    url = mgr._get_compute_terminal_url("ws1", "http://compute:3003", session_id="sess-1", shell="zsh")
    assert url.startswith("ws://compute:3003/terminal/ws1")
    assert "shell=zsh" in url
    assert "session_id=sess-1" in url


@pytest.mark.asyncio
async def test_cleanup_stale_sessions_removes_idle_sessions(monkeypatch: pytest.MonkeyPatch) -> None:
    mgr = term_module.TerminalManager()

    # Create a stale session
    stale = term_module.TerminalSession(
        workspace_id="ws1",
        session_id="s1",
    )
    stale.last_activity = datetime.now(UTC) - timedelta(hours=term_module.SESSION_MAX_IDLE_HOURS + 1)
    mgr.sessions["s1"] = stale

    # Stub logging and redis lock acquisition to avoid external calls
    monkeypatch.setattr(term_module, "_get_redis", AsyncMock(), raising=False)  # no-op

    await mgr._cleanup_stale_sessions()

    assert "s1" not in mgr.sessions
