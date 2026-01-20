"""Comprehensive tests for billing models."""

from datetime import datetime, timezone
from decimal import Decimal

from podex_shared.models.billing import (
    DEFAULT_INPUT_PRICE_PER_MILLION,
    DEFAULT_OUTPUT_PRICE_PER_MILLION,
    BillingEventInfo,
    BillingEventType,
    CreateSubscriptionRequest,
    CreditBalanceInfo,
    CreditTransactionInfo,
    CreditTransactionType,
    InvoiceInfo,
    InvoiceStatus,
    ModelPricing,
    PurchaseCreditsRequest,
    QuotaInfo,
    SubscriptionPlanInfo,
    SubscriptionPlanType,
    SubscriptionStatus,
    UpdateSubscriptionRequest,
    UsageHistoryRequest,
    UsageRecordInfo,
    UsageSummary,
    UsageType,
    calculate_token_cost_with_pricing,
)


class TestSubscriptionPlanType:
    """Tests for SubscriptionPlanType enum."""

    def test_plan_types(self) -> None:
        """Test plan type values."""
        assert SubscriptionPlanType.FREE == "free"
        assert SubscriptionPlanType.STARTER == "starter"
        assert SubscriptionPlanType.PRO == "pro"
        assert SubscriptionPlanType.TEAM == "team"
        assert SubscriptionPlanType.ENTERPRISE == "enterprise"


class TestSubscriptionStatus:
    """Tests for SubscriptionStatus enum."""

    def test_status_values(self) -> None:
        """Test subscription status values."""
        assert SubscriptionStatus.ACTIVE == "active"
        assert SubscriptionStatus.CANCELED == "canceled"
        assert SubscriptionStatus.PAST_DUE == "past_due"
        assert SubscriptionStatus.TRIALING == "trialing"
        assert SubscriptionStatus.PAUSED == "paused"
        assert SubscriptionStatus.INCOMPLETE == "incomplete"


class TestUsageType:
    """Tests for UsageType enum."""

    def test_usage_types(self) -> None:
        """Test usage type values."""
        assert UsageType.TOKENS_INPUT == "tokens_input"
        assert UsageType.TOKENS_OUTPUT == "tokens_output"
        assert UsageType.COMPUTE_SECONDS == "compute_seconds"
        assert UsageType.STORAGE_GB == "storage_gb"
        assert UsageType.API_CALLS == "api_calls"


class TestCreditTransactionType:
    """Tests for CreditTransactionType enum."""

    def test_transaction_types(self) -> None:
        """Test transaction type values."""
        assert CreditTransactionType.PURCHASE == "purchase"
        assert CreditTransactionType.BONUS == "bonus"
        assert CreditTransactionType.REFERRAL == "referral"
        assert CreditTransactionType.REFUND == "refund"
        assert CreditTransactionType.USAGE == "usage"
        assert CreditTransactionType.EXPIRY == "expiry"
        assert CreditTransactionType.SUBSCRIPTION_CREDIT == "subscription_credit"


class TestBillingEventType:
    """Tests for BillingEventType enum."""

    def test_event_types(self) -> None:
        """Test billing event type values."""
        assert BillingEventType.SUBSCRIPTION_CREATED == "subscription_created"
        assert BillingEventType.PAYMENT_SUCCEEDED == "payment_succeeded"
        assert BillingEventType.PAYMENT_FAILED == "payment_failed"
        assert BillingEventType.CREDITS_PURCHASED == "credits_purchased"
        assert BillingEventType.QUOTA_EXCEEDED == "quota_exceeded"


class TestInvoiceStatus:
    """Tests for InvoiceStatus enum."""

    def test_status_values(self) -> None:
        """Test invoice status values."""
        assert InvoiceStatus.DRAFT == "draft"
        assert InvoiceStatus.OPEN == "open"
        assert InvoiceStatus.PAID == "paid"
        assert InvoiceStatus.VOID == "void"
        assert InvoiceStatus.UNCOLLECTIBLE == "uncollectible"


class TestSubscriptionPlanInfo:
    """Tests for SubscriptionPlanInfo model."""

    def test_subscription_plan_info(self) -> None:
        """Test creating SubscriptionPlanInfo."""
        plan = SubscriptionPlanInfo(
            id="plan-123",
            name="Pro Plan",
            slug="pro",
            description="Professional features",
            price_monthly=Decimal("29.99"),
            price_yearly=Decimal("299.99"),
            tokens_included=1000000,
            storage_gb_included=50,
            max_agents=10,
            max_sessions=5,
            max_team_members=5,
        )
        assert plan.id == "plan-123"
        assert plan.name == "Pro Plan"
        assert plan.price_monthly == Decimal("29.99")
        assert plan.tokens_included == 1000000

    def test_subscription_plan_info_defaults(self) -> None:
        """Test SubscriptionPlanInfo defaults."""
        plan = SubscriptionPlanInfo(
            id="plan-123",
            name="Test",
            slug="test",
            price_monthly=Decimal("0"),
            price_yearly=Decimal("0"),
            tokens_included=0,
            storage_gb_included=0,
            max_agents=1,
            max_sessions=1,
            max_team_members=1,
        )
        assert plan.description is None
        assert plan.features == {}
        assert plan.is_popular is False
        assert plan.is_enterprise is False
        assert plan.sort_order == 0


