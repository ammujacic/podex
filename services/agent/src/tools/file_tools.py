"""File system tools for agents."""

import fnmatch
import re
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger()

# File size limits
MAX_READ_FILE_SIZE = 1_000_000  # 1MB
MAX_SEARCH_FILE_SIZE = 500_000  # 500KB


def _validate_path_within_workspace(workspace_path: Path, target_path: Path) -> bool:
    """Validate that target_path is within workspace_path, protecting against symlink attacks.

    Args:
        workspace_path: Base workspace path (must be resolved).
        target_path: Target path to validate (must be resolved).

    Returns:
        True if target is within workspace, False otherwise.
    """
    try:
        # Use relative_to() which raises ValueError if path is not relative to workspace
        # This is safer than string comparison as it handles edge cases properly
        target_path.relative_to(workspace_path)
        return True
    except ValueError:
        return False


def _validate_file_for_read(
    workspace_path: Path,
    file_path: Path,
    path: str,
) -> str | None:
    """Validate file is readable within workspace.

    Args:
        workspace_path: Resolved workspace path.
        file_path: Resolved file path.
        path: Original relative path for error messages.

    Returns:
        Error message if validation fails, None if valid.
    """
    resolved_workspace = workspace_path.resolve()

    if not _validate_path_within_workspace(resolved_workspace, file_path):
        return "Path traversal not allowed"

    if not file_path.exists():
        return f"File not found: {path}"

    if not file_path.is_file():
        return f"Not a file: {path}"

    if file_path.stat().st_size > MAX_READ_FILE_SIZE:
        return "File too large (max 1MB)"

    return None


async def read_file(workspace_path: Path, path: str) -> dict[str, Any]:
    """Read a file from the workspace.

    Args:
        workspace_path: Base path to the workspace.
        path: Relative path to the file within the workspace.

    Returns:
        Dictionary with content or error.
    """
    try:
        file_path = (workspace_path / path).resolve()

        # Validate file is readable
        error = _validate_file_for_read(workspace_path, file_path, path)
        if error:
            return {"success": False, "error": error}

        content = file_path.read_text(encoding="utf-8")

        logger.info("File read", path=path, size=len(content))
        return {
            "success": True,
            "content": content,
            "path": path,
            "size": len(content),
        }

    except UnicodeDecodeError:
        return {"success": False, "error": f"Cannot read binary file: {path}"}
    except PermissionError:
        return {"success": False, "error": f"Permission denied: {path}"}
    except Exception as e:
        logger.error("Failed to read file", path=path, error=str(e))
        return {"success": False, "error": str(e)}


async def write_file(workspace_path: Path, path: str, content: str) -> dict[str, Any]:
    """Write content to a file in the workspace.

    Args:
        workspace_path: Base path to the workspace.
        path: Relative path to the file within the workspace.
        content: Content to write.

    Returns:
        Dictionary with success status or error.
    """
    try:
        # Resolve both paths to handle symlinks safely
        resolved_workspace = workspace_path.resolve()
        file_path = (workspace_path / path).resolve()

        # Validate path is within workspace (protects against symlink attacks)
        if not _validate_path_within_workspace(resolved_workspace, file_path):
            return {"success": False, "error": "Path traversal not allowed"}

        # Create parent directories if needed
        file_path.parent.mkdir(parents=True, exist_ok=True)

        # Write content
        file_path.write_text(content, encoding="utf-8")

        logger.info("File written", path=path, size=len(content))
        return {
            "success": True,
            "path": path,
            "size": len(content),
            "message": f"Successfully wrote {len(content)} bytes to {path}",
        }

    except PermissionError:
        return {"success": False, "error": f"Permission denied: {path}"}
    except Exception as e:
        logger.error("Failed to write file", path=path, error=str(e))
        return {"success": False, "error": str(e)}


