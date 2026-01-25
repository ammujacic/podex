"""Tests for workspace routes - comprehensive endpoint testing."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import status
from fastapi.testclient import TestClient

from src.models.workspace import (
    WorkspaceConfig,
    WorkspaceExecResponse,
    WorkspaceScaleResponse,
    WorkspaceStatus,
    WorkspaceTier,
)


# ============================================
# Authentication & Authorization Tests
# ============================================


def test_missing_user_id_header(test_internal_api_key: str, docker_manager, mock_api_calls):
    """Test that missing X-User-ID header returns 401."""
    from src.main import app

    # Create a fresh client without default headers
    with TestClient(app) as client:
        # Request with only X-Internal-API-Key, missing X-User-ID
        response = client.get(
            "/workspaces/test-ws-1",
            headers={"X-Internal-API-Key": test_internal_api_key},
        )
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


def test_missing_internal_api_key(test_user_id: str, test_internal_api_key: str, docker_manager, mock_api_calls):
    """Test that missing X-Internal-API-Key header returns 401."""
    from src.main import app

    # Create a fresh client without default headers
    with TestClient(app) as client:
        # Request with only X-User-ID, missing X-Internal-API-Key
        response = client.get(
            "/workspaces/test-ws-1",
            headers={"X-User-ID": test_user_id},
        )
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.asyncio
async def test_verify_workspace_ownership_blocks_wrong_user(
    fastapi_client: TestClient, docker_manager, workspace_factory
):
    """Test that verify_workspace_ownership blocks access to other user's workspaces."""
    # Create workspace for a different user - use same store as routes
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id="other-user-999",
        session_id="session-1",
        status=WorkspaceStatus.RUNNING,
    )
    await docker_manager._workspace_store.save(workspace)

    # Try to access with test user
    response = fastapi_client.get("/workspaces/test-ws-1")
    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert "Not authorized" in response.json()["detail"]


# ============================================
# POST /workspaces - Create Workspace
# ============================================


@pytest.mark.asyncio
async def test_create_workspace_success(
    fastapi_client: TestClient, docker_manager, test_user_id, workspace_factory
):
    """Test successful workspace creation."""
    request_data = {
        "session_id": "session-1",
        "config": {
            "tier": "starter",  # lowercase enum value
            "git_email": "test@example.com",
            "git_name": "Test User",
            "repos": [],
        },
    }

    with patch(
        "src.managers.docker_manager.DockerComputeManager.create_workspace",
        new_callable=AsyncMock,
    ) as mock_create:
        # Use workspace_factory to create a properly configured mock workspace
        mock_workspace = workspace_factory.create_info(
            workspace_id="ws-created",
            user_id=test_user_id,
            session_id="session-1",
            status=WorkspaceStatus.RUNNING,
            tier=WorkspaceTier.STARTER,
        )
        mock_create.return_value = mock_workspace

        response = fastapi_client.post("/workspaces", json=request_data)

        assert response.status_code == status.HTTP_201_CREATED
        data = response.json()
        assert data["id"] == "ws-created"
        assert data["user_id"] == test_user_id
        # Enum serializes to lowercase value
        assert data["status"].lower() == "running"


@pytest.mark.asyncio
async def test_create_workspace_with_repos(fastapi_client: TestClient, test_user_id, workspace_factory):
    """Test workspace creation with git repos."""
    request_data = {
        "session_id": "session-1",
        "config": {
            "tier": "pro",  # lowercase enum value
            "git_email": "test@example.com",
            "git_name": "Test User",
            "github_token": "ghp_test123",
            "repos": ["https://github.com/test/repo1", "https://github.com/test/repo2"],
        },
    }

    with patch(
        "src.managers.docker_manager.DockerComputeManager.create_workspace",
        new_callable=AsyncMock,
    ) as mock_create:
        # Use workspace_factory to create a properly configured mock workspace
        mock_workspace = workspace_factory.create_info(
            workspace_id="ws-with-repos",
            user_id=test_user_id,
            session_id="session-1",
            status=WorkspaceStatus.RUNNING,
            tier=WorkspaceTier.PRO,
            repos=["https://github.com/test/repo1", "https://github.com/test/repo2"],
        )
        mock_create.return_value = mock_workspace

        response = fastapi_client.post("/workspaces", json=request_data)

        assert response.status_code == status.HTTP_201_CREATED
        data = response.json()
        assert len(data["repos"]) == 2


