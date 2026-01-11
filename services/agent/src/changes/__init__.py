"""Change set management for aggregated diff views."""

from .manager import (
    ChangeSet,
    ChangeSetManager,
    ChangeType,
    DiffHunk,
    DiffLine,
    FileChange,
    HunkStatus,
    get_change_set_manager,
)

__all__ = [
    "ChangeSet",
    "ChangeSetManager",
    "ChangeType",
    "DiffHunk",
    "DiffLine",
    "FileChange",
    "HunkStatus",
    "get_change_set_manager",
]
