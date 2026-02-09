"""Unit tests for selected server helpers using mocked DB and models."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from starlette.requests import Request
from starlette.responses import Response

from src.database.models import HardwareSpec, ServerStatus, WorkspaceServer
from src.routes import servers as servers_module


def _make_workspace_server_mock() -> WorkspaceServer:
    """Helper to construct a WorkspaceServer-like mock with all fields used by helpers."""
    server = MagicMock(spec=WorkspaceServer)
    server.id = "srv-1"
    server.name = "Server 1"
    server.hostname = "srv1"
    server.ip_address = "127.0.0.1"
    server.docker_port = 2376
    server.status = ServerStatus.ACTIVE
    server.total_cpu = 8
    server.total_memory_mb = 16384
    server.total_disk_gb = 200
    server.total_bandwidth_mbps = 1000
    server.used_cpu = 2.0
    server.used_memory_mb = 2048
    server.used_disk_gb = 20
    server.used_bandwidth_mbps = 100
    server.available_cpu = 6.0
    server.available_memory_mb = 14336
    server.available_disk_gb = 180
    server.available_bandwidth_mbps = 900
    server.active_workspaces = 1
    server.max_workspaces = 10
    server.architecture = "amd64"
    server.region = "us"
    server.labels = {}
    server.has_gpu = False
    server.gpu_type = None
    server.gpu_count = 0
    server.tls_enabled = False
    server.tls_cert_path = None
    server.tls_key_path = None
    server.tls_ca_path = None
    server.compute_service_url = "http://compute"
    server.workspace_image = "img"
    server.workspace_image_arm64 = None
    server.workspace_image_amd64 = None
    server.workspace_image_gpu = None
    server.created_at = datetime.now(UTC)
    server.last_heartbeat = datetime.now(UTC)
    server.is_healthy = True
    server.bandwidth_utilization = 10.0
    return server


def _make_admin_request(path: str = "/") -> Request:
    """Create a minimal Starlette Request with admin user on state for protected endpoints."""
    request = Request({"type": "http", "method": "GET", "path": path, "headers": []})
    request.state.user_id = "admin-user"
    request.state.user_role = "admin"
    request.state.user_email = "admin@example.com"
    return request


def test_server_to_response_maps_fields_and_defaults() -> None:
    """_server_to_response returns expected ServerResponse fields and handles None labels/heartbeat."""
    server = _make_workspace_server_mock()
    server.labels = None
    server.last_heartbeat = None

    resp = servers_module._server_to_response(server)
    assert resp.id == "srv-1"
    assert resp.hostname == "srv1"
    assert resp.available_cpu == 6.0
    # labels should default to {}
    assert resp.labels == {}
    # last_heartbeat should be None when server.last_heartbeat is None
    assert resp.last_heartbeat is None


@pytest.mark.asyncio
async def test_list_servers_for_compute_requires_token(monkeypatch: pytest.MonkeyPatch) -> None:
    """Internal list endpoint enforces internal service token."""
    from src import config as config_module

    monkeypatch.setattr(
        config_module.settings, "INTERNAL_SERVICE_TOKEN", "secret-token", raising=False
    )

    request = MagicMock()
    request.headers = {"X-Internal-Service-Token": "wrong"}

    with pytest.raises(HTTPException) as exc:
        await servers_module.list_servers_for_compute(request=request, db=AsyncMock(), region=None)

    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_list_servers_for_compute_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    """Internal list endpoint returns minimal server info when token is valid."""
    from src import config as config_module

    monkeypatch.setattr(
        config_module.settings, "INTERNAL_SERVICE_TOKEN", "secret-token", raising=False
    )

    server = _make_workspace_server_mock()
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalars.return_value.all.return_value = [server]
    db.execute.return_value = execute_result

    request = MagicMock()
    request.headers = {"X-Internal-Service-Token": "secret-token"}

    result = await servers_module.list_servers_for_compute(request=request, db=db, region=None)

    assert len(result) == 1
    internal = result[0]
    assert internal.id == server.id
    assert internal.hostname == server.hostname
    assert internal.ip_address == str(server.ip_address)
    assert internal.workspace_image == server.workspace_image


def test_tier_capacity_model() -> None:
    """TierCapacity and RegionCapacityResponse hold expected structure."""
    cap = servers_module.TierCapacity(available=True, slots=5)
    assert cap.available is True
    assert cap.slots == 5

    resp = servers_module.RegionCapacityResponse(region="us", tiers={"standard": cap})
    assert resp.region == "us"
    assert "standard" in resp.tiers


def test_server_register_request_defaults_and_tls_validation() -> None:
    """ServerRegisterRequest enforces TLS paths and populates sane defaults."""
    # Defaults when TLS disabled
    req = servers_module.ServerRegisterRequest(
        name="srv",
        hostname="srv1",
        ip_address="127.0.0.1",
        total_cpu=4,
        total_memory_mb=4096,
        total_disk_gb=100,
    )

    assert req.docker_port == 2376
    assert req.total_bandwidth_mbps == 1000
    assert req.architecture == "amd64"
    # workspace_image has a concrete default; just assert it is non-empty
    assert isinstance(req.workspace_image, str) and req.workspace_image

    # When TLS is enabled all paths must be provided
    with pytest.raises(ValueError):
        servers_module.ServerRegisterRequest(
            name="srv",
            hostname="srv1",
            ip_address="127.0.0.1",
            total_cpu=4,
            total_memory_mb=4096,
            total_disk_gb=100,
            tls_enabled=True,
            tls_cert_path=None,
            tls_key_path=None,
            tls_ca_path=None,
        )

    ok_req = servers_module.ServerRegisterRequest(
        name="srv",
        hostname="srv1",
        ip_address="127.0.0.1",
        total_cpu=4,
        total_memory_mb=4096,
        total_disk_gb=100,
        tls_enabled=True,
        tls_cert_path="/cert",
        tls_key_path="/key",
        tls_ca_path="/ca",
    )
    assert ok_req.tls_enabled is True
    assert ok_req.tls_cert_path == "/cert"


def test_server_update_request_validation() -> None:
    """ServerUpdateRequest validates constrained fields like status and architecture."""
    # Valid minimal update
    update = servers_module.ServerUpdateRequest(status="active", architecture="amd64")
    assert update.status == "active"
    assert update.architecture == "amd64"

    # Invalid status should raise a validation error
    with pytest.raises(ValidationError):
        servers_module.ServerUpdateRequest(status="invalid-status")

    # Invalid architecture should raise a validation error
    with pytest.raises(ValidationError):
        servers_module.ServerUpdateRequest(architecture="riscv")


def test_internal_server_response_model_shape() -> None:
    """InternalServerResponse mirrors minimal server fields used by compute service."""
    internal = servers_module.InternalServerResponse(
        id="srv-1",
        hostname="srv1",
        ip_address="127.0.0.1",
        docker_port=2376,
        architecture="amd64",
        region="us",
        compute_service_url="http://compute",
        tls_enabled=False,
        tls_cert_path=None,
        tls_key_path=None,
        tls_ca_path=None,
        workspace_image="img",
        workspace_image_arm64=None,
        workspace_image_amd64=None,
        workspace_image_gpu=None,
    )

    dumped = internal.model_dump()
    assert dumped["hostname"] == "srv1"
    assert dumped["compute_service_url"] == "http://compute"


@pytest.mark.asyncio
async def test_server_heartbeat_updates_usage_and_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """server_heartbeat updates usage metrics and flips status from ERROR to ACTIVE."""
    # Disable slowapi limiter to avoid Redis connections in unit tests
    monkeypatch.setattr(servers_module.limiter, "enabled", False, raising=False)
    server = _make_workspace_server_mock()
    server.status = ServerStatus.ERROR
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = server
    db.execute.return_value = execute_result

    resp = await servers_module.server_heartbeat(
        server_id=server.id,
        request=_make_admin_request("/servers/heartbeat"),
        response=Response(),
        db=db,
        used_cpu=4.0,
        used_memory_mb=8192,
        used_disk_gb=50,
        used_bandwidth_mbps=400,
        active_workspaces=3,
    )

    assert resp.server_id == server.id
    # Status should be flipped to ACTIVE
    assert resp.status == ServerStatus.ACTIVE
    assert resp.active_workspaces == 3
    # Utilization numbers should be non-zero
    assert resp.cpu_utilization > 0
    assert resp.memory_utilization > 0
    assert resp.disk_utilization > 0
    assert resp.bandwidth_utilization > 0


@pytest.mark.asyncio
async def test_get_server_health_calculates_utilization(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_server_health calculates percentages from used/total resources."""
    monkeypatch.setattr(servers_module.limiter, "enabled", False, raising=False)
    server = _make_workspace_server_mock()
    server.used_cpu = 4.0
    server.total_cpu = 8
    server.used_memory_mb = 8192
    server.total_memory_mb = 16384
    server.used_disk_gb = 100
    server.total_disk_gb = 200
    server.used_bandwidth_mbps = 500
    server.total_bandwidth_mbps = 1000

    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = server
    db.execute.return_value = execute_result
    resp = await servers_module.get_server_health(
        server_id=server.id,
        request=_make_admin_request("/servers/health"),
        response=Response(),
        db=db,
    )

    assert resp.cpu_utilization == 50.0
    assert resp.memory_utilization == 50.0
    assert resp.disk_utilization == 50.0
    assert resp.bandwidth_utilization == 50.0


