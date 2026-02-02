"""Unit tests for MFA route helpers and Pydantic models."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response

from src.routes import mfa as mfa_module


class TestMFAPydanticModels:
    """Pydantic model validation and defaults."""

    def test_mfa_verify_request_validation(self) -> None:
        """MFAVerifyRequest enforces code length."""
        req = mfa_module.MFAVerifyRequest(code="123456")
        assert req.code == "123456"
        dumped = req.model_dump()
        assert "code" in dumped

    def test_mfa_disable_request_validation(self) -> None:
        """MFADisableRequest requires code and password."""
        req = mfa_module.MFADisableRequest(code="123456", password="secret")
        assert req.code == "123456"
        assert req.password == "secret"

    def test_mfa_status_response(self) -> None:
        """MFAStatusResponse holds enabled and backup_codes_remaining."""
        resp = mfa_module.MFAStatusResponse(enabled=False, backup_codes_remaining=0)
        assert resp.enabled is False
        assert resp.backup_codes_remaining == 0

    def test_mfa_setup_response(self) -> None:
        """MFASetupResponse holds secret, qr_code_base64, provisioning_uri, backup_codes."""
        resp = mfa_module.MFASetupResponse(
            secret="SECRET",
            qr_code_base64="data:image/png;base64,...",
            provisioning_uri="otpauth://...",
            backup_codes=["a", "b"],
        )
        assert resp.secret == "SECRET"
        assert len(resp.backup_codes) == 2

    def test_mfa_backup_codes_response(self) -> None:
        """MFABackupCodesResponse holds backup_codes list."""
        resp = mfa_module.MFABackupCodesResponse(backup_codes=["x", "y", "z"])
        assert len(resp.backup_codes) == 3


def _make_user_mock(
    user_id: str = "u1",
    mfa_enabled: bool = False,
    mfa_secret: str | None = None,
    mfa_backup_codes: list[str] | None = None,
    email: str = "u@example.com",
    password_hash: str | None = "hash",
    oauth_provider: str | None = None,
) -> MagicMock:
    user = MagicMock()
    user.id = user_id
    user.mfa_enabled = mfa_enabled
    user.mfa_secret = mfa_secret
    user.mfa_backup_codes = mfa_backup_codes or []
    user.email = email
    user.password_hash = password_hash
    user.oauth_provider = oauth_provider
    return user


def _mfa_request(path: str = "/mfa/status") -> Request:
    return Request({"type": "http", "method": "GET", "path": path, "headers": []})


@pytest.mark.asyncio
async def test_get_mfa_status_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_mfa_status raises 404 when user not found."""
    monkeypatch.setattr(mfa_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=execute_result)

    with pytest.raises(HTTPException) as exc:
        await mfa_module.get_mfa_status(
            request=_mfa_request("/mfa/status"),
            response=Response(),
            db=db,
            user_id="nonexistent",
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_get_mfa_status_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_mfa_status returns MFAStatusResponse when user found."""
    monkeypatch.setattr(mfa_module.limiter, "enabled", False, raising=False)
    user = _make_user_mock(mfa_enabled=True, mfa_backup_codes=["a", "b"])
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=execute_result)

    result = await mfa_module.get_mfa_status(
        request=_mfa_request("/mfa/status"),
        response=Response(),
        db=db,
        user_id=user.id,
    )
    assert result.enabled is True
    assert result.backup_codes_remaining == 2


@pytest.mark.asyncio
async def test_setup_mfa_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """setup_mfa raises 404 when user not found."""
    monkeypatch.setattr(mfa_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=execute_result)

    with pytest.raises(HTTPException) as exc:
        await mfa_module.setup_mfa(
            request=_mfa_request("/mfa/setup"),
            response=Response(),
            db=db,
            user_id="nonexistent",
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_setup_mfa_400_already_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    """setup_mfa raises 400 when MFA already enabled."""
    monkeypatch.setattr(mfa_module.limiter, "enabled", False, raising=False)
    user = _make_user_mock(mfa_enabled=True)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=execute_result)

    with pytest.raises(HTTPException) as exc:
        await mfa_module.setup_mfa(
            request=_mfa_request("/mfa/setup"),
            response=Response(),
            db=db,
            user_id=user.id,
        )
    assert exc.value.status_code == 400
    assert "already enabled" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_verify_mfa_setup_400_no_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    """verify_mfa_setup raises 400 when user has no mfa_secret."""
    monkeypatch.setattr(mfa_module.limiter, "enabled", False, raising=False)
    user = _make_user_mock(mfa_enabled=False, mfa_secret=None)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=execute_result)
    body = mfa_module.MFAVerifyRequest(code="123456")

    with pytest.raises(HTTPException) as exc:
        await mfa_module.verify_mfa_setup(
            request=_mfa_request("/mfa/verify-setup"),
            response=Response(),
            body=body,
            db=db,
            user_id=user.id,
        )
    assert exc.value.status_code == 400
    assert "setup not initiated" in exc.value.detail.lower() or "setup first" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_disable_mfa_400_not_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    """disable_mfa raises 400 when MFA is not enabled."""
    monkeypatch.setattr(mfa_module.limiter, "enabled", False, raising=False)
    user = _make_user_mock(mfa_enabled=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=execute_result)
    body = mfa_module.MFADisableRequest(code="123456", password="pass")

    with pytest.raises(HTTPException) as exc:
        await mfa_module.disable_mfa(
            request=_mfa_request("/mfa/disable"),
            response=Response(),
            body=body,
            db=db,
            user_id=user.id,
        )
    assert exc.value.status_code == 400
    assert "not enabled" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_regenerate_backup_codes_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """regenerate_backup_codes raises 404 when user not found."""
    monkeypatch.setattr(mfa_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=execute_result)
    body = mfa_module.MFAVerifyRequest(code="123456")

    with pytest.raises(HTTPException) as exc:
        await mfa_module.regenerate_backup_codes(
            request=_mfa_request("/mfa/regenerate-backup-codes"),
            response=Response(),
            body=body,
            db=db,
            user_id="nonexistent",
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_regenerate_backup_codes_400_not_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    """regenerate_backup_codes raises 400 when MFA not enabled."""
    monkeypatch.setattr(mfa_module.limiter, "enabled", False, raising=False)
    user = _make_user_mock(mfa_enabled=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=execute_result)
    body = mfa_module.MFAVerifyRequest(code="123456")

    with pytest.raises(HTTPException) as exc:
        await mfa_module.regenerate_backup_codes(
            request=_mfa_request("/mfa/regenerate-backup-codes"),
            response=Response(),
            body=body,
            db=db,
            user_id=user.id,
        )
    assert exc.value.status_code == 400
    assert "not enabled" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_setup_mfa_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """setup_mfa returns MFASetupResponse when user found and MFA not enabled."""
    monkeypatch.setattr(mfa_module.limiter, "enabled", False, raising=False)
    user = _make_user_mock(mfa_enabled=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=execute_result)
    db.commit = AsyncMock()

    setup_result = MagicMock()
    setup_result.secret = "SECRET"
    setup_result.qr_code_base64 = "data:image/png;base64,xxx"
    setup_result.provisioning_uri = "otpauth://..."
    setup_result.backup_codes = ["code1", "code2"]
    mfa_service = MagicMock()
    mfa_service.setup_mfa.return_value = setup_result
    mfa_service.hash_backup_codes.return_value = ["hashed1", "hashed2"]
    monkeypatch.setattr(mfa_module, "get_mfa_service", lambda: mfa_service)

    result = await mfa_module.setup_mfa(
        request=_mfa_request("/mfa/setup"),
        response=Response(),
        db=db,
        user_id=user.id,
    )
    assert result.secret == "SECRET"
    assert result.qr_code_base64 == "data:image/png;base64,xxx"
    assert result.backup_codes == ["code1", "code2"]
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_verify_mfa_setup_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """verify_mfa_setup enables MFA and returns success when code valid."""
    monkeypatch.setattr(mfa_module.limiter, "enabled", False, raising=False)
    user = _make_user_mock(mfa_enabled=False, mfa_secret="secret")
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=execute_result)
    db.commit = AsyncMock()

    mfa_service = MagicMock()
    mfa_service.verify_totp.return_value = True
    monkeypatch.setattr(mfa_module, "get_mfa_service", lambda: mfa_service)
    audit = MagicMock()
    audit.log_auth = AsyncMock()
    monkeypatch.setattr(mfa_module.AuditLogger, "set_context", lambda self, **kw: audit)

    body = mfa_module.MFAVerifyRequest(code="123456")
    result = await mfa_module.verify_mfa_setup(
        request=_mfa_request("/mfa/verify-setup"),
        response=Response(),
        body=body,
        db=db,
        user_id=user.id,
    )
    assert result["message"] == "MFA has been enabled successfully"
    assert user.mfa_enabled is True
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_verify_mfa_setup_400_invalid_code(monkeypatch: pytest.MonkeyPatch) -> None:
    """verify_mfa_setup raises 400 when TOTP code invalid."""
    monkeypatch.setattr(mfa_module.limiter, "enabled", False, raising=False)
    user = _make_user_mock(mfa_enabled=False, mfa_secret="secret")
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=execute_result)

    mfa_service = MagicMock()
    mfa_service.verify_totp.return_value = False
    monkeypatch.setattr(mfa_module, "get_mfa_service", lambda: mfa_service)
    body = mfa_module.MFAVerifyRequest(code="000000")

    with pytest.raises(HTTPException) as exc:
        await mfa_module.verify_mfa_setup(
            request=_mfa_request("/mfa/verify-setup"),
            response=Response(),
            body=body,
            db=db,
            user_id=user.id,
        )
    assert exc.value.status_code == 400
    assert "Invalid" in exc.value.detail or "verification" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_verify_mfa_setup_400_already_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    """verify_mfa_setup raises 400 when MFA already enabled."""
    monkeypatch.setattr(mfa_module.limiter, "enabled", False, raising=False)
    user = _make_user_mock(mfa_enabled=True, mfa_secret="secret")
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=execute_result)
    body = mfa_module.MFAVerifyRequest(code="123456")

    with pytest.raises(HTTPException) as exc:
        await mfa_module.verify_mfa_setup(
            request=_mfa_request("/mfa/verify-setup"),
            response=Response(),
            body=body,
            db=db,
            user_id=user.id,
        )
    assert exc.value.status_code == 400
    assert "already enabled" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_disable_mfa_401_invalid_password(monkeypatch: pytest.MonkeyPatch) -> None:
    """disable_mfa raises 401 when password wrong."""
    monkeypatch.setattr(mfa_module.limiter, "enabled", False, raising=False)
    user = _make_user_mock(mfa_enabled=True, password_hash="hash", oauth_provider=None)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=execute_result)
    monkeypatch.setattr(mfa_module, "verify_password", lambda p, h: False)
    body = mfa_module.MFADisableRequest(code="123456", password="wrong")

    with pytest.raises(HTTPException) as exc:
        await mfa_module.disable_mfa(
            request=_mfa_request("/mfa/disable"),
            response=Response(),
            body=body,
            db=db,
            user_id=user.id,
        )
    assert exc.value.status_code == 401
    assert "password" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_disable_mfa_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """disable_mfa disables MFA and returns success when password and code valid."""
    monkeypatch.setattr(mfa_module.limiter, "enabled", False, raising=False)
    user = _make_user_mock(mfa_enabled=True, password_hash="hash", oauth_provider=None)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=execute_result)
    db.commit = AsyncMock()
    monkeypatch.setattr(mfa_module, "verify_password", lambda p, h: True)
    verification_result = MagicMock()
    verification_result.success = True
    mfa_service = MagicMock()
    mfa_service.verify_mfa.return_value = (verification_result, None)
    monkeypatch.setattr(mfa_module, "get_mfa_service", lambda: mfa_service)
    audit = MagicMock()
    audit.log_auth = AsyncMock()
    monkeypatch.setattr(mfa_module.AuditLogger, "set_context", lambda self, **kw: audit)

    body = mfa_module.MFADisableRequest(code="123456", password="correct")
    result = await mfa_module.disable_mfa(
        request=_mfa_request("/mfa/disable"),
        response=Response(),
        body=body,
        db=db,
        user_id=user.id,
    )
    assert result["message"] == "MFA has been disabled"
    assert user.mfa_enabled is False
    assert user.mfa_secret is None
    assert user.mfa_backup_codes is None
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_disable_mfa_200_oauth(monkeypatch: pytest.MonkeyPatch) -> None:
    """disable_mfa disables MFA for OAuth user (no password check)."""
    monkeypatch.setattr(mfa_module.limiter, "enabled", False, raising=False)
    user = _make_user_mock(
        mfa_enabled=True, password_hash=None, oauth_provider="google"
    )
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=execute_result)
    db.commit = AsyncMock()
    verification_result = MagicMock()
    verification_result.success = True
    mfa_service = MagicMock()
    mfa_service.verify_mfa.return_value = (verification_result, None)
    monkeypatch.setattr(mfa_module, "get_mfa_service", lambda: mfa_service)
    audit = MagicMock()
    audit.log_auth = AsyncMock()
    monkeypatch.setattr(mfa_module.AuditLogger, "set_context", lambda self, **kw: audit)

    body = mfa_module.MFADisableRequest(code="123456", password="ignored")
    result = await mfa_module.disable_mfa(
        request=_mfa_request("/mfa/disable"),
        response=Response(),
        body=body,
        db=db,
        user_id=user.id,
    )
    assert result["message"] == "MFA has been disabled"
    assert user.mfa_enabled is False


@pytest.mark.asyncio
async def test_disable_mfa_400_cannot_verify_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    """disable_mfa raises 400 when user has no password and no OAuth."""
    monkeypatch.setattr(mfa_module.limiter, "enabled", False, raising=False)
    user = _make_user_mock(mfa_enabled=True, password_hash=None, oauth_provider=None)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=execute_result)
    body = mfa_module.MFADisableRequest(code="123456", password="x")

    with pytest.raises(HTTPException) as exc:
        await mfa_module.disable_mfa(
            request=_mfa_request("/mfa/disable"),
            response=Response(),
            body=body,
            db=db,
            user_id=user.id,
        )
    assert exc.value.status_code == 400
    assert "identity" in exc.value.detail.lower() or "verify" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_disable_mfa_400_invalid_code(monkeypatch: pytest.MonkeyPatch) -> None:
    """disable_mfa raises 400 when MFA code invalid."""
    monkeypatch.setattr(mfa_module.limiter, "enabled", False, raising=False)
    user = _make_user_mock(mfa_enabled=True, password_hash="hash")
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=execute_result)
    monkeypatch.setattr(mfa_module, "verify_password", lambda p, h: True)
    verification_result = MagicMock()
    verification_result.success = False
    mfa_service = MagicMock()
    mfa_service.verify_mfa.return_value = (verification_result, None)
    monkeypatch.setattr(mfa_module, "get_mfa_service", lambda: mfa_service)
    body = mfa_module.MFADisableRequest(code="000000", password="correct")

    with pytest.raises(HTTPException) as exc:
        await mfa_module.disable_mfa(
            request=_mfa_request("/mfa/disable"),
            response=Response(),
            body=body,
            db=db,
            user_id=user.id,
        )
    assert exc.value.status_code == 400
    assert "Invalid" in exc.value.detail or "verification" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_regenerate_backup_codes_400_invalid_code(monkeypatch: pytest.MonkeyPatch) -> None:
    """regenerate_backup_codes raises 400 when TOTP code invalid."""
    monkeypatch.setattr(mfa_module.limiter, "enabled", False, raising=False)
    user = _make_user_mock(mfa_enabled=True, mfa_secret="secret")
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=execute_result)
    mfa_service = MagicMock()
    mfa_service.verify_totp.return_value = False
    monkeypatch.setattr(mfa_module, "get_mfa_service", lambda: mfa_service)
    body = mfa_module.MFAVerifyRequest(code="000000")

    with pytest.raises(HTTPException) as exc:
        await mfa_module.regenerate_backup_codes(
            request=_mfa_request("/mfa/regenerate-backup-codes"),
            response=Response(),
            body=body,
            db=db,
            user_id=user.id,
        )
    assert exc.value.status_code == 400
    assert "Invalid" in exc.value.detail or "authenticator" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_regenerate_backup_codes_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """regenerate_backup_codes returns new backup codes when TOTP valid."""
    monkeypatch.setattr(mfa_module.limiter, "enabled", False, raising=False)
    user = _make_user_mock(mfa_enabled=True, mfa_secret="secret")
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=execute_result)
    db.commit = AsyncMock()
    mfa_service = MagicMock()
    mfa_service.verify_totp.return_value = True
    mfa_service.generate_backup_codes.return_value = ["new1", "new2", "new3"]
    mfa_service.hash_backup_codes.return_value = ["h1", "h2", "h3"]
    monkeypatch.setattr(mfa_module, "get_mfa_service", lambda: mfa_service)
    body = mfa_module.MFAVerifyRequest(code="123456")

    result = await mfa_module.regenerate_backup_codes(
        request=_mfa_request("/mfa/regenerate-backup-codes"),
        response=Response(),
        body=body,
        db=db,
        user_id=user.id,
    )
    assert result.backup_codes == ["new1", "new2", "new3"]
    assert user.mfa_backup_codes == ["h1", "h2", "h3"]
    db.commit.assert_awaited_once()
