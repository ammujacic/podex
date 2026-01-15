"""Git operations routes.

These routes provide Git functionality for workspaces. They communicate with
the compute service to execute Git commands in the workspace container.
"""

import re
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.compute_client import compute_client
from src.database import Session as SessionModel
from src.database import get_db
from src.exceptions import ComputeClientError
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter
from src.routes.sessions import ensure_workspace_provisioned

logger = structlog.get_logger()
router = APIRouter()

# Git branch name validation pattern
# Based on git check-ref-format rules
_INVALID_BRANCH_CHARS = re.compile(r"[\x00-\x1f\x7f ~^:?*\[\\]")
_INVALID_BRANCH_PATTERNS = ["..", "@{", "//"]


def validate_branch_name(branch: str | None) -> str | None:
    """Validate a Git branch name to prevent injection attacks.

    Based on git check-ref-format rules:
    - Cannot contain control chars, space, ~, ^, :, ?, *, [, or backslash
    - Cannot start with . or end with .lock
    - Cannot contain .. or @{
    - Cannot be @ alone
    - Cannot be empty or only whitespace

    Args:
        branch: The branch name to validate (can be None).

    Returns:
        The validated branch name, or None if input was None.

    Raises:
        HTTPException: If the branch name is invalid.
    """
    if branch is None:
        return None

    # Check for empty/whitespace
    if not branch or not branch.strip():
        raise HTTPException(status_code=400, detail="Branch name cannot be empty")

    # Check length
    if len(branch) > 255:
        raise HTTPException(status_code=400, detail="Branch name too long (max 255 characters)")

    # Check for invalid characters
    if _INVALID_BRANCH_CHARS.search(branch):
        raise HTTPException(
            status_code=400,
            detail="Branch name contains invalid characters",
        )

    # Check for invalid patterns
    for pattern in _INVALID_BRANCH_PATTERNS:
        if pattern in branch:
            raise HTTPException(
                status_code=400,
                detail=f"Branch name cannot contain '{pattern}'",
            )

    # Check start/end rules
    if branch.startswith(".") or branch.startswith("-"):
        raise HTTPException(status_code=400, detail="Branch name cannot start with '.' or '-'")

    if branch.endswith(".lock") or branch.endswith("."):
        raise HTTPException(status_code=400, detail="Branch name cannot end with '.lock' or '.'")

    # Cannot be @ alone
    if branch == "@":
        raise HTTPException(status_code=400, detail="Branch name cannot be '@'")

    return branch


# Type alias for database session dependency
DbSession = Annotated[AsyncSession, Depends(get_db)]


