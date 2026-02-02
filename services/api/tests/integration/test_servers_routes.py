"""Integration tests for /servers routes.

These tests exercise:
- Admin auth requirements
- CRUD behavior for servers (list/get/update/delete)
- Internal list endpoint token validation
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models.server import ServerStatus, WorkspaceServer
from src.routes import servers as servers_module


def _make_server(
    *,
    server_id: str = "srv-1",
    hostname: str = "srv-1",
    region: str | None = "us",
    active_workspaces: int = 0,
) -> WorkspaceServer:
    """Helper to construct a WorkspaceServer ORM instance with sensible defaults."""
    now = datetime.now(UTC)
    return WorkspaceServer(
        id=server_id,
        name="Server 1",
        hostname=hostname,
        ip_address="127.0.0.1",
        docker_port=2376,
        ssh_port=22,
        total_cpu=8,
        total_memory_mb=16_384,
        total_disk_gb=200,
        total_bandwidth_mbps=1_000,
        used_cpu=1.0,
        used_memory_mb=1_024,
        used_disk_gb=10,
        used_bandwidth_mbps=100,
        active_workspaces=active_workspaces,
        max_workspaces=10,
        status=ServerStatus.ACTIVE,
        last_heartbeat=now,
        has_gpu=False,
        gpu_type=None,
        gpu_count=0,
        docker_runtime="runsc",
        architecture="amd64",
        labels={},
        region=region,
        provider="test",
        compute_service_url="http://compute-test",
        workspace_image="ghcr.io/mujacica/workspace:latest",
        workspace_image_arm64=None,
        workspace_image_amd64=None,
        workspace_image_gpu=None,
        created_at=now,
        updated_at=now,
    )


@pytest.mark.asyncio
async def test_list_servers_requires_admin(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """Non-admin auth should be rejected by /servers list endpoint."""
    response = await test_client.get("/api/servers", headers=auth_headers_with_db)

    # Depending on middleware, this may be 401 or 403; both mean "not allowed".
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_list_and_get_server_happy_path(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    admin_headers_with_db: dict[str, str],
) -> None:
    """Admin can list and fetch a registered server."""
    sid = f"srv-{uuid4()}"
    server = _make_server(server_id=sid, hostname=sid)
    integration_db.add(server)
    await integration_db.commit()
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["servers"].append(server.id)

    list_resp = await test_client.get("/api/servers", headers=admin_headers_with_db)
    assert list_resp.status_code == 200
    servers = list_resp.json()
    assert isinstance(servers, list)
    assert any(s["id"] == server.id for s in servers)

    get_resp = await test_client.get(f"/api/servers/{server.id}", headers=admin_headers_with_db)
    assert get_resp.status_code == 200
    data = get_resp.json()
    assert data["id"] == server.id
    assert data["hostname"] == server.hostname


@pytest.mark.asyncio
async def test_get_server_not_found(
    test_client: AsyncClient,
    admin_headers_with_db: dict[str, str],
) -> None:
    """Fetching a non-existent server should return 404."""
    resp = await test_client.get("/api/servers/does-not-exist", headers=admin_headers_with_db)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Server not found"


@pytest.mark.asyncio
async def test_update_server_mutates_fields(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    admin_headers_with_db: dict[str, str],
) -> None:
    """PATCH /servers/{id} should update mutable fields."""
    sid = f"srv-{uuid4()}"
    server = _make_server(server_id=sid, hostname=sid)
    integration_db.add(server)
    await integration_db.commit()
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["servers"].append(server.id)

    payload = {
        "name": "Updated Name",
        "status": ServerStatus.DRAINING,
        "labels": {"env": "test"},
        "max_workspaces": 20,
        "region": "eu",
        "architecture": "arm64",
    }

    resp = await test_client.patch(
        f"/api/servers/{server.id}",
        headers=admin_headers_with_db,
        json=payload,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Updated Name"
    assert data["status"] == ServerStatus.DRAINING
    assert data["labels"] == {"env": "test"}
    assert data["max_workspaces"] == 20
    assert data["region"] == "eu"
    assert data["architecture"] == "arm64"


@pytest.mark.asyncio
async def test_delete_server_with_active_workspaces_requires_force(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    admin_headers_with_db: dict[str, str],
) -> None:
    """Deleting a server with active workspaces should require force=true."""
    sid = f"srv-{uuid4()}"
    server = _make_server(
        server_id=sid, hostname=sid, active_workspaces=2
    )
    integration_db.add(server)
    await integration_db.commit()
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["servers"].append(server.id)

    # Without force flag -> 400
    resp = await test_client.delete(
        f"/api/servers/{server.id}",
        headers=admin_headers_with_db,
    )
    assert resp.status_code == 400
    assert "active workspaces" in resp.json()["detail"]

    # With force flag -> 204 and server removed
    resp_force = await test_client.delete(
        f"/api/servers/{server.id}?force=true",
        headers=admin_headers_with_db,
    )
    assert resp_force.status_code == 204

    # Verify deletion at the DB level
    result = await integration_db.execute(
        select(WorkspaceServer).where(WorkspaceServer.id == server.id)
    )
    assert result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_internal_list_requires_valid_internal_token(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Internal list endpoint should enforce INTERNAL_SERVICE_TOKEN."""
    sid = f"internal-{uuid4()}"
    server = _make_server(server_id=sid, hostname=sid, region="us")
    integration_db.add(server)
    await integration_db.commit()
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["servers"].append(server.id)

    # Configure internal service token
    from src import config as config_module

    monkeypatch.setattr(
        config_module.settings, "INTERNAL_SERVICE_TOKEN", "secret-token", raising=False
    )

    # Missing/invalid token -> 401
    bad_resp = await test_client.get("/api/servers/internal/list")
    assert bad_resp.status_code == 401

    # Valid token -> server is returned
    ok_resp = await test_client.get(
        "/api/servers/internal/list",
        headers={"X-Internal-Service-Token": "secret-token"},
    )
    assert ok_resp.status_code == 200
    items = ok_resp.json()
    assert any(item["id"] == server.id for item in items)


