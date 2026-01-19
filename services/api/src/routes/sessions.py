"""Session management routes."""

import os
from dataclasses import dataclass
from datetime import UTC, datetime
from http import HTTPStatus
from pathlib import PurePath
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from src.audit_logger import AuditAction, AuditLogger
from src.cache import (
    cache_delete,
    cache_get,
    cache_set,
    invalidate_user_sessions,
    session_key,
)
from src.compute_client import compute_client
from src.config import settings
from src.database import Agent as AgentModel
from src.database import (
    FileChange,
    PlatformSetting,
    PodTemplate,
    SubscriptionPlan,
    UserSubscription,
)
from src.database import Session as SessionModel
from src.database import Workspace as WorkspaceModel
from src.exceptions import ComputeClientError, ComputeServiceHTTPError
from src.middleware.rate_limit import (
    RATE_LIMIT_STANDARD,
    RATE_LIMIT_UPLOAD,
    limiter,
)
from src.routes.dependencies import DbSession, get_current_user_id

logger = structlog.get_logger()

router = APIRouter()

# First agent always gets cyan color
DEFAULT_AGENT_COLOR = "#00e5ff"


async def _get_default_model_for_role(db: AsyncSession, role: str) -> str:
    """Get the default model for an agent role from platform settings."""
    result = await db.execute(
        select(PlatformSetting).where(PlatformSetting.key == "agent_model_defaults")
    )
    setting = result.scalar_one_or_none()

    if setting and setting.value and isinstance(setting.value, dict):
        defaults = setting.value
        if role in defaults and isinstance(defaults[role], dict) and "model_id" in defaults[role]:
            return str(defaults[role]["model_id"])

    raise HTTPException(
        status_code=500,
        detail=(
            f"No default model configured for role '{role}'. "
            "Check agent_model_defaults in platform settings."
        ),
    )


@dataclass
class SessionListParams:
    """Query parameters for listing sessions."""

    page: int = 1
    page_size: int = 20
    include_archived: bool = False
    archived_only: bool = False
    status: str | None = None
    cursor: str | None = None


@dataclass
class PaginationParams:
    """Pagination parameters."""

    page: int = 1
    page_size: int = 20
    cursor: str | None = None


def get_session_list_params(
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    include_archived: Annotated[bool, Query()] = False,
    archived_only: Annotated[bool, Query()] = False,
    status: Annotated[str | None, Query()] = None,
) -> SessionListParams:
    """Dependency to get session list parameters."""
    return SessionListParams(
        page=page,
        page_size=page_size,
        include_archived=include_archived,
        archived_only=archived_only,
        status=status,
    )


class SessionCreate(BaseModel):
    """Create session request."""

    name: str
    git_url: str | None = None
    branch: str = "main"
    template_id: str | None = None
    tier: str | None = None  # Hardware tier (starter, pro, etc.)


class SessionResponse(BaseModel):
    """Session response."""

    id: str
    name: str
    owner_id: str
    workspace_id: str | None
    branch: str
    status: str
    template_id: str | None = None
    git_url: str | None = None
    archived_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SessionListResponse(BaseModel):
    """Session list response."""

    items: list[SessionResponse]
    total: int
    page: int
    page_size: int
    has_more: bool
    # Cursor for next page (for cursor-based pagination)
    next_cursor: str | None = None


async def check_session_quota(db: AsyncSession, user_id: str) -> None:
    """Check if user has reached their session quota.

    Uses SELECT FOR UPDATE with NOWAIT on the user's subscription row to prevent
    race conditions where concurrent requests could exceed the quota. The lock
    serializes all concurrent session creation requests for the same user.

    Args:
        db: Database session
        user_id: User ID to check

    Raises:
        HTTPException: If user has exceeded their session quota or lock acquisition fails
    """
    from sqlalchemy.exc import OperationalError

    try:
        # Lock the user's subscription row with NOWAIT to fail fast on contention
        # This prevents race conditions where multiple requests could exceed the quota
        sub_query = (
            select(UserSubscription)
            .where(UserSubscription.user_id == user_id)
            .where(UserSubscription.status.in_(["active", "trialing"]))
            .order_by(UserSubscription.created_at.desc())
            .limit(1)
            .with_for_update(nowait=True)
        )
        sub_result = await db.execute(sub_query)
        subscription = sub_result.scalar_one_or_none()
    except OperationalError:
        # Lock acquisition failed - another request is creating a session
        raise HTTPException(
            status_code=409,
            detail="Another session creation is in progress. Please try again.",
        ) from None

    if not subscription:
        # No active subscription - use free tier limits (3 sessions)
        max_sessions = 3
    else:
        # Get plan limits
        plan_result = await db.execute(
            select(SubscriptionPlan).where(SubscriptionPlan.id == subscription.plan_id)
        )
        plan = plan_result.scalar_one_or_none()
        max_sessions = plan.max_sessions if plan else 3

    # Count current active (non-archived) sessions (within the lock)
    # The lock ensures this count is accurate and won't change until we commit
    count_query = (
        select(func.count())
        .select_from(SessionModel)
        .where(SessionModel.owner_id == user_id)
        .where(SessionModel.archived_at.is_(None))
    )
    count_result = await db.execute(count_query)
    current_sessions = count_result.scalar() or 0

    if current_sessions >= max_sessions:
        raise HTTPException(
            status_code=HTTPStatus.FORBIDDEN,
            detail=f"Session quota exceeded. You have {current_sessions} sessions "
            f"and your plan allows {max_sessions}. Please archive or delete existing "
            "sessions or upgrade your plan.",
        )


