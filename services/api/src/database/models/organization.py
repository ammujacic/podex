"""Organization models for enterprise/team accounts and billing."""

from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, _generate_uuid

if TYPE_CHECKING:
    from .billing import SubscriptionPlan
    from .core import User


# Default blocked email domains for auto-join (personal email providers)
DEFAULT_BLOCKED_EMAIL_DOMAINS = [
    "gmail.com",
    "yahoo.com",
    "hotmail.com",
    "outlook.com",
    "aol.com",
    "icloud.com",
    "live.com",
    "msn.com",
    "protonmail.com",
    "proton.me",
    "zoho.com",
    "yandex.com",
    "mail.com",
    "gmx.com",
    "fastmail.com",
]


class Organization(Base):
    """Organization model for enterprise/team accounts."""

    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)

    # Billing configuration
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)

    # Credit model: "pooled", "allocated", "usage_based"
    credit_model: Mapped[str] = mapped_column(String(50), default="pooled", nullable=False)

    # Organization-level credit pool (in cents)
    credit_pool_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    credit_pool_limit_cents: Mapped[int | None] = mapped_column(Integer)  # Optional hard limit

    # Domain-based auto-join settings
    auto_join_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    auto_join_domains: Mapped[list[str] | None] = mapped_column(ARRAY(String(255)))
    auto_join_default_role: Mapped[str] = mapped_column(
        String(50), default="member", nullable=False
    )

    # Blocked email domains for invites/auto-join (personal email providers)
    blocked_email_domains: Mapped[list[str]] = mapped_column(
        ARRAY(String(255)),
        default=DEFAULT_BLOCKED_EMAIL_DOMAINS,
        nullable=False,
    )

    # Default resource limits for new members
    default_spending_limit_cents: Mapped[int | None] = mapped_column(Integer)
    default_allowed_models: Mapped[list[str] | None] = mapped_column(JSONB)
    default_allowed_instance_types: Mapped[list[str] | None] = mapped_column(JSONB)
    default_storage_limit_gb: Mapped[int | None] = mapped_column(Integer)
    default_feature_access: Mapped[dict[str, bool] | None] = mapped_column(JSONB)

    # Organization status
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

    # Branding and metadata
    logo_url: Mapped[str | None] = mapped_column(Text)
    website: Mapped[str | None] = mapped_column(String(500))
    settings: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    # Onboarding tracking
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    onboarding_step: Mapped[str | None] = mapped_column(String(50))  # Current step in wizard

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
    members: Mapped[list["OrganizationMember"]] = relationship(
        "OrganizationMember",
        back_populates="organization",
        cascade="all, delete-orphan",
    )
    invitations: Mapped[list["OrganizationInvitation"]] = relationship(
        "OrganizationInvitation",
        back_populates="organization",
        cascade="all, delete-orphan",
    )
    invite_links: Mapped[list["OrganizationInviteLink"]] = relationship(
        "OrganizationInviteLink",
        back_populates="organization",
        cascade="all, delete-orphan",
    )
    subscriptions: Mapped[list["OrganizationSubscription"]] = relationship(
        "OrganizationSubscription",
        back_populates="organization",
    )
    usage_records: Mapped[list["OrganizationUsageRecord"]] = relationship(
        "OrganizationUsageRecord",
        back_populates="organization",
    )
    credit_transactions: Mapped[list["OrganizationCreditTransaction"]] = relationship(
        "OrganizationCreditTransaction",
        back_populates="organization",
    )

    __table_args__ = (
        CheckConstraint(
            "credit_model IN ('pooled', 'allocated', 'usage_based')",
            name="ck_organization_credit_model",
        ),
    )


class OrganizationMember(Base):
    """Organization membership linking users to organizations."""

    __tablename__ = "organization_members"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,  # User can only belong to one organization
        index=True,
    )

    # Role: "owner", "admin", "member"
    role: Mapped[str] = mapped_column(String(50), default="member", nullable=False, index=True)

    # Individual resource controls (overrides org defaults if set)
    spending_limit_cents: Mapped[int | None] = mapped_column(Integer)
    current_spending_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # For "allocated" credit model - pre-allocated credits
    allocated_credits_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    used_credits_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Resource restrictions (NULL = use org defaults)
    allowed_models: Mapped[list[str] | None] = mapped_column(JSONB)
    allowed_instance_types: Mapped[list[str] | None] = mapped_column(JSONB)
    storage_limit_gb: Mapped[int | None] = mapped_column(Integer)
    feature_access: Mapped[dict[str, bool] | None] = mapped_column(JSONB)

    # Blocking status
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    blocked_reason: Mapped[str | None] = mapped_column(Text)
    blocked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Billing period tracking (for usage-based model)
    billing_period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    billing_period_spending_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    joined_at: Mapped[datetime] = mapped_column(
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
    organization: Mapped["Organization"] = relationship("Organization", back_populates="members")
    user: Mapped["User"] = relationship("User", back_populates="organization_member")

    __table_args__ = (
        CheckConstraint("role IN ('owner', 'admin', 'member')", name="ck_org_member_role"),
    )


class OrganizationInvitation(Base):
    """Email invitations to join an organization."""

    __tablename__ = "organization_invitations"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(50), default="member", nullable=False)

    # Invitation token for email link
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)

    # Who sent the invitation
    invited_by_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="SET NULL"),
    )

    # Status: "pending", "accepted", "expired", "revoked"
    status: Mapped[str] = mapped_column(String(50), default="pending", nullable=False, index=True)

    # Custom message for the invitation
    message: Mapped[str | None] = mapped_column(Text)

    # Pre-configured resource limits
    spending_limit_cents: Mapped[int | None] = mapped_column(Integer)
    allocated_credits_cents: Mapped[int | None] = mapped_column(Integer)
    allowed_models: Mapped[list[str] | None] = mapped_column(JSONB)
    allowed_instance_types: Mapped[list[str] | None] = mapped_column(JSONB)

    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization", back_populates="invitations"
    )
    invited_by: Mapped["User | None"] = relationship("User")

    __table_args__ = (
        UniqueConstraint("organization_id", "email", name="uq_org_invitation_email"),
        CheckConstraint(
            "status IN ('pending', 'accepted', 'expired', 'revoked')",
            name="ck_org_invitation_status",
        ),
    )


