"""Budget alert management for cost tracking."""

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from enum import Enum
from typing import Any

from .realtime_tracker import CostBreakdown, get_cost_tracker

logger = logging.getLogger(__name__)

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


class CostAlertManager:
    """
    Manage budget alerts and notifications.

    Features:
    - User and session-level budgets
    - Configurable warning thresholds
    - Alert deduplication
    - Hard limit enforcement
    - Spending spike detection
    """

    def __init__(self) -> None:
        # User ID -> list of budgets
        self._user_budgets: dict[str, list[Budget]] = {}
        # Session ID -> budget
        self._session_budgets: dict[str, Budget] = {}
        # Alert history (alert_id -> BudgetAlert)
        self._alerts: dict[str, BudgetAlert] = {}
        # Alert callback
        self._alert_callback: Callable[[BudgetAlert], Awaitable[None]] | None = None
        # Sent alerts (for deduplication): (user_id, alert_type, budget_id) -> last_sent
        self._sent_alerts: dict[tuple[str, str, str | None], datetime] = {}
        # Alert cooldown (avoid spamming)
        self._alert_cooldown = timedelta(minutes=5)
        # Lock
        self._lock = asyncio.Lock()

    def set_alert_callback(self, callback: Callable[[BudgetAlert], Awaitable[None]]) -> None:
        """Set callback for alert notifications."""
        self._alert_callback = callback

    async def set_user_budget(self, budget: Budget) -> Budget:
        """Set a budget for a user."""
        async with self._lock:
            if budget.user_id not in self._user_budgets:
                self._user_budgets[budget.user_id] = []

            # Remove existing budget with same period
            self._user_budgets[budget.user_id] = [
                b for b in self._user_budgets[budget.user_id] if b.period != budget.period
            ]
            self._user_budgets[budget.user_id].append(budget)

            logger.info(
                "Set %s budget for user %s: $%s",
                budget.period,
                budget.user_id,
                budget.amount,
            )
            return budget

    async def set_session_budget(self, budget: Budget) -> Budget:
        """Set a budget for a session."""
        async with self._lock:
            if not budget.session_id:
                raise ValueError("session_id required")  # noqa: TRY003

            self._session_budgets[budget.session_id] = budget

            logger.info(
                "Set session budget for %s: $%s",
                budget.session_id,
                budget.amount,
            )
            return budget

    async def get_user_budgets(self, user_id: str) -> list[Budget]:
        """Get all budgets for a user."""
        async with self._lock:
            return self._user_budgets.get(user_id, []).copy()

    async def get_session_budget(self, session_id: str) -> Budget | None:
        """Get budget for a session."""
        async with self._lock:
            return self._session_budgets.get(session_id)

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
        async with self._lock:
            # Check user budgets
            for budget_user_id, budgets in self._user_budgets.items():
                for i, budget in enumerate(budgets):
                    if budget.id == budget_id:
                        # SECURITY: Verify ownership if user_id provided
                        if user_id and budget.user_id != user_id:
                            logger.warning(
                                "Budget ownership mismatch on delete",
                                extra={
                                    "budget_id": budget_id,
                                    "budget_owner": budget.user_id,
                                    "requesting_user": user_id,
                                },
                            )
                            return False
                        del self._user_budgets[budget_user_id][i]
                        return True

            # Check session budgets
            for session_id, budget in list(self._session_budgets.items()):
                if budget.id == budget_id:
                    # SECURITY: Verify ownership if user_id provided
                    if user_id and budget.user_id != user_id:
                        logger.warning(
                            "Session budget ownership mismatch on delete",
                            extra={
                                "budget_id": budget_id,
                                "budget_owner": budget.user_id,
                                "requesting_user": user_id,
                            },
                        )
                        return False
                    del self._session_budgets[session_id]
                    return True

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

        async with self._lock:
            tracker = get_cost_tracker()

            # Check session budget
            session_budget = self._session_budgets.get(session_id)
            if session_budget:
                session_cost = await tracker.get_session_cost(session_id)
                alert = self._check_single_budget(
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
            user_budgets = self._user_budgets.get(user_id, [])
            for budget in user_budgets:
                period_start = self._get_period_start(budget.period)
                user_cost = await tracker.get_user_cost(user_id, since=period_start)

                alert = self._check_single_budget(
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

    def _check_single_budget(
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

        # Check for deduplication
        alert_key: tuple[str, str, str | None] = (user_id, "budget_check", budget.id)
        last_sent = self._sent_alerts.get(alert_key)
        now = datetime.now(UTC)

        if last_sent and (now - last_sent) < self._alert_cooldown:
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
            self._alerts[alert.id] = alert
            self._sent_alerts[alert_key] = now

        return alert

    async def detect_spending_spike(
        self,
        user_id: str,
        _current_cost: Decimal,
        window_hours: int = 1,
    ) -> BudgetAlert | None:
        """Detect unusual spending spikes."""
        async with self._lock:
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

                self._alerts[alert.id] = alert

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
        async with self._lock:
            alerts = [
                a
                for a in self._alerts.values()
                if a.user_id == user_id and (include_acknowledged or not a.acknowledged)
            ]
            alerts.sort(key=lambda a: a.created_at, reverse=True)
            return alerts[:limit]

    async def acknowledge_alert(self, alert_id: str) -> bool:
        """Acknowledge an alert."""
        async with self._lock:
            if alert_id in self._alerts:
                self._alerts[alert_id].acknowledged = True
                self._alerts[alert_id].acknowledged_at = datetime.now(UTC)
                return True
            return False

    async def get_budget_status(
        self,
        user_id: str,
        session_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Get current status of all budgets."""
        async with self._lock:
            tracker = get_cost_tracker()
            statuses = []

            # Session budget
            if session_id:
                budget = self._session_budgets.get(session_id)
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
            for budget in self._user_budgets.get(user_id, []):
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
