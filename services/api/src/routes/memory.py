"""Memory management routes for the settings page.

Provides CRUD operations for user's agent memories stored in PostgreSQL.
"""

from datetime import UTC, datetime, timedelta
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import Memory

logger = structlog.get_logger()

router = APIRouter()

DbSession = Annotated[AsyncSession, Depends(get_db)]


def get_current_user_id(request: Request) -> str:
    """Get current user ID from request state."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return str(user_id)


# ============================================================================
# Request/Response Models
# ============================================================================


class MemoryResponse(BaseModel):
    """A memory item."""

    id: str
    content: str
    memory_type: str
    tags: list[str] | None
    importance: float
    session_id: str | None
    project_id: str | None
    access_count: int
    created_at: str
    updated_at: str


class MemoryListResponse(BaseModel):
    """Paginated memory list response."""

    memories: list[MemoryResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class MemoryStatsResponse(BaseModel):
    """Memory statistics."""

    total_memories: int
    by_type: dict[str, int]
    by_session: int
    by_project: int
    average_importance: float
    oldest_memory: str | None
    newest_memory: str | None


class BulkDeleteRequest(BaseModel):
    """Request for bulk delete."""

    memory_type: str | None = None
    session_id: str | None = None
    older_than_days: int | None = None
    tags: list[str] | None = None


class CreateMemoryRequest(BaseModel):
    """Request for creating a new memory."""

    content: str
    memory_type: str = "fact"
    tags: list[str] | None = None
    importance: float = 0.5


# ============================================================================
# Routes
# ============================================================================


@router.get("/memories", response_model=MemoryListResponse)
async def list_memories(
    request: Request,
    db: DbSession,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    memory_type: str | None = None,
    session_id: str | None = None,
    search: str | None = None,
    sort_by: str = Query(default="created_at", pattern="^(created_at|importance|updated_at)$"),
    sort_order: str = Query(default="desc", pattern="^(asc|desc)$"),
) -> MemoryListResponse:
    """List user's memories with filtering and pagination."""
    user_id = get_current_user_id(request)

    # Build base query
    query = select(Memory).where(Memory.user_id == user_id)

    # Apply filters
    if memory_type:
        query = query.where(Memory.memory_type == memory_type)
    if session_id:
        query = query.where(Memory.session_id == session_id)
    if search:
        query = query.where(Memory.content.ilike(f"%{search}%"))

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Apply sorting
    sort_column = getattr(Memory, sort_by)
    if sort_order == "desc":
        query = query.order_by(sort_column.desc())
    else:
        query = query.order_by(sort_column.asc())

    # Apply pagination
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    # Execute
    result = await db.execute(query)
    memories = result.scalars().all()

    return MemoryListResponse(
        memories=[
            MemoryResponse(
                id=m.id,
                content=m.content,
                memory_type=m.memory_type,
                tags=m.tags,
                importance=m.importance,
                session_id=m.session_id,
                project_id=m.project_id,
                access_count=0,  # Not tracked in DB model currently
                created_at=m.created_at.isoformat(),
                updated_at=m.updated_at.isoformat(),
            )
            for m in memories
        ],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size if total > 0 else 1,
    )


@router.post("/memories", response_model=MemoryResponse)
async def create_memory(
    request: Request,
    db: DbSession,
    body: CreateMemoryRequest,
) -> MemoryResponse:
    """Create a new memory manually."""
    user_id = get_current_user_id(request)

    # Validate memory type
    valid_types = {"fact", "preference", "context", "code_pattern", "error_solution", "wiki"}
    if body.memory_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid memory type. Must be one of: {', '.join(valid_types)}",
        )

    # Validate importance
    importance = max(0.0, min(1.0, body.importance))

    # Create memory
    memory = Memory(
        user_id=user_id,
        content=body.content,
        memory_type=body.memory_type,
        tags=body.tags or [],
        importance=importance,
    )
    db.add(memory)
    await db.commit()
    await db.refresh(memory)

    logger.info(
        "Memory created manually",
        memory_id=memory.id,
        memory_type=body.memory_type,
        user_id=user_id,
    )

    return MemoryResponse(
        id=memory.id,
        content=memory.content,
        memory_type=memory.memory_type,
        tags=memory.tags,
        importance=memory.importance,
        session_id=memory.session_id,
        project_id=memory.project_id,
        access_count=0,
        created_at=memory.created_at.isoformat(),
        updated_at=memory.updated_at.isoformat(),
    )


