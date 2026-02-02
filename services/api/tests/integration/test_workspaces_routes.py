"""Integration tests for workspace routes.

Covers: GET workspace (401, 403 orphan, 404, 200), files list/content/update/create/delete/move,
initialize, status, start (400 when not stopped). Workspace creation happens via session creation
(POST /sessions) in sessions routes.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import Session, Workspace
from src.database.models import User


async def _create_workspace_with_session(
    db: AsyncSession,
    owner_id: str,
    *,
    workspace_status: str = "stopped",
) -> tuple[Workspace, Session]:
    """Create a workspace and session linked to it. Caller must track session.id for cleanup."""
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
        name="Test Session",
        workspace_id=workspace.id,
        created_at=now,
        updated_at=now,
    )
    db.add(session)
    await db.commit()
    await db.refresh(workspace)
    if hasattr(db, "_test_created_ids"):
        db._test_created_ids["sessions"].append(session.id)
    return workspace, session


# -----------------------------------------------------------------------------
# Get workspace
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_workspace_401_unauthenticated(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
) -> None:
    """GET /workspaces/{id} returns 401 without auth."""
    workspace, _ = await _create_workspace_with_session(integration_db, test_user_with_db.id)
    resp = await test_client.get(
        f"/api/workspaces/{workspace.id}",
        headers={"X-Requested-With": "XMLHttpRequest", "Origin": "http://test"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_workspace_404_when_not_found(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /workspaces/{id} returns 404 for unknown workspace."""
    resp = await test_client.get(
        f"/api/workspaces/{uuid4()}",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 404
    assert "not found" in resp.json().get("detail", "").lower()


@pytest.mark.asyncio
async def test_get_workspace_403_when_no_session(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /workspaces/{id} returns 403 when workspace has no associated session (orphan)."""
    workspace_id = str(uuid4())
    now = datetime.now(UTC)
    workspace = Workspace(
        id=workspace_id,
        status="stopped",
        created_at=now,
        updated_at=now,
    )
    integration_db.add(workspace)
    await integration_db.commit()
    await integration_db.refresh(workspace)

    resp = await test_client.get(
        f"/api/workspaces/{workspace.id}",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 403
    assert "no associated session" in resp.json().get("detail", "").lower()


@pytest.mark.asyncio
async def test_get_workspace_success(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /workspaces/{id} returns workspace when user owns the session."""
    workspace, session = await _create_workspace_with_session(
        integration_db, test_user_with_db.id
    )

    resp = await test_client.get(
        f"/api/workspaces/{workspace.id}",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == workspace.id
    assert data["session_id"] == session.id
    assert "status" in data


# -----------------------------------------------------------------------------
# Files: list, content, update, create, delete, move
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_workspace_files_success(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /workspaces/{id}/files returns demo file tree (template-based)."""
    workspace, _ = await _create_workspace_with_session(integration_db, test_user_with_db.id)

    resp = await test_client.get(
        f"/api/workspaces/{workspace.id}/files",
        headers=auth_headers_with_db,
        params={"path": "/workspace"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    # Default template is nodejs; has README.md, src, package.json, etc.
    paths = [n.get("path") or (n.get("name") and f"/workspace/{n['name']}") for n in data]
    assert any("README" in str(p) for p in paths) or len(data) > 0


@pytest.mark.asyncio
async def test_get_file_content_success(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /workspaces/{id}/files/content returns file content for valid path."""
    workspace, _ = await _create_workspace_with_session(integration_db, test_user_with_db.id)

    resp = await test_client.get(
        f"/api/workspaces/{workspace.id}/files/content",
        headers=auth_headers_with_db,
        params={"path": "/workspace/README.md"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["path"] == "/workspace/README.md"
    assert "content" in data
    assert "Node.js" in data["content"] or "App" in data["content"]


@pytest.mark.asyncio
async def test_get_file_content_404_for_nonexistent(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /workspaces/{id}/files/content returns 404 for path not in demo contents."""
    workspace, _ = await _create_workspace_with_session(integration_db, test_user_with_db.id)

    resp = await test_client.get(
        f"/api/workspaces/{workspace.id}/files/content",
        headers=auth_headers_with_db,
        params={"path": "/workspace/nonexistent-file.txt"},
    )
    assert resp.status_code == 404
    assert "not found" in resp.json().get("detail", "").lower()


@pytest.mark.asyncio
async def test_put_file_content_success(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """PUT /workspaces/{id}/files/content updates file and returns content."""
    workspace, _ = await _create_workspace_with_session(integration_db, test_user_with_db.id)

    resp = await test_client.put(
        f"/api/workspaces/{workspace.id}/files/content",
        headers=auth_headers_with_db,
        params={"path": "/workspace/README.md"},
        json={"content": "# Updated content"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["path"] == "/workspace/README.md"
    assert data["content"] == "# Updated content"


@pytest.mark.asyncio
async def test_post_create_file_success(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /workspaces/{id}/files creates file and returns FileContent."""
    workspace, _ = await _create_workspace_with_session(integration_db, test_user_with_db.id)

    resp = await test_client.post(
        f"/api/workspaces/{workspace.id}/files",
        headers=auth_headers_with_db,
        json={"path": "/workspace/newfile.txt", "content": "hello"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["path"] == "/workspace/newfile.txt"
    assert data["content"] == "hello"


@pytest.mark.asyncio
async def test_delete_file_success(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """DELETE /workspaces/{id}/files returns deleted path."""
    workspace, _ = await _create_workspace_with_session(integration_db, test_user_with_db.id)

    resp = await test_client.delete(
        f"/api/workspaces/{workspace.id}/files",
        headers=auth_headers_with_db,
        params={"path": "/workspace/README.md"},
    )
    assert resp.status_code == 200
    assert resp.json().get("deleted") == "/workspace/README.md"


@pytest.mark.asyncio
async def test_post_move_file_success(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /workspaces/{id}/files/move returns source and destination."""
    workspace, _ = await _create_workspace_with_session(integration_db, test_user_with_db.id)

    resp = await test_client.post(
        f"/api/workspaces/{workspace.id}/files/move",
        headers=auth_headers_with_db,
        json={"source_path": "/workspace/README.md", "dest_path": "/workspace/README2.md"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["source"] == "/workspace/README.md"
    assert data["destination"] == "/workspace/README2.md"


@pytest.mark.asyncio
async def test_file_path_traversal_rejected(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /workspaces/{id}/files with path traversal returns 400."""
    workspace, _ = await _create_workspace_with_session(integration_db, test_user_with_db.id)

    resp = await test_client.get(
        f"/api/workspaces/{workspace.id}/files",
        headers=auth_headers_with_db,
        params={"path": "../../../etc/passwd"},
    )
    assert resp.status_code == 400
    assert "forbidden" in resp.json().get("detail", "").lower() or "invalid" in resp.json().get("detail", "").lower()


# -----------------------------------------------------------------------------
# Initialize, status, start
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_initialize_workspace_success(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /workspaces/{id}/initialize returns workspace_id and message."""
    workspace, _ = await _create_workspace_with_session(integration_db, test_user_with_db.id)

    resp = await test_client.post(
        f"/api/workspaces/{workspace.id}/initialize",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["workspace_id"] == workspace.id
    assert "files_created" in data
    assert "message" in data


@pytest.mark.asyncio
async def test_get_workspace_status_success(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /workspaces/{id}/status returns status (uses DB when compute unavailable)."""
    workspace, _ = await _create_workspace_with_session(integration_db, test_user_with_db.id)

    resp = await test_client.get(
        f"/api/workspaces/{workspace.id}/status",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == workspace.id
    assert data["status"] == "stopped"


@pytest.mark.asyncio
async def test_start_workspace_400_when_not_stopped(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    test_user_with_db: User,
    auth_headers_with_db: dict[str, str],
) -> None:
    """POST /workspaces/{id}/start returns 400 when workspace is not in stopped state."""
    workspace, _ = await _create_workspace_with_session(
        integration_db, test_user_with_db.id, workspace_status="running"
    )

    resp = await test_client.post(
        f"/api/workspaces/{workspace.id}/start",
        headers=auth_headers_with_db,
    )
    assert resp.status_code == 400
    assert "cannot start" in resp.json().get("detail", "").lower() or "stopped" in resp.json().get("detail", "").lower()
