"""Default health checks seed data.

This defines the built-in health checks for project health analysis.
Each check specifies a command to run and how to parse its output into a score.

Categories:
- code_quality: Linting, complexity, code style
- test_coverage: Test execution and coverage metrics
- security: Vulnerability scanning, secrets detection
- documentation: README, inline comments, API docs
- dependencies: Outdated, deprecated, vulnerable packages

Parse modes:
- exit_code: Score based on command exit code
- json: Parse JSON output and extract score/errors
- regex: Count pattern matches
- line_count: Score based on output line count
"""

from typing import Any, TypedDict


class HealthCheckData(TypedDict, total=False):
    """Type definition for health check seed data."""

    category: str
    name: str
    description: str
    command: str
    working_directory: str | None
    timeout: int
    parse_mode: str
    parse_config: dict[str, Any]
    weight: float
    enabled: bool
    is_builtin: bool
    project_types: list[str] | None
    fix_command: str | None


# Default health checks - built-in checks that run based on project type
DEFAULT_HEALTH_CHECKS: list[HealthCheckData] = [
    # ==================== Code Quality ====================
    {
        "category": "code_quality",
        "name": "ESLint",
        "description": "JavaScript/TypeScript linting with ESLint",
        "command": "npx eslint . --format=json --max-warnings=-1 2>/dev/null || true",
        "working_directory": None,
        "timeout": 120,
        "parse_mode": "json",
        "parse_config": {
            "type": "eslint",
            "error_weight": 5,
            "warning_weight": 1,
            "base_score": 100,
            "min_score": 0,
        },
        "weight": 1.0,
        "enabled": True,
        "is_builtin": True,
        "project_types": ["nodejs", "typescript", "javascript", "nextjs", "react", "vue"],
        "fix_command": "npx eslint . --fix",
    },
    {
        "category": "code_quality",
        "name": "Ruff",
        "description": "Python linting with Ruff (fast Python linter)",
        "command": "ruff check . --output-format=json 2>/dev/null || true",
        "working_directory": None,
        "timeout": 60,
        "parse_mode": "json",
        "parse_config": {
            "type": "ruff",
            "error_weight": 5,
            "warning_weight": 1,
            "base_score": 100,
            "min_score": 0,
        },
        "weight": 1.0,
        "enabled": True,
        "is_builtin": True,
        "project_types": ["python", "django", "fastapi", "flask"],
        "fix_command": "ruff check . --fix",
    },
    {
        "category": "code_quality",
        "name": "TypeScript Compiler",
        "description": "TypeScript type checking",
        "command": "npx tsc --noEmit --pretty false 2>&1 || true",
        "working_directory": None,
        "timeout": 120,
        "parse_mode": "regex",
        "parse_config": {
            "pattern": r"error TS\d+:",
            "base_score": 100,
            "penalty_per_match": 5,
            "min_score": 0,
        },
        "weight": 0.8,
        "enabled": True,
        "is_builtin": True,
        "project_types": ["typescript", "nextjs"],
        "fix_command": None,
    },
    {
        "category": "code_quality",
        "name": "Go Vet",
        "description": "Go static analysis",
        "command": "go vet ./... 2>&1 || true",
        "working_directory": None,
        "timeout": 60,
        "parse_mode": "line_count",
        "parse_config": {
            "base_score": 100,
            "penalty_per_line": 10,
            "min_score": 0,
        },
        "weight": 1.0,
        "enabled": True,
        "is_builtin": True,
        "project_types": ["go", "gin", "fiber", "echo"],
        "fix_command": None,
    },
    {
        "category": "code_quality",
        "name": "Clippy",
        "description": "Rust linting with Clippy",
        "command": "cargo clippy --message-format=json 2>/dev/null || true",
        "working_directory": None,
        "timeout": 180,
        "parse_mode": "json",
        "parse_config": {
            "type": "clippy",
            "error_weight": 5,
            "warning_weight": 1,
            "base_score": 100,
            "min_score": 0,
        },
        "weight": 1.0,
        "enabled": True,
        "is_builtin": True,
        "project_types": ["rust", "actix", "axum", "rocket"],
        "fix_command": "cargo clippy --fix --allow-dirty",
    },
    # ==================== Test Coverage ====================
    {
        "category": "test_coverage",
        "name": "Jest Coverage",
        "description": "JavaScript/TypeScript test coverage with Jest",
        "command": "npm test -- --coverage --coverageReporters=json-summary --passWithNoTests 2>/dev/null && cat coverage/coverage-summary.json || true",  # noqa: E501
        "working_directory": None,
        "timeout": 300,
        "parse_mode": "json",
        "parse_config": {
            "type": "jest_coverage",
            "coverage_path": "total.lines.pct",
            "branch_path": "total.branches.pct",
            "function_path": "total.functions.pct",
        },
        "weight": 1.0,
        "enabled": True,
        "is_builtin": True,
        "project_types": ["nodejs", "typescript", "javascript", "nextjs", "react"],
        "fix_command": None,
    },
    {
        "category": "test_coverage",
        "name": "Pytest Coverage",
        "description": "Python test coverage with pytest-cov",
        "command": "pytest --cov=. --cov-report=json --no-header -q 2>/dev/null && cat coverage.json || true",  # noqa: E501
        "working_directory": None,
        "timeout": 300,
        "parse_mode": "json",
        "parse_config": {
            "type": "pytest_coverage",
            "coverage_path": "totals.percent_covered",
        },
        "weight": 1.0,
        "enabled": True,
        "is_builtin": True,
        "project_types": ["python", "django", "fastapi", "flask"],
        "fix_command": None,
    },
    {
        "category": "test_coverage",
        "name": "Go Test Coverage",
        "description": "Go test coverage",
        "command": "go test -coverprofile=coverage.out ./... 2>/dev/null && go tool cover -func=coverage.out | grep total | awk '{print $3}' || true",  # noqa: E501
        "working_directory": None,
        "timeout": 300,
        "parse_mode": "regex",
        "parse_config": {
            "pattern": r"(\d+\.?\d*)%",
            "extract_group": 1,
            "type": "percentage",
        },
        "weight": 1.0,
        "enabled": True,
        "is_builtin": True,
        "project_types": ["go", "gin", "fiber", "echo"],
        "fix_command": None,
    },
    # ==================== Security ====================
    {
        "category": "security",
        "name": "npm audit",
        "description": "Node.js dependency vulnerability scanning",
        "command": "npm audit --json 2>/dev/null || true",
        "working_directory": None,
        "timeout": 60,
        "parse_mode": "json",
        "parse_config": {
            "type": "npm_audit",
            "critical_weight": 25,
            "high_weight": 15,
            "moderate_weight": 5,
            "low_weight": 1,
            "base_score": 100,
            "min_score": 0,
        },
        "weight": 1.0,
        "enabled": True,
        "is_builtin": True,
        "project_types": ["nodejs", "typescript", "javascript", "nextjs", "react", "vue"],
        "fix_command": "npm audit fix",
    },
    {
        "category": "security",
        "name": "pip-audit",
        "description": "Python dependency vulnerability scanning",
        "command": "pip-audit --format=json 2>/dev/null || true",
        "working_directory": None,
        "timeout": 60,
        "parse_mode": "json",
        "parse_config": {
            "type": "pip_audit",
            "vuln_weight": 10,
            "base_score": 100,
            "min_score": 0,
        },
        "weight": 1.0,
        "enabled": True,
        "is_builtin": True,
        "project_types": ["python", "django", "fastapi", "flask"],
        "fix_command": None,
    },
    {
        "category": "security",
        "name": "Bandit",
        "description": "Python security linter",
        "command": "bandit -r . -f json 2>/dev/null || true",
        "working_directory": None,
        "timeout": 120,
        "parse_mode": "json",
        "parse_config": {
            "type": "bandit",
            "high_weight": 15,
            "medium_weight": 5,
            "low_weight": 1,
            "base_score": 100,
            "min_score": 0,
        },
        "weight": 0.8,
        "enabled": True,
        "is_builtin": True,
        "project_types": ["python", "django", "fastapi", "flask"],
        "fix_command": None,
    },
    {
        "category": "security",
        "name": "Secrets Detection",
        "description": "Check for hardcoded secrets and API keys",
        "command": "grep -rn --include='*.ts' --include='*.js' --include='*.py' --include='*.go' -E '(api[_-]?key|secret|password|token|credential)\\s*[:=]\\s*[\"\\'][A-Za-z0-9+/=]{20,}' . 2>/dev/null | wc -l || echo 0",  # noqa: E501
        "working_directory": None,
        "timeout": 30,
        "parse_mode": "line_count",
        "parse_config": {
            "base_score": 100,
            "penalty_per_line": 25,
            "min_score": 0,
        },
        "weight": 0.5,
        "enabled": True,
        "is_builtin": True,
        "project_types": None,  # All project types
        "fix_command": None,
    },
    # ==================== Documentation ====================
    {
        "category": "documentation",
        "name": "README Check",
        "description": "Check for README file presence and quality",
        "command": "test -f README.md && wc -l < README.md || echo 0",
        "working_directory": None,
        "timeout": 10,
        "parse_mode": "line_count",
        "parse_config": {
            "type": "readme_quality",
            "min_lines_for_full_score": 50,
            "min_lines_for_pass": 10,
        },
        "weight": 1.0,
        "enabled": True,
        "is_builtin": True,
        "project_types": None,  # All project types
        "fix_command": None,
    },
    {
        "category": "documentation",
        "name": "Inline Comments Ratio",
        "description": "Check for inline code comments",
        "command": "find . -type f \\( -name '*.ts' -o -name '*.js' -o -name '*.py' \\) -not -path '*/node_modules/*' -not -path '*/.git/*' | head -100 | xargs grep -c '//' 2>/dev/null | awk -F: '{sum+=$2} END {print sum}' || echo 0",  # noqa: E501
        "working_directory": None,
        "timeout": 30,
        "parse_mode": "line_count",
        "parse_config": {
            "type": "comment_ratio",
            "target_ratio": 0.1,  # 10% comments
        },
        "weight": 0.5,
        "enabled": True,
        "is_builtin": True,
        "project_types": None,
        "fix_command": None,
    },
    # ==================== Dependencies ====================
    {
        "category": "dependencies",
        "name": "npm outdated",
        "description": "Check for outdated npm packages",
        "command": "npm outdated --json 2>/dev/null || true",
        "working_directory": None,
        "timeout": 60,
        "parse_mode": "json",
        "parse_config": {
            "type": "npm_outdated",
            "major_weight": 5,
            "minor_weight": 2,
            "patch_weight": 0.5,
            "base_score": 100,
            "min_score": 0,
        },
        "weight": 1.0,
        "enabled": True,
        "is_builtin": True,
        "project_types": ["nodejs", "typescript", "javascript", "nextjs", "react", "vue"],
        "fix_command": "npm update",
    },
    {
        "category": "dependencies",
        "name": "pip outdated",
        "description": "Check for outdated Python packages",
        "command": "pip list --outdated --format=json 2>/dev/null || true",
        "working_directory": None,
        "timeout": 60,
        "parse_mode": "json",
        "parse_config": {
            "type": "pip_outdated",
            "package_weight": 2,
            "base_score": 100,
            "min_score": 0,
        },
        "weight": 1.0,
        "enabled": True,
        "is_builtin": True,
        "project_types": ["python", "django", "fastapi", "flask"],
        "fix_command": None,
    },
    {
        "category": "dependencies",
        "name": "Go mod tidy",
        "description": "Check for unused Go dependencies",
        "command": "go mod tidy -v 2>&1 | grep -c 'unused' || echo 0",
        "working_directory": None,
        "timeout": 60,
        "parse_mode": "line_count",
        "parse_config": {
            "base_score": 100,
            "penalty_per_line": 5,
            "min_score": 0,
        },
        "weight": 1.0,
        "enabled": True,
        "is_builtin": True,
        "project_types": ["go", "gin", "fiber", "echo"],
        "fix_command": "go mod tidy",
    },
]
