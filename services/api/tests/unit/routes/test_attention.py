"""Unit tests for attention route helpers and Pydantic models."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response

from src.routes import attention as attention_module


class TestAttentionPydanticModels:
    """Pydantic model validation."""

    def test_attention_response(self) -> None:
        """AttentionResponse holds id, agent_id, session_id, title, message, etc."""
        resp = attention_module.AttentionResponse(
            id="att-1",
            agent_id="agent-1",
            agent_name="Agent",
            session_id="s1",
            attention_type="info",
            title="Title",
            message="Message",
            priority="normal",
            is_read=False,
            is_dismissed=False,
            metadata=None,
            created_at=datetime.now(UTC),
        )
        assert resp.id == "att-1"
        assert resp.agent_name == "Agent"
        assert resp.is_read is False


def _attention_request(path: str = "/sessions/s1/attention", user_id: str = "u1") -> Request:
    req = Request({"type": "http", "method": "GET", "path": path, "headers": []})
    req.state.user_id = user_id
    return req


@pytest.mark.asyncio
async def test_list_attention_items_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """list_attention_items returns list of AttentionResponse."""
    monkeypatch.setattr(attention_module.limiter, "enabled", False, raising=False)
    monkeypatch.setattr(
        attention_module,
        "verify_session_access",
        AsyncMock(return_value=MagicMock()),
    )
    item = MagicMock()
    item.id = "att-1"
    item.agent_id = "agent-1"
    item.session_id = "s1"
    item.attention_type = "info"
    item.title = "Title"
    item.message = "Message"
    item.priority = "normal"
    item.is_read = False
    item.is_dismissed = False
    item.attention_metadata = None
    item.created_at = datetime.now(UTC)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.all.return_value = [(item, "Agent Name")]
    db.execute = AsyncMock(return_value=execute_result)

    result = await attention_module.list_attention_items(
        session_id="s1",
        request=_attention_request(),
        response=Response(),
        db=db,
        include_dismissed=False,
    )
    assert len(result) == 1
    assert result[0].id == "att-1"
    assert result[0].agent_name == "Agent Name"
    assert result[0].title == "Title"


@pytest.mark.asyncio
async def test_get_unread_count_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_unread_count returns unread_count."""
    monkeypatch.setattr(attention_module.limiter, "enabled", False, raising=False)
    monkeypatch.setattr(
        attention_module,
        "verify_session_access",
        AsyncMock(return_value=MagicMock()),
    )
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar.return_value = 3
    db.execute = AsyncMock(return_value=execute_result)

    result = await attention_module.get_unread_count(
        session_id="s1",
        request=_attention_request(),
        response=Response(),
        db=db,
    )
    assert result["unread_count"] == 3


@pytest.mark.asyncio
async def test_mark_attention_read_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """mark_attention_read raises 404 when attention item not found."""
    monkeypatch.setattr(attention_module.limiter, "enabled", False, raising=False)
    monkeypatch.setattr(
        attention_module,
        "verify_session_access",
        AsyncMock(return_value=MagicMock()),
    )
    monkeypatch.setattr(attention_module, "emit_to_session", AsyncMock())
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=execute_result)
    db.commit = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await attention_module.mark_attention_read(
            session_id="s1",
            attention_id="nonexistent",
            request=_attention_request(),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 404
    assert "not found" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_mark_attention_read_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """mark_attention_read returns message and broadcasts."""
    monkeypatch.setattr(attention_module.limiter, "enabled", False, raising=False)
    monkeypatch.setattr(
        attention_module,
        "verify_session_access",
        AsyncMock(return_value=MagicMock()),
    )
    emit = AsyncMock()
    monkeypatch.setattr(attention_module, "emit_to_session", emit)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = "att-1"
    db.execute = AsyncMock(return_value=execute_result)
    db.commit = AsyncMock()

    result = await attention_module.mark_attention_read(
        session_id="s1",
        attention_id="att-1",
        request=_attention_request(),
        response=Response(),
        db=db,
    )
    assert result["message"] == "Marked as read"
    emit.assert_awaited_once()
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_dismiss_attention_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """dismiss_attention raises 404 when attention item not found."""
    monkeypatch.setattr(attention_module.limiter, "enabled", False, raising=False)
    monkeypatch.setattr(
        attention_module,
        "verify_session_access",
        AsyncMock(return_value=MagicMock()),
    )
    monkeypatch.setattr(attention_module, "emit_to_session", AsyncMock())
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=execute_result)

    with pytest.raises(HTTPException) as exc:
        await attention_module.dismiss_attention(
            session_id="s1",
            attention_id="nonexistent",
            request=_attention_request(),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 404
    assert "not found" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_dismiss_attention_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """dismiss_attention updates item and broadcasts."""
    monkeypatch.setattr(attention_module.limiter, "enabled", False, raising=False)
    monkeypatch.setattr(
        attention_module,
        "verify_session_access",
        AsyncMock(return_value=MagicMock()),
    )
    emit = AsyncMock()
    monkeypatch.setattr(attention_module, "emit_to_session", emit)
    attention = MagicMock()
    attention.agent_id = "agent-1"
    db = AsyncMock()
    first_result = MagicMock()
    first_result.scalar_one_or_none.return_value = attention
    db.execute = AsyncMock(side_effect=[first_result, MagicMock()])
    db.commit = AsyncMock()

    result = await attention_module.dismiss_attention(
        session_id="s1",
        attention_id="att-1",
        request=_attention_request(),
        response=Response(),
        db=db,
    )
    assert result["message"] == "Dismissed"
    emit.assert_awaited_once()
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_dismiss_all_attention_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """dismiss_all_attention updates all and broadcasts."""
    monkeypatch.setattr(attention_module.limiter, "enabled", False, raising=False)
    monkeypatch.setattr(
        attention_module,
        "verify_session_access",
        AsyncMock(return_value=MagicMock()),
    )
    emit = AsyncMock()
    monkeypatch.setattr(attention_module, "emit_to_session", emit)
    db = AsyncMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()

    result = await attention_module.dismiss_all_attention(
        session_id="s1",
        request=_attention_request(),
        response=Response(),
        db=db,
    )
    assert result["message"] == "All dismissed"
    emit.assert_awaited_once()
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_dismiss_agent_attention_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """dismiss_agent_attention updates items for agent and broadcasts."""
    monkeypatch.setattr(attention_module.limiter, "enabled", False, raising=False)
    monkeypatch.setattr(
        attention_module,
        "verify_session_access",
        AsyncMock(return_value=MagicMock()),
    )
    emit = AsyncMock()
    monkeypatch.setattr(attention_module, "emit_to_session", emit)
    db = AsyncMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()

    result = await attention_module.dismiss_agent_attention(
        session_id="s1",
        agent_id="agent-1",
        request=_attention_request(),
        response=Response(),
        db=db,
    )
    assert result["message"] == "Agent attention dismissed"
    emit.assert_awaited_once()
    db.commit.assert_awaited_once()
