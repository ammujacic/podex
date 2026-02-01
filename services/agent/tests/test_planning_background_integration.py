"""Integration tests for background planning module."""

import asyncio
import pytest
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

from src.planning.background import (
    BackgroundPlanner,
    BackgroundPlanStatus,
    BackgroundPlanTask,
    get_background_planner,
    start_background_planner,
    stop_background_planner,
)


class TestBackgroundPlanTask:
    """Tests for BackgroundPlanTask dataclass."""

    def test_task_defaults(self) -> None:
        """Test BackgroundPlanTask default values."""
        task = BackgroundPlanTask(
            id="task-1",
            session_id="session-1",
            agent_id="agent-1",
            task_description="Plan a feature",
            context=None,
            num_plans=3,
            models=["claude-sonnet-4-20250514"],
        )

        assert task.status == BackgroundPlanStatus.QUEUED
        assert task.plan_ids == []
        assert task.started_at is None
        assert task.completed_at is None
        assert task.error is None

    def test_task_to_dict(self) -> None:
        """Test BackgroundPlanTask to_dict method."""
        now = datetime.now(UTC)
        task = BackgroundPlanTask(
            id="task-1",
            session_id="session-1",
            agent_id="agent-1",
            task_description="Plan a feature",
            context="Some context",
            num_plans=3,
            models=["claude-sonnet-4-20250514"],
            status=BackgroundPlanStatus.COMPLETED,
            plan_ids=["plan-1", "plan-2"],
            created_at=now,
            started_at=now,
            completed_at=now,
        )

        result = task.to_dict()

        assert result["id"] == "task-1"
        assert result["session_id"] == "session-1"
        assert result["status"] == "completed"
        assert result["plan_ids"] == ["plan-1", "plan-2"]
        assert result["started_at"] is not None
        assert result["completed_at"] is not None


