"""Transactional email service with pluggable backends.

This module provides a comprehensive email service with:
- Beautiful, responsive HTML templates matching the Podex design system
- Plain text fallbacks for all emails
- Multiple backend support (console, SMTP, SendGrid)
- Email tracking and logging
- Template rendering with Jinja2-style variables

Backends:
- console: Logs emails to console (development)
- smtp: Uses standard SMTP (production - works with any SMTP relay)
- sendgrid: Uses SendGrid API (recommended for production)
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from enum import Enum
from functools import lru_cache
from typing import Any
from uuid import uuid4

import structlog

from src.config import settings

logger = structlog.get_logger()


class EmailTemplate(str, Enum):
    """Available email templates."""

    WELCOME = "welcome"
    EMAIL_VERIFICATION = "email_verification"
    PASSWORD_RESET = "pw_reset"
    PASSWORD_CHANGED = "pw_changed"
    SUBSCRIPTION_CREATED = "subscription_created"
    SUBSCRIPTION_CANCELED = "subscription_canceled"
    SUBSCRIPTION_RENEWED = "subscription_renewed"
    PAYMENT_RECEIVED = "payment_received"
    PAYMENT_FAILED = "payment_failed"
    USAGE_WARNING = "usage_warning"
    USAGE_LIMIT_REACHED = "usage_limit_reached"
    CREDITS_LOW = "credits_low"
    CREDITS_ADDED = "credits_added"
    ACCOUNT_DEACTIVATED = "account_deactivated"
    TEAM_INVITE = "team_invite"
    SESSION_SHARED = "session_shared"
    PLATFORM_INVITE = "platform_invite"
    WAITLIST_CONFIRMATION = "waitlist_confirmation"


@dataclass
class EmailResult:
    """Result of an email send operation."""

    success: bool
    message_id: str | None = None
    error: str | None = None


class EmailService:
    """Service for sending transactional emails with pluggable backends.

    Supported backends (via EMAIL_BACKEND setting):
    - console: Logs emails to console (development)
    - smtp: Uses standard SMTP (production)
    """

    def __init__(self) -> None:
        """Initialize the email service."""
        self._from_email = settings.EMAIL_FROM_ADDRESS
        self._from_name = settings.EMAIL_FROM_NAME
        self._backend = getattr(settings, "EMAIL_BACKEND", "console")

    async def send_email(
        self,
        to_email: str,
        template: EmailTemplate,
        context: dict[str, Any],
        *,
        cc: list[str] | None = None,
        bcc: list[str] | None = None,
    ) -> EmailResult:
        """Send a transactional email.

        Args:
            to_email: Recipient email address
            template: Email template to use
            context: Template context variables
            cc: Optional CC recipients
            bcc: Optional BCC recipients

        Returns:
            EmailResult with success status and message ID
        """
        # Build email content
        subject = self._get_subject(template, context)
        html_body = self._render_html(template, context)
        text_body = self._render_text(template, context)

        # Build from address
        from_address = f"{self._from_name} <{self._from_email}>"

        # Route to appropriate backend
        if self._backend == "console":
            return await self._send_console(
                to_email, subject, html_body, text_body, template, cc, bcc
            )
        if self._backend == "smtp":
            return await self._send_smtp(
                to_email, from_address, subject, html_body, text_body, template, cc, bcc
            )
        if self._backend == "sendgrid":
            return await self._send_sendgrid(
                to_email, subject, html_body, text_body, template, cc, bcc
            )
        logger.warning("Unknown email backend: %s, using console", self._backend)
        return await self._send_console(to_email, subject, html_body, text_body, template, cc, bcc)

    async def _send_console(
        self,
        to_email: str,
        subject: str,
        html_body: str,  # noqa: ARG002
        text_body: str,
        template: EmailTemplate,
        cc: list[str] | None,
        bcc: list[str] | None,
    ) -> EmailResult:
        """Log email to console (development backend)."""
        message_id = f"console-{uuid4().hex[:12]}"

        logger.info(
            "Email sent (console backend)",
            to=to_email,
            cc=cc,
            bcc=bcc,
            subject=subject,
            template=template.value,
            message_id=message_id,
            body_preview=text_body[:200] + "..." if len(text_body) > 200 else text_body,
        )

        return EmailResult(success=True, message_id=message_id)

    async def _send_smtp(
        self,
        to_email: str,
        from_address: str,
        subject: str,
        html_body: str,
        text_body: str,
        template: EmailTemplate,
        cc: list[str] | None,
        bcc: list[str] | None,
    ) -> EmailResult:
        """Send email via async SMTP (non-blocking)."""
        import aiosmtplib  # noqa: PLC0415

        try:
            # Build MIME message
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = from_address
            msg["To"] = to_email
            if cc:
                msg["Cc"] = ", ".join(cc)

            # Attach plain text and HTML parts
            msg.attach(MIMEText(text_body, "plain", "utf-8"))
            msg.attach(MIMEText(html_body, "html", "utf-8"))

            # Build recipient list
            recipients = [to_email]
            if cc:
                recipients.extend(cc)
            if bcc:
                recipients.extend(bcc)

            # Get SMTP settings
            smtp_host = getattr(settings, "SMTP_HOST", "localhost")
            smtp_port = getattr(settings, "SMTP_PORT", 587)
            smtp_user = getattr(settings, "SMTP_USER", None)
            smtp_password = getattr(settings, "SMTP_PASSWORD", None)
            smtp_use_tls = getattr(settings, "SMTP_USE_TLS", True)

            # Send via async SMTP (non-blocking - doesn't block the event loop)
            await aiosmtplib.send(
                msg,
                hostname=smtp_host,
                port=smtp_port,
                username=smtp_user,
                password=smtp_password,
                start_tls=smtp_use_tls,
                recipients=recipients,
            )

            message_id = f"smtp-{uuid4().hex[:12]}"
            logger.info(
                "Email sent successfully",
                to=to_email,
                template=template.value,
                message_id=message_id,
            )

            return EmailResult(success=True, message_id=message_id)

        except Exception as e:
            error_msg = str(e)
            logger.exception(
                "Failed to send email",
                to=to_email,
                template=template.value,
            )
            return EmailResult(success=False, error=error_msg)

    async def _send_sendgrid(
        self,
        to_email: str,
        subject: str,
        html_body: str,
        text_body: str,
        template: EmailTemplate,
        cc: list[str] | None,
        bcc: list[str] | None,
    ) -> EmailResult:
        """Send email via SendGrid API (recommended for production)."""
        import httpx  # noqa: PLC0415

        api_key = getattr(settings, "SENDGRID_API_KEY", None)
        if not api_key:
            logger.warning("SENDGRID_API_KEY not set, falling back to console")
            return await self._send_console(
                to_email, subject, html_body, text_body, template, cc, bcc
            )

        try:
            # Build SendGrid API payload
            payload: dict[str, Any] = {
                "personalizations": [
                    {
                        "to": [{"email": to_email}],
                    }
                ],
                "from": {
                    "email": self._from_email,
                    "name": self._from_name,
                },
                "reply_to": {
                    "email": settings.EMAIL_REPLY_TO,
                },
                "subject": subject,
                "content": [
                    {"type": "text/plain", "value": text_body},
                    {"type": "text/html", "value": html_body},
                ],
                # Track opens and clicks for analytics
                "tracking_settings": {
                    "click_tracking": {"enable": True},
                    "open_tracking": {"enable": True},
                },
                # Add category for filtering in SendGrid dashboard
                "categories": [template.value, "transactional"],
            }

            # Add CC/BCC if provided
            if cc:
                payload["personalizations"][0]["cc"] = [{"email": e} for e in cc]
            if bcc:
                payload["personalizations"][0]["bcc"] = [{"email": e} for e in bcc]

            # Send via SendGrid API
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    settings.SENDGRID_API_URL,
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    timeout=settings.HTTP_TIMEOUT_SENDGRID,
                )

            # SendGrid returns 202 Accepted on success
            if response.status_code == 202:
                # Extract message ID from headers
                message_id = response.headers.get("X-Message-Id", f"sg-{uuid4().hex[:12]}")
                logger.info(
                    "Email sent via SendGrid",
                    to=to_email,
                    template=template.value,
                    message_id=message_id,
                )
                return EmailResult(success=True, message_id=message_id)

            # Handle errors
            error_msg = f"SendGrid API error: {response.status_code} - {response.text}"
            logger.error(
                "SendGrid API error",
                status_code=response.status_code,
                response=response.text,
                to=to_email,
                template=template.value,
            )
            return EmailResult(success=False, error=error_msg)

        except Exception as e:
            error_msg = str(e)
            logger.exception(
                "Failed to send email via SendGrid",
                to=to_email,
                template=template.value,
            )
            return EmailResult(success=False, error=error_msg)

    def _get_subject(self, template: EmailTemplate, context: dict[str, Any]) -> str:
        """Get the email subject for a template."""
        plan_name = context.get("plan_name", "Pro")
        percent = context.get("percent", 80)
        amount = context.get("amount", 0)
        team_name = context.get("team_name", "a team")
        sharer_name = context.get("sharer_name", "Someone")
        inviter_name = context.get("inviter_name", "The Podex team")

        subjects = {
            EmailTemplate.WELCOME: "Welcome to Podex - Your AI-Powered IDE",
            EmailTemplate.EMAIL_VERIFICATION: "Verify your Podex email address",
            EmailTemplate.PASSWORD_RESET: "Reset your Podex password",
            EmailTemplate.PASSWORD_CHANGED: "Your Podex password has been changed",
            EmailTemplate.SUBSCRIPTION_CREATED: f"Welcome to Podex {plan_name}!",
            EmailTemplate.SUBSCRIPTION_CANCELED: "Your Podex subscription has been canceled",
            EmailTemplate.SUBSCRIPTION_RENEWED: "Your Podex subscription has been renewed",
            EmailTemplate.PAYMENT_RECEIVED: "Payment received - Thank you!",
            EmailTemplate.PAYMENT_FAILED: "Action required: Payment failed",
            EmailTemplate.USAGE_WARNING: f"Usage Alert: {percent}% of your quota used",
            EmailTemplate.USAGE_LIMIT_REACHED: "Usage limit reached - Upgrade to continue",
            EmailTemplate.CREDITS_LOW: "Low credit balance alert",
            EmailTemplate.CREDITS_ADDED: f"${amount:.2f} credits added to your account",
            EmailTemplate.ACCOUNT_DEACTIVATED: "Your Podex account has been deactivated",
            EmailTemplate.TEAM_INVITE: f"You've been invited to join {team_name} on Podex",
            EmailTemplate.SESSION_SHARED: f"{sharer_name} shared a session with you",
            EmailTemplate.PLATFORM_INVITE: f"{inviter_name} invited you to join Podex",
            EmailTemplate.WAITLIST_CONFIRMATION: "You're on the Podex waitlist!",
        }
        return subjects.get(template, "Message from Podex")

    def _render_html(self, template: EmailTemplate, context: dict[str, Any]) -> str:
        """Render the HTML version of an email."""
        body_content = self._get_body_content(template, context)
        cta_button = self._get_cta_button(template, context)
        footer_text = self._get_footer_text(template)

        return BASE_HTML_TEMPLATE.format(
            preheader=self._get_preheader(template, context),
            logo_url=f"{settings.FRONTEND_URL}/icons/icon-192.png",
            body_content=body_content,
            cta_button=cta_button,
            footer_text=footer_text,
            current_year=datetime.now(UTC).year,
            unsubscribe_url=f"{settings.FRONTEND_URL}/settings/notifications",
        )

    def _render_text(self, template: EmailTemplate, context: dict[str, Any]) -> str:
        """Render the plain text version of an email."""
        return self._get_text_content(template, context)

    def _get_preheader(self, template: EmailTemplate, context: dict[str, Any]) -> str:
        """Get preheader text (preview text in email clients)."""
        gift_months = context.get("gift_months")
        gift_text = f" - includes {gift_months} months free!" if gift_months else ""

        preheaders = {
            EmailTemplate.WELCOME: "Get started with AI-powered development",
            EmailTemplate.EMAIL_VERIFICATION: "Please verify your email to continue",
            EmailTemplate.PASSWORD_RESET: "Click the link to reset your password",
            EmailTemplate.PASSWORD_CHANGED: "Your password was successfully changed",
            EmailTemplate.SUBSCRIPTION_CREATED: "Your subscription is now active",
            EmailTemplate.PAYMENT_RECEIVED: f"Payment of ${context.get('amount', 0):.2f} received",
            EmailTemplate.PAYMENT_FAILED: "Please update your payment method",
            EmailTemplate.USAGE_WARNING: "Consider upgrading your plan",
            EmailTemplate.PLATFORM_INVITE: f"Join the AI-powered IDE{gift_text}",
            EmailTemplate.WAITLIST_CONFIRMATION: "We'll notify you when it's your turn",
        }
        return preheaders.get(template, "")

    def _get_body_content(self, template: EmailTemplate, context: dict[str, Any]) -> str:
        """Get the main body content for a template."""
        name = context.get("name", "there")

        # Common styles
        h1 = "margin: 0 0 24px; font-size: 28px; font-weight: 700; color: #f0f0f5;"
        p_main = "margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #9898a8;"
        p_small = "margin: 0 0 24px; font-size: 14px; color: #5c5c6e;"
        box_gradient = (
            "background: linear-gradient(135deg, rgba(139, 92, 246, 0.1), "
            "rgba(6, 182, 212, 0.1)); border-radius: 12px; padding: 24px; margin: 24px 0;"
        )
        box_purple = (
            "background: rgba(139, 92, 246, 0.1); border-radius: 12px; "
            "padding: 24px; margin: 24px 0;"
        )
        box_green = (
            "background: rgba(34, 197, 94, 0.1); border-radius: 12px; "
            "padding: 24px; margin: 24px 0;"
        )
        box_warning = (
            "background: rgba(245, 158, 11, 0.1); border-radius: 12px; "
            "padding: 24px; margin: 24px 0;"
        )
        alert_red = (
            "background: rgba(239, 68, 68, 0.1); border-left: 4px solid #ef4444; "
            "border-radius: 8px; padding: 16px; margin: 24px 0;"
        )
        h3 = "margin: 0 0 16px; font-size: 18px; color: #f0f0f5;"
        ul = "margin: 0; padding-left: 20px; color: #9898a8;"
        li = "margin-bottom: 8px;"

        content_map = {
            EmailTemplate.WELCOME: f"""
