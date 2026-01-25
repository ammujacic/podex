"""Tests for WorkspaceStore Redis operations."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from src.models.workspace import WorkspaceStatus, WorkspaceTier
from src.storage.workspace_store import (
    WORKSPACE_TTL_SECONDS,
    WorkspaceStore,
    _session_set_key,
    _status_set_key,
    _user_set_key,
    _workspace_key,
)


# ============================================
# CRUD Operations Tests
# ============================================


@pytest.mark.asyncio
async def test_save_and_get_workspace(workspace_store: WorkspaceStore, workspace_factory):
    """Test saving and retrieving a workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id="user-1",
        session_id="session-1",
        status=WorkspaceStatus.RUNNING,
        tier=WorkspaceTier.STARTER,
    )

    await workspace_store.save(workspace)
    retrieved = await workspace_store.get("test-ws-1")

    assert retrieved is not None
    assert retrieved.id == workspace.id
    assert retrieved.user_id == workspace.user_id
    assert retrieved.session_id == workspace.session_id
    assert retrieved.status == workspace.status
    assert retrieved.tier == workspace.tier


@pytest.mark.asyncio
async def test_get_nonexistent_workspace(workspace_store: WorkspaceStore):
    """Test getting a workspace that doesn't exist returns None."""
    result = await workspace_store.get("nonexistent-ws")
    assert result is None


@pytest.mark.asyncio
async def test_save_updates_existing_workspace(workspace_store: WorkspaceStore, workspace_factory):
    """Test that saving an existing workspace updates it."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        status=WorkspaceStatus.RUNNING,
    )

    await workspace_store.save(workspace)

    # Update status
    workspace.status = WorkspaceStatus.STOPPED
    await workspace_store.save(workspace)

    retrieved = await workspace_store.get("test-ws-1")
    assert retrieved.status == WorkspaceStatus.STOPPED


@pytest.mark.asyncio
async def test_save_sets_ttl(workspace_store: WorkspaceStore, workspace_factory, redis_client):
    """Test that saving a workspace sets TTL."""
    workspace = workspace_factory.create_info(workspace_id="test-ws-1")

    await workspace_store.save(workspace)

    # Check TTL
    key = _workspace_key("test-ws-1")
    ttl = await redis_client.client.ttl(key)

    assert ttl > 0
    assert ttl <= WORKSPACE_TTL_SECONDS


@pytest.mark.asyncio
async def test_delete_workspace(workspace_store: WorkspaceStore, workspace_factory):
    """Test deleting a workspace."""
    workspace = workspace_factory.create_info(workspace_id="test-ws-1")

    await workspace_store.save(workspace)
    assert await workspace_store.get("test-ws-1") is not None

    await workspace_store.delete("test-ws-1")
    assert await workspace_store.get("test-ws-1") is None


@pytest.mark.asyncio
async def test_delete_removes_from_indices(
    workspace_store: WorkspaceStore, workspace_factory, redis_client
):
    """Test that deleting a workspace removes it from all indices."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id="user-1",
        session_id="session-1",
        status=WorkspaceStatus.RUNNING,
    )

    await workspace_store.save(workspace)
    await workspace_store.delete("test-ws-1")

    # Check indices are empty
    redis = redis_client.client
    user_set = await redis.smembers(_user_set_key("user-1"))
    session_set = await redis.smembers(_session_set_key("session-1"))
    status_set = await redis.smembers(_status_set_key(WorkspaceStatus.RUNNING))

    assert "test-ws-1" not in user_set
    assert "test-ws-1" not in session_set
    assert "test-ws-1" not in status_set


# ============================================
# Index Management Tests
# ============================================


@pytest.mark.asyncio
async def test_save_updates_user_index(
    workspace_store: WorkspaceStore, workspace_factory, redis_client
):
    """Test that saving updates the user index."""
    workspace = workspace_factory.create_info(workspace_id="test-ws-1", user_id="user-1")

    await workspace_store.save(workspace)

    redis = redis_client.client
    user_set = await redis.smembers(_user_set_key("user-1"))
    assert "test-ws-1" in user_set