async def list_directory(workspace_path: Path, path: str = ".") -> dict[str, Any]:
    """List files in a directory.

    Args:
        workspace_path: Base path to the workspace.
        path: Relative path to the directory.

    Returns:
        Dictionary with file listing or error.
    """
    try:
        # Resolve both paths to handle symlinks safely
        resolved_workspace = workspace_path.resolve()
        dir_path = (workspace_path / path).resolve()

        # Validate path is within workspace (protects against symlink attacks)
        if not _validate_path_within_workspace(resolved_workspace, dir_path):
            return {"success": False, "error": "Path traversal not allowed"}

        if not dir_path.exists():
            return {"success": False, "error": f"Directory not found: {path}"}

        if not dir_path.is_dir():
            return {"success": False, "error": f"Not a directory: {path}"}

        entries: list[dict[str, Any]] = []
        for entry in sorted(dir_path.iterdir()):
            # Skip hidden files and common ignore patterns
            if entry.name.startswith(".") or entry.name in [
                "node_modules",
                "__pycache__",
                ".git",
                "venv",
                ".venv",
            ]:
                continue

            entry_info: dict[str, Any] = {
                "name": entry.name,
                "type": "directory" if entry.is_dir() else "file",
                "path": str(entry.relative_to(workspace_path)),
            }

            if entry.is_file():
                entry_info["size"] = entry.stat().st_size

            entries.append(entry_info)

        logger.info("Directory listed", path=path, count=len(entries))
        return {
            "success": True,
            "path": path,
            "entries": entries,
            "count": len(entries),
        }

    except PermissionError:
        return {"success": False, "error": f"Permission denied: {path}"}
    except Exception as e:
        logger.error("Failed to list directory", path=path, error=str(e))
        return {"success": False, "error": str(e)}


async def search_code(
    workspace_path: Path,
    query: str,
    file_pattern: str | None = None,
    max_results: int = 50,
) -> dict[str, Any]:
    """Search for code patterns in the workspace.

    Args:
        workspace_path: Base path to the workspace.
        query: Search query (supports regex).
        file_pattern: Optional glob pattern for files (e.g., "*.py", "*.ts").
        max_results: Maximum number of results to return.

    Returns:
        Dictionary with search results or error.
    """
    try:
        results: list[dict[str, Any]] = []
        try:
            pattern = re.compile(query, re.IGNORECASE)
        except re.error as e:
            return {"success": False, "error": f"Invalid regex pattern: {e}"}

        # Walk through workspace
        for file_path in workspace_path.rglob("*"):
            if len(results) >= max_results:
                break

            # Skip directories and hidden/ignored files
            if not file_path.is_file():
                continue

            relative_path = str(file_path.relative_to(workspace_path))

            # Skip common ignore patterns
            skip_patterns = [
                "node_modules/",
                "__pycache__/",
                ".git/",
                "venv/",
                ".venv/",
                ".next/",
                "dist/",
                "build/",
                ".cache/",
            ]
            if any(pat in relative_path for pat in skip_patterns):
                continue

            # Apply file pattern filter
            if file_pattern and not fnmatch.fnmatch(file_path.name, file_pattern):
                continue

            # Skip binary and large files
            try:
                if file_path.stat().st_size > MAX_SEARCH_FILE_SIZE:
                    continue

                content = file_path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, PermissionError):
                continue

            # Search for matches
            for line_num, line in enumerate(content.splitlines(), 1):
                if pattern.search(line):
                    results.append(
                        {
                            "file": relative_path,
                            "line": line_num,
                            "content": line.strip()[:200],  # Truncate long lines
                        },
                    )

                    if len(results) >= max_results:
                        break

        logger.info("Code search completed", query=query, results=len(results))
        return {
            "success": True,
            "query": query,
            "file_pattern": file_pattern,
            "results": results,
            "count": len(results),
            "truncated": len(results) >= max_results,
        }

    except Exception as e:
        logger.error("Failed to search code", query=query, error=str(e))
        return {"success": False, "error": str(e)}
