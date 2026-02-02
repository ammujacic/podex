"""Cleanup seed data to align prod DB with current state.

Revision ID: 13
Revises: 12
Create Date: 2026-02-01

This migration fixes:
1. OpenRouter model IDs: 4-5 → 4.5 (OpenRouter accepts dots)
2. Direct Anthropic model IDs: 4.5 → 4-5 (Anthropic API requires hyphens)
3. Removes deprecated MCP servers (filesystem, git, web_fetch, puppeteer, github)
   - Only sentry remains as the default MCP server
4. Updates platform_settings that reference old model IDs
"""

from collections.abc import Sequence

from alembic import op
from sqlalchemy import Connection, text

# revision identifiers, used by Alembic.
revision: str = "13"
down_revision: str | None = "12"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# OpenRouter model fixes: 4-5 → 4.5 (OpenRouter uses dots)
OPENROUTER_MODEL_FIXES = [
    ("anthropic/claude-sonnet-4-5", "anthropic/claude-sonnet-4.5"),
    ("anthropic/claude-opus-4-5", "anthropic/claude-opus-4.5"),
    ("anthropic/claude-haiku-4-5", "anthropic/claude-haiku-4.5"),
]

# Direct Anthropic model fixes: 4.5 → 4-5 (Anthropic API uses hyphens)
ANTHROPIC_DIRECT_MODEL_FIXES = [
    ("anthropic-direct/claude-sonnet-4.5", "anthropic-direct/claude-sonnet-4-5"),
    ("anthropic-direct/claude-opus-4.5", "anthropic-direct/claude-opus-4-5"),
    ("anthropic-direct/claude-haiku-4.5", "anthropic-direct/claude-haiku-4-5"),
]

# MCP servers to remove (keep only 'sentry')
DEPRECATED_MCP_SLUGS = [
    "filesystem",
    "git",
    "web_fetch",
    "web-fetch",
    "webfetch",
    "puppeteer",
    "github",
]


def _fix_model_ids(conn: Connection, model_fixes: list[tuple[str, str]]) -> None:
    """Apply model ID fixes, always ensuring only the correct model remains."""
    for old_id, _new_id in model_fixes:
        # Always delete the old (incorrect) model if it exists
        # The correct model will be (re)created by seed scripts if missing
        conn.execute(
            text("DELETE FROM llm_models WHERE model_id = :old_id"),
            {"old_id": old_id},
        )


def upgrade() -> None:
    """Clean up seed data to match current state."""
    conn = op.get_bind()

    # 1. Fix OpenRouter model IDs (4-5 → 4.5)
    _fix_model_ids(conn, OPENROUTER_MODEL_FIXES)

    # 2. Fix Direct Anthropic model IDs (4.5 → 4-5)
    _fix_model_ids(conn, ANTHROPIC_DIRECT_MODEL_FIXES)

    # 3. Remove deprecated MCP servers from default_mcp_servers
    for slug in DEPRECATED_MCP_SLUGS:
        conn.execute(
            text("DELETE FROM default_mcp_servers WHERE slug = :slug"),
            {"slug": slug},
        )

    # 4. Update platform_settings that reference old model IDs
    # These settings use OpenRouter format (with dots)
    conn.execute(
        text("""
            UPDATE platform_settings
            SET value = REPLACE(
                REPLACE(
                    REPLACE(value::text, 'claude-sonnet-4-5', 'claude-sonnet-4.5'),
                    'claude-opus-4-5', 'claude-opus-4.5'
                ),
                'claude-haiku-4-5', 'claude-haiku-4.5'
            )::jsonb
            WHERE key IN ('agent_model_defaults', 'parallel_planning_config')
        """)
    )


def _revert_model_ids(conn: Connection, model_fixes: list[tuple[str, str]]) -> None:
    """Revert model ID fixes (swap old and new)."""
    for old_id, new_id in model_fixes:
        result = conn.execute(
            text("SELECT id FROM llm_models WHERE model_id = :new_id"),
            {"new_id": new_id},
        )
        if result.fetchone():
            conn.execute(
                text("UPDATE llm_models SET model_id = :old_id WHERE model_id = :new_id"),
                {"old_id": old_id, "new_id": new_id},
            )


def downgrade() -> None:
    """Revert model ID changes (not recommended - old format is incorrect)."""
    conn = op.get_bind()

    # Revert OpenRouter model IDs (4.5 → 4-5)
    _revert_model_ids(conn, OPENROUTER_MODEL_FIXES)

    # Revert Direct Anthropic model IDs (4-5 → 4.5)
    _revert_model_ids(conn, ANTHROPIC_DIRECT_MODEL_FIXES)

    # Revert platform_settings
    conn.execute(
        text("""
            UPDATE platform_settings
            SET value = REPLACE(
                REPLACE(
                    REPLACE(value::text, 'claude-sonnet-4.5', 'claude-sonnet-4-5'),
                    'claude-opus-4.5', 'claude-opus-4-5'
                ),
                'claude-haiku-4.5', 'claude-haiku-4-5'
            )::jsonb
            WHERE key IN ('agent_model_defaults', 'parallel_planning_config')
        """)
    )

    # Note: We don't recreate deleted MCP servers in downgrade
    # as that would require full schema data. If needed, re-run seeds.
