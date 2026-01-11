"""End-to-end test runner for deployment verification."""

import asyncio
import json
import os
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from http import HTTPStatus
from pathlib import Path
from typing import Any

import aiohttp
import structlog

logger = structlog.get_logger()


@dataclass
class PlaywrightOptions:
    """Options for running Playwright tests."""

    pattern: str | None = None
    parallel: bool = True
    retries: int = 0
    timeout: int = 60000
    env_vars: dict[str, str] | None = None


class TestStatus(str, Enum):
    """Status of a test."""

    PENDING = "pending"
    RUNNING = "running"
    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"
    ERROR = "error"


@dataclass
class TestResult:
    """Result of a single test."""

    name: str
    status: TestStatus
    duration_ms: int = 0
    error: str | None = None
    stdout: str = ""
    stderr: str = ""
    assertions: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "name": self.name,
            "status": self.status.value,
            "duration_ms": self.duration_ms,
            "error": self.error,
            "assertions": self.assertions,
        }


@dataclass
class TestSuite:
    """A collection of test results."""

    name: str
    tests: list[TestResult] = field(default_factory=list)
    total: int = 0
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    errors: int = 0
    duration_ms: int = 0
    started_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    completed_at: datetime | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "name": self.name,
            "total": self.total,
            "passed": self.passed,
            "failed": self.failed,
            "skipped": self.skipped,
            "errors": self.errors,
            "duration_ms": self.duration_ms,
            "success_rate": (self.passed / self.total * 100) if self.total > 0 else 0,
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "tests": [t.to_dict() for t in self.tests],
        }


