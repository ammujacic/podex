"""Central notification service with preference enforcement.

This service coordinates notification delivery across all channels:
- Email (via EmailService)
- Push (via PushNotificationService)
- In-App (via database Notification model)

It checks user notification preferences before sending to each channel.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import Notification, User, UserConfig
from src.services.email import EmailService, EmailTemplate, get_email_service
from src.services.push import PushResult, push_service

logger = structlog.get_logger()


class NotificationType(str, Enum):
    """Notification category types matching frontend settings."""

    AGENT_COMPLETE = "agent_complete"
    AGENT_ERROR = "agent_error"
    BILLING = "billing"
    SECURITY = "security"
    UPDATES = "updates"


@dataclass
class NotificationResult:
    """Result of sending a notification across channels."""

    email_sent: bool = False
    push_sent: bool = False
    in_app_created: bool = False
    notification_id: str | None = None
    error: str | None = None


class NotificationService:
    """Central service for sending notifications with preference enforcement."""

    def __init__(self, db: AsyncSession) -> None:
        """Initialize the notification service."""
        self._db = db
        self._email_service: EmailService = get_email_service()

    async def _get_user_preferences(
        self,
        user_id: str,
    ) -> dict[str, Any]:
        """Get notification preferences for a user.

        Returns default preferences if none are configured.
        """
        result = await self._db.execute(
            select(UserConfig.ui_preferences).where(UserConfig.user_id == user_id)
        )
        row = result.scalar_one_or_none()

        if not row or not isinstance(row, dict):
            return {}

        notifications = row.get("notifications", {})
        return notifications if isinstance(notifications, dict) else {}

    async def _get_channel_enabled(
        self,
        user_id: str,
        notification_type: NotificationType,
        channel: str,
    ) -> bool:
        """Check if a specific channel is enabled for a notification type.

        Args:
            user_id: The user ID
            notification_type: The notification category
            channel: One of 'email', 'push', 'inApp'

        Returns:
            True if enabled, False if disabled. Defaults to True for most.
        """
        prefs = await self._get_user_preferences(user_id)
        settings = prefs.get("settings", [])

        # Find the setting for this notification type
        for setting in settings:
            if setting.get("id") == notification_type.value:
                return bool(setting.get(channel, True))

        # Default preferences if not configured
        defaults = {
            NotificationType.AGENT_COMPLETE: {"email": True, "push": True, "inApp": True},
            NotificationType.AGENT_ERROR: {"email": True, "push": True, "inApp": True},
            NotificationType.BILLING: {"email": True, "push": False, "inApp": True},
            NotificationType.SECURITY: {"email": True, "push": True, "inApp": True},
            NotificationType.UPDATES: {"email": False, "push": False, "inApp": True},
        }

        return defaults.get(notification_type, {}).get(channel, True)

    async def _create_in_app_notification(
        self,
        user_id: str,
        title: str,
        message: str,
        notification_type: str = "info",
        action_url: str | None = None,
        action_label: str | None = None,
    ) -> Notification:
        """Create an in-app notification in the database and emit WebSocket event."""
        notification = Notification(
            user_id=user_id,
            type=notification_type,
            title=title,
            message=message,
            action_url=action_url,
            action_label=action_label,
            read=False,
        )
        self._db.add(notification)
        await self._db.flush()

        # Emit real-time WebSocket event
        try:
            from src.websocket.hub import emit_notification_to_user  # noqa: PLC0415

            await emit_notification_to_user(
                user_id,
                notification.id,
                title,
                message,
                notification_type,
                action_url,
            )
        except Exception as e:
            logger.warning(
                "Failed to emit notification WebSocket event",
                user_id=user_id,
                error=str(e),
            )

        return notification

    async def send_notification(
        self,
        user_id: str,
        notification_type: NotificationType,
        title: str,
        message: str,
        *,
        email_template: EmailTemplate | None = None,
        email_context: dict[str, Any] | None = None,
        action_url: str | None = None,
        action_label: str | None = None,
        in_app_type: str = "info",
        push_tag: str | None = None,
    ) -> NotificationResult:
        """Send a notification across all enabled channels.

        Args:
            user_id: Target user ID
            notification_type: Category of notification (for preference lookup)
            title: Notification title (used for push and in-app)
            message: Notification body (used for push and in-app)
            email_template: Optional email template to use
            email_context: Context variables for email template
            action_url: Optional URL for the notification action
            action_label: Optional label for the action button
            in_app_type: Type for in-app notification (info, warning, error, success)
            push_tag: Optional tag for push notification grouping

        Returns:
            NotificationResult with delivery status for each channel
        """
        result = NotificationResult()

        # Get user email for email notifications
        user_result = await self._db.execute(
            select(User.email, User.name).where(User.id == user_id)
        )
        user_row = user_result.one_or_none()
        if not user_row:
            result.error = "User not found"
            return result

        user_email, user_name = user_row

        # Check and send email
        if email_template and await self._get_channel_enabled(user_id, notification_type, "email"):
            try:
                context = email_context or {}
                if "name" not in context:
                    context["name"] = user_name or "there"
                email_result = await self._email_service.send_email(
                    user_email,
                    email_template,
                    context,
                )
                result.email_sent = email_result.success
            except Exception as e:
                logger.warning(
                    "Failed to send email notification",
                    user_id=user_id,
                    error=str(e),
                )

        # Check and send push
        if await self._get_channel_enabled(user_id, notification_type, "push"):
            try:
                push_result: PushResult = await push_service.send_notification(
                    self._db,
                    user_id,
                    title,
                    message,
                    url=action_url,
                    tag=push_tag or notification_type.value,
                )
                result.push_sent = push_result.success and push_result.sent_count > 0
            except Exception as e:
                logger.warning(
                    "Failed to send push notification",
                    user_id=user_id,
                    error=str(e),
                )

        # Check and create in-app notification
        if await self._get_channel_enabled(user_id, notification_type, "inApp"):
            try:
                notification = await self._create_in_app_notification(
                    user_id,
                    title,
                    message,
                    notification_type=in_app_type,
                    action_url=action_url,
                    action_label=action_label,
                )
                result.in_app_created = True
                result.notification_id = notification.id
            except Exception as e:
                logger.warning(
                    "Failed to create in-app notification",
                    user_id=user_id,
                    error=str(e),
                )

        logger.info(
            "Notification sent",
            user_id=user_id,
            notification_type=notification_type.value,
            email=result.email_sent,
            push=result.push_sent,
            in_app=result.in_app_created,
        )

        return result

    async def send_billing_notification(
        self,
        user_id: str,
        title: str,
        message: str,
        email_template: EmailTemplate,
        email_context: dict[str, Any],
        action_url: str | None = None,
    ) -> NotificationResult:
        """Send a billing-related notification."""
        return await self.send_notification(
            user_id,
            NotificationType.BILLING,
            title,
            message,
            email_template=email_template,
            email_context=email_context,
            action_url=action_url,
            action_label="View Details",
            in_app_type="info",
        )

    async def send_security_notification(
        self,
        user_id: str,
        title: str,
        message: str,
        email_template: EmailTemplate | None = None,
        email_context: dict[str, Any] | None = None,
    ) -> NotificationResult:
        """Send a security-related notification."""
        return await self.send_notification(
            user_id,
            NotificationType.SECURITY,
            title,
            message,
            email_template=email_template,
            email_context=email_context,
            action_url="/settings/security",
            action_label="Review Security",
            in_app_type="warning",
        )

    async def send_agent_notification(
        self,
        user_id: str,
        title: str,
        message: str,
        is_error: bool = False,
        session_url: str | None = None,
    ) -> NotificationResult:
        """Send an agent-related notification."""
        notification_type = (
            NotificationType.AGENT_ERROR if is_error else NotificationType.AGENT_COMPLETE
        )
        return await self.send_notification(
            user_id,
            notification_type,
            title,
            message,
            action_url=session_url,
            action_label="View Session",
            in_app_type="error" if is_error else "success",
        )

    async def send_product_update(
        self,
        user_id: str,
        title: str,
        message: str,
        action_url: str | None = None,
        action_label: str | None = None,
    ) -> NotificationResult:
        """Send a product update notification."""
        return await self.send_notification(
            user_id,
            NotificationType.UPDATES,
            title,
            message,
            action_url=action_url,
            action_label=action_label or "Learn More",
            in_app_type="info",
        )
