"""Tests for correction modules.

Tests cover:
- Error handler (ErrorCorrection, ErrorAnalyzer, SelfCorrectingExecutor)
- Evaluator (ConfidenceScore, ConfidenceEvaluator)
- Retry logic (RetryConfig, RetryResult, RetryHandler)
"""

import pytest
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

from src.correction.evaluator import (
    ConfidenceScore,
    ConfidenceEvaluator,
    HIGH_CONFIDENCE_THRESHOLD,
    MEDIUM_CONFIDENCE_THRESHOLD,
    HIGH_RISK_THRESHOLD,
)
from src.correction.retry import (
    RetryConfig,
    RetryResult,
    RetryHandler,
    RetryableToolExecutor,
)
from src.correction.error_handler import (
    ErrorCorrection,
    ErrorAnalyzer,
    SelfCorrectingExecutor,
    CorrectionRecord,
    ExecutionResult,
)


class TestCorrectionModuleImports:
    """Test correction module imports."""

    def test_correction_module_exists(self):
        """Test correction module can be imported."""
        from src import correction
        assert correction is not None

    def test_error_handler_module_exists(self):
        """Test error_handler module can be imported."""
        from src.correction import error_handler
        assert error_handler is not None

    def test_evaluator_module_exists(self):
        """Test evaluator module can be imported."""
        from src.correction import evaluator
        assert evaluator is not None

    def test_retry_module_exists(self):
        """Test retry module can be imported."""
        from src.correction import retry
        assert retry is not None


class TestConfidenceScore:
    """Test ConfidenceScore dataclass."""

    def test_high_confidence_level(self):
        """Test high confidence level."""
        score = ConfidenceScore(
            score=0.9,
            reasons=["Valid path", "Safe operation"],
            should_proceed=True,
            needs_confirmation=False,
        )

        assert score.level == "high"
        assert score.should_proceed is True
        assert score.needs_confirmation is False

    def test_medium_confidence_level(self):
        """Test medium confidence level."""
        score = ConfidenceScore(
            score=0.6,
            reasons=["Partial match"],
            should_proceed=True,
            needs_confirmation=True,
        )

        assert score.level == "medium"
        assert score.should_proceed is True
        assert score.needs_confirmation is True

    def test_low_confidence_level(self):
        """Test low confidence level."""
        score = ConfidenceScore(
            score=0.3,
            reasons=["Unknown tool", "Risky operation"],
            should_proceed=False,
            needs_confirmation=True,
        )

        assert score.level == "low"
        assert score.should_proceed is False

    def test_boundary_high_confidence(self):
        """Test confidence at high threshold boundary."""
        score = ConfidenceScore(
            score=HIGH_CONFIDENCE_THRESHOLD,
            reasons=[],
            should_proceed=True,
            needs_confirmation=False,
        )

        assert score.level == "high"

    def test_boundary_medium_confidence(self):
        """Test confidence at medium threshold boundary."""
        score = ConfidenceScore(
            score=MEDIUM_CONFIDENCE_THRESHOLD,
            reasons=[],
            should_proceed=True,
            needs_confirmation=True,
        )

        assert score.level == "medium"

    def test_zero_confidence(self):
        """Test zero confidence score."""
        score = ConfidenceScore(
            score=0.0,
            reasons=["Completely unknown"],
            should_proceed=False,
            needs_confirmation=True,
        )

        assert score.level == "low"

    def test_max_confidence(self):
        """Test maximum confidence score."""
        score = ConfidenceScore(
            score=1.0,
            reasons=["Perfect match"],
            should_proceed=True,
            needs_confirmation=False,
        )

        assert score.level == "high"