class E2ETestRunner:
    """Runs end-to-end tests against preview or production environments.

    Features:
    - Support for multiple test frameworks (Playwright, Cypress, Puppeteer)
    - Parallel test execution
    - Screenshot on failure
    - Test report generation
    - Retry logic for flaky tests
    """

    def __init__(
        self,
        workspace_path: str,
        framework: str = "auto",
        base_url: str | None = None,
    ) -> None:
        """Initialize E2E test runner.

        Args:
            workspace_path: Path to the workspace
            framework: Test framework (playwright, cypress, puppeteer, auto)
            base_url: Base URL for tests
        """
        self._workspace_path = Path(workspace_path)
        self._framework = framework
        self._base_url = base_url
        self._detected_framework: str | None = None

    async def detect_framework(self) -> str:
        """Detect the test framework used in the project."""
        if self._framework != "auto":
            return self._framework

        package_json = self._workspace_path / "package.json"
        if package_json.exists():
            content = json.loads(package_json.read_text())
            deps = {**content.get("dependencies", {}), **content.get("devDependencies", {})}

            if "@playwright/test" in deps or "playwright" in deps:
                self._detected_framework = "playwright"
            elif "cypress" in deps:
                self._detected_framework = "cypress"
            elif "puppeteer" in deps:
                self._detected_framework = "puppeteer"
            elif "jest" in deps:
                self._detected_framework = "jest"

        # Check for config files
        if not self._detected_framework:
            if (self._workspace_path / "playwright.config.ts").exists() or (
                self._workspace_path / "playwright.config.js"
            ).exists():
                self._detected_framework = "playwright"
            elif (self._workspace_path / "cypress.config.ts").exists() or (
                self._workspace_path / "cypress.config.js"
            ).exists():
                self._detected_framework = "cypress"

        return self._detected_framework or "unknown"

    async def run_tests(
        self,
        test_pattern: str | None = None,
        parallel: bool = True,
        retries: int = 0,
        timeout: int = 60000,
        env_vars: dict[str, str] | None = None,
    ) -> TestSuite:
        """Run E2E tests.

        Args:
            test_pattern: Pattern to filter tests (e.g., "login")
            parallel: Run tests in parallel
            retries: Number of retries for failed tests
            timeout: Test timeout in milliseconds
            env_vars: Additional environment variables

        Returns:
            Test suite with results
        """
        framework = await self.detect_framework()
        logger.info("Running E2E tests", framework=framework, pattern=test_pattern)

        suite = TestSuite(name=f"E2E Tests ({framework})")

        try:
            if framework == "playwright":
                playwright_opts = PlaywrightOptions(
                    pattern=test_pattern,
                    parallel=parallel,
                    retries=retries,
                    timeout=timeout,
                    env_vars=env_vars,
                )
                await self._run_playwright(suite, playwright_opts)
            elif framework == "cypress":
                await self._run_cypress(suite, test_pattern, parallel, env_vars)
            elif framework == "jest":
                await self._run_jest(suite, test_pattern, env_vars)
            else:
                # Fallback to npm test
                await self._run_npm_test(suite, env_vars)

        except Exception as e:
            suite.errors += 1
            suite.tests.append(
                TestResult(
                    name="Test Runner Error",
                    status=TestStatus.ERROR,
                    error=str(e),
                ),
            )
            logger.error("E2E test runner failed", error=str(e))

        suite.completed_at = datetime.now(UTC)
        suite.duration_ms = int((suite.completed_at - suite.started_at).total_seconds() * 1000)

        return suite

    async def _run_playwright(
        self,
        suite: TestSuite,
        options: PlaywrightOptions,
    ) -> None:
        """Run Playwright tests."""
        cmd = ["npx", "playwright", "test", "--reporter=json"]

        if options.pattern:
            cmd.extend(["-g", options.pattern])
        if not options.parallel:
            cmd.append("--workers=1")
        if options.retries > 0:
            cmd.extend(["--retries", str(options.retries)])
        cmd.extend(["--timeout", str(options.timeout)])

        env = self._prepare_env(options.env_vars)

        result = await self._execute_command(cmd, env)
        self._parse_playwright_output(suite, result["stdout"])

    async def _run_cypress(
        self,
        suite: TestSuite,
        pattern: str | None,
        _parallel: bool,
        env_vars: dict[str, str] | None,
    ) -> None:
        """Run Cypress tests."""
        cmd = ["npx", "cypress", "run", "--reporter", "json"]

        if pattern:
            cmd.extend(["--spec", f"**/*{pattern}*"])
        if self._base_url:
            cmd.extend(["--config", f"baseUrl={self._base_url}"])

        env = self._prepare_env(env_vars)

        result = await self._execute_command(cmd, env)
        self._parse_cypress_output(suite, result["stdout"])

    async def _run_jest(
        self,
        suite: TestSuite,
        pattern: str | None,
        env_vars: dict[str, str] | None,
    ) -> None:
        """Run Jest tests."""
        cmd = ["npx", "jest", "--json"]

        if pattern:
            cmd.append(pattern)

        env = self._prepare_env(env_vars)

        result = await self._execute_command(cmd, env)
        self._parse_jest_output(suite, result["stdout"])

    async def _run_npm_test(
        self,
        suite: TestSuite,
        env_vars: dict[str, str] | None,
    ) -> None:
        """Run npm test as fallback."""
        env = self._prepare_env(env_vars)

        result = await self._execute_command(["npm", "test"], env)

        # Basic parsing
        if result["returncode"] == 0:
            suite.passed = 1
            suite.total = 1
            suite.tests.append(
                TestResult(
                    name="npm test",
                    status=TestStatus.PASSED,
                    stdout=result["stdout"],
                ),
            )
        else:
            suite.failed = 1
            suite.total = 1
            suite.tests.append(
                TestResult(
                    name="npm test",
                    status=TestStatus.FAILED,
                    stdout=result["stdout"],
                    stderr=result["stderr"],
                    error="Tests failed",
                ),
            )

    def _prepare_env(self, env_vars: dict[str, str] | None) -> dict[str, str]:
        """Prepare environment variables."""
        env = os.environ.copy()
        if self._base_url:
            env["BASE_URL"] = self._base_url
            env["PLAYWRIGHT_BASE_URL"] = self._base_url
        if env_vars:
            env.update(env_vars)
        return env

    async def _execute_command(
        self,
        cmd: list[str],
        env: dict[str, str],
    ) -> dict[str, Any]:
        """Execute a command and capture output."""
        process = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(self._workspace_path),
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout, stderr = await process.communicate()

        return {
            "returncode": process.returncode,
            "stdout": stdout.decode("utf-8", errors="replace"),
            "stderr": stderr.decode("utf-8", errors="replace"),
        }

    def _parse_playwright_output(self, suite: TestSuite, output: str) -> None:
        """Parse Playwright JSON output."""
        try:
            # Find JSON in output
            json_match = re.search(r"\{.*\}", output, re.DOTALL)
            if not json_match:
                return

            data = json.loads(json_match.group())

            for suite_data in data.get("suites", []):
                for spec in suite_data.get("specs", []):
                    for test in spec.get("tests", []):
                        for result in test.get("results", []):
                            status = TestStatus.PASSED
                            if result.get("status") == "failed":
                                status = TestStatus.FAILED
                                suite.failed += 1
                            elif result.get("status") == "skipped":
                                status = TestStatus.SKIPPED
                                suite.skipped += 1
                            else:
                                suite.passed += 1

                            suite.total += 1
                            suite.tests.append(
                                TestResult(
                                    name=test.get("title", "Unknown"),
                                    status=status,
                                    duration_ms=result.get("duration", 0),
                                    error=result.get("error", {}).get("message")
                                    if result.get("error")
                                    else None,
                                ),
                            )

        except json.JSONDecodeError:
            logger.warning("Failed to parse Playwright output")

    def _parse_cypress_output(self, suite: TestSuite, output: str) -> None:
        """Parse Cypress JSON output."""
        try:
            json_match = re.search(r"\{.*\}", output, re.DOTALL)
            if not json_match:
                return

            data = json.loads(json_match.group())

            suite.total = data.get("totalTests", 0)
            suite.passed = data.get("totalPassed", 0)
            suite.failed = data.get("totalFailed", 0)
            suite.skipped = data.get("totalSkipped", 0)

            for run in data.get("runs", []):
                for test in run.get("tests", []):
                    status = TestStatus.PASSED
                    if test.get("state") == "failed":
                        status = TestStatus.FAILED
                    elif test.get("state") == "skipped":
                        status = TestStatus.SKIPPED

                    suite.tests.append(
                        TestResult(
                            name=" > ".join(test.get("title", ["Unknown"])),
                            status=status,
                            duration_ms=test.get("duration", 0),
                            error=test.get("displayError"),
                        ),
                    )

        except json.JSONDecodeError:
            logger.warning("Failed to parse Cypress output")

    def _parse_jest_output(self, suite: TestSuite, output: str) -> None:
        """Parse Jest JSON output."""
        try:
            json_match = re.search(r"\{.*\}", output, re.DOTALL)
            if not json_match:
                return

            data = json.loads(json_match.group())

            suite.total = data.get("numTotalTests", 0)
            suite.passed = data.get("numPassedTests", 0)
            suite.failed = data.get("numFailedTests", 0)

            for test_result in data.get("testResults", []):
                for assertion in test_result.get("assertionResults", []):
                    status = TestStatus.PASSED
                    if assertion.get("status") == "failed":
                        status = TestStatus.FAILED
                    elif assertion.get("status") == "pending":
                        status = TestStatus.SKIPPED

                    suite.tests.append(
                        TestResult(
                            name=assertion.get("fullName", "Unknown"),
                            status=status,
                            duration_ms=assertion.get("duration", 0),
                            error="\n".join(assertion.get("failureMessages", [])) or None,
                        ),
                    )

        except json.JSONDecodeError:
            logger.warning("Failed to parse Jest output")

    async def run_single_test(
        self,
        test_name: str,
        retries: int = 2,
    ) -> TestResult:
        """Run a single test with retries.

        Args:
            test_name: Name/pattern of test to run
            retries: Number of retries

        Returns:
            Test result
        """
        await self.detect_framework()

        for attempt in range(retries + 1):
            suite = await self.run_tests(test_pattern=test_name, retries=0)

            if suite.tests and suite.tests[0].status == TestStatus.PASSED:
                return suite.tests[0]

            if attempt < retries:
                logger.info(
                    "Retrying test",
                    test=test_name,
                    attempt=attempt + 1,
                    max_retries=retries,
                )
                await asyncio.sleep(1)

        return (
            suite.tests[0]
            if suite.tests
            else TestResult(
                name=test_name,
                status=TestStatus.ERROR,
                error="Test not found or runner error",
            )
        )


