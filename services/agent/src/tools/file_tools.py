"""File system tools for agents."""

import fnmatch
import re
from pathlib import Path
from typing import Any

import httpx
import structlog

logger = structlog.get_logger()

# File size limits
MAX_READ_FILE_SIZE = 1_000_000  # 1MB
MAX_SEARCH_FILE_SIZE = 500_000  # 500KB


def _normalize_path(path: str) -> str:
    """Normalize a path by stripping leading slashes.

    This handles the common LLM mistake of passing absolute paths like "/README.md"
    instead of relative paths like "README.md".

    Args:
        path: Path string that may have leading slashes.

    Returns:
        Normalized path without leading slashes.
    """
    return path.lstrip("/")


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
        # Normalize path to handle absolute paths passed by LLM
        path = _normalize_path(path)
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
        # Normalize path to handle absolute paths passed by LLM
        path = _normalize_path(path)
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
        # Normalize path to handle absolute paths passed by LLM
        path = _normalize_path(path) or "."
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


async def glob_files(
    workspace_path: Path,
    pattern: str,
    path: str = ".",
    include_hidden: bool = False,
) -> dict[str, Any]:
    """Find files matching a glob pattern.

    Args:
        workspace_path: Base path to the workspace.
        pattern: Glob pattern to match (e.g., '**/*.py', 'src/*.ts').
        path: Base directory to search from (relative to workspace root).
        include_hidden: Include hidden files (starting with .).

    Returns:
        Dictionary with matching files or error.
    """
    try:
        # Normalize path
        path = _normalize_path(path) or "."
        resolved_workspace = workspace_path.resolve()
        search_path = (workspace_path / path).resolve()

        # Validate path is within workspace
        if not _validate_path_within_workspace(resolved_workspace, search_path):
            return {"success": False, "error": "Path traversal not allowed"}

        if not search_path.exists():
            return {"success": False, "error": f"Directory not found: {path}"}

        if not search_path.is_dir():
            return {"success": False, "error": f"Not a directory: {path}"}

        # Find matching files
        matches: list[dict[str, Any]] = []
        skip_patterns = [
            "node_modules",
            "__pycache__",
            ".git",
            "venv",
            ".venv",
            ".next",
            "dist",
            "build",
            ".cache",
        ]

        for file_path in search_path.glob(pattern):
            if not file_path.is_file():
                continue

            relative_path = str(file_path.relative_to(workspace_path))

            # Skip ignored directories
            if any(
                f"/{pat}/" in f"/{relative_path}" or relative_path.startswith(f"{pat}/")
                for pat in skip_patterns
            ):
                continue

            # Skip hidden files unless requested
            if not include_hidden and any(part.startswith(".") for part in file_path.parts):
                continue

            matches.append(
                {
                    "path": relative_path,
                    "name": file_path.name,
                    "size": file_path.stat().st_size,
                }
            )

            # Limit results
            if len(matches) >= 500:
                break

        logger.info("Glob search completed", pattern=pattern, count=len(matches))
        return {
            "success": True,
            "pattern": pattern,
            "base_path": path,
            "files": matches,
            "count": len(matches),
            "truncated": len(matches) >= 500,
        }

    except Exception as e:
        logger.error("Failed to glob files", pattern=pattern, error=str(e))
        return {"success": False, "error": str(e)}


async def grep(
    workspace_path: Path,
    pattern: str,
    path: str = ".",
    file_pattern: str | None = None,
    ignore_case: bool = False,
    context_lines: int = 2,
    max_results: int = 100,
) -> dict[str, Any]:
    """Search for text patterns in files using regex.

    Args:
        workspace_path: Base path to the workspace.
        pattern: Regex pattern to search for.
        path: File or directory to search in.
        file_pattern: Glob pattern to filter files (e.g., '*.py').
        ignore_case: Case-insensitive search.
        context_lines: Number of context lines around matches.
        max_results: Maximum number of results.

    Returns:
        Dictionary with search results or error.
    """
    try:
        # Compile regex
        flags = re.IGNORECASE if ignore_case else 0
        try:
            regex = re.compile(pattern, flags)
        except re.error as e:
            return {"success": False, "error": f"Invalid regex pattern: {e}"}

        # Normalize path
        path = _normalize_path(path) or "."
        resolved_workspace = workspace_path.resolve()
        search_path = (workspace_path / path).resolve()

        # Validate path is within workspace
        if not _validate_path_within_workspace(resolved_workspace, search_path):
            return {"success": False, "error": "Path traversal not allowed"}

        results: list[dict[str, Any]] = []

        # Determine files to search
        if search_path.is_file():
            files_to_search = [search_path]
        elif search_path.is_dir():
            if file_pattern:
                files_to_search = list(search_path.rglob(file_pattern))
            else:
                files_to_search = list(search_path.rglob("*"))
        else:
            return {"success": False, "error": f"Path not found: {path}"}

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

        for file_path in files_to_search:
            if len(results) >= max_results:
                break

            if not file_path.is_file():
                continue

            relative_path = str(file_path.relative_to(workspace_path))

            # Skip ignored directories
            if any(pat in relative_path for pat in skip_patterns):
                continue

            # Skip binary/large files
            try:
                if file_path.stat().st_size > MAX_SEARCH_FILE_SIZE:
                    continue
                content = file_path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, PermissionError):
                continue

            lines = content.splitlines()
            for line_num, line in enumerate(lines, 1):
                if regex.search(line):
                    # Get context lines
                    start = max(0, line_num - 1 - context_lines)
                    end = min(len(lines), line_num + context_lines)
                    context = []
                    for i in range(start, end):
                        prefix = ">" if i == line_num - 1 else " "
                        context.append(f"{prefix} {i + 1}: {lines[i][:200]}")

                    results.append(
                        {
                            "file": relative_path,
                            "line": line_num,
                            "match": line.strip()[:200],
                            "context": "\n".join(context),
                        }
                    )

                    if len(results) >= max_results:
                        break

        logger.info("Grep search completed", pattern=pattern, count=len(results))
        return {
            "success": True,
            "pattern": pattern,
            "results": results,
            "count": len(results),
            "truncated": len(results) >= max_results,
        }

    except Exception as e:
        logger.error("Failed to grep", pattern=pattern, error=str(e))
        return {"success": False, "error": str(e)}


