"""Add TLS configuration fields to workspace_servers table.

Revision ID: 1
Revises:
Create Date: 2026-01-30

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add TLS configuration columns to workspace_servers."""
    op.add_column(
        "workspace_servers",
        sa.Column("tls_enabled", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "workspace_servers",
        sa.Column("tls_cert_path", sa.String(500), nullable=True),
    )
    op.add_column(
        "workspace_servers",
        sa.Column("tls_key_path", sa.String(500), nullable=True),
    )
    op.add_column(
        "workspace_servers",
        sa.Column("tls_ca_path", sa.String(500), nullable=True),
    )


def downgrade() -> None:
    """Remove TLS configuration columns from workspace_servers."""
    op.drop_column("workspace_servers", "tls_ca_path")
    op.drop_column("workspace_servers", "tls_key_path")
    op.drop_column("workspace_servers", "tls_cert_path")
    op.drop_column("workspace_servers", "tls_enabled")
