"""Tests for main.py CLI module."""

import asyncio
import os
import signal
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from click.testing import CliRunner

from podex_local_pod.config import LocalPodConfig
from podex_local_pod.main import _init_sentry, cli


class TestSentryInitialization:
    """Test _init_sentry function."""

    def test_init_sentry_with_dsn(self):
        """Test Sentry initialization with DSN."""
        with (
            patch.dict(os.environ, {"SENTRY_DSN": "https://test@sentry.io/123"}),
            patch("sentry_sdk.init") as mock_init,
            patch("sentry_sdk.set_tag") as mock_tag,
        ):
            result = _init_sentry()
            assert result is True
            mock_init.assert_called_once()
            mock_tag.assert_called_with("service", "podex-local-pod")

    def test_init_sentry_without_dsn(self):
        """Test Sentry initialization without DSN."""
        with patch.dict(os.environ, {}, clear=True):
            result = _init_sentry()
            assert result is False

    def test_init_sentry_production_environment(self):
        """Test Sentry with production environment."""
        with (
            patch.dict(
                os.environ,
                {"SENTRY_DSN": "https://test@sentry.io/123", "ENVIRONMENT": "production"},
            ),
            patch("sentry_sdk.init") as mock_init,
        ):
            _init_sentry()
            call_kwargs = mock_init.call_args[1]
            assert call_kwargs["environment"] == "production"
            assert call_kwargs["traces_sample_rate"] == 0.2
            assert call_kwargs["profiles_sample_rate"] == 0.1

    def test_init_sentry_development_environment(self):
        """Test Sentry with development environment."""
        with (
            patch.dict(
                os.environ,
                {"SENTRY_DSN": "https://test@sentry.io/123", "ENVIRONMENT": "development"},
            ),
            patch("sentry_sdk.init") as mock_init,
        ):
            _init_sentry()
            call_kwargs = mock_init.call_args[1]
            assert call_kwargs["environment"] == "development"
            assert call_kwargs["traces_sample_rate"] == 1.0
            assert call_kwargs["profiles_sample_rate"] == 1.0

    def test_init_sentry_tags_set(self):
        """Test that Sentry tags are properly set."""
        with (
            patch.dict(os.environ, {"SENTRY_DSN": "https://test@sentry.io/123"}),
            patch("sentry_sdk.init"),
            patch("sentry_sdk.set_tag") as mock_tag,
        ):
            _init_sentry()
            mock_tag.assert_called_with("service", "podex-local-pod")

    def test_init_sentry_ignored_errors(self):
        """Test that expected errors are ignored."""
        with (
            patch.dict(os.environ, {"SENTRY_DSN": "https://test@sentry.io/123"}),
            patch("sentry_sdk.init") as mock_init,
        ):
            _init_sentry()
            call_kwargs = mock_init.call_args[1]
            assert "ConnectionRefusedError" in call_kwargs["ignore_errors"]
            assert "KeyboardInterrupt" in call_kwargs["ignore_errors"]
            assert "asyncio.CancelledError" in call_kwargs["ignore_errors"]


class TestCLIGroup:
    """Test CLI group."""

    def test_cli_help(self, cli_runner):
        """Test CLI help message."""
        result = cli_runner.invoke(cli, ["--help"])
        assert result.exit_code == 0
        assert "Podex Local Pod" in result.output
        assert "Self-hosted compute agent" in result.output

    def test_cli_version_option(self, cli_runner):
        """Test CLI version option."""
        result = cli_runner.invoke(cli, ["--version"])
        assert result.exit_code == 0
        assert "podex-local-pod" in result.output


