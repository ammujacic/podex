"""Update plan features to remove falsely gated features and fix priority_support.

Revision ID: 8
Revises: 7
Create Date: 2026-02-01

This migration:
1. Removes agent_memory, planning_mode, vision_analysis from all plan features
   (these are now available to everyone, not plan-gated)
2. Fixes Max plan's priority_support from False to True
3. Updates highlight_features to reflect the changes
"""

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = "8"
down_revision: str | None = "7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Remove falsely gated features and fix priority_support."""
    conn = op.get_bind()

    # Remove deprecated feature flags from all plans
    # These features are now available to everyone
    deprecated_features = ["agent_memory", "planning_mode", "vision_analysis"]

    for feature in deprecated_features:
        conn.execute(
            text(
                f"""
                UPDATE subscription_plans
                SET features = features - '{feature}'
                WHERE features ? '{feature}'
                """
            )
        )

    # Fix Max plan's priority_support to True
    conn.execute(
        text(
            """
            UPDATE subscription_plans
            SET features = jsonb_set(features, '{priority_support}', 'true')
            WHERE slug = 'max'
            """
        )
    )

    # Update Pro plan's highlight_features to remove "Agent memory & context"
    conn.execute(
        text(
            """
            UPDATE subscription_plans
            SET highlight_features = ARRAY['1M tokens/month', '5 AI agents', 'Private projects', 'Custom agent templates', 'Email support']
            WHERE slug = 'pro'
            """
        )
    )

    # Update Max plan's highlight_features to include "Priority support"
    conn.execute(
        text(
            """
            UPDATE subscription_plans
            SET highlight_features = ARRAY['5M tokens/month', '20 AI agents', 'GPU access', 'Audit logs', 'Priority support']
            WHERE slug = 'max'
            """
        )
    )


def downgrade() -> None:
    """Revert to old feature flags (not recommended)."""
    conn = op.get_bind()

    # Re-add deprecated features to Free plan (as False)
    conn.execute(
        text(
            """
            UPDATE subscription_plans
            SET features = features || '{"agent_memory": false, "planning_mode": false, "vision_analysis": false}'::jsonb
            WHERE slug = 'free'
            """
        )
    )

    # Re-add deprecated features to Pro plan (as True)
    conn.execute(
        text(
            """
            UPDATE subscription_plans
            SET features = features || '{"agent_memory": true, "planning_mode": true, "vision_analysis": true}'::jsonb
            WHERE slug = 'pro'
            """
        )
    )

    # Re-add deprecated features to Max plan (as True) and set priority_support back to False
    conn.execute(
        text(
            """
            UPDATE subscription_plans
            SET features = features || '{"agent_memory": true, "planning_mode": true, "vision_analysis": true, "priority_support": false}'::jsonb
            WHERE slug = 'max'
            """
        )
    )

    # Revert Pro plan's highlight_features
    conn.execute(
        text(
            """
            UPDATE subscription_plans
            SET highlight_features = ARRAY['1M tokens/month', '5 AI agents', 'Agent memory & context', 'Custom agent templates', 'Email support']
            WHERE slug = 'pro'
            """
        )
    )

    # Revert Max plan's highlight_features
    conn.execute(
        text(
            """
            UPDATE subscription_plans
            SET highlight_features = ARRAY['5M tokens/month', '20 AI agents', 'GPU access', 'Audit logs', '200 GB storage']
            WHERE slug = 'max'
            """
        )
    )
