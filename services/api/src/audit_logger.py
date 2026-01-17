"""Audit logging service for security and compliance tracking."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime, UTC
from functools import wraps
from typing import Any, Callable
from uuid import uuid4

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import AuditLog

logger = logging.getLogger(__name__)


# ============================================================================
# Audit Categories and Actions
# ============================================================================


class AuditCategory:
    """Audit log categories."""

    AUTH = "auth"
    FILE = "file"
    AGENT = "agent"
    SESSION = "session"
    BILLING = "billing"
    ADMIN = "admin"
    USER = "user"
    INTEGRATION = "integration"


class AuditAction:
    """Audit log actions by category."""

    # Auth
    AUTH_LOGIN = "auth.login"
    AUTH_LOGOUT = "auth.logout"
    AUTH_LOGIN_FAILED = "auth.login_failed"
    AUTH_PASSWORD_CHANGED = "auth.password_changed"
    AUTH_MFA_ENABLED = "auth.mfa_enabled"
    AUTH_MFA_DISABLED = "auth.mfa_disabled"
    AUTH_TOKEN_CREATED = "auth.token_created"
    AUTH_TOKEN_REVOKED = "auth.token_revoked"

    # File operations
    FILE_READ = "file.read"
    FILE_WRITE = "file.write"
    FILE_DELETE = "file.delete"
    FILE_UPLOAD = "file.upload"
    FILE_DOWNLOAD = "file.download"

    # Agent operations
    AGENT_CREATED = "agent.created"
    AGENT_MESSAGE = "agent.message"
    AGENT_TOOL_CALL = "agent.tool_call"
    AGENT_MODE_CHANGED = "agent.mode_changed"
    AGENT_DELETED = "agent.deleted"

    # Session operations
    SESSION_CREATED = "session.created"
    SESSION_DELETED = "session.deleted"
    SESSION_SHARED = "session.shared"
    SESSION_EXPORTED = "session.exported"

    # User operations
    USER_CREATED = "user.created"
    USER_UPDATED = "user.updated"
    USER_DELETED = "user.deleted"
    USER_ROLE_CHANGED = "user.role_changed"

    # Billing operations
    BILLING_SUBSCRIPTION_CREATED = "billing.subscription_created"
    BILLING_SUBSCRIPTION_CHANGED = "billing.subscription_changed"
    BILLING_SUBSCRIPTION_CANCELLED = "billing.subscription_cancelled"
    BILLING_PAYMENT_SUCCEEDED = "billing.payment_succeeded"
    BILLING_PAYMENT_FAILED = "billing.payment_failed"
    # Usage tracking operations (for security auditing)
    BILLING_USAGE_RECORDED = "billing.usage_recorded"
    BILLING_USAGE_REJECTED = "billing.usage_rejected"
    BILLING_CREDIT_DEDUCTED = "billing.credit_deducted"
    BILLING_CREDIT_ADDED = "billing.credit_added"
    BILLING_QUOTA_EXCEEDED = "billing.quota_exceeded"
    BILLING_OVERAGE_CHARGED = "billing.overage_charged"

    # Admin operations
    ADMIN_SETTINGS_CHANGED = "admin.settings_changed"
    ADMIN_MODEL_UPDATED = "admin.model_updated"
    ADMIN_USER_SUSPENDED = "admin.user_suspended"
    ADMIN_DATA_EXPORTED = "admin.data_exported"

    # Integration operations
    INTEGRATION_CONNECTED = "integration.connected"
    INTEGRATION_DISCONNECTED = "integration.disconnected"
    INTEGRATION_ERROR = "integration.error"


class AuditStatus:
    """Audit log status values."""

    SUCCESS = "success"
    FAILURE = "failure"
    DENIED = "denied"


# ============================================================================
# Audit Logger Service
# ============================================================================


class AuditLogger:
    """Service for creating audit log entries."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._request: Request | None = None
        self._user_id: str | None = None
        self._user_email: str | None = None

    def set_context(
        self,
        request: Request | None = None,
        user_id: str | None = None,
        user_email: str | None = None,
    ) -> "AuditLogger":
        """Set request and user context for the logger."""
        self._request = request
        self._user_id = user_id
        self._user_email = user_email
        return self

    async def log(
        self,
        action: str,
        category: str,
        *,
        resource_type: str | None = None,
        resource_id: str | None = None,
        status: str = AuditStatus.SUCCESS,
        details: dict[str, Any] | None = None,
        changes: dict[str, Any] | None = None,
        session_id: str | None = None,
        user_id: str | None = None,
        user_email: str | None = None,
    ) -> AuditLog:
        """Create an audit log entry."""
        # Use provided values or fall back to context
        resolved_user_id = user_id or self._user_id
        resolved_user_email = user_email or self._user_email

        # Extract request context
        ip_address = None
        user_agent = None
        request_id = None
        request_path = None
        request_method = None

        if self._request:
            # Get client IP (handle proxied requests)
            forwarded_for = self._request.headers.get("X-Forwarded-For")
            if forwarded_for:
                ip_address = forwarded_for.split(",")[0].strip()
            else:
                ip_address = self._request.client.host if self._request.client else None

            user_agent = self._request.headers.get("User-Agent")
            request_id = self._request.headers.get("X-Request-ID") or str(uuid4())
            request_path = str(self._request.url.path)
            request_method = self._request.method

        # Create log entry
        audit_log = AuditLog(
            id=str(uuid4()),
            user_id=resolved_user_id,
            user_email=resolved_user_email,
            session_id=session_id,
            action=action,
            category=category,
            resource_type=resource_type,
            resource_id=resource_id,
            status=status,
            details=details,
            changes=changes,
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
            request_path=request_path,
            request_method=request_method,
            created_at=datetime.now(UTC),
        )

        self.db.add(audit_log)
        await self.db.commit()

        logger.debug(
            f"Audit: {action} by {resolved_user_email or 'anonymous'} "
            f"- {status} ({resource_type}:{resource_id})"
        )

        return audit_log

    # Convenience methods for common operations

    async def log_auth(
        self,
        action: str,
        status: str = AuditStatus.SUCCESS,
        details: dict[str, Any] | None = None,
        **kwargs,
    ) -> AuditLog:
        """Log an authentication event."""
        return await self.log(
            action=action,
            category=AuditCategory.AUTH,
            resource_type="user",
            status=status,
            details=details,
            **kwargs,
        )

    async def log_file_operation(
        self,
        action: str,
        file_path: str,
        session_id: str | None = None,
        status: str = AuditStatus.SUCCESS,
        details: dict[str, Any] | None = None,
        **kwargs,
    ) -> AuditLog:
        """Log a file operation."""
        return await self.log(
            action=action,
            category=AuditCategory.FILE,
            resource_type="file",
            resource_id=file_path,
            session_id=session_id,
            status=status,
            details=details,
            **kwargs,
        )

    async def log_agent_event(
        self,
        action: str,
        agent_id: str,
        session_id: str,
        status: str = AuditStatus.SUCCESS,
        details: dict[str, Any] | None = None,
        **kwargs,
    ) -> AuditLog:
        """Log an agent event."""
        return await self.log(
            action=action,
            category=AuditCategory.AGENT,
            resource_type="agent",
            resource_id=agent_id,
            session_id=session_id,
            status=status,
            details=details,
            **kwargs,
        )

    async def log_session_event(
        self,
        action: str,
        session_id: str,
        status: str = AuditStatus.SUCCESS,
        details: dict[str, Any] | None = None,
        **kwargs,
    ) -> AuditLog:
        """Log a session event."""
        return await self.log(
            action=action,
            category=AuditCategory.SESSION,
            resource_type="session",
            resource_id=session_id,
            session_id=session_id,
            status=status,
            details=details,
            **kwargs,
        )

    async def log_admin_action(
        self,
        action: str,
        resource_type: str | None = None,
        resource_id: str | None = None,
        status: str = AuditStatus.SUCCESS,
        details: dict[str, Any] | None = None,
        changes: dict[str, Any] | None = None,
        **kwargs,
    ) -> AuditLog:
        """Log an admin action."""
        return await self.log(
            action=action,
            category=AuditCategory.ADMIN,
            resource_type=resource_type,
            resource_id=resource_id,
            status=status,
            details=details,
            changes=changes,
            **kwargs,
        )


