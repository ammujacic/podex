"""Service for tracking and aggregating productivity metrics.

This service receives events from various sources and aggregates them
into daily ProductivityMetric records using an upsert pattern.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import ProductivityMetric

logger = structlog.get_logger()


# ============================================================================
# Language Detection
# ============================================================================

EXTENSION_TO_LANGUAGE: dict[str, str] = {
    # JavaScript/TypeScript
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    # Python
    ".py": "Python",
    ".pyi": "Python",
    ".pyx": "Python",
    # Web
    ".html": "HTML",
    ".htm": "HTML",
    ".css": "CSS",
    ".scss": "SCSS",
    ".sass": "SASS",
    ".less": "Less",
    # Data
    ".json": "JSON",
    ".yaml": "YAML",
    ".yml": "YAML",
    ".toml": "TOML",
    ".xml": "XML",
    # Systems
    ".go": "Go",
    ".rs": "Rust",
    ".c": "C",
    ".cpp": "C++",
    ".cc": "C++",
    ".h": "C",
    ".hpp": "C++",
    ".java": "Java",
    ".kt": "Kotlin",
    ".swift": "Swift",
    # Scripting
    ".sh": "Shell",
    ".bash": "Shell",
    ".zsh": "Shell",
    ".rb": "Ruby",
    ".php": "PHP",
    ".pl": "Perl",
    # Other
    ".sql": "SQL",
    ".md": "Markdown",
    ".proto": "Protocol Buffers",
    ".graphql": "GraphQL",
    ".vue": "Vue",
    ".svelte": "Svelte",
    ".r": "R",
    ".scala": "Scala",
    ".ex": "Elixir",
    ".exs": "Elixir",
    ".clj": "Clojure",
    ".hs": "Haskell",
    ".lua": "Lua",
    ".dart": "Dart",
    ".cs": "C#",
    ".fs": "F#",
}


def detect_language(file_path: str) -> str:
    """Detect programming language from file extension."""
    path = Path(file_path)
    ext = path.suffix.lower()

    # Handle Dockerfile special case
    if path.name.lower() in ("dockerfile", "containerfile"):
        return "Docker"

    # Handle Makefile
    if path.name.lower() == "makefile":
        return "Makefile"

    return EXTENSION_TO_LANGUAGE.get(ext, "Other")


# ============================================================================
# Time Saved Estimation
# ============================================================================

# Heuristic constants for time saved estimation
TOKENS_PER_MINUTE_TYPING = 30  # Average tokens a developer types per minute
SUGGESTION_ACCEPTED_MINUTES = 2  # Average time saved per accepted suggestion
TASK_COMPLETED_MINUTES = 10  # Average time saved per completed agent task


def estimate_time_saved(
    tokens_generated: int = 0,
    suggestions_accepted: int = 0,
    tasks_completed: int = 0,
) -> int:
    """Estimate time saved in minutes based on productivity metrics.

    Heuristic approach:
    - Code generation: tokens / typing_speed gives minutes saved
    - Accepted suggestions: each saves ~2 minutes of thinking/typing
    - Completed tasks: each saves ~10 minutes on average

    Returns:
        Total estimated minutes saved.
    """
    by_code_gen = int(tokens_generated / TOKENS_PER_MINUTE_TYPING)
    by_suggestions = suggestions_accepted * SUGGESTION_ACCEPTED_MINUTES
    by_tasks = tasks_completed * TASK_COMPLETED_MINUTES

    return by_code_gen + by_suggestions + by_tasks


# ============================================================================
# ProductivityTrackingService
# ============================================================================


class ProductivityTrackingService:
    """Service for tracking and aggregating productivity metrics.

    Uses get-or-create pattern to aggregate metrics into daily records.
    All operations are wrapped in try/except to not disrupt primary operations.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _get_or_create_daily_metric(
        self,
        user_id: str,
        metric_date: date | None = None,
    ) -> ProductivityMetric:
        """Get or create a ProductivityMetric record for the given day."""
        if metric_date is None:
            metric_date = datetime.now(UTC).date()

        # Convert date to datetime for comparison
        start_of_day = datetime.combine(metric_date, datetime.min.time(), tzinfo=UTC)
        end_of_day = start_of_day + timedelta(days=1)

        # Try to get existing record
        query = select(ProductivityMetric).where(
            ProductivityMetric.user_id == user_id,
            ProductivityMetric.date >= start_of_day,
            ProductivityMetric.date < end_of_day,
        )
        result = await self.db.execute(query)
        metric = result.scalar_one_or_none()

        if metric:
            return metric

        # Create new record with defaults
        metric = ProductivityMetric(
            user_id=user_id,
            date=start_of_day,
            lines_written=0,
            lines_deleted=0,
            files_modified=0,
            commits_count=0,
            agent_messages_sent=0,
            agent_suggestions_accepted=0,
            agent_suggestions_rejected=0,
            agent_tasks_completed=0,
            active_session_minutes=0,
            coding_minutes=0,
            estimated_time_saved_minutes=0,
            language_breakdown={},
            agent_usage_breakdown={},
            current_streak_days=0,
            longest_streak_days=0,
        )
        self.db.add(metric)
        await self.db.flush()
        return metric

    # ========================================================================
    # Agent Message Tracking
    # ========================================================================

    async def track_agent_message(
        self,
        user_id: str,
        agent_role: str | None = None,
        tokens_used: int = 0,
    ) -> None:
        """Track when an agent sends a message response.

        Called after agent message is saved to database.

        Args:
            user_id: ID of the user who received the message
            agent_role: Role of the agent (coder, reviewer, etc.)
            tokens_used: Number of tokens in the response
        """
        try:
            metric = await self._get_or_create_daily_metric(user_id)

            # Increment message count
            metric.agent_messages_sent += 1

            # Update agent usage breakdown if role provided
            if agent_role:
                breakdown = dict(metric.agent_usage_breakdown or {})
                breakdown[agent_role] = breakdown.get(agent_role, 0) + 1
                metric.agent_usage_breakdown = breakdown

            # Estimate time saved from token generation
            time_saved = estimate_time_saved(tokens_generated=tokens_used)
            metric.estimated_time_saved_minutes += time_saved

            await self.db.commit()

            logger.debug(
                "Tracked agent message",
                user_id=user_id,
                agent_role=agent_role,
                tokens_used=tokens_used,
                daily_messages=metric.agent_messages_sent,
            )
        except Exception:
            logger.exception("Failed to track agent message", user_id=user_id)
            # Don't re-raise - tracking failures shouldn't affect primary operations

    # ========================================================================
    # Approval/Rejection Tracking
    # ========================================================================

    async def track_suggestion_response(
        self,
        user_id: str,
        accepted: bool,
    ) -> None:
        """Track when a user accepts or rejects an agent suggestion.

        Called after AgentPendingApproval status changes to approved/rejected.

        Args:
            user_id: ID of the user who responded
            accepted: True if approved, False if rejected
        """
        try:
            metric = await self._get_or_create_daily_metric(user_id)

            if accepted:
                metric.agent_suggestions_accepted += 1
                # Add time saved for accepted suggestion
                time_saved = estimate_time_saved(suggestions_accepted=1)
                metric.estimated_time_saved_minutes += time_saved
            else:
                metric.agent_suggestions_rejected += 1

            await self.db.commit()

            logger.debug(
                "Tracked suggestion response",
                user_id=user_id,
                accepted=accepted,
                total_accepted=metric.agent_suggestions_accepted,
                total_rejected=metric.agent_suggestions_rejected,
            )
        except Exception:
            logger.exception("Failed to track suggestion response", user_id=user_id)

    async def track_task_completed(self, user_id: str) -> None:
        """Track when an agent task is completed.

        Args:
            user_id: ID of the user
        """
        try:
            metric = await self._get_or_create_daily_metric(user_id)

            metric.agent_tasks_completed += 1

            # Add time saved for completed task
            time_saved = estimate_time_saved(tasks_completed=1)
            metric.estimated_time_saved_minutes += time_saved

            await self.db.commit()

            logger.debug(
                "Tracked task completed",
                user_id=user_id,
                total_tasks=metric.agent_tasks_completed,
            )
        except Exception:
            logger.exception("Failed to track task completed", user_id=user_id)

    # ========================================================================
    # Git/Code Change Tracking
    # ========================================================================

    async def track_commit(
        self,
        user_id: str,
        files_changed: list[dict[str, Any]],
    ) -> None:
        """Track a git commit with file changes.

        Called after a commit is made via git routes.

        Args:
            user_id: ID of the user who made the commit
            files_changed: List of file change dicts with:
                - path: str
                - additions: int
                - deletions: int
        """
        try:
            metric = await self._get_or_create_daily_metric(user_id)

            # Increment commit count
            metric.commits_count += 1

            # Track unique files modified
            unique_files: set[str] = set()
            total_additions = 0
            total_deletions = 0
            language_changes: dict[str, int] = {}

            for file_change in files_changed:
                path = file_change.get("path", "")
                additions = file_change.get("additions", 0)
                deletions = file_change.get("deletions", 0)

                # Handle binary files (additions/deletions might be "-")
                if isinstance(additions, str):
                    additions = 0
                if isinstance(deletions, str):
                    deletions = 0

                unique_files.add(path)
                total_additions += additions
                total_deletions += deletions

                # Track language breakdown by additions
                if additions > 0:
                    language = detect_language(path)
                    language_changes[language] = language_changes.get(language, 0) + additions

            # Update metrics
            metric.lines_written += total_additions
            metric.lines_deleted += total_deletions
            metric.files_modified += len(unique_files)

            # Merge language breakdown
            breakdown = dict(metric.language_breakdown or {})
            for lang, lines in language_changes.items():
                breakdown[lang] = breakdown.get(lang, 0) + lines
            metric.language_breakdown = breakdown

            await self.db.commit()

            logger.debug(
                "Tracked commit",
                user_id=user_id,
                files=len(unique_files),
                additions=total_additions,
                deletions=total_deletions,
                daily_commits=metric.commits_count,
            )
        except Exception:
            logger.exception("Failed to track commit", user_id=user_id)

    # ========================================================================
    # Session Activity Tracking
    # ========================================================================

    async def track_session_activity(
        self,
        user_id: str,
        active_minutes: int,
        coding_minutes: int | None = None,
    ) -> None:
        """Track session activity duration.

        Called periodically or on session leave to update activity time.

        Args:
            user_id: ID of the user
            active_minutes: Minutes of active session time to add
            coding_minutes: Minutes of coding time to add (defaults to active_minutes)
        """
        try:
            if coding_minutes is None:
                coding_minutes = active_minutes

            metric = await self._get_or_create_daily_metric(user_id)

            metric.active_session_minutes += active_minutes
            metric.coding_minutes += coding_minutes

            await self.db.commit()

            logger.debug(
                "Tracked session activity",
                user_id=user_id,
                added_active_minutes=active_minutes,
                added_coding_minutes=coding_minutes,
                daily_active_minutes=metric.active_session_minutes,
            )
        except Exception:
            logger.exception("Failed to track session activity", user_id=user_id)

    # ========================================================================
    # Streak Calculation
    # ========================================================================

    async def update_streaks(self, user_id: str) -> None:
        """Update coding streak for a user.

        A coding day is defined as a day with:
        - coding_minutes > 0 OR
        - commits_count > 0 OR
        - lines_written > 0

        This should be called when viewing metrics or at end of day.
        """
        try:
            today = datetime.now(UTC).date()

            # Get recent metrics ordered by date descending
            query = (
                select(ProductivityMetric)
                .where(ProductivityMetric.user_id == user_id)
                .order_by(ProductivityMetric.date.desc())
                .limit(365)  # Look back up to a year
            )
            result = await self.db.execute(query)
            metrics = list(result.scalars().all())

            if not metrics:
                return

            # Calculate current streak
            current_streak = 0
            expected_date = today

            for metric in metrics:
                metric_date = (
                    metric.date.date() if isinstance(metric.date, datetime) else metric.date
                )

                # Check if this is a coding day
                is_coding_day = (
                    metric.coding_minutes > 0
                    or metric.commits_count > 0
                    or metric.lines_written > 0
                )

                # Check if date matches expected (allowing for today having no activity yet)
                if metric_date == expected_date:
                    if is_coding_day:
                        current_streak += 1
                    expected_date = metric_date - timedelta(days=1)
                elif metric_date == expected_date - timedelta(days=1):
                    # Yesterday - continue if it was a coding day
                    if is_coding_day:
                        current_streak += 1
                        expected_date = metric_date - timedelta(days=1)
                    else:
                        # Gap with no coding breaks streak
                        break
                else:
                    # Gap in dates breaks streak
                    break

            # Get historical longest streak
            longest_streak = max((m.longest_streak_days for m in metrics), default=0)
            longest_streak = max(longest_streak, current_streak)

            # Update today's metric
            today_metric = await self._get_or_create_daily_metric(user_id, today)
            today_metric.current_streak_days = current_streak
            today_metric.longest_streak_days = longest_streak

            await self.db.commit()

            logger.debug(
                "Updated streaks",
                user_id=user_id,
                current_streak=current_streak,
                longest_streak=longest_streak,
            )
        except Exception:
            logger.exception("Failed to update streaks", user_id=user_id)


# ============================================================================
# Convenience Function
# ============================================================================


def get_productivity_tracker(db: AsyncSession) -> ProductivityTrackingService:
    """Factory function to create ProductivityTrackingService."""
    return ProductivityTrackingService(db)
