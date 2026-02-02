"""Unit tests for health_checks route helpers and Pydantic models."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response

from src.routes import health_checks as health_checks_module


def _make_check_mock(
    check_id: str = "chk-1",
    category: str = "code_quality",
    name: str = "Lint",
    is_builtin: bool = False,
    user_id: str | None = "user-1",
) -> MagicMock:
    """Build a HealthCheck-like mock for response validation."""
    check = MagicMock()
    check.id = check_id
    check.category = category
    check.name = name
    check.description = "Runs linter"
    check.command = "npm run lint"
    check.working_directory = None
    check.timeout = 60
    check.parse_mode = "exit_code"
    check.parse_config = {"success_exit_codes": [0]}
    check.weight = 1.0
    check.enabled = True
    check.is_builtin = is_builtin
    check.project_types = None
    check.fix_command = None
    check.user_id = user_id
    check.session_id = None
    return check


class TestHealthCheckPydanticModels:
    """Pydantic model validation and defaults."""

    def test_health_check_create_defaults_and_validation(self) -> None:
        """HealthCheckCreate has expected defaults and accepts valid payload."""
        body = health_checks_module.HealthCheckCreate(
            category="code_quality",
            name="My Check",
            command="echo ok",
            parse_mode="exit_code",
            parse_config={"success_exit_codes": [0]},
        )
        assert body.timeout == 60
        assert body.weight == 1.0
        assert body.description is None
        assert body.session_id is None
        assert body.project_types is None
        assert body.fix_command is None

    def test_health_check_update_optional_fields(self) -> None:
        """HealthCheckUpdate allows partial updates."""
        body = health_checks_module.HealthCheckUpdate(name="New Name", enabled=False)
        dumped = body.model_dump(exclude_unset=True)
        assert dumped == {"name": "New Name", "enabled": False}

    def test_health_check_response_from_attributes(self) -> None:
        """HealthCheckResponse.model_validate builds from check-like object."""
        check = _make_check_mock(check_id="chk-1", name="Lint", is_builtin=True)
        resp = health_checks_module.HealthCheckResponse.model_validate(check)
        assert resp.id == "chk-1"
        assert resp.name == "Lint"
        assert resp.is_builtin is True
        assert resp.category == "code_quality"

    def test_health_check_test_request_response(self) -> None:
        """HealthCheckTestRequest and HealthCheckTestResponse serialize correctly."""
        req = health_checks_module.HealthCheckTestRequest(session_id="sess-1")
        assert req.session_id == "sess-1"

        resp = health_checks_module.HealthCheckTestResponse(
            success=True,
            score=1.0,
            details={},
            raw_output="ok",
            execution_time_ms=100.0,
        )
        assert resp.success is True
        assert resp.error is None
        assert resp.model_dump()["execution_time_ms"] == 100.0


@pytest.mark.asyncio
async def test_list_health_checks_returns_mapped_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """list_health_checks returns HealthCheckResponse list for user + built-in."""
    monkeypatch.setattr(health_checks_module.limiter, "enabled", False, raising=False)
    check = _make_check_mock(check_id="chk-1", name="Lint", is_builtin=False, user_id="u1")
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalars.return_value.all.return_value = [check]
    db.execute.return_value = execute_result
    current_user = {"user_id": "u1"}

    result = await health_checks_module.list_health_checks(
        request=Request({"type": "http", "method": "GET", "path": "/health/checks", "headers": []}),
        response=Response(),
        category=None,
        include_builtin=True,
        session_id=None,
        current_user=current_user,
        db=db,
    )
    assert len(result) == 1
    assert result[0].id == "chk-1"
    assert result[0].name == "Lint"


@pytest.mark.asyncio
async def test_list_health_checks_with_category_and_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """list_health_checks applies category and session_id filters."""
    monkeypatch.setattr(health_checks_module.limiter, "enabled", False, raising=False)
    check = _make_check_mock(
        check_id="chk-2",
        category="security",
        name="Security",
        is_builtin=False,
        user_id="u1",
    )
    check.session_id = "sess-1"
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalars.return_value.all.return_value = [check]
    db.execute.return_value = execute_result
    current_user = {"user_id": "u1"}

    result = await health_checks_module.list_health_checks(
        request=Request({"type": "http", "method": "GET", "path": "/health/checks", "headers": []}),
        response=Response(),
        category="security",
        include_builtin=True,
        session_id="sess-1",
        current_user=current_user,
        db=db,
    )
    assert len(result) == 1
    assert result[0].category == "security"


@pytest.mark.asyncio
async def test_list_default_checks_returns_mapped_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """list_default_checks returns HealthCheckResponse list from built-in checks."""
    monkeypatch.setattr(health_checks_module.limiter, "enabled", False, raising=False)
    check = _make_check_mock(check_id="default-1", name="Default", is_builtin=True, user_id=None)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalars.return_value.all.return_value = [check]
    db.execute.return_value = execute_result

    result = await health_checks_module.list_default_checks(
        request=Request({"type": "http", "method": "GET", "path": "/health/checks/defaults", "headers": []}),
        response=Response(),
        category=None,
        db=db,
    )
    assert len(result) == 1
    assert result[0].id == "default-1"
    assert result[0].is_builtin is True


@pytest.mark.asyncio
async def test_list_default_checks_with_category(monkeypatch: pytest.MonkeyPatch) -> None:
    """list_default_checks filters by category when provided."""
    monkeypatch.setattr(health_checks_module.limiter, "enabled", False, raising=False)
    check = _make_check_mock(category="security", name="Security", is_builtin=True, user_id=None)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalars.return_value.all.return_value = [check]
    db.execute.return_value = execute_result

    result = await health_checks_module.list_default_checks(
        request=Request({"type": "http", "method": "GET", "path": "/health/checks/defaults", "headers": []}),
        response=Response(),
        category="security",
        db=db,
    )
    assert len(result) == 1
    assert result[0].category == "security"


@pytest.mark.asyncio
async def test_get_health_check_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_health_check raises 404 when check_id not found."""
    monkeypatch.setattr(health_checks_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute.return_value = execute_result
    current_user = {"user_id": "u1"}

    with pytest.raises(HTTPException) as exc:
        await health_checks_module.get_health_check(
            check_id="nonexistent",
            request=Request({"type": "http", "method": "GET", "path": "/health/checks/nonexistent", "headers": []}),
            response=Response(),
            current_user=current_user,
            db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_get_health_check_403_when_not_owner(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_health_check raises 403 when check is custom and not owned by user."""
    monkeypatch.setattr(health_checks_module.limiter, "enabled", False, raising=False)
    check = _make_check_mock(user_id="other-user", is_builtin=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = check
    db.execute.return_value = execute_result
    current_user = {"user_id": "u1"}

    with pytest.raises(HTTPException) as exc:
        await health_checks_module.get_health_check(
            check_id=check.id,
            request=Request({"type": "http", "method": "GET", "path": f"/health/checks/{check.id}", "headers": []}),
            response=Response(),
            current_user=current_user,
            db=db,
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_get_health_check_200_builtin(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_health_check returns HealthCheckResponse for built-in check."""
    monkeypatch.setattr(health_checks_module.limiter, "enabled", False, raising=False)
    check = _make_check_mock(is_builtin=True, user_id=None)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = check
    db.execute.return_value = execute_result
    current_user = {"user_id": "u1"}

    result = await health_checks_module.get_health_check(
        check_id=check.id,
        request=Request({"type": "http", "method": "GET", "path": f"/health/checks/{check.id}", "headers": []}),
        response=Response(),
        current_user=current_user,
        db=db,
    )
    assert result.id == check.id
    assert result.is_builtin is True


@pytest.mark.asyncio
async def test_create_health_check_400_invalid_category(monkeypatch: pytest.MonkeyPatch) -> None:
    """create_health_check raises 400 for invalid category."""
    monkeypatch.setattr(health_checks_module.limiter, "enabled", False, raising=False)
    body = health_checks_module.HealthCheckCreate(
        category="invalid_cat",
        name="Check",
        command="echo ok",
        parse_mode="exit_code",
        parse_config={},
    )
    current_user = {"user_id": "u1"}
    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await health_checks_module.create_health_check(
            request=Request({"type": "http", "method": "POST", "path": "/health/checks", "headers": []}),
            response=Response(),
            body=body,
            current_user=current_user,
            db=db,
        )
    assert exc.value.status_code == 400
    assert "category" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_create_health_check_400_invalid_parse_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    """create_health_check raises 400 for invalid parse_mode."""
    monkeypatch.setattr(health_checks_module.limiter, "enabled", False, raising=False)
    body = health_checks_module.HealthCheckCreate(
        category="code_quality",
        name="Check",
        command="echo ok",
        parse_mode="invalid_mode",
        parse_config={},
    )
    current_user = {"user_id": "u1"}
    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await health_checks_module.create_health_check(
            request=Request({"type": "http", "method": "POST", "path": "/health/checks", "headers": []}),
            response=Response(),
            body=body,
            current_user=current_user,
            db=db,
        )
    assert exc.value.status_code == 400
    assert "parse_mode" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_create_health_check_403_session_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    """create_health_check raises 403 when session_id given but session not found or not owned."""
    monkeypatch.setattr(health_checks_module.limiter, "enabled", False, raising=False)
    body = health_checks_module.HealthCheckCreate(
        category="code_quality",
        name="Check",
        command="echo ok",
        parse_mode="exit_code",
        parse_config={"success_exit_codes": [0]},
        session_id="sess-unknown",
    )
    current_user = {"user_id": "u1"}
    db = AsyncMock()
    session_result = MagicMock()
    session_result.scalar_one_or_none.return_value = None
    db.execute.return_value = session_result

    with pytest.raises(HTTPException) as exc:
        await health_checks_module.create_health_check(
            request=Request({"type": "http", "method": "POST", "path": "/health/checks", "headers": []}),
            response=Response(),
            body=body,
            current_user=current_user,
            db=db,
        )
    assert exc.value.status_code == 403
    assert "Session" in exc.value.detail or "session" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_delete_health_check_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """delete_health_check raises 404 when check not found."""
    monkeypatch.setattr(health_checks_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute.return_value = execute_result
    current_user = {"user_id": "u1"}

    with pytest.raises(HTTPException) as exc:
        await health_checks_module.delete_health_check(
            check_id="nonexistent",
            request=Request({"type": "http", "method": "DELETE", "path": "/health/checks/nonexistent", "headers": []}),
            response=Response(),
            current_user=current_user,
            db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_health_check_400_builtin(monkeypatch: pytest.MonkeyPatch) -> None:
    """delete_health_check raises 400 when trying to delete built-in check."""
    monkeypatch.setattr(health_checks_module.limiter, "enabled", False, raising=False)
    check = _make_check_mock(is_builtin=True, user_id=None)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = check
    db.execute.return_value = execute_result
    current_user = {"user_id": "u1"}

    with pytest.raises(HTTPException) as exc:
        await health_checks_module.delete_health_check(
            check_id=check.id,
            request=Request({"type": "http", "method": "DELETE", "path": f"/health/checks/{check.id}", "headers": []}),
            response=Response(),
            current_user=current_user,
            db=db,
        )
    assert exc.value.status_code == 400
    assert "built-in" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_delete_health_check_403_when_not_owner(monkeypatch: pytest.MonkeyPatch) -> None:
    """delete_health_check raises 403 when check belongs to another user."""
    monkeypatch.setattr(health_checks_module.limiter, "enabled", False, raising=False)
    check = _make_check_mock(is_builtin=False, user_id="other-user")
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = check
    db.execute.return_value = execute_result
    current_user = {"user_id": "u1"}

    with pytest.raises(HTTPException) as exc:
        await health_checks_module.delete_health_check(
            check_id=check.id,
            request=Request({"type": "http", "method": "DELETE", "path": f"/health/checks/{check.id}", "headers": []}),
            response=Response(),
            current_user=current_user,
            db=db,
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_delete_health_check_204(monkeypatch: pytest.MonkeyPatch) -> None:
    """delete_health_check returns 204 and deletes when user owns custom check."""
    monkeypatch.setattr(health_checks_module.limiter, "enabled", False, raising=False)
    check = _make_check_mock(is_builtin=False, user_id="u1")
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = check
    db.execute.return_value = execute_result
    current_user = {"user_id": "u1"}

    result = await health_checks_module.delete_health_check(
        check_id=check.id,
        request=Request({"type": "http", "method": "DELETE", "path": f"/health/checks/{check.id}", "headers": []}),
        response=Response(),
        current_user=current_user,
        db=db,
    )
    assert result is None
    db.delete.assert_called_once_with(check)
    db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_update_health_check_200_custom_check(monkeypatch: pytest.MonkeyPatch) -> None:
    """update_health_check applies fields and returns response for custom check."""
    monkeypatch.setattr(health_checks_module.limiter, "enabled", False, raising=False)
    check = _make_check_mock(is_builtin=False, user_id="u1", name="Old Name")
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = check
    db.execute.return_value = execute_result
    current_user = {"user_id": "u1"}
    body = health_checks_module.HealthCheckUpdate(name="New Name", description="Updated")

    result = await health_checks_module.update_health_check(
        check_id=check.id,
        request=Request({"type": "http", "method": "PUT", "path": f"/health/checks/{check.id}", "headers": []}),
        response=Response(),
        body=body,
        current_user=current_user,
        db=db,
    )
    assert result.id == check.id
    assert check.name == "New Name"
    assert check.description == "Updated"
    db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_update_health_check_200_builtin_no_enabled_change(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """update_health_check returns check unchanged when built-in and enabled not in body."""
    monkeypatch.setattr(health_checks_module.limiter, "enabled", False, raising=False)
    check = _make_check_mock(is_builtin=True, user_id=None, name="Built-in Lint")
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = check
    db.execute.return_value = execute_result
    current_user = {"user_id": "u1"}
    body = health_checks_module.HealthCheckUpdate(name="Ignored")  # enabled not set

    result = await health_checks_module.update_health_check(
        check_id=check.id,
        request=Request({"type": "http", "method": "PUT", "path": f"/health/checks/{check.id}", "headers": []}),
        response=Response(),
        body=body,
        current_user=current_user,
        db=db,
    )
    assert result.id == check.id
    assert result.is_builtin is True
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_update_health_check_400_builtin_modification(monkeypatch: pytest.MonkeyPatch) -> None:
    """update_health_check raises 400 when enabling built-in (built-in cannot be modified)."""
    monkeypatch.setattr(health_checks_module.limiter, "enabled", False, raising=False)
    check = _make_check_mock(is_builtin=True, user_id=None)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = check
    db.execute.return_value = execute_result
    current_user = {"user_id": "u1"}
    body = health_checks_module.HealthCheckUpdate(enabled=False)

    with pytest.raises(HTTPException) as exc:
        await health_checks_module.update_health_check(
            check_id=check.id,
            request=Request({"type": "http", "method": "PUT", "path": f"/health/checks/{check.id}", "headers": []}),
            response=Response(),
            body=body,
            current_user=current_user,
            db=db,
        )
    assert exc.value.status_code == 400
    assert "built-in" in exc.value.detail.lower()
