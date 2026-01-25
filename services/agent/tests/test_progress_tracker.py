"""Tests for progress tracker module.

Tests cover:
- StepStatus enum
- ProgressStep dataclass
- TaskProgress dataclass
- extract_steps_from_text function
- ProgressTracker class
"""

from datetime import datetime
from typing import Any
from unittest.mock import MagicMock, patch

import pytest


class TestStepStatusEnum:
    """Test StepStatus enum."""

    def test_step_status_exists(self):
        """Test StepStatus enum exists."""
        from src.progress.tracker import StepStatus
        assert StepStatus is not None

    def test_step_status_values(self):
        """Test StepStatus enum values."""
        from src.progress.tracker import StepStatus

        assert StepStatus.PENDING.value == "pending"
        assert StepStatus.IN_PROGRESS.value == "in_progress"
        assert StepStatus.COMPLETED.value == "completed"
        assert StepStatus.FAILED.value == "failed"
        assert StepStatus.SKIPPED.value == "skipped"


class TestProgressStep:
    """Test ProgressStep dataclass."""

    def test_progress_step_exists(self):
        """Test ProgressStep exists."""
        from src.progress.tracker import ProgressStep
        assert ProgressStep is not None

    def test_progress_step_creation(self):
        """Test creating ProgressStep."""
        from src.progress.tracker import ProgressStep, StepStatus

        step = ProgressStep(
            id="step-1",
            index=0,
            description="First step",
        )

        assert step.id == "step-1"
        assert step.index == 0
        assert step.description == "First step"
        assert step.status == StepStatus.PENDING

    def test_progress_step_defaults(self):
        """Test ProgressStep default values."""
        from src.progress.tracker import ProgressStep

        step = ProgressStep(
            id="step-1",
            index=0,
            description="Test",
        )

        assert step.started_at is None
        assert step.completed_at is None
        assert step.error is None
        assert step.metadata == {}

    def test_progress_step_duration_ms(self):
        """Test duration_ms property."""
        from src.progress.tracker import ProgressStep, StepStatus

        now = datetime.utcnow()
        later = datetime.utcnow()

        step = ProgressStep(
            id="step-1",
            index=0,
            description="Test",
            status=StepStatus.COMPLETED,
            started_at=now,
            completed_at=later,
        )

        # Should return duration in ms
        assert step.duration_ms is not None
        assert isinstance(step.duration_ms, int)

    def test_progress_step_duration_ms_none_when_not_completed(self):
        """Test duration_ms is None when not completed."""
        from src.progress.tracker import ProgressStep

        step = ProgressStep(
            id="step-1",
            index=0,
            description="Test",
            started_at=datetime.utcnow(),
        )

        assert step.duration_ms is None

    def test_progress_step_to_dict(self):
        """Test ProgressStep to_dict method."""
        from src.progress.tracker import ProgressStep, StepStatus

        step = ProgressStep(
            id="step-1",
            index=0,
            description="First step",
            status=StepStatus.COMPLETED,
        )

        data = step.to_dict()

        assert data["id"] == "step-1"
        assert data["index"] == 0
        assert data["description"] == "First step"
        assert data["status"] == "completed"


