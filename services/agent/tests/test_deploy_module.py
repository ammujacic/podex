"""Tests for deploy module.

Tests cover:
- Deploy preview (PreviewManager, PreviewConfig, PreviewStatus)
- E2E deployment (E2ETestRunner, TestResult, TestSuite)
- Environment variable sanitization
- Security validations
"""

from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.deploy.e2e import (
    E2ETestRunner,
    HealthChecker,
    PlaywrightOptions,
    TestResult,
    TestStatus,
    TestSuite,
)
from src.deploy.preview import (
    PreviewConfig,
    PreviewEnvironment,
    PreviewManager,
    PreviewStatus,
    _sanitize_env_vars,
    _validate_command,
    _DANGEROUS_ENV_VARS,
    _DANGEROUS_PATTERNS,
)


class TestDeployModuleImports:
    """Test deploy module imports."""

    def test_deploy_module_exists(self):
        """Test deploy module can be imported."""
        from src import deploy
        assert deploy is not None

    def test_preview_module_exists(self):
        """Test preview module can be imported."""
        from src.deploy import preview
        assert preview is not None

    def test_e2e_module_exists(self):
        """Test e2e module can be imported."""
        from src.deploy import e2e
        assert e2e is not None


class TestPlaywrightOptions:
    """Test PlaywrightOptions dataclass."""

    def test_default_values(self):
        """Test default values for PlaywrightOptions."""
        options = PlaywrightOptions()

        assert options.pattern is None
        assert options.parallel is True
        assert options.retries == 0
        assert options.timeout == 60000
        assert options.env_vars is None

    def test_with_all_values(self):
        """Test PlaywrightOptions with all values set."""
        options = PlaywrightOptions(
            pattern="test_login",
            parallel=False,
            retries=3,
            timeout=120000,
            env_vars={"TEST_VAR": "value"},
        )

        assert options.pattern == "test_login"
        assert options.parallel is False
        assert options.retries == 3
        assert options.timeout == 120000
        assert options.env_vars == {"TEST_VAR": "value"}


class TestTestStatus:
    """Test TestStatus enum."""

    def test_all_statuses_exist(self):
        """Test all expected statuses exist."""
        assert TestStatus.PENDING == "pending"
        assert TestStatus.RUNNING == "running"
        assert TestStatus.PASSED == "passed"
        assert TestStatus.FAILED == "failed"
        assert TestStatus.SKIPPED == "skipped"
        assert TestStatus.ERROR == "error"

    def test_status_is_string(self):
        """Test that status values are strings."""
        assert isinstance(TestStatus.PASSED.value, str)
        assert isinstance(TestStatus.FAILED.value, str)


class TestTestResult:
    """Test TestResult dataclass."""

    def test_basic_creation(self):
        """Test basic TestResult creation."""
        result = TestResult(
            name="test_login",
            status=TestStatus.PASSED,
        )

        assert result.name == "test_login"
        assert result.status == TestStatus.PASSED
        assert result.duration_ms == 0
        assert result.error is None
        assert result.stdout == ""
        assert result.stderr == ""
        assert result.assertions == []

    def test_with_all_fields(self):
        """Test TestResult with all fields."""
        result = TestResult(
            name="test_login",
            status=TestStatus.FAILED,
            duration_ms=1500,
            error="Assertion failed",
            stdout="Login page loaded",
            stderr="Warning: slow response",
            assertions=[{"type": "visible", "passed": False}],
        )

        assert result.name == "test_login"
        assert result.status == TestStatus.FAILED
        assert result.duration_ms == 1500
        assert result.error == "Assertion failed"
        assert result.stdout == "Login page loaded"
        assert result.stderr == "Warning: slow response"
        assert len(result.assertions) == 1

    def test_to_dict(self):
        """Test TestResult to_dict method."""
        result = TestResult(
            name="test_login",
            status=TestStatus.PASSED,
            duration_ms=1000,
        )

        result_dict = result.to_dict()

        assert result_dict["name"] == "test_login"
        assert result_dict["status"] == "passed"
        assert result_dict["duration_ms"] == 1000
        assert result_dict["error"] is None

    def test_to_dict_with_error(self):
        """Test TestResult to_dict with error."""
        result = TestResult(
            name="test_failing",
            status=TestStatus.FAILED,
            error="Element not found",
        )

        result_dict = result.to_dict()

        assert result_dict["status"] == "failed"
        assert result_dict["error"] == "Element not found"


