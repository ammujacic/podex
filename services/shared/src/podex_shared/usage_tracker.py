"""Usage tracking utilities for billing.

This module provides utilities to track and record usage events
(tokens, compute time, storage) across Podex services.
"""

import asyncio
import contextlib
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any
from uuid import uuid4

import httpx
import structlog
from pydantic import BaseModel, Field

from podex_shared.models.billing import MODEL_PRICING, UsageType, calculate_token_cost

logger = structlog.get_logger()


class UsageEventStatus(str, Enum):
    """Status of a usage event."""

    PENDING = "pending"
    RECORDED = "recorded"
    FAILED = "failed"


class UsageEvent(BaseModel):
    """A usage event to be recorded."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    user_id: str
    session_id: str | None = None
    workspace_id: str | None = None
    agent_id: str | None = None

    usage_type: UsageType
    quantity: int  # Tokens, seconds, or bytes
    unit: str  # "tokens", "seconds", "bytes"
    unit_price_cents: int  # Price per unit in cents (x 1000000 for precision)
    total_cost_cents: int  # Total cost in cents

    # For token usage
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None

    # For compute usage
    tier: str | None = None
    duration_seconds: int | None = None

    # Metadata
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    status: UsageEventStatus = UsageEventStatus.PENDING


@dataclass
class TokenUsageParams:
    """Parameters for recording token usage."""

    user_id: str
    model: str
    input_tokens: int
    output_tokens: int
    session_id: str | None = None
    workspace_id: str | None = None
    agent_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ComputeUsageParams:
    """Parameters for recording compute usage."""

    user_id: str
    tier: str
    duration_seconds: int
    session_id: str | None = None
    workspace_id: str | None = None
    hourly_rate_cents: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


class UsageTracker:
    """Tracks and records usage events for billing.

    This class provides methods to record various types of usage:
    - Token usage from LLM calls
    - Compute usage from workspace sessions
    - Storage usage from file operations

    Events are batched and sent to the API service asynchronously.
    """

    def __init__(
        self,
        api_base_url: str,
        service_token: str | None = None,
        batch_size: int = 10,
        flush_interval: float = 5.0,
    ) -> None:
        """Initialize usage tracker.

        Args:
            api_base_url: Base URL of the API service
            service_token: Internal service authentication token
            batch_size: Number of events to batch before sending
            flush_interval: Seconds between automatic flushes
        """
        self.api_base_url = api_base_url.rstrip("/")
        self.service_token = service_token
        self.batch_size = batch_size
        self.flush_interval = flush_interval

        self._event_queue: list[UsageEvent] = []
        self._queue_lock = asyncio.Lock()
        self._flush_task: asyncio.Task[None] | None = None
        self._client: httpx.AsyncClient | None = None
        self._running = False

    async def start(self) -> None:
        """Start the usage tracker background tasks."""
        if self._running:
            return

        self._running = True
        self._client = httpx.AsyncClient(
            base_url=self.api_base_url,
            headers={
                "Content-Type": "application/json",
                **({"Authorization": f"Bearer {self.service_token}"} if self.service_token else {}),
            },
            timeout=60.0,  # Increased timeout from 30 to 60 seconds
        )
        self._flush_task = asyncio.create_task(self._periodic_flush())
        logger.info("Usage tracker started", api_base_url=self.api_base_url)

    async def stop(self) -> None:
        """Stop the usage tracker and flush remaining events."""
        self._running = False

        if self._flush_task:
            self._flush_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._flush_task
            self._flush_task = None

        # Final flush
        await self.flush()

        if self._client:
            await self._client.aclose()
            self._client = None

        logger.info("Usage tracker stopped")

    async def _periodic_flush(self) -> None:
        """Periodically flush events to the API."""
        while self._running:
            try:
                await asyncio.sleep(self.flush_interval)
                await self.flush()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Error in periodic flush")

    async def flush(self) -> None:
        """Flush all pending events to the API."""
        async with self._queue_lock:
            if not self._event_queue:
                return

            events = self._event_queue.copy()
            self._event_queue.clear()

        if not events:
            return

        try:
            await self._send_events(events)
        except Exception:
            logger.exception("Failed to send usage events", count=len(events))
            # Re-queue failed events (up to a limit)
            async with self._queue_lock:
                # Only re-queue if we haven't accumulated too many
                if len(self._event_queue) < self.batch_size * 10:
                    self._event_queue.extend(events)

    async def _send_events(self, events: list[UsageEvent]) -> None:
        """Send events to the API service."""
        if not self._client:
            logger.warning("Usage tracker not started, events will be queued")
            return

        # Retry logic for resilience
        max_retries = 3
        for attempt in range(max_retries):
            try:
                response = await self._client.post(
                    "/api/billing/usage/record",
                    json={"events": [e.model_dump(mode="json") for e in events]},
                )
                response.raise_for_status()
                logger.debug("Recorded usage events", count=len(events))
                return
            except httpx.HTTPStatusError as e:
                logger.error(
                    "Failed to record usage events",
                    status_code=e.response.status_code,
                    response=e.response.text,
                    attempt=attempt + 1,
                )
                if attempt == max_retries - 1:  # Last attempt
                    raise
            except httpx.RequestError as e:
                logger.error(
                    "Request error recording usage events", error=str(e), attempt=attempt + 1
                )
                if attempt == max_retries - 1:  # Last attempt
                    raise
                # Wait before retry (exponential backoff)
                await asyncio.sleep(2**attempt)

    async def record_event(self, event: UsageEvent) -> None:
        """Record a usage event.

        Args:
            event: The usage event to record
        """
        async with self._queue_lock:
            self._event_queue.append(event)

            if len(self._event_queue) >= self.batch_size:
                # Trigger immediate flush
                events = self._event_queue.copy()
                self._event_queue.clear()

        if len(events if "events" in dir() else []) >= self.batch_size:
            try:
                await self._send_events(events)
            except Exception:
                # Re-queue on failure
                async with self._queue_lock:
                    self._event_queue.extend(events)

    async def record_token_usage(self, params: TokenUsageParams) -> UsageEvent:
        """Record token usage from an LLM call.

        Args:
            params: Token usage parameters including user_id, model, input_tokens,
                   output_tokens, and optional session_id, workspace_id, agent_id, metadata

        Returns:
            The created usage event
        """
        # Calculate cost
        total_cost = calculate_token_cost(params.model, params.input_tokens, params.output_tokens)
        total_tokens = params.input_tokens + params.output_tokens

        # Get pricing info
        pricing = MODEL_PRICING.get(params.model)
        if pricing:
            # Average price per token (weighted by input/output ratio)
            avg_price_per_token = total_cost / total_tokens if total_tokens > 0 else Decimal("0")
            unit_price_cents = int(avg_price_per_token * 100)
        else:
            unit_price_cents = 0

        event = UsageEvent(
            user_id=params.user_id,
            session_id=params.session_id,
            workspace_id=params.workspace_id,
            agent_id=params.agent_id,
            usage_type=UsageType.TOKENS_OUTPUT,
            quantity=total_tokens,
            unit="tokens",
            unit_price_cents=unit_price_cents,
            total_cost_cents=int(total_cost * 100),
            model=params.model,
            input_tokens=params.input_tokens,
            output_tokens=params.output_tokens,
            metadata=params.metadata,
        )

        await self.record_event(event)

        logger.debug(
            "Recorded token usage",
            user_id=params.user_id,
            model=params.model,
            input_tokens=params.input_tokens,
            output_tokens=params.output_tokens,
            cost_cents=event.total_cost_cents,
        )

        return event

    async def record_compute_usage(self, params: ComputeUsageParams) -> UsageEvent:
        """Record compute usage from a workspace session.

        Args:
            params: Compute usage parameters including user_id, tier, duration_seconds,
                   and optional session_id, workspace_id, hourly_rate_cents, metadata

        Returns:
            The created usage event
        """
        # Calculate cost based on duration and hourly rate
        hours = Decimal(params.duration_seconds) / Decimal(3600)
        total_cost_cents = int(hours * Decimal(params.hourly_rate_cents))

        # Price per second
        unit_price_cents = params.hourly_rate_cents // 3600 if params.hourly_rate_cents > 0 else 0

        event = UsageEvent(
            user_id=params.user_id,
            session_id=params.session_id,
            workspace_id=params.workspace_id,
            usage_type=UsageType.COMPUTE_SECONDS,
            quantity=params.duration_seconds,
            unit="seconds",
            unit_price_cents=unit_price_cents,
            total_cost_cents=total_cost_cents,
            tier=params.tier,
            duration_seconds=params.duration_seconds,
            metadata=params.metadata,
        )

        await self.record_event(event)

        logger.debug(
            "Recorded compute usage",
            user_id=params.user_id,
            tier=params.tier,
            duration_seconds=params.duration_seconds,
            cost_cents=total_cost_cents,
        )

        return event

    async def record_storage_usage(
        self,
        user_id: str,
        bytes_used: int,
        session_id: str | None = None,
        workspace_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> UsageEvent:
        """Record storage usage.

        Args:
            user_id: The user who used storage
            bytes_used: Bytes of storage used
            session_id: Optional session ID
            workspace_id: Optional workspace ID
            metadata: Optional additional metadata

        Returns:
            The created usage event
        """
        # Storage pricing: $0.10 per GB per month = $0.10 / (30 * 24 * 3600) per GB per second
        # For simplicity, we record the snapshot and calculate monthly cost elsewhere
        gb_used = Decimal(bytes_used) / Decimal(1024 * 1024 * 1024)
        monthly_cost_cents = int(gb_used * Decimal(10))  # $0.10/GB

        event = UsageEvent(
            user_id=user_id,
            session_id=session_id,
            workspace_id=workspace_id,
            usage_type=UsageType.STORAGE_GB,
            quantity=bytes_used,
            unit="bytes",
            unit_price_cents=10,  # $0.10 per GB per month
            total_cost_cents=monthly_cost_cents,
            metadata=metadata or {},
        )

        await self.record_event(event)

        logger.debug(
            "Recorded storage usage",
            user_id=user_id,
            bytes_used=bytes_used,
            gb_used=float(gb_used),
        )

        return event

    async def record_api_call(
        self,
        user_id: str,
        endpoint: str,
        session_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> UsageEvent:
        """Record an API call for rate limiting/tracking.

        Args:
            user_id: The user who made the call
            endpoint: The API endpoint called
            session_id: Optional session ID
            metadata: Optional additional metadata

        Returns:
            The created usage event
        """
        event = UsageEvent(
            user_id=user_id,
            session_id=session_id,
            usage_type=UsageType.API_CALLS,
            quantity=1,
            unit="calls",
            unit_price_cents=0,  # API calls typically not billed directly
            total_cost_cents=0,
            metadata={"endpoint": endpoint, **(metadata or {})},
        )

        await self.record_event(event)

        return event


class _UsageTrackerSingleton:
    """Singleton holder for the global UsageTracker instance."""

    _instance: UsageTracker | None = None

    @classmethod
    def get(cls) -> UsageTracker | None:
        """Get the global usage tracker instance."""
        return cls._instance

    @classmethod
    async def init(
        cls,
        api_base_url: str,
        service_token: str | None = None,
        batch_size: int = 10,
        flush_interval: float = 5.0,
    ) -> UsageTracker:
        """Initialize and start the global usage tracker.

        Args:
            api_base_url: Base URL of the API service
            service_token: Internal service authentication token
            batch_size: Number of events to batch before sending
            flush_interval: Seconds between automatic flushes

        Returns:
            The initialized usage tracker
        """
        if cls._instance is not None:
            await cls._instance.stop()

        cls._instance = UsageTracker(
            api_base_url=api_base_url,
            service_token=service_token,
            batch_size=batch_size,
            flush_interval=flush_interval,
        )
        await cls._instance.start()
        return cls._instance

    @classmethod
    async def shutdown(cls) -> None:
        """Shutdown the global usage tracker."""
        if cls._instance is not None:
            await cls._instance.stop()
            cls._instance = None


def get_usage_tracker() -> UsageTracker | None:
    """Get the global usage tracker instance."""
    return _UsageTrackerSingleton.get()


async def init_usage_tracker(
    api_base_url: str,
    service_token: str | None = None,
    batch_size: int = 10,
    flush_interval: float = 5.0,
) -> UsageTracker:
    """Initialize and start the global usage tracker.

    Args:
        api_base_url: Base URL of the API service
        service_token: Internal service authentication token
        batch_size: Number of events to batch before sending
        flush_interval: Seconds between automatic flushes

    Returns:
        The initialized usage tracker
    """
    return await _UsageTrackerSingleton.init(
        api_base_url=api_base_url,
        service_token=service_token,
        batch_size=batch_size,
        flush_interval=flush_interval,
    )


async def shutdown_usage_tracker() -> None:
    """Shutdown the global usage tracker."""
    await _UsageTrackerSingleton.shutdown()
