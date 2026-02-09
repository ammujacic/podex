"""Budget alert management for cost tracking.

Multi-Worker Architecture:
- All budget and alert state is stored in Redis for cross-worker visibility
- Budget configurations persist across worker restarts
- Alert deduplication uses Redis-based tracking
"""

import json
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from enum import Enum
from typing import Any

import redis.asyncio as aioredis
import structlog

from src.config import settings

from .realtime_tracker import CostBreakdown, get_cost_tracker

logger = structlog.get_logger(__name__)

# Redis keys for alert management
ALERT_USER_BUDGETS_KEY = "podex:alert:user:{user_id}:budgets"  # Hash of period -> budget JSON
ALERT_SESSION_BUDGET_KEY = "podex:alert:session:{session_id}:budget"  # Budget JSON
ALERT_HISTORY_KEY = "podex:alert:history:{user_id}"  # List of alert JSONs
ALERT_SENT_KEY = "podex:alert:sent:{user_id}:{alert_type}:{budget_id}"  # Timestamp of last sent
ALERT_HISTORY_TTL = 30 * 24 * 3600  # 30 days
ALERT_SENT_TTL = 3600  # 1 hour (longer than cooldown to allow cleanup)

# Redis client singleton
_redis: aioredis.Redis | None = None  # type: ignore[type-arg]


async def _get_redis() -> aioredis.Redis:  # type: ignore[type-arg]
    """Get or create Redis client."""
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis


# Minimum number of days of usage data required for spike detection
MIN_DAYS_FOR_SPIKE_DETECTION = 3


class AlertType(str, Enum):
    """Types of budget alerts."""

    THRESHOLD_WARNING = "threshold_warning"  # Approaching budget limit
    BUDGET_EXCEEDED = "budget_exceeded"  # Budget exceeded
    DAILY_LIMIT = "daily_limit"  # Daily spending limit
    UNUSUAL_SPIKE = "unusual_spike"  # Unusual spending spike
    SESSION_LIMIT = "session_limit"  # Session spending limit


class AlertSeverity(str, Enum):
    """Alert severity levels."""

    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass
class Budget:
    """Budget configuration."""

    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str = ""
    session_id: str | None = None  # None = user-level budget
    amount: Decimal = Decimal(0)
    period: str = "monthly"  # "session", "daily", "weekly", "monthly"
    warning_threshold: float = 0.8  # Alert at 80% by default
    hard_limit: bool = False  # Whether to block further usage
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    expires_at: datetime | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "user_id": self.user_id,
            "session_id": self.session_id,
            "amount": float(self.amount),
            "period": self.period,
            "warning_threshold": self.warning_threshold,
            "hard_limit": self.hard_limit,
            "created_at": self.created_at.isoformat(),
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Budget":
        """Create from dictionary."""
        return cls(
            id=data.get("id", str(uuid.uuid4())),
            user_id=data.get("user_id", ""),
            session_id=data.get("session_id"),
            amount=Decimal(str(data.get("amount", 0))),
            period=data.get("period", "monthly"),
            warning_threshold=data.get("warning_threshold", 0.8),
            hard_limit=data.get("hard_limit", False),
            created_at=datetime.fromisoformat(data["created_at"])
            if data.get("created_at")
            else datetime.now(UTC),
            expires_at=datetime.fromisoformat(data["expires_at"])
            if data.get("expires_at")
            else None,
        )


