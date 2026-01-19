"""GitHub integration API routes for PRs and Actions."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import GitHubIntegration
from src.dependencies import get_current_user
from src.github_client import (
    GitHubClient,
    GitHubTokenExpiredError,
)

router = APIRouter(prefix="/github", tags=["github"])


def handle_github_token_error(e: GitHubTokenExpiredError) -> None:
    """Convert GitHubTokenExpiredError to HTTP 424 (Failed Dependency) response.

    We use 424 instead of 401 because:
    - 401 would trigger the frontend to log the user out (thinks Podex auth failed)
    - 424 indicates a dependency (GitHub) failed, not the user's Podex session
    """
    raise HTTPException(
        status_code=status.HTTP_424_FAILED_DEPENDENCY,
        detail=str(e),
    ) from e


# ============================================================================
# Helper to get GitHub client
# ============================================================================

logger = structlog.get_logger()


async def get_github_client(
    db: AsyncSession,
    user: dict,
) -> tuple[GitHubClient, GitHubIntegration]:
    """Get GitHub client for authenticated user."""
    query = select(GitHubIntegration).where(
        GitHubIntegration.user_id == user["id"],
        GitHubIntegration.is_active == True,
    )
    result = await db.execute(query)
    integration = result.scalar_one_or_none()

    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="GitHub integration not found. Please connect your GitHub account.",
        )

    # Log token info for debugging
    token = integration.access_token
    if not token:
        raise HTTPException(
            status_code=status.HTTP_424_FAILED_DEPENDENCY,
            detail="GitHub token is missing. Please reconnect your GitHub account.",
        )

    # Update last used timestamp
    await db.execute(
        update(GitHubIntegration)
        .where(GitHubIntegration.id == integration.id)
        .values(last_used_at=datetime.now(UTC))
    )
    await db.commit()

    return GitHubClient(integration.access_token), integration


# ============================================================================
# Request/Response Models
# ============================================================================


class GitHubConnectionStatus(BaseModel):
    """GitHub connection status."""

    connected: bool
    username: str | None = None
    avatar_url: str | None = None
    scopes: list[str] | None = None
    connected_at: datetime | None = None
    last_used_at: datetime | None = None


class CreatePRRequest(BaseModel):
    """Request to create a pull request."""

    title: str
    head: str
    base: str
    body: str | None = None
    draft: bool = False


class UpdatePRRequest(BaseModel):
    """Request to update a pull request."""

    title: str | None = None
    body: str | None = None
    state: str | None = None  # open, closed
    base: str | None = None


class MergePRRequest(BaseModel):
    """Request to merge a pull request."""

    commit_title: str | None = None
    commit_message: str | None = None
    merge_method: str = "merge"  # merge, squash, rebase


class CreateReviewRequest(BaseModel):
    """Request to create a PR review."""

    body: str | None = None
    event: str = "COMMENT"  # APPROVE, REQUEST_CHANGES, COMMENT
    comments: list[dict[str, Any]] | None = None


class CreateCommentRequest(BaseModel):
    """Request to create a PR comment."""

    body: str
    commit_id: str
    path: str
    line: int
    side: str = "RIGHT"


class TriggerWorkflowRequest(BaseModel):
    """Request to trigger a workflow."""

    ref: str
    inputs: dict[str, Any] | None = None


# ============================================================================
# Connection Status Routes
# ============================================================================


@router.get("/status", response_model=GitHubConnectionStatus)
async def get_connection_status(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> GitHubConnectionStatus:
    """Get GitHub connection status."""
    query = select(GitHubIntegration).where(GitHubIntegration.user_id == user["id"])
    result = await db.execute(query)
    integration = result.scalar_one_or_none()

    if not integration or not integration.is_active:
        return GitHubConnectionStatus(connected=False)

    return GitHubConnectionStatus(
        connected=True,
        username=integration.github_username,
        avatar_url=integration.github_avatar_url,
        scopes=integration.scopes,
        connected_at=integration.created_at,
        last_used_at=integration.last_used_at,
    )


@router.delete("/disconnect")
async def disconnect_github(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    """Disconnect GitHub integration."""
    query = select(GitHubIntegration).where(GitHubIntegration.user_id == user["id"])
    result = await db.execute(query)
    integration = result.scalar_one_or_none()

    if integration:
        await db.delete(integration)
        await db.commit()

    return {"success": True}


# ============================================================================
# Repository Routes
# ============================================================================


@router.get("/repos", response_model=list[dict])
async def list_repositories(
    per_page: int = Query(30, ge=1, le=100),
    page: int = Query(1, ge=1),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[dict]:
    """List repositories for the authenticated user."""
    client, _ = await get_github_client(db, user)

    try:
        async with client:
            repos = await client.list_repos(per_page=per_page, page=page)
            return [r.model_dump() for r in repos]
    except GitHubTokenExpiredError as e:
        handle_github_token_error(e)


@router.get("/repos/{owner}/{repo}", response_model=dict)
async def get_repository(
    owner: str,
    repo: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    """Get a specific repository."""
    client, _ = await get_github_client(db, user)

    try:
        async with client:
            repository = await client.get_repo(owner, repo)
            return repository.model_dump()
    except GitHubTokenExpiredError as e:
        handle_github_token_error(e)


@router.get("/repos/{owner}/{repo}/branches", response_model=list[dict])
async def list_branches(
    owner: str,
    repo: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[dict]:
    """List branches for a repository."""
    client, _ = await get_github_client(db, user)

    try:
        async with client:
            branches = await client.list_branches(owner, repo)
            return [b.model_dump() for b in branches]
    except GitHubTokenExpiredError as e:
        handle_github_token_error(e)


# ============================================================================
# Pull Request Routes
# ============================================================================


@router.get("/repos/{owner}/{repo}/pulls", response_model=list[dict])
async def list_pull_requests(
    owner: str,
    repo: str,
    state: str = Query("open"),
    per_page: int = Query(30, ge=1, le=100),
    page: int = Query(1, ge=1),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[dict]:
    """List pull requests for a repository."""
    client, _ = await get_github_client(db, user)

    async with client:
        prs = await client.list_pull_requests(
            owner, repo, state=state, per_page=per_page, page=page
        )
        return [pr.model_dump() for pr in prs]


@router.get("/repos/{owner}/{repo}/pulls/{number}", response_model=dict)
async def get_pull_request(
    owner: str,
    repo: str,
    number: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    """Get a specific pull request."""
    client, _ = await get_github_client(db, user)

    async with client:
        pr = await client.get_pull_request(owner, repo, number)
        return pr.model_dump()


@router.post("/repos/{owner}/{repo}/pulls", response_model=dict)
async def create_pull_request(
    owner: str,
    repo: str,
    request: CreatePRRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    """Create a new pull request."""
    client, _ = await get_github_client(db, user)

    async with client:
        pr = await client.create_pull_request(
            owner,
            repo,
            title=request.title,
            head=request.head,
            base=request.base,
            body=request.body,
            draft=request.draft,
        )
        return pr.model_dump()


@router.patch("/repos/{owner}/{repo}/pulls/{number}", response_model=dict)
async def update_pull_request(
    owner: str,
    repo: str,
    number: int,
    request: UpdatePRRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    """Update a pull request."""
    client, _ = await get_github_client(db, user)

    async with client:
        pr = await client.update_pull_request(
            owner,
            repo,
            number,
            title=request.title,
            body=request.body,
            state=request.state,
            base=request.base,
        )
        return pr.model_dump()


@router.put("/repos/{owner}/{repo}/pulls/{number}/merge", response_model=dict)
async def merge_pull_request(
    owner: str,
    repo: str,
    number: int,
    request: MergePRRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    """Merge a pull request."""
    client, _ = await get_github_client(db, user)

    async with client:
        result = await client.merge_pull_request(
            owner,
            repo,
            number,
            commit_title=request.commit_title,
            commit_message=request.commit_message,
            merge_method=request.merge_method,
        )
        return result


@router.get("/repos/{owner}/{repo}/pulls/{number}/files", response_model=list[dict])
async def list_pr_files(
    owner: str,
    repo: str,
    number: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[dict]:
    """List files changed in a pull request."""
    client, _ = await get_github_client(db, user)

    async with client:
        files = await client.list_pr_files(owner, repo, number)
        return [f.model_dump() for f in files]


@router.get("/repos/{owner}/{repo}/pulls/{number}/commits", response_model=list[dict])
async def list_pr_commits(
    owner: str,
    repo: str,
    number: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[dict]:
    """List commits in a pull request."""
    client, _ = await get_github_client(db, user)

    async with client:
        commits = await client.list_pr_commits(owner, repo, number)
        return [c.model_dump() for c in commits]


# ============================================================================
# Review & Comment Routes
# ============================================================================


@router.get("/repos/{owner}/{repo}/pulls/{number}/reviews", response_model=list[dict])
async def list_pr_reviews(
    owner: str,
    repo: str,
    number: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[dict]:
    """List reviews on a pull request."""
    client, _ = await get_github_client(db, user)

    async with client:
        reviews = await client.list_pr_reviews(owner, repo, number)
        return [r.model_dump() for r in reviews]


@router.post("/repos/{owner}/{repo}/pulls/{number}/reviews", response_model=dict)
async def create_pr_review(
    owner: str,
    repo: str,
    number: int,
    request: CreateReviewRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    """Create a review on a pull request."""
    client, _ = await get_github_client(db, user)

    async with client:
        review = await client.create_pr_review(
            owner,
            repo,
            number,
            body=request.body,
            event=request.event,
            comments=request.comments,
        )
        return review.model_dump()


@router.get("/repos/{owner}/{repo}/pulls/{number}/comments", response_model=list[dict])
async def list_pr_comments(
    owner: str,
    repo: str,
    number: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[dict]:
    """List review comments on a pull request."""
    client, _ = await get_github_client(db, user)

    async with client:
        comments = await client.list_pr_comments(owner, repo, number)
        return [c.model_dump() for c in comments]


@router.post("/repos/{owner}/{repo}/pulls/{number}/comments", response_model=dict)
async def create_pr_comment(
    owner: str,
    repo: str,
    number: int,
    request: CreateCommentRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    """Create a review comment on a pull request."""
    client, _ = await get_github_client(db, user)

    async with client:
        comment = await client.create_pr_comment(
            owner,
            repo,
            number,
            body=request.body,
            commit_id=request.commit_id,
            path=request.path,
            line=request.line,
            side=request.side,
        )
        return comment.model_dump()


# ============================================================================
# GitHub Actions Routes
# ============================================================================


@router.get("/repos/{owner}/{repo}/actions/workflows", response_model=list[dict])
async def list_workflows(
    owner: str,
    repo: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[dict]:
    """List workflows for a repository."""
    client, _ = await get_github_client(db, user)

    async with client:
        workflows = await client.list_workflows(owner, repo)
        return [w.model_dump() for w in workflows]


@router.post("/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches")
async def trigger_workflow(
    owner: str,
    repo: str,
    workflow_id: str,
    request: TriggerWorkflowRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    """Trigger a workflow dispatch event."""
    client, _ = await get_github_client(db, user)

    async with client:
        await client.trigger_workflow(
            owner, repo, workflow_id, ref=request.ref, inputs=request.inputs
        )
        return {"success": True}


@router.get("/repos/{owner}/{repo}/actions/runs", response_model=list[dict])
async def list_workflow_runs(
    owner: str,
    repo: str,
    workflow_id: str | None = Query(None),
    branch: str | None = Query(None),
    run_status: str | None = Query(None, alias="status"),
    per_page: int = Query(30, ge=1, le=100),
    page: int = Query(1, ge=1),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[dict]:
    """List workflow runs for a repository."""
    client, _ = await get_github_client(db, user)

    async with client:
        runs = await client.list_workflow_runs(
            owner,
            repo,
            workflow_id=workflow_id,
            branch=branch,
            status=run_status,
            per_page=per_page,
            page=page,
        )
        return [r.model_dump() for r in runs]


@router.get("/repos/{owner}/{repo}/actions/runs/{run_id}", response_model=dict)
async def get_workflow_run(
    owner: str,
    repo: str,
    run_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    """Get a specific workflow run."""
    client, _ = await get_github_client(db, user)

    async with client:
        run = await client.get_workflow_run(owner, repo, run_id)
        return run.model_dump()


@router.get("/repos/{owner}/{repo}/actions/runs/{run_id}/jobs", response_model=list[dict])
async def list_workflow_jobs(
    owner: str,
    repo: str,
    run_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[dict]:
    """List jobs for a workflow run."""
    client, _ = await get_github_client(db, user)

    async with client:
        jobs = await client.list_workflow_jobs(owner, repo, run_id)
        return [j.model_dump() for j in jobs]


@router.get("/repos/{owner}/{repo}/actions/jobs/{job_id}/logs")
async def get_job_logs(
    owner: str,
    repo: str,
    job_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    """Get logs for a specific job."""
    client, _ = await get_github_client(db, user)

    async with client:
        logs = await client.get_job_logs(owner, repo, job_id)
        return {"logs": logs}


@router.post("/repos/{owner}/{repo}/actions/runs/{run_id}/cancel")
async def cancel_workflow_run(
    owner: str,
    repo: str,
    run_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    """Cancel a workflow run."""
    client, _ = await get_github_client(db, user)

    async with client:
        await client.cancel_workflow_run(owner, repo, run_id)
        return {"success": True}


@router.post("/repos/{owner}/{repo}/actions/runs/{run_id}/rerun")
async def rerun_workflow(
    owner: str,
    repo: str,
    run_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    """Re-run a workflow."""
    client, _ = await get_github_client(db, user)

    async with client:
        await client.rerun_workflow(owner, repo, run_id)
        return {"success": True}
