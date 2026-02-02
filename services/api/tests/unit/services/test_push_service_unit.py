"""Unit tests for push notification service.

Tests web push notification functionality with mocked dependencies.
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.services.push import PushNotificationService, PushResult


@pytest.mark.unit
def test_push_service_init_with_keys():
    """Test push service initialization with VAPID keys."""
    with patch("src.services.push.settings") as mock_settings:
        mock_settings.VAPID_PRIVATE_KEY = "test_private"
        mock_settings.VAPID_PUBLIC_KEY = "test_public"
        mock_settings.VAPID_EMAIL = "test@example.com"

        with patch("src.services.push.WEBPUSH_AVAILABLE", True):
            service = PushNotificationService()

            assert service.is_available is True


@pytest.mark.unit
def test_push_service_init_without_webpush():
    """Test push service when pywebpush not installed."""
    with patch("src.services.push.settings") as mock_settings:
        mock_settings.VAPID_PRIVATE_KEY = "test_private"
        mock_settings.VAPID_PUBLIC_KEY = "test_public"

        with patch("src.services.push.WEBPUSH_AVAILABLE", False):
            service = PushNotificationService()

            assert service.is_available is False


@pytest.mark.unit
def test_push_service_init_without_keys():
    """Test push service when VAPID keys not configured."""
    with patch("src.services.push.settings") as mock_settings:
        mock_settings.VAPID_PRIVATE_KEY = None
        mock_settings.VAPID_PUBLIC_KEY = None

        with patch("src.services.push.WEBPUSH_AVAILABLE", True):
            service = PushNotificationService()

            assert service.is_available is False


@pytest.mark.unit
@pytest.mark.asyncio
async def test_send_notification_not_configured():
    """Test sending notification when service not configured."""
    with patch("src.services.push.settings") as mock_settings:
        mock_settings.VAPID_PRIVATE_KEY = None
        mock_settings.VAPID_PUBLIC_KEY = None

        with patch("src.services.push.WEBPUSH_AVAILABLE", True):
            service = PushNotificationService()
            mock_db = AsyncMock()

            result = await service.send_notification(mock_db, "user123", "Test Title", "Test Body")

            assert result.success is False
            assert result.error == "Push notifications not configured"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_send_notification_no_subscriptions():
    """Test sending notification when user has no subscriptions."""
    with patch("src.services.push.settings") as mock_settings:
        mock_settings.VAPID_PRIVATE_KEY = "test_private"
        mock_settings.VAPID_PUBLIC_KEY = "test_public"

        with patch("src.services.push.WEBPUSH_AVAILABLE", True):
            service = PushNotificationService()
            mock_db = AsyncMock()

            # Mock no subscriptions
            mock_result = MagicMock()
            mock_result.scalars().all.return_value = []
            mock_db.execute = AsyncMock(return_value=mock_result)

            result = await service.send_notification(mock_db, "user123", "Test Title", "Test Body")

            assert result.success is True
            assert result.sent_count == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_send_notification_success():
    """Test successfully sending notification."""
    with patch("src.services.push.settings") as mock_settings:
        mock_settings.VAPID_PRIVATE_KEY = "test_private"
        mock_settings.VAPID_PUBLIC_KEY = "test_public"
        mock_settings.VAPID_EMAIL = "test@example.com"

        with patch("src.services.push.WEBPUSH_AVAILABLE", True):
            with patch("src.services.push.webpush") as mock_webpush:
                service = PushNotificationService()
                mock_db = AsyncMock()

                # Mock subscription
                mock_subscription = MagicMock()
                mock_subscription.id = "sub123"
                mock_subscription.endpoint = "https://push.example.com"
                mock_subscription.p256dh_key = "test_p256dh"
                mock_subscription.auth_key = "test_auth"
                mock_subscription.last_used_at = datetime.now(UTC)

                mock_result = MagicMock()
                mock_result.scalars().all.return_value = [mock_subscription]
                mock_db.execute = AsyncMock(return_value=mock_result)

                result = await service.send_notification(
                    mock_db,
                    "user123",
                    "Test Title",
                    "Test Body",
                    url="https://example.com",
                    tag="test_tag",
                )

                assert result.success is True
                assert result.sent_count == 1
                assert result.failed_count == 0
                mock_webpush.assert_called_once()
                mock_db.commit.assert_called_once()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_send_notification_webpush_exception_410():
    """Test handling WebPushException with 410 Gone status."""
    with patch("src.services.push.settings") as mock_settings:
        mock_settings.VAPID_PRIVATE_KEY = "test_private"
        mock_settings.VAPID_PUBLIC_KEY = "test_public"

        with patch("src.services.push.WEBPUSH_AVAILABLE", True):
            with patch("src.services.push.webpush") as mock_webpush:
                # Import WebPushException from the mocked module
                from src.services.push import WebPushException

                # Mock exception with 410 status
                mock_response = MagicMock()
                mock_response.status_code = 410
                exc = WebPushException("Gone")
                exc.response = mock_response
                mock_webpush.side_effect = exc

                service = PushNotificationService()
                mock_db = AsyncMock()

                # Mock subscription
                mock_subscription = MagicMock()
                mock_subscription.id = "sub123"
                mock_subscription.endpoint = "https://push.example.com"
                mock_subscription.p256dh_key = "test_p256dh"
                mock_subscription.auth_key = "test_auth"

                mock_result = MagicMock()
                mock_result.scalars().all.return_value = [mock_subscription]
                mock_db.execute = AsyncMock(return_value=mock_result)

                result = await service.send_notification(
                    mock_db, "user123", "Test Title", "Test Body"
                )

                assert result.success is False
                assert result.sent_count == 0
                assert result.failed_count == 1
                # Subscription should be deactivated
                mock_db.execute.assert_called()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_send_notification_generic_exception():
    """Test handling generic exception during send."""
    with patch("src.services.push.settings") as mock_settings:
        mock_settings.VAPID_PRIVATE_KEY = "test_private"
        mock_settings.VAPID_PUBLIC_KEY = "test_public"

        with patch("src.services.push.WEBPUSH_AVAILABLE", True):
            with patch("src.services.push.webpush") as mock_webpush:
                # Mock generic exception
                mock_webpush.side_effect = Exception("Unexpected error")

                service = PushNotificationService()
                mock_db = AsyncMock()

                # Mock subscription
                mock_subscription = MagicMock()
                mock_subscription.id = "sub123"
                mock_subscription.endpoint = "https://push.example.com"
                mock_subscription.p256dh_key = "test_p256dh"
                mock_subscription.auth_key = "test_auth"

                mock_result = MagicMock()
                mock_result.scalars().all.return_value = [mock_subscription]
                mock_db.execute = AsyncMock(return_value=mock_result)

                result = await service.send_notification(
                    mock_db, "user123", "Test Title", "Test Body"
                )

                assert result.success is False
                assert result.sent_count == 0
                assert result.failed_count == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_send_notification_mixed_results():
    """Test sending notification to multiple subscriptions with mixed results."""
    with patch("src.services.push.settings") as mock_settings:
        mock_settings.VAPID_PRIVATE_KEY = "test_private"
        mock_settings.VAPID_PUBLIC_KEY = "test_public"

        with patch("src.services.push.WEBPUSH_AVAILABLE", True):
            with patch("src.services.push.webpush") as mock_webpush:
                # First call succeeds, second fails
                from src.services.push import WebPushException

                mock_response = MagicMock()
                mock_response.status_code = 404
                exc = WebPushException("Not found")
                exc.response = mock_response

                mock_webpush.side_effect = [None, exc]

                service = PushNotificationService()
                mock_db = AsyncMock()

                # Mock two subscriptions
                mock_sub1 = MagicMock()
                mock_sub1.id = "sub1"
                mock_sub1.endpoint = "https://push.example.com/1"
                mock_sub1.p256dh_key = "test_p256dh"
                mock_sub1.auth_key = "test_auth"

                mock_sub2 = MagicMock()
                mock_sub2.id = "sub2"
                mock_sub2.endpoint = "https://push.example.com/2"
                mock_sub2.p256dh_key = "test_p256dh"
                mock_sub2.auth_key = "test_auth"

                mock_result = MagicMock()
                mock_result.scalars().all.return_value = [mock_sub1, mock_sub2]
                mock_db.execute = AsyncMock(return_value=mock_result)

                result = await service.send_notification(
                    mock_db, "user123", "Test Title", "Test Body"
                )

                assert result.sent_count == 1
                assert result.failed_count == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_send_notification_to_many():
    """Test sending notification to multiple users."""
    with patch("src.services.push.settings") as mock_settings:
        mock_settings.VAPID_PRIVATE_KEY = "test_private"
        mock_settings.VAPID_PUBLIC_KEY = "test_public"

        with patch("src.services.push.WEBPUSH_AVAILABLE", True):
            service = PushNotificationService()
            mock_db = AsyncMock()

            # Mock no subscriptions for simplicity
            mock_result = MagicMock()
            mock_result.scalars().all.return_value = []
            mock_db.execute = AsyncMock(return_value=mock_result)

            user_ids = ["user1", "user2", "user3"]
            results = await service.send_notification_to_many(
                mock_db, user_ids, "Test Title", "Test Body"
            )

            assert len(results) == 3
            assert "user1" in results
            assert "user2" in results
            assert "user3" in results
            # Each should have success=True with sent_count=0 (no subscriptions)
            for user_id in user_ids:
                assert results[user_id].success is True
                assert results[user_id].sent_count == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_send_notification_with_actions_and_data():
    """Test sending notification with actions and custom data."""
    with patch("src.services.push.settings") as mock_settings:
        mock_settings.VAPID_PRIVATE_KEY = "test_private"
        mock_settings.VAPID_PUBLIC_KEY = "test_public"

        with patch("src.services.push.WEBPUSH_AVAILABLE", True):
            with patch("src.services.push.webpush") as mock_webpush:
                service = PushNotificationService()
                mock_db = AsyncMock()

                # Mock subscription
                mock_subscription = MagicMock()
                mock_subscription.id = "sub123"
                mock_subscription.endpoint = "https://push.example.com"
                mock_subscription.p256dh_key = "test_p256dh"
                mock_subscription.auth_key = "test_auth"

                mock_result = MagicMock()
                mock_result.scalars().all.return_value = [mock_subscription]
                mock_db.execute = AsyncMock(return_value=mock_result)

                actions = [{"action": "view", "title": "View"}]
                data = {"custom_key": "custom_value"}

                result = await service.send_notification(
                    mock_db,
                    "user123",
                    "Test Title",
                    "Test Body",
                    actions=actions,
                    data=data,
                )

                assert result.success is True
                assert result.sent_count == 1
                # Verify webpush was called with the payload
                call_args = mock_webpush.call_args
                assert call_args is not None
