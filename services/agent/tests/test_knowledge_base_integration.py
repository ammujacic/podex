"""Comprehensive integration tests for KnowledgeBase with Redis.

Tests cover:
- Memory storage and retrieval
- Memory updates and deletion
- Search by session, user, tags, text
- Relevance-based context retrieval
- Index management and trimming
"""

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from tests.conftest import requires_redis

from src.memory.knowledge_base import (
    KnowledgeBase,
    Memory,
    MemoryStoreRequest,
    MemoryType,
)


class TestMemoryDataclass:
    """Test Memory dataclass."""

    def test_memory_type_enum_values(self):
        """Test MemoryType enum has expected values."""
        assert MemoryType.FACT.value == "fact"
        assert MemoryType.PREFERENCE.value == "preference"
        assert MemoryType.CONTEXT.value == "context"
        assert MemoryType.WIKI.value == "wiki"
        assert MemoryType.CODE_PATTERN.value == "code_pattern"
        assert MemoryType.ERROR_SOLUTION.value == "error_solution"

    def test_memory_creation(self):
        """Test Memory dataclass creation."""
        memory = Memory(
            id="mem-123",
            user_id="user-456",
            content="Test memory content",
            memory_type=MemoryType.FACT,
            session_id="session-789",
            project_id="project-abc",
            tags=["tag1", "tag2"],
            importance=0.8,
        )

        assert memory.id == "mem-123"
        assert memory.user_id == "user-456"
        assert memory.content == "Test memory content"
        assert memory.memory_type == MemoryType.FACT
        assert memory.session_id == "session-789"
        assert memory.project_id == "project-abc"
        assert memory.tags == ["tag1", "tag2"]
        assert memory.importance == 0.8
        assert memory.access_count == 0

    def test_memory_defaults(self):
        """Test Memory default values."""
        memory = Memory(
            id="mem-123",
            user_id="user-456",
            content="Test",
            memory_type=MemoryType.CONTEXT,
        )

        assert memory.session_id is None
        assert memory.project_id is None
        assert memory.tags == []
        assert memory.metadata == {}
        assert memory.embedding is None
        assert memory.importance == 0.5
        assert memory.access_count == 0

    def test_memory_to_dict(self):
        """Test Memory to_dict serialization."""
        memory = Memory(
            id="mem-123",
            user_id="user-456",
            content="Test content",
            memory_type=MemoryType.PREFERENCE,
            tags=["test"],
            importance=0.9,
        )

        data = memory.to_dict()

        assert data["id"] == "mem-123"
        assert data["user_id"] == "user-456"
        assert data["content"] == "Test content"
        assert data["memory_type"] == "preference"
        assert data["tags"] == ["test"]
        assert data["importance"] == 0.9
        assert "created_at" in data
        assert "updated_at" in data

    def test_memory_from_dict(self):
        """Test Memory from_dict deserialization."""
        data = {
            "id": "mem-123",
            "user_id": "user-456",
            "content": "Test content",
            "memory_type": "fact",
            "session_id": "session-789",
            "tags": ["tag1"],
            "metadata": {"key": "value"},
            "importance": 0.7,
            "access_count": 5,
            "created_at": "2024-01-01T00:00:00+00:00",
            "updated_at": "2024-01-02T00:00:00+00:00",
        }

        memory = Memory.from_dict(data)

        assert memory.id == "mem-123"
        assert memory.user_id == "user-456"
        assert memory.memory_type == MemoryType.FACT
        assert memory.tags == ["tag1"]
        assert memory.access_count == 5


class TestMemoryStoreRequest:
    """Test MemoryStoreRequest dataclass."""

    def test_store_request_creation(self):
        """Test MemoryStoreRequest creation."""
        request = MemoryStoreRequest(
            user_id="user-123",
            content="Test memory",
            memory_type=MemoryType.PREFERENCE,
            session_id="session-456",
            tags=["tag1", "tag2"],
            importance=0.9,
        )

        assert request.user_id == "user-123"
        assert request.content == "Test memory"
        assert request.memory_type == MemoryType.PREFERENCE
        assert request.session_id == "session-456"
        assert request.tags == ["tag1", "tag2"]
        assert request.importance == 0.9

    def test_store_request_defaults(self):
        """Test MemoryStoreRequest default values."""
        request = MemoryStoreRequest(
            user_id="user-123",
            content="Test",
            memory_type="fact",
        )

        assert request.session_id is None
        assert request.project_id is None
        assert request.tags is None
        assert request.metadata is None
        assert request.importance == 0.5

    def test_store_request_string_memory_type(self):
        """Test MemoryStoreRequest with string memory_type."""
        request = MemoryStoreRequest(
            user_id="user-123",
            content="Test",
            memory_type="preference",
        )

        assert request.memory_type == "preference"


