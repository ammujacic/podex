"""Error analysis and correction using LLM."""

import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, TypedDict

import structlog

from src.providers.llm import CompletionRequest

if TYPE_CHECKING:
    from collections.abc import Callable

    from src.providers.llm import LLMProvider

logger = structlog.get_logger()


@dataclass
class ErrorCorrection:
    """Suggested correction for an error."""

    should_retry: bool
    corrected_arguments: dict[str, Any] | None
    explanation: str
    confidence: float
    alternative_approach: str | None = None


class CorrectionRecord(TypedDict):
    """Record of a correction attempt."""

    attempt: int
    original_args: dict[str, Any]
    corrected_args: dict[str, Any]
    explanation: str


class ExecutionResult(TypedDict, total=False):
    """Result from tool execution with optional correction info."""

    success: bool
    output: str
    error: str
    corrections_made: list[CorrectionRecord]
    correction_analysis: dict[str, str | None]


# Prompt for error analysis
ERROR_ANALYSIS_PROMPT = """Analyze this tool execution error and suggest a correction.

Tool: {tool_name}
Arguments: {arguments}
Error: {error}
Context: {context}

Provide your analysis in this JSON format:
{{
    "should_retry": true/false,
    "corrected_arguments": {{}} or null,
    "explanation": "Brief explanation of what went wrong",
    "confidence": 0.0-1.0,
    "alternative_approach": "Alternative way to achieve the goal" or null
}}

Guidelines:
- Set should_retry=true only if the error is fixable by changing arguments
- Provide corrected_arguments only if you can fix the issue
- Be specific about what was wrong and how to fix it
- Suggest alternative approaches if the original approach is fundamentally flawed

Respond with only valid JSON."""


class ErrorAnalyzer:
    """Analyzes errors and suggests corrections using LLM."""

    def __init__(self, llm_provider: "LLMProvider") -> None:
        """Initialize error analyzer.

        Args:
            llm_provider: LLM provider for analysis
        """
        self._llm = llm_provider

    async def analyze_and_correct(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        error: str,
        context: dict[str, Any] | None = None,
    ) -> ErrorCorrection:
        """Analyze an error and suggest corrections.

        Args:
            tool_name: Tool that failed
            arguments: Original arguments
            error: Error message
            context: Execution context

        Returns:
            ErrorCorrection with suggestions
        """
        # First try rule-based correction
        rule_correction = self._rule_based_correction(tool_name, arguments, error)
        if rule_correction:
            return rule_correction

        # Use LLM for more complex analysis
        prompt = ERROR_ANALYSIS_PROMPT.format(
            tool_name=tool_name,
            arguments=str(arguments),
            error=error,
            context=str(context or {}),
        )

        try:
            # Use the same model as the calling agent; ErrorAnalyzer should be
            # instantiated with an LLMProvider already configured for that model.
            model_value = context.get("model") if isinstance(context, dict) else None
            model_str = str(model_value) if model_value is not None else ""
            request = CompletionRequest(
                model=model_str,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=1024,
                temperature=0.3,
            )
            response = await self._llm.complete(request)

            content = response.get("content", "")

            # Parse JSON response
            try:
                # Handle markdown code blocks
                json_str = content
                if "```json" in content:
                    json_str = content.split("```json")[1].split("```")[0]
                elif "```" in content:
                    json_str = content.split("```")[1].split("```")[0]

                data = json.loads(json_str.strip())

                return ErrorCorrection(
                    should_retry=data.get("should_retry", False),
                    corrected_arguments=data.get("corrected_arguments"),
                    explanation=data.get("explanation", "Unknown error"),
                    confidence=data.get("confidence", 0.5),
                    alternative_approach=data.get("alternative_approach"),
                )

            except (json.JSONDecodeError, IndexError) as e:
                logger.warning("Failed to parse error analysis", error=str(e))
                return ErrorCorrection(
                    should_retry=False,
                    corrected_arguments=None,
                    explanation=f"Analysis failed: {error}",
                    confidence=0.3,
                )

        except Exception as e:
            logger.error("Error analysis failed", error=str(e))
            return ErrorCorrection(
                should_retry=False,
                corrected_arguments=None,
                explanation=f"Analysis unavailable: {e!s}",
                confidence=0.0,
            )

    def _check_file_not_found(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        error_lower: str,
    ) -> ErrorCorrection | None:
        """Check for file not found errors."""
        if ("not found" in error_lower or "no such file" in error_lower) and tool_name in (
            "read_file",
            "write_file",
        ):
            path = arguments.get("path", "")
            corrected_path = path.lstrip("/") if path.startswith("/") else "/" + path
            return ErrorCorrection(
                should_retry=True,
                corrected_arguments={**arguments, "path": corrected_path},
                explanation="File not found, trying alternative path format",
                confidence=0.6,
            )
        return None

    def _check_common_errors(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        error_lower: str,
    ) -> ErrorCorrection | None:
        """Check for common error patterns."""
        # Permission denied
        if "permission denied" in error_lower:
            return ErrorCorrection(
                should_retry=False,
                corrected_arguments=None,
                explanation="Permission denied - file may be read-only or in a protected directory",
                confidence=0.8,
                alternative_approach="Check file permissions or use a different location",
            )

        # Command not found
        if "command not found" in error_lower and tool_name == "run_command":
            command = arguments.get("command", "")
            parts = command.split()
            if parts:
                return ErrorCorrection(
                    should_retry=False,
                    corrected_arguments=None,
                    explanation=f"Command '{parts[0]}' not found - it may not be installed",
                    confidence=0.9,
                    alternative_approach=f"Install {parts[0]} or use an alternative command",
                )

        # Syntax errors
        if "syntax error" in error_lower or "syntaxerror" in error_lower:
            return ErrorCorrection(
                should_retry=False,
                corrected_arguments=None,
                explanation="Syntax error in code - review and fix the syntax",
                confidence=0.8,
                alternative_approach="Check for missing brackets, quotes, or typos",
            )

        return None

    def _check_transient_errors(
        self,
        arguments: dict[str, Any],
        error_lower: str,
    ) -> ErrorCorrection | None:
        """Check for transient/retryable errors."""
        if "timeout" in error_lower or "timed out" in error_lower:
            return ErrorCorrection(
                should_retry=True,
                corrected_arguments=arguments,
                explanation="Operation timed out - may succeed on retry",
                confidence=0.5,
            )

        if "connection" in error_lower and ("refused" in error_lower or "failed" in error_lower):
            return ErrorCorrection(
                should_retry=True,
                corrected_arguments=arguments,
                explanation="Connection failed - may be temporary",
                confidence=0.4,
            )

        return None

    def _check_git_errors(self, tool_name: str, error_lower: str) -> ErrorCorrection | None:
        """Check for git-specific errors."""
        if not tool_name.startswith("git_"):
            return None

        if "nothing to commit" in error_lower:
            return ErrorCorrection(
                should_retry=False,
                corrected_arguments=None,
                explanation="No changes to commit",
                confidence=0.95,
            )

        if "conflict" in error_lower:
            return ErrorCorrection(
                should_retry=False,
                corrected_arguments=None,
                explanation="Git conflict detected - manual resolution required",
                confidence=0.9,
                alternative_approach="Resolve conflicts manually before continuing",
            )

        return None

    def _rule_based_correction(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        error: str,
    ) -> ErrorCorrection | None:
        """Apply rule-based corrections for common errors.

        Args:
            tool_name: Tool that failed
            arguments: Original arguments
            error: Error message

        Returns:
            ErrorCorrection if a rule applies, None otherwise
        """
        error_lower = error.lower()

        # Check each error category in order
        checkers: list[Callable[[], ErrorCorrection | None]] = [
            lambda: self._check_file_not_found(tool_name, arguments, error_lower),
            lambda: self._check_common_errors(tool_name, arguments, error_lower),
            lambda: self._check_transient_errors(arguments, error_lower),
            lambda: self._check_git_errors(tool_name, error_lower),
        ]

        for checker in checkers:
            correction = checker()
            if correction is not None:
                return correction

        return None


