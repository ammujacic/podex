"""Sentry SDK initialization and utilities for Podex services."""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Callable, Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, cast

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.httpx import HttpxIntegration
from sentry_sdk.integrations.logging import LoggingIntegration
from sentry_sdk.integrations.redis import RedisIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

if TYPE_CHECKING:
    from sentry_sdk.types import Event

# Type alias for Sentry event callbacks
EventCallback = Callable[[dict[str, Any], dict[str, Any]], dict[str, Any] | None]

# Default sample rates
DEFAULT_TRACES_SAMPLE_RATE = 0.2  # 20% of transactions in production
DEFAULT_PROFILES_SAMPLE_RATE = 0.1  # 10% of profiled transactions
DEV_TRACES_SAMPLE_RATE = 1.0  # 100% in development


@dataclass
class SentryConfig:
    """Configuration for Sentry SDK initialization."""

    service_name: str
    dsn: str | None = None
    environment: str | None = None
    release: str | None = None
    traces_sample_rate: float | None = None
    profiles_sample_rate: float | None = None
    enable_db_tracing: bool = True
    enable_redis_tracing: bool = True
    additional_integrations: list[Any] = field(default_factory=list)
    before_send: EventCallback | None = None
    before_send_transaction: EventCallback | None = None


def init_sentry(
    service_name: str,
    config: SentryConfig | None = None,
) -> bool:
    """
    Initialize Sentry SDK with standard configuration for Podex services.

    Args:
        service_name: Name of the service (e.g., 'podex-api', 'podex-agent')
        config: Optional SentryConfig object with full configuration

    Returns:
        True if Sentry was initialized, False if DSN was not provided
    """
    # Build effective config from parameters
    cfg = config or SentryConfig(service_name=service_name)
    effective_dsn = cfg.dsn or os.environ.get("SENTRY_DSN")
    if not effective_dsn:
        return False

    effective_env = cfg.environment or os.environ.get("ENVIRONMENT", "development")
    is_production = effective_env == "production"

    # Calculate sample rates
    effective_traces_rate = cfg.traces_sample_rate
    effective_profiles_rate = cfg.profiles_sample_rate
    if effective_traces_rate is None:
        effective_traces_rate = (
            DEFAULT_TRACES_SAMPLE_RATE if is_production else DEV_TRACES_SAMPLE_RATE
        )
    if effective_profiles_rate is None:
        effective_profiles_rate = (
            DEFAULT_PROFILES_SAMPLE_RATE if is_production else DEV_TRACES_SAMPLE_RATE
        )

    # Build integrations list
    integrations: list[Any] = [
        StarletteIntegration(transaction_style="endpoint"),
        FastApiIntegration(transaction_style="endpoint"),
        HttpxIntegration(),
        LoggingIntegration(level=None, event_level=logging.ERROR),
    ]

    # Optional integrations
    if cfg.enable_db_tracing:
        integrations.append(SqlalchemyIntegration())

    if cfg.enable_redis_tracing:
        integrations.append(RedisIntegration())

    # Add any additional integrations
    if cfg.additional_integrations:
        integrations.extend(cfg.additional_integrations)

    # Default before_send to scrub sensitive data
    def default_before_send(
        event: Event,
        hint: dict[str, Any],
    ) -> Event | None:
        # Scrub sensitive headers
        request = event.get("request")
        if request is not None:
            headers = request.get("headers")
            if headers is not None and isinstance(headers, dict):
                sensitive_headers = ["authorization", "cookie", "x-api-key", "x-auth-token"]
                for header in sensitive_headers:
                    if header in headers:
                        headers[header] = "[Filtered]"

        # Call custom before_send if provided
        if cfg.before_send:
            result = cfg.before_send(cast("dict[str, Any]", event), hint)
            return cast("Event | None", result)
        return event

    # Default before_send_transaction to filter health checks
    def default_before_send_transaction(
        event: Event,
        hint: dict[str, Any],
    ) -> Event | None:
        # Filter out health check transactions
        transaction_name = event.get("transaction", "")
        if any(
            pattern in str(transaction_name)
            for pattern in ["/health", "/readiness", "/liveness", "/_health"]
        ):
            return None

        # Call custom before_send_transaction if provided
        if cfg.before_send_transaction:
            result = cfg.before_send_transaction(cast("dict[str, Any]", event), hint)
            return cast("Event | None", result)
        return event

    default_release = f"{service_name}@{os.environ.get('VERSION', '0.1.0')}"
    effective_release = cfg.release or default_release

    # Initialize Sentry
    sentry_sdk.init(
        dsn=effective_dsn,
        environment=effective_env,
        release=effective_release,
        # Performance monitoring
        traces_sample_rate=effective_traces_rate,
        # Profiling (requires traces)
        profiles_sample_rate=effective_profiles_rate,
        # Metrics (beta feature)
        _experiments={
            "continuous_profiling_auto_start": True,
        },
        # Integrations
        integrations=integrations,
        # Event processing
        before_send=default_before_send,
        before_send_transaction=default_before_send_transaction,
        # Additional options
        send_default_pii=False,
        attach_stacktrace=True,
        max_breadcrumbs=50,
        # Debug mode for development
        debug=effective_env == "development" and os.environ.get("SENTRY_DEBUG") == "true",
        # Server name
        server_name=service_name,
        # Ignore common expected errors
        ignore_errors=[
            # Connection errors that are expected
            "ConnectionRefusedError",
            "ConnectionResetError",
            "TimeoutError",
            # Graceful shutdown
            "asyncio.CancelledError",
            "KeyboardInterrupt",
            "SystemExit",
        ],
        # Enable tracing for specific URLs
        trace_propagation_targets=[
            "localhost",
            r".*\.podex\.dev",
            r".*\.podex\.io",
        ],
    )

    # Set service tag
    sentry_sdk.set_tag("service", service_name)

    return True


