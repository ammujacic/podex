"""Progress and task tracking for agent execution.

This module tracks the progress of agent tasks, including:
- Step-by-step progress indicators
- Time elapsed per step
- Overall progress percentage
- Automatic step extraction from plans
"""

import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any

import structlog

logger = structlog.get_logger()


class StepStatus(str, Enum):
    """Status of a progress step."""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class ProgressStep:
    """A single step in a task."""

    id: str
    index: int
    description: str
    status: StepStatus = StepStatus.PENDING
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def duration_ms(self) -> int | None:
        """Duration in milliseconds, if completed."""
        if self.started_at and self.completed_at:
            return int((self.completed_at - self.started_at).total_seconds() * 1000)
        return None

    @property
    def elapsed_ms(self) -> int | None:
        """Time elapsed since start, if in progress."""
        if self.started_at and not self.completed_at:
            return int((datetime.utcnow() - self.started_at).total_seconds() * 1000)
        return None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "index": self.index,
            "description": self.description,
            "status": self.status.value,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "duration_ms": self.duration_ms,
            "elapsed_ms": self.elapsed_ms,
            "error": self.error,
            "metadata": self.metadata,
        }


@dataclass
class TaskProgress:
    """Progress tracking for an agent task."""

    id: str
    agent_id: str
    session_id: str
    title: str
    steps: list[ProgressStep]
    created_at: datetime = field(default_factory=datetime.utcnow)
    completed_at: datetime | None = None
    status: str = "pending"  # pending, in_progress, completed, failed

    @property
    def current_step_index(self) -> int | None:
        """Index of the currently in-progress step."""
        for step in self.steps:
            if step.status == StepStatus.IN_PROGRESS:
                return step.index
        return None

    @property
    def completed_steps(self) -> int:
        """Number of completed steps."""
        return sum(1 for s in self.steps if s.status == StepStatus.COMPLETED)

    @property
    def total_steps(self) -> int:
        """Total number of steps."""
        return len(self.steps)

    @property
    def progress_percent(self) -> int:
        """Overall progress percentage."""
        if self.total_steps == 0:
            return 0
        return int((self.completed_steps / self.total_steps) * 100)

    @property
    def total_duration_ms(self) -> int | None:
        """Total duration in milliseconds."""
        if self.created_at and self.completed_at:
            return int((self.completed_at - self.created_at).total_seconds() * 1000)
        return None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "agent_id": self.agent_id,
            "session_id": self.session_id,
            "title": self.title,
            "status": self.status,
            "steps": [s.to_dict() for s in self.steps],
            "current_step_index": self.current_step_index,
            "completed_steps": self.completed_steps,
            "total_steps": self.total_steps,
            "progress_percent": self.progress_percent,
            "created_at": self.created_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "total_duration_ms": self.total_duration_ms,
        }


# Patterns for extracting steps from text
STEP_PATTERNS = [
    # Numbered lists: 1. Step, 2. Step
    re.compile(r"^\s*(\d+)[.)]\s*(.+?)(?=\n\s*\d+[.)]|\n\n|\Z)", re.MULTILINE),
    # Bullet lists with specific markers
    re.compile(r"^\s*[-*•]\s*(.+?)(?=\n\s*[-*•]|\n\n|\Z)", re.MULTILINE),
    # TODO/TASK markers
    re.compile(r"(?:TODO|TASK|STEP):\s*(.+?)(?=\n|$)", re.IGNORECASE),
    # Action verbs at start of lines
    re.compile(
        r"^\s*((?:First|Then|Next|Finally|After that)[,:]?\s*.+?)"
        r"(?=\n(?:First|Then|Next|Finally|After that)|\n\n|\Z)",
        re.MULTILINE | re.IGNORECASE,
    ),
]


def extract_steps_from_text(text: str) -> list[str]:
    """
    Extract task steps from plan text.

    Tries multiple patterns to find structured steps.
    """
    steps = []

    # Try numbered list first (most common in plans)
    numbered_matches = STEP_PATTERNS[0].findall(text)
    if numbered_matches:
        steps = [match[1].strip() for match in numbered_matches if match[1].strip()]
        if len(steps) >= 2:
            return steps

    # Try bullet points
    bullet_matches = STEP_PATTERNS[1].findall(text)
    if bullet_matches:
        steps = [match.strip() for match in bullet_matches if match.strip()]
        if len(steps) >= 2:
            return steps

    # Try TODO/TASK markers
    todo_matches = STEP_PATTERNS[2].findall(text)
    if todo_matches:
        steps = [match.strip() for match in todo_matches if match.strip()]
        if len(steps) >= 2:
            return steps

    # Try action verb patterns
    action_matches = STEP_PATTERNS[3].findall(text)
    if action_matches:
        steps = [match.strip() for match in action_matches if match.strip()]
        if len(steps) >= 2:
            return steps

    return steps


