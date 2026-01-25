"""Integration tests for agents routes.

Tests agent CRUD operations with real database.
"""

import pytest


@pytest.mark.integration
@pytest.mark.asyncio
async def test_create_agent_basic(
    test_client, integration_db, test_user_with_db, auth_headers_with_db
):
    """Test creating a basic agent."""
    from tests.integration.conftest import create_test_session

    # Create a session first
    session = await create_test_session(integration_db, test_user_with_db)

    # Create agent via API
    response = await test_client.post(
        f"/api/sessions/{session.id}/agents",
        headers=auth_headers_with_db,
        json={
            "role": "coder",
            "name": "Test Coder Agent",
        },
    )

    assert response.status_code == 200  # Endpoint returns 200, not 201
    data = response.json()
    assert data["role"] == "coder"
    assert data["name"] == "Test Coder Agent"
    assert "id" in data
    assert "session_id" in data
    assert data["session_id"] == session.id


@pytest.mark.integration
@pytest.mark.asyncio
async def test_list_session_agents(
    test_client, integration_db, test_user_with_db, auth_headers_with_db
):
    """Test listing agents for a session."""
    from tests.integration.conftest import create_test_agent, create_test_session

    # Create session and agents
    session = await create_test_session(integration_db, test_user_with_db)
    await create_test_agent(integration_db, session.id, role="coder")
    await create_test_agent(integration_db, session.id, role="reviewer")

    # List agents via API
    response = await test_client.get(
        f"/api/sessions/{session.id}/agents",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    roles = [agent["role"] for agent in data]
    assert "coder" in roles
    assert "reviewer" in roles


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_agent_by_id(
    test_client, integration_db, test_user_with_db, auth_headers_with_db
):
    """Test getting a specific agent by ID."""
    from tests.integration.conftest import create_test_agent, create_test_session

    session = await create_test_session(integration_db, test_user_with_db)
    agent = await create_test_agent(integration_db, session.id, role="coder", name="Test Agent")

    # Get agent via API
    response = await test_client.get(
        f"/api/sessions/{session.id}/agents/{agent.id}",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == agent.id
    assert data["role"] == "coder"
    assert data["name"] == "Test Agent"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_update_agent(test_client, integration_db, test_user_with_db, auth_headers_with_db):
    """Test updating an agent."""
    from tests.integration.conftest import create_test_agent, create_test_session

    session = await create_test_session(integration_db, test_user_with_db)
    agent = await create_test_agent(integration_db, session.id, role="coder")

    # Update agent via API
    response = await test_client.patch(
        f"/api/sessions/{session.id}/agents/{agent.id}",
        headers=auth_headers_with_db,
        json={
            "name": "Updated Agent Name",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Updated Agent Name"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_delete_agent(test_client, integration_db, test_user_with_db, auth_headers_with_db):
    """Test deleting an agent."""
    from tests.integration.conftest import create_test_agent, create_test_session

    session = await create_test_session(integration_db, test_user_with_db)
    agent = await create_test_agent(integration_db, session.id, role="coder")

    # Delete agent via API
    response = await test_client.delete(
        f"/api/sessions/{session.id}/agents/{agent.id}",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 200  # Endpoint returns 200, not 204

    # Verify agent is gone
    response = await test_client.get(
        f"/api/sessions/{session.id}/agents/{agent.id}",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 404


@pytest.mark.integration
@pytest.mark.asyncio
async def test_create_agent_unauthorized(test_client, integration_db, test_user_with_db):
    """Test creating agent without authentication fails."""
    from tests.integration.conftest import create_test_session

    session = await create_test_session(integration_db, test_user_with_db)

    # Try to create without auth (CSRF protection triggers first)
    response = await test_client.post(
        f"/api/sessions/{session.id}/agents",
        json={"role": "coder"},
    )

    assert response.status_code == 403  # CSRF check happens before auth


@pytest.mark.integration
@pytest.mark.asyncio
async def test_get_nonexistent_agent(
    test_client, integration_db, test_user_with_db, auth_headers_with_db
):
    """Test getting a nonexistent agent returns 404."""
    from tests.integration.conftest import create_test_session

    session = await create_test_session(integration_db, test_user_with_db)

    response = await test_client.get(
        f"/api/sessions/{session.id}/agents/00000000-0000-0000-0000-000000000000",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 404
