"""Unit tests for health check_runner (CheckRunner.run_check with mocked compute)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from src.health.check_runner import CheckResult, CheckRunner


@pytest.mark.asyncio
async def test_run_check_success_exit_code_mode() -> None:
    """run_check returns CheckResult with score from exit_code parse when command succeeds."""
    fake_compute = AsyncMock()
    fake_compute.exec_command = AsyncMock(
        return_value={"stdout": "", "stderr": "", "exit_code": 0}
    )

    with patch("src.health.check_runner.get_compute_client_for_workspace", AsyncMock(return_value=fake_compute)):
        runner = CheckRunner(workspace_id="ws1", user_id="u1")
        result = await runner.run_check(
            check_id="c1",
            check_name="Lint",
            category="code_quality",
            command="ruff check .",
            working_directory=".",
            timeout=60,
            parse_mode="exit_code",
            parse_config={},
            weight=1.0,
        )

    assert isinstance(result, CheckResult)
    assert result.check_id == "c1"
    assert result.check_name == "Lint"
    assert result.category == "code_quality"
    assert result.score == 100
    assert result.success is True
    assert result.details.get("success") is True
    assert result.error is None
    assert result.execution_time_ms >= 0


@pytest.mark.asyncio
async def test_run_check_success_uses_stdout_over_stderr() -> None:
    """run_check uses stdout for parsing when present."""
    fake_compute = AsyncMock()
    fake_compute.exec_command = AsyncMock(
        return_value={"stdout": "ok", "stderr": "warn", "exit_code": 0}
    )

    with patch("src.health.check_runner.get_compute_client_for_workspace", AsyncMock(return_value=fake_compute)):
        runner = CheckRunner(workspace_id="ws1", user_id="u1")
        result = await runner.run_check(
            check_id="c1",
            check_name="Lint",
            category="code_quality",
            command="cmd",
            working_directory=None,
            timeout=30,
            parse_mode="exit_code",
            parse_config={"score_on_success": 100, "score_on_failure": 0},
            weight=1.0,
        )

    assert result.success is True
    assert result.score == 100


@pytest.mark.asyncio
async def test_run_check_failure_exit_code() -> None:
    """run_check returns success=False and score 0 when command fails (exit_code mode)."""
    fake_compute = AsyncMock()
    fake_compute.exec_command = AsyncMock(
        return_value={"stdout": "", "stderr": "error", "exit_code": 1}
    )

    with patch("src.health.check_runner.get_compute_client_for_workspace", AsyncMock(return_value=fake_compute)):
        runner = CheckRunner(workspace_id="ws1", user_id="u1")
        result = await runner.run_check(
            check_id="c1",
            check_name="Lint",
            category="code_quality",
            command="cmd",
            working_directory=None,
            timeout=30,
            parse_mode="exit_code",
            parse_config={},
            weight=1.0,
        )

    assert result.success is True  # parse succeeded; score reflects failure
    assert result.score == 0
    assert result.details.get("success") is False


@pytest.mark.asyncio
async def test_run_check_timeout_returns_failure_result() -> None:
    """run_check returns CheckResult with timed_out when exec_command raises TimeoutError."""
    fake_compute = AsyncMock()
    fake_compute.exec_command = AsyncMock(side_effect=TimeoutError())

    with patch("src.health.check_runner.get_compute_client_for_workspace", AsyncMock(return_value=fake_compute)):
        runner = CheckRunner(workspace_id="ws1", user_id="u1")
        result = await runner.run_check(
            check_id="c1",
            check_name="Lint",
            category="code_quality",
            command="cmd",
            working_directory=None,
            timeout=10,
            parse_mode="exit_code",
            parse_config={},
            weight=1.0,
        )

    assert result.success is False
    assert result.score == 0
    assert result.details.get("timed_out") is True
    assert "timed out" in (result.error or "")


@pytest.mark.asyncio
async def test_run_check_exception_returns_failure_result() -> None:
    """run_check returns CheckResult with error when exec_command raises."""
    fake_compute = AsyncMock()
    fake_compute.exec_command = AsyncMock(side_effect=RuntimeError("compute unavailable"))

    with patch("src.health.check_runner.get_compute_client_for_workspace", AsyncMock(return_value=fake_compute)):
        runner = CheckRunner(workspace_id="ws1", user_id="u1")
        result = await runner.run_check(
            check_id="c1",
            check_name="Lint",
            category="code_quality",
            command="cmd",
            working_directory=None,
            timeout=30,
            parse_mode="exit_code",
            parse_config={},
            weight=1.0,
        )

    assert result.success is False
    assert result.score == 0
    assert "compute unavailable" in (result.error or "")
    assert result.details.get("error") == "compute unavailable"


def test_check_result_dataclass() -> None:
    """CheckResult holds all expected fields."""
    r = CheckResult(
        check_id="c1",
        check_name="Lint",
        category="code_quality",
        score=85.0,
        weight=1.0,
        success=True,
        details={"error_count": 2},
        error=None,
        raw_output="...",
        execution_time_ms=100.0,
    )
    assert r.check_id == "c1"
    assert r.score == 85.0
    assert r.execution_time_ms == 100.0
