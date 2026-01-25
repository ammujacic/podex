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


@pytest.fixture
async def redis_client(redis_url: str) -> AsyncGenerator[RedisClient, None]:
    """Function-scoped Redis client with automatic cleanup.

    Each test gets its own Redis client to avoid event loop conflicts
    with pytest-asyncio's function-scoped event loops.
    """
    client = get_redis_client(redis_url)
    await client.connect()
    # Flush test keys before test
    await _flush_test_keys(client)
    yield client
    # Flush test keys after test
    await _flush_test_keys(client)
    await client.disconnect()


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


class MockWorkspaceStore:
    """In-memory mock workspace store for unit tests without Redis."""

    def __init__(self) -> None:
        self._workspaces: dict[str, Any] = {}
        self._client = None

    async def _get_client(self) -> Any:
        """Mock method for compatibility with init_compute_manager."""
        return self  # Return self since no real Redis client is needed

    async def save(self, workspace: Any) -> None:
        """Save workspace to in-memory store."""
        self._workspaces[workspace.id] = workspace

    async def get(self, workspace_id: str) -> Any | None:
        """Get workspace from in-memory store."""
        return self._workspaces.get(workspace_id)

    async def delete(self, workspace_id: str) -> None:
        """Delete workspace from in-memory store."""
        self._workspaces.pop(workspace_id, None)

    async def list_running(self) -> list[Any]:
        """List running workspaces."""
        from src.models.workspace import WorkspaceStatus
        return [w for w in self._workspaces.values()
                if hasattr(w, 'status') and w.status == WorkspaceStatus.RUNNING]

    async def list_by_user(self, user_id: str) -> list[Any]:
        """List workspaces for a user."""
        return [w for w in self._workspaces.values()
                if hasattr(w, 'user_id') and w.user_id == user_id]

    async def list_by_session(self, session_id: str) -> list[Any]:
        """List workspaces for a session."""
        return [w for w in self._workspaces.values()
                if hasattr(w, 'session_id') and w.session_id == session_id]

    async def list_all(self) -> list[Any]:
        """List all workspaces."""
        return list(self._workspaces.values())


@pytest.fixture
def mock_workspace_store() -> MockWorkspaceStore:
    """Mock workspace store for unit tests without Redis."""
    return MockWorkspaceStore()


@pytest.fixture
async def workspace_store(redis_url: str) -> AsyncGenerator[WorkspaceStore, None]:
    """Fresh WorkspaceStore instance per test (requires Redis).

    Cleans up all workspace keys before and after each test to ensure
    test isolation.
    """
    from src.storage.workspace_store import WorkspaceStore

    store = WorkspaceStore(redis_url=redis_url)
    # Get client and clean up before test
    client = await store._get_client()
    await _flush_test_keys(client)

    yield store

    # Clean up after test - check if client is still connected
    if store._client is not None and store._client._client is not None:
        await _flush_test_keys(store._client)
        await store._client.disconnect()
        store._client = None


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


def create_mock_container(
    container_id: str = "container123",
    name: str = "podex-workspace-test",
    status: str = "running",
    ip_address: str = "172.17.0.2",
) -> MagicMock:
    """Create a properly configured mock Docker container."""
    mock_container = MagicMock()
    mock_container.id = container_id
    mock_container.name = name
    mock_container.status = status
    mock_container.attrs = {
        "NetworkSettings": {
            "Networks": {
                "podex-network": {"IPAddress": ip_address}
            }
        }
    }
    mock_container.reload = MagicMock()
    mock_container.start = MagicMock()
    mock_container.stop = MagicMock()
    mock_container.remove = MagicMock()

    # Mock exec_run for commands - returns (stdout, stderr) tuple
    mock_exec_result = MagicMock()
    mock_exec_result.exit_code = 0
    mock_exec_result.output = (b"ready\n", b"")
    mock_container.exec_run.return_value = mock_exec_result

    return mock_container