class TestTaskProgress:
    """Test TaskProgress dataclass."""

    def test_task_progress_exists(self):
        """Test TaskProgress exists."""
        from src.progress.tracker import TaskProgress
        assert TaskProgress is not None

    def test_task_progress_creation(self):
        """Test creating TaskProgress."""
        from src.progress.tracker import TaskProgress, ProgressStep

        steps = [
            ProgressStep(id="s1", index=0, description="Step 1"),
            ProgressStep(id="s2", index=1, description="Step 2"),
        ]

        progress = TaskProgress(
            id="prog-1",
            agent_id="agent-123",
            session_id="session-456",
            title="My Task",
            steps=steps,
        )

        assert progress.id == "prog-1"
        assert progress.agent_id == "agent-123"
        assert progress.session_id == "session-456"
        assert progress.title == "My Task"
        assert len(progress.steps) == 2

    def test_task_progress_defaults(self):
        """Test TaskProgress default values."""
        from src.progress.tracker import TaskProgress

        progress = TaskProgress(
            id="prog-1",
            agent_id="agent-123",
            session_id="session-456",
            title="Test",
            steps=[],
        )

        assert progress.status == "pending"
        assert progress.completed_at is None

    def test_task_progress_completed_steps(self):
        """Test completed_steps property."""
        from src.progress.tracker import TaskProgress, ProgressStep, StepStatus

        steps = [
            ProgressStep(id="s1", index=0, description="Step 1", status=StepStatus.COMPLETED),
            ProgressStep(id="s2", index=1, description="Step 2", status=StepStatus.COMPLETED),
            ProgressStep(id="s3", index=2, description="Step 3", status=StepStatus.PENDING),
        ]

        progress = TaskProgress(
            id="prog-1",
            agent_id="agent-123",
            session_id="session-456",
            title="Test",
            steps=steps,
        )

        assert progress.completed_steps == 2

    def test_task_progress_total_steps(self):
        """Test total_steps property."""
        from src.progress.tracker import TaskProgress, ProgressStep

        steps = [
            ProgressStep(id="s1", index=0, description="Step 1"),
            ProgressStep(id="s2", index=1, description="Step 2"),
            ProgressStep(id="s3", index=2, description="Step 3"),
        ]

        progress = TaskProgress(
            id="prog-1",
            agent_id="agent-123",
            session_id="session-456",
            title="Test",
            steps=steps,
        )

        assert progress.total_steps == 3

    def test_task_progress_percent(self):
        """Test progress_percent property."""
        from src.progress.tracker import TaskProgress, ProgressStep, StepStatus

        steps = [
            ProgressStep(id="s1", index=0, description="Step 1", status=StepStatus.COMPLETED),
            ProgressStep(id="s2", index=1, description="Step 2", status=StepStatus.PENDING),
        ]

        progress = TaskProgress(
            id="prog-1",
            agent_id="agent-123",
            session_id="session-456",
            title="Test",
            steps=steps,
        )

        assert progress.progress_percent == 50

    def test_task_progress_current_step_index(self):
        """Test current_step_index property."""
        from src.progress.tracker import TaskProgress, ProgressStep, StepStatus

        steps = [
            ProgressStep(id="s1", index=0, description="Step 1", status=StepStatus.COMPLETED),
            ProgressStep(id="s2", index=1, description="Step 2", status=StepStatus.IN_PROGRESS),
            ProgressStep(id="s3", index=2, description="Step 3", status=StepStatus.PENDING),
        ]

        progress = TaskProgress(
            id="prog-1",
            agent_id="agent-123",
            session_id="session-456",
            title="Test",
            steps=steps,
        )

        assert progress.current_step_index == 1

    def test_task_progress_to_dict(self):
        """Test TaskProgress to_dict method."""
        from src.progress.tracker import TaskProgress, ProgressStep

        progress = TaskProgress(
            id="prog-1",
            agent_id="agent-123",
            session_id="session-456",
            title="Test Task",
            steps=[ProgressStep(id="s1", index=0, description="Step 1")],
        )

        data = progress.to_dict()

        assert data["id"] == "prog-1"
        assert data["agent_id"] == "agent-123"
        assert data["title"] == "Test Task"
        assert "steps" in data
        assert "progress_percent" in data


class TestExtractStepsFromText:
    """Test extract_steps_from_text function."""

    def test_function_exists(self):
        """Test extract_steps_from_text function exists."""
        from src.progress.tracker import extract_steps_from_text
        assert callable(extract_steps_from_text)

    def test_extract_numbered_steps(self):
        """Test extracting numbered steps."""
        from src.progress.tracker import extract_steps_from_text

        text = """
        1. First step
        2. Second step
        3. Third step
        """

        steps = extract_steps_from_text(text)

        assert len(steps) >= 1
        assert "First step" in steps[0] or "step" in steps[0].lower()

    def test_extract_bulleted_steps(self):
        """Test extracting bulleted steps."""
        from src.progress.tracker import extract_steps_from_text

        text = """
        - First item
        - Second item
        - Third item
        """

        steps = extract_steps_from_text(text)

        assert len(steps) >= 1

    def test_extract_empty_text(self):
        """Test extracting from empty text."""
        from src.progress.tracker import extract_steps_from_text

        steps = extract_steps_from_text("")

        assert isinstance(steps, list)