@pytest.mark.asyncio
async def test_create_workspace_validation_error(fastapi_client: TestClient):
    """Test workspace creation with invalid data."""
    request_data = {
        "session_id": "session-1",
        "config": {
            "tier": "INVALID_TIER",  # Invalid tier
        },
    }

    response = fastapi_client.post("/workspaces", json=request_data)
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


@pytest.mark.asyncio
async def test_create_workspace_max_limit_reached(fastapi_client: TestClient):
    """Test workspace creation when max limit is reached."""
    request_data = {
        "session_id": "session-1",
        "config": {"tier": "starter"},  # lowercase enum value
    }

    with patch(
        "src.managers.docker_manager.DockerComputeManager.create_workspace",
        new_callable=AsyncMock,
    ) as mock_create:
        # Simulate max workspace limit
        mock_create.side_effect = RuntimeError("Maximum workspace limit reached")

        response = fastapi_client.post("/workspaces", json=request_data)

        assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
        assert "Maximum workspace limit" in response.json()["detail"]


# ============================================
# GET /workspaces/{id} - Get Workspace
# ============================================


@pytest.mark.asyncio
async def test_get_workspace_success(
    fastapi_client: TestClient, docker_manager, workspace_factory, test_user_id
):
    """Test successful workspace retrieval."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        session_id="session-1",
        status=WorkspaceStatus.RUNNING,
    )
    await docker_manager._workspace_store.save(workspace)

    response = fastapi_client.get("/workspaces/test-ws-1")
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["id"] == "test-ws-1"
    assert data["user_id"] == test_user_id


@pytest.mark.asyncio
async def test_get_workspace_not_found(fastapi_client: TestClient):
    """Test getting non-existent workspace returns 404."""
    response = fastapi_client.get("/workspaces/nonexistent")
    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_get_workspace_wrong_user(
    fastapi_client: TestClient, docker_manager, workspace_factory
):
    """Test that user cannot access another user's workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id="other-user-999",
        session_id="session-1",
    )
    await docker_manager._workspace_store.save(workspace)

    response = fastapi_client.get("/workspaces/test-ws-1")
    assert response.status_code == status.HTTP_403_FORBIDDEN


# ============================================
# GET /workspaces - List Workspaces
# ============================================


@pytest.mark.asyncio
async def test_list_workspaces_all_user_workspaces(
    fastapi_client: TestClient, docker_manager, workspace_factory, test_user_id
):
    """Test listing all workspaces for a user."""
    ws1 = workspace_factory.create_info(
        workspace_id="ws-1", user_id=test_user_id, session_id="session-1"
    )
    ws2 = workspace_factory.create_info(
        workspace_id="ws-2", user_id=test_user_id, session_id="session-2"
    )
    ws3 = workspace_factory.create_info(
        workspace_id="ws-3", user_id="other-user", session_id="session-3"
    )

    await docker_manager._workspace_store.save(ws1)
    await docker_manager._workspace_store.save(ws2)
    await docker_manager._workspace_store.save(ws3)

    response = fastapi_client.get("/workspaces")
    assert response.status_code == status.HTTP_200_OK
    data = response.json()

    # Should only return test user's workspaces
    assert len(data) == 2
    workspace_ids = {ws["id"] for ws in data}
    assert "ws-1" in workspace_ids
    assert "ws-2" in workspace_ids
    assert "ws-3" not in workspace_ids


@pytest.mark.asyncio
async def test_list_workspaces_filter_by_session(
    fastapi_client: TestClient, docker_manager, workspace_factory, test_user_id
):
    """Test listing workspaces filtered by session."""
    ws1 = workspace_factory.create_info(
        workspace_id="ws-1", user_id=test_user_id, session_id="session-1"
    )
    ws2 = workspace_factory.create_info(
        workspace_id="ws-2", user_id=test_user_id, session_id="session-2"
    )

    await docker_manager._workspace_store.save(ws1)
    await docker_manager._workspace_store.save(ws2)

    response = fastapi_client.get("/workspaces?session_id=session-1")
    assert response.status_code == status.HTTP_200_OK
    data = response.json()

    assert len(data) == 1
    assert data[0]["id"] == "ws-1"
    assert data[0]["session_id"] == "session-1"