class TestBackgroundPlanner:
    """Tests for BackgroundPlanner class."""

    def test_init(self) -> None:
        """Test BackgroundPlanner initialization."""
        planner = BackgroundPlanner()

        assert planner._tasks == {}
        assert planner._notification_callbacks == []
        assert planner._running is False
        assert planner._worker_task is None

    @pytest.mark.asyncio
    async def test_start_and_stop(self) -> None:
        """Test starting and stopping the planner."""
        planner = BackgroundPlanner()

        await planner.start()
        assert planner._running is True
        assert planner._worker_task is not None

        await planner.stop()
        assert planner._running is False

    @pytest.mark.asyncio
    async def test_start_already_running(self) -> None:
        """Test starting when already running does nothing."""
        planner = BackgroundPlanner()

        await planner.start()
        task1 = planner._worker_task

        await planner.start()  # Should not create new task
        assert planner._worker_task is task1

        await planner.stop()

    def test_register_notification_callback(self) -> None:
        """Test registering notification callback."""
        planner = BackgroundPlanner()

        async def callback(task: BackgroundPlanTask, plans: list) -> None:
            pass

        planner.register_notification_callback(callback)

        assert len(planner._notification_callbacks) == 1

    @pytest.mark.asyncio
    async def test_queue_planning_task_no_models(self) -> None:
        """Test queuing task without models raises error."""
        planner = BackgroundPlanner()

        with pytest.raises(ValueError) as exc_info:
            await planner.queue_planning_task(
                session_id="session-1",
                agent_id="agent-1",
                task_description="Plan a feature",
                models=None,
            )

        assert "models are required" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_queue_planning_task_success(self) -> None:
        """Test successfully queuing a planning task."""
        planner = BackgroundPlanner()

        task = await planner.queue_planning_task(
            session_id="session-1",
            agent_id="agent-1",
            task_description="Plan a feature",
            num_plans=2,
            models=["claude-sonnet-4-20250514"],
            context="Some context",
        )

        assert task.id is not None
        assert task.session_id == "session-1"
        assert task.agent_id == "agent-1"
        assert task.num_plans == 2
        assert task.status == BackgroundPlanStatus.QUEUED
        assert task.id in planner._tasks

        # Cleanup
        await planner.stop()

    @pytest.mark.asyncio
    async def test_queue_planning_task_starts_worker(self) -> None:
        """Test that queuing a task starts the worker."""
        planner = BackgroundPlanner()

        assert planner._running is False

        await planner.queue_planning_task(
            session_id="session-1",
            agent_id="agent-1",
            task_description="Plan a feature",
            models=["claude-sonnet-4-20250514"],
        )

        assert planner._running is True

        await planner.stop()

    @pytest.mark.asyncio
    async def test_cancel_queued_task(self) -> None:
        """Test cancelling a queued task."""
        planner = BackgroundPlanner()

        task = await planner.queue_planning_task(
            session_id="session-1",
            agent_id="agent-1",
            task_description="Plan a feature",
            models=["claude-sonnet-4-20250514"],
        )

        result = await planner.cancel_task(task.id)

        assert result is True
        assert task.status == BackgroundPlanStatus.CANCELLED

        await planner.stop()

    @pytest.mark.asyncio
    async def test_cancel_nonexistent_task(self) -> None:
        """Test cancelling a nonexistent task."""
        planner = BackgroundPlanner()

        result = await planner.cancel_task("nonexistent")

        assert result is False

    @pytest.mark.asyncio
    async def test_cancel_completed_task(self) -> None:
        """Test cancelling a completed task returns False."""
        planner = BackgroundPlanner()

        task = await planner.queue_planning_task(
            session_id="session-1",
            agent_id="agent-1",
            task_description="Plan a feature",
            models=["claude-sonnet-4-20250514"],
        )

        # Manually set to completed
        task.status = BackgroundPlanStatus.COMPLETED

        result = await planner.cancel_task(task.id)

        assert result is False

        await planner.stop()

    def test_get_task(self) -> None:
        """Test getting a task by ID."""
        planner = BackgroundPlanner()
        task = BackgroundPlanTask(
            id="task-1",
            session_id="session-1",
            agent_id="agent-1",
            task_description="Test",
            context=None,
            num_plans=1,
            models=["model"],
        )
        planner._tasks["task-1"] = task

        result = planner.get_task("task-1")
        assert result is task

        result = planner.get_task("nonexistent")
        assert result is None

    def test_get_session_tasks(self) -> None:
        """Test getting tasks for a session."""
        planner = BackgroundPlanner()

        # Add tasks for different sessions
        for i in range(3):
            task = BackgroundPlanTask(
                id=f"task-{i}",
                session_id="session-1" if i < 2 else "session-2",
                agent_id="agent-1",
                task_description=f"Task {i}",
                context=None,
                num_plans=1,
                models=["model"],
            )
            planner._tasks[task.id] = task

        tasks = planner.get_session_tasks("session-1")
        assert len(tasks) == 2

        tasks = planner.get_session_tasks("session-2")
        assert len(tasks) == 1

    def test_get_session_tasks_exclude_completed(self) -> None:
        """Test getting tasks excluding completed ones."""
        planner = BackgroundPlanner()

        task1 = BackgroundPlanTask(
            id="task-1",
            session_id="session-1",
            agent_id="agent-1",
            task_description="Task 1",
            context=None,
            num_plans=1,
            models=["model"],
            status=BackgroundPlanStatus.QUEUED,
        )
        task2 = BackgroundPlanTask(
            id="task-2",
            session_id="session-1",
            agent_id="agent-1",
            task_description="Task 2",
            context=None,
            num_plans=1,
            models=["model"],
            status=BackgroundPlanStatus.COMPLETED,
        )

        planner._tasks["task-1"] = task1
        planner._tasks["task-2"] = task2

        tasks = planner.get_session_tasks("session-1", include_completed=False)
        assert len(tasks) == 1
        assert tasks[0].id == "task-1"

    def test_get_queue_status(self) -> None:
        """Test getting queue status."""
        planner = BackgroundPlanner()

        # Add tasks with different statuses
        task1 = BackgroundPlanTask(
            id="task-1",
            session_id="session-1",
            agent_id="agent-1",
            task_description="Task 1",
            context=None,
            num_plans=1,
            models=["model"],
            status=BackgroundPlanStatus.QUEUED,
        )
        task2 = BackgroundPlanTask(
            id="task-2",
            session_id="session-1",
            agent_id="agent-1",
            task_description="Task 2",
            context=None,
            num_plans=1,
            models=["model"],
            status=BackgroundPlanStatus.RUNNING,
        )
        task3 = BackgroundPlanTask(
            id="task-3",
            session_id="session-1",
            agent_id="agent-1",
            task_description="Task 3",
            context=None,
            num_plans=1,
            models=["model"],
            status=BackgroundPlanStatus.COMPLETED,
        )

        planner._tasks = {"task-1": task1, "task-2": task2, "task-3": task3}

        status = planner.get_queue_status()

        assert status["running"] is False
        assert status["queued_tasks"] == 1
        assert status["running_tasks"] == 1
        assert status["total_tasks"] == 3

    @pytest.mark.asyncio
    async def test_worker_loop_processes_task(self) -> None:
        """Test that worker loop processes tasks."""
        planner = BackgroundPlanner()

        # Mock the parallel plan generator
        mock_plans = [MagicMock(id="plan-1"), MagicMock(id="plan-2")]

        with patch("src.planning.background.get_parallel_plan_generator") as mock_gen:
            mock_generator = MagicMock()
            mock_generator.generate_parallel_plans = AsyncMock(return_value=mock_plans)
            mock_gen.return_value = mock_generator

            # Start planner
            await planner.start()

            # Queue a task
            task = await planner.queue_planning_task(
                session_id="session-1",
                agent_id="agent-1",
                task_description="Plan a feature",
                models=["claude-sonnet-4-20250514"],
            )

            # Wait for processing
            await asyncio.sleep(0.2)

            # Task should be completed
            assert task.status == BackgroundPlanStatus.COMPLETED
            assert task.plan_ids == ["plan-1", "plan-2"]

            await planner.stop()

    @pytest.mark.asyncio
    async def test_worker_loop_handles_failure(self) -> None:
        """Test that worker loop handles task failure."""
        planner = BackgroundPlanner()

        with patch("src.planning.background.get_parallel_plan_generator") as mock_gen:
            mock_generator = MagicMock()
            mock_generator.generate_parallel_plans = AsyncMock(
                side_effect=Exception("Planning failed")
            )
            mock_gen.return_value = mock_generator

            await planner.start()

            task = await planner.queue_planning_task(
                session_id="session-1",
                agent_id="agent-1",
                task_description="Plan a feature",
                models=["claude-sonnet-4-20250514"],
            )

            await asyncio.sleep(0.2)

            assert task.status == BackgroundPlanStatus.FAILED
            assert task.error == "Planning failed"

            await planner.stop()

    @pytest.mark.asyncio
    async def test_worker_loop_skips_cancelled_task(self) -> None:
        """Test that worker loop skips cancelled tasks."""
        planner = BackgroundPlanner()

        with patch("src.planning.background.get_parallel_plan_generator") as mock_gen:
            mock_generator = MagicMock()
            mock_generator.generate_parallel_plans = AsyncMock(return_value=[])
            mock_gen.return_value = mock_generator

            # Queue and immediately cancel
            task = await planner.queue_planning_task(
                session_id="session-1",
                agent_id="agent-1",
                task_description="Plan a feature",
                models=["claude-sonnet-4-20250514"],
            )

            await planner.cancel_task(task.id)
            await planner.start()

            await asyncio.sleep(0.2)

            # Task should still be cancelled, not processed
            assert task.status == BackgroundPlanStatus.CANCELLED

            await planner.stop()

    @pytest.mark.asyncio
    async def test_notification_callbacks_called(self) -> None:
        """Test that notification callbacks are called on completion."""
        planner = BackgroundPlanner()
        callback_called = False
        received_task = None
        received_plans = None

        async def callback(task: BackgroundPlanTask, plans: list) -> None:
            nonlocal callback_called, received_task, received_plans
            callback_called = True
            received_task = task
            received_plans = plans

        planner.register_notification_callback(callback)

        mock_plans = [MagicMock(id="plan-1")]

        with patch("src.planning.background.get_parallel_plan_generator") as mock_gen:
            mock_generator = MagicMock()
            mock_generator.generate_parallel_plans = AsyncMock(return_value=mock_plans)
            mock_gen.return_value = mock_generator

            await planner.start()

            task = await planner.queue_planning_task(
                session_id="session-1",
                agent_id="agent-1",
                task_description="Plan a feature",
                models=["claude-sonnet-4-20250514"],
            )

            await asyncio.sleep(0.2)

            assert callback_called
            assert received_task.id == task.id
            assert len(received_plans) == 1

            await planner.stop()

    @pytest.mark.asyncio
    async def test_notification_callback_error_handled(self) -> None:
        """Test that callback errors don't crash the worker."""
        planner = BackgroundPlanner()

        async def failing_callback(task: BackgroundPlanTask, plans: list) -> None:
            raise Exception("Callback failed")

        planner.register_notification_callback(failing_callback)

        with patch("src.planning.background.get_parallel_plan_generator") as mock_gen:
            mock_generator = MagicMock()
            mock_generator.generate_parallel_plans = AsyncMock(return_value=[])
            mock_gen.return_value = mock_generator

            await planner.start()

            task = await planner.queue_planning_task(
                session_id="session-1",
                agent_id="agent-1",
                task_description="Plan a feature",
                models=["claude-sonnet-4-20250514"],
            )

            await asyncio.sleep(0.2)

            # Task should still complete despite callback error
            assert task.status == BackgroundPlanStatus.COMPLETED

            await planner.stop()


class TestGlobalPlannerFunctions:
    """Tests for global planner functions."""

    def test_get_background_planner_singleton(self) -> None:
        """Test that get_background_planner returns singleton."""
        # Reset global
        import src.planning.background as bg

        bg._planner = None

        planner1 = get_background_planner()
        planner2 = get_background_planner()

        assert planner1 is planner2

        # Cleanup
        bg._planner = None

    @pytest.mark.asyncio
    async def test_start_stop_background_planner(self) -> None:
        """Test start and stop global planner functions."""
        import src.planning.background as bg

        bg._planner = None

        await start_background_planner()
        planner = get_background_planner()
        assert planner._running is True

        await stop_background_planner()
        assert planner._running is False

        bg._planner = None
