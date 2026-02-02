"""Integration tests for session routes.

Covers: create session (with mocked compute/credits), list/get session,
archive/unarchive, delete. Workspace creation happens via POST /sessions.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import Session, Workspace
from src.database.models import User


async def _create_session_with_workspace(
    db: AsyncSession,
    owner_id: str,
    *,
    name: str = "Test Session",
    workspace_status: str = "stopped",
    archived_at: datetime | None = None,
) -> tuple[Workspace, Session]:
    """Create a workspace and session linked to it. Tracks both for cleanup."""
    workspace_id = str(uuid4())
    now = datetime.now(UTC)
    workspace = Workspace(
        id=workspace_id,
        status=workspace_status,
        created_at=now,
        updated_at=now,
    )
    db.add(workspace)
    await db.flush()

    session = Session(
        id=str(uuid4()),
        owner_id=owner_id,
        name=name,
        workspace_id=workspace.id,
        branch="main",
        status="active",
        archived_at=archived_at,
        created_at=now,
        updated_at=now,
    )
    db.add(session)
    await db.commit()
    await db.refresh(workspace)
    await db.refresh(session)
    if hasattr(db, "_test_created_ids"):
        db._test_created_ids["sessions"].append(session.id)
        db._test_created_ids["workspaces"].append(workspace.id)
    return workspace, session


# -----------------------------------------------------------------------------
# List sessions
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_sessions_401_unauthenticated(
    test_client: AsyncClient,
) -> None:
    """GET /sessions returns 401 without auth."""
    resp = await test_client.get(
        "/api/sessions",
        headers={"X-Requested-With": "XMLHttpRequest", "Origin": "http://test"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_list_sessions_success_empty(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /sessions returns 200 with empty list for user with no sessions."""
    resp = await test_client.get("/api/sessions", headers=auth_headers_with_db)
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert data["items"] == []
    assert data["total"] == 0
    assert data["page"] == 1
    assert data["page_size"] in (20, 100)  # default or max
    assert data["has_more"] is False


