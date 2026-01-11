"""Knowledge base and memory API routes."""

from dataclasses import dataclass
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.connection import get_db
from src.database.models import Memory, Session
from src.middleware.auth import get_current_user
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

router = APIRouter(prefix="/api/sessions/{session_id}/memories", tags=["knowledge"])

# Type aliases for dependencies
DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[dict[str, str | None], Depends(get_current_user)]


@dataclass
class MemoryListParams:
    """Query parameters for listing memories."""

    memory_type: str | None = None
    tags: list[str] | None = None
    page: int = 1
    page_size: int = 20


def get_memory_list_params(
    memory_type: str | None = None,
    tags: Annotated[list[str] | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> MemoryListParams:
    """Dependency to get memory list parameters."""
    return MemoryListParams(
        memory_type=memory_type,
        tags=list(tags) if tags else None,
        page=page,
        page_size=page_size,
    )


@dataclass
class MemorySearchParams:
    """Query parameters for searching memories."""

    q: str
    memory_type: str | None = None
    limit: int = 10


def get_memory_search_params(
    q: str = Query(..., min_length=1),
    memory_type: str | None = None,
    limit: int = Query(default=10, ge=1, le=50),
) -> MemorySearchParams:
    """Dependency to get memory search parameters."""
    return MemorySearchParams(q=q, memory_type=memory_type, limit=limit)


class MemoryCreate(BaseModel):
    """Request to create a memory."""

    content: str = Field(..., min_length=1, max_length=10000)
    memory_type: str = Field(default="fact")
    tags: list[str] = Field(default_factory=list)
    importance: float = Field(default=0.5, ge=0.0, le=1.0)
    metadata: dict[str, Any] = Field(default_factory=dict)


class MemoryUpdate(BaseModel):
    """Request to update a memory."""

    content: str | None = Field(None, min_length=1, max_length=10000)
    memory_type: str | None = None
    tags: list[str] | None = None
    importance: float | None = Field(None, ge=0.0, le=1.0)
    metadata: dict[str, Any] | None = None


class MemoryResponse(BaseModel):
    """Memory response."""

    id: str
    session_id: str | None
    user_id: str
    content: str
    memory_type: str
    tags: list[str]
    importance: float
    metadata: dict[str, Any]
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


class MemoryListResponse(BaseModel):
    """List of memories response."""

    memories: list[MemoryResponse]
    total: int
    page: int
    page_size: int


class MemorySearchResponse(BaseModel):
    """Memory search response."""

    memories: list[MemoryResponse]
    query: str
    total: int


@router.get("", response_model=MemoryListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_memories(
    request: Request,
    response: Response,
    session_id: UUID,
    db: DbSession,
    current_user: CurrentUser,
    params: Annotated[MemoryListParams, Depends(get_memory_list_params)],
) -> MemoryListResponse:
    """List memories for a session."""
    # Verify session access
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.owner_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Build query
    query = select(Memory).where(Memory.session_id == session_id)

    if params.memory_type:
        query = query.where(Memory.memory_type == params.memory_type)

    if params.tags:
        # Filter by tags (any match)
        for tag in params.tags:
            query = query.where(Memory.tags.contains([tag]))

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.scalar(count_query) or 0

    # Apply pagination
    query = query.offset((params.page - 1) * params.page_size).limit(params.page_size)
    query = query.order_by(Memory.created_at.desc())

    result = await db.execute(query)
    memories = result.scalars().all()

    return MemoryListResponse(
        memories=[
            MemoryResponse(
                id=m.id,
                session_id=m.session_id,
                user_id=m.user_id,
                content=m.content,
                memory_type=m.memory_type,
                tags=m.tags or [],
                importance=m.importance,
                metadata=m.memory_metadata or {},
                created_at=m.created_at.isoformat(),
                updated_at=m.updated_at.isoformat(),
            )
            for m in memories
        ],
        total=total,
        page=params.page,
        page_size=params.page_size,
    )


@router.post("", response_model=MemoryResponse, status_code=201)
@limiter.limit(RATE_LIMIT_STANDARD)
async def create_memory(
    request: Request,
    response: Response,
    session_id: UUID,
    data: MemoryCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> MemoryResponse:
    """Create a new memory."""
    # Verify session access
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.owner_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    memory = Memory(
        session_id=session_id,
        user_id=current_user["id"],
        content=data.content,
        memory_type=data.memory_type,
        tags=data.tags,
        importance=data.importance,
        memory_metadata=data.metadata,
    )

    db.add(memory)
    await db.commit()
    await db.refresh(memory)

    return MemoryResponse(
        id=memory.id,
        session_id=memory.session_id,
        user_id=memory.user_id,
        content=memory.content,
        memory_type=memory.memory_type,
        tags=memory.tags or [],
        importance=memory.importance,
        metadata=memory.memory_metadata or {},
        created_at=memory.created_at.isoformat(),
        updated_at=memory.updated_at.isoformat(),
    )


def escape_like_pattern(pattern: str) -> str:
    """Escape special characters in LIKE patterns to prevent injection.

    Args:
        pattern: User-provided search pattern

    Returns:
        Escaped pattern safe for use in LIKE queries
    """
    # Escape backslash first, then % and _
    return pattern.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@router.get("/search", response_model=MemorySearchResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def search_memories(
    request: Request,
    response: Response,
    session_id: UUID,
    db: DbSession,
    current_user: CurrentUser,
    params: Annotated[MemorySearchParams, Depends(get_memory_search_params)],
) -> MemorySearchResponse:
    """Search memories by content."""
    # Verify session access
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.owner_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Escape special LIKE characters to prevent injection
    escaped_query = escape_like_pattern(params.q)

    # Simple text search (can be enhanced with embeddings)
    query = select(Memory).where(
        Memory.session_id == session_id,
        Memory.content.ilike(f"%{escaped_query}%", escape="\\"),
    )

    if params.memory_type:
        query = query.where(Memory.memory_type == params.memory_type)

    query = query.order_by(Memory.importance.desc()).limit(params.limit)

    result = await db.execute(query)
    memories = result.scalars().all()

    return MemorySearchResponse(
        memories=[
            MemoryResponse(
                id=m.id,
                session_id=m.session_id,
                user_id=m.user_id,
                content=m.content,
                memory_type=m.memory_type,
                tags=m.tags or [],
                importance=m.importance,
                metadata=m.memory_metadata or {},
                created_at=m.created_at.isoformat(),
                updated_at=m.updated_at.isoformat(),
            )
            for m in memories
        ],
        query=params.q,
        total=len(memories),
    )


@router.get("/{memory_id}", response_model=MemoryResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_memory(
    request: Request,
    response: Response,
    session_id: UUID,
    memory_id: UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> MemoryResponse:
    """Get a specific memory."""
    memory = await db.get(Memory, memory_id)

    if not memory or memory.session_id != session_id:
        raise HTTPException(status_code=404, detail="Memory not found")

    if memory.user_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    return MemoryResponse(
        id=memory.id,
        session_id=memory.session_id,
        user_id=memory.user_id,
        content=memory.content,
        memory_type=memory.memory_type,
        tags=memory.tags or [],
        importance=memory.importance,
        metadata=memory.memory_metadata or {},
        created_at=memory.created_at.isoformat(),
        updated_at=memory.updated_at.isoformat(),
    )


@router.patch("/{memory_id}", response_model=MemoryResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def update_memory(
    request: Request,
    response: Response,
    session_id: UUID,
    memory_id: UUID,
    data: MemoryUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> MemoryResponse:
    """Update a memory."""
    memory = await db.get(Memory, memory_id)

    if not memory or memory.session_id != session_id:
        raise HTTPException(status_code=404, detail="Memory not found")

    if memory.user_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Update fields
    if data.content is not None:
        memory.content = data.content
    if data.memory_type is not None:
        memory.memory_type = data.memory_type
    if data.tags is not None:
        memory.tags = data.tags
    if data.importance is not None:
        memory.importance = data.importance
    if data.metadata is not None:
        memory.memory_metadata = data.metadata

    await db.commit()
    await db.refresh(memory)

    return MemoryResponse(
        id=memory.id,
        session_id=memory.session_id,
        user_id=memory.user_id,
        content=memory.content,
        memory_type=memory.memory_type,
        tags=memory.tags or [],
        importance=memory.importance,
        metadata=memory.memory_metadata or {},
        created_at=memory.created_at.isoformat(),
        updated_at=memory.updated_at.isoformat(),
    )


@router.delete("/{memory_id}", status_code=204)
@limiter.limit(RATE_LIMIT_STANDARD)
async def delete_memory(
    request: Request,
    response: Response,
    session_id: UUID,
    memory_id: UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> None:
    """Delete a memory."""
    memory = await db.get(Memory, memory_id)

    if not memory or memory.session_id != session_id:
        raise HTTPException(status_code=404, detail="Memory not found")

    if memory.user_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    await db.delete(memory)
    await db.commit()
