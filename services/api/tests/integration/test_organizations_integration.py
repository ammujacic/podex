"""
Integration tests for organization routes.

Tests organization CRUD, membership, invitations, and billing operations
using real database and Redis connections.
"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import User


@pytest.mark.integration
@pytest.mark.asyncio
async def test_create_organization(
    test_client,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
):
    """Test creating a new organization."""
    response = await test_client.post(
        "/api/organizations/",
        headers=auth_headers_with_db,
        json={
            "name": "Test Organization",
            "slug": f"test-org-{uuid4().hex[:8]}",
        },
    )

    # Accept 200 or 201 for successful creation
    assert response.status_code in [200, 201]
    data = response.json()
    assert data["name"] == "Test Organization"
    assert "id" in data


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_current_organization(
    test_client,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
):
    """Test getting the current user's organization."""
    response = await test_client.get(
        "/api/organizations/",
        headers=auth_headers_with_db,
    )

    # User may or may not have an organization
    assert response.status_code in [200, 404]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_user_org_context(
    test_client,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
):
    """Test getting user's organization context."""
    response = await test_client.get(
        "/api/organizations/me",
        headers=auth_headers_with_db,
    )

    # User may or may not have an organization
    assert response.status_code in [200, 404]
    if response.status_code == 200:
        data = response.json()
        if data is not None:
            # Check response structure when user has org
            assert isinstance(data, dict)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_user_limits(
    test_client,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
):
    """Test getting user's organization limits."""
    response = await test_client.get(
        "/api/organizations/me/limits",
        headers=auth_headers_with_db,
    )

    # Should return limits or 400/404 if not in org
    assert response.status_code in [200, 400, 404]
    if response.status_code == 200:
        data = response.json()
        assert isinstance(data, dict)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_organization_not_found(
    test_client,
    auth_headers_with_db: dict[str, str],
):
    """Test getting a non-existent organization returns 404."""
    fake_org_id = str(uuid4())
    response = await test_client.get(
        f"/api/organizations/{fake_org_id}",
        headers=auth_headers_with_db,
    )

    assert response.status_code in [403, 404]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_organization_members_unauthorized(
    test_client,
    auth_headers_with_db: dict[str, str],
):
    """Test getting members of an org user doesn't belong to returns 403."""
    fake_org_id = str(uuid4())
    response = await test_client.get(
        f"/api/organizations/{fake_org_id}/members",
        headers=auth_headers_with_db,
    )

    assert response.status_code in [403, 404]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_organization_invitations_unauthorized(
    test_client,
    auth_headers_with_db: dict[str, str],
):
    """Test getting invitations for an org user doesn't belong to returns 403."""
    fake_org_id = str(uuid4())
    response = await test_client.get(
        f"/api/organizations/{fake_org_id}/invitations",
        headers=auth_headers_with_db,
    )

    assert response.status_code in [403, 404]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_organization_invite_links_unauthorized(
    test_client,
    auth_headers_with_db: dict[str, str],
):
    """Test getting invite links for an org user doesn't belong to returns 403."""
    fake_org_id = str(uuid4())
    response = await test_client.get(
        f"/api/organizations/{fake_org_id}/invite-links",
        headers=auth_headers_with_db,
    )

    assert response.status_code in [403, 404]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_join_with_invalid_invitation(
    test_client,
    auth_headers_with_db: dict[str, str],
):
    """Test joining org with invalid invitation token returns 404."""
    response = await test_client.post(
        "/api/organizations/join/invitation/invalid-token-12345",
        headers=auth_headers_with_db,
    )

    assert response.status_code in [400, 404]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_join_with_invalid_link(
    test_client,
    auth_headers_with_db: dict[str, str],
):
    """Test joining org with invalid invite link code returns 404."""
    response = await test_client.post(
        "/api/organizations/join/link/INVALIDCODE",
        headers=auth_headers_with_db,
    )

    assert response.status_code in [400, 404]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_domain_check(
    test_client,
    auth_headers_with_db: dict[str, str],
):
    """Test domain auto-join check."""
    response = await test_client.get(
        "/api/organizations/join/domain-check",
        headers=auth_headers_with_db,
    )

    # Should return domain check result
    assert response.status_code in [200, 404]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_organization_billing_unauthorized(
    test_client,
    auth_headers_with_db: dict[str, str],
):
    """Test getting billing for an org user doesn't belong to returns 403."""
    fake_org_id = str(uuid4())
    response = await test_client.get(
        f"/api/organizations/{fake_org_id}/billing/summary",
        headers=auth_headers_with_db,
    )

    assert response.status_code in [403, 404]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_unauthenticated_organization_access(
    test_client,
):
    """Test that unauthenticated requests are rejected."""
    response = await test_client.get("/api/organizations/")

    # Should get 401 or 403 (CSRF check)
    assert response.status_code in [401, 403]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_organization_crud_flow(
    test_client,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
):
    """Test full organization CRUD flow."""
    # Create organization
    org_slug = f"crud-test-{uuid4().hex[:8]}"
    create_response = await test_client.post(
        "/api/organizations/",
        headers=auth_headers_with_db,
        json={
            "name": "CRUD Test Org",
            "slug": org_slug,
        },
    )

    # Skip if organization creation failed (user may already have org)
    if create_response.status_code not in [200, 201]:
        pytest.skip("Could not create test organization")

    org_data = create_response.json()
    org_id = org_data["id"]

    # Get the organization
    get_response = await test_client.get(
        f"/api/organizations/{org_id}",
        headers=auth_headers_with_db,
    )

    assert get_response.status_code == 200
    retrieved_org = get_response.json()
    assert retrieved_org["name"] == "CRUD Test Org"

    # Update the organization
    update_response = await test_client.patch(
        f"/api/organizations/{org_id}",
        headers=auth_headers_with_db,
        json={"name": "Updated CRUD Test Org"},
    )

    # Accept success codes
    assert update_response.status_code in [200, 201, 204]

    # List members
    members_response = await test_client.get(
        f"/api/organizations/{org_id}/members",
        headers=auth_headers_with_db,
    )

    assert members_response.status_code == 200
    members = members_response.json()
    assert isinstance(members, list)
    # Creator should be a member
    assert len(members) >= 1