class TestStartCommand:
    """Test 'start' command."""

    def test_start_with_token_flag(self, cli_runner):
        """Test start command with token flag."""
        with patch("podex_local_pod.main.LocalPodClient") as mock_client:
            mock_client_instance = MagicMock()
            mock_client_instance.run = AsyncMock()
            mock_client_instance.shutdown = AsyncMock()
            mock_client.return_value = mock_client_instance

            result = cli_runner.invoke(cli, ["start", "--token", "pdx_pod_test_token"])
            assert result.exit_code == 0
            mock_client.assert_called_once()

    def test_start_with_env_var_token(self, cli_runner):
        """Test start command with environment variable token."""
        with (
            patch.dict(os.environ, {"PODEX_POD_TOKEN": "pdx_pod_env_token"}),
            patch("podex_local_pod.main.LocalPodClient") as mock_client,
        ):
            mock_client_instance = MagicMock()
            mock_client_instance.run = AsyncMock()
            mock_client_instance.shutdown = AsyncMock()
            mock_client.return_value = mock_client_instance

            result = cli_runner.invoke(cli, ["start"])
            assert result.exit_code == 0

    def test_start_without_token_error(self, cli_runner):
        """Test start command without token shows error."""
        result = cli_runner.invoke(cli, ["start"])
        assert result.exit_code == 1
        assert "Error:" in result.output
        assert "Pod token is required" in result.output

    def test_start_with_config_file(self, cli_runner, temp_config_file):
        """Test start command with config file."""
        with patch("podex_local_pod.main.LocalPodClient") as mock_client:
            mock_client_instance = MagicMock()
            mock_client_instance.run = AsyncMock()
            mock_client_instance.shutdown = AsyncMock()
            mock_client.return_value = mock_client_instance

            result = cli_runner.invoke(cli, ["start", "--config", str(temp_config_file)])
            assert result.exit_code == 0

    def test_start_generates_pod_name_from_hostname(self, cli_runner):
        """Test that pod name defaults to hostname."""
        with (
            patch("podex_local_pod.main.LocalPodClient") as mock_client,
            patch("socket.gethostname", return_value="test-machine"),
        ):
            mock_client_instance = MagicMock()
            mock_client_instance.run = AsyncMock()
            mock_client_instance.shutdown = AsyncMock()
            mock_client.return_value = mock_client_instance

            result = cli_runner.invoke(cli, ["start", "--token", "pdx_pod_test"])
            assert result.exit_code == 0
            # Verify pod_name is set to hostname
            call_args = mock_client.call_args[0][0]
            assert call_args.pod_name == "test-machine"

    def test_start_with_custom_pod_name(self, cli_runner):
        """Test start command with custom pod name."""
        with patch("podex_local_pod.main.LocalPodClient") as mock_client:
            mock_client_instance = MagicMock()
            mock_client_instance.run = AsyncMock()
            mock_client_instance.shutdown = AsyncMock()
            mock_client.return_value = mock_client_instance

            result = cli_runner.invoke(
                cli, ["start", "--token", "pdx_pod_test", "--name", "my-custom-pod"]
            )
            assert result.exit_code == 0
            call_args = mock_client.call_args[0][0]
            assert call_args.pod_name == "my-custom-pod"

    def test_start_creates_client(self, cli_runner):
        """Test that start command creates LocalPodClient."""
        with patch("podex_local_pod.main.LocalPodClient") as mock_client:
            mock_client_instance = MagicMock()
            mock_client_instance.run = AsyncMock()
            mock_client_instance.shutdown = AsyncMock()
            mock_client.return_value = mock_client_instance

            cli_runner.invoke(cli, ["start", "--token", "pdx_pod_test"])
            mock_client.assert_called_once()
            assert isinstance(mock_client.call_args[0][0], LocalPodConfig)

