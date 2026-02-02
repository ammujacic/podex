"""Integration tests for organization routes.

Covers: create/list/get/update/delete org, get my org, members list/get/update/remove,
permission checks (member vs admin vs owner).
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import Organization, OrganizationMember, User


async def _create_org_with_owner(
    db: AsyncSession,
    *,
    org_id: str | None = None,
    user_id: str = "",
    name: str = "Test Org",
    slug: str | None = None,
) -> Organization:
    """Create an organization and owner membership in the DB."""
    oid = org_id or str(uuid4())
    org = Organization(
        id=oid,
        name=name,
        slug=slug or oid.replace("-", "_"),
        credit_model="pooled",
        credit_pool_cents=0,
        is_active=True,
    )
    db.add(org)
    db.add(
        OrganizationMember(
            organization_id=oid,
            user_id=user_id,
            role="owner",
        )
    )
    await db.commit()
    await db.refresh(org)
    return org


# -----------------------------------------------------------------------------
# Create organization
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_organization_success(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /organizations/ creates org and returns 200 with org data."""
    resp = await test_client.post(
        "/api/organizations/",
        headers=auth_headers_with_db,
        json={"name": "Acme Corp", "credit_model": "pooled"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Acme Corp"
    assert data["slug"]
    assert data["id"]
    assert data["credit_model"] == "pooled"
    assert data["member_count"] == 1


@pytest.mark.asyncio
async def test_create_organization_requires_auth(
    test_client: AsyncClient,
) -> None:
    """POST /organizations/ without auth returns 401."""
    resp = await test_client.post(
        "/api/organizations/",
        headers={"X-Requested-With": "XMLHttpRequest", "Origin": "http://test"},
        json={"name": "Acme", "credit_model": "pooled"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_create_organization_400_when_already_in_org(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /organizations/ returns 400 when user is already in an org."""
    await _create_org_with_owner(
        integration_db,
        user_id=test_user_with_db.id,
        name="Existing Org",
    )
    resp = await test_client.post(
        "/api/organizations/",
        headers=auth_headers_with_db,
        json={"name": "Second Org", "credit_model": "pooled"},
    )
    assert resp.status_code == 400
    assert "already a member" in resp.json().get("detail", "").lower()


# -----------------------------------------------------------------------------
# Get my organization
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_my_organization_returns_null_when_no_org(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /organizations/ returns null when user has no org."""
    resp = await test_client.get("/api/organizations/", headers=auth_headers_with_db)
    assert resp.status_code == 200
    assert resp.json() is None


@pytest.mark.asyncio
async def test_get_my_organization_returns_org_after_create(
    test_client: AsyncClient,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /organizations/ returns org after user creates one."""
    await test_client.post(
        "/api/organizations/",
        headers=auth_headers_with_db,
        json={"name": "My Org", "credit_model": "pooled"},
    )
    resp = await test_client.get("/api/organizations/", headers=auth_headers_with_db)
    assert resp.status_code == 200
    data = resp.json()
    assert data is not None
    assert data["name"] == "My Org"


# -----------------------------------------------------------------------------
# Get organization by ID
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_organization_by_id_success(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /organizations/{org_id} returns org when user is member."""
    org = await _create_org_with_owner(
        integration_db,
        user_id=test_user_with_db.id,
        name="Member Org",
    )
    resp = await test_client.get(
        f"/api/organizations/{org.id}",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == org.id
    assert resp.json()["name"] == "Member Org"


@pytest.mark.asyncio
async def test_get_organization_by_id_403_when_not_member(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /organizations/{org_id} returns 403 when user is not a member."""
    # Create org owned by a different user
    other_user_id = str(uuid4())
    now = datetime.now(UTC)
    other_user = User(
        id=other_user_id,
        email=f"other-{other_user_id}@example.com",
        name="Other",
        password_hash="x",
        is_active=True,
        role="member",
        created_at=now,
        updated_at=now,
    )
    integration_db.add(other_user)
    await integration_db.commit()
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["users"].append(other_user_id)
    org = await _create_org_with_owner(
        integration_db,
        user_id=other_user_id,
        name="Other Org",
    )
    # Request as test_user_with_db (not a member)
    resp = await test_client.get(
        f"/api/organizations/{org.id}",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 403


# -----------------------------------------------------------------------------
# List members
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_members_success(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /organizations/{org_id}/members returns member list."""
    org = await _create_org_with_owner(
        integration_db,
        user_id=test_user_with_db.id,
        name="Org With Members",
    )
    resp = await test_client.get(
        f"/api/organizations/{org.id}/members",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 200
    members = resp.json()
    assert isinstance(members, list)
    assert len(members) == 1
    assert members[0]["user_id"] == test_user_with_db.id
    assert members[0]["role"] == "owner"


# -----------------------------------------------------------------------------
# Update organization
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_organization_success(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """PATCH /organizations/{org_id} updates org (owner/admin)."""
    org = await _create_org_with_owner(
        integration_db,
        user_id=test_user_with_db.id,
        name="Original Name",
    )
    resp = await test_client.patch(
        f"/api/organizations/{org.id}",
        headers=auth_headers_with_db,
        json={"name": "Updated Name"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Updated Name"


# -----------------------------------------------------------------------------
# Delete organization
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_organization_success(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """DELETE /organizations/{org_id} removes org when user is owner."""
    org = await _create_org_with_owner(
        integration_db,
        user_id=test_user_with_db.id,
        name="To Delete",
    )
    resp = await test_client.delete(
        f"/api/organizations/{org.id}",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 200
    assert "deleted" in resp.json().get("message", "").lower()
    # GET my org should now return null
    get_resp = await test_client.get("/api/organizations/", headers=auth_headers_with_db)
    assert get_resp.status_code == 200
    assert get_resp.json() is None