class TestUsageRecordInfo:
    """Tests for UsageRecordInfo model."""

    def test_usage_record_info(self) -> None:
        """Test creating UsageRecordInfo."""
        now = datetime.now()
        record = UsageRecordInfo(
            id="record-123",
            user_id="user-456",
            usage_type=UsageType.TOKENS_OUTPUT,
            quantity=Decimal("1000"),
            unit="tokens",
            unit_price=Decimal("0.001"),
            total_cost=Decimal("1.00"),
            created_at=now,
        )
        assert record.id == "record-123"
        assert record.usage_type == UsageType.TOKENS_OUTPUT
        assert record.total_cost == Decimal("1.00")


class TestUsageSummary:
    """Tests for UsageSummary model."""

    def test_usage_summary_defaults(self) -> None:
        """Test UsageSummary default values."""
        now = datetime.now()
        summary = UsageSummary(
            period_start=now,
            period_end=now,
        )
        assert summary.tokens_input == 0
        assert summary.tokens_output == 0
        assert summary.tokens_total == 0
        assert summary.tokens_cost == Decimal("0")
        assert summary.compute_seconds == 0
        assert summary.compute_hours == 0.0
        assert summary.storage_gb == 0.0
        assert summary.api_calls == 0
        assert summary.total_cost == Decimal("0")
        assert summary.usage_by_model == {}
        assert summary.usage_by_agent == {}
        assert summary.usage_by_session == {}


class TestQuotaInfo:
    """Tests for QuotaInfo model."""

    def test_quota_info(self) -> None:
        """Test creating QuotaInfo."""
        quota = QuotaInfo(
            id="quota-123",
            user_id="user-456",
            quota_type="tokens",
            limit_value=1000000,
            current_usage=500000,
            usage_percentage=50.0,
        )
        assert quota.id == "quota-123"
        assert quota.limit_value == 1000000
        assert quota.current_usage == 500000
        assert quota.usage_percentage == 50.0
        assert quota.is_exceeded is False
        assert quota.is_warning is False


class TestCreditBalanceInfo:
    """Tests for CreditBalanceInfo model."""

    def test_credit_balance_info(self) -> None:
        """Test creating CreditBalanceInfo."""
        now = datetime.now()
        balance = CreditBalanceInfo(
            user_id="user-123",
            balance=Decimal("100.00"),
            last_updated=now,
        )
        assert balance.user_id == "user-123"
        assert balance.balance == Decimal("100.00")
        assert balance.pending_balance == Decimal("0")
        assert balance.expires_soon == Decimal("0")


class TestCreditTransactionInfo:
    """Tests for CreditTransactionInfo model."""

    def test_credit_transaction_info(self) -> None:
        """Test creating CreditTransactionInfo."""
        now = datetime.now()
        transaction = CreditTransactionInfo(
            id="tx-123",
            user_id="user-456",
            amount=Decimal("50.00"),
            transaction_type=CreditTransactionType.PURCHASE,
            description="Credit purchase",
            created_at=now,
        )
        assert transaction.id == "tx-123"
        assert transaction.amount == Decimal("50.00")
        assert transaction.currency == "USD"


class TestInvoiceInfo:
    """Tests for InvoiceInfo model."""

    def test_invoice_info(self) -> None:
        """Test creating InvoiceInfo."""
        now = datetime.now()
        invoice = InvoiceInfo(
            id="inv-123",
            user_id="user-456",
            invoice_number="INV-2025-001",
            amount=Decimal("99.99"),
            status=InvoiceStatus.PAID,
            period_start=now,
            period_end=now,
            due_date=now,
            created_at=now,
        )
        assert invoice.id == "inv-123"
        assert invoice.invoice_number == "INV-2025-001"
        assert invoice.status == InvoiceStatus.PAID


class TestBillingEventInfo:
    """Tests for BillingEventInfo model."""

    def test_billing_event_info(self) -> None:
        """Test creating BillingEventInfo."""
        now = datetime.now()
        event = BillingEventInfo(
            id="event-123",
            user_id="user-456",
            event_type=BillingEventType.SUBSCRIPTION_CREATED,
            created_at=now,
        )
        assert event.id == "event-123"
        assert event.event_type == BillingEventType.SUBSCRIPTION_CREATED
        assert event.event_data == {}


