"""Tests for preview proxy routes."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import status
from fastapi.testclient import TestClient

from src.models.workspace import WorkspaceStatus


@pytest.mark.asyncio
async def test_get_preview_info(
    fastapi_client: TestClient, workspace_store, workspace_factory, test_user_id
):
    """Test getting preview info for a workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
    )
    await workspace_store.save(workspace)

    with patch(
        "src.managers.docker_manager.DockerComputeManager.get_active_ports",
        new_callable=AsyncMock,
    ) as mock_ports:
        mock_ports.return_value = [
            {"port": 3000, "process_name": "node"},
            {"port": 8080, "process_name": "python"},
        ]

        response = fastapi_client.get("/preview/test-ws-1")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["workspace_id"] == "test-ws-1"
        assert data["status"] == "RUNNING"
        assert len(data["active_ports"]) == 2
        assert data["active_ports"][0]["port"] == 3000
        assert data["preview_base_url"] == "/preview/test-ws-1/proxy"


@pytest.mark.asyncio
async def test_get_preview_info_workspace_not_found(fastapi_client: TestClient):
    """Test getting preview info for non-existent workspace returns 404."""
    response = fastapi_client.get("/preview/nonexistent")
    assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.asyncio
async def test_get_active_ports(
    fastapi_client: TestClient, workspace_store, workspace_factory, test_user_id
):
    """Test getting list of active ports."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
    )
    await workspace_store.save(workspace)

    with patch(
        "src.managers.docker_manager.DockerComputeManager.get_active_ports",
        new_callable=AsyncMock,
    ) as mock_ports:
        mock_ports.return_value = [
            {"port": 5000, "process_name": "flask"},
        ]

        response = fastapi_client.get("/preview/test-ws-1/ports")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert len(data) == 1
        assert data[0]["port"] == 5000
        assert data[0]["process_name"] == "flask"


@pytest.mark.asyncio
async def test_proxy_get_request(
    fastapi_client: TestClient, workspace_store, workspace_factory, test_user_id
):
    """Test proxying GET request to workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
    )
    await workspace_store.save(workspace)

    with patch(
        "src.managers.docker_manager.DockerComputeManager.proxy_request",
        new_callable=AsyncMock,
    ) as mock_proxy:
        mock_proxy.return_value = (
            200,
            {"content-type": "text/html"},
            b"<html>Hello World</html>",
        )

        response = fastapi_client.get("/preview/test-ws-1/proxy/3000/index.html")

        assert response.status_code == status.HTTP_200_OK
        assert b"Hello World" in response.content
        assert "text/html" in response.headers.get("content-type", "")


@pytest.mark.asyncio
async def test_proxy_post_request(
    fastapi_client: TestClient, workspace_store, workspace_factory, test_user_id
):
    """Test proxying POST request to workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
    )
    await workspace_store.save(workspace)

    with patch(
        "src.managers.docker_manager.DockerComputeManager.proxy_request",
        new_callable=AsyncMock,
    ) as mock_proxy:
        mock_proxy.return_value = (
            201,
            {"content-type": "application/json"},
            b'{"status": "created"}',
        )

        response = fastapi_client.post(
            "/preview/test-ws-1/proxy/8000/api/users",
            json={"name": "Test User"},
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert b"created" in response.content


@pytest.mark.asyncio
async def test_proxy_workspace_not_found(
    fastapi_client: TestClient, workspace_store, workspace_factory, test_user_id
):
    """Test proxy request to non-existent workspace returns 404."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
    )
    await workspace_store.save(workspace)

    with patch(
        "src.managers.docker_manager.DockerComputeManager.proxy_request",
        new_callable=AsyncMock,
    ) as mock_proxy:
        mock_proxy.side_effect = ValueError("Workspace not found")

        response = fastapi_client.get("/preview/test-ws-1/proxy/3000/")

        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.asyncio
async def test_proxy_workspace_not_running(
    fastapi_client: TestClient, workspace_store, workspace_factory, test_user_id
):
    """Test proxy request when workspace is not running returns 503."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
    )
    await workspace_store.save(workspace)

    with patch(
        "src.managers.docker_manager.DockerComputeManager.proxy_request",
        new_callable=AsyncMock,
    ) as mock_proxy:
        mock_proxy.side_effect = ValueError("Workspace is not running")

        response = fastapi_client.get("/preview/test-ws-1/proxy/3000/")

        assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE


@pytest.mark.asyncio
async def test_proxy_connection_error(
    fastapi_client: TestClient, workspace_store, workspace_factory, test_user_id
):
    """Test proxy request when connection fails returns 502."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
    )
    await workspace_store.save(workspace)

    with patch(
        "src.managers.docker_manager.DockerComputeManager.proxy_request",
        new_callable=AsyncMock,
    ) as mock_proxy:
        mock_proxy.side_effect = ValueError("Could not connect to workspace")

        response = fastapi_client.get("/preview/test-ws-1/proxy/3000/")

        assert response.status_code == status.HTTP_502_BAD_GATEWAY


@pytest.mark.asyncio
async def test_proxy_timeout(
    fastapi_client: TestClient, workspace_store, workspace_factory, test_user_id
):
    """Test proxy request timeout returns 504."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
    )
    await workspace_store.save(workspace)

    with patch(
        "src.managers.docker_manager.DockerComputeManager.proxy_request",
        new_callable=AsyncMock,
    ) as mock_proxy:
        mock_proxy.side_effect = ValueError("Request timed out")

        response = fastapi_client.get("/preview/test-ws-1/proxy/3000/")

        assert response.status_code == status.HTTP_504_GATEWAY_TIMEOUT


@pytest.mark.asyncio
async def test_proxy_default_port(
    fastapi_client: TestClient, workspace_store, workspace_factory, test_user_id
):
    """Test proxying to default port 3000."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
    )
    await workspace_store.save(workspace)

    with patch(
        "src.managers.docker_manager.DockerComputeManager.proxy_request",
        new_callable=AsyncMock,
    ) as mock_proxy:
        mock_proxy.return_value = (
            200,
            {"content-type": "text/html"},
            b"<html>App</html>",
        )

        response = fastapi_client.get("/preview/test-ws-1/app/")

        assert response.status_code == status.HTTP_200_OK
        # Verify it was called with port 3000
        call_args = mock_proxy.call_args[0][0]
        assert call_args.port == 3000
