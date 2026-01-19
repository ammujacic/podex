"""HTTP client for compute service communication."""

import contextlib
import time
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from http import HTTPStatus
from typing import Any

import httpx
import structlog
from sqlalchemy import select, update

from src.config import settings
from src.database.connection import get_db_context
from src.database.models import Session as SessionModel
from src.database.models import Workspace
from src.exceptions import (
    ComputeClientError,
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
        # Workspace creation can take a long time due to:
        # - Docker container startup
        # - GCS file syncing
        # - Repo cloning
        # - Post-init commands (up to 300s each)
        # Use a much longer timeout for workspace creation
        workspace_creation_timeout = 600  # 10 minutes

        logger.debug(
            "Creating workspace with extended timeout",
            workspace_id=workspace_id,
            timeout_seconds=workspace_creation_timeout,
        )

        try:
            # Create a custom client with appropriate timeout for workspace creation
            async with httpx.AsyncClient(
                base_url=settings.COMPUTE_SERVICE_URL,
                timeout=httpx.Timeout(float(workspace_creation_timeout), connect=10.0),
                headers={"X-Internal-API-Key": settings.COMPUTE_INTERNAL_API_KEY}
                if settings.COMPUTE_INTERNAL_API_KEY
                else {},
            ) as client:
                headers = {"X-User-ID": user_id}
                response = await client.post(
                    "/workspaces",
                    headers=headers,
                    json={
                        "session_id": session_id,
                        "workspace_id": workspace_id,
                        "config": config or {},
                    },
                )
                response.raise_for_status()
                result: dict[str, Any] = response.json()
                return result
        except httpx.TimeoutException:
            logger.exception(
                "Workspace creation timed out",
                workspace_id=workspace_id,
                timeout_seconds=workspace_creation_timeout,
            )
            raise ComputeServiceConnectionError(
                f"Workspace creation timed out after {workspace_creation_timeout} seconds"
            ) from None
        except httpx.HTTPStatusError as e:
            logger.exception(
                "Workspace creation HTTP error",
                workspace_id=workspace_id,
                status_code=e.response.status_code,
                detail=e.response.text[:500] if e.response.text else None,
            )
            raise ComputeServiceHTTPError(
                e.response.status_code,
                e.response.text,
            ) from e
        except httpx.RequestError as e:
            logger.exception(
                "Workspace creation request error",
                workspace_id=workspace_id,
            )
            raise ComputeServiceConnectionError(str(e)) from e

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
                # Workspace not found in compute service, mark as standby
                await self._handle_workspace_not_found(workspace_id, "get")
                return None
            raise
        else:
            return result

    async def _handle_workspace_not_found(self, workspace_id: str, operation: str) -> None:
        """Handle case where compute service doesn't know about a workspace.

        This indicates a state inconsistency where the API database thinks a workspace
        exists but the compute service doesn't have it (likely stopped/removed).
        Automatically mark as standby in the database.
        """
        logger.warning(
            "Compute service returned 404 for workspace %s, marking as standby",
            operation,
            workspace_id=workspace_id,
            operation=operation,
        )

        try:
            async with get_db_context() as db:
                # Update workspace status to standby
                now = datetime.now(UTC)
                result = await db.execute(
                    update(Workspace)
                    .where(Workspace.id == workspace_id)
                    .values(status="standby", standby_at=now, updated_at=now)
                )

                if result.rowcount and result.rowcount > 0:  # type: ignore[attr-defined]
                    logger.info(
                        "Automatically marked inconsistent workspace as standby",
                        workspace_id=workspace_id,
                        operation=operation,
                    )

                    # Emit WebSocket event to notify clients
                    try:
                        # Import here to avoid circular import with sessions.py
                        from src.websocket.hub import emit_to_session  # noqa: PLC0415

                        session_result = await db.execute(
                            select(SessionModel).where(SessionModel.workspace_id == workspace_id)
                        )
                        session = session_result.scalar_one_or_none()
                        if session:
                            await emit_to_session(
                                str(session.id),
                                "workspace_status",
                                {
                                    "workspace_id": workspace_id,
                                    "status": "standby",
                                    "standby_at": now.isoformat(),
                                },
                            )
                    except Exception as e:
                        logger.warning(
                            "Failed to emit WebSocket event for auto-standby",
                            workspace_id=workspace_id,
                            error=str(e),
                        )
                else:
                    logger.warning(
                        "Workspace not found in database during auto-standby",
                        workspace_id=workspace_id,
                    )

                await db.commit()

        except Exception as e:
            logger.exception(
                "Failed to auto-mark workspace as standby",
                workspace_id=workspace_id,
                operation=operation,
                error=str(e),
            )

    async def stop_workspace(self, workspace_id: str, user_id: str) -> None:
        """Stop a running workspace."""
        try:
            await self._request("POST", f"/workspaces/{workspace_id}/stop", user_id=user_id)
        except ComputeServiceHTTPError as e:
            if e.status_code == 404:
                # Workspace not found in compute service, mark as standby
                await self._handle_workspace_not_found(workspace_id, "stop")
            else:
                raise

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
        try:
            await self._request("POST", f"/workspaces/{workspace_id}/heartbeat", user_id=user_id)
        except ComputeServiceHTTPError as e:
            if e.status_code == 404:
                # Workspace not found in compute service, mark as standby
                await self._handle_workspace_not_found(workspace_id, "heartbeat")
            else:
                raise

    async def scale_workspace(
        self,
        workspace_id: str,
        user_id: str,
        new_tier: str,
    ) -> dict[str, Any]:
        """Scale a workspace to a new compute tier."""
        result: dict[str, Any] = await self._request(
            "POST",
            f"/workspaces/{workspace_id}/scale",
            user_id=user_id,
            json={"new_tier": new_tier},
        )
        return result

    async def health_check_workspace(
        self,
        workspace_id: str,
        user_id: str,
        timeout_seconds: int = 10,
    ) -> dict[str, Any]:
        """Check if a workspace container is healthy and responsive.

        Performs a lightweight operation to verify container responsiveness
        by executing a simple echo command.

        Args:
            workspace_id: The workspace ID.
            user_id: User ID for authorization.
            timeout_seconds: Command timeout in seconds.

        Returns:
            Dict with 'healthy', 'latency_ms', and optional 'error' fields.
        """
        start = time.monotonic()

        try:
            # Simple command that should complete quickly
            result = await self._request(
                "POST",
                f"/workspaces/{workspace_id}/exec",
                user_id=user_id,
                json={
                    "command": "echo 'health_check'",
                    "timeout": timeout_seconds,
                },
            )
            latency_ms = (time.monotonic() - start) * 1000

            return {
                "healthy": True,
                "latency_ms": round(latency_ms, 2),
                "exit_code": result.get("exit_code", 0) if result else 0,
            }
        except ComputeServiceHTTPError as e:
            latency_ms = (time.monotonic() - start) * 1000
            return {
                "healthy": False,
                "latency_ms": round(latency_ms, 2),
                "error": f"HTTP {e.status_code}: {e.detail[:200] if e.detail else 'Unknown'}",
            }
        except Exception as e:
            latency_ms = (time.monotonic() - start) * 1000
            return {
                "healthy": False,
                "latency_ms": round(latency_ms, 2),
                "error": str(e)[:200],
            }

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
        """Execute a command in the workspace.

        Args:
            workspace_id: The workspace ID.
            user_id: User ID for authorization.
            command: The command to execute.
            working_dir: Working directory for the command.
            exec_timeout: Timeout for command execution in seconds.

        Returns:
            Dict with exit_code, stdout, stderr.
        """
        # Use a longer HTTP timeout for long-running commands
        # Add 30 seconds buffer for network overhead
        http_timeout = max(exec_timeout + 30, 60)

        logger.debug(
            "Executing command in workspace",
            workspace_id=workspace_id,
            command=command[:100],
            exec_timeout=exec_timeout,
            http_timeout=http_timeout,
        )

        try:
            # Create a custom client with appropriate timeout for this request
            async with httpx.AsyncClient(
                base_url=settings.COMPUTE_SERVICE_URL,
                timeout=httpx.Timeout(float(http_timeout), connect=10.0),
                headers={"X-Internal-API-Key": settings.COMPUTE_INTERNAL_API_KEY}
                if settings.COMPUTE_INTERNAL_API_KEY
                else {},
            ) as client:
                headers = {"X-User-ID": user_id}
                response = await client.post(
                    f"/workspaces/{workspace_id}/exec",
                    headers=headers,
                    json={
                        "command": command,
                        "working_dir": working_dir,
                        "timeout": exec_timeout,
                    },
                )
                response.raise_for_status()
                result: dict[str, Any] = response.json()

                logger.debug(
                    "Command execution completed",
                    workspace_id=workspace_id,
                    exit_code=result.get("exit_code"),
                    stdout_len=len(result.get("stdout", "")),
                    stderr_len=len(result.get("stderr", "")),
                )

                return result
        except httpx.TimeoutException:
            logger.exception(
                "Command execution timed out",
                workspace_id=workspace_id,
                command=command[:100],
                exec_timeout=exec_timeout,
            )
            return {
                "exit_code": -1,
                "stdout": "",
                "stderr": f"Command timed out after {exec_timeout} seconds",
            }
        except httpx.HTTPStatusError as e:
            logger.exception(
                "Command execution HTTP error",
                workspace_id=workspace_id,
                command=command[:100],
                status_code=e.response.status_code,
                detail=e.response.text[:500] if e.response.text else None,
            )
            raise ComputeServiceHTTPError(
                e.response.status_code,
                e.response.text,
            ) from e
        except httpx.RequestError as e:
            logger.exception(
                "Command execution request error",
                workspace_id=workspace_id,
                command=command[:100],
            )
            raise ComputeServiceConnectionError(str(e)) from e

    async def exec_command_stream(
        self,
        workspace_id: str,
        user_id: str,
        command: str,
        working_dir: str | None = None,
        exec_timeout: int = 60,
    ) -> AsyncGenerator[str, None]:
        """Execute a command and stream output chunks.

        Uses Server-Sent Events to stream command output in real-time.
        Useful for interactive commands like authentication flows.

        Args:
            workspace_id: The workspace ID.
            user_id: User ID for authorization.
            command: The command to execute.
            working_dir: Working directory for the command.
            exec_timeout: Timeout for command execution in seconds.

        Yields:
            Output chunks as strings.
        """
        http_timeout = max(exec_timeout + 30, 60)

        logger.debug(
            "Streaming command in workspace",
            workspace_id=workspace_id,
            command=command[:100],
            exec_timeout=exec_timeout,
        )

        try:
            async with httpx.AsyncClient(
                base_url=settings.COMPUTE_SERVICE_URL,
                timeout=httpx.Timeout(float(http_timeout), connect=10.0),
                headers={"X-Internal-API-Key": settings.COMPUTE_INTERNAL_API_KEY}
                if settings.COMPUTE_INTERNAL_API_KEY
                else {},
            ) as client:
                headers = {"X-User-ID": user_id}
                async with client.stream(
                    "POST",
                    f"/workspaces/{workspace_id}/exec-stream",
                    headers=headers,
                    json={
                        "command": command,
                        "working_dir": working_dir,
                        "timeout": exec_timeout,
                    },
                ) as response:
                    response.raise_for_status()

                    # Process SSE stream
                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            data = line[6:]  # Remove "data: " prefix
                            if data == "[DONE]":
                                break
                            if data.startswith("ERROR:"):
                                logger.warning(
                                    "Streaming exec error",
                                    workspace_id=workspace_id,
                                    error=data,
                                )
                                yield data
                                break
                            # Unescape newlines from SSE format
                            chunk = data.replace("\\n", "\n")
                            yield chunk

        except httpx.TimeoutException:
            logger.exception(
                "Streaming exec timed out",
                workspace_id=workspace_id,
                command=command[:100],
            )
            yield f"Command timed out after {exec_timeout} seconds"
        except httpx.HTTPStatusError as e:
            logger.exception(
                "Streaming exec HTTP error",
                workspace_id=workspace_id,
                status_code=e.response.status_code,
            )
            yield f"Error: HTTP {e.response.status_code}"
        except Exception as e:
            logger.exception(
                "Streaming exec error",
                workspace_id=workspace_id,
            )
            yield f"Error: {e}"

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
        # Use -- to separate options from paths, and properly escape each file
        escaped_files = [self._escape_shell_arg(f) for f in files]
        files_str = " ".join(escaped_files)
        await self.exec_command(workspace_id, user_id, f"git add -- {files_str}")

    async def git_unstage(self, workspace_id: str, user_id: str, files: list[str]) -> None:
        """Unstage files."""
        # Use -- to separate options from paths, and properly escape each file
        escaped_files = [self._escape_shell_arg(f) for f in files]
        files_str = " ".join(escaped_files)
        await self.exec_command(workspace_id, user_id, f"git reset HEAD -- {files_str}")

    async def git_commit(
        self,
        workspace_id: str,
        user_id: str,
        message: str,
    ) -> dict[str, str]:
        """Create a git commit."""
        # Use proper shell escaping for the commit message
        safe_message = self._escape_shell_arg(message)
        result = await self.exec_command(
            workspace_id,
            user_id,
            f"git commit -m {safe_message}",
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
        delete_branch: bool = True,
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

            return {
                "success": True,
                "message": "Worktree deleted successfully",
            }
        except Exception as e:
            return {
                "success": False,
                "message": str(e),
            }

    async def git_compare(
        self,
        workspace_id: str,
        user_id: str,
        base: str,
        compare: str,
    ) -> dict[str, Any]:
        """Compare two branches and return commits and changed files.

        Args:
            workspace_id: The workspace ID.
            user_id: The user ID.
            base: The base branch to compare from.
            compare: The branch to compare against.

        Returns:
            Dictionary with commits, files, and stats.
        """
        try:
            # Get commits between branches
            commits_result = await self.exec_command(
                workspace_id,
                user_id,
                f"git log --oneline --format='%H|%s|%an|%ad' --date=iso {base}..{compare}",
            )
            commits_output = commits_result.get("stdout", "")
            commits = []
            for line in commits_output.strip().split("\n") if commits_output.strip() else []:
                parts = line.split("|", 3)
                if len(parts) >= MIN_COMMIT_LOG_PARTS - 1:
                    commits.append(
                        {
                            "sha": parts[0],
                            "message": parts[1],
                            "author": parts[2],
                            "date": parts[3],
                        }
                    )

            # Get diff stat
            stat_result = await self.exec_command(
                workspace_id,
                user_id,
                f"git diff --stat {base}...{compare}",
            )
            stat_output = stat_result.get("stdout", "")

            # Get list of changed files
            files_result = await self.exec_command(
                workspace_id,
                user_id,
                f"git diff --name-status {base}...{compare}",
            )
            files_output = files_result.get("stdout", "")
            files = []
            for line in files_output.strip().split("\n") if files_output.strip() else []:
                parts = line.split("\t", 1)
                if len(parts) >= MIN_COMMIT_INFO_PARTS:
                    status = parts[0]
                    path = parts[1]
                    status_map = {
                        "A": "added",
                        "M": "modified",
                        "D": "deleted",
                        "R": "renamed",
                    }
                    files.append(
                        {
                            "path": path,
                            "status": status_map.get(status[0], "modified"),
                        }
                    )

            return {
                "base": base,
                "compare": compare,
                "commits": commits,
                "files": files,
                "ahead": len(commits),
                "stat": stat_output.strip() if stat_output else "",
            }
        except Exception as e:
            raise ComputeClientError(f"Branch comparison failed: {e}") from e

    async def git_merge_preview(
        self,
        workspace_id: str,
        user_id: str,
        source_branch: str,
        target_branch: str,
    ) -> dict[str, Any]:
        """Preview a merge operation without actually merging.

        Args:
            workspace_id: The workspace ID.
            user_id: The user ID.
            source_branch: The branch to merge from.
            target_branch: The branch to merge into.

        Returns:
            Dictionary with merge preview including conflict information.
        """
        try:
            # Save current branch
            current_branch_result = await self.exec_command(
                workspace_id,
                user_id,
                "git branch --show-current",
            )
            current_branch = current_branch_result.get("stdout", "").strip()

            # Check if there are uncommitted changes
            status_result = await self.exec_command(
                workspace_id,
                user_id,
                "git status --porcelain",
            )
            status_output = status_result.get("stdout", "")
            if status_output.strip():
                return {
                    "can_merge": False,
                    "has_conflicts": False,
                    "conflicts": [],
                    "files_changed": [],
                    "error": "Uncommitted changes exist. Please commit or stash before merging.",
                }

            # Checkout target branch
            await self.exec_command(workspace_id, user_id, f"git checkout {target_branch}")

            try:
                # Try merge with no commit and no fast-forward
                await self.exec_command(
                    workspace_id,
                    user_id,
                    f"git merge --no-commit --no-ff {source_branch}",
                )

                # Get list of files that would change
                diff_result = await self.exec_command(
                    workspace_id,
                    user_id,
                    "git diff --cached --name-status HEAD",
                )
                diff_output = diff_result.get("stdout", "")
                files = []
                for line in diff_output.strip().split("\n") if diff_output.strip() else []:
                    parts = line.split("\t", 1)
                    if len(parts) >= MIN_COMMIT_INFO_PARTS:
                        files.append(
                            {
                                "path": parts[1],
                                "status": parts[0],
                            }
                        )

                result = {
                    "can_merge": True,
                    "has_conflicts": False,
                    "conflicts": [],
                    "files_changed": files,
                }
            except Exception:
                # Merge failed - likely conflicts
                # Get conflict files
                conflict_result = await self.exec_command(
                    workspace_id,
                    user_id,
                    "git diff --name-only --diff-filter=U",
                )
                conflict_output = conflict_result.get("stdout", "")
                conflicts = [f.strip() for f in conflict_output.strip().split("\n") if f.strip()]

                result = {
                    "can_merge": False,
                    "has_conflicts": True,
                    "conflicts": conflicts,
                    "files_changed": [],
                }
            finally:
                # Abort merge and checkout original branch
                with contextlib.suppress(Exception):
                    await self.exec_command(workspace_id, user_id, "git merge --abort")
                with contextlib.suppress(Exception):
                    await self.exec_command(workspace_id, user_id, f"git checkout {current_branch}")

            return result
        except Exception as e:
            raise ComputeClientError(f"Merge preview failed: {e}") from e

    # ==================== Shell Escaping Helpers ====================

    def _escape_shell_arg(self, arg: str) -> str:
        """Safely escape a string for use as a shell argument.

        Uses single quotes which prevent all shell interpretation.
        Single quotes within the string are handled by ending the quoted
        section, adding an escaped single quote, and starting a new section.

        Args:
            arg: The string to escape.

        Returns:
            A safely quoted shell argument.
        """
        # Replace single quotes with: end quote, escaped quote, start quote
        # e.g., "it's" becomes 'it'\''s'
        escaped = arg.replace("'", "'\"'\"'")
        return f"'{escaped}'"

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