async def build_workspace_config(
    db: AsyncSession,
    template_id: str | None,
    git_url: str | None,
    tier: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Build workspace configuration from template and git URL.

    Args:
        db: Database session
        template_id: Optional template ID to fetch configuration from
        git_url: Optional git URL to clone
        tier: Optional hardware tier (defaults to "starter")
        user_id: Optional user ID to fetch git config from

    Returns:
        Workspace configuration dict for the compute service
    """
    from src.database.models import UserConfig

    config: dict[str, Any] = {
        "repos": [git_url] if git_url else [],
        "tier": tier or "starter",  # Default to starter tier if not specified
    }

    # Fetch user's configuration if user_id provided
    if user_id:
        user_config_result = await db.execute(
            select(UserConfig).where(UserConfig.user_id == user_id)
        )
        user_config = user_config_result.scalar_one_or_none()
        if user_config:
            # Git configuration
            if user_config.git_name:
                config["git_name"] = user_config.git_name
            if user_config.git_email:
                config["git_email"] = user_config.git_email
            # Dotfiles sync configuration
            config["sync_dotfiles"] = user_config.sync_dotfiles
            if user_config.dotfiles_paths:
                config["dotfiles_paths"] = user_config.dotfiles_paths

    if template_id:
        # Fetch template configuration
        template_result = await db.execute(select(PodTemplate).where(PodTemplate.id == template_id))
        template = template_result.scalar_one_or_none()

        if template:
            config["template_id"] = template_id

            # Apply template's base image if specified
            if template.base_image and template.base_image != "podex/workspace:latest":
                config["base_image"] = template.base_image

            # Apply pre-install commands as post_init_commands
            # (post_init runs after container is ready)
            if template.pre_install_commands:
                config["post_init_commands"] = template.pre_install_commands

            # Apply environment variables
            if template.environment_variables:
                config["environment"] = template.environment_variables

            logger.debug(
                "Applied template configuration",
                template_id=template_id,
                template_name=template.name,
                has_pre_install=bool(template.pre_install_commands),
                has_env_vars=bool(template.environment_variables),
            )

    return config


@router.post("", response_model=SessionResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def create_session(
    request: Request,
    response: Response,
    data: SessionCreate,
    db: DbSession,
) -> SessionResponse:
    """Create a new session."""
    user_id = get_current_user_id(request)

    # Check session quota before creating
    await check_session_quota(db, user_id)

    # Create workspace first
    workspace = WorkspaceModel(status="pending")
    db.add(workspace)
    await db.flush()

    try:
        # Create session with tier in settings
        settings = {}
        if data.tier:
            settings["tier"] = data.tier

        session = SessionModel(
            name=data.name,
            owner_id=user_id,
            workspace_id=workspace.id,
            git_url=data.git_url,
            branch=data.branch,
            template_id=data.template_id,
            status="active",
            settings=settings if settings else None,
        )
        db.add(session)
        await db.commit()
        await db.refresh(session)
    except Exception as e:
        # Rollback to clean up workspace on failure
        await db.rollback()
        logger.exception("Failed to create session", error=str(e), user_id=user_id)
        raise HTTPException(status_code=500, detail="Failed to create session") from None

    # Build workspace config from template (includes user's git config)
    workspace_config = await build_workspace_config(
        db, data.template_id, data.git_url, data.tier, user_id
    )

    # Provision workspace in compute service
    try:
        workspace_info = await compute_client.create_workspace(
            session_id=str(session.id),
            user_id=user_id,
            workspace_id=str(workspace.id),
            config=workspace_config,
        )
        # Update workspace status from compute service response
        workspace.status = workspace_info.get("status", "running")
        await db.commit()
    except ComputeClientError as e:
        logger.warning(
            "Failed to provision workspace in compute service",
            workspace_id=str(workspace.id),
            session_id=str(session.id),
            error=str(e),
        )
        # Session still usable, compute will be provisioned on first access

    # Invalidate user's sessions list cache (O(1) version increment)
    await invalidate_user_sessions(user_id)

    # Audit log: session created
    audit = AuditLogger(db).set_context(request=request, user_id=user_id)
    await audit.log_session_event(
        AuditAction.SESSION_CREATED,
        session_id=session.id,
        details={"name": session.name, "git_url": session.git_url, "branch": session.branch},
    )

    # Create default Chat agent for the session
    try:
        default_model = await _get_default_model_for_role(db, "chat")
        default_agent = AgentModel(
            session_id=session.id,
            name="Chat",
            role="chat",
            model=default_model,
            status="idle",
            mode="auto",
            config={"color": DEFAULT_AGENT_COLOR},
        )
        db.add(default_agent)
        await db.commit()
        logger.info(
            "Created default Chat agent for session",
            session_id=str(session.id),
            agent_id=str(default_agent.id),
        )
    except Exception as e:
        logger.warning(
            "Failed to create default Chat agent",
            session_id=str(session.id),
            error=str(e),
        )
        # Don't fail session creation if default agent creation fails

    return SessionResponse(
        id=session.id,
        name=session.name,
        owner_id=session.owner_id,
        workspace_id=session.workspace_id,
        branch=session.branch,
        status=session.status,
        template_id=session.template_id,
        git_url=session.git_url,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


@router.get("", response_model=SessionListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_sessions(
    request: Request,
    response: Response,
    db: DbSession,
    params: Annotated[SessionListParams, Depends(get_session_list_params)],
) -> SessionListResponse:
    """List user's sessions.

    Args:
        params: Query parameters for filtering and pagination
    """
    user_id = get_current_user_id(request)

    # Build base filter conditions
    conditions = [SessionModel.owner_id == user_id]

    # Archival filter
    if params.archived_only:
        conditions.append(SessionModel.archived_at.isnot(None))
    elif not params.include_archived:
        conditions.append(SessionModel.archived_at.is_(None))

    # Status filter
    if params.status:
        conditions.append(SessionModel.status == params.status)

    # Count total sessions matching filters
    count_query = select(func.count()).select_from(SessionModel).where(*conditions)
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Build query with pagination
    query = select(SessionModel).where(*conditions).order_by(SessionModel.updated_at.desc())

    # Apply cursor-based pagination if cursor provided
    if params.cursor:
        # Get the cursor session to find its updated_at
        cursor_result = await db.execute(
            select(SessionModel.updated_at).where(SessionModel.id == params.cursor),
        )
        cursor_updated_at = cursor_result.scalar()
        if cursor_updated_at:
            query = query.where(SessionModel.updated_at < cursor_updated_at)
    else:
        # Fall back to offset-based pagination
        offset = (params.page - 1) * params.page_size
        query = query.offset(offset)

    query = query.limit(params.page_size)

    result = await db.execute(query)
    sessions = result.scalars().all()

    items = [
        SessionResponse(
            id=s.id,
            name=s.name,
            owner_id=s.owner_id,
            workspace_id=s.workspace_id,
            branch=s.branch,
            status=s.status,
            template_id=s.template_id,
            git_url=s.git_url,
            archived_at=s.archived_at,
            created_at=s.created_at,
            updated_at=s.updated_at,
        )
        for s in sessions
    ]

    # Calculate next cursor
    next_cursor = items[-1].id if len(items) == params.page_size else None

    # Calculate has_more based on pagination type
    if params.cursor:
        # For cursor-based pagination, we have more if we got a full page
        # and there are still items remaining after the cursor
        has_more = len(items) == params.page_size and next_cursor is not None
    else:
        # For offset-based pagination, calculate based on total
        offset = (params.page - 1) * params.page_size
        has_more = (offset + len(items)) < total

    return SessionListResponse(
        items=items,
        total=total,
        page=params.page,
        page_size=params.page_size,
        has_more=has_more,
        next_cursor=next_cursor,
    )


@router.get("/{session_id}", response_model=SessionResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_session(
    session_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> SessionResponse:
    """Get session by ID."""
    user_id = get_current_user_id(request)

    # Try cache first
    cache_key = session_key(session_id)
    cached = await cache_get(cache_key)
    if cached is not None:
        # Check ownership
        if cached.get("owner_id") != user_id:
            raise HTTPException(status_code=403, detail="Access denied")
        logger.debug("Session cache hit", session_id=session_id)
        return SessionResponse(**cached)

    query = select(SessionModel).where(SessionModel.id == session_id)
    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    session_response = SessionResponse(
        id=session.id,
        name=session.name,
        owner_id=session.owner_id,
        workspace_id=session.workspace_id,
        branch=session.branch,
        status=session.status,
        template_id=session.template_id,
        git_url=session.git_url,
        archived_at=session.archived_at,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )

    # Cache the result
    await cache_set(cache_key, session_response, ttl=settings.CACHE_TTL_SESSIONS)

    return session_response


@router.post("/{session_id}/archive")
@limiter.limit(RATE_LIMIT_STANDARD)
async def archive_session(
    session_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> SessionResponse:
    """Archive a session."""
    query = select(SessionModel).where(SessionModel.id == session_id)
    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    user_id = get_current_user_id(request)
    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    if session.archived_at is not None:
        raise HTTPException(status_code=400, detail="Session is already archived")

    session.archived_at = datetime.now(UTC)
    session.archived_by = user_id
    await db.commit()
    await db.refresh(session)

    # Invalidate caches
    await cache_delete(session_key(session_id))
    await invalidate_user_sessions(user_id)

    return SessionResponse(
        id=session.id,
        name=session.name,
        owner_id=session.owner_id,
        workspace_id=session.workspace_id,
        branch=session.branch,
        status=session.status,
        template_id=session.template_id,
        git_url=session.git_url,
        archived_at=session.archived_at,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


@router.post("/{session_id}/unarchive")
@limiter.limit(RATE_LIMIT_STANDARD)
async def unarchive_session(
    session_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> SessionResponse:
    """Unarchive a session."""
    query = select(SessionModel).where(SessionModel.id == session_id)
    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    user_id = get_current_user_id(request)
    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    if session.archived_at is None:
        raise HTTPException(status_code=400, detail="Session is not archived")

    session.archived_at = None
    session.archived_by = None
    await db.commit()
    await db.refresh(session)

    # Invalidate caches
    await cache_delete(session_key(session_id))
    await invalidate_user_sessions(user_id)

    return SessionResponse(
        id=session.id,
        name=session.name,
        owner_id=session.owner_id,
        workspace_id=session.workspace_id,
        branch=session.branch,
        status=session.status,
        template_id=session.template_id,
        git_url=session.git_url,
        archived_at=session.archived_at,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


@router.delete("/{session_id}")
@limiter.limit(RATE_LIMIT_STANDARD)
async def delete_session(
    session_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, str]:
    """Delete a session."""
    query = select(SessionModel).where(SessionModel.id == session_id)
    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    user_id = get_current_user_id(request)
    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Capture session info before deletion for audit log
    session_name = session.name

    await db.delete(session)
    await db.commit()

    # Audit log: session deleted
    audit = AuditLogger(db).set_context(request=request, user_id=user_id)
    await audit.log_session_event(
        AuditAction.SESSION_DELETED,
        session_id=session_id,
        details={"name": session_name},
    )

    # Invalidate caches
    await cache_delete(session_key(session_id))
    await invalidate_user_sessions(user_id)

    return {"message": "Session deleted"}


# ==================== Layout Routes ====================


class LayoutResponse(BaseModel):
    """Session layout response."""

    view_mode: str = "grid"
    active_agent_id: str | None = None
    agent_layouts: dict[str, dict[str, Any]] = {}
    file_preview_layouts: dict[str, dict[str, Any]] = {}
    sidebar_open: bool = True
    sidebar_width: int = 280
    editor_grid_card_id: str | None = None
    editor_grid_span: dict[str, Any] | None = None
    editor_freeform_position: dict[str, Any] | None = None


class LayoutUpdateRequest(BaseModel):
    """Update session layout request."""

    view_mode: str | None = None
    active_agent_id: str | None = None
    agent_layouts: dict[str, dict[str, Any]] | None = None
    file_preview_layouts: dict[str, dict[str, Any]] | None = None
    sidebar_open: bool | None = None
    sidebar_width: int | None = None
    editor_grid_card_id: str | None = None
    editor_grid_span: dict[str, Any] | None = None
    editor_freeform_position: dict[str, Any] | None = None


@router.get("/{session_id}/layout", response_model=LayoutResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_session_layout(
    session_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> LayoutResponse:
    """Get session layout state."""
    session = await get_session_or_404(session_id, request, db)

    # Layout is stored in the session's settings JSONB field
    settings = session.settings or {}
    layout = settings.get("layout", {})

    return LayoutResponse(
        view_mode=layout.get("view_mode", "grid"),
        active_agent_id=layout.get("active_agent_id"),
        agent_layouts=layout.get("agent_layouts", {}),
        file_preview_layouts=layout.get("file_preview_layouts", {}),
        sidebar_open=layout.get("sidebar_open", True),
        sidebar_width=layout.get("sidebar_width", 280),
        editor_grid_card_id=layout.get("editor_grid_card_id"),
        editor_grid_span=layout.get("editor_grid_span"),
        editor_freeform_position=layout.get("editor_freeform_position"),
    )


@router.put("/{session_id}/layout", response_model=LayoutResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def update_session_layout(
    session_id: str,
    request: Request,
    response: Response,
    data: LayoutUpdateRequest,
    db: DbSession,
) -> LayoutResponse:
    """Update session layout state."""
    session = await get_session_or_404(session_id, request, db)

    # Get existing settings and layout
    settings = session.settings or {}
    layout = settings.get("layout", {})

    # Update layout fields if provided
    if data.view_mode is not None:
        layout["view_mode"] = data.view_mode
    if data.active_agent_id is not None:
        layout["active_agent_id"] = data.active_agent_id
    if data.agent_layouts is not None:
        layout["agent_layouts"] = data.agent_layouts
    if data.file_preview_layouts is not None:
        layout["file_preview_layouts"] = data.file_preview_layouts
    if data.sidebar_open is not None:
        layout["sidebar_open"] = data.sidebar_open
    if data.sidebar_width is not None:
        layout["sidebar_width"] = data.sidebar_width
    if data.editor_grid_card_id is not None:
        layout["editor_grid_card_id"] = data.editor_grid_card_id
    if data.editor_grid_span is not None:
        layout["editor_grid_span"] = data.editor_grid_span
    if data.editor_freeform_position is not None:
        layout["editor_freeform_position"] = data.editor_freeform_position

    # Save back to session
    settings["layout"] = layout
    session.settings = settings
    # Mark settings as modified for SQLAlchemy to detect JSONB changes
    flag_modified(session, "settings")
    await db.commit()

    return LayoutResponse(
        view_mode=layout.get("view_mode", "grid"),
        active_agent_id=layout.get("active_agent_id"),
        agent_layouts=layout.get("agent_layouts", {}),
        file_preview_layouts=layout.get("file_preview_layouts", {}),
        sidebar_open=layout.get("sidebar_open", True),
        sidebar_width=layout.get("sidebar_width", 280),
        editor_grid_card_id=layout.get("editor_grid_card_id"),
        editor_grid_span=layout.get("editor_grid_span"),
        editor_freeform_position=layout.get("editor_freeform_position"),
    )


@router.patch("/{session_id}/layout/agent/{agent_id}")
@limiter.limit(RATE_LIMIT_STANDARD)
async def update_agent_layout(
    session_id: str,
    agent_id: str,
    request: Request,
    response: Response,
    data: dict[str, Any],
    db: DbSession,
) -> dict[str, Any]:
    """Update a single agent's layout."""
    session = await get_session_or_404(session_id, request, db)

    settings: dict[str, Any] = session.settings or {}
    layout: dict[str, Any] = settings.get("layout", {})
    agent_layouts: dict[str, Any] = layout.get("agent_layouts", {})

    # Update or create agent layout
    current: dict[str, Any] = agent_layouts.get(agent_id, {"agent_id": agent_id})
    current.update(data)
    agent_layouts[agent_id] = current

    layout["agent_layouts"] = agent_layouts
    settings["layout"] = layout
    session.settings = settings
    # Mark settings as modified for SQLAlchemy to detect JSONB changes
    flag_modified(session, "settings")
    await db.commit()

    return current


@router.patch("/{session_id}/layout/file-preview/{preview_id}")
@limiter.limit(RATE_LIMIT_STANDARD)
async def update_file_preview_layout(
    session_id: str,
    preview_id: str,
    request: Request,
    response: Response,
    data: dict[str, Any],
    db: DbSession,
) -> dict[str, Any]:
    """Update a single file preview's layout."""
    session = await get_session_or_404(session_id, request, db)

    settings: dict[str, Any] = session.settings or {}
    layout: dict[str, Any] = settings.get("layout", {})
    file_preview_layouts: dict[str, Any] = layout.get("file_preview_layouts", {})

    # Update or create file preview layout
    current: dict[str, Any] = file_preview_layouts.get(preview_id, {"preview_id": preview_id})
    current.update(data)
    file_preview_layouts[preview_id] = current

    layout["file_preview_layouts"] = file_preview_layouts
    settings["layout"] = layout
    session.settings = settings
    # Mark settings as modified for SQLAlchemy to detect JSONB changes
    flag_modified(session, "settings")
    await db.commit()

    return current


@router.patch("/{session_id}/layout/editor")
@limiter.limit(RATE_LIMIT_STANDARD)
async def update_editor_layout(
    session_id: str,
    request: Request,
    response: Response,
    data: dict[str, Any],
    db: DbSession,
) -> dict[str, Any]:
    """Update the editor grid card's layout."""
    session = await get_session_or_404(session_id, request, db)

    settings: dict[str, Any] = session.settings or {}
    layout: dict[str, Any] = settings.get("layout", {})

    # Update editor layout fields
    if "editor_grid_card_id" in data:
        layout["editor_grid_card_id"] = data["editor_grid_card_id"]
    if "editor_grid_span" in data:
        layout["editor_grid_span"] = data["editor_grid_span"]
    if "editor_freeform_position" in data:
        layout["editor_freeform_position"] = data["editor_freeform_position"]

    settings["layout"] = layout
    session.settings = settings
    # Mark settings as modified for SQLAlchemy to detect JSONB changes
    flag_modified(session, "settings")
    await db.commit()

    return {
        "editor_grid_card_id": layout.get("editor_grid_card_id"),
        "editor_grid_span": layout.get("editor_grid_span"),
        "editor_freeform_position": layout.get("editor_freeform_position"),
    }


# ==================== Standby Settings Routes ====================


class StandbySettingsResponse(BaseModel):
    """Session standby settings response."""

    timeout_minutes: int | None  # None = Never
    source: str  # "session" or "user_default"


class StandbySettingsRequest(BaseModel):
    """Update session standby settings."""

    timeout_minutes: int | None = None  # None = Never, or 15/30/60/120


@router.get("/{session_id}/standby-settings", response_model=StandbySettingsResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_standby_settings(
    session_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> StandbySettingsResponse:
    """Get effective standby settings for session."""
    from src.database.models import UserConfig

    session = await get_session_or_404(session_id, request, db)

    # Check session-level override first
    settings = session.settings or {}
    if "standby_timeout_minutes" in settings:
        return StandbySettingsResponse(
            timeout_minutes=settings.get("standby_timeout_minutes"),
            source="session",
        )

    # Fall back to user default
    result = await db.execute(select(UserConfig).where(UserConfig.user_id == session.owner_id))
    user_config = result.scalar_one_or_none()

    timeout = (user_config.default_standby_timeout_minutes if user_config else None) or 60

    return StandbySettingsResponse(
        timeout_minutes=timeout,
        source="user_default",
    )


@router.patch("/{session_id}/standby-settings", response_model=StandbySettingsResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def update_standby_settings(
    session_id: str,
    data: StandbySettingsRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> StandbySettingsResponse:
    """Update per-session standby override."""
    session = await get_session_or_404(session_id, request, db)

    user_id = get_current_user_id(request)
    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Validate timeout value (must be one of the presets or None)
    valid_timeouts = {15, 30, 60, 120, None}
    if data.timeout_minutes not in valid_timeouts:
        raise HTTPException(
            status_code=400,
            detail="Invalid timeout. Must be 15, 30, 60, 120, or null (never)",
        )

    # Update session settings
    settings = session.settings or {}
    settings["standby_timeout_minutes"] = data.timeout_minutes
    session.settings = settings
    await db.commit()

    # Invalidate session cache
    await cache_delete(session_key(session_id))

    return StandbySettingsResponse(
        timeout_minutes=data.timeout_minutes,
        source="session",
    )


@router.delete("/{session_id}/standby-settings")
@limiter.limit(RATE_LIMIT_STANDARD)
async def clear_standby_settings(
    session_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> StandbySettingsResponse:
    """Clear per-session standby override (revert to user default)."""
    from src.database.models import UserConfig

    session = await get_session_or_404(session_id, request, db)

    user_id = get_current_user_id(request)
    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Remove session-level override
    settings = session.settings or {}
    if "standby_timeout_minutes" in settings:
        del settings["standby_timeout_minutes"]
        session.settings = settings
        await db.commit()

    # Invalidate session cache
    await cache_delete(session_key(session_id))

    # Return user default
    result = await db.execute(select(UserConfig).where(UserConfig.user_id == session.owner_id))
    user_config = result.scalar_one_or_none()

    timeout = (user_config.default_standby_timeout_minutes if user_config else None) or 60

    return StandbySettingsResponse(
        timeout_minutes=timeout,
        source="user_default",
    )


# ==================== File System Routes ====================


class FileNode(BaseModel):
    """File tree node."""

    name: str
    path: str
    type: str  # file or directory
    children: list["FileNode"] | None = None


class FileContent(BaseModel):
    """File content response."""

    path: str
    content: str
    language: str


class CreateFileRequest(BaseModel):
    """Create file request."""

    path: str
    content: str = ""


class UpdateFileRequest(BaseModel):
    """Update file request."""

    content: str


class MoveFileRequest(BaseModel):
    """Move/rename file request."""

    source_path: str
    dest_path: str


def validate_file_path(path: str, max_length: int = 4096) -> str:
    """Validate and normalize a file path to prevent path traversal attacks.

    Args:
        path: The file path to validate.
        max_length: Maximum allowed path length (default 4096).

    Returns:
        The normalized, safe path.

    Raises:
        HTTPException: If the path is invalid or attempts path traversal.
    """
    # Security: Check for null bytes FIRST (can bypass other checks)
    if "\x00" in path:
        raise HTTPException(status_code=400, detail="Invalid path: null bytes not allowed")

    # Check path length to prevent DoS
    if len(path) > max_length:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid path: path too long (max {max_length} characters)",
        )

    # Reject empty paths
    if not path or not path.strip():
        raise HTTPException(status_code=400, detail="Invalid path: path cannot be empty")

    # Check for backslashes (normalize to forward slashes for consistency)
    # This prevents mixed-separator bypass attempts
    clean_path = path.replace("\\", "/")

    # Reject URL-encoded traversal attempts (before normalization)
    if "%2e" in path.lower() or "%2f" in path.lower():
        raise HTTPException(
            status_code=400,
            detail="Invalid path: URL-encoded characters not allowed",
        )

    # Normalize the path to resolve any .. or . components
    normalized = os.path.normpath(clean_path)

    # Check for path traversal attempts
    if normalized.startswith(("..", "/")):
        raise HTTPException(
            status_code=400,
            detail="Invalid path: absolute paths and path traversal are not allowed",
        )

    # Check for any remaining .. after normalization
    if ".." in PurePath(normalized).parts:
        raise HTTPException(
            status_code=400,
            detail="Invalid path: path traversal is not allowed",
        )

    # "." is allowed - it represents the current/root directory for listing
    return normalized


def get_language_from_path(path: str) -> str:
    """Determine language from file extension."""
    extension = path.split(".")[-1].lower() if "." in path else ""
    language_map = {
        "tsx": "typescript",
        "ts": "typescript",
        "json": "json",
        "js": "javascript",
        "jsx": "javascript",
        "py": "python",
        "md": "markdown",
        "css": "css",
        "html": "html",
        "yml": "yaml",
        "yaml": "yaml",
        "sh": "shell",
        "bash": "shell",
        "sql": "sql",
        "go": "go",
        "rs": "rust",
        "java": "java",
        "c": "c",
        "cpp": "cpp",
        "h": "c",
        "hpp": "cpp",
    }
    return language_map.get(extension, "plaintext")


# Demo file tree for development
def get_demo_file_tree() -> list[FileNode]:
    """Get demo file tree."""
    return [
        FileNode(
            name="src",
            path="src",
            type="directory",
            children=[
                FileNode(
                    name="components",
                    path="src/components",
                    type="directory",
                    children=[
                        FileNode(name="Button.tsx", path="src/components/Button.tsx", type="file"),
                        FileNode(name="Input.tsx", path="src/components/Input.tsx", type="file"),
                    ],
                ),
                FileNode(name="App.tsx", path="src/App.tsx", type="file"),
                FileNode(name="index.tsx", path="src/index.tsx", type="file"),
            ],
        ),
        FileNode(name="package.json", path="package.json", type="file"),
        FileNode(name="tsconfig.json", path="tsconfig.json", type="file"),
        FileNode(name="README.md", path="README.md", type="file"),
    ]


# Demo file contents
DEMO_FILE_CONTENTS: dict[str, str] = {
    "src/App.tsx": """import { useState } from 'react';
import { Button } from './components/Button';

export function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="app">
      <h1>Welcome to Podex</h1>
      <p>Count: {count}</p>
      <Button onClick={() => setCount(c => c + 1)}>
        Increment
      </Button>
    </div>
  );
}""",
    "src/index.tsx": """import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);""",
    "src/components/Button.tsx": """import { type ReactNode } from 'react';

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
}

export function Button({ children, onClick, variant = 'primary' }: ButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`btn btn-${variant}`}
    >
      {children}
    </button>
  );
}""",
    "src/components/Input.tsx": """interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function Input({ value, onChange, placeholder }: InputProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="input"
    />
  );
}""",
    "package.json": """{
  "name": "my-app",
  "version": "1.0.0",
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vite": "^5.0.0"
  },
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  }
}""",
    "tsconfig.json": """{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}""",
    "README.md": """# My App

A sample application built with React and TypeScript.

## Getting Started

```bash
npm install
npm run dev
```

## Features

- React 18
- TypeScript
- Vite
""",
}


async def get_session_or_404(
    session_id: str,
    request: Request,
    db: AsyncSession,
) -> SessionModel:
    """Get session by ID or raise 404."""
    query = select(SessionModel).where(SessionModel.id == session_id)
    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    user_id = get_current_user_id(request)
    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return session


async def ensure_workspace_provisioned(
    session: SessionModel,
    user_id: str,
    db: AsyncSession | None = None,
) -> None:
    """Ensure workspace is provisioned in compute service.

    For sessions created before workspace provisioning was added,
    this lazily provisions the workspace on first access.

    Uses a distributed Redis lock to prevent race conditions when
    multiple requests try to provision the same workspace concurrently.

    Args:
        session: The session model
        user_id: The user ID
        db: Optional database session for fetching template configuration
    """
    if not session.workspace_id:
        return

    workspace_id = str(session.workspace_id)

    # Check if workspace exists in compute service (fast path, no lock needed)
    try:
        existing = await compute_client.get_workspace(workspace_id, user_id)
        if existing:
            return  # Workspace exists, nothing to do
    except ComputeServiceHTTPError as e:
        if e.status_code != 404:
            raise  # Re-raise non-404 errors

    # Build workspace config from template if db session is available
    if db and session.template_id:
        tier = session.settings.get("tier") if session.settings else None
        workspace_config = await build_workspace_config(
            db, session.template_id, session.git_url, tier, user_id
        )
    elif db:
        # No template but we have db - still fetch git config
        tier = session.settings.get("tier", "starter") if session.settings else "starter"
        workspace_config = await build_workspace_config(db, None, session.git_url, tier, user_id)
    else:
        tier = session.settings.get("tier", "starter") if session.settings else "starter"
        workspace_config = {
            "repos": [session.git_url] if session.git_url else [],
            "tier": tier,
        }

    # Workspace doesn't exist, acquire lock before provisioning
    # This prevents multiple concurrent requests from trying to create
    # the same workspace simultaneously
    from src.cache import get_cache_client

    lock_key = f"workspace_provision:{workspace_id}"

    try:
        client = await get_cache_client()

        async with client.lock(lock_key, timeout=60, retry_interval=0.2, max_retries=150):
            # Double-check after acquiring lock (another request may have created it)
            try:
                existing = await compute_client.get_workspace(workspace_id, user_id)
                if existing:
                    logger.debug(
                        "Workspace already provisioned by another request",
                        workspace_id=workspace_id,
                    )
                    return  # Workspace was created while we waited for lock
            except ComputeServiceHTTPError as e:
                if e.status_code != 404:
                    raise

            # Workspace still doesn't exist, provision it
            logger.info(
                "Lazily provisioning workspace in compute service",
                workspace_id=workspace_id,
                session_id=str(session.id),
                user_id=user_id,
                has_template=bool(session.template_id),
            )

            await compute_client.create_workspace(
                session_id=str(session.id),
                user_id=user_id,
                workspace_id=workspace_id,
                config=workspace_config,
            )
    except RuntimeError as e:
        # Lock acquisition failed - do NOT proceed without lock
        # This prevents race conditions where multiple requests could
        # try to create the same workspace simultaneously
        logger.error(
            "Failed to acquire provisioning lock",
            workspace_id=workspace_id,
            error=str(e),
        )
        raise ComputeClientError(
            f"Workspace provisioning temporarily unavailable. Please retry. Error: {e}",
            status_code=503,
        ) from e


async def update_workspace_activity(
    session: SessionModel,
    db: AsyncSession,
) -> None:
    """Update workspace activity timestamp and handle standby->running transition.

    This function:
    1. Updates workspace.last_activity to prevent idle detection from triggering
    2. If workspace was in "standby" state (but container auto-restarted),
       transitions it back to "running" and notifies connected clients

    Should be called after any successful workspace operation (file access,
    terminal usage, agent activity, etc.) to keep the workspace alive.
    """
    if not session.workspace_id:
        return

    from sqlalchemy import select

    from src.websocket.hub import emit_to_session

    # Fetch workspace
    result = await db.execute(
        select(WorkspaceModel).where(WorkspaceModel.id == session.workspace_id)
    )
    workspace = result.scalar_one_or_none()

    if not workspace:
        return

    now = datetime.now(UTC)
    workspace.last_activity = now

    # Handle standby -> running transition
    # This happens when the compute service auto-restarts a stopped container
    if workspace.status == "standby":
        workspace.status = "running"
        workspace.standby_at = None

        logger.info(
            "Workspace auto-resumed from standby",
            workspace_id=str(workspace.id),
            session_id=str(session.id),
        )

        # Notify connected clients about the status change
        await emit_to_session(
            str(session.id),
            "workspace_status",
            {
                "workspace_id": str(workspace.id),
                "status": "running",
                "standby_at": None,
                "last_activity": now.isoformat(),
            },
        )

    await db.commit()


@router.get("/{session_id}/files", response_model=list[FileNode])
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_files(
    session_id: str,
    request: Request,
    response: Response,
    db: DbSession,
    path: str = ".",
) -> list[FileNode]:
    """List files in session workspace."""
    session = await get_session_or_404(session_id, request, db)
    user_id = get_current_user_id(request)

    # Validate path to prevent traversal attacks
    validate_file_path(path)

    # Try to fetch from compute service
    if session.workspace_id:
        try:
            # Ensure workspace is provisioned before accessing
            await ensure_workspace_provisioned(session, user_id, db)
            files = await compute_client.list_files(session.workspace_id, user_id, path)
            # Update activity timestamp and handle standby->running sync
            await update_workspace_activity(session, db)
            # Transform compute service response to FileNode format
            # Pass base_path so file paths are correctly constructed for nested directories
            base_path = "" if path == "." else path
            return _transform_file_list(files, base_path)
        except ComputeClientError as e:
            logger.warning(
                "Failed to list files from compute service, using demo data",
                workspace_id=session.workspace_id,
                error=str(e),
            )
            # Fall through to demo data in development
            if settings.ENVIRONMENT == "production":
                raise HTTPException(status_code=503, detail="Compute service unavailable") from e

    # Return demo data in development mode
    return get_demo_file_tree()


def _transform_file_list(files: list[dict[str, str]], base_path: str = "") -> list[FileNode]:
    """Transform compute service file list to FileNode format.

    The compute service returns files with 'name', 'type', 'size', 'permissions'.
    This function converts them to FileNode format with 'name', 'path', 'type', 'children'.
    """
    root_nodes: list[FileNode] = []

    for file_info in sorted(files, key=lambda x: x.get("name", "")):
        name = file_info.get("name", "")
        if not name or name in (".", ".."):
            continue

        file_type = file_info.get("type", "file")
        # Build the full path from base_path and name
        file_path = f"{base_path}/{name}".lstrip("/") if base_path else name

        node = FileNode(
            name=name,
            path=file_path,
            type=file_type,
            children=[] if file_type == "directory" else None,
        )
        root_nodes.append(node)

    return root_nodes


@router.get("/{session_id}/files/content", response_model=FileContent)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_file_content(
    session_id: str,
    request: Request,
    response: Response,
    path: str,
    db: DbSession,
) -> FileContent:
    """Get file content."""
    session = await get_session_or_404(session_id, request, db)
    user_id = get_current_user_id(request)

    # Validate path to prevent traversal attacks
    safe_path = validate_file_path(path)

    # Try to fetch from compute service
    if session.workspace_id:
        try:
            # Ensure workspace is provisioned before accessing
            await ensure_workspace_provisioned(session, user_id, db)
            result = await compute_client.read_file(session.workspace_id, user_id, safe_path)
            # Update activity timestamp and handle standby->running sync
            await update_workspace_activity(session, db)
            return FileContent(
                path=safe_path,
                content=result.get("content", ""),
                language=get_language_from_path(safe_path),
            )
        except ComputeClientError as e:
            if e.status_code == HTTPStatus.NOT_FOUND:
                raise HTTPException(status_code=404, detail="File not found") from e
            logger.warning(
                "Failed to read file from compute service",
                workspace_id=session.workspace_id,
                path=safe_path,
                error=str(e),
            )
            if settings.ENVIRONMENT == "production":
                raise HTTPException(status_code=503, detail="Compute service unavailable") from e

    # Fall back to demo data in development
    content = DEMO_FILE_CONTENTS.get(safe_path)
    if content is None:
        raise HTTPException(status_code=404, detail="File not found")

    return FileContent(
        path=safe_path,
        content=content,
        language=get_language_from_path(safe_path),
    )


@router.post("/{session_id}/files", response_model=FileContent)
@limiter.limit(RATE_LIMIT_UPLOAD)
async def create_file(
    session_id: str,
    request: Request,
    response: Response,
    data: CreateFileRequest,
    db: DbSession,
) -> FileContent:
    """Create a new file."""
    session = await get_session_or_404(session_id, request, db)
    user_id = get_current_user_id(request)

    # Validate path to prevent traversal attacks
    safe_path = validate_file_path(data.path)

    # Create file in compute service
    if session.workspace_id:
        try:
            # Ensure workspace is provisioned before accessing
            await ensure_workspace_provisioned(session, user_id, db)
            await compute_client.write_file(session.workspace_id, user_id, safe_path, data.content)
            # Update activity timestamp and handle standby->running sync
            await update_workspace_activity(session, db)
            return FileContent(
                path=safe_path,
                content=data.content,
                language=get_language_from_path(safe_path),
            )
        except ComputeClientError as e:
            logger.exception(
                "Failed to create file in compute service",
                workspace_id=session.workspace_id,
                path=safe_path,
                error=str(e),
            )
            if settings.ENVIRONMENT == "production":
                raise HTTPException(status_code=503, detail="Compute service unavailable") from e

    # Return success in development mode (no-op)
    return FileContent(
        path=safe_path,
        content=data.content,
        language=get_language_from_path(safe_path),
    )


@router.put("/{session_id}/files/content", response_model=FileContent)
@limiter.limit(RATE_LIMIT_UPLOAD)
async def update_file_content(
    session_id: str,
    request: Request,
    response: Response,
    path: str,
    data: UpdateFileRequest,
    db: DbSession,
) -> FileContent:
    """Update file content."""
    session = await get_session_or_404(session_id, request, db)
    user_id = get_current_user_id(request)

    # Validate path to prevent traversal attacks
    safe_path = validate_file_path(path)

    # Update file in compute service
    if session.workspace_id:
        try:
            # Ensure workspace is provisioned before accessing
            await ensure_workspace_provisioned(session, user_id, db)
            await compute_client.write_file(session.workspace_id, user_id, safe_path, data.content)
            # Update activity timestamp and handle standby->running sync
            await update_workspace_activity(session, db)
            return FileContent(
                path=safe_path,
                content=data.content,
                language=get_language_from_path(safe_path),
            )
        except ComputeClientError as e:
            logger.exception(
                "Failed to update file in compute service",
                workspace_id=session.workspace_id,
                path=safe_path,
                error=str(e),
            )
            if settings.ENVIRONMENT == "production":
                raise HTTPException(status_code=503, detail="Compute service unavailable") from e

    # Return success in development mode (no-op)
    return FileContent(
        path=safe_path,
        content=data.content,
        language=get_language_from_path(safe_path),
    )


@router.delete("/{session_id}/files")
@limiter.limit(RATE_LIMIT_STANDARD)
async def delete_file(
    session_id: str,
    request: Request,
    response: Response,
    path: str,
    db: DbSession,
) -> dict[str, str]:
    """Delete a file."""
    session = await get_session_or_404(session_id, request, db)
    user_id = get_current_user_id(request)

    # Validate path to prevent traversal attacks
    safe_path = validate_file_path(path)

    # Delete file in compute service
    if session.workspace_id:
        try:
            # Ensure workspace is provisioned before accessing
            await ensure_workspace_provisioned(session, user_id, db)
            await compute_client.delete_file(session.workspace_id, user_id, safe_path)
            # Update activity timestamp and handle standby->running sync
            await update_workspace_activity(session, db)
        except ComputeClientError as e:
            if e.status_code == HTTPStatus.NOT_FOUND:
                raise HTTPException(status_code=404, detail="File not found") from e
            logger.exception(
                "Failed to delete file in compute service",
                workspace_id=session.workspace_id,
                path=safe_path,
                error=str(e),
            )
            if settings.ENVIRONMENT == "production":
                raise HTTPException(status_code=503, detail="Compute service unavailable") from e

    return {"deleted": safe_path}


@router.post("/{session_id}/files/move")
@limiter.limit(RATE_LIMIT_STANDARD)
async def move_file(
    session_id: str,
    request: Request,
    response: Response,
    data: MoveFileRequest,
    db: DbSession,
) -> dict[str, str]:
    """Move or rename a file."""
    session = await get_session_or_404(session_id, request, db)
    user_id = get_current_user_id(request)

    # Validate both paths to prevent traversal attacks
    safe_source = validate_file_path(data.source_path)
    safe_dest = validate_file_path(data.dest_path)

    # Move file in compute service (read source, write dest, delete source)
    if session.workspace_id:
        try:
            # Ensure workspace is provisioned before accessing
            await ensure_workspace_provisioned(session, user_id, db)
            # Read the source file
            source_content = await compute_client.read_file(
                session.workspace_id, user_id, safe_source
            )
            # Write to destination
            await compute_client.write_file(
                session.workspace_id,
                user_id,
                safe_dest,
                source_content.get("content", ""),
            )
            # Delete the source
            await compute_client.delete_file(session.workspace_id, user_id, safe_source)
            # Update activity timestamp and handle standby->running sync
            await update_workspace_activity(session, db)
        except ComputeClientError as e:
            if e.status_code == HTTPStatus.NOT_FOUND:
                raise HTTPException(status_code=404, detail="Source file not found") from e
            logger.exception(
                "Failed to move file in compute service",
                workspace_id=session.workspace_id,
                source=safe_source,
                dest=safe_dest,
                error=str(e),
            )
            if settings.ENVIRONMENT == "production":
                raise HTTPException(status_code=503, detail="Compute service unavailable") from e

    return {
        "source": safe_source,
        "destination": safe_dest,
    }


# ==================== Bulk File Operations ====================


class BulkDeleteRequest(BaseModel):
    """Request for bulk file deletion."""

    paths: list[str]


class BulkDeleteResponse(BaseModel):
    """Response for bulk file deletion."""

    deleted: list[str]
    failed: list[dict[str, str]]


class BulkMoveRequest(BaseModel):
    """Request for bulk file move/rename."""

    operations: list[dict[str, str]]  # List of {"source": "...", "dest": "..."}


class BulkMoveResponse(BaseModel):
    """Response for bulk file move."""

    moved: list[dict[str, str]]
    failed: list[dict[str, str]]


@router.post("/{session_id}/files/bulk-delete")
@limiter.limit(RATE_LIMIT_STANDARD)
async def bulk_delete_files(
    session_id: str,
    request: Request,
    response: Response,
    data: BulkDeleteRequest,
    db: DbSession,
) -> BulkDeleteResponse:
    """Delete multiple files at once.

    Args:
        session_id: The session ID
        data: List of file paths to delete (max 50)

    Returns:
        List of successfully deleted files and any failures
    """
    session = await get_session_or_404(session_id, request, db)
    user_id = get_current_user_id(request)

    # Limit number of files
    max_files = 50
    if len(data.paths) > max_files:
        raise HTTPException(
            status_code=400,
            detail=f"Too many files. Maximum is {max_files} files per request",
        )

    deleted: list[str] = []
    failed: list[dict[str, str]] = []

    if session.workspace_id:
        try:
            await ensure_workspace_provisioned(session, user_id, db)
        except Exception as e:
            raise HTTPException(status_code=503, detail="Workspace not available") from e

        for path in data.paths:
            try:
                safe_path = validate_file_path(path)
                await compute_client.delete_file(session.workspace_id, user_id, safe_path)
                deleted.append(safe_path)

                # Record file change
                file_change = FileChange(
                    workspace_id=session.workspace_id,
                    file_path=safe_path,
                    change_type="deleted",
                    changed_by=f"user:{user_id}",
                )
                db.add(file_change)

            except HTTPException as e:
                failed.append({"path": path, "error": str(e.detail)})
            except ComputeClientError as e:
                if e.status_code == HTTPStatus.NOT_FOUND:
                    failed.append({"path": path, "error": "File not found"})
                else:
                    failed.append({"path": path, "error": str(e)})
            except Exception as e:
                failed.append({"path": path, "error": str(e)})

        # Update activity timestamp and handle standby->running sync
        await update_workspace_activity(session, db)
        await db.commit()

    logger.info(
        "Bulk delete completed",
        session_id=session_id,
        deleted=len(deleted),
        failed=len(failed),
    )

    return BulkDeleteResponse(deleted=deleted, failed=failed)


@router.post("/{session_id}/files/bulk-move")
@limiter.limit(RATE_LIMIT_STANDARD)
async def bulk_move_files(
    session_id: str,
    request: Request,
    response: Response,
    data: BulkMoveRequest,
    db: DbSession,
) -> BulkMoveResponse:
    """Move or rename multiple files at once.

    Args:
        session_id: The session ID
        data: List of move operations with source and dest paths (max 50)

    Returns:
        List of successfully moved files and any failures
    """
    session = await get_session_or_404(session_id, request, db)
    user_id = get_current_user_id(request)

    # Limit number of operations
    max_ops = 50
    if len(data.operations) > max_ops:
        raise HTTPException(
            status_code=400,
            detail=f"Too many operations. Maximum is {max_ops} per request",
        )

    moved: list[dict[str, str]] = []
    failed: list[dict[str, str]] = []

    if session.workspace_id:
        try:
            await ensure_workspace_provisioned(session, user_id, db)
        except Exception as e:
            raise HTTPException(status_code=503, detail="Workspace not available") from e

        for op in data.operations:
            source = op.get("source", "")
            dest = op.get("dest", "")

            if not source or not dest:
                failed.append({"source": source, "dest": dest, "error": "Missing source or dest"})
                continue

            try:
                safe_source = validate_file_path(source)
                safe_dest = validate_file_path(dest)

                # Read source, write to dest, delete source
                source_content = await compute_client.read_file(
                    session.workspace_id, user_id, safe_source
                )
                await compute_client.write_file(
                    session.workspace_id,
                    user_id,
                    safe_dest,
                    source_content.get("content", ""),
                )
                await compute_client.delete_file(session.workspace_id, user_id, safe_source)

                moved.append({"source": safe_source, "dest": safe_dest})

                # Record file changes
                db.add(
                    FileChange(
                        workspace_id=session.workspace_id,
                        file_path=safe_source,
                        change_type="moved",
                        changed_by=f"user:{user_id}",
                    )
                )
                db.add(
                    FileChange(
                        workspace_id=session.workspace_id,
                        file_path=safe_dest,
                        change_type="created",
                        changed_by=f"user:{user_id}",
                    )
                )

            except HTTPException as e:
                failed.append({"source": source, "dest": dest, "error": str(e.detail)})
            except ComputeClientError as e:
                if e.status_code == HTTPStatus.NOT_FOUND:
                    failed.append({"source": source, "dest": dest, "error": "Source not found"})
                else:
                    failed.append({"source": source, "dest": dest, "error": str(e)})
            except Exception as e:
                failed.append({"source": source, "dest": dest, "error": str(e)})

        # Update activity timestamp and handle standby->running sync
        await update_workspace_activity(session, db)
        await db.commit()

    logger.info(
        "Bulk move completed",
        session_id=session_id,
        moved=len(moved),
        failed=len(failed),
    )

    return BulkMoveResponse(moved=moved, failed=failed)


# ==================== File Version History ====================


class FileChangeResponse(BaseModel):
    """Response for a file change entry."""

    id: str
    file_path: str
    change_type: str
    changed_by: str
    diff: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FileHistoryResponse(BaseModel):
    """Response for file version history."""

    path: str
    changes: list[FileChangeResponse]
    total: int


@router.get("/{session_id}/files/history")
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_file_history(
    session_id: str,
    request: Request,
    response: Response,
    db: DbSession,
    path: str | None = Query(default=None, description="File path to get history for"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> FileHistoryResponse:
    """Get file change history for a session.

    Args:
        session_id: The session ID
        path: Optional file path filter
        limit: Maximum number of changes to return
        offset: Offset for pagination

    Returns:
        File change history with diffs when available
    """
    session = await get_session_or_404(session_id, request, db)

    if not session.workspace_id:
        return FileHistoryResponse(path=path or "*", changes=[], total=0)

    # Build query
    query = select(FileChange).where(FileChange.workspace_id == session.workspace_id)

    if path:
        safe_path = validate_file_path(path)
        query = query.where(FileChange.file_path == safe_path)

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Get paginated results
    query = query.order_by(FileChange.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(query)
    changes = result.scalars().all()

    return FileHistoryResponse(
        path=path or "*",
        changes=[
            FileChangeResponse(
                id=change.id,
                file_path=change.file_path,
                change_type=change.change_type,
                changed_by=change.changed_by,
                diff=change.diff,
                created_at=change.created_at,
            )
            for change in changes
        ],
        total=total,
    )


@router.get("/{session_id}/files/diff")
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_file_diff(
    session_id: str,
    request: Request,
    response: Response,
    db: DbSession,
    path: str = Query(..., description="File path to get diff for"),
    change_id: str | None = Query(default=None, description="Specific change ID"),
) -> dict[str, Any]:
    """Get diff for a specific file change.

    Args:
        session_id: The session ID
        path: File path
        change_id: Optional specific change ID

    Returns:
        Diff information for the file change
    """
    session = await get_session_or_404(session_id, request, db)

    if not session.workspace_id:
        raise HTTPException(status_code=404, detail="No workspace for this session")

    safe_path = validate_file_path(path)

    # Query for specific change or most recent
    query = select(FileChange).where(
        FileChange.workspace_id == session.workspace_id,
        FileChange.file_path == safe_path,
    )

    if change_id:
        query = query.where(FileChange.id == change_id)
    else:
        query = query.order_by(FileChange.created_at.desc()).limit(1)

    result = await db.execute(query)
    change = result.scalar_one_or_none()

    if not change:
        raise HTTPException(status_code=404, detail="No changes found for this file")

    return {
        "id": change.id,
        "path": change.file_path,
        "change_type": change.change_type,
        "changed_by": change.changed_by,
        "diff": change.diff,
        "created_at": change.created_at.isoformat(),
    }