<h1 style="{h1}">Welcome to Podex, {name}!</h1>
<p style="{p_main}">
    You've just joined the future of software development.
    Podex is your AI-powered IDE that brings intelligent agents,
    cloud workspaces, and powerful tools together in one place.
</p>
<div style="{box_gradient}">
    <h3 style="{h3}">Here's what you can do:</h3>
    <ul style="{ul}">
        <li style="{li}">Create cloud development workspaces in seconds</li>
        <li style="{li}">Use AI agents to help with coding and debugging</li>
        <li style="{li}">Collaborate in real-time with your team</li>
        <li style="{li}">Access your projects from anywhere</li>
    </ul>
</div>
            """,
            EmailTemplate.EMAIL_VERIFICATION: f"""
<h1 style="{h1}">Verify your email address</h1>
<p style="{p_main}">
    Hi {name}, please click the button below to verify your email address
    and complete your account setup.
</p>
<p style="{p_small}">
    This link will expire in 24 hours.
    If you didn't create a Podex account, you can safely ignore this email.
</p>
            """,
            EmailTemplate.PASSWORD_RESET: f"""
<h1 style="{h1}">Reset your password</h1>
<p style="{p_main}">
    Hi {name}, we received a request to reset your password.
    Click the button below to choose a new password.
</p>
<p style="{p_small}">
    This link will expire in 1 hour.
    If you didn't request this, please ignore this email.
