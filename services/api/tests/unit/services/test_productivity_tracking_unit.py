"""Unit tests for productivity_tracking_service helpers."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock

import pytest

from src.services import productivity_tracking_service as pts


class DummyMetric:
    def __init__(self, d: datetime) -> None:
        self.user_id = "u1"
        self.date = d
        self.lines_written = 0
        self.lines_deleted = 0
        self.files_modified = 0
        self.commits_count = 0
        self.agent_messages_sent = 0
        self.agent_suggestions_accepted = 0
        self.agent_suggestions_rejected = 0
        self.agent_tasks_completed = 0
        self.active_session_minutes = 0
        self.coding_minutes = 0
        self.estimated_time_saved_minutes = 0
        self.language_breakdown: dict[str, int] = {}
        self.agent_usage_breakdown: dict[str, int] = {}
        self.current_streak_days = 0
        self.longest_streak_days = 0


class FakeScalarResult:
    def __init__(self, metric: Any) -> None:
        self._metric = metric

    def scalar_one_or_none(self) -> Any:
        return self._metric


class FakeExecuteResult:
    def __init__(self, items: list[Any]) -> None:
        self._items = items

    def scalars(self) -> Any:
        class S:
            def __init__(self, items: list[Any]) -> None:
                self._items = items

            def all(self) -> list[Any]:
                return self._items

        return S(self._items)


class FakeDB:
    def __init__(self, metric: DummyMetric | None = None, metrics_for_streak: list[DummyMetric] | None = None) -> None:
        self.metric = metric
        self.metrics_for_streak = metrics_for_streak or []
        self.added: list[Any] = []
        self.commits = 0

    async def execute(self, _query: Any) -> Any:  # noqa: ARG002
        # Used by _get_or_create_daily_metric and update_streaks.
        # When metrics_for_streak is set, first call (update_streaks) should
        # return a list of metrics; subsequent call (get_or_create_daily_metric)
        # should return today's metric.
        if self.metrics_for_streak:
            # Pop the list once so second call falls back to scalar result
            metrics = self.metrics_for_streak
            self.metrics_for_streak = []
            return FakeExecuteResult(metrics)
        return FakeScalarResult(self.metric)

    async def flush(self) -> None:
        return None

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    async def commit(self) -> None:
        self.commits += 1


def test_detect_language_special_cases() -> None:
    assert pts.detect_language("Dockerfile") == "Docker"
    assert pts.detect_language("Makefile") == "Makefile"
    assert pts.detect_language("foo.py") == "Python"
    assert pts.detect_language("unknown.xyz") == "Other"


def test_estimate_time_saved_combines_components() -> None:
    # 60 tokens -> 2 minutes by typing heuristic, plus suggestions and tasks
    minutes = pts.estimate_time_saved(tokens_generated=60, suggestions_accepted=1, tasks_completed=1)
    assert minutes >= 2 + pts.SUGGESTION_ACCEPTED_MINUTES + pts.TASK_COMPLETED_MINUTES


@pytest.mark.asyncio
async def test_get_or_create_daily_metric_creates_when_missing() -> None:
    today = datetime.now(UTC).date()
    fake_db = FakeDB(metric=None)
    service = pts.ProductivityTrackingService(fake_db)  # type: ignore[arg-type]

    metric = await service._get_or_create_daily_metric("u1", metric_date=today)
    assert metric.user_id == "u1"
    assert fake_db.added  # new metric added


@pytest.mark.asyncio
async def test_track_commit_updates_counts_and_language_breakdown() -> None:
    # Existing metric that will be updated
    start = datetime.now(UTC)
    metric = DummyMetric(start)
    fake_db = FakeDB(metric=metric)
    service = pts.ProductivityTrackingService(fake_db)  # type: ignore[arg-type]

    files = [
        {"path": "a.py", "additions": 10, "deletions": 2},
        {"path": "b.tsx", "additions": 5, "deletions": 1},
    ]

    await service.track_commit("u1", files_changed=files)

    assert metric.commits_count == 1
    assert metric.lines_written == 15
    assert metric.lines_deleted == 3
    # Two unique files
    assert metric.files_modified == 2
    # Language breakdown accumulates additions
    assert metric.language_breakdown.get("Python") == 10
    assert metric.language_breakdown.get("TypeScript") == 5


@pytest.mark.asyncio
async def test_update_streaks_computes_current_and_longest() -> None:
    today = datetime.now(UTC).date()
    # Create metrics for 3 consecutive coding days ending today
    metrics_for_streak = []
    for i in range(3):
        d = datetime.combine(today - timedelta(days=i), datetime.min.time(), tzinfo=UTC)
        m = DummyMetric(d)
        m.coding_minutes = 30
        metrics_for_streak.append(m)

    # Today metric used by _get_or_create_daily_metric
    today_metric = DummyMetric(datetime.combine(today, datetime.min.time(), tzinfo=UTC))
    fake_db = FakeDB(metric=today_metric, metrics_for_streak=metrics_for_streak)
    service = pts.ProductivityTrackingService(fake_db)  # type: ignore[arg-type]

    await service.update_streaks("u1")

    assert today_metric.current_streak_days >= 3
    assert today_metric.longest_streak_days >= 3