class HealthChecker:
    """Check health of deployed services."""

    def __init__(self, base_url: str) -> None:
        """Initialize health checker.

        Args:
            base_url: Base URL to check
        """
        self._base_url = base_url.rstrip("/")

    async def check_health(
        self,
        endpoints: list[str] | None = None,
        timeout: int = 10,
    ) -> dict[str, Any]:
        """Check health of endpoints.

        Args:
            endpoints: List of endpoints to check (default: ["/", "/health"])
            timeout: Timeout in seconds

        Returns:
            Health check results
        """
        if endpoints is None:
            endpoints = ["/", "/health", "/api/health"]

        checks_list: list[dict[str, Any]] = []
        results: dict[str, Any] = {
            "base_url": self._base_url,
            "healthy": True,
            "checks": checks_list,
        }

        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as session:
            for endpoint in endpoints:
                url = f"{self._base_url}{endpoint}"
                check = {
                    "endpoint": endpoint,
                    "url": url,
                    "status": "unknown",
                    "response_time_ms": 0,
                }

                try:
                    start = asyncio.get_event_loop().time()
                    async with session.get(url) as response:
                        check["response_time_ms"] = int(
                            (asyncio.get_event_loop().time() - start) * 1000,
                        )
                        check["status_code"] = response.status
                        check["status"] = (
                            "healthy" if response.status < HTTPStatus.BAD_REQUEST else "unhealthy"
                        )

                        if response.status >= HTTPStatus.BAD_REQUEST:
                            results["healthy"] = False

                except Exception as e:
                    check["status"] = "error"
                    check["error"] = str(e)
                    results["healthy"] = False

                results["checks"].append(check)

        return results

    async def wait_for_healthy(
        self,
        endpoint: str = "/health",
        timeout: int = 120,
        interval: int = 5,
    ) -> bool:
        """Wait for service to become healthy.

        Args:
            endpoint: Health endpoint to check
            timeout: Maximum wait time in seconds
            interval: Check interval in seconds

        Returns:
            True if healthy within timeout
        """
        url = f"{self._base_url}{endpoint}"
        start = asyncio.get_event_loop().time()

        while (asyncio.get_event_loop().time() - start) < timeout:
            try:
                async with (
                    aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as session,
                    session.get(url) as response,
                ):
                    if response.status < HTTPStatus.BAD_REQUEST:
                        logger.info("Service is healthy", url=url)
                        return True
            except Exception as e:
                logger.debug("Health check failed, retrying", url=url, error=str(e))

            await asyncio.sleep(interval)

        logger.warning("Service health check timed out", url=url, timeout=timeout)
        return False
