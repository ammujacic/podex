"""Unit tests for health analyzer (_calculate_grade and get_enabled_checks)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from src.health import analyzer as ana


def test_calculate_grade_a() -> None:
    assert ana._calculate_grade(90) == "A"
    assert ana._calculate_grade(95) == "A"
    assert ana._calculate_grade(100) == "A"


def test_calculate_grade_b() -> None:
    assert ana._calculate_grade(80) == "B"
    assert ana._calculate_grade(85) == "B"
    assert ana._calculate_grade(89.9) == "B"


def test_calculate_grade_c() -> None:
    assert ana._calculate_grade(70) == "C"
    assert ana._calculate_grade(75) == "C"
    assert ana._calculate_grade(79.9) == "C"


def test_calculate_grade_d() -> None:
    assert ana._calculate_grade(60) == "D"
    assert ana._calculate_grade(65) == "D"
    assert ana._calculate_grade(69.9) == "D"


def test_calculate_grade_f() -> None:
    assert ana._calculate_grade(0) == "F"
    assert ana._calculate_grade(59.9) == "F"


@pytest.mark.asyncio
async def test_get_enabled_checks_returns_all_when_no_project_type_restriction() -> None:
    """Checks with project_types=None are included for any project_type."""
    fake_check = MagicMock()
    fake_check.project_types = None
    fake_check.enabled = True

    fake_result = MagicMock()
    fake_result.scalars.return_value.all.return_value = [fake_check]

    fake_db = AsyncMock()
    fake_db.execute = AsyncMock(return_value=fake_result)

    analyzer = ana.HealthAnalyzer(
        db=fake_db,
        workspace_id="ws1",
        user_id="u1",
        session_id="s1",
    )
    checks = await analyzer.get_enabled_checks(project_type="python")
    assert len(checks) == 1
    assert checks[0] is fake_check


@pytest.mark.asyncio
async def test_get_enabled_checks_filters_by_project_type() -> None:
    """Checks with project_types are included only when project_type matches."""
    node_check = MagicMock()
    node_check.project_types = ["nodejs", "typescript"]
    python_check = MagicMock()
    python_check.project_types = ["python"]

    fake_result = MagicMock()
    fake_result.scalars.return_value.all.return_value = [node_check, python_check]

    fake_db = AsyncMock()
    fake_db.execute = AsyncMock(return_value=fake_result)

    analyzer = ana.HealthAnalyzer(
        db=fake_db,
        workspace_id="ws1",
        user_id="u1",
        session_id="s1",
    )
    checks = await analyzer.get_enabled_checks(project_type="python")
    assert len(checks) == 1
    assert checks[0] is python_check


@pytest.mark.asyncio
async def test_get_enabled_checks_empty_when_project_type_none_and_restricted() -> None:
    """When project_type is None, checks that require a project_type are excluded."""
    node_check = MagicMock()
    node_check.project_types = ["nodejs"]

    fake_result = MagicMock()
    fake_result.scalars.return_value.all.return_value = [node_check]

    fake_db = AsyncMock()
    fake_db.execute = AsyncMock(return_value=fake_result)

    analyzer = ana.HealthAnalyzer(
        db=fake_db,
        workspace_id="ws1",
        user_id="u1",
        session_id="s1",
    )
    checks = await analyzer.get_enabled_checks(project_type=None)
    assert len(checks) == 0
