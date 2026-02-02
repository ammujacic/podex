"""Unit tests for auth middleware path checks."""

from __future__ import annotations

import pytest

from src.middleware import auth as auth_mw


def test_is_public_path_exact() -> None:
    assert auth_mw._is_public_path("/health") is True
    assert auth_mw._is_public_path("/api/auth/login") is True
    assert auth_mw._is_public_path("/api/auth/register") is True
    assert auth_mw._is_public_path("/api/billing/plans") is True
    assert auth_mw._is_public_path("/api/billing/plans/") is True
    assert auth_mw._is_public_path("/api/billing/plans?x=1") is True
    assert auth_mw._is_public_path("/api/private/thing") is False
    assert auth_mw._is_public_path("/api/auth/login/extra") is False


def test_is_public_path_prefix() -> None:
    assert auth_mw._is_public_path("/api/billing/plans/featured") is True
    assert auth_mw._is_public_path("/socket.io/") is True
    assert auth_mw._is_public_path("/api/waitlist/signup") is True
    assert auth_mw._is_public_path("/api/waitlist") is True


def test_is_internal_token_path() -> None:
    assert auth_mw._is_internal_token_path("/api/billing/usage/record") is True
    assert auth_mw._is_internal_token_path("/api/models/capabilities") is True
    assert auth_mw._is_internal_token_path("/api/models/capabilities/foo") is True
    assert auth_mw._is_internal_token_path("/api/agent-tools") is True
    assert auth_mw._is_internal_token_path("/api/agent-tools/bar") is True
    assert auth_mw._is_internal_token_path("/api/skills/available") is False


def test_is_internal_or_user_path() -> None:
    assert auth_mw._is_internal_or_user_path("/api/skills/available") is True
    assert auth_mw._is_internal_or_user_path("/api/v1/skills/available") is True
    assert auth_mw._is_internal_or_user_path("/api/agent-roles") is True
    assert auth_mw._is_internal_or_user_path("/api/agent-roles/xyz") is True
    assert auth_mw._is_internal_or_user_path("/api/servers") is True
    assert auth_mw._is_internal_or_user_path("/api/billing/hardware-specs") is True
    assert auth_mw._is_internal_or_user_path("/api/other") is False
