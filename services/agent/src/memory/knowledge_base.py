"""Knowledge base for persistent agent memory."""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from typing import Any
from uuid import uuid4

import structlog

from podex_shared.redis_client import RedisClient

logger = structlog.get_logger()


class MemoryType(str, Enum):
    """Types of memories that can be stored."""

    FACT = "fact"  # Factual information discovered
    PREFERENCE = "preference"  # User preferences
    CONTEXT = "context"  # Session context
    WIKI = "wiki"  # User-editable documentation
    CODE_PATTERN = "code_pattern"  # Learned coding patterns
    ERROR_SOLUTION = "error_solution"  # Solutions to encountered errors


@dataclass
class MemoryStoreRequest:
    """Request data for storing a new memory."""

    user_id: str
    content: str
    memory_type: MemoryType | str
    session_id: str | None = None
    project_id: str | None = None
    tags: list[str] | None = None
    metadata: dict[str, Any] | None = None
    importance: float = 0.5
    source_message_id: str | None = None


@dataclass
class Memory:
    """A memory entry in the knowledge base."""

    id: str
    user_id: str
    content: str
    memory_type: MemoryType
    session_id: str | None = None
    project_id: str | None = None
    tags: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    embedding: list[float] | None = None
    source_message_id: str | None = None
    importance: float = 0.5  # 0-1 scale
    access_count: int = 0
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    expires_at: datetime | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "user_id": self.user_id,
            "content": self.content,
            "memory_type": self.memory_type.value
            if isinstance(self.memory_type, MemoryType)
            else self.memory_type,
            "session_id": self.session_id,
            "project_id": self.project_id,
            "tags": self.tags,
            "metadata": self.metadata,
            "embedding": self.embedding,
            "source_message_id": self.source_message_id,
            "importance": self.importance,
            "access_count": self.access_count,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Memory":
        """Create from dictionary."""
        return cls(
            id=data["id"],
            user_id=data["user_id"],
            content=data["content"],
            memory_type=MemoryType(data.get("memory_type", "fact")),
            session_id=data.get("session_id"),
            project_id=data.get("project_id"),
            tags=data.get("tags", []),
            metadata=data.get("metadata", {}),
            embedding=data.get("embedding"),
            source_message_id=data.get("source_message_id"),
            importance=data.get("importance", 0.5),
            access_count=data.get("access_count", 0),
            created_at=datetime.fromisoformat(data["created_at"])
            if data.get("created_at")
            else datetime.now(UTC),
            updated_at=datetime.fromisoformat(data["updated_at"])
            if data.get("updated_at")
            else datetime.now(UTC),
            expires_at=datetime.fromisoformat(data["expires_at"])
            if data.get("expires_at")
            else None,
        )


