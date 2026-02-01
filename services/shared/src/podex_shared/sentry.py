"""Sentry SDK initialization and utilities for Podex services."""

from __future__ import annotations

import logging
import os
import sys
import time
from collections.abc import Callable, Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, cast

import sentry_sdk
import structlog
from sentry_sdk.integrations.asyncio import AsyncioIntegration
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
DEFAULT_ERROR_SAMPLE_RATE = 1.0  # 100% of errors
DEV_TRACES_SAMPLE_RATE = 1.0  # 100% in development

# File size bucket thresholds
FILE_SIZE_SMALL_THRESHOLD = 1024  # 1 KB
FILE_SIZE_MEDIUM_THRESHOLD = 1024 * 1024  # 1 MB


def configure_logging(
    service_name: str,
    log_level: int = logging.INFO,
    json_format: bool | None = None,
) -> structlog.stdlib.BoundLogger:
    """
    Configure unified logging for Podex services.

    Sets up both Python's standard logging and structlog to work together,
    with proper Sentry integration. Call this once at service startup,
    AFTER init_sentry().

    Args:
        service_name: Name of the service for log context
        log_level: Minimum log level (default: INFO)
        json_format: Use JSON output (True) or console format (False).
                     If None (default), auto-detect based on ENVIRONMENT:
                     - development: console format with colors
                     - production: JSON format for log aggregation

    Returns:
        Configured structlog logger

    Example:
        from podex_shared import init_sentry, configure_logging, SentryConfig

        init_sentry("my-service", SentryConfig(...))
        logger = configure_logging("my-service")
        logger.info("Service started", port=8080)
    """
    # Auto-detect format based on environment if not specified
    if json_format is None:
        environment = os.environ.get("ENVIRONMENT", "development")
        json_format = environment != "development"
    # Configure Python's root logger to output to stdout
    # This is required for structlog's stdlib integration to work
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    # Remove existing handlers to avoid duplicates on hot reload
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    # Add stdout handler
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(log_level)

    # Use a simple format - structlog handles the actual formatting
    handler.setFormatter(logging.Formatter("%(message)s"))
    root_logger.addHandler(handler)

    # Build structlog processors
    processors: list[Any] = [
        # Filter by log level
        structlog.stdlib.filter_by_level,
        # Add logger name and level
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        # Handle positional arguments
        structlog.stdlib.PositionalArgumentsFormatter(),
        # Add timestamp
        structlog.processors.TimeStamper(fmt="iso"),
        # Add stack info for exceptions
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        # Decode unicode
        structlog.processors.UnicodeDecoder(),
        # Add service context
        structlog.processors.CallsiteParameterAdder(
            [
                structlog.processors.CallsiteParameter.FILENAME,
                structlog.processors.CallsiteParameter.LINENO,
            ]
        ),
    ]

    # Add Sentry integration processor
    processors.extend(_get_sentry_processors())

    # Add final renderer
    if json_format:
        processors.append(structlog.processors.JSONRenderer())
    else:
        processors.append(structlog.dev.ConsoleRenderer(colors=True))

    # Configure structlog
    structlog.configure(
        processors=processors,
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Return a logger bound with service name
    return cast("structlog.stdlib.BoundLogger", structlog.get_logger(service_name))


def _get_sentry_processors() -> list[Any]:
    """Get structlog processors for Sentry integration."""

    def add_sentry_context(
        _logger: Any,
        method_name: str,
        event_dict: dict[str, Any],
    ) -> dict[str, Any]:
        """Add structlog event data to Sentry breadcrumbs and capture errors."""
        # Add as breadcrumb for context
        level = event_dict.get("level", "info")
        message = event_dict.get("event", "")

        # Extract extra data (everything except standard keys)
        standard_keys = {"event", "level", "timestamp", "logger", "filename", "lineno"}
        extra_data = {k: v for k, v in event_dict.items() if k not in standard_keys}

        sentry_sdk.add_breadcrumb(
            message=str(message),
            category="log",
            level=level,
            data=extra_data if extra_data else None,
        )

        # For errors, capture to Sentry
        if method_name in ("error", "exception", "critical"):
            exc_info = event_dict.get("exc_info")
            if exc_info:
                sentry_sdk.capture_exception(exc_info[1] if isinstance(exc_info, tuple) else None)
            else:
                # Capture as message with extra context
                # Use isolation_scope for isolation (new API replacing push_scope)
                with sentry_sdk.isolation_scope() as scope:
                    for key, value in extra_data.items():
                        scope.set_extra(key, value)
                    sentry_sdk.capture_message(
                        str(message),
                        level="error" if method_name == "error" else "fatal",
                    )

        return event_dict

    return [add_sentry_context]


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
    enable_logs: bool = True  # Enable Sentry Logs feature
    enable_spotlight: bool = True  # Enable Spotlight for local development
    additional_integrations: list[Any] = field(default_factory=list)
    before_send: EventCallback | None = None
    before_send_transaction: EventCallback | None = None


def _build_integrations(cfg: SentryConfig) -> list[Any]:
    """Build the list of Sentry integrations based on configuration."""
    integrations: list[Any] = [
        # Web framework integrations
        StarletteIntegration(transaction_style="endpoint"),
        FastApiIntegration(transaction_style="endpoint"),
        # HTTP client integration
        HttpxIntegration(),
        # Async support
        AsyncioIntegration(),
        # Logging integration - captures Python logging as breadcrumbs and sends errors
        LoggingIntegration(
            level=logging.INFO,  # Capture INFO+ as breadcrumbs
            event_level=logging.ERROR,  # Send ERROR+ to Sentry
        ),
    ]

    # Optional integrations
    if cfg.enable_db_tracing:
        integrations.append(SqlalchemyIntegration())

    if cfg.enable_redis_tracing:
        integrations.append(RedisIntegration())

    # Add any additional integrations
    if cfg.additional_integrations:
        integrations.extend(cfg.additional_integrations)

    return integrations


def init_sentry(
    service_name: str,
    config: SentryConfig | None = None,
) -> bool:
    """
    Initialize Sentry SDK with standard configuration for Podex services.

    Features enabled:
    - Error tracking with stack traces
    - Performance monitoring (traces)
    - Profiling for performance bottlenecks
    - Logs integration (captures Python logging)
    - Structured logging support via structlog
    - Asyncio integration for async code
    - Framework integrations (FastAPI, Starlette, SQLAlchemy, Redis, HTTPX)
    - Spotlight for local development debugging

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
    is_development = effective_env == "development"

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
    integrations = _build_integrations(cfg)

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
                sensitive_headers = [
                    "authorization",
                    "cookie",
                    "x-api-key",
                    "x-auth-token",
                    "x-internal-api-key",
                    "x-service-token",
                ]
                for header in sensitive_headers:
                    if header in headers:
                        headers[header] = "[Filtered]"

        # Scrub sensitive data from extra context
        extra = event.get("extra")
        if extra is not None and isinstance(extra, dict):
            sensitive_keys = ["password", "token", "secret", "api_key", "apikey", "credentials"]
            for key in list(extra.keys()):
                if any(sensitive in key.lower() for sensitive in sensitive_keys):
                    extra[key] = "[Filtered]"

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
        # Filter out health check transactions (exact matches only)
        transaction_name = event.get("transaction", "")
        if transaction_name in ["/health", "/readiness", "/liveness", "/_health"]:
            return None

        # Call custom before_send_transaction if provided
        if cfg.before_send_transaction:
            result = cfg.before_send_transaction(cast("dict[str, Any]", event), hint)
            return cast("Event | None", result)
        return event

    default_release = f"{service_name}@{os.environ.get('VERSION', '0.1.0')}"
    effective_release = cfg.release or default_release

    # Build experiments config
    experiments: dict[str, Any] = {
        "continuous_profiling_auto_start": True,
    }

    # Enable Spotlight for local development (Sentry's local debugging tool)
    # In Docker, we need to use the spotlight container URL instead of localhost
    spotlight_setting: bool | str = False
    if cfg.enable_spotlight and is_development:
        spotlight_url = os.environ.get("SENTRY_SPOTLIGHT_URL")
        spotlight_setting = spotlight_url or True

    # Initialize Sentry
    sentry_sdk.init(
        dsn=effective_dsn,
        environment=effective_env,
        release=effective_release,
        # Performance monitoring
        traces_sample_rate=effective_traces_rate,
        # Error sampling (send all errors)
        error_sampler=lambda _event, _hint: DEFAULT_ERROR_SAMPLE_RATE,
        # Profiling (requires traces)
        profiles_sample_rate=effective_profiles_rate,
        # Enable Sentry structured logs (requires SDK 2.35.0+)
        enable_logs=cfg.enable_logs,
        # Experiments for continuous profiling
        _experiments=experiments,  # type: ignore[arg-type]
        # Spotlight for local dev
        spotlight=spotlight_setting,
        # Integrations
        integrations=integrations,
        # Event processing
        before_send=default_before_send,
        before_send_transaction=default_before_send_transaction,
        # Additional options
        send_default_pii=False,  # Don't send PII by default
        attach_stacktrace=True,  # Always attach stack traces
        max_breadcrumbs=100,  # Increase breadcrumb limit for better debugging
        # Debug mode for development
        debug=is_development and os.environ.get("SENTRY_DEBUG") == "true",
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
            # HTTP client errors
            "httpx.ConnectError",
            "httpx.ReadTimeout",
        ],
        # Enable tracing for specific URLs
        trace_propagation_targets=[
            "localhost",
            r".*\.podex\.dev",
            r".*\.podex\.io",
        ],
        # Include local variables in stack traces (helpful for debugging)
        include_local_variables=True,
        # Enable source context
        include_source_context=True,
        # Maximum request body size to capture
        max_request_body_size="medium",  # "small", "medium", "large", "always"
    )

    # Set service tag
    sentry_sdk.set_tag("service", service_name)

    # Set initial context
    sentry_sdk.set_context(
        "runtime",
        {
            "name": "Python",
            "version": os.environ.get("PYTHON_VERSION", "3.12"),
        },
    )

    return True


def configure_structlog_sentry() -> list[Any]:
    """
    Get structlog processors that integrate with Sentry.

    Use this when configuring structlog to ensure logs are sent to Sentry.

    Returns:
        List of processors to add to structlog configuration

    Example:
        import structlog
        from podex_shared.sentry import configure_structlog_sentry

        structlog.configure(
            processors=[
                structlog.stdlib.add_log_level,
                *configure_structlog_sentry(),
                structlog.processors.JSONRenderer(),
            ],
        )
    """

    def add_sentry_context(
        _logger: Any,
        method_name: str,
        event_dict: dict[str, Any],
    ) -> dict[str, Any]:
        """Add structlog event data to Sentry breadcrumbs."""
        # Add as breadcrumb for context
        level = event_dict.get("level", "info")
        message = event_dict.get("event", "")

        # Extract extra data (everything except standard keys)
        extra_data = {
            k: v
            for k, v in event_dict.items()
            if k not in ("event", "level", "timestamp", "logger")
        }

        sentry_sdk.add_breadcrumb(
            message=str(message),
            category="structlog",
            level=level,
            data=extra_data if extra_data else None,
        )

        # For errors, capture to Sentry
        if method_name in ("error", "exception", "critical"):
            exc_info = event_dict.get("exc_info")
            if exc_info:
                sentry_sdk.capture_exception(exc_info[1] if isinstance(exc_info, tuple) else None)
            else:
                sentry_sdk.capture_message(
                    str(message),
                    level="error" if method_name == "error" else "fatal",
                )

        return event_dict

    return [add_sentry_context]


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


def set_context(name: str, data: dict[str, Any]) -> None:
    """
    Set additional context for Sentry events.

    Args:
        name: Context name (e.g., 'workspace', 'session', 'agent')
        data: Context data dictionary
    """
    sentry_sdk.set_context(name, data)


def set_tag(key: str, value: str) -> None:
    """
    Set a tag on the current scope.

    Tags are indexed and searchable in Sentry.

    Args:
        key: Tag name
        value: Tag value
    """
    sentry_sdk.set_tag(key, value)


def set_tags(tags: dict[str, str]) -> None:
    """
    Set multiple tags on the current scope.

    Args:
        tags: Dictionary of tag key-value pairs
    """
    for key, value in tags.items():
        sentry_sdk.set_tag(key, value)


def capture_exception(
    error: Exception,
    *,
    tags: dict[str, str] | None = None,
    extra: dict[str, Any] | None = None,
    level: str | None = None,
    fingerprint: list[str] | None = None,
) -> str | None:
    """
    Capture an exception and send it to Sentry.

    Args:
        error: The exception to capture
        tags: Additional tags to attach to the event
        extra: Additional context data
        level: Override the severity level
        fingerprint: Custom fingerprint for grouping

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
        if fingerprint:
            scope.fingerprint = fingerprint

        return sentry_sdk.capture_exception(error)


def capture_message(
    message: str,
    *,
    level: str = "info",
    tags: dict[str, str] | None = None,
    extra: dict[str, Any] | None = None,
    fingerprint: list[str] | None = None,
) -> str | None:
    """
    Capture a message and send it to Sentry.

    Args:
        message: The message to capture
        level: Severity level (debug, info, warning, error, fatal)
        tags: Additional tags to attach to the event
        extra: Additional context data
        fingerprint: Custom fingerprint for grouping

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
        if fingerprint:
            scope.fingerprint = fingerprint

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


# Metrics API
def incr(
    key: str,
    value: float = 1.0,
    *,
    tags: dict[str, str] | None = None,
    unit: str | None = "none",
) -> None:
    """
    Increment a counter metric.

    Args:
        key: Metric name
        value: Value to increment by
        tags: Additional tags (passed as attributes)
        unit: Unit of measurement
    """
    sentry_sdk.metrics.count(key, value, unit=unit, attributes=tags)


def gauge(
    key: str,
    value: float,
    *,
    tags: dict[str, str] | None = None,
    unit: str | None = None,
) -> None:
    """
    Set a gauge metric value.

    Args:
        key: Metric name
        value: Current value
        tags: Additional tags (passed as attributes)
        unit: Unit of measurement
    """
    sentry_sdk.metrics.gauge(key, value, unit=unit, attributes=tags)


def distribution(
    key: str,
    value: float,
    *,
    tags: dict[str, str] | None = None,
    unit: str | None = None,
) -> None:
    """
    Record a distribution metric value.

    Args:
        key: Metric name
        value: Value to record
        tags: Additional tags (passed as attributes)
        unit: Unit of measurement (e.g., 'second', 'millisecond', 'byte')
    """
    sentry_sdk.metrics.distribution(key, value, unit=unit, attributes=tags)


def set_metric(
    key: str,
    value: str | int,
    *,
    tags: dict[str, str] | None = None,
    unit: str | None = None,
) -> None:
    """
    Record a set metric (counts unique values).

    Note: Uses count as a fallback since set is not available in current SDK.

    Args:
        key: Metric name
        value: Value to add to the set
        tags: Additional tags (passed as attributes)
        unit: Unit of measurement
    """
    # Sentry SDK no longer has a set metric, use count with a unique key pattern
    sentry_sdk.metrics.count(f"{key}.{value}", 1, unit=unit, attributes=tags)


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
        tags: Additional tags (passed as attributes)
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


def flush(timeout: float = 2.0) -> None:
    """
    Flush pending Sentry events.

    Call this before shutdown to ensure all events are sent.

    Args:
        timeout: Maximum time to wait for flush in seconds
    """
    sentry_sdk.flush(timeout=timeout)


def close() -> None:
    """
    Close the Sentry client.

    Call this during application shutdown.
    """
    client = sentry_sdk.get_client()
    if client:
        client.close(timeout=2.0)


# =============================================================================
# Podex Business Metrics Helpers
# =============================================================================
# Typed helpers for common metrics with standard naming convention:
# podex.<service>.<category>.<metric_name>


def track_workspace_created(tier: str, server_id: str, duration_ms: float) -> None:
    """Track workspace creation with duration."""
    tags = {"tier": tier, "server_id": server_id}
    distribution(
        "podex.compute.workspace.creation_duration",
        duration_ms,
        unit="millisecond",
        tags=tags,
    )
    incr("podex.compute.workspace.created", tags=tags)


def track_workspace_failed(tier: str, reason: str) -> None:
    """Track workspace creation failure."""
    incr(
        "podex.compute.workspace.creation_failed",
        tags={"tier": tier, "reason": reason},
    )


def track_workspace_health_check_failed(workspace_id: str, server_id: str) -> None:
    """Track workspace health check failure."""
    incr(
        "podex.compute.workspace.health_check_failed",
        tags={"workspace_id": workspace_id, "server_id": server_id},
    )


def track_workspace_active(tier: str, server_id: str, count: int) -> None:
    """Track active workspace count."""
    gauge(
        "podex.compute.workspace.active",
        float(count),
        tags={"tier": tier, "server_id": server_id},
    )


@dataclass
class LLMUsageMetrics:
    """Metrics for an LLM call."""

    model: str
    provider: str
    input_tokens: int
    output_tokens: int
    cached_tokens: int
    cost_cents: float
    latency_ms: float
    session_id: str | None = None


def track_llm_usage(metrics: LLMUsageMetrics) -> None:
    """Track LLM call metrics."""
    tags: dict[str, str] = {"model": metrics.model, "provider": metrics.provider}
    if metrics.session_id:
        tags["session_id"] = metrics.session_id

    incr("podex.billing.tokens.input", metrics.input_tokens, tags=tags)
    incr("podex.billing.tokens.output", metrics.output_tokens, tags=tags)
    if metrics.cached_tokens > 0:
        incr("podex.billing.tokens.cached", metrics.cached_tokens, tags=tags)
    distribution("podex.billing.cost.llm", metrics.cost_cents, tags=tags)
    distribution("podex.agent.llm.latency", metrics.latency_ms, unit="millisecond", tags=tags)


def track_agent_run(
    model: str,
    role: str,
    duration_ms: float,
    success: bool,
    error_type: str | None = None,
) -> None:
    """Track agent run metrics."""
    tags = {"model": model, "role": role}
    distribution("podex.agent.run.duration", duration_ms, unit="millisecond", tags=tags)
    if not success and error_type:
        incr("podex.agent.run.failed", tags={**tags, "error_type": error_type})


def track_agent_stuck_recovered(role: str, stuck_duration_seconds: float) -> None:
    """Track agent stuck recovery."""
    incr(
        "podex.agent.stuck_recovered",
        tags={"role": role, "stuck_duration": str(int(stuck_duration_seconds))},
    )


def track_terminal_command(
    workspace_id: str,
    duration_ms: float,
    success: bool,
    reason: str | None = None,
) -> None:
    """Track terminal command metrics."""
    distribution(
        "podex.compute.terminal.command_duration",
        duration_ms,
        unit="millisecond",
        tags={"workspace_id": workspace_id},
    )
    if not success and reason:
        incr("podex.compute.terminal.session_failed", tags={"reason": reason})


def track_terminal_reconnect(workspace_id: str) -> None:
    """Track terminal session reconnection."""
    incr("podex.compute.terminal.reconnect", tags={"workspace_id": workspace_id})


def track_background_task(
    task_name: str,
    duration_ms: float,
    success: bool,
    error_type: str | None = None,
) -> None:
    """Track background task metrics."""
    distribution(
        "podex.api.task.duration",
        duration_ms,
        unit="millisecond",
        tags={"task_name": task_name},
    )
    if not success and error_type:
        incr("podex.api.task.failed", tags={"task_name": task_name, "error_type": error_type})


def track_credits_consumed(user_id: str, resource_type: str, amount_cents: float) -> None:
    """Track credit consumption."""
    incr(
        "podex.billing.credits.consumed",
        amount_cents,
        tags={"user_id": user_id, "resource_type": resource_type},
    )


def track_credits_granted(reason: str, amount_cents: float) -> None:
    """Track credit grants."""
    incr("podex.billing.credits.granted", amount_cents, tags={"reason": reason})


def track_credits_expired(user_id: str, amount_cents: float) -> None:
    """Track expired credits."""
    incr("podex.billing.credits.expired", amount_cents, tags={"user_id": user_id})


def track_quota_exceeded(quota_type: str, user_id: str) -> None:
    """Track quota enforcement events."""
    incr("podex.billing.quota.exceeded", tags={"quota_type": quota_type, "user_id": user_id})


def track_subscription_renewed(plan: str, period: str) -> None:
    """Track subscription renewal."""
    incr("podex.billing.subscription.renewed", tags={"plan": plan, "period": period})


def track_subscription_churned(plan: str, reason: str) -> None:
    """Track subscription churn."""
    incr("podex.billing.subscription.churned", tags={"plan": plan, "reason": reason})


def track_session_time_to_active(template_id: str, tier: str, duration_ms: float) -> None:
    """Track session activation time."""
    distribution(
        "podex.api.session.time_to_active",
        duration_ms,
        unit="millisecond",
        tags={"template_id": template_id, "tier": tier},
    )


def track_file_operation(
    operation: str,
    duration_ms: float,
    size_bytes: int,
    success: bool,
    reason: str | None = None,
) -> None:
    """Track file operation metrics."""
    # Bucket sizes: small (<1KB), medium (1KB-1MB), large (>1MB)
    if size_bytes < FILE_SIZE_SMALL_THRESHOLD:
        size_bucket = "small"
    elif size_bytes < FILE_SIZE_MEDIUM_THRESHOLD:
        size_bucket = "medium"
    else:
        size_bucket = "large"

    metric_name = f"podex.compute.file.{operation}_duration"
    distribution(metric_name, duration_ms, unit="millisecond", tags={"size_bucket": size_bucket})

    if not success and reason:
        incr(
            "podex.compute.file.operation_failed",
            tags={"operation": operation, "reason": reason},
        )


def track_db_query(operation: str, table: str, duration_ms: float) -> None:
    """Track database query performance."""
    distribution(
        "podex.infra.db.query_duration",
        duration_ms,
        unit="millisecond",
        tags={"operation": operation, "table": table},
    )


def track_db_pool_active(service: str, count: int) -> None:
    """Track database connection pool usage."""
    gauge("podex.infra.db.pool.active", float(count), tags={"service": service})


def track_redis_operation(operation: str, duration_ms: float) -> None:
    """Track Redis operation performance."""
    distribution(
        "podex.infra.redis.operation_duration",
        duration_ms,
        unit="millisecond",
        tags={"operation": operation},
    )


def track_websocket_connections(service: str, count: int) -> None:
    """Track active WebSocket connections."""
    gauge("podex.infra.websocket.connections", float(count), tags={"service": service})


def track_http_latency(endpoint: str, method: str, duration_ms: float) -> None:
    """Track HTTP endpoint latency."""
    distribution(
        "podex.infra.http.latency",
        duration_ms,
        unit="millisecond",
        tags={"endpoint": endpoint, "method": method},
    )
