"""Merge results from parallel agent execution."""

import difflib
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any

import structlog

from .conflict_detector import Conflict

logger = structlog.get_logger()


class MergeStrategy(str, Enum):
    """Strategy for merging parallel agent results."""

    FIRST_WINS = "first_wins"  # First agent's changes take priority
    LAST_WINS = "last_wins"  # Last agent's changes take priority
    UNION = "union"  # Combine non-conflicting changes
    LLM_ASSISTED = "llm_assisted"  # Use LLM to resolve conflicts
    MANUAL = "manual"  # Require manual resolution


class MergeStatus(str, Enum):
    """Status of a merge operation."""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CONFLICTS = "conflicts"
    FAILED = "failed"


@dataclass
class FileVersion:
    """A version of a file from an agent."""

    agent_id: str
    file_path: str
    content: str
    timestamp: datetime
    commit_hash: str | None = None


@dataclass
class MergeResult:
    """Result of merging file versions."""

    file_path: str
    merged_content: str | None
    success: bool
    strategy_used: MergeStrategy
    conflicts_resolved: int = 0
    manual_review_needed: bool = False
    conflict_markers: list[tuple[int, int]] = field(default_factory=list)  # (start_line, end_line)
    contributors: list[str] = field(default_factory=list)  # agent_ids that contributed


@dataclass
class MergeOperation:
    """A merge operation across multiple agents."""

    id: str
    session_id: str
    strategy: MergeStrategy
    status: MergeStatus
    agent_ids: list[str]
    files_merged: list[str] = field(default_factory=list)
    results: list[MergeResult] = field(default_factory=list)
    conflicts: list[Conflict] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    completed_at: datetime | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "session_id": self.session_id,
            "strategy": self.strategy.value,
            "status": self.status.value,
            "agent_ids": self.agent_ids,
            "files_merged": self.files_merged,
            "results": [
                {
                    "file_path": r.file_path,
                    "success": r.success,
                    "strategy_used": r.strategy_used.value,
                    "conflicts_resolved": r.conflicts_resolved,
                    "manual_review_needed": r.manual_review_needed,
                    "contributors": r.contributors,
                }
                for r in self.results
            ],
            "conflict_count": len(self.conflicts),
            "created_at": self.created_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "error": self.error,
        }


