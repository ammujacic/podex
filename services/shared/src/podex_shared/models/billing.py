"""Billing models shared across services."""

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class SubscriptionPlanType(str, Enum):
    """Subscription plan types."""

    FREE = "free"
    STARTER = "starter"
    PRO = "pro"
    TEAM = "team"
    ENTERPRISE = "enterprise"


class SubscriptionStatus(str, Enum):
    """Subscription status."""

    ACTIVE = "active"
    CANCELED = "canceled"
    PAST_DUE = "past_due"
    TRIALING = "trialing"
    PAUSED = "paused"
    INCOMPLETE = "incomplete"


class UsageType(str, Enum):
    """Types of billable usage."""

    TOKENS_INPUT = "tokens_input"
    TOKENS_OUTPUT = "tokens_output"
    COMPUTE_SECONDS = "compute_seconds"
    STORAGE_GB = "storage_gb"
    API_CALLS = "api_calls"


class CreditTransactionType(str, Enum):
    """Types of credit transactions."""

    PURCHASE = "purchase"
    BONUS = "bonus"
    REFERRAL = "referral"
    REFUND = "refund"
    USAGE = "usage"
    EXPIRY = "expiry"
    SUBSCRIPTION_CREDIT = "subscription_credit"


class BillingEventType(str, Enum):
    """Types of billing events for audit log."""

    SUBSCRIPTION_CREATED = "subscription_created"
    SUBSCRIPTION_UPDATED = "subscription_updated"
    SUBSCRIPTION_CANCELED = "subscription_canceled"
    SUBSCRIPTION_RENEWED = "subscription_renewed"
    PAYMENT_SUCCEEDED = "payment_succeeded"
    PAYMENT_FAILED = "payment_failed"
    CREDITS_PURCHASED = "credits_purchased"
    CREDITS_USED = "credits_used"
    CREDITS_EXPIRED = "credits_expired"
    QUOTA_WARNING = "quota_warning"
    QUOTA_EXCEEDED = "quota_exceeded"
    INVOICE_CREATED = "invoice_created"
    INVOICE_PAID = "invoice_paid"
    REFUND_ISSUED = "refund_issued"
    PLAN_UPGRADED = "plan_upgraded"
    PLAN_DOWNGRADED = "plan_downgraded"


class InvoiceStatus(str, Enum):
    """Invoice status."""

    DRAFT = "draft"
    OPEN = "open"
    PAID = "paid"
    VOID = "void"
    UNCOLLECTIBLE = "uncollectible"


# Pydantic models for API


class SubscriptionPlanInfo(BaseModel):
    """Subscription plan information."""

    id: str
    name: str
    slug: str
    description: str | None = None
    price_monthly: Decimal
    price_yearly: Decimal

    # Included allowances
    tokens_included: int  # Monthly token allowance
    storage_gb_included: int  # Storage included

    # Limits
    max_agents: int
    max_sessions: int
    max_team_members: int

    # Features
    features: dict[str, Any] = Field(default_factory=dict)

    # Display
    is_popular: bool = False
    is_enterprise: bool = False
    sort_order: int = 0

    model_config = {"from_attributes": True}


class SubscriptionInfo(BaseModel):
    """User subscription information."""

    id: str
    user_id: str
    plan: SubscriptionPlanInfo
    status: SubscriptionStatus
    current_period_start: datetime
    current_period_end: datetime
    cancel_at_period_end: bool = False
    canceled_at: datetime | None = None
    trial_end: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class UsageRecordInfo(BaseModel):
    """Usage record information."""

    id: str
    user_id: str
    session_id: str | None = None
    workspace_id: str | None = None
    agent_id: str | None = None
    usage_type: UsageType
    quantity: Decimal
    unit: str
    unit_price: Decimal
    total_cost: Decimal
    model: str | None = None  # For token usage
    tier: str | None = None  # For compute usage
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime

    model_config = {"from_attributes": True}


class UsageSummary(BaseModel):
    """Usage summary for a period."""

    period_start: datetime
    period_end: datetime

    # Token usage
    tokens_input: int = 0
    tokens_output: int = 0
    tokens_total: int = 0
    tokens_cost: Decimal = Decimal("0")

    # Compute usage
    compute_seconds: int = 0
    compute_hours: float = 0.0
    compute_cost: Decimal = Decimal("0")

    # Storage usage
    storage_gb: float = 0.0
    storage_cost: Decimal = Decimal("0")

    # API usage
    api_calls: int = 0

    # Totals
    total_cost: Decimal = Decimal("0")

    # Breakdown by model
    usage_by_model: dict[str, dict[str, Any]] = Field(default_factory=dict)

    # Breakdown by agent
    usage_by_agent: dict[str, dict[str, Any]] = Field(default_factory=dict)

    # Breakdown by session
    usage_by_session: dict[str, dict[str, Any]] = Field(default_factory=dict)


class QuotaInfo(BaseModel):
    """Quota/limit information."""

    id: str
    user_id: str
    quota_type: str
    limit_value: int
    current_usage: int
    usage_percentage: float
    reset_at: datetime | None = None
    overage_allowed: bool = False
    overage_rate: Decimal | None = None
    hard_limit: int | None = None
    is_exceeded: bool = False
    is_warning: bool = False  # > 80% usage

    model_config = {"from_attributes": True}


class CreditBalanceInfo(BaseModel):
    """Credit balance information."""

    user_id: str
    balance: Decimal
    pending_balance: Decimal = Decimal("0")  # Credits being processed
    expires_soon: Decimal = Decimal("0")  # Credits expiring in 30 days
    last_updated: datetime