</p>
            """,
            EmailTemplate.PASSWORD_CHANGED: f"""
<h1 style="{h1}">Password changed successfully</h1>
<p style="{p_main}">
    Hi {name}, your Podex password has been successfully changed.
</p>
<div style="{alert_red}">
    <p style="margin: 0; font-size: 14px; color: #f0f0f5;">
        <strong>Wasn't you?</strong> If you didn't make this change,
        please reset your password immediately and contact support.
    </p>
</div>
            """,
            EmailTemplate.SUBSCRIPTION_CREATED: self._render_subscription_created(
                name, context, h1, p_main, box_purple, h3, ul, li
            ),
            EmailTemplate.PAYMENT_RECEIVED: self._render_payment_received(
                name, context, h1, p_main, box_green
            ),
            EmailTemplate.PAYMENT_FAILED: self._render_payment_failed(
                name, context, h1, p_main, alert_red
            ),
            EmailTemplate.USAGE_WARNING: self._render_usage_warning(
                name, context, h1, p_main, box_warning
            ),
            EmailTemplate.CREDITS_ADDED: self._render_credits_added(
                name, context, h1, p_main, box_green
            ),
            EmailTemplate.TEAM_INVITE: self._render_team_invite(name, context, h1, p_main, p_small),
            EmailTemplate.SESSION_SHARED: self._render_session_shared(
                name, context, h1, p_main, box_purple
            ),
            EmailTemplate.PLATFORM_INVITE: self._render_platform_invite(
                name, context, h1, p_main, p_small, box_gradient, box_purple
            ),
            EmailTemplate.WAITLIST_CONFIRMATION: self._render_waitlist_confirmation(
                name, context, h1, p_main, box_gradient, box_purple
            ),
        }

        return content_map.get(template, f"<p>Hi {name},</p>")

    def _render_subscription_created(
        self,
        name: str,
        context: dict[str, Any],
        h1: str,
        p_main: str,
        box: str,
        h3: str,
        ul: str,
        li: str,
    ) -> str:
        """Render subscription created email content."""
        plan = context.get("plan_name", "Pro")
        tokens = context.get("tokens_included", 0)
        compute_credits = context.get("compute_credits", 0)
        sessions = context.get("max_sessions", 0)
        storage = context.get("storage_gb", 0)
        return f"""