@router.get("/memories/stats", response_model=MemoryStatsResponse)
async def get_memory_stats(
    request: Request,
    db: DbSession,
) -> MemoryStatsResponse:
    """Get memory statistics for the user."""
    user_id = get_current_user_id(request)

    # Total count
    total_result = await db.execute(select(func.count()).where(Memory.user_id == user_id))
    total = total_result.scalar() or 0

    # Count by type
    type_counts_result = await db.execute(
        select(Memory.memory_type, func.count())
        .where(Memory.user_id == user_id)
        .group_by(Memory.memory_type)
    )
    by_type = {row[0]: row[1] for row in type_counts_result.all()}

    # Count with session
    session_count_result = await db.execute(
        select(func.count()).where(Memory.user_id == user_id).where(Memory.session_id.isnot(None))
    )
    by_session = session_count_result.scalar() or 0

    # Count with project
    project_count_result = await db.execute(
        select(func.count()).where(Memory.user_id == user_id).where(Memory.project_id.isnot(None))
    )
    by_project = project_count_result.scalar() or 0

    # Average importance
    avg_result = await db.execute(
        select(func.avg(Memory.importance)).where(Memory.user_id == user_id)
    )
    avg_importance = avg_result.scalar() or 0.5

    # Oldest and newest
    oldest_result = await db.execute(
        select(Memory.created_at)
        .where(Memory.user_id == user_id)
        .order_by(Memory.created_at.asc())
        .limit(1)
    )
    oldest = oldest_result.scalar()

    newest_result = await db.execute(
        select(Memory.created_at)
        .where(Memory.user_id == user_id)
        .order_by(Memory.created_at.desc())
        .limit(1)
    )
    newest = newest_result.scalar()

    return MemoryStatsResponse(
        total_memories=total,
        by_type=by_type,
        by_session=by_session,
        by_project=by_project,
        average_importance=round(avg_importance, 2),
        oldest_memory=oldest.isoformat() if oldest else None,
        newest_memory=newest.isoformat() if newest else None,
    )


@router.get("/memories/{memory_id}", response_model=MemoryResponse)
async def get_memory(
    memory_id: str,
    request: Request,
    db: DbSession,
) -> MemoryResponse:
    """Get a specific memory."""
    user_id = get_current_user_id(request)

    result = await db.execute(
        select(Memory).where(Memory.id == memory_id, Memory.user_id == user_id)
    )
    memory = result.scalar_one_or_none()

    if not memory:
        raise HTTPException(status_code=404, detail="Memory not found")

    return MemoryResponse(
        id=memory.id,
        content=memory.content,
        memory_type=memory.memory_type,
        tags=memory.tags,
        importance=memory.importance,
        session_id=memory.session_id,
        project_id=memory.project_id,
        access_count=0,
        created_at=memory.created_at.isoformat(),
        updated_at=memory.updated_at.isoformat(),
    )


@router.delete("/memories/{memory_id}")
async def delete_memory(
    memory_id: str,
    request: Request,
    db: DbSession,
) -> dict[str, str]:
    """Delete a specific memory."""
    user_id = get_current_user_id(request)

    result = await db.execute(
        select(Memory).where(Memory.id == memory_id, Memory.user_id == user_id)
    )
    memory = result.scalar_one_or_none()

    if not memory:
        raise HTTPException(status_code=404, detail="Memory not found")

    await db.delete(memory)
    await db.commit()

    logger.info("Memory deleted", memory_id=memory_id, user_id=user_id)

    return {"status": "deleted", "memory_id": memory_id}


@router.post("/memories/bulk-delete")
async def bulk_delete_memories(
    request: Request,
    db: DbSession,
    body: BulkDeleteRequest,
) -> dict[str, int]:
    """Bulk delete memories based on criteria."""
    user_id = get_current_user_id(request)

    # Build delete query
    conditions = [Memory.user_id == user_id]

    if body.memory_type:
        conditions.append(Memory.memory_type == body.memory_type)

    if body.session_id:
        conditions.append(Memory.session_id == body.session_id)

    if body.older_than_days:
        cutoff = datetime.now(tz=UTC) - timedelta(days=body.older_than_days)
        conditions.append(Memory.created_at < cutoff)

    # Execute delete
    delete_stmt = delete(Memory).where(*conditions)
    result = await db.execute(delete_stmt)
    await db.commit()

    deleted_count = result.rowcount or 0  # type: ignore[attr-defined]

    logger.info(
        "Bulk delete completed",
        user_id=user_id,
        deleted_count=deleted_count,
        criteria=body.model_dump(exclude_none=True),
    )

    return {"deleted_count": deleted_count}


@router.delete("/memories")
async def clear_all_memories(
    request: Request,
    db: DbSession,
    confirm: bool = Query(default=False),
) -> dict[str, int]:
    """Clear all memories for the user. Requires confirm=true."""
    if not confirm:
        raise HTTPException(
            status_code=400,
            detail="Add ?confirm=true to confirm deletion of all memories",
        )

    user_id = get_current_user_id(request)

    delete_stmt = delete(Memory).where(Memory.user_id == user_id)
    result = await db.execute(delete_stmt)
    await db.commit()

    deleted_count = result.rowcount or 0  # type: ignore[attr-defined]

    logger.info("All memories cleared", user_id=user_id, deleted_count=deleted_count)

    return {"deleted_count": deleted_count}
