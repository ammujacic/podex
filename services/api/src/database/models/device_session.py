"""Device session models for tracking authenticated devices.

Tracks active sessions across different device types (browser, CLI, mobile, VSCode)
and enables users to view and revoke individual sessions.
"""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, _generate_uuid

if TYPE_CHECKING:
    from .core import User


class DeviceSession(Base):
    """Active device/session tracking for users.

    Each row represents an active authenticated session from a specific device.
    Used for:
    - Displaying active sessions in user settings
    - Allowing users to revoke specific sessions
    - Security monitoring (unusual login locations, devices)
    - Device-specific token management
    """

    __tablename__ = "device_sessions"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Device identification
    device_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # browser, cli, mobile, vscode, api
    device_name: Mapped[str | None] = mapped_column(
        String(255)
    )  # e.g., "Chrome on macOS", "Podex CLI", "iPhone 15"

    # Session tracking
    refresh_token_jti: Mapped[str] = mapped_column(
        String(255), unique=True, nullable=False, index=True
    )  # Links to actual refresh token

    # Client information
    ip_address: Mapped[str | None] = mapped_column(String(45))  # IPv6-safe
    user_agent: Mapped[str | None] = mapped_column(Text)
    # Parsed OS/browser info for display
    os_name: Mapped[str | None] = mapped_column(String(100))  # macOS, Windows, iOS, Android, Linux
    browser_name: Mapped[str | None] = mapped_column(String(100))  # Chrome, Safari, Firefox, etc.

    # Location (optional, from IP geolocation)
    city: Mapped[str | None] = mapped_column(String(100))
    country: Mapped[str | None] = mapped_column(String(100))
    country_code: Mapped[str | None] = mapped_column(String(10))

    # Activity tracking
    last_active_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    last_ip_address: Mapped[str | None] = mapped_column(String(45))

    # Session metadata
    is_current: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )  # Marked on response
    is_revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="device_sessions")

    __table_args__ = (
        # Index for efficient user session lookups
        Index("ix_device_sessions_user_active", "user_id", "is_revoked"),
        # Index for cleanup of expired sessions
        Index("ix_device_sessions_expires_at", "expires_at"),
    )


class DeviceCode(Base):
    """Temporary device codes for CLI/device authentication flow.

    Implements OAuth 2.0 Device Authorization Grant (RFC 8628).
    Used when the device cannot open a browser directly (CLI, TV apps, etc.)

    Flow:
    1. Device requests a device code via POST /api/v1/auth/device/code
    2. User visits verification URL and enters user_code
    3. Device polls POST /api/v1/auth/device/token until authorized
    4. On success, device receives access/refresh tokens
    """

    __tablename__ = "device_codes"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)

    # Device code (secret, used by device to poll)
    device_code: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    # User code (short, shown to user to enter in browser)
    user_code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)

    # Device info (captured at code request time)
    device_type: Mapped[str] = mapped_column(String(50), nullable=False)  # cli, vscode, mobile
    device_name: Mapped[str | None] = mapped_column(String(255))
    ip_address: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(Text)

    # Authorization state
    # pending: waiting for user to authorize
    # authorized: user approved, tokens ready to be issued
    # denied: user denied access
    # expired: code expired before user action
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False, index=True)

    # User who authorized (set when status changes to authorized)
    user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )

    # Polling interval (in seconds) - can be increased if client polls too fast
    interval: Mapped[int] = mapped_column(default=5, nullable=False)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    authorized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Relationship
    user: Mapped["User | None"] = relationship("User")

    __table_args__ = (
        # Index for cleanup of expired codes
        Index("ix_device_codes_expires_at", "expires_at"),
        # Index for pending codes by user_code (user lookup)
        Index("ix_device_codes_user_code_status", "user_code", "status"),
    )
