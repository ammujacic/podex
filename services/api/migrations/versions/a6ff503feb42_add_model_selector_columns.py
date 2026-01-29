"""Add model selector columns to llm_models table

Revision ID: a6ff503feb42
Revises:
Create Date: 2026-01-29

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "a6ff503feb42"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade database schema."""
    # Add is_featured column with index for filtering featured models
    op.add_column(
        "llm_models",
        sa.Column("is_featured", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.create_index("ix_llm_models_is_featured", "llm_models", ["is_featured"])

    # Add display_order for sorting within lists
    op.add_column(
        "llm_models",
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
    )

    # Add categories as JSONB array for category filtering
    op.add_column(
        "llm_models",
        sa.Column("categories", JSONB(), nullable=False, server_default="[]"),
    )

    # Add short_description for model cards
    op.add_column(
        "llm_models",
        sa.Column("short_description", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    """Downgrade database schema."""
    op.drop_column("llm_models", "short_description")
    op.drop_column("llm_models", "categories")
    op.drop_column("llm_models", "display_order")
    op.drop_index("ix_llm_models_is_featured", table_name="llm_models")
    op.drop_column("llm_models", "is_featured")
