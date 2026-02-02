"""Unit tests for task_queue pure-Python helpers with fake Redis."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from src.services import task_queue as tq


class FakeRedisClient:
    """Minimal in-memory Redis stand-in for sorted sets, sets, JSON and publish."""

    def __init__(self) -> None:
        self.json_store: dict[str, Any] = {}
        self.sorted_sets: dict[str, dict[str, float]] = {}
        self.sets: dict[str, set[str]] = {}
        self.pub_messages: list[tuple[str, Any]] = []

        class ClientOps:
            def __init__(self, parent: "FakeRedisClient") -> None:
                self.parent = parent

            async def zadd(self, key: str, mapping: dict[str, float]) -> None:
                zs = self.parent.sorted_sets.setdefault(key, {})
                zs.update(mapping)

            async def zrem(self, key: str, member: str) -> None:
                zs = self.parent.sorted_sets.get(key, {})
                zs.pop(member, None)

            async def zrange(self, key: str, start: int, end: int) -> list[str]:
                zs = self.parent.sorted_sets.get(key, {})
                items = sorted(zs.items(), key=lambda kv: kv[1])
                slice_items = items[start : end + 1 if end >= 0 else None]
                return [task_id for task_id, _score in slice_items]

            async def srem(self, key: str, member: str) -> None:
                self.parent.sets.setdefault(key, set()).discard(member)

            async def smembers(self, key: str) -> set[str]:
                return set(self.parent.sets.get(key, set()))

            async def delete(self, key: str) -> None:
                self.parent.json_store.pop(key, None)

        self.client = ClientOps(self)

    async def set_json(self, key: str, value: Any, ex: int | None = None) -> None:  # noqa: ARG002
        self.json_store[key] = value

    async def get_json(self, key: str) -> Any:
        return self.json_store.get(key)

    async def publish(self, channel: str, payload: Any) -> None:
        self.pub_messages.append((channel, payload))


@pytest.mark.asyncio
async def test_subagent_task_data_roundtrip() -> None:
    now = datetime.now(UTC)
    data = tq.SubagentTaskData(
        id="t1",
        session_id="s1",
        parent_agent_id="agent",
        subagent_type="explore",
        task_description="do something",
        created_at=now,
    )
    d = data.to_dict()
    restored = tq.SubagentTaskData.from_dict(d)
    assert restored.id == "t1"
    assert restored.session_id == "s1"
    assert isinstance(restored.created_at, datetime)


@pytest.mark.asyncio
async def test_subagent_queue_enqueue_and_cancel(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_redis = FakeRedisClient()

    async def fake_get_cache_client() -> FakeRedisClient:
        return fake_redis

    monkeypatch.setattr(tq, "get_cache_client", fake_get_cache_client)

    queue = tq.SubagentTaskQueue()
    task = await queue.enqueue(
        session_id="s1",
        parent_agent_id="p1",
        subagent_type="explore",
        task_description="inspect code",
    )

    # Task should be stored and present in pending zset
    stored = await fake_redis.get_json(tq.SubagentTaskQueue.TASK_KEY.format(task_id=task.id))
    assert stored["id"] == task.id

    pending_key = tq.SubagentTaskQueue.PENDING_KEY.format(session_id="s1")
    pending_ids = await fake_redis.client.zrange(pending_key, 0, -1)
    assert task.id in pending_ids

    # Cancel should update status and move out of queues
    cancelled = await queue.cancel_task(task.id)
    assert cancelled is True

    updated = await queue.get_task(task.id)
    assert updated is not None
    assert updated.status == tq.TaskStatus.CANCELLED


@pytest.mark.asyncio
async def test_agent_task_data_roundtrip() -> None:
    now = datetime.now(UTC)
    data = tq.AgentTaskData(
        id="a1",
        session_id="s1",
        agent_id="agent",
        message="hello",
        message_id="m1",
        created_at=now,
    )
    d = data.to_dict()
    restored = tq.AgentTaskData.from_dict(d)
    assert restored.id == "a1"
    assert restored.message == "hello"
    assert isinstance(restored.created_at, datetime)


@pytest.mark.asyncio
async def test_agent_task_queue_enqueue_and_get(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_redis = FakeRedisClient()

    async def fake_get_cache_client() -> FakeRedisClient:
        return fake_redis

    monkeypatch.setattr(tq, "get_cache_client", fake_get_cache_client)

    queue = tq.AgentTaskQueue()
    task = await queue.enqueue(
        session_id="s1",
        agent_id="agent1",
        message="hi",
        message_id="mid",
    )

    fetched = await queue.get_task(task.id)
    assert fetched is not None
    assert fetched.id == task.id
    assert fetched.message == "hi"


@pytest.mark.asyncio
async def test_compaction_task_data_roundtrip() -> None:
    now = datetime.now(UTC)
    data = tq.CompactionTaskData(
        id="c1",
        agent_id="agent",
        session_id="s1",
        created_at=now,
        tokens_before=100,
        tokens_after=50,
    )
    d = data.to_dict()
    restored = tq.CompactionTaskData.from_dict(d)
    assert restored.tokens_before == 100
    assert restored.tokens_after == 50
    assert restored.status == tq.TaskStatus.PENDING


@pytest.mark.asyncio
async def test_approval_request_data_roundtrip() -> None:
    now = datetime.now(UTC)
    data = tq.ApprovalRequestData(
        approval_id="ap1",
        agent_id="agent",
        session_id="s1",
        tool_name="write_file",
        action_type="file_write",
        arguments={"path": "foo.txt"},
        created_at=now,
    )
    d = data.to_dict()
    restored = tq.ApprovalRequestData.from_dict(d)
    assert restored.approval_id == "ap1"
    assert restored.arguments["path"] == "foo.txt"
    assert isinstance(restored.created_at, datetime)