@pytest.mark.asyncio
async def test_save_updates_session_index(
    workspace_store: WorkspaceStore, workspace_factory, redis_client
):
    """Test that saving updates the session index."""
    workspace = workspace_factory.create_info(workspace_id="test-ws-1", session_id="session-1")

    await workspace_store.save(workspace)

    redis = redis_client.client
    session_set = await redis.smembers(_session_set_key("session-1"))
    assert "test-ws-1" in session_set


@pytest.mark.asyncio
async def test_save_updates_status_index(
    workspace_store: WorkspaceStore, workspace_factory, redis_client
):
    """Test that saving updates the status index."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1", status=WorkspaceStatus.RUNNING
    )

    await workspace_store.save(workspace)

    redis = redis_client.client
    status_set = await redis.smembers(_status_set_key(WorkspaceStatus.RUNNING))
    assert "test-ws-1" in status_set


@pytest.mark.asyncio
async def test_status_transition_updates_indices(
    workspace_store: WorkspaceStore, workspace_factory, redis_client
):
    """Test that status transitions update status index correctly."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1", status=WorkspaceStatus.RUNNING
    )

    await workspace_store.save(workspace)

    # Change status
    workspace.status = WorkspaceStatus.STOPPED
    await workspace_store.save(workspace)

    redis = redis_client.client
    running_set = await redis.smembers(_status_set_key(WorkspaceStatus.RUNNING))
    stopped_set = await redis.smembers(_status_set_key(WorkspaceStatus.STOPPED))

    assert "test-ws-1" not in running_set
    assert "test-ws-1" in stopped_set


# ============================================
# Query Operations Tests
# ============================================


@pytest.mark.asyncio
async def test_list_by_user(workspace_store: WorkspaceStore, workspace_factory):
    """Test listing workspaces by user."""
    ws1 = workspace_factory.create_info(workspace_id="ws-1", user_id="user-1")
    ws2 = workspace_factory.create_info(workspace_id="ws-2", user_id="user-1")
    ws3 = workspace_factory.create_info(workspace_id="ws-3", user_id="user-2")

    await workspace_store.save(ws1)
    await workspace_store.save(ws2)
    await workspace_store.save(ws3)

    user1_workspaces = await workspace_store.list_by_user("user-1")
    user1_ids = {ws.id for ws in user1_workspaces}

    assert len(user1_workspaces) == 2
    assert "ws-1" in user1_ids
    assert "ws-2" in user1_ids
    assert "ws-3" not in user1_ids


@pytest.mark.asyncio
async def test_list_by_session(workspace_store: WorkspaceStore, workspace_factory):
    """Test listing workspaces by session."""
    ws1 = workspace_factory.create_info(workspace_id="ws-1", session_id="session-1")
    ws2 = workspace_factory.create_info(workspace_id="ws-2", session_id="session-1")
    ws3 = workspace_factory.create_info(workspace_id="ws-3", session_id="session-2")

    await workspace_store.save(ws1)
    await workspace_store.save(ws2)
    await workspace_store.save(ws3)

    session1_workspaces = await workspace_store.list_by_session("session-1")
    session1_ids = {ws.id for ws in session1_workspaces}

    assert len(session1_workspaces) == 2
    assert "ws-1" in session1_ids
    assert "ws-2" in session1_ids
    assert "ws-3" not in session1_ids


@pytest.mark.asyncio
async def test_list_running(workspace_store: WorkspaceStore, workspace_factory):
    """Test listing only running workspaces."""
    ws1 = workspace_factory.create_info(workspace_id="ws-1", status=WorkspaceStatus.RUNNING)
    ws2 = workspace_factory.create_info(workspace_id="ws-2", status=WorkspaceStatus.RUNNING)
    ws3 = workspace_factory.create_info(workspace_id="ws-3", status=WorkspaceStatus.STOPPED)

    await workspace_store.save(ws1)
    await workspace_store.save(ws2)
    await workspace_store.save(ws3)

    running_workspaces = await workspace_store.list_running()
    running_ids = {ws.id for ws in running_workspaces}

    assert len(running_workspaces) == 2
    assert "ws-1" in running_ids
    assert "ws-2" in running_ids
    assert "ws-3" not in running_ids


