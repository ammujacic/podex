"""Web Push notification service.

This module provides a service for sending push notifications to users
via the Web Push protocol. Requires VAPID keys to be configured.

To generate VAPID keys, run:
    npx web-push generate-vapid-keys

Then set the environment variables:
    VAPID_PUBLIC_KEY=<public key>
    VAPID_PRIVATE_KEY=<private key>
    VAPID_EMAIL=mailto:admin@example.com
"""

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import structlog
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import PushSubscription

logger = structlog.get_logger()

# Try to import pywebpush - it's optional and only needed for sending
try:
    from pywebpush import WebPushException, webpush

    WEBPUSH_AVAILABLE = True
except ImportError:
    WEBPUSH_AVAILABLE = False
    logger.warning("pywebpush not installed - push notifications will be disabled")


@dataclass
class PushResult:
    """Result of a push notification send operation."""

    success: bool
    sent_count: int = 0
    failed_count: int = 0
    error: str | None = None


class PushNotificationService:
    """Service for sending Web Push notifications."""

    def __init__(self) -> None:
        """Initialize the push notification service."""
        self._vapid_private_key = getattr(settings, "VAPID_PRIVATE_KEY", None)
        self._vapid_public_key = getattr(settings, "VAPID_PUBLIC_KEY", None)
        self._vapid_email = getattr(settings, "VAPID_EMAIL", "mailto:admin@podex.io")

        if not WEBPUSH_AVAILABLE:
            logger.warning("Push notifications disabled: pywebpush not installed")
        elif not self._vapid_private_key or not self._vapid_public_key:
            logger.warning("Push notifications disabled: VAPID keys not configured")

    @property
    def is_available(self) -> bool:
        """Check if push notifications are available."""
        return WEBPUSH_AVAILABLE and bool(self._vapid_private_key) and bool(self._vapid_public_key)

    async def send_notification(
        self,
        db: AsyncSession,
        user_id: str,
        title: str,
        body: str,
        *,
        url: str | None = None,
        tag: str | None = None,
        actions: list[dict[str, str]] | None = None,
        data: dict[str, Any] | None = None,
    ) -> PushResult:
        """Send a push notification to all active subscriptions for a user.

        Args:
            db: Database session
            user_id: User ID to send notification to
            title: Notification title
            body: Notification body text
            url: Optional URL to open when notification is clicked
            tag: Optional tag for grouping/replacing notifications
            actions: Optional list of action buttons
            data: Optional additional data to include

        Returns:
            PushResult with success status and counts
        """
        if not self.is_available:
            return PushResult(
                success=False,
                error="Push notifications not configured",
            )

        # Get all active subscriptions for the user
        result = await db.execute(
            select(PushSubscription).where(
                PushSubscription.user_id == user_id,
                PushSubscription.is_active == True,
            )
        )
        subscriptions = result.scalars().all()

        if not subscriptions:
            logger.debug("No active push subscriptions for user", user_id=user_id)
            return PushResult(success=True, sent_count=0)

        # Build notification payload
        payload = json.dumps(
            {
                "title": title,
                "body": body,
                "url": url,
                "tag": tag,
                "actions": actions or [],
                "data": data or {},
            }
        )

        sent_count = 0
        failed_count = 0
        deactivated_ids: list[str] = []

        for subscription in subscriptions:
            try:
                webpush(
                    subscription_info={
                        "endpoint": subscription.endpoint,
                        "keys": {
                            "p256dh": subscription.p256dh_key,
                            "auth": subscription.auth_key,
                        },
                    },
                    data=payload,
                    vapid_private_key=self._vapid_private_key,
                    vapid_claims={
                        "sub": self._vapid_email,
                    },
                )
                sent_count += 1

                # Update last_used_at
                subscription.last_used_at = datetime.now(UTC)

            except WebPushException as e:
                failed_count += 1
                logger.warning(
                    "Push notification failed",
                    subscription_id=subscription.id,
                    status_code=e.response.status_code if e.response else None,
                    error=str(e),
                )

                # Deactivate subscription if it's gone (410) or unauthorized (401/403)
                if e.response and e.response.status_code in (401, 403, 404, 410):
                    deactivated_ids.append(subscription.id)

            except Exception:
                failed_count += 1
                logger.exception(
                    "Unexpected error sending push notification",
                    subscription_id=subscription.id,
                )

        # Deactivate failed subscriptions
        if deactivated_ids:
            await db.execute(
                update(PushSubscription)
                .where(PushSubscription.id.in_(deactivated_ids))
                .values(is_active=False)
            )
            logger.info(
                "Deactivated stale push subscriptions",
                count=len(deactivated_ids),
                user_id=user_id,
            )

        await db.commit()

        logger.info(
            "Sent push notifications",
            user_id=user_id,
            sent=sent_count,
            failed=failed_count,
        )

        return PushResult(
            success=sent_count > 0 or failed_count == 0,
            sent_count=sent_count,
            failed_count=failed_count,
        )

    async def send_notification_to_many(
        self,
        db: AsyncSession,
        user_ids: list[str],
        title: str,
        body: str,
        **kwargs: Any,
    ) -> dict[str, PushResult]:
        """Send a push notification to multiple users.

        Args:
            db: Database session
            user_ids: List of user IDs
            title: Notification title
            body: Notification body text
            **kwargs: Additional arguments passed to send_notification

        Returns:
            Dict mapping user_id to PushResult
        """
        results = {}
        for user_id in user_ids:
            results[user_id] = await self.send_notification(db, user_id, title, body, **kwargs)
        return results


# Singleton instance
push_service = PushNotificationService()
