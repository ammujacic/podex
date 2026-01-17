"""Context window management routes."""

from datetime import UTC, datetime
from uuid import uuid4

import structlog
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.agent_client import agent_client
from src.database.models import (
    Agent,
    CompactionLog,
    ContextCompactionSettings,
)
from src.database.models import (
    Session as SessionModel,
)
from src.routes.dependencies import DbSession, get_current_user_id
from src.websocket.hub import emit_to_session

logger = structlog.get_logger()

router = APIRouter()


class ContextUsageResponse(BaseModel):
    """Context usage response."""

    agent_id: str
    tokens_used: int
    tokens_max: int
    percentage: int


class CompactionSettingsRequest(BaseModel):
    """Compaction settings update request."""

    auto_compact_enabled: bool | None = None
    auto_compact_threshold_percent: int | None = None
    custom_compaction_instructions: str | None = None
    preserve_recent_messages: int | None = None


class CompactionSettingsResponse(BaseModel):
    """Compaction settings response."""

    auto_compact_enabled: bool
    auto_compact_threshold_percent: int
    custom_compaction_instructions: str | None
    preserve_recent_messages: int


class CompactRequest(BaseModel):
    """Manual compaction request."""

    custom_instructions: str | None = None
    preserve_recent_messages: int | None = None


class CompactResponse(BaseModel):
    """Compaction response."""

    success: bool
    tokens_before: int
    tokens_after: int
    messages_removed: int
    summary: str | None


class CompactionLogResponse(BaseModel):
    """Compaction log entry response."""

    id: str
    agent_id: str
    tokens_before: int
    tokens_after: int
    messages_removed: int
    messages_preserved: int
    summary_text: str | None
    trigger_type: str
    created_at: str


async def maybe_trigger_auto_compaction(
    db: AsyncSession,
    agent: Agent,
    session_id: str,
    _user_id: str,
) -> bool:
    """Check if auto-compaction should be triggered and execute if needed.

    This function checks the compaction settings for the session and triggers
    automatic compaction if the context usage exceeds the configured threshold.

    Args:
        db: Database session
        agent: The agent to check
        session_id: Session ID for settings lookup
        user_id: User ID for authorization

    Returns:
        True if compaction was triggered, False otherwise
    """
    # Skip for terminal agents - they don't track context the same way
    if str(agent.id).startswith("terminal-"):
        return False

    # Get compaction settings for session
    settings_result = await db.execute(
        select(ContextCompactionSettings).where(ContextCompactionSettings.session_id == session_id)
    )
    settings = settings_result.scalar_one_or_none()

    # Use defaults if no settings
    auto_enabled = settings.auto_compact_enabled if settings else True
    threshold_percent = settings.auto_compact_threshold_percent if settings else 80
    custom_instructions = settings.custom_compaction_instructions if settings else None
    preserve_recent = settings.preserve_recent_messages if settings else 15

    if not auto_enabled:
        return False

    # Check threshold
    tokens_max = agent.context_max_tokens or 200000
    tokens_used = agent.context_tokens_used or 0
    threshold = tokens_max * (threshold_percent / 100)

    if tokens_used < threshold:
        return False

    logger.info(
        "Auto-compaction triggered",
        agent_id=str(agent.id),
        session_id=session_id,
        tokens_used=tokens_used,
        tokens_max=tokens_max,
        threshold_percent=threshold_percent,
    )

    # Emit compaction started event
    await emit_to_session(
        session_id,
        "compaction_started",
        {
            "agent_id": str(agent.id),
            "session_id": session_id,
            "trigger_type": "auto",
        },
    )

    try:
        # Call agent service to perform compaction
        result = await agent_client._request(
            "POST",
            f"/agents/{agent.id}/compact",
            json={
                "custom_instructions": custom_instructions,
                "preserve_recent_messages": preserve_recent,
            },
        )

        tokens_after = result.get("tokens_after", tokens_used)
        messages_removed = result.get("messages_removed", 0)
        messages_preserved = result.get("messages_preserved", 0)
        summary = result.get("summary")

        # Update agent context usage
        agent.context_tokens_used = tokens_after
        await db.commit()

        # Log the compaction
        log = CompactionLog(
            id=str(uuid4()),
            agent_id=str(agent.id),
            session_id=session_id,
            tokens_before=tokens_used,
            tokens_after=tokens_after,
            messages_removed=messages_removed,
            messages_preserved=messages_preserved,
            summary_text=summary,
            trigger_type="auto",
            custom_instructions=custom_instructions,
        )
        db.add(log)
        await db.commit()

        # Emit compaction completed event
        await emit_to_session(
            session_id,
            "compaction_completed",
            {
                "agent_id": str(agent.id),
                "session_id": session_id,
                "tokens_before": tokens_used,
                "tokens_after": tokens_after,
                "messages_removed": messages_removed,
                "summary": summary,
                "trigger_type": "auto",
            },
        )

        # Emit updated context usage
        await emit_to_session(
            session_id,
            "context_usage_update",
            {
                "agent_id": str(agent.id),
                "tokens_used": tokens_after,
                "tokens_max": tokens_max,
                "percentage": int((tokens_after / tokens_max) * 100),
            },
        )

        logger.info(
            "Auto-compaction completed",
            agent_id=str(agent.id),
            tokens_before=tokens_used,
            tokens_after=tokens_after,
            messages_removed=messages_removed,
        )

    except Exception as e:
        logger.exception("Auto-compaction failed", agent_id=str(agent.id), error=str(e))
        # Emit failure event
        await emit_to_session(
            session_id,
            "compaction_failed",
            {
                "agent_id": str(agent.id),
                "session_id": session_id,
                "error": str(e),
                "trigger_type": "auto",
            },
        )
        return False
    else:
        return True