class TestConfidenceEvaluator:
    """Test ConfidenceEvaluator class."""

    @pytest.fixture
    def evaluator(self) -> ConfidenceEvaluator:
        """Create test evaluator."""
        return ConfidenceEvaluator()

    def test_evaluator_initialization(self, evaluator: ConfidenceEvaluator):
        """Test evaluator initialization."""
        assert evaluator._success_history == {}

    def test_evaluate_low_risk_tool(self, evaluator: ConfidenceEvaluator):
        """Test evaluation of low-risk tool."""
        score = evaluator.evaluate(
            tool_name="read_file",
            arguments={"path": "/home/user/file.txt"},
        )

        assert score.score > 0.7  # Low risk should give high score
        assert score.should_proceed is True

    def test_evaluate_high_risk_tool(self, evaluator: ConfidenceEvaluator):
        """Test evaluation of high-risk tool."""
        score = evaluator.evaluate(
            tool_name="delete_file",
            arguments={"path": "/important/file.txt"},
        )

        assert score.score < 0.8  # High risk tool
        assert score.needs_confirmation is True

    def test_evaluate_unknown_tool(self, evaluator: ConfidenceEvaluator):
        """Test evaluation of unknown tool."""
        score = evaluator.evaluate(
            tool_name="unknown_tool",
            arguments={},
        )

        # Unknown tool gets default risk of 0.3
        assert 0.3 <= score.score <= 0.9

    def test_evaluate_with_context(self, evaluator: ConfidenceEvaluator):
        """Test evaluation with context."""
        score = evaluator.evaluate(
            tool_name="write_file",
            arguments={"path": "/home/user/test.txt", "content": "test"},
            context={"mode": "auto", "task": "write tests"},
        )

        assert score.score > 0  # Context shouldn't break evaluation

    def test_tool_risk_levels(self, evaluator: ConfidenceEvaluator):
        """Test tool risk level constants."""
        assert ConfidenceEvaluator.TOOL_RISK["read_file"] == 0.1
        assert ConfidenceEvaluator.TOOL_RISK["delete_file"] == 0.8
        assert ConfidenceEvaluator.TOOL_RISK["run_command"] == 0.5
        assert ConfidenceEvaluator.TOOL_RISK["git_push"] == 0.6

    def test_proceed_threshold(self, evaluator: ConfidenceEvaluator):
        """Test proceed threshold constant."""
        assert ConfidenceEvaluator.PROCEED_THRESHOLD == 0.5

    def test_confirmation_threshold(self, evaluator: ConfidenceEvaluator):
        """Test confirmation threshold constant."""
        assert ConfidenceEvaluator.CONFIRMATION_THRESHOLD == 0.7


class TestRetryConfig:
    """Test RetryConfig dataclass."""

    def test_default_values(self):
        """Test default configuration values."""
        config = RetryConfig()

        assert config.max_retries == 3
        assert config.base_delay == 1.0
        assert config.max_delay == 30.0
        assert config.exponential_base == 2.0
        assert config.jitter is True
        assert "timeout" in config.retryable_errors
        assert "connection" in config.retryable_errors

    def test_custom_values(self):
        """Test custom configuration values."""
        config = RetryConfig(
            max_retries=5,
            base_delay=2.0,
            max_delay=60.0,
            exponential_base=3.0,
            jitter=False,
            retryable_errors=["custom_error"],
        )

        assert config.max_retries == 5
        assert config.base_delay == 2.0
        assert config.max_delay == 60.0
        assert config.exponential_base == 3.0
        assert config.jitter is False
        assert config.retryable_errors == ["custom_error"]


class TestRetryResult:
    """Test RetryResult dataclass."""

    def test_successful_result(self):
        """Test successful retry result."""
        result = RetryResult(
            success=True,
            result={"data": "value"},
            attempts=1,
            total_delay=0.0,
            errors=[],
        )

        assert result.success is True
        assert result.result == {"data": "value"}
        assert result.attempts == 1
        assert result.total_delay == 0.0
        assert result.errors == []

    def test_failed_result(self):
        """Test failed retry result."""
        result = RetryResult(
            success=False,
            result=None,
            attempts=4,
            total_delay=15.5,
            errors=["timeout", "timeout", "connection", "timeout"],
        )

        assert result.success is False
        assert result.result is None
        assert result.attempts == 4
        assert result.total_delay == 15.5
        assert len(result.errors) == 4

    def test_result_with_partial_success(self):
        """Test result after retries succeeded."""
        result = RetryResult(
            success=True,
            result="done",
            attempts=3,
            total_delay=3.0,
            errors=["timeout", "connection"],
        )

        assert result.success is True
        assert result.attempts == 3
        assert len(result.errors) == 2  # 2 failures before success


