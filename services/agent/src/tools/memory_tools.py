"""Memory tools for agents to store and recall information."""

from dataclasses import dataclass
from typing import Any

import structlog

from podex_shared.redis_client import get_redis_client
from src.config import settings
from src.memory.knowledge_base import KnowledgeBase, MemoryStoreRequest, MemoryType
from src.memory.retriever import MemoryRetriever, RetrievalQuery

logger = structlog.get_logger()


class MemoryToolsHolder:
    """Singleton holder for memory tools instances."""

    _knowledge_base: KnowledgeBase | None = None
    _retriever: MemoryRetriever | None = None

    @classmethod
    def get_knowledge_base(cls) -> KnowledgeBase:
        """Get or create the global knowledge base instance."""
        if cls._knowledge_base is None:
            redis_client = get_redis_client(settings.REDIS_URL)
            cls._knowledge_base = KnowledgeBase(redis_client)
        return cls._knowledge_base

    @classmethod
    def get_retriever(cls) -> MemoryRetriever:
        """Get or create the global retriever instance."""
        if cls._retriever is None:
            cls._retriever = MemoryRetriever(cls.get_knowledge_base())
        return cls._retriever


def get_knowledge_base() -> KnowledgeBase:
    """Get or create the global knowledge base instance."""
    return MemoryToolsHolder.get_knowledge_base()


def get_retriever() -> MemoryRetriever:
    """Get or create the global retriever instance."""
    return MemoryToolsHolder.get_retriever()


@dataclass
class StoreMemoryParams:
    """Parameters for storing a memory."""

    session_id: str
    user_id: str
    content: str
    memory_type: str = "fact"
    tags: list[str] | None = None
    importance: float = 0.5


async def store_memory(params: StoreMemoryParams) -> dict[str, Any]:
    """Store a fact or insight for later recall.

    Use this tool to remember important information discovered during
    the conversation, such as:
    - User preferences and coding style
    - Project conventions and patterns
    - Decisions made and their reasoning
    - Solutions to problems encountered

    Args:
        params: Parameters for storing the memory.

    Returns:
        Dictionary with memory info or error.
    """
    try:
        # Validate memory type
        valid_types = {"fact", "preference", "context", "code_pattern", "error_solution", "wiki"}
        if params.memory_type not in valid_types:
            return {
                "success": False,
                "error": (
                    f"Invalid memory type: {params.memory_type}. Must be one of: {valid_types}"
                ),
            }

        # Validate importance
        importance = max(0.0, min(1.0, params.importance))

        kb = get_knowledge_base()
        request = MemoryStoreRequest(
            user_id=params.user_id,
            content=params.content,
            memory_type=MemoryType(params.memory_type),
            session_id=params.session_id,
            tags=params.tags or [],
            importance=importance,
        )
        memory = await kb.store(request)

        logger.info(
            "Memory stored by agent",
            memory_id=memory.id,
            memory_type=params.memory_type,
            session_id=params.session_id,
        )

        return {
            "success": True,
            "memory_id": memory.id,
            "memory_type": params.memory_type,
            "message": f"Memory stored successfully with importance {importance}",
        }

    except Exception as e:
        logger.error("Failed to store memory", error=str(e))
        return {"success": False, "error": str(e)}


@dataclass
class RecallMemoryParams:
    """Parameters for recalling memories."""

    session_id: str
    user_id: str
    query: str
    memory_type: str | None = None
    tags: list[str] | None = None
    limit: int = 5


