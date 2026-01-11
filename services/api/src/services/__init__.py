"""Service modules for the API."""

from src.services.email import EmailService, EmailTemplate, get_email_service

__all__ = [
    "EmailService",
    "EmailTemplate",
    "get_email_service",
]