class CreditTransactionInfo(BaseModel):
    """Credit transaction information."""

    id: str
    user_id: str
    amount: Decimal
    currency: str = "USD"
    transaction_type: CreditTransactionType
    description: str
    expires_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class InvoiceInfo(BaseModel):
    """Invoice information."""

    id: str
    user_id: str
    invoice_number: str
    amount: Decimal
    currency: str = "USD"
    status: InvoiceStatus
    line_items: list[dict[str, Any]] = Field(default_factory=list)
    period_start: datetime
    period_end: datetime
    due_date: datetime
    paid_at: datetime | None = None
    pdf_url: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class BillingEventInfo(BaseModel):
    """Billing event for audit log."""

    id: str
    user_id: str
    event_type: BillingEventType
    event_data: dict[str, Any] = Field(default_factory=dict)
    ip_address: str | None = None
    user_agent: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# Request/Response models


class CreateSubscriptionRequest(BaseModel):
    """Request to create a subscription."""

    plan_id: str
    billing_cycle: str = "monthly"  # monthly or yearly
    promotion_code: str | None = None


class UpdateSubscriptionRequest(BaseModel):
    """Request to update a subscription."""

    plan_id: str | None = None
    cancel_at_period_end: bool | None = None


class PurchaseCreditsRequest(BaseModel):
    """Request to purchase credits."""

    amount: Decimal
    payment_method_id: str | None = None  # For Stripe integration later


class UsageHistoryRequest(BaseModel):
    """Request for usage history."""

    start_date: datetime | None = None
    end_date: datetime | None = None
    usage_type: UsageType | None = None
    session_id: str | None = None
    agent_id: str | None = None
    page: int = 1
    page_size: int = 50


# Model pricing configuration


class ModelPricing(BaseModel):
    """Pricing for an LLM model."""

    model_id: str
    display_name: str
    provider: str
    input_price_per_million: Decimal
    output_price_per_million: Decimal
    is_available: bool = True


# Predefined model pricing (can be loaded from config/database)
MODEL_PRICING: dict[str, ModelPricing] = {
    "claude-opus-4-5-20251101": ModelPricing(
        model_id="claude-opus-4-5-20251101",
        display_name="Claude Opus 4.5",
        provider="anthropic",
        input_price_per_million=Decimal("15.00"),
        output_price_per_million=Decimal("75.00"),
    ),
    "claude-sonnet-4-20250514": ModelPricing(
        model_id="claude-sonnet-4-20250514",
        display_name="Claude Sonnet 4",
        provider="anthropic",
        input_price_per_million=Decimal("3.00"),
        output_price_per_million=Decimal("15.00"),
    ),
    "claude-3-5-haiku-20241022": ModelPricing(
        model_id="claude-3-5-haiku-20241022",
        display_name="Claude 3.5 Haiku",
        provider="anthropic",
        input_price_per_million=Decimal("0.25"),
        output_price_per_million=Decimal("1.25"),
    ),
    "gpt-4o": ModelPricing(
        model_id="gpt-4o",
        display_name="GPT-4o",
        provider="openai",
        input_price_per_million=Decimal("2.50"),
        output_price_per_million=Decimal("10.00"),
    ),
    "gpt-4o-mini": ModelPricing(
        model_id="gpt-4o-mini",
        display_name="GPT-4o Mini",
        provider="openai",
        input_price_per_million=Decimal("0.15"),
        output_price_per_million=Decimal("0.60"),
    ),
    "gpt-4-turbo": ModelPricing(
        model_id="gpt-4-turbo",
        display_name="GPT-4 Turbo",
        provider="openai",
        input_price_per_million=Decimal("10.00"),
        output_price_per_million=Decimal("30.00"),
    ),
    "gemini-2.0-flash": ModelPricing(
        model_id="gemini-2.0-flash",
        display_name="Gemini 2.0 Flash",
        provider="google",
        input_price_per_million=Decimal("0.075"),
        output_price_per_million=Decimal("0.30"),
    ),
    "gemini-1.5-pro": ModelPricing(
        model_id="gemini-1.5-pro",
        display_name="Gemini 1.5 Pro",
        provider="google",
        input_price_per_million=Decimal("1.25"),
        output_price_per_million=Decimal("5.00"),
    ),
    "deepseek-chat": ModelPricing(
        model_id="deepseek-chat",
        display_name="DeepSeek Chat",
        provider="deepseek",
        input_price_per_million=Decimal("0.14"),
        output_price_per_million=Decimal("0.28"),
    ),
    "deepseek-reasoner": ModelPricing(
        model_id="deepseek-reasoner",
        display_name="DeepSeek Reasoner",
        provider="deepseek",
        input_price_per_million=Decimal("0.55"),
        output_price_per_million=Decimal("2.19"),
    ),
}


def calculate_token_cost(
    model_id: str,
    input_tokens: int,
    output_tokens: int,
) -> Decimal:
    """Calculate the cost for token usage."""
    pricing = MODEL_PRICING.get(model_id)
    if not pricing:
        # Default to Claude Sonnet pricing if model not found
        pricing = MODEL_PRICING["claude-sonnet-4-20250514"]

    input_cost = (Decimal(input_tokens) / Decimal("1000000")) * pricing.input_price_per_million
    output_cost = (Decimal(output_tokens) / Decimal("1000000")) * pricing.output_price_per_million

    return input_cost + output_cost