<h1 style="{h1}">Welcome to Podex {plan}!</h1>
<p style="{p_main}">
    Hi {name}, thank you for subscribing to Podex!
    Your {plan} plan is now active.
</p>
<div style="{box}">
    <h3 style="{h3}">Your plan includes:</h3>
    <ul style="{ul}">
        <li style="{li}">{tokens:,} tokens per month</li>
        <li style="{li}">${compute_credits:.2f} in compute credits</li>
        <li style="{li}">{sessions} concurrent sessions</li>
        <li style="{li}">{storage}GB storage</li>
    </ul>
</div>
        """

    def _render_payment_received(
        self,
        name: str,
        context: dict[str, Any],
        h1: str,
        p_main: str,
        box: str,
    ) -> str:
        """Render payment received email content."""
        amount = context.get("amount", 0)
        date = context.get("date", "Today")
        invoice = context.get("invoice_number", "N/A")
        td_left = "padding: 8px 0; color: #9898a8;"
        td_right = "padding: 8px 0; text-align: right; color: #f0f0f5;"
        return f"""
<h1 style="{h1}">Payment received - Thank you!</h1>
<p style="{p_main}">
    Hi {name}, we've received your payment of
    <strong style="color: #22c55e;">${amount:.2f}</strong>.
</p>
<div style="{box}">
    <table style="width: 100%; border-collapse: collapse;">
        <tr>
            <td style="{td_left}">Date</td>
            <td style="{td_right}">{date}</td>
        </tr>
        <tr>
            <td style="{td_left}">Amount</td>
            <td style="{td_right}">${amount:.2f}</td>
        </tr>
        <tr>
            <td style="{td_left}">Invoice #</td>
            <td style="{td_right}">{invoice}</td>
        </tr>
    </table>
