"""Deployment tools for agents to manage preview environments and testing."""

import json
from dataclasses import dataclass

import structlog

from src.deploy.e2e import E2ETestRunner, HealthChecker
from src.deploy.preview import PreviewConfig, PreviewManager

logger = structlog.get_logger()


class PreviewManagerHolder:
    """Singleton holder for the preview manager instance."""

    _instance: PreviewManager | None = None

    @classmethod
    def get(cls) -> PreviewManager:
        """Get or create preview manager."""
        if cls._instance is None:
            cls._instance = PreviewManager()
        return cls._instance


def _get_preview_manager() -> PreviewManager:
    """Get or create preview manager."""
    return PreviewManagerHolder.get()


@dataclass
class DeployPreviewConfig:
    """Configuration for deploying a preview environment."""

    workspace_path: str
    session_id: str
    branch: str = "main"
    build_command: str | None = None
    start_command: str | None = None
    env_vars: dict[str, str] | None = None


async def deploy_preview(config: DeployPreviewConfig) -> str:
    """Deploy a preview environment for testing.

    Args:
        config: Configuration for the preview deployment.

    Returns:
        JSON string with deployment result
    """
    logger.info(
        "Deploying preview",
        workspace_path=config.workspace_path,
        branch=config.branch,
    )

    try:
        manager = _get_preview_manager()

        preview_config = PreviewConfig(
            branch=config.branch,
            build_command=config.build_command,
            start_command=config.start_command,
            env_vars=config.env_vars,
        )

        preview = await manager.create_preview(
            session_id=config.session_id,
            workspace_path=config.workspace_path,
            config=preview_config,
        )

        return json.dumps(
            {
                "success": True,
                "preview_id": preview.id,
                "status": preview.status.value,
                "url": preview.url,
                "port": preview.port,
                "message": f"Preview deployment started. ID: {preview.id}",
            },
        )

    except Exception as e:
        logger.error("Preview deployment failed", error=str(e))
        return json.dumps(
            {
                "success": False,
                "error": str(e),
            },
        )


async def get_preview_status(preview_id: str) -> str:
    """Get the status of a preview deployment.

    Args:
        preview_id: Preview ID to check

    Returns:
        JSON string with preview status
    """
    manager = _get_preview_manager()
    preview = await manager.get_preview(preview_id)

    if not preview:
        return json.dumps(
            {
                "success": False,
                "error": f"Preview not found: {preview_id}",
            },
        )

    return json.dumps(
        {
            "success": True,
            "preview": preview.to_dict(),
        },
    )


async def stop_preview(preview_id: str) -> str:
    """Stop a running preview environment.

    Args:
        preview_id: Preview ID to stop

    Returns:
        JSON string with result
    """
    logger.info("Stopping preview", preview_id=preview_id)

    manager = _get_preview_manager()
    success = await manager.stop_preview(preview_id)

    if success:
        return json.dumps(
            {
                "success": True,
                "message": f"Preview {preview_id} stopped",
            },
        )
    else:
        return json.dumps(
            {
                "success": False,
                "error": f"Failed to stop preview: {preview_id}",
            },
        )


async def rollback_deploy(
    preview_id: str,
    to_commit: str,
) -> str:
    """Rollback a preview deployment to a specific commit.

    Args:
        preview_id: Preview ID to rollback
        to_commit: Git commit hash to rollback to

    Returns:
        JSON string with rollback result
    """
    logger.info(
        "Rolling back preview",
        preview_id=preview_id,
        to_commit=to_commit,
    )

    manager = _get_preview_manager()
    success = await manager.rollback_preview(preview_id, to_commit)

    if success:
        preview = await manager.get_preview(preview_id)
        return json.dumps(
            {
                "success": True,
                "message": f"Preview rolled back to {to_commit}",
                "preview": preview.to_dict() if preview else None,
            },
        )
    else:
        return json.dumps(
            {
                "success": False,
                "error": f"Rollback failed for preview {preview_id}",
            },
        )


