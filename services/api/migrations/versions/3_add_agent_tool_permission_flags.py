"""Add permission flags to agent_tools table for mode enforcement.

Revision ID: 3
Revises: 2
Create Date: 2026-01-30

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3"
down_revision: str | None = "2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add permission flag columns to agent_tools for agent mode enforcement.

    These flags determine how each tool behaves in different agent modes:
    - is_read_operation: Allowed in Plan mode (read-only)
    - is_write_operation: Requires approval in Ask mode, auto in Auto mode
    - is_command_operation: Requires allowlist or approval in Auto mode
    - is_deploy_operation: Always requires approval (even in Auto mode)
    """
    op.add_column(
        "agent_tools",
        sa.Column("is_read_operation", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.add_column(
        "agent_tools",
        sa.Column("is_write_operation", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "agent_tools",
        sa.Column("is_command_operation", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "agent_tools",
        sa.Column("is_deploy_operation", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    """Remove permission flag columns from agent_tools."""
    op.drop_column("agent_tools", "is_deploy_operation")
    op.drop_column("agent_tools", "is_command_operation")
    op.drop_column("agent_tools", "is_write_operation")
    op.drop_column("agent_tools", "is_read_operation")