</div>
        """

    def _render_payment_failed(
        self,
        name: str,
        context: dict[str, Any],
        h1: str,
        p_main: str,
        alert: str,
    ) -> str:
        """Render payment failed email content."""
        amount = context.get("amount", 0)
        return f"""
<h1 style="{h1}">Payment failed - Action required</h1>
<p style="{p_main}">
    Hi {name}, we were unable to process your payment of ${amount:.2f}.
    Please update your payment method to continue using Podex.
</p>
<div style="{alert}">
    <p style="margin: 0; font-size: 14px; color: #f0f0f5;">
        <strong>Important:</strong> If payment is not received within 7 days,
        your subscription will be suspended.
    </p>
</div>
        """

    def _render_usage_warning(
        self,
        name: str,
        context: dict[str, Any],
        h1: str,
        p_main: str,
        box: str,
    ) -> str:
        """Render usage warning email content."""
        percent = context.get("percent", 80)
        quota_type = context.get("quota_type", "monthly")
        current = context.get("current_usage", 0)
        limit = context.get("limit", 0)
        unit = context.get("unit", "tokens")
        progress_bar = (
            "background: #1a1a21; border-radius: 8px; "
            "height: 12px; overflow: hidden; margin-bottom: 12px;"
        )
        progress_fill = (
            f"background: linear-gradient(90deg, #8B5CF6, #f59e0b); "
            f"height: 100%; width: {percent}%;"
        )
        return f"""
<h1 style="{h1}">Usage Alert: {percent}% used</h1>
<p style="{p_main}">
    Hi {name}, you've used {percent}% of your {quota_type} quota.
</p>
<div style="{box}">
    <div style="{progress_bar}">
        <div style="{progress_fill}"></div>
    </div>
    <p style="margin: 0; font-size: 14px; color: #9898a8;">
        {current:,} / {limit:,} {unit}
    </p>
</div>
<p style="margin: 0 0 24px; font-size: 14px; color: #9898a8;">
    Consider upgrading your plan to avoid service interruption.
</p>
        """

    def _render_credits_added(
        self,
        name: str,
        context: dict[str, Any],
        h1: str,
        p_main: str,
        box: str,
    ) -> str:
        """Render credits added email content."""
        amount = context.get("amount", 0)
        balance = context.get("new_balance", 0)
        box_centered = f"{box} text-align: center;"
        return f"""
<h1 style="{h1}">Credits added to your account</h1>
<p style="{p_main}">
    Hi {name}, <strong style="color: #22c55e;">${amount:.2f}</strong>
    has been added to your account.
</p>
<div style="{box_centered}">
    <p style="margin: 0 0 8px; font-size: 14px; color: #9898a8;">New Balance</p>
    <p style="margin: 0; font-size: 36px; font-weight: 700; color: #22c55e;">
        ${balance:.2f}
    </p>
</div>
        """

    def _render_team_invite(
        self,
        name: str,
        context: dict[str, Any],
        h1: str,
        p_main: str,
        p_small: str,
    ) -> str:
        """Render team invite email content."""
        inviter = context.get("inviter_name", "Someone")
        team = context.get("team_name", "their team")
        purple = "color: #8B5CF6;"
        return f"""
<h1 style="{h1}">You've been invited to join a team</h1>
<p style="{p_main}">
    Hi {name}, <strong style="{purple}">{inviter}</strong> has invited you
    to join <strong style="{purple}">{team}</strong> on Podex.
</p>
<p style="{p_small}">This invitation will expire in 7 days.</p>
        """

    def _render_session_shared(
        self,
        name: str,
        context: dict[str, Any],
        h1: str,
        p_main: str,
        box: str,
    ) -> str:
        """Render session shared email content."""
        sharer = context.get("sharer_name", "Someone")
        session = context.get("session_name", "Untitled")
        desc = context.get("session_description", "")
        purple = "color: #8B5CF6;"
        desc_html = ""
        if desc:
            desc_html = f'<p style="margin: 8px 0 0; font-size: 14px; color: #5c5c6e;">{desc}</p>'
        return f"""
<h1 style="{h1}">A session has been shared with you</h1>
<p style="{p_main}">
    Hi {name}, <strong style="{purple}">{sharer}</strong> has shared
    the session "<strong>{session}</strong>" with you.
</p>
<div style="{box}">
    <p style="margin: 0 0 8px; font-size: 14px; color: #9898a8;">Session</p>
    <p style="margin: 0; font-size: 18px; font-weight: 600; color: #f0f0f5;">
        {session}
    </p>
    {desc_html}
</div>
        """

    def _render_platform_invite(
        self,
        name: str,
        context: dict[str, Any],
        h1: str,
        p_main: str,
        p_small: str,
        box_gradient: str,
        box_purple: str,
    ) -> str:
        """Render platform invitation email content."""
        inviter = context.get("inviter_name", "The Podex team")
        message = context.get("message", "")
        gift_plan_name = context.get("gift_plan_name")
        gift_months = context.get("gift_months")
        expires_days = context.get("expires_days", 7)
        purple = "color: #8B5CF6;"

        # Build gift section if subscription is being gifted
        gift_section = ""
        if gift_plan_name and gift_months:
            month_word = "month" if gift_months == 1 else "months"
            gift_section = f"""
