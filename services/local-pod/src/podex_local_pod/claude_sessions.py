"""Claude Code session discovery and management.

This module provides functionality to discover, enumerate, and read
Claude Code sessions stored locally on the user's machine.

Claude Code stores sessions in:
- ~/.claude/projects/{encoded-project-path}/sessions-index.json  (session list)
- ~/.claude/projects/{encoded-project-path}/{session-id}.jsonl   (conversation history)

The session index provides fast lookup without parsing all JSONL files.
"""

import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any, TypedDict

import structlog

logger = structlog.get_logger()


class ClaudeSessionSummary(TypedDict):
    """Summary of a Claude Code session for API responses."""

    session_id: str
    first_prompt: str
    message_count: int
    created_at: str
    modified_at: str
    git_branch: str
    project_path: str
    is_sidechain: bool
    file_size_bytes: int


class ClaudeSessionDetail(TypedDict):
    """Full details of a Claude Code session including messages."""

    session_id: str
    first_prompt: str
    message_count: int
    created_at: str
    modified_at: str
    git_branch: str
    project_path: str
    is_sidechain: bool
    messages: list[dict[str, Any]]


def get_claude_projects_dir() -> Path:
    """Get the Claude Code projects directory."""
    return Path.home() / ".claude" / "projects"


def encode_project_path(project_path: str) -> str:
    """Encode a project path to Claude Code's directory naming scheme.

    Claude Code encodes paths by replacing '/' with '-'.
    Example: /Users/foo/bar -> -Users-foo-bar
    """
    normalized = os.path.normpath(project_path)
    return normalized.replace("/", "-")


def get_sessions_index_path(project_path: str) -> Path:
    """Get the path to the sessions index file for a project."""
    encoded = encode_project_path(project_path)
    return get_claude_projects_dir() / encoded / "sessions-index.json"


def list_claude_projects() -> list[dict[str, Any]]:
    """List all projects that have Claude Code sessions."""
    projects_dir = get_claude_projects_dir()
    if not projects_dir.exists():
        return []

    projects = []
    for entry in projects_dir.iterdir():
        if not entry.is_dir() or entry.name.startswith("."):
            continue

        index_path = entry / "sessions-index.json"
        if not index_path.exists():
            continue

        try:
            with open(index_path) as f:
                data = json.load(f)

            entries = data.get("entries", [])
            original_path = data.get("originalPath", "")

            if not original_path:
                original_path = entry.name.replace("-", "/")
                if not original_path.startswith("/"):
                    original_path = "/" + original_path

            projects.append(
                {
                    "path": original_path,
                    "encoded_path": entry.name,
                    "session_count": len(entries),
                    "last_modified": max((e.get("modified", "") for e in entries), default=""),
                }
            )
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("Failed to read project index", path=str(entry), error=str(e))
            continue

    projects.sort(key=lambda p: p.get("last_modified", ""), reverse=True)
    return projects