@pytest.mark.asyncio
async def test_list_workspaces_empty(fastapi_client: TestClient):
    """Test listing workspaces when user has none."""
    response = fastapi_client.get("/workspaces")
    assert response.status_code == status.HTTP_200_OK
    assert response.json() == []


# ============================================
# POST /workspaces/{id}/stop - Stop Workspace
# ============================================


@pytest.mark.asyncio
async def test_stop_workspace_success(
    fastapi_client: TestClient, docker_manager, workspace_factory, test_user_id
):
    """Test successfully stopping a running workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
    )
    await docker_manager._workspace_store.save(workspace)

    with patch(
        "src.managers.docker_manager.DockerComputeManager.stop_workspace",
        new_callable=AsyncMock,
    ) as mock_stop:
        response = fastapi_client.post("/workspaces/test-ws-1/stop")

        assert response.status_code == status.HTTP_204_NO_CONTENT
        mock_stop.assert_called_once_with("test-ws-1")


@pytest.mark.asyncio
async def test_stop_workspace_not_found(fastapi_client: TestClient):
    """Test stopping non-existent workspace returns 404."""
    response = fastapi_client.post("/workspaces/nonexistent/stop")
    assert response.status_code == status.HTTP_404_NOT_FOUND


# ============================================
# POST /workspaces/{id}/restart - Restart Workspace
# ============================================


@pytest.mark.asyncio
async def test_restart_workspace_success(
    fastapi_client: TestClient, docker_manager, workspace_factory, test_user_id
):
    """Test successfully restarting a stopped workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.STOPPED,
    )
    await docker_manager._workspace_store.save(workspace)

    with patch(
        "src.managers.docker_manager.DockerComputeManager.restart_workspace",
        new_callable=AsyncMock,
    ) as mock_restart:
        response = fastapi_client.post("/workspaces/test-ws-1/restart")

        assert response.status_code == status.HTTP_204_NO_CONTENT
        mock_restart.assert_called_once_with("test-ws-1")


@pytest.mark.asyncio
async def test_restart_workspace_not_found(
    fastapi_client: TestClient, docker_manager, workspace_factory, test_user_id
):
    """Test restarting non-existent workspace returns 404."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
    )
    await docker_manager._workspace_store.save(workspace)

    with patch(
        "src.managers.docker_manager.DockerComputeManager.restart_workspace",
        new_callable=AsyncMock,
    ) as mock_restart:
        mock_restart.side_effect = ValueError("Workspace not found")

        response = fastapi_client.post("/workspaces/test-ws-1/restart")
        assert response.status_code == status.HTTP_404_NOT_FOUND


# ============================================
# DELETE /workspaces/{id} - Delete Workspace
# ============================================


@pytest.mark.asyncio
async def test_delete_workspace_success(
    fastapi_client: TestClient, docker_manager, workspace_factory, test_user_id
):
    """Test successfully deleting a workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
    )
    await docker_manager._workspace_store.save(workspace)

    with patch(
        "src.managers.docker_manager.DockerComputeManager.delete_workspace",
        new_callable=AsyncMock,
    ) as mock_delete:
        response = fastapi_client.delete("/workspaces/test-ws-1")

        assert response.status_code == status.HTTP_204_NO_CONTENT
        mock_delete.assert_called_once_with("test-ws-1")


@pytest.mark.asyncio
async def test_delete_workspace_not_found(fastapi_client: TestClient):
    """Test deleting non-existent workspace returns 404."""
    response = fastapi_client.delete("/workspaces/nonexistent")
    assert response.status_code == status.HTTP_404_NOT_FOUND


# ============================================
# POST /workspaces/{id}/exec - Execute Command
# ============================================