@pytest.mark.asyncio
async def test_register_server_duplicate_hostname_returns_400(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    admin_headers_with_db: dict[str, str],
) -> None:
    """POST /servers with an already-registered hostname should return 400."""
    hostname = f"dup-{uuid4()}"
    sid = f"srv-{uuid4()}"
    server = _make_server(server_id=sid, hostname=hostname, region="us")
    integration_db.add(server)
    await integration_db.commit()
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["servers"].append(server.id)

    payload = {
        "name": "Other Server",
        "hostname": hostname,
        "ip_address": "192.168.1.2",
        "docker_port": 2376,
        "total_cpu": 4,
        "total_memory_mb": 8192,
        "total_disk_gb": 100,
        "total_bandwidth_mbps": 500,
        "architecture": "amd64",
    }

    resp = await test_client.post(
        "/api/servers",
        headers=admin_headers_with_db,
        json=payload,
    )
    assert resp.status_code == 400
    assert "already registered" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_list_servers_filter_by_status_and_region(
    test_client: AsyncClient,
    integration_db: AsyncSession,
    admin_headers_with_db: dict[str, str],
) -> None:
    """GET /servers?status=active&region=us should return only matching servers."""
    us_id, eu_id = f"us-{uuid4()}", f"eu-{uuid4()}"
    us_server = _make_server(server_id=us_id, hostname=us_id, region="us")
    eu_server = _make_server(server_id=eu_id, hostname=eu_id, region="eu")
    integration_db.add(us_server)
    integration_db.add(eu_server)
    await integration_db.commit()
    if hasattr(integration_db, "_test_created_ids"):
        integration_db._test_created_ids["servers"].extend([us_server.id, eu_server.id])

    resp = await test_client.get(
        "/api/servers",
        headers=admin_headers_with_db,
        params={"status": ServerStatus.ACTIVE, "region": "us"},
    )
    assert resp.status_code == 200
    servers = resp.json()
    assert all(s["region"] == "us" and s["status"] == ServerStatus.ACTIVE for s in servers)
    assert any(s["id"] == us_id for s in servers)
    assert not any(s["id"] == eu_id for s in servers)