async def get_preview_logs(preview_id: str, lines: int = 100) -> str:
    """Get logs from a preview deployment.

    Args:
        preview_id: Preview ID
        lines: Number of log lines to retrieve

    Returns:
        JSON string with logs
    """
    manager = _get_preview_manager()
    logs = await manager.get_preview_logs(preview_id, lines)

    return json.dumps(
        {
            "success": True,
            "preview_id": preview_id,
            "logs": logs,
        },
    )


@dataclass
class E2ETestConfig:
    """Configuration for running E2E tests."""

    workspace_path: str
    base_url: str | None = None
    test_pattern: str | None = None
    parallel: bool = True
    retries: int = 1
    framework: str = "auto"


async def run_e2e_tests(config: E2ETestConfig) -> str:
    """Run end-to-end tests against a deployment.

    Args:
        config: Configuration for E2E test execution.

    Returns:
        JSON string with test results
    """
    logger.info(
        "Running E2E tests",
        workspace_path=config.workspace_path,
        base_url=config.base_url,
        pattern=config.test_pattern,
    )

    try:
        runner = E2ETestRunner(
            workspace_path=config.workspace_path,
            framework=config.framework,
            base_url=config.base_url,
        )

        suite = await runner.run_tests(
            test_pattern=config.test_pattern,
            parallel=config.parallel,
            retries=config.retries,
        )

        return json.dumps(
            {
                "success": True,
                "all_passed": suite.failed == 0 and suite.errors == 0,
                "suite": suite.to_dict(),
                "summary": {
                    "total": suite.total,
                    "passed": suite.passed,
                    "failed": suite.failed,
                    "skipped": suite.skipped,
                    "errors": suite.errors,
                    "duration_ms": suite.duration_ms,
                    "success_rate": f"{(suite.passed / suite.total * 100):.1f}%"
                    if suite.total > 0
                    else "0%",
                },
            },
        )

    except Exception as e:
        logger.error("E2E tests failed", error=str(e))
        return json.dumps(
            {
                "success": False,
                "error": str(e),
            },
        )


async def check_deployment_health(
    url: str,
    endpoints: list[str] | None = None,
    timeout: int = 10,
) -> str:
    """Check health of a deployed service.

    Args:
        url: Base URL of the deployment
        endpoints: List of endpoints to check
        timeout: Timeout in seconds

    Returns:
        JSON string with health check results
    """
    logger.info("Checking deployment health", url=url)

    try:
        checker = HealthChecker(url)
        results = await checker.check_health(endpoints, timeout)

        return json.dumps(
            {
                "success": True,
                **results,
            },
        )

    except Exception as e:
        logger.error("Health check failed", url=url, error=str(e))
        return json.dumps(
            {
                "success": False,
                "error": str(e),
                "url": url,
            },
        )


async def wait_for_deployment(
    url: str,
    endpoint: str = "/health",
    timeout: int = 120,
    interval: int = 5,
) -> str:
    """Wait for a deployment to become healthy.

    Args:
        url: Base URL of the deployment
        endpoint: Health endpoint to check
        timeout: Maximum wait time in seconds
        interval: Check interval in seconds

    Returns:
        JSON string with result
    """
    logger.info(
        "Waiting for deployment",
        url=url,
        endpoint=endpoint,
        timeout=timeout,
    )

    try:
        checker = HealthChecker(url)
        healthy = await checker.wait_for_healthy(endpoint, timeout, interval)

        if healthy:
            return json.dumps(
                {
                    "success": True,
                    "healthy": True,
                    "message": f"Deployment at {url} is healthy",
                },
            )
        else:
            return json.dumps(
                {
                    "success": True,
                    "healthy": False,
                    "message": f"Deployment at {url} did not become healthy within {timeout}s",
                },
            )

    except Exception as e:
        logger.error("Wait for deployment failed", url=url, error=str(e))
        return json.dumps(
            {
                "success": False,
                "error": str(e),
            },
        )


async def list_previews(session_id: str) -> str:
    """List all preview deployments for a session.

    Args:
        session_id: Session ID

    Returns:
        JSON string with previews list
    """
    manager = _get_preview_manager()
    previews = await manager.get_session_previews(session_id)

    return json.dumps(
        {
            "success": True,
            "count": len(previews),
            "previews": [p.to_dict() for p in previews],
        },
    )


