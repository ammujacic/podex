"""Shared test fixtures for compute service tests."""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from unittest.mock import AsyncMock, MagicMock

import docker
import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from httpx import AsyncClient, Response

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Generator

    from src.managers.docker_manager import DockerComputeManager
    from src.managers.gcp_manager import GCPComputeManager
    from src.storage.workspace_store import WorkspaceStore

from podex_shared.redis_client import RedisClient, get_redis_client
from src.config import settings
from src.models.workspace import (
    WorkspaceConfig,
    WorkspaceInfo,
    WorkspaceStatus,
    WorkspaceTier,
)


# ============================================
# Redis Fixtures
# ============================================


@pytest.fixture(scope="session")
def redis_url() -> str:
    """Redis URL for testing - use env var or default to redis-test."""
    return os.getenv("COMPUTE_REDIS_URL", "redis://localhost:6379")


@pytest.fixture(scope="session")
async def redis_client_session(redis_url: str) -> AsyncGenerator[RedisClient, None]:
    """Session-scoped Redis client - reused across all tests."""
    client = get_redis_client(redis_url)
    await client.connect()
    yield client
    await client.disconnect()


@pytest.fixture
async def redis_client(redis_client_session: RedisClient) -> AsyncGenerator[RedisClient, None]:
    """Function-scoped Redis client with automatic cleanup."""
    # Flush test keys before test
    await _flush_test_keys(redis_client_session)
    yield redis_client_session
    # Flush test keys after test
    await _flush_test_keys(redis_client_session)


async def _flush_test_keys(client: RedisClient) -> None:
    """Flush all workspace keys from Redis."""
    redis = client.client
    # Scan for all workspace keys
    cursor = 0
    while True:
        cursor, keys = await redis.scan(cursor=cursor, match="workspace:*", count=1000)
        if keys:
            await redis.delete(*keys)
        if cursor == 0:
            break


# ============================================
# WorkspaceStore Fixtures
# ============================================


@pytest.fixture
async def workspace_store(redis_url: str) -> AsyncGenerator[WorkspaceStore, None]:
    """Fresh WorkspaceStore instance per test."""
    from src.storage.workspace_store import WorkspaceStore

    store = WorkspaceStore(redis_url=redis_url)
    yield store
    # Cleanup is handled by redis_client fixture


# ============================================
# Docker Fixtures
# ============================================


@pytest.fixture(scope="session")
def docker_client_session() -> Generator[docker.DockerClient, None, None]:
    """Session-scoped Docker client - reused across all tests."""
    client = docker.from_env()
    yield client
    client.close()


@pytest.fixture
def docker_client(docker_client_session: docker.DockerClient) -> docker.DockerClient:
    """Function-scoped Docker client."""
    return docker_client_session


# ============================================
# Manager Fixtures
# ============================================


@pytest.fixture
async def docker_manager(
    workspace_store: WorkspaceStore, docker_client: docker.DockerClient
) -> AsyncGenerator[DockerComputeManager, None]:
    """DockerComputeManager with real Docker for integration tests."""
    from src.managers.docker_manager import DockerComputeManager

    manager = DockerComputeManager(workspace_store=workspace_store)
    yield manager

    # Cleanup: stop and remove any test containers
    try:
        containers = docker_client.containers.list(
            all=True, filters={"label": "podex.test=true"}
        )
        for container in containers:
            try:
                container.stop(timeout=1)
                container.remove(force=True)
            except Exception:
                pass
    except Exception:
        pass

    # Close HTTP client if it exists
    if manager._http_client and not manager._http_client.is_closed:
        await manager._http_client.aclose()


@pytest.fixture
def mock_gcp_run_client() -> MagicMock:
    """Mock google.cloud.run_v2.JobsAsyncClient."""
    mock = MagicMock()
    mock.create_job = AsyncMock()
    mock.get_job = AsyncMock()
    mock.delete_job = AsyncMock()
    mock.list_jobs = AsyncMock(return_value=[])
    return mock


@pytest.fixture
def mock_gcp_executions_client() -> MagicMock:
    """Mock google.cloud.run_v2.ExecutionsAsyncClient."""
    mock = MagicMock()
    mock.create_execution = AsyncMock()
    mock.get_execution = AsyncMock()
    mock.delete_execution = AsyncMock()
    mock.list_executions = AsyncMock(return_value=[])
    return mock


@pytest.fixture
def mock_gcp_storage_client() -> MagicMock:
    """Mock google.cloud.storage.Client."""
    mock = MagicMock()
    mock.bucket = MagicMock()
    mock.create_bucket = MagicMock()
    return mock