@pytest.mark.asyncio
async def test_get_cluster_status_aggregates_servers(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_cluster_status aggregates totals and builds per-server health list."""
    monkeypatch.setattr(servers_module.limiter, "enabled", False, raising=False)
    s1 = _make_workspace_server_mock()
    s2 = _make_workspace_server_mock()
    s2.id = "srv-2"
    s2.used_cpu = 4.0
    s2.used_memory_mb = 4096
    s2.active_workspaces = 2

    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalars.return_value.all.return_value = [s1, s2]
    db.execute.return_value = execute_result
    resp = await servers_module.get_cluster_status(
        request=_make_admin_request("/servers/cluster/status"),
        response=Response(),
        db=db,
    )

    assert resp.total_servers == 2
    assert resp.active_servers == 2
    assert resp.healthy_servers == 2
    assert resp.total_workspaces == s1.active_workspaces + s2.active_workspaces
    assert len(resp.servers) == 2


@pytest.mark.asyncio
async def test_get_region_capacity_respects_architecture_and_gpu(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """get_region_capacity computes slots and respects architecture/GPU constraints."""
    monkeypatch.setattr(servers_module.limiter, "enabled", False, raising=False)
    # One server with ample resources and a GPU
    server = _make_workspace_server_mock()
    server.available_cpu = 16.0
    server.available_memory_mb = 32768
    server.available_disk_gb = 1000
    server.available_bandwidth_mbps = 1000
    server.has_gpu = True
    server.gpu_type = "nvidia"

    # Two hardware specs: one CPU-only, one GPU-only with architecture constraint
    cpu_spec = MagicMock(spec=HardwareSpec)
    cpu_spec.tier = "standard"
    cpu_spec.vcpu = 2
    cpu_spec.memory_mb = 2048
    cpu_spec.storage_gb = 50
    cpu_spec.bandwidth_mbps = 100
    cpu_spec.architecture = None
    cpu_spec.is_gpu = False
    cpu_spec.gpu_type = None

    gpu_spec = MagicMock(spec=HardwareSpec)
    gpu_spec.tier = "gpu"
    gpu_spec.vcpu = 4
    gpu_spec.memory_mb = 4096
    gpu_spec.storage_gb = 100
    gpu_spec.bandwidth_mbps = 200
    gpu_spec.architecture = "amd64"
    gpu_spec.is_gpu = True
    gpu_spec.gpu_type = "nvidia"

    db = AsyncMock()
    # First execute() call: servers; second: hardware specs
    servers_result = MagicMock()
    servers_result.scalars.return_value.all.return_value = [server]
    specs_result = MagicMock()
    specs_result.scalars.return_value.all.return_value = [cpu_spec, gpu_spec]
    db.execute.side_effect = [servers_result, specs_result]

    resp = await servers_module.get_region_capacity(
        region="us",
        request=Request(
            {
                "type": "http",
                "method": "GET",
                "path": "/servers/capacity/us",
                "headers": [],
            }
        ),
        response=Response(),
        db=db,
    )

    assert resp.region == "us"
    assert "standard" in resp.tiers
    assert "gpu" in resp.tiers
    # Both tiers should be available with at least one slot
    assert resp.tiers["standard"].available is True
    assert resp.tiers["standard"].slots > 0
    assert resp.tiers["gpu"].available is True
    assert resp.tiers["gpu"].slots > 0


@pytest.mark.asyncio
async def test_list_servers_returns_mapped_responses(monkeypatch: pytest.MonkeyPatch) -> None:
    """list_servers returns ServerResponse list from db query."""
    monkeypatch.setattr(servers_module.limiter, "enabled", False, raising=False)
    server = _make_workspace_server_mock()
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalars.return_value.all.return_value = [server]
    db.execute.return_value = execute_result

    result = await servers_module.list_servers(
        request=_make_admin_request("/servers"),
        response=Response(),
        db=db,
        status=None,
        region=None,
    )
    assert len(result) == 1
    assert result[0].id == server.id
    assert result[0].hostname == server.hostname


@pytest.mark.asyncio
async def test_get_server_404_when_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_server raises 404 when server_id does not exist."""
    monkeypatch.setattr(servers_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute.return_value = execute_result

    with pytest.raises(HTTPException) as exc:
        await servers_module.get_server(
            server_id="nonexistent",
            request=_make_admin_request("/servers/nonexistent"),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_get_server_returns_mapped_response(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_server returns ServerResponse when server exists."""
    monkeypatch.setattr(servers_module.limiter, "enabled", False, raising=False)
    server = _make_workspace_server_mock()
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = server
    db.execute.return_value = execute_result

    result = await servers_module.get_server(
        server_id=server.id,
        request=_make_admin_request(f"/servers/{server.id}"),
        response=Response(),
        db=db,
    )
    assert result.id == server.id
    assert result.name == server.name


@pytest.mark.asyncio
async def test_update_server_404_when_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    """update_server raises 404 when server_id does not exist."""
    monkeypatch.setattr(servers_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute.return_value = execute_result

    data = servers_module.ServerUpdateRequest(name="New Name")
    with pytest.raises(HTTPException) as exc:
        await servers_module.update_server(
            server_id="nonexistent",
            request=_make_admin_request("/servers/nonexistent"),
            response=Response(),
            data=data,
            db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_update_server_applies_fields_and_returns_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """update_server updates server and returns ServerResponse."""
    monkeypatch.setattr(servers_module.limiter, "enabled", False, raising=False)
    server = _make_workspace_server_mock()
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = server
    db.execute.return_value = execute_result

    data = servers_module.ServerUpdateRequest(name="Updated Name", status="draining")
    result = await servers_module.update_server(
        server_id=server.id,
        request=_make_admin_request(f"/servers/{server.id}"),
        response=Response(),
        data=data,
        db=db,
    )
    assert result.id == server.id
    assert server.name == "Updated Name"
    assert server.status == "draining"


@pytest.mark.asyncio
async def test_delete_server_404_when_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    """delete_server raises 404 when server_id does not exist."""
    monkeypatch.setattr(servers_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute.return_value = execute_result

    with pytest.raises(HTTPException) as exc:
        await servers_module.delete_server(
            server_id="nonexistent",
            request=_make_admin_request("/servers/nonexistent"),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_server_400_when_has_workspaces_and_not_force(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """delete_server raises 400 when server has active workspaces and force is False."""
    monkeypatch.setattr(servers_module.limiter, "enabled", False, raising=False)
    server = _make_workspace_server_mock()
    server.active_workspaces = 3
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = server
    db.execute.return_value = execute_result

    with pytest.raises(HTTPException) as exc:
        await servers_module.delete_server(
            server_id=server.id,
            request=_make_admin_request(f"/servers/{server.id}"),
            response=Response(),
            db=db,
            force=False,
        )
    assert exc.value.status_code == 400
    assert "active workspaces" in exc.value.detail


@pytest.mark.asyncio
async def test_delete_server_204_when_force_or_no_workspaces(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """delete_server returns 204 when force=True or server has no workspaces."""
    monkeypatch.setattr(servers_module.limiter, "enabled", False, raising=False)
    server = _make_workspace_server_mock()
    server.active_workspaces = 0
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = server
    db.execute.return_value = execute_result

    result = await servers_module.delete_server(
        server_id=server.id,
        request=_make_admin_request(f"/servers/{server.id}"),
        response=Response(),
        db=db,
        force=False,
    )
    assert result is None  # 204 no content
    db.delete.assert_called_once_with(server)
    db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_drain_server_404_when_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    """drain_server raises 404 when server_id does not exist."""
    monkeypatch.setattr(servers_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute.return_value = execute_result

    with pytest.raises(HTTPException) as exc:
        await servers_module.drain_server(
            server_id="nonexistent",
            request=_make_admin_request("/servers/nonexistent/drain"),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_drain_server_sets_draining_and_returns_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """drain_server sets status to DRAINING and returns ServerResponse."""
    monkeypatch.setattr(servers_module.limiter, "enabled", False, raising=False)
    server = _make_workspace_server_mock()
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = server
    db.execute.return_value = execute_result

    result = await servers_module.drain_server(
        server_id=server.id,
        request=_make_admin_request(f"/servers/{server.id}/drain"),
        response=Response(),
        db=db,
    )
    assert result.id == server.id
    assert server.status == ServerStatus.DRAINING


@pytest.mark.asyncio
async def test_activate_server_404_when_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    """activate_server raises 404 when server_id does not exist."""
    monkeypatch.setattr(servers_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute.return_value = execute_result

    with pytest.raises(HTTPException) as exc:
        await servers_module.activate_server(
            server_id="nonexistent",
            request=_make_admin_request("/servers/nonexistent/activate"),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_activate_server_sets_active_and_returns_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """activate_server sets status to ACTIVE and returns ServerResponse."""
    monkeypatch.setattr(servers_module.limiter, "enabled", False, raising=False)
    server = _make_workspace_server_mock()
    server.status = ServerStatus.DRAINING
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = server
    db.execute.return_value = execute_result

    result = await servers_module.activate_server(
        server_id=server.id,
        request=_make_admin_request(f"/servers/{server.id}/activate"),
        response=Response(),
        db=db,
    )
    assert result.id == server.id
    assert server.status == ServerStatus.ACTIVE


@pytest.mark.asyncio
async def test_get_server_workspaces_404_when_server_not_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """get_server_workspaces raises 404 when server_id does not exist."""
    monkeypatch.setattr(servers_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db.execute.return_value = execute_result

    with pytest.raises(HTTPException) as exc:
        await servers_module.get_server_workspaces(
            server_id="nonexistent",
            request=_make_admin_request("/servers/nonexistent/workspaces"),
            response=Response(),
            db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_get_server_workspaces_returns_empty_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """get_server_workspaces returns ServerWorkspacesResponse with empty workspaces."""
    monkeypatch.setattr(servers_module.limiter, "enabled", False, raising=False)
    server = _make_workspace_server_mock()
    db = AsyncMock()
    server_result = MagicMock()
    server_result.scalar_one_or_none.return_value = server
    workspaces_result = MagicMock()
    workspaces_result.scalars.return_value.all.return_value = []
    db.execute.side_effect = [server_result, workspaces_result]

    result = await servers_module.get_server_workspaces(
        server_id=server.id,
        request=_make_admin_request(f"/servers/{server.id}/workspaces"),
        response=Response(),
        db=db,
    )
    assert result.server_id == server.id
    assert result.server_name == server.name
    assert result.workspaces == []
    assert result.total_count == 0


@pytest.mark.asyncio
async def test_register_server_400_when_hostname_exists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """register_server raises 400 when hostname already registered."""
    monkeypatch.setattr(servers_module.limiter, "enabled", False, raising=False)
    db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = _make_workspace_server_mock()  # existing
    db.execute.return_value = execute_result

    data = servers_module.ServerRegisterRequest(
        name="New Server",
        hostname="srv1",
        ip_address="127.0.0.1",
        total_cpu=4,
        total_memory_mb=4096,
        total_disk_gb=100,
    )
    with pytest.raises(HTTPException) as exc:
        await servers_module.register_server(
            request=_make_admin_request("/servers"),
            response=Response(),
            data=data,
            db=db,
        )
    assert exc.value.status_code == 400
    assert "already registered" in exc.value.detail


# register_server 201 path requires real WorkspaceServer + DB (integration test);
# unit test only covers 400 duplicate hostname above.
