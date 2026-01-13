"""HTTP client for compute service communication."""

import contextlib
from http import HTTPStatus
from typing import Any

import httpx
import structlog

from src.config import settings
from src.exceptions import (
    ComputeServiceConnectionError,
    ComputeServiceHTTPError,
)

# Constants for parsing git output
MIN_COMMIT_INFO_PARTS = 2
MIN_GIT_STATUS_LINE_LENGTH = 3
MIN_BRANCH_PARTS = 3
MIN_COMMIT_LOG_PARTS = 5
MIN_DIFF_PARTS = 3

logger = structlog.get_logger()


class _HttpClientManager:
    """Manager for shared HTTP client with lazy initialization."""

    _instance: httpx.AsyncClient | None = None

    @classmethod
    def get(cls) -> httpx.AsyncClient:
        """Get or create the shared HTTP client."""
        if cls._instance is None:
            # Build headers with internal API key for service-to-service auth
            headers = {}
            if settings.COMPUTE_INTERNAL_API_KEY:
                headers["X-Internal-API-Key"] = settings.COMPUTE_INTERNAL_API_KEY

            cls._instance = httpx.AsyncClient(
                base_url=settings.COMPUTE_SERVICE_URL,
                timeout=httpx.Timeout(30.0, connect=10.0),
                headers=headers,
            )
        return cls._instance

    @classmethod
    async def close(cls) -> None:
        """Close the HTTP client on shutdown."""
        if cls._instance is not None:
            await cls._instance.aclose()
            cls._instance = None


def get_http_client() -> httpx.AsyncClient:
    """Get or create the shared HTTP client."""
    return _HttpClientManager.get()


async def close_http_client() -> None:
    """Close the HTTP client on shutdown."""
    await _HttpClientManager.close()