class ParallelResultsMerger:
    """
    Merges results from parallel agent execution.

    Features:
    - Multiple merge strategies
    - Three-way merge support
    - LLM-assisted conflict resolution
    - Conflict marker generation
    - Merge operation history
    """

    def __init__(self, llm_client: Any = None):
        self._llm_client = llm_client
        self._operations: dict[str, MergeOperation] = {}

    async def merge_file_versions(
        self,
        base_content: str,
        versions: list[FileVersion],
        strategy: MergeStrategy = MergeStrategy.UNION,
    ) -> MergeResult:
        """
        Merge multiple versions of a file.

        Args:
            base_content: The original file content
            versions: List of file versions from different agents
            strategy: Merge strategy to use

        Returns:
            MergeResult with merged content
        """
        if not versions:
            return MergeResult(
                file_path="",
                merged_content=base_content,
                success=True,
                strategy_used=strategy,
            )

        file_path = versions[0].file_path
        contributors = [v.agent_id for v in versions]

        if len(versions) == 1:
            # Single version - no merge needed
            return MergeResult(
                file_path=file_path,
                merged_content=versions[0].content,
                success=True,
                strategy_used=strategy,
                contributors=contributors,
            )

        # Sort by timestamp
        sorted_versions = sorted(versions, key=lambda v: v.timestamp)

        if strategy == MergeStrategy.FIRST_WINS:
            return MergeResult(
                file_path=file_path,
                merged_content=sorted_versions[0].content,
                success=True,
                strategy_used=strategy,
                contributors=[sorted_versions[0].agent_id],
            )

        elif strategy == MergeStrategy.LAST_WINS:
            return MergeResult(
                file_path=file_path,
                merged_content=sorted_versions[-1].content,
                success=True,
                strategy_used=strategy,
                contributors=[sorted_versions[-1].agent_id],
            )

        elif strategy == MergeStrategy.UNION:
            return self._union_merge(base_content, sorted_versions, file_path)

        elif strategy == MergeStrategy.LLM_ASSISTED:
            return await self._llm_merge(base_content, sorted_versions, file_path)

        else:  # MANUAL
            return self._manual_merge(base_content, sorted_versions, file_path)

    def _union_merge(
        self,
        base_content: str,
        versions: list[FileVersion],
        file_path: str,
    ) -> MergeResult:
        """
        Merge using union strategy - combine non-conflicting changes.
        """
        base_lines = base_content.splitlines(keepends=True)
        merged_lines = list(base_lines)
        contributors = []
        conflicts_resolved = 0
        conflict_markers = []

        for version in versions:
            version_lines = version.content.splitlines(keepends=True)

            # Find differences using SequenceMatcher
            matcher = difflib.SequenceMatcher(None, merged_lines, version_lines)

            new_merged = []

            for tag, i1, i2, j1, j2 in matcher.get_opcodes():
                if tag == "equal":
                    new_merged.extend(merged_lines[i1:i2])
                elif tag == "insert":
                    new_merged.extend(version_lines[j1:j2])
                    contributors.append(version.agent_id)
                elif tag == "delete":
                    # Keep deletions from version
                    pass
                elif tag == "replace":
                    # This is a potential conflict
                    if self._can_auto_resolve(merged_lines[i1:i2], version_lines[j1:j2]):
                        # Prefer the version's changes
                        new_merged.extend(version_lines[j1:j2])
                        conflicts_resolved += 1
                    else:
                        # Add conflict markers
                        start_line = len(new_merged)
                        new_merged.append("<<<<<<< CURRENT\n")
                        new_merged.extend(merged_lines[i1:i2])
                        new_merged.append("=======\n")
                        new_merged.extend(version_lines[j1:j2])
                        new_merged.append(f">>>>>>> {version.agent_id[:8]}\n")
                        end_line = len(new_merged)
                        conflict_markers.append((start_line, end_line))

            merged_lines = new_merged

            if version.agent_id not in contributors:
                contributors.append(version.agent_id)

        merged_content = "".join(merged_lines)

        return MergeResult(
            file_path=file_path,
            merged_content=merged_content,
            success=not conflict_markers,
            strategy_used=MergeStrategy.UNION,
            conflicts_resolved=conflicts_resolved,
            manual_review_needed=bool(conflict_markers),
            conflict_markers=conflict_markers,
            contributors=list(set(contributors)),
        )

    def _can_auto_resolve(
        self,
        current_lines: list[str],
        new_lines: list[str],
    ) -> bool:
        """Check if a conflict can be auto-resolved."""
        # Simple heuristics
        current = "".join(current_lines).strip()
        new = "".join(new_lines).strip()

        # Identical after stripping
        if current == new:
            return True

        # One is a subset of the other
        if current in new or new in current:
            return True

        # Very small change
        if len(current_lines) <= 1 and len(new_lines) <= 1:
            return True

        return False

    async def _llm_merge(
        self,
        base_content: str,
        versions: list[FileVersion],
        file_path: str,
    ) -> MergeResult:
        """
        Use LLM to intelligently merge conflicting changes.
        """
        if not self._llm_client:
            # Fall back to union merge
            return self._union_merge(base_content, versions, file_path)

        # First try union merge
        union_result = self._union_merge(base_content, versions, file_path)

        if union_result.success:
            return union_result

        # Use LLM to resolve conflicts
        prompt = f"""You are a code merge assistant. Resolve the merge conflicts below.

Original file:
```
{base_content[:2000]}
```

Current merged state with conflict markers:
```
{union_result.merged_content[:4000] if union_result.merged_content else ""}
```

Instructions:
1. Review the conflict markers (<<<<<<< / ======= / >>>>>>>)
2. Choose the best resolution for each conflict
3. Return ONLY the resolved file content, no explanations

Resolved file:"""

        try:
            resolved = await self._llm_client.generate(
                prompt=prompt,
                max_tokens=4000,
            )

            # Clean up LLM response
            resolved = resolved.strip()
            if resolved.startswith("```"):
                lines = resolved.split("\n")
                resolved = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])

            return MergeResult(
                file_path=file_path,
                merged_content=resolved,
                success=True,
                strategy_used=MergeStrategy.LLM_ASSISTED,
                conflicts_resolved=len(union_result.conflict_markers),
                contributors=[v.agent_id for v in versions],
            )

        except Exception as e:
            logger.error("llm_merge_failed", file=file_path, error=str(e))
            # Return the union result with conflicts
            return union_result

    def _manual_merge(
        self,
        base_content: str,
        versions: list[FileVersion],
        file_path: str,
    ) -> MergeResult:
        """
        Prepare for manual merge by adding conflict markers.
        """
        # Use union merge but mark as needing manual review
        result = self._union_merge(base_content, versions, file_path)
        result.strategy_used = MergeStrategy.MANUAL
        result.manual_review_needed = True
        return result

    async def create_merge_operation(
        self,
        session_id: str,
        agent_ids: list[str],
        strategy: MergeStrategy = MergeStrategy.UNION,
    ) -> MergeOperation:
        """Create a new merge operation."""
        import uuid

        operation = MergeOperation(
            id=str(uuid.uuid4()),
            session_id=session_id,
            strategy=strategy,
            status=MergeStatus.PENDING,
            agent_ids=agent_ids,
        )
        self._operations[operation.id] = operation
        return operation

    async def execute_merge(
        self,
        operation_id: str,
        file_versions: dict[str, list[FileVersion]],  # file_path -> versions
        base_contents: dict[str, str],  # file_path -> base content
    ) -> MergeOperation:
        """
        Execute a merge operation.

        Args:
            operation_id: The merge operation ID
            file_versions: Versions of each file from agents
            base_contents: Original content of each file

        Returns:
            Updated MergeOperation
        """
        operation = self._operations.get(operation_id)
        if not operation:
            raise ValueError(f"Operation not found: {operation_id}")

        operation.status = MergeStatus.IN_PROGRESS

        try:
            for file_path, versions in file_versions.items():
                base = base_contents.get(file_path, "")

                result = await self.merge_file_versions(
                    base_content=base,
                    versions=versions,
                    strategy=operation.strategy,
                )

                operation.results.append(result)
                if result.success:
                    operation.files_merged.append(file_path)

            # Check overall status
            has_conflicts = any(not r.success for r in operation.results)
            operation.status = MergeStatus.CONFLICTS if has_conflicts else MergeStatus.COMPLETED
            operation.completed_at = datetime.utcnow()

            logger.info(
                "merge_operation_completed",
                operation_id=operation_id,
                files_merged=len(operation.files_merged),
                has_conflicts=has_conflicts,
            )

        except Exception as e:
            operation.status = MergeStatus.FAILED
            operation.error = str(e)
            logger.error(
                "merge_operation_failed",
                operation_id=operation_id,
                error=str(e),
            )

        return operation

    def get_operation(self, operation_id: str) -> MergeOperation | None:
        """Get a merge operation by ID."""
        return self._operations.get(operation_id)

    def get_session_operations(self, session_id: str) -> list[MergeOperation]:
        """Get all merge operations for a session."""
        return [op for op in self._operations.values() if op.session_id == session_id]


# Global instance
_merger: ParallelResultsMerger | None = None


def get_results_merger() -> ParallelResultsMerger:
    """Get or create the global results merger."""
    global _merger
    if _merger is None:
        _merger = ParallelResultsMerger()
    return _merger
