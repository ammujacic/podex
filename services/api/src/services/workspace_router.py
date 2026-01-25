"""Workspace operation routing service.

Routes workspace operations to either:
- Cloud compute service (Docker/GCP) via HTTP
- Local pods via WebSocket RPC

This provides a unified interface for workspace operations regardless of where
the workspace is running.
"""

from collections.abc import AsyncGenerator
from typing import Any

import structlog
from sqlalchemy import select

from src.compute_client import ComputeClient, compute_client
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
    """

    def __init__(self, compute: ComputeClient | None = None) -> None:
        self.compute = compute or compute_client

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

        return await self.compute.get_workspace(workspace_id, user_id)

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

        await self.compute.stop_workspace(workspace_id, user_id)

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

        return await self.compute.restart_workspace(workspace_id, user_id)

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

        await self.compute.delete_workspace(workspace_id, user_id)

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

        await self.compute.heartbeat(workspace_id, user_id)

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

        return await self.compute.health_check_workspace(workspace_id, user_id, timeout_seconds)

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
            result = await call_pod(
                pod_id,
                RPCMethods.WORKSPACE_LIST_FILES,
                {"workspace_id": workspace_id, "path": path},
                rpc_timeout=RPC_TIMEOUT_DEFAULT,
            )
            return result if isinstance(result, list) else []

        return await self.compute.list_files(workspace_id, user_id, path)

    async def read_file(
        self,
        workspace_id: str,
        user_id: str,
        path: str,
    ) -> dict[str, str]:
        """Read a file from the workspace."""
        is_local, pod_id = await self._is_local_pod_workspace(workspace_id)

        if is_local and pod_id:
            result = await call_pod(
                pod_id,
                RPCMethods.WORKSPACE_READ_FILE,
                {"workspace_id": workspace_id, "path": path},
                rpc_timeout=RPC_TIMEOUT_DEFAULT,
            )
            if isinstance(result, dict):
                return result
            # Normalize response format
            return {"path": path, "content": str(result) if result else ""}

        return await self.compute.read_file(workspace_id, user_id, path)

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
            await call_pod(
                pod_id,
                RPCMethods.WORKSPACE_WRITE_FILE,
                {"workspace_id": workspace_id, "path": path, "content": content},
                rpc_timeout=RPC_TIMEOUT_DEFAULT,
            )
            return

        await self.compute.write_file(workspace_id, user_id, path, content)

    async def delete_file(
        self,
        workspace_id: str,
        user_id: str,
        path: str,
    ) -> None:
        """Delete a file from the workspace."""
        is_local, pod_id = await self._is_local_pod_workspace(workspace_id)

        if is_local and pod_id:
            # Use exec to delete file on local pod
            await call_pod(
                pod_id,
                RPCMethods.WORKSPACE_EXEC,
                {"workspace_id": workspace_id, "command": f"rm -rf {path}"},
                rpc_timeout=RPC_TIMEOUT_DEFAULT,
            )
            return

        await self.compute.delete_file(workspace_id, user_id, path)

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

        return await self.compute.exec_command(
            workspace_id, user_id, command, working_dir, exec_timeout
        )

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

        async for chunk in self.compute.exec_command_stream(
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
        result = await self.exec_command(
            workspace_id,
            user_id,
            "git status --porcelain -b",
            working_dir=working_dir,
        )
        return self.compute._parse_git_status(result.get("stdout", ""))

    async def git_branches(
        self,
        workspace_id: str,
        user_id: str,
        working_dir: str | None = None,
    ) -> list[dict[str, Any]]:
        """Get list of git branches."""
        result = await self.exec_command(
            workspace_id,
            user_id,
            "git branch -a --format='%(refname:short)|%(objectname:short)|%(HEAD)'",
            working_dir=working_dir,
        )
        return self.compute._parse_git_branches(result.get("stdout", ""))

    async def git_log(
        self,
        workspace_id: str,
        user_id: str,
        limit: int = 20,
        working_dir: str | None = None,
    ) -> list[dict[str, str]]:
        """Get git commit log."""
        result = await self.exec_command(
            workspace_id,
            user_id,
            f"git log --format='%H|%h|%s|%an|%aI' -n {limit}",
            working_dir=working_dir,
        )
        return self.compute._parse_git_log(result.get("stdout", ""))

    async def git_diff(
        self,
        workspace_id: str,
        user_id: str,
        *,
        staged: bool = False,
        working_dir: str | None = None,
    ) -> list[dict[str, Any]]:
        """Get git diff."""
        flag = "--staged" if staged else ""
        result = await self.exec_command(
            workspace_id,
            user_id,
            f"git diff {flag} --numstat",
            working_dir=working_dir,
        )
        return self.compute._parse_git_diff(result.get("stdout", ""))

    async def git_stage(
        self,
        workspace_id: str,
        user_id: str,
        files: list[str],
        working_dir: str | None = None,
    ) -> None:
        """Stage files for commit."""
        escaped_files = [self.compute._escape_shell_arg(f) for f in files]
        files_str = " ".join(escaped_files)
        await self.exec_command(
            workspace_id, user_id, f"git add -- {files_str}", working_dir=working_dir
        )

    async def git_unstage(
        self,
        workspace_id: str,
        user_id: str,
        files: list[str],
        working_dir: str | None = None,
    ) -> None:
        """Unstage files."""
        escaped_files = [self.compute._escape_shell_arg(f) for f in files]
        files_str = " ".join(escaped_files)
        await self.exec_command(
            workspace_id, user_id, f"git reset HEAD -- {files_str}", working_dir=working_dir
        )

    async def git_commit(
        self,
        workspace_id: str,
        user_id: str,
        message: str,
        working_dir: str | None = None,
    ) -> dict[str, str]:
        """Create a git commit."""
        safe_message = self.compute._escape_shell_arg(message)
        result = await self.exec_command(
            workspace_id,
            user_id,
            f"git commit -m {safe_message}",
            working_dir=working_dir,
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
        cmd = f"git push {remote}"
        if branch:
            cmd += f" {branch}"
        result = await self.exec_command(workspace_id, user_id, cmd, working_dir=working_dir)
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
        cmd = f"git pull {remote}"
        if branch:
            cmd += f" {branch}"
        result = await self.exec_command(workspace_id, user_id, cmd, working_dir=working_dir)
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
        flag = "-b" if create else ""
        result = await self.exec_command(
            workspace_id,
            user_id,
            f"git checkout {flag} {branch}",
            working_dir=working_dir,
        )
        return {"message": result.get("stdout", "") or result.get("stderr", "")}

    async def git_compare(
        self,
        workspace_id: str,
        user_id: str,
        base: str,
        compare: str,
        working_dir: str | None = None,
    ) -> dict[str, Any]:
        """Compare two branches."""
        # Delegate to compute client which handles parsing
        return await self.compute.git_compare(workspace_id, user_id, base, compare, working_dir)

    async def git_merge_preview(
        self,
        workspace_id: str,
        user_id: str,
        source_branch: str,
        target_branch: str,
        working_dir: str | None = None,
    ) -> dict[str, Any]:
        """Preview a merge operation."""
        # Delegate to compute client which handles the complex merge preview logic
        return await self.compute.git_merge_preview(
            workspace_id, user_id, source_branch, target_branch, working_dir
        )


# Singleton instance
workspace_router = WorkspaceRouter()
