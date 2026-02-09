"""Add compute_service_url to workspace_servers.

This field stores the URL of the compute service that manages this server.
Each regional compute service has its own URL, enabling multi-region deployment.

Revision ID: 5
Revises: 4
Create Date: 2026-01-31

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5"
down_revision: str | None = "4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add compute_service_url column to workspace_servers."""
    conn = op.get_bind()

    # Check if column already exists
    result = conn.execute(
        sa.text(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'workspace_servers' AND column_name = 'compute_service_url'
            """
        )
    )
    if result.fetchone():
        # Column already exists, skip
        return

    # Add column as nullable first
    op.add_column(
        "workspace_servers",
        sa.Column("compute_service_url", sa.String(500), nullable=True),
    )

    # Backfill existing servers with default URL
    op.execute(
        "UPDATE workspace_servers SET compute_service_url = 'http://compute:3003' WHERE compute_service_url IS NULL"
    )

    # Make column non-nullable
    op.alter_column(
        "workspace_servers",
        "compute_service_url",
        nullable=False,
    )


def downgrade() -> None:
    """Remove compute_service_url column from workspace_servers."""
    op.drop_column("workspace_servers", "compute_service_url")
