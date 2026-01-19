"""Comprehensive tests for usage tracking utilities."""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from podex_shared.models.billing import UsageType
from podex_shared.usage_tracker import (
    ComputeUsageParams,
    TokenUsageParams,
    UsageEvent,
    UsageEventStatus,
    UsageTracker,
    _UsageTrackerSingleton,
    get_usage_tracker,
    init_usage_tracker,
    shutdown_usage_tracker,
)


class TestUsageEventStatus:
    """Tests for UsageEventStatus enum."""

    def test_status_values(self) -> None:
        """Test status enum values."""
        assert UsageEventStatus.PENDING == "pending"
        assert UsageEventStatus.RECORDED == "recorded"
        assert UsageEventStatus.FAILED == "failed"


class TestUsageEvent:
    """Tests for UsageEvent model."""

    def test_usage_event_defaults(self) -> None:
        """Test UsageEvent default values."""
        event = UsageEvent(
            user_id="user-123",
            usage_type=UsageType.TOKENS_OUTPUT,
            quantity=1000,
            unit="tokens",
            unit_price_cents=0,
            total_cost_cents=10,
        )
        assert event.id  # Auto-generated
        assert event.session_id is None
        assert event.workspace_id is None
        assert event.agent_id is None
        assert event.model is None
        assert event.tier is None
        assert event.status == UsageEventStatus.PENDING
        assert isinstance(event.created_at, datetime)
        assert event.metadata == {}

    def test_usage_event_token_fields(self) -> None:
        """Test UsageEvent with token fields."""
        event = UsageEvent(
            user_id="user-123",
            usage_type=UsageType.TOKENS_OUTPUT,
            quantity=1500,
            unit="tokens",
            unit_price_cents=1,
            total_cost_cents=15,
            model="claude-sonnet-4-20250514",
            input_tokens=1000,
            output_tokens=500,
        )
        assert event.model == "claude-sonnet-4-20250514"
        assert event.input_tokens == 1000
        assert event.output_tokens == 500

    def test_usage_event_compute_fields(self) -> None:
        """Test UsageEvent with compute fields."""
        event = UsageEvent(
            user_id="user-123",
            usage_type=UsageType.COMPUTE_SECONDS,
            quantity=3600,
            unit="seconds",
            unit_price_cents=1,
            total_cost_cents=10,
            tier="pro",
            duration_seconds=3600,
        )
        assert event.tier == "pro"
        assert event.duration_seconds == 3600


class TestTokenUsageParams:
    """Tests for TokenUsageParams dataclass."""

    def test_token_usage_params_required(self) -> None:
        """Test TokenUsageParams required fields."""
        params = TokenUsageParams(
            user_id="user-123",
            model="claude-sonnet-4-20250514",
            input_tokens=1000,
            output_tokens=500,
        )
        assert params.user_id == "user-123"
        assert params.model == "claude-sonnet-4-20250514"
        assert params.input_tokens == 1000
        assert params.output_tokens == 500

    def test_token_usage_params_optional(self) -> None:
        """Test TokenUsageParams optional fields."""
        params = TokenUsageParams(
            user_id="user-123",
            model="claude-sonnet-4-20250514",
            input_tokens=1000,
            output_tokens=500,
            session_id="session-456",
            workspace_id="workspace-789",
            agent_id="agent-abc",
            metadata={"task": "code_review"},
        )
        assert params.session_id == "session-456"
        assert params.workspace_id == "workspace-789"
        assert params.agent_id == "agent-abc"
        assert params.metadata == {"task": "code_review"}


class TestComputeUsageParams:
    """Tests for ComputeUsageParams dataclass."""

    def test_compute_usage_params_required(self) -> None:
        """Test ComputeUsageParams required fields."""
        params = ComputeUsageParams(
            user_id="user-123",
            tier="pro",
            duration_seconds=3600,
        )
        assert params.user_id == "user-123"
        assert params.tier == "pro"
        assert params.duration_seconds == 3600

    def test_compute_usage_params_optional(self) -> None:
        """Test ComputeUsageParams optional fields."""
        params = ComputeUsageParams(
            user_id="user-123",
            tier="power",
            duration_seconds=7200,
            session_id="session-456",
            workspace_id="workspace-789",
            hourly_rate_cents=20,
            metadata={"project": "ml-training"},
        )
        assert params.session_id == "session-456"
        assert params.hourly_rate_cents == 20
        assert params.metadata == {"project": "ml-training"}


