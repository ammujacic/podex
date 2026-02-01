"""Integration tests for error handler and self-correcting executor."""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from typing import Any


class TestErrorCorrection:
    """Tests for ErrorCorrection dataclass."""

    def test_error_correction_defaults(self) -> None:
        """Test ErrorCorrection default values."""
        from src.correction.error_handler import ErrorCorrection

        correction = ErrorCorrection(
            should_retry=False,
            corrected_arguments=None,
            explanation="Test error",
            confidence=0.5,
        )

        assert correction.should_retry is False
        assert correction.corrected_arguments is None
        assert correction.explanation == "Test error"
        assert correction.confidence == 0.5
        assert correction.alternative_approach is None

    def test_error_correction_with_alternative(self) -> None:
        """Test ErrorCorrection with alternative approach."""
        from src.correction.error_handler import ErrorCorrection

        correction = ErrorCorrection(
            should_retry=True,
            corrected_arguments={"path": "/new/path"},
            explanation="Path format fixed",
            confidence=0.8,
            alternative_approach="Try a different directory",
        )

        assert correction.should_retry is True
        assert correction.corrected_arguments == {"path": "/new/path"}
        assert correction.alternative_approach == "Try a different directory"


class TestErrorAnalyzer:
    """Tests for ErrorAnalyzer."""

    @pytest.mark.asyncio
    async def test_rule_based_file_not_found(self) -> None:
        """Test rule-based correction for file not found."""
        from src.correction.error_handler import ErrorAnalyzer

        mock_llm = MagicMock()
        analyzer = ErrorAnalyzer(mock_llm)

        correction = await analyzer.analyze_and_correct(
            tool_name="read_file",
            arguments={"path": "/workspace/file.py"},
            error="No such file or directory: /workspace/file.py",
        )

        assert correction.should_retry is True
        assert correction.corrected_arguments is not None
        assert "path" in correction.corrected_arguments
        assert correction.confidence == 0.6

    @pytest.mark.asyncio
    async def test_rule_based_permission_denied(self) -> None:
        """Test rule-based correction for permission denied."""
        from src.correction.error_handler import ErrorAnalyzer

        mock_llm = MagicMock()
        analyzer = ErrorAnalyzer(mock_llm)

        correction = await analyzer.analyze_and_correct(
            tool_name="write_file",
            arguments={"path": "/etc/passwd", "content": "test"},
            error="Permission denied: /etc/passwd",
        )

        assert correction.should_retry is False
        assert correction.corrected_arguments is None
        assert correction.confidence == 0.8
        assert correction.alternative_approach is not None
        assert "permission" in correction.alternative_approach.lower()

    @pytest.mark.asyncio
    async def test_rule_based_command_not_found(self) -> None:
        """Test rule-based correction for command not found."""
        from src.correction.error_handler import ErrorAnalyzer

        mock_llm = MagicMock()
        analyzer = ErrorAnalyzer(mock_llm)

        correction = await analyzer.analyze_and_correct(
            tool_name="run_command",
            arguments={"command": "nonexistent_tool --version"},
            error="bash: nonexistent_tool: command not found",
        )

        assert correction.should_retry is False
        assert correction.confidence == 0.9
        assert "nonexistent_tool" in correction.explanation

    @pytest.mark.asyncio
    async def test_rule_based_syntax_error(self) -> None:
        """Test rule-based correction for syntax errors."""
        from src.correction.error_handler import ErrorAnalyzer

        mock_llm = MagicMock()
        analyzer = ErrorAnalyzer(mock_llm)

        correction = await analyzer.analyze_and_correct(
            tool_name="run_command",
            arguments={"command": "python script.py"},
            error="SyntaxError: invalid syntax on line 10",
        )

        assert correction.should_retry is False
        assert correction.confidence == 0.8
        assert "syntax" in correction.explanation.lower()

    @pytest.mark.asyncio
    async def test_rule_based_timeout(self) -> None:
        """Test rule-based correction for timeout errors."""
        from src.correction.error_handler import ErrorAnalyzer

        mock_llm = MagicMock()
        analyzer = ErrorAnalyzer(mock_llm)

        correction = await analyzer.analyze_and_correct(
            tool_name="run_command",
            arguments={"command": "sleep 100"},
            error="Operation timed out after 30 seconds",
        )

        assert correction.should_retry is True
        assert correction.confidence == 0.5

    @pytest.mark.asyncio
    async def test_rule_based_connection_refused(self) -> None:
        """Test rule-based correction for connection errors."""
        from src.correction.error_handler import ErrorAnalyzer

        mock_llm = MagicMock()
        analyzer = ErrorAnalyzer(mock_llm)

        correction = await analyzer.analyze_and_correct(
            tool_name="run_command",
            arguments={"command": "curl http://localhost:9999"},
            error="Connection refused to localhost:9999",
        )

        assert correction.should_retry is True
        assert correction.confidence == 0.4

    @pytest.mark.asyncio
    async def test_rule_based_git_nothing_to_commit(self) -> None:
        """Test rule-based correction for git errors."""
        from src.correction.error_handler import ErrorAnalyzer

        mock_llm = MagicMock()
        analyzer = ErrorAnalyzer(mock_llm)

        correction = await analyzer.analyze_and_correct(
            tool_name="git_commit",
            arguments={"message": "Test commit"},
            error="nothing to commit, working tree clean",
        )

        assert correction.should_retry is False
        assert correction.confidence == 0.95

    @pytest.mark.asyncio
    async def test_rule_based_git_conflict(self) -> None:
        """Test rule-based correction for git conflicts."""
        from src.correction.error_handler import ErrorAnalyzer

        mock_llm = MagicMock()
        analyzer = ErrorAnalyzer(mock_llm)

        correction = await analyzer.analyze_and_correct(
            tool_name="git_merge",
            arguments={"branch": "feature"},
            error="Merge conflict in file.py",
        )

        assert correction.should_retry is False
        assert correction.confidence == 0.9
        assert correction.alternative_approach is not None
        assert "conflict" in correction.alternative_approach.lower()

    @pytest.mark.asyncio
    async def test_llm_based_correction_success(self) -> None:
        """Test LLM-based correction when no rule matches."""
        from src.correction.error_handler import ErrorAnalyzer

        mock_llm = MagicMock()
        mock_llm.complete = AsyncMock(
            return_value={
                "content": json.dumps(
                    {
                        "should_retry": True,
                        "corrected_arguments": {"param": "fixed_value"},
                        "explanation": "Fixed the parameter format",
                        "confidence": 0.7,
                        "alternative_approach": None,
                    }
                )
            }
        )

        analyzer = ErrorAnalyzer(mock_llm)

        correction = await analyzer.analyze_and_correct(
            tool_name="custom_tool",
            arguments={"param": "wrong_value"},
            error="Invalid parameter format",
            context={"model": "claude-sonnet-4-20250514"},
        )

        assert correction.should_retry is True
        assert correction.corrected_arguments == {"param": "fixed_value"}
        assert correction.confidence == 0.7

    @pytest.mark.asyncio
    async def test_llm_based_correction_with_markdown(self) -> None:
        """Test LLM-based correction with markdown code blocks."""
        from src.correction.error_handler import ErrorAnalyzer

        mock_llm = MagicMock()
        mock_llm.complete = AsyncMock(
            return_value={
                "content": """Here's the analysis:
```json
{
    "should_retry": false,
    "corrected_arguments": null,
    "explanation": "Cannot fix this error",
    "confidence": 0.3,
    "alternative_approach": "Try a different approach"
}
```"""
            }
        )

        analyzer = ErrorAnalyzer(mock_llm)

        correction = await analyzer.analyze_and_correct(
            tool_name="custom_tool",
            arguments={"param": "value"},
            error="Unknown error",
        )

        assert correction.should_retry is False
        assert correction.alternative_approach == "Try a different approach"

    @pytest.mark.asyncio
    async def test_llm_based_correction_invalid_json(self) -> None:
        """Test LLM-based correction with invalid JSON response."""
        from src.correction.error_handler import ErrorAnalyzer

        mock_llm = MagicMock()
        mock_llm.complete = AsyncMock(
            return_value={"content": "This is not valid JSON"}
        )

        analyzer = ErrorAnalyzer(mock_llm)

        correction = await analyzer.analyze_and_correct(
            tool_name="custom_tool",
            arguments={"param": "value"},
            error="Unknown error",
        )

        assert correction.should_retry is False
        assert correction.confidence == 0.3

    @pytest.mark.asyncio
    async def test_llm_based_correction_exception(self) -> None:
        """Test LLM-based correction when LLM call fails."""
        from src.correction.error_handler import ErrorAnalyzer

        mock_llm = MagicMock()
        mock_llm.complete = AsyncMock(side_effect=Exception("API Error"))

        analyzer = ErrorAnalyzer(mock_llm)

        correction = await analyzer.analyze_and_correct(
            tool_name="custom_tool",
            arguments={"param": "value"},
            error="Unknown error",
        )

        assert correction.should_retry is False
        assert correction.confidence == 0.0
        assert "unavailable" in correction.explanation.lower()