async def apply_patch(
    workspace_path: Path,
    path: str,
    patch: str,
    reverse: bool = False,
) -> dict[str, Any]:
    """Apply a unified diff patch to a file.

    Args:
        workspace_path: Base path to the workspace.
        path: File path to apply patch to.
        patch: Unified diff patch content.
        reverse: Reverse the patch (undo changes).

    Returns:
        Dictionary with success status or error.
    """
    try:
        # Normalize path
        path = _normalize_path(path)
        resolved_workspace = workspace_path.resolve()
        file_path = (workspace_path / path).resolve()

        # Validate path is within workspace
        if not _validate_path_within_workspace(resolved_workspace, file_path):
            return {"success": False, "error": "Path traversal not allowed"}

        # Read original file content
        original_content = ""
        if file_path.exists():
            if file_path.stat().st_size > MAX_READ_FILE_SIZE:
                return {"success": False, "error": "File too large for patching"}
            original_content = file_path.read_text(encoding="utf-8")

        original_lines = original_content.splitlines(keepends=True)
        if original_lines and not original_lines[-1].endswith("\n"):
            original_lines[-1] += "\n"

        # Parse and apply patch
        patch_lines = patch.splitlines(keepends=True)
        if patch_lines and not patch_lines[-1].endswith("\n"):
            patch_lines[-1] += "\n"

        # Simple unified diff application
        result_lines = list(original_lines)
        current_line = 0

        for patch_line in patch_lines:
            if patch_line.startswith("@@"):
                # Parse hunk header: @@ -start,count +start,count @@
                match = re.match(r"@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@", patch_line)
                if match:
                    group_idx = 2 if reverse else 1
                    current_line = int(match.group(group_idx)) - 1
            elif patch_line.startswith("-") and not patch_line.startswith("---"):
                if reverse:
                    # Reverse: add this line back
                    line_content = patch_line[1:]
                    if current_line <= len(result_lines):
                        result_lines.insert(current_line, line_content)
                        current_line += 1
                # Normal: remove this line
                elif current_line < len(result_lines):
                    if result_lines[current_line].rstrip() == patch_line[1:].rstrip():
                        result_lines.pop(current_line)
            elif patch_line.startswith("+") and not patch_line.startswith("+++"):
                if reverse:
                    # Reverse: remove this line
                    if current_line < len(result_lines):
                        if result_lines[current_line].rstrip() == patch_line[1:].rstrip():
                            result_lines.pop(current_line)
                else:
                    # Normal: add this line
                    line_content = patch_line[1:]
                    if current_line <= len(result_lines):
                        result_lines.insert(current_line, line_content)
                        current_line += 1
            elif patch_line.startswith(" "):
                # Context line
                current_line += 1

        # Write patched content
        new_content = "".join(result_lines)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(new_content, encoding="utf-8")

        logger.info("Patch applied", path=path, reverse=reverse)
        return {
            "success": True,
            "path": path,
            "message": f"Patch {'reversed' if reverse else 'applied'} successfully",
        }

    except Exception as e:
        logger.error("Failed to apply patch", path=path, error=str(e))
        return {"success": False, "error": str(e)}


async def fetch_url(
    url: str,
    extract_text: bool = True,
    max_length: int = 50000,
) -> dict[str, Any]:
    """Fetch content from a URL.

    Args:
        url: URL to fetch.
        extract_text: Extract and clean text content (removes HTML tags).
        max_length: Maximum content length in characters.

    Returns:
        Dictionary with fetched content or error.
    """
    try:
        # Validate URL
        if not url.startswith(("http://", "https://")):
            return {"success": False, "error": "URL must start with http:// or https://"}

        # Fetch URL
        async with httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=True,
            headers={"User-Agent": "Podex-Agent/1.0"},
        ) as client:
            response = await client.get(url)
            response.raise_for_status()

        content = response.text
        content_type = response.headers.get("content-type", "")

        # Extract text from HTML if requested
        if extract_text and "text/html" in content_type:
            # Simple HTML to text conversion
            # Remove script and style elements
            content = re.sub(
                r"<script[^>]*>.*?</script>", "", content, flags=re.DOTALL | re.IGNORECASE
            )
            content = re.sub(
                r"<style[^>]*>.*?</style>", "", content, flags=re.DOTALL | re.IGNORECASE
            )
            # Remove HTML tags
            content = re.sub(r"<[^>]+>", " ", content)
            # Normalize whitespace
            content = re.sub(r"\s+", " ", content).strip()
            # Decode HTML entities
            content = content.replace("&nbsp;", " ")
            content = content.replace("&amp;", "&")
            content = content.replace("&lt;", "<")
            content = content.replace("&gt;", ">")
            content = content.replace("&quot;", '"')

        # Truncate if needed
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
