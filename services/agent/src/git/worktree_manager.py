"""Git worktree manager for parallel agent execution."""

import asyncio
import contextlib
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger()


class WorktreeStatus(str, Enum):
    """Status of a git worktree."""

    CREATING = "creating"
    ACTIVE = "active"
    MERGING = "merging"
    MERGED = "merged"
    CONFLICT = "conflict"
    CLEANUP = "cleanup"
    DELETED = "deleted"
    FAILED = "failed"


@dataclass
class GitWorktree:
    """Represents a git worktree for an agent."""

    id: str
    agent_id: str
    session_id: str
    main_repo_path: str
    worktree_path: str
    branch_name: str
    base_branch: str
    status: WorktreeStatus = WorktreeStatus.CREATING
    files_modified: list[str] = field(default_factory=list)
    commits: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    merged_at: datetime | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "agent_id": self.agent_id,
            "session_id": self.session_id,
            "worktree_path": self.worktree_path,
            "branch_name": self.branch_name,
            "base_branch": self.base_branch,
            "status": self.status.value,
            "files_modified": self.files_modified,
            "commits": self.commits,
            "created_at": self.created_at.isoformat(),
            "merged_at": self.merged_at.isoformat() if self.merged_at else None,
            "error": self.error,
        }


class GitWorktreeManager:
    """
    Manages git worktrees for parallel agent execution.

    Features:
    - Create isolated worktrees for each parallel agent
    - Track file modifications across worktrees
    - Detect and handle merge conflicts
    - Merge worktree changes back to main branch
    - Cleanup worktrees after completion
    """

    WORKTREE_PREFIX = ".podex-worktrees"

    def __init__(self, base_path: str | None = None):
        self._base_path = base_path
        self._worktrees: dict[str, GitWorktree] = {}
        self._agent_worktrees: dict[str, str] = {}  # agent_id -> worktree_id

    async def create_worktree(
        self,
        agent_id: str,
        session_id: str,
        repo_path: str,
        base_branch: str = "main",
        branch_prefix: str = "agent",
    ) -> GitWorktree:
        """
        Create a new worktree for an agent.

        Args:
            agent_id: The agent ID
            session_id: The session ID
            repo_path: Path to the main git repository
            base_branch: Branch to base the worktree on
            branch_prefix: Prefix for the new branch name

        Returns:
            GitWorktree object
        """
        worktree_id = str(uuid.uuid4())[:8]
        branch_name = f"{branch_prefix}/{agent_id[:8]}-{worktree_id}"
        worktree_dir = Path(repo_path) / self.WORKTREE_PREFIX / worktree_id

        worktree = GitWorktree(
            id=worktree_id,
            agent_id=agent_id,
            session_id=session_id,
            main_repo_path=repo_path,
            worktree_path=str(worktree_dir),
            branch_name=branch_name,
            base_branch=base_branch,
        )

        self._worktrees[worktree_id] = worktree
        self._agent_worktrees[agent_id] = worktree_id

        try:
            # Ensure worktrees directory exists
            worktree_dir.parent.mkdir(parents=True, exist_ok=True)

            # Create the worktree with a new branch
            await self._run_git(
                repo_path, ["worktree", "add", "-b", branch_name, str(worktree_dir), base_branch]
            )

            worktree.status = WorktreeStatus.ACTIVE
            logger.info(
                "worktree_created",
                worktree_id=worktree_id,
                agent_id=agent_id,
                branch=branch_name,
                path=str(worktree_dir),
            )

        except Exception as e:
            worktree.status = WorktreeStatus.FAILED
            worktree.error = str(e)
            logger.error(
                "worktree_creation_failed",
                worktree_id=worktree_id,
                error=str(e),
            )
            raise

        return worktree

    async def get_worktree(self, worktree_id: str) -> GitWorktree | None:
        """Get a worktree by ID."""
        return self._worktrees.get(worktree_id)

    async def get_agent_worktree(self, agent_id: str) -> GitWorktree | None:
        """Get the worktree for an agent."""
        worktree_id = self._agent_worktrees.get(agent_id)
        if worktree_id:
            return self._worktrees.get(worktree_id)
        return None

    async def get_session_worktrees(self, session_id: str) -> list[GitWorktree]:
        """Get all worktrees for a session."""
        return [w for w in self._worktrees.values() if w.session_id == session_id]

    async def track_file_change(
        self,
        worktree_id: str,
        file_path: str,
    ) -> None:
        """Track a file modification in a worktree."""
        worktree = self._worktrees.get(worktree_id)
        if worktree and file_path not in worktree.files_modified:
            worktree.files_modified.append(file_path)

    async def commit_changes(
        self,
        worktree_id: str,
        message: str,
        author: str | None = None,
    ) -> str | None:
        """
        Commit changes in a worktree.

        Returns:
            The commit hash if successful, None otherwise
        """
        worktree = self._worktrees.get(worktree_id)
        if not worktree:
            return None

        try:
            # Stage all changes
            await self._run_git(worktree.worktree_path, ["add", "-A"])

            # Check if there are changes to commit
            status = await self._run_git(worktree.worktree_path, ["status", "--porcelain"])
            if not status.strip():
                return None  # No changes

            # Commit
            commit_args = ["commit", "-m", message]
            if author:
                commit_args.extend(["--author", author])

            await self._run_git(worktree.worktree_path, commit_args)

            # Get commit hash
            commit_hash = await self._run_git(worktree.worktree_path, ["rev-parse", "HEAD"])
            commit_hash = commit_hash.strip()
            worktree.commits.append(commit_hash)

            logger.info(
                "worktree_commit",
                worktree_id=worktree_id,
                commit=commit_hash[:8],
                message=message[:50],
            )

            return commit_hash

        except Exception as e:
            logger.error(
                "worktree_commit_failed",
                worktree_id=worktree_id,
                error=str(e),
            )
            return None

    async def check_conflicts(
        self,
        worktree_id: str,
        other_worktree_ids: list[str] | None = None,
    ) -> list[str]:
        """
        Check for conflicts between a worktree and main branch or other worktrees.

        Returns:
            List of conflicting file paths
        """
        worktree = self._worktrees.get(worktree_id)
        if not worktree:
            return []

        conflicts = []

        try:
            # Fetch latest from origin
            await self._run_git(worktree.worktree_path, ["fetch", "origin"])

            # Check merge conflicts with base branch
            merge_base = await self._run_git(
                worktree.worktree_path, ["merge-base", "HEAD", f"origin/{worktree.base_branch}"]
            )

            # Get files changed in both branches
            our_changes = await self._run_git(
                worktree.worktree_path, ["diff", "--name-only", merge_base.strip(), "HEAD"]
            )
            their_changes = await self._run_git(
                worktree.worktree_path,
                ["diff", "--name-only", merge_base.strip(), f"origin/{worktree.base_branch}"],
            )

            our_files = set(our_changes.strip().split("\n")) if our_changes.strip() else set()
            their_files = set(their_changes.strip().split("\n")) if their_changes.strip() else set()

            # Files modified in both are potential conflicts
            conflicts.extend(list(our_files & their_files))

            # Check conflicts with other worktrees
            if other_worktree_ids:
                for other_id in other_worktree_ids:
                    other = self._worktrees.get(other_id)
                    if other and other.id != worktree_id:
                        # Check overlapping modified files
                        overlap = set(worktree.files_modified) & set(other.files_modified)
                        conflicts.extend(list(overlap))

            # Deduplicate
            conflicts = list(set(conflicts))

            if conflicts:
                worktree.status = WorktreeStatus.CONFLICT
                logger.warning(
                    "worktree_conflicts_detected",
                    worktree_id=worktree_id,
                    conflicts=conflicts,
                )

        except Exception as e:
            logger.error(
                "conflict_check_failed",
                worktree_id=worktree_id,
                error=str(e),
            )

        return conflicts

    async def merge_to_main(
        self,
        worktree_id: str,
        squash: bool = False,
        delete_branch: bool = True,
    ) -> bool:
        """
        Merge worktree changes back to main branch.

        Args:
            worktree_id: The worktree ID
            squash: Whether to squash commits
            delete_branch: Whether to delete the branch after merge

        Returns:
            True if merge was successful
        """
        worktree = self._worktrees.get(worktree_id)
        if not worktree:
            return False

        worktree.status = WorktreeStatus.MERGING

        try:
            # Switch to main branch in main repo
            await self._run_git(worktree.main_repo_path, ["checkout", worktree.base_branch])

            # Pull latest
            await self._run_git(worktree.main_repo_path, ["pull", "origin", worktree.base_branch])

            # Merge worktree branch
            merge_args = ["merge"]
            if squash:
                merge_args.append("--squash")
            merge_args.append(worktree.branch_name)

            await self._run_git(worktree.main_repo_path, merge_args)

            if squash:
                # Need to commit after squash
                await self._run_git(
                    worktree.main_repo_path,
                    ["commit", "-m", f"Merge agent changes from {worktree.branch_name}"],
                )

            worktree.status = WorktreeStatus.MERGED
            worktree.merged_at = datetime.utcnow()

            logger.info(
                "worktree_merged",
                worktree_id=worktree_id,
                branch=worktree.branch_name,
                squash=squash,
            )

            # Cleanup
            if delete_branch:
                await self.delete_worktree(worktree_id)

            return True

        except Exception as e:
            worktree.status = WorktreeStatus.CONFLICT
            worktree.error = str(e)
            logger.error(
                "worktree_merge_failed",
                worktree_id=worktree_id,
                error=str(e),
            )
            return False

    async def delete_worktree(self, worktree_id: str) -> bool:
        """Delete a worktree and cleanup."""
        worktree = self._worktrees.get(worktree_id)
        if not worktree:
            return False

        worktree.status = WorktreeStatus.CLEANUP

        try:
            # Remove worktree
            await self._run_git(
                worktree.main_repo_path, ["worktree", "remove", "--force", worktree.worktree_path]
            )

            # Delete branch (if not already deleted during prune)
            with contextlib.suppress(Exception):
                await self._run_git(worktree.main_repo_path, ["branch", "-D", worktree.branch_name])

            worktree.status = WorktreeStatus.DELETED

            # Remove from tracking
            if worktree.agent_id in self._agent_worktrees:
                del self._agent_worktrees[worktree.agent_id]

            logger.info("worktree_deleted", worktree_id=worktree_id)
            return True

        except Exception as e:
            worktree.error = str(e)
            logger.error(
                "worktree_deletion_failed",
                worktree_id=worktree_id,
                error=str(e),
            )
            return False

    async def cleanup_session_worktrees(self, session_id: str) -> int:
        """Cleanup all worktrees for a session."""
        worktrees = await self.get_session_worktrees(session_id)
        deleted = 0
        for wt in worktrees:
            if await self.delete_worktree(wt.id):
                deleted += 1
        return deleted

    async def _run_git(self, cwd: str, args: list[str]) -> str:
        """Run a git command and return output."""
        process = await asyncio.create_subprocess_exec(
            "git",
            *args,
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()

        if process.returncode != 0:
            error = (
                stderr.decode() if stderr else f"Git command failed with code {process.returncode}"
            )
            raise RuntimeError(error)

        return stdout.decode()

    def get_worktree_stats(self, session_id: str) -> dict[str, Any]:
        """Get statistics about worktrees for a session."""
        worktrees = [w for w in self._worktrees.values() if w.session_id == session_id]
        return {
            "total": len(worktrees),
            "active": sum(1 for w in worktrees if w.status == WorktreeStatus.ACTIVE),
            "merged": sum(1 for w in worktrees if w.status == WorktreeStatus.MERGED),
            "conflicts": sum(1 for w in worktrees if w.status == WorktreeStatus.CONFLICT),
            "files_modified": sum(len(w.files_modified) for w in worktrees),
            "total_commits": sum(len(w.commits) for w in worktrees),
        }


# Global instance
_manager: GitWorktreeManager | None = None


def get_worktree_manager() -> GitWorktreeManager:
    """Get or create the global worktree manager."""
    global _manager
    if _manager is None:
        _manager = GitWorktreeManager()
    return _manager
