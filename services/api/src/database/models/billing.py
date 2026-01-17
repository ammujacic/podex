"""Billing models: SubscriptionPlan, UserSubscription, UsageRecord, Invoice, etc."""

from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, _generate_uuid

if TYPE_CHECKING:
    from .core import User


class SubscriptionPlan(Base):
    """Subscription plan model defining available plans and pricing."""

    __tablename__ = "subscription_plans"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)

    # Pricing (stored as cents to avoid floating point issues)
    price_monthly_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    price_yearly_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)

    # Included allowances (monthly)
    tokens_included: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    compute_credits_cents_included: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    storage_gb_included: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Limits
    max_agents: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    max_sessions: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    max_team_members: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    # Overage rates (stored as cents per unit)
    overage_token_rate_cents: Mapped[int] = mapped_column(Integer, default=0)  # Per 1000 tokens
    overage_compute_rate_cents: Mapped[int] = mapped_column(Integer, default=0)  # Per hour
    overage_storage_rate_cents: Mapped[int] = mapped_column(Integer, default=0)  # Per GB/month
    overage_allowed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Margin percentages (internal - not exposed to users)
    # Applied on top of base provider costs to calculate final user pricing
    # Values represent percentages, e.g., 20 = 20%
    llm_margin_percent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    compute_margin_percent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Features (JSONB for flexibility)
    features: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)

    # Display settings
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    is_popular: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_enterprise: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Stripe integration (for future)
    stripe_price_id_monthly: Mapped[str | None] = mapped_column(String(255))
    stripe_price_id_yearly: Mapped[str | None] = mapped_column(String(255))
    stripe_product_id: Mapped[str | None] = mapped_column(String(255))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    subscriptions: Mapped[list["UserSubscription"]] = relationship(
        "UserSubscription",
        back_populates="plan",
    )


class UserSubscription(Base):
    """User subscription model tracking active subscriptions."""

    __tablename__ = "user_subscriptions"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    plan_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("subscription_plans.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # Status
    status: Mapped[str] = mapped_column(
        String(50),
        default="active",
        nullable=False,
        index=True,
    )  # active, canceled, past_due, trialing, paused, incomplete

    # Billing cycle: "monthly" or "yearly"
    billing_cycle: Mapped[str] = mapped_column(String(20), default="monthly", nullable=False)
    current_period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    current_period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Cancellation
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancellation_reason: Mapped[str | None] = mapped_column(Text)

    # Trial
    trial_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    trial_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Stripe integration (for future)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255), index=True)

    # Metadata
    subscription_metadata: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    user: Mapped["User"] = relationship("User")
    plan: Mapped["SubscriptionPlan"] = relationship(
        "SubscriptionPlan",
        back_populates="subscriptions",
    )


class UsageRecord(Base):
    """Usage record model for tracking billable usage."""

    __tablename__ = "usage_records"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)

    # Idempotency key to prevent duplicate event processing
    # Format: "{user_id}:{event_id}" - ensures same event is only recorded once
    idempotency_key: Mapped[str | None] = mapped_column(
        String(200),
        unique=True,
        nullable=True,
        index=True,
    )

    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    session_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="SET NULL"),
        index=True,
    )
    workspace_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("workspaces.id", ondelete="SET NULL"),
        index=True,
    )
    agent_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("agents.id", ondelete="SET NULL"),
        index=True,
    )

    # Usage type and quantity
    usage_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
    )  # tokens_input, tokens_output, compute_seconds, storage_gb, api_calls
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)  # Amount in base units
    unit: Mapped[str] = mapped_column(String(20), nullable=False)  # tokens, seconds, bytes, calls

    # Pricing (stored as cents)
    unit_price_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Base cost is what we pay providers (internal tracking)
    base_cost_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Total cost is what user pays (base + margin)
    total_cost_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Context
    model: Mapped[str | None] = mapped_column(String(100))  # For token usage
    tier: Mapped[str | None] = mapped_column(String(50))  # For compute usage

    # Billing period reference
    billing_period_start: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        index=True,
    )
    billing_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Whether this was charged or within included allowance
    is_overage: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Additional metadata
    record_metadata: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )


class UsageQuota(Base):
    """Usage quota model for tracking limits and current usage."""

    __tablename__ = "usage_quotas"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Quota type
    quota_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
    )  # tokens, compute_hours, storage_gb, api_calls, sessions, agents

    # Limits
    limit_value: Mapped[int] = mapped_column(Integer, nullable=False)
    current_usage: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Reset timing
    reset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_reset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Overage settings
    overage_allowed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    overage_rate_cents: Mapped[int | None] = mapped_column(Integer)  # Price per unit over limit
    hard_limit: Mapped[int | None] = mapped_column(Integer)  # Absolute maximum (even with overage)

    # Alert thresholds
    warning_threshold_percent: Mapped[int] = mapped_column(Integer, default=80, nullable=False)
    warning_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Unique constraint: one quota per type per user
    __table_args__ = (UniqueConstraint("user_id", "quota_type", name="uq_usage_quotas_user_type"),)


