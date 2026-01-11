"""Comprehensive tests for Sentry SDK utilities."""

import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from podex_shared.sentry import (
    DEFAULT_PROFILES_SAMPLE_RATE,
    DEFAULT_TRACES_SAMPLE_RATE,
    DEV_TRACES_SAMPLE_RATE,
    SentryConfig,
    add_breadcrumb,
    capture_exception,
    capture_message,
    clear_user_context,
    distribution,
    gauge,
    incr,
    init_sentry,
    set_user_context,
    start_span,
    start_transaction,
    timing,
)


class TestSentryConfig:
    """Tests for SentryConfig dataclass."""

    def test_config_required_fields(self) -> None:
        """Test SentryConfig required fields."""
        config = SentryConfig(service_name="test-service")
        assert config.service_name == "test-service"
        assert config.dsn is None
        assert config.environment is None
        assert config.release is None

    def test_config_all_fields(self) -> None:
        """Test SentryConfig with all fields."""
        config = SentryConfig(
            service_name="test-service",
            dsn="https://key@sentry.io/123",
            environment="production",
            release="1.0.0",
            traces_sample_rate=0.5,
            profiles_sample_rate=0.2,
            enable_db_tracing=False,
            enable_redis_tracing=False,
        )
        assert config.dsn == "https://key@sentry.io/123"
        assert config.environment == "production"
        assert config.release == "1.0.0"
        assert config.traces_sample_rate == 0.5
        assert config.profiles_sample_rate == 0.2
        assert config.enable_db_tracing is False
        assert config.enable_redis_tracing is False

    def test_config_default_sample_rates(self) -> None:
        """Test SentryConfig default sample rates."""
        config = SentryConfig(service_name="test")
        assert config.traces_sample_rate is None
        assert config.profiles_sample_rate is None


class TestSampleRateConstants:
    """Tests for sample rate constants."""

    def test_default_rates(self) -> None:
        """Test default sample rates."""
        assert DEFAULT_TRACES_SAMPLE_RATE == 0.2
        assert DEFAULT_PROFILES_SAMPLE_RATE == 0.1
        assert DEV_TRACES_SAMPLE_RATE == 1.0


class TestInitSentry:
    """Tests for init_sentry function."""

    def test_init_without_dsn_returns_false(self) -> None:
        """Test that init without DSN returns False."""
        with patch.dict(os.environ, {}, clear=True):
            result = init_sentry("test-service")
            assert result is False

    @patch("podex_shared.sentry.sentry_sdk.init")
    @patch("podex_shared.sentry.sentry_sdk.set_tag")
    def test_init_with_dsn_returns_true(
        self, mock_set_tag: MagicMock, mock_init: MagicMock
    ) -> None:
        """Test that init with DSN returns True."""
        config = SentryConfig(
            service_name="test-service",
            dsn="https://key@sentry.io/123",
        )
        result = init_sentry("test-service", config=config)

        assert result is True
        mock_init.assert_called_once()
        mock_set_tag.assert_called_with("service", "test-service")

    @patch("podex_shared.sentry.sentry_sdk.init")
    @patch("podex_shared.sentry.sentry_sdk.set_tag")
    def test_init_with_env_dsn(
        self, mock_set_tag: MagicMock, mock_init: MagicMock
    ) -> None:
        """Test that init reads DSN from environment."""
        with patch.dict(os.environ, {"SENTRY_DSN": "https://env@sentry.io/456"}):
            result = init_sentry("test-service")
            assert result is True
            mock_init.assert_called_once()

    @patch("podex_shared.sentry.sentry_sdk.init")
    @patch("podex_shared.sentry.sentry_sdk.set_tag")
    def test_init_production_sample_rates(
        self, mock_set_tag: MagicMock, mock_init: MagicMock
    ) -> None:
        """Test production sample rates."""
        config = SentryConfig(
            service_name="test-service",
            dsn="https://key@sentry.io/123",
            environment="production",
        )
        init_sentry("test-service", config=config)

        call_kwargs = mock_init.call_args[1]
        assert call_kwargs["traces_sample_rate"] == DEFAULT_TRACES_SAMPLE_RATE
        assert call_kwargs["profiles_sample_rate"] == DEFAULT_PROFILES_SAMPLE_RATE

    @patch("podex_shared.sentry.sentry_sdk.init")
    @patch("podex_shared.sentry.sentry_sdk.set_tag")
    def test_init_development_sample_rates(
        self, mock_set_tag: MagicMock, mock_init: MagicMock
    ) -> None:
        """Test development sample rates."""
        config = SentryConfig(
            service_name="test-service",
            dsn="https://key@sentry.io/123",
            environment="development",
        )
        init_sentry("test-service", config=config)

        call_kwargs = mock_init.call_args[1]
        assert call_kwargs["traces_sample_rate"] == DEV_TRACES_SAMPLE_RATE

    @patch("podex_shared.sentry.sentry_sdk.init")
    @patch("podex_shared.sentry.sentry_sdk.set_tag")
    def test_init_custom_sample_rates(
        self, mock_set_tag: MagicMock, mock_init: MagicMock
    ) -> None:
        """Test custom sample rates."""
        config = SentryConfig(
            service_name="test-service",
            dsn="https://key@sentry.io/123",
            traces_sample_rate=0.8,
            profiles_sample_rate=0.4,
        )
        init_sentry("test-service", config=config)

        call_kwargs = mock_init.call_args[1]
        assert call_kwargs["traces_sample_rate"] == 0.8
        assert call_kwargs["profiles_sample_rate"] == 0.4


