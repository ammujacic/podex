"""Output parsers for health check tools.

Parses output from various tools (eslint, ruff, npm audit, etc.)
and converts them to scores.
"""

import json
import re
from typing import Any

import structlog

logger = structlog.get_logger()


def parse_check_output(
    output: str,
    exit_code: int,
    parse_mode: str,
    parse_config: dict[str, Any],
) -> tuple[float, dict[str, Any]]:
    """Parse check output and return score with details.

    Args:
        output: Command output (stdout or stderr)
        exit_code: Command exit code
        parse_mode: Parser mode (exit_code, json, regex, line_count)
        parse_config: Configuration for the parser

    Returns:
        Tuple of (score 0-100, details dict)
    """
    try:
        if parse_mode == "exit_code":
            return _parse_exit_code(exit_code, parse_config)
        if parse_mode == "json":
            return _parse_json(output, parse_config)
        if parse_mode == "regex":
            return _parse_regex(output, parse_config)
        if parse_mode == "line_count":
            return _parse_line_count(output, parse_config)
    except Exception as e:
        logger.exception("Error parsing check output", parse_mode=parse_mode, error=str(e))
        return 0, {"error": str(e), "parse_failed": True}
    else:
        logger.warning("Unknown parse mode", parse_mode=parse_mode)
        return 0, {"error": f"Unknown parse mode: {parse_mode}"}