@dataclass
class BudgetAlert:
    """A budget alert."""

    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    alert_type: AlertType = AlertType.THRESHOLD_WARNING
    severity: AlertSeverity = AlertSeverity.WARNING
    user_id: str = ""
    session_id: str | None = None
    budget_id: str | None = None
    message: str = ""
    current_spent: Decimal = Decimal(0)
    budget_amount: Decimal = Decimal(0)
    percentage_used: float = 0.0
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    acknowledged: bool = False
    acknowledged_at: datetime | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "alert_type": self.alert_type.value,
            "severity": self.severity.value,
            "user_id": self.user_id,
            "session_id": self.session_id,
            "budget_id": self.budget_id,
            "message": self.message,
            "current_spent": float(self.current_spent),
            "budget_amount": float(self.budget_amount),
            "percentage_used": self.percentage_used,
            "created_at": self.created_at.isoformat(),
            "acknowledged": self.acknowledged,
            "acknowledged_at": self.acknowledged_at.isoformat() if self.acknowledged_at else None,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "BudgetAlert":
        """Create from dictionary."""
        return cls(
            id=data.get("id", str(uuid.uuid4())),
            alert_type=AlertType(data.get("alert_type", "threshold_warning")),
            severity=AlertSeverity(data.get("severity", "warning")),
            user_id=data.get("user_id", ""),
            session_id=data.get("session_id"),
            budget_id=data.get("budget_id"),
            message=data.get("message", ""),
            current_spent=Decimal(str(data.get("current_spent", 0))),
            budget_amount=Decimal(str(data.get("budget_amount", 0))),
            percentage_used=data.get("percentage_used", 0.0),
            created_at=datetime.fromisoformat(data["created_at"])
            if data.get("created_at")
            else datetime.now(UTC),
            acknowledged=data.get("acknowledged", False),
            acknowledged_at=datetime.fromisoformat(data["acknowledged_at"])
            if data.get("acknowledged_at")
            else None,
        )


