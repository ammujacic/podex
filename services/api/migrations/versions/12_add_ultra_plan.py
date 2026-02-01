"""Add Ultra subscription plan tier.

Revision ID: 12
Revises: 11
Create Date: 2026-02-01

This migration adds the Ultra plan ($199/month) for power users and larger teams.
"""

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = "12"
down_revision: str | None = "11"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add Ultra plan if it doesn't exist."""
    conn = op.get_bind()

    # Check if Ultra plan already exists
    result = conn.execute(text("SELECT id FROM subscription_plans WHERE slug = 'ultra'"))
    if result.fetchone():
        # Plan already exists, skip
        return

    # Insert Ultra plan
    conn.execute(
        text(
            """
            INSERT INTO subscription_plans (
                name, slug, description,
                price_monthly_cents, price_yearly_cents, currency,
                tokens_included, compute_credits_cents_included, storage_gb_included,
                max_agents, max_sessions, max_team_members,
                overage_allowed, llm_margin_percent, compute_margin_percent,
                features, color, icon, cta_text, highlight_features,
                session_timeout_options, max_thinking_tokens,
                workspace_cpu_limit, workspace_memory_limit, workspace_disk_limit,
                max_session_duration_minutes,
                is_active, is_popular, is_enterprise, sort_order
            ) VALUES (
                'Ultra', 'ultra', 'For power users and larger teams',
                19900, 199000, 'USD',
                15000000, 15000, 500,
                50, 150, 50,
                true, 30, 20,
                '{"private_projects": true, "git_integration": true, "team_collaboration": true, "gpu_access": true, "advanced_analytics": true, "audit_logs": true, "custom_agents": true, "priority_support": true, "dedicated_support": true, "sla_guarantee": true, "custom_integrations": true}'::jsonb,
                '#ec4899', 'Gem', 'Go Ultra',
                '["15M tokens/month", "50 AI agents", "150 concurrent sessions", "Dedicated support", "99.9% SLA"]'::jsonb,
                ARRAY[15, 30, 60, 120, NULL]::integer[],
                64000,
                8000, 16384, 200,
                NULL,
                true, false, false, 3
            )
            """
        )
    )


def downgrade() -> None:
    """Remove Ultra plan."""
    conn = op.get_bind()
    conn.execute(text("DELETE FROM subscription_plans WHERE slug = 'ultra'"))