class TestProgressTracker:
    """Test ProgressTracker class."""

    def test_progress_tracker_exists(self):
        """Test ProgressTracker class exists."""
        from src.progress.tracker import ProgressTracker
        assert ProgressTracker is not None

    def test_progress_tracker_initialization(self):
        """Test ProgressTracker initialization."""
        from src.progress.tracker import ProgressTracker

        tracker = ProgressTracker()
        assert tracker is not None

    def test_create_progress(self):
        """Test create_progress method."""
        from src.progress.tracker import ProgressTracker

        tracker = ProgressTracker()

        progress = tracker.create_progress(
            agent_id="agent-123",
            session_id="session-456",
            title="Test Task",
            step_descriptions=["Step 1", "Step 2", "Step 3"],
        )

        assert progress.agent_id == "agent-123"
        assert progress.session_id == "session-456"
        assert progress.title == "Test Task"
        assert len(progress.steps) == 3

    def test_create_from_plan(self):
        """Test create_from_plan method."""
        from src.progress.tracker import ProgressTracker

        tracker = ProgressTracker()

        plan = """
        1. First step of the plan
        2. Second step of the plan
        3. Third step of the plan
        """

        progress = tracker.create_from_plan(
            agent_id="agent-123",
            session_id="session-456",
            title="Plan Task",
            plan_text=plan,
        )

        assert progress.agent_id == "agent-123"
        assert len(progress.steps) >= 1

    def test_get_progress(self):
        """Test get_progress method."""
        from src.progress.tracker import ProgressTracker

        tracker = ProgressTracker()

        progress = tracker.create_progress(
            agent_id="agent-123",
            session_id="session-456",
            title="Test",
            step_descriptions=["Step 1"],
        )

        retrieved = tracker.get_progress(progress.id)

        assert retrieved is not None
        assert retrieved.id == progress.id

    def test_get_progress_not_found(self):
        """Test get_progress returns None for unknown ID."""
        from src.progress.tracker import ProgressTracker

        tracker = ProgressTracker()
        retrieved = tracker.get_progress("nonexistent-id")

        assert retrieved is None

    def test_get_agent_progress(self):
        """Test get_agent_progress method."""
        from src.progress.tracker import ProgressTracker

        tracker = ProgressTracker()

        tracker.create_progress(
            agent_id="agent-123",
            session_id="session-456",
            title="Task 1",
            step_descriptions=["Step 1"],
        )
        tracker.create_progress(
            agent_id="agent-123",
            session_id="session-456",
            title="Task 2",
            step_descriptions=["Step 1"],
        )

        progress_list = tracker.get_agent_progress("agent-123")

        assert len(progress_list) == 2

    def test_start_step(self):
        """Test start_step method."""
        from src.progress.tracker import ProgressTracker, StepStatus

        tracker = ProgressTracker()

        progress = tracker.create_progress(
            agent_id="agent-123",
            session_id="session-456",
            title="Test",
            step_descriptions=["Step 1", "Step 2"],
        )

        result = tracker.start_step(progress.id, 0)

        assert result is True
        assert progress.steps[0].status == StepStatus.IN_PROGRESS

    def test_complete_step(self):
        """Test complete_step method."""
        from src.progress.tracker import ProgressTracker, StepStatus

        tracker = ProgressTracker()

        progress = tracker.create_progress(
            agent_id="agent-123",
            session_id="session-456",
            title="Test",
            step_descriptions=["Step 1", "Step 2"],
        )

        tracker.start_step(progress.id, 0)
        result = tracker.complete_step(progress.id, 0)

        assert result is True
        assert progress.steps[0].status == StepStatus.COMPLETED

    def test_fail_step(self):
        """Test fail_step method."""
        from src.progress.tracker import ProgressTracker, StepStatus

        tracker = ProgressTracker()

        progress = tracker.create_progress(
            agent_id="agent-123",
            session_id="session-456",
            title="Test",
            step_descriptions=["Step 1"],
        )

        tracker.start_step(progress.id, 0)
        result = tracker.fail_step(progress.id, 0, "Something went wrong")

        assert result is True
        assert progress.steps[0].status == StepStatus.FAILED
        assert progress.steps[0].error == "Something went wrong"

    def test_skip_step(self):
        """Test skip_step method."""
        from src.progress.tracker import ProgressTracker, StepStatus

        tracker = ProgressTracker()

        progress = tracker.create_progress(
            agent_id="agent-123",
            session_id="session-456",
            title="Test",
            step_descriptions=["Step 1"],
        )

        result = tracker.skip_step(progress.id, 0)

        assert result is True
        assert progress.steps[0].status == StepStatus.SKIPPED

    def test_cleanup_agent(self):
        """Test cleanup_agent method."""
        from src.progress.tracker import ProgressTracker

        tracker = ProgressTracker()

        tracker.create_progress(
            agent_id="agent-123",
            session_id="session-456",
            title="Task",
            step_descriptions=["Step 1"],
        )

        tracker.cleanup_agent("agent-123")

        progress_list = tracker.get_agent_progress("agent-123")
        assert len(progress_list) == 0

    def test_set_event_callback(self):
        """Test set_event_callback method."""
        from src.progress.tracker import ProgressTracker

        tracker = ProgressTracker()
        callback = MagicMock()

        tracker.set_event_callback(callback)

        # Callback should be set
        assert tracker._event_callback == callback


class TestGetProgressTracker:
    """Test get_progress_tracker function."""

    def test_get_progress_tracker_exists(self):
        """Test get_progress_tracker function exists."""
        from src.progress.tracker import get_progress_tracker
        assert callable(get_progress_tracker)
