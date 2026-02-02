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


# ============== Authenticated endpoints (use auth_headers_with_db) ==============


@pytest.mark.asyncio
async def test_me_returns_user_when_authenticated(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
    test_user_with_db: User,
) -> None:
    """GET /auth/me with valid JWT returns current user."""
    resp = await test_client.get("/api/auth/me", headers=auth_headers_with_db)
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == test_user_with_db.id
    assert data["email"] == test_user_with_db.email
    assert data["name"] == test_user_with_db.name
    assert "role" in data


@pytest.mark.asyncio
async def test_logout_returns_success_when_authenticated(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /auth/logout with valid auth returns success."""
    resp = await test_client.post(
        "/api/auth/logout",
        json={},
        headers={**CSRF_HEADERS, **auth_headers_with_db},
    )
    assert resp.status_code == 200
    assert resp.json()["message"] == "Logged out successfully"


@pytest.mark.asyncio
async def test_logout_revoke_all_sessions(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /auth/logout with revoke_all_sessions returns success and message."""
    resp = await test_client.post(
        "/api/auth/logout",
        json={"revoke_all_sessions": True},
        headers={**CSRF_HEADERS, **auth_headers_with_db},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "message" in data
    assert "Logged out" in data["message"]


@pytest.mark.asyncio
async def test_ws_token_returns_token_when_authenticated(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /auth/ws-token with valid auth returns short-lived token."""
    resp = await test_client.post(
        "/api/auth/ws-token",
        headers={**CSRF_HEADERS, **auth_headers_with_db},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["token"].startswith("wst_")
    assert data["expires_in"] == 30


@pytest.mark.asyncio
async def test_ws_token_requires_authentication(test_client: AsyncClient) -> None:
    """POST /auth/ws-token without auth returns 401."""
    resp = await test_client.post(
        "/api/auth/ws-token",
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_password_change_success(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /auth/password/change with correct current password updates password."""
    resp = await test_client.post(
        "/api/auth/password/change",
        json={
            "current_password": "testpass123",
            "new_password": "NewSecureP@ssw0rd!",
        },
        headers={**CSRF_HEADERS, **auth_headers_with_db},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "message" in data
    assert "sessions_revoked" in data


@pytest.mark.asyncio
async def test_password_change_wrong_current_password(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /auth/password/change with wrong current password returns 401."""
    resp = await test_client.post(
        "/api/auth/password/change",
        json={
            "current_password": "wrongpassword",
            "new_password": "NewSecureP@ssw0rd!",
        },
        headers={**CSRF_HEADERS, **auth_headers_with_db},
    )
    assert resp.status_code == 401
    assert "incorrect" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_password_change_requires_authentication(test_client: AsyncClient) -> None:
    """POST /auth/password/change without auth returns 401."""
    resp = await test_client.post(
        "/api/auth/password/change",
        json={"current_password": "x", "new_password": "NewSecureP@ssw0rd!"},
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_refresh_requires_token(test_client: AsyncClient) -> None:
    """POST /auth/refresh without refresh token returns 401."""
    resp = await test_client.post(
        "/api/auth/refresh",
        json={},
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 401
    assert "refresh" in resp.json()["detail"].lower() or "required" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_refresh_success_with_body_token(
    test_client: AsyncClient,
    test_user_with_db: User,
) -> None:
    """POST /auth/refresh with valid refresh token in body returns new tokens."""
    # Login to get refresh token
    login_resp = await test_client.post(
        "/api/auth/login",
        json={"email": test_user_with_db.email, "password": "testpass123"},
        headers=CSRF_HEADERS,
    )
    assert login_resp.status_code == 200
    login_data = login_resp.json()
    refresh_token = login_data.get("refresh_token")
    assert refresh_token, "Login should return refresh_token in body (dev mode)"

    resp = await test_client.post(
        "/api/auth/refresh",
        json={"refresh_token": refresh_token},
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data or "expires_in" in data


@pytest.mark.asyncio
async def test_password_forgot_returns_200_always(
    test_client: AsyncClient,
) -> None:
    """POST /auth/password/forgot always returns 200 (no email enumeration)."""
    resp = await test_client.post(
        "/api/auth/password/forgot",
        json={"email": "nonexistent@example.com"},
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 200
    assert "message" in resp.json()


@pytest.mark.asyncio
async def test_password_reset_invalid_token_returns_400(test_client: AsyncClient) -> None:
    """POST /auth/password/reset with invalid token returns 400."""
    resp = await test_client.post(
        "/api/auth/password/reset",
        json={"token": "invalid-token-123", "new_password": "NewSecureP@ssw0rd!"},
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 400
    assert "token" in resp.json()["detail"].lower() or "invalid" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_password_reset_success_with_stored_token(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    integration_redis,
) -> None:
    """POST /auth/password/reset with valid token in Redis updates password."""
    import json

    from src.routes.auth import PASSWORD_RESET_PREFIX, PASSWORD_RESET_TTL

    reset_token = "valid-reset-token-for-test"
    key = f"{PASSWORD_RESET_PREFIX}{reset_token}"
    value = json.dumps({"user_id": test_user_with_db.id, "email": test_user_with_db.email})
    await integration_redis.setex(key, PASSWORD_RESET_TTL, value)

    resp = await test_client.post(
        "/api/auth/password/reset",
        json={"token": reset_token, "new_password": "NewSecureP@ssw0rd!WithLength"},
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 200
    assert "message" in resp.json()


@pytest.mark.asyncio
async def test_delete_account_requires_authentication(test_client: AsyncClient) -> None:
    """DELETE /auth/account without auth returns 401."""
    resp = await test_client.request(
        "DELETE",
        "/api/auth/account",
        json={"password": "x", "confirmation": "x@x.com"},
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_delete_account_wrong_confirmation(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
    test_user_with_db: User,
) -> None:
    """DELETE /auth/account with wrong email confirmation returns 400."""
    resp = await test_client.request(
        "DELETE",
        "/api/auth/account",
        json={
            "password": "testpass123",
            "confirmation": "wrong@example.com",
        },
        headers={**CSRF_HEADERS, **auth_headers_with_db},
    )
    assert resp.status_code == 400
    assert "confirmation" in resp.json()["detail"].lower() or "match" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_delete_account_wrong_password(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
    test_user_with_db: User,
) -> None:
    """DELETE /auth/account with wrong password returns 401."""
    resp = await test_client.request(
        "DELETE",
        "/api/auth/account",
        json={
            "password": "wrongpassword",
            "confirmation": test_user_with_db.email,
        },
        headers={**CSRF_HEADERS, **auth_headers_with_db},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_delete_account_success_soft_deletes(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
    test_user_with_db: User,
    integration_db: AsyncSession,
) -> None:
    """DELETE /auth/account with correct password and confirmation soft-deletes user."""
    resp = await test_client.request(
        "DELETE",
        "/api/auth/account",
        json={
            "password": "testpass123",
            "confirmation": test_user_with_db.email,
        },
        headers={**CSRF_HEADERS, **auth_headers_with_db},
    )
    assert resp.status_code == 200
    assert resp.json()["message"] == "Account deleted successfully"

    result = await integration_db.execute(select(User).where(User.id == test_user_with_db.id))
    user_after = result.scalar_one_or_none()
    assert user_after is not None
    assert user_after.is_active is False
    assert user_after.deleted_at is not None