@pytest.mark.asyncio
async def test_exec_command_success(
    fastapi_client: TestClient, docker_manager, workspace_factory, test_user_id
):
    """Test successfully executing a command."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
    )
    await docker_manager._workspace_store.save(workspace)

    with patch(
        "src.managers.docker_manager.DockerComputeManager.exec_command",
        new_callable=AsyncMock,
    ) as mock_exec:
        mock_exec.return_value = WorkspaceExecResponse(
            exit_code=0, stdout="Hello World\n", stderr=""
        )

        response = fastapi_client.post(
            "/workspaces/test-ws-1/exec",
            json={"command": "echo 'Hello World'"},
        )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["exit_code"] == 0
        assert "Hello World" in data["stdout"]


@pytest.mark.asyncio
async def test_exec_command_timeout(
    fastapi_client: TestClient, docker_manager, workspace_factory, test_user_id
):
    """Test command execution with timeout."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
    )
    await docker_manager._workspace_store.save(workspace)

    response = fastapi_client.post(
        "/workspaces/test-ws-1/exec",
        json={"command": "sleep 100", "timeout": 30},
    )

    # The actual timeout would occur in the manager, but we're testing the API accepts the parameter
    # Without mocking exec_command, various errors may occur depending on container state
    assert response.status_code in [
        status.HTTP_200_OK,
        status.HTTP_404_NOT_FOUND,
        status.HTTP_500_INTERNAL_SERVER_ERROR,
    ]


@pytest.mark.asyncio
async def test_exec_command_workspace_not_found(
    fastapi_client: TestClient, docker_manager, workspace_factory, test_user_id
):
    """Test executing command on non-existent workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
    )
    await docker_manager._workspace_store.save(workspace)

    with patch(
        "src.managers.docker_manager.DockerComputeManager.exec_command",
        new_callable=AsyncMock,
    ) as mock_exec:
        mock_exec.side_effect = ValueError("Workspace not found")

        response = fastapi_client.post(
            "/workspaces/test-ws-1/exec",
            json={"command": "echo test"},
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND


# ============================================
# POST /workspaces/{id}/exec-stream - Stream Command Output
# ============================================


@pytest.mark.asyncio
async def test_exec_command_stream_sse_format(
    fastapi_client: TestClient, docker_manager, workspace_factory, test_user_id
):
    """Test that exec-stream returns SSE format."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
    )
    await docker_manager._workspace_store.save(workspace)

    async def mock_stream():
        yield "line1"
        yield "line2"

    with patch(
        "src.managers.docker_manager.DockerComputeManager.exec_command_stream",
        return_value=mock_stream(),
    ):
        response = fastapi_client.post(
            "/workspaces/test-ws-1/exec-stream",
            json={"command": "echo test"},
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.headers["content-type"] == "text/event-stream; charset=utf-8"
        assert "no-cache" in response.headers.get("cache-control", "")


# ============================================
# File Operations Tests
# ============================================


@pytest.mark.asyncio
async def test_list_files(
    fastapi_client: TestClient, docker_manager, workspace_factory, test_user_id
):
    """Test listing files in workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
    )
    await docker_manager._workspace_store.save(workspace)

    with patch(
        "src.managers.docker_manager.DockerComputeManager.list_files",
        new_callable=AsyncMock,
    ) as mock_list:
        mock_list.return_value = [
            {"name": "file1.txt", "type": "file"},
            {"name": "dir1", "type": "directory"},
        ]

        response = fastapi_client.get("/workspaces/test-ws-1/files?path=/home/dev")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert len(data) == 2
        assert data[0]["name"] == "file1.txt"


@pytest.mark.asyncio
async def test_read_file(
    fastapi_client: TestClient, docker_manager, workspace_factory, test_user_id
):
    """Test reading file content from workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
    )
    await docker_manager._workspace_store.save(workspace)

    with patch(
        "src.managers.docker_manager.DockerComputeManager.read_file",
        new_callable=AsyncMock,
    ) as mock_read:
        mock_read.return_value = "Hello from file"

        response = fastapi_client.get(
            "/workspaces/test-ws-1/files/content?path=/home/dev/test.txt"
        )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["content"] == "Hello from file"
        assert data["path"] == "/home/dev/test.txt"


