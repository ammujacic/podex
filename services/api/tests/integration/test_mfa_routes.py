"""Integration tests for MFA routes.

Covers: status (auth required), setup, verify-setup (with real TOTP), disable (password + code),
regenerate-backup-codes (with MFA enabled).
"""

from __future__ import annotations

import pytest
import pyotp
from httpx import AsyncClient


# -----------------------------------------------------------------------------
# Status
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mfa_status_requires_auth(test_client: AsyncClient) -> None:
    """GET /mfa/status without auth returns 401."""
    resp = await test_client.get(
        "/api/mfa/status",
        headers={"X-Requested-With": "XMLHttpRequest", "Origin": "http://test"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_mfa_status_returns_disabled(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /mfa/status with auth returns enabled: false when MFA not set up."""
    resp = await test_client.get("/api/mfa/status", headers=auth_headers_with_db)
    assert resp.status_code == 200
    data = resp.json()
    assert data["enabled"] is False
    assert data["backup_codes_remaining"] == 0


# -----------------------------------------------------------------------------
# Setup
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mfa_setup_success(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /mfa/setup returns secret, qr_code_base64, backup_codes."""
    resp = await test_client.post("/api/mfa/setup", headers=auth_headers_with_db)
    assert resp.status_code == 200
    data = resp.json()
    assert "secret" in data
    assert "qr_code_base64" in data
    assert "provisioning_uri" in data
    assert "backup_codes" in data
    assert isinstance(data["backup_codes"], list)
    assert len(data["backup_codes"]) > 0


@pytest.mark.asyncio
async def test_mfa_setup_400_when_already_enabled(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /mfa/setup returns 400 when MFA is already enabled."""
    # Setup and verify to enable MFA
    setup_resp = await test_client.post("/api/mfa/setup", headers=auth_headers_with_db)
    assert setup_resp.status_code == 200
    secret = setup_resp.json()["secret"]
    code = pyotp.TOTP(secret).now()
    await test_client.post(
        "/api/mfa/verify-setup",
        headers=auth_headers_with_db,
        json={"code": code},
    )
    # Second setup should fail
    resp = await test_client.post("/api/mfa/setup", headers=auth_headers_with_db)
    assert resp.status_code == 400
    assert "already enabled" in resp.json().get("detail", "").lower()


# -----------------------------------------------------------------------------
# Verify setup & status after enable
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mfa_verify_setup_success(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /mfa/verify-setup with valid TOTP code enables MFA."""
    setup_resp = await test_client.post("/api/mfa/setup", headers=auth_headers_with_db)
    assert setup_resp.status_code == 200
    secret = setup_resp.json()["secret"]
    code = pyotp.TOTP(secret).now()

    resp = await test_client.post(
        "/api/mfa/verify-setup",
        headers=auth_headers_with_db,
        json={"code": code},
    )
    assert resp.status_code == 200
    assert "enabled" in resp.json().get("message", "").lower()

    status_resp = await test_client.get("/api/mfa/status", headers=auth_headers_with_db)
    assert status_resp.status_code == 200
    assert status_resp.json()["enabled"] is True


# -----------------------------------------------------------------------------
# Disable
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mfa_disable_success(
    test_client: AsyncClient,
    test_user_with_db,  # noqa: ANN001 - from conftest
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /mfa/disable with valid password and backup code disables MFA."""
    # Enable MFA first
    setup_resp = await test_client.post("/api/mfa/setup", headers=auth_headers_with_db)
    assert setup_resp.status_code == 200
    secret = setup_resp.json()["secret"]
    backup_codes = setup_resp.json()["backup_codes"]
    code = pyotp.TOTP(secret).now()
    await test_client.post(
        "/api/mfa/verify-setup",
        headers=auth_headers_with_db,
        json={"code": code},
    )
    # Disable using first backup code and password (test user password from conftest)
    resp = await test_client.post(
        "/api/mfa/disable",
        headers=auth_headers_with_db,
        json={"code": backup_codes[0], "password": "testpass123"},
    )
    assert resp.status_code == 200
    assert "disabled" in resp.json().get("message", "").lower()

    status_resp = await test_client.get("/api/mfa/status", headers=auth_headers_with_db)
    assert status_resp.json()["enabled"] is False


@pytest.mark.asyncio
async def test_mfa_disable_401_wrong_password(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /mfa/disable with wrong password returns 401."""
    setup_resp = await test_client.post("/api/mfa/setup", headers=auth_headers_with_db)
    secret = setup_resp.json()["secret"]
    backup_codes = setup_resp.json()["backup_codes"]
    code = pyotp.TOTP(secret).now()
    await test_client.post(
        "/api/mfa/verify-setup",
        headers=auth_headers_with_db,
        json={"code": code},
    )
    resp = await test_client.post(
        "/api/mfa/disable",
        headers=auth_headers_with_db,
        json={"code": backup_codes[0], "password": "wrongpassword"},
    )
    assert resp.status_code == 401
    assert "password" in resp.json().get("detail", "").lower()


# -----------------------------------------------------------------------------
# Regenerate backup codes
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mfa_regenerate_backup_codes_400_when_not_enabled(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /mfa/regenerate-backup-codes returns 400 when MFA not enabled."""
    resp = await test_client.post(
        "/api/mfa/regenerate-backup-codes",
        headers=auth_headers_with_db,
        json={"code": "123456"},
    )
    assert resp.status_code == 400
    assert "not enabled" in resp.json().get("detail", "").lower()


@pytest.mark.asyncio
async def test_mfa_regenerate_backup_codes_success(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /mfa/regenerate-backup-codes with valid TOTP returns new backup codes."""
    setup_resp = await test_client.post("/api/mfa/setup", headers=auth_headers_with_db)
    secret = setup_resp.json()["secret"]
    code = pyotp.TOTP(secret).now()
    await test_client.post(
        "/api/mfa/verify-setup",
        headers=auth_headers_with_db,
        json={"code": code},
    )
    code2 = pyotp.TOTP(secret).now()
    resp = await test_client.post(
        "/api/mfa/regenerate-backup-codes",
        headers=auth_headers_with_db,
        json={"code": code2},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "backup_codes" in data
    assert len(data["backup_codes"]) > 0
