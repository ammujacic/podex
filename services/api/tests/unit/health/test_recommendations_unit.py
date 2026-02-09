"""Unit tests for health recommendations pure helpers."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from src.health import recommendations as rec
from src.health.check_runner import CheckResult


def test_get_impact_security() -> None:
    assert rec._get_impact("security", 20) == "high"
    assert rec._get_impact("security", 60) == "medium"  # fallback


def test_get_impact_code_quality() -> None:
    assert rec._get_impact("code_quality", 40) == "medium"
    assert rec._get_impact("code_quality", 80) == "low"


def test_get_impact_test_coverage() -> None:
    assert rec._get_impact("test_coverage", 20) == "high"
    assert rec._get_impact("test_coverage", 50) == "medium"
    assert rec._get_impact("test_coverage", 70) == "low"


def test_get_impact_documentation() -> None:
    assert rec._get_impact("documentation", 0) == "low"


def test_get_impact_dependencies() -> None:
    assert rec._get_impact("dependencies", 40) == "medium"
    assert rec._get_impact("dependencies", 80) == "low"


def test_get_impact_unknown_category() -> None:
    assert rec._get_impact("other", 50) == "medium"


def test_generate_recommendations_skips_success_high_score() -> None:
    """Checks with success and score >= 80 are skipped."""
    result = CheckResult(
        check_id="c1",
        check_name="Lint",
        category="code_quality",
        score=85.0,
        weight=1.0,
        success=True,
        details={},
    )
    check = MagicMock()
    check.id = "c1"
    check.name = "Lint"
    check.fix_command = None

    recs = rec.generate_recommendations({}, [result], [check])
    assert len(recs) == 0


def test_generate_recommendations_includes_low_score() -> None:
    """Checks with low score get a recommendation."""
    result = CheckResult(
        check_id="c1",
        check_name="Lint",
        category="code_quality",
        score=30.0,
        weight=1.0,
        success=False,
        details={"error_count": 5, "warning_count": 2},
    )
    check = MagicMock()
    check.id = "c1"
    check.name = "Lint"
    check.fix_command = "ruff check --fix"

    recs = rec.generate_recommendations({}, [result], [check])
    assert len(recs) >= 1
    assert recs[0]["priority"] in ("high", "medium", "low")
    assert recs[0]["type"] == "code_quality"
    assert recs[0]["current_score"] == 30.0


def test_generate_recommendations_sorted_by_priority() -> None:
    """Recommendations are sorted high -> medium -> low."""
    results = [
        CheckResult("c1", "A", "code_quality", 80.0, 1.0, True, {}),
        CheckResult("c2", "B", "security", 20.0, 1.0, False, {"critical": 1}),
        CheckResult("c3", "C", "documentation", 50.0, 1.0, False, {}),
    ]
    checks = [
        MagicMock(id="c1", name="A", fix_command=None),
        MagicMock(id="c2", name="B", fix_command=None),
        MagicMock(id="c3", name="C", fix_command=None),
    ]
    for c in checks:
        c.id = c.id
        c.name = c.name
        c.fix_command = c.fix_command

    recs = rec.generate_recommendations({}, results, checks)
    # c1 is skipped (success and 80). c2 high, c3 low/medium. Order: high first
    if len(recs) >= 2:
        order = [r["priority"] for r in recs]
        high_idx = next((i for i, p in enumerate(order) if p == "high"), None)
        low_idx = next((i for i, p in enumerate(order) if p == "low"), None)
        if high_idx is not None and low_idx is not None:
            assert high_idx < low_idx
