"""Intent detection for automatic agent mode switching.

This module detects user intent to switch agent modes based on message content.
Uses a hybrid approach: fast keyword-based detection first, with optional LLM
fallback for ambiguous cases.
"""

import logging
import re
from dataclasses import dataclass
from enum import Enum

try:
    import structlog

    logger = structlog.get_logger()
except ImportError:
    # Fall back to standard logging if structlog not available
    logger = logging.getLogger(__name__)


class IntendedMode(str, Enum):
    """Detected intended mode from user message."""

    PLAN = "plan"
    ASK = "ask"
    AUTO = "auto"
    NO_SWITCH = "no_switch"  # No mode switch detected


@dataclass
class IntentResult:
    """Result of intent detection."""

    intended_mode: IntendedMode
    confidence: float  # 0-1
    trigger_phrase: str | None = None
    reason: str | None = None


# Pattern-based triggers for each mode
# Using word boundaries (\b) to avoid partial matches

PLAN_PATTERNS = [
    # Direct planning requests
    r"\b(plan|design|architect|outline)\s+(how|the|an?|this)",
    r"\b(create|make|write)\s+(a\s+)?(plan|design|architecture)",
    r"\bhow\s+would\s+you\s+(implement|approach|design|build)",
    r"\b(think\s+through|break\s+down|analyze)\s+(how|the|this)",
    # Planning mode triggers
    r"\bbefore\s+(you\s+)?(start|implement|begin|code)",
    r"\blet'?s?\s+(think|plan|design|analyze)",
    r"\bwhat'?s?\s+(the\s+)?(approach|strategy|plan)",
    r"\bwalk\s+me\s+through",
    r"\bexplore\s+(the\s+)?(options|approaches|ways)",
]

ASK_PATTERNS = [
    # Careful/verification requests
    r"\b(carefully|cautiously)\s+(make|do|implement|change)",
    r"\bstep\s+by\s+step",
    r"\bone\s+(at\s+a\s+time|thing\s+at\s+a\s+time)",
    r"\b(confirm|verify|check)\s+(with\s+me|each|before|first)",
    r"\bask\s+(me\s+)?(before|first)",
    r"\bwait\s+for\s+(my\s+)?(approval|confirmation)",
    r"\bshow\s+me\s+(first|before)",
    r"\blet\s+me\s+(review|see|approve)",
    r"\bneed\s+to\s+(see|review|approve)",
]

AUTO_PATTERNS = [
    # Execution requests
    r"\bgo\s+ahead(\s+and)?",
    r"\bjust\s+(do\s+it|implement|make|fix)",
    r"\b(do|implement|execute|run|make)\s+it",
    r"\bproceed(\s+with)?",
    r"\bstart\s+(working|implementing|coding)",
    # Permission grants
    r"\byou\s+can\s+(go\s+ahead|start|proceed|do)",
    r"\bfeel\s+free\s+to",
    r"\bdon'?t\s+(need\s+to\s+)?(ask|wait|confirm)",
    r"\bmake\s+the\s+changes",
    r"\bapply\s+(the\s+)?(changes|fix|update)",
]

# Patterns that indicate explicit mode requests (override detection)
EXPLICIT_MODE_PATTERNS = {
    "plan": r"\b(switch|change|go)\s+(to\s+)?plan\s+mode",
    "ask": r"\b(switch|change|go)\s+(to\s+)?ask\s+mode",
    "auto": r"\b(switch|change|go)\s+(to\s+)?auto\s+mode",
}