class TestRetryHandler:
    """Test RetryHandler class."""

    @pytest.fixture
    def handler(self) -> RetryHandler:
        """Create test handler."""
        return RetryHandler()

    @pytest.fixture
    def custom_handler(self) -> RetryHandler:
        """Create handler with custom config."""
        config = RetryConfig(max_retries=2, base_delay=0.01)
        return RetryHandler(config=config)

    def test_handler_initialization(self, handler: RetryHandler):
        """Test handler initialization with defaults."""
        assert handler._config.max_retries == 3
        assert handler._on_retry is None

    def test_handler_with_custom_config(self, custom_handler: RetryHandler):
        """Test handler with custom config."""
        assert custom_handler._config.max_retries == 2

    async def test_execute_success_first_try(self, handler: RetryHandler):
        """Test successful execution on first try."""
        async def success_op():
            return {"success": True, "data": "result"}

        result = await handler.execute_with_retry(success_op)

        assert result.success is True
        assert result.attempts == 1
        assert result.errors == []

    async def test_execute_with_retry_callback(self):
        """Test handler with retry callback."""
        callback_calls = []

        async def on_retry(attempt: int, error: str, delay: float):
            callback_calls.append((attempt, error, delay))

        config = RetryConfig(max_retries=2, base_delay=0.01)
        handler = RetryHandler(config=config, on_retry=on_retry)

        call_count = 0

        async def failing_op():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                return {"success": False, "error": "timeout error"}
            return {"success": True}

        result = await handler.execute_with_retry(failing_op)

        assert result.success is True
        assert len(callback_calls) == 2


class TestRetryableToolExecutor:
    """Test RetryableToolExecutor class."""

    def test_executor_initialization(self):
        """Test executor initialization."""
        mock_executor = MagicMock()
        retryable = RetryableToolExecutor(tool_executor=mock_executor)

        assert retryable._executor == mock_executor
        assert retryable._retry_handler is not None

    def test_executor_with_custom_config(self):
        """Test executor with custom retry config."""
        mock_executor = MagicMock()
        config = RetryConfig(max_retries=5)
        retryable = RetryableToolExecutor(tool_executor=mock_executor, retry_config=config)

        assert retryable._retry_handler._config.max_retries == 5


class TestErrorCorrection:
    """Test ErrorCorrection class."""

    def test_error_correction_class_exists(self):
        """Test ErrorCorrection class exists."""
        assert ErrorCorrection is not None


class TestErrorAnalyzer:
    """Test ErrorAnalyzer class."""

    def test_error_analyzer_class_exists(self):
        """Test ErrorAnalyzer class exists."""
        assert ErrorAnalyzer is not None


class TestSelfCorrectingExecutor:
    """Test SelfCorrectingExecutor class."""

    def test_self_correcting_executor_class_exists(self):
        """Test SelfCorrectingExecutor class exists."""
        assert SelfCorrectingExecutor is not None


class TestCorrectionRecord:
    """Test CorrectionRecord dataclass."""

    def test_correction_record_type_exists(self):
        """Test CorrectionRecord type exists."""
        assert CorrectionRecord is not None


class TestExecutionResult:
    """Test ExecutionResult dataclass."""

    def test_execution_result_type_exists(self):
        """Test ExecutionResult type exists."""
        assert ExecutionResult is not None


class TestEvaluatorConstants:
    """Test evaluator module constants."""

    def test_high_confidence_threshold(self):
        """Test HIGH_CONFIDENCE_THRESHOLD value."""
        assert HIGH_CONFIDENCE_THRESHOLD == 0.8

    def test_medium_confidence_threshold(self):
        """Test MEDIUM_CONFIDENCE_THRESHOLD value."""
        assert MEDIUM_CONFIDENCE_THRESHOLD == 0.5

    def test_high_risk_threshold(self):
        """Test HIGH_RISK_THRESHOLD value."""
        assert HIGH_RISK_THRESHOLD == 0.6
