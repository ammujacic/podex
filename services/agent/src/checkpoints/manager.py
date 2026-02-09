"""Checkpoint manager for file change tracking and restoration."""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import structlog

logger = structlog.get_logger()


@dataclass
class FileChange:
    """Represents a single file change."""

    file_path: str
    change_type: str  # 'create', 'modify', 'delete'
    content_before: str | None  # None for creates
    content_after: str | None  # None for deletes
    lines_added: int = 0
    lines_removed: int = 0


@dataclass
class Checkpoint:
    """Represents a checkpoint (snapshot) of file changes."""

    id: str
    session_id: str
    workspace_id: str
    agent_id: str
    checkpoint_number: int
    description: str
    action_type: str  # 'file_edit', 'file_create', 'batch_edit', 'command'
    files: list[FileChange] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    status: str = "active"  # 'active', 'restored', 'superseded'
    metadata: dict[str, Any] = field(default_factory=dict)


class CheckpointManager:
    """Manages file checkpoints for undo/restore functionality.

    Creates checkpoints before file modifications and allows restoration
    to previous states.
    """

    def __init__(self, workspace_path: str) -> None:
        """Initialize checkpoint manager.

        Args:
            workspace_path: Base path to the workspace directory.
        """
        self.workspace_path = Path(workspace_path)
        self.checkpoints: dict[str, list[Checkpoint]] = {}  # session_id -> checkpoints
        self._checkpoint_counters: dict[str, int] = {}  # session_id -> counter

    def _get_next_checkpoint_number(self, session_id: str) -> int:
        """Get the next checkpoint number for a session."""
        current = self._checkpoint_counters.get(session_id, 0)
        self._checkpoint_counters[session_id] = current + 1
        return current + 1

    def _read_file_content(self, file_path: str) -> str | None:
        """Read file content, returning None if file doesn't exist."""
        full_path = self.workspace_path / file_path
        try:
            if full_path.exists():
                return full_path.read_text()
        except Exception as e:
            logger.warning("Failed to read file", file_path=file_path, error=str(e))
        return None

    def _count_lines(self, content: str | None) -> int:
        """Count lines in content."""
        if content is None:
            return 0
        return len(content.splitlines())

    def create_checkpoint_before_edit(
        self,
        session_id: str,
        workspace_id: str,
        agent_id: str,
        file_path: str,
        new_content: str,
        description: str | None = None,
    ) -> Checkpoint:
        """Create a checkpoint before editing a file.

        Args:
            session_id: The session ID.
            workspace_id: The workspace ID.
            agent_id: The agent making the change.
            file_path: Path to the file being edited (relative to workspace).
            new_content: The new content that will be written.
            description: Optional description of the change.

        Returns:
            The created checkpoint.
        """
        # Read current content before the change
        old_content = self._read_file_content(file_path)
        is_create = old_content is None

        # Calculate line changes
        old_lines = self._count_lines(old_content)
        new_lines = self._count_lines(new_content)
        lines_added = max(0, new_lines - old_lines)
        lines_removed = max(0, old_lines - new_lines)

        file_change = FileChange(
            file_path=file_path,
            change_type="create" if is_create else "modify",
            content_before=old_content,
            content_after=new_content,
            lines_added=lines_added,
            lines_removed=lines_removed,
        )

        checkpoint = Checkpoint(
            id=str(uuid4()),
            session_id=session_id,
            workspace_id=workspace_id,
            agent_id=agent_id,
            checkpoint_number=self._get_next_checkpoint_number(session_id),
            description=description or f"Edit {file_path}",
            action_type="file_create" if is_create else "file_edit",
            files=[file_change],
        )

        # Store checkpoint
        if session_id not in self.checkpoints:
            self.checkpoints[session_id] = []
        self.checkpoints[session_id].append(checkpoint)

        logger.info(
            "Created checkpoint",
            checkpoint_id=checkpoint.id,
            checkpoint_number=checkpoint.checkpoint_number,
            file_path=file_path,
            action_type=checkpoint.action_type,
        )

        return checkpoint

    def create_checkpoint_before_delete(
        self,
        session_id: str,
        workspace_id: str,
        agent_id: str,
        file_path: str,
        description: str | None = None,
    ) -> Checkpoint | None:
        """Create a checkpoint before deleting a file.

        Args:
            session_id: The session ID.
            workspace_id: The workspace ID.
            agent_id: The agent making the change.
            file_path: Path to the file being deleted.
            description: Optional description.

        Returns:
            The created checkpoint, or None if file doesn't exist.
        """
        old_content = self._read_file_content(file_path)
        if old_content is None:
            return None

        file_change = FileChange(
            file_path=file_path,
            change_type="delete",
            content_before=old_content,
            content_after=None,
            lines_removed=self._count_lines(old_content),
        )

        checkpoint = Checkpoint(
            id=str(uuid4()),
            session_id=session_id,
            workspace_id=workspace_id,
            agent_id=agent_id,
            checkpoint_number=self._get_next_checkpoint_number(session_id),
            description=description or f"Delete {file_path}",
            action_type="file_delete",
            files=[file_change],
        )

        if session_id not in self.checkpoints:
            self.checkpoints[session_id] = []
        self.checkpoints[session_id].append(checkpoint)

        logger.info(
            "Created checkpoint before delete",
            checkpoint_id=checkpoint.id,
            file_path=file_path,
        )

        return checkpoint

    def create_batch_checkpoint(
        self,
        session_id: str,
        workspace_id: str,
        agent_id: str,
        file_changes: list[tuple[str, str | None]],  # [(path, new_content), ...]
        description: str | None = None,
    ) -> Checkpoint:
        """Create a checkpoint for multiple file changes.

        Args:
            session_id: The session ID.
            workspace_id: The workspace ID.
            agent_id: The agent making the changes.
            file_changes: List of (file_path, new_content) tuples. new_content=None means delete.
            description: Optional description.

        Returns:
            The created checkpoint.
        """
        changes: list[FileChange] = []

        for file_path, new_content in file_changes:
            old_content = self._read_file_content(file_path)

            if new_content is None:
                # Delete
                if old_content is not None:
                    changes.append(
                        FileChange(
                            file_path=file_path,
                            change_type="delete",
                            content_before=old_content,
                            content_after=None,
                            lines_removed=self._count_lines(old_content),
                        )
                    )
            elif old_content is None:
                # Create
                changes.append(
                    FileChange(
                        file_path=file_path,
                        change_type="create",
                        content_before=None,
                        content_after=new_content,
                        lines_added=self._count_lines(new_content),
                    )
                )
            else:
                # Modify
                old_lines = self._count_lines(old_content)
                new_lines = self._count_lines(new_content)
                changes.append(
                    FileChange(
                        file_path=file_path,
                        change_type="modify",
                        content_before=old_content,
                        content_after=new_content,
                        lines_added=max(0, new_lines - old_lines),
                        lines_removed=max(0, old_lines - new_lines),
                    )
                )

        checkpoint = Checkpoint(
            id=str(uuid4()),
            session_id=session_id,
            workspace_id=workspace_id,
            agent_id=agent_id,
            checkpoint_number=self._get_next_checkpoint_number(session_id),
            description=description or f"Batch edit ({len(changes)} files)",
            action_type="batch_edit",
            files=changes,
        )

        if session_id not in self.checkpoints:
            self.checkpoints[session_id] = []
        self.checkpoints[session_id].append(checkpoint)

        logger.info(
            "Created batch checkpoint",
            checkpoint_id=checkpoint.id,
            file_count=len(changes),
        )

        return checkpoint

    def restore_checkpoint(self, session_id: str, checkpoint_id: str) -> dict[str, Any]:
        """Restore files to their state at a checkpoint.

        Args:
            session_id: The session ID.
            checkpoint_id: The checkpoint to restore.

        Returns:
            Dict with restoration results.
        """
        checkpoints = self.checkpoints.get(session_id, [])
        checkpoint = next((c for c in checkpoints if c.id == checkpoint_id), None)

        if not checkpoint:
            return {"success": False, "error": "Checkpoint not found"}

        results: list[dict[str, Any]] = []

        for file_change in checkpoint.files:
            full_path = self.workspace_path / file_change.file_path
            try:
                if file_change.change_type == "delete":
                    # Restore deleted file
                    full_path.parent.mkdir(parents=True, exist_ok=True)
                    full_path.write_text(file_change.content_before or "")
                    results.append(
                        {
                            "file": file_change.file_path,
                            "action": "restored",
                            "success": True,
                        }
                    )

                elif file_change.change_type == "create":
                    # Remove created file
                    if full_path.exists():
                        full_path.unlink()
                    results.append(
                        {
                            "file": file_change.file_path,
                            "action": "removed",
                            "success": True,
                        }
                    )

                # Restore previous content
                elif file_change.content_before is not None:
                    full_path.write_text(file_change.content_before)
                    results.append(
                        {
                            "file": file_change.file_path,
                            "action": "reverted",
                            "success": True,
                        }
                    )

            except Exception as e:
                logger.error(
                    "Failed to restore file",
                    file_path=file_change.file_path,
                    error=str(e),
                )
                results.append(
                    {
                        "file": file_change.file_path,
                        "action": "failed",
                        "success": False,
                        "error": str(e),
                    }
                )

        # Mark checkpoint as restored
        checkpoint.status = "restored"

        # Mark any checkpoints after this one as superseded
        for cp in checkpoints:
            if cp.checkpoint_number > checkpoint.checkpoint_number:
                cp.status = "superseded"

        logger.info(
            "Restored checkpoint",
            checkpoint_id=checkpoint_id,
            files_restored=len([r for r in results if r["success"]]),
        )

        return {
            "success": all(r["success"] for r in results),
            "checkpoint_id": checkpoint_id,
            "files": results,
        }

    def get_checkpoints(
        self,
        session_id: str,
        agent_id: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Get checkpoints for a session.

        Args:
            session_id: The session ID.
            agent_id: Optional filter by agent.
            limit: Maximum number of checkpoints to return.

        Returns:
            List of checkpoint summaries.
        """
        checkpoints = self.checkpoints.get(session_id, [])

        if agent_id:
            checkpoints = [c for c in checkpoints if c.agent_id == agent_id]

        # Sort by checkpoint number descending (most recent first)
        checkpoints = sorted(checkpoints, key=lambda c: c.checkpoint_number, reverse=True)[:limit]

        return [
            {
                "id": cp.id,
                "checkpoint_number": cp.checkpoint_number,
                "description": cp.description,
                "action_type": cp.action_type,
                "agent_id": cp.agent_id,
                "status": cp.status,
                "created_at": cp.created_at.isoformat(),
                "files": [
                    {
                        "path": f.file_path,
                        "change_type": f.change_type,
                        "lines_added": f.lines_added,
                        "lines_removed": f.lines_removed,
                    }
                    for f in cp.files
                ],
                "file_count": len(cp.files),
                "total_lines_added": sum(f.lines_added for f in cp.files),
                "total_lines_removed": sum(f.lines_removed for f in cp.files),
            }
            for cp in checkpoints
        ]

    def get_checkpoint_diff(self, session_id: str, checkpoint_id: str) -> dict[str, Any]:
        """Get the full diff for a checkpoint.

        Args:
            session_id: The session ID.
            checkpoint_id: The checkpoint ID.

        Returns:
            Dict with file diffs.
        """
        checkpoints = self.checkpoints.get(session_id, [])
        checkpoint = next((c for c in checkpoints if c.id == checkpoint_id), None)

        if not checkpoint:
            return {"error": "Checkpoint not found"}

        return {
            "id": checkpoint.id,
            "description": checkpoint.description,
            "files": [
                {
                    "path": f.file_path,
                    "change_type": f.change_type,
                    "content_before": f.content_before,
                    "content_after": f.content_after,
                    "lines_added": f.lines_added,
                    "lines_removed": f.lines_removed,
                }
                for f in checkpoint.files
            ],
        }

    def clear_session_checkpoints(self, session_id: str) -> None:
        """Clear all checkpoints for a session.

        Args:
            session_id: The session ID.
        """
        if session_id in self.checkpoints:
            del self.checkpoints[session_id]
        if session_id in self._checkpoint_counters:
            del self._checkpoint_counters[session_id]
        logger.info("Cleared session checkpoints", session_id=session_id)


# Global checkpoint manager instance (initialized per workspace)
_checkpoint_managers: dict[str, CheckpointManager] = {}


def get_checkpoint_manager(workspace_path: str) -> CheckpointManager:
    """Get or create a checkpoint manager for a workspace.

    Args:
        workspace_path: Path to the workspace.

    Returns:
        CheckpointManager instance.
    """
    if workspace_path not in _checkpoint_managers:
        _checkpoint_managers[workspace_path] = CheckpointManager(workspace_path)
    return _checkpoint_managers[workspace_path]