@pytest.fixture
def mock_container() -> MagicMock:
    """Create a mock Docker container for testing."""
    return create_mock_container()


@pytest.fixture
async def docker_manager(
    mock_workspace_store: MockWorkspaceStore, mock_container: MagicMock
) -> AsyncGenerator[DockerComputeManager, None]:
    """DockerComputeManager with mocked Docker client for unit tests.

    This fixture patches docker.from_env BEFORE instantiating the manager,
    which is required because DockerComputeManager uses asyncio.to_thread()
    that captures method references at call time.

    Uses MockWorkspaceStore to avoid Redis dependency.
    """
    from unittest.mock import patch
    from src.managers.docker_manager import DockerComputeManager

    mock_docker_client = MagicMock()
    mock_docker_client.containers.run.return_value = mock_container
    # First get raises NotFound (no existing container), subsequent calls return the container
    mock_docker_client.containers.get.return_value = mock_container
    mock_docker_client.containers.list.return_value = []

    with patch("docker.from_env", return_value=mock_docker_client):
        manager = DockerComputeManager(workspace_store=mock_workspace_store)
        # Store the mock client for tests that need to customize behavior
        manager._mock_docker_client = mock_docker_client
        manager._mock_container = mock_container
        yield manager

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
    mock_workspace_store: MockWorkspaceStore,
    mock_gcp_run_client: MagicMock,
    mock_gcp_executions_client: MagicMock,
    mock_gcp_storage_client: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncGenerator[GCPComputeManager, None]:
    """GCPComputeManager with mocked GCP SDK.

    Uses MockWorkspaceStore to avoid Redis dependency.
    Skips tests if GCP SDK is not installed.
    """
    from src.managers.gcp_manager import GCPComputeManager, run_v2

    # Skip if GCP SDK not installed
    if run_v2 is None:
        pytest.skip("GCP SDK (google-cloud-run) not installed")

    # Mock GCP clients
    monkeypatch.setattr("src.managers.gcp_manager.run_v2.JobsAsyncClient", lambda: mock_gcp_run_client)
    monkeypatch.setattr(
        "src.managers.gcp_manager.run_v2.ExecutionsAsyncClient", lambda: mock_gcp_executions_client
    )
    monkeypatch.setattr("src.managers.gcp_manager.storage.Client", lambda: mock_gcp_storage_client)

    manager = GCPComputeManager(workspace_store=mock_workspace_store)
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
def test_internal_api_key(monkeypatch: pytest.MonkeyPatch) -> str:
    """Test internal API key for authentication.

    Sets a non-empty API key so authentication checks are actually enforced.
    """
    test_key = "test-api-key-12345"
    # Set the key in settings so auth checks work
    monkeypatch.setattr(settings, "internal_api_key", test_key)
    return test_key


@pytest.fixture
async def fastapi_client(
    docker_manager: DockerComputeManager,
    test_user_id: str,
    test_internal_api_key: str,
    mock_api_calls: respx.MockRouter,
) -> AsyncGenerator[TestClient, None]:
    """FastAPI TestClient with real routes and dependencies.

    Uses mocked workspace store to avoid Redis connection issues in tests.
    """
    from src.deps import ComputeManagerSingleton
    from src.main import app

    # Initialize compute manager singleton with mock store
    # Setting _workspace_store prevents init_compute_manager from creating a real Redis connection
    ComputeManagerSingleton._instance = docker_manager
    # Use the mock workspace store from docker_manager fixture
    # docker_manager uses mock_workspace_store which doesn't need Redis
    ComputeManagerSingleton._workspace_store = docker_manager._workspace_store

    # Create test client
    with TestClient(app) as client:
        # Set default headers
        client.headers.update({
            "X-User-ID": test_user_id,
            "X-Internal-API-Key": test_internal_api_key,
        })
        yield client

    # Clean up singleton state
    ComputeManagerSingleton._instance = None
    ComputeManagerSingleton._workspace_store = None


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