class TestTestSuite:
    """Test TestSuite dataclass."""

    def test_basic_creation(self):
        """Test basic TestSuite creation."""
        suite = TestSuite(name="login-tests")

        assert suite.name == "login-tests"
        assert suite.tests == []
        assert suite.total == 0
        assert suite.passed == 0
        assert suite.failed == 0
        assert suite.skipped == 0
        assert suite.errors == 0
        assert suite.duration_ms == 0
        assert suite.started_at is not None
        assert suite.completed_at is None

    def test_with_test_results(self):
        """Test TestSuite with test results."""
        test1 = TestResult(name="test_1", status=TestStatus.PASSED, duration_ms=100)
        test2 = TestResult(name="test_2", status=TestStatus.FAILED, duration_ms=200)

        suite = TestSuite(
            name="my-suite",
            tests=[test1, test2],
            total=2,
            passed=1,
            failed=1,
            duration_ms=300,
        )

        assert len(suite.tests) == 2
        assert suite.total == 2
        assert suite.passed == 1
        assert suite.failed == 1

    def test_to_dict(self):
        """Test TestSuite to_dict method."""
        suite = TestSuite(
            name="my-suite",
            total=10,
            passed=8,
            failed=2,
            duration_ms=5000,
        )

        suite_dict = suite.to_dict()

        assert suite_dict["name"] == "my-suite"
        assert suite_dict["total"] == 10
        assert suite_dict["passed"] == 8
        assert suite_dict["failed"] == 2
        assert suite_dict["success_rate"] == 80.0
        assert suite_dict["duration_ms"] == 5000

    def test_to_dict_success_rate_zero_total(self):
        """Test success rate calculation with zero total."""
        suite = TestSuite(name="empty-suite", total=0)

        suite_dict = suite.to_dict()

        assert suite_dict["success_rate"] == 0

    def test_to_dict_with_completed_at(self):
        """Test to_dict with completed_at set."""
        completed = datetime.now(UTC)
        suite = TestSuite(
            name="completed-suite",
            completed_at=completed,
        )

        suite_dict = suite.to_dict()

        assert suite_dict["completed_at"] is not None


class TestE2ETestRunner:
    """Test E2ETestRunner class."""

    def test_runner_initialization(self):
        """Test E2ETestRunner initialization."""
        runner = E2ETestRunner(
            workspace_path="/home/dev/project",
        )

        assert runner._workspace_path.as_posix() == "/home/dev/project"
        assert runner._framework == "auto"
        assert runner._base_url is None

    def test_runner_with_framework(self):
        """Test E2ETestRunner with specific framework."""
        runner = E2ETestRunner(
            workspace_path="/home/dev/project",
            framework="playwright",
        )

        assert runner._framework == "playwright"

    def test_runner_with_base_url(self):
        """Test E2ETestRunner with base URL."""
        runner = E2ETestRunner(
            workspace_path="/home/dev/project",
            base_url="http://localhost:3000",
        )

        assert runner._base_url == "http://localhost:3000"

    async def test_detect_framework_returns_configured(self):
        """Test that detect_framework returns configured framework."""
        runner = E2ETestRunner(
            workspace_path="/home/dev/project",
            framework="cypress",
        )

        result = await runner.detect_framework()

        assert result == "cypress"