class ComputeClient:
    """Client for interacting with the compute service."""

    def __init__(self) -> None:
        self.client = get_http_client()

    async def _request(
        self,
        method: str,
        path: str,
        user_id: str | None = None,
        **kwargs: Any,
    ) -> Any:
        """Make an HTTP request to the compute service.

        Args:
            method: HTTP method.
            path: Request path.
            user_id: User ID to pass in X-User-ID header for authorization.
            **kwargs: Additional arguments to pass to httpx.
        """
        # Add user ID header if provided
        if user_id:
            headers = kwargs.get("headers", {})
            headers["X-User-ID"] = user_id
            kwargs["headers"] = headers

        try:
            response = await self.client.request(method, path, **kwargs)
            response.raise_for_status()

            # Return None for 204 No Content
            if response.status_code == HTTPStatus.NO_CONTENT:
                return None

            return response.json()
        except httpx.HTTPStatusError as e:
            # Log 404s at debug level since they're expected for existence checks
            if e.response.status_code == HTTPStatus.NOT_FOUND:
                logger.debug(
                    "Compute service resource not found",
                    path=path,
                    status_code=e.response.status_code,
                )
            else:
                logger.exception(
                    "Compute service HTTP error",
                    path=path,
                    status_code=e.response.status_code,
                    detail=e.response.text,
                )
            raise ComputeServiceHTTPError(
                e.response.status_code,
                e.response.text,
            ) from e
        except httpx.RequestError as e:
            logger.exception(
                "Compute service request error",
                path=path,
                error=str(e),
            )
            raise ComputeServiceConnectionError(str(e)) from e

    # ==================== Workspace Operations ====================

    async def create_workspace(
        self,
        session_id: str,
        user_id: str,
        workspace_id: str | None = None,
        config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Create a new workspace for a session."""
        result: dict[str, Any] = await self._request(
            "POST",
            "/workspaces",
            user_id=user_id,
            json={
                "session_id": session_id,
                "workspace_id": workspace_id,
                "config": config or {},
            },
        )
        return result

    async def get_workspace(
        self,
        workspace_id: str,
        user_id: str,
    ) -> dict[str, Any] | None:
        """Get workspace information."""
        try:
            result: dict[str, Any] = await self._request(
                "GET",
                f"/workspaces/{workspace_id}",
                user_id=user_id,
            )
        except ComputeServiceHTTPError as e:
            if e.status_code == HTTPStatus.NOT_FOUND:
                return None
            raise
        else:
            return result

    async def stop_workspace(self, workspace_id: str, user_id: str) -> None:
        """Stop a running workspace."""
        await self._request("POST", f"/workspaces/{workspace_id}/stop", user_id=user_id)

    async def restart_workspace(self, workspace_id: str, user_id: str) -> dict[str, Any]:
        """Restart a stopped/standby workspace."""
        result: dict[str, Any] = await self._request(
            "POST",
            f"/workspaces/{workspace_id}/restart",
            user_id=user_id,
        )
        return result

    async def delete_workspace(self, workspace_id: str, user_id: str) -> None:
        """Delete a workspace."""
        await self._request("DELETE", f"/workspaces/{workspace_id}", user_id=user_id)

    async def heartbeat(self, workspace_id: str, user_id: str) -> None:
        """Send heartbeat to keep workspace alive."""
        await self._request("POST", f"/workspaces/{workspace_id}/heartbeat", user_id=user_id)

    # ==================== File Operations ====================

    async def list_files(
        self,
        workspace_id: str,
        user_id: str,
        path: str = ".",
    ) -> list[dict[str, str]]:
        """List files in workspace directory."""
        result: list[dict[str, str]] | None = await self._request(
            "GET",
            f"/workspaces/{workspace_id}/files",
            user_id=user_id,
            params={"path": path},
        )
        return result if result else []

    async def read_file(
        self,
        workspace_id: str,
        user_id: str,
        path: str,
    ) -> dict[str, str]:
        """Read a file from the workspace."""
        result: dict[str, str] = await self._request(
            "GET",
            f"/workspaces/{workspace_id}/files/content",
            user_id=user_id,
            params={"path": path},
        )
        return result

    async def write_file(
        self,
        workspace_id: str,
        user_id: str,
        path: str,
        content: str,
    ) -> None:
        """Write a file to the workspace."""
        await self._request(
            "PUT",
            f"/workspaces/{workspace_id}/files/content",
            user_id=user_id,
            json={"path": path, "content": content},
        )

    async def delete_file(
        self,
        workspace_id: str,
        user_id: str,
        path: str,
    ) -> None:
        """Delete a file from the workspace."""
        await self._request(
            "DELETE",
            f"/workspaces/{workspace_id}/files",
            user_id=user_id,
            params={"path": path},
        )

    # ==================== Command Execution ====================

    async def exec_command(
        self,
        workspace_id: str,
        user_id: str,
        command: str,
        working_dir: str | None = None,
        exec_timeout: int = 60,
    ) -> dict[str, Any]:
        """Execute a command in the workspace."""
        result: dict[str, Any] = await self._request(
            "POST",
            f"/workspaces/{workspace_id}/exec",
            user_id=user_id,
            json={
                "command": command,
                "working_dir": working_dir,
                "timeout": exec_timeout,
            },
        )
        return result

    # ==================== Git Operations ====================

    async def git_status(self, workspace_id: str, user_id: str) -> dict[str, Any]:
        """Get git status for the workspace."""
        result = await self.exec_command(
            workspace_id,
            user_id,
            "git status --porcelain -b",
        )
        return self._parse_git_status(result.get("stdout", ""))

    async def git_branches(self, workspace_id: str, user_id: str) -> list[dict[str, Any]]:
        """Get list of git branches."""
        result = await self.exec_command(
            workspace_id,
            user_id,
            "git branch -a --format='%(refname:short)|%(objectname:short)|%(HEAD)'",
        )
        return self._parse_git_branches(result.get("stdout", ""))

    async def git_log(
        self,
        workspace_id: str,
        user_id: str,
        limit: int = 20,
    ) -> list[dict[str, str]]:
        """Get git commit log."""
        result = await self.exec_command(
            workspace_id,
            user_id,
            f"git log --format='%H|%h|%s|%an|%aI' -n {limit}",
        )
        return self._parse_git_log(result.get("stdout", ""))

    async def git_diff(
        self,
        workspace_id: str,
        user_id: str,
        *,
        staged: bool = False,
    ) -> list[dict[str, Any]]:
        """Get git diff."""
        flag = "--staged" if staged else ""
        result = await self.exec_command(
            workspace_id,
            user_id,
            f"git diff {flag} --numstat",
        )
        return self._parse_git_diff(result.get("stdout", ""))

    async def git_stage(self, workspace_id: str, user_id: str, files: list[str]) -> None:
        """Stage files for commit."""
        files_str = " ".join(f'"{f}"' for f in files)
        await self.exec_command(workspace_id, user_id, f"git add {files_str}")

    async def git_unstage(self, workspace_id: str, user_id: str, files: list[str]) -> None:
        """Unstage files."""
        files_str = " ".join(f'"{f}"' for f in files)
        await self.exec_command(workspace_id, user_id, f"git reset HEAD {files_str}")

    async def git_commit(
        self,
        workspace_id: str,
        user_id: str,
        message: str,
    ) -> dict[str, str]:
        """Create a git commit."""
        # Escape message for shell
        safe_message = message.replace('"', '\\"').replace("$", "\\$")
        result = await self.exec_command(
            workspace_id,
            user_id,
            f'git commit -m "{safe_message}"',
        )
        # Extract commit hash from output
        stdout = result.get("stdout", "")
        commit_hash = ""
        if "[" in stdout and "]" in stdout:
            # Parse "[branch hash] message" format
            parts = stdout.split("]")[0].split()
            if len(parts) >= MIN_COMMIT_INFO_PARTS:
                commit_hash = parts[-1]
        return {"message": message, "hash": commit_hash}

    async def git_push(
        self,
        workspace_id: str,
        user_id: str,
        remote: str = "origin",
        branch: str | None = None,
    ) -> dict[str, str]:
        """Push commits to remote."""
        cmd = f"git push {remote}"
        if branch:
            cmd += f" {branch}"
        result = await self.exec_command(workspace_id, user_id, cmd)
        return {"message": result.get("stdout", "") or result.get("stderr", "")}

    async def git_pull(
        self,
        workspace_id: str,
        user_id: str,
        remote: str = "origin",
        branch: str | None = None,
    ) -> dict[str, str]:
        """Pull changes from remote."""
        cmd = f"git pull {remote}"
        if branch:
            cmd += f" {branch}"
        result = await self.exec_command(workspace_id, user_id, cmd)
        return {"message": result.get("stdout", "") or result.get("stderr", "")}

    async def git_checkout(
        self,
        workspace_id: str,
        user_id: str,
        branch: str,
        *,
        create: bool = False,
    ) -> dict[str, str]:
        """Checkout a branch."""
        flag = "-b" if create else ""
        result = await self.exec_command(
            workspace_id,
            user_id,
            f"git checkout {flag} {branch}",
        )
        return {"message": result.get("stdout", "") or result.get("stderr", "")}

    # ==================== Git Worktree Operations ====================

    async def git_worktree_merge(
        self,
        workspace_id: str,
        user_id: str,
        branch_name: str,
        delete_branch: bool = True,  # noqa: FBT001, FBT002
    ) -> dict[str, Any]:
        """Merge a worktree branch to main branch."""
        try:
            # Switch to main branch
            await self.exec_command(workspace_id, user_id, "git checkout main")

            # Pull latest changes
            with contextlib.suppress(Exception):
                await self.exec_command(workspace_id, user_id, "git pull origin main")

            # Merge the branch
            result = await self.exec_command(
                workspace_id,
                user_id,
                f'git merge --no-ff {branch_name} -m "Merge {branch_name}"',
            )

            # Delete the branch if requested
            if delete_branch:
                with contextlib.suppress(Exception):
                    await self.exec_command(workspace_id, user_id, f"git branch -d {branch_name}")

            return {
                "success": True,
                "message": result.get("stdout", "") or result.get("stderr", ""),
            }
        except Exception as e:
            return {
                "success": False,
                "message": str(e),
            }

    async def git_worktree_check_conflicts(
        self,
        workspace_id: str,
        user_id: str,
        branch_name: str,
    ) -> dict[str, Any]:
        """Check for merge conflicts between branch and main."""
        try:
            # Save current branch
            current_result = await self.exec_command(
                workspace_id,
                user_id,
                "git rev-parse --abbrev-ref HEAD",
            )
            current_branch = current_result.get("stdout", "").strip()

            # Switch to main
            await self.exec_command(workspace_id, user_id, "git checkout main")

            # Try a dry-run merge
            try:
                await self.exec_command(
                    workspace_id,
                    user_id,
                    f"git merge --no-commit --no-ff {branch_name}",
                )
                # No conflicts
                await self.exec_command(workspace_id, user_id, "git merge --abort")
                conflicts = []
            except Exception:
                # Check for conflicting files
                status_result = await self.exec_command(
                    workspace_id,
                    user_id,
                    "git diff --name-only --diff-filter=U",
                )
                conflicts = [
                    line.strip()
                    for line in status_result.get("stdout", "").split("\n")
                    if line.strip()
                ]
                # Abort the merge
                await self.exec_command(workspace_id, user_id, "git merge --abort")

            # Return to original branch
            await self.exec_command(workspace_id, user_id, f"git checkout {current_branch}")

            return {
                "has_conflicts": len(conflicts) > 0,
                "files": [{"path": f, "conflict_markers": 1} for f in conflicts],
            }
        except Exception as e:
            logger.exception("Failed to check worktree conflicts", error=str(e))
            return {
                "has_conflicts": False,
                "files": [],
            }

    async def git_worktree_delete(
        self,
        workspace_id: str,
        user_id: str,
        worktree_path: str,
        branch_name: str,
    ) -> dict[str, Any]:
        """Remove a git worktree and its branch."""
        try:
            # Remove the worktree
            await self.exec_command(
                workspace_id,
                user_id,
                f"git worktree remove --force {worktree_path}",
            )

            # Delete the branch
            with contextlib.suppress(Exception):
                await self.exec_command(workspace_id, user_id, f"git branch -D {branch_name}")

            return {  # noqa: TRY300
                "success": True,
                "message": "Worktree deleted successfully",
            }
        except Exception as e:
            return {
                "success": False,
                "message": str(e),
            }

    # ==================== Git Parsing Helpers ====================

    def _parse_git_status(self, output: str) -> dict[str, Any]:
        """Parse git status --porcelain -b output."""
        lines = output.strip().split("\n") if output.strip() else []

        branch = "main"
        ahead = 0
        behind = 0
        staged = []
        unstaged = []
        untracked = []

        for line in lines:
            if line.startswith("## "):
                # Parse branch line: ## branch...origin/branch [ahead N, behind M]
                branch_info = line[3:]
                if "..." in branch_info:
                    branch = branch_info.split("...")[0]
                else:
                    branch = branch_info.split()[0] if branch_info else "main"
                if "[ahead " in branch_info:
                    with contextlib.suppress(IndexError, ValueError):
                        ahead = int(branch_info.split("[ahead ")[1].split("]")[0].split(",")[0])
                if "behind " in branch_info:
                    with contextlib.suppress(IndexError, ValueError):
                        behind = int(branch_info.split("behind ")[1].split("]")[0])
            elif len(line) >= MIN_GIT_STATUS_LINE_LENGTH:
                index_status = line[0]
                worktree_status = line[1]
                filepath = line[3:]

                if index_status == "?":
                    untracked.append(filepath)
                else:
                    if index_status != " ":
                        staged.append(
                            {
                                "path": filepath,
                                "status": self._git_status_char_to_name(index_status),
                            },
                        )
                    if worktree_status != " ":
                        unstaged.append(
                            {
                                "path": filepath,
                                "status": self._git_status_char_to_name(worktree_status),
                            },
                        )

        return {
            "branch": branch,
            "is_clean": len(staged) == 0 and len(unstaged) == 0 and len(untracked) == 0,
            "ahead": ahead,
            "behind": behind,
            "staged": staged,
            "unstaged": unstaged,
            "untracked": untracked,
        }

    def _git_status_char_to_name(self, char: str) -> str:
        """Convert git status character to name."""
        mapping = {
            "M": "modified",
            "A": "added",
            "D": "deleted",
            "R": "renamed",
            "C": "copied",
            "U": "unmerged",
        }
        return mapping.get(char, "unknown")

    def _parse_git_branches(self, output: str) -> list[dict[str, Any]]:
        """Parse git branch output."""
        branches = []
        for line in output.strip().split("\n"):
            if not line or "|" not in line:
                continue
            parts = line.split("|")
            if len(parts) >= MIN_BRANCH_PARTS:
                name = parts[0].strip()
                is_remote = name.startswith(("remotes/", "origin/"))
                branches.append(
                    {
                        "name": name.replace("remotes/", ""),
                        "is_current": parts[2].strip() == "*",
                        "is_remote": is_remote,
                        "commit_hash": parts[1].strip() if len(parts) > 1 else None,
                    },
                )
        return branches

    def _parse_git_log(self, output: str) -> list[dict[str, str]]:
        """Parse git log output."""
        commits = []
        for line in output.strip().split("\n"):
            if not line or "|" not in line:
                continue
            parts = line.split("|")
            if len(parts) >= MIN_COMMIT_LOG_PARTS:
                commits.append(
                    {
                        "hash": parts[0],
                        "short_hash": parts[1],
                        "message": parts[2],
                        "author": parts[3],
                        "date": parts[4],
                    },
                )
        return commits

    def _parse_git_diff(self, output: str) -> list[dict[str, Any]]:
        """Parse git diff --numstat output."""
        files = []
        for line in output.strip().split("\n"):
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) >= MIN_DIFF_PARTS:
                additions = int(parts[0]) if parts[0] != "-" else 0
                deletions = int(parts[1]) if parts[1] != "-" else 0
                files.append(
                    {
                        "path": parts[2],
                        "status": "modified",
                        "additions": additions,
                        "deletions": deletions,
                        "diff": None,  # Would need separate call for actual diff
                    },
                )
        return files


# Singleton instance
compute_client = ComputeClient()