class TestSetUserContext:
    """Tests for user context functions."""

    @patch("podex_shared.sentry.sentry_sdk.set_user")
    def test_set_user_context_minimal(self, mock_set_user: MagicMock) -> None:
        """Test setting minimal user context."""
        set_user_context("user-123")

        mock_set_user.assert_called_once_with(
            {"id": "user-123", "email": None, "username": None}
        )

    @patch("podex_shared.sentry.sentry_sdk.set_user")
    def test_set_user_context_full(self, mock_set_user: MagicMock) -> None:
        """Test setting full user context."""
        set_user_context(
            "user-123",
            email="test@example.com",
            username="testuser",
            subscription="pro",
        )

        mock_set_user.assert_called_once_with(
            {
                "id": "user-123",
                "email": "test@example.com",
                "username": "testuser",
                "subscription": "pro",
            }
        )

    @patch("podex_shared.sentry.sentry_sdk.set_user")
    def test_clear_user_context(self, mock_set_user: MagicMock) -> None:
        """Test clearing user context."""
        clear_user_context()
        mock_set_user.assert_called_once_with(None)


class TestCaptureException:
    """Tests for capture_exception function."""

    @patch("podex_shared.sentry.sentry_sdk.push_scope")
    @patch("podex_shared.sentry.sentry_sdk.capture_exception")
    def test_capture_exception_basic(
        self, mock_capture: MagicMock, mock_push_scope: MagicMock
    ) -> None:
        """Test basic exception capture."""
        mock_scope = MagicMock()
        mock_push_scope.return_value.__enter__ = MagicMock(return_value=mock_scope)
        mock_push_scope.return_value.__exit__ = MagicMock(return_value=False)
        mock_capture.return_value = "event-123"

        error = ValueError("test error")
        result = capture_exception(error)

        mock_capture.assert_called_once_with(error)
        assert result == "event-123"

    @patch("podex_shared.sentry.sentry_sdk.push_scope")
    @patch("podex_shared.sentry.sentry_sdk.capture_exception")
    def test_capture_exception_with_tags(
        self, mock_capture: MagicMock, mock_push_scope: MagicMock
    ) -> None:
        """Test exception capture with tags."""
        mock_scope = MagicMock()
        mock_push_scope.return_value.__enter__ = MagicMock(return_value=mock_scope)
        mock_push_scope.return_value.__exit__ = MagicMock(return_value=False)

        error = ValueError("test error")
        capture_exception(error, tags={"component": "api", "version": "1.0"})

        mock_scope.set_tag.assert_any_call("component", "api")
        mock_scope.set_tag.assert_any_call("version", "1.0")

    @patch("podex_shared.sentry.sentry_sdk.push_scope")
    @patch("podex_shared.sentry.sentry_sdk.capture_exception")
    def test_capture_exception_with_extra(
        self, mock_capture: MagicMock, mock_push_scope: MagicMock
    ) -> None:
        """Test exception capture with extra data."""
        mock_scope = MagicMock()
        mock_push_scope.return_value.__enter__ = MagicMock(return_value=mock_scope)
        mock_push_scope.return_value.__exit__ = MagicMock(return_value=False)

        error = ValueError("test error")
        capture_exception(error, extra={"user_id": "123", "request_id": "abc"})

        mock_scope.set_extra.assert_any_call("user_id", "123")
        mock_scope.set_extra.assert_any_call("request_id", "abc")

    @patch("podex_shared.sentry.sentry_sdk.push_scope")
    @patch("podex_shared.sentry.sentry_sdk.capture_exception")
    def test_capture_exception_with_level(
        self, mock_capture: MagicMock, mock_push_scope: MagicMock
    ) -> None:
        """Test exception capture with custom level."""
        mock_scope = MagicMock()
        mock_push_scope.return_value.__enter__ = MagicMock(return_value=mock_scope)
        mock_push_scope.return_value.__exit__ = MagicMock(return_value=False)

        error = ValueError("test error")
        capture_exception(error, level="warning")

        assert mock_scope.level == "warning"