# ============================================================================
# Helpers and Decorators
# ============================================================================


def get_audit_logger(db: AsyncSession) -> AuditLogger:
    """Factory function to create an audit logger."""
    return AuditLogger(db)


@asynccontextmanager
async def audit_context(
    db: AsyncSession,
    request: Request | None = None,
    user_id: str | None = None,
    user_email: str | None = None,
):
    """Context manager for audit logging with request/user context."""
    audit = AuditLogger(db)
    audit.set_context(request=request, user_id=user_id, user_email=user_email)
    yield audit


def audit_log(
    action: str,
    category: str,
    resource_type: str | None = None,
    get_resource_id: Callable[..., str | None] | None = None,
    get_details: Callable[..., dict[str, Any] | None] | None = None,
):
    """Decorator to automatically log route calls.

    Usage:
        @router.post("/users")
        @audit_log(AuditAction.USER_CREATED, AuditCategory.USER, "user")
        async def create_user(...):
            ...
    """

    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Try to extract db, request, and user from kwargs
            db: AsyncSession | None = kwargs.get("db")
            request: Request | None = kwargs.get("request")
            user: dict | None = kwargs.get("user")

            result = None
            status = AuditStatus.SUCCESS
            error_details = None

            try:
                result = await func(*args, **kwargs)
                return result
            except Exception as e:
                status = AuditStatus.FAILURE
                error_details = {"error": str(e), "error_type": type(e).__name__}
                raise
            finally:
                # Log the action if we have a database session
                if db is not None:
                    try:
                        audit = AuditLogger(db)
                        audit.set_context(
                            request=request,
                            user_id=user.get("id") if user else None,
                            user_email=user.get("email") if user else None,
                        )

                        resource_id = None
                        if get_resource_id:
                            try:
                                resource_id = get_resource_id(result, *args, **kwargs)
                            except Exception:
                                pass

                        details = error_details
                        if get_details and details is None:
                            try:
                                details = get_details(result, *args, **kwargs)
                            except Exception:
                                pass

                        await audit.log(
                            action=action,
                            category=category,
                            resource_type=resource_type,
                            resource_id=resource_id,
                            status=status,
                            details=details,
                        )
                    except Exception as log_error:
                        logger.error(f"Failed to create audit log: {log_error}")

        return wrapper

    return decorator
