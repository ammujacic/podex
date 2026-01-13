"""Podex Compute Service - Workspace Management."""

import asyncio
import contextlib
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from podex_shared import SentryConfig, init_sentry, init_usage_tracker, shutdown_usage_tracker
from src.config import settings
from src.deps import cleanup_compute_manager, get_compute_manager, init_compute_manager
from src.routes import (
    health_router,
    preview_router,
    terminal_router,
    websocket_router,
    workspaces_router,
)

# Initialize Sentry
_sentry_config = SentryConfig(
    service_name="podex-compute",
    dsn=settings.sentry_dsn,
    environment=settings.environment,
    release="podex-compute@0.1.0",
    traces_sample_rate=settings.sentry_traces_sample_rate,
    profiles_sample_rate=settings.sentry_profiles_sample_rate,
    enable_db_tracing=False,
    enable_redis_tracing=True,
)
init_sentry("podex-compute", _sentry_config)

# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()


async def cleanup_task() -> None:
    """Background task to cleanup idle workspaces and track compute usage."""
    while True:
        try:
            await asyncio.sleep(60)  # Check every minute
            manager = get_compute_manager()

            # Track compute usage for running workspaces (billing every minute)
            try:
                await manager.track_running_workspaces_usage()
            except Exception:
                logger.exception("Error tracking workspace usage")

            # Cleanup idle workspaces
            cleaned = await manager.cleanup_idle_workspaces(settings.workspace_timeout)
            if cleaned:
                logger.info("Cleaned up idle workspaces", count=len(cleaned))
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Error in cleanup task")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """Manage application lifespan - startup and shutdown."""
    logger.info(
        "Starting Podex Compute Service",
        environment=settings.environment,
        compute_mode=settings.compute_mode,
    )

    # Initialize compute manager
    await init_compute_manager()

    # Discover existing workspace containers (for recovery after restart)
    manager = get_compute_manager()
    await manager.discover_existing_workspaces()

    # Initialize usage tracker for billing
    await init_usage_tracker(
        api_base_url=settings.api_base_url,
        service_token=settings.internal_service_token,
        batch_size=10,
        flush_interval=5.0,
    )
    logger.info("Usage tracker initialized", api_url=settings.api_base_url)

    # Start background cleanup task
    cleanup = asyncio.create_task(cleanup_task())

    yield

    # Shutdown
    logger.info("Shutting down Podex Compute Service")
    cleanup.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await cleanup

    # Shutdown usage tracker first to flush pending events
    await shutdown_usage_tracker()
    logger.info("Usage tracker stopped")

    await cleanup_compute_manager()


# Create FastAPI app
app = FastAPI(
    title="Podex Compute Service",
    description="Workspace management service for isolated development environments",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware - use configured origins instead of allowing all in development
# This prevents credential leakage even in development environments
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health_router)
app.include_router(workspaces_router)
app.include_router(preview_router)
app.include_router(terminal_router)
app.include_router(websocket_router)


@app.get("/")
async def root() -> dict[str, str]:
    """Root endpoint."""
    return {
        "service": "podex-compute",
        "version": "0.1.0",
        "mode": settings.compute_mode,
    }