def get_current_user_id(request: Request) -> str:
    """Get current user ID from request state.

    Raises:
        HTTPException: If user is not authenticated.
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return str(user_id)


class GitStatus(BaseModel):
    """Git status response."""

    branch: str
    is_clean: bool
    ahead: int
    behind: int
    staged: list[dict[str, Any]]
    unstaged: list[dict[str, Any]]
    untracked: list[str]


class GitBranch(BaseModel):
    """Git branch info."""

    name: str
    is_current: bool
    is_remote: bool
    commit_hash: str | None = None


class GitCommit(BaseModel):
    """Git commit info."""

    hash: str
    short_hash: str
    message: str
    author: str
    date: str


class GitDiffFile(BaseModel):
    """Git diff file info."""

    path: str
    status: str  # added, modified, deleted
    additions: int
    deletions: int
    diff: str | None = None


class CommitRequest(BaseModel):
    """Commit request."""

    message: str
    files: list[str] | None = None  # If None, commit all staged


class PushPullRequest(BaseModel):
    """Push/pull request."""

    remote: str = "origin"
    branch: str | None = None  # If None, use current branch


class StageRequest(BaseModel):
    """Stage files request."""

    files: list[str]


class CheckoutRequest(BaseModel):
    """Checkout branch request."""

    branch: str
    create: bool = False


async def get_workspace_and_user(
    session_id: str,
    request: Request,
    db: AsyncSession,
) -> tuple[str, str]:
    """Get workspace ID and user ID for a session after verifying ownership.

    Args:
        session_id: The session ID
        request: The HTTP request (for getting current user)
        db: Database session

    Returns:
        Tuple of (workspace_id, user_id)

    Raises:
        HTTPException: If session not found, user not authorized, or no workspace
    """
    user_id = get_current_user_id(request)

    query = select(SessionModel).where(SessionModel.id == session_id)
    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Verify the current user owns this session
    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to access this session")

    if not session.workspace_id:
        raise HTTPException(status_code=400, detail="Session has no workspace")

    # Ensure workspace is provisioned in compute service
    try:
        await ensure_workspace_provisioned(session, user_id, db)
    except ComputeClientError as e:
        logger.exception(
            "Failed to ensure workspace is provisioned",
            workspace_id=str(session.workspace_id),
        )
        raise HTTPException(
            status_code=503,
            detail=f"Failed to provision workspace: {e}",
        ) from e

    return str(session.workspace_id), user_id


@router.get("/status", response_model=GitStatus)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_git_status(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> GitStatus:
    """Get Git status for workspace."""
    workspace_id, user_id = await get_workspace_and_user(session_id, request, db)

    try:
        result = await compute_client.git_status(workspace_id, user_id)
    except ComputeClientError as e:
        logger.error(  # noqa: TRY400
            "Failed to get git status from compute service",
            workspace_id=workspace_id,
            error=str(e),
        )
        raise HTTPException(status_code=503, detail=f"Compute service unavailable: {e}") from e
    else:
        return GitStatus(**result)


@router.get("/branches", response_model=list[GitBranch])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_branches(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> list[GitBranch]:
    """Get Git branches for workspace."""
    workspace_id, user_id = await get_workspace_and_user(session_id, request, db)

    try:
        result = await compute_client.git_branches(workspace_id, user_id)
    except ComputeClientError as e:
        logger.error(  # noqa: TRY400
            "Failed to get git branches from compute service",
            workspace_id=workspace_id,
            error=str(e),
        )
        raise HTTPException(status_code=503, detail=f"Compute service unavailable: {e}") from e
    else:
        return [GitBranch(**b) for b in result]


@router.get("/log", response_model=list[GitCommit])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_log(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    limit: int = 20,
) -> list[GitCommit]:
    """Get Git commit log for workspace."""
    workspace_id, user_id = await get_workspace_and_user(session_id, request, db)

    try:
        result = await compute_client.git_log(workspace_id, user_id, limit=limit)
    except ComputeClientError as e:
        logger.error(  # noqa: TRY400
            "Failed to get git log from compute service",
            workspace_id=workspace_id,
            error=str(e),
        )
        raise HTTPException(status_code=503, detail=f"Compute service unavailable: {e}") from e
    else:
        return [GitCommit(**c) for c in result]


@router.get("/diff", response_model=list[GitDiffFile])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_diff(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    *,
    staged: bool = Query(default=False),
) -> list[GitDiffFile]:
    """Get Git diff for workspace."""
    workspace_id, user_id = await get_workspace_and_user(session_id, request, db)

    try:
        result = await compute_client.git_diff(workspace_id, user_id, staged=staged)
    except ComputeClientError as e:
        logger.error(  # noqa: TRY400
            "Failed to get git diff from compute service",
            workspace_id=workspace_id,
            error=str(e),
        )
        raise HTTPException(status_code=503, detail=f"Compute service unavailable: {e}") from e
    else:
        return [GitDiffFile(**f) for f in result]


@router.post("/stage")
@limiter.limit(RATE_LIMIT_STANDARD)
async def stage_files(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    data: StageRequest,
    db: DbSession,
) -> dict[str, str]:
    """Stage files for commit."""
    workspace_id, user_id = await get_workspace_and_user(session_id, request, db)

    try:
        await compute_client.git_stage(workspace_id, user_id, data.files)
    except ComputeClientError as e:
        logger.error(  # noqa: TRY400
            "Failed to stage files",
            workspace_id=workspace_id,
            files=data.files,
            error=str(e),
        )
        raise HTTPException(status_code=503, detail=f"Compute service unavailable: {e}") from e
    return {"message": f"Staged {len(data.files)} file(s)"}


@router.post("/unstage")
@limiter.limit(RATE_LIMIT_STANDARD)
async def unstage_files(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    data: StageRequest,
    db: DbSession,
) -> dict[str, str]:
    """Unstage files."""
    workspace_id, user_id = await get_workspace_and_user(session_id, request, db)

    try:
        await compute_client.git_unstage(workspace_id, user_id, data.files)
    except ComputeClientError as e:
        logger.error(  # noqa: TRY400
            "Failed to unstage files",
            workspace_id=workspace_id,
            files=data.files,
            error=str(e),
        )
        raise HTTPException(status_code=503, detail=f"Compute service unavailable: {e}") from e
    return {"message": f"Unstaged {len(data.files)} file(s)"}


@router.post("/commit")
@limiter.limit(RATE_LIMIT_STANDARD)
async def commit_changes(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    data: CommitRequest,
    db: DbSession,
) -> dict[str, str]:
    """Commit staged changes."""
    workspace_id, user_id = await get_workspace_and_user(session_id, request, db)

    try:
        # If specific files provided, stage them first
        if data.files:
            await compute_client.git_stage(workspace_id, user_id, data.files)

        result = await compute_client.git_commit(workspace_id, user_id, data.message)
    except ComputeClientError as e:
        logger.error(  # noqa: TRY400
            "Failed to commit changes",
            workspace_id=workspace_id,
            message=data.message,
            error=str(e),
        )
        raise HTTPException(status_code=503, detail=f"Compute service unavailable: {e}") from e
    return result


@router.post("/push")
@limiter.limit(RATE_LIMIT_STANDARD)
async def push_changes(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    data: PushPullRequest,
    db: DbSession,
) -> dict[str, str]:
    """Push commits to remote."""
    workspace_id, user_id = await get_workspace_and_user(session_id, request, db)

    # Validate branch name if provided
    safe_branch = validate_branch_name(data.branch)

    try:
        result = await compute_client.git_push(
            workspace_id,
            user_id,
            remote=data.remote,
            branch=safe_branch,
        )
    except ComputeClientError as e:
        logger.error(  # noqa: TRY400
            "Failed to push changes",
            workspace_id=workspace_id,
            remote=data.remote,
            branch=data.branch,
            error=str(e),
        )
        raise HTTPException(status_code=503, detail=f"Compute service unavailable: {e}") from e
    return result


@router.post("/pull")
@limiter.limit(RATE_LIMIT_STANDARD)
async def pull_changes(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    data: PushPullRequest,
    db: DbSession,
) -> dict[str, str]:
    """Pull changes from remote."""
    workspace_id, user_id = await get_workspace_and_user(session_id, request, db)

    # Validate branch name if provided
    safe_branch = validate_branch_name(data.branch)

    try:
        result = await compute_client.git_pull(
            workspace_id,
            user_id,
            remote=data.remote,
            branch=safe_branch,
        )
    except ComputeClientError as e:
        logger.error(  # noqa: TRY400
            "Failed to pull changes",
            workspace_id=workspace_id,
            remote=data.remote,
            branch=data.branch,
            error=str(e),
        )
        raise HTTPException(status_code=503, detail=f"Compute service unavailable: {e}") from e
    return result


@router.post("/checkout")
@limiter.limit(RATE_LIMIT_STANDARD)
async def checkout_branch(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    data: CheckoutRequest,
    db: DbSession,
) -> dict[str, str]:
    """Checkout a branch."""
    workspace_id, user_id = await get_workspace_and_user(session_id, request, db)

    # Validate branch name (required for checkout)
    safe_branch = validate_branch_name(data.branch)
    if not safe_branch:
        raise HTTPException(status_code=400, detail="Branch name is required for checkout")

    try:
        result = await compute_client.git_checkout(
            workspace_id,
            user_id,
            branch=safe_branch,
            create=data.create,
        )
    except ComputeClientError as e:
        logger.error(  # noqa: TRY400
            "Failed to checkout branch",
            workspace_id=workspace_id,
            branch=data.branch,
            create=data.create,
            error=str(e),
        )
        raise HTTPException(status_code=503, detail=f"Compute service unavailable: {e}") from e
    return result