@router.get("/agents/{agent_id}/context", response_model=ContextUsageResponse)
async def get_agent_context_usage(
    agent_id: str,
    request: Request,
    db: DbSession,
) -> ContextUsageResponse:
    """Get context usage for an agent."""
    user_id = get_current_user_id(request)

    # Handle terminal agents (prefixed with "terminal-")
    # Terminal agents don't track context usage the same way as regular agents
    if agent_id.startswith("terminal-"):
        return ContextUsageResponse(
            agent_id=agent_id,
            tokens_used=0,
            tokens_max=0,
            percentage=0,
        )

    # Verify agent exists and user has access
    agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = agent_result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Verify session access
    session_result = await db.execute(
        select(SessionModel).where(SessionModel.id == agent.session_id)
    )
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Get usage from agent model
    tokens_used = agent.context_tokens_used or 0
    tokens_max = agent.context_max_tokens or 200000
    percentage = int((tokens_used / tokens_max) * 100) if tokens_max > 0 else 0

    return ContextUsageResponse(
        agent_id=agent_id,
        tokens_used=tokens_used,
        tokens_max=tokens_max,
        percentage=percentage,
    )


@router.get("/sessions/{session_id}/context/settings", response_model=CompactionSettingsResponse)
async def get_compaction_settings(
    session_id: str,
    request: Request,
    db: DbSession,
) -> CompactionSettingsResponse:
    """Get compaction settings for a session."""
    user_id = get_current_user_id(request)

    # Verify session access
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == session_id))
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Get settings or use defaults
    settings_result = await db.execute(
        select(ContextCompactionSettings).where(ContextCompactionSettings.session_id == session_id)
    )
    settings = settings_result.scalar_one_or_none()

    if settings:
        return CompactionSettingsResponse(
            auto_compact_enabled=settings.auto_compact_enabled,
            auto_compact_threshold_percent=settings.auto_compact_threshold_percent,
            custom_compaction_instructions=settings.custom_compaction_instructions,
            preserve_recent_messages=settings.preserve_recent_messages,
        )

    # Return defaults
    return CompactionSettingsResponse(
        auto_compact_enabled=True,
        auto_compact_threshold_percent=80,
        custom_compaction_instructions=None,
        preserve_recent_messages=15,
    )


@router.put("/sessions/{session_id}/context/settings", response_model=CompactionSettingsResponse)
async def update_compaction_settings(
    session_id: str,
    settings_data: CompactionSettingsRequest,
    request: Request,
    db: DbSession,
) -> CompactionSettingsResponse:
    """Update compaction settings for a session."""
    user_id = get_current_user_id(request)

    # Verify session access
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == session_id))
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Get or create settings
    settings_result = await db.execute(
        select(ContextCompactionSettings).where(ContextCompactionSettings.session_id == session_id)
    )
    settings = settings_result.scalar_one_or_none()

    if not settings:
        settings = ContextCompactionSettings(
            id=str(uuid4()),
            user_id=user_id,
            session_id=session_id,
        )
        db.add(settings)

    # Update fields if provided
    if settings_data.auto_compact_enabled is not None:
        settings.auto_compact_enabled = settings_data.auto_compact_enabled
    if settings_data.auto_compact_threshold_percent is not None:
        settings.auto_compact_threshold_percent = settings_data.auto_compact_threshold_percent
    if settings_data.custom_compaction_instructions is not None:
        settings.custom_compaction_instructions = settings_data.custom_compaction_instructions
    if settings_data.preserve_recent_messages is not None:
        settings.preserve_recent_messages = settings_data.preserve_recent_messages

    await db.commit()
    await db.refresh(settings)

    return CompactionSettingsResponse(
        auto_compact_enabled=settings.auto_compact_enabled,
        auto_compact_threshold_percent=settings.auto_compact_threshold_percent,
        custom_compaction_instructions=settings.custom_compaction_instructions,
        preserve_recent_messages=settings.preserve_recent_messages,
    )


