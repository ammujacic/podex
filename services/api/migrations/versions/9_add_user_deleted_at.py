"""Add deleted_at field to users table for soft delete support.

Revision ID: 9
Revises: 8
Create Date: 2026-02-01

This migration adds the deleted_at field to track when accounts are deleted.
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "9"
down_revision: str | None = "8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add deleted_at column to users table."""
    conn = op.get_bind()

    # Check if column already exists
    result = conn.execute(
        sa.text(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'users' AND column_name = 'deleted_at'
            """
        )
    )
    if result.fetchone():
        # Column already exists, skip
        return

    op.add_column(
        "users",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    """Remove deleted_at column from users table."""
    op.drop_column("users", "deleted_at")
