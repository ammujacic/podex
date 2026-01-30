"""Pytest fixtures for local-pod tests."""

from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def cli_runner():
    """Click CLI test runner."""
    from click.testing import CliRunner

    return CliRunner()


@pytest.fixture
def mock_sentry_sdk():
    """Mock Sentry SDK."""
    with (
        patch("sentry_sdk.init") as mock_init,
        patch("sentry_sdk.set_tag") as mock_tag,
        patch("sentry_sdk.flush") as mock_flush,
    ):
        yield {"init": mock_init, "set_tag": mock_tag, "flush": mock_flush}


@pytest.fixture
def mock_psutil():
    """Mock psutil for system checks."""
    with (
        patch("psutil.virtual_memory") as mock_mem,
        patch("psutil.cpu_count") as mock_cpu,
        patch("psutil.cpu_percent") as mock_cpu_pct,
    ):
        mock_mem.return_value = MagicMock(
            total=17179869184,  # 16 GB
            used=8589934592,  # 8 GB
            percent=50.0,
        )
        mock_cpu.return_value = 8
        mock_cpu_pct.return_value = 25.0
        yield {"memory": mock_mem, "cpu_count": mock_cpu, "cpu_percent": mock_cpu_pct}


@pytest.fixture
def mock_signal_handlers():
    """Mock signal handler setup."""
    with patch("signal.signal") as mock_signal:
        yield mock_signal
