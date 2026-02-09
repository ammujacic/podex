"""Add workspace image fields to workspace_servers.

These fields allow per-server configuration of workspace container images,
replacing the environment variable-based configuration in the compute service.

Revision ID: 7
Revises: 6
Create Date: 2026-02-01

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7"
down_revision: str | None = "6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Default image for all servers
DEFAULT_WORKSPACE_IMAGE = "ghcr.io/mujacica/workspace:latest"


def upgrade() -> None:
    """Add workspace image columns to workspace_servers."""
    conn = op.get_bind()

    # Check if column already exists
    result = conn.execute(
        sa.text(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'workspace_servers' AND column_name = 'workspace_image'
            """
        )
    )
    if result.fetchone():
        # Column already exists, skip
        return

    # Add workspace_image as nullable first
    op.add_column(
        "workspace_servers",
        sa.Column("workspace_image", sa.String(500), nullable=True),
    )

    # Add optional architecture-specific image columns
    op.add_column(
        "workspace_servers",
        sa.Column("workspace_image_arm64", sa.String(500), nullable=True),
    )
    op.add_column(
        "workspace_servers",
        sa.Column("workspace_image_amd64", sa.String(500), nullable=True),
    )
    op.add_column(
        "workspace_servers",
        sa.Column("workspace_image_gpu", sa.String(500), nullable=True),
    )

    # Backfill existing servers with default image
    op.execute(
        f"UPDATE workspace_servers SET workspace_image = '{DEFAULT_WORKSPACE_IMAGE}' WHERE workspace_image IS NULL"
    )

    # Make workspace_image non-nullable
    op.alter_column(
        "workspace_servers",
        "workspace_image",
        nullable=False,
    )


def downgrade() -> None:
    """Remove workspace image columns from workspace_servers."""
    op.drop_column("workspace_servers", "workspace_image_gpu")
    op.drop_column("workspace_servers", "workspace_image_amd64")
    op.drop_column("workspace_servers", "workspace_image_arm64")
    op.drop_column("workspace_servers", "workspace_image")