class CreditTransaction(Base):
    """Credit transaction model for tracking credit purchases and usage."""

    __tablename__ = "credit_transactions"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Transaction details
    # Positive for credits, negative for usage
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)
    transaction_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
    )  # purchase, bonus, referral, refund, usage, expiry, subscription_credit
    description: Mapped[str] = mapped_column(String(500), nullable=False)

    # Reference to what caused this transaction
    # usage_record, invoice, subscription
    reference_type: Mapped[str | None] = mapped_column(String(50))
    reference_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False))

    # Stripe integration
    stripe_payment_intent_id: Mapped[str | None] = mapped_column(String(255), index=True)
    stripe_charge_id: Mapped[str | None] = mapped_column(String(255))

    # Expiration (for promotional credits)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    expired: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Running balance after this transaction
    balance_after_cents: Mapped[int] = mapped_column(Integer, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )


class CreditBalance(Base):
    """Credit balance model for quick balance lookups."""

    __tablename__ = "credit_balances"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    # Current balance (in cents)
    balance_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Pending balance (credits being processed)
    pending_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Credits expiring soon (next 30 days)
    expiring_soon_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Lifetime stats
    total_purchased_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_used_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_bonus_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    last_updated: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Invoice(Base):
    """Invoice model for billing records."""

    __tablename__ = "invoices"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    subscription_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("user_subscriptions.id", ondelete="SET NULL"),
        index=True,
    )

    # Invoice number (human readable)
    invoice_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)

    # Amounts (in cents)
    subtotal_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    discount_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tax_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)

    # Status
    status: Mapped[str] = mapped_column(
        String(50),
        default="draft",
        nullable=False,
        index=True,
    )  # draft, open, paid, void, uncollectible

    # Line items (JSONB for flexibility)
    line_items: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list, nullable=False)

    # Period
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Payment info
    due_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    payment_method: Mapped[str | None] = mapped_column(String(50))  # card, bank_transfer, credits

    # Stripe integration
    stripe_invoice_id: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)
    stripe_payment_intent_id: Mapped[str | None] = mapped_column(String(255))

    # PDF storage
    pdf_url: Mapped[str | None] = mapped_column(Text)

    # Notes
    notes: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class BillingEvent(Base):
    """Billing event audit log model."""

    __tablename__ = "billing_events"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Event type
    event_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )  # subscription_created, payment_succeeded, quota_exceeded, etc.

    # Event data (full context)
    event_data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)

    # Request context (for audit trail)
    ip_address: Mapped[str | None] = mapped_column(String(45))  # IPv6 compatible
    user_agent: Mapped[str | None] = mapped_column(Text)
    request_id: Mapped[str | None] = mapped_column(String(100))

    # Stripe event ID for idempotency (indexed for fast lookups)
    stripe_event_id: Mapped[str | None] = mapped_column(
        String(100),
        unique=True,
        nullable=True,
        index=True,
    )

    # Related entities
    subscription_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    invoice_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    transaction_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )


class HardwareSpec(Base):
    """Hardware specification model for available compute tiers."""

    __tablename__ = "hardware_specs"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    tier: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    # Hardware specifications
    architecture: Mapped[str] = mapped_column(String(20), nullable=False)  # x86_64, arm64
    vcpu: Mapped[int] = mapped_column(Integer, nullable=False)
    memory_mb: Mapped[int] = mapped_column(Integer, nullable=False)

    # GPU specifications
    gpu_type: Mapped[str | None] = mapped_column(String(50))  # t4, a10g, a100_40gb, etc.
    gpu_memory_gb: Mapped[int | None] = mapped_column(Integer)
    gpu_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Compute routing flags (admin-configurable)
    # is_gpu: Whether this tier has GPU/accelerator hardware
    # requires_gke: Whether this tier requires GKE (Cloud Run doesn't support GPUs)
    is_gpu: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    requires_gke: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Storage limits
    storage_gb_default: Mapped[int] = mapped_column(Integer, default=20, nullable=False)
    storage_gb_max: Mapped[int] = mapped_column(Integer, default=100, nullable=False)

    # Pricing (cents per hour)
    hourly_rate_cents: Mapped[int] = mapped_column(Integer, nullable=False)

    # Availability
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    # Minimum plan slug required
    requires_subscription: Mapped[str | None] = mapped_column(String(50))

    # Region availability (JSONB array of region codes)
    region_availability: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)

    # GCP/Cloud specifics
    machine_type: Mapped[str | None] = mapped_column(String(50))
    cpu_millicores: Mapped[int | None] = mapped_column(Integer)

    # Display order
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class UserBudget(Base):
    """User budget settings for cost control."""

    __tablename__ = "user_budgets"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    daily_budget_cents: Mapped[int | None] = mapped_column(Integer)
    monthly_budget_cents: Mapped[int | None] = mapped_column(Integer)
    session_default_budget_cents: Mapped[int | None] = mapped_column(Integer)
    alert_threshold_percent: Mapped[int] = mapped_column(Integer, default=80, nullable=False)
    hard_limit_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class SessionBudget(Base):
    """Per-session budget settings."""

    __tablename__ = "session_budgets"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    budget_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    spent_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    alert_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class CostAlert(Base):
    """Cost alert history for audit."""

    __tablename__ = "cost_alerts"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    session_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="SET NULL"),
        index=True,
    )
    alert_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # budget_warning, budget_exceeded, daily_limit, monthly_limit
    threshold_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    actual_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    dismissed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )
