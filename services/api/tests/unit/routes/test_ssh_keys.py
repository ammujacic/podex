"""Unit tests for ssh_keys route helpers and Pydantic models."""

from __future__ import annotations

import base64
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response

from src.routes import ssh_keys as ssh_keys_module


# Minimal valid SSH public keys for testing (proper base64 padding for Python 3.13+)
SSH_RSA_KEY = "ssh-rsa " + base64.b64encode(b"x" * 24).decode() + " test-key@host"
SSH_ED25519_KEY = "ssh-ed25519 " + base64.b64encode(b"y" * 24).decode() + " test@host"


class TestValidateSSHPublicKey:
    """Tests for validate_ssh_public_key helper."""

    def test_valid_ssh_rsa_returns_type_and_fingerprint(self) -> None:
        """validate_ssh_public_key returns key_type and fingerprint for valid ssh-rsa."""
        key_type, fingerprint = ssh_keys_module.validate_ssh_public_key(SSH_RSA_KEY)
        assert key_type == "ssh-rsa"
        assert fingerprint is not None
        assert ":" in fingerprint
        assert len(fingerprint) > 10

    def test_valid_ssh_ed25519_returns_type_and_fingerprint(self) -> None:
        """validate_ssh_public_key returns key_type and fingerprint for valid ssh-ed25519."""
        key_type, fingerprint = ssh_keys_module.validate_ssh_public_key(SSH_ED25519_KEY)
        assert key_type == "ssh-ed25519"
        assert fingerprint is not None

    def test_invalid_format_too_few_parts(self) -> None:
        """validate_ssh_public_key raises ValueError when key has too few parts."""
        with pytest.raises(ValueError) as exc:
            ssh_keys_module.validate_ssh_public_key("not-a-valid-key")
        assert "Invalid" in str(exc.value) or "format" in str(exc.value).lower()

    def test_unsupported_key_type(self) -> None:
        """validate_ssh_public_key raises ValueError for unsupported key type."""
        # Use a valid base64 blob but unsupported type
        with pytest.raises(ValueError) as exc:
            ssh_keys_module.validate_ssh_public_key("ssh-dss AAAAB3NzaC1kc3MAAACB test")
        assert "Unsupported" in str(exc.value) or "ssh-dss" in str(exc.value)

    def test_invalid_base64(self) -> None:
        """validate_ssh_public_key raises ValueError for invalid base64."""
        with pytest.raises(ValueError) as exc:
            ssh_keys_module.validate_ssh_public_key("ssh-rsa not-valid-base64!!!")
        assert "base64" in str(exc.value).lower() or "Invalid" in str(exc.value)


class TestSSHKeyPydanticModels:
    """Pydantic model validation."""

    def test_ssh_key_create(self) -> None:
        """SSHKeyCreate holds name and public_key."""
        body = ssh_keys_module.SSHKeyCreate(name="laptop", public_key=SSH_RSA_KEY)
        assert body.name == "laptop"
        assert body.public_key == SSH_RSA_KEY

    def test_ssh_key_response(self) -> None:
        """SSHKeyResponse holds name, key_type, fingerprint, public_key, created_at."""
        resp = ssh_keys_module.SSHKeyResponse(
            name="laptop",
            key_type="ssh-rsa",
            fingerprint="aa:bb:cc",
            public_key=SSH_RSA_KEY,
            created_at=datetime.now(UTC).isoformat(),
        )
        assert resp.name == "laptop"
        assert resp.key_type == "ssh-rsa"
        assert resp.fingerprint == "aa:bb:cc"

    def test_ssh_key_list_response(self) -> None:
        """SSHKeyListResponse holds keys list and total."""
        resp = ssh_keys_module.SSHKeyListResponse(keys=[], total=0)
        assert resp.keys == []
        assert resp.total == 0


def _make_user_mock(ssh_public_keys: list | None = None) -> MagicMock:
    user = MagicMock()
    user.id = "u1"
    user.ssh_public_keys = ssh_public_keys or []
    return user


def _ssh_request(path: str = "/ssh-keys") -> Request:
    req = Request({"type": "http", "method": "GET", "path": path, "headers": []})
    req.state.user_id = "u1"
    return req


@pytest.mark.asyncio
async def test_list_ssh_keys_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """list_ssh_keys returns SSHKeyListResponse with user's keys."""
    monkeypatch.setattr(ssh_keys_module.limiter, "enabled", False, raising=False)
    user = _make_user_mock([
        {"name": "laptop", "key_type": "ssh-rsa", "fingerprint": "aa:bb", "public_key": SSH_RSA_KEY, "created_at": "2025-01-01T00:00:00Z"},
    ])
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=execute_result)

    result = await ssh_keys_module.list_ssh_keys(
        request=_ssh_request(),
        response=Response(),
        db=db,
    )
    assert result.total == 1
    assert len(result.keys) == 1
    assert result.keys[0].name == "laptop"
    assert result.keys[0].key_type == "ssh-rsa"


@pytest.mark.asyncio
async def test_add_ssh_key_400_invalid_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """add_ssh_key raises 400 for invalid public key."""
    monkeypatch.setattr(ssh_keys_module.limiter, "enabled", False, raising=False)
    user = _make_user_mock([])
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=execute_result)
    body = ssh_keys_module.SSHKeyCreate(name="laptop", public_key="invalid-key")

    with pytest.raises(HTTPException) as exc:
        await ssh_keys_module.add_ssh_key(
            request=_ssh_request(),
            response=Response(),
            body=body,
            db=db,
        )
    assert exc.value.status_code == 400
    assert "Invalid" in exc.value.detail or "key" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_add_ssh_key_201(monkeypatch: pytest.MonkeyPatch) -> None:
    """add_ssh_key returns SSHKeyResponse when key is valid and new."""
    monkeypatch.setattr(ssh_keys_module.limiter, "enabled", False, raising=False)
    user = _make_user_mock([])
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=execute_result)
    body = ssh_keys_module.SSHKeyCreate(name="laptop", public_key=SSH_RSA_KEY)

    result = await ssh_keys_module.add_ssh_key(
        request=_ssh_request(),
        response=Response(),
        body=body,
        db=db,
    )
    assert result.name == "laptop"
    assert result.key_type == "ssh-rsa"
    assert result.fingerprint is not None
    db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_add_ssh_key_409_duplicate(monkeypatch: pytest.MonkeyPatch) -> None:
    """add_ssh_key raises 409 when fingerprint already exists."""
    monkeypatch.setattr(ssh_keys_module.limiter, "enabled", False, raising=False)
    key_type, fingerprint = ssh_keys_module.validate_ssh_public_key(SSH_RSA_KEY)
    user = _make_user_mock([
        {"name": "other", "fingerprint": fingerprint, "key_type": key_type, "public_key": SSH_RSA_KEY, "created_at": "2025-01-01T00:00:00Z"},
    ])
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=execute_result)
    body = ssh_keys_module.SSHKeyCreate(name="laptop", public_key=SSH_RSA_KEY)

    with pytest.raises(HTTPException) as exc:
        await ssh_keys_module.add_ssh_key(
            request=_ssh_request(),
            response=Response(),
            body=body,
            db=db,
        )
    assert exc.value.status_code == 409
    assert "already exists" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_delete_ssh_key_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """delete_ssh_key raises 404 when fingerprint not found."""
    monkeypatch.setattr(ssh_keys_module.limiter, "enabled", False, raising=False)
    user = _make_user_mock([{"name": "laptop", "fingerprint": "aa:bb:cc", "key_type": "ssh-rsa", "public_key": SSH_RSA_KEY, "created_at": "2025-01-01T00:00:00Z"}])
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=execute_result)

    with pytest.raises(HTTPException) as exc:
        await ssh_keys_module.delete_ssh_key(
            fingerprint="unknown:fingerprint",
            request=_ssh_request(),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 404
    assert "not found" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_delete_ssh_key_204(monkeypatch: pytest.MonkeyPatch) -> None:
    """delete_ssh_key returns 204 and removes key when fingerprint found."""
    monkeypatch.setattr(ssh_keys_module.limiter, "enabled", False, raising=False)
    keys_list = [{"name": "laptop", "fingerprint": "aa:bb:cc", "key_type": "ssh-rsa", "public_key": SSH_RSA_KEY, "created_at": "2025-01-01T00:00:00Z"}]
    user = _make_user_mock(keys_list)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=execute_result)

    result = await ssh_keys_module.delete_ssh_key(
        fingerprint="aa:bb:cc",
        request=_ssh_request(),
        response=Response(),
        db=db,
    )
    assert result is None
    assert len(user.ssh_public_keys) == 0
    db.commit.assert_awaited()
