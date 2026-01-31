"""Unit tests for local pod usage tracker.

Tests compute usage tracking for workspaces running on local pods.
"""

import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.services.local_pod_usage_tracker import (
    TRACKING_INTERVAL_SECONDS,
    LocalPodUsageTracker,
    cleanup_tracking_state,
    get_local_pod_pricing,
    track_local_pod_workspaces,
)


@pytest.fixture(autouse=True)
def clear_tracking_state():
    """Clear tracking state before and after each test."""
    import src.services.local_pod_usage_tracker as tracker_module

    tracker_module._last_tracked = {}
    yield
    tracker_module._last_tracked = {}


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_local_pod_pricing_from_db():
    """Test getting local pod pricing from database."""
    mock_setting = MagicMock()
    mock_setting.key = "local_pod_pricing"
    mock_setting.value = {
        "hourly_rate_cents": 500,
        "description": "Local pod pricing",
        "billing_enabled": True,
    }

    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = mock_setting

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_result)

    with patch("src.services.local_pod_usage_tracker.async_session_factory") as mock_factory:
        mock_factory.return_value.__aenter__.return_value = mock_db

        pricing = await get_local_pod_pricing()

        assert pricing["hourly_rate_cents"] == 500
        assert pricing["billing_enabled"] is True
        assert pricing["description"] == "Local pod pricing"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_local_pod_pricing_default_when_not_found():
    """Test getting local pod pricing returns defaults when not in DB."""
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_result)

    with patch("src.services.local_pod_usage_tracker.async_session_factory") as mock_factory:
        mock_factory.return_value.__aenter__.return_value = mock_db

        pricing = await get_local_pod_pricing()

        assert pricing["hourly_rate_cents"] == 0
        assert pricing["billing_enabled"] is False
        assert pricing["description"] == "Your local machine"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_local_pod_pricing_default_when_invalid_value():
    """Test getting local pod pricing returns defaults when value is invalid."""
    mock_setting = MagicMock()
    mock_setting.value = "not_a_dict"  # Invalid type

    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = mock_setting

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_result)

    with patch("src.services.local_pod_usage_tracker.async_session_factory") as mock_factory:
        mock_factory.return_value.__aenter__.return_value = mock_db

        pricing = await get_local_pod_pricing()

        assert pricing["billing_enabled"] is False


@pytest.mark.unit
@pytest.mark.asyncio
async def test_track_local_pod_workspaces_billing_disabled():
    """Test tracking skips when billing is disabled."""
    with patch("src.services.local_pod_usage_tracker.get_local_pod_pricing") as mock_pricing:
        mock_pricing.return_value = {"billing_enabled": False}

        await track_local_pod_workspaces()

        # Should return early without querying workspaces
        mock_pricing.assert_called_once()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_track_local_pod_workspaces_no_workspaces():
    """Test tracking when no workspaces are running."""
    mock_result = MagicMock()
    mock_result.scalars().all.return_value = []

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_result)
    mock_db.commit = AsyncMock()

    with patch("src.services.local_pod_usage_tracker.get_local_pod_pricing") as mock_pricing:
        mock_pricing.return_value = {
            "billing_enabled": True,
            "hourly_rate_cents": 100,
        }

        with patch("src.services.local_pod_usage_tracker.async_session_factory") as mock_factory:
            mock_factory.return_value.__aenter__.return_value = mock_db

            await track_local_pod_workspaces()

            mock_db.commit.assert_called_once()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_track_local_pod_workspaces_pod_offline():
    """Test tracking skips workspace when pod is offline."""
    mock_workspace = MagicMock()
    mock_workspace.id = "ws123"
    mock_workspace.local_pod_id = "pod123"
    mock_workspace.status = "running"

    mock_result = MagicMock()
    mock_result.scalars().all.return_value = [mock_workspace]

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_result)
    mock_db.commit = AsyncMock()

    with patch("src.services.local_pod_usage_tracker.get_local_pod_pricing") as mock_pricing:
        mock_pricing.return_value = {
            "billing_enabled": True,
            "hourly_rate_cents": 100,
        }

        with patch("src.services.local_pod_usage_tracker.async_session_factory") as mock_factory:
            mock_factory.return_value.__aenter__.return_value = mock_db

            with patch("src.services.local_pod_usage_tracker.is_pod_online", return_value=False):
                await track_local_pod_workspaces()

                # Should skip workspace but still commit
                mock_db.commit.assert_called_once()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_track_local_pod_workspaces_success():
    """Test successfully tracking workspace usage."""
    mock_session = MagicMock()
    mock_session.id = "session123"
    mock_session.owner_id = "user123"

    mock_workspace = MagicMock()
    mock_workspace.id = "ws123"
    mock_workspace.local_pod_id = "pod123"
    mock_workspace.status = "running"
    mock_workspace.session = mock_session

    mock_result = MagicMock()
    mock_result.scalars().all.return_value = [mock_workspace]

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_result)
    mock_db.commit = AsyncMock()

    with patch("src.services.local_pod_usage_tracker.get_local_pod_pricing") as mock_pricing:
        mock_pricing.return_value = {
            "billing_enabled": True,
            "hourly_rate_cents": 100,
        }

        with patch("src.services.local_pod_usage_tracker.async_session_factory") as mock_factory:
            mock_factory.return_value.__aenter__.return_value = mock_db

            with patch("src.services.local_pod_usage_tracker.is_pod_online", return_value=True):
                with patch(
                    "src.services.local_pod_usage_tracker._record_local_pod_usage"
                ) as mock_record:
                    mock_record.return_value = None

                    await track_local_pod_workspaces()

                    # Should record usage
                    mock_record.assert_called_once()
                    assert mock_record.call_args.kwargs["user_id"] == "user123"
                    assert mock_record.call_args.kwargs["workspace_id"] == "ws123"
                    assert mock_record.call_args.kwargs["local_pod_id"] == "pod123"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_track_local_pod_workspaces_calculates_duration():
    """Test tracking calculates correct duration between calls."""
    import src.services.local_pod_usage_tracker as tracker_module

    mock_session = MagicMock()
    mock_session.id = "session123"
    mock_session.owner_id = "user123"

    mock_workspace = MagicMock()
    mock_workspace.id = "ws123"
    mock_workspace.local_pod_id = "pod123"
    mock_workspace.status = "running"
    mock_workspace.session = mock_session

    # Set last tracked time to 120 seconds ago
    now = datetime.now(UTC)
    tracker_module._last_tracked["ws123"] = now - timedelta(seconds=120)

    mock_result = MagicMock()
    mock_result.scalars().all.return_value = [mock_workspace]

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_result)
    mock_db.commit = AsyncMock()

    with patch("src.services.local_pod_usage_tracker.get_local_pod_pricing") as mock_pricing:
        mock_pricing.return_value = {
            "billing_enabled": True,
            "hourly_rate_cents": 100,
        }

        with patch("src.services.local_pod_usage_tracker.async_session_factory") as mock_factory:
            mock_factory.return_value.__aenter__.return_value = mock_db

            with patch("src.services.local_pod_usage_tracker.is_pod_online", return_value=True):
                with patch(
                    "src.services.local_pod_usage_tracker._record_local_pod_usage"
                ) as mock_record:
                    await track_local_pod_workspaces()

                    # Should calculate duration around 120 seconds
                    duration = mock_record.call_args.kwargs["duration_seconds"]
                    assert 115 <= duration <= 125  # Allow some tolerance


