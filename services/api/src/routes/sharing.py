"""Session sharing routes."""

import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit_logger import AuditAction, AuditLogger
from src.database.models import Session as SessionModel
from src.database.models import SessionShare
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter
from src.routes.dependencies import DbSession, get_current_user_id
from src.session_sync.manager import session_sync_manager
from src.session_sync.models import SharingMode

router = APIRouter()


# ============== Request/Response Models ==============


class ShareSessionRequest(BaseModel):
    """Request to share a session."""

    user_id: str | None = None  # Share with specific user
    email: str | None = None  # Or share with email
    sharing_mode: SharingMode = SharingMode.CAN_EDIT


class ShareLinkRequest(BaseModel):
    """Request to create a share link."""

    sharing_mode: SharingMode = SharingMode.CAN_EDIT
    expires_in_hours: int | None = None  # None = never expires


class UpdateShareRequest(BaseModel):
    """Request to update sharing permissions."""

    sharing_mode: SharingMode


class ShareResponse(BaseModel):
    """Share record response."""

    id: str
    session_id: str
    shared_with_id: str | None
    shared_with_email: str | None
    sharing_mode: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ShareLinkResponse(BaseModel):
    """Share link response."""

    share_link: str
    share_code: str
    sharing_mode: str
    expires_at: datetime | None


class SessionSharesResponse(BaseModel):
    """List of session shares response."""

    shares: list[ShareResponse]
    share_link: str | None
    share_link_mode: str | None


# ============== Helper Functions ==============


async def check_session_owner(
    session_id: str,
    user_id: str,
    db: AsyncSession,
) -> SessionModel:
    """Verify user owns the session."""
    query = select(SessionModel).where(SessionModel.id == session_id)
    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Only session owner can manage sharing")

    return session


async def check_session_access(
    session_id: str,
    user_id: str,
    db: AsyncSession,
    required_mode: SharingMode | None = None,
) -> tuple[SessionModel, SharingMode]:
    """Check if user has access to session and return their permission level."""
    query = select(SessionModel).where(SessionModel.id == session_id)
    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Owner has full control
    if session.owner_id == user_id:
        return session, SharingMode.FULL_CONTROL

    # Check if user has explicit share
    share_query = select(SessionShare).where(
        SessionShare.session_id == session_id,
        SessionShare.shared_with_id == user_id,
    )
    share_result = await db.execute(share_query)
    share = share_result.scalar_one_or_none()

    if not share:
        raise HTTPException(status_code=403, detail="Access denied")

    user_mode = SharingMode(share.sharing_mode)

    # Check if user has required permission level
    if required_mode:
        mode_levels = {
            SharingMode.VIEW_ONLY: 1,
            SharingMode.CAN_EDIT: 2,
            SharingMode.FULL_CONTROL: 3,
        }
        if mode_levels[user_mode] < mode_levels[required_mode]:
            raise HTTPException(status_code=403, detail="Insufficient permissions")

    return session, user_mode


# ============== Routes ==============


