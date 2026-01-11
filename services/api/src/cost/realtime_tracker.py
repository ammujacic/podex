"""Real-time cost tracking for LLM usage."""

import asyncio
import logging
import uuid
from collections import defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)

# Token divisor for cost calculation (cost per million tokens)
TOKENS_PER_MILLION = 1000000


class ModelProvider(str, Enum):
    """Supported model providers."""

    ANTHROPIC = "anthropic"
    OPENAI = "openai"
    GOOGLE = "google"


@dataclass
class ModelPricing:
    """Pricing per million tokens for a model."""

    input_per_million: Decimal
    output_per_million: Decimal
    cached_input_per_million: Decimal | None = None  # For models with caching


# Pricing as of late 2024/early 2025 (USD per million tokens)
MODEL_PRICING: dict[str, ModelPricing] = {
    # Anthropic
    "claude-opus-4-20250514": ModelPricing(
        input_per_million=Decimal("15.00"),
        output_per_million=Decimal("75.00"),
        cached_input_per_million=Decimal("1.50"),
    ),
    "claude-sonnet-4-20250514": ModelPricing(
        input_per_million=Decimal("3.00"),
        output_per_million=Decimal("15.00"),
        cached_input_per_million=Decimal("0.30"),
    ),
    "claude-3-5-sonnet-20241022": ModelPricing(
        input_per_million=Decimal("3.00"),
        output_per_million=Decimal("15.00"),
        cached_input_per_million=Decimal("0.30"),
    ),
    "claude-3-5-haiku-20241022": ModelPricing(
        input_per_million=Decimal("0.80"),
        output_per_million=Decimal("4.00"),
        cached_input_per_million=Decimal("0.08"),
    ),
    # OpenAI
    "gpt-4o": ModelPricing(
        input_per_million=Decimal("2.50"),
        output_per_million=Decimal("10.00"),
    ),
    "gpt-4o-mini": ModelPricing(
        input_per_million=Decimal("0.15"),
        output_per_million=Decimal("0.60"),
    ),
    "gpt-4-turbo": ModelPricing(
        input_per_million=Decimal("10.00"),
        output_per_million=Decimal("30.00"),
    ),
    "o1": ModelPricing(
        input_per_million=Decimal("15.00"),
        output_per_million=Decimal("60.00"),
    ),
    "o1-mini": ModelPricing(
        input_per_million=Decimal("3.00"),
        output_per_million=Decimal("12.00"),
    ),
    # Google
    "gemini-2.0-flash": ModelPricing(
        input_per_million=Decimal("0.10"),
        output_per_million=Decimal("0.40"),
    ),
    "gemini-1.5-pro": ModelPricing(
        input_per_million=Decimal("1.25"),
        output_per_million=Decimal("5.00"),
    ),
}

# Fallback pricing for unknown models
DEFAULT_PRICING = ModelPricing(
    input_per_million=Decimal("5.00"),
    output_per_million=Decimal("15.00"),
)


@dataclass
class TokenUsage:
    """Token usage for a single LLM call."""

    input_tokens: int
    output_tokens: int
    cached_input_tokens: int = 0
    model: str = ""
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))
    agent_id: str | None = None
    call_id: str = field(default_factory=lambda: str(uuid.uuid4()))


@dataclass
class CostBreakdown:
    """Cost breakdown for a session or agent."""

    input_cost: Decimal = Decimal(0)
    output_cost: Decimal = Decimal(0)
    cached_input_cost: Decimal = Decimal(0)
    total_cost: Decimal = Decimal(0)
    input_tokens: int = 0
    output_tokens: int = 0
    cached_input_tokens: int = 0
    total_tokens: int = 0
    call_count: int = 0
    by_model: dict[str, "CostBreakdown"] = field(default_factory=dict)
    by_agent: dict[str, "CostBreakdown"] = field(default_factory=dict)

    def add(self, other: "CostBreakdown") -> None:
        """Add another cost breakdown to this one."""
        self.input_cost += other.input_cost
        self.output_cost += other.output_cost
        self.cached_input_cost += other.cached_input_cost
        self.total_cost += other.total_cost
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.cached_input_tokens += other.cached_input_tokens
        self.total_tokens += other.total_tokens
        self.call_count += other.call_count

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "input_cost": float(self.input_cost),
            "output_cost": float(self.output_cost),
            "cached_input_cost": float(self.cached_input_cost),
            "total_cost": float(self.total_cost),
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cached_input_tokens": self.cached_input_tokens,
            "total_tokens": self.total_tokens,
            "call_count": self.call_count,
            "by_model": {k: v.to_dict() for k, v in self.by_model.items()},
            "by_agent": {k: v.to_dict() for k, v in self.by_agent.items()},
        }


