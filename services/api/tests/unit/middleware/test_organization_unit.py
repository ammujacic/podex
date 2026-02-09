"""Unit tests for organization middleware pure helpers."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from src.middleware import organization as org


def test_has_permission() -> None:
    assert org.has_permission("owner", "billing:manage") is True
    assert org.has_permission("admin", "billing:manage") is False
    assert org.has_permission("member", "members:view") is True
    assert org.has_permission("member", "org:delete") is False
    assert org.has_permission("unknown", "org:view") is False


def test_has_role_or_higher() -> None:
    assert org.has_role_or_higher("owner", "member") is True
    assert org.has_role_or_higher("admin", "member") is True
    assert org.has_role_or_higher("member", "admin") is False
    assert org.has_role_or_higher("owner", "owner") is True


def test_org_context_helpers() -> None:
    fake_org = MagicMock()
    fake_org.id = "org-1"
    fake_member_owner = MagicMock()
    fake_member_owner.user_id = "u1"
    fake_member_owner.role = "owner"
    fake_member_admin = MagicMock()
    fake_member_admin.user_id = "u2"
    fake_member_admin.role = "admin"
    fake_member_member = MagicMock()
    fake_member_member.user_id = "u3"
    fake_member_member.role = "member"

    ctx_owner = org.OrgContext(fake_org, fake_member_owner)
    assert ctx_owner.org_id == "org-1"
    assert ctx_owner.role == "owner"
    assert ctx_owner.is_owner() is True
    assert ctx_owner.is_admin() is True
    assert ctx_owner.can_access_billing() is True
    assert ctx_owner.has_permission("billing:manage") is True

    ctx_admin = org.OrgContext(fake_org, fake_member_admin)
    assert ctx_admin.is_owner() is False
    assert ctx_admin.is_admin() is True
    assert ctx_admin.can_access_billing() is False
    assert ctx_admin.has_permission("members:invite") is True

    ctx_member = org.OrgContext(fake_org, fake_member_member)
    assert ctx_member.is_admin() is False
    assert ctx_member.has_permission("org:view") is True
    assert ctx_member.has_permission("org:delete") is False


def test_is_business_email() -> None:
    assert org.is_business_email("user@company.com") is True
    assert org.is_business_email("user@gmail.com", blocked_domains=["gmail.com"]) is False
    assert org.is_business_email("user@Acme.co", blocked_domains=["acme.co"]) is False


def test_validate_invite_email_raises_for_blocked() -> None:
    with pytest.raises(HTTPException) as exc_info:
        org.validate_invite_email("user@gmail.com", blocked_domains=["gmail.com"])
    assert exc_info.value.status_code == 400
    assert "business email" in (exc_info.value.detail or "").lower()


def test_validate_invite_email_passes_for_business() -> None:
    org.validate_invite_email("user@company.com", blocked_domains=["gmail.com"])