@router.post("/{session_id}/share", response_model=ShareResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def share_session(
    session_id: str,
    data: ShareSessionRequest,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> ShareResponse:
    """Share a session with another user."""
    user_id = get_current_user_id(request)
    await check_session_owner(session_id, user_id, db)

    if not data.user_id and not data.email:
        raise HTTPException(
            status_code=400,
            detail="Either user_id or email is required",
        )

    # Use upsert to handle race conditions atomically
    # Build the values for insert
    from uuid import uuid4

    share_id = str(uuid4())
    now = datetime.now(UTC)

    insert_stmt = pg_insert(SessionShare).values(
        id=share_id,
        session_id=session_id,
        shared_with_id=data.user_id,
        shared_with_email=data.email,
        sharing_mode=data.sharing_mode.value,
        created_at=now,
    )

    # Define the conflict resolution - update sharing_mode if exists
    # Conflict on (session_id, shared_with_id) or (session_id, shared_with_email)
    if data.user_id:
        # PostgreSQL needs a unique constraint - we'll use DO UPDATE with exclusion
        upsert_stmt = insert_stmt.on_conflict_do_update(
            index_elements=["session_id", "shared_with_id"],
            set_={"sharing_mode": data.sharing_mode.value},
        )
    else:
        upsert_stmt = insert_stmt.on_conflict_do_update(
            index_elements=["session_id", "shared_with_email"],
            set_={"sharing_mode": data.sharing_mode.value},
        )

    # Execute upsert and return the result
    returning_stmt = upsert_stmt.returning(SessionShare)
    result = await db.execute(returning_stmt)
    share = result.scalar_one()
    await db.commit()

    # Update session sync state
    session_state = await session_sync_manager.get_session_state(session_id)
    if session_state and data.user_id:
        if data.user_id not in session_state.shared_with:
            session_state.shared_with.append(data.user_id)

    # Audit log: session shared
    audit = AuditLogger(db).set_context(request=request, user_id=user_id)
    await audit.log_session_event(
        AuditAction.SESSION_SHARED,
        session_id=session_id,
        details={
            "shared_with_id": data.user_id,
            "shared_with_email": data.email,
            "sharing_mode": data.sharing_mode.value,
        },
    )

    return ShareResponse(
        id=share.id,
        session_id=share.session_id,
        shared_with_id=share.shared_with_id,
        shared_with_email=share.shared_with_email,
        sharing_mode=share.sharing_mode,
        created_at=share.created_at,
    )


@router.post("/{session_id}/share-link", response_model=ShareLinkResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def create_share_link(
    session_id: str,
    data: ShareLinkRequest,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> ShareLinkResponse:
    """Create a shareable link for the session."""
    user_id = get_current_user_id(request)
    session = await check_session_owner(session_id, user_id, db)

    # Generate unique share code - use 32 bytes for stronger security
    share_code = secrets.token_urlsafe(32)

    # Calculate expiration
    expires_at = None
    if data.expires_in_hours:
        expires_at = datetime.now(UTC) + timedelta(hours=data.expires_in_hours)

    # Store share link info in database (including expiration)
    session.share_link = share_code
    session.share_link_mode = data.sharing_mode.value
    session.share_link_expires_at = expires_at
    await db.commit()

    # Update session sync state
    session_state = await session_sync_manager.get_session_state(session_id)
    if session_state:
        session_state.share_link = share_code
        session_state.default_sharing_mode = data.sharing_mode

    # Audit log: share link created
    audit = AuditLogger(db).set_context(request=request, user_id=user_id)
    await audit.log_session_event(
        AuditAction.SESSION_SHARED,
        session_id=session_id,
        details={
            "action": "share_link_created",
            "sharing_mode": data.sharing_mode.value,
            "expires_at": expires_at.isoformat() if expires_at else None,
        },
    )

    return ShareLinkResponse(
        share_link=f"/s/{share_code}",
        share_code=share_code,
        sharing_mode=data.sharing_mode.value,
        expires_at=expires_at,
    )


@router.delete("/{session_id}/share-link")
@limiter.limit(RATE_LIMIT_STANDARD)
async def revoke_share_link(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, str]:
    """Revoke the shareable link for the session."""
    user_id = get_current_user_id(request)
    session = await check_session_owner(session_id, user_id, db)

    session.share_link = None
    session.share_link_mode = None
    session.share_link_expires_at = None
    await db.commit()

    # Update session sync state
    session_state = await session_sync_manager.get_session_state(session_id)
    if session_state:
        session_state.share_link = None

    # Audit log: share link revoked
    audit = AuditLogger(db).set_context(request=request, user_id=user_id)
    await audit.log_session_event(
        AuditAction.SESSION_SHARED,
        session_id=session_id,
        details={"action": "share_link_revoked"},
    )

    return {"message": "Share link revoked"}


@router.get("/{session_id}/shares", response_model=SessionSharesResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_shares(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> SessionSharesResponse:
    """List all shares for a session."""
    user_id = get_current_user_id(request)
    session = await check_session_owner(session_id, user_id, db)

    # Get all shares
    query = select(SessionShare).where(SessionShare.session_id == session_id)
    result = await db.execute(query)
    shares = result.scalars().all()

    return SessionSharesResponse(
        shares=[
            ShareResponse(
                id=s.id,
                session_id=s.session_id,
                shared_with_id=s.shared_with_id,
                shared_with_email=s.shared_with_email,
                sharing_mode=s.sharing_mode,
                created_at=s.created_at,
            )
            for s in shares
        ],
        share_link=f"/s/{session.share_link}" if session.share_link else None,
        share_link_mode=session.share_link_mode,
    )


@router.put("/{session_id}/shares/{share_id}", response_model=ShareResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def update_share(
    session_id: str,
    share_id: str,
    data: UpdateShareRequest,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> ShareResponse:
    """Update sharing permissions for a user."""
    user_id = get_current_user_id(request)
    await check_session_owner(session_id, user_id, db)

    # Get the share
    query = select(SessionShare).where(
        SessionShare.id == share_id,
        SessionShare.session_id == session_id,
    )
    result = await db.execute(query)
    share = result.scalar_one_or_none()

    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    share.sharing_mode = data.sharing_mode.value
    await db.commit()

    return ShareResponse(
        id=share.id,
        session_id=share.session_id,
        shared_with_id=share.shared_with_id,
        shared_with_email=share.shared_with_email,
        sharing_mode=share.sharing_mode,
        created_at=share.created_at,
    )


@router.delete("/{session_id}/shares/{share_id}")
@limiter.limit(RATE_LIMIT_STANDARD)
async def revoke_share(
    session_id: str,
    share_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, str]:
    """Revoke sharing with a user."""
    user_id = get_current_user_id(request)
    await check_session_owner(session_id, user_id, db)

    # Delete the share
    stmt = delete(SessionShare).where(
        SessionShare.id == share_id,
        SessionShare.session_id == session_id,
    )
    result = await db.execute(stmt)
    rows_affected: int = getattr(result, "rowcount", 0)

    if rows_affected == 0:
        raise HTTPException(status_code=404, detail="Share not found")

    await db.commit()
    return {"message": "Share revoked"}


@router.get("/join/{share_code}")
@limiter.limit(RATE_LIMIT_STANDARD)
async def join_via_link(
    share_code: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, str]:
    """Join a session via share link."""
    # Find session by share code
    query = select(SessionModel).where(SessionModel.share_link == share_code)
    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Invalid or expired share link")

    # Check if share link has expired
    if session.share_link_expires_at and datetime.now(UTC) > session.share_link_expires_at:
        raise HTTPException(status_code=410, detail="Share link has expired")

    user_id = get_current_user_id(request)

    # Don't create share for the owner
    if session.owner_id == user_id:
        return {
            "session_id": session.id,
            "message": "You own this session",
            "sharing_mode": SharingMode.FULL_CONTROL.value,
        }

    sharing_mode = session.share_link_mode or SharingMode.CAN_EDIT.value

    # Use upsert to handle race condition when joining
    from uuid import uuid4

    share_id = str(uuid4())
    now = datetime.now(UTC)

    insert_stmt = pg_insert(SessionShare).values(
        id=share_id,
        session_id=session.id,
        shared_with_id=user_id,
        sharing_mode=sharing_mode,
        created_at=now,
    )

    # On conflict (user already has access), do nothing (keep existing permissions)
    upsert_stmt = insert_stmt.on_conflict_do_nothing(
        index_elements=["session_id", "shared_with_id"],
    )
    await db.execute(upsert_stmt)
    await db.commit()

    return {
        "session_id": session.id,
        "message": "Joined session successfully",
        "sharing_mode": sharing_mode,
    }