@pytest.mark.asyncio
async def test_list_all(workspace_store: WorkspaceStore, workspace_factory):
    """Test listing all workspaces using scan."""
    ws1 = workspace_factory.create_info(workspace_id="ws-1")
    ws2 = workspace_factory.create_info(workspace_id="ws-2")
    ws3 = workspace_factory.create_info(workspace_id="ws-3")

    await workspace_store.save(ws1)
    await workspace_store.save(ws2)
    await workspace_store.save(ws3)

    all_workspaces = await workspace_store.list_all()
    all_ids = {ws.id for ws in all_workspaces}

    assert len(all_workspaces) == 3
    assert "ws-1" in all_ids
    assert "ws-2" in all_ids
    assert "ws-3" in all_ids


@pytest.mark.asyncio
async def test_list_by_ids(workspace_store: WorkspaceStore, workspace_factory):
    """Test loading multiple workspaces by ID."""
    ws1 = workspace_factory.create_info(workspace_id="ws-1")
    ws2 = workspace_factory.create_info(workspace_id="ws-2")
    ws3 = workspace_factory.create_info(workspace_id="ws-3")

    await workspace_store.save(ws1)
    await workspace_store.save(ws2)
    await workspace_store.save(ws3)

    workspaces = await workspace_store.list_by_ids(["ws-1", "ws-3"])
    workspace_ids = {ws.id for ws in workspaces}

    assert len(workspaces) == 2
    assert "ws-1" in workspace_ids
    assert "ws-3" in workspace_ids


@pytest.mark.asyncio
async def test_list_by_ids_with_nonexistent(workspace_store: WorkspaceStore, workspace_factory):
    """Test list_by_ids skips non-existent workspaces."""
    ws1 = workspace_factory.create_info(workspace_id="ws-1")
    await workspace_store.save(ws1)

    workspaces = await workspace_store.list_by_ids(["ws-1", "nonexistent"])
    assert len(workspaces) == 1
    assert workspaces[0].id == "ws-1"


# ============================================
# Heartbeat & Activity Tests
# ============================================


@pytest.mark.asyncio
async def test_update_heartbeat(workspace_store: WorkspaceStore, workspace_factory):
    """Test updating workspace heartbeat."""
    initial_time = datetime.now(UTC) - timedelta(minutes=10)
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1", last_activity=initial_time
    )

    await workspace_store.save(workspace)
    await asyncio.sleep(0.1)  # Small delay to ensure time difference
    await workspace_store.update_heartbeat("test-ws-1")

    retrieved = await workspace_store.get("test-ws-1")
    assert retrieved.last_activity > initial_time


@pytest.mark.asyncio
async def test_heartbeat_extends_ttl(workspace_store: WorkspaceStore, workspace_factory, redis_client):
    """Test that heartbeat extends TTL."""
    workspace = workspace_factory.create_info(workspace_id="test-ws-1")

    await workspace_store.save(workspace)

    # Wait and update heartbeat
    await asyncio.sleep(1)
    await workspace_store.update_heartbeat("test-ws-1")

    # Check TTL is close to maximum
    key = _workspace_key("test-ws-1")
    ttl = await redis_client.client.ttl(key)

    # TTL should be close to the maximum (within 10 seconds)
    assert ttl > (WORKSPACE_TTL_SECONDS - 10)


# ============================================
# Stale Cleanup Tests
# ============================================


@pytest.mark.asyncio
async def test_cleanup_stale_removes_old_workspaces(
    workspace_store: WorkspaceStore, workspace_factory
):
    """Test that cleanup_stale removes old workspaces."""
    old_time = datetime.now(UTC) - timedelta(hours=50)
    recent_time = datetime.now(UTC) - timedelta(minutes=10)

    ws_old = workspace_factory.create_info(
        workspace_id="ws-old", last_activity=old_time, created_at=old_time
    )
    ws_recent = workspace_factory.create_info(
        workspace_id="ws-recent", last_activity=recent_time, created_at=recent_time
    )

    await workspace_store.save(ws_old)
    await workspace_store.save(ws_recent)

    # Cleanup workspaces older than 48 hours
    removed = await workspace_store.cleanup_stale(max_age_seconds=48 * 60 * 60)

    assert "ws-old" in removed
    assert "ws-recent" not in removed

    # Verify old workspace is gone
    assert await workspace_store.get("ws-old") is None
    assert await workspace_store.get("ws-recent") is not None


