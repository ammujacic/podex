"""Add model and tier restriction fields to organization_invite_links table.

Revision ID: 2
Revises: 1
Create Date: 2026-01-30

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "2"
down_revision: str | None = "1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add model and tier restriction columns to organization_invite_links."""
    op.add_column(
        "organization_invite_links",
        sa.Column("allowed_models", JSONB(), nullable=True),
    )
    op.add_column(
        "organization_invite_links",
        sa.Column("allowed_instance_types", JSONB(), nullable=True),
    )


def downgrade() -> None:
    """Remove model and tier restriction columns from organization_invite_links."""
    op.drop_column("organization_invite_links", "allowed_instance_types")
    op.drop_column("organization_invite_links", "allowed_models")