def get_claude_sessions(
    project_path: str,
    limit: int = 50,
    offset: int = 0,
    sort_by: str = "modified",
    sort_order: str = "desc",
) -> tuple[list[ClaudeSessionSummary], int]:
    """Get Claude Code sessions for a project.

    Scans ALL JSONL files in the project directory (not just sessions-index.json)
    because the index is often incomplete and has stale data.
    This matches how VS Code displays sessions.
    """
    from datetime import datetime

    encoded = encode_project_path(project_path)
    project_dir = get_claude_projects_dir() / encoded

    if not project_dir.exists():
        logger.debug("Project directory not found", path=str(project_dir))
        return [], 0

    # Load index for metadata lookup (optional - may be incomplete)
    index_path = project_dir / "sessions-index.json"
    index_entries: dict[str, dict[str, Any]] = {}
    if index_path.exists():
        try:
            with open(index_path) as f:
                data = json.load(f)
            for entry in data.get("entries", []):
                sid = entry.get("sessionId", "")
                if sid:
                    index_entries[sid] = entry
        except (json.JSONDecodeError, OSError):
            pass

    sessions: list[ClaudeSessionSummary] = []

    # Scan ALL JSONL files in the project directory
    for jsonl_path in project_dir.glob("*.jsonl"):
        session_id = jsonl_path.stem

        # Get first prompt from JSONL file
        first_prompt = _get_first_user_prompt_from_jsonl(jsonl_path)

        # Skip sessions with no meaningful prompt
        if not first_prompt:
            continue

        # Get file stats for modified time
        try:
            stat = jsonl_path.stat()
            file_size = stat.st_size
            file_mtime = datetime.fromtimestamp(stat.st_mtime).isoformat()
        except OSError:
            file_size = 0
            file_mtime = ""

        # Try to get metadata from index, fall back to JSONL parsing
        index_entry = index_entries.get(session_id, {})
        if index_entry:
            # Use index metadata
            message_count = index_entry.get("messageCount", 0)
            created_at = index_entry.get("created", "")
            modified_at = index_entry.get("modified", file_mtime)
            git_branch = index_entry.get("gitBranch", "")
            is_sidechain = index_entry.get("isSidechain", False)
        else:
            # Parse metadata from JSONL file
            metadata = _get_session_metadata_from_jsonl(jsonl_path)
            message_count = metadata["message_count"]
            created_at = metadata["created_at"]
            modified_at = file_mtime  # Use file mtime for sorting
            git_branch = metadata["git_branch"]
            is_sidechain = metadata["is_sidechain"]

        sessions.append(
            {
                "session_id": session_id,
                "first_prompt": first_prompt,
                "message_count": message_count,
                "created_at": created_at,
                "modified_at": modified_at,
                "git_branch": git_branch,
                "project_path": project_path,
                "is_sidechain": is_sidechain,
                "file_size_bytes": file_size,
            }
        )

    total = len(sessions)

    sort_key_map = {
        "created": "created_at",
        "modified": "modified_at",
        "message_count": "message_count",
    }
    sort_key = sort_key_map.get(sort_by, "modified_at")
    reverse = sort_order == "desc"
    sessions.sort(key=lambda s: str(s.get(sort_key, "")), reverse=reverse)

    paginated = sessions[offset : offset + limit]
    return paginated, total


def get_claude_session_detail(
    project_path: str,
    session_id: str,
    include_messages: bool = True,
    message_limit: int = 100,
) -> ClaudeSessionDetail | None:
    """Get detailed info about a specific Claude Code session.

    First tries to find session metadata in the index file. If not found,
    falls back to reading directly from the session file (handles cases
    where Claude Code's index is out of sync).
    """
    entry = None

    # Try to find session in index first
    index_path = get_sessions_index_path(project_path)
    if index_path.exists():
        try:
            with open(index_path) as f:
                data = json.load(f)
            for item in data.get("entries", []):
                if item.get("sessionId") == session_id:
                    entry = item
                    break
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("Failed to read sessions index", error=str(e))

    # Fallback: check if session file exists directly (index may be out of sync)
    encoded = encode_project_path(project_path)
    session_path = get_claude_projects_dir() / encoded / f"{session_id}.jsonl"

    if not entry and not session_path.exists():
        logger.debug("Session not found in index or filesystem", session_id=session_id)
        return None

    # Build session detail from index entry or from file directly
    if entry:
        detail: ClaudeSessionDetail = {
            "session_id": entry.get("sessionId", ""),
            "first_prompt": _clean_first_prompt(entry.get("firstPrompt", "")),
            "message_count": entry.get("messageCount", 0),
            "created_at": entry.get("created", ""),
            "modified_at": entry.get("modified", ""),
            "git_branch": entry.get("gitBranch", ""),
            "project_path": entry.get("projectPath", project_path),
            "is_sidechain": entry.get("isSidechain", False),
            "messages": [],
        }
    else:
        # Build detail from session file when not in index
        logger.debug("Session not in index, reading from file", session_id=session_id)
        fallback_detail = _build_session_detail_from_file(session_path, session_id, project_path)
        if not fallback_detail:
            return None
        detail = fallback_detail

    if include_messages:
        messages, _ = get_claude_session_messages(project_path, session_id, limit=message_limit)
        detail["messages"] = messages

    return detail


