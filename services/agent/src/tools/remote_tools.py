"""Remote tools for workspace operations via compute service.

These tools execute operations on the actual workspace container via HTTP calls
to the compute service, rather than operating on the local filesystem.

This module provides the same interface as file_tools.py, command_tools.py,
and git_tools.py, but routes all operations through the compute service.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

import httpx
import structlog

if TYPE_CHECKING:
    from src.compute_client import ComputeClient

logger = structlog.get_logger()


def _normalize_path(path: str) -> str:
    """Normalize a path by stripping leading slashes.

    This handles the common LLM mistake of passing absolute paths like "/README.md"
    instead of relative paths like "README.md".
    """
    return path.lstrip("/")


# =============================================================================
# File Operations
# =============================================================================


async def read_file(client: ComputeClient, path: str) -> dict[str, Any]:
    """Read a file from the workspace container.

    Args:
        client: ComputeClient instance.
        path: Relative path to the file within the workspace.

    Returns:
        Dictionary with content or error.
    """
    path = _normalize_path(path)
    return await client.read_file(path)


async def write_file(client: ComputeClient, path: str, content: str) -> dict[str, Any]:
    """Write content to a file in the workspace container.

    Args:
        client: ComputeClient instance.
        path: Relative path to the file within the workspace.
        content: Content to write.

    Returns:
        Dictionary with success status or error.
    """
    path = _normalize_path(path)
    return await client.write_file(path, content)


async def list_directory(client: ComputeClient, path: str = ".") -> dict[str, Any]:
    """List files in a directory on the workspace container.

    Args:
        client: ComputeClient instance.
        path: Relative path to the directory.

    Returns:
        Dictionary with file listing or error.
    """
    path = _normalize_path(path) or "."
    result = await client.list_files(path)

    # Filter out common ignore patterns for consistency with local version
    if result.get("success") and result.get("entries"):
        skip_names = {"node_modules", "__pycache__", ".git", "venv", ".venv"}
        filtered = [
            e
            for e in result["entries"]
            if e.get("name") not in skip_names and not e.get("name", "").startswith(".")
        ]
        result["entries"] = filtered
        result["count"] = len(filtered)

    return result


async def search_code(
    client: ComputeClient,
    query: str,
    file_pattern: str | None = None,
    max_results: int = 50,
) -> dict[str, Any]:
    """Search for code patterns in the workspace container.

    Args:
        client: ComputeClient instance.
        query: Search query (supports regex).
        file_pattern: Optional glob pattern for files (e.g., "*.py", "*.ts").
        max_results: Maximum number of results to return.

    Returns:
        Dictionary with search results or error.
    """
    return await client.search_code(
        query=query,
        file_pattern=file_pattern,
        max_results=max_results,
    )


async def glob_files(
    client: ComputeClient,
    pattern: str,
    path: str = ".",
    include_hidden: bool = False,
) -> dict[str, Any]:
    """Find files matching a glob pattern on the workspace container.

    Args:
        client: ComputeClient instance.
        pattern: Glob pattern to match (e.g., '**/*.py', 'src/*.ts').
        path: Base directory to search from.
        include_hidden: Include hidden files.

    Returns:
        Dictionary with matching files or error.
    """
    path = _normalize_path(path) or "."
    result = await client.glob_files(pattern, path)

    # Filter hidden files if needed
    if not include_hidden and result.get("success") and result.get("files"):
        filtered = [
            f
            for f in result["files"]
            if not any(part.startswith(".") for part in f.get("path", "").split("/"))
        ]
        result["files"] = filtered
        result["count"] = len(filtered)

    return result


async def grep(
    client: ComputeClient,
    pattern: str,
    path: str = ".",
    file_pattern: str | None = None,
    ignore_case: bool = False,
    context_lines: int = 2,
    max_results: int = 100,
) -> dict[str, Any]:
    """Search for text patterns in files on the workspace container.

    Args:
        client: ComputeClient instance.
        pattern: Regex pattern to search for.
        path: File or directory to search in.
        file_pattern: Glob pattern to filter files.
        ignore_case: Case-insensitive search.
        context_lines: Number of context lines around matches.
        max_results: Maximum number of results.

    Returns:
        Dictionary with search results or error.
    """
    path = _normalize_path(path) or "."
    return await client.grep(
        pattern=pattern,
        path=path,
        file_pattern=file_pattern,
        ignore_case=ignore_case,
        context_lines=context_lines,
        max_results=max_results,
    )


async def apply_patch(
    client: ComputeClient,
    path: str,
    patch: str,
    reverse: bool = False,
) -> dict[str, Any]:
    """Apply a unified diff patch to a file on the workspace container.

    Args:
        client: ComputeClient instance.
        path: File path to apply patch to.
        patch: Unified diff patch content.
        reverse: Reverse the patch (undo changes).

    Returns:
        Dictionary with success status or error.
    """
    path = _normalize_path(path)

    # Read the original file
    read_result = await client.read_file(path)

    if not read_result.get("success"):
        # File doesn't exist - check if patch creates it
        if "File not found" in read_result.get("error", ""):
            original_content = ""
        else:
            return read_result
    else:
        original_content = read_result.get("content", "")

    # Apply patch locally (same logic as file_tools.py)
    original_lines = original_content.splitlines(keepends=True)
    if original_lines and not original_lines[-1].endswith("\n"):
        original_lines[-1] += "\n"

    patch_lines = patch.splitlines(keepends=True)
    if patch_lines and not patch_lines[-1].endswith("\n"):
        patch_lines[-1] += "\n"

    result_lines = list(original_lines)
    current_line = 0

    for patch_line in patch_lines:
        if patch_line.startswith("@@"):
            match = re.match(r"@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@", patch_line)
            if match:
                group_idx = 2 if reverse else 1
                current_line = int(match.group(group_idx)) - 1
        elif patch_line.startswith("-") and not patch_line.startswith("---"):
            if reverse:
                line_content = patch_line[1:]
                if current_line <= len(result_lines):
                    result_lines.insert(current_line, line_content)
                    current_line += 1
            elif current_line < len(result_lines):
                if result_lines[current_line].rstrip() == patch_line[1:].rstrip():
                    result_lines.pop(current_line)
        elif patch_line.startswith("+") and not patch_line.startswith("+++"):
            if reverse:
                if current_line < len(result_lines):
                    if result_lines[current_line].rstrip() == patch_line[1:].rstrip():
                        result_lines.pop(current_line)
            else:
                line_content = patch_line[1:]
                if current_line <= len(result_lines):
                    result_lines.insert(current_line, line_content)
                    current_line += 1
        elif patch_line.startswith(" "):
            current_line += 1

    # Write the patched content
    new_content = "".join(result_lines)
    write_result = await client.write_file(path, new_content)

    if not write_result.get("success"):
        return write_result

    logger.info("Patch applied remotely", path=path, reverse=reverse)
    return {
        "success": True,
        "path": path,
        "message": f"Patch {'reversed' if reverse else 'applied'} successfully",
    }


async def fetch_url(
    url: str,
    extract_text: bool = True,
    max_length: int = 50000,
) -> dict[str, Any]:
    """Fetch content from a URL.

    Note: This doesn't need to run on the workspace container since
    it's just fetching external URLs.

    Args:
        url: URL to fetch.
        extract_text: Extract and clean text content.
        max_length: Maximum content length.

    Returns:
        Dictionary with fetched content or error.
    """
    try:
        if not url.startswith(("http://", "https://")):
            return {"success": False, "error": "URL must start with http:// or https://"}

        async with httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=True,
            headers={"User-Agent": "Podex-Agent/1.0"},
        ) as http_client:
            response = await http_client.get(url)
            response.raise_for_status()

        content = response.text
        content_type = response.headers.get("content-type", "")

        if extract_text and "text/html" in content_type:
            content = re.sub(
                r"<script[^>]*>.*?</script>", "", content, flags=re.DOTALL | re.IGNORECASE
            )
            content = re.sub(
                r"<style[^>]*>.*?</style>", "", content, flags=re.DOTALL | re.IGNORECASE
            )
            content = re.sub(r"<[^>]+>", " ", content)
            content = re.sub(r"\s+", " ", content).strip()
            content = content.replace("&nbsp;", " ")
            content = content.replace("&amp;", "&")
            content = content.replace("&lt;", "<")
            content = content.replace("&gt;", ">")
            content = content.replace("&quot;", '"')

        truncated = False
        if len(content) > max_length:
            content = content[:max_length]
            truncated = True

        logger.info("URL fetched", url=url, size=len(content))
        return {
            "success": True,
            "url": url,
            "content": content,
            "content_type": content_type,
            "size": len(content),
            "truncated": truncated,
        }

    except httpx.HTTPStatusError as e:
        return {"success": False, "error": f"HTTP error: {e.response.status_code}"}
    except httpx.ConnectError:
        return {"success": False, "error": "Failed to connect to URL"}
    except httpx.TimeoutException:
        return {"success": False, "error": "Request timed out"}
    except Exception as e:
        logger.error("Failed to fetch URL", url=url, error=str(e))
        return {"success": False, "error": str(e)}


# =============================================================================
# Command Execution
# =============================================================================


async def run_command(
    client: ComputeClient,
    command: str,
    cwd: str | None = None,
    timeout: int = 60,
) -> dict[str, Any]:
    """Run a shell command in the workspace container.

    Args:
        client: ComputeClient instance.
        command: Command to execute.
        cwd: Working directory relative to workspace.
        timeout: Command timeout in seconds.

    Returns:
        Dictionary with command output or error.
    """
    # Note: Command validation and allowlist checking should be done
    # by the executor before calling this function
    return await client.exec_command(command, working_dir=cwd, timeout=timeout)


# =============================================================================
# Git Operations
# =============================================================================


async def git_status(client: ComputeClient) -> dict[str, Any]:
    """Get git status for the workspace.

    Args:
        client: ComputeClient instance.

    Returns:
        Dictionary with git status info.
    """
    success, stdout, stderr = await client.git_command(["status", "--porcelain", "-b"])

    if not success:
        return {"success": False, "error": stderr or "Failed to get git status"}

    lines = stdout.strip().split("\n")
    branch = None
    changes = []

    for line in lines:
        if line.startswith("##"):
            branch_match = re.match(r"## (\S+)", line)
            if branch_match:
                branch = branch_match.group(1)
        elif line:
            status = line[:2]
            filename = line[3:]
            changes.append({"status": status, "file": filename})

    return {
        "success": True,
        "branch": branch,
        "changes": changes,
        "has_changes": len(changes) > 0,
    }


async def git_commit(
    client: ComputeClient,
    message: str,
    files: list[str] | None = None,
    all_changes: bool = False,
) -> dict[str, Any]:
    """Stage files and create a commit.

    Args:
        client: ComputeClient instance.
        message: Commit message.
        files: Specific files to stage.
        all_changes: Stage all changes if True.

    Returns:
        Dictionary with commit info or error.
    """
    if not message or len(message.strip()) < 3:
        return {"success": False, "error": "Commit message must be at least 3 characters"}

    # Stage files
    if files:
        success, _, stderr = await client.git_command(["add", *files])
    elif all_changes:
        success, _, stderr = await client.git_command(["add", "-A"])
    else:
        success, _, stderr = await client.git_command(["add", "-u"])

    if not success:
        return {"success": False, "error": f"Failed to stage files: {stderr}"}

    # Create commit
    success, stdout, stderr = await client.git_command(["commit", "-m", message])

    if not success:
        error_msg = "Nothing to commit" if "nothing to commit" in stderr + stdout else stderr
        return {"success": False, "error": error_msg}

    # Get commit hash
    success, hash_out, _ = await client.git_command(["rev-parse", "HEAD"])
    commit_hash = hash_out.strip() if success else None

    logger.info("Git commit created", commit_hash=commit_hash, message=message[:50])

    return {
        "success": True,
        "commit_hash": commit_hash,
        "message": message,
        "output": stdout,
    }


async def git_push(
    client: ComputeClient,
    remote: str = "origin",
    branch: str | None = None,
    force: bool = False,
    set_upstream: bool = False,
) -> dict[str, Any]:
    """Push commits to remote repository.

    Args:
        client: ComputeClient instance.
        remote: Remote name.
        branch: Branch to push.
        force: Force push.
        set_upstream: Set upstream tracking.

    Returns:
        Dictionary with push result or error.
    """
    if not branch:
        success, stdout, _ = await client.git_command(["branch", "--show-current"])
        branch = stdout.strip() if success else "main"

    args = ["push"]
    if set_upstream:
        args.extend(["-u", remote, branch])
    else:
        args.extend([remote, branch])

    if force:
        args.insert(1, "--force-with-lease")

    success, stdout, stderr = await client.git_command(args, timeout=120)

    if not success:
        return {"success": False, "error": stderr}

    logger.info("Git push completed", remote=remote, branch=branch, force=force)

    return {
        "success": True,
        "remote": remote,
        "branch": branch,
        "output": stdout or stderr,
    }


async def git_branch(
    client: ComputeClient,
    action: str,
    name: str | None = None,
) -> dict[str, Any]:
    """Create, switch, list, or delete branches.

    Args:
        client: ComputeClient instance.
        action: Action to perform (create, switch, list, delete).
        name: Branch name.

    Returns:
        Dictionary with result or error.
    """
    if action == "list":
        success, stdout, stderr = await client.git_command(["branch", "-a"])
        if not success:
            return {"success": False, "error": stderr}

        branches = []
        current = None
        for raw_line in stdout.strip().split("\n"):
            cleaned_line = raw_line.strip()
            if cleaned_line.startswith("*"):
                current = cleaned_line[2:]
                branches.append(current)
            elif cleaned_line:
                branches.append(cleaned_line)

        return {"success": True, "branches": branches, "current": current}

    if not name:
        return {"success": False, "error": "Branch name required"}

    if action == "create":
        success, _, stderr = await client.git_command(["checkout", "-b", name])
        if not success:
            return {"success": False, "error": stderr}
        return {"success": True, "action": "created", "branch": name}

    if action == "switch":
        success, _, stderr = await client.git_command(["checkout", name])
        if not success:
            return {"success": False, "error": stderr}
        return {"success": True, "action": "switched", "branch": name}

    if action == "delete":
        if name in ("main", "master"):
            return {"success": False, "error": "Cannot delete main/master branch"}
        success, _, stderr = await client.git_command(["branch", "-d", name])
        if not success:
            return {"success": False, "error": stderr}
        return {"success": True, "action": "deleted", "branch": name}

    return {"success": False, "error": f"Unknown action: {action}"}


async def git_diff(
    client: ComputeClient,
    staged: bool = False,
    file: str | None = None,
) -> dict[str, Any]:
    """Get git diff output.

    Args:
        client: ComputeClient instance.
        staged: Show staged changes.
        file: Specific file to diff.

    Returns:
        Dictionary with diff output.
    """
    args = ["diff"]
    if staged:
        args.append("--staged")
    if file:
        args.append("--")
        args.append(file)

    success, stdout, stderr = await client.git_command(args)

    if not success:
        return {"success": False, "error": stderr}

    return {
        "success": True,
        "diff": stdout,
        "has_changes": bool(stdout.strip()),
    }


async def git_log(
    client: ComputeClient,
    limit: int = 10,
    oneline: bool = True,
) -> dict[str, Any]:
    """Get git log.

    Args:
        client: ComputeClient instance.
        limit: Number of commits to show.
        oneline: Use oneline format.

    Returns:
        Dictionary with log output.
    """
    args = ["log", f"-{limit}"]
    if oneline:
        args.append("--oneline")

    success, stdout, stderr = await client.git_command(args)

    if not success:
        return {"success": False, "error": stderr}

    commits: list[dict[str, str]] = []
    for line in stdout.strip().split("\n"):
        if line:
            if oneline:
                parts = line.split(" ", 1)
                commits.append(
                    {
                        "hash": parts[0],
                        "message": parts[1] if len(parts) > 1 else "",
                    }
                )
            else:
                commits.append({"raw": line})

    return {"success": True, "commits": commits}


async def create_pr(
    client: ComputeClient,
    title: str,
    body: str = "",
    base: str = "main",
    draft: bool = False,
) -> dict[str, Any]:
    """Create a pull request using GitHub CLI.

    Args:
        client: ComputeClient instance.
        title: PR title.
        body: PR body/description.
        base: Base branch.
        draft: Create as draft PR.

    Returns:
        Dictionary with PR info or error.
    """
    # Build gh command
    cmd_parts = ["gh", "pr", "create", "--title", f'"{title}"', "--base", base]

    if body:
        # Escape body for shell
        escaped_body = body.replace('"', '\\"').replace("$", "\\$")
        cmd_parts.extend(["--body", f'"{escaped_body}"'])
    else:
        cmd_parts.append("--body-file=-")

    if draft:
        cmd_parts.append("--draft")

    cmd = " ".join(cmd_parts)

    # Execute via compute client
    if not body:
        # Need to pipe empty input
        cmd = f'echo "" | {cmd}'

    result = await client.exec_command(cmd, timeout=60)

    if not result.get("success"):
        error = result.get("stderr") or result.get("error") or "Failed to create PR"
        if "gh: command not found" in error:
            return {"success": False, "error": "GitHub CLI (gh) not installed"}
        return {"success": False, "error": error}

    pr_url = result.get("stdout", "").strip()

    logger.info("Pull request created", title=title, url=pr_url)

    return {
        "success": True,
        "title": title,
        "url": pr_url,
        "base": base,
        "draft": draft,
    }
