"""Add provider field to usage_records table.

This field stores the LLM provider (anthropic, openai, etc.) directly on the
usage record instead of deriving it from the model name. This enables accurate
analytics grouping by provider without hardcoded model name patterns.

Revision ID: 14
Revises: 13
Create Date: 2026-02-02

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "14"
down_revision: str | None = "13"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def column_exists(table_name: str, column_name: str) -> bool:
    """Check if a column already exists in the table."""
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = [col["name"] for col in inspector.get_columns(table_name)]
    return column_name in columns


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
    """Add provider column to usage_records table."""
    # Add provider column (skip if already exists from create_all)
    if not column_exists("usage_records", "provider"):
        op.add_column(
            "usage_records",
            sa.Column("provider", sa.String(50), nullable=True),
        )

    # Create index for provider column (skip if already exists)
    if not index_exists("ix_usage_records_provider"):
        op.create_index(
            "ix_usage_records_provider",
            "usage_records",
            ["provider"],
        )


def downgrade() -> None:
    """Remove provider column from usage_records table."""
    op.drop_index("ix_usage_records_provider", table_name="usage_records")
    op.drop_column("usage_records", "provider")