@pytest.fixture
async def gcp_manager(
    workspace_store: WorkspaceStore,
    mock_gcp_run_client: MagicMock,
    mock_gcp_executions_client: MagicMock,
    mock_gcp_storage_client: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncGenerator[GCPComputeManager, None]:
    """GCPComputeManager with mocked GCP SDK."""
    from src.managers.gcp_manager import GCPComputeManager

    # Mock GCP clients
    monkeypatch.setattr("src.managers.gcp_manager.run_v2.JobsAsyncClient", lambda: mock_gcp_run_client)
    monkeypatch.setattr(
        "src.managers.gcp_manager.run_v2.ExecutionsAsyncClient", lambda: mock_gcp_executions_client
    )
    monkeypatch.setattr("src.managers.gcp_manager.storage.Client", lambda: mock_gcp_storage_client)

    manager = GCPComputeManager(workspace_store=workspace_store)
    yield manager

    # Close HTTP client if it exists
    if manager._http_client and not manager._http_client.is_closed:
        await manager._http_client.aclose()


# ============================================
# API Mocking Fixtures
# ============================================


@pytest.fixture
def mock_api_calls() -> Generator[respx.MockRouter, None, None]:
    """Mock API service HTTP calls using respx."""
    with respx.mock:
        # Mock sync_workspace_status_to_api
        respx.post(f"{settings.api_base_url}/internal/workspaces/status").mock(
            return_value=Response(200, json={"success": True})
        )
        # Mock usage tracking
        respx.post(f"{settings.api_base_url}/internal/usage/track").mock(
            return_value=Response(200, json={"success": True})
        )
        yield respx


# ============================================
# FastAPI TestClient Fixtures
# ============================================


@pytest.fixture
def test_user_id() -> str:
    """Test user ID for authentication."""
    return "test-user-123"


@pytest.fixture
def test_internal_api_key() -> str:
    """Test internal API key for authentication."""
    return settings.internal_api_key


@pytest.fixture
async def fastapi_client(
    docker_manager: DockerComputeManager,
    test_user_id: str,
    test_internal_api_key: str,
    mock_api_calls: respx.MockRouter,
) -> AsyncGenerator[TestClient, None]:
    """FastAPI TestClient with real routes and dependencies."""
    from src.deps import ComputeManagerSingleton, init_compute_manager
    from src.main import app

    # Initialize compute manager singleton
    ComputeManagerSingleton.manager = docker_manager
    await init_compute_manager()

    # Create test client
    with TestClient(app) as client:
        # Set default headers
        client.headers.update({
            "X-User-ID": test_user_id,
            "X-Internal-API-Key": test_internal_api_key,
        })
        yield client


# ============================================
# Test Data Factories
# ============================================


@pytest.fixture
def workspace_factory() -> type[WorkspaceFactory]:
    """Factory for creating test WorkspaceInfo instances."""
    return WorkspaceFactory


class WorkspaceFactory:
    """Factory for creating test workspace data."""

    @staticmethod
    def create_info(
        workspace_id: str | None = None,
        user_id: str = "test-user-123",
        session_id: str = "test-session-456",
        status: WorkspaceStatus = WorkspaceStatus.RUNNING,
        tier: WorkspaceTier = WorkspaceTier.STARTER,
        host: str = "127.0.0.1",
        port: int = 3000,
        **kwargs: Any,
    ) -> WorkspaceInfo:
        """Create a WorkspaceInfo instance for testing."""
        workspace_id = workspace_id or f"ws-{uuid.uuid4().hex[:8]}"
        return WorkspaceInfo(
            id=workspace_id,
            user_id=user_id,
            session_id=session_id,
            status=status,
            tier=tier,
            host=host,
            port=port,
            repos=kwargs.pop("repos", []),
            created_at=kwargs.pop("created_at", datetime.now(UTC)),
            last_activity=kwargs.pop("last_activity", datetime.now(UTC)),
            **kwargs,
        )

    @staticmethod
    def create_config(
        tier: WorkspaceTier = WorkspaceTier.STARTER,
        base_image: str | None = None,
        git_email: str | None = None,
        git_name: str | None = None,
        github_token: str | None = None,
        repos: list[str] | None = None,
        post_init_commands: list[str] | None = None,
    ) -> WorkspaceConfig:
        """Create a WorkspaceConfig instance for testing."""
        return WorkspaceConfig(
            tier=tier,
            base_image=base_image,
            git_email=git_email,
            git_name=git_name,
            github_token=github_token,
            repos=repos or [],
            post_init_commands=post_init_commands or [],
        )


@pytest.fixture
async def test_workspace_cleanup() -> AsyncGenerator[list[str], None]:
    """Track and cleanup test workspaces.

    Usage:
        test_workspace_cleanup.append(workspace_id)
    """
    workspace_ids: list[str] = []
    yield workspace_ids

    # Cleanup all tracked workspaces
    if workspace_ids:
        docker_client = docker.from_env()
        for workspace_id in workspace_ids:
            try:
                # Stop and remove container
                container_name = f"podex-workspace-{workspace_id}"
                try:
                    container = docker_client.containers.get(container_name)
                    container.stop(timeout=1)
                    container.remove(force=True)
                except docker.errors.NotFound:
                    pass
            except Exception:
                pass


# ============================================
# Async Test Configuration
# ============================================


@pytest.fixture(scope="session")
def event_loop_policy():
    """Use the default event loop policy."""
    return asyncio.get_event_loop_policy()


# ============================================
# Settings Override Fixtures
# ============================================


@pytest.fixture
def test_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Override settings for testing."""
    monkeypatch.setattr("src.config.settings.environment", "test")
    monkeypatch.setattr("src.config.settings.max_workspaces", 5)
    monkeypatch.setattr("src.config.settings.workspace_idle_timeout_seconds", 300)
