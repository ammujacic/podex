"""Redis-backed workspace state storage for compute service."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any, cast

import structlog

if TYPE_CHECKING:
    from collections.abc import Iterable

from podex_shared.redis_client import RedisClient, get_redis_client
from src.config import settings
from src.models.workspace import WorkspaceInfo, WorkspaceStatus

logger = structlog.get_logger()


WORKSPACE_TTL_SECONDS = 24 * 60 * 60  # 24 hours


def _workspace_key(workspace_id: str) -> str:
    return f"workspace:{workspace_id}"


def _user_set_key(user_id: str) -> str:
    return f"workspace:user:{user_id}"


def _session_set_key(session_id: str) -> str:
    return f"workspace:session:{session_id}"


def _status_set_key(status: WorkspaceStatus | str) -> str:
    status_value = status.value if isinstance(status, WorkspaceStatus) else status
    return f"workspace:status:{status_value}"


class WorkspaceStore:
    """Redis-backed workspace state storage.

    This store is the source of truth for workspace metadata across compute
    instances. Compute managers should use it instead of keeping their own
    in-memory registries.
    """

    def __init__(self, redis_url: str | None = None) -> None:
        self._redis_url = redis_url or settings.redis_url
        self._client: RedisClient | None = None

    async def _get_client(self) -> RedisClient:
        """Get or create the Redis client and ensure it's connected."""
        if self._client is None:
            self._client = get_redis_client(self._redis_url)
        await self._client.connect()
        return self._client

    async def save(self, workspace: WorkspaceInfo) -> None:
        """Save or update a workspace."""
        client = await self._get_client()
        now = datetime.now(UTC)
        await self._write_workspace(client, workspace, now)

    async def _write_workspace(
        self,
        client: RedisClient,
        workspace: WorkspaceInfo,
        updated_at: datetime,
    ) -> None:
        """Internal helper to write workspace and update indices."""
        key = _workspace_key(workspace.id)
        data: dict[str, Any] = workspace.model_dump(mode="json")
        data["updated_at"] = updated_at.isoformat()

        # Store JSON blob in 'data' field
        await client.hset(key, "data", json.dumps(data))

        # Set TTL
        await client.expire(key, WORKSPACE_TTL_SECONDS)

        # Update indices
        redis = client.client
        await redis.sadd(_user_set_key(workspace.user_id), workspace.id)
        await redis.sadd(_session_set_key(workspace.session_id), workspace.id)

        # Status index
        for status in WorkspaceStatus:
            await redis.srem(_status_set_key(status), workspace.id)
        await redis.sadd(_status_set_key(workspace.status), workspace.id)

    async def get(self, workspace_id: str) -> WorkspaceInfo | None:
        """Get workspace information."""
        client = await self._get_client()
        key = _workspace_key(workspace_id)

        try:
            # Check if key exists and is a hash
            key_type = await client.client.type(key)
            if key_type != "hash":
                logger.debug(
                    "Key is not a hash, skipping",
                    workspace_id=workspace_id,
                    key_type=key_type,
                )
                return None

            data_json = await client.hget(key, "data")
            if not data_json:
                return None

            try:
                data: dict[str, Any] = json.loads(data_json)
                # Remove store-only fields before validation
                data.pop("updated_at", None)
                workspace = WorkspaceInfo.model_validate(data)
            except Exception:
                logger.exception("Failed to decode workspace from Redis", workspace_id=workspace_id)
                return None

            return workspace
        except Exception as e:
            # Handle WRONGTYPE and other Redis errors gracefully
            logger.debug(
                "Error reading workspace from Redis",
                workspace_id=workspace_id,
                error=str(e),
            )
            return None

    async def delete(self, workspace_id: str) -> None:
        """Delete workspace and all indices."""
        client = await self._get_client()
        key = _workspace_key(workspace_id)

        workspace = await self.get(workspace_id)
        await client.delete(key)

        if not workspace:
            return

        redis = client.client
        await redis.srem(_user_set_key(workspace.user_id), workspace.id)
        await redis.srem(_session_set_key(workspace.session_id), workspace.id)
        for status in WorkspaceStatus:
            await redis.srem(_status_set_key(status), workspace.id)

    async def list_by_ids(self, workspace_ids: Iterable[str]) -> list[WorkspaceInfo]:
        """Load multiple workspaces by ID."""
        results: list[WorkspaceInfo] = []
        for wid in workspace_ids:
            ws = await self.get(wid)
            if ws:
                results.append(ws)
        return results

    async def list_by_user(self, user_id: str) -> list[WorkspaceInfo]:
        """List workspaces for a user."""
        client = await self._get_client()
        redis = client.client
        ids = await redis.smembers(_user_set_key(user_id))
        return await self.list_by_ids(ids)

    async def list_by_session(self, session_id: str) -> list[WorkspaceInfo]:
        """List workspaces for a session."""
        client = await self._get_client()
        redis = client.client
        ids = await redis.smembers(_session_set_key(session_id))
        return await self.list_by_ids(ids)

    async def list_running(self) -> list[WorkspaceInfo]:
        """List all running workspaces."""
        client = await self._get_client()
        redis = client.client
        ids = await redis.smembers(_status_set_key(WorkspaceStatus.RUNNING))
        return await self.list_by_ids(ids)

    async def list_all(self) -> list[WorkspaceInfo]:
        """List all known workspaces (scan)."""
        client = await self._get_client()
        redis = client.client
        cursor = 0
        ids: list[str] = []

        pattern = "workspace:*"
        while True:
            cursor, keys = await redis.scan(cursor=cursor, match=pattern, count=100)
            for raw_key in keys:
                # Extract workspace_id from key
                key_str = raw_key.decode() if isinstance(raw_key, bytes) else raw_key
                if not isinstance(key_str, str):
                    continue

                # Skip index keys (workspace:user:*, workspace:session:*, workspace:status:*)
                if ":" in key_str[10:]:  # After "workspace:"
                    continue

                # Only process direct workspace keys (workspace:{id})
                if key_str.startswith("workspace:"):
                    workspace_id = key_str.split(":", 1)[1]
                    # Verify it's a hash before adding to list
                    try:
                        key_type = await redis.type(key_str)
                        if key_type == "hash":
                            ids.append(workspace_id)
                    except Exception:
                        # Skip keys that cause errors (logged at debug level)
                        logger.debug("Error checking key type", key=key_str)
            if cursor == 0:
                break

        return await self.list_by_ids(ids)

    async def update_heartbeat(self, workspace_id: str) -> None:
        """Update last_activity and extend TTL."""
        client = await self._get_client()
        workspace = await self.get(workspace_id)
        if not workspace:
            return

        now = datetime.now(UTC)
        workspace.last_activity = now
        await self._write_workspace(client, workspace, now)

    async def cleanup_stale(self, max_age_seconds: int) -> list[str]:
        """Remove workspaces whose updated_at is too old.

        This is a defensive cleanup on top of key TTLs to handle cases where
        TTL wasn't set correctly or was extended incorrectly.
        """
        client = await self._get_client()
        redis = client.client

        now = datetime.now(UTC)
        threshold = now - timedelta(seconds=max_age_seconds)
        removed: list[str] = []

        cursor = 0
        pattern = "workspace:*"
        while True:
            cursor, keys = await redis.scan(cursor=cursor, match=pattern, count=100)
            for key in keys:
                key_str = key.decode() if isinstance(key, bytes) else key
                if not isinstance(key_str, str) or not key_str.startswith("workspace:"):
                    continue

                # Skip index keys (workspace:user:*, workspace:session:*, workspace:status:*)
                if ":" in key_str[10:]:  # After "workspace:"
                    continue

                workspace_id = key_str.split(":", 1)[1]

                # Check if key is a hash before calling hget
                try:
                    key_type = await redis.type(key_str)
                    if key_type != "hash":
                        continue
                except Exception:
                    logger.debug("Error checking key type during stale cleanup", key=key_str)
                    continue

                try:
                    data_json = await client.hget(key_str, "data")
                except Exception as e:
                    logger.debug(
                        "Error reading workspace during stale cleanup",
                        workspace_id=workspace_id,
                        error=str(e),
                    )
                    continue

                if not data_json:
                    await client.delete(key_str)
                    removed.append(workspace_id)
                    continue

                try:
                    data: dict[str, Any] = json.loads(data_json)
                    updated_at_str = data.get("updated_at")
                    updated_at = datetime.fromisoformat(updated_at_str) if updated_at_str else None
                    # Also validate that we can deserialize workspace
                    data.pop("updated_at", None)
                    workspace = WorkspaceInfo.model_validate(data)
                except Exception:
                    logger.exception(
                        "Failed to decode workspace during stale cleanup",
                        workspace_id=workspace_id,
                    )
                    await client.delete(key_str)
                    removed.append(workspace_id)
                    continue

                effective_time = updated_at or workspace.last_activity
                if effective_time < threshold:
                    await self.delete(workspace_id)
                    removed.append(workspace_id)

            if cursor == 0:
                break

        if removed:
            logger.info("Cleaned up stale workspaces in Redis", count=len(removed))

        return removed

    async def update_metrics(
        self,
        workspace_id: str,
        metrics: dict[str, Any],
    ) -> None:
        """Store resource metrics for a workspace.

        Args:
            workspace_id: The workspace ID
            metrics: Metrics dict from parse_container_stats
        """
        client = await self._get_client()
        key = f"workspace:{workspace_id}:metrics"
        await client.client.set(key, json.dumps(metrics), ex=120)  # 2 min TTL

    async def get_metrics(self, workspace_id: str) -> dict[str, Any] | None:
        """Get resource metrics for a workspace.

        Args:
            workspace_id: The workspace ID

        Returns:
            Metrics dict or None if not found
        """
        client = await self._get_client()
        key = f"workspace:{workspace_id}:metrics"
        data = await client.client.get(key)
        if not data:
            return None
        try:
            return cast("dict[str, Any]", json.loads(data))
        except json.JSONDecodeError:
            return None
