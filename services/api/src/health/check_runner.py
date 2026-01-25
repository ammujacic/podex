"""Check runner for executing health checks in workspace containers.

Handles command execution via compute service and output parsing.
"""

import time
from dataclasses import dataclass
from typing import Any

import structlog

from src.compute_client import compute_client
from src.health.parsers import parse_check_output

logger = structlog.get_logger()


@dataclass
class CheckResult:
    """Result of running a single health check."""

    check_id: str
    check_name: str
    category: str
    score: float
    weight: float
    success: bool
    details: dict[str, Any]
    error: str | None = None
    raw_output: str | None = None
    execution_time_ms: float = 0


class CheckRunner:
    """Runs health checks in workspace containers."""

    def __init__(self, workspace_id: str, user_id: str) -> None:
        """Initialize check runner.

        Args:
            workspace_id: ID of the workspace to run checks in
            user_id: ID of the user owning the workspace
        """
        self.workspace_id = workspace_id
        self.user_id = user_id

    async def run_check(
        self,
        check_id: str,
        check_name: str,
        category: str,
        command: str,
        working_directory: str | None,
        timeout: int,  # noqa: ASYNC109
        parse_mode: str,
        parse_config: dict[str, Any],
        weight: float,
    ) -> CheckResult:
        """Run a single health check.

        Args:
            check_id: Unique ID of the check
            check_name: Display name of the check
            category: Category (code_quality, security, etc.)
            command: Shell command to execute
            working_directory: Working directory (relative to workspace root)
            timeout: Command timeout in seconds
            parse_mode: How to parse output (exit_code, json, regex, line_count)
            parse_config: Configuration for the parser
            weight: Weight of this check in category score

        Returns:
            CheckResult with score and details
        """
        start_time = time.time()

        try:
            # Execute command in workspace
            result = await compute_client.exec_command(
                workspace_id=self.workspace_id,
                user_id=self.user_id,
                command=command,
                working_dir=working_directory,
                exec_timeout=timeout,
            )

            execution_time_ms = (time.time() - start_time) * 1000

            # Parse the output
            stdout = result.get("stdout", "")
            stderr = result.get("stderr", "")
            exit_code = result.get("exit_code", 1)

            # Combine output for parsing
            output = stdout if stdout else stderr

            # Parse output to get score
            score, details = parse_check_output(
                output=output,
                exit_code=exit_code,
                parse_mode=parse_mode,
                parse_config=parse_config,
            )

            logger.debug(
                "Health check completed",
                check_name=check_name,
                category=category,
                score=score,
                exit_code=exit_code,
                execution_time_ms=execution_time_ms,
            )

            return CheckResult(
                check_id=check_id,
                check_name=check_name,
                category=category,
                score=score,
                weight=weight,
                success=True,
                details=details,
                raw_output=output[:5000] if output else None,  # Limit stored output
                execution_time_ms=execution_time_ms,
            )

        except TimeoutError:
            execution_time_ms = (time.time() - start_time) * 1000
            logger.warning(
                "Health check timed out",
                check_name=check_name,
                category=category,
                timeout=timeout,
            )
            return CheckResult(
                check_id=check_id,
                check_name=check_name,
                category=category,
                score=0,
                weight=weight,
                success=False,
                details={"timed_out": True},
                error=f"Check timed out after {timeout} seconds",
                execution_time_ms=execution_time_ms,
            )

        except Exception as e:
            execution_time_ms = (time.time() - start_time) * 1000
            logger.exception(
                "Health check failed",
                check_name=check_name,
                category=category,
                error=str(e),
            )
            return CheckResult(
                check_id=check_id,
                check_name=check_name,
                category=category,
                score=0,
                weight=weight,
                success=False,
                details={"error": str(e)},
                error=str(e),
                execution_time_ms=execution_time_ms,
            )

    async def check_tool_available(self, tool_name: str) -> bool:
        """Check if a tool is available in the workspace.

        Args:
            tool_name: Name of the tool to check (e.g., "eslint", "ruff")

        Returns:
            True if tool is available
        """
        try:
            result = await compute_client.exec_command(
                workspace_id=self.workspace_id,
                user_id=self.user_id,
                command=f"which {tool_name} 2>/dev/null || command -v {tool_name} 2>/dev/null",
                exec_timeout=5,
            )
            exit_code: int = result.get("exit_code", 1)
        except Exception:
            return False
        else:
            return exit_code == 0