@pytest.mark.asyncio
async def test_cleanup_stale_respects_threshold(
    workspace_store: WorkspaceStore, workspace_factory
):
    """Test that cleanup_stale respects max_age_seconds threshold."""
    time_30min = datetime.now(UTC) - timedelta(minutes=30)
    time_90min = datetime.now(UTC) - timedelta(minutes=90)

    ws1 = workspace_factory.create_info(
        workspace_id="ws-1", last_activity=time_30min, created_at=time_30min
    )
    ws2 = workspace_factory.create_info(
        workspace_id="ws-2", last_activity=time_90min, created_at=time_90min
    )

    await workspace_store.save(ws1)
    await workspace_store.save(ws2)

    # Cleanup workspaces older than 1 hour
    removed = await workspace_store.cleanup_stale(max_age_seconds=60 * 60)

    assert "ws-1" not in removed
    assert "ws-2" in removed


@pytest.mark.asyncio
async def test_cleanup_stale_returns_removed_ids(
    workspace_store: WorkspaceStore, workspace_factory
):
    """Test that cleanup_stale returns list of removed workspace IDs."""
    old_time = datetime.now(UTC) - timedelta(hours=50)

    ws1 = workspace_factory.create_info(
        workspace_id="ws-1", last_activity=old_time, created_at=old_time
    )
    ws2 = workspace_factory.create_info(
        workspace_id="ws-2", last_activity=old_time, created_at=old_time
    )

    await workspace_store.save(ws1)
    await workspace_store.save(ws2)

    removed = await workspace_store.cleanup_stale(max_age_seconds=48 * 60 * 60)

    assert len(removed) == 2
    assert "ws-1" in removed
    assert "ws-2" in removed


# ============================================
# Concurrency Tests
# ============================================


@pytest.mark.asyncio
async def test_concurrent_saves_dont_corrupt_data(
    workspace_store: WorkspaceStore, workspace_factory
):
    """Test that concurrent saves don't corrupt workspace data."""

    async def save_workspace(workspace_id: str) -> None:
        workspace = workspace_factory.create_info(workspace_id=workspace_id)
        await workspace_store.save(workspace)

    # Save 10 workspaces concurrently
    tasks = [save_workspace(f"ws-{i}") for i in range(10)]
    await asyncio.gather(*tasks)

    # Verify all workspaces exist
    all_workspaces = await workspace_store.list_all()
    assert len(all_workspaces) == 10


@pytest.mark.asyncio
async def test_concurrent_deletes_dont_fail(workspace_store: WorkspaceStore, workspace_factory):
    """Test that concurrent deletes of same workspace don't fail."""
    workspace = workspace_factory.create_info(workspace_id="test-ws-1")
    await workspace_store.save(workspace)

    # Delete same workspace concurrently
    tasks = [workspace_store.delete("test-ws-1") for _ in range(5)]
    await asyncio.gather(*tasks)  # Should not raise

    # Verify workspace is deleted
    assert await workspace_store.get("test-ws-1") is None


# ============================================
# Error Handling Tests
# ============================================


@pytest.mark.asyncio
async def test_get_handles_malformed_json(workspace_store: WorkspaceStore, redis_client):
    """Test that get() handles malformed JSON gracefully."""
    key = _workspace_key("test-ws-1")
    await redis_client.hset(key, "data", "invalid json {")

    result = await workspace_store.get("test-ws-1")
    assert result is None


@pytest.mark.asyncio
async def test_get_handles_wrong_key_type(workspace_store: WorkspaceStore, redis_client):
    """Test that get() handles wrong Redis key type gracefully."""
    key = _workspace_key("test-ws-1")
    # Set as string instead of hash
    await redis_client.client.set(key, "some value")

    result = await workspace_store.get("test-ws-1")
    assert result is None