class CostAlertManager:
    """
    Manage budget alerts and notifications.

    Multi-Worker: All state is stored in Redis for cross-worker consistency.

    Features:
    - User and session-level budgets
    - Configurable warning thresholds
    - Alert deduplication
    - Hard limit enforcement
    - Spending spike detection
    """

    def __init__(self) -> None:
        # Alert callback (local - each worker can have its own)
        self._alert_callback: Callable[[BudgetAlert], Awaitable[None]] | None = None
        # Alert cooldown (avoid spamming)
        self._alert_cooldown = timedelta(minutes=5)

    def set_alert_callback(self, callback: Callable[[BudgetAlert], Awaitable[None]]) -> None:
        """Set callback for alert notifications."""
        self._alert_callback = callback

    async def _store_user_budget(self, budget: Budget) -> None:
        """Store a user budget in Redis."""
        try:
            redis = await _get_redis()
            key = ALERT_USER_BUDGETS_KEY.format(user_id=budget.user_id)
            await redis.hset(key, budget.period, json.dumps(budget.to_dict()))
        except Exception as e:
            logger.warning(
                "Failed to store user budget in Redis", user_id=budget.user_id, error=str(e)
            )

    async def _get_user_budgets_from_redis(self, user_id: str) -> list[Budget]:
        """Get all budgets for a user from Redis."""
        try:
            redis = await _get_redis()
            key = ALERT_USER_BUDGETS_KEY.format(user_id=user_id)
            data = await redis.hgetall(key)
            return [Budget.from_dict(json.loads(v)) for v in data.values()]
        except Exception as e:
            logger.warning("Failed to get user budgets from Redis", user_id=user_id, error=str(e))
            return []

    async def _store_session_budget(self, budget: Budget) -> None:
        """Store a session budget in Redis."""
        try:
            redis = await _get_redis()
            key = ALERT_SESSION_BUDGET_KEY.format(session_id=budget.session_id)
            await redis.set(key, json.dumps(budget.to_dict()))
        except Exception as e:
            logger.warning(
                "Failed to store session budget in Redis",
                session_id=budget.session_id,
                error=str(e),
            )

    async def _get_session_budget_from_redis(self, session_id: str) -> Budget | None:
        """Get session budget from Redis."""
        try:
            redis = await _get_redis()
            key = ALERT_SESSION_BUDGET_KEY.format(session_id=session_id)
            data = await redis.get(key)
            if data:
                return Budget.from_dict(json.loads(data))
        except Exception as e:
            logger.warning(
                "Failed to get session budget from Redis", session_id=session_id, error=str(e)
            )
        return None

    async def _store_alert(self, alert: BudgetAlert) -> None:
        """Store an alert in Redis."""
        try:
            redis = await _get_redis()
            key = ALERT_HISTORY_KEY.format(user_id=alert.user_id)
            await redis.lpush(key, json.dumps(alert.to_dict()))
            # Trim to last 100 alerts
            await redis.ltrim(key, 0, 99)
            await redis.expire(key, ALERT_HISTORY_TTL)
        except Exception as e:
            logger.warning("Failed to store alert in Redis", user_id=alert.user_id, error=str(e))

    async def _get_alerts_from_redis(self, user_id: str, limit: int = 50) -> list[BudgetAlert]:
        """Get alerts for a user from Redis."""
        try:
            redis = await _get_redis()
            key = ALERT_HISTORY_KEY.format(user_id=user_id)
            data = await redis.lrange(key, 0, limit - 1)
            return [BudgetAlert.from_dict(json.loads(d)) for d in data]
        except Exception as e:
            logger.warning("Failed to get alerts from Redis", user_id=user_id, error=str(e))
            return []

    async def _check_alert_cooldown(
        self, user_id: str, alert_type: str, budget_id: str | None
    ) -> bool:
        """Check if we're still in cooldown for this alert type."""
        try:
            redis = await _get_redis()
            key = ALERT_SENT_KEY.format(
                user_id=user_id, alert_type=alert_type, budget_id=budget_id or "none"
            )
            exists = await redis.exists(key)
            return bool(exists)
        except Exception as e:
            logger.warning("Failed to check alert cooldown", error=str(e))
            return False

    async def _mark_alert_sent(self, user_id: str, alert_type: str, budget_id: str | None) -> None:
        """Mark an alert as sent (for cooldown)."""
        try:
            redis = await _get_redis()
            key = ALERT_SENT_KEY.format(
                user_id=user_id, alert_type=alert_type, budget_id=budget_id or "none"
            )
            cooldown_seconds = int(self._alert_cooldown.total_seconds())
            await redis.setex(key, cooldown_seconds, datetime.now(UTC).isoformat())
        except Exception as e:
            logger.warning("Failed to mark alert sent", error=str(e))

    async def set_user_budget(self, budget: Budget) -> Budget:
        """Set a budget for a user."""
        await self._store_user_budget(budget)
        logger.info(
            "Set %s budget for user %s: $%s",
            budget.period,
            budget.user_id,
            budget.amount,
        )
        return budget

    async def set_session_budget(self, budget: Budget) -> Budget:
        """Set a budget for a session."""
        if not budget.session_id:
            raise ValueError("session_id required")  # noqa: TRY003

        await self._store_session_budget(budget)
        logger.info(
            "Set session budget for %s: $%s",
            budget.session_id,
            budget.amount,
        )
        return budget

    async def get_user_budgets(self, user_id: str) -> list[Budget]:
        """Get all budgets for a user."""
        return await self._get_user_budgets_from_redis(user_id)

    async def get_session_budget(self, session_id: str) -> Budget | None:
        """Get budget for a session."""
        return await self._get_session_budget_from_redis(session_id)

    async def delete_budget(self, budget_id: str, user_id: str | None = None) -> bool:
        """Delete a budget by ID.

        SECURITY: If user_id is provided, verifies ownership before deletion.

        Args:
            budget_id: The ID of the budget to delete.
            user_id: Optional user ID to verify ownership. If provided, only
                     deletes the budget if it belongs to this user.

        Returns:
            True if budget was deleted, False if not found or ownership mismatch.
        """
        try:
            redis = await _get_redis()

            # Check user budgets - scan all users or specific user
            if user_id:
                user_ids = [user_id]
            else:
                # Scan for all user budget keys
                user_ids = []
                cursor = 0
                while True:
                    cursor, keys = await redis.scan(
                        cursor, match="podex:alert:user:*:budgets", count=100
                    )
                    for key in keys:
                        # Extract user_id from key
                        parts = key.split(":")
                        if len(parts) >= 4:
                            user_ids.append(parts[3])
                    if cursor == 0:
                        break

            for uid in user_ids:
                budgets = await self._get_user_budgets_from_redis(uid)
                for budget in budgets:
                    if budget.id == budget_id:
                        # SECURITY: Verify ownership if user_id provided
                        if user_id and budget.user_id != user_id:
                            logger.warning(
                                "Budget ownership mismatch on delete",
                                budget_id=budget_id,
                                budget_owner=budget.user_id,
                                requesting_user=user_id,
                            )
                            return False
                        # Delete from Redis hash
                        key = ALERT_USER_BUDGETS_KEY.format(user_id=budget.user_id)
                        await redis.hdel(key, budget.period)
                        return True

            # Check session budgets
            cursor = 0
            while True:
                cursor, keys = await redis.scan(
                    cursor, match="podex:alert:session:*:budget", count=100
                )
                for key in keys:
                    data = await redis.get(key)
                    if data:
                        budget = Budget.from_dict(json.loads(data))
                        if budget.id == budget_id:
                            # SECURITY: Verify ownership if user_id provided
                            if user_id and budget.user_id != user_id:
                                logger.warning(
                                    "Session budget ownership mismatch on delete",
                                    budget_id=budget_id,
                                    budget_owner=budget.user_id,
                                    requesting_user=user_id,
                                )
                                return False
                            await redis.delete(key)
                            return True
                if cursor == 0:
                    break

            return False  # noqa: TRY300
        except Exception as e:
            logger.warning("Failed to delete budget from Redis", budget_id=budget_id, error=str(e))
            return False

    def _get_period_start(self, period: str) -> datetime:
        """Get the start of the current period."""
        now = datetime.now(UTC)

        if period == "daily":
            return now.replace(hour=0, minute=0, second=0, microsecond=0)
        if period == "weekly":
            days_since_monday = now.weekday()
            return (now - timedelta(days=days_since_monday)).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
        if period == "monthly":
            return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        # session - no period constraint
        return datetime.min.replace(tzinfo=UTC)

    async def check_budgets(
        self,
        user_id: str,
        session_id: str,
        _cost: CostBreakdown,
    ) -> tuple[bool, list[BudgetAlert]]:
        """
        Check if usage is within budget limits.

        Returns (allowed, alerts) where allowed is False if hard limit exceeded.
        """
        alerts: list[BudgetAlert] = []
        allowed = True

        tracker = get_cost_tracker()

        # Check session budget
        session_budget = await self._get_session_budget_from_redis(session_id)
        if session_budget:
            session_cost = await tracker.get_session_cost(session_id)
            alert = await self._check_single_budget(
                session_budget,
                session_cost.total_cost,
                user_id,
                session_id,
            )
            if alert:
                alerts.append(alert)
                if session_budget.hard_limit and alert.alert_type == AlertType.BUDGET_EXCEEDED:
                    allowed = False

        # Check user budgets
        user_budgets = await self._get_user_budgets_from_redis(user_id)
        for budget in user_budgets:
            period_start = self._get_period_start(budget.period)
            user_cost = await tracker.get_user_cost(user_id, since=period_start)

            alert = await self._check_single_budget(
                budget,
                user_cost.total_cost,
                user_id,
                None,
            )
            if alert:
                alerts.append(alert)
                if budget.hard_limit and alert.alert_type == AlertType.BUDGET_EXCEEDED:
                    allowed = False

        # Send alerts via callback
        for alert in alerts:
            if self._alert_callback:
                try:
                    await self._alert_callback(alert)
                except Exception:
                    logger.exception("Alert callback failed")

        return allowed, alerts

    async def _check_single_budget(
        self,
        budget: Budget,
        current_spent: Decimal,
        user_id: str,
        session_id: str | None,
    ) -> BudgetAlert | None:
        """Check a single budget and create alert if needed."""
        if budget.amount <= 0:
            return None

        percentage = float(current_spent / budget.amount)

        # Check for deduplication via Redis
        if await self._check_alert_cooldown(user_id, "budget_check", budget.id):
            return None

        alert: BudgetAlert | None = None

        if percentage >= 1.0:
            # Budget exceeded
            alert = BudgetAlert(
                alert_type=AlertType.BUDGET_EXCEEDED,
                severity=AlertSeverity.CRITICAL,
                user_id=user_id,
                session_id=session_id,
                budget_id=budget.id,
                message=f"Budget exceeded! Spent ${current_spent:.2f} of ${budget.amount:.2f} "
                f"({budget.period} budget)",
                current_spent=current_spent,
                budget_amount=budget.amount,
                percentage_used=percentage * 100,
            )
        elif percentage >= budget.warning_threshold:
            # Approaching limit
            alert = BudgetAlert(
                alert_type=AlertType.THRESHOLD_WARNING,
                severity=AlertSeverity.WARNING,
                user_id=user_id,
                session_id=session_id,
                budget_id=budget.id,
                message=f"Approaching budget limit: ${current_spent:.2f} of ${budget.amount:.2f} "
                f"({percentage * 100:.0f}% used)",
                current_spent=current_spent,
                budget_amount=budget.amount,
                percentage_used=percentage * 100,
            )

        if alert:
            await self._store_alert(alert)
            await self._mark_alert_sent(user_id, "budget_check", budget.id)

        return alert

    async def detect_spending_spike(
        self,
        user_id: str,
        _current_cost: Decimal,
        window_hours: int = 1,
    ) -> BudgetAlert | None:
        """Detect unusual spending spikes."""
        tracker = get_cost_tracker()

        # Get cost for the past period
        window_start = datetime.now(UTC) - timedelta(hours=window_hours)
        recent_cost = await tracker.get_user_cost(user_id, since=window_start)

        # Get daily average for comparison
        daily_usage = await tracker.get_daily_usage(user_id, days=7)
        if len(daily_usage) < MIN_DAYS_FOR_SPIKE_DETECTION:
            return None

        avg_daily = sum(d["total_cost"] for d in daily_usage) / len(daily_usage)

        # Alert if recent spending is > 3x the hourly average
        hourly_avg = avg_daily / 24
        threshold = hourly_avg * window_hours * 3

        if 0 < threshold < float(recent_cost.total_cost):
            alert = BudgetAlert(
                alert_type=AlertType.UNUSUAL_SPIKE,
                severity=AlertSeverity.WARNING,
                user_id=user_id,
                message=f"Unusual spending detected: ${recent_cost.total_cost:.2f} in "
                f"the last {window_hours}h (average: ${threshold / 3:.2f})",
                current_spent=recent_cost.total_cost,
                percentage_used=float(recent_cost.total_cost) / threshold * 100
                if threshold > 0
                else 0,
            )

            await self._store_alert(alert)

            if self._alert_callback:
                try:
                    await self._alert_callback(alert)
                except Exception:
                    logger.exception("Alert callback failed")

            return alert

        return None

    async def get_alerts(
        self,
        user_id: str,
        *,
        include_acknowledged: bool = False,
        limit: int = 50,
    ) -> list[BudgetAlert]:
        """Get alerts for a user."""
        alerts = await self._get_alerts_from_redis(user_id, limit=limit)
        if not include_acknowledged:
            alerts = [a for a in alerts if not a.acknowledged]
        return alerts

    async def acknowledge_alert(self, alert_id: str, user_id: str) -> bool:
        """Acknowledge an alert.

        Updates the alert in Redis to mark it as acknowledged.
        """
        try:
            redis = await _get_redis()
            key = ALERT_HISTORY_KEY.format(user_id=user_id)

            # Get all alerts
            all_data = await redis.lrange(key, 0, -1)

            for i, data in enumerate(all_data):
                alert_dict = json.loads(data)
                if alert_dict.get("id") == alert_id:
                    # Update the alert
                    alert_dict["acknowledged"] = True
                    alert_dict["acknowledged_at"] = datetime.now(UTC).isoformat()
                    await redis.lset(key, i, json.dumps(alert_dict))
                    return True

            return False  # noqa: TRY300
        except Exception as e:
            logger.warning("Failed to acknowledge alert in Redis", alert_id=alert_id, error=str(e))
            return False

    async def get_budget_status(
        self,
        user_id: str,
        session_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Get current status of all budgets."""
        tracker = get_cost_tracker()
        statuses = []

        # Session budget
        if session_id:
            budget = await self._get_session_budget_from_redis(session_id)
            if budget:
                cost = await tracker.get_session_cost(session_id)
                statuses.append(
                    {
                        "budget": budget.to_dict(),
                        "spent": float(cost.total_cost),
                        "remaining": float(budget.amount - cost.total_cost),
                        "percentage_used": float(cost.total_cost / budget.amount * 100)
                        if budget.amount > 0
                        else 0,
                    }
                )

        # User budgets
        for budget in await self._get_user_budgets_from_redis(user_id):
            period_start = self._get_period_start(budget.period)
            cost = await tracker.get_user_cost(user_id, since=period_start)
            statuses.append(
                {
                    "budget": budget.to_dict(),
                    "spent": float(cost.total_cost),
                    "remaining": float(budget.amount - cost.total_cost),
                    "percentage_used": float(cost.total_cost / budget.amount * 100)
                    if budget.amount > 0
                    else 0,
                    "period_start": period_start.isoformat(),
                }
            )

        return statuses


# Global instance
_alert_manager: CostAlertManager | None = None


def get_alert_manager() -> CostAlertManager:
    """Get the global alert manager instance."""
    global _alert_manager
    if _alert_manager is None:
        _alert_manager = CostAlertManager()
    return _alert_manager