def _build_session_detail_from_file(
    session_path: Path, session_id: str, project_path: str
) -> ClaudeSessionDetail | None:
    """Build session detail by reading the session JSONL file directly.

    Used as fallback when session is not in the index.
    """
    first_prompt = ""
    git_branch = ""
    is_sidechain = False
    created_at = ""
    modified_at = ""
    message_count = 0

    try:
        stat = session_path.stat()
        # Use file timestamps as fallback
        from datetime import UTC, datetime

        created_at = datetime.fromtimestamp(stat.st_ctime, tz=UTC).isoformat()
        modified_at = datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat()

        with open(session_path) as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue

                entry_type = entry.get("type")

                # Extract metadata from first user message
                if entry_type == "user" and not first_prompt:
                    msg = entry.get("message", {})
                    content = msg.get("content", [])
                    if isinstance(content, list):
                        for block in content:
                            if isinstance(block, dict) and block.get("type") == "text":
                                first_prompt = block.get("text", "")[:200]
                                break
                    elif isinstance(content, str):
                        first_prompt = content[:200]

                # Extract git branch and other metadata
                if not git_branch and entry.get("gitBranch"):
                    git_branch = entry.get("gitBranch", "")

                if entry.get("isSidechain"):
                    is_sidechain = True

                # Count user/assistant messages
                if entry_type in ("user", "assistant"):
                    message_count += 1

    except OSError as e:
        logger.error("Failed to read session file", path=str(session_path), error=str(e))
        return None

    return {
        "session_id": session_id,
        "first_prompt": _clean_first_prompt(first_prompt) if first_prompt else "No prompt",
        "message_count": message_count,
        "created_at": created_at,
        "modified_at": modified_at,
        "git_branch": git_branch,
        "project_path": project_path,
        "is_sidechain": is_sidechain,
        "messages": [],
    }