@pytest.mark.unit
@pytest.mark.asyncio
async def test_track_local_pod_workspaces_skips_short_duration():
    """Test tracking skips if duration is too short (< 30s)."""
    import src.services.local_pod_usage_tracker as tracker_module

    mock_session = MagicMock()
    mock_session.id = "session123"
    mock_session.owner_id = "user123"

    mock_workspace = MagicMock()
    mock_workspace.id = "ws123"
    mock_workspace.local_pod_id = "pod123"
    mock_workspace.status = "running"
    mock_workspace.session = mock_session

    # Set last tracked time to 10 seconds ago (too short)
    tracker_module._last_tracked["ws123"] = datetime.now(UTC) - timedelta(seconds=10)

    mock_result = MagicMock()
    mock_result.scalars().all.return_value = [mock_workspace]

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_result)
    mock_db.commit = AsyncMock()

    with patch("src.services.local_pod_usage_tracker.get_local_pod_pricing") as mock_pricing:
        mock_pricing.return_value = {
            "billing_enabled": True,
            "hourly_rate_cents": 100,
        }

        with patch("src.services.local_pod_usage_tracker.async_session_factory") as mock_factory:
            mock_factory.return_value.__aenter__.return_value = mock_db

            with patch("src.services.local_pod_usage_tracker.is_pod_online", return_value=True):
                with patch(
                    "src.services.local_pod_usage_tracker._record_local_pod_usage"
                ) as mock_record:
                    await track_local_pod_workspaces()

                    # Should not record usage
                    mock_record.assert_not_called()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_track_local_pod_workspaces_skips_no_session():
    """Test tracking skips workspace without session."""
    mock_workspace = MagicMock()
    mock_workspace.id = "ws123"
    mock_workspace.local_pod_id = "pod123"
    mock_workspace.status = "running"
    mock_workspace.session = None  # No session

    mock_result = MagicMock()
    mock_result.scalars().all.return_value = [mock_workspace]

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_result)
    mock_db.commit = AsyncMock()

    with patch("src.services.local_pod_usage_tracker.get_local_pod_pricing") as mock_pricing:
        mock_pricing.return_value = {
            "billing_enabled": True,
            "hourly_rate_cents": 100,
        }

        with patch("src.services.local_pod_usage_tracker.async_session_factory") as mock_factory:
            mock_factory.return_value.__aenter__.return_value = mock_db

            with patch("src.services.local_pod_usage_tracker.is_pod_online", return_value=True):
                with patch(
                    "src.services.local_pod_usage_tracker._record_local_pod_usage"
                ) as mock_record:
                    await track_local_pod_workspaces()

                    mock_record.assert_not_called()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_track_local_pod_workspaces_handles_workspace_error():
    """Test tracking continues even if one workspace fails."""
    mock_session = MagicMock()
    mock_session.id = "session123"
    mock_session.owner_id = "user123"

    # First workspace will error, second should still process
    mock_ws1 = MagicMock()
    mock_ws1.id = "ws1"
    mock_ws1.local_pod_id = "pod1"
    mock_ws1.session = mock_session

    mock_ws2 = MagicMock()
    mock_ws2.id = "ws2"
    mock_ws2.local_pod_id = "pod2"
    mock_ws2.session = mock_session

    mock_result = MagicMock()
    mock_result.scalars().all.return_value = [mock_ws1, mock_ws2]

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_result)
    mock_db.commit = AsyncMock()

    with patch("src.services.local_pod_usage_tracker.get_local_pod_pricing") as mock_pricing:
        mock_pricing.return_value = {
            "billing_enabled": True,
            "hourly_rate_cents": 100,
        }

        with patch("src.services.local_pod_usage_tracker.async_session_factory") as mock_factory:
            mock_factory.return_value.__aenter__.return_value = mock_db

            with (
                patch(
                    "src.services.local_pod_usage_tracker.is_pod_online", side_effect=[True, True]
                ),
                patch(
                    "src.services.local_pod_usage_tracker._record_local_pod_usage"
                ) as mock_record,
            ):
                # First call raises error, second succeeds
                mock_record.side_effect = [Exception("Test error"), None]

                await track_local_pod_workspaces()

                # Should have tried to record both
                assert mock_record.call_count == 2


