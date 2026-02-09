"""Unit tests for health parsers (parse_check_output and tool-specific parsers)."""

from __future__ import annotations

import pytest

from src.health import parsers as p


# --- parse_check_output entry point ---


def test_parse_check_output_exit_code_mode() -> None:
    score, details = p.parse_check_output("", 0, "exit_code", {})
    assert score == 100
    assert details["success"] is True
    assert details["exit_code"] == 0


def test_parse_check_output_exit_code_failure() -> None:
    score, details = p.parse_check_output("", 1, "exit_code", {})
    assert score == 0
    assert details["success"] is False


def test_parse_check_output_exit_code_custom_config() -> None:
    score, _ = p.parse_check_output("", 0, "exit_code", {"success_codes": [0, 2], "score_on_success": 80, "score_on_failure": 10})
    assert score == 80
    score2, _ = p.parse_check_output("", 2, "exit_code", {"success_codes": [0, 2]})
    assert score2 == 100


def test_parse_check_output_json_mode_eslint() -> None:
    output = '[{"errorCount": 2, "warningCount": 1}]'
    score, details = p.parse_check_output(output, 0, "json", {"type": "eslint"})
    assert score == 100 - (2 * 5 + 1 * 1)  # 89
    assert details["error_count"] == 2
    assert details["warning_count"] == 1
    assert details["files_with_issues"] == 1


def test_parse_check_output_json_mode_ruff() -> None:
    output = '[{"code": "E501"}, {"code": "W291"}]'
    score, details = p.parse_check_output(output, 0, "json", {"type": "ruff"})
    assert details["error_count"] == 1
    assert details["warning_count"] == 1
    assert details["total_issues"] == 2


def test_parse_check_output_json_mode_npm_audit() -> None:
    output = '{"vulnerabilities": {}, "metadata": {"vulnerabilities": {"critical": 0, "high": 1, "moderate": 2, "low": 0}}}'
    score, details = p.parse_check_output(output, 0, "json", {"type": "npm_audit"})
    assert details["high"] == 1
    assert details["moderate"] == 2
    assert details["critical"] == 0
    assert details["low"] == 0
    assert score == 100 - (1 * 15 + 2 * 5)


def test_parse_check_output_json_mode_pip_audit() -> None:
    output = '[{"name": "pkg1"}, {"name": "pkg2"}]'
    score, details = p.parse_check_output(output, 0, "json", {"type": "pip_audit"})
    assert details["vulnerability_count"] == 2
    assert score == 100 - 2 * 10


def test_parse_check_output_json_mode_bandit() -> None:
    output = '{"results": [{"issue_severity": "HIGH"}, {"issue_severity": "LOW"}]}'
    score, details = p.parse_check_output(output, 0, "json", {"type": "bandit"})
    assert details["high_severity"] == 1
    assert details["low_severity"] == 1
    assert details["total_issues"] == 2


def test_parse_check_output_json_mode_jest_coverage() -> None:
    output = '{"total": {"lines": {"pct": 80}, "branches": {"pct": 70}, "functions": {"pct": 60}}}'
    score, details = p.parse_check_output(
        output, 0, "json",
        {"type": "jest_coverage", "coverage_path": "total.lines.pct", "branch_path": "total.branches.pct", "function_path": "total.functions.pct"}
    )
    assert details["line_coverage"] == 80
    assert details["branch_coverage"] == 70
    assert details["function_coverage"] == 60
    assert score == 80 * 0.5 + 70 * 0.3 + 60 * 0.2


def test_parse_check_output_json_mode_pytest_coverage() -> None:
    output = '{"totals": {"percent_covered": 75.5}}'
    score, details = p.parse_check_output(
        output, 0, "json",
        {"type": "pytest_coverage", "coverage_path": "totals.percent_covered"}
    )
    assert details["percent_covered"] == 75.5
    assert score == 75.5


def test_parse_check_output_json_mode_clippy() -> None:
    output = '[{"level": "error"}, {"level": "warning"}]'
    score, details = p.parse_check_output(output, 0, "json", {"type": "clippy"})
    assert details["error_count"] == 1
    assert details["warning_count"] == 1


