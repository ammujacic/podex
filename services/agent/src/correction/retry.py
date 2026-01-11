"""Retry handler with exponential backoff and intelligent retries."""

import asyncio
import json
import secrets
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
from typing import Any

import structlog

logger = structlog.get_logger()


@dataclass
class RetryConfig:
    """Configuration for retry behavior."""

    max_retries: int = 3
    base_delay: float = 1.0  # seconds
    max_delay: float = 30.0  # seconds
    exponential_base: float = 2.0
    jitter: bool = True
    retryable_errors: list[str] = field(
        default_factory=lambda: [
            "timeout",
            "connection",
            "rate_limit",
            "temporary",
            "transient",
        ],
    )


@dataclass
class RetryResult:
    """Result of a retry operation."""

    success: bool
    result: Any
    attempts: int
    total_delay: float
    errors: list[str]


class RetryHandler:
    """Handles retries with exponential backoff.

    Features:
    - Exponential backoff with jitter
    - Configurable retry conditions
    - Error classification
    - Callback hooks for retry events
    """

    def __init__(
        self,
        config: RetryConfig | None = None,
        on_retry: Callable[[int, str, float], Coroutine[Any, Any, None]] | None = None,
    ) -> None:
        """Initialize retry handler.

        Args:
            config: Retry configuration
            on_retry: Callback when a retry is attempted
        """
        self._config = config or RetryConfig()
        self._on_retry = on_retry

    async def execute_with_retry(
        self,
        operation: Callable[[], Coroutine[Any, Any, Any]],
        operation_name: str = "operation",
    ) -> RetryResult:
        """Execute an operation with retry logic.

        Args:
            operation: Async function to execute
            operation_name: Name for logging

        Returns:
            RetryResult with outcome
        """
        errors: list[str] = []
        total_delay = 0.0

        for attempt in range(self._config.max_retries + 1):
            try:
                result = await operation()

                # Check if result indicates failure that should be retried
                if isinstance(result, dict) and not result.get("success", True):
                    error = result.get("error", "Unknown error")
                    if self._should_retry(error) and attempt < self._config.max_retries:
                        errors.append(error)
                        delay = self._calculate_delay(attempt)
                        total_delay += delay

                        logger.warning(
                            "Operation failed, retrying",
                            operation=operation_name,
                            attempt=attempt + 1,
                            error=error,
                            delay=delay,
                        )

                        if self._on_retry:
                            await self._on_retry(attempt + 1, error, delay)

                        await asyncio.sleep(delay)
                        continue

                    # Non-retryable error or max retries reached
                    return RetryResult(
                        success=False,
                        result=result,
                        attempts=attempt + 1,
                        total_delay=total_delay,
                        errors=[*errors, error],
                    )

                # Success
                return RetryResult(
                    success=True,
                    result=result,
                    attempts=attempt + 1,
                    total_delay=total_delay,
                    errors=errors,
                )

            except Exception as e:
                error_str = str(e)
                errors.append(error_str)

                if self._should_retry(error_str) and attempt < self._config.max_retries:
                    delay = self._calculate_delay(attempt)
                    total_delay += delay

                    logger.warning(
                        "Operation raised exception, retrying",
                        operation=operation_name,
                        attempt=attempt + 1,
                        error=error_str,
                        delay=delay,
                    )

                    if self._on_retry:
                        await self._on_retry(attempt + 1, error_str, delay)

                    await asyncio.sleep(delay)
                    continue

                # Non-retryable or max retries reached
                logger.error(
                    "Operation failed after retries",
                    operation=operation_name,
                    attempts=attempt + 1,
                    errors=errors,
                )

                return RetryResult(
                    success=False,
                    result={"error": error_str},
                    attempts=attempt + 1,
                    total_delay=total_delay,
                    errors=errors,
                )

        # Should not reach here, but just in case
        return RetryResult(
            success=False,
            result={"error": "Max retries exceeded"},
            attempts=self._config.max_retries + 1,
            total_delay=total_delay,
            errors=errors,
        )

    def _should_retry(self, error: str) -> bool:
        """Determine if an error should trigger a retry.

        Args:
            error: Error message

        Returns:
            True if should retry
        """
        error_lower = error.lower()

        # Check for retryable error patterns
        for pattern in self._config.retryable_errors:
            if pattern in error_lower:
                return True

        # Check for common retryable conditions
        retryable_patterns = [
            "timed out",
            "connection refused",
            "connection reset",
            "too many requests",
            "service unavailable",
            "server error",
            "internal error",
            "try again",
            "temporarily",
        ]

        return any(pattern in error_lower for pattern in retryable_patterns)

    def _calculate_delay(self, attempt: int) -> float:
        """Calculate delay before next retry.

        Uses exponential backoff with optional jitter.

        Args:
            attempt: Current attempt number (0-indexed)

        Returns:
            Delay in seconds
        """
        delay = self._config.base_delay * (self._config.exponential_base**attempt)
        delay = min(delay, self._config.max_delay)

        if self._config.jitter:
            # Add up to 25% jitter using cryptographically secure random
            # secrets.randbelow returns int, so we scale to get a float in [0, 0.25)
            jitter = delay * (secrets.randbelow(250) / 1000)
            delay += jitter

        return delay


class RetryableToolExecutor:
    """Wraps tool executor with retry capabilities."""

    def __init__(
        self,
        tool_executor: Any,  # ToolExecutor
        retry_config: RetryConfig | None = None,
    ) -> None:
        """Initialize retryable executor.

        Args:
            tool_executor: Base tool executor
            retry_config: Retry configuration
        """
        self._executor = tool_executor
        self._retry_handler = RetryHandler(retry_config)

    async def execute(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        retry: bool = True,
    ) -> str:
        """Execute a tool with optional retry.

        Args:
            tool_name: Tool to execute
            arguments: Tool arguments
            retry: Whether to retry on failure

        Returns:
            Tool result as JSON string
        """
        if not retry:
            executor_result: str = await self._executor.execute(tool_name, arguments)
            return executor_result

        async def operation() -> dict[str, Any]:
            result = await self._executor.execute(tool_name, arguments)
            try:
                parsed: dict[str, Any] = json.loads(result)
                return parsed
            except json.JSONDecodeError:
                return {"success": True, "output": result}

        retry_result = await self._retry_handler.execute_with_retry(
            operation,
            operation_name=f"tool:{tool_name}",
        )

        if retry_result.success:
            return str(json.dumps(retry_result.result))
        else:
            result_dict: dict[str, Any] = retry_result.result
            if "retry_info" not in result_dict:
                result_dict["retry_info"] = {
                    "attempts": retry_result.attempts,
                    "errors": retry_result.errors,
                }
            return str(json.dumps(result_dict))
