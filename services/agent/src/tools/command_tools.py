"""Command execution tools for agents."""

import asyncio
import shlex
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger()

# Commands that are allowed to be executed
ALLOWED_COMMANDS = {
    # Package managers
    "npm",
    "pnpm",
    "yarn",
    "pip",
    "uv",
    "poetry",
    # Build tools
    "make",
    "cargo",
    "go",
    # Testing
    "pytest",
    "jest",
    "vitest",
    "mocha",
    # Linting/Formatting
    "eslint",
    "prettier",
    "ruff",
    "black",
    "mypy",
    # Git (read-only operations)
    "git",
    # Utilities
    "ls",
    "cat",
    "head",
    "tail",
    "grep",
    "find",
    "wc",
    "echo",
    "pwd",
    "which",
    "env",
    # Language runtimes
    "node",
    "python",
    "python3",
    "ruby",
    "java",
    "javac",
}

# Git subcommands that are allowed
ALLOWED_GIT_SUBCOMMANDS = {
    "status",
    "diff",
    "log",
    "show",
    "branch",
    "tag",
    "remote",
    "fetch",
    "ls-files",
    "ls-tree",
    "rev-parse",
    "describe",
    "blame",
    "shortlog",
}

# Commands that are explicitly blocked
BLOCKED_COMMANDS = {
    "rm",
    "rmdir",
    "mv",
    "cp",
    "chmod",
    "chown",
    "sudo",
    "su",
    "kill",
    "pkill",
    "killall",
    "dd",
    "mkfs",
    "fdisk",
    "mount",
    "umount",
    "shutdown",
    "reboot",
    "systemctl",
    "service",
    "curl",
    "wget",
    "ssh",
    "scp",
    "rsync",
    "nc",
    "netcat",
    "nmap",
    "telnet",
}


def _parse_command(command: str) -> tuple[list[str] | None, str]:
    """Parse and extract command parts.

    Args:
        command: The command string to parse.

    Returns:
        Tuple of (parts list or None, error_message).
    """
    try:
        parts = shlex.split(command)
    except ValueError as e:
        return None, f"Invalid command syntax: {e}"

    if not parts:
        return None, "Empty command"

    return parts, ""


def _check_base_command(base_command: str) -> tuple[bool, str]:
    """Check if base command is allowed.

    Args:
        base_command: The base command name.

    Returns:
        Tuple of (is_valid, error_message).
    """
    if base_command in BLOCKED_COMMANDS:
        return False, f"Command not allowed: {base_command}"
    if base_command not in ALLOWED_COMMANDS:
        return False, f"Command not in allowlist: {base_command}"
    return True, ""


def _check_dangerous_patterns(command: str) -> tuple[bool, str]:
    """Check for dangerous shell patterns.

    Args:
        command: The command string.

    Returns:
        Tuple of (is_valid, error_message).
    """
    dangerous_patterns = [
        "&&",
        "||",
        ";",
        "|",
        ">",
        "<",
        ">>",
        "<<",
        "`",
        "$(",
        "${",
    ]

    for pattern in dangerous_patterns:
        if pattern in command:
            return False, f"Dangerous pattern not allowed: {pattern}"

    return True, ""


def _validate_command(command: str) -> tuple[bool, str]:
    """Validate that a command is safe to execute.

    Args:
        command: The command string to validate.

    Returns:
        Tuple of (is_valid, error_message).
    """
    parts, error = _parse_command(command)
    if parts is None:
        return False, error

    base_command = parts[0].split("/")[-1]  # Handle full paths

    is_valid, error = _check_base_command(base_command)
    if not is_valid:
        return False, error

    # Special handling for git
    if base_command == "git" and len(parts) > 1:
        subcommand = parts[1]
        if subcommand not in ALLOWED_GIT_SUBCOMMANDS:
            return False, f"Git subcommand not allowed: {subcommand}"

    return _check_dangerous_patterns(command)


def _resolve_work_dir(
    workspace_path: Path,
    cwd: str | None,
) -> tuple[Path | None, str]:
    """Resolve the working directory for command execution.

    Args:
        workspace_path: Base path to the workspace.
        cwd: Relative path within workspace.

    Returns:
        Tuple of (resolved path or None, error_message).
    """
    if cwd:
        work_dir = (workspace_path / cwd).resolve()
        if not str(work_dir).startswith(str(workspace_path.resolve())):
            return None, "Path traversal not allowed"
    else:
        work_dir = workspace_path

    if not work_dir.exists():
        return None, f"Working directory not found: {cwd}"

    return work_dir, ""


def _truncate_output(output: str, max_output: int = 50000) -> str:
    """Truncate output if too long."""
    if len(output) > max_output:
        return output[:max_output] + "\n... (output truncated)"
    return output


async def run_command(
    workspace_path: Path,
    command: str,
    cwd: str | None = None,
    timeout: int = 60,
) -> dict[str, Any]:
    """Run a shell command in the workspace.

    Args:
        workspace_path: Base path to the workspace.
        command: Command to execute.
        cwd: Working directory relative to workspace.
        timeout: Command timeout in seconds.

    Returns:
        Dictionary with command output or error.
    """
    # Validate command
    is_valid, error = _validate_command(command)
    if not is_valid:
        logger.warning("Command rejected", command=command, reason=error)
        return {"success": False, "error": error}

    try:
        # Determine working directory
        work_dir, error = _resolve_work_dir(workspace_path, cwd)
        if work_dir is None:
            return {"success": False, "error": error}

        logger.info("Executing command", command=command, cwd=str(work_dir))

        # Parse command into arguments for safer execution
        args, error = _parse_command(command)
        if args is None:
            return {"success": False, "error": error}

        # Execute command using exec (safer than shell)
        process = await asyncio.create_subprocess_exec(
            args[0],
            *args[1:],
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=work_dir,
            env={
                "PATH": "/usr/local/bin:/usr/bin:/bin",
                "HOME": str(workspace_path),
                "LANG": "en_US.UTF-8",
            },
        )

        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
        except TimeoutError:
            process.kill()
            return {"success": False, "error": f"Command timed out after {timeout} seconds"}

        stdout_str = _truncate_output(stdout.decode("utf-8", errors="replace"))
        stderr_str = _truncate_output(stderr.decode("utf-8", errors="replace"))

        result: dict[str, Any] = {
            "success": process.returncode == 0,
            "exit_code": process.returncode,
            "stdout": stdout_str,
            "stderr": stderr_str,
            "command": command,
        }

        if process.returncode != 0:
            result["error"] = f"Command exited with code {process.returncode}"

        logger.info(
            "Command completed",
            command=command,
            exit_code=process.returncode,
            stdout_len=len(stdout_str),
            stderr_len=len(stderr_str),
        )

        return result

    except Exception as e:
        logger.error("Failed to execute command", command=command, error=str(e))
        return {"success": False, "error": str(e)}
