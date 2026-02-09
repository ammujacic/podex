"""Shared route dependencies and utilities.

This module centralizes common patterns used across route handlers to reduce
code duplication and ensure consistency.
"""

from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import Session as SessionModel

# Shared database session dependency type alias
DbSession = Annotated[AsyncSession, Depends(get_db)]


def get_current_user_id(request: Request) -> str:
    """Get current user ID from request state.

    This is a simple helper for routes that just need the user ID.

    Args:
        request: The FastAPI request object

    Returns:
        The authenticated user's ID as a string

    Raises:
        HTTPException: If user is not authenticated (401)
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return str(user_id)


def get_optional_user_id(request: Request) -> str | None:
    """Get current user ID if authenticated, None otherwise.

    Use this for endpoints that work for both authenticated and unauthenticated
    users but want to provide additional info when authenticated.

    Args:
        request: The FastAPI request object

    Returns:
        The authenticated user's ID as a string, or None if not authenticated
    """
    user_id = getattr(request.state, "user_id", None)
    return str(user_id) if user_id else None


async def verify_session_access(
    session_id: str,
    request: Request,
    db: AsyncSession,
) -> SessionModel:
    """Verify the current user has access to the session.

    Args:
        session_id: The session ID to verify access for
        request: The FastAPI request object
        db: The database session

    Returns:
        The session model if access is verified

    Raises:
        HTTPException: If user is not authenticated (401)
        HTTPException: If session is not found (404)
        HTTPException: If user lacks access to session (403)
    """
    user_id = get_current_user_id(request)

    session_query = select(SessionModel).where(SessionModel.id == session_id)
    session_result = await db.execute(session_query)
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return session
