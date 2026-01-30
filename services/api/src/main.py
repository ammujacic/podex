"""Podex API Gateway - Main FastAPI application."""

# ruff: noqa: I001

import asyncio
import contextlib
import os
import shutil
import subprocess
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import socketio
import structlog
from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse, Response
from slowapi import _rate_limit_exceeded_handler as _slowapi_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware

from podex_shared import SentryConfig, init_sentry
from src.config import settings
from src.cost.realtime_tracker import get_cost_tracker
from src.database import close_database, get_db, init_database, seed_database
from src.exceptions import (
    AlembicConfigNotFoundError,
    AlembicNotFoundError,
    MigrationExecutionError,
    MigrationFileNotFoundError,
)
from src.middleware.admin import require_admin
from src.middleware.auth import AuthMiddleware
from src.middleware.csrf import CSRFMiddleware
from src.middleware.logging_filter import configure_logging_filter
from src.middleware.rate_limit import RateLimitMiddleware, close_redis_client, limiter
from src.middleware.security_headers import SecurityHeadersMiddleware
from src.routes import (
    admin,
    agent_templates,
    agents,
    attention,
    auth,
    auth_oauth,
    billing,
    changes,
    checkpoints,
    commands,
    completion,
    context,
    conversations,
    cost_insights,
    dashboard,
    doctor,
    extensions,
    git,
    github,
    health_checks,
    hooks,
    knowledge,
    llm_providers,
    local_pods,
    lsp,
    marketplace,
    mcp,
    memory,
    mfa,
    notifications,
    oauth,
    organizations,
    pending_changes,
    plans,
    platform_settings,
    preview,
    productivity,
    project_health,
    project_init,
    push,
    servers,
    sessions,
    sharing,
    skill_repositories,
    skill_templates,
    skills,
    ssh_keys,
    subagents,
    templates,
    uploads,
    user_compliance,
    user_config,
    voice,
    webhooks,
    workspaces,
    worktrees,
)
from src.routes.admin.agents import public_router as agent_roles_public_router
from src.routes.admin.models import public_router as models_public_router
from src.routes.admin.tools import public_router as agent_tools_public_router
from src.routes.billing import (
    expire_credits,
    grant_monthly_credits,
    process_subscription_period_ends,
    renew_subscription_periods,
    reset_expired_quotas,
    update_expiring_soon_credits,
)
from src.services.local_pod_usage_tracker import local_pod_usage_tracker
from src.services.pricing import refresh_pricing_cache
from src.services.settings_service import ensure_settings_cached
from src.terminal.manager import terminal_manager
from src.websocket.hub import cleanup_session_sync, init_session_sync, sio


def _rate_limit_exceeded_handler(request: Request, exc: Exception) -> Response:
    """Wrapper for slowapi handler with correct signature for FastAPI."""
    if isinstance(exc, RateLimitExceeded):
        return _slowapi_handler(request, exc)  # type: ignore[no-any-return]
    raise exc


logger = structlog.get_logger()


