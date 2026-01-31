"""Add device_sessions and device_codes tables for device authentication.

Revision ID: 4
Revises: 3
Create Date: 2026-01-31

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "4"
down_revision: str | None = "3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def table_exists(table_name: str) -> bool:
    """Check if a table already exists in the database."""
    bind = op.get_bind()
    inspector = inspect(bind)
    return table_name in inspector.get_table_names()


def index_exists(index_name: str) -> bool:
    """Check if an index already exists."""
    bind = op.get_bind()
    inspector = inspect(bind)
    for table_name in inspector.get_table_names():
        indexes = inspector.get_indexes(table_name)
        if any(idx["name"] == index_name for idx in indexes):
            return True
    return False


def upgrade() -> None:
    """Create device_sessions and device_codes tables."""
    # Create device_sessions table (skip if already exists from create_all)
    if not table_exists("device_sessions"):
        op.create_table(
            "device_sessions",
            sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=False), nullable=False),
            sa.Column("device_type", sa.String(50), nullable=False),
            sa.Column("device_name", sa.String(255), nullable=True),
            sa.Column("refresh_token_jti", sa.String(255), nullable=False),
            sa.Column("ip_address", sa.String(45), nullable=True),
            sa.Column("user_agent", sa.Text(), nullable=True),
            sa.Column("os_name", sa.String(100), nullable=True),
            sa.Column("browser_name", sa.String(100), nullable=True),
            sa.Column("city", sa.String(100), nullable=True),
            sa.Column("country", sa.String(100), nullable=True),
            sa.Column("country_code", sa.String(10), nullable=True),
            sa.Column(
                "last_active_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.Column("last_ip_address", sa.String(45), nullable=True),
            sa.Column("is_current", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("is_revoked", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        )

    # Create indexes (skip if they already exist)
    if not index_exists("ix_device_sessions_user_id"):
        op.create_index("ix_device_sessions_user_id", "device_sessions", ["user_id"])
    if not index_exists("ix_device_sessions_refresh_token_jti"):
        op.create_index(
            "ix_device_sessions_refresh_token_jti",
            "device_sessions",
            ["refresh_token_jti"],
            unique=True,
        )
    if not index_exists("ix_device_sessions_user_active"):
        op.create_index(
            "ix_device_sessions_user_active",
            "device_sessions",
            ["user_id", "is_revoked"],
        )
    if not index_exists("ix_device_sessions_expires_at"):
        op.create_index(
            "ix_device_sessions_expires_at",
            "device_sessions",
            ["expires_at"],
        )

    # Create device_codes table (skip if already exists from create_all)
    if not table_exists("device_codes"):
        op.create_table(
            "device_codes",
            sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
            sa.Column("device_code", sa.String(255), nullable=False),
            sa.Column("user_code", sa.String(20), nullable=False),
            sa.Column("device_type", sa.String(50), nullable=False),
            sa.Column("device_name", sa.String(255), nullable=True),
            sa.Column("ip_address", sa.String(45), nullable=True),
            sa.Column("user_agent", sa.Text(), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
            sa.Column("user_id", postgresql.UUID(as_uuid=False), nullable=True),
            sa.Column("interval", sa.Integer(), nullable=False, server_default="5"),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("authorized_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        )

    # Create indexes (skip if they already exist)
    if not index_exists("ix_device_codes_device_code"):
        op.create_index(
            "ix_device_codes_device_code",
            "device_codes",
            ["device_code"],
            unique=True,
        )
    if not index_exists("ix_device_codes_user_code"):
        op.create_index(
            "ix_device_codes_user_code",
            "device_codes",
            ["user_code"],
            unique=True,
        )
    if not index_exists("ix_device_codes_status"):
        op.create_index("ix_device_codes_status", "device_codes", ["status"])
    if not index_exists("ix_device_codes_user_id"):
        op.create_index("ix_device_codes_user_id", "device_codes", ["user_id"])
    if not index_exists("ix_device_codes_expires_at"):
        op.create_index("ix_device_codes_expires_at", "device_codes", ["expires_at"])
    if not index_exists("ix_device_codes_user_code_status"):
        op.create_index(
            "ix_device_codes_user_code_status",
            "device_codes",
            ["user_code", "status"],
        )


def downgrade() -> None:
    """Remove device_sessions and device_codes tables."""
    op.drop_table("device_codes")
    op.drop_table("device_sessions")