class TestCheckCommand:
    """Test 'check' command."""

    def test_check_docker_available(self, cli_runner):
        """Test check command when Docker is available."""
        with patch("docker.from_env") as mock_docker:
            mock_client = MagicMock()
            mock_client.info.return_value = {"ServerVersion": "24.0.0"}
            mock_docker.return_value = mock_client

            with patch("psutil.virtual_memory") as mock_mem, patch(
                "psutil.cpu_count"
            ) as mock_cpu:
                mock_mem.return_value = MagicMock(total=17179869184)
                mock_cpu.return_value = 8

                result = cli_runner.invoke(cli, ["check"])
                assert result.exit_code == 0
                assert "Docker: " in result.output
                assert "OK" in result.output

    def test_check_docker_unavailable(self, cli_runner):
        """Test check command when Docker is unavailable."""
        with patch("docker.from_env", side_effect=Exception("Docker not found")):
            with patch("psutil.virtual_memory") as mock_mem, patch(
                "psutil.cpu_count"
            ) as mock_cpu:
                mock_mem.return_value = MagicMock(total=17179869184)
                mock_cpu.return_value = 8

                result = cli_runner.invoke(cli, ["check"])
                assert result.exit_code == 1
                assert "FAILED" in result.output

    def test_check_displays_docker_version(self, cli_runner):
        """Test that check displays Docker version."""
        with patch("docker.from_env") as mock_docker:
            mock_client = MagicMock()
            mock_client.info.return_value = {"ServerVersion": "25.0.1"}
            mock_docker.return_value = mock_client

            with patch("psutil.virtual_memory") as mock_mem, patch(
                "psutil.cpu_count"
            ) as mock_cpu:
                mock_mem.return_value = MagicMock(total=17179869184)
                mock_cpu.return_value = 8

                result = cli_runner.invoke(cli, ["check"])
                assert "25.0.1" in result.output

    def test_check_displays_system_resources(self, cli_runner):
        """Test that check displays system resources."""
        with patch("docker.from_env") as mock_docker:
            mock_client = MagicMock()
            mock_client.info.return_value = {"ServerVersion": "24.0.0"}
            mock_docker.return_value = mock_client

            with patch("psutil.virtual_memory") as mock_mem, patch(
                "psutil.cpu_count"
            ) as mock_cpu:
                mock_mem.return_value = MagicMock(total=17179869184)  # 16 GB
                mock_cpu.return_value = 12

                result = cli_runner.invoke(cli, ["check"])
                assert "Memory:" in result.output
                assert "CPU cores:" in result.output
                assert "12" in result.output

    def test_check_psutil_error_handling(self, cli_runner):
        """Test check command handles psutil errors."""
        with patch("docker.from_env") as mock_docker:
            mock_client = MagicMock()
            mock_client.info.return_value = {"ServerVersion": "24.0.0"}
            mock_docker.return_value = mock_client

            with patch("psutil.virtual_memory", side_effect=Exception("psutil error")):
                result = cli_runner.invoke(cli, ["check"])
                assert "Error:" in result.output
                assert result.exit_code == 1

    def test_check_platform_info(self, cli_runner):
        """Test that check displays platform info."""
        with patch("docker.from_env") as mock_docker:
            mock_client = MagicMock()
            mock_client.info.return_value = {"ServerVersion": "24.0.0"}
            mock_docker.return_value = mock_client

            with patch("psutil.virtual_memory") as mock_mem, patch(
                "psutil.cpu_count"
            ) as mock_cpu:
                mock_mem.return_value = MagicMock(total=17179869184)
                mock_cpu.return_value = 8

                result = cli_runner.invoke(cli, ["check"])
                assert "Platform:" in result.output
                assert "Architecture:" in result.output

    def test_check_all_passed(self, cli_runner):
        """Test check command when all checks pass."""
        with patch("docker.from_env") as mock_docker:
            mock_client = MagicMock()
            mock_client.info.return_value = {"ServerVersion": "24.0.0"}
            mock_docker.return_value = mock_client

            with patch("psutil.virtual_memory") as mock_mem, patch(
                "psutil.cpu_count"
            ) as mock_cpu:
                mock_mem.return_value = MagicMock(total=17179869184)
                mock_cpu.return_value = 8

                result = cli_runner.invoke(cli, ["check"])
                assert result.exit_code == 0
                assert "All checks passed" in result.output

    def test_check_fails_with_docker_error(self, cli_runner):
        """Test check command fails when Docker check fails."""
        with patch("docker.from_env", side_effect=Exception("Docker error")):
            with patch("psutil.virtual_memory") as mock_mem, patch(
                "psutil.cpu_count"
            ) as mock_cpu:
                mock_mem.return_value = MagicMock(total=17179869184)
                mock_cpu.return_value = 8

                result = cli_runner.invoke(cli, ["check"])
                assert result.exit_code == 1
                assert "Some checks failed" in result.output


class TestVersionCommand:
    """Test 'version' command."""

    def test_version_displays_correctly(self, cli_runner):
        """Test that version command displays version."""
        result = cli_runner.invoke(cli, ["version"])
        assert result.exit_code == 0
        assert "podex-local-pod" in result.output