class ProgressTracker:
    """
    Manages progress tracking for agent tasks.

    Features:
    - Create progress trackers from plans
    - Update step statuses
    - Auto-advance on completion
    - Emit WebSocket events for real-time updates
    """

    def __init__(self) -> None:
        # agent_id -> list of task progress
        self._progress: dict[str, list[TaskProgress]] = {}
        # progress_id -> progress
        self._progress_by_id: dict[str, TaskProgress] = {}
        # Callback for emitting events
        self._event_callback: Callable[[str, str, dict[str, Any]], None] | None = None

    def set_event_callback(self, callback: Callable[[str, str, dict[str, Any]], None]) -> None:
        """Set callback for emitting progress events."""
        self._event_callback = callback

    def create_progress(
        self,
        agent_id: str,
        session_id: str,
        title: str,
        step_descriptions: list[str],
    ) -> TaskProgress:
        """Create a new progress tracker with specified steps."""
        steps = [
            ProgressStep(
                id=str(uuid.uuid4()),
                index=i,
                description=desc,
            )
            for i, desc in enumerate(step_descriptions)
        ]

        progress = TaskProgress(
            id=str(uuid.uuid4()),
            agent_id=agent_id,
            session_id=session_id,
            title=title,
            steps=steps,
        )

        if agent_id not in self._progress:
            self._progress[agent_id] = []
        self._progress[agent_id].append(progress)
        self._progress_by_id[progress.id] = progress

        logger.info(
            "progress_created",
            progress_id=progress.id,
            agent_id=agent_id,
            total_steps=len(steps),
        )

        self._emit_event("task_progress_created", progress)
        return progress

    def create_from_plan(
        self,
        agent_id: str,
        session_id: str,
        plan_text: str,
        title: str | None = None,
    ) -> TaskProgress | None:
        """
        Create progress tracker by extracting steps from plan text.

        Returns None if no steps could be extracted.
        """
        steps = extract_steps_from_text(plan_text)
        if not steps:
            logger.debug("no_steps_extracted", agent_id=agent_id)
            return None

        # Use first line as title if not provided
        if not title:
            first_line = plan_text.strip().split("\n")[0]
            title = first_line[:100] if first_line else "Task"

        return self.create_progress(agent_id, session_id, title, steps)

    def start_step(self, progress_id: str, step_index: int) -> bool:
        """Mark a step as started."""
        progress = self._progress_by_id.get(progress_id)
        if not progress or step_index >= len(progress.steps):
            return False

        step = progress.steps[step_index]
        step.status = StepStatus.IN_PROGRESS
        step.started_at = datetime.utcnow()
        progress.status = "in_progress"

        logger.info(
            "step_started",
            progress_id=progress_id,
            step_index=step_index,
        )

        self._emit_event("task_step_started", progress, step)
        return True

    def complete_step(
        self,
        progress_id: str,
        step_index: int,
        auto_advance: bool = True,
    ) -> bool:
        """Mark a step as completed."""
        progress = self._progress_by_id.get(progress_id)
        if not progress or step_index >= len(progress.steps):
            return False

        step = progress.steps[step_index]
        step.status = StepStatus.COMPLETED
        step.completed_at = datetime.utcnow()

        logger.info(
            "step_completed",
            progress_id=progress_id,
            step_index=step_index,
            duration_ms=step.duration_ms,
        )

        self._emit_event("task_step_completed", progress, step)

        # Auto-advance to next step
        if auto_advance and step_index + 1 < len(progress.steps):
            self.start_step(progress_id, step_index + 1)
        elif step_index == len(progress.steps) - 1:
            # All steps done
            self._complete_progress(progress)

        return True

    def fail_step(self, progress_id: str, step_index: int, error: str) -> bool:
        """Mark a step as failed."""
        progress = self._progress_by_id.get(progress_id)
        if not progress or step_index >= len(progress.steps):
            return False

        step = progress.steps[step_index]
        step.status = StepStatus.FAILED
        step.completed_at = datetime.utcnow()
        step.error = error
        progress.status = "failed"

        logger.info(
            "step_failed",
            progress_id=progress_id,
            step_index=step_index,
            error=error,
        )

        self._emit_event("task_step_failed", progress, step)
        return True

    def skip_step(self, progress_id: str, step_index: int) -> bool:
        """Mark a step as skipped."""
        progress = self._progress_by_id.get(progress_id)
        if not progress or step_index >= len(progress.steps):
            return False

        step = progress.steps[step_index]
        step.status = StepStatus.SKIPPED
        step.completed_at = datetime.utcnow()

        self._emit_event("task_step_skipped", progress, step)
        return True

    def _complete_progress(self, progress: TaskProgress) -> None:
        """Mark the entire task as completed."""
        progress.status = "completed"
        progress.completed_at = datetime.utcnow()

        logger.info(
            "progress_completed",
            progress_id=progress.id,
            total_duration_ms=progress.total_duration_ms,
        )

        self._emit_event("task_progress_completed", progress)

    def get_progress(self, progress_id: str) -> TaskProgress | None:
        """Get a progress tracker by ID."""
        return self._progress_by_id.get(progress_id)

    def get_agent_progress(self, agent_id: str) -> list[TaskProgress]:
        """Get all progress trackers for an agent."""
        return self._progress.get(agent_id, [])

    def get_active_progress(self, agent_id: str) -> TaskProgress | None:
        """Get the currently active (in-progress) task for an agent."""
        for progress in self.get_agent_progress(agent_id):
            if progress.status == "in_progress":
                return progress
        return None

    def cleanup_agent(self, agent_id: str) -> None:
        """Clean up all progress for an agent."""
        progress_list = self._progress.pop(agent_id, [])
        for p in progress_list:
            if p.id in self._progress_by_id:
                del self._progress_by_id[p.id]

    def _emit_event(
        self,
        event_type: str,
        progress: TaskProgress,
        step: ProgressStep | None = None,
    ) -> None:
        """Emit a progress event via the callback."""
        if not self._event_callback:
            return

        data = {
            "event_type": event_type,
            "progress": progress.to_dict(),
        }
        if step:
            data["step"] = step.to_dict()

        try:
            self._event_callback(progress.session_id, event_type, data)
        except Exception as e:
            logger.error("failed_to_emit_event", error=str(e))


# Global instance
_tracker: ProgressTracker | None = None


def get_progress_tracker() -> ProgressTracker:
    """Get or create the global progress tracker instance."""
    global _tracker
    if _tracker is None:
        _tracker = ProgressTracker()
    return _tracker
