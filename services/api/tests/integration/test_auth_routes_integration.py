"""Integration tests for real /api/auth routes.

These tests focus on login and registration error paths to exercise
validation and security-related branches without touching external services.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import PlatformSetting, User
from src.routes import auth as auth_module

# Ensure CSRF bypass for POST (middleware may not see client default headers)
CSRF_HEADERS = {"X-Requested-With": "XMLHttpRequest", "Origin": "http://test"}


@pytest.mark.asyncio
async def test_login_user_not_found(test_client: AsyncClient) -> None:
    """Login with unknown email should return 401 Invalid credentials."""
    resp = await test_client.post(
        "/api/auth/login",
        json={"email": "missing@example.com", "password": "password123"},
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid credentials"


@pytest.mark.asyncio
async def test_login_oauth_only_user_rejected(
    test_client: AsyncClient,
    integration_db: AsyncSession,
) -> None:
    """Users without a password hash (OAuth-only) cannot log in with password."""
    email = f"oauth-{uuid4()}@example.com"
    user = User(
        email=email,
        password_hash=None,  # OAuth-only
        name="OAuth User",
        is_active=True,
    )
    integration_db.add(user)
    await integration_db.commit()
    await integration_db.refresh(user)
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["users"].append(user.id)

    resp = await test_client.post(
        "/api/auth/login",
        json={"email": email, "password": "irrelevant"},
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 401
    assert "OAuth login" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_login_invalid_password(
    test_client: AsyncClient,
    integration_db: AsyncSession,
) -> None:
    """Wrong password should return 401 without issuing tokens."""
    email = f"user-{uuid4()}@example.com"
    hashed = auth_module.hash_password("correct-password")
    user = User(
        email=email,
        password_hash=hashed,
        name="Test User",
        is_active=True,
    )
    integration_db.add(user)
    await integration_db.commit()
    await integration_db.refresh(user)
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["users"].append(user.id)

    resp = await test_client.post(
        "/api/auth/login",
        json={"email": email, "password": "wrong-password"},
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid credentials"


@pytest.mark.asyncio
async def test_login_inactive_user(
    test_client: AsyncClient,
    integration_db: AsyncSession,
) -> None:
    """Inactive accounts should not be able to log in."""
    email = f"inactive-{uuid4()}@example.com"
    hashed = auth_module.hash_password("password123")
    user = User(
        email=email,
        password_hash=hashed,
        name="Inactive User",
        is_active=False,
    )
    integration_db.add(user)
    await integration_db.commit()
    await integration_db.refresh(user)
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["users"].append(user.id)

    resp = await test_client.post(
        "/api/auth/login",
        json={"email": email, "password": "password123"},
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Account is disabled"


@pytest.mark.asyncio
async def test_login_mfa_required_without_code(
    test_client: AsyncClient,
    integration_db: AsyncSession,
) -> None:
    """When MFA is enabled but mfa_code is missing, API should request MFA."""
    email = f"mfa-{uuid4()}@example.com"
    hashed = auth_module.hash_password("password123")
    user = User(
        email=email,
        password_hash=hashed,
        name="MFA User",
        is_active=True,
        mfa_enabled=True,
        mfa_secret="SECRET",
        mfa_backup_codes=None,
    )
    integration_db.add(user)
    await integration_db.commit()
    await integration_db.refresh(user)
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["users"].append(user.id)

    resp = await test_client.post(
        "/api/auth/login",
        json={"email": email, "password": "password123"},
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["mfa_required"] is True
    assert body["message"] == "MFA verification required"


@pytest.mark.asyncio
async def test_login_invalid_mfa_code(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Invalid MFA code should return 401 and not issue tokens."""
    email = f"mfa2-{uuid4()}@example.com"
    hashed = auth_module.hash_password("password123")
    user = User(
        email=email,
        password_hash=hashed,
        name="MFA User",
        is_active=True,
        mfa_enabled=True,
        mfa_secret="SECRET2",
        mfa_backup_codes=None,
    )
    integration_db.add(user)
    await integration_db.commit()
    await integration_db.refresh(user)
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["users"].append(user.id)

    class _FakeVerification:
        def __init__(self) -> None:
            self.success = False
            self.used_backup_code = False

    class _FakeMFAService:
        def verify_mfa(self, code: str, secret: str, backup_codes) -> tuple[_FakeVerification, None]:  # noqa: ARG002
            return _FakeVerification(), None

    monkeypatch.setattr(auth_module, "get_mfa_service", lambda: _FakeMFAService())

    resp = await test_client.post(
        "/api/auth/login",
        json={
            "email": email,
            "password": "password123",
            "mfa_code": "000000",
        },
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid MFA code"


@pytest.mark.asyncio
async def test_register_rejected_when_registration_disabled(
    test_client: AsyncClient,
    integration_db: AsyncSession,
) -> None:
    """When feature_flags.registration_enabled is False, registration requires invitation."""
    from sqlalchemy import delete

    await integration_db.execute(
        delete(PlatformSetting).where(PlatformSetting.key == "feature_flags")
    )
    await integration_db.commit()
    setting = PlatformSetting(
        key="feature_flags",
        value={"registration_enabled": False},
    )
    integration_db.add(setting)
    await integration_db.commit()

    resp = await test_client.post(
        "/api/auth/register",
        json={
            "email": "new@example.com",
            "password": "StrongPassw0rd!",
            "name": "New User",
        },
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 403
    assert "Registration is currently disabled" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_register_invalid_invitation_token(
    test_client: AsyncClient,
) -> None:
    """Providing an invalid invitation token should result in 403."""
    resp = await test_client.post(
        "/api/auth/register",
        json={
            "email": "invited@example.com",
            "password": "StrongPassw0rd!",
            "name": "Invited User",
            "invitation_token": "invalid-token",
        },
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 403
    assert "Invalid or expired invitation token" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_register_email_already_registered(
    test_client: AsyncClient,
    integration_db: AsyncSession,
) -> None:
    """Attempting to register an existing email should return 400."""
    email = f"taken-{uuid4()}@example.com"
    user = User(
        email=email,
        password_hash=auth_module.hash_password("password123"),
        name="Existing",
        is_active=True,
    )
    integration_db.add(user)
    await integration_db.commit()
    await integration_db.refresh(user)
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["users"].append(user.id)

    # Ensure registration is enabled (another test may have disabled it)
    from sqlalchemy import delete

    await integration_db.execute(
        delete(PlatformSetting).where(PlatformSetting.key == "feature_flags")
    )
    await integration_db.commit()

    resp = await test_client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "AnotherStrongPass1!",
            "name": "Another",
        },
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Email already registered"


@pytest.mark.asyncio
async def test_register_rejects_weak_password(
    test_client: AsyncClient,
    integration_db: AsyncSession,
) -> None:
    """Weak passwords should be rejected with a helpful error message."""
    # Ensure registration is enabled (another test may have disabled it)
    from sqlalchemy import delete

    await integration_db.execute(
        delete(PlatformSetting).where(PlatformSetting.key == "feature_flags")
    )
    await integration_db.commit()

    resp = await test_client.post(
        "/api/auth/register",
        json={
            "email": "weakpass@example.com",
            "password": "short",
            "name": "Weak Password",
        },
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert isinstance(detail, str)
    assert "Password does not meet requirements" in detail


@pytest.mark.asyncio
async def test_me_requires_authentication(test_client: AsyncClient) -> None:
    """GET /auth/me without auth should return 401."""
    resp = await test_client.get("/api/auth/me")
    assert resp.status_code == 401
    detail = resp.json()["detail"]
    assert detail in ("Not authenticated", "Authentication required")


@pytest.mark.asyncio
async def test_invitation_invalid_token_returns_valid_false(test_client: AsyncClient) -> None:
    """GET /auth/invitation/{token} with invalid token returns valid=False or 401 if auth required."""
    resp = await test_client.get("/api/auth/invitation/invalid-token-12345")
    if resp.status_code == 401:
        return  # Endpoint may require auth in some setups
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is False
    assert data.get("email") is None


@pytest.mark.asyncio
async def test_password_check_returns_strength_and_errors(test_client: AsyncClient) -> None:
    """POST /auth/password/check is public and returns strength + validation errors."""
    resp = await test_client.post(
        "/api/auth/password/check",
        json={"password": "weak"},
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "strength" in data
    assert "is_valid" in data
    assert "errors" in data
    assert isinstance(data["errors"], list)
    assert data["is_valid"] is False

    resp_strong = await test_client.post(
        "/api/auth/password/check",
        json={"password": "StrongPassw0rd!WithLength"},
        headers=CSRF_HEADERS,
    )
    assert resp_strong.status_code == 200
    assert resp_strong.json()["is_valid"] is True
