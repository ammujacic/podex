"""Health analysis tools for agents.

Provides tools for analyzing project health, getting scores, and applying fixes.
"""

from dataclasses import dataclass
from typing import Any

import httpx
import structlog

from src.config import get_settings

logger = structlog.get_logger()


@dataclass
class HealthAnalysisConfig:
    """Configuration for triggering health analysis."""

    session_id: str
    user_id: str
    workspace_id: str | None = None
    working_directory: str | None = None  # Optional subfolder to analyze


async def analyze_project_health(
    config: HealthAnalysisConfig,
) -> dict[str, Any]:
    """Trigger a health analysis for the current project.

    This runs various checks (linting, tests, security, etc.) and returns
    an aggregated health score with detailed breakdown.

    Args:
        config: Health analysis configuration

    Returns:
        Dict with analysis results including overall score and category scores
    """
    settings = get_settings()

    try:
        headers = {}
        if settings.INTERNAL_SERVICE_TOKEN:
            headers["Authorization"] = f"Bearer {settings.INTERNAL_SERVICE_TOKEN}"

        # Include workspace_id for compute service to run checks
        payload: dict[str, Any] = {
            "working_directory": config.working_directory,
        }
        if config.workspace_id:
            payload["workspace_id"] = config.workspace_id

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{settings.API_BASE_URL}/api/v1/sessions/{config.session_id}/health/analyze",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            result = response.json()

            return {
                "success": True,
                "message": "Health analysis started",
                "health_score_id": result.get("id"),
                "status": result.get("status", "pending"),
            }

    except httpx.HTTPStatusError as e:
        logger.error(
            "Health analysis API error",
            status_code=e.response.status_code,
            error=str(e),
        )
        return {
            "success": False,
            "error": f"Health analysis failed: {e.response.text}",
        }
    except Exception as e:
        logger.error("Health analysis failed", error=str(e))
        return {
            "success": False,
            "error": f"Health analysis failed: {e!s}",
        }


async def get_health_score(
    session_id: str,
    user_id: str,  # noqa: ARG001
) -> dict[str, Any]:
    """Get the current health score for a project.

    Args:
        session_id: Session ID
        user_id: User ID for auth

    Returns:
        Dict with current health score and category breakdown
    """
    settings = get_settings()

    try:
        headers = {}
        if settings.INTERNAL_SERVICE_TOKEN:
            headers["Authorization"] = f"Bearer {settings.INTERNAL_SERVICE_TOKEN}"

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{settings.API_BASE_URL}/api/v1/sessions/{session_id}/health/latest",
                headers=headers,
            )
            response.raise_for_status()
            result = response.json()

            if not result:
                return {
                    "success": True,
                    "has_score": False,
                    "message": "No health analysis has been run yet for this project.",
                }

            return {
                "success": True,
                "has_score": True,
                "overall_score": result.get("overall_score"),
                "status": result.get("status"),
                "analyzed_at": result.get("analyzed_at"),
                "categories": result.get("categories", {}),
                "recommendations": result.get("recommendations", []),
            }

    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return {
                "success": True,
                "has_score": False,
                "message": "No health analysis has been run yet for this project.",
            }
        logger.error(
            "Get health score API error",
            status_code=e.response.status_code,
            error=str(e),
        )
        return {
            "success": False,
            "error": f"Failed to get health score: {e.response.text}",
        }
    except Exception as e:
        logger.error("Get health score failed", error=str(e))
        return {
            "success": False,
            "error": f"Failed to get health score: {e!s}",
        }


async def apply_health_fix(
    session_id: str,
    user_id: str,  # noqa: ARG001
    recommendation_id: str,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    """Apply an auto-fix for a health recommendation.

    This executes the fix command associated with a recommendation
    (e.g., "npm audit fix" for security issues).

    Args:
        session_id: Session ID
        user_id: User ID for auth
        recommendation_id: ID of the recommendation to fix
        workspace_id: Optional workspace container ID for remote execution

    Returns:
        Dict with fix result
    """
    settings = get_settings()

    try:
        headers = {}
        if settings.INTERNAL_SERVICE_TOKEN:
            headers["Authorization"] = f"Bearer {settings.INTERNAL_SERVICE_TOKEN}"

        payload: dict[str, Any] = {}
        if workspace_id:
            payload["workspace_id"] = workspace_id

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{settings.API_BASE_URL}/api/v1/sessions/{session_id}/health/recommendations/{recommendation_id}/fix",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            result = response.json()

            return {
                "success": True,
                "message": "Fix applied successfully",
                "command": result.get("command"),
                "output": result.get("output"),
                "exit_code": result.get("exit_code", 0),
            }

    except httpx.HTTPStatusError as e:
        logger.error(
            "Apply health fix API error",
            status_code=e.response.status_code,
            error=str(e),
        )
        return {
            "success": False,
            "error": f"Failed to apply fix: {e.response.text}",
        }
    except Exception as e:
        logger.error("Apply health fix failed", error=str(e))
        return {
            "success": False,
            "error": f"Failed to apply fix: {e!s}",
        }


async def list_health_checks(
    session_id: str,  # noqa: ARG001
    user_id: str,  # noqa: ARG001
    category: str | None = None,
) -> dict[str, Any]:
    """List available health checks for the project.

    Args:
        session_id: Session ID
        user_id: User ID for auth
        category: Optional category filter (code_quality, test_coverage, security, etc.)

    Returns:
        Dict with list of available checks
    """
    settings = get_settings()

    try:
        headers = {}
        if settings.INTERNAL_SERVICE_TOKEN:
            headers["Authorization"] = f"Bearer {settings.INTERNAL_SERVICE_TOKEN}"

        params: dict[str, Any] = {}
        if category:
            params["category"] = category

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{settings.API_BASE_URL}/api/v1/health/checks",
                headers=headers,
                params=params,
            )
            response.raise_for_status()
            result = response.json()

            return {
                "success": True,
                "checks": result.get("checks", []),
                "total": result.get("total", 0),
            }

    except httpx.HTTPStatusError as e:
        logger.error(
            "List health checks API error",
            status_code=e.response.status_code,
            error=str(e),
        )
        return {
            "success": False,
            "error": f"Failed to list health checks: {e.response.text}",
        }
    except Exception as e:
        logger.error("List health checks failed", error=str(e))
        return {
            "success": False,
            "error": f"Failed to list health checks: {e!s}",
        }