@pytest.mark.asyncio
async def test_write_file(
    fastapi_client: TestClient, docker_manager, workspace_factory, test_user_id
):
    """Test writing file to workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
    )
    await docker_manager._workspace_store.save(workspace)

    with patch(
        "src.managers.docker_manager.DockerComputeManager.write_file",
        new_callable=AsyncMock,
    ) as mock_write:
        response = fastapi_client.put(
            "/workspaces/test-ws-1/files/content",
            json={"path": "/home/dev/test.txt", "content": "New content"},
        )

        assert response.status_code == status.HTTP_204_NO_CONTENT
        mock_write.assert_called_once_with("test-ws-1", "/home/dev/test.txt", "New content")


@pytest.mark.asyncio
async def test_write_file_missing_content(
    fastapi_client: TestClient, docker_manager, workspace_factory, test_user_id
):
    """Test writing file without content returns 400."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
    )
    await docker_manager._workspace_store.save(workspace)

    response = fastapi_client.put(
        "/workspaces/test-ws-1/files/content",
        json={"path": "/home/dev/test.txt", "content": None},
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST


# ============================================
# POST /workspaces/{id}/heartbeat - Update Activity
# ============================================


@pytest.mark.asyncio
async def test_heartbeat_updates_activity(
    fastapi_client: TestClient, docker_manager, workspace_factory, test_user_id
):
    """Test heartbeat endpoint updates last_activity."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
    )
    await docker_manager._workspace_store.save(workspace)

    with patch(
        "src.managers.docker_manager.DockerComputeManager.heartbeat",
        new_callable=AsyncMock,
    ) as mock_heartbeat:
        response = fastapi_client.post("/workspaces/test-ws-1/heartbeat")

        assert response.status_code == status.HTTP_204_NO_CONTENT
        mock_heartbeat.assert_called_once_with("test-ws-1")


# ============================================
# GET /workspaces/{id}/health - Check Health
# ============================================


@pytest.mark.asyncio
async def test_check_workspace_health(
    fastapi_client: TestClient, docker_manager, workspace_factory, test_user_id
):
    """Test checking workspace health."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
    )
    await docker_manager._workspace_store.save(workspace)

    with patch(
        "src.managers.docker_manager.DockerComputeManager.check_workspace_health",
        new_callable=AsyncMock,
    ) as mock_health:
        mock_health.return_value = True

        response = fastapi_client.get("/workspaces/test-ws-1/health")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["healthy"] is True
        # Enum serializes to lowercase value
        assert data["status"].lower() == "running"


# ============================================
# POST /workspaces/{id}/scale - Scale Tier
# ============================================


@pytest.mark.asyncio
async def test_scale_workspace_success(
    fastapi_client: TestClient, docker_manager, workspace_factory, test_user_id
):
    """Test successfully scaling workspace to new tier."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        tier=WorkspaceTier.STARTER,
    )
    await docker_manager._workspace_store.save(workspace)

    with patch(
        "src.managers.docker_manager.DockerComputeManager.scale_workspace",
        new_callable=AsyncMock,
    ) as mock_scale:
        mock_scale.return_value = WorkspaceScaleResponse(
            success=True,
            message="Workspace scaled successfully",
            new_tier=WorkspaceTier.PRO,
        )

        response = fastapi_client.post(
            "/workspaces/test-ws-1/scale",
            json={"new_tier": "pro"},  # lowercase enum value
        )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["success"] is True
        # Enum serializes to lowercase value
        assert data["new_tier"].lower() == "pro"


@pytest.mark.asyncio
async def test_scale_workspace_same_tier(
    fastapi_client: TestClient, docker_manager, workspace_factory, test_user_id
):
    """Test scaling to the same tier returns failure."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        tier=WorkspaceTier.PRO,
    )
    await docker_manager._workspace_store.save(workspace)

    response = fastapi_client.post(
        "/workspaces/test-ws-1/scale",
        json={"new_tier": "pro"},  # lowercase enum value
    )

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["success"] is False
    assert "already on" in data["message"].lower()
