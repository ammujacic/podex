"""Health analysis package for project health scoring.

This package provides functionality to analyze project health by running
checks on code quality, test coverage, security, documentation, and dependencies.
"""

from src.health.analyzer import HealthAnalyzer
from src.health.check_runner import CheckRunner
from src.health.parsers import parse_check_output
from src.health.recommendations import generate_recommendations

__all__ = [
    "CheckRunner",
    "HealthAnalyzer",
    "generate_recommendations",
    "parse_check_output",
]
