"""
Unit tests for email service.

Tests email sending with mocked SMTP backend.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.services.email import EmailResult, EmailService, EmailTemplate


@pytest.mark.unit
@pytest.mark.asyncio
async def test_email_service_initialization():
    """Test email service initializes correctly."""
    service = EmailService()
    assert service is not None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_send_welcome_email():
    """Test sending welcome email."""
    service = EmailService()

    with patch.object(service, "_send_console") as mock_console:
        mock_console.return_value = EmailResult(success=True, message_id="test-123")

        result = await service.send_email(
            to_email="test@example.com",
            template=EmailTemplate.WELCOME,
            context={"user_name": "Test User", "frontend_url": "http://localhost:3000"},
        )

        assert result.success is True
        mock_console.assert_called_once()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_send_email_verification():
    """Test sending email verification."""
    service = EmailService()

    with patch.object(service, "_send_console") as mock_console:
        mock_console.return_value = EmailResult(success=True, message_id="test-456")

        result = await service.send_email(
            to_email="verify@example.com",
            template=EmailTemplate.EMAIL_VERIFICATION,
            context={
                "user_name": "Test User",
                "verification_url": "http://localhost:3000/verify",
                "frontend_url": "http://localhost:3000",
            },
        )

        assert result.success is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_send_password_reset_email():
    """Test sending password reset email."""
    service = EmailService()

    with patch.object(service, "_send_console") as mock_console:
        mock_console.return_value = EmailResult(success=True, message_id="test-789")

        result = await service.send_email(
            to_email="reset@example.com",
            template=EmailTemplate.PASSWORD_RESET,
            context={
                "user_name": "Test User",
                "reset_url": "http://localhost:3000/reset",
                "frontend_url": "http://localhost:3000",
            },
        )

        assert result.success is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_send_subscription_created_email():
    """Test sending subscription created email."""
    service = EmailService()

    with patch.object(service, "_send_console") as mock_console:
        mock_console.return_value = EmailResult(success=True, message_id="test-sub")

        result = await service.send_email(
            to_email="subscriber@example.com",
            template=EmailTemplate.SUBSCRIPTION_CREATED,
            context={
                "user_name": "Test User",
                "plan_name": "Pro",
                "billing_amount": "$29.00",
                "frontend_url": "http://localhost:3000",
            },
        )

        assert result.success is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_send_payment_received_email():
    """Test sending payment received email."""
    service = EmailService()

    with patch.object(service, "_send_console") as mock_console:
        mock_console.return_value = EmailResult(success=True, message_id="test-payment")

        result = await service.send_email(
            to_email="payment@example.com",
            template=EmailTemplate.PAYMENT_RECEIVED,
            context={
                "name": "Test User",
                "amount": 29.00,  # Numeric value for formatting
                "invoice_url": "http://localhost:3000/invoice/123",
                "frontend_url": "http://localhost:3000",
            },
        )

        assert result.success is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_send_email_with_cc_bcc():
    """Test sending email with CC and BCC."""
    service = EmailService()

    with patch.object(service, "_send_console") as mock_console:
        mock_console.return_value = EmailResult(success=True, message_id="test-cc-bcc")

        result = await service.send_email(
            to_email="primary@example.com",
            template=EmailTemplate.TEAM_INVITE,
            context={
                "inviter_name": "Admin User",
                "team_name": "Test Team",
                "invite_url": "http://localhost:3000/invite",
                "frontend_url": "http://localhost:3000",
            },
            cc=["cc@example.com"],
            bcc=["bcc@example.com"],
        )

        assert result.success is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_send_email_failure():
    """Test email sending failure."""
    service = EmailService()

    with patch.object(service, "_send_console") as mock_console:
        mock_console.return_value = EmailResult(success=False, error="SMTP connection failed")

        result = await service.send_email(
            to_email="fail@example.com",
            template=EmailTemplate.WELCOME,
            context={"user_name": "Test", "frontend_url": "http://localhost:3000"},
        )

        assert result.success is False
        assert result.error == "SMTP connection failed"


@pytest.mark.unit
def test_get_subject():
    """Test email subject generation."""
    service = EmailService()

    # Test various templates
    subject = service._get_subject(EmailTemplate.WELCOME, {"user_name": "Test User"})
    assert "Welcome" in subject

    subject = service._get_subject(EmailTemplate.PASSWORD_RESET, {})
    assert "Password" in subject or "Reset" in subject


@pytest.mark.unit
def test_render_html():
    """Test HTML email rendering."""
    service = EmailService()

    html = service._render_html(
        EmailTemplate.WELCOME,
        {
            "name": "Test User",  # Templates use 'name', not 'user_name'
            "frontend_url": "http://localhost:3000",
        },
    )

    assert isinstance(html, str)
    assert len(html) > 0
    # Should contain user name (templates greet with "Welcome to Podex, {name}!")
    assert "Test User" in html


@pytest.mark.unit
def test_render_text():
    """Test plain text email rendering."""
    service = EmailService()

    text = service._render_text(
        EmailTemplate.WELCOME,
        {
            "name": "Test User",  # Templates use 'name', not 'user_name'
            "frontend_url": "http://localhost:3000",
        },
    )

    assert isinstance(text, str)
    assert len(text) > 0
    # Plain text should contain user name (templates greet with "Welcome to Podex, {name}!")
    assert "Test User" in text