class TestUsageTrackerInit:
    """Tests for UsageTracker initialization."""

    def test_init(self) -> None:
        """Test UsageTracker initialization."""
        tracker = UsageTracker(
            api_base_url="http://localhost:8000",
            service_token="token123",
            batch_size=20,
            flush_interval=10.0,
        )
        assert tracker.api_base_url == "http://localhost:8000"
        assert tracker.service_token == "token123"
        assert tracker.batch_size == 20
        assert tracker.flush_interval == 10.0
        assert tracker._running is False
        assert tracker._client is None

    def test_init_strips_trailing_slash(self) -> None:
        """Test that trailing slash is stripped from URL."""
        tracker = UsageTracker(api_base_url="http://localhost:8000/")
        assert tracker.api_base_url == "http://localhost:8000"


class TestUsageTrackerStartStop:
    """Tests for UsageTracker start/stop."""

    @pytest.mark.asyncio
    async def test_start(self) -> None:
        """Test starting the usage tracker."""
        tracker = UsageTracker(api_base_url="http://localhost:8000")
        await tracker.start()

        assert tracker._running is True
        assert tracker._client is not None
        assert tracker._flush_task is not None

        # Cleanup
        await tracker.stop()

    @pytest.mark.asyncio
    async def test_start_idempotent(self) -> None:
        """Test that multiple start calls are idempotent."""
        tracker = UsageTracker(api_base_url="http://localhost:8000")
        await tracker.start()
        client1 = tracker._client
        await tracker.start()
        client2 = tracker._client

        assert client1 is client2

        # Cleanup
        await tracker.stop()

    @pytest.mark.asyncio
    async def test_stop(self) -> None:
        """Test stopping the usage tracker."""
        tracker = UsageTracker(api_base_url="http://localhost:8000")
        await tracker.start()
        await tracker.stop()

        assert tracker._running is False
        assert tracker._client is None
        assert tracker._flush_task is None


class TestUsageTrackerRecordEvent:
    """Tests for recording events."""

    @pytest.mark.asyncio
    async def test_record_event_queues(self) -> None:
        """Test that record_event adds to queue."""
        tracker = UsageTracker(api_base_url="http://localhost:8000", batch_size=100)
        event = UsageEvent(
            user_id="user-123",
            usage_type=UsageType.TOKENS_OUTPUT,
            quantity=1000,
            unit="tokens",
            unit_price_cents=0,
            total_cost_cents=10,
        )

        await tracker.record_event(event)

        assert len(tracker._event_queue) == 1
        assert tracker._event_queue[0] is event


class TestUsageTrackerRecordTokenUsage:
    """Tests for recording token usage."""

    @pytest.mark.asyncio
    async def test_record_token_usage(self) -> None:
        """Test recording token usage."""
        tracker = UsageTracker(api_base_url="http://localhost:8000", batch_size=100)
        params = TokenUsageParams(
            user_id="user-123",
            model="claude-sonnet-4-20250514",
            input_tokens=1000,
            output_tokens=500,
            session_id="session-456",
        )

        event = await tracker.record_token_usage(params)

        assert event.user_id == "user-123"
        assert event.model == "claude-sonnet-4-20250514"
        assert event.input_tokens == 1000
        assert event.output_tokens == 500
        assert event.quantity == 1500  # total tokens
        assert event.unit == "tokens"
        assert event.usage_type == UsageType.TOKENS_OUTPUT
        assert event.total_cost_cents > 0

    @pytest.mark.asyncio
    async def test_record_token_usage_unknown_model(self) -> None:
        """Test recording token usage with unknown model."""
        tracker = UsageTracker(api_base_url="http://localhost:8000", batch_size=100)
        params = TokenUsageParams(
            user_id="user-123",
            model="unknown-model",
            input_tokens=100,
            output_tokens=50,
        )

        event = await tracker.record_token_usage(params)

        # Unknown models have zero cost (no pricing info available)
        assert event.model == "unknown-model"
        assert event.quantity == 150  # total tokens
        assert event.total_cost_cents == 0


