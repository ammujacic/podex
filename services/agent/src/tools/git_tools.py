"""Git tools for version control operations."""

import asyncio
import os
import re
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger()

# Commit message validation
MIN_COMMIT_MESSAGE_LENGTH = 3

# Git subcommands that are allowed
ALLOWED_GIT_WRITE_COMMANDS = {
    "add",
    "commit",
    "push",
    "pull",
    "checkout",
    "switch",
    "branch",
    "merge",
    "stash",
    "reset",
    "fetch",
    "rebase",
}

# Dangerous git operations that require confirmation
DANGEROUS_OPERATIONS = {
    "push --force",
    "push -f",
    "reset --hard",
    "rebase",
    "merge",
}


async def _run_git_command(
    workspace_path: Path,
    args: list[str],
    timeout: int = 60,
) -> tuple[bool, str, str]:
    """Run a git command in the workspace.

    Args:
        workspace_path: Workspace directory
        args: Git command arguments
        timeout: Command timeout in seconds

    Returns:
        Tuple of (success, stdout, stderr)
    """
    cmd = ["git", *args]

    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=workspace_path,
            env={
                **os.environ,
                "GIT_TERMINAL_PROMPT": "0",  # Disable prompts
            },
        )

        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)

        stdout_str = stdout.decode("utf-8", errors="replace")
        stderr_str = stderr.decode("utf-8", errors="replace")

        return process.returncode == 0, stdout_str, stderr_str

    except TimeoutError:
        return False, "", f"Git command timed out after {timeout} seconds"
    except Exception as e:
        return False, "", str(e)


async def git_status(workspace_path: Path) -> dict[str, Any]:
    """Get git status for the workspace.

    Args:
        workspace_path: Workspace directory

    Returns:
        Dictionary with git status info
    """
    try:
        success, stdout, stderr = await _run_git_command(
            workspace_path,
            ["status", "--porcelain", "-b"],
        )

        if not success:
            return {"success": False, "error": stderr or "Failed to get git status"}

        # Parse status
        lines = stdout.strip().split("\n")
        branch = None
        changes = []

        for line in lines:
            if line.startswith("##"):
                # Branch info
                branch_match = re.match(r"## (\S+)", line)
                if branch_match:
                    branch = branch_match.group(1)
            elif line:
                # File change
                status = line[:2]
                filename = line[3:]
                changes.append({"status": status, "file": filename})

        return {
            "success": True,
            "branch": branch,
            "changes": changes,
            "has_changes": len(changes) > 0,
        }

    except Exception as e:
        logger.error("Git status failed", error=str(e))
        return {"success": False, "error": str(e)}


def _validate_commit_files(workspace_path: Path, files: list[str]) -> str | None:
    """Validate files for commit are within workspace.

    Args:
        workspace_path: Workspace directory.
        files: List of file paths to validate.

    Returns:
        Error message if validation fails, None if valid.
    """
    resolved_workspace = str(workspace_path.resolve())
    for file in files:
        file_path = (workspace_path / file).resolve()
        if not str(file_path).startswith(resolved_workspace):
            return f"Invalid file path: {file}"
    return None


async def _stage_files(
    workspace_path: Path,
    files: list[str] | None,
    all_changes: bool,
) -> tuple[bool, str]:
    """Stage files for commit.

    Returns:
        Tuple of (success, error_message).
    """
    if files:
        success, _, stderr = await _run_git_command(workspace_path, ["add", *files])
    elif all_changes:
        success, _, stderr = await _run_git_command(workspace_path, ["add", "-A"])
    else:
        success, _, stderr = await _run_git_command(workspace_path, ["add", "-u"])

    if not success:
        return False, f"Failed to stage files: {stderr}"
    return True, ""


async def git_commit(
    workspace_path: Path,
    message: str,
    files: list[str] | None = None,
    all_changes: bool = False,
) -> dict[str, Any]:
    """Stage files and create a commit.

    Args:
        workspace_path: Workspace directory
        message: Commit message
        files: Specific files to stage (optional)
        all_changes: Stage all changes if True

    Returns:
        Dictionary with commit info or error
    """
    try:
        # Validate message
        if not message or len(message.strip()) < MIN_COMMIT_MESSAGE_LENGTH:
            return {"success": False, "error": "Commit message must be at least 3 characters"}

        # Validate file paths if specified
        if files:
            error = _validate_commit_files(workspace_path, files)
            if error:
                return {"success": False, "error": error}

        # Stage files
        success, stage_error = await _stage_files(workspace_path, files, all_changes)
        if not success:
            return {"success": False, "error": stage_error}

        # Create commit
        success, stdout, stderr = await _run_git_command(workspace_path, ["commit", "-m", message])

        if not success:
            error_msg = "Nothing to commit" if "nothing to commit" in stderr + stdout else stderr
            return {"success": False, "error": error_msg}

        # Get commit hash
        success, hash_out, _ = await _run_git_command(workspace_path, ["rev-parse", "HEAD"])
        commit_hash = hash_out.strip() if success else None

        logger.info(
            "Git commit created",
            commit_hash=commit_hash,
            message=message[:50],
        )

        return {
            "success": True,
            "commit_hash": commit_hash,
            "message": message,
            "output": stdout,
        }

    except Exception as e:
        logger.error("Git commit failed", error=str(e))
        return {"success": False, "error": str(e)}