class TestCaptureMessage:
    """Tests for capture_message function."""

    @patch("podex_shared.sentry.sentry_sdk.push_scope")
    @patch("podex_shared.sentry.sentry_sdk.capture_message")
    def test_capture_message_basic(
        self, mock_capture: MagicMock, mock_push_scope: MagicMock
    ) -> None:
        """Test basic message capture."""
        mock_scope = MagicMock()
        mock_push_scope.return_value.__enter__ = MagicMock(return_value=mock_scope)
        mock_push_scope.return_value.__exit__ = MagicMock(return_value=False)
        mock_capture.return_value = "event-456"

        result = capture_message("Test message")

        mock_capture.assert_called_once_with("Test message")
        assert result == "event-456"
        assert mock_scope.level == "info"

    @patch("podex_shared.sentry.sentry_sdk.push_scope")
    @patch("podex_shared.sentry.sentry_sdk.capture_message")
    def test_capture_message_with_level(
        self, mock_capture: MagicMock, mock_push_scope: MagicMock
    ) -> None:
        """Test message capture with custom level."""
        mock_scope = MagicMock()
        mock_push_scope.return_value.__enter__ = MagicMock(return_value=mock_scope)
        mock_push_scope.return_value.__exit__ = MagicMock(return_value=False)

        capture_message("Warning message", level="warning")

        assert mock_scope.level == "warning"


class TestAddBreadcrumb:
    """Tests for add_breadcrumb function."""

    @patch("podex_shared.sentry.sentry_sdk.add_breadcrumb")
    def test_add_breadcrumb_basic(self, mock_add: MagicMock) -> None:
        """Test basic breadcrumb."""
        add_breadcrumb("User clicked button")

        mock_add.assert_called_once_with(
            message="User clicked button",
            category="custom",
            level="info",
            data={},
        )

    @patch("podex_shared.sentry.sentry_sdk.add_breadcrumb")
    def test_add_breadcrumb_with_options(self, mock_add: MagicMock) -> None:
        """Test breadcrumb with options."""
        add_breadcrumb(
            "API request",
            category="http",
            level="debug",
            data={"url": "/api/users", "method": "GET"},
        )

        mock_add.assert_called_once_with(
            message="API request",
            category="http",
            level="debug",
            data={"url": "/api/users", "method": "GET"},
        )


class TestStartTransaction:
    """Tests for start_transaction function."""

    @patch("podex_shared.sentry.sentry_sdk.start_transaction")
    def test_start_transaction(self, mock_start: MagicMock) -> None:
        """Test starting a transaction."""
        start_transaction("my-task", op="background.task")

        mock_start.assert_called_once_with(name="my-task", op="background.task")

    @patch("podex_shared.sentry.sentry_sdk.start_transaction")
    def test_start_transaction_default_op(self, mock_start: MagicMock) -> None:
        """Test starting transaction with default op."""
        start_transaction("my-task")

        mock_start.assert_called_once_with(name="my-task", op="task")


class TestStartSpan:
    """Tests for start_span function."""

    @patch("podex_shared.sentry.sentry_sdk.start_span")
    def test_start_span(self, mock_start: MagicMock) -> None:
        """Test starting a span."""
        start_span("db.query", description="SELECT * FROM users")

        mock_start.assert_called_once_with(
            op="db.query",
            description="SELECT * FROM users",
        )


class TestMetrics:
    """Tests for metrics functions."""

    @patch("podex_shared.sentry.sentry_sdk.metrics.count")
    def test_incr(self, mock_count: MagicMock) -> None:
        """Test incrementing a counter."""
        incr("api.requests", value=1.0, tags={"endpoint": "/users"})

        mock_count.assert_called_once_with(
            "api.requests",
            1.0,
            unit="none",
            attributes={"endpoint": "/users"},
        )

    @patch("podex_shared.sentry.sentry_sdk.metrics.count")
    def test_incr_default_value(self, mock_count: MagicMock) -> None:
        """Test incr with default value."""
        incr("counter")

        mock_count.assert_called_once_with(
            "counter",
            1.0,
            unit="none",
            attributes=None,
        )

    @patch("podex_shared.sentry.sentry_sdk.metrics.gauge")
    def test_gauge(self, mock_gauge: MagicMock) -> None:
        """Test setting a gauge."""
        gauge("memory.usage", 1024.0, tags={"host": "server1"}, unit="byte")

        mock_gauge.assert_called_once_with(
            "memory.usage",
            1024.0,
            unit="byte",
            attributes={"host": "server1"},
        )

    @patch("podex_shared.sentry.sentry_sdk.metrics.distribution")
    def test_distribution(self, mock_dist: MagicMock) -> None:
        """Test recording a distribution."""
        distribution("request.latency", 0.123, unit="second")

        mock_dist.assert_called_once_with(
            "request.latency",
            0.123,
            unit="second",
            attributes=None,
        )


class TestTiming:
    """Tests for timing context manager."""

    @patch("podex_shared.sentry.sentry_sdk.metrics.distribution")
    def test_timing(self, mock_dist: MagicMock) -> None:
        """Test timing context manager."""
        with timing("operation.duration"):
            # Simulate some work
            pass

        mock_dist.assert_called_once()
        call_args = mock_dist.call_args
        assert call_args[0][0] == "operation.duration"
        assert call_args[0][1] >= 0  # Duration should be non-negative
        assert call_args[1]["unit"] == "second"

    @patch("podex_shared.sentry.sentry_sdk.metrics.distribution")
    def test_timing_with_tags(self, mock_dist: MagicMock) -> None:
        """Test timing with tags."""
        with timing("db.query", tags={"table": "users"}):
            pass

        call_args = mock_dist.call_args
        assert call_args[1]["attributes"] == {"table": "users"}
