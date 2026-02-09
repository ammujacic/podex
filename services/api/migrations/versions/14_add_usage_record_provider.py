"""Add provider field to usage_records table.

This field stores the LLM provider (anthropic, openai, etc.) directly on the
usage record instead of deriving it from the model name. This enables accurate
analytics grouping by provider without hardcoded model name patterns.

Revision ID: 14
Revises: 13
Create Date: 2026-02-02

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "14"
down_revision: str | None = "13"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add provider column to usage_records table."""
    # Use raw SQL with IF NOT EXISTS to handle concurrent worker migrations
    # The Python-level column_exists check has a race condition when multiple
    # workers run migrations simultaneously
    op.execute(
        "ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS provider VARCHAR(50)"
    )

    # Create index concurrently-safe (IF NOT EXISTS)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_usage_records_provider ON usage_records (provider)"
    )


def downgrade() -> None:
    """Remove provider column from usage_records table."""
    op.drop_index("ix_usage_records_provider", table_name="usage_records")
    op.drop_column("usage_records", "provider")
