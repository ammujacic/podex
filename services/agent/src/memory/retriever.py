"""Memory retrieval with embedding-based semantic search."""

from dataclasses import dataclass
from typing import TYPE_CHECKING

import structlog

from src.database.connection import get_db_context
from src.database.models import Memory as MemoryModel
from src.memory.knowledge_base import KnowledgeBase, Memory, MemoryStoreRequest, MemoryType

if TYPE_CHECKING:
    from src.providers.llm import LLMProvider

logger = structlog.get_logger()


@dataclass
class RetrievalQuery:
    """Query parameters for memory retrieval."""

    query: str
    session_id: str | None = None
    user_id: str | None = None
    memory_types: list[MemoryType] | None = None
    tags: list[str] | None = None
    limit: int = 5


class MemoryRetriever:
    """Retrieves relevant memories using semantic search.

    Supports both keyword-based and embedding-based retrieval.
    For production, consider using a vector database like Pinecone,
    Weaviate, or pgvector.
    """

    def __init__(
        self,
        knowledge_base: KnowledgeBase,
        llm_provider: "LLMProvider | None" = None,
    ) -> None:
        """Initialize retriever.

        Args:
            knowledge_base: Knowledge base instance
            llm_provider: Optional LLM provider for embeddings
        """
        self._kb = knowledge_base
        self._llm = llm_provider

    async def retrieve(self, query: RetrievalQuery) -> list[Memory]:
        """Retrieve relevant memories for a query.

        Args:
            query: Retrieval query containing search parameters

        Returns:
            Relevant memories
        """
        results = []

        # Tag-based search
        if query.tags:
            tag_results = await self._kb.search_by_tags(query.tags, limit=query.limit)
            results.extend(tag_results)

        # Text search
        if query.query:
            text_results = await self._kb.search_text(
                query.query,
                session_id=query.session_id,
                user_id=query.user_id,
                limit=query.limit,
            )
            results.extend(text_results)

        # Session memories
        if query.session_id:
            session_results = await self._kb.search_by_session(query.session_id, limit=query.limit)
            results.extend(session_results)

        # Deduplicate
        seen = set()
        unique = []
        for memory in results:
            type_matches = query.memory_types is None or memory.memory_type in query.memory_types
            if memory.id not in seen and type_matches:
                seen.add(memory.id)
                unique.append(memory)

        # Sort by relevance (importance + recency)
        unique.sort(key=lambda m: m.importance, reverse=True)
        return unique[: query.limit]

    async def get_context_injection(
        self,
        session_id: str,
        user_id: str,
        current_message: str,
        limit: int = 5,
    ) -> str:
        """Get formatted memory context for injection into prompts.

        Args:
            session_id: Current session
            user_id: Current user
            current_message: Current user message
            limit: Max memories

        Returns:
            Formatted context string
        """
        memories = await self._kb.get_relevant_context(
            session_id=session_id,
            user_id=user_id,
            current_message=current_message,
            limit=limit,
        )

        if not memories:
            return ""

        # Format memories for context injection
        lines = ["[Relevant memories]"]
        for memory in memories:
            type_label = memory.memory_type.value.replace("_", " ").title()
            tags_str = f" [{', '.join(memory.tags)}]" if memory.tags else ""
            lines.append(f"- ({type_label}{tags_str}): {memory.content}")

        return "\n".join(lines)

    async def auto_extract_memories(
        self,
        session_id: str,
        user_id: str,
        message: str,
        response: str,
    ) -> list[Memory]:
        """Automatically extract and store memories from a conversation turn.

        Uses heuristics to identify memorable information:
        - User preferences (likes, dislikes, prefers)
        - Factual information (is, are, has)
        - Decisions (decided, chose, will use)

        Stores memories in both Redis (for fast retrieval) and PostgreSQL (for frontend display).

        Args:
            session_id: Session ID
            user_id: User ID
            message: User message
            response: Assistant response

        Returns:
            List of extracted memories
        """
        extracted = []

        # Preference patterns
        preference_keywords = [
            "i prefer",
            "i like",
            "i want",
            "i need",
            "please use",
            "always use",
            "never use",
            "my favorite",
            "i hate",
        ]

        message_lower = message.lower()
        for keyword in preference_keywords:
            if keyword in message_lower:
                request = MemoryStoreRequest(
                    user_id=user_id,
                    content=message,
                    memory_type=MemoryType.PREFERENCE,
                    session_id=session_id,
                    importance=0.7,
                    metadata={"extracted_keyword": keyword},
                )
                memory = await self._kb.store(request)
                extracted.append(memory)

                # Also persist to PostgreSQL for frontend display
                await self._persist_to_postgres(memory)
                break

        # Decision patterns
        decision_keywords = [
            "we decided",
            "let's use",
            "we'll go with",
            "the solution is",
            "we chose",
        ]

        response_lower = response.lower()
        for keyword in decision_keywords:
            if keyword in response_lower:
                # Extract the sentence containing the decision
                sentences = response.split(".")
                for sentence in sentences:
                    if keyword in sentence.lower():
                        request = MemoryStoreRequest(
                            user_id=user_id,
                            content=sentence.strip(),
                            memory_type=MemoryType.FACT,
                            session_id=session_id,
                            importance=0.6,
                            metadata={"extracted_keyword": keyword},
                        )
                        memory = await self._kb.store(request)
                        extracted.append(memory)

                        # Also persist to PostgreSQL for frontend display
                        await self._persist_to_postgres(memory)
                        break
                break

        return extracted

    async def _persist_to_postgres(self, memory: Memory) -> None:
        """Persist a memory to PostgreSQL for frontend display.

        Args:
            memory: The memory to persist
        """
        try:
            async with get_db_context() as db:
                db_memory = MemoryModel(
                    id=memory.id,
                    user_id=memory.user_id,
                    session_id=memory.session_id,
                    project_id=memory.project_id,
                    content=memory.content,
                    memory_type=memory.memory_type.value
                    if isinstance(memory.memory_type, MemoryType)
                    else memory.memory_type,
                    tags=memory.tags or [],
                    memory_metadata=memory.metadata or {},
                    importance=memory.importance,
                    source_message_id=memory.source_message_id,
                )
                db.add(db_memory)
                await db.commit()
                logger.debug(
                    "Memory persisted to PostgreSQL",
                    memory_id=memory.id,
                    memory_type=memory.memory_type,
                )
        except Exception as e:
            # Log but don't fail - Redis storage succeeded
            logger.warning(
                "Failed to persist memory to PostgreSQL",
                memory_id=memory.id,
                error=str(e),
            )


class MemoryRetrieverHolder:
    """Singleton holder for the global memory retriever instance."""

    _instance: MemoryRetriever | None = None

    @classmethod
    def get(cls) -> MemoryRetriever | None:
        """Get the global memory retriever instance."""
        return cls._instance

    @classmethod
    def set(cls, retriever: MemoryRetriever) -> None:
        """Set the global memory retriever instance."""
        cls._instance = retriever


def get_memory_retriever() -> MemoryRetriever | None:
    """Get the global memory retriever instance."""
    return MemoryRetrieverHolder.get()


def set_memory_retriever(retriever: MemoryRetriever) -> None:
    """Set the global memory retriever instance."""
    MemoryRetrieverHolder.set(retriever)