class TestHealthChecker:
    """Test HealthChecker class."""

    def test_health_checker_initialization(self):
        """Test HealthChecker initialization."""
        checker = HealthChecker(base_url="http://localhost:3000")

        assert checker._base_url == "http://localhost:3000"

    def test_health_checker_strips_trailing_slash(self):
        """Test HealthChecker strips trailing slash from base URL."""
        checker = HealthChecker(base_url="http://localhost:3000/")

        assert checker._base_url == "http://localhost:3000"


class TestPreviewStatus:
    """Test PreviewStatus enum."""

    def test_all_statuses_exist(self):
        """Test all expected preview statuses exist."""
        assert PreviewStatus.PENDING == "pending"
        assert PreviewStatus.BUILDING == "building"
        assert PreviewStatus.DEPLOYING == "deploying"
        assert PreviewStatus.RUNNING == "running"
        assert PreviewStatus.STOPPED == "stopped"
        assert PreviewStatus.FAILED == "failed"
        assert PreviewStatus.EXPIRED == "expired"


class TestPreviewConfig:
    """Test PreviewConfig dataclass."""

    def test_default_values(self):
        """Test PreviewConfig default values."""
        config = PreviewConfig()

        assert config.branch == "main"
        assert config.build_command is None
        assert config.start_command is None
        assert config.env_vars is None

    def test_with_all_fields(self):
        """Test PreviewConfig with all fields."""
        config = PreviewConfig(
            branch="feature-branch",
            build_command="npm run build",
            start_command="npm start",
            env_vars={"API_URL": "http://api.example.com"},
        )

        assert config.branch == "feature-branch"
        assert config.build_command == "npm run build"
        assert config.start_command == "npm start"
        assert config.env_vars == {"API_URL": "http://api.example.com"}


class TestPreviewEnvironment:
    """Test PreviewEnvironment dataclass."""

    def test_basic_creation(self):
        """Test basic PreviewEnvironment creation."""
        env = PreviewEnvironment(
            id="preview-123",
            session_id="session-456",
            workspace_path="/home/dev/project",
            branch="main",
        )

        assert env.id == "preview-123"
        assert env.session_id == "session-456"
        assert env.workspace_path == "/home/dev/project"
        assert env.branch == "main"
        assert env.status == PreviewStatus.PENDING

    def test_with_all_fields(self):
        """Test PreviewEnvironment with all fields."""
        env = PreviewEnvironment(
            id="preview-123",
            session_id="session-456",
            workspace_path="/home/dev/project",
            branch="feature-branch",
            status=PreviewStatus.RUNNING,
            url="https://preview-123.example.com",
            port=3100,
            container_id="container-abc",
            created_at=datetime.now(UTC),
        )

        assert env.status == PreviewStatus.RUNNING
        assert env.url == "https://preview-123.example.com"
        assert env.port == 3100
        assert env.container_id == "container-abc"
        assert env.created_at is not None

    def test_to_dict(self):
        """Test PreviewEnvironment to_dict method."""
        env = PreviewEnvironment(
            id="preview-123",
            session_id="session-456",
            workspace_path="/home/dev/project",
            branch="main",
        )

        env_dict = env.to_dict()

        assert env_dict["id"] == "preview-123"
        assert env_dict["session_id"] == "session-456"
        assert env_dict["branch"] == "main"
        assert env_dict["status"] == "pending"


class TestPreviewManager:
    """Test PreviewManager class."""

    def test_manager_initialization(self):
        """Test PreviewManager initialization."""
        manager = PreviewManager()

        assert manager._base_port == 3100
        assert manager._max_previews == 10

    def test_manager_with_custom_params(self):
        """Test PreviewManager with custom parameters."""
        manager = PreviewManager(
            base_port=4000,
            max_previews=5,
            preview_ttl_hours=12,
        )

        assert manager._base_port == 4000
        assert manager._max_previews == 5
        assert manager._preview_ttl == 12 * 3600


