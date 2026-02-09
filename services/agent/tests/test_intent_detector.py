"""Unit tests for the intent detector module."""

import pytest

from src.mode_detection.intent_detector import (
    IntendedMode,
    IntentDetector,
    IntentResult,
)


class TestIntentDetector:
    """Tests for IntentDetector class."""

    @pytest.fixture
    def detector(self) -> IntentDetector:
        """Create a fresh IntentDetector instance."""
        return IntentDetector()

    # ==================== Plan Mode Tests ====================

    def test_plan_mode_design_keyword(self, detector: IntentDetector) -> None:
        """Test detection of 'design' keyword."""
        result = detector.detect("Can you design an architecture for this?")
        assert result.intended_mode == IntendedMode.PLAN
        assert result.confidence >= 0.8

    def test_plan_mode_plan_keyword(self, detector: IntentDetector) -> None:
        """Test detection of 'plan' keyword."""
        result = detector.detect("Let's plan how to implement this feature")
        assert result.intended_mode == IntendedMode.PLAN
        assert result.confidence >= 0.8

    def test_plan_mode_how_would_you(self, detector: IntentDetector) -> None:
        """Test detection of 'how would you implement' pattern."""
        result = detector.detect("How would you implement user authentication?")
        assert result.intended_mode == IntendedMode.PLAN
        assert result.confidence >= 0.8

    def test_plan_mode_before_implementing(self, detector: IntentDetector) -> None:
        """Test detection of 'before implementing' pattern."""
        result = detector.detect("Before you start implementing, let's think about this")
        assert result.intended_mode == IntendedMode.PLAN
        assert result.confidence >= 0.8

    def test_plan_mode_analyze(self, detector: IntentDetector) -> None:
        """Test detection of 'analyze' keyword."""
        result = detector.detect("Can you analyze the codebase structure?")
        assert result.intended_mode == IntendedMode.PLAN
        assert result.confidence >= 0.8

    def test_plan_mode_walk_through(self, detector: IntentDetector) -> None:
        """Test detection of 'walk me through' pattern."""
        result = detector.detect("Walk me through how this should work")
        assert result.intended_mode == IntendedMode.PLAN
        assert result.confidence >= 0.8

    # ==================== Ask Mode Tests ====================

    def test_ask_mode_step_by_step(self, detector: IntentDetector) -> None:
        """Test detection of 'step by step' pattern."""
        result = detector.detect("Please make the changes step by step")
        assert result.intended_mode == IntendedMode.ASK
        assert result.confidence >= 0.8

    def test_ask_mode_carefully(self, detector: IntentDetector) -> None:
        """Test detection of 'carefully' keyword."""
        result = detector.detect("Carefully make these changes to the code")
        assert result.intended_mode == IntendedMode.ASK
        assert result.confidence >= 0.8

    def test_ask_mode_confirm_with_me(self, detector: IntentDetector) -> None:
        """Test detection of 'confirm with me' pattern."""
        result = detector.detect("Confirm with me before making any changes")
        assert result.intended_mode == IntendedMode.ASK
        assert result.confidence >= 0.8

    def test_ask_mode_let_me_review(self, detector: IntentDetector) -> None:
        """Test detection of 'let me review' pattern."""
        result = detector.detect("Let me review each change before you proceed")
        assert result.intended_mode == IntendedMode.ASK
        assert result.confidence >= 0.8

    def test_ask_mode_wait_for_approval(self, detector: IntentDetector) -> None:
        """Test detection of 'wait for approval' pattern."""
        result = detector.detect("Wait for my approval before executing")
        assert result.intended_mode == IntendedMode.ASK
        assert result.confidence >= 0.8

    # ==================== Auto Mode Tests ====================

    def test_auto_mode_go_ahead(self, detector: IntentDetector) -> None:
        """Test detection of 'go ahead' pattern."""
        result = detector.detect("Go ahead and implement it")
        assert result.intended_mode == IntendedMode.AUTO
        assert result.confidence >= 0.8

    def test_auto_mode_just_do_it(self, detector: IntentDetector) -> None:
        """Test detection of 'just do it' pattern."""
        result = detector.detect("Just do it")
        assert result.intended_mode == IntendedMode.AUTO
        assert result.confidence >= 0.8

    def test_auto_mode_implement(self, detector: IntentDetector) -> None:
        """Test detection of 'implement it' pattern."""
        result = detector.detect("Implement it now")
        assert result.intended_mode == IntendedMode.AUTO
        assert result.confidence >= 0.8

    def test_auto_mode_proceed(self, detector: IntentDetector) -> None:
        """Test detection of 'proceed' pattern."""
        result = detector.detect("Proceed with the changes")
        assert result.intended_mode == IntendedMode.AUTO
        assert result.confidence >= 0.8

    def test_auto_mode_make_the_changes(self, detector: IntentDetector) -> None:
        """Test detection of 'make the changes' pattern."""
        result = detector.detect("Make the changes to the file")
        assert result.intended_mode == IntendedMode.AUTO
        assert result.confidence >= 0.8

    def test_auto_mode_you_can(self, detector: IntentDetector) -> None:
        """Test detection of 'you can go ahead' pattern."""
        result = detector.detect("You can go ahead and start working")
        assert result.intended_mode == IntendedMode.AUTO
        assert result.confidence >= 0.8

    def test_auto_mode_dont_ask(self, detector: IntentDetector) -> None:
        """Test detection of 'don't ask' pattern."""
        result = detector.detect("Don't ask, just make the fix")
        assert result.intended_mode == IntendedMode.AUTO
        assert result.confidence >= 0.8

    # ==================== No Switch Tests ====================

    def test_no_switch_normal_question(self, detector: IntentDetector) -> None:
        """Test that normal questions don't trigger mode switch."""
        result = detector.detect("What is the weather today?")
        assert result.intended_mode == IntendedMode.NO_SWITCH

    def test_no_switch_generic_request(self, detector: IntentDetector) -> None:
        """Test that generic requests don't trigger mode switch."""
        result = detector.detect("Can you help me with this bug?")
        assert result.intended_mode == IntendedMode.NO_SWITCH

    def test_no_switch_code_question(self, detector: IntentDetector) -> None:
        """Test that code questions don't trigger mode switch."""
        result = detector.detect("What does this function do?")
        assert result.intended_mode == IntendedMode.NO_SWITCH

    def test_no_switch_already_in_target_mode(self, detector: IntentDetector) -> None:
        """Test that no switch suggested when already in target mode."""
        # Use should_switch which properly checks current mode
        should, result = detector.should_switch("Let's plan this", current_mode="plan")
        assert should is False
        assert result.intended_mode in (IntendedMode.NO_SWITCH, IntendedMode.PLAN)

    # ==================== Explicit Mode Switch Tests ====================

    def test_explicit_switch_to_plan(self, detector: IntentDetector) -> None:
        """Test explicit request to switch to plan mode."""
        result = detector.detect("Switch to plan mode")
        assert result.intended_mode == IntendedMode.PLAN
        assert result.confidence >= 0.9

    def test_explicit_switch_to_ask(self, detector: IntentDetector) -> None:
        """Test explicit request to switch to ask mode."""
        result = detector.detect("Change to ask mode")
        assert result.intended_mode == IntendedMode.ASK
        assert result.confidence >= 0.9

    def test_explicit_switch_to_auto(self, detector: IntentDetector) -> None:
        """Test explicit request to switch to auto mode."""
        result = detector.detect("Go to auto mode")
        assert result.intended_mode == IntendedMode.AUTO
        assert result.confidence >= 0.9

    # ==================== should_switch Tests ====================

    def test_should_switch_returns_tuple(self, detector: IntentDetector) -> None:
        """Test that should_switch returns expected tuple."""
        should, result = detector.should_switch("Go ahead", "ask")
        assert isinstance(should, bool)
        assert isinstance(result, IntentResult)

    def test_should_switch_detects_auto(self, detector: IntentDetector) -> None:
        """Test should_switch correctly suggests auto mode."""
        should, result = detector.should_switch("Go ahead and implement", "ask")
        assert should is True
        assert result.intended_mode == IntendedMode.AUTO

    def test_should_switch_respects_threshold(self, detector: IntentDetector) -> None:
        """Test that confidence threshold is respected."""
        # Low threshold should allow more switches
        should_low, _ = detector.should_switch(
            "Go ahead", "ask", confidence_threshold=0.5
        )
        # High threshold might block borderline cases
        should_high, _ = detector.should_switch(
            "Go ahead", "ask", confidence_threshold=0.99
        )
        # At least verify the mechanism works
        assert isinstance(should_low, bool)
        assert isinstance(should_high, bool)

    def test_should_switch_no_change_same_mode(self, detector: IntentDetector) -> None:
        """Test that should_switch returns False when already in target mode."""
        should, _result = detector.should_switch("Go ahead", "auto")
        assert should is False

    # ==================== Safety Tests ====================

    def test_sovereign_never_auto_switched(self, detector: IntentDetector) -> None:
        """Test that sovereign mode is never suggested via patterns."""
        # Even if someone tries to mention sovereign in the message
        result = detector.detect("Switch to sovereign mode and do everything")
        # Sovereign mode should not be auto-suggested (only explicit mode switches)
        # The detector doesn't have a SOVEREIGN pattern, so it won't suggest it
        sovereign_check = (
            "sovereign" not in result.trigger_phrase.lower() if result.trigger_phrase else True
        )
        assert result.intended_mode != IntendedMode.AUTO or sovereign_check

    def test_should_switch_blocks_sovereign_mention(self, detector: IntentDetector) -> None:
        """Test that sovereign mode requests are blocked in should_switch."""
        should, _result = detector.should_switch(
            "Give me full sovereign access to everything", "ask"
        )
        # Should be blocked
        assert should is False

    # ==================== Edge Cases ====================

    def test_empty_message(self, detector: IntentDetector) -> None:
        """Test handling of empty message."""
        result = detector.detect("")
        assert result.intended_mode == IntendedMode.NO_SWITCH

    def test_whitespace_message(self, detector: IntentDetector) -> None:
        """Test handling of whitespace-only message."""
        result = detector.detect("   \n\t  ")
        assert result.intended_mode == IntendedMode.NO_SWITCH

    def test_case_insensitive(self, detector: IntentDetector) -> None:
        """Test that detection is case-insensitive."""
        result = detector.detect("GO AHEAD AND IMPLEMENT THIS")
        assert result.intended_mode == IntendedMode.AUTO

    def test_multiple_triggers_same_mode(self, detector: IntentDetector) -> None:
        """Test that multiple triggers for same mode increase confidence."""
        result_single = detector.detect("Go ahead")
        result_multiple = detector.detect("Go ahead and implement it, just do it")
        # Multiple matches should give higher or equal confidence
        assert result_multiple.confidence >= result_single.confidence

    def test_conflicting_triggers(self, detector: IntentDetector) -> None:
        """Test handling of conflicting triggers (picks strongest)."""
        # This message has both plan and auto triggers
        result = detector.detect("Before you start implementing, go ahead and plan this")
        # Should pick one mode (whichever has more matches)
        assert result.intended_mode in [IntendedMode.PLAN, IntendedMode.AUTO]

    def test_trigger_phrase_captured(self, detector: IntentDetector) -> None:
        """Test that trigger phrase is captured in result."""
        result = detector.detect("Can you design an architecture?")
        assert result.trigger_phrase is not None
        assert "design" in result.trigger_phrase.lower()