async def _global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Global exception handler to prevent leaking internal details.

    SECURITY: Catches unhandled exceptions and returns a generic error message
    to prevent exposing stack traces, internal paths, or sensitive information.
    The actual exception details are logged for debugging but not returned.
    """
    # Generate a unique error ID for correlation
    import uuid

    error_id = str(uuid.uuid4())[:8]

    # Log the actual exception details for debugging
    logger.exception(
        "Unhandled exception",
        error_id=error_id,
        path=str(request.url.path),
        method=request.method,
        exc_type=type(exc).__name__,
    )

    # Return a generic error message - NEVER expose internal details
    return JSONResponse(
        status_code=500,
        content={
            "detail": "An internal error occurred. Please try again later.",
            "error_id": error_id,
        },
    )


# Background task container to avoid global statement
class _BackgroundTasks:
    """Container for background tasks to avoid global statement."""

    quota_reset: asyncio.Task[None] | None = None
    oauth_refresh: asyncio.Task[None] | None = None
    standby_check: asyncio.Task[None] | None = None
    workspace_provision: asyncio.Task[None] | None = None
    billing_maintenance: asyncio.Task[None] | None = None
    # New cleanup and health check tasks
    agent_watchdog: asyncio.Task[None] | None = None
    container_health_check: asyncio.Task[None] | None = None
    standby_cleanup: asyncio.Task[None] | None = None
    credit_enforcement: asyncio.Task[None] | None = None


_tasks = _BackgroundTasks()


def _task_exception_callback(task: asyncio.Task[None], task_name: str) -> None:
    """Callback to log exceptions from background tasks.

    RELIABILITY: Ensures background task exceptions are logged immediately
    instead of being silently ignored (fire-and-forget anti-pattern).
    """
    try:
        exc = task.exception()
        if exc is not None:
            logger.error(
                "Background task failed with exception",
                task_name=task_name,
                exc_info=exc,
            )
    except asyncio.CancelledError:
        # Task was cancelled, this is expected during shutdown
        pass


def create_monitored_task(coro: Any, name: str) -> asyncio.Task[None]:
    """Create an asyncio task with exception monitoring.

    Args:
        coro: The coroutine to run
        name: Name for logging purposes

    Returns:
        The created task with exception callback attached
    """
    task = asyncio.create_task(coro)
    task.add_done_callback(lambda t: _task_exception_callback(t, name))
    return task


def _report_background_error(
    task_name: str,
    message: str,
    exc: Exception | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    """Report background task errors to error tracking (Sentry) if configured.

    MEDIUM FIX: Ensures background task failures are visible in error tracking
    rather than just being logged and potentially lost.

    Args:
        task_name: Name of the background task that failed
        message: Error message
        exc: Optional exception object
        extra: Optional extra context data
    """
    try:
        import sentry_sdk

        if sentry_sdk.is_initialized():
            with sentry_sdk.push_scope() as scope:
                scope.set_tag("background_task", task_name)
                scope.set_context(
                    "task_info",
                    {
                        "task_name": task_name,
                        "message": message,
                        **(extra or {}),
                    },
                )
                if exc:
                    sentry_sdk.capture_exception(exc)
                else:
                    sentry_sdk.capture_message(f"Background task error: {task_name} - {message}")
    except ImportError:
        # Sentry not installed, just log
        pass
    except Exception as e:
        logger.warning("Failed to report error to Sentry", error=str(e))


async def quota_reset_background_task() -> None:
    """Background task to periodically reset expired quotas.

    Runs every 5 minutes to check for quotas that need to be reset
    based on their reset_at timestamp.

    RELIABILITY: Uses asyncio.wait_for() timeout to prevent connection pool
    exhaustion from hung database operations.
    """
    while True:
        try:
            await asyncio.sleep(settings.BG_TASK_QUOTA_RESET_INTERVAL)

            async for db in get_db():
                try:
                    # CRITICAL FIX: Add timeout to prevent pool exhaustion
                    reset_count = await asyncio.wait_for(
                        reset_expired_quotas(db),
                        timeout=settings.BG_TASK_DB_TIMEOUT,
                    )
                    if reset_count > 0:
                        await asyncio.wait_for(
                            db.commit(),
                            timeout=settings.BG_TASK_DB_TIMEOUT,
                        )
                        logger.info("Reset expired quotas", count=reset_count)
                except TimeoutError:
                    await db.rollback()
                    logger.exception("Quota reset timed out - possible DB connection issue")
                    # MEDIUM FIX: Report to error tracking for alerting
                    _report_background_error("quota_reset", "Database operation timed out")
                except Exception as e:
                    await db.rollback()
                    logger.exception("Failed to reset quotas", error=str(e))
                    # MEDIUM FIX: Report to error tracking for alerting
                    _report_background_error("quota_reset", str(e), exc=e)

        except asyncio.CancelledError:
            logger.info("Quota reset task cancelled")
            break
        except Exception as e:
            logger.exception("Error in quota reset task", error=str(e))
            # MEDIUM FIX: Report to error tracking for alerting
            _report_background_error("quota_reset", str(e), exc=e)
            # Continue running despite errors
            await asyncio.sleep(60)  # Wait a bit before retrying


async def oauth_token_refresh_background_task() -> None:
    """Background task to periodically refresh OAuth tokens that are expiring soon.

    Runs every 30 minutes to check for OAuth tokens that will expire within 1 hour
    and proactively refreshes them.

    RELIABILITY: Uses asyncio.wait_for() timeout to prevent connection pool
    exhaustion from hung operations.
    """
    from sqlalchemy import select
    from src.database.models import UserOAuthToken
    from src.services.oauth import get_oauth_provider

    while True:
        try:
            async for db in get_db():
                try:
                    # Find tokens expiring within 1 hour
                    import time

                    one_hour_from_now = int(time.time()) + 3600
                    logger.debug(
                        "Checking for expiring OAuth tokens",
                        current_time=int(time.time()),
                        one_hour_from_now=one_hour_from_now,
                    )

                    result = await db.execute(
                        select(UserOAuthToken)
                        .where(
                            UserOAuthToken.status.in_(["connected", "error"])
                        )  # Also retry error tokens
                        .where(UserOAuthToken.expires_at < one_hour_from_now)
                        .where(UserOAuthToken.refresh_token.isnot(None))
                    )
                    expiring_tokens = result.scalars().all()

                    logger.debug(
                        "Found expiring OAuth tokens"
                        if expiring_tokens
                        else "No expiring OAuth tokens found",
                        count=len(expiring_tokens),
                    )

                    if not expiring_tokens:
                        continue

                    logger.info(
                        "Refreshing expiring OAuth tokens",
                        count=len(expiring_tokens),
                    )

                    for token in expiring_tokens:
                        try:
                            logger.debug(
                                "Attempting to refresh token",
                                provider=token.provider,
                                refresh_token_prefix=token.refresh_token[:20]
                                if token.refresh_token
                                else None,
                                refresh_token_len=len(token.refresh_token)
                                if token.refresh_token
                                else 0,
                            )
                            oauth_provider = get_oauth_provider(token.provider)
                            if not token.refresh_token:
                                continue
                            credentials = await asyncio.wait_for(
                                oauth_provider.refresh_token(token.refresh_token),
                                timeout=30.0,
                            )

                            # Update token
                            token.access_token = credentials.access_token
                            if credentials.refresh_token:
                                token.refresh_token = credentials.refresh_token
                            token.expires_at = credentials.expires_at
                            token.status = "connected"
                            token.last_error = None

                            logger.info(
                                "Refreshed OAuth token",
                                provider=token.provider,
                                user_id=token.user_id,
                            )
                        except Exception as e:
                            token.status = "error"
                            token.last_error = str(e)
                            logger.warning(
                                "Failed to refresh OAuth token",
                                provider=token.provider,
                                user_id=token.user_id,
                                error=str(e),
                            )

                    await asyncio.wait_for(
                        db.commit(),
                        timeout=settings.BG_TASK_DB_TIMEOUT,
                    )

                except TimeoutError:
                    await db.rollback()
                    logger.exception("OAuth refresh timed out - possible DB connection issue")
                    _report_background_error("oauth_refresh", "Database operation timed out")
                except Exception as e:
                    await db.rollback()
                    logger.exception("Failed to refresh OAuth tokens", error=str(e))
                    _report_background_error("oauth_refresh", str(e), exc=e)

        except asyncio.CancelledError:
            logger.info("OAuth refresh task cancelled")
            break
        except Exception as e:
            logger.exception("Error in OAuth refresh task", error=str(e))
            _report_background_error("oauth_refresh", str(e), exc=e)
            await asyncio.sleep(60)
            continue

        # Run every 30 minutes
        await asyncio.sleep(30 * 60)


async def billing_maintenance_background_task() -> None:
    """Background task for billing maintenance operations.

    Runs every 5 minutes to:
    - Renew non-Stripe subscriptions (Free plans, sponsored, etc.)
    - Grant monthly credits for renewed billing periods
    - Expire credits that have passed their expiration date
    - Update expiring_soon_cents for credit balances
    - Process subscriptions that need to be canceled at period end
    - Handle trials that have ended

    RELIABILITY: Uses asyncio.wait_for() timeout to prevent connection pool
    exhaustion from hung database operations.
    """
    while True:
        try:
            await asyncio.sleep(settings.BG_TASK_BILLING_INTERVAL)

            async for db in get_db():
                try:
                    # STEP 1: Renew non-Stripe subscriptions first
                    # This extends period_end for Free plans and sponsored subscriptions
                    renewed_count = await asyncio.wait_for(
                        renew_subscription_periods(db),
                        timeout=settings.BG_TASK_DB_TIMEOUT,
                    )
                    if renewed_count > 0:
                        logger.info("Renewed subscription periods", count=renewed_count)

                    # STEP 2: Grant monthly credits for new billing periods
                    # This resets quotas and grants included allowances
                    credits_granted = await asyncio.wait_for(
                        grant_monthly_credits(db),
                        timeout=settings.BG_TASK_DB_TIMEOUT,
                    )
                    if credits_granted > 0:
                        logger.info("Granted monthly credits", count=credits_granted)

                    # STEP 3: Process cancellations for subscriptions marked cancel_at_period_end
                    canceled, trial_ended = await asyncio.wait_for(
                        process_subscription_period_ends(db),
                        timeout=settings.BG_TASK_DB_TIMEOUT,
                    )
                    if canceled > 0:
                        logger.info("Canceled subscriptions at period end", count=canceled)
                    if trial_ended > 0:
                        logger.info("Processed ended trials", count=trial_ended)

                    # STEP 4: Expire promotional/bonus credits that have passed expiration
                    expired_count = await asyncio.wait_for(
                        expire_credits(db),
                        timeout=settings.BG_TASK_DB_TIMEOUT,
                    )
                    if expired_count > 0:
                        logger.info("Expired credits", count=expired_count)

                    # STEP 5: Update expiring soon counts for user notifications
                    expiring_updated = await asyncio.wait_for(
                        update_expiring_soon_credits(db),
                        timeout=settings.BG_TASK_DB_TIMEOUT,
                    )
                    if expiring_updated > 0:
                        logger.info("Updated expiring soon balances", count=expiring_updated)

                    # CRITICAL FIX: Commit with timeout and verify success
                    try:
                        await asyncio.wait_for(
                            db.commit(),
                            timeout=settings.BG_TASK_DB_TIMEOUT,
                        )
                    except TimeoutError:
                        logger.exception(
                            "Billing commit timed out - transaction may be inconsistent"
                        )
                        await db.rollback()
                        raise

                except TimeoutError:
                    await db.rollback()
                    logger.exception("Billing maintenance timed out - possible DB connection issue")
                    # MEDIUM FIX: Report to error tracking for alerting
                    _report_background_error("billing_maintenance", "Database operation timed out")
                except Exception as e:
                    await db.rollback()
                    logger.exception("Failed in billing maintenance", error=str(e))
                    # MEDIUM FIX: Report to error tracking for alerting
                    _report_background_error("billing_maintenance", str(e), exc=e)

        except asyncio.CancelledError:
            logger.info("Billing maintenance task cancelled")
            break
        except Exception as e:
            logger.exception("Error in billing maintenance task", error=str(e))
            # MEDIUM FIX: Report to error tracking for alerting
            _report_background_error("billing_maintenance", str(e), exc=e)
            await asyncio.sleep(60)  # Wait 1 minute before retrying


async def credit_enforcement_background_task() -> None:
    """Background task to enforce credit limits by stopping cloud workspaces.

    Runs every 5 minutes to check for users who have exhausted their compute credits
    (both plan quota and prepaid credits) and moves their running *compute-backed*
    workspaces from 'running' to 'stopped'. Local-pod workspaces are not affected.
    """

    from sqlalchemy import select

    from src.compute_client import compute_client
    from src.database.models import Session as SessionModel
    from src.database.models import Workspace
    from src.services.credit_enforcement import get_users_with_exhausted_credits
    from src.websocket.hub import emit_to_session

    while True:
        try:
            await asyncio.sleep(300)  # Check every 5 minutes

            async for db in get_db():
                try:
                    standby_count = 0

                    # Get users who have exhausted compute credits
                    exhausted_users = await get_users_with_exhausted_credits(db, "compute")

                    if not exhausted_users:
                        continue

                    logger.info(
                        "Found users with exhausted compute credits",
                        user_count=len(exhausted_users),
                    )

                    # For each exhausted user, find and stop their running compute workspaces
                    for user_id in exhausted_users:
                        # Find running *cloud* workspaces owned by this user
                        query = (
                            select(Workspace, SessionModel)
                            .join(SessionModel, SessionModel.workspace_id == Workspace.id)
                            .where(
                                SessionModel.owner_id == user_id,
                                Workspace.status == "running",
                                Workspace.local_pod_id.is_(None),
                            )
                        )

                        result = await db.execute(query)
                        rows = result.all()

                        for workspace, session in rows:
                            try:
                                from src.exceptions import ComputeServiceHTTPError

                                # Stop the container in the compute service
                                try:
                                    await compute_client.stop_workspace(workspace.id, user_id)
                                except ComputeServiceHTTPError as compute_error:
                                    # If workspace doesn't exist (404), it's already stopped
                                    if compute_error.status_code != 404:
                                        raise compute_error  # noqa: TRY201

                                # Update database: normalize to explicit 'stopped' state
                                workspace.status = "stopped"
                                workspace.standby_at = None

                                # Notify connected clients about billing stop
                                await emit_to_session(
                                    str(session.id),
                                    "workspace_billing_standby",
                                    {
                                        "workspace_id": workspace.id,
                                        "status": "stopped",
                                        "reason": "credit_exhaustion",
                                        "message": (
                                            "Your cloud workspace has been stopped due to "
                                            "insufficient compute credits. Please upgrade your "
                                            "plan or add credits to resume."
                                        ),
                                        "standby_at": None,
                                        "upgrade_url": "/settings/plans",
                                        "add_credits_url": "/settings/billing",
                                    },
                                )

                                standby_count += 1
                                logger.info(
                                    "Stopped workspace due to credit exhaustion",
                                    workspace_id=workspace.id,
                                    session_id=str(session.id),
                                    user_id=user_id,
                                )

                            except Exception as e:
                                logger.exception(
                                    "Failed to move workspace to standby for billing",
                                    workspace_id=workspace.id,
                                    user_id=user_id,
                                    error=str(e),
                                )

                    if standby_count > 0:
                        await db.commit()
                        logger.info(
                            "Credit enforcement completed",
                            workspaces_standby=standby_count,
                        )

                except Exception as e:
                    await db.rollback()
                    logger.exception("Failed in credit enforcement", error=str(e))

        except asyncio.CancelledError:
            logger.info("Credit enforcement task cancelled")
            break
        except Exception as e:
            logger.exception("Error in credit enforcement task", error=str(e))
            await asyncio.sleep(300)  # Wait 5 minutes before retrying


async def standby_background_task() -> None:
    """Background task to check for idle workspaces and move them to standby.

    Runs every 60 seconds to check for workspaces that have been idle
    longer than their configured standby timeout.
    """
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import select

    from src.compute_client import compute_client
    from src.database.models import Session as SessionModel
    from src.database.models import UserConfig, Workspace

    while True:
        try:
            await asyncio.sleep(60)  # Check every minute

            async for db in get_db():
                try:
                    now = datetime.now(UTC)
                    standby_count = 0

                    # Find running workspaces with sessions
                    query = (
                        select(Workspace, SessionModel, UserConfig)
                        .join(SessionModel, SessionModel.workspace_id == Workspace.id)
                        .outerjoin(UserConfig, UserConfig.user_id == SessionModel.owner_id)
                        .where(Workspace.status == "running")
                    )

                    result = await db.execute(query)
                    rows = result.all()

                    # Group sessions by workspace to avoid duplicate processing
                    # A workspace may have multiple sessions, but we only want to
                    # stop it once and emit one notification per session
                    workspace_sessions: dict[
                        str, list[tuple[Workspace, SessionModel, UserConfig | None]]
                    ] = {}
                    for workspace, session, user_config in rows:
                        ws_id = str(workspace.id)
                        if ws_id not in workspace_sessions:
                            workspace_sessions[ws_id] = []
                        workspace_sessions[ws_id].append((workspace, session, user_config))

                    # Track workspaces we've already processed
                    processed_workspaces: set[str] = set()

                    for ws_id, sessions_data in workspace_sessions.items():
                        # Use the first session's data for timeout calculation
                        # (all sessions share the same workspace)
                        workspace, session, user_config = sessions_data[0]

                        # Determine effective timeout
                        timeout_minutes = None

                        # Check session override first
                        if session.settings and "standby_timeout_minutes" in session.settings:
                            timeout_minutes = session.settings.get("standby_timeout_minutes")
                        elif (
                            user_config and user_config.default_standby_timeout_minutes is not None
                        ):
                            timeout_minutes = user_config.default_standby_timeout_minutes
                        else:
                            # Default to 60 minutes if no config
                            timeout_minutes = 60

                        # None means "Never" - skip this workspace
                        if timeout_minutes is None:
                            continue

                        # Check if workspace has been idle long enough
                        # Use the most recent activity from workspace and ALL sessions
                        workspace_activity = workspace.last_activity or workspace.created_at
                        last_activity = workspace_activity
                        for _, sess, _ in sessions_data:
                            session_activity = sess.updated_at or sess.created_at
                            last_activity = max(last_activity, session_activity)

                        idle_duration = now - last_activity

                        if idle_duration > timedelta(minutes=timeout_minutes):
                            try:
                                from src.exceptions import ComputeServiceHTTPError
                                from src.websocket.hub import emit_to_session

                                # Stop the container (only once per workspace)
                                try:
                                    await compute_client.stop_workspace(
                                        workspace.id, session.owner_id
                                    )
                                except ComputeServiceHTTPError as compute_error:
                                    # If workspace doesn't exist in compute service (404),
                                    # it's already stopped, so we can still mark it as standby
                                    if compute_error.status_code == 404:
                                        logger.warning(
                                            "Workspace not found in compute service, "
                                            "marking as standby anyway",
                                            workspace_id=workspace.id,
                                            error=str(compute_error),
                                        )
                                    else:
                                        raise compute_error  # noqa: TRY201

                                # Update database (only once per workspace)
                                workspace.status = "standby"
                                workspace.standby_at = now

                                # Notify the PRIMARY session only (avoid duplicate toasts)
                                # Other sessions will get status on next API call or reconnect
                                await emit_to_session(
                                    str(session.id),
                                    "workspace_status",
                                    {
                                        "workspace_id": workspace.id,
                                        "status": "standby",
                                        "standby_at": now.isoformat(),
                                    },
                                )

                                standby_count += 1
                                processed_workspaces.add(ws_id)
                                logger.info(
                                    "Workspace moved to standby due to inactivity",
                                    workspace_id=workspace.id,
                                    session_id=session.id,
                                    session_count=len(sessions_data),
                                    idle_minutes=int(idle_duration.total_seconds() / 60),
                                )

                            except Exception as e:
                                logger.exception(
                                    "Failed to move workspace to standby",
                                    workspace_id=workspace.id,
                                    error=str(e),
                                )

                    if standby_count > 0:
                        await db.commit()
                        logger.info("Moved idle workspaces to standby", count=standby_count)

                except Exception as e:
                    await db.rollback()
                    logger.exception("Failed to check idle workspaces", error=str(e))

        except asyncio.CancelledError:
            logger.info("Standby check task cancelled")
            break
        except Exception as e:
            logger.exception("Error in standby check task", error=str(e))
            await asyncio.sleep(60)  # Wait before retrying


async def workspace_provision_background_task() -> None:
    """Background task to ensure workspaces are provisioned for active sessions.

    Runs every 60 seconds to check for active sessions that should have
    running workspaces but don't (e.g., after compute service restart).
    This ensures compute usage tracking works for all active pods.

    Optimized to batch workspace existence checks using asyncio.gather to
    avoid N+1 API calls.
    """
    from datetime import UTC, datetime

    from sqlalchemy import select

    from src.compute_client import compute_client
    from src.database.models import Session as SessionModel
    from src.database.models import Workspace
    from src.exceptions import ComputeServiceHTTPError

    async def check_workspace_exists(
        workspace_id: str, owner_id: str
    ) -> tuple[str, bool, str | None]:
        """Check if workspace exists in compute service.

        Returns:
            Tuple of (workspace_id, exists, error_message).
        """
        try:
            existing = await compute_client.get_workspace(workspace_id, owner_id)
        except ComputeServiceHTTPError as e:
            if e.status_code == 404:
                return (workspace_id, False, None)
            return (workspace_id, True, str(e))  # Assume exists on error
        except Exception as e:
            return (workspace_id, True, str(e))  # Assume exists on error
        else:
            return (workspace_id, existing is not None, None)

    while True:
        try:
            await asyncio.sleep(60)  # Check every minute

            async for db in get_db():
                try:
                    provisioned_count = 0

                    # Find active *cloud* sessions with workspaces that should be running.
                    # IMPORTANT: Skip local-pod workspaces entirely - those are managed by the
                    # local pod connection and should never be auto-provisioned via compute.
                    # NOTE: Only check "running" status - "pending" and "creating" workspaces
                    # are still being provisioned by another request, and checking them here
                    # causes a race condition where we try to create them twice.
                    query = (
                        select(SessionModel, Workspace)
                        .join(Workspace, SessionModel.workspace_id == Workspace.id)
                        .where(
                            SessionModel.status == "active",
                            Workspace.status == "running",
                            Workspace.local_pod_id.is_(None),
                        )
                    )

                    result = await db.execute(query)
                    rows = result.all()

                    if not rows:
                        continue

                    # Batch check workspace existence using asyncio.gather
                    # This converts N sequential API calls into N parallel calls
                    check_tasks = [
                        check_workspace_exists(workspace.id, session.owner_id)
                        for session, workspace in rows
                    ]
                    check_results = await asyncio.gather(*check_tasks)

                    # Build lookup of which workspaces need provisioning
                    needs_provision: dict[str, bool] = {}
                    for workspace_id, exists, error in check_results:
                        if error:
                            logger.warning(
                                "Error checking workspace existence",
                                workspace_id=workspace_id,
                                error=error,
                            )
                        needs_provision[workspace_id] = not exists and error is None

                    # Now provision only the workspaces that don't exist
                    for session, workspace in rows:
                        if not needs_provision.get(workspace.id, False):
                            continue

                        try:
                            # Use the existing build_workspace_config function
                            from src.routes.sessions import (
                                build_workspace_config,
                            )

                            # Determine tier from session settings
                            tier = (
                                session.settings.get("tier", "starter")
                                if session.settings
                                else "starter"
                            )

                            # Build workspace config using the helper
                            workspace_config = await build_workspace_config(
                                db,
                                session.template_id,
                                session.git_url,
                                tier,
                            )

                            logger.info(
                                "Auto-provisioning workspace for active session",
                                workspace_id=workspace.id,
                                session_id=str(session.id),
                                session_name=session.name,
                            )

                            await compute_client.create_workspace(
                                session_id=str(session.id),
                                user_id=session.owner_id,
                                workspace_id=workspace.id,
                                config=workspace_config,
                            )

                            # Update last activity
                            workspace.last_activity = datetime.now(UTC)
                            provisioned_count += 1

                        except Exception as e:
                            logger.warning(
                                "Failed to auto-provision workspace",
                                workspace_id=workspace.id,
                                session_id=str(session.id),
                                error=str(e),
                            )

                    if provisioned_count > 0:
                        await db.commit()
                        logger.info(
                            "Auto-provisioned workspaces for active sessions",
                            count=provisioned_count,
                        )

                except Exception as e:
                    await db.rollback()
                    logger.exception("Failed to check workspace provisioning", error=str(e))

        except asyncio.CancelledError:
            logger.info("Workspace provision task cancelled")
            break
        except Exception as e:
            logger.exception("Error in workspace provision task", error=str(e))
            await asyncio.sleep(60)  # Wait before retrying


async def agent_watchdog_background_task() -> None:
    """Background task to detect and recover stuck agents.

    Runs every AGENT_WATCHDOG_INTERVAL seconds to check for agents that have been
    in 'running' state longer than AGENT_TIMEOUT_MINUTES and transitions them
    to 'error' state with appropriate notifications.

    This prevents agents from getting permanently stuck in a running state
    due to service crashes, network issues, or hung LLM calls.
    """
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import select

    from src.database.models import Agent as AgentModel
    from src.database.models import Session as SessionModel
    from src.websocket.hub import emit_to_session

    while True:
        try:
            await asyncio.sleep(settings.AGENT_WATCHDOG_INTERVAL)

            if not settings.AGENT_WATCHDOG_ENABLED:
                continue

            async for db in get_db():
                try:
                    now = datetime.now(UTC)
                    timeout_threshold = now - timedelta(minutes=settings.AGENT_TIMEOUT_MINUTES)
                    recovered_count = 0

                    # Find stuck agents - in 'running' state with status_changed_at
                    # older than threshold. Also check agents without
                    # status_changed_at but updated_at is old (for backwards compat)
                    query = (
                        select(AgentModel, SessionModel)
                        .join(SessionModel, SessionModel.id == AgentModel.session_id)
                        .where(
                            AgentModel.status == "running",
                        )
                    )

                    result = await db.execute(query)
                    potential_stuck = result.all()

                    for agent, session in potential_stuck:
                        # Determine when status last changed
                        status_time = agent.status_changed_at or agent.updated_at
                        if status_time > timeout_threshold:
                            # Not stuck yet
                            continue

                        # Agent is stuck - attempt recovery
                        try:
                            # Try to abort via agent service first (best effort)
                            from src.agent_client import agent_client

                            try:
                                await agent_client.abort_agent(agent.id)
                            except Exception as abort_error:
                                logger.warning(
                                    "Failed to abort stuck agent via service",
                                    agent_id=agent.id,
                                    error=str(abort_error),
                                )

                            # Update agent to error state
                            agent.status = "error"
                            agent.status_changed_at = now

                            # Notify via WebSocket
                            timeout_msg = (
                                f"Agent timed out after "
                                f"{settings.AGENT_TIMEOUT_MINUTES} minutes in running state"
                            )
                            await emit_to_session(
                                str(session.id),
                                "agent_status",
                                {
                                    "agent_id": agent.id,
                                    "status": "error",
                                    "error": timeout_msg,
                                    "auto_recovered": True,
                                },
                            )

                            recovered_count += 1
                            logger.warning(
                                "Recovered stuck agent",
                                agent_id=agent.id,
                                session_id=str(session.id),
                                stuck_since=status_time.isoformat() if status_time else "unknown",
                            )

                        except Exception as recover_error:
                            logger.exception(
                                "Failed to recover stuck agent",
                                agent_id=agent.id,
                                error=str(recover_error),
                            )

                    if recovered_count > 0:
                        await db.commit()
                        logger.info("Agent watchdog recovered stuck agents", count=recovered_count)

                except Exception as e:
                    await db.rollback()
                    logger.exception("Failed in agent watchdog", error=str(e))

        except asyncio.CancelledError:
            logger.info("Agent watchdog task cancelled")
            break
        except Exception as e:
            logger.exception("Error in agent watchdog task", error=str(e))
            await asyncio.sleep(60)  # Wait before retrying


async def container_health_check_background_task() -> None:
    """Background task to verify running containers are responsive.

    Runs every CONTAINER_HEALTH_CHECK_INTERVAL seconds to check containers
    that haven't had recent activity. After CONTAINER_UNRESPONSIVE_THRESHOLD
    consecutive failures, marks the workspace as 'error' state.

    This detects containers that have crashed or become unresponsive
    without the API service being notified.
    """
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import select

    from src.compute_client import compute_client
    from src.database.models import Session as SessionModel
    from src.database.models import Workspace
    from src.websocket.hub import emit_to_session

    # Track consecutive failures per workspace (in-memory, reset on restart)
    failure_counts: dict[str, int] = {}

    while True:
        try:
            await asyncio.sleep(settings.CONTAINER_HEALTH_CHECK_INTERVAL)

            if not settings.CONTAINER_HEALTH_CHECK_ENABLED:
                continue

            async for db in get_db():
                try:
                    now = datetime.now(UTC)
                    # Only check workspaces inactive for > 5 minutes
                    inactive_threshold = now - timedelta(minutes=5)

                    query = (
                        select(Workspace, SessionModel)
                        .join(SessionModel, SessionModel.workspace_id == Workspace.id)
                        .where(
                            Workspace.status == "running",
                            Workspace.last_activity < inactive_threshold,
                        )
                    )

                    result = await db.execute(query)
                    workspaces = result.all()

                    for workspace, session in workspaces:
                        try:
                            # Perform health check
                            health = await compute_client.health_check_workspace(
                                workspace.id,
                                session.owner_id,
                                timeout_seconds=settings.CONTAINER_HEALTH_CHECK_TIMEOUT,
                            )

                            if health.get("healthy", False):
                                # Clear failure count on success
                                failure_counts.pop(workspace.id, None)
                            else:
                                # Increment failure count
                                failure_counts[workspace.id] = (
                                    failure_counts.get(workspace.id, 0) + 1
                                )

                                if (
                                    failure_counts[workspace.id]
                                    >= settings.CONTAINER_UNRESPONSIVE_THRESHOLD
                                ):
                                    logger.warning(
                                        "Workspace container unresponsive",
                                        workspace_id=workspace.id,
                                        failures=failure_counts[workspace.id],
                                        error=health.get("error"),
                                    )

                                    # Move to error state
                                    workspace.status = "error"

                                    await emit_to_session(
                                        str(session.id),
                                        "workspace_status",
                                        {
                                            "workspace_id": workspace.id,
                                            "status": "error",
                                            "error": "Container became unresponsive",
                                        },
                                    )

                                    # Clear from tracking
                                    del failure_counts[workspace.id]

                        except Exception as check_error:
                            # Health check itself failed - count as failure
                            failure_counts[workspace.id] = failure_counts.get(workspace.id, 0) + 1
                            logger.warning(
                                "Health check failed for workspace",
                                workspace_id=workspace.id,
                                error=str(check_error),
                            )

                    await db.commit()

                except Exception as e:
                    await db.rollback()
                    logger.exception("Failed in container health check", error=str(e))

        except asyncio.CancelledError:
            logger.info("Container health check task cancelled")
            break
        except Exception as e:
            logger.exception("Error in container health check task", error=str(e))
            await asyncio.sleep(60)  # Wait before retrying


async def standby_cleanup_background_task() -> None:
    """Background task to clean up workspaces in standby for too long.

    Runs every STANDBY_CLEANUP_INTERVAL seconds to find workspaces that have
    been in standby longer than STANDBY_MAX_HOURS_DEFAULT (configurable per user).

    This prevents storage accumulation from abandoned workspaces.
    The session is archived (not deleted) to preserve history.
    """
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import select

    from src.compute_client import compute_client
    from src.database.models import Session as SessionModel
    from src.database.models import UserConfig, Workspace

    while True:
        try:
            await asyncio.sleep(settings.STANDBY_CLEANUP_INTERVAL)

            if not settings.STANDBY_CLEANUP_ENABLED:
                continue

            async for db in get_db():
                try:
                    now = datetime.now(UTC)
                    deleted_count = 0

                    # Find standby workspaces with their sessions and user configs
                    query = (
                        select(Workspace, SessionModel, UserConfig)
                        .join(SessionModel, SessionModel.workspace_id == Workspace.id)
                        .outerjoin(UserConfig, UserConfig.user_id == SessionModel.owner_id)
                        .where(Workspace.status == "standby")
                    )

                    result = await db.execute(query)
                    rows = result.all()

                    for workspace, session, user_config in rows:
                        # Determine cleanup threshold
                        max_hours = settings.STANDBY_MAX_HOURS_DEFAULT

                        # Check for user-specific setting
                        if user_config:
                            user_max = getattr(user_config, "standby_auto_delete_hours", None)
                            if user_max is not None:
                                if user_max == 0:
                                    # User disabled auto-cleanup
                                    continue
                                max_hours = user_max

                        # Check if workspace has been in standby too long
                        standby_since = workspace.standby_at or workspace.updated_at
                        standby_duration = now - standby_since

                        if standby_duration > timedelta(hours=max_hours):
                            try:
                                # Delete workspace from compute service with timeout
                                # MEDIUM FIX: Add timeout to prevent cleanup task from hanging
                                await asyncio.wait_for(
                                    compute_client.delete_workspace(
                                        workspace.id,
                                        session.owner_id,
                                    ),
                                    timeout=settings.BG_TASK_WORKSPACE_DELETE_TIMEOUT,
                                )

                                # Archive the session instead of deleting
                                session.archived_at = now
                                session.status = "archived"

                                # Clear workspace reference
                                session.workspace_id = None

                                # Delete workspace from database
                                await db.delete(workspace)

                                deleted_count += 1

                                logger.info(
                                    "Cleaned up long-standby workspace",
                                    workspace_id=workspace.id,
                                    session_id=str(session.id),
                                    standby_hours=int(standby_duration.total_seconds() / 3600),
                                )

                            except TimeoutError:
                                logger.warning(
                                    "Standby workspace deletion timed out",
                                    workspace_id=workspace.id,
                                    timeout=settings.BG_TASK_WORKSPACE_DELETE_TIMEOUT,
                                )
                            except Exception as cleanup_error:
                                logger.warning(
                                    "Failed to cleanup standby workspace",
                                    workspace_id=workspace.id,
                                    error=str(cleanup_error),
                                )

                    if deleted_count > 0:
                        await db.commit()
                        logger.info("Standby cleanup completed", deleted_count=deleted_count)

                except Exception as e:
                    await db.rollback()
                    logger.exception("Failed in standby cleanup", error=str(e))

        except asyncio.CancelledError:
            logger.info("Standby cleanup task cancelled")
            break
        except Exception as e:
            logger.exception("Error in standby cleanup task", error=str(e))
            await asyncio.sleep(300)  # Wait 5 minutes before retrying


def _init_sentry() -> None:
    """Initialize Sentry with the configured settings."""
    sentry_config = SentryConfig(
        service_name="podex-api",
        dsn=settings.SENTRY_DSN,
        environment=settings.ENVIRONMENT,
        release=f"podex-api@{settings.VERSION}",
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        profiles_sample_rate=settings.SENTRY_PROFILES_SAMPLE_RATE,
        enable_db_tracing=True,
        enable_redis_tracing=True,
    )
    init_sentry("podex-api", sentry_config)


# Initialize Sentry
_init_sentry()

logger = structlog.get_logger()

# Maximum request body size (10MB)
MAX_REQUEST_BODY_SIZE = 10 * 1024 * 1024


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """Middleware to limit request body size."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        """Check request body size before processing."""
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > MAX_REQUEST_BODY_SIZE:
            return JSONResponse(
                status_code=413,
                content={"detail": "Request body too large. Maximum size is 10MB."},
            )
        response: Response = await call_next(request)
        return response


def run_migrations() -> None:
    """Run alembic migrations on startup using subprocess to avoid event loop conflicts."""
    # Get the directory where alembic.ini is located
    api_dir = Path(__file__).resolve().parent.parent

    # Check if alembic is available
    if not shutil.which("alembic"):
        logger.error(
            "Alembic not found in PATH",
            hint="Install alembic or ensure it's in your PATH",
        )
        raise AlembicNotFoundError

    # Check if alembic.ini exists
    alembic_ini = api_dir / "alembic.ini"
    if not alembic_ini.exists():
        logger.error(
            "alembic.ini not found",
            expected_path=str(alembic_ini),
            hint="Ensure alembic.ini exists in the api service directory",
        )
        raise AlembicConfigNotFoundError(str(alembic_ini))

    try:
        # MEDIUM FIX: Use absolute path from shutil.which to prevent path manipulation
        alembic_path = shutil.which("alembic")
        if not alembic_path:
            raise AlembicNotFoundError

        logger.info("Running database migrations...", cwd=str(api_dir), alembic_path=alembic_path)
        result = subprocess.run(  # noqa: S603
            [alembic_path, "upgrade", "head"],
            cwd=str(api_dir),
            capture_output=True,
            text=True,
            check=True,
        )
        if result.stdout:
            logger.info("Migration output", output=result.stdout)
        logger.info("Database migrations completed")
    except subprocess.CalledProcessError as e:
        error_output = e.stderr or e.stdout or str(e)
        logger.exception(
            "Migration failed",
            error=error_output,
            returncode=e.returncode,
            stdout=e.stdout,
            stderr=e.stderr,
        )
        raise MigrationExecutionError(e.returncode, error_output) from e
    except FileNotFoundError as e:
        logger.exception("Failed to execute alembic", error=str(e))
        raise MigrationFileNotFoundError(str(e)) from e


async def seed_admin() -> None:
    """Seed admin user if credentials are provided.

    In development: Seeds admin and test users when DEV_SEED_ADMIN is True.
    In production: Seeds admin user only when ADMIN_EMAIL/PASSWORD are provided.

    This allows bootstrapping an initial admin account in production deployments.
    The admin credentials should be set via GCP Secret Manager.
    """
    is_dev = settings.ENVIRONMENT == "development"

    # In development, respect DEV_SEED_ADMIN setting
    # In production, always try to seed admin if credentials are provided
    if is_dev and not settings.DEV_SEED_ADMIN:
        return

    from passlib.context import CryptContext
    from sqlalchemy import select

    from src.database.models import (
        SubscriptionPlan,
        User,
        UserSubscription,
    )

    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

    # Admin credentials - SECURITY: No hardcoded defaults, require explicit env vars
    admin_email = os.environ.get("ADMIN_EMAIL")
    admin_password = os.environ.get("ADMIN_PASSWORD")

    # Skip placeholder values from GCP Secret Manager
    if admin_email == "PLACEHOLDER_SET_VIA_CONSOLE":
        admin_email = None
    if admin_password == "PLACEHOLDER_SET_VIA_CONSOLE":
        admin_password = None

    users_to_seed = []

    # Only create admin user if credentials are explicitly provided
    if admin_email and admin_password:
        users_to_seed.append(
            {
                "email": admin_email,
                "password": admin_password,
                "name": "Admin User",
                "role": "super_admin",
                "plan_slug": "pro",
            }
        )
    elif is_dev:
        logger.warning("Admin user not created: ADMIN_EMAIL and ADMIN_PASSWORD env vars required")

    # Test user only in development
    if is_dev:
        test_email = os.environ.get("TEST_EMAIL")
        test_password = os.environ.get("TEST_PASSWORD")

        if test_email and test_password:
            users_to_seed.append(
                {
                    "email": test_email,
                    "password": test_password,
                    "name": "Test User",
                    "role": "member",
                    "plan_slug": "free",
                }
            )
        else:
            logger.warning("Test user not created: TEST_EMAIL and TEST_PASSWORD env vars required")

    if not users_to_seed:
        if is_dev:
            logger.info(
                "No users to seed - set ADMIN_EMAIL/ADMIN_PASSWORD or TEST_EMAIL/TEST_PASSWORD"
            )
        return

    async for db in get_db():
        try:
            # Get all plans
            plans_result = await db.execute(
                select(SubscriptionPlan).where(SubscriptionPlan.slug.in_(["pro", "free"]))
            )
            plans = {plan.slug: plan for plan in plans_result.scalars().all()}

            if not plans:
                logger.warning("Plans not found, users will be created without subscriptions")

            for user_data in users_to_seed:
                plan_slug = user_data.get("plan_slug", "free")
                plan = plans.get(plan_slug)

                # Check if user already exists
                result = await db.execute(select(User).where(User.email == user_data["email"]))
                existing_user = result.scalar_one_or_none()

                if existing_user:
                    logger.debug("Seeded user already exists", email=user_data["email"])
                    # Check if user has a subscription
                    if plan:
                        sub_result = await db.execute(
                            select(UserSubscription).where(
                                UserSubscription.user_id == existing_user.id
                            )
                        )
                        existing_sub = sub_result.scalar_one_or_none()
                        if not existing_sub:
                            logger.info(
                                "Creating subscription for existing seeded user",
                                email=user_data["email"],
                                plan=plan_slug,
                            )
                            # Create subscription and quotas for existing user
                            await _create_dev_subscription(db, existing_user.id, plan)
                    continue

                # Create user
                user = User(
                    email=user_data["email"],
                    password_hash=pwd_context.hash(user_data["password"]),
                    name=user_data["name"],
                    role=user_data["role"],
                    is_active=True,
                )
                db.add(user)
                await db.flush()  # Flush to get user.id

                logger.info(
                    "Seeded user created",
                    email=user_data["email"],
                    role=user_data["role"],
                )

                # Create subscription for the user
                if plan:
                    await _create_dev_subscription(db, user.id, plan)
                    logger.info(
                        "Created subscription for seeded user",
                        email=user_data["email"],
                        plan=plan_slug,
                    )

            await db.commit()

        except Exception as e:
            await db.rollback()
            logger.warning("Failed to seed dev users", error=str(e))


async def _create_dev_subscription(
    db: Any,  # AsyncSession
    user_id: str,
    plan: Any,  # SubscriptionPlan
) -> None:
    """Create a subscription and quotas for a development user.

    Args:
        db: Database session
        user_id: User ID to create subscription for
        plan: Subscription plan to use
    """
    from datetime import UTC, datetime, timedelta

    from src.database.models import UserSubscription
    from src.routes.billing import sync_quotas_from_plan

    # Calculate subscription period (1 year for dev users)
    now = datetime.now(UTC)
    period_end = now + timedelta(days=365)

    # Create subscription
    subscription = UserSubscription(
        user_id=user_id,
        plan_id=plan.id,
        status="active",
        billing_cycle="yearly",
        current_period_start=now,
        current_period_end=period_end,
        last_credit_grant=now,  # Mark credits as granted for initial period
    )
    db.add(subscription)
    await db.flush()

    # Create quotas using centralized function (single source of truth)
    await sync_quotas_from_plan(db, user_id, plan, subscription)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan manager."""
    logger.info("Starting Podex API", version=settings.VERSION)

    # Initialize database connection (creates all tables from models)
    # Since databases are empty, we create from models first
    await init_database()

    # Run Alembic migrations (for future schema changes)
    # Tables are created from models, but we still run migrations to:
    # 1. Stamp existing migrations as applied if tables already exist
    # 2. Apply any new migrations for future changes
    run_migrations()

    # Seed default data (plans, hardware, templates, settings)
    await seed_database()

    # Initialize model pricing cache from database
    # This must happen after seeding so models exist, and before any requests
    async for db in get_db():
        await refresh_pricing_cache(db)
        break
    logger.info("Model pricing cache initialized")

    # Initialize platform settings cache from database
    # This must happen after seeding so settings exist
    async for db in get_db():
        await ensure_settings_cached(db)
        break
    logger.info("Platform settings cache initialized")

    # Seed development admin user (only in development mode)
    await seed_admin()

    # Initialize session sync (Redis Pub/Sub for cross-instance sync)
    await init_session_sync()
    logger.info("Session sync initialized")

    # Start background tasks with exception monitoring
    # RELIABILITY: create_monitored_task logs exceptions from fire-and-forget tasks
    _tasks.quota_reset = create_monitored_task(quota_reset_background_task(), "quota_reset")
    logger.info("Quota reset background task started")

    # NOTE: Idle standby/auto-pause and long-standby cleanup are disabled. The only
    # automatic transition away from 'running' is explicit credit enforcement for
    # cloud workspaces; everything else is user-driven.

    _tasks.credit_enforcement = create_monitored_task(
        credit_enforcement_background_task(), "credit_enforcement"
    )
    logger.info("Credit enforcement background task started")

    _tasks.workspace_provision = create_monitored_task(
        workspace_provision_background_task(), "workspace_provision"
    )
    logger.info("Workspace provision background task started")

    _tasks.billing_maintenance = create_monitored_task(
        billing_maintenance_background_task(), "billing_maintenance"
    )
    logger.info("Billing maintenance background task started")

    _tasks.agent_watchdog = create_monitored_task(
        agent_watchdog_background_task(), "agent_watchdog"
    )
    logger.info("Agent watchdog background task started")

    _tasks.container_health_check = create_monitored_task(
        container_health_check_background_task(), "container_health_check"
    )
    logger.info("Container health check background task started")

    _tasks.oauth_refresh = create_monitored_task(
        oauth_token_refresh_background_task(), "oauth_refresh"
    )
    logger.info("OAuth token refresh background task started")

    # Start terminal session cleanup task (cleans up stale sessions after 24 hours)
    await terminal_manager.start_cleanup_task()
    logger.info("Terminal session cleanup task started")

    # Start cost tracker cleanup task (trims usage history and removes old sessions)
    cost_tracker = get_cost_tracker()
    await cost_tracker.start_cleanup_task()
    logger.info("Cost tracker cleanup task started")

    # Configure sensitive data logging filter (redacts passwords, tokens, API keys from logs)
    configure_logging_filter()
    logger.info("Sensitive data logging filter configured")

    # Start local pod usage tracker (tracks compute usage for workspaces on local pods)
    await local_pod_usage_tracker.start()
    logger.info("Local pod usage tracker started")

    yield

    # Cleanup
    logger.info("Shutting down Podex API")

    # Stop terminal session cleanup task
    await terminal_manager.stop_cleanup_task()
    logger.info("Terminal session cleanup task stopped")

    # Stop cost tracker cleanup task
    await get_cost_tracker().stop_cleanup_task()
    logger.info("Cost tracker cleanup task stopped")

    # Cancel quota reset task
    if _tasks.quota_reset:
        _tasks.quota_reset.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _tasks.quota_reset
        logger.info("Quota reset background task stopped")

    # Cancel standby check task
    if _tasks.standby_check:
        _tasks.standby_check.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _tasks.standby_check
        logger.info("Standby check background task stopped")

    # Cancel workspace provision task
    if _tasks.workspace_provision:
        _tasks.workspace_provision.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _tasks.workspace_provision
        logger.info("Workspace provision background task stopped")

    # Cancel billing maintenance task
    if _tasks.billing_maintenance:
        _tasks.billing_maintenance.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _tasks.billing_maintenance
        logger.info("Billing maintenance background task stopped")

    # Cancel agent watchdog task
    if _tasks.agent_watchdog:
        _tasks.agent_watchdog.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _tasks.agent_watchdog
        logger.info("Agent watchdog background task stopped")

    # Cancel container health check task
    if _tasks.container_health_check:
        _tasks.container_health_check.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _tasks.container_health_check
        logger.info("Container health check background task stopped")

    # Cancel standby cleanup task
    if _tasks.standby_cleanup:
        _tasks.standby_cleanup.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _tasks.standby_cleanup
        logger.info("Standby cleanup background task stopped")

    # Cancel credit enforcement task
    if _tasks.credit_enforcement:
        _tasks.credit_enforcement.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _tasks.credit_enforcement
        logger.info("Credit enforcement background task stopped")

    # Stop local pod usage tracker
    await local_pod_usage_tracker.stop()
    logger.info("Local pod usage tracker stopped")

    await cleanup_session_sync()
    await close_database()
    await close_redis_client()  # Close rate limit Redis connection