<div style="{box_purple}">
    <p style="margin: 0 0 8px; font-size: 14px; color: #9898a8;">Included Gift</p>
    <p style="margin: 0; font-size: 20px; font-weight: 600; color: #8B5CF6;">
        {gift_months} {month_word} of {gift_plan_name}
    </p>
    <p style="margin: 8px 0 0; font-size: 14px; color: #5c5c6e;">
        Start coding with full access from day one
    </p>
</div>
"""

        # Build personal message section if provided
        message_section = ""
        if message:
            message_section = f"""
<div style="background: rgba(255, 255, 255, 0.03); border-left: 3px solid #8B5CF6; padding: 16px; margin: 24px 0; border-radius: 4px;">
    <p style="margin: 0; font-size: 14px; color: #9898a8; font-style: italic;">
        "{message}"
    </p>
    <p style="margin: 8px 0 0 0; font-size: 13px; color: #5c5c6e;">
        — {inviter}
    </p>
</div>
"""

        # Use the recipient's name for a personalized greeting
        greeting = f"Hi {name}," if name else "Hi there,"

        return f"""
<p style="margin: 0 0 16px; font-size: 16px; color: #f0f0f5;">{greeting}</p>
<h1 style="{h1}">You're invited to join Podex</h1>
<p style="{p_main}">
    <strong style="{purple}">{inviter}</strong> has invited you to join Podex,
    the AI-powered development platform that brings intelligent coding agents,
    cloud workspaces, and powerful tools together in one place.
</p>
{message_section}
{gift_section}
<div style="{box_gradient}">
    <p style="margin: 0 0 12px; font-size: 16px; font-weight: 600; color: #f0f0f5;">
        What you can do with Podex:
    </p>
    <p style="margin: 0 0 8px; font-size: 14px; color: #9898a8;">
        • Create cloud development workspaces in seconds
    </p>
    <p style="margin: 0 0 8px; font-size: 14px; color: #9898a8;">
        • Use AI agents to help with coding and debugging
    </p>
    <p style="margin: 0 0 8px; font-size: 14px; color: #9898a8;">
        • Collaborate in real-time with your team
    </p>
    <p style="margin: 0; font-size: 14px; color: #9898a8;">
        • Access your projects from anywhere
    </p>
</div>
<p style="{p_small}">This invitation will expire in {expires_days} days.</p>
        """

    def _render_waitlist_confirmation(
        self,
        _name: str,
        context: dict[str, Any],
        h1: str,
        p_main: str,
        box_gradient: str,
        box_purple: str,
    ) -> str:
        """Render waitlist confirmation email content."""
        position = context.get("position")
        purple = "color: #8B5CF6;"

        # Build position section if we have a position
        position_section = ""
        if position:
            position_section = f"""
<div style="{box_purple} text-align: center;">
    <p style="margin: 0 0 8px; font-size: 14px; color: #9898a8;">Your position</p>
    <p style="margin: 0; font-size: 48px; font-weight: 700; {purple}">
        #{position}
    </p>
    <p style="margin: 8px 0 0; font-size: 14px; color: #5c5c6e;">
        We'll notify you when it's your turn
    </p>
</div>
"""

        return f"""
<h1 style="{h1}">You're on the list!</h1>
<p style="{p_main}">
    Thanks for your interest in Podex. We're building something special and
    can't wait to share it with you.
</p>
{position_section}
<div style="{box_gradient}">
    <p style="margin: 0 0 12px; font-size: 16px; font-weight: 600; color: #f0f0f5;">
        What's coming:
    </p>
    <p style="margin: 0 0 8px; font-size: 14px; color: #9898a8;">
        • AI agents that code alongside you
    </p>
    <p style="margin: 0 0 8px; font-size: 14px; color: #9898a8;">
        • Cloud workspaces accessible from anywhere
    </p>
    <p style="margin: 0 0 8px; font-size: 14px; color: #9898a8;">
        • Mobile-first development experience
    </p>
    <p style="margin: 0; font-size: 14px; color: #9898a8;">
        • Real-time collaboration with your team
    </p>
</div>
<p style="margin: 0; font-size: 14px; color: #5c5c6e;">
    We'll send you an invitation as soon as a spot opens up.