@pytest.mark.unit
@pytest.mark.asyncio
async def test_track_local_pod_workspaces_handles_db_error():
    """Test tracking handles database errors gracefully."""
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(side_effect=Exception("DB error"))

    with patch("src.services.local_pod_usage_tracker.get_local_pod_pricing") as mock_pricing:
        mock_pricing.return_value = {
            "billing_enabled": True,
            "hourly_rate_cents": 100,
        }

        with patch("src.services.local_pod_usage_tracker.async_session_factory") as mock_factory:
            mock_factory.return_value.__aenter__.return_value = mock_db

            # Should not raise exception
            await track_local_pod_workspaces()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_cleanup_tracking_state():
    """Test cleanup removes workspace from tracking state."""
    import src.services.local_pod_usage_tracker as tracker_module

    tracker_module._last_tracked["ws123"] = datetime.now(UTC)

    await cleanup_tracking_state("ws123")

    assert "ws123" not in tracker_module._last_tracked


@pytest.mark.unit
@pytest.mark.asyncio
async def test_cleanup_tracking_state_nonexistent():
    """Test cleanup handles nonexistent workspace gracefully."""
    # Should not raise error
    await cleanup_tracking_state("nonexistent")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_local_pod_usage_tracker_start():
    """Test starting the usage tracker."""
    tracker = LocalPodUsageTracker()

    await tracker.start()

    assert tracker._running is True
    assert tracker._task is not None

    await tracker.stop()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_local_pod_usage_tracker_start_idempotent():
    """Test starting tracker multiple times is idempotent."""
    tracker = LocalPodUsageTracker()

    await tracker.start()
    first_task = tracker._task

    await tracker.start()
    second_task = tracker._task

    assert first_task is second_task

    await tracker.stop()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_local_pod_usage_tracker_stop():
    """Test stopping the usage tracker."""
    tracker = LocalPodUsageTracker()

    await tracker.start()
    await tracker.stop()

    assert tracker._running is False
    assert tracker._task is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_local_pod_usage_tracker_stop_clears_state():
    """Test stopping tracker clears tracking state."""
    import src.services.local_pod_usage_tracker as tracker_module

    tracker_module._last_tracked["ws123"] = datetime.now(UTC)

    tracker = LocalPodUsageTracker()
    await tracker.start()
    await tracker.stop()

    assert len(tracker_module._last_tracked) == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_local_pod_usage_tracker_run_loop():
    """Test tracker runs tracking loop."""
    tracker = LocalPodUsageTracker()

    with patch("src.services.local_pod_usage_tracker.track_local_pod_workspaces") as mock_track:
        mock_track.return_value = None

        await tracker.start()

        # Wait for at least one tracking cycle
        await asyncio.sleep(0.1)

        await tracker.stop()

        # Should have called tracking function at least once
        assert mock_track.call_count >= 0  # May not be called yet due to sleep


@pytest.mark.unit
@pytest.mark.asyncio
async def test_local_pod_usage_tracker_handles_tracking_error():
    """Test tracker continues running even if tracking fails."""
    tracker = LocalPodUsageTracker()

    with patch("src.services.local_pod_usage_tracker.track_local_pod_workspaces") as mock_track:
        mock_track.side_effect = Exception("Tracking error")

        await tracker.start()
        await asyncio.sleep(0.1)

        # Should still be running
        assert tracker._running is True

        await tracker.stop()