class SelfCorrectingExecutor:
    """Executor that attempts self-correction on failures."""

    def __init__(
        self,
        tool_executor: Any,  # ToolExecutor
        error_analyzer: ErrorAnalyzer,
        max_correction_attempts: int = 2,
    ) -> None:
        """Initialize self-correcting executor.

        Args:
            tool_executor: Base tool executor
            error_analyzer: Error analyzer for corrections
            max_correction_attempts: Max correction attempts
        """
        self._executor = tool_executor
        self._analyzer = error_analyzer
        self._max_attempts = max_correction_attempts

    async def execute(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        context: dict[str, Any] | None = None,
    ) -> ExecutionResult:
        """Execute a tool with self-correction.

        Args:
            tool_name: Tool to execute
            arguments: Tool arguments
            context: Execution context

        Returns:
            Execution result with correction info
        """
        current_args = arguments
        corrections_made: list[CorrectionRecord] = []
        result: ExecutionResult = {"success": True, "output": ""}

        for attempt in range(self._max_attempts + 1):
            # Execute tool
            result_str: str = await self._executor.execute(tool_name, current_args)

            try:
                parsed: dict[str, Any] = json.loads(result_str)
                result = ExecutionResult(
                    success=parsed.get("success", True),
                    output=parsed.get("output", ""),
                    error=parsed.get("error", ""),
                )
            except json.JSONDecodeError:
                result = ExecutionResult(success=True, output=result_str)

            # Check if successful
            if result.get("success", True):
                if corrections_made:
                    result["corrections_made"] = corrections_made
                return result

            # Attempt correction
            if attempt < self._max_attempts:
                error = result.get("error", "Unknown error")
                correction = await self._analyzer.analyze_and_correct(
                    tool_name,
                    current_args,
                    str(error),
                    context,
                )

                if correction.should_retry and correction.corrected_arguments:
                    corrections_made.append(
                        CorrectionRecord(
                            attempt=attempt + 1,
                            original_args=current_args,
                            corrected_args=correction.corrected_arguments,
                            explanation=correction.explanation,
                        ),
                    )

                    current_args = correction.corrected_arguments

                    logger.info(
                        "Applying self-correction",
                        tool_name=tool_name,
                        attempt=attempt + 1,
                        explanation=correction.explanation,
                    )
                    continue

                # No correction possible
                result["correction_analysis"] = {
                    "explanation": correction.explanation,
                    "alternative_approach": correction.alternative_approach,
                }

            result["corrections_made"] = corrections_made
            return result

        return result