def get_claude_session_messages(
    project_path: str,
    session_id: str,
    limit: int = 100,
    offset: int = 0,
    reverse: bool = False,
) -> tuple[list[dict[str, Any]], int]:
    """Get all entries from a Claude Code session.

    Returns all entry types including:
    - user/assistant messages
    - progress events (thinking, hooks, etc.)
    - tool results
    - file history snapshots
    - queue operations
    - mode changes

    Args:
        project_path: Path to the project
        session_id: Claude session ID
        limit: Maximum number of messages to return
        offset: Number of messages to skip
        reverse: If True, return messages in reverse order (newest first).
                 This enables bottom-up loading where we fetch latest messages
                 first for fast initial display.

    Returns:
        Tuple of (messages, total_count). Messages are in the requested order.
    """
    encoded = encode_project_path(project_path)
    session_path = get_claude_projects_dir() / encoded / f"{session_id}.jsonl"

    if not session_path.exists():
        logger.debug("Session file not found", path=str(session_path))
        return [], 0

    entries: list[dict[str, Any]] = []
    try:
        with open(session_path) as f:
            for line in f:
                if not line.strip():
                    continue

                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue

                entry_type = entry.get("type")

                # Build a normalized entry with common fields
                # Generate a uuid if missing to ensure all entries are identifiable
                entry_uuid = entry.get("uuid")
                if not entry_uuid:
                    # Generate deterministic uuid from content hash for deduplication
                    content_hash = hashlib.sha256(line.encode()).hexdigest()[:32]
                    entry_uuid = f"gen-{content_hash}"

                normalized: dict[str, Any] = {
                    "uuid": entry_uuid,
                    "parent_uuid": entry.get("parentUuid"),
                    "type": entry_type,
                    "timestamp": entry.get("timestamp"),
                    "session_id": entry.get("sessionId"),
                    "is_sidechain": entry.get("isSidechain", False),
                }

                # Handle user/assistant messages specially
                if entry_type in ("user", "assistant"):
                    message = entry.get("message", {})
                    # Content can be in message.content or directly on entry
                    content = message.get("content") or entry.get("content", [])

                    text_content = ""
                    thinking_content = ""
                    tool_calls = None
                    tool_results = None

                    if isinstance(content, list):
                        for block in content:
                            if isinstance(block, dict):
                                block_type = block.get("type")
                                if block_type == "text":
                                    text_content += block.get("text", "")
                                elif block_type == "thinking":
                                    # Extract thinking content from extended thinking
                                    thinking_content += block.get("thinking", "")
                                elif block_type == "tool_result":
                                    if tool_results is None:
                                        tool_results = []
                                    tool_results.append(
                                        {
                                            "tool_use_id": block.get("tool_use_id"),
                                            "content": block.get("content"),
                                            "is_error": block.get("is_error", False),
                                        }
                                    )
                        tool_calls = _extract_tool_calls(content)
                    elif isinstance(content, str):
                        text_content = content

                    normalized.update(
                        {
                            "role": message.get("role", entry_type),
                            "content": text_content,
                            "thinking": thinking_content if thinking_content else None,
                            "model": message.get("model"),
                            "tool_calls": tool_calls,
                            "tool_results": tool_results,
                            "stop_reason": message.get("stop_reason"),
                            "usage": message.get("usage"),
                        }
                    )

                # Handle progress events
                elif entry_type == "progress":
                    data = entry.get("data", {})
                    normalized.update(
                        {
                            "progress_type": data.get("type"),
                            "data": data,
                            "tool_use_id": entry.get("toolUseID"),
                            "parent_tool_use_id": entry.get("parentToolUseID"),
                        }
                    )

                # Handle summary entries
                elif entry_type == "summary":
                    normalized.update(
                        {
                            "summary": entry.get("summary"),
                            "leaf_uuid": entry.get("leafUuid"),
                        }
                    )

                # Handle tool results as standalone entries
                elif entry_type == "tool_result":
                    normalized.update(
                        {
                            "tool_use_id": entry.get("toolUseId"),
                            "content": entry.get("content"),
                            "is_error": entry.get("isError", False),
                        }
                    )

                # For all other types, include raw data
                else:
                    # Include any additional fields we haven't normalized
                    for key, value in entry.items():
                        if key not in normalized:
                            normalized[key] = value

                entries.append(normalized)

    except OSError as e:
        logger.error("Failed to read session file", path=str(session_path), error=str(e))
        return [], 0

    total = len(entries)

    # If reverse is requested, reverse the entire list first
    # This allows bottom-up loading: newest messages first
    if reverse:
        entries = entries[::-1]

    # Apply pagination after reversing
    paginated = entries[offset : offset + limit]

    return paginated, total


def _clean_first_prompt_minimal(prompt: str) -> str:
    """Minimal cleaning of first prompt to match Claude Code's display.

    Claude Code shows firstPrompt from index with minimal processing.
    We just normalize whitespace and truncate, preserving the actual content.
    """
    if not prompt:
        return ""

    # Normalize whitespace (Claude Code does this)
    prompt = " ".join(prompt.split())

    # Truncate long prompts
    max_length = 200
    if len(prompt) > max_length:
        prompt = prompt[:max_length] + "..."

    return prompt.strip()


def _clean_first_prompt(prompt: str) -> str:
    """Clean the first prompt for display (aggressive cleaning).

    Removes IDE context tags and other XML-like tags to extract
    the actual user-typed prompt text. Used for detail views.
    """
    if not prompt:
        return ""

    # Remove IDE context tags like <ide_opened_file>...</ide_opened_file>
    prompt = re.sub(r"<ide_[^>]+>.*?</ide_[^>]+>", "", prompt, flags=re.DOTALL)
    # Remove any remaining XML-like tags
    prompt = re.sub(r"<[^>]+>", "", prompt)
    # Normalize whitespace
    prompt = " ".join(prompt.split())

    max_length = 200
    if len(prompt) > max_length:
        prompt = prompt[:max_length] + "..."

    return prompt.strip()