def test_parse_check_output_json_mode_generic_score_path() -> None:
    output = '{"metrics": {"score": 88}}'
    score, details = p.parse_check_output(output, 0, "json", {"type": "generic", "score_path": "metrics.score"})
    assert score == 88
    assert details.get("extracted_score") == 88


def test_parse_check_output_json_mode_generic_error_path() -> None:
    output = '{"errors": [1, 2, 3]}'
    score, details = p.parse_check_output(output, 0, "json", {"type": "generic", "error_path": "errors", "penalty_per_error": 5})
    assert details["error_count"] == 3
    assert score == 100 - 15


def test_parse_check_output_json_no_json_in_output() -> None:
    score, details = p.parse_check_output("no json here", 0, "json", {"type": "generic"})
    assert score == 0
    assert "error" in details
    assert "No JSON" in details.get("error", "") or "raw_output_preview" in details


def test_parse_check_output_regex_mode() -> None:
    output = "line1\nwarning: x\nline3\nwarning: y"
    score, details = p.parse_check_output(
        output, 0, "regex",
        {"pattern": r"warning:", "penalty_per_match": 10}
    )
    assert details["match_count"] == 2
    assert score == 100 - 20


def test_parse_check_output_regex_extract_percentage() -> None:
    output = "Coverage: 77.5%"
    score, details = p.parse_check_output(
        output, 0, "regex",
        {"pattern": r"(\d+(?:\.\d+)?)\s*%", "extract_group": 1, "type": "percentage"}
    )
    assert score == 77.5
    assert details.get("extracted_value") == 77.5


def test_parse_check_output_line_count_mode() -> None:
    output = "a\nb\nc\n"
    score, details = p.parse_check_output(output, 0, "line_count", {"target": 5, "base_score": 100})
    assert details["line_count"] == 3
    assert score == 100  # under target


def test_parse_check_output_line_count_readme_quality() -> None:
    lines = "\n".join(["line"] * 30)
    score, details = p.parse_check_output(
        lines, 0, "line_count",
        {"type": "readme_quality", "min_lines_for_pass": 10, "min_lines_for_full_score": 50}
    )
    assert details["line_count"] == 30
    assert details["has_readme"] is True
    assert 0 < score < 100


def test_parse_check_output_unknown_mode() -> None:
    score, details = p.parse_check_output("", 0, "unknown_mode", {})
    assert score == 0
    assert "Unknown parse mode" in details.get("error", "")


def test_parse_exit_code_direct() -> None:
    score, d = p._parse_exit_code(0, {})
    assert score == 100 and d["success"] is True
    score2, d2 = p._parse_exit_code(1, {})
    assert score2 == 0 and d2["success"] is False


def test_parse_npm_outdated_major_minor_patch() -> None:
    # major outdated: latest 2.0.0 vs current 1.0.0
    output = '{"pkg": {"current": "1.0.0", "wanted": "1.0.0", "latest": "2.0.0"}}'
    score, details = p.parse_check_output(output, 0, "json", {"type": "npm_outdated"})
    assert details["major_outdated"] == 1
    assert details["total_outdated"] == 1


def test_parse_pip_outdated() -> None:
    output = '[{"name": "a"}, {"name": "b"}]'
    score, details = p.parse_check_output(output, 0, "json", {"type": "pip_outdated", "package_weight": 3})
    assert details["outdated_count"] == 2
    assert score == 100 - 2 * 3


def test_parse_regex_invalid_pattern() -> None:
    score, details = p.parse_check_output("x", 0, "regex", {"pattern": r"([invalid"})
    assert score == 0
    assert "error" in details


def test_parse_line_count_single_line_number() -> None:
    # Parser interprets single line as number: line_count becomes 42; target 50 -> under target -> full score
    score, details = p.parse_check_output("42", 0, "line_count", {"target": 50, "penalty_per_line": 2})
    assert details["line_count"] == 42
    assert score == 100
