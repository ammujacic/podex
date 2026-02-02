"""Unit tests for plans route helpers and Pydantic models."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response

from src.routes import plans as plans_module


def _make_session_mock(session_id: str, owner_id: str = "u1") -> MagicMock:
    s = MagicMock()
    s.id = session_id
    s.owner_id = owner_id
    return s


def _make_plan_mock(
    plan_id: str,
    session_id: str,
    title: str = "Plan",
    status: str = "pending_approval",
) -> MagicMock:
    p = MagicMock()
    p.id = plan_id
    p.session_id = session_id
    p.agent_id = None
    p.title = title
    p.description = None
    p.original_task = None
    p.steps = [{"id": "s1", "description": "Step 1", "action_type": "run", "action_params": {}, "status": "pending", "result": None, "error": None, "can_rollback": False}]
    p.current_step = 0
    p.status = status
    p.confidence_score = None
    p.error = None
    p.created_at = datetime.now(UTC)
    p.approved_at = None
    p.approved_by = None
    p.started_at = None
    p.completed_at = None
    return p


class TestPlansPydanticModels:
    """Pydantic model validation and helper."""

    def test_plan_list_params(self) -> None:
        """get_plan_list_params returns PlanListParams with defaults."""
        # Pass explicit defaults; when used as Depends(), FastAPI injects Query() defaults
        params = plans_module.get_plan_list_params(status=None, page=1, page_size=20)
        assert params.page == 1
        assert params.page_size == 20
        assert params.status is None

    def test_approval_request_optional_notes(self) -> None:
        """ApprovalRequest has optional notes."""
        req = plans_module.ApprovalRequest(notes="looks good")
        assert req.notes == "looks good"
        req2 = plans_module.ApprovalRequest()
        assert req2.notes is None

    def test_rejection_request_requires_reason(self) -> None:
        """RejectionRequest requires non-empty reason."""
        req = plans_module.RejectionRequest(reason="Not needed")
        assert req.reason == "Not needed"

    def test_plan_to_response_maps_plan(self) -> None:
        """_plan_to_response converts plan-like mock to PlanResponse."""
        plan = _make_plan_mock(str(uuid4()), str(uuid4()), title="My Plan", status="approved")
        plan.approved_at = datetime.now(UTC)
        plan.approved_by = "u1"
        resp = plans_module._plan_to_response(plan)
        assert resp.title == "My Plan"
        assert resp.status == "approved"
        assert len(resp.steps) == 1
        assert resp.steps[0].description == "Step 1"


def _plans_request(path: str = "/api/sessions/s1/plans") -> Request:
    return Request({"type": "http", "method": "GET", "path": path, "headers": []})


@pytest.mark.asyncio
async def test_list_plans_404_session(monkeypatch: pytest.MonkeyPatch) -> None:
    """list_plans raises 404 when session not found."""
    monkeypatch.setattr(plans_module.limiter, "enabled", False, raising=False)
    session_id = uuid4()
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)
    current_user = {"id": "u1"}
    params = plans_module.PlanListParams(status=None, page=1, page_size=20)

    with pytest.raises(HTTPException) as exc:
        await plans_module.list_plans(
            request=_plans_request(),
            response=Response(),
            session_id=session_id,
            db=db,
            current_user=current_user,
            params=params,
        )
    assert exc.value.status_code == 404
    assert "Session" in exc.value.detail


@pytest.mark.asyncio
async def test_list_plans_403_not_owner(monkeypatch: pytest.MonkeyPatch) -> None:
    """list_plans raises 403 when session owned by another user."""
    monkeypatch.setattr(plans_module.limiter, "enabled", False, raising=False)
    session_id = uuid4()
    session = _make_session_mock(str(session_id), owner_id="other")
    db = AsyncMock()
    db.get = AsyncMock(return_value=session)
    current_user = {"id": "u1"}
    params = plans_module.PlanListParams(status=None, page=1, page_size=20)

    with pytest.raises(HTTPException) as exc:
        await plans_module.list_plans(
            request=_plans_request(),
            response=Response(),
            session_id=session_id,
            db=db,
            current_user=current_user,
            params=params,
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_list_plans_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """list_plans returns PlanListResponse with plans and pagination."""
    monkeypatch.setattr(plans_module.limiter, "enabled", False, raising=False)
    session_id = uuid4()
    session = _make_session_mock(str(session_id), owner_id="u1")
    plan = _make_plan_mock(str(uuid4()), str(session_id))
    db = AsyncMock()
    db.get = AsyncMock(side_effect=[session])
    db.scalar = AsyncMock(return_value=1)
    execute_result = MagicMock()
    execute_result.scalars.return_value.all.return_value = [plan]
    db.execute = AsyncMock(return_value=execute_result)
    current_user = {"id": "u1"}
    params = plans_module.PlanListParams(status=None, page=1, page_size=20)

    result = await plans_module.list_plans(
        request=_plans_request(),
        response=Response(),
        session_id=session_id,
        db=db,
        current_user=current_user,
        params=params,
    )
    assert result.total == 1
    assert result.page == 1
    assert result.page_size == 20
    assert len(result.plans) == 1
    assert result.plans[0].title == "Plan"


@pytest.mark.asyncio
async def test_get_plan_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_plan raises 404 when plan not found."""
    monkeypatch.setattr(plans_module.limiter, "enabled", False, raising=False)
    session_id = uuid4()
    plan_id = uuid4()
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await plans_module.get_plan(
            request=_plans_request(),
            response=Response(),
            session_id=session_id,
            plan_id=plan_id,
            db=db,
            current_user={"id": "u1"},
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_get_plan_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_plan returns PlanResponse when plan found and user owns session."""
    monkeypatch.setattr(plans_module.limiter, "enabled", False, raising=False)
    session_id = uuid4()
    plan_id = uuid4()
    session_id_str = str(session_id)
    session = _make_session_mock(session_id_str, owner_id="u1")
    plan = _make_plan_mock(str(plan_id), session_id_str, title="My Plan")
    plan.session_id = session_id_str  # ensure exact match for str(plan.session_id) != str(session_id)
    db = AsyncMock()

    async def get_side_effect(model: type, pk: object) -> MagicMock | None:
        if pk == plan_id:
            return plan
        if pk == session_id:
            return session
        return None

    db.get = AsyncMock(side_effect=get_side_effect)

    result = await plans_module.get_plan(
        request=_plans_request(),
        response=Response(),
        session_id=session_id,
        plan_id=plan_id,
        db=db,
        current_user={"id": "u1"},
    )
    assert result.title == "My Plan"
    assert result.id == str(plan_id)


@pytest.mark.asyncio
async def test_list_pending_plans_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """list_pending_plans returns list of plans with status pending_approval."""
    monkeypatch.setattr(plans_module.limiter, "enabled", False, raising=False)
    session_id = uuid4()
    session = _make_session_mock(str(session_id), owner_id="u1")
    plan = _make_plan_mock(str(uuid4()), str(session_id), status="pending_approval")
    db = AsyncMock()
    db.get = AsyncMock(return_value=session)
    execute_result = MagicMock()
    execute_result.scalars.return_value.all.return_value = [plan]
    db.execute = AsyncMock(return_value=execute_result)

    result = await plans_module.list_pending_plans(
        request=_plans_request(),
        response=Response(),
        session_id=session_id,
        db=db,
        current_user={"id": "u1"},
        limit=100,
    )
    assert len(result) == 1
    assert result[0].status == "pending_approval"


def _db_get_side_effect(plan: MagicMock, session: MagicMock, plan_id: object, session_id: object):
    """Return a get_side_effect that returns plan for plan_id and session for session_id."""
    async def get_side_effect(model: type, pk: object) -> MagicMock | None:
        if pk == plan_id:
            return plan
        if pk == session_id:
            return session
        return None
    return get_side_effect


@pytest.mark.asyncio
async def test_list_plans_200_with_status_filter(monkeypatch: pytest.MonkeyPatch) -> None:
    """list_plans filters by params.status when set."""
    monkeypatch.setattr(plans_module.limiter, "enabled", False, raising=False)
    session_id = uuid4()
    session = _make_session_mock(str(session_id), owner_id="u1")
    plan = _make_plan_mock(str(uuid4()), str(session_id), status="approved")
    db = AsyncMock()
    db.get = AsyncMock(side_effect=[session])
    db.scalar = AsyncMock(return_value=1)
    execute_result = MagicMock()
    execute_result.scalars.return_value.all.return_value = [plan]
    db.execute = AsyncMock(return_value=execute_result)
    params = plans_module.PlanListParams(status="approved", page=1, page_size=20)

    result = await plans_module.list_plans(
        request=_plans_request(),
        response=Response(),
        session_id=session_id,
        db=db,
        current_user={"id": "u1"},
        params=params,
    )
    assert result.total == 1
    assert result.page == 1
    assert len(result.plans) == 1
    assert result.plans[0].status == "approved"


@pytest.mark.asyncio
async def test_list_pending_plans_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """list_pending_plans raises 404 when session not found."""
    monkeypatch.setattr(plans_module.limiter, "enabled", False, raising=False)
    session_id = uuid4()
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await plans_module.list_pending_plans(
            request=_plans_request(),
            response=Response(),
            session_id=session_id,
            db=db,
            current_user={"id": "u1"},
            limit=100,
        )
    assert exc.value.status_code == 404
    assert "Session" in exc.value.detail


@pytest.mark.asyncio
async def test_list_pending_plans_403(monkeypatch: pytest.MonkeyPatch) -> None:
    """list_pending_plans raises 403 when session owned by another user."""
    monkeypatch.setattr(plans_module.limiter, "enabled", False, raising=False)
    session_id = uuid4()
    session = _make_session_mock(str(session_id), owner_id="other")
    db = AsyncMock()
    db.get = AsyncMock(return_value=session)

    with pytest.raises(HTTPException) as exc:
        await plans_module.list_pending_plans(
            request=_plans_request(),
            response=Response(),
            session_id=session_id,
            db=db,
            current_user={"id": "u1"},
            limit=100,
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_get_plan_403_not_owner(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_plan raises 403 when session owned by another user."""
    monkeypatch.setattr(plans_module.limiter, "enabled", False, raising=False)
    session_id = uuid4()
    plan_id = uuid4()
    session_id_str = str(session_id)
    session = _make_session_mock(session_id_str, owner_id="other")
    plan = _make_plan_mock(str(plan_id), session_id_str)
    db = AsyncMock()
    db.get = AsyncMock(side_effect=_db_get_side_effect(plan, session, plan_id, session_id))

    with pytest.raises(HTTPException) as exc:
        await plans_module.get_plan(
            request=_plans_request(),
            response=Response(),
            session_id=session_id,
            plan_id=plan_id,
            db=db,
            current_user={"id": "u1"},
        )
    assert exc.value.status_code == 403
    assert "authorized" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_approve_plan_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """approve_plan raises 404 when plan not found."""
    monkeypatch.setattr(plans_module.limiter, "enabled", False, raising=False)
    session_id = uuid4()
    plan_id = uuid4()
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await plans_module.approve_plan(
            request=_plans_request(),
            response=Response(),
            session_id=session_id,
            plan_id=plan_id,
            db=db,
            current_user={"id": "u1"},
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_approve_plan_400_wrong_status(monkeypatch: pytest.MonkeyPatch) -> None:
    """approve_plan raises 400 when plan not pending_approval."""
    monkeypatch.setattr(plans_module.limiter, "enabled", False, raising=False)
    session_id = uuid4()
    plan_id = uuid4()
    session_id_str = str(session_id)
    session = _make_session_mock(session_id_str, owner_id="u1")
    plan = _make_plan_mock(str(plan_id), session_id_str, status="approved")
    db = AsyncMock()
    db.get = AsyncMock(side_effect=_db_get_side_effect(plan, session, plan_id, session_id))

    with pytest.raises(HTTPException) as exc:
        await plans_module.approve_plan(
            request=_plans_request(),
            response=Response(),
            session_id=session_id,
            plan_id=plan_id,
            db=db,
            current_user={"id": "u1"},
        )
    assert exc.value.status_code == 400
    assert "cannot be approved" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_approve_plan_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """approve_plan updates plan to approved and returns PlanResponse."""
    monkeypatch.setattr(plans_module.limiter, "enabled", False, raising=False)
    session_id = uuid4()
    plan_id = uuid4()
    session_id_str = str(session_id)
    session = _make_session_mock(session_id_str, owner_id="u1")
    plan = _make_plan_mock(str(plan_id), session_id_str, status="pending_approval")
    db = AsyncMock()
    db.get = AsyncMock(side_effect=_db_get_side_effect(plan, session, plan_id, session_id))
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    result = await plans_module.approve_plan(
        request=_plans_request(),
        response=Response(),
        session_id=session_id,
        plan_id=plan_id,
        db=db,
        current_user={"id": "u1"},
    )
    assert result.status == "approved"
    assert plan.status == "approved"
    assert plan.approved_by == "u1"
    db.commit.assert_awaited_once()
    db.refresh.assert_awaited_once()


@pytest.mark.asyncio
async def test_reject_plan_400_wrong_status(monkeypatch: pytest.MonkeyPatch) -> None:
    """reject_plan raises 400 when plan not pending_approval."""
    monkeypatch.setattr(plans_module.limiter, "enabled", False, raising=False)
    session_id = uuid4()
    plan_id = uuid4()
    session_id_str = str(session_id)
    session = _make_session_mock(session_id_str, owner_id="u1")
    plan = _make_plan_mock(str(plan_id), session_id_str, status="approved")
    db = AsyncMock()
    db.get = AsyncMock(side_effect=_db_get_side_effect(plan, session, plan_id, session_id))
    body = plans_module.RejectionRequest(reason="Not needed")

    with pytest.raises(HTTPException) as exc:
        await plans_module.reject_plan(
            request=_plans_request(),
            response=Response(),
            session_id=session_id,
            plan_id=plan_id,
            data=body,
            db=db,
            current_user={"id": "u1"},
        )
    assert exc.value.status_code == 400
    assert "cannot be rejected" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_reject_plan_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """reject_plan updates plan to rejected and returns PlanResponse."""
    monkeypatch.setattr(plans_module.limiter, "enabled", False, raising=False)
    session_id = uuid4()
    plan_id = uuid4()
    session_id_str = str(session_id)
    session = _make_session_mock(session_id_str, owner_id="u1")
    plan = _make_plan_mock(str(plan_id), session_id_str, status="pending_approval")
    db = AsyncMock()
    db.get = AsyncMock(side_effect=_db_get_side_effect(plan, session, plan_id, session_id))
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    body = plans_module.RejectionRequest(reason="Not needed")

    result = await plans_module.reject_plan(
        request=_plans_request(),
        response=Response(),
        session_id=session_id,
        plan_id=plan_id,
        data=body,
        db=db,
        current_user={"id": "u1"},
    )
    assert result.status == "rejected"
    assert plan.status == "rejected"
    assert "Not needed" in (plan.error or "")
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_cancel_plan_400_wrong_status(monkeypatch: pytest.MonkeyPatch) -> None:
    """cancel_plan raises 400 when plan not in approved/executing/paused."""
    monkeypatch.setattr(plans_module.limiter, "enabled", False, raising=False)
    session_id = uuid4()
    plan_id = uuid4()
    session_id_str = str(session_id)
    session = _make_session_mock(session_id_str, owner_id="u1")
    plan = _make_plan_mock(str(plan_id), session_id_str, status="pending_approval")
    db = AsyncMock()
    db.get = AsyncMock(side_effect=_db_get_side_effect(plan, session, plan_id, session_id))

    with pytest.raises(HTTPException) as exc:
        await plans_module.cancel_plan(
            request=_plans_request(),
            response=Response(),
            session_id=session_id,
            plan_id=plan_id,
            db=db,
            current_user={"id": "u1"},
        )
    assert exc.value.status_code == 400
    assert "cannot be cancelled" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_cancel_plan_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """cancel_plan updates plan to cancelled and returns PlanResponse."""
    monkeypatch.setattr(plans_module.limiter, "enabled", False, raising=False)
    session_id = uuid4()
    plan_id = uuid4()
    session_id_str = str(session_id)
    session = _make_session_mock(session_id_str, owner_id="u1")
    plan = _make_plan_mock(str(plan_id), session_id_str, status="executing")
    db = AsyncMock()
    db.get = AsyncMock(side_effect=_db_get_side_effect(plan, session, plan_id, session_id))
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    result = await plans_module.cancel_plan(
        request=_plans_request(),
        response=Response(),
        session_id=session_id,
        plan_id=plan_id,
        db=db,
        current_user={"id": "u1"},
    )
    assert result.status == "cancelled"
    assert plan.status == "cancelled"
    assert "Cancelled" in (plan.error or "")
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_pause_plan_400_wrong_status(monkeypatch: pytest.MonkeyPatch) -> None:
    """pause_plan raises 400 when plan not executing."""
    monkeypatch.setattr(plans_module.limiter, "enabled", False, raising=False)
    session_id = uuid4()
    plan_id = uuid4()
    session_id_str = str(session_id)
    session = _make_session_mock(session_id_str, owner_id="u1")
    plan = _make_plan_mock(str(plan_id), session_id_str, status="approved")
    db = AsyncMock()
    db.get = AsyncMock(side_effect=_db_get_side_effect(plan, session, plan_id, session_id))

    with pytest.raises(HTTPException) as exc:
        await plans_module.pause_plan(
            request=_plans_request(),
            response=Response(),
            session_id=session_id,
            plan_id=plan_id,
            db=db,
            current_user={"id": "u1"},
        )
    assert exc.value.status_code == 400
    assert "Only executing" in exc.value.detail or "can be paused" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_pause_plan_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """pause_plan updates plan to paused and returns PlanResponse."""
    monkeypatch.setattr(plans_module.limiter, "enabled", False, raising=False)
    session_id = uuid4()
    plan_id = uuid4()
    session_id_str = str(session_id)
    session = _make_session_mock(session_id_str, owner_id="u1")
    plan = _make_plan_mock(str(plan_id), session_id_str, status="executing")
    db = AsyncMock()
    db.get = AsyncMock(side_effect=_db_get_side_effect(plan, session, plan_id, session_id))
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    result = await plans_module.pause_plan(
        request=_plans_request(),
        response=Response(),
        session_id=session_id,
        plan_id=plan_id,
        db=db,
        current_user={"id": "u1"},
    )
    assert result.status == "paused"
    assert plan.status == "paused"
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_resume_plan_400_wrong_status(monkeypatch: pytest.MonkeyPatch) -> None:
    """resume_plan raises 400 when plan not paused."""
    monkeypatch.setattr(plans_module.limiter, "enabled", False, raising=False)
    session_id = uuid4()
    plan_id = uuid4()
    session_id_str = str(session_id)
    session = _make_session_mock(session_id_str, owner_id="u1")
    plan = _make_plan_mock(str(plan_id), session_id_str, status="executing")
    db = AsyncMock()
    db.get = AsyncMock(side_effect=_db_get_side_effect(plan, session, plan_id, session_id))

    with pytest.raises(HTTPException) as exc:
        await plans_module.resume_plan(
            request=_plans_request(),
            response=Response(),
            session_id=session_id,
            plan_id=plan_id,
            db=db,
            current_user={"id": "u1"},
        )
    assert exc.value.status_code == 400
    assert "Only paused" in exc.value.detail or "can be resumed" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_resume_plan_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """resume_plan updates plan to executing and returns PlanResponse."""
    monkeypatch.setattr(plans_module.limiter, "enabled", False, raising=False)
    session_id = uuid4()
    plan_id = uuid4()
    session_id_str = str(session_id)
    session = _make_session_mock(session_id_str, owner_id="u1")
    plan = _make_plan_mock(str(plan_id), session_id_str, status="paused")
    db = AsyncMock()
    db.get = AsyncMock(side_effect=_db_get_side_effect(plan, session, plan_id, session_id))
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    result = await plans_module.resume_plan(
        request=_plans_request(),
        response=Response(),
        session_id=session_id,
        plan_id=plan_id,
        db=db,
        current_user={"id": "u1"},
    )
    assert result.status == "executing"
    assert plan.status == "executing"
    db.commit.assert_awaited_once()