class TestUsageTrackerRecordComputeUsage:
    """Tests for recording compute usage."""

    @pytest.mark.asyncio
    async def test_record_compute_usage(self) -> None:
        """Test recording compute usage."""
        tracker = UsageTracker(api_base_url="http://localhost:8000", batch_size=100)
        params = ComputeUsageParams(
            user_id="user-123",
            tier="pro",
            duration_seconds=3600,
            hourly_rate_cents=10,
        )

        event = await tracker.record_compute_usage(params)

        assert event.user_id == "user-123"
        assert event.tier == "pro"
        assert event.duration_seconds == 3600
        assert event.quantity == 3600
        assert event.unit == "seconds"
        assert event.usage_type == UsageType.COMPUTE_SECONDS
        assert event.total_cost_cents == 10  # 1 hour at 10 cents/hour


class TestUsageTrackerRecordStorageUsage:
    """Tests for recording storage usage."""

    @pytest.mark.asyncio
    async def test_record_storage_usage(self) -> None:
        """Test recording storage usage."""
        tracker = UsageTracker(api_base_url="http://localhost:8000", batch_size=100)

        event = await tracker.record_storage_usage(
            user_id="user-123",
            bytes_used=1024 * 1024 * 1024,  # 1 GB
            session_id="session-456",
        )

        assert event.user_id == "user-123"
        assert event.quantity == 1024 * 1024 * 1024
        assert event.unit == "bytes"
        assert event.usage_type == UsageType.STORAGE_GB
        assert event.total_cost_cents == 10  # $0.10 per GB


class TestUsageTrackerRecordAPICall:
    """Tests for recording API calls."""

    @pytest.mark.asyncio
    async def test_record_api_call(self) -> None:
        """Test recording API call."""
        tracker = UsageTracker(api_base_url="http://localhost:8000", batch_size=100)

        event = await tracker.record_api_call(
            user_id="user-123",
            endpoint="/api/sessions",
            metadata={"method": "POST"},
        )

        assert event.user_id == "user-123"
        assert event.quantity == 1
        assert event.unit == "calls"
        assert event.usage_type == UsageType.API_CALLS
        assert event.total_cost_cents == 0
        assert event.metadata["endpoint"] == "/api/sessions"
        assert event.metadata["method"] == "POST"


class TestUsageTrackerFlush:
    """Tests for flushing events."""

    @pytest.mark.asyncio
    async def test_flush_empty_queue(self) -> None:
        """Test flushing empty queue does nothing."""
        tracker = UsageTracker(api_base_url="http://localhost:8000")
        # Should not raise
        await tracker.flush()

    @pytest.mark.asyncio
    async def test_flush_sends_events(self) -> None:
        """Test flushing sends events to API."""
        tracker = UsageTracker(api_base_url="http://localhost:8000", batch_size=100)

        # Mock the client
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_client = MagicMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        tracker._client = mock_client

        # Add events
        event = UsageEvent(
            user_id="user-123",
            usage_type=UsageType.TOKENS_OUTPUT,
            quantity=1000,
            unit="tokens",
            unit_price_cents=0,
            total_cost_cents=10,
        )
        tracker._event_queue.append(event)

        await tracker.flush()

        mock_client.post.assert_called_once()
        assert len(tracker._event_queue) == 0


class TestUsageTrackerSingleton:
    """Tests for UsageTracker singleton."""

    @pytest.mark.asyncio
    async def test_singleton_init(self) -> None:
        """Test singleton initialization."""
        _UsageTrackerSingleton._instance = None

        tracker = await init_usage_tracker(
            api_base_url="http://localhost:8000",
            service_token="token123",
        )

        assert tracker is not None
        assert get_usage_tracker() is tracker

        await shutdown_usage_tracker()

    @pytest.mark.asyncio
    async def test_singleton_shutdown(self) -> None:
        """Test singleton shutdown."""
        _UsageTrackerSingleton._instance = None

        await init_usage_tracker(api_base_url="http://localhost:8000")
        await shutdown_usage_tracker()

        assert get_usage_tracker() is None

    @pytest.mark.asyncio
    async def test_get_tracker_before_init(self) -> None:
        """Test getting tracker before initialization."""
        _UsageTrackerSingleton._instance = None
        assert get_usage_tracker() is None

    @pytest.mark.asyncio
    async def test_reinit_stops_previous(self) -> None:
        """Test that re-init stops previous tracker."""
        _UsageTrackerSingleton._instance = None

        tracker1 = await init_usage_tracker(api_base_url="http://localhost:8000")
        tracker2 = await init_usage_tracker(api_base_url="http://localhost:8001")

        assert tracker1 is not tracker2
        assert get_usage_tracker() is tracker2

        await shutdown_usage_tracker()
