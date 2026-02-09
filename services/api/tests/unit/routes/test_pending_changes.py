"""Unit tests for pending_changes route helpers and Pydantic models."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response

from src.routes import pending_changes as pc_module


class TestPendingChangesPydanticModels:
    """Pydantic model validation."""

    def test_pending_change_response(self) -> None:
        """PendingChangeResponse holds id, session_id, file_path, status, etc."""
        resp = pc_module.PendingChangeResponse(
            id="ch-1",
            session_id="s1",
            agent_id="agent-1",
            agent_name="Agent",
            file_path="/foo",
            original_content="old",
            proposed_content="new",
            description="Edit",
            status="pending",
            created_at="2025-01-01T00:00:00Z",
        )
        assert resp.id == "ch-1"
        assert resp.file_path == "/foo"
        assert resp.status == "pending"

    def test_create_pending_change_request(self) -> None:
        """CreatePendingChangeRequest holds agent_id, file_path, proposed_content."""
        req = pc_module.CreatePendingChangeRequest(
            agent_id="agent-1",
            file_path="/foo",
            proposed_content="new content",
        )
        assert req.agent_id == "agent-1"
        assert req.proposed_content == "new content"
        assert req.original_content is None
        assert req.description is None

    def test_reject_change_request_optional_feedback(self) -> None:
        """RejectChangeRequest has optional feedback."""
        req = pc_module.RejectChangeRequest(feedback="Not needed")
        assert req.feedback == "Not needed"
        req2 = pc_module.RejectChangeRequest()
        assert req2.feedback is None


def _pending_request(path: str = "/sessions/s1/pending-changes", user_id: str = "u1") -> Request:
    req = Request({"type": "http", "method": "GET", "path": path, "headers": []})
    req.state.user_id = user_id
    return req


def _make_session_mock(session_id: str, owner_id: str = "u1") -> MagicMock:
    s = MagicMock()
    s.id = session_id
    s.owner_id = owner_id
    return s


@pytest.mark.asyncio
async def test_list_pending_changes_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """list_pending_changes raises 404 when session not found."""
    monkeypatch.setattr(pc_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=execute_result)

    with pytest.raises(HTTPException) as exc:
        await pc_module.list_pending_changes(
            session_id="s1",
            request=_pending_request(),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 404
    assert "Session" in exc.value.detail


@pytest.mark.asyncio
async def test_list_pending_changes_403(monkeypatch: pytest.MonkeyPatch) -> None:
    """list_pending_changes raises 403 when session owned by another user."""
    monkeypatch.setattr(pc_module.limiter, "enabled", False, raising=False)
    session = _make_session_mock("s1", owner_id="other")
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = session
    db.execute = AsyncMock(return_value=execute_result)

    with pytest.raises(HTTPException) as exc:
        await pc_module.list_pending_changes(
            session_id="s1",
            request=_pending_request(),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 403
    assert "authorized" in exc.value.detail.lower() or "denied" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_list_pending_changes_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """list_pending_changes returns list of PendingChangeResponse."""
    monkeypatch.setattr(pc_module.limiter, "enabled", False, raising=False)
    session = _make_session_mock("s1", owner_id="u1")
    change = MagicMock()
    change.id = "ch-1"
    change.session_id = "s1"
    change.agent_id = "agent-1"
    change.file_path = "/foo"
    change.original_content = None
    change.proposed_content = "new"
    change.description = None
    change.status = "pending"
    change.created_at = datetime.now(UTC)
    db = AsyncMock()
    session_result = MagicMock()
    session_result.scalar_one_or_none.return_value = session
    rows_result = MagicMock()
    rows_result.all.return_value = [(change, "Agent Name")]
    db.execute = AsyncMock(side_effect=[session_result, rows_result])

    result = await pc_module.list_pending_changes(
        session_id="s1",
        request=_pending_request(),
        response=Response(),
        db=db,
    )
    assert len(result) == 1
    assert result[0].id == "ch-1"
    assert result[0].agent_name == "Agent Name"
    assert result[0].status == "pending"


@pytest.mark.asyncio
async def test_get_pending_change_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_pending_change raises 404 when change not found."""
    monkeypatch.setattr(pc_module.limiter, "enabled", False, raising=False)
    session = _make_session_mock("s1", owner_id="u1")
    db = AsyncMock()
    session_result = MagicMock()
    session_result.scalar_one_or_none.return_value = session
    row_result = MagicMock()
    row_result.one_or_none.return_value = None
    db.execute = AsyncMock(side_effect=[session_result, row_result])

    with pytest.raises(HTTPException) as exc:
        await pc_module.get_pending_change(
            session_id="s1",
            change_id="nonexistent",
            request=_pending_request(),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 404
    assert "not found" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_get_pending_change_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_pending_change returns PendingChangeResponse when found."""
    monkeypatch.setattr(pc_module.limiter, "enabled", False, raising=False)
    session = _make_session_mock("s1", owner_id="u1")
    change = MagicMock()
    change.id = "ch-1"
    change.session_id = "s1"
    change.agent_id = "agent-1"
    change.file_path = "/foo"
    change.original_content = None
    change.proposed_content = "new"
    change.description = None
    change.status = "pending"
    change.created_at = datetime.now(UTC)
    db = AsyncMock()
    session_result = MagicMock()
    session_result.scalar_one_or_none.return_value = session
    row_result = MagicMock()
    row_result.one_or_none.return_value = (change, "Agent Name")
    db.execute = AsyncMock(side_effect=[session_result, row_result])

    result = await pc_module.get_pending_change(
        session_id="s1",
        change_id="ch-1",
        request=_pending_request(),
        response=Response(),
        db=db,
    )
    assert result.id == "ch-1"
    assert result.file_path == "/foo"
    assert result.agent_name == "Agent Name"


@pytest.mark.asyncio
async def test_create_pending_change_404_agent(monkeypatch: pytest.MonkeyPatch) -> None:
    """create_pending_change raises 404 when agent not in session."""
    monkeypatch.setattr(pc_module.limiter, "enabled", False, raising=False)
    session = _make_session_mock("s1", owner_id="u1")
    db = AsyncMock()
    session_result = MagicMock()
    session_result.scalar_one_or_none.return_value = session
    agent_result = MagicMock()
    agent_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(side_effect=[session_result, agent_result])
    body = pc_module.CreatePendingChangeRequest(
        agent_id="agent-1",
        file_path="/foo",
        proposed_content="new",
    )

    with pytest.raises(HTTPException) as exc:
        await pc_module.create_pending_change(
            session_id="s1",
            request=_pending_request(path="/sessions/s1/pending-changes"),
            response=Response(),
            db=db,
            body=body,
        )
    assert exc.value.status_code == 404
    assert "Agent" in exc.value.detail


@pytest.mark.asyncio
async def test_create_pending_change_201(monkeypatch: pytest.MonkeyPatch) -> None:
    """create_pending_change creates change and returns PendingChangeResponse."""
    monkeypatch.setattr(pc_module.limiter, "enabled", False, raising=False)
    session = _make_session_mock("s1", owner_id="u1")
    agent = MagicMock()
    agent.name = "Agent"
    db = AsyncMock()
    session_result = MagicMock()
    session_result.scalar_one_or_none.return_value = session
    agent_result = MagicMock()
    agent_result.scalar_one_or_none.return_value = agent
    db.execute = AsyncMock(side_effect=[session_result, agent_result])
    db.add = MagicMock()
    db.commit = AsyncMock()

    async def refresh_change(instance: object) -> None:
        setattr(instance, "id", "ch-new")
        setattr(instance, "session_id", "s1")
        setattr(instance, "agent_id", "agent-1")
        setattr(instance, "file_path", "/foo")
        setattr(instance, "original_content", None)
        setattr(instance, "proposed_content", "new")
        setattr(instance, "description", None)
        setattr(instance, "status", "pending")
        setattr(instance, "created_at", datetime.now(UTC))

    db.refresh = AsyncMock(side_effect=refresh_change)
    body = pc_module.CreatePendingChangeRequest(
        agent_id="agent-1",
        file_path="/foo",
        proposed_content="new",
    )

    result = await pc_module.create_pending_change(
        session_id="s1",
        request=_pending_request(path="/sessions/s1/pending-changes"),
        response=Response(),
        db=db,
        body=body,
    )
    assert result.id == "ch-new"
    assert result.file_path == "/foo"
    assert result.status == "pending"
    db.add.assert_called_once()
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_accept_pending_change_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """accept_pending_change raises 404 when change not found."""
    monkeypatch.setattr(pc_module.limiter, "enabled", False, raising=False)
    session = _make_session_mock("s1", owner_id="u1")
    db = AsyncMock()
    session_result = MagicMock()
    session_result.scalar_one_or_none.return_value = session
    change_result = MagicMock()
    change_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(side_effect=[session_result, change_result])
    db.commit = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await pc_module.accept_pending_change(
            session_id="s1",
            change_id="nonexistent",
            request=_pending_request(),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 404
    assert "not found" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_accept_pending_change_400_wrong_status(monkeypatch: pytest.MonkeyPatch) -> None:
    """accept_pending_change raises 400 when change not pending."""
    monkeypatch.setattr(pc_module.limiter, "enabled", False, raising=False)
    session = _make_session_mock("s1", owner_id="u1")
    change = MagicMock()
    change.status = "accepted"
    change.file_path = "/foo"
    db = AsyncMock()
    session_result = MagicMock()
    session_result.scalar_one_or_none.return_value = session
    change_result = MagicMock()
    change_result.scalar_one_or_none.return_value = change
    db.execute = AsyncMock(side_effect=[session_result, change_result])

    with pytest.raises(HTTPException) as exc:
        await pc_module.accept_pending_change(
            session_id="s1",
            change_id="ch-1",
            request=_pending_request(),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 400
    assert "already" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_accept_pending_change_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """accept_pending_change updates status and returns accepted."""
    monkeypatch.setattr(pc_module.limiter, "enabled", False, raising=False)
    session = _make_session_mock("s1", owner_id="u1")
    change = MagicMock()
    change.status = "pending"
    change.file_path = "/foo"
    db = AsyncMock()
    session_result = MagicMock()
    session_result.scalar_one_or_none.return_value = session
    change_result = MagicMock()
    change_result.scalar_one_or_none.return_value = change
    db.execute = AsyncMock(side_effect=[session_result, change_result])
    db.commit = AsyncMock()

    result = await pc_module.accept_pending_change(
        session_id="s1",
        change_id="ch-1",
        request=_pending_request(),
        response=Response(),
        db=db,
    )
    assert result["status"] == "accepted"
    assert result["change_id"] == "ch-1"
    assert change.status == "accepted"
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_reject_pending_change_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """reject_pending_change raises 404 when change not found."""
    monkeypatch.setattr(pc_module.limiter, "enabled", False, raising=False)
    session = _make_session_mock("s1", owner_id="u1")
    db = AsyncMock()
    session_result = MagicMock()
    session_result.scalar_one_or_none.return_value = session
    change_result = MagicMock()
    change_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(side_effect=[session_result, change_result])
    db.commit = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await pc_module.reject_pending_change(
            session_id="s1",
            change_id="nonexistent",
            request=_pending_request(),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 404
    assert "not found" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_reject_pending_change_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """reject_pending_change updates status and returns rejected."""
    monkeypatch.setattr(pc_module.limiter, "enabled", False, raising=False)
    session = _make_session_mock("s1", owner_id="u1")
    change = MagicMock()
    change.status = "pending"
    change.file_path = "/foo"
    db = AsyncMock()
    session_result = MagicMock()
    session_result.scalar_one_or_none.return_value = session
    change_result = MagicMock()
    change_result.scalar_one_or_none.return_value = change
    db.execute = AsyncMock(side_effect=[session_result, change_result])
    db.commit = AsyncMock()
    body = pc_module.RejectChangeRequest(feedback="Not needed")

    result = await pc_module.reject_pending_change(
        session_id="s1",
        change_id="ch-1",
        request=_pending_request(),
        response=Response(),
        db=db,
        body=body,
    )
    assert result["status"] == "rejected"
    assert result["change_id"] == "ch-1"
    assert change.status == "rejected"
    db.commit.assert_awaited_once()