def _get_session_metadata_from_jsonl(session_path: Path) -> dict[str, Any]:
    """Extract session metadata from a JSONL file.

    Used for sessions not in the index.
    """
    metadata: dict[str, Any] = {
        "message_count": 0,
        "created_at": "",
        "git_branch": "",
        "is_sidechain": False,
    }

    if not session_path.exists():
        return metadata

    try:
        with open(session_path) as f:
            first_timestamp = None
            for line in f:
                if not line.strip():
                    continue
                try:
                    entry = json.loads(line)
                    msg_type = entry.get("type")

                    # Count user/assistant messages
                    if msg_type in ("user", "assistant"):
                        metadata["message_count"] += 1

                    # Get first timestamp as created_at
                    if first_timestamp is None and entry.get("timestamp"):
                        first_timestamp = entry.get("timestamp")
                        metadata["created_at"] = first_timestamp

                    # Get git branch from first user message
                    if msg_type == "user" and not metadata["git_branch"]:
                        metadata["git_branch"] = entry.get("gitBranch", "")
                        metadata["is_sidechain"] = entry.get("isSidechain", False)

                except json.JSONDecodeError:
                    continue
    except OSError:
        pass

    return metadata


def _get_first_user_prompt_from_jsonl(session_path: Path) -> str:
    """Extract the first user prompt from a session JSONL file.

    Skips IDE context tags to find the actual user-typed prompt.
    """
    if not session_path.exists():
        return ""

    try:
        with open(session_path) as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    entry = json.loads(line)
                    if entry.get("type") == "user":
                        message = entry.get("message", {})
                        content = message.get("content", [])

                        # Extract text blocks, prioritizing non-IDE blocks
                        text_blocks = []
                        if isinstance(content, list):
                            for block in content:
                                if isinstance(block, dict) and block.get("type") == "text":
                                    text = block.get("text", "").strip()
                                    if text:
                                        text_blocks.append(text)
                        elif isinstance(content, str):
                            text_blocks.append(content.strip())

                        # Find first block that isn't just IDE context
                        for text in text_blocks:
                            # Skip blocks that are only IDE tags
                            if text.startswith("<ide_") and text.endswith(">"):
                                continue
                            cleaned = _clean_first_prompt(text)
                            if cleaned:
                                return cleaned

                        # Fallback: use all text if no non-IDE block found
                        if text_blocks:
                            all_text = " ".join(text_blocks)
                            cleaned = _clean_first_prompt(all_text)
                            if cleaned:
                                return cleaned
                except json.JSONDecodeError:
                    continue
    except OSError:
        pass

    return ""


def _extract_tool_calls(content: list[Any] | str) -> list[dict[str, Any]] | None:
    """Extract tool calls from message content."""
    if not isinstance(content, list):
        return None

    tool_calls = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_use":
            tool_calls.append(
                {
                    "id": block.get("id"),
                    "name": block.get("name"),
                    "input": block.get("input"),
                }
            )

    return tool_calls if tool_calls else None


def sync_session_to_dict(project_path: str, session_id: str) -> dict[str, Any] | None:
    """Get session data formatted for syncing to Podex DB."""
    detail = get_claude_session_detail(project_path, session_id, include_messages=True)
    if not detail:
        return None

    return {
        "claude_session_id": detail["session_id"],
        "project_path": detail["project_path"],
        "git_branch": detail["git_branch"],
        "first_prompt": detail["first_prompt"],
        "message_count": detail["message_count"],
        "created_at": detail["created_at"],
        "modified_at": detail["modified_at"],
        "is_sidechain": detail["is_sidechain"],
        "messages": [
            {
                "uuid": m["uuid"],
                "parent_uuid": m.get("parent_uuid"),
                "role": m["role"],
                "content": m["content"],
                "timestamp": m["timestamp"],
                "model": m.get("model"),
                "tool_calls": m.get("tool_calls"),
            }
            for m in detail["messages"]
        ],
    }