class TestCreateSubscriptionRequest:
    """Tests for CreateSubscriptionRequest model."""

    def test_create_subscription_request(self) -> None:
        """Test creating CreateSubscriptionRequest."""
        request = CreateSubscriptionRequest(plan_id="plan-123")
        assert request.plan_id == "plan-123"
        assert request.billing_cycle == "monthly"
        assert request.promotion_code is None

    def test_create_subscription_request_yearly(self) -> None:
        """Test creating yearly subscription request."""
        request = CreateSubscriptionRequest(
            plan_id="plan-123",
            billing_cycle="yearly",
            promotion_code="SAVE20",
        )
        assert request.billing_cycle == "yearly"
        assert request.promotion_code == "SAVE20"


class TestUpdateSubscriptionRequest:
    """Tests for UpdateSubscriptionRequest model."""

    def test_update_subscription_request(self) -> None:
        """Test creating UpdateSubscriptionRequest."""
        request = UpdateSubscriptionRequest(plan_id="plan-456")
        assert request.plan_id == "plan-456"
        assert request.cancel_at_period_end is None

    def test_update_subscription_cancel(self) -> None:
        """Test cancellation request."""
        request = UpdateSubscriptionRequest(cancel_at_period_end=True)
        assert request.cancel_at_period_end is True


class TestPurchaseCreditsRequest:
    """Tests for PurchaseCreditsRequest model."""

    def test_purchase_credits_request(self) -> None:
        """Test creating PurchaseCreditsRequest."""
        request = PurchaseCreditsRequest(amount=Decimal("50.00"))
        assert request.amount == Decimal("50.00")
        assert request.payment_method_id is None


class TestUsageHistoryRequest:
    """Tests for UsageHistoryRequest model."""

    def test_usage_history_request_defaults(self) -> None:
        """Test UsageHistoryRequest defaults."""
        request = UsageHistoryRequest()
        assert request.start_date is None
        assert request.end_date is None
        assert request.usage_type is None
        assert request.page == 1
        assert request.page_size == 50


class TestModelPricing:
    """Tests for ModelPricing model."""

    def test_model_pricing(self) -> None:
        """Test creating ModelPricing."""
        pricing = ModelPricing(
            model_id="test-model",
            display_name="Test Model",
            provider="test",
            input_price_per_million=Decimal("1.00"),
            output_price_per_million=Decimal("2.00"),
        )
        assert pricing.model_id == "test-model"
        assert pricing.is_available is True


class TestDefaultPricing:
    """Tests for default pricing constants."""

    def test_default_input_price(self) -> None:
        """Test default input price constant."""
        assert DEFAULT_INPUT_PRICE_PER_MILLION == Decimal("3.00")

    def test_default_output_price(self) -> None:
        """Test default output price constant."""
        assert DEFAULT_OUTPUT_PRICE_PER_MILLION == Decimal("15.00")


class TestCalculateTokenCostWithPricing:
    """Tests for calculate_token_cost_with_pricing function."""

    def test_calculate_cost_with_explicit_pricing(self) -> None:
        """Test cost calculation with explicit pricing."""
        cost = calculate_token_cost_with_pricing(
            input_tokens=1000000,
            output_tokens=500000,
            input_price_per_million=Decimal("3.00"),
            output_price_per_million=Decimal("15.00"),
        )
        # Input: 1M * $3/M = $3
        # Output: 0.5M * $15/M = $7.5
        # Total: $10.50
        expected = Decimal("3.00") + Decimal("7.50")
        assert cost == expected

    def test_calculate_cost_zero_tokens(self) -> None:
        """Test cost calculation with zero tokens."""
        cost = calculate_token_cost_with_pricing(
            input_tokens=0,
            output_tokens=0,
            input_price_per_million=Decimal("3.00"),
            output_price_per_million=Decimal("15.00"),
        )
        assert cost == Decimal("0")

    def test_calculate_cost_small_tokens(self) -> None:
        """Test cost calculation with small token count."""
        cost = calculate_token_cost_with_pricing(
            input_tokens=100,
            output_tokens=50,
            input_price_per_million=Decimal("3.00"),
            output_price_per_million=Decimal("15.00"),
        )
        # Should be a small but non-zero amount
        assert cost > Decimal("0")
        assert cost < Decimal("1")

    def test_calculate_cost_only_input(self) -> None:
        """Test cost calculation with only input tokens."""
        cost = calculate_token_cost_with_pricing(
            input_tokens=1000000,
            output_tokens=0,
            input_price_per_million=Decimal("1.00"),
            output_price_per_million=Decimal("2.00"),
        )
        assert cost == Decimal("1.00")

    def test_calculate_cost_only_output(self) -> None:
        """Test cost calculation with only output tokens."""
        cost = calculate_token_cost_with_pricing(
            input_tokens=0,
            output_tokens=1000000,
            input_price_per_million=Decimal("1.00"),
            output_price_per_million=Decimal("2.00"),
        )
        assert cost == Decimal("2.00")