</p>
        """

    def _get_cta_button(self, template: EmailTemplate, context: dict[str, Any]) -> str:
        """Get the call-to-action button for a template."""
        base = settings.FRONTEND_URL
        billing = f"{base}/settings/billing"
        invoice_url = context.get("invoice_url", billing)

        cta_map = {
            EmailTemplate.WELCOME: ("Get Started", f"{base}/dashboard"),
            EmailTemplate.EMAIL_VERIFICATION: (
                "Verify Email",
                context.get("verification_url", "#"),
            ),
            EmailTemplate.PASSWORD_RESET: ("Reset Password", context.get("reset_url", "#")),
            EmailTemplate.PASSWORD_CHANGED: ("Go to Settings", f"{base}/settings/security"),
            EmailTemplate.SUBSCRIPTION_CREATED: ("View Dashboard", f"{base}/dashboard"),
            EmailTemplate.PAYMENT_RECEIVED: ("View Invoice", invoice_url),
            EmailTemplate.PAYMENT_FAILED: ("Update Payment Method", billing),
            EmailTemplate.USAGE_WARNING: ("Upgrade Plan", f"{billing}/plans"),
            EmailTemplate.USAGE_LIMIT_REACHED: ("Upgrade Now", f"{billing}/plans"),
            EmailTemplate.CREDITS_LOW: ("Add Credits", f"{billing}/credits"),
            EmailTemplate.CREDITS_ADDED: ("View Balance", f"{billing}/credits"),
            EmailTemplate.TEAM_INVITE: ("Accept Invite", context.get("invite_url", "#")),
            EmailTemplate.SESSION_SHARED: ("Open Session", context.get("session_url", "#")),
            EmailTemplate.PLATFORM_INVITE: (
                "Accept Invitation",
                context.get("invite_url", "#"),
            ),
            EmailTemplate.WAITLIST_CONFIRMATION: (
                "Learn More",
                f"{base}/",
            ),
        }

        if template not in cta_map:
            return ""

        text, url = cta_map[template]
        btn_bg = "background: linear-gradient(135deg, #8B5CF6, #7C3AED);"
        btn_style = (
            "display: inline-block; padding: 16px 32px; font-size: 16px; "
            "font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;"
        )
        return f"""
            <table cellpadding="0" cellspacing="0" border="0" style="margin: 32px 0;">
                <tr>
                    <td style="border-radius: 8px; {btn_bg}">
                        <a href="{url}" target="_blank" style="{btn_style}">
                            {text}
                        </a>
                    </td>
                </tr>
            </table>
        """

    def _get_footer_text(self, template: EmailTemplate) -> str:
        """Get footer text for a template."""
        security_templates = {
            EmailTemplate.PASSWORD_RESET,
            EmailTemplate.PASSWORD_CHANGED,
            EmailTemplate.ACCOUNT_DEACTIVATED,
        }

        if template in security_templates:
            return (
                "This is a security notification. "
                "If you didn't make this request, please contact support immediately."
            )

        return "You're receiving this email because you have a Podex account."

    def _get_text_content(self, template: EmailTemplate, context: dict[str, Any]) -> str:
        """Get plain text content for a template."""
        name = context.get("name", "there")
        frontend_url = settings.FRONTEND_URL

        text_map = {
            EmailTemplate.WELCOME: f"""
Welcome to Podex, {name}!

You've just joined the future of software development. Podex is your AI-powered
IDE that brings intelligent agents, cloud workspaces, and powerful tools
together in one place.

Here's what you can do:
- Create cloud development workspaces in seconds
- Use AI agents to help with coding, debugging, and deployment
- Collaborate in real-time with your team
- Access your projects from anywhere

Get started: {frontend_url}/dashboard

--
The Podex Team
""",
            EmailTemplate.EMAIL_VERIFICATION: f"""
Verify your email address

Hi {name}, please click the link below to verify your email address:

{context.get("verification_url", "#")}

This link will expire in 24 hours.

If you didn't create a Podex account, you can safely ignore this email.

--
The Podex Team
""",
            EmailTemplate.PASSWORD_RESET: f"""
Reset your password

Hi {name}, we received a request to reset your password.

Click this link to reset your password:
{context.get("reset_url", "#")}

This link will expire in 1 hour.

If you didn't request this, please ignore this email.

--
The Podex Team
""",
            EmailTemplate.PAYMENT_RECEIVED: f"""
Payment received - Thank you!

Hi {name}, we've received your payment of ${context.get("amount", 0):.2f}.

Date: {context.get("date", "Today")}
Amount: ${context.get("amount", 0):.2f}
Invoice #: {context.get("invoice_number", "N/A")}

View invoice: {context.get("invoice_url", f"{frontend_url}/settings/billing")}

--
The Podex Team
""",
        }

        # Handle USAGE_WARNING separately to avoid line length issues
        percent = context.get("percent", 80)
        quota_type = context.get("quota_type", "monthly")
        current = context.get("current_usage", 0)
        limit = context.get("limit", 0)
        unit = context.get("unit", "tokens")

        text_map[EmailTemplate.USAGE_WARNING] = f"""
Usage Alert: {percent}% of your quota used

Hi {name}, you've used {percent}% of your {quota_type} quota.

{current:,} / {limit:,} {unit}

Consider upgrading your plan to avoid service interruption:
{frontend_url}/settings/billing/plans

--
The Podex Team
"""

        # Handle PLATFORM_INVITE separately for readability
        inviter = context.get("inviter_name", "The Podex team")
        invite_url = context.get("invite_url", f"{frontend_url}/register")
        message = context.get("message", "")
        gift_plan_name = context.get("gift_plan_name")
        gift_months = context.get("gift_months")
        expires_days = context.get("expires_days", 7)

        gift_text = ""
        if gift_plan_name and gift_months:
            month_word = "month" if gift_months == 1 else "months"
            gift_text = f"\n\nIncluded Gift: {gift_months} {month_word} of {gift_plan_name}\n"

        message_text = ""
        if message:
            message_text = f'\n\n"{message}"\n— {inviter}\n'

        text_map[EmailTemplate.PLATFORM_INVITE] = f"""
