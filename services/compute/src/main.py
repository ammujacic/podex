"""Podex Compute Service - Workspace Management."""

import asyncio
import contextlib
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from podex_shared import (
    SentryConfig,
    configure_logging,
    init_sentry,
    init_usage_tracker,
    shutdown_usage_tracker,
)
from src.config import settings
from src.deps import (
    InternalAuth,
    OrchestratorSingleton,
    cleanup_compute_manager,
    get_compute_manager,
    get_docker_manager,
    init_compute_manager,
)
from src.managers.heartbeat import HeartbeatConfig, HeartbeatService
from src.routes import (
    health_router,
    preview_router,
    reset_terminal_manager,
    servers_router,
    shutdown_terminal_sessions,
    terminal_router,
    tunnels_router,
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

# Configure unified logging (structlog + Python logging + Sentry integration)
logger = configure_logging("podex-compute")


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

            # Cleanup workspaces marked for deletion
            cleaned = await manager.cleanup_deleted_workspaces()
            if cleaned:
                logger.info("Cleaned up deleted workspaces", count=len(cleaned))

            # Cleanup stale workspaces from Redis (defensive cleanup)
            workspace_store = OrchestratorSingleton._workspace_store
            if workspace_store:
                try:
                    # Clean up workspaces older than 48 hours (2x TTL)
                    stale_removed = await workspace_store.cleanup_stale(
                        max_age_seconds=48 * 60 * 60
                    )
                    if stale_removed:
                        logger.info(
                            "Cleaned up stale workspaces from Redis", count=len(stale_removed)
                        )
                except Exception:
                    logger.exception("Error cleaning up stale workspaces from Redis")
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
    )

    # Reset terminal manager state (clears any stale shutdown flags from hot reload)
    reset_terminal_manager()

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

    # Initialize and start heartbeat service for server and workspace health monitoring
    heartbeat_service: HeartbeatService | None = None
    docker_manager = get_docker_manager()
    if docker_manager.servers:
        heartbeat_config = HeartbeatConfig(
            interval_seconds=30,
            failure_threshold=3,
            report_to_api=True,
            check_workspace_containers=True,
            workspace_check_interval_multiplier=2,  # Check workspaces every 60s
        )
        heartbeat_service = HeartbeatService(
            docker_manager=docker_manager,
            config=heartbeat_config,
            api_base_url=settings.api_base_url,
            api_token=settings.internal_service_token,
            workspace_store=OrchestratorSingleton._workspace_store,
        )
        await heartbeat_service.start()
        logger.info(
            "Heartbeat service started",
            server_count=len(docker_manager.servers),
            workspace_health_check=True,
        )

    # Start background cleanup task
    cleanup = asyncio.create_task(cleanup_task())

    yield

    # Shutdown with overall timeout to prevent hanging
    logger.info("Shutting down Podex Compute Service")

    async def graceful_shutdown() -> None:
        """Perform graceful shutdown with timeout protection."""
        logger.info("Starting graceful shutdown sequence")

        # Stop heartbeat service first
        if heartbeat_service:
            logger.info("Stopping heartbeat service...")
            await heartbeat_service.stop()
            logger.info("Heartbeat service stopped")

        # Close active terminal sessions first to unblock WebSocket handlers
        logger.info("Closing terminal sessions...")
        await shutdown_terminal_sessions()
        logger.info("Terminal sessions closed")

        # Shutdown usage tracker to flush pending events
        logger.info("Stopping usage tracker...")
        await shutdown_usage_tracker()
        logger.info("Usage tracker stopped")

        # Cleanup compute manager and workspaces
        logger.info("Cleaning up workspaces and compute manager...")
        await cleanup_compute_manager()
        logger.info("Compute manager cleanup completed")

    # Cancel cleanup task first
    cleanup.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await cleanup

    # Run shutdown with timeout - if it takes too long, force exit
    try:
        await asyncio.wait_for(graceful_shutdown(), timeout=settings.shutdown_timeout)
        logger.info("Graceful shutdown completed")
    except TimeoutError:
        logger.warning(
            "Shutdown timed out after %d seconds, forcing exit",
            settings.shutdown_timeout,
        )


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

# Configure Prometheus metrics endpoint
from prometheus_fastapi_instrumentator import Instrumentator  # noqa: E402

Instrumentator().instrument(app).expose(app)

# Include routers
app.include_router(health_router)
app.include_router(workspaces_router)
app.include_router(tunnels_router)
app.include_router(preview_router)
app.include_router(terminal_router)
app.include_router(websocket_router)
app.include_router(servers_router)


@app.get("/")
async def root(_auth: InternalAuth) -> dict[str, str]:
    """Root endpoint."""
    return {
        "service": "podex-compute",
        "version": "0.1.0",
    }