async def recall_memory(params: RecallMemoryParams) -> dict[str, Any]:
    """Search memories for relevant information.

    Use this tool to recall previously stored information, such as:
    - User preferences for coding style
    - Previously discovered patterns
    - Solutions to similar problems
    - Project-specific context

    Args:
        params: Parameters for recalling memories.

    Returns:
        Dictionary with matching memories or error.
    """
    try:
        retriever = get_retriever()

        memory_types = None
        if params.memory_type:
            try:
                memory_types = [MemoryType(params.memory_type)]
            except ValueError:
                return {
                    "success": False,
                    "error": f"Invalid memory type: {params.memory_type}",
                }

        retrieval_query = RetrievalQuery(
            query=params.query,
            session_id=params.session_id,
            user_id=params.user_id,
            memory_types=memory_types,
            tags=params.tags,
            limit=params.limit,
        )
        memories = await retriever.retrieve(retrieval_query)

        results = []
        for memory in memories:
            results.append(
                {
                    "id": memory.id,
                    "content": memory.content,
                    "type": memory.memory_type.value,
                    "tags": memory.tags,
                    "importance": memory.importance,
                    "created_at": memory.created_at.isoformat() if memory.created_at else None,
                },
            )

        logger.info(
            "Memory recall completed",
            query=params.query[:50],
            results_count=len(results),
            session_id=params.session_id,
        )

        return {
            "success": True,
            "query": params.query,
            "count": len(results),
            "memories": results,
        }

    except Exception as e:
        logger.error("Failed to recall memories", error=str(e))
        return {"success": False, "error": str(e)}


async def update_memory(
    memory_id: str,
    content: str | None = None,
    tags: list[str] | None = None,
    importance: float | None = None,
) -> dict[str, Any]:
    """Update an existing memory.

    Args:
        memory_id: Memory ID to update.
        content: New content (optional).
        tags: New tags (optional).
        importance: New importance (optional).

    Returns:
        Dictionary with updated memory or error.
    """
    try:
        kb = get_knowledge_base()
        memory = await kb.update(
            memory_id=memory_id,
            content=content,
            tags=tags,
            importance=importance,
        )

        if not memory:
            return {
                "success": False,
                "error": f"Memory not found: {memory_id}",
            }

        return {
            "success": True,
            "memory_id": memory.id,
            "message": "Memory updated successfully",
        }

    except Exception as e:
        logger.error("Failed to update memory", error=str(e))
        return {"success": False, "error": str(e)}


async def delete_memory(memory_id: str) -> dict[str, Any]:
    """Delete a memory.

    Args:
        memory_id: Memory ID to delete.

    Returns:
        Dictionary with result.
    """
    try:
        kb = get_knowledge_base()
        deleted = await kb.delete(memory_id)

        if not deleted:
            return {
                "success": False,
                "error": f"Memory not found: {memory_id}",
            }

        return {
            "success": True,
            "message": "Memory deleted successfully",
        }

    except Exception as e:
        logger.error("Failed to delete memory", error=str(e))
        return {"success": False, "error": str(e)}


async def get_session_memories(
    session_id: str,
    limit: int = 20,
) -> dict[str, Any]:
    """Get all memories for a session.

    Args:
        session_id: Session ID.
        limit: Maximum memories to return.

    Returns:
        Dictionary with memories.
    """
    try:
        kb = get_knowledge_base()
        memories = await kb.search_by_session(session_id, limit=limit)

        results = []
        for memory in memories:
            results.append(
                {
                    "id": memory.id,
                    "content": memory.content,
                    "type": memory.memory_type.value,
                    "tags": memory.tags,
                    "importance": memory.importance,
                },
            )

        return {
            "success": True,
            "session_id": session_id,
            "count": len(results),
            "memories": results,
        }

    except Exception as e:
        logger.error("Failed to get session memories", error=str(e))
        return {"success": False, "error": str(e)}


# Tool definitions for agent use
MEMORY_TOOLS = [
    {
        "name": "store_memory",
        "description": (
            "Store a fact or insight for later recall. Use this to remember "
            "user preferences, project patterns, decisions made, or solutions "
            "discovered."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "The information to remember",
                },
                "memory_type": {
                    "type": "string",
                    "enum": ["fact", "preference", "context", "code_pattern", "error_solution"],
                    "description": "Type of memory",
                    "default": "fact",
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Tags for categorization",
                },
                "importance": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "description": "Importance score (0-1)",
                    "default": 0.5,
                },
            },
            "required": ["content"],
        },
    },
    {
        "name": "recall_memory",
        "description": (
            "Search memories for relevant information. Use this to recall user "
            "preferences, patterns, or solutions from previous interactions."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query describing what you're looking for",
                },
                "memory_type": {
                    "type": "string",
                    "enum": ["fact", "preference", "context", "code_pattern", "error_solution"],
                    "description": "Filter by memory type",
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Filter by tags",
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 20,
                    "description": "Maximum results to return",
                    "default": 5,
                },
            },
            "required": ["query"],
        },
    },
]