class RealtimeCostTracker:
    """
    Track costs in real-time for sessions and agents.

    Features:
    - Real-time cost calculation per LLM call
    - Session and agent-level aggregation
    - Model-specific pricing
    - WebSocket update notifications
    """

    def __init__(self) -> None:
        # Session ID -> list of TokenUsage
        self._session_usage: dict[str, list[TokenUsage]] = defaultdict(list)
        # Session ID -> CostBreakdown (cached)
        self._session_costs: dict[str, CostBreakdown] = {}
        # User ID -> list of session IDs
        self._user_sessions: dict[str, list[str]] = defaultdict(list)
        # Callback for cost updates
        self._update_callback: Callable[[str, CostBreakdown], Awaitable[None]] | None = None
        # Lock for thread safety
        self._lock = asyncio.Lock()

    def set_update_callback(
        self, callback: Callable[[str, CostBreakdown], Awaitable[None]]
    ) -> None:
        """Set callback for cost update notifications."""
        self._update_callback = callback

    def get_pricing(self, model: str) -> ModelPricing:
        """Get pricing for a model, with fallback to default."""
        # Normalize model name
        model_lower = model.lower()

        # Try exact match
        if model in MODEL_PRICING:
            return MODEL_PRICING[model]

        # Try partial match
        for known_model, pricing in MODEL_PRICING.items():
            if known_model in model_lower or model_lower in known_model:
                return pricing

        logger.warning("Unknown model '%s', using default pricing", model)
        return DEFAULT_PRICING

    def calculate_cost(self, usage: TokenUsage) -> CostBreakdown:
        """Calculate cost for a single usage record."""
        pricing = self.get_pricing(usage.model)

        input_cost = (
            Decimal(usage.input_tokens) / Decimal(TOKENS_PER_MILLION)
        ) * pricing.input_per_million
        output_cost = (
            Decimal(usage.output_tokens) / Decimal(TOKENS_PER_MILLION)
        ) * pricing.output_per_million

        cached_input_cost = Decimal(0)
        if usage.cached_input_tokens and pricing.cached_input_per_million:
            cached_input_cost = (
                Decimal(usage.cached_input_tokens) / Decimal(TOKENS_PER_MILLION)
            ) * pricing.cached_input_per_million

        total_cost = input_cost + output_cost + cached_input_cost

        return CostBreakdown(
            input_cost=input_cost,
            output_cost=output_cost,
            cached_input_cost=cached_input_cost,
            total_cost=total_cost,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cached_input_tokens=usage.cached_input_tokens,
            total_tokens=usage.input_tokens + usage.output_tokens + usage.cached_input_tokens,
            call_count=1,
        )

    async def track_usage(
        self,
        session_id: str,
        usage: TokenUsage,
        user_id: str | None = None,
    ) -> CostBreakdown:
        """
        Track token usage for a session.

        Returns the cost breakdown for this usage.
        """
        async with self._lock:
            # Store usage
            self._session_usage[session_id].append(usage)

            # Track user -> session mapping
            if user_id and session_id not in self._user_sessions[user_id]:
                self._user_sessions[user_id].append(session_id)

            # Invalidate cached cost
            if session_id in self._session_costs:
                del self._session_costs[session_id]

            # Calculate cost for this usage
            cost = self.calculate_cost(usage)

            # Get updated session cost
            session_cost = self._calculate_session_cost(session_id)

            # Notify via callback
            if self._update_callback:
                try:
                    await self._update_callback(session_id, session_cost)
                except Exception:
                    logger.exception("Cost update callback failed")

            return cost

    def _calculate_session_cost(self, session_id: str) -> CostBreakdown:
        """Calculate total cost for a session."""
        if session_id in self._session_costs:
            return self._session_costs[session_id]

        breakdown = CostBreakdown()

        for usage in self._session_usage[session_id]:
            cost = self.calculate_cost(usage)
            breakdown.add(cost)

            # Track by model
            if usage.model not in breakdown.by_model:
                breakdown.by_model[usage.model] = CostBreakdown()
            breakdown.by_model[usage.model].add(cost)

            # Track by agent
            if usage.agent_id:
                if usage.agent_id not in breakdown.by_agent:
                    breakdown.by_agent[usage.agent_id] = CostBreakdown()
                breakdown.by_agent[usage.agent_id].add(cost)

        self._session_costs[session_id] = breakdown
        return breakdown

    async def get_session_cost(self, session_id: str) -> CostBreakdown:
        """Get current cost for a session."""
        async with self._lock:
            return self._calculate_session_cost(session_id)

    async def get_agent_cost(self, session_id: str, agent_id: str) -> CostBreakdown:
        """Get cost for a specific agent in a session."""
        async with self._lock:
            session_cost = self._calculate_session_cost(session_id)
            return session_cost.by_agent.get(agent_id, CostBreakdown())

    async def get_user_cost(
        self,
        user_id: str,
        since: datetime | None = None,
    ) -> CostBreakdown:
        """Get total cost for a user across all sessions."""
        async with self._lock:
            breakdown = CostBreakdown()

            for session_id in self._user_sessions.get(user_id, []):
                for usage in self._session_usage[session_id]:
                    if since and usage.timestamp < since:
                        continue
                    cost = self.calculate_cost(usage)
                    breakdown.add(cost)

                    if usage.model not in breakdown.by_model:
                        breakdown.by_model[usage.model] = CostBreakdown()
                    breakdown.by_model[usage.model].add(cost)

            return breakdown

    async def get_usage_history(
        self,
        session_id: str,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Get recent usage history for a session."""
        async with self._lock:
            usages = self._session_usage[session_id][-limit:]
            return [
                {
                    "call_id": u.call_id,
                    "model": u.model,
                    "input_tokens": u.input_tokens,
                    "output_tokens": u.output_tokens,
                    "cached_input_tokens": u.cached_input_tokens,
                    "cost": float(self.calculate_cost(u).total_cost),
                    "timestamp": u.timestamp.isoformat(),
                    "agent_id": u.agent_id,
                }
                for u in usages
            ]

    async def get_daily_usage(
        self,
        user_id: str,
        days: int = 30,
    ) -> list[dict[str, Any]]:
        """Get daily usage aggregates for a user."""
        async with self._lock:
            cutoff = datetime.now(UTC) - timedelta(days=days)
            daily: dict[str, CostBreakdown] = defaultdict(CostBreakdown)

            for session_id in self._user_sessions.get(user_id, []):
                for usage in self._session_usage[session_id]:
                    if usage.timestamp < cutoff:
                        continue
                    day = usage.timestamp.strftime("%Y-%m-%d")
                    cost = self.calculate_cost(usage)
                    daily[day].add(cost)

            return [
                {
                    "date": date,
                    **breakdown.to_dict(),
                }
                for date, breakdown in sorted(daily.items())
            ]

    async def reset_session(self, session_id: str) -> None:
        """Reset tracking for a session."""
        async with self._lock:
            self._session_usage[session_id] = []
            if session_id in self._session_costs:
                del self._session_costs[session_id]

    def estimate_cost(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int,
        cached_input_tokens: int = 0,
    ) -> Decimal:
        """Estimate cost before making a call."""
        usage = TokenUsage(
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cached_input_tokens=cached_input_tokens,
        )
        return self.calculate_cost(usage).total_cost


# Global instance
_tracker: RealtimeCostTracker | None = None


def get_cost_tracker() -> RealtimeCostTracker:
    """Get the global cost tracker instance."""
    global _tracker  # noqa: PLW0603
    if _tracker is None:
        _tracker = RealtimeCostTracker()
    return _tracker