You're invited to join Podex

{inviter} has invited you to join Podex, the AI-powered development platform.
{message_text}{gift_text}
What you can do with Podex:
- Create cloud development workspaces in seconds
- Use AI agents to help with coding and debugging
- Collaborate in real-time with your team
- Access your projects from anywhere

Accept your invitation: {invite_url}

This invitation will expire in {expires_days} days.

--
The Podex Team
"""

        # Handle WAITLIST_CONFIRMATION
        waitlist_position = context.get("position")
        position_text = f"\nYour position: #{waitlist_position}\n" if waitlist_position else ""

        text_map[EmailTemplate.WAITLIST_CONFIRMATION] = f"""
You're on the Podex waitlist!

Thanks for your interest in Podex. We're building something special and
can't wait to share it with you.
{position_text}
What's coming:
- AI agents that code alongside you
- Cloud workspaces accessible from anywhere
- Mobile-first development experience
- Real-time collaboration with your team

We'll send you an invitation as soon as a spot opens up.

Learn more: {frontend_url}/

--
The Podex Team
"""

        return text_map.get(template, f"Hi {name},\n\n--\nThe Podex Team")


# Base HTML email template with Podex branding
BASE_HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="dark">
    <meta name="supported-color-schemes" content="dark">
    <title>Podex</title>
    <!--[if mso]>
    <noscript>
        <xml>
            <o:OfficeDocumentSettings>
                <o:PixelsPerInch>96</o:PixelsPerInch>
            </o:OfficeDocumentSettings>
        </xml>
    </noscript>
    <![endif]-->
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@800&display=swap');

        :root {{
            color-scheme: dark;
            supported-color-schemes: dark;
        }}

        body {{
            margin: 0;
            padding: 0;
            background-color: #07070a;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
                'Helvetica Neue', Arial, sans-serif;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }}

        .wrapper {{
            width: 100%;
            background-color: #07070a;
            padding: 40px 0;
        }}

        .container {{
            max-width: 600px;
            margin: 0 auto;
            padding: 0 20px;
        }}

        .card {{
            background-color: #0d0d12;
            border: 1px solid #1e1e26;
            border-radius: 16px;
            overflow: hidden;
        }}

        .header {{
            background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(6, 182, 212, 0.1));
            padding: 32px;
            text-align: center;
            border-bottom: 1px solid #1e1e26;
        }}

        .logo {{
            text-align: center;
        }}

        .content {{
            padding: 40px 32px;
        }}

        .footer {{
            padding: 24px 32px;
            border-top: 1px solid #1e1e26;
            text-align: center;
        }}

        .footer-links {{
            margin-bottom: 16px;
        }}

        .footer-links a {{
            color: #9898a8;
            text-decoration: none;
            margin: 0 12px;
            font-size: 13px;
        }}

        .footer-links a:hover {{
            color: #8B5CF6;
        }}

        .footer-text {{
            color: #5c5c6e;
            font-size: 12px;
            line-height: 1.5;
        }}

        .preheader {{
            display: none !important;
            visibility: hidden;
            mso-hide: all;
            font-size: 1px;
            line-height: 1px;
            max-height: 0;
            max-width: 0;
            opacity: 0;
            overflow: hidden;
        }}

        @media only screen and (max-width: 600px) {{
            .container {{
                padding: 0 12px;
            }}

            .content {{
                padding: 24px 20px;
            }}

            .header {{
                padding: 24px 20px;
            }}

            .footer {{
                padding: 20px;
            }}
        }}
    </style>
</head>
<body>
    <span class="preheader">{preheader}</span>

    <div class="wrapper">
        <div class="container">
            <div class="card">
                <div class="header">
                    <div class="logo">
                        <img src="{logo_url}" alt="Podex" width="48" height="48" style="width: 48px; height: 48px; border-radius: 8px; margin-bottom: 8px;" />
                        <div style="font-family: 'Orbitron', sans-serif; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; color: #ffffff;">Podex</div>
                    </div>
                </div>

                <div class="content">
                    {body_content}
                    {cta_button}
                </div>

                <div class="footer">
                    <div class="footer-links">
                        <a href="https://podex.dev">Website</a>
                        <a href="https://podex.dev/docs">Documentation</a>
                        <a href="https://podex.dev/support">Support</a>
                        <a href="{unsubscribe_url}">Email Preferences</a>
                    </div>
                    <p class="footer-text">
                        {footer_text}<br>
                        &copy; {current_year} Podex. All rights reserved.
                    </p>
                </div>
            </div>
        </div>
    </div>
</body>
</html>
"""


@lru_cache
def get_email_service() -> EmailService:
    """Get the email service singleton."""
    return EmailService()
