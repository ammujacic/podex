"""GitHub API client for PR and Actions integration."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Self

import httpx
import structlog
from pydantic import BaseModel

from src.config import settings

logger = structlog.get_logger(__name__)

GITHUB_API_BASE = settings.GITHUB_API_URL


# ============================================================================
# Exceptions
# ============================================================================


class GitHubTokenExpiredError(Exception):
    """Raised when the GitHub access token is invalid or expired."""


# ============================================================================
# Response Models
# ============================================================================


class GitHubUser(BaseModel):
    """GitHub user info."""

    id: int
    login: str
    avatar_url: str | None = None
    html_url: str | None = None


class GitHubRepo(BaseModel):
    """GitHub repository info."""

    id: int
    name: str
    full_name: str
    private: bool
    html_url: str
    default_branch: str
    owner: GitHubUser


class GitHubBranch(BaseModel):
    """GitHub branch info."""

    name: str
    commit_sha: str
    protected: bool = False


class GitHubCommit(BaseModel):
    """GitHub commit info."""

    sha: str
    message: str
    author: str
    date: datetime
    html_url: str | None = None


class GitHubPRFile(BaseModel):
    """File changed in a PR."""

    filename: str
    status: str  # added, removed, modified, renamed
    additions: int
    deletions: int
    changes: int
    patch: str | None = None
    previous_filename: str | None = None


class GitHubLabel(BaseModel):
    """PR/Issue label."""

    id: int
    name: str
    color: str
    description: str | None = None


class GitHubPullRequest(BaseModel):
    """GitHub pull request."""

    id: int
    number: int
    title: str
    body: str | None = None
    state: str  # open, closed
    draft: bool = False
    merged: bool = False
    mergeable: bool | None = None
    mergeable_state: str | None = None
    html_url: str
    diff_url: str
    user: GitHubUser
    head_ref: str
    head_sha: str
    base_ref: str
    base_sha: str
    labels: list[GitHubLabel] = []
    requested_reviewers: list[GitHubUser] = []
    additions: int = 0
    deletions: int = 0
    changed_files: int = 0
    created_at: datetime
    updated_at: datetime
    merged_at: datetime | None = None
    closed_at: datetime | None = None


class GitHubReview(BaseModel):
    """PR review."""

    id: int
    user: GitHubUser
    body: str | None = None
    state: str  # APPROVED, CHANGES_REQUESTED, COMMENTED, PENDING, DISMISSED
    submitted_at: datetime | None = None
    html_url: str


class GitHubComment(BaseModel):
    """PR/Issue comment."""

    id: int
    user: GitHubUser
    body: str
    html_url: str
    created_at: datetime
    updated_at: datetime
    # For PR review comments
    path: str | None = None
    position: int | None = None
    line: int | None = None
    commit_id: str | None = None


class GitHubWorkflow(BaseModel):
    """GitHub Actions workflow."""

    id: int
    name: str
    path: str
    state: str  # active, disabled_manually, disabled_inactivity
    html_url: str


class GitHubWorkflowRun(BaseModel):
    """GitHub Actions workflow run."""

    id: int
    name: str
    workflow_id: int
    status: str  # queued, in_progress, completed
    conclusion: str | None  # success, failure, cancelled, skipped, etc.
    html_url: str
    run_number: int
    event: str  # push, pull_request, workflow_dispatch, etc.
    head_branch: str | None = None
    head_sha: str
    created_at: datetime
    updated_at: datetime
    run_started_at: datetime | None = None


class GitHubJob(BaseModel):
    """GitHub Actions job."""

    id: int
    run_id: int
    name: str
    status: str
    conclusion: str | None
    html_url: str
    started_at: datetime | None = None
    completed_at: datetime | None = None
    steps: list[dict[str, Any]] = []


# ============================================================================
# GitHub Client
# ============================================================================


class GitHubClient:
    """Client for GitHub API interactions."""

    def __init__(self, access_token: str):
        self.access_token = access_token
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> Self:
        self._client = httpx.AsyncClient(
            base_url=GITHUB_API_BASE,
            headers={
                "Authorization": f"Bearer {self.access_token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": settings.GITHUB_API_VERSION,
            },
            timeout=settings.HTTP_TIMEOUT_GITHUB,
        )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._client:
            await self._client.aclose()

    @property
    def client(self) -> httpx.AsyncClient:
        if not self._client:
            raise RuntimeError("GitHubClient must be used as async context manager")
        return self._client

    async def _request(
        self,
        method: str,
        path: str,
        **kwargs,
    ) -> dict[str, Any] | list[Any] | str:
        """Make a request to the GitHub API."""
        response = await self.client.request(method, path, **kwargs)

        # Handle 401 specifically - token is invalid/expired
        if response.status_code == 401:
            raise GitHubTokenExpiredError(
                "GitHub access token is invalid or expired. Please reconnect your GitHub account."
            )

        response.raise_for_status()

        if response.headers.get("content-type", "").startswith("application/json"):
            return response.json()
        return response.text

    # -------------------------------------------------------------------------
    # User & Repo
    # -------------------------------------------------------------------------

    async def get_authenticated_user(self) -> GitHubUser:
        """Get the authenticated user."""
        data = await self._request("GET", "/user")
        return GitHubUser(
            id=data["id"],
            login=data["login"],
            avatar_url=data.get("avatar_url"),
            html_url=data.get("html_url"),
        )

    async def list_repos(
        self, per_page: int = 30, page: int = 1, sort: str = "updated"
    ) -> list[GitHubRepo]:
        """List repositories for the authenticated user."""
        data = await self._request(
            "GET",
            "/user/repos",
            params={"per_page": per_page, "page": page, "sort": sort},
        )
        return [
            GitHubRepo(
                id=r["id"],
                name=r["name"],
                full_name=r["full_name"],
                private=r["private"],
                html_url=r["html_url"],
                default_branch=r["default_branch"],
                owner=GitHubUser(
                    id=r["owner"]["id"],
                    login=r["owner"]["login"],
                    avatar_url=r["owner"].get("avatar_url"),
                ),
            )
            for r in data
        ]

    async def get_repo(self, owner: str, repo: str) -> GitHubRepo:
        """Get a specific repository."""
        data = await self._request("GET", f"/repos/{owner}/{repo}")
        return GitHubRepo(
            id=data["id"],
            name=data["name"],
            full_name=data["full_name"],
            private=data["private"],
            html_url=data["html_url"],
            default_branch=data["default_branch"],
            owner=GitHubUser(
                id=data["owner"]["id"],
                login=data["owner"]["login"],
                avatar_url=data["owner"].get("avatar_url"),
            ),
        )

    async def list_branches(self, owner: str, repo: str) -> list[GitHubBranch]:
        """List branches for a repository."""
        data = await self._request("GET", f"/repos/{owner}/{repo}/branches")
        return [
            GitHubBranch(
                name=b["name"],
                commit_sha=b["commit"]["sha"],
                protected=b.get("protected", False),
            )
            for b in data
        ]

    # -------------------------------------------------------------------------
    # Pull Requests
    # -------------------------------------------------------------------------

    def _parse_pr(self, data: dict) -> GitHubPullRequest:
        """Parse PR data from API response."""
        return GitHubPullRequest(
            id=data["id"],
            number=data["number"],
            title=data["title"],
            body=data.get("body"),
            state=data["state"],
            draft=data.get("draft", False),
            merged=data.get("merged", False),
            mergeable=data.get("mergeable"),
            mergeable_state=data.get("mergeable_state"),
            html_url=data["html_url"],
            diff_url=data["diff_url"],
            user=GitHubUser(
                id=data["user"]["id"],
                login=data["user"]["login"],
                avatar_url=data["user"].get("avatar_url"),
            ),
            head_ref=data["head"]["ref"],
            head_sha=data["head"]["sha"],
            base_ref=data["base"]["ref"],
            base_sha=data["base"]["sha"],
            labels=[
                GitHubLabel(
                    id=l["id"],
                    name=l["name"],
                    color=l["color"],
                    description=l.get("description"),
                )
                for l in data.get("labels", [])
            ],
            requested_reviewers=[
                GitHubUser(id=r["id"], login=r["login"], avatar_url=r.get("avatar_url"))
                for r in data.get("requested_reviewers", [])
            ],
            additions=data.get("additions", 0),
            deletions=data.get("deletions", 0),
            changed_files=data.get("changed_files", 0),
            created_at=datetime.fromisoformat(data["created_at"].replace("Z", "+00:00")),
            updated_at=datetime.fromisoformat(data["updated_at"].replace("Z", "+00:00")),
            merged_at=(
                datetime.fromisoformat(data["merged_at"].replace("Z", "+00:00"))
                if data.get("merged_at")
                else None
            ),
            closed_at=(
                datetime.fromisoformat(data["closed_at"].replace("Z", "+00:00"))
                if data.get("closed_at")
                else None
            ),
        )

    async def list_pull_requests(
        self,
        owner: str,
        repo: str,
        state: str = "open",
        per_page: int = 30,
        page: int = 1,
    ) -> list[GitHubPullRequest]:
        """List pull requests for a repository."""
        data = await self._request(
            "GET",
            f"/repos/{owner}/{repo}/pulls",
            params={"state": state, "per_page": per_page, "page": page},
        )
        return [self._parse_pr(pr) for pr in data]

    async def get_pull_request(self, owner: str, repo: str, number: int) -> GitHubPullRequest:
        """Get a specific pull request."""
        data = await self._request("GET", f"/repos/{owner}/{repo}/pulls/{number}")
        return self._parse_pr(data)

    async def create_pull_request(
        self,
        owner: str,
        repo: str,
        title: str,
        head: str,
        base: str,
        body: str | None = None,
        draft: bool = False,
    ) -> GitHubPullRequest:
        """Create a new pull request."""
        data = await self._request(
            "POST",
            f"/repos/{owner}/{repo}/pulls",
            json={
                "title": title,
                "head": head,
                "base": base,
                "body": body,
                "draft": draft,
            },
        )
        return self._parse_pr(data)

    async def update_pull_request(
        self,
        owner: str,
        repo: str,
        number: int,
        title: str | None = None,
        body: str | None = None,
        state: str | None = None,
        base: str | None = None,
    ) -> GitHubPullRequest:
        """Update a pull request."""
        update_data = {}
        if title is not None:
            update_data["title"] = title
        if body is not None:
            update_data["body"] = body
        if state is not None:
            update_data["state"] = state
        if base is not None:
            update_data["base"] = base

        data = await self._request(
            "PATCH",
            f"/repos/{owner}/{repo}/pulls/{number}",
            json=update_data,
        )
        return self._parse_pr(data)

    async def merge_pull_request(
        self,
        owner: str,
        repo: str,
        number: int,
        commit_title: str | None = None,
        commit_message: str | None = None,
        merge_method: str = "merge",  # merge, squash, rebase
    ) -> dict[str, Any]:
        """Merge a pull request."""
        merge_data: dict[str, Any] = {"merge_method": merge_method}
        if commit_title:
            merge_data["commit_title"] = commit_title
        if commit_message:
            merge_data["commit_message"] = commit_message

        return await self._request(
            "PUT",
            f"/repos/{owner}/{repo}/pulls/{number}/merge",
            json=merge_data,
        )

    async def list_pr_files(self, owner: str, repo: str, number: int) -> list[GitHubPRFile]:
        """List files changed in a pull request."""
        data = await self._request(
            "GET",
            f"/repos/{owner}/{repo}/pulls/{number}/files",
        )
        return [
            GitHubPRFile(
                filename=f["filename"],
                status=f["status"],
                additions=f["additions"],
                deletions=f["deletions"],
                changes=f["changes"],
                patch=f.get("patch"),
                previous_filename=f.get("previous_filename"),
            )
            for f in data
        ]

    async def list_pr_commits(self, owner: str, repo: str, number: int) -> list[GitHubCommit]:
        """List commits in a pull request."""
        data = await self._request(
            "GET",
            f"/repos/{owner}/{repo}/pulls/{number}/commits",
        )
        return [
            GitHubCommit(
                sha=c["sha"],
                message=c["commit"]["message"],
                author=c["commit"]["author"]["name"],
                date=datetime.fromisoformat(c["commit"]["author"]["date"].replace("Z", "+00:00")),
                html_url=c.get("html_url"),
            )
            for c in data
        ]

    # -------------------------------------------------------------------------
    # Reviews & Comments
    # -------------------------------------------------------------------------

    async def list_pr_reviews(self, owner: str, repo: str, number: int) -> list[GitHubReview]:
        """List reviews on a pull request."""
        data = await self._request(
            "GET",
            f"/repos/{owner}/{repo}/pulls/{number}/reviews",
        )
        return [
            GitHubReview(
                id=r["id"],
                user=GitHubUser(
                    id=r["user"]["id"],
                    login=r["user"]["login"],
                    avatar_url=r["user"].get("avatar_url"),
                ),
                body=r.get("body"),
                state=r["state"],
                submitted_at=(
                    datetime.fromisoformat(r["submitted_at"].replace("Z", "+00:00"))
                    if r.get("submitted_at")
                    else None
                ),
                html_url=r["html_url"],
            )
            for r in data
        ]

    async def create_pr_review(
        self,
        owner: str,
        repo: str,
        number: int,
        body: str | None = None,
        event: str = "COMMENT",  # APPROVE, REQUEST_CHANGES, COMMENT
        comments: list[dict[str, Any]] | None = None,
    ) -> GitHubReview:
        """Create a review on a pull request."""
        review_data: dict[str, Any] = {"event": event}
        if body:
            review_data["body"] = body
        if comments:
            review_data["comments"] = comments

        data = await self._request(
            "POST",
            f"/repos/{owner}/{repo}/pulls/{number}/reviews",
            json=review_data,
        )
        return GitHubReview(
            id=data["id"],
            user=GitHubUser(
                id=data["user"]["id"],
                login=data["user"]["login"],
                avatar_url=data["user"].get("avatar_url"),
            ),
            body=data.get("body"),
            state=data["state"],
            submitted_at=(
                datetime.fromisoformat(data["submitted_at"].replace("Z", "+00:00"))
                if data.get("submitted_at")
                else None
            ),
            html_url=data["html_url"],
        )

    async def list_pr_comments(self, owner: str, repo: str, number: int) -> list[GitHubComment]:
        """List review comments on a pull request."""
        data = await self._request(
            "GET",
            f"/repos/{owner}/{repo}/pulls/{number}/comments",
        )
        return [
            GitHubComment(
                id=c["id"],
                user=GitHubUser(
                    id=c["user"]["id"],
                    login=c["user"]["login"],
                    avatar_url=c["user"].get("avatar_url"),
                ),
                body=c["body"],
                html_url=c["html_url"],
                created_at=datetime.fromisoformat(c["created_at"].replace("Z", "+00:00")),
                updated_at=datetime.fromisoformat(c["updated_at"].replace("Z", "+00:00")),
                path=c.get("path"),
                position=c.get("position"),
                line=c.get("line"),
                commit_id=c.get("commit_id"),
            )
            for c in data
        ]

    async def create_pr_comment(
        self,
        owner: str,
        repo: str,
        number: int,
        body: str,
        commit_id: str,
        path: str,
        line: int,
        side: str = "RIGHT",  # LEFT or RIGHT
    ) -> GitHubComment:
        """Create a review comment on a pull request."""
        data = await self._request(
            "POST",
            f"/repos/{owner}/{repo}/pulls/{number}/comments",
            json={
                "body": body,
                "commit_id": commit_id,
                "path": path,
                "line": line,
                "side": side,
            },
        )
        return GitHubComment(
            id=data["id"],
            user=GitHubUser(
                id=data["user"]["id"],
                login=data["user"]["login"],
                avatar_url=data["user"].get("avatar_url"),
            ),
            body=data["body"],
            html_url=data["html_url"],
            created_at=datetime.fromisoformat(data["created_at"].replace("Z", "+00:00")),
            updated_at=datetime.fromisoformat(data["updated_at"].replace("Z", "+00:00")),
            path=data.get("path"),
            line=data.get("line"),
            commit_id=data.get("commit_id"),
        )

    # -------------------------------------------------------------------------
    # GitHub Actions
    # -------------------------------------------------------------------------

    async def list_workflows(self, owner: str, repo: str) -> list[GitHubWorkflow]:
        """List workflows for a repository."""
        data = await self._request("GET", f"/repos/{owner}/{repo}/actions/workflows")
        return [
            GitHubWorkflow(
                id=w["id"],
                name=w["name"],
                path=w["path"],
                state=w["state"],
                html_url=w["html_url"],
            )
            for w in data.get("workflows", [])
        ]

    async def trigger_workflow(
        self,
        owner: str,
        repo: str,
        workflow_id: int | str,
        ref: str,
        inputs: dict[str, Any] | None = None,
    ) -> None:
        """Trigger a workflow dispatch event."""
        dispatch_data: dict[str, Any] = {"ref": ref}
        if inputs:
            dispatch_data["inputs"] = inputs

        await self._request(
            "POST",
            f"/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
            json=dispatch_data,
        )

    async def list_workflow_runs(
        self,
        owner: str,
        repo: str,
        workflow_id: int | str | None = None,
        branch: str | None = None,
        status: str | None = None,
        per_page: int = 30,
        page: int = 1,
    ) -> list[GitHubWorkflowRun]:
        """List workflow runs for a repository."""
        params: dict[str, Any] = {"per_page": per_page, "page": page}
        if branch:
            params["branch"] = branch
        if status:
            params["status"] = status

        if workflow_id:
            path = f"/repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs"
        else:
            path = f"/repos/{owner}/{repo}/actions/runs"

        data = await self._request("GET", path, params=params)
        return [
            GitHubWorkflowRun(
                id=r["id"],
                name=r["name"],
                workflow_id=r["workflow_id"],
                status=r["status"],
                conclusion=r.get("conclusion"),
                html_url=r["html_url"],
                run_number=r["run_number"],
                event=r["event"],
                head_branch=r.get("head_branch"),
                head_sha=r["head_sha"],
                created_at=datetime.fromisoformat(r["created_at"].replace("Z", "+00:00")),
                updated_at=datetime.fromisoformat(r["updated_at"].replace("Z", "+00:00")),
                run_started_at=(
                    datetime.fromisoformat(r["run_started_at"].replace("Z", "+00:00"))
                    if r.get("run_started_at")
                    else None
                ),
            )
            for r in data.get("workflow_runs", [])
        ]

    async def get_workflow_run(self, owner: str, repo: str, run_id: int) -> GitHubWorkflowRun:
        """Get a specific workflow run."""
        data = await self._request("GET", f"/repos/{owner}/{repo}/actions/runs/{run_id}")
        return GitHubWorkflowRun(
            id=data["id"],
            name=data["name"],
            workflow_id=data["workflow_id"],
            status=data["status"],
            conclusion=data.get("conclusion"),
            html_url=data["html_url"],
            run_number=data["run_number"],
            event=data["event"],
            head_branch=data.get("head_branch"),
            head_sha=data["head_sha"],
            created_at=datetime.fromisoformat(data["created_at"].replace("Z", "+00:00")),
            updated_at=datetime.fromisoformat(data["updated_at"].replace("Z", "+00:00")),
            run_started_at=(
                datetime.fromisoformat(data["run_started_at"].replace("Z", "+00:00"))
                if data.get("run_started_at")
                else None
            ),
        )

    async def list_workflow_jobs(self, owner: str, repo: str, run_id: int) -> list[GitHubJob]:
        """List jobs for a workflow run."""
        data = await self._request("GET", f"/repos/{owner}/{repo}/actions/runs/{run_id}/jobs")
        return [
            GitHubJob(
                id=j["id"],
                run_id=j["run_id"],
                name=j["name"],
                status=j["status"],
                conclusion=j.get("conclusion"),
                html_url=j["html_url"],
                started_at=(
                    datetime.fromisoformat(j["started_at"].replace("Z", "+00:00"))
                    if j.get("started_at")
                    else None
                ),
                completed_at=(
                    datetime.fromisoformat(j["completed_at"].replace("Z", "+00:00"))
                    if j.get("completed_at")
                    else None
                ),
                steps=j.get("steps", []),
            )
            for j in data.get("jobs", [])
        ]

    async def get_job_logs(self, owner: str, repo: str, job_id: int) -> str:
        """Get logs for a specific job."""
        # GitHub returns a redirect to the actual logs
        response = await self.client.get(
            f"/repos/{owner}/{repo}/actions/jobs/{job_id}/logs",
            follow_redirects=True,
        )
        response.raise_for_status()
        return response.text

    async def cancel_workflow_run(self, owner: str, repo: str, run_id: int) -> None:
        """Cancel a workflow run."""
        await self._request("POST", f"/repos/{owner}/{repo}/actions/runs/{run_id}/cancel")

    async def rerun_workflow(self, owner: str, repo: str, run_id: int) -> None:
        """Re-run a workflow."""
        await self._request("POST", f"/repos/{owner}/{repo}/actions/runs/{run_id}/rerun")
