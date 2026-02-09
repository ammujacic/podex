"""Unit tests for ConfigSyncService pure logic."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.services import config_sync


class FakeScalarResult:
    def __init__(self, value: Any) -> None:
        self._value = value

    def scalar_one_or_none(self) -> Any:
        return self._value


class FakeExecuteResult:
    def __init__(self, items: list[Any]) -> None:
        self._items = items

    def scalars(self) -> Any:
        mock = MagicMock()
        mock.all.return_value = self._items
        return mock


class FakeRedis:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    async def set_json(self, key: str, value: Any, ex: int | None = None) -> None:  # noqa: ARG002
        self.calls.append((key, value))

    async def get_json(self, key: str) -> Any:
        for k, v in self.calls:
            if k == key:
                return v
        return None


class DummyPlatformSetting:
    def __init__(self, key: str, value: Any) -> None:
        self.key = key
        self.value = value


class DummyAgentTool:
    def __init__(self, name: str, category: str = "general") -> None:
        self.name = name
        self.description = "desc"
        self.parameters = {}
        self.category = category
        self.is_system = False
        self.is_read_operation = True
        self.is_write_operation = False
        self.is_command_operation = False
        self.is_deploy_operation = False


class DummyAgentRoleConfig:
    def __init__(self, role: str, name: str) -> None:
        self.role = role
        self.name = name
        self.description = ""
        self.system_prompt = ""
        self.tools = []
        self.category = "general"
        self.color = "#fff"
        self.icon = "icon"
        self.is_system = False


class DummySystemSkill:
    def __init__(self, slug: str) -> None:
        from datetime import UTC, datetime

        self.id = 1
        self.slug = slug
        self.name = slug
        self.description = ""
        self.system_prompt = ""
        self.steps = []
        self.skill_metadata = {"category": "cat", "icon": "i"}
        self.is_active = True
        self.triggers = []
        self.tags = []
        self.required_tools = []
        self.created_at = datetime.now(UTC)
        self.updated_at = datetime.now(UTC)


@pytest.mark.asyncio
async def test_sync_settings_writes_selected_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_redis = FakeRedis()

    async def fake_get_cache_client() -> FakeRedis:
        return fake_redis

    monkeypatch.setattr(config_sync, "get_cache_client", fake_get_cache_client)

    # Fake DB returns a PlatformSetting for each key
    async def fake_execute(_query: Any) -> FakeScalarResult:
        return FakeScalarResult(DummyPlatformSetting("session_defaults", {"foo": "bar"}))

    fake_db = AsyncMock()
    fake_db.execute.side_effect = fake_execute

    service = config_sync.ConfigSyncService(fake_db)
    count = await service.sync_settings()

    # Only keys that exist in DB are counted; in our fake they all return non-None
    assert count == 3
    keys = {k for k, _ in fake_redis.calls}
    assert f"{config_sync.SETTINGS_KEY}:session_defaults" in keys


@pytest.mark.asyncio
async def test_sync_modes_writes_all_modes(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_redis = FakeRedis()

    async def fake_get_cache_client() -> FakeRedis:
        return fake_redis

    monkeypatch.setattr(config_sync, "get_cache_client", fake_get_cache_client)

    service = config_sync.ConfigSyncService(db=AsyncMock())
    count = await service.sync_modes()

    assert count == len(config_sync.AGENT_MODES)
    # Verify names list persisted
    keys = {k for k, _ in fake_redis.calls}
    assert f"{config_sync.MODES_KEY}:names" in keys


@pytest.mark.asyncio
async def test_sync_tools_serializes_enabled_tools(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_redis = FakeRedis()

    async def fake_get_cache_client() -> FakeRedis:
        return fake_redis

    monkeypatch.setattr(config_sync, "get_cache_client", fake_get_cache_client)

    tools = [DummyAgentTool("t1"), DummyAgentTool("t2")]

    async def fake_execute(_query: Any) -> FakeExecuteResult:
        return FakeExecuteResult(tools)

    fake_db = AsyncMock()
    fake_db.execute.side_effect = fake_execute

    service = config_sync.ConfigSyncService(fake_db)
    count = await service.sync_tools()

    assert count == 2
    keys = {k for k, _ in fake_redis.calls}
    assert f"{config_sync.TOOLS_KEY}:all" in keys
    assert f"{config_sync.TOOLS_KEY}:t1" in keys


@pytest.mark.asyncio
async def test_sync_roles_uses_non_delegatable_from_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_redis = FakeRedis()

    async def fake_get_cache_client() -> FakeRedis:
        return fake_redis

    monkeypatch.setattr(config_sync, "get_cache_client", fake_get_cache_client)

    # Pre-populate special_agent_roles in Redis to avoid DB fallback
    non_delegatable = {"non_delegatable_roles": ["admin"]}
    await fake_redis.set_json(f"{config_sync.SETTINGS_KEY}:special_agent_roles", non_delegatable)

    roles = [DummyAgentRoleConfig("admin", "Admin"), DummyAgentRoleConfig("user", "User")]

    async def fake_execute(_query: Any) -> Any:
        # First call is for roles query
        return FakeExecuteResult(roles)

    fake_db = AsyncMock()
    fake_db.execute.side_effect = fake_execute

    service = config_sync.ConfigSyncService(fake_db)
    count = await service.sync_roles()

    assert count == 2
    # Delegatable list should exclude "admin"
    names_key = f"{config_sync.ROLES_KEY}:names"
    delegatable_key = f"{config_sync.ROLES_KEY}:delegatable"
    stored = {k: v for k, v in fake_redis.calls}
    assert "user" in stored[names_key]
    assert any(r["role"] == "user" for r in stored[delegatable_key])


@pytest.mark.asyncio
async def test_sync_skills_writes_slugs(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_redis = FakeRedis()

    async def fake_get_cache_client() -> FakeRedis:
        return fake_redis

    monkeypatch.setattr(config_sync, "get_cache_client", fake_get_cache_client)

    skills = [DummySystemSkill("skill-a"), DummySystemSkill("skill-b")]

    async def fake_execute(_query: Any) -> FakeExecuteResult:
        return FakeExecuteResult(skills)

    fake_db = AsyncMock()
    fake_db.execute.side_effect = fake_execute

    service = config_sync.ConfigSyncService(fake_db)
    count = await service.sync_skills()

    assert count == 2
    stored = {k: v for k, v in fake_redis.calls}
    assert stored[f"{config_sync.SKILLS_KEY}:slugs"] == ["skill-a", "skill-b"]
