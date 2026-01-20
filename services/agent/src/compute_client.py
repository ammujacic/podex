"""Compute service client for remote workspace operations.

This client provides a bridge between the agent service and workspace containers
via the compute service HTTP API. All file operations, command execution, and
git operations should go through this client to execute on the actual workspace
container rather than the agent's local filesystem.
"""

from __future__ import annotations

from typing import Any

import httpx
import structlog

from src.config import settings

logger = structlog.get_logger()

# Default timeout for compute service requests
DEFAULT_TIMEOUT = 30.0
EXEC_TIMEOUT = 120.0  # Longer timeout for command execution


class ComputeClientError(Exception):
    """Error from compute service operations."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class ComputeClient:
    """Client for compute service workspace operations.

    This client wraps HTTP calls to the compute service to perform
    file operations and command execution on workspace containers.

    All agent tools that need to access workspace files or run commands
    should use this client instead of local filesystem operations.
    """

    def __init__(
        self,
        workspace_id: str,
        user_id: str,
        base_url: str | None = None,
        auth_token: str | None = None,
    ) -> None:
        """Initialize compute client.

        Args:
            workspace_id: The workspace container ID.
            user_id: The user ID for authorization.
            base_url: Compute service URL (defaults to settings).
            auth_token: Authorization token (defaults to internal service token).
        """
        self.workspace_id = workspace_id
        self.user_id = user_id
        self.base_url = (base_url or settings.COMPUTE_SERVICE_URL).rstrip("/")
        # Use COMPUTE_INTERNAL_API_KEY for compute service authentication
        self.auth_token = auth_token or settings.COMPUTE_INTERNAL_API_KEY

    def _get_headers(self) -> dict[str, str]:
        """Get HTTP headers for compute service requests."""
        headers = {
            "Content-Type": "application/json",
            "X-User-ID": self.user_id,
        }
        if self.auth_token:
            # Compute service expects X-Internal-API-Key header
            headers["X-Internal-API-Key"] = self.auth_token
        return headers

    async def read_file(self, path: str) -> dict[str, Any]:
        """Read a file from the workspace container.

        Args:
            path: File path relative to workspace root.

        Returns:
            Dictionary with content or error.
        """
        try:
            async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
                response = await client.get(
                    f"{self.base_url}/workspaces/{self.workspace_id}/files/content",
                    params={"path": path},
                    headers=self._get_headers(),
                )

                if response.status_code == 404:
                    return {"success": False, "error": f"File not found: {path}"}
                if response.status_code == 403:
                    return {"success": False, "error": f"Permission denied: {path}"}

                response.raise_for_status()
                data = response.json()

                logger.info(
                    "File read from workspace",
                    workspace_id=self.workspace_id,
                    path=path,
                    size=len(data.get("content", "")),
                )

                return {
                    "success": True,
                    "content": data["content"],
                    "path": path,
                    "size": len(data["content"]),
                }

        except httpx.HTTPStatusError as e:
            logger.error(
                "Failed to read file",
                workspace_id=self.workspace_id,
                path=path,
                status=e.response.status_code,
            )
            return {"success": False, "error": f"HTTP error: {e.response.status_code}"}
        except httpx.TimeoutException:
            return {"success": False, "error": "Request timed out"}
        except Exception as e:
            logger.error(
                "Failed to read file",
                workspace_id=self.workspace_id,
                path=path,
                error=str(e),
            )
            return {"success": False, "error": str(e)}

    async def write_file(self, path: str, content: str) -> dict[str, Any]:
        """Write a file to the workspace container.

        Args:
            path: File path relative to workspace root.
            content: File content to write.

        Returns:
            Dictionary with success status or error.
        """
        try:
            async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
                response = await client.put(
                    f"{self.base_url}/workspaces/{self.workspace_id}/files/content",
                    json={"path": path, "content": content},
                    headers=self._get_headers(),
                )

                if response.status_code == 403:
                    return {"success": False, "error": f"Permission denied: {path}"}

                response.raise_for_status()

                logger.info(
                    "File written to workspace",
                    workspace_id=self.workspace_id,
                    path=path,
                    size=len(content),
                )

                return {
                    "success": True,
                    "path": path,
                    "size": len(content),
                    "message": f"Successfully wrote {len(content)} bytes to {path}",
                }

        except httpx.HTTPStatusError as e:
            logger.error(
                "Failed to write file",
                workspace_id=self.workspace_id,
                path=path,
                status=e.response.status_code,
            )
            return {"success": False, "error": f"HTTP error: {e.response.status_code}"}
        except httpx.TimeoutException:
            return {"success": False, "error": "Request timed out"}
        except Exception as e:
            logger.error(
                "Failed to write file",
                workspace_id=self.workspace_id,
                path=path,
                error=str(e),
            )
            return {"success": False, "error": str(e)}

    async def list_files(self, path: str = ".") -> dict[str, Any]:
        """List files in a workspace directory.

        Args:
            path: Directory path relative to workspace root.

        Returns:
            Dictionary with file listing or error.
        """
        try:
            async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
                response = await client.get(
                    f"{self.base_url}/workspaces/{self.workspace_id}/files",
                    params={"path": path},
                    headers=self._get_headers(),
                )

                if response.status_code == 404:
                    return {"success": False, "error": f"Directory not found: {path}"}

                response.raise_for_status()
                entries = response.json()

                logger.info(
                    "Directory listed",
                    workspace_id=self.workspace_id,
                    path=path,
                    count=len(entries),
                )

                return {
                    "success": True,
                    "path": path,
                    "entries": entries,
                    "count": len(entries),
                }

        except httpx.HTTPStatusError as e:
            return {"success": False, "error": f"HTTP error: {e.response.status_code}"}
        except httpx.TimeoutException:
            return {"success": False, "error": "Request timed out"}
        except Exception as e:
            logger.error(
                "Failed to list files",
                workspace_id=self.workspace_id,
                path=path,
                error=str(e),
            )
            return {"success": False, "error": str(e)}

    async def exec_command(
        self,
        command: str,
        working_dir: str | None = None,
        timeout: int = 60,
    ) -> dict[str, Any]:
        """Execute a command in the workspace container.

        Args:
            command: Shell command to execute.
            working_dir: Working directory (default: /home/dev).
            timeout: Command timeout in seconds.

        Returns:
            Dictionary with command output or error.
        """
        try:
            async with httpx.AsyncClient(timeout=EXEC_TIMEOUT) as client:
                response = await client.post(
                    f"{self.base_url}/workspaces/{self.workspace_id}/exec",
                    json={
                        "command": command,
                        "working_dir": working_dir,
                        "timeout": timeout,
                    },
                    headers=self._get_headers(),
                )

                if response.status_code == 404:
                    return {"success": False, "error": "Workspace not found"}

                response.raise_for_status()
                result = response.json()

                logger.info(
                    "Command executed",
                    workspace_id=self.workspace_id,
                    command=command[:50] + "..." if len(command) > 50 else command,
                    exit_code=result.get("exit_code"),
                )

                return {
                    "success": result.get("exit_code") == 0,
                    "exit_code": result.get("exit_code"),
                    "stdout": result.get("stdout", ""),
                    "stderr": result.get("stderr", ""),
                    "command": command,
                    "error": result.get("stderr") if result.get("exit_code") != 0 else None,
                }

        except httpx.HTTPStatusError as e:
            logger.error(
                "Failed to execute command",
                workspace_id=self.workspace_id,
                command=command,
                status=e.response.status_code,
            )
            return {"success": False, "error": f"HTTP error: {e.response.status_code}"}
        except httpx.TimeoutException:
            return {"success": False, "error": f"Command timed out after {timeout} seconds"}
        except Exception as e:
            logger.error(
                "Failed to execute command",
                workspace_id=self.workspace_id,
                command=command,
                error=str(e),
            )
            return {"success": False, "error": str(e)}

    async def glob_files(
        self,
        pattern: str,
        path: str = ".",
    ) -> dict[str, Any]:
        """Find files matching a glob pattern using shell command.

        Args:
            pattern: Glob pattern to match.
            path: Base directory to search from.

        Returns:
            Dictionary with matching files or error.
        """
        # Use find command for glob-like behavior
        # Escape special characters in pattern for find
        cmd = f"find {path} -type f -name '{pattern}' 2>/dev/null | head -500"
        result = await self.exec_command(cmd, timeout=30)

        if not result["success"] and "error" in result:
            return result

        files = []
        stdout = result.get("stdout", "")
        for line in stdout.strip().split("\n"):
            if line:
                files.append({"path": line, "name": line.split("/")[-1]})

        return {
            "success": True,
            "pattern": pattern,
            "base_path": path,
            "files": files,
            "count": len(files),
            "truncated": len(files) >= 500,
        }

    async def grep(
        self,
        pattern: str,
        path: str = ".",
        file_pattern: str | None = None,
        ignore_case: bool = False,
        context_lines: int = 2,
        max_results: int = 100,
    ) -> dict[str, Any]:
        """Search for text patterns in files using grep.

        Args:
            pattern: Regex pattern to search for.
            path: File or directory to search in.
            file_pattern: Glob pattern to filter files.
            ignore_case: Case-insensitive search.
            context_lines: Number of context lines around matches.
            max_results: Maximum number of results.

        Returns:
            Dictionary with search results or error.
        """
        # Build grep command
        flags = ["-r", "-n"]  # Recursive, line numbers
        if ignore_case:
            flags.append("-i")
        if context_lines > 0:
            flags.append(f"-C{context_lines}")

        flags_str = " ".join(flags)

        # Handle file pattern filter
        if file_pattern:
            cmd = (
                f"grep {flags_str} --include='{file_pattern}' '{pattern}' {path} "
                f"2>/dev/null | head -{max_results}"
            )
        else:
            cmd = f"grep {flags_str} '{pattern}' {path} 2>/dev/null | head -{max_results}"

        result = await self.exec_command(cmd, timeout=30)

        # grep returns exit code 1 when no matches found, which is not an error
        stdout = result.get("stdout", "")
        results = []

        for line in stdout.strip().split("\n"):
            if line and ":" in line:
                # Parse grep output: file:line:content
                parts = line.split(":", 2)
                if len(parts) >= 3:
                    results.append(
                        {
                            "file": parts[0],
                            "line": int(parts[1]) if parts[1].isdigit() else 0,
                            "match": parts[2].strip()[:200],
                        }
                    )
                elif len(parts) == 2:
                    results.append(
                        {
                            "file": parts[0],
                            "line": 0,
                            "match": parts[1].strip()[:200],
                        }
                    )

        return {
            "success": True,
            "pattern": pattern,
            "results": results,
            "count": len(results),
            "truncated": len(results) >= max_results,
        }

    async def search_code(
        self,
        query: str,
        file_pattern: str | None = None,
        max_results: int = 50,
    ) -> dict[str, Any]:
        """Search for code patterns in the workspace.

        Args:
            query: Search query (regex).
            file_pattern: Glob pattern for files.
            max_results: Maximum results.

        Returns:
            Dictionary with search results or error.
        """
        return await self.grep(
            pattern=query,
            path=".",
            file_pattern=file_pattern,
            ignore_case=True,
            context_lines=0,
            max_results=max_results,
        )

    async def git_command(
        self,
        args: list[str],
        timeout: int = 60,
    ) -> tuple[bool, str, str]:
        """Run a git command in the workspace.

        Args:
            args: Git command arguments.
            timeout: Command timeout.

        Returns:
            Tuple of (success, stdout, stderr).
        """
        cmd = "git " + " ".join(args)
        result = await self.exec_command(cmd, timeout=timeout)

        return (
            result.get("success", False),
            result.get("stdout", ""),
            result.get("stderr", ""),
        )

    async def health_check(self) -> bool:
        """Check if workspace is accessible.

        Returns:
            True if workspace is reachable.
        """
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.base_url}/workspaces/{self.workspace_id}",
                    headers=self._get_headers(),
                )
                return response.status_code == 200
        except Exception:
            return False


# Singleton client cache per workspace
_client_cache: dict[str, ComputeClient] = {}


def get_compute_client(
    workspace_id: str,
    user_id: str,
    base_url: str | None = None,
    auth_token: str | None = None,
) -> ComputeClient:
    """Get or create a compute client for a workspace.

    Args:
        workspace_id: The workspace container ID.
        user_id: The user ID for authorization.
        base_url: Compute service URL.
        auth_token: Authorization token.

    Returns:
        ComputeClient instance.
    """
    cache_key = f"{workspace_id}:{user_id}"
    if cache_key not in _client_cache:
        _client_cache[cache_key] = ComputeClient(
            workspace_id=workspace_id,
            user_id=user_id,
            base_url=base_url,
            auth_token=auth_token,
        )
    return _client_cache[cache_key]


def clear_client_cache() -> None:
    """Clear the client cache."""
    _client_cache.clear()
