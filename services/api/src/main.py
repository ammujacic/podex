"""Podex API Gateway - Main FastAPI application."""

import asyncio
import contextlib
import os
import shutil
import subprocess
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path

import socketio
import structlog
from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from slowapi import _rate_limit_exceeded_handler as _slowapi_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware

from podex_shared import SentryConfig, init_sentry
from src.config import settings
from src.database import close_database, get_db, init_database, seed_database
from src.exceptions import (
    AlembicConfigNotFoundError,
    AlembicNotFoundError,
    MigrationExecutionError,
    MigrationFileNotFoundError,
)
from src.middleware.auth import AuthMiddleware
from src.middleware.csrf import CSRFMiddleware
from src.middleware.rate_limit import RateLimitMiddleware, close_redis_client, limiter
from src.middleware.security_headers import SecurityHeadersMiddleware
from src.routes import (
    admin,
    agent_templates,
    agents,
    attention,
    auth,
    billing,
    changes,
    checkpoints,
    completion,
    context,
    dashboard,
    git,
    hooks,
    knowledge,
    local_pods,
    mcp,
    mfa,
    notifications,
    oauth,
    plans,
    preview,
    sessions,
    sharing,
    subagents,
    templates,
    uploads,
    user_config,
    voice,
    webhooks,
    workspaces,
)
from src.routes.billing import reset_expired_quotas
from src.websocket.hub import cleanup_session_sync, init_session_sync, sio


def _rate_limit_exceeded_handler(request: Request, exc: Exception) -> Response:
    """Wrapper for slowapi handler with correct signature for FastAPI."""
    if isinstance(exc, RateLimitExceeded):
        return _slowapi_handler(request, exc)  # type: ignore[no-any-return]
    raise exc


# Background task container to avoid global statement
class _BackgroundTasks:
    """Container for background tasks to avoid global statement."""

    quota_reset: asyncio.Task[None] | None = None
    standby_check: asyncio.Task[None] | None = None


_tasks = _BackgroundTasks()


async def quota_reset_background_task() -> None:
    """Background task to periodically reset expired quotas.

    Runs every 5 minutes to check for quotas that need to be reset
    based on their reset_at timestamp.
    """
    while True:
        try:
            await asyncio.sleep(300)  # Check every 5 minutes

            async for db in get_db():
                try:
                    reset_count = await reset_expired_quotas(db)
                    if reset_count > 0:
                        await db.commit()
                        logger.info("Reset expired quotas", count=reset_count)
                except Exception as e:
                    await db.rollback()
                    logger.exception("Failed to reset quotas", error=str(e))

        except asyncio.CancelledError:
            logger.info("Quota reset task cancelled")
            break
        except Exception as e:
            logger.exception("Error in quota reset task", error=str(e))
            # Continue running despite errors
            await asyncio.sleep(60)  # Wait a bit before retrying