class IntentDetector:
    """Detects user intent for mode switching.

    Uses pattern-based detection for fast, reliable intent classification.
    Supports explicit mode requests and contextual triggers.
    """

    def __init__(self) -> None:
        """Initialize the intent detector."""
        # Compile patterns for better performance
        self._plan_patterns = [re.compile(p, re.IGNORECASE) for p in PLAN_PATTERNS]
        self._ask_patterns = [re.compile(p, re.IGNORECASE) for p in ASK_PATTERNS]
        self._auto_patterns = [re.compile(p, re.IGNORECASE) for p in AUTO_PATTERNS]
        self._explicit_patterns = {
            mode: re.compile(p, re.IGNORECASE) for mode, p in EXPLICIT_MODE_PATTERNS.items()
        }

    def detect(self, message: str, current_mode: str | None = None) -> IntentResult:
        """Detect user intent for mode switching.

        Args:
            message: The user message to analyze.
            current_mode: The agent's current mode (for context).

        Returns:
            IntentResult with detected mode and confidence.
        """
        # First check for explicit mode requests (highest confidence)
        explicit_result = self._check_explicit_mode_request(message)
        if explicit_result:
            return explicit_result

        # Check pattern-based triggers
        pattern_result = self._check_patterns(message, current_mode)
        if pattern_result.intended_mode != IntendedMode.NO_SWITCH:
            return pattern_result

        return IntentResult(
            intended_mode=IntendedMode.NO_SWITCH,
            confidence=1.0,
            reason="No mode switch intent detected",
        )

    def _check_explicit_mode_request(self, message: str) -> IntentResult | None:
        """Check for explicit mode switch requests.

        Args:
            message: The user message.

        Returns:
            IntentResult if explicit request found, None otherwise.
        """
        for mode, pattern in self._explicit_patterns.items():
            match = pattern.search(message)
            if match:
                return IntentResult(
                    intended_mode=IntendedMode(mode),
                    confidence=0.95,
                    trigger_phrase=match.group(0),
                    reason="Explicit mode switch request",
                )
        return None

    def _check_patterns(self, message: str, current_mode: str | None = None) -> IntentResult:
        """Check pattern-based triggers for mode switching.

        Args:
            message: The user message.
            current_mode: The agent's current mode.

        Returns:
            IntentResult with detected mode and confidence.
        """
        # Track all matches for potential conflict resolution
        matches: dict[IntendedMode, list[tuple[str, float]]] = {
            IntendedMode.PLAN: [],
            IntendedMode.ASK: [],
            IntendedMode.AUTO: [],
        }

        # Check PLAN patterns
        for pattern in self._plan_patterns:
            match = pattern.search(message)
            if match:
                matches[IntendedMode.PLAN].append((match.group(0), 0.85))

        # Check ASK patterns
        for pattern in self._ask_patterns:
            match = pattern.search(message)
            if match:
                matches[IntendedMode.ASK].append((match.group(0), 0.85))

        # Check AUTO patterns
        for pattern in self._auto_patterns:
            match = pattern.search(message)
            if match:
                matches[IntendedMode.AUTO].append((match.group(0), 0.85))

        # Find the mode with most matches (if any)
        best_mode = IntendedMode.NO_SWITCH
        best_confidence = 0.0
        best_trigger = None

        for mode, mode_matches in matches.items():
            if mode_matches:
                # More matches = higher confidence
                confidence = min(0.95, 0.85 + (len(mode_matches) - 1) * 0.05)
                if confidence > best_confidence:
                    best_mode = mode
                    best_confidence = confidence
                    best_trigger = mode_matches[0][0]  # Use first match as trigger

        if best_mode == IntendedMode.NO_SWITCH:
            return IntentResult(
                intended_mode=IntendedMode.NO_SWITCH,
                confidence=1.0,
            )

        # Don't suggest switching to current mode
        if current_mode and best_mode.value == current_mode:
            return IntentResult(
                intended_mode=IntendedMode.NO_SWITCH,
                confidence=1.0,
                reason=f"Already in {current_mode} mode",
            )

        return IntentResult(
            intended_mode=best_mode,
            confidence=best_confidence,
            trigger_phrase=best_trigger,
            reason="Pattern trigger detected",
        )

    def should_switch(
        self,
        message: str,
        current_mode: str,
        confidence_threshold: float = 0.8,
    ) -> tuple[bool, IntentResult]:
        """Determine if mode should switch based on message.

        This is the main entry point for the mode switching logic.
        Includes safety checks (e.g., never auto-switch to sovereign).

        Args:
            message: The user message.
            current_mode: The agent's current mode.
            confidence_threshold: Minimum confidence to trigger switch.

        Returns:
            Tuple of (should_switch, result).
        """
        result = self.detect(message, current_mode)

        # Safety: Never auto-switch to sovereign mode
        if result.intended_mode == IntendedMode.AUTO:
            # Check if message mentions sovereign - block it
            if re.search(r"\bsovereign\b", message, re.IGNORECASE):
                logger.info(
                    "Blocked auto-switch to sovereign mode",
                    message_preview=message[:100],
                )
                return False, IntentResult(
                    intended_mode=IntendedMode.NO_SWITCH,
                    confidence=1.0,
                    reason="Sovereign mode requires manual activation",
                )

        # Check if we should switch
        should_switch = (
            result.intended_mode != IntendedMode.NO_SWITCH
            and result.confidence >= confidence_threshold
            and result.intended_mode.value != current_mode
        )

        return should_switch, result