class TestSanitizeEnvVars:
    """Test environment variable sanitization."""

    def test_removes_dangerous_env_vars(self):
        """Test that dangerous env vars are removed."""
        env_vars = {
            "SAFE_VAR": "value",
            "LD_PRELOAD": "/malicious.so",
            "ANOTHER_SAFE": "value2",
        }

        result = _sanitize_env_vars(env_vars)

        assert "SAFE_VAR" in result
        assert "ANOTHER_SAFE" in result
        assert "LD_PRELOAD" not in result

    def test_removes_path_override(self):
        """Test that PATH cannot be overridden."""
        env_vars = {
            "PATH": "/malicious/bin",
            "SAFE_VAR": "value",
        }

        result = _sanitize_env_vars(env_vars)

        assert "PATH" not in result
        assert "SAFE_VAR" in result

    def test_removes_home_override(self):
        """Test that HOME cannot be overridden."""
        env_vars = {
            "HOME": "/tmp/fake_home",
            "SAFE_VAR": "value",
        }

        result = _sanitize_env_vars(env_vars)

        assert "HOME" not in result

    def test_removes_node_options(self):
        """Test that NODE_OPTIONS is blocked."""
        env_vars = {
            "NODE_OPTIONS": "--require=malicious.js",
            "NODE_ENV": "production",
        }

        result = _sanitize_env_vars(env_vars)

        assert "NODE_OPTIONS" not in result
        assert "NODE_ENV" in result

    def test_removes_python_injection_vars(self):
        """Test that Python injection vars are blocked."""
        env_vars = {
            "PYTHONPATH": "/malicious",
            "PYTHONSTARTUP": "/malicious.py",
            "PYTHONHOME": "/fake_python",
            "PYTHON_DEBUG": "1",  # Safe var
        }

        result = _sanitize_env_vars(env_vars)

        assert "PYTHONPATH" not in result
        assert "PYTHONSTARTUP" not in result
        assert "PYTHONHOME" not in result
        # PYTHON_DEBUG should be safe
        assert "PYTHON_DEBUG" in result

    def test_removes_java_injection_vars(self):
        """Test that Java injection vars are blocked."""
        env_vars = {
            "JAVA_TOOL_OPTIONS": "-javaagent:malicious.jar",
            "_JAVA_OPTIONS": "-Xmx1g",
            "CLASSPATH": "/malicious.jar",
        }

        result = _sanitize_env_vars(env_vars)

        assert "JAVA_TOOL_OPTIONS" not in result
        assert "_JAVA_OPTIONS" not in result
        assert "CLASSPATH" not in result

    def test_case_insensitive_blocking(self):
        """Test that blocking is case insensitive."""
        env_vars = {
            "ld_preload": "/malicious.so",
            "Ld_Preload": "/malicious.so",
            "LD_PRELOAD": "/malicious.so",
        }

        result = _sanitize_env_vars(env_vars)

        assert len(result) == 0

    def test_blocks_invalid_key_characters(self):
        """Test that invalid key characters are blocked."""
        env_vars = {
            "SAFE_VAR": "value",
            "VAR;rm -rf /": "malicious",
            "VAR$(cmd)": "malicious",
        }

        result = _sanitize_env_vars(env_vars)

        assert "SAFE_VAR" in result
        assert len(result) == 1  # Only SAFE_VAR should pass

    def test_empty_env_vars(self):
        """Test with empty env vars."""
        result = _sanitize_env_vars({})

        assert result == {}

    def test_all_safe_vars_pass(self):
        """Test that safe vars pass through."""
        env_vars = {
            "API_URL": "https://api.example.com",
            "DATABASE_URL": "postgres://...",
            "DEBUG": "true",
            "LOG_LEVEL": "info",
            "CUSTOM_VAR_123": "value",
        }

        result = _sanitize_env_vars(env_vars)

        assert result == env_vars

    def test_truncates_long_values(self):
        """Test that long values are truncated to 4096 characters."""
        long_value = "x" * 5000
        env_vars = {"LONG_VAR": long_value}

        result = _sanitize_env_vars(env_vars)

        assert len(result["LONG_VAR"]) == 4096

    def test_removes_null_bytes(self):
        """Test that null bytes are removed from values."""
        env_vars = {"VAR": "value\x00with\x00nulls"}

        result = _sanitize_env_vars(env_vars)

        assert result["VAR"] == "valuewithnulls"