class TestSelfCorrectingExecutor:
    """Tests for SelfCorrectingExecutor."""

    @pytest.mark.asyncio
    async def test_execute_success_no_correction(self) -> None:
        """Test successful execution without correction."""
        from src.correction.error_handler import SelfCorrectingExecutor, ErrorAnalyzer

        mock_executor = MagicMock()
        mock_executor.execute = AsyncMock(
            return_value=json.dumps({"success": True, "output": "Command executed"})
        )

        mock_llm = MagicMock()
        analyzer = ErrorAnalyzer(mock_llm)
        correcting_executor = SelfCorrectingExecutor(mock_executor, analyzer)

        result = await correcting_executor.execute(
            tool_name="run_command",
            arguments={"command": "ls -la"},
        )

        assert result["success"] is True
        assert result["output"] == "Command executed"
        assert "corrections_made" not in result

    @pytest.mark.asyncio
    async def test_execute_with_correction(self) -> None:
        """Test execution with successful correction."""
        from src.correction.error_handler import SelfCorrectingExecutor, ErrorAnalyzer

        # First call fails, second succeeds
        mock_executor = MagicMock()
        call_count = 0

        async def mock_execute(tool_name: str, args: dict[str, Any]) -> str:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return json.dumps(
                    {"success": False, "error": "File not found: /wrong/path"}
                )
            return json.dumps({"success": True, "output": "File content"})

        mock_executor.execute = mock_execute

        mock_llm = MagicMock()
        analyzer = ErrorAnalyzer(mock_llm)
        correcting_executor = SelfCorrectingExecutor(mock_executor, analyzer)

        result = await correcting_executor.execute(
            tool_name="read_file",
            arguments={"path": "/wrong/path"},
        )

        assert result["success"] is True
        assert "corrections_made" in result
        assert len(result["corrections_made"]) == 1

    @pytest.mark.asyncio
    async def test_execute_max_attempts_exceeded(self) -> None:
        """Test execution when max correction attempts exceeded."""
        from src.correction.error_handler import (
            SelfCorrectingExecutor,
            ErrorAnalyzer,
            ErrorCorrection,
        )

        mock_executor = MagicMock()
        mock_executor.execute = AsyncMock(
            return_value=json.dumps({"success": False, "error": "Persistent error"})
        )

        mock_llm = MagicMock()
        analyzer = ErrorAnalyzer(mock_llm)

        # Mock analyze_and_correct to always suggest retry
        analyzer.analyze_and_correct = AsyncMock(
            return_value=ErrorCorrection(
                should_retry=True,
                corrected_arguments={"path": "/another/path"},
                explanation="Try different path",
                confidence=0.5,
            )
        )

        correcting_executor = SelfCorrectingExecutor(
            mock_executor, analyzer, max_correction_attempts=2
        )

        result = await correcting_executor.execute(
            tool_name="read_file",
            arguments={"path": "/wrong/path"},
        )

        assert result["success"] is False
        assert "corrections_made" in result
        # Should have made 2 correction attempts
        assert len(result["corrections_made"]) == 2

    @pytest.mark.asyncio
    async def test_execute_no_correction_possible(self) -> None:
        """Test execution when no correction is possible."""
        from src.correction.error_handler import (
            SelfCorrectingExecutor,
            ErrorAnalyzer,
            ErrorCorrection,
        )

        mock_executor = MagicMock()
        mock_executor.execute = AsyncMock(
            return_value=json.dumps({"success": False, "error": "Permission denied"})
        )

        mock_llm = MagicMock()
        analyzer = ErrorAnalyzer(mock_llm)

        correcting_executor = SelfCorrectingExecutor(mock_executor, analyzer)

        result = await correcting_executor.execute(
            tool_name="write_file",
            arguments={"path": "/etc/passwd", "content": "test"},
        )

        assert result["success"] is False
        assert "correction_analysis" in result
        assert "explanation" in result["correction_analysis"]

    @pytest.mark.asyncio
    async def test_execute_non_json_result(self) -> None:
        """Test execution with non-JSON result."""
        from src.correction.error_handler import SelfCorrectingExecutor, ErrorAnalyzer

        mock_executor = MagicMock()
        mock_executor.execute = AsyncMock(return_value="Plain text output")

        mock_llm = MagicMock()
        analyzer = ErrorAnalyzer(mock_llm)
        correcting_executor = SelfCorrectingExecutor(mock_executor, analyzer)

        result = await correcting_executor.execute(
            tool_name="run_command",
            arguments={"command": "echo hello"},
        )

        assert result["success"] is True
        assert result["output"] == "Plain text output"