class OrganizationInviteLink(Base):
    """Shareable invite links for organizations."""

    __tablename__ = "organization_invite_links"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Link code (short, shareable)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)

    # Human-readable name for the link
    name: Mapped[str | None] = mapped_column(String(255))

    # Role assigned to users who join via this link
    role: Mapped[str] = mapped_column(String(50), default="member", nullable=False)

    # Usage limits
    max_uses: Mapped[int | None] = mapped_column(Integer)  # NULL = unlimited
    current_uses: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Pre-configured resource limits for users joining via this link
    spending_limit_cents: Mapped[int | None] = mapped_column(Integer)
    allocated_credits_cents: Mapped[int | None] = mapped_column(Integer)

    # Status
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

    created_by_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="SET NULL"),
    )

    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization", back_populates="invite_links"
    )
    created_by: Mapped["User | None"] = relationship("User")


class OrganizationSubscription(Base):
    """Organization-level subscription (replaces individual user subscriptions)."""

    __tablename__ = "organization_subscriptions"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    plan_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("subscription_plans.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # Status: active, canceled, past_due, trialing, paused
    status: Mapped[str] = mapped_column(String(50), default="active", nullable=False, index=True)

    billing_cycle: Mapped[str] = mapped_column(String(20), default="monthly", nullable=False)
    current_period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    current_period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Seat-based pricing
    seat_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    price_per_seat_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Cancellation
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancellation_reason: Mapped[str | None] = mapped_column(Text)

    # Stripe integration
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)

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
    organization: Mapped["Organization"] = relationship(
        "Organization", back_populates="subscriptions"
    )
    plan: Mapped["SubscriptionPlan"] = relationship("SubscriptionPlan")


class OrganizationUsageRecord(Base):
    """Usage tracking at organization level with user attribution."""

    __tablename__ = "organization_usage_records"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )

    # Usage details (same structure as UsageRecord)
    usage_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit: Mapped[str] = mapped_column(String(20), nullable=False)
    total_cost_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Context
    model: Mapped[str | None] = mapped_column(String(100))
    tier: Mapped[str | None] = mapped_column(String(50))
    session_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), index=True)

    # Snapshot fields - preserve entity names at time of recording for historical accuracy
    # These are populated when the record is created and never updated (even on rename)
    user_name: Mapped[str | None] = mapped_column(String(255))
    user_email: Mapped[str | None] = mapped_column(String(255))
    session_name: Mapped[str | None] = mapped_column(String(255))

    # Billing period
    billing_period_start: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True
    )
    billing_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Additional metadata
    record_metadata: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization", back_populates="usage_records"
    )
    user: Mapped["User | None"] = relationship("User")


class OrganizationCreditTransaction(Base):
    """Credit transactions at organization level."""

    __tablename__ = "organization_credit_transactions"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )

    # Transaction details
    # Positive for credits added, negative for usage
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    transaction_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    # Types: purchase, allocation, usage, refund, adjustment, transfer_in, transfer_out
    description: Mapped[str] = mapped_column(String(500), nullable=False)

    # Balance tracking
    pool_balance_after_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    user_balance_after_cents: Mapped[int | None] = mapped_column(Integer)  # For allocated model

    # Reference
    reference_type: Mapped[str | None] = mapped_column(String(50))
    reference_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False))

    # Stripe integration
    stripe_payment_intent_id: Mapped[str | None] = mapped_column(String(255), index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization", back_populates="credit_transactions"
    )
    user: Mapped["User | None"] = relationship("User")


class OrganizationInvoice(Base):
    """Invoice model for organization billing records."""

    __tablename__ = "organization_invoices"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    subscription_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("organization_subscriptions.id", ondelete="SET NULL"),
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

    # Status: draft, open, paid, void, uncollectible
    status: Mapped[str] = mapped_column(String(50), default="draft", nullable=False, index=True)

    # Line items (JSONB for flexibility)
    line_items: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list, nullable=False)

    # Period
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Payment info
    due_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    payment_method: Mapped[str | None] = mapped_column(String(50))

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

    # Relationships
    organization: Mapped["Organization"] = relationship("Organization")
    subscription: Mapped["OrganizationSubscription | None"] = relationship(
        "OrganizationSubscription"
    )
