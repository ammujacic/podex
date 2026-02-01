"""Workspace operation routing service.

Routes workspace operations to either:
- Cloud compute service (Docker/GCP) via HTTP
- Local pods via WebSocket RPC

This provides a unified interface for workspace operations regardless of where
the workspace is running.
"""

import contextlib
from collections.abc import AsyncGenerator
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.compute_client import ComputeClient
from src.database.connection import get_db_context
from src.database.models import Workspace
from src.websocket.local_pod_hub import (
    PodNotConnectedError,
    RPCMethods,
    call_pod,
    is_pod_online,
)

logger = structlog.get_logger()

# RPC timeout for workspace operations (longer for create/exec)
RPC_TIMEOUT_DEFAULT = 30.0
RPC_TIMEOUT_LONG = 600.0  # 10 minutes for create operations
RPC_TIMEOUT_EXEC = 120.0  # 2 minutes for exec by default


class WorkspaceRouter:
    """Routes workspace operations to the appropriate backend.

    Checks if a workspace is running on a local pod and routes operations
    via WebSocket RPC if so, otherwise routes to the cloud compute service.

    The compute service URL is determined by the workspace's assigned server.
    """

    def __init__(self) -> None:
        pass

    async def _get_compute_client(self, workspace_id: str) -> ComputeClient:
        """Get the compute client for a workspace based on its server's compute_service_url.

        Args:
            workspace_id: The workspace ID.

        Returns:
            A ComputeClient configured for the workspace's compute service.

        Raises:
            ValueError: If the workspace has no server assigned or no compute_service_url.
        """
        async with get_db_context() as db:
            result = await db.execute(
                select(Workspace)
                .options(selectinload(Workspace.server))
                .where(Workspace.id == workspace_id)
            )
            workspace = result.scalar_one_or_none()

            if not workspace:
                msg = f"Workspace {workspace_id} not found"
                raise ValueError(msg)

            if not workspace.server:
                msg = f"Workspace {workspace_id} has no server assigned"
                raise ValueError(msg)

            if not workspace.server.compute_service_url:
                msg = f"Server {workspace.server.id} has no compute_service_url configured"
                raise ValueError(msg)

            return ComputeClient(workspace.server.compute_service_url)

    async def _get_local_pod_id(self, workspace_id: str) -> str | None:
        """Get the local_pod_id for a workspace, if any."""
        async with get_db_context() as db:
            result = await db.execute(
                select(Workspace.local_pod_id).where(Workspace.id == workspace_id)
            )
            return result.scalar_one_or_none()

    async def _is_local_pod_workspace(self, workspace_id: str) -> tuple[bool, str | None]:
        """Check if workspace is on a local pod and return pod_id.

        Returns:
            Tuple of (is_local, pod_id). If is_local is True, pod_id will be set.
        """
        local_pod_id = await self._get_local_pod_id(workspace_id)
        if local_pod_id:
            # Verify pod is still online
            if is_pod_online(local_pod_id):
                return True, local_pod_id
            logger.warning(
                "Local pod is offline for workspace",
                workspace_id=workspace_id,
                local_pod_id=local_pod_id,
            )
            # Could potentially fail or fallback here
            raise PodNotConnectedError(local_pod_id)
        return False, None

    async def _resolve_working_dir(
        self,
        workspace_id: str,
        user_id: str,
        working_dir: str | None,
    ) -> str:
        """Resolve working directory for git operations.

        For local pods without explicit working_dir, get the workspace's default working_dir.
        This ensures git commands run in the correct directory.
        """
        if working_dir:
            return working_dir

        # Use the robust get_workspace_working_dir which checks DB first
        return await self.get_workspace_working_dir(workspace_id, user_id)

    # ==================== Workspace Operations ====================

    async def get_workspace(
        self,
        workspace_id: str,
        user_id: str,
    ) -> dict[str, Any] | None:
        """Get workspace information."""
        is_local, pod_id = await self._is_local_pod_workspace(workspace_id)

        if is_local and pod_id:
            result = await call_pod(
                pod_id,
                RPCMethods.WORKSPACE_GET,
                {"workspace_id": workspace_id},
                rpc_timeout=RPC_TIMEOUT_DEFAULT,
            )
            return result if isinstance(result, dict) else None

        compute = await self._get_compute_client(workspace_id)
        return await compute.get_workspace(workspace_id, user_id)

    async def update_workspace(
        self,
        workspace_id: str,
        user_id: str,  # noqa: ARG002 - kept for API consistency
        working_dir: str | None = None,
    ) -> dict[str, Any] | None:
        """Update workspace configuration.

        Currently only supported for local pods (working_dir update).
        Cloud workspaces don't support dynamic working_dir changes.
        """
        is_local, pod_id = await self._is_local_pod_workspace(workspace_id)

        if is_local and pod_id:
            result = await call_pod(
                pod_id,
                RPCMethods.WORKSPACE_UPDATE,
                {
                    "workspace_id": workspace_id,
                    "working_dir": working_dir,
                },
                rpc_timeout=RPC_TIMEOUT_DEFAULT,
            )
            return result if isinstance(result, dict) else None

        # Cloud workspaces don't support dynamic working_dir changes
        return None

    async def stop_workspace(self, workspace_id: str, user_id: str) -> None:
        """Stop a running workspace."""
        is_local, pod_id = await self._is_local_pod_workspace(workspace_id)

        if is_local and pod_id:
            await call_pod(
                pod_id,
                RPCMethods.WORKSPACE_STOP,
                {"workspace_id": workspace_id},
                rpc_timeout=RPC_TIMEOUT_DEFAULT,
            )
            return

        compute = await self._get_compute_client(workspace_id)
        await compute.stop_workspace(workspace_id, user_id)

    async def restart_workspace(self, workspace_id: str, user_id: str) -> dict[str, Any]:
        """Restart a stopped/standby workspace."""
        is_local, pod_id = await self._is_local_pod_workspace(workspace_id)

        if is_local and pod_id:
            result = await call_pod(
                pod_id,
                RPCMethods.WORKSPACE_CREATE,  # Restart is essentially re-create
                {"workspace_id": workspace_id},
                rpc_timeout=RPC_TIMEOUT_LONG,
            )
            return result if isinstance(result, dict) else {}

        compute = await self._get_compute_client(workspace_id)
        return await compute.restart_workspace(workspace_id, user_id)

    async def delete_workspace(self, workspace_id: str, user_id: str) -> None:
        """Delete a workspace."""
        is_local, pod_id = await self._is_local_pod_workspace(workspace_id)

        if is_local and pod_id:
            await call_pod(
                pod_id,
                RPCMethods.WORKSPACE_DELETE,
                {"workspace_id": workspace_id},
                rpc_timeout=RPC_TIMEOUT_DEFAULT,
            )
            return

        compute = await self._get_compute_client(workspace_id)
        await compute.delete_workspace(workspace_id, user_id)

    async def heartbeat(self, workspace_id: str, user_id: str) -> None:
        """Send heartbeat to keep workspace alive."""
        is_local, pod_id = await self._is_local_pod_workspace(workspace_id)

        if is_local and pod_id:
            await call_pod(
                pod_id,
                RPCMethods.WORKSPACE_HEARTBEAT,
                {"workspace_id": workspace_id},
                rpc_timeout=RPC_TIMEOUT_DEFAULT,
            )
            return

        compute = await self._get_compute_client(workspace_id)
        await compute.heartbeat(workspace_id, user_id)

    async def health_check_workspace(
        self,
        workspace_id: str,
        user_id: str,
        timeout_seconds: int = 10,
    ) -> dict[str, Any]:
        """Check if a workspace container is healthy and responsive."""
        import time  # noqa: PLC0415

        start = time.monotonic()

        is_local, pod_id = await self._is_local_pod_workspace(workspace_id)

        if is_local and pod_id:
            try:
                result = await call_pod(
                    pod_id,
                    RPCMethods.HEALTH_CHECK,
                    {"workspace_id": workspace_id},
                    rpc_timeout=float(timeout_seconds),
                )
                latency_ms = (time.monotonic() - start) * 1000
                return {
                    "healthy": True,
                    "latency_ms": round(latency_ms, 2),
                    "exit_code": 0,
                    **(result if isinstance(result, dict) else {}),
                }
            except Exception as e:
                latency_ms = (time.monotonic() - start) * 1000
                return {
                    "healthy": False,
                    "latency_ms": round(latency_ms, 2),
                    "error": str(e)[:200],
                }

        compute = await self._get_compute_client(workspace_id)
        return await compute.health_check_workspace(workspace_id, user_id, timeout_seconds)

    # ==================== File Operations ====================

    async def list_files(
        self,
        workspace_id: str,
        user_id: str,
        path: str = ".",
    ) -> list[dict[str, str]]:
        """List files in workspace directory."""
        is_local, pod_id = await self._is_local_pod_workspace(workspace_id)

        if is_local and pod_id:
            # Get working_dir for stateless operation
            working_dir = await self.get_workspace_working_dir(workspace_id, user_id)
            result = await call_pod(
                pod_id,
                RPCMethods.WORKSPACE_LIST_FILES,
                {"workspace_id": workspace_id, "path": path, "working_dir": working_dir},
                rpc_timeout=RPC_TIMEOUT_DEFAULT,
            )
            return result if isinstance(result, list) else []

        compute = await self._get_compute_client(workspace_id)
        return await compute.list_files(workspace_id, user_id, path)

    async def read_file(
        self,
        workspace_id: str,
        user_id: str,
        path: str,
    ) -> dict[str, str]:
        """Read a file from the workspace."""
        is_local, pod_id = await self._is_local_pod_workspace(workspace_id)

        if is_local and pod_id:
            # Get working_dir for stateless operation
            working_dir = await self.get_workspace_working_dir(workspace_id, user_id)
            result = await call_pod(
                pod_id,
                RPCMethods.WORKSPACE_READ_FILE,
                {"workspace_id": workspace_id, "path": path, "working_dir": working_dir},
                rpc_timeout=RPC_TIMEOUT_DEFAULT,
            )
            if isinstance(result, dict):
                return result
            # Normalize response format
            return {"path": path, "content": str(result) if result else ""}

        compute = await self._get_compute_client(workspace_id)
        return await compute.read_file(workspace_id, user_id, path)

    async def write_file(
        self,
        workspace_id: str,
        user_id: str,
        path: str,
        content: str,
    ) -> None:
        """Write a file to the workspace."""
        is_local, pod_id = await self._is_local_pod_workspace(workspace_id)

        if is_local and pod_id:
            # Get working_dir for stateless operation
            working_dir = await self.get_workspace_working_dir(workspace_id, user_id)
            await call_pod(
                pod_id,
                RPCMethods.WORKSPACE_WRITE_FILE,
                {
                    "workspace_id": workspace_id,
                    "path": path,
                    "content": content,
                    "working_dir": working_dir,
                },
                rpc_timeout=RPC_TIMEOUT_DEFAULT,
            )
            return

        compute = await self._get_compute_client(workspace_id)
        await compute.write_file(workspace_id, user_id, path, content)

    async def delete_file(
        self,
        workspace_id: str,
        user_id: str,
        path: str,
    ) -> None:
        """Delete a file from the workspace."""
        is_local, pod_id = await self._is_local_pod_workspace(workspace_id)

        if is_local and pod_id:
            # Get working_dir for stateless operation
            working_dir = await self.get_workspace_working_dir(workspace_id, user_id)
            # Use exec to delete file on local pod
            await call_pod(
                pod_id,
                RPCMethods.WORKSPACE_EXEC,
                {
                    "workspace_id": workspace_id,
                    "command": f"rm -rf {path}",
                    "working_dir": working_dir,
                },
                rpc_timeout=RPC_TIMEOUT_DEFAULT,
            )
            return

        compute = await self._get_compute_client(workspace_id)
        await compute.delete_file(workspace_id, user_id, path)

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
        is_local, pod_id = await self._is_local_pod_workspace(workspace_id)

        if is_local and pod_id:
            result = await call_pod(
                pod_id,
                RPCMethods.WORKSPACE_EXEC,
                {
                    "workspace_id": workspace_id,
                    "command": command,
                    "working_dir": working_dir,
                    "timeout": exec_timeout,
                },
                rpc_timeout=float(exec_timeout) + 30,  # Add buffer for RPC overhead
            )
            if isinstance(result, dict):
                return result
            return {
                "exit_code": 0,
                "stdout": str(result) if result else "",
                "stderr": "",
            }

        compute = await self._get_compute_client(workspace_id)
        return await compute.exec_command(workspace_id, user_id, command, working_dir, exec_timeout)

    async def exec_command_stream(
        self,
        workspace_id: str,
        user_id: str,
        command: str,
        working_dir: str | None = None,
        exec_timeout: int = 60,
    ) -> AsyncGenerator[str, None]:
        """Execute a command and stream output chunks.

        Note: For local pods, streaming is not yet supported, so we fall back
        to exec_command and yield the full result.
        """
        is_local, pod_id = await self._is_local_pod_workspace(workspace_id)

        if is_local and pod_id:
            # Local pods don't support streaming yet, fall back to full exec
            result = await self.exec_command(
                workspace_id, user_id, command, working_dir, exec_timeout
            )
            yield result.get("stdout", "")
            if result.get("stderr"):
                yield result.get("stderr", "")
            return

        compute = await self._get_compute_client(workspace_id)
        async for chunk in compute.exec_command_stream(
            workspace_id, user_id, command, working_dir, exec_timeout
        ):
            yield chunk

    # ==================== Git Operations ====================
    # Git operations use exec_command, so they work automatically with local pods

    async def git_status(
        self,
        workspace_id: str,
        user_id: str,
        working_dir: str | None = None,
    ) -> dict[str, Any]:
        """Get git status for the workspace."""
        actual_working_dir = await self._resolve_working_dir(workspace_id, user_id, working_dir)

        result = await self.exec_command(
            workspace_id,
            user_id,
            "git status --porcelain -b",
            working_dir=actual_working_dir,
        )
        status = ComputeClient._parse_git_status(result.get("stdout", ""))

        # Include the actual working directory used
        status["working_dir"] = actual_working_dir
        return status

    async def git_branches(
        self,
        workspace_id: str,
        user_id: str,
        working_dir: str | None = None,
    ) -> list[dict[str, Any]]:
        """Get list of git branches."""
        actual_working_dir = await self._resolve_working_dir(workspace_id, user_id, working_dir)
        result = await self.exec_command(
            workspace_id,
            user_id,
            "git branch -a --format='%(refname:short)|%(objectname:short)|%(HEAD)'",
            working_dir=actual_working_dir,
        )
        return ComputeClient._parse_git_branches(result.get("stdout", ""))

    async def git_log(
        self,
        workspace_id: str,
        user_id: str,
        limit: int = 20,
        working_dir: str | None = None,
    ) -> list[dict[str, str]]:
        """Get git commit log."""
        actual_working_dir = await self._resolve_working_dir(workspace_id, user_id, working_dir)
        result = await self.exec_command(
            workspace_id,
            user_id,
            f"git log --format='%H|%h|%s|%an|%aI' -n {limit}",
            working_dir=actual_working_dir,
        )
        return ComputeClient._parse_git_log(result.get("stdout", ""))

    async def git_diff(
        self,
        workspace_id: str,
        user_id: str,
        *,
        staged: bool = False,
        working_dir: str | None = None,
    ) -> list[dict[str, Any]]:
        """Get git diff with actual diff content for each file."""
        actual_working_dir = await self._resolve_working_dir(workspace_id, user_id, working_dir)
        flag = "--staged" if staged else ""

        # First get file list with stats
        result = await self.exec_command(
            workspace_id,
            user_id,
            f"git diff {flag} --numstat",
            working_dir=actual_working_dir,
        )
        files = ComputeClient._parse_git_diff(result.get("stdout", ""))

        # Then get actual diff content for each file
        for file_info in files:
            file_path = file_info["path"]
            escaped_path = ComputeClient._escape_shell_arg(file_path)
            diff_result = await self.exec_command(
                workspace_id,
                user_id,
                f"git diff {flag} -- {escaped_path}",
                working_dir=actual_working_dir,
            )
            file_info["diff"] = diff_result.get("stdout", "")

        return files

    async def git_stage(
        self,
        workspace_id: str,
        user_id: str,
        files: list[str],
        working_dir: str | None = None,
    ) -> None:
        """Stage files for commit."""
        actual_working_dir = await self._resolve_working_dir(workspace_id, user_id, working_dir)
        escaped_files = [ComputeClient._escape_shell_arg(f) for f in files]
        files_str = " ".join(escaped_files)
        await self.exec_command(
            workspace_id, user_id, f"git add -- {files_str}", working_dir=actual_working_dir
        )

    async def git_unstage(
        self,
        workspace_id: str,
        user_id: str,
        files: list[str],
        working_dir: str | None = None,
    ) -> None:
        """Unstage files."""
        actual_working_dir = await self._resolve_working_dir(workspace_id, user_id, working_dir)
        escaped_files = [ComputeClient._escape_shell_arg(f) for f in files]
        files_str = " ".join(escaped_files)
        await self.exec_command(
            workspace_id, user_id, f"git reset HEAD -- {files_str}", working_dir=actual_working_dir
        )

    async def git_commit(
        self,
        workspace_id: str,
        user_id: str,
        message: str,
        working_dir: str | None = None,
    ) -> dict[str, str]:
        """Create a git commit."""
        actual_working_dir = await self._resolve_working_dir(workspace_id, user_id, working_dir)
        safe_message = ComputeClient._escape_shell_arg(message)
        result = await self.exec_command(
            workspace_id,
            user_id,
            f"git commit -m {safe_message}",
            working_dir=actual_working_dir,
        )
        stdout = result.get("stdout", "")
        commit_hash = ""
        if "[" in stdout and "]" in stdout:
            parts = stdout.split("]")[0].split()
            if len(parts) >= 2:
                commit_hash = parts[-1]
        return {"message": message, "hash": commit_hash}

    async def git_push(
        self,
        workspace_id: str,
        user_id: str,
        remote: str = "origin",
        branch: str | None = None,
        working_dir: str | None = None,
    ) -> dict[str, str]:
        """Push commits to remote."""
        actual_working_dir = await self._resolve_working_dir(workspace_id, user_id, working_dir)
        cmd = f"git push {remote}"
        if branch:
            cmd += f" {branch}"
        result = await self.exec_command(workspace_id, user_id, cmd, working_dir=actual_working_dir)
        return {"message": result.get("stdout", "") or result.get("stderr", "")}

    async def git_pull(
        self,
        workspace_id: str,
        user_id: str,
        remote: str = "origin",
        branch: str | None = None,
        working_dir: str | None = None,
    ) -> dict[str, str]:
        """Pull changes from remote."""
        actual_working_dir = await self._resolve_working_dir(workspace_id, user_id, working_dir)
        cmd = f"git pull {remote}"
        if branch:
            cmd += f" {branch}"
        result = await self.exec_command(workspace_id, user_id, cmd, working_dir=actual_working_dir)
        return {"message": result.get("stdout", "") or result.get("stderr", "")}

    async def git_checkout(
        self,
        workspace_id: str,
        user_id: str,
        branch: str,
        *,
        create: bool = False,
        working_dir: str | None = None,
    ) -> dict[str, str]:
        """Checkout a branch."""
        actual_working_dir = await self._resolve_working_dir(workspace_id, user_id, working_dir)
        flag = "-b" if create else ""
        result = await self.exec_command(
            workspace_id,
            user_id,
            f"git checkout {flag} {branch}",
            working_dir=actual_working_dir,
        )
        return {"message": result.get("stdout", "") or result.get("stderr", "")}

    async def git_compare(
        self,
        workspace_id: str,
        user_id: str,
        base: str,
        compare: str,
        working_dir: str | None = None,
        include_uncommitted: bool = False,
    ) -> dict[str, Any]:
        """Compare two branches.

        Args:
            include_uncommitted: If True, also include uncommitted working directory changes
        """
        actual_working_dir = await self._resolve_working_dir(workspace_id, user_id, working_dir)

        # Get commits between branches
        # Use compare..base to get commits on base not on compare
        # (i.e., how many commits base is "ahead" of compare)
        commits_result = await self.exec_command(
            workspace_id,
            user_id,
            f"git log --oneline --format='%H|%s|%an|%ad' --date=iso {compare}..{base}",
            working_dir=actual_working_dir,
        )
        commits_output = commits_result.get("stdout", "")
        commits = []
        for line in commits_output.strip().split("\n") if commits_output.strip() else []:
            parts = line.split("|", 3)
            if len(parts) >= 4:
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
            f"git diff --stat {compare}...{base}",
            working_dir=actual_working_dir,
        )
        stat_output = stat_result.get("stdout", "")

        # Get list of changed files between branches
        files_result = await self.exec_command(
            workspace_id,
            user_id,
            f"git diff --name-status {compare}...{base}",
            working_dir=actual_working_dir,
        )
        files_output = files_result.get("stdout", "")
        files: list[dict[str, str]] = []
        seen_paths: set[str] = set()
        status_map = {"A": "added", "M": "modified", "D": "deleted", "R": "renamed"}

        for line in files_output.strip().split("\n") if files_output.strip() else []:
            parts = line.split("\t", 1)
            if len(parts) >= 2:
                status = parts[0]
                path = parts[1]
                files.append(
                    {
                        "path": path,
                        "status": status_map.get(status[0], "modified"),
                    }
                )
                seen_paths.add(path)

        # Include uncommitted changes if requested
        if include_uncommitted:
            # Get staged changes
            staged_result = await self.exec_command(
                workspace_id,
                user_id,
                "git diff --cached --name-status",
                working_dir=actual_working_dir,
            )
            staged_output = staged_result.get("stdout", "")
            for line in staged_output.strip().split("\n") if staged_output.strip() else []:
                parts = line.split("\t", 1)
                if len(parts) >= 2:
                    status, path = parts[0], parts[1]
                    if path not in seen_paths:
                        files.append(
                            {"path": path, "status": status_map.get(status[0], "modified")}
                        )
                        seen_paths.add(path)

            # Get unstaged changes
            unstaged_result = await self.exec_command(
                workspace_id, user_id, "git diff --name-status", working_dir=actual_working_dir
            )
            unstaged_output = unstaged_result.get("stdout", "")
            for line in unstaged_output.strip().split("\n") if unstaged_output.strip() else []:
                parts = line.split("\t", 1)
                if len(parts) >= 2:
                    status, path = parts[0], parts[1]
                    if path not in seen_paths:
                        files.append(
                            {"path": path, "status": status_map.get(status[0], "modified")}
                        )
                        seen_paths.add(path)

            # Get untracked files
            untracked_result = await self.exec_command(
                workspace_id,
                user_id,
                "git ls-files --others --exclude-standard",
                working_dir=actual_working_dir,
            )
            untracked_output = untracked_result.get("stdout", "")
            for line in untracked_output.strip().split("\n") if untracked_output.strip() else []:
                path = line.strip()
                if path and path not in seen_paths:
                    files.append({"path": path, "status": "added"})
                    seen_paths.add(path)

        return {
            "base": base,
            "compare": compare,
            "commits": commits,
            "files": files,
            "ahead": len(commits),
            "stat": stat_output.strip() if stat_output else "",
        }

    async def git_merge_preview(
        self,
        workspace_id: str,
        user_id: str,
        source_branch: str,
        target_branch: str,
        working_dir: str | None = None,
    ) -> dict[str, Any]:
        """Preview a merge operation without actually merging."""
        actual_working_dir = await self._resolve_working_dir(workspace_id, user_id, working_dir)

        # Save current branch
        current_branch_result = await self.exec_command(
            workspace_id, user_id, "git branch --show-current", working_dir=actual_working_dir
        )
        current_branch = current_branch_result.get("stdout", "").strip()

        # Check if there are uncommitted changes
        status_result = await self.exec_command(
            workspace_id, user_id, "git status --porcelain", working_dir=actual_working_dir
        )
        if status_result.get("stdout", "").strip():
            return {
                "can_merge": False,
                "has_conflicts": False,
                "conflicts": [],
                "files_changed": [],
                "error": "Uncommitted changes exist. Please commit or stash before merging.",
            }

        # Checkout target branch
        await self.exec_command(
            workspace_id, user_id, f"git checkout {target_branch}", working_dir=actual_working_dir
        )

        try:
            # Try merge with no commit and no fast-forward
            merge_result = await self.exec_command(
                workspace_id,
                user_id,
                f"git merge --no-commit --no-ff {source_branch}",
                working_dir=actual_working_dir,
            )

            if merge_result.get("exit_code", 0) != 0:
                # Merge failed - likely conflicts
                conflict_result = await self.exec_command(
                    workspace_id,
                    user_id,
                    "git diff --name-only --diff-filter=U",
                    working_dir=actual_working_dir,
                )
                conflict_output = conflict_result.get("stdout", "")
                conflicts = [f.strip() for f in conflict_output.strip().split("\n") if f.strip()]
                result: dict[str, Any] = {
                    "can_merge": False,
                    "has_conflicts": True,
                    "conflicts": conflicts,
                    "files_changed": [],
                }
            else:
                # Get list of files that would change
                diff_result = await self.exec_command(
                    workspace_id,
                    user_id,
                    "git diff --cached --name-status HEAD",
                    working_dir=actual_working_dir,
                )
                diff_output = diff_result.get("stdout", "")
                files = []
                for line in diff_output.strip().split("\n") if diff_output.strip() else []:
                    parts = line.split("\t", 1)
                    if len(parts) >= 2:
                        files.append({"path": parts[1], "status": parts[0]})
                result = {
                    "can_merge": True,
                    "has_conflicts": False,
                    "conflicts": [],
                    "files_changed": files,
                }
        finally:
            # Abort merge and checkout original branch
            with contextlib.suppress(Exception):
                await self.exec_command(
                    workspace_id, user_id, "git merge --abort", working_dir=actual_working_dir
                )
            with contextlib.suppress(Exception):
                await self.exec_command(
                    workspace_id,
                    user_id,
                    f"git checkout {current_branch}",
                    working_dir=actual_working_dir,
                )

        return result

    # ==================== Terminal Operations ====================

    async def terminal_create(
        self,
        workspace_id: str,
        user_id: str,
        session_id: str | None = None,
        shell: str = "bash",
        command: str | None = None,
    ) -> dict[str, Any]:
        """Create a terminal session.

        For local pods, creates a tmux session via RPC.
        For cloud workspaces, delegates to compute service.

        Args:
            workspace_id: ID of the workspace.
            user_id: User ID (for workspace lookup).
            session_id: Optional unique session ID for tmux.
            shell: Shell to use if command not provided.
            command: Optional command to run instead of interactive shell.
                    If provided, tmux starts directly running this command.

        Returns:
            Dict with session info including working_dir for the workspace.
        """
        is_local, pod_id = await self._is_local_pod_workspace(workspace_id)

        if is_local and pod_id:
            # Get workspace info from DB to pass working_dir to local pod
            # This allows the pod to work even after restart (stateless)
            working_dir = await self.get_workspace_working_dir(workspace_id, user_id)

            params: dict[str, Any] = {
                "workspace_id": workspace_id,
                "session_id": session_id or workspace_id,
                "shell": shell,
                "working_dir": working_dir,  # Pass working_dir so pod doesn't need state
                "user_id": user_id,
            }
            if command:
                params["command"] = command  # Pass command to run directly

            result = await call_pod(
                pod_id,
                RPCMethods.TERMINAL_CREATE,
                params,
                rpc_timeout=RPC_TIMEOUT_DEFAULT,
            )
            return result if isinstance(result, dict) else {}

        # For cloud workspaces, return basic info - actual terminal is via WebSocket
        return {
            "session_id": session_id or workspace_id,
            "workspace_id": workspace_id,
            "working_dir": "/home/dev",
            "shell": shell,
        }

    async def terminal_input(
        self,
        workspace_id: str,
        user_id: str,
        session_id: str,
        data: str,
    ) -> None:
        """Send input to a terminal session."""
        is_local, pod_id = await self._is_local_pod_workspace(workspace_id)

        if is_local and pod_id:
            # Get working_dir for stateless operation
            working_dir = await self.get_workspace_working_dir(workspace_id, user_id)
            await call_pod(
                pod_id,
                RPCMethods.TERMINAL_INPUT,
                {
                    "workspace_id": workspace_id,
                    "session_id": session_id,
                    "data": data,
                    "working_dir": working_dir,
                },
                rpc_timeout=RPC_TIMEOUT_DEFAULT,
            )

    async def terminal_resize(
        self,
        workspace_id: str,
        user_id: str,
        session_id: str,
        rows: int,
        cols: int,
    ) -> None:
        """Resize a terminal session."""
        is_local, pod_id = await self._is_local_pod_workspace(workspace_id)

        if is_local and pod_id:
            # Get working_dir for stateless operation
            working_dir = await self.get_workspace_working_dir(workspace_id, user_id)
            await call_pod(
                pod_id,
                RPCMethods.TERMINAL_RESIZE,
                {
                    "workspace_id": workspace_id,
                    "session_id": session_id,
                    "rows": rows,
                    "cols": cols,
                    "working_dir": working_dir,
                },
                rpc_timeout=RPC_TIMEOUT_DEFAULT,
            )

    async def terminal_close(
        self,
        workspace_id: str,
        user_id: str,
        session_id: str,
    ) -> None:
        """Close a terminal session."""
        is_local, pod_id = await self._is_local_pod_workspace(workspace_id)

        if is_local and pod_id:
            # Get working_dir for stateless operation
            working_dir = await self.get_workspace_working_dir(workspace_id, user_id)
            await call_pod(
                pod_id,
                RPCMethods.TERMINAL_CLOSE,
                {
                    "workspace_id": workspace_id,
                    "session_id": session_id,
                    "working_dir": working_dir,
                },
                rpc_timeout=RPC_TIMEOUT_DEFAULT,
            )

    async def is_local_pod_workspace(self, workspace_id: str) -> bool:
        """Check if a workspace is running on a local pod.

        Public method for other modules to check workspace type.
        """
        is_local, _ = await self._is_local_pod_workspace(workspace_id)
        return is_local

    async def get_workspace_working_dir(self, workspace_id: str, user_id: str) -> str:
        """Get the working directory for a workspace.

        For local pods, returns the actual host path from DB (mount_path).
        For cloud workspaces, returns /home/dev.
        """
        is_local, pod_id = await self._is_local_pod_workspace(workspace_id)

        if is_local and pod_id:
            # Get mount_path from session.settings in DB
            # This is the authoritative source - don't rely on local pod state
            from src.database import Session as SessionModel  # noqa: PLC0415
            from src.database.connection import async_session_factory  # noqa: PLC0415

            async with async_session_factory() as db:
                result = await db.execute(
                    select(SessionModel).where(SessionModel.workspace_id == workspace_id)
                )
                session = result.scalar_one_or_none()
                if session and session.settings:
                    mount_path = session.settings.get("mount_path")
                    if mount_path:
                        return str(mount_path)

            # Fallback: try to get from local pod (if it has the workspace registered)
            try:
                workspace_info = await self.get_workspace(workspace_id, user_id)
                if workspace_info:
                    return str(workspace_info.get("working_dir", "."))
            except Exception:
                pass

            return "."

        return "/home/dev"


# Singleton instance
workspace_router = WorkspaceRouter()