@router.post("/agents/{agent_id}/compact", response_model=CompactResponse)
async def compact_agent_context(
    agent_id: str,
    compact_data: CompactRequest,
    request: Request,
    db: DbSession,
) -> CompactResponse:
    """Manually trigger context compaction for an agent."""
    user_id = get_current_user_id(request)

    # Verify agent exists and user has access
    agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = agent_result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Verify session access
    session_result = await db.execute(
        select(SessionModel).where(SessionModel.id == agent.session_id)
    )
    session = session_result.scalar_one_or_none()

    if not session or session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Emit compaction started event
    await emit_to_session(
        str(agent.session_id),
        "compaction_started",
        {
            "agent_id": agent_id,
            "session_id": str(agent.session_id),
            "trigger_type": "manual",
        },
    )

    tokens_before = agent.context_tokens_used or 0

    # Get preserve_recent_messages from request or session settings
    preserve_recent = compact_data.preserve_recent_messages
    if preserve_recent is None:
        # Get from session settings if not provided
        settings_result = await db.execute(
            select(ContextCompactionSettings).where(
                ContextCompactionSettings.session_id == str(agent.session_id)
            )
        )
        settings = settings_result.scalar_one_or_none()
        preserve_recent = settings.preserve_recent_messages if settings else 15

    try:
        # Call agent service to perform compaction
        result = await agent_client._request(
            "POST",
            f"/agents/{agent_id}/compact",
            json={
                "custom_instructions": compact_data.custom_instructions,
                "preserve_recent_messages": preserve_recent,
            },
        )

        tokens_after = result.get("tokens_after", tokens_before)
        messages_removed = result.get("messages_removed", 0)
        summary = result.get("summary")

        # Update agent context usage
        agent.context_tokens_used = tokens_after
        await db.commit()

        # Log the compaction
        log = CompactionLog(
            id=str(uuid4()),
            agent_id=agent_id,
            tokens_before=tokens_before,
            tokens_after=tokens_after,
            messages_removed=messages_removed,
            messages_preserved=result.get("messages_preserved", 0),
            summary_text=summary,
            trigger_type="manual",
        )
        db.add(log)
        await db.commit()

        # Emit compaction completed event
        await emit_to_session(
            str(agent.session_id),
            "compaction_completed",
            {
                "agent_id": agent_id,
                "session_id": str(agent.session_id),
                "tokens_before": tokens_before,
                "tokens_after": tokens_after,
                "messages_removed": messages_removed,
                "summary": summary,
                "trigger_type": "manual",
            },
        )

        # Emit updated context usage
        await emit_to_session(
            str(agent.session_id),
            "context_usage_update",
            {
                "agent_id": agent_id,
                "tokens_used": tokens_after,
                "tokens_max": agent.context_max_tokens or 200000,
                "percentage": int((tokens_after / (agent.context_max_tokens or 200000)) * 100),
            },
        )

        return CompactResponse(
            success=True,
            tokens_before=tokens_before,
            tokens_after=tokens_after,
            messages_removed=messages_removed,
            summary=summary,
        )

    except Exception as e:
        logger.exception("Compaction failed", agent_id=agent_id, error=str(e))
        raise HTTPException(status_code=500, detail=f"Compaction failed: {e!s}") from e


@router.get("/sessions/{session_id}/context/history", response_model=list[CompactionLogResponse])
async def get_compaction_history(
    session_id: str,
    request: Request,
    db: DbSession,
) -> list[CompactionLogResponse]:
    """Get compaction history for a session."""
    user_id = get_current_user_id(request)

    # Verify session access
    session_result = await db.execute(select(SessionModel).where(SessionModel.id == session_id))
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Get all agents in session
    agents_result = await db.execute(select(Agent.id).where(Agent.session_id == session_id))
    agent_ids = [row[0] for row in agents_result.fetchall()]

    if not agent_ids:
        return []

    # Get compaction logs for all agents in session
    logs_result = await db.execute(
        select(CompactionLog)
        .where(CompactionLog.agent_id.in_(agent_ids))
        .order_by(CompactionLog.created_at.desc())
        .limit(50)
    )
    logs = logs_result.scalars().all()

    return [
        CompactionLogResponse(
            id=str(log.id),
            agent_id=str(log.agent_id),
            tokens_before=log.tokens_before,
            tokens_after=log.tokens_after,
            messages_removed=log.messages_removed,
            messages_preserved=log.messages_preserved,
            summary_text=log.summary_text,
            trigger_type=log.trigger_type,
            created_at=log.created_at.isoformat()
            if log.created_at
            else datetime.now(UTC).isoformat(),
        )
        for log in logs
    ]