# OpenAPI metadata
OPENAPI_TAGS = [
    {"name": "auth", "description": "Authentication and user management"},
    {"name": "oauth", "description": "OAuth2 provider integrations"},
    {"name": "sessions", "description": "Development session management"},
    {"name": "agents", "description": "AI agent interactions"},
    {"name": "workspaces", "description": "Workspace file and terminal operations"},
    {"name": "templates", "description": "Pod templates for quick starts"},
    {"name": "billing", "description": "Subscription, usage, and payments"},
    {"name": "webhooks", "description": "External service webhooks"},
    {"name": "admin", "description": "Administrative operations"},
]

# Create FastAPI app - API docs are ONLY available via protected admin routes
app = FastAPI(
    title="Podex API",
    description="""
## Podex API - AI-Powered Development Platform

Podex is a web-based agentic IDE that brings intelligent AI agents, cloud workspaces,
and powerful development tools together in one platform.

### Key Features

- **AI Agents**: Intelligent coding assistants that help with development tasks
- **Cloud Workspaces**: Instant, containerized development environments
- **Real-time Collaboration**: Share sessions and collaborate with your team
- **MCP Integration**: Model Context Protocol for extensible tool capabilities

### Authentication

Most endpoints require authentication via JWT tokens. Include the token in the
`Authorization` header as `Bearer <token>`.

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### Rate Limiting

API requests are rate-limited. Current limits:
- General: 100 requests/minute
- Auth endpoints: 20 requests/minute
- Sensitive operations: 10 requests/minute

### WebSocket

Real-time updates are available via Socket.IO at the `/socket.io` endpoint.
""",
    version=settings.VERSION,
    # Disable public docs - only available via /admin/api/docs (admin-protected)
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    openapi_tags=OPENAPI_TAGS,
    terms_of_service="https://podex.dev/terms",
    contact={
        "name": "Podex Support",
        "url": "https://podex.dev/support",
        "email": "support@podex.dev",
    },
    license_info={
        "name": "Proprietary",
        "url": "https://podex.dev/license",
    },
    lifespan=lifespan,
)