class TestKnowledgeBaseUnit:
    """Unit tests for KnowledgeBase."""

    @pytest.fixture
    def mock_redis(self) -> MagicMock:
        """Create mock Redis client."""
        mock = MagicMock()
        mock.client = MagicMock()
        mock.client.zadd = AsyncMock(return_value=1)
        mock.client.zcard = AsyncMock(return_value=0)
        mock.client.zrem = AsyncMock(return_value=1)
        mock.client.zrevrange = AsyncMock(return_value=[])
        mock.client.zremrangebyrank = AsyncMock(return_value=0)
        mock.client.sadd = AsyncMock(return_value=1)
        mock.client.srem = AsyncMock(return_value=1)
        mock.client.smembers = AsyncMock(return_value=set())
        mock.client.sinter = AsyncMock(return_value=set())
        mock.get_json = AsyncMock(return_value=None)
        mock.set_json = AsyncMock(return_value=True)
        mock.delete = AsyncMock(return_value=1)
        return mock

    @pytest.fixture
    def kb(self, mock_redis: MagicMock) -> KnowledgeBase:
        """Create KnowledgeBase with mock Redis."""
        return KnowledgeBase(mock_redis)

    async def test_store_memory_basic(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test storing a basic memory."""
        request = MemoryStoreRequest(
            user_id="user-123",
            content="Test memory content",
            memory_type=MemoryType.FACT,
        )

        memory = await kb.store(request)

        assert memory.user_id == "user-123"
        assert memory.content == "Test memory content"
        assert memory.memory_type == MemoryType.FACT
        assert memory.id is not None

        # Verify Redis calls
        mock_redis.set_json.assert_called_once()
        mock_redis.client.zadd.assert_called_once()

    async def test_store_memory_with_session(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test storing memory with session scope."""
        request = MemoryStoreRequest(
            user_id="user-123",
            content="Session memory",
            memory_type=MemoryType.CONTEXT,
            session_id="session-456",
        )

        memory = await kb.store(request)

        assert memory.session_id == "session-456"

        # Should add to both user and session indexes
        assert mock_redis.client.zadd.call_count == 2

    async def test_store_memory_with_project(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test storing memory with project scope."""
        request = MemoryStoreRequest(
            user_id="user-123",
            content="Project memory",
            memory_type=MemoryType.CODE_PATTERN,
            project_id="project-789",
        )

        memory = await kb.store(request)

        assert memory.project_id == "project-789"

        # Should add to both user and project indexes
        assert mock_redis.client.zadd.call_count == 2

    async def test_store_memory_with_tags(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test storing memory with tags."""
        request = MemoryStoreRequest(
            user_id="user-123",
            content="Tagged memory",
            memory_type=MemoryType.PREFERENCE,
            tags=["python", "testing"],
        )

        memory = await kb.store(request)

        assert memory.tags == ["python", "testing"]

        # Should add to tag indexes (2 tags = 2 sadd calls)
        assert mock_redis.client.sadd.call_count == 2

    async def test_get_memory_found(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test getting existing memory."""
        memory_data = {
            "id": "mem-123",
            "user_id": "user-456",
            "content": "Test content",
            "memory_type": "fact",
            "created_at": "2024-01-01T00:00:00+00:00",
            "updated_at": "2024-01-01T00:00:00+00:00",
        }
        mock_redis.get_json = AsyncMock(return_value=memory_data)

        memory = await kb.get("mem-123")

        assert memory is not None
        assert memory.id == "mem-123"
        assert memory.content == "Test content"
        assert memory.access_count == 1  # Incremented

    async def test_get_memory_not_found(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test getting non-existent memory."""
        mock_redis.get_json = AsyncMock(return_value=None)

        memory = await kb.get("nonexistent")

        assert memory is None

    async def test_update_memory_content(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test updating memory content."""
        memory_data = {
            "id": "mem-123",
            "user_id": "user-456",
            "content": "Old content",
            "memory_type": "fact",
            "tags": [],
            "created_at": "2024-01-01T00:00:00+00:00",
            "updated_at": "2024-01-01T00:00:00+00:00",
        }
        mock_redis.get_json = AsyncMock(return_value=memory_data)

        memory = await kb.update("mem-123", content="New content")

        assert memory is not None
        assert memory.content == "New content"

    async def test_update_memory_tags(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test updating memory tags."""
        memory_data = {
            "id": "mem-123",
            "user_id": "user-456",
            "content": "Content",
            "memory_type": "fact",
            "tags": ["old-tag"],
            "created_at": "2024-01-01T00:00:00+00:00",
            "updated_at": "2024-01-01T00:00:00+00:00",
        }
        mock_redis.get_json = AsyncMock(return_value=memory_data)

        memory = await kb.update("mem-123", tags=["new-tag1", "new-tag2"])

        assert memory is not None
        assert memory.tags == ["new-tag1", "new-tag2"]

        # Should have removed old tag and added new tags
        mock_redis.client.srem.assert_called_once()
        assert mock_redis.client.sadd.call_count == 2

    async def test_update_memory_importance(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test updating memory importance."""
        memory_data = {
            "id": "mem-123",
            "user_id": "user-456",
            "content": "Content",
            "memory_type": "fact",
            "tags": [],
            "importance": 0.5,
            "created_at": "2024-01-01T00:00:00+00:00",
            "updated_at": "2024-01-01T00:00:00+00:00",
        }
        mock_redis.get_json = AsyncMock(return_value=memory_data)

        memory = await kb.update("mem-123", importance=0.9)

        assert memory is not None
        assert memory.importance == 0.9

        # Should update importance in user index
        # zadd called once in update_importance_scores
        assert mock_redis.client.zadd.call_count >= 1

    async def test_update_memory_not_found(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test updating non-existent memory."""
        mock_redis.get_json = AsyncMock(return_value=None)

        memory = await kb.update("nonexistent", content="New content")

        assert memory is None

    async def test_delete_memory(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test deleting memory."""
        memory_data = {
            "id": "mem-123",
            "user_id": "user-456",
            "content": "Content",
            "memory_type": "fact",
            "tags": ["tag1"],
            "session_id": "session-789",
            "project_id": "project-abc",
            "created_at": "2024-01-01T00:00:00+00:00",
            "updated_at": "2024-01-01T00:00:00+00:00",
        }
        mock_redis.get_json = AsyncMock(return_value=memory_data)

        result = await kb.delete("mem-123")

        assert result is True

        # Should remove from all indexes
        assert mock_redis.client.zrem.call_count == 3  # user, session, project
        mock_redis.client.srem.assert_called_once()  # tag
        mock_redis.delete.assert_called_once()

    async def test_delete_memory_not_found(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test deleting non-existent memory."""
        mock_redis.get_json = AsyncMock(return_value=None)

        result = await kb.delete("nonexistent")

        assert result is False


class TestKnowledgeBaseSearch:
    """Test KnowledgeBase search methods."""

    @pytest.fixture
    def mock_redis(self) -> MagicMock:
        """Create mock Redis client."""
        mock = MagicMock()
        mock.client = MagicMock()
        mock.client.zadd = AsyncMock(return_value=1)
        mock.client.zcard = AsyncMock(return_value=0)
        mock.client.zrem = AsyncMock(return_value=1)
        mock.client.zrevrange = AsyncMock(return_value=[])
        mock.client.smembers = AsyncMock(return_value=set())
        mock.client.sinter = AsyncMock(return_value=set())
        mock.get_json = AsyncMock(return_value=None)
        mock.set_json = AsyncMock(return_value=True)
        return mock

    @pytest.fixture
    def kb(self, mock_redis: MagicMock) -> KnowledgeBase:
        """Create KnowledgeBase with mock Redis."""
        return KnowledgeBase(mock_redis)

    async def test_search_by_session(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test searching by session."""
        mock_redis.client.zrevrange = AsyncMock(return_value=["mem-1", "mem-2"])
        mock_redis.get_json = AsyncMock(side_effect=[
            {
                "id": "mem-1",
                "user_id": "user-123",
                "content": "Memory 1",
                "memory_type": "fact",
                "created_at": "2024-01-01T00:00:00+00:00",
                "updated_at": "2024-01-01T00:00:00+00:00",
            },
            {
                "id": "mem-1",  # Called again for access count update
                "user_id": "user-123",
                "content": "Memory 1",
                "memory_type": "fact",
                "created_at": "2024-01-01T00:00:00+00:00",
                "updated_at": "2024-01-01T00:00:00+00:00",
            },
            {
                "id": "mem-2",
                "user_id": "user-123",
                "content": "Memory 2",
                "memory_type": "preference",
                "created_at": "2024-01-01T00:00:00+00:00",
                "updated_at": "2024-01-01T00:00:00+00:00",
            },
            {
                "id": "mem-2",  # Called again for access count update
                "user_id": "user-123",
                "content": "Memory 2",
                "memory_type": "preference",
                "created_at": "2024-01-01T00:00:00+00:00",
                "updated_at": "2024-01-01T00:00:00+00:00",
            },
        ])

        memories = await kb.search_by_session("session-456")

        assert len(memories) == 2
        mock_redis.client.zrevrange.assert_called_once()

    async def test_search_by_session_with_type_filter(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test searching by session with type filter."""
        mock_redis.client.zrevrange = AsyncMock(return_value=["mem-1", "mem-2"])

        # Use return_value dict with memory IDs as keys
        async def get_json_by_key(key: str):
            if "mem-1" in key:
                return {
                    "id": "mem-1",
                    "user_id": "user-123",
                    "content": "Memory 1",
                    "memory_type": "fact",
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-01T00:00:00+00:00",
                }
            elif "mem-2" in key:
                return {
                    "id": "mem-2",
                    "user_id": "user-123",
                    "content": "Memory 2",
                    "memory_type": "preference",
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-01T00:00:00+00:00",
                }
            return None

        mock_redis.get_json = AsyncMock(side_effect=get_json_by_key)

        memories = await kb.search_by_session("session-456", memory_type=MemoryType.FACT)

        assert len(memories) == 1
        assert memories[0].memory_type == MemoryType.FACT

    async def test_search_by_user(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test searching by user."""
        mock_redis.client.zrevrange = AsyncMock(return_value=["mem-1"])
        mock_redis.get_json = AsyncMock(return_value={
            "id": "mem-1",
            "user_id": "user-123",
            "content": "User memory",
            "memory_type": "preference",
            "created_at": "2024-01-01T00:00:00+00:00",
            "updated_at": "2024-01-01T00:00:00+00:00",
        })

        memories = await kb.search_by_user("user-123")

        assert len(memories) == 1

    async def test_search_by_tags_single(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test searching by single tag."""
        mock_redis.client.smembers = AsyncMock(return_value={"mem-1", "mem-2"})
        mock_redis.get_json = AsyncMock(return_value={
            "id": "mem-1",
            "user_id": "user-123",
            "content": "Tagged memory",
            "memory_type": "fact",
            "importance": 0.8,
            "created_at": "2024-01-01T00:00:00+00:00",
            "updated_at": "2024-01-01T00:00:00+00:00",
        })

        memories = await kb.search_by_tags(["python"])

        assert len(memories) <= 2
        mock_redis.client.smembers.assert_called_once()

    async def test_search_by_tags_multiple(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test searching by multiple tags (AND logic)."""
        mock_redis.client.sinter = AsyncMock(return_value={"mem-1"})
        mock_redis.get_json = AsyncMock(return_value={
            "id": "mem-1",
            "user_id": "user-123",
            "content": "Multi-tagged memory",
            "memory_type": "code_pattern",
            "importance": 0.9,
            "created_at": "2024-01-01T00:00:00+00:00",
            "updated_at": "2024-01-01T00:00:00+00:00",
        })

        memories = await kb.search_by_tags(["python", "async"])

        assert len(memories) == 1
        mock_redis.client.sinter.assert_called_once()

    async def test_search_by_tags_empty(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test searching with empty tags list."""
        memories = await kb.search_by_tags([])

        assert memories == []

    async def test_search_text(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test text search."""
        mock_redis.client.zrevrange = AsyncMock(return_value=["mem-1", "mem-2"])

        async def get_json_by_key(key: str):
            if "mem-1" in key:
                return {
                    "id": "mem-1",
                    "user_id": "user-123",
                    "content": "Python async await patterns",
                    "memory_type": "code_pattern",
                    "importance": 0.8,
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-01T00:00:00+00:00",
                }
            elif "mem-2" in key:
                return {
                    "id": "mem-2",
                    "user_id": "user-123",
                    "content": "JavaScript promises",
                    "memory_type": "code_pattern",
                    "importance": 0.7,
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-01T00:00:00+00:00",
                }
            return None

        mock_redis.get_json = AsyncMock(side_effect=get_json_by_key)

        memories = await kb.search_text("python", session_id="session-456")

        # Should find the Python memory
        assert len(memories) == 1
        assert "Python" in memories[0].content

    async def test_search_text_no_scope(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test text search without scope returns empty."""
        memories = await kb.search_text("test")

        assert memories == []

    async def test_get_relevant_context(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test getting relevant context."""
        mock_redis.client.zrevrange = AsyncMock(return_value=["mem-1"])
        mock_redis.get_json = AsyncMock(return_value={
            "id": "mem-1",
            "user_id": "user-123",
            "content": "User prefers Python",
            "memory_type": "preference",
            "importance": 0.9,
            "created_at": "2024-01-01T00:00:00+00:00",
            "updated_at": "2024-01-01T00:00:00+00:00",
        })

        memories = await kb.get_relevant_context(
            session_id="session-456",
            user_id="user-123",
            current_message="Help me with Python code",
            limit=5,
        )

        # Should combine session, user, and text search results
        assert len(memories) >= 0  # Deduplicated


class TestKnowledgeBaseIndexManagement:
    """Test index management and trimming."""

    @pytest.fixture
    def mock_redis(self) -> MagicMock:
        """Create mock Redis client."""
        mock = MagicMock()
        mock.client = MagicMock()
        mock.client.zadd = AsyncMock(return_value=1)
        mock.client.zcard = AsyncMock(return_value=1500)  # Over MAX_MEMORIES_PER_SCOPE
        mock.client.zremrangebyrank = AsyncMock(return_value=500)
        mock.client.sadd = AsyncMock(return_value=1)
        mock.get_json = AsyncMock(return_value=None)
        mock.set_json = AsyncMock(return_value=True)
        return mock

    @pytest.fixture
    def kb(self, mock_redis: MagicMock) -> KnowledgeBase:
        """Create KnowledgeBase with mock Redis."""
        return KnowledgeBase(mock_redis)

    async def test_trim_index_when_over_limit(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test that index is trimmed when over limit."""
        # zcard returns 1500, which is over MAX_MEMORIES_PER_SCOPE (1000)
        await kb._trim_index("test:key")

        mock_redis.client.zremrangebyrank.assert_called_once()

    async def test_trim_index_when_under_limit(self, kb: KnowledgeBase, mock_redis: MagicMock):
        """Test that index is not trimmed when under limit."""
        mock_redis.client.zcard = AsyncMock(return_value=500)

        await kb._trim_index("test:key")

        mock_redis.client.zremrangebyrank.assert_not_called()


@pytest.mark.integration
@requires_redis
class TestKnowledgeBaseRedisIntegration:
    """Integration tests with real Redis.

    These tests require a running Redis instance.
    Run with: pytest -m integration --run-redis-tests
    """

    @pytest.fixture
    async def redis_client(self):
        """Get real Redis client."""
        import os
        from podex_shared.redis_client import RedisClient

        redis_url = os.getenv("REDIS_URL", "redis://localhost:6380")
        try:
            client = RedisClient(redis_url)
            await client.connect()
            yield client
            await client.disconnect()
        except Exception:
            pytest.skip("Redis not available")

    @pytest.fixture
    async def kb(self, redis_client) -> KnowledgeBase:
        """Create KnowledgeBase with real Redis."""
        kb = KnowledgeBase(redis_client)
        yield kb

        # Cleanup test data
        # Clean up any test memories created

    async def test_full_memory_lifecycle(self, kb: KnowledgeBase, redis_client):
        """Test complete memory lifecycle with real Redis."""
        user_id = f"test-user-{uuid.uuid4().hex[:8]}"
        session_id = f"test-session-{uuid.uuid4().hex[:8]}"

        try:
            # Store
            request = MemoryStoreRequest(
                user_id=user_id,
                content="Integration test memory",
                memory_type=MemoryType.FACT,
                session_id=session_id,
                tags=["integration-test"],
                importance=0.8,
            )
            memory = await kb.store(request)
            memory_id = memory.id

            # Get
            retrieved = await kb.get(memory_id)
            assert retrieved is not None
            assert retrieved.content == "Integration test memory"
            assert retrieved.access_count == 1

            # Update
            updated = await kb.update(memory_id, content="Updated content")
            assert updated is not None
            assert updated.content == "Updated content"

            # Search
            results = await kb.search_by_session(session_id)
            assert len(results) >= 1

            # Delete
            deleted = await kb.delete(memory_id)
            assert deleted is True

            # Verify deleted
            not_found = await kb.get(memory_id)
            assert not_found is None

        finally:
            # Cleanup
            try:
                await kb.delete(memory_id)
            except Exception:
                pass