async def git_push(
    workspace_path: Path,
    remote: str = "origin",
    branch: str | None = None,
    force: bool = False,
    set_upstream: bool = False,
) -> dict[str, Any]:
    """Push commits to remote repository.

    Args:
        workspace_path: Workspace directory
        remote: Remote name (default: origin)
        branch: Branch to push (default: current branch)
        force: Force push (use with caution)
        set_upstream: Set upstream tracking

    Returns:
        Dictionary with push result or error
    """
    try:
        # Get current branch if not specified
        if not branch:
            success, stdout, _ = await _run_git_command(
                workspace_path,
                ["branch", "--show-current"],
            )
            branch = stdout.strip() if success else "main"

        # Build push command
        args = ["push"]

        if set_upstream:
            args.extend(["-u", remote, branch])
        else:
            args.extend([remote, branch])

        if force:
            args.insert(1, "--force-with-lease")  # Safer than --force

        success, stdout, stderr = await _run_git_command(workspace_path, args, timeout=120)

        if not success:
            return {"success": False, "error": stderr}

        logger.info(
            "Git push completed",
            remote=remote,
            branch=branch,
            force=force,
        )

        return {
            "success": True,
            "remote": remote,
            "branch": branch,
            "output": stdout or stderr,
        }

    except Exception as e:
        logger.error("Git push failed", error=str(e))
        return {"success": False, "error": str(e)}


async def _git_branch_list(workspace_path: Path) -> dict[str, Any]:
    """List git branches."""
    success, stdout, stderr = await _run_git_command(workspace_path, ["branch", "-a"])

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


async def _git_branch_create(workspace_path: Path, name: str) -> dict[str, Any]:
    """Create a new git branch."""
    success, _stdout, stderr = await _run_git_command(
        workspace_path,
        ["checkout", "-b", name],
    )

    if not success:
        return {"success": False, "error": stderr}

    return {"success": True, "action": "created", "branch": name}


async def _git_branch_switch(workspace_path: Path, name: str) -> dict[str, Any]:
    """Switch to a git branch."""
    success, _stdout, stderr = await _run_git_command(workspace_path, ["checkout", name])

    if not success:
        return {"success": False, "error": stderr}

    return {"success": True, "action": "switched", "branch": name}


async def _git_branch_delete(workspace_path: Path, name: str) -> dict[str, Any]:
    """Delete a git branch."""
    # Don't allow deleting main/master
    if name in ("main", "master"):
        return {"success": False, "error": "Cannot delete main/master branch"}

    success, _stdout, stderr = await _run_git_command(workspace_path, ["branch", "-d", name])

    if not success:
        return {"success": False, "error": stderr}

    return {"success": True, "action": "deleted", "branch": name}


async def git_branch(
    workspace_path: Path,
    action: str,
    name: str | None = None,
) -> dict[str, Any]:
    """Create, switch, list, or delete branches.

    Args:
        workspace_path: Workspace directory
        action: Action to perform (create, switch, list, delete)
        name: Branch name (required for create, switch, delete)

    Returns:
        Dictionary with result or error
    """
    try:
        if action == "list":
            return await _git_branch_list(workspace_path)

        # Actions that require a name
        if not name:
            return {"success": False, "error": "Branch name required"}

        action_handlers = {
            "create": _git_branch_create,
            "switch": _git_branch_switch,
            "delete": _git_branch_delete,
        }

        handler = action_handlers.get(action)
        if handler is None:
            return {"success": False, "error": f"Unknown action: {action}"}

        return await handler(workspace_path, name)

    except Exception as e:
        logger.error("Git branch operation failed", error=str(e))
        return {"success": False, "error": str(e)}


async def git_diff(
    workspace_path: Path,
    staged: bool = False,
    file: str | None = None,
) -> dict[str, Any]:
    """Get git diff output.

    Args:
        workspace_path: Workspace directory
        staged: Show staged changes
        file: Specific file to diff

    Returns:
        Dictionary with diff output
    """
    try:
        args = ["diff"]
        if staged:
            args.append("--staged")
        if file:
            args.append("--")
            args.append(file)

        success, stdout, stderr = await _run_git_command(workspace_path, args)

        if not success:
            return {"success": False, "error": stderr}

        return {
            "success": True,
            "diff": stdout,
            "has_changes": bool(stdout.strip()),
        }

    except Exception as e:
        logger.error("Git diff failed", error=str(e))
        return {"success": False, "error": str(e)}