class KnowledgeBase:
    """Persistent knowledge base for agent memories.

    Stores memories in Redis with support for:
    - Session-scoped memories
    - Project-wide memories (cross-session)
    - User-level memories
    - Tagged memories for categorization
    - Importance-based retrieval

    Key structure:
        podex:memory:{memory_id}           - Memory data
        podex:memories:user:{user_id}      - User's memory IDs
        podex:memories:session:{session_id} - Session memory IDs
        podex:memories:project:{project_id} - Project memory IDs
        podex:memories:tags:{tag}          - Memory IDs by tag
    """

    MEMORY_KEY = "podex:memory:{memory_id}"
    USER_MEMORIES_KEY = "podex:memories:user:{user_id}"
    SESSION_MEMORIES_KEY = "podex:memories:session:{session_id}"
    PROJECT_MEMORIES_KEY = "podex:memories:project:{project_id}"
    TAG_MEMORIES_KEY = "podex:memories:tags:{tag}"

    MEMORY_TTL = 86400 * 30  # 30 days default
    MAX_MEMORIES_PER_SCOPE = 1000

    def __init__(self, redis_client: RedisClient) -> None:
        """Initialize knowledge base.

        Args:
            redis_client: Redis client instance
        """
        self._redis = redis_client

    async def store(self, request: MemoryStoreRequest) -> Memory:
        """Store a new memory.

        Args:
            request: Memory store request containing all memory data

        Returns:
            Created Memory object
        """
        memory_id = str(uuid4())

        memory_type = request.memory_type
        if isinstance(memory_type, str):
            memory_type = MemoryType(memory_type)

        memory = Memory(
            id=memory_id,
            user_id=request.user_id,
            content=request.content,
            memory_type=memory_type,
            session_id=request.session_id,
            project_id=request.project_id,
            tags=request.tags or [],
            metadata=request.metadata or {},
            importance=request.importance,
            source_message_id=request.source_message_id,
        )

        # Store memory data
        memory_key = self.MEMORY_KEY.format(memory_id=memory_id)
        await self._redis.set_json(memory_key, memory.to_dict(), ex=self.MEMORY_TTL)

        # Add to user index
        user_key = self.USER_MEMORIES_KEY.format(user_id=memory.user_id)
        await self._redis.client.zadd(user_key, {memory_id: memory.importance})
        await self._trim_index(user_key)

        # Add to session index if scoped
        if memory.session_id:
            session_key = self.SESSION_MEMORIES_KEY.format(session_id=memory.session_id)
            await self._redis.client.zadd(session_key, {memory_id: memory.importance})
            await self._trim_index(session_key)

        # Add to project index if scoped
        if memory.project_id:
            project_key = self.PROJECT_MEMORIES_KEY.format(project_id=memory.project_id)
            await self._redis.client.zadd(project_key, {memory_id: memory.importance})
            await self._trim_index(project_key)

        # Add to tag indexes
        for tag in memory.tags:
            tag_key = self.TAG_MEMORIES_KEY.format(tag=tag.lower())
            await self._redis.client.sadd(tag_key, memory_id)

        logger.info(
            "Memory stored",
            memory_id=memory_id,
            memory_type=memory_type.value,
            user_id=memory.user_id,
        )

        return memory

    async def get(self, memory_id: str) -> Memory | None:
        """Get a memory by ID.

        Args:
            memory_id: Memory ID

        Returns:
            Memory if found, None otherwise
        """
        memory_key = self.MEMORY_KEY.format(memory_id=memory_id)
        data = await self._redis.get_json(memory_key)

        if data and isinstance(data, dict):
            # Increment access count
            memory = Memory.from_dict(data)
            memory.access_count += 1
            await self._redis.set_json(memory_key, memory.to_dict(), ex=self.MEMORY_TTL)
            return memory

        return None

    async def update(
        self,
        memory_id: str,
        content: str | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        importance: float | None = None,
    ) -> Memory | None:
        """Update an existing memory.

        Args:
            memory_id: Memory ID to update
            content: New content (optional)
            tags: New tags (optional)
            metadata: New metadata (optional)
            importance: New importance (optional)

        Returns:
            Updated Memory if found
        """
        memory = await self.get(memory_id)
        if not memory:
            return None

        # Update fields
        if content is not None:
            memory.content = content
        if tags is not None:
            # Update tag indexes
            old_tags = set(memory.tags)
            new_tags = set(tags)

            # Remove from old tags
            for tag in old_tags - new_tags:
                tag_key = self.TAG_MEMORIES_KEY.format(tag=tag.lower())
                await self._redis.client.srem(tag_key, memory_id)

            # Add to new tags
            for tag in new_tags - old_tags:
                tag_key = self.TAG_MEMORIES_KEY.format(tag=tag.lower())
                await self._redis.client.sadd(tag_key, memory_id)

            memory.tags = tags

        if metadata is not None:
            memory.metadata.update(metadata)
        if importance is not None:
            memory.importance = importance
            # Update importance in indexes
            await self._update_importance_scores(memory)

        memory.updated_at = datetime.now(UTC)

        # Save
        memory_key = self.MEMORY_KEY.format(memory_id=memory_id)
        await self._redis.set_json(memory_key, memory.to_dict(), ex=self.MEMORY_TTL)

        return memory

    async def delete(self, memory_id: str) -> bool:
        """Delete a memory.

        Args:
            memory_id: Memory ID to delete

        Returns:
            True if deleted
        """
        memory = await self.get(memory_id)
        if not memory:
            return False

        # Remove from all indexes
        user_key = self.USER_MEMORIES_KEY.format(user_id=memory.user_id)
        await self._redis.client.zrem(user_key, memory_id)

        if memory.session_id:
            session_key = self.SESSION_MEMORIES_KEY.format(session_id=memory.session_id)
            await self._redis.client.zrem(session_key, memory_id)

        if memory.project_id:
            project_key = self.PROJECT_MEMORIES_KEY.format(project_id=memory.project_id)
            await self._redis.client.zrem(project_key, memory_id)

        for tag in memory.tags:
            tag_key = self.TAG_MEMORIES_KEY.format(tag=tag.lower())
            await self._redis.client.srem(tag_key, memory_id)

        # Delete memory data
        memory_key = self.MEMORY_KEY.format(memory_id=memory_id)
        await self._redis.delete(memory_key)

        logger.info("Memory deleted", memory_id=memory_id)
        return True

    async def search_by_session(
        self,
        session_id: str,
        limit: int = 20,
        memory_type: MemoryType | None = None,
    ) -> list[Memory]:
        """Get memories for a session.

        Args:
            session_id: Session ID
            limit: Max memories to return
            memory_type: Optional type filter

        Returns:
            List of memories ordered by importance
        """
        session_key = self.SESSION_MEMORIES_KEY.format(session_id=session_id)
        memory_ids = await self._redis.client.zrevrange(session_key, 0, limit - 1)
        return await self._load_memories(memory_ids, memory_type)

    async def search_by_user(
        self,
        user_id: str,
        limit: int = 20,
        memory_type: MemoryType | None = None,
    ) -> list[Memory]:
        """Get memories for a user.

        Args:
            user_id: User ID
            limit: Max memories to return
            memory_type: Optional type filter

        Returns:
            List of memories ordered by importance
        """
        user_key = self.USER_MEMORIES_KEY.format(user_id=user_id)
        memory_ids = await self._redis.client.zrevrange(user_key, 0, limit - 1)
        return await self._load_memories(memory_ids, memory_type)

    async def search_by_tags(
        self,
        tags: list[str],
        limit: int = 20,
    ) -> list[Memory]:
        """Search memories by tags.

        Args:
            tags: Tags to search for (AND logic)
            limit: Max memories to return

        Returns:
            List of memories matching all tags
        """
        if not tags:
            return []

        # Get memory IDs for each tag
        tag_keys = [self.TAG_MEMORIES_KEY.format(tag=tag.lower()) for tag in tags]

        if len(tag_keys) == 1:
            memory_ids = await self._redis.client.smembers(tag_keys[0])
        else:
            # Intersection of all tag sets
            memory_ids = await self._redis.client.sinter(*tag_keys)

        # Load and sort by importance
        memories = await self._load_memories(list(memory_ids)[: limit * 2])
        memories.sort(key=lambda m: m.importance, reverse=True)
        return memories[:limit]

    async def search_text(
        self,
        query: str,
        session_id: str | None = None,
        user_id: str | None = None,
        limit: int = 10,
    ) -> list[Memory]:
        """Simple text search in memories.

        For production, consider using vector embeddings or full-text search.

        Args:
            query: Search query
            session_id: Optional session filter
            user_id: Optional user filter
            limit: Max results

        Returns:
            Matching memories
        """
        # Get candidate memories
        if session_id:
            memories = await self.search_by_session(session_id, limit=100)
        elif user_id:
            memories = await self.search_by_user(user_id, limit=100)
        else:
            return []

        # Simple keyword matching
        query_lower = query.lower()
        query_words = set(query_lower.split())

        results = []
        for memory in memories:
            content_lower = memory.content.lower()

            # Check if any query word is in content
            if any(word in content_lower for word in query_words):
                # Score based on word matches
                score = sum(1 for word in query_words if word in content_lower)
                results.append((memory, score))

        # Sort by match score, then importance
        results.sort(key=lambda x: (x[1], x[0].importance), reverse=True)
        return [m for m, _ in results[:limit]]

    async def get_relevant_context(
        self,
        session_id: str,
        user_id: str,
        current_message: str,
        limit: int = 5,
    ) -> list[Memory]:
        """Get memories relevant to the current context.

        Combines session memories, recent user memories, and text search.

        Args:
            session_id: Current session
            user_id: Current user
            current_message: Current message for relevance
            limit: Max memories to return

        Returns:
            Relevant memories
        """
        results = []

        # Get high-importance session memories
        session_memories = await self.search_by_session(session_id, limit=limit)
        results.extend(session_memories)

        # Get user preferences
        user_memories = await self.search_by_user(
            user_id,
            limit=limit,
            memory_type=MemoryType.PREFERENCE,
        )
        results.extend(user_memories)

        # Text search for relevant memories
        if current_message:
            text_matches = await self.search_text(
                current_message,
                session_id=session_id,
                limit=limit,
            )
            results.extend(text_matches)

        # Deduplicate and sort
        seen = set()
        unique = []
        for memory in results:
            if memory.id not in seen:
                seen.add(memory.id)
                unique.append(memory)

        unique.sort(key=lambda m: m.importance, reverse=True)
        return unique[:limit]

    async def _load_memories(
        self,
        memory_ids: list[str],
        memory_type: MemoryType | None = None,
    ) -> list[Memory]:
        """Load memories by IDs.

        Args:
            memory_ids: List of memory IDs
            memory_type: Optional type filter

        Returns:
            List of Memory objects
        """
        memories = []
        for memory_id in memory_ids:
            memory = await self.get(memory_id)
            if memory and (memory_type is None or memory.memory_type == memory_type):
                memories.append(memory)
        return memories

    async def _trim_index(self, key: str) -> None:
        """Trim an index to max size, removing lowest importance items."""
        count = await self._redis.client.zcard(key)
        if count > self.MAX_MEMORIES_PER_SCOPE:
            # Remove lowest importance items
            await self._redis.client.zremrangebyrank(
                key,
                0,
                count - self.MAX_MEMORIES_PER_SCOPE - 1,
            )

    async def _update_importance_scores(self, memory: Memory) -> None:
        """Update importance scores in indexes."""
        user_key = self.USER_MEMORIES_KEY.format(user_id=memory.user_id)
        await self._redis.client.zadd(user_key, {memory.id: memory.importance})

        if memory.session_id:
            session_key = self.SESSION_MEMORIES_KEY.format(session_id=memory.session_id)
            await self._redis.client.zadd(session_key, {memory.id: memory.importance})

        if memory.project_id:
            project_key = self.PROJECT_MEMORIES_KEY.format(project_id=memory.project_id)
            await self._redis.client.zadd(project_key, {memory.id: memory.importance})