# ==========================================
# Protected API Documentation (Admin Only)
# ==========================================
# API docs are only accessible to admins and super_admins via these routes.
# Public docs are disabled for security.


@app.get("/admin/api/openapi.json", include_in_schema=False)
async def get_protected_openapi(
    _: None = Depends(require_admin),  # type: ignore[type-arg]
) -> dict[str, Any]:
    """Get OpenAPI schema (admin only)."""
    return get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
        tags=app.openapi_tags,
    )


@app.get("/admin/api/docs", include_in_schema=False)
async def get_protected_docs(
    _: None = Depends(require_admin),  # type: ignore[type-arg]
) -> Response:
    """Get Swagger UI (admin only)."""
    return get_swagger_ui_html(
        openapi_url="/admin/api/openapi.json",
        title=f"{app.title} - API Docs",
    )


@app.get("/admin/api/redoc", include_in_schema=False)
async def get_protected_redoc(
    _: None = Depends(require_admin),  # type: ignore[type-arg]
) -> Response:
    """Get ReDoc (admin only)."""
    return get_redoc_html(
        openapi_url="/admin/api/openapi.json",
        title=f"{app.title} - API Reference",
    )


# Configure slowapi rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
# SECURITY: Global exception handler to prevent leaking internal details
app.add_exception_handler(Exception, _global_exception_handler)