async def standby_background_task() -> None:  # noqa: PLR0912
    """Background task to check for idle workspaces and move them to standby.

    Runs every 60 seconds to check for workspaces that have been idle
    longer than their configured standby timeout.
    """
    from datetime import UTC, datetime, timedelta  # noqa: PLC0415

    from sqlalchemy import select  # noqa: PLC0415

    from src.compute_client import compute_client  # noqa: PLC0415
    from src.database.models import Session as SessionModel  # noqa: PLC0415
    from src.database.models import UserConfig, Workspace  # noqa: PLC0415

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

                    for workspace, session, user_config in rows:
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
                        last_activity = workspace.last_activity or workspace.created_at
                        idle_duration = now - last_activity

                        if idle_duration > timedelta(minutes=timeout_minutes):
                            try:
                                # Stop the container
                                await compute_client.stop_workspace(workspace.id, session.owner_id)

                                # Update database
                                workspace.status = "standby"
                                workspace.standby_at = now

                                standby_count += 1
                                logger.info(
                                    "Workspace moved to standby due to inactivity",
                                    workspace_id=workspace.id,
                                    session_id=session.id,
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
        logger.info("Running database migrations...", cwd=str(api_dir))
        result = subprocess.run(
            ["alembic", "upgrade", "head"],  # noqa: S607
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


async def seed_dev_admin() -> None:
    """Seed development users if they don't exist.

    Only runs in development mode when DEV_SEED_ADMIN is True.
    Creates both admin and regular test users.
    """
    if settings.ENVIRONMENT != "development" or not settings.DEV_SEED_ADMIN:
        return

    from passlib.context import CryptContext  # noqa: PLC0415
    from sqlalchemy import select  # noqa: PLC0415

    from src.database.models import User  # noqa: PLC0415

    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

    # Dev users to seed
    dev_users = [
        {
            "email": os.environ.get("ADMIN_EMAIL", "admin@podex.dev"),
            "password": os.environ.get("ADMIN_PASSWORD", "AdminPassword123!"),
            "name": "Admin User",
            "role": "admin",
        },
        {
            "email": os.environ.get("TEST_EMAIL", "user@podex.dev"),
            "password": os.environ.get("TEST_PASSWORD", "UserPassword123!"),
            "name": "Test User",
            "role": "member",
        },
    ]

    async for db in get_db():
        try:
            for user_data in dev_users:
                # Check if user already exists
                result = await db.execute(select(User).where(User.email == user_data["email"]))
                existing_user = result.scalar_one_or_none()

                if existing_user:
                    logger.debug("Dev user already exists", email=user_data["email"])
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
                logger.info(
                    "Created dev user",
                    email=user_data["email"],
                    role=user_data["role"],
                )

            await db.commit()

        except Exception as e:
            await db.rollback()
            logger.warning("Failed to seed dev users", error=str(e))


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

    # Seed development admin user (only in development mode)
    await seed_dev_admin()

    # Initialize session sync (Redis Pub/Sub for cross-instance sync)
    await init_session_sync()
    logger.info("Session sync initialized")

    # Start background task for quota resets
    _tasks.quota_reset = asyncio.create_task(quota_reset_background_task())
    logger.info("Quota reset background task started")

    # Start background task for standby checks
    _tasks.standby_check = asyncio.create_task(standby_background_task())
    logger.info("Standby check background task started")

    yield

    # Cleanup
    logger.info("Shutting down Podex API")

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

# Create FastAPI app with comprehensive OpenAPI documentation
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
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
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

# Configure slowapi rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

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
api_v1.include_router(oauth.router, prefix="/oauth", tags=["oauth"])
api_v1.include_router(sessions.router, prefix="/sessions", tags=["sessions"])
api_v1.include_router(sharing.router, prefix="/sessions", tags=["sharing"])
api_v1.include_router(agents.router, prefix="/sessions/{session_id}/agents", tags=["agents"])
api_v1.include_router(
    attention.router, prefix="/sessions/{session_id}/attention", tags=["attention"]
)
api_v1.include_router(git.router, prefix="/sessions/{session_id}/git", tags=["git"])
api_v1.include_router(workspaces.router, prefix="/workspaces", tags=["workspaces"])
api_v1.include_router(preview.router, prefix="/preview", tags=["preview"])
api_v1.include_router(templates.router, prefix="/templates", tags=["templates"])
api_v1.include_router(user_config.router, prefix="/user/config", tags=["user-config"])
api_v1.include_router(agent_templates.router, prefix="/agent-templates", tags=["agent-templates"])
api_v1.include_router(completion.router, prefix="/completion", tags=["completion"])
api_v1.include_router(knowledge.router)  # Already has prefix
api_v1.include_router(plans.router)  # Already has prefix
api_v1.include_router(mcp.router)  # Already has prefix
api_v1.include_router(mcp.defaults_router)  # MCP defaults catalog
api_v1.include_router(local_pods.router)  # Already has prefix
api_v1.include_router(voice.router, prefix="/voice", tags=["voice"])
api_v1.include_router(uploads.router, prefix="/sessions", tags=["uploads"])
api_v1.include_router(billing.router, tags=["billing"])
api_v1.include_router(webhooks.router, tags=["webhooks"])
api_v1.include_router(admin.router, tags=["admin"])
api_v1.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_v1.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
api_v1.include_router(context.router, prefix="/context", tags=["context"])
api_v1.include_router(checkpoints.router, prefix="/checkpoints", tags=["checkpoints"])
api_v1.include_router(changes.router, prefix="/changes", tags=["changes"])
api_v1.include_router(subagents.router, tags=["subagents"])
api_v1.include_router(hooks.router, tags=["hooks"])

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