async def git_log(
    workspace_path: Path,
    limit: int = 10,
    oneline: bool = True,
) -> dict[str, Any]:
    """Get git log.

    Args:
        workspace_path: Workspace directory
        limit: Number of commits to show
        oneline: Use oneline format

    Returns:
        Dictionary with log output
    """
    try:
        args = ["log", f"-{limit}"]
        if oneline:
            args.append("--oneline")

        success, stdout, stderr = await _run_git_command(workspace_path, args)

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
                        },
                    )
                else:
                    commits.append({"raw": line})

        return {
            "success": True,
            "commits": commits,
        }

    except Exception as e:
        logger.error("Git log failed", error=str(e))
        return {"success": False, "error": str(e)}


async def create_pr(
    workspace_path: Path,
    title: str,
    body: str = "",
    base: str = "main",
    draft: bool = False,
) -> dict[str, Any]:
    """Create a pull request using GitHub CLI.

    Requires 'gh' CLI to be installed and authenticated.

    Args:
        workspace_path: Workspace directory
        title: PR title
        body: PR body/description
        base: Base branch (default: main)
        draft: Create as draft PR

    Returns:
        Dictionary with PR info or error
    """
    try:
        args = ["pr", "create", "--title", title, "--base", base]

        if body:
            args.extend(["--body", body])
        else:
            args.append("--body-file=-")  # Empty body

        if draft:
            args.append("--draft")

        # Use gh CLI
        process = await asyncio.create_subprocess_exec(
            "gh",
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=workspace_path,
            stdin=asyncio.subprocess.PIPE if not body else None,
        )

        if not body:
            stdout, stderr = await asyncio.wait_for(process.communicate(input=b""), timeout=60)
        else:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=60)

        stdout_str = stdout.decode("utf-8", errors="replace")
        stderr_str = stderr.decode("utf-8", errors="replace")

        if process.returncode != 0:
            return {"success": False, "error": stderr_str or "Failed to create PR"}

        # Extract PR URL from output
        pr_url = stdout_str.strip()

        logger.info(
            "Pull request created",
            title=title,
            url=pr_url,
        )

        return {
            "success": True,
            "title": title,
            "url": pr_url,
            "base": base,
            "draft": draft,
        }

    except FileNotFoundError:
        return {"success": False, "error": "GitHub CLI (gh) not installed"}
    except Exception as e:
        logger.error("Create PR failed", error=str(e))
        return {"success": False, "error": str(e)}


# Tool definitions for agent use
GIT_TOOLS = [
    {
        "name": "git_status",
        "description": "Get the current git status showing modified, staged, and untracked files",
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "git_commit",
        "description": "Stage files and create a git commit",
        "parameters": {
            "type": "object",
            "properties": {
                "message": {
                    "type": "string",
                    "description": "Commit message describing the changes",
                },
                "files": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Specific files to stage (optional, stages modified files by default)"
                    ),
                },
                "all_changes": {
                    "type": "boolean",
                    "description": "Stage all changes including untracked files",
                    "default": False,
                },
            },
            "required": ["message"],
        },
    },
    {
        "name": "git_push",
        "description": "Push commits to the remote repository",
        "parameters": {
            "type": "object",
            "properties": {
                "remote": {
                    "type": "string",
                    "description": "Remote name",
                    "default": "origin",
                },
                "branch": {
                    "type": "string",
                    "description": "Branch to push (defaults to current branch)",
                },
                "force": {
                    "type": "boolean",
                    "description": "Force push (use with caution)",
                    "default": False,
                },
                "set_upstream": {
                    "type": "boolean",
                    "description": "Set upstream tracking",
                    "default": False,
                },
            },
        },
    },
    {
        "name": "git_branch",
        "description": "Create, switch, list, or delete git branches",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["create", "switch", "list", "delete"],
                    "description": "Branch action to perform",
                },
                "name": {
                    "type": "string",
                    "description": "Branch name (required for create, switch, delete)",
                },
            },
            "required": ["action"],
        },
    },
    {
        "name": "git_diff",
        "description": "Show changes between commits, working tree, etc.",
        "parameters": {
            "type": "object",
            "properties": {
                "staged": {
                    "type": "boolean",
                    "description": "Show only staged changes",
                    "default": False,
                },
                "file": {
                    "type": "string",
                    "description": "Specific file to diff",
                },
            },
        },
    },
    {
        "name": "git_log",
        "description": "Show commit history",
        "parameters": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Number of commits to show",
                    "default": 10,
                },
            },
        },
    },
    {
        "name": "create_pr",
        "description": "Create a GitHub pull request for the current branch",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Pull request title",
                },
                "body": {
                    "type": "string",
                    "description": "Pull request description",
                },
                "base": {
                    "type": "string",
                    "description": "Base branch to merge into",
                    "default": "main",
                },
                "draft": {
                    "type": "boolean",
                    "description": "Create as draft PR",
                    "default": False,
                },
            },
            "required": ["title"],
        },
    },
]