def set_user_context(
    user_id: str,
    email: str | None = None,
    username: str | None = None,
    **extra: Any,
) -> None:
    """Set the current user context for Sentry events."""
    sentry_sdk.set_user(
        {
            "id": user_id,
            "email": email,
            "username": username,
            **extra,
        }
    )


def clear_user_context() -> None:
    """Clear the current user context."""
    sentry_sdk.set_user(None)


def capture_exception(
    error: Exception,
    *,
    tags: dict[str, str] | None = None,
    extra: dict[str, Any] | None = None,
    level: str | None = None,
) -> str | None:
    """
    Capture an exception and send it to Sentry.

    Args:
        error: The exception to capture
        tags: Additional tags to attach to the event
        extra: Additional context data
        level: Override the severity level

    Returns:
        The Sentry event ID, or None if not sent
    """
    with sentry_sdk.push_scope() as scope:
        if tags:
            for key, value in tags.items():
                scope.set_tag(key, value)
        if extra:
            for key, value in extra.items():
                scope.set_extra(key, value)
        if level:
            scope.level = level

        return sentry_sdk.capture_exception(error)


def capture_message(
    message: str,
    *,
    level: str = "info",
    tags: dict[str, str] | None = None,
    extra: dict[str, Any] | None = None,
) -> str | None:
    """
    Capture a message and send it to Sentry.

    Args:
        message: The message to capture
        level: Severity level (debug, info, warning, error, fatal)
        tags: Additional tags to attach to the event
        extra: Additional context data

    Returns:
        The Sentry event ID, or None if not sent
    """
    with sentry_sdk.push_scope() as scope:
        scope.level = level
        if tags:
            for key, value in tags.items():
                scope.set_tag(key, value)
        if extra:
            for key, value in extra.items():
                scope.set_extra(key, value)

        return sentry_sdk.capture_message(message)


def add_breadcrumb(
    message: str,
    *,
    category: str = "custom",
    level: str = "info",
    data: dict[str, Any] | None = None,
) -> None:
    """
    Add a breadcrumb to the current scope.

    Breadcrumbs are a trail of events that help debug issues.

    Args:
        message: Description of the breadcrumb
        category: Category for grouping (e.g., 'http', 'query', 'ui')
        level: Severity level
        data: Additional data to attach
    """
    sentry_sdk.add_breadcrumb(
        message=message,
        category=category,
        level=level,
        data=data or {},
    )


def start_transaction(
    name: str,
    op: str = "task",
    **kwargs: Any,
) -> Any:
    """
    Start a new transaction for performance monitoring.

    Args:
        name: Transaction name
        op: Operation type (e.g., 'http.server', 'task', 'queue.process')
        **kwargs: Additional transaction options

    Returns:
        The transaction object (use as context manager)
    """
    return sentry_sdk.start_transaction(name=name, op=op, **kwargs)


def start_span(
    op: str,
    description: str | None = None,
    **kwargs: Any,
) -> Any:
    """
    Start a new span within the current transaction.

    Args:
        op: Operation type
        description: Span description
        **kwargs: Additional span options

    Returns:
        The span object (use as context manager)
    """
    return sentry_sdk.start_span(op=op, description=description, **kwargs)


# Metrics API (beta)
def incr(
    key: str,
    value: float = 1.0,
    *,
    tags: dict[str, str] | None = None,
    unit: str = "none",
) -> None:
    """
    Increment a counter metric.

    Args:
        key: Metric name
        value: Value to increment by
        tags: Additional tags
        unit: Unit of measurement
    """
    sentry_sdk.metrics.count(key, value, unit=unit, attributes=tags)


def gauge(
    key: str,
    value: float,
    *,
    tags: dict[str, str] | None = None,
    unit: str = "none",
) -> None:
    """
    Set a gauge metric value.

    Args:
        key: Metric name
        value: Current value
        tags: Additional tags
        unit: Unit of measurement
    """
    sentry_sdk.metrics.gauge(key, value, unit=unit, attributes=tags)


def distribution(
    key: str,
    value: float,
    *,
    tags: dict[str, str] | None = None,
    unit: str = "none",
) -> None:
    """
    Record a distribution metric value.

    Args:
        key: Metric name
        value: Value to record
        tags: Additional tags
        unit: Unit of measurement (e.g., 'second', 'millisecond', 'byte')
    """
    sentry_sdk.metrics.distribution(key, value, unit=unit, attributes=tags)


@contextmanager
def timing(
    key: str,
    *,
    tags: dict[str, str] | None = None,
    unit: str = "second",
) -> Generator[None, None, None]:
    """
    Context manager for timing a code block.

    Args:
        key: Metric name
        tags: Additional tags
        unit: Unit of measurement

    Yields:
        None - use as context manager to measure duration
    """
    start = time.perf_counter()
    try:
        yield
    finally:
        duration = time.perf_counter() - start
        sentry_sdk.metrics.distribution(key, duration, unit=unit, attributes=tags)