def _parse_exit_code(exit_code: int, config: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    """Parse based on exit code.

    Config:
        success_codes: List of codes that indicate success (default [0])
        score_on_success: Score when successful (default 100)
        score_on_failure: Score when failed (default 0)
    """
    success_codes = config.get("success_codes", [0])
    score_on_success = config.get("score_on_success", 100)
    score_on_failure = config.get("score_on_failure", 0)

    success = exit_code in success_codes
    score = score_on_success if success else score_on_failure

    return score, {
        "exit_code": exit_code,
        "success": success,
    }


def _parse_json(output: str, config: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    """Parse JSON output from tools.

    Config:
        type: Tool type (eslint, ruff, npm_audit, etc.) for specialized parsing
        score_path: JSON path to score value
        error_path: JSON path to error count
        error_weight: Points to deduct per error
        warning_weight: Points to deduct per warning
        base_score: Starting score (default 100)
        min_score: Minimum score (default 0)
    """
    tool_type = config.get("type", "generic")

    # Try to parse JSON from output
    try:
        # Handle case where output might have non-JSON prefix/suffix
        json_match = re.search(r"[\[\{].*[\]\}]", output, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group())
        else:
            # No JSON found, return failure
            return 0, {"error": "No JSON found in output", "raw_output_preview": output[:200]}
    except json.JSONDecodeError as e:
        return 0, {"error": f"Invalid JSON: {e}", "raw_output_preview": output[:200]}

    # Route to specialized parser based on tool type
    if tool_type == "eslint":
        return _parse_eslint_json(data, config)
    if tool_type == "ruff":
        return _parse_ruff_json(data, config)
    if tool_type == "npm_audit":
        return _parse_npm_audit_json(data, config)
    if tool_type == "pip_audit":
        return _parse_pip_audit_json(data, config)
    if tool_type == "bandit":
        return _parse_bandit_json(data, config)
    if tool_type == "npm_outdated":
        return _parse_npm_outdated_json(data, config)
    if tool_type == "pip_outdated":
        return _parse_pip_outdated_json(data, config)
    if tool_type == "jest_coverage":
        return _parse_jest_coverage_json(data, config)
    if tool_type == "pytest_coverage":
        return _parse_pytest_coverage_json(data, config)
    if tool_type == "clippy":
        return _parse_clippy_json(data, config)
    return _parse_generic_json(data, config)


def _parse_eslint_json(data: Any, config: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    """Parse ESLint JSON output."""
    base_score = config.get("base_score", 100)
    error_weight = config.get("error_weight", 5)
    warning_weight = config.get("warning_weight", 1)
    min_score = config.get("min_score", 0)

    error_count = 0
    warning_count = 0
    files_with_issues = 0

    if isinstance(data, list):
        for file_result in data:
            errors = file_result.get("errorCount", 0)
            warnings = file_result.get("warningCount", 0)
            error_count += errors
            warning_count += warnings
            if errors > 0 or warnings > 0:
                files_with_issues += 1

    penalty = (error_count * error_weight) + (warning_count * warning_weight)
    score = max(min_score, base_score - penalty)

    return score, {
        "error_count": error_count,
        "warning_count": warning_count,
        "files_with_issues": files_with_issues,
        "penalty": penalty,
    }


def _parse_ruff_json(data: Any, config: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    """Parse Ruff JSON output."""
    base_score = config.get("base_score", 100)
    error_weight = config.get("error_weight", 5)
    warning_weight = config.get("warning_weight", 1)
    min_score = config.get("min_score", 0)

    issues = data if isinstance(data, list) else []
    error_count = 0
    warning_count = 0

    for issue in issues:
        # Ruff uses 'E' prefix for errors, 'W' for warnings
        code = issue.get("code", "")
        if code.startswith(("E", "F")):
            error_count += 1
        else:
            warning_count += 1

    penalty = (error_count * error_weight) + (warning_count * warning_weight)
    score = max(min_score, base_score - penalty)

    return score, {
        "error_count": error_count,
        "warning_count": warning_count,
        "total_issues": len(issues),
        "penalty": penalty,
    }


def _parse_npm_audit_json(data: Any, config: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    """Parse npm audit JSON output."""
    base_score = config.get("base_score", 100)
    critical_weight = config.get("critical_weight", 25)
    high_weight = config.get("high_weight", 15)
    moderate_weight = config.get("moderate_weight", 5)
    low_weight = config.get("low_weight", 1)
    min_score = config.get("min_score", 0)

    # npm audit v7+ format
    vulnerabilities = data.get("vulnerabilities", {})
    metadata = data.get("metadata", {}).get("vulnerabilities", {})

    # Count by severity
    if metadata:
        # New format
        critical = metadata.get("critical", 0)
        high = metadata.get("high", 0)
        moderate = metadata.get("moderate", 0)
        low = metadata.get("low", 0)
    else:
        # Count from vulnerabilities object
        critical = high = moderate = low = 0
        for vuln in vulnerabilities.values():
            severity = vuln.get("severity", "").lower()
            if severity == "critical":
                critical += 1
            elif severity == "high":
                high += 1
            elif severity == "moderate":
                moderate += 1
            elif severity == "low":
                low += 1

    penalty = (
        (critical * critical_weight)
        + (high * high_weight)
        + (moderate * moderate_weight)
        + (low * low_weight)
    )
    score = max(min_score, base_score - penalty)

    return score, {
        "critical": critical,
        "high": high,
        "moderate": moderate,
        "low": low,
        "total": critical + high + moderate + low,
        "penalty": penalty,
    }


def _parse_pip_audit_json(data: Any, config: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    """Parse pip-audit JSON output."""
    base_score = config.get("base_score", 100)
    vuln_weight = config.get("vuln_weight", 10)
    min_score = config.get("min_score", 0)

    vulnerabilities = data if isinstance(data, list) else []
    vuln_count = len(vulnerabilities)

    penalty = vuln_count * vuln_weight
    score = max(min_score, base_score - penalty)

    return score, {
        "vulnerability_count": vuln_count,
        "penalty": penalty,
    }


def _parse_bandit_json(data: Any, config: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    """Parse Bandit security scanner JSON output."""
    base_score = config.get("base_score", 100)
    high_weight = config.get("high_weight", 15)
    medium_weight = config.get("medium_weight", 5)
    low_weight = config.get("low_weight", 1)
    min_score = config.get("min_score", 0)

    results = data.get("results", [])

    high = medium = low = 0
    for result in results:
        severity = result.get("issue_severity", "").upper()
        if severity == "HIGH":
            high += 1
        elif severity == "MEDIUM":
            medium += 1
        elif severity == "LOW":
            low += 1

    penalty = (high * high_weight) + (medium * medium_weight) + (low * low_weight)
    score = max(min_score, base_score - penalty)

    return score, {
        "high_severity": high,
        "medium_severity": medium,
        "low_severity": low,
        "total_issues": len(results),
        "penalty": penalty,
    }


def _parse_npm_outdated_json(data: Any, config: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    """Parse npm outdated JSON output."""
    base_score = config.get("base_score", 100)
    major_weight = config.get("major_weight", 5)
    minor_weight = config.get("minor_weight", 2)
    patch_weight = config.get("patch_weight", 0.5)
    min_score = config.get("min_score", 0)

    packages = data if isinstance(data, dict) else {}

    major_outdated = minor_outdated = patch_outdated = 0

    for pkg_info in packages.values():
        current = pkg_info.get("current", "0.0.0")
        wanted = pkg_info.get("wanted", current)
        latest = pkg_info.get("latest", wanted)

        # Simple version comparison (major.minor.patch)
        try:
            current_parts = [int(x) for x in current.split(".")[:3]]
            latest_parts = [int(x) for x in latest.split(".")[:3]]

            # Pad to 3 parts
            while len(current_parts) < 3:
                current_parts.append(0)
            while len(latest_parts) < 3:
                latest_parts.append(0)

            if latest_parts[0] > current_parts[0]:
                major_outdated += 1
            elif latest_parts[1] > current_parts[1]:
                minor_outdated += 1
            elif latest_parts[2] > current_parts[2]:
                patch_outdated += 1
        except (ValueError, IndexError):
            # If version parsing fails, count as patch
            patch_outdated += 1

    penalty = (
        (major_outdated * major_weight)
        + (minor_outdated * minor_weight)
        + (patch_outdated * patch_weight)
    )
    score = max(min_score, base_score - penalty)

    return score, {
        "major_outdated": major_outdated,
        "minor_outdated": minor_outdated,
        "patch_outdated": patch_outdated,
        "total_outdated": len(packages),
        "penalty": penalty,
    }


def _parse_pip_outdated_json(data: Any, config: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    """Parse pip list --outdated JSON output."""
    base_score = config.get("base_score", 100)
    package_weight = config.get("package_weight", 2)
    min_score = config.get("min_score", 0)

    packages = data if isinstance(data, list) else []
    outdated_count = len(packages)

    penalty = outdated_count * package_weight
    score = max(min_score, base_score - penalty)

    return score, {
        "outdated_count": outdated_count,
        "packages": [p.get("name") for p in packages[:10]],  # List first 10
        "penalty": penalty,
    }


def _parse_jest_coverage_json(data: Any, config: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    """Parse Jest coverage summary JSON."""
    coverage_path = config.get("coverage_path", "total.lines.pct")
    branch_path = config.get("branch_path", "total.branches.pct")
    function_path = config.get("function_path", "total.functions.pct")

    def get_nested(d: Any, path: str) -> float:
        """Get nested value by dot-separated path."""
        try:
            for key in path.split("."):
                d = d[key]
            return float(d)
        except (KeyError, TypeError, ValueError):
            return 0

    line_coverage = get_nested(data, coverage_path)
    branch_coverage = get_nested(data, branch_path)
    function_coverage = get_nested(data, function_path)

    # Weighted average (lines most important)
    score = (line_coverage * 0.5) + (branch_coverage * 0.3) + (function_coverage * 0.2)

    return score, {
        "line_coverage": line_coverage,
        "branch_coverage": branch_coverage,
        "function_coverage": function_coverage,
    }


def _parse_pytest_coverage_json(data: Any, config: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    """Parse pytest-cov JSON output."""
    coverage_path = config.get("coverage_path", "totals.percent_covered")

    def get_nested(d: Any, path: str) -> float:
        """Get nested value by dot-separated path."""
        try:
            for key in path.split("."):
                d = d[key]
            return float(d)
        except (KeyError, TypeError, ValueError):
            return 0

    coverage = get_nested(data, coverage_path)

    return coverage, {
        "percent_covered": coverage,
    }


def _parse_clippy_json(data: Any, config: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    """Parse Cargo Clippy JSON output."""
    base_score = config.get("base_score", 100)
    error_weight = config.get("error_weight", 5)
    warning_weight = config.get("warning_weight", 1)
    min_score = config.get("min_score", 0)

    # Clippy outputs NDJSON (one JSON object per line)
    messages = data if isinstance(data, list) else [data]

    error_count = 0
    warning_count = 0

    for msg in messages:
        if isinstance(msg, dict):
            level = msg.get("level", "")
            if level == "error":
                error_count += 1
            elif level == "warning":
                warning_count += 1

    penalty = (error_count * error_weight) + (warning_count * warning_weight)
    score = max(min_score, base_score - penalty)

    return score, {
        "error_count": error_count,
        "warning_count": warning_count,
        "penalty": penalty,
    }


def _parse_generic_json(data: Any, config: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    """Parse generic JSON with configurable score path."""
    score_path = config.get("score_path")
    error_path = config.get("error_path")
    penalty_per_error = config.get("penalty_per_error", 5)
    base_score = config.get("base_score", 100)
    min_score = config.get("min_score", 0)

    def get_nested(d: Any, path: str) -> Any:
        """Get nested value by dot-separated path."""
        try:
            for key in path.split("."):
                if isinstance(d, dict):
                    d = d[key]
                elif isinstance(d, list) and key.isdigit():
                    d = d[int(key)]
                else:
                    return None
        except (KeyError, IndexError, TypeError):
            return None
        else:
            return d

    # If score_path is provided, use it directly
    if score_path:
        score_value = get_nested(data, score_path)
        if score_value is not None:
            return float(score_value), {"extracted_score": float(score_value)}

    # If error_path is provided, calculate score from errors
    if error_path:
        error_value = get_nested(data, error_path)
        if error_value is not None:
            error_count = len(error_value) if isinstance(error_value, list) else int(error_value)
            penalty = error_count * penalty_per_error
            score = max(min_score, base_score - penalty)
            return score, {"error_count": error_count, "penalty": penalty}

    # Fallback: return 0 if we can't parse
    return 0, {"error": "Could not extract score from JSON"}


def _parse_regex(output: str, config: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    """Parse using regex pattern matching.

    Config:
        pattern: Regex pattern to match
        base_score: Starting score (default 100)
        penalty_per_match: Points to deduct per match (default 5)
        min_score: Minimum score (default 0)
        extract_group: If set, extract this group as the score
        type: If "percentage", extract percentage value
    """
    pattern = config.get("pattern", "")
    base_score = config.get("base_score", 100)
    penalty_per_match = config.get("penalty_per_match", 5)
    min_score = config.get("min_score", 0)
    extract_group = config.get("extract_group")
    parse_type = config.get("type")

    try:
        matches = re.findall(pattern, output, re.MULTILINE | re.IGNORECASE)
        match_count = len(matches)

        # If extracting a group as score
        if extract_group is not None and matches:
            try:
                extracted = matches[0]
                if isinstance(extracted, tuple):
                    extracted = extracted[extract_group - 1]

                if parse_type == "percentage":
                    # Remove % sign if present
                    extracted = extracted.replace("%", "")
                    return float(extracted), {"extracted_value": float(extracted)}
                return float(extracted), {"extracted_value": float(extracted)}
            except (IndexError, ValueError):
                pass

        # Calculate penalty-based score
        penalty = match_count * penalty_per_match
        score = max(min_score, base_score - penalty)
    except re.error as e:
        return 0, {"error": f"Invalid regex pattern: {e}"}
    else:
        return score, {
            "match_count": match_count,
            "penalty": penalty,
        }


def _parse_line_count(output: str, config: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    """Parse based on output line count.

    Config:
        base_score: Starting score (default 100)
        penalty_per_line: Points to deduct per line (default 5)
        min_score: Minimum score (default 0)
        target: Target line count for full score (default 0)
        type: Special handling (readme_quality, comment_ratio)
    """
    base_score = config.get("base_score", 100)
    penalty_per_line = config.get("penalty_per_line", 5)
    min_score = config.get("min_score", 0)
    target = config.get("target", 0)
    parse_type = config.get("type")

    # Count non-empty lines
    lines = [line for line in output.strip().split("\n") if line.strip()]
    line_count = len(lines)

    # Try to parse as number if single line output
    if line_count == 1:
        try:  # noqa: SIM105
            line_count = int(lines[0].strip())
        except ValueError:
            pass

    # Special handling for readme quality
    if parse_type == "readme_quality":
        min_lines = config.get("min_lines_for_pass", 10)
        full_score_lines = config.get("min_lines_for_full_score", 50)

        if line_count < min_lines:
            return 0, {"line_count": line_count, "has_readme": line_count > 0}
        if line_count >= full_score_lines:
            return 100, {"line_count": line_count, "has_readme": True}
        # Linear scale between min_lines and full_score_lines
        score = ((line_count - min_lines) / (full_score_lines - min_lines)) * 100
        return score, {"line_count": line_count, "has_readme": True}

    # Standard penalty-based scoring
    if line_count <= target:
        return base_score, {"line_count": line_count, "target": target}

    penalty = (line_count - target) * penalty_per_line
    score = max(min_score, base_score - penalty)

    return score, {
        "line_count": line_count,
        "target": target,
        "penalty": penalty,
    }