@pytest.mark.asyncio
async def test_list_sessions_success_with_items(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /sessions returns 200 with sessions owned by user."""
    _, session = await _create_session_with_workspace(
        integration_db, test_user_with_db.id, name="My Session"
    )
    resp = await test_client.get("/api/sessions", headers=auth_headers_with_db)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) >= 1
    ids = [s["id"] for s in data["items"]]
    assert session.id in ids
    found = next(s for s in data["items"] if s["id"] == session.id)
    assert found["name"] == "My Session"
    assert found["owner_id"] == test_user_with_db.id
    assert found["workspace_id"] is not None
    assert data["total"] >= 1


@pytest.mark.asyncio
async def test_list_sessions_pagination(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /sessions respects page and page_size."""
    resp = await test_client.get(
        "/api/sessions",
        headers=auth_headers_with_db,
        params={"page": 1, "page_size": 5},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["page"] == 1
    assert data["page_size"] == 5
    assert len(data["items"]) <= 5


@pytest.mark.asyncio
async def test_list_sessions_include_archived(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /sessions?include_archived=true returns archived sessions."""
    _, session = await _create_session_with_workspace(
        integration_db,
        test_user_with_db.id,
        name="Archived Session",
        archived_at=datetime.now(UTC),
    )
    # Session model needs archived_at set; our helper sets it but ORM might not
    # persist it if Session.archived_at is not in the model. Check model: Session has archived_at.
    from sqlalchemy import update

    await integration_db.execute(
        update(Session).where(Session.id == session.id).values(archived_at=datetime.now(UTC))
    )
    await integration_db.commit()

    resp = await test_client.get(
        "/api/sessions",
        headers=auth_headers_with_db,
        params={"include_archived": "true"},
    )
    assert resp.status_code == 200
    data = resp.json()
    ids = [s["id"] for s in data["items"]]
    assert session.id in ids


# -----------------------------------------------------------------------------
# Get session
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_session_401_unauthenticated(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
) -> None:
    """GET /sessions/{id} returns 401 without auth."""
    _, session = await _create_session_with_workspace(integration_db, test_user_with_db.id)
    resp = await test_client.get(
        f"/api/sessions/{session.id}",
        headers={"X-Requested-With": "XMLHttpRequest", "Origin": "http://test"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_session_404_not_found(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /sessions/{id} returns 404 for unknown session."""
    resp = await test_client.get(
        f"/api/sessions/{uuid4()}",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 404
    assert "not found" in resp.json().get("detail", "").lower()


@pytest.mark.asyncio
async def test_get_session_403_not_owner(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /sessions/{id} returns 403 when session belongs to another user."""
    from src.database import User as UserModel

    other_user = UserModel(
        id=str(uuid4()),
        email=f"other-{uuid4()}@example.com",
        name="Other User",
        password_hash="dummy",
        is_active=True,
        role="member",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    integration_db.add(other_user)
    await integration_db.commit()
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["users"].append(other_user.id)
    _, session = await _create_session_with_workspace(integration_db, other_user.id)
    resp = await test_client.get(
        f"/api/sessions/{session.id}",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 403
    assert "denied" in resp.json().get("detail", "").lower()


@pytest.mark.asyncio
async def test_get_session_success(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /sessions/{id} returns 200 with session data for owner."""
    _, session = await _create_session_with_workspace(
        integration_db, test_user_with_db.id, name="Get Me"
    )
    resp = await test_client.get(
        f"/api/sessions/{session.id}",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == session.id
    assert data["name"] == "Get Me"
    assert data["owner_id"] == test_user_with_db.id
    assert data["workspace_id"] == str(session.workspace_id)
    assert data["branch"] == "main"
    assert data["status"] == "active"


# -----------------------------------------------------------------------------
# Create session (mocked compute and credits)
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_session_401_unauthenticated(
    test_client: AsyncClient,
) -> None:
    """POST /sessions returns 401 without auth."""
    resp = await test_client.post(
        "/api/sessions",
        headers={"X-Requested-With": "XMLHttpRequest", "Origin": "http://test"},
        json={"name": "New Session"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_create_session_success(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /sessions creates session and workspace when compute/credits are mocked."""
    mock_create = AsyncMock(return_value={"status": "running"})
    mock_client = MagicMock()
    mock_client.create_workspace = mock_create
    # Use id that exists in workspace_servers seed (ws-local-1)
    mock_placement = AsyncMock(return_value=(mock_client, MagicMock(id="ws-local-1")))

    with (
        patch(
            "src.services.credit_enforcement.check_credits_available",
            new_callable=AsyncMock,
        ) as mock_credits,
        patch(
            "src.routes.sessions.get_compute_client_for_placement",
            mock_placement,
        ),
    ):
        mock_credits.return_value = MagicMock(can_proceed=True)
        resp = await test_client.post(
            "/api/sessions",
            headers=auth_headers_with_db,
            json={"name": "Created Session"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Created Session"
    assert data["owner_id"] == test_user_with_db.id
    assert data["workspace_id"] is not None
    assert data["branch"] == "main"
    assert data["status"] == "active"
    mock_create.assert_called_once()

    # Record for cleanup (route creates session/workspace but doesn't track them)
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["sessions"].append(data["id"])
        integration_db._test_created_ids["workspaces"].append(data["workspace_id"])


# -----------------------------------------------------------------------------
# Archive session
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_archive_session_404(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /sessions/{id}/archive returns 404 for unknown session."""
    resp = await test_client.post(
        f"/api/sessions/{uuid4()}/archive",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_archive_session_403_not_owner(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /sessions/{id}/archive returns 403 when session belongs to another user."""
    from src.database import User as UserModel

    other_user = UserModel(
        id=str(uuid4()),
        email=f"other-{uuid4()}@example.com",
        name="Other User",
        password_hash="dummy",
        is_active=True,
        role="member",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    integration_db.add(other_user)
    await integration_db.commit()
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["users"].append(other_user.id)
    _, session = await _create_session_with_workspace(integration_db, other_user.id)
    resp = await test_client.post(
        f"/api/sessions/{session.id}/archive",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_archive_session_400_already_archived(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /sessions/{id}/archive returns 400 when session is already archived."""
    _, session = await _create_session_with_workspace(
        integration_db, test_user_with_db.id, name="To Archive Twice"
    )
    resp = await test_client.post(
        f"/api/sessions/{session.id}/archive",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 200  # first archive succeeds
    resp2 = await test_client.post(
        f"/api/sessions/{session.id}/archive",
        headers=auth_headers_with_db,
    )
    assert resp2.status_code == 400
    assert "already archived" in resp2.json().get("detail", "").lower()


@pytest.mark.asyncio
async def test_archive_session_success(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /sessions/{id}/archive returns 200 and sets archived_at."""
    _, session = await _create_session_with_workspace(
        integration_db, test_user_with_db.id, name="To Archive"
    )
    resp = await test_client.post(
        f"/api/sessions/{session.id}/archive",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == session.id
    assert data["archived_at"] is not None


# -----------------------------------------------------------------------------
# Unarchive session
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unarchive_session_404(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /sessions/{id}/unarchive returns 404 for unknown session."""
    resp = await test_client.post(
        f"/api/sessions/{uuid4()}/unarchive",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_unarchive_session_403_not_owner(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /sessions/{id}/unarchive returns 403 when session belongs to another user."""
    from src.database import User as UserModel

    other_user = UserModel(
        id=str(uuid4()),
        email=f"other-{uuid4()}@example.com",
        name="Other User",
        password_hash="dummy",
        is_active=True,
        role="member",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    integration_db.add(other_user)
    await integration_db.commit()
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["users"].append(other_user.id)
    _, session = await _create_session_with_workspace(
        integration_db, other_user.id, archived_at=datetime.now(UTC)
    )

    resp = await test_client.post(
        f"/api/sessions/{session.id}/unarchive",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_unarchive_session_400_not_archived(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /sessions/{id}/unarchive returns 400 when session is not archived."""
    _, session = await _create_session_with_workspace(
        integration_db, test_user_with_db.id, name="Active Session"
    )
    resp = await test_client.post(
        f"/api/sessions/{session.id}/unarchive",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 400
    assert "not archived" in resp.json().get("detail", "").lower()


@pytest.mark.asyncio
async def test_unarchive_session_success(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /sessions/{id}/unarchive returns 200 and clears archived_at."""
    _, session = await _create_session_with_workspace(
        integration_db, test_user_with_db.id, name="Archive Then Unarchive"
    )
    resp = await test_client.post(
        f"/api/sessions/{session.id}/archive",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 200

    resp2 = await test_client.post(
        f"/api/sessions/{session.id}/unarchive",
        headers=auth_headers_with_db,
    )
    assert resp2.status_code == 200
    data = resp2.json()
    assert data["id"] == session.id
    assert data["archived_at"] is None


# -----------------------------------------------------------------------------
# Delete session
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_session_404(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """DELETE /sessions/{id} returns 404 for unknown session."""
    resp = await test_client.delete(
        f"/api/sessions/{uuid4()}",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_session_403_not_owner(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    auth_headers_with_db: dict[str, str],
) -> None:
    """DELETE /sessions/{id} returns 403 when session belongs to another user."""
    from src.database import User as UserModel

    other_user = UserModel(
        id=str(uuid4()),
        email=f"other-{uuid4()}@example.com",
        name="Other User",
        password_hash="dummy",
        is_active=True,
        role="member",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    integration_db.add(other_user)
    await integration_db.commit()
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["users"].append(other_user.id)
    _, session = await _create_session_with_workspace(integration_db, other_user.id)
    resp = await test_client.delete(
        f"/api/sessions/{session.id}",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_delete_session_success(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """DELETE /sessions/{id} returns 200 and removes session (compute mock)."""
    _, session = await _create_session_with_workspace(
        integration_db, test_user_with_db.id, name="To Delete"
    )
    session_id = session.id
    workspace_id = str(session.workspace_id)

    mock_mark = AsyncMock(return_value=None)
    mock_client = MagicMock()
    mock_client.mark_workspace_for_deletion = mock_mark

    with patch(
        "src.routes.sessions.get_compute_client_for_workspace",
        new_callable=AsyncMock,
        return_value=mock_client,
    ):
        resp = await test_client.delete(
            f"/api/sessions/{session_id}",
            headers=auth_headers_with_db,
        )

    assert resp.status_code == 200
    mock_mark.assert_called_once_with(workspace_id, test_user_with_db.id)

    # Session should be gone
    get_resp = await test_client.get(
        f"/api/sessions/{session_id}",
        headers=auth_headers_with_db,
    )
    assert get_resp.status_code == 404
