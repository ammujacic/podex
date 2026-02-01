"""Add new platform settings for agent configuration.

Revision ID: 11
Revises: 10
Create Date: 2026-02-01

This migration adds new platform settings that were previously hardcoded:
1. session_defaults: default role, mode, and model fallback role for new sessions
2. forbidden_command_patterns: dangerous patterns blocked from command allowlists
3. special_agent_roles: special role identifiers (agent_builder, orchestrator, etc.)

Note: Tool categories for permission checking are derived from the tools table
(by category field) rather than stored as a separate setting.
"""

import json
from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = "11"
down_revision: str | None = "10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Settings to add
NEW_SETTINGS = [
    {
        "key": "session_defaults",
        "value": {
            "default_role": "chat",
            "default_mode": "auto",
            "model_fallback_role": "coder",
        },
        "description": "Default settings for new sessions (role, mode, fallback role)",
        "category": "agents",
        "is_public": False,
    },
    {
        "key": "forbidden_command_patterns",
        "value": [
            "*",
            "/*",
            "sudo *",
            "rm -rf *",
            "rm -rf /",
            "rm -rf /*",
            "> /dev/*",
            "curl * | *",
            "wget * | *",
            "eval *",
            "exec *",
            "$(*))",
            "`*`",
        ],
        "description": (
            "Dangerous command patterns that should never be allowed in agent command_allowlist. "
            "These patterns could compromise system security if added to an allowlist."
        ),
        "category": "security",
        "is_public": False,
    },
    {
        "key": "special_agent_roles",
        "value": {
            "agent_builder_role": "agent_builder",
            "orchestrator_role": "orchestrator",
            "non_delegatable_roles": ["orchestrator", "agent_builder", "chat"],
        },
        "description": (
            "Special agent role identifiers used for system behavior. "
            "agent_builder_role creates custom agents, orchestrator manages delegation."
        ),
        "category": "agents",
        "is_public": False,
    },
]


def upgrade() -> None:
    """Add new platform settings for agent configuration."""
    conn = op.get_bind()

    for setting in NEW_SETTINGS:
        # Check if setting already exists
        result = conn.execute(
            text("SELECT key FROM platform_settings WHERE key = :key"),
            {"key": setting["key"]},
        )
        if result.fetchone() is None:
            # Insert the setting
            conn.execute(
                text(
                    """
                    INSERT INTO platform_settings (key, value, description, category, is_public)
                    VALUES (:key, :value, :description, :category, :is_public)
                    """
                ),
                {
                    "key": setting["key"],
                    "value": json.dumps(setting["value"]),
                    "description": setting["description"],
                    "category": setting["category"],
                    "is_public": setting["is_public"],
                },
            )


def downgrade() -> None:
    """Remove the new platform settings."""
    conn = op.get_bind()

    for setting in NEW_SETTINGS:
        conn.execute(
            text("DELETE FROM platform_settings WHERE key = :key"),
            {"key": setting["key"]},
        )
