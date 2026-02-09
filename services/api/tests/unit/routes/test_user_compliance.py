"""Unit tests for user_compliance route helpers and Pydantic models."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from starlette.requests import Request
from starlette.responses import Response

from src.routes import user_compliance as uc_module


class TestUserCompliancePydanticModels:
    """Pydantic model validation and defaults."""

    def test_data_export_request_create_defaults(self) -> None:
        """DataExportRequestCreate has expected defaults."""
        body = uc_module.DataExportRequestCreate()
        assert body.request_type == "export_data"
        assert "profile" in body.data_categories
        assert "sessions" in body.data_categories

    def test_data_export_request_create_valid_type(self) -> None:
        """DataExportRequestCreate accepts export_data and data_portability."""
        body = uc_module.DataExportRequestCreate(
            request_type="data_portability",
            data_categories=["profile"],
        )
        assert body.request_type == "data_portability"
        assert body.data_categories == ["profile"]

    def test_data_export_request_create_invalid_type(self) -> None:
        """DataExportRequestCreate rejects invalid request_type."""
        with pytest.raises(ValidationError):
            uc_module.DataExportRequestCreate(
                request_type="invalid",
                data_categories=["profile"],
            )

    def test_data_export_request_response(self) -> None:
        """DataExportRequestResponse holds id, request_type, status, dates."""
        resp = uc_module.DataExportRequestResponse(
            id="req-1",
            request_type="export_data",
            data_categories=["profile"],
            status="pending",
            created_at=datetime.now(UTC),
            completed_at=None,
            download_expires_at=None,
        )
        assert resp.id == "req-1"
        assert resp.status == "pending"


def _request(path: str = "/compliance/data-export", user_id: str | None = "u1") -> Request:
    req = Request({"type": "http", "method": "POST", "path": path, "headers": []})
    if user_id is not None:
        req.state.user_id = user_id
    return req


@pytest.mark.asyncio
async def test_get_current_user_id_401() -> None:
    """get_current_user_id raises 401 when request has no user_id."""
    req = Request({"type": "http", "method": "GET", "path": "/", "headers": []})
    if hasattr(req.state, "user_id"):
        delattr(req.state, "user_id")

    with pytest.raises(HTTPException) as exc:
        await uc_module.get_current_user_id(req)
    assert exc.value.status_code == 401
    assert "authenticated" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_request_data_export_400_invalid_categories() -> None:
    """request_data_export raises 400 for invalid data_categories."""
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=execute_result)
    body = uc_module.DataExportRequestCreate(
        request_type="export_data",
        data_categories=["profile", "invalid_category"],
    )

    with pytest.raises(HTTPException) as exc:
        await uc_module.request_data_export(
            data=body,
            request=_request(),
            db=db,
            user_id="u1",
        )
    assert exc.value.status_code == 400
    assert "Invalid data categories" in exc.value.detail


@pytest.mark.asyncio
async def test_request_data_export_409_pending_exists() -> None:
    """request_data_export raises 409 when user has pending/processing request."""
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = MagicMock()  # existing request
    db.execute = AsyncMock(return_value=execute_result)
    body = uc_module.DataExportRequestCreate(
        request_type="export_data",
        data_categories=["profile"],
    )

    with pytest.raises(HTTPException) as exc:
        await uc_module.request_data_export(
            data=body,
            request=_request(),
            db=db,
            user_id="u1",
        )
    assert exc.value.status_code == 409
    assert "pending" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_request_data_export_201() -> None:
    """request_data_export creates export request and returns 201."""
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=execute_result)
    db.add = MagicMock()
    db.commit = AsyncMock()
    async def refresh_export(instance: object) -> None:
        setattr(instance, "created_at", datetime.now(UTC))
        setattr(instance, "completed_at", None)
        setattr(instance, "download_expires_at", None)
    db.refresh = AsyncMock(side_effect=refresh_export)
    body = uc_module.DataExportRequestCreate(
        request_type="export_data",
        data_categories=["profile", "sessions"],
    )

    result = await uc_module.request_data_export(
        data=body,
        request=_request(),
        db=db,
        user_id="u1",
    )
    assert result.request_type == "export_data"
    assert result.data_categories == ["profile", "sessions"]
    assert result.status == "pending"
    db.add.assert_called_once()
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_list_my_data_exports_200() -> None:
    """list_my_data_exports returns list of DataExportRequestResponse."""
    db = AsyncMock()
    r = MagicMock()
    r.id = "req-1"
    r.request_type = "export_data"
    r.data_categories = ["profile"]
    r.status = "completed"
    r.created_at = datetime.now(UTC)
    r.completed_at = None
    r.download_expires_at = None
    execute_result = MagicMock()
    execute_result.scalars.return_value.all.return_value = [r]
    db.execute = AsyncMock(return_value=execute_result)

    result = await uc_module.list_my_data_exports(
        request=_request(path="/compliance/data-export"),
        db=db,
        user_id="u1",
    )
    assert len(result) == 1
    assert result[0].id == "req-1"
    assert result[0].status == "completed"


@pytest.mark.asyncio
async def test_get_my_data_export_404() -> None:
    """get_my_data_export raises 404 when request not found."""
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=execute_result)

    with pytest.raises(HTTPException) as exc:
        await uc_module.get_my_data_export(
            request_id="nonexistent",
            request=_request(),
            db=db,
            user_id="u1",
        )
    assert exc.value.status_code == 404
    assert "not found" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_get_my_data_export_200() -> None:
    """get_my_data_export returns DataExportRequestResponse when found."""
    db = AsyncMock()
    r = MagicMock()
    r.id = "req-1"
    r.request_type = "export_data"
    r.data_categories = ["profile"]
    r.status = "pending"
    r.created_at = datetime.now(UTC)
    r.completed_at = None
    r.download_expires_at = None
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = r
    db.execute = AsyncMock(return_value=execute_result)

    result = await uc_module.get_my_data_export(
        request_id="req-1",
        request=_request(),
        db=db,
        user_id="u1",
    )
    assert result.id == "req-1"
    assert result.status == "pending"