# CORS middleware - restrict methods and headers for security
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "Accept",
        "Origin",
        "X-Requested-With",
        "X-Request-ID",
    ],
    expose_headers=["X-Request-ID"],
    max_age=600,  # Cache preflight for 10 minutes
)

# Custom middleware (order matters - first added is last executed)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(AuthMiddleware)
app.add_middleware(CSRFMiddleware)  # Origin validation for state-changing requests
app.add_middleware(RequestSizeLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)  # Runs first, adds security headers to all responses

# Create versioned API router (v1)
api_v1 = APIRouter()

# Include all routes in v1 router
api_v1.include_router(auth.router, prefix="/auth", tags=["auth"])
api_v1.include_router(mfa.router)  # Already has prefix
api_v1.include_router(
    auth_oauth.router, prefix="/oauth", tags=["oauth"]
)  # User authentication OAuth
api_v1.include_router(oauth.router, prefix="/llm-oauth", tags=["llm-oauth"])  # LLM provider OAuth
api_v1.include_router(sessions.router, prefix="/sessions", tags=["sessions"])
api_v1.include_router(sharing.router, prefix="/sessions", tags=["sharing"])
api_v1.include_router(conversations.router, tags=["conversations"])
api_v1.include_router(agents.router, prefix="/sessions/{session_id}/agents", tags=["agents"])
api_v1.include_router(
    attention.router, prefix="/sessions/{session_id}/attention", tags=["attention"]
)
api_v1.include_router(git.router, prefix="/sessions/{session_id}/git", tags=["git"])
api_v1.include_router(github.router, tags=["github"])
api_v1.include_router(workspaces.router, prefix="/workspaces", tags=["workspaces"])
api_v1.include_router(preview.router, prefix="/preview", tags=["preview"])
api_v1.include_router(templates.router, prefix="/templates", tags=["templates"])
api_v1.include_router(user_config.router, prefix="/user/config", tags=["user-config"])
api_v1.include_router(ssh_keys.router, prefix="/ssh-keys", tags=["ssh-keys"])
api_v1.include_router(agent_templates.router, prefix="/agent-templates", tags=["agent-templates"])
api_v1.include_router(completion.router, prefix="/completion", tags=["completion"])
api_v1.include_router(knowledge.router)  # Already has prefix
api_v1.include_router(plans.router)  # Already has prefix
api_v1.include_router(mcp.router)  # Already has prefix
api_v1.include_router(mcp.defaults_router)  # MCP defaults catalog
api_v1.include_router(memory.router, tags=["memory"])
api_v1.include_router(skills.router, tags=["skills"])
api_v1.include_router(skill_templates.router, tags=["skill-templates"])
api_v1.include_router(skill_repositories.router, tags=["skill-repositories"])
api_v1.include_router(marketplace.router, tags=["marketplace"])
api_v1.include_router(llm_providers.router, tags=["llm-providers"])
api_v1.include_router(local_pods.router)  # Already has prefix
api_v1.include_router(voice.router, prefix="/voice", tags=["voice"])
api_v1.include_router(uploads.router, prefix="/sessions", tags=["uploads"])
api_v1.include_router(billing.router, tags=["billing"])
api_v1.include_router(cost_insights.router, tags=["cost-insights"])
api_v1.include_router(webhooks.router, tags=["webhooks"])
api_v1.include_router(admin.router, tags=["admin"])
api_v1.include_router(servers.router, prefix="/servers", tags=["servers"])
api_v1.include_router(models_public_router, prefix="/models", tags=["models"])
api_v1.include_router(agent_roles_public_router, prefix="/agent-roles", tags=["agent-roles"])
api_v1.include_router(agent_tools_public_router, prefix="/agent-tools", tags=["agent-tools"])
api_v1.include_router(platform_settings.router, tags=["platform"])
api_v1.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_v1.include_router(productivity.router, tags=["productivity"])
api_v1.include_router(project_health.router, tags=["project-health"])
api_v1.include_router(health_checks.router, tags=["health-checks"])
api_v1.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
api_v1.include_router(organizations.router, prefix="/organizations", tags=["organizations"])
api_v1.include_router(push.router, prefix="/push", tags=["push"])
api_v1.include_router(context.router, prefix="/context", tags=["context"])
api_v1.include_router(checkpoints.router, prefix="/checkpoints", tags=["checkpoints"])
api_v1.include_router(worktrees.router, prefix="/worktrees", tags=["worktrees"])
api_v1.include_router(changes.router, prefix="/changes", tags=["changes"])
api_v1.include_router(pending_changes.router, tags=["pending-changes"])
api_v1.include_router(subagents.router, tags=["subagents"])
api_v1.include_router(hooks.router, tags=["hooks"])
api_v1.include_router(lsp.router, tags=["lsp"])
api_v1.include_router(commands.router, tags=["commands"])
api_v1.include_router(project_init.router, tags=["init"])
api_v1.include_router(doctor.router, tags=["doctor"])
api_v1.include_router(extensions.router, prefix="/extensions", tags=["extensions"])
api_v1.include_router(user_compliance.router, prefix="/compliance", tags=["compliance"])

# Mount v1 API at /api/v1
app.include_router(api_v1, prefix="/api/v1")

# Also mount at /api for backward compatibility (can be deprecated in future)
app.include_router(api_v1, prefix="/api")


# Health check endpoint
@app.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "healthy", "version": settings.VERSION}


# Mount Socket.IO
socket_app = socketio.ASGIApp(sio, app)


def create_app() -> socketio.ASGIApp:
    """Create and return the application instance."""
    return socket_app


if __name__ == "__main__":
    import uvicorn

    # Get host from environment, default to localhost for security
    host = os.environ.get("HOST", "127.0.0.1")
    uvicorn.run(
        "src.main:socket_app",
        host=host,
        port=settings.PORT,
        reload=settings.ENVIRONMENT == "development",
        log_level="info",
    )