# Tool definitions for registration
DEPLOY_TOOLS = {
    "deploy_preview": {
        "function": deploy_preview,
        "description": (
            "Deploy a preview environment for testing. Creates an isolated "
            "instance of the application on a specific branch."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "workspace_path": {
                    "type": "string",
                    "description": "Path to the workspace to deploy",
                },
                "session_id": {
                    "type": "string",
                    "description": "Session ID for tracking",
                },
                "branch": {
                    "type": "string",
                    "description": "Git branch to deploy (default: main)",
                    "default": "main",
                },
                "build_command": {
                    "type": "string",
                    "description": "Command to build the project (e.g., 'npm run build')",
                },
                "start_command": {
                    "type": "string",
                    "description": "Command to start the server (e.g., 'npm start')",
                },
                "env_vars": {
                    "type": "object",
                    "description": "Environment variables for the preview",
                    "additionalProperties": {"type": "string"},
                },
            },
            "required": ["workspace_path", "session_id"],
        },
    },
    "get_preview_status": {
        "function": get_preview_status,
        "description": "Get the current status of a preview deployment.",
        "parameters": {
            "type": "object",
            "properties": {
                "preview_id": {
                    "type": "string",
                    "description": "Preview ID to check",
                },
            },
            "required": ["preview_id"],
        },
    },
    "stop_preview": {
        "function": stop_preview,
        "description": "Stop a running preview environment.",
        "parameters": {
            "type": "object",
            "properties": {
                "preview_id": {
                    "type": "string",
                    "description": "Preview ID to stop",
                },
            },
            "required": ["preview_id"],
        },
    },
    "rollback_deploy": {
        "function": rollback_deploy,
        "description": "Rollback a preview deployment to a specific git commit.",
        "parameters": {
            "type": "object",
            "properties": {
                "preview_id": {
                    "type": "string",
                    "description": "Preview ID to rollback",
                },
                "to_commit": {
                    "type": "string",
                    "description": "Git commit hash to rollback to",
                },
            },
            "required": ["preview_id", "to_commit"],
        },
    },
    "run_e2e_tests": {
        "function": run_e2e_tests,
        "description": (
            "Run end-to-end tests against a deployment. Supports Playwright, Cypress, and Jest."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "workspace_path": {
                    "type": "string",
                    "description": "Path to the workspace with tests",
                },
                "base_url": {
                    "type": "string",
                    "description": "Base URL to test against",
                },
                "test_pattern": {
                    "type": "string",
                    "description": "Pattern to filter tests",
                },
                "parallel": {
                    "type": "boolean",
                    "description": "Run tests in parallel (default: true)",
                    "default": True,
                },
                "retries": {
                    "type": "integer",
                    "description": "Number of retries for failed tests",
                    "default": 1,
                },
                "framework": {
                    "type": "string",
                    "description": "Test framework (auto, playwright, cypress, jest)",
                    "default": "auto",
                },
            },
            "required": ["workspace_path"],
        },
    },
    "check_deployment_health": {
        "function": check_deployment_health,
        "description": "Check health of a deployed service by hitting health endpoints.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Base URL of the deployment",
                },
                "endpoints": {
                    "type": "array",
                    "description": "List of endpoints to check",
                    "items": {"type": "string"},
                },
                "timeout": {
                    "type": "integer",
                    "description": "Timeout in seconds (default: 10)",
                    "default": 10,
                },
            },
            "required": ["url"],
        },
    },
    "wait_for_deployment": {
        "function": wait_for_deployment,
        "description": "Wait for a deployment to become healthy before proceeding.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Base URL of the deployment",
                },
                "endpoint": {
                    "type": "string",
                    "description": "Health endpoint to check (default: /health)",
                    "default": "/health",
                },
                "timeout": {
                    "type": "integer",
                    "description": "Maximum wait time in seconds (default: 120)",
                    "default": 120,
                },
                "interval": {
                    "type": "integer",
                    "description": "Check interval in seconds (default: 5)",
                    "default": 5,
                },
            },
            "required": ["url"],
        },
    },
    "list_previews": {
        "function": list_previews,
        "description": "List all preview deployments for a session.",
        "parameters": {
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "Session ID",
                },
            },
            "required": ["session_id"],
        },
    },
}
