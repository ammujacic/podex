"""Add ssh_public_keys column to users table.

Revision ID: 6
Revises: 5
Create Date: 2026-02-01

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "6"
down_revision: str | None = "5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def column_exists(table_name: str, column_name: str) -> bool:
    """Check if a column already exists in the table."""
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = [col["name"] for col in inspector.get_columns(table_name)]
    return column_name in columns


def upgrade() -> None:
    """Add ssh_public_keys JSONB column to users table."""
    if not column_exists("users", "ssh_public_keys"):
        op.add_column(
            "users",
            sa.Column("ssh_public_keys", postgresql.JSONB(), nullable=True),
        )


def downgrade() -> None:
    """Remove ssh_public_keys column from users table."""
    op.drop_column("users", "ssh_public_keys")