class TestValidateCommand:
    """Test command validation."""

    def test_allows_safe_commands(self):
        """Test that safe commands pass validation."""
        # Should not raise
        _validate_command("npm run build")
        _validate_command("npm start")
        _validate_command("python manage.py runserver")

    def test_blocks_semicolon(self):
        """Test that semicolon is blocked."""
        with pytest.raises(RuntimeError, match="forbidden pattern"):
            _validate_command("npm run build; rm -rf /")

    def test_blocks_pipe(self):
        """Test that pipe is blocked."""
        with pytest.raises(RuntimeError, match="forbidden pattern"):
            _validate_command("echo test | cat")

    def test_blocks_and_operator(self):
        """Test that && is blocked."""
        with pytest.raises(RuntimeError, match="forbidden pattern"):
            _validate_command("npm run build && rm -rf /")

    def test_blocks_or_operator(self):
        """Test that || is blocked."""
        with pytest.raises(RuntimeError, match="forbidden pattern"):
            _validate_command("true || rm -rf /")

    def test_blocks_command_substitution(self):
        """Test that command substitution is blocked."""
        with pytest.raises(RuntimeError, match="forbidden pattern"):
            _validate_command("echo $(whoami)")

        with pytest.raises(RuntimeError, match="forbidden pattern"):
            _validate_command("echo `whoami`")

    def test_blocks_variable_expansion(self):
        """Test that variable expansion is blocked."""
        with pytest.raises(RuntimeError, match="forbidden pattern"):
            _validate_command("echo ${PATH}")

    def test_blocks_newlines(self):
        """Test that newlines are blocked."""
        with pytest.raises(RuntimeError, match="forbidden pattern"):
            _validate_command("npm run build\nrm -rf /")


class TestDangerousEnvVars:
    """Test dangerous env var constants."""

    def test_dangerous_env_vars_contains_ld_preload(self):
        """Test LD_PRELOAD is in dangerous vars."""
        assert "LD_PRELOAD" in _DANGEROUS_ENV_VARS

    def test_dangerous_env_vars_contains_path(self):
        """Test PATH is in dangerous vars."""
        assert "PATH" in _DANGEROUS_ENV_VARS

    def test_dangerous_env_vars_contains_node_options(self):
        """Test NODE_OPTIONS is in dangerous vars."""
        assert "NODE_OPTIONS" in _DANGEROUS_ENV_VARS

    def test_dangerous_env_vars_is_frozen(self):
        """Test that dangerous env vars set is frozen."""
        assert isinstance(_DANGEROUS_ENV_VARS, frozenset)


class TestDangerousPatterns:
    """Test dangerous pattern constants."""

    def test_contains_shell_operators(self):
        """Test shell operators are in dangerous patterns."""
        assert "&&" in _DANGEROUS_PATTERNS
        assert "||" in _DANGEROUS_PATTERNS
        assert ";" in _DANGEROUS_PATTERNS
        assert "|" in _DANGEROUS_PATTERNS

    def test_contains_command_substitution(self):
        """Test command substitution patterns are dangerous."""
        assert "`" in _DANGEROUS_PATTERNS
        assert "$(" in _DANGEROUS_PATTERNS
        assert "${" in _DANGEROUS_PATTERNS

    def test_contains_process_substitution(self):
        """Test process substitution patterns are dangerous."""
        assert "<(" in _DANGEROUS_PATTERNS
        assert ">(" in _DANGEROUS_PATTERNS

    def test_contains_newlines(self):
        """Test newline characters are dangerous."""
        assert "\n" in _DANGEROUS_PATTERNS
        assert "\r" in _DANGEROUS_PATTERNS

    def test_dangerous_patterns_is_frozen(self):
        """Test that dangerous patterns set is frozen."""
        assert isinstance(_DANGEROUS_PATTERNS, frozenset)
