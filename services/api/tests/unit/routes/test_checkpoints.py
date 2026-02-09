"""Unit tests for checkpoints route helpers and Pydantic models."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response

from src.routes import checkpoints as cp_module


class TestCheckpointsPydanticModels:
    """Pydantic model validation."""

    def test_file_change_response(self) -> None:
        """FileChangeResponse holds path, change_type, lines_added, lines_removed."""
        resp = cp_module.FileChangeResponse(
            path="/foo/bar",
            change_type="modified",
            lines_added=10,
            lines_removed=2,
        )
        assert resp.path == "/foo/bar"
        assert resp.lines_added == 10
        assert resp.lines_removed == 2

    def test_checkpoint_response(self) -> None:
        """CheckpointResponse holds id, checkpoint_number, files, etc."""
        resp = cp_module.CheckpointResponse(
            id="cp-1",
            checkpoint_number=1,
            description="Edit",
            action_type="edit",
            agent_id="agent-1",
            status="completed",
            created_at="2025-01-01T00:00:00Z",
            files=[],
            file_count=0,
            total_lines_added=0,
            total_lines_removed=0,
        )
        assert resp.id == "cp-1"
        assert resp.checkpoint_number == 1
        assert resp.file_count == 0

    def test_checkpoint_diff_response(self) -> None:
        """CheckpointDiffResponse holds id, description, files."""
        resp = cp_module.CheckpointDiffResponse(
            id="cp-1",
            description="Edit",
            files=[{"path": "/foo", "change_type": "modified"}],
        )
        assert resp.id == "cp-1"
        assert len(resp.files) == 1

    def test_restore_response(self) -> None:
        """RestoreResponse holds success, checkpoint_id, files."""
        resp = cp_module.RestoreResponse(
            success=True,
            checkpoint_id="cp-1",
            files=[{"path": "/foo", "action": "restored", "success": True}],
        )
        assert resp.success is True
        assert resp.checkpoint_id == "cp-1"


def _checkpoint_request(path: str = "/sessions/s1/checkpoints", user_id: str = "u1") -> Request:
    req = Request({"type": "http", "method": "GET", "path": path, "headers": []})
    req.state.user_id = user_id
    return req


def _make_session_mock(session_id: str, owner_id: str = "u1", workspace_id: str | None = "ws1") -> MagicMock:
    s = MagicMock()
    s.id = session_id
    s.owner_id = owner_id
    s.workspace_id = workspace_id
    return s


def _make_checkpoint_mock(
    cp_id: str,
    session_id: str,
    checkpoint_number: int = 1,
    files: list | None = None,
) -> MagicMock:
    cp = MagicMock()
    cp.id = cp_id
    cp.session_id = session_id
    cp.checkpoint_number = checkpoint_number
    cp.description = "Edit"
    cp.action_type = "edit"
    cp.agent_id = "agent-1"
    cp.status = "completed"
    cp.created_at = datetime.now(UTC)
    cp.files = files or []
    return cp


@pytest.mark.asyncio
async def test_get_session_checkpoints_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_session_checkpoints raises 404 when session not found."""
    monkeypatch.setattr(cp_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=execute_result)

    with pytest.raises(HTTPException) as exc:
        await cp_module.get_session_checkpoints(
            session_id="s1",
            request=_checkpoint_request(),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 404
    assert "Session" in exc.value.detail


@pytest.mark.asyncio
async def test_get_session_checkpoints_403(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_session_checkpoints raises 403 when session owned by another user."""
    monkeypatch.setattr(cp_module.limiter, "enabled", False, raising=False)
    session = _make_session_mock("s1", owner_id="other")
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = session
    db.execute = AsyncMock(return_value=execute_result)

    with pytest.raises(HTTPException) as exc:
        await cp_module.get_session_checkpoints(
            session_id="s1",
            request=_checkpoint_request(),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 403
    assert "Access denied" in exc.value.detail


@pytest.mark.asyncio
async def test_get_session_checkpoints_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_session_checkpoints returns list of CheckpointResponse."""
    monkeypatch.setattr(cp_module.limiter, "enabled", False, raising=False)
    session = _make_session_mock("s1", owner_id="u1")
    cp = _make_checkpoint_mock("cp-1", "s1", checkpoint_number=1, files=[])
    db = AsyncMock()
    session_result = MagicMock()
    session_result.scalar_one_or_none.return_value = session
    cp_result = MagicMock()
    cp_result.scalars.return_value.all.return_value = [cp]
    db.execute = AsyncMock(side_effect=[session_result, cp_result])

    result = await cp_module.get_session_checkpoints(
        session_id="s1",
        request=_checkpoint_request(),
        response=Response(),
        db=db,
    )
    assert len(result) == 1
    assert result[0].id == "cp-1"
    assert result[0].checkpoint_number == 1
    assert result[0].file_count == 0


@pytest.mark.asyncio
async def test_get_checkpoint_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_checkpoint raises 404 when checkpoint not found."""
    monkeypatch.setattr(cp_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=execute_result)

    with pytest.raises(HTTPException) as exc:
        await cp_module.get_checkpoint(
            checkpoint_id="nonexistent",
            request=_checkpoint_request(path="/checkpoints/nonexistent"),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 404
    assert "Checkpoint" in exc.value.detail


@pytest.mark.asyncio
async def test_get_checkpoint_403(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_checkpoint raises 403 when session owned by another user."""
    monkeypatch.setattr(cp_module.limiter, "enabled", False, raising=False)
    checkpoint = _make_checkpoint_mock("cp-1", "s1")
    session = _make_session_mock("s1", owner_id="other")
    cp_with_files = _make_checkpoint_mock("cp-1", "s1")
    cp_with_files.files = []
    db = AsyncMock()
    r1 = MagicMock()
    r1.scalar_one_or_none.return_value = checkpoint
    r2 = MagicMock()
    r2.scalar_one_or_none.return_value = session
    r3 = MagicMock()
    r3.scalar_one.return_value = cp_with_files
    db.execute = AsyncMock(side_effect=[r1, r2, r3])

    with pytest.raises(HTTPException) as exc:
        await cp_module.get_checkpoint(
            checkpoint_id="cp-1",
            request=_checkpoint_request(path="/checkpoints/cp-1"),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 403
    assert "Access denied" in exc.value.detail


@pytest.mark.asyncio
async def test_get_checkpoint_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_checkpoint returns CheckpointResponse when found and authorized."""
    monkeypatch.setattr(cp_module.limiter, "enabled", False, raising=False)
    checkpoint = _make_checkpoint_mock("cp-1", "s1")
    session = _make_session_mock("s1", owner_id="u1")
    cp_with_files = _make_checkpoint_mock("cp-1", "s1")
    cp_with_files.files = []
    db = AsyncMock()
    r1 = MagicMock()
    r1.scalar_one_or_none.return_value = checkpoint
    r2 = MagicMock()
    r2.scalar_one_or_none.return_value = session
    r3 = MagicMock()
    r3.scalar_one.return_value = cp_with_files
    db.execute = AsyncMock(side_effect=[r1, r2, r3])

    result = await cp_module.get_checkpoint(
        checkpoint_id="cp-1",
        request=_checkpoint_request(path="/checkpoints/cp-1"),
        response=Response(),
        db=db,
    )
    assert result.id == "cp-1"
    assert result.checkpoint_number == 1
    assert result.file_count == 0


@pytest.mark.asyncio
async def test_get_checkpoint_diff_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_checkpoint_diff raises 404 when checkpoint not found."""
    monkeypatch.setattr(cp_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=execute_result)

    with pytest.raises(HTTPException) as exc:
        await cp_module.get_checkpoint_diff(
            checkpoint_id="nonexistent",
            request=_checkpoint_request(path="/checkpoints/nonexistent/diff"),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_get_checkpoint_diff_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_checkpoint_diff returns CheckpointDiffResponse when found."""
    monkeypatch.setattr(cp_module.limiter, "enabled", False, raising=False)
    checkpoint = _make_checkpoint_mock("cp-1", "s1")
    checkpoint.description = "Edit"
    session = _make_session_mock("s1", owner_id="u1")
    f = MagicMock()
    f.file_path = "/foo"
    f.change_type = "modified"
    f.content_before = "old"
    f.content_after = "new"
    f.lines_added = 1
    f.lines_removed = 1
    cp_with_files = _make_checkpoint_mock("cp-1", "s1")
    cp_with_files.description = "Edit"
    cp_with_files.files = [f]
    db = AsyncMock()
    r1 = MagicMock()
    r1.scalar_one_or_none.return_value = checkpoint
    r2 = MagicMock()
    r2.scalar_one_or_none.return_value = session
    r3 = MagicMock()
    r3.scalar_one.return_value = cp_with_files
    db.execute = AsyncMock(side_effect=[r1, r2, r3])

    result = await cp_module.get_checkpoint_diff(
        checkpoint_id="cp-1",
        request=_checkpoint_request(path="/checkpoints/cp-1/diff"),
        response=Response(),
        db=db,
    )
    assert result.id == "cp-1"
    assert len(result.files) == 1
    assert result.files[0]["path"] == "/foo"


@pytest.mark.asyncio
async def test_restore_checkpoint_400_no_workspace(monkeypatch: pytest.MonkeyPatch) -> None:
    """restore_checkpoint raises 400 when session has no workspace."""
    monkeypatch.setattr(cp_module.limiter, "enabled", False, raising=False)
    checkpoint = _make_checkpoint_mock("cp-1", "s1")
    session = _make_session_mock("s1", owner_id="u1", workspace_id=None)
    db = AsyncMock()
    r1 = MagicMock()
    r1.scalar_one_or_none.return_value = checkpoint
    r2 = MagicMock()
    r2.scalar_one_or_none.return_value = session
    db.execute = AsyncMock(side_effect=[r1, r2])

    with pytest.raises(HTTPException) as exc:
        await cp_module.restore_checkpoint(
            checkpoint_id="cp-1",
            request=_checkpoint_request(path="/checkpoints/cp-1/restore"),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 400
    assert "no workspace" in exc.value.detail.lower()