class TestFileNotFoundCorrection:
    """Detailed tests for file not found corrections."""

    @pytest.mark.asyncio
    async def test_absolute_to_relative_path(self) -> None:
        """Test converting absolute to relative path."""
        from src.correction.error_handler import ErrorAnalyzer

        mock_llm = MagicMock()
        analyzer = ErrorAnalyzer(mock_llm)

        correction = await analyzer.analyze_and_correct(
            tool_name="read_file",
            arguments={"path": "/workspace/src/file.py"},
            error="No such file or directory",
        )

        assert correction.should_retry is True
        assert correction.corrected_arguments is not None
        # Should strip leading slash
        assert correction.corrected_arguments["path"] == "workspace/src/file.py"

    @pytest.mark.asyncio
    async def test_relative_to_absolute_path(self) -> None:
        """Test converting relative to absolute path."""
        from src.correction.error_handler import ErrorAnalyzer

        mock_llm = MagicMock()
        analyzer = ErrorAnalyzer(mock_llm)

        correction = await analyzer.analyze_and_correct(
            tool_name="read_file",
            arguments={"path": "src/file.py"},
            error="File not found: src/file.py",
        )

        assert correction.should_retry is True
        assert correction.corrected_arguments is not None
        # Should add leading slash
        assert correction.corrected_arguments["path"] == "/src/file.py"


class TestGitErrorCorrection:
    """Tests for git-specific error corrections."""

    @pytest.mark.asyncio
    async def test_non_git_tool_no_git_rules(self) -> None:
        """Test that non-git tools don't trigger git rules."""
        from src.correction.error_handler import ErrorAnalyzer

        mock_llm = MagicMock()
        mock_llm.complete = AsyncMock(
            return_value={
                "content": json.dumps(
                    {
                        "should_retry": False,
                        "corrected_arguments": None,
                        "explanation": "Unknown error",
                        "confidence": 0.5,
                    }
                )
            }
        )

        analyzer = ErrorAnalyzer(mock_llm)

        # Error message contains "nothing to commit" but tool is not git
        correction = await analyzer.analyze_and_correct(
            tool_name="run_command",
            arguments={"command": "echo nothing to commit"},
            error="nothing to commit",
        )

        # Should fall through to LLM analysis, not git rules
        assert mock_llm.complete.called
