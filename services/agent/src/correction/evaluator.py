"""Confidence evaluation for tool calls and actions."""

from dataclasses import dataclass
from typing import Any, ClassVar

import structlog

logger = structlog.get_logger()

# Confidence level thresholds
HIGH_CONFIDENCE_THRESHOLD = 0.8
MEDIUM_CONFIDENCE_THRESHOLD = 0.5

# Risk thresholds
HIGH_RISK_THRESHOLD = 0.6

# Score thresholds for quality checks
ARGUMENT_QUALITY_THRESHOLD = 0.8
HISTORICAL_SUCCESS_THRESHOLD = 0.8
CONTEXT_FIT_THRESHOLD = 0.9

# History settings
MAX_HISTORY_RESULTS = 100


@dataclass
class ConfidenceScore:
    """Confidence score for an action."""

    score: float  # 0-1
    reasons: list[str]
    should_proceed: bool
    needs_confirmation: bool

    @property
    def level(self) -> str:
        """Get confidence level as string."""
        if self.score >= HIGH_CONFIDENCE_THRESHOLD:
            return "high"
        elif self.score >= MEDIUM_CONFIDENCE_THRESHOLD:
            return "medium"
        else:
            return "low"


class ConfidenceEvaluator:
    """Evaluates confidence scores for tool calls and actions.

    Considers:
    - Tool type risk level
    - Parameter validation
    - Context appropriateness
    - Historical success rates
    """

    # Tool risk levels (higher = more risky)
    TOOL_RISK: ClassVar[dict[str, float]] = {
        "read_file": 0.1,
        "list_directory": 0.1,
        "search_code": 0.1,
        "write_file": 0.4,
        "run_command": 0.5,
        "git_commit": 0.3,
        "git_push": 0.6,
        "git_branch": 0.3,
        "create_pr": 0.5,
        "deploy_preview": 0.7,
        "delete_file": 0.8,
    }

    # Confirmation thresholds
    PROCEED_THRESHOLD = 0.5
    CONFIRMATION_THRESHOLD = 0.7

    def __init__(self) -> None:
        """Initialize evaluator."""
        self._success_history: dict[str, list[bool]] = {}

    def evaluate(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        context: dict[str, Any] | None = None,
    ) -> ConfidenceScore:
        """Evaluate confidence for a tool call.

        Args:
            tool_name: Tool being called
            arguments: Tool arguments
            context: Optional execution context

        Returns:
            ConfidenceScore with evaluation results
        """
        reasons = []
        score = 1.0

        # Factor 1: Tool risk level
        risk = self.TOOL_RISK.get(tool_name, 0.3)
        score -= risk * 0.3
        if risk >= HIGH_RISK_THRESHOLD:
            reasons.append(f"High-risk tool: {tool_name}")

        # Factor 2: Argument validation
        arg_score = self._evaluate_arguments(tool_name, arguments)
        score *= arg_score
        if arg_score < ARGUMENT_QUALITY_THRESHOLD:
            reasons.append("Some arguments may be incomplete")

        # Factor 3: Historical success rate
        history_score = self._get_historical_score(tool_name)
        score *= history_score
        if history_score < HISTORICAL_SUCCESS_THRESHOLD:
            reasons.append(f"Historical success rate: {history_score:.0%}")

        # Factor 4: Context appropriateness
        if context:
            context_score = self._evaluate_context(tool_name, arguments, context)
            score *= context_score
            if context_score < CONTEXT_FIT_THRESHOLD:
                reasons.append("Action may not fit current context")

        # Normalize score to 0-1
        score = max(0.0, min(1.0, score))

        # Determine if confirmation needed
        needs_confirmation = (
            score < self.CONFIRMATION_THRESHOLD
            or risk >= HIGH_RISK_THRESHOLD
            or tool_name in ("git_push", "delete_file", "deploy_preview")
        )

        return ConfidenceScore(
            score=score,
            reasons=reasons,
            should_proceed=score >= self.PROCEED_THRESHOLD,
            needs_confirmation=needs_confirmation,
        )

    def record_result(self, tool_name: str, success: bool) -> None:
        """Record a tool execution result for future confidence calculations.

        Args:
            tool_name: Tool that was executed
            success: Whether execution succeeded
        """
        if tool_name not in self._success_history:
            self._success_history[tool_name] = []

        self._success_history[tool_name].append(success)

        # Keep only last MAX_HISTORY_RESULTS results
        if len(self._success_history[tool_name]) > MAX_HISTORY_RESULTS:
            self._success_history[tool_name] = self._success_history[tool_name][
                -MAX_HISTORY_RESULTS:
            ]

    def _evaluate_arguments(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> float:
        """Evaluate argument quality.

        Args:
            tool_name: Tool name
            arguments: Tool arguments

        Returns:
            Score 0-1
        """
        score = 1.0

        # Check for empty required arguments
        required_args = {
            "write_file": ["path", "content"],
            "run_command": ["command"],
            "git_commit": ["message"],
            "git_push": [],
            "create_pr": ["title"],
        }

        required = required_args.get(tool_name, [])
        for arg in required:
            if arg not in arguments or not arguments[arg]:
                score -= 0.3

        # Check for suspicious patterns
        if tool_name == "run_command":
            command = arguments.get("command", "")
            # Dangerous patterns
            if any(p in command for p in ["rm -rf", "sudo", "chmod 777"]):
                score -= 0.4

        if tool_name == "write_file":
            path = arguments.get("path", "")
            # Sensitive file patterns
            if any(p in path for p in [".env", "credentials", "secret", "password"]):
                score -= 0.3

        return max(0.0, score)

    def _get_historical_score(self, tool_name: str) -> float:
        """Get historical success rate for a tool.

        Args:
            tool_name: Tool name

        Returns:
            Success rate 0-1
        """
        history = self._success_history.get(tool_name, [])
        if not history:
            return 0.9  # Default for unknown tools

        # Weight recent results more heavily
        weighted_sum = 0.0
        weight_total = 0.0

        for i, success in enumerate(reversed(history)):
            weight = 1.0 + (i * 0.1)  # Newer results have higher weight
            weighted_sum += (1.0 if success else 0.0) * weight
            weight_total += weight

        return weighted_sum / weight_total if weight_total > 0 else 0.9

    def _evaluate_context(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        context: dict[str, Any],
    ) -> float:
        """Evaluate if the action fits the current context.

        Args:
            tool_name: Tool name
            arguments: Tool arguments
            context: Execution context

        Returns:
            Score 0-1
        """
        score = 1.0

        # Check if writing to files that were just read
        if tool_name == "write_file":
            recently_read = context.get("recently_read_files", [])
            path = arguments.get("path", "")
            if path not in recently_read:
                score -= 0.1  # Writing to unread file is slightly suspicious

        # Check if running commands in wrong directory
        if tool_name == "run_command":
            expected_cwd = context.get("expected_cwd")
            actual_cwd = arguments.get("cwd")
            if expected_cwd and actual_cwd and expected_cwd != actual_cwd:
                score -= 0.2

        return max(0.0, score)
