"""Podex Agent Service - AI Orchestration."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import structlog
import uvicorn
from fastapi import FastAPI

from podex_shared import SentryConfig, init_sentry, init_usage_tracker, shutdown_usage_tracker
from podex_shared.redis_client import get_redis_client
from src.config import refresh_model_capabilities, settings
from src.context.manager import ContextWindowManager, set_context_manager
from src.providers.llm import LLMProvider
from src.queue.task_queue import TaskQueue
from src.queue.worker import TaskWorker, set_task_worker
from src.routes import agents, health
from src.tools.skill_tools import SkillRegistryHolder


def _init_sentry() -> None:
    """Initialize Sentry for error tracking."""
    _sentry_config = SentryConfig(
        service_name="podex-agent",
        dsn=settings.SENTRY_DSN,
        environment=settings.ENVIRONMENT,
        release=f"podex-agent@{settings.VERSION}",
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        profiles_sample_rate=settings.SENTRY_PROFILES_SAMPLE_RATE,
        enable_db_tracing=False,  # Agent service doesn't use SQLAlchemy directly
        enable_redis_tracing=True,
    )
    init_sentry("podex-agent", _sentry_config)


# Initialize Sentry at module load time
_init_sentry()

logger = structlog.get_logger()


class ServiceManager:
    """Manages global service instances for the application."""

    _redis_client = None
    _task_worker = None
    _context_manager = None
    _usage_tracker = None

    @classmethod
    async def init_services(cls) -> None:
        """Initialize background services."""
        # Initialize Redis
        cls._redis_client = get_redis_client(settings.REDIS_URL)
        await cls._redis_client.connect()
        logger.info("Redis connected", url=settings.REDIS_URL)

        # Initialize usage tracker for billing
        cls._usage_tracker = await init_usage_tracker(
            api_base_url=settings.API_BASE_URL,
            service_token=settings.INTERNAL_SERVICE_TOKEN,
            batch_size=10,
            flush_interval=5.0,
        )
        logger.info("Usage tracker initialized", api_url=settings.API_BASE_URL)

        # Initialize task queue and worker
        task_queue = TaskQueue(cls._redis_client)
        cls._task_worker = TaskWorker(
            task_queue=task_queue,
            redis_client=cls._redis_client,
            poll_interval=settings.TASK_QUEUE_POLL_INTERVAL,
        )
        set_task_worker(cls._task_worker)
        await cls._task_worker.start()
        logger.info("Task worker started")

        # Initialize context manager
        llm_provider = LLMProvider()
        cls._context_manager = ContextWindowManager(
            llm_provider=llm_provider,
            max_context_tokens=settings.MAX_CONTEXT_TOKENS,
        )
        set_context_manager(cls._context_manager)
        logger.info("Context manager initialized")

        # Initialize skill registry and load skills from API
        skill_registry = SkillRegistryHolder.get()
        try:
            skills = await skill_registry.load_skills()
            logger.info("Skill registry initialized", skill_count=len(skills))
        except Exception as e:
            logger.warning("Failed to load skills from API", error=str(e))

    @classmethod
    async def shutdown_services(cls) -> None:
        """Shutdown background services."""
        # Shutdown usage tracker first to flush pending events
        if cls._usage_tracker:
            await shutdown_usage_tracker()
            logger.info("Usage tracker stopped")

        if cls._task_worker:
            await cls._task_worker.stop()
            logger.info("Task worker stopped")

        if cls._redis_client:
            await cls._redis_client.disconnect()
            logger.info("Redis disconnected")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan manager."""
    logger.info("Starting Podex Agent Service", version=settings.VERSION)

    # Initialize services
    await ServiceManager.init_services()

    # Load model capabilities from API (async)
    try:
        await refresh_model_capabilities(force=True)
    except Exception as e:
        logger.warning("Failed to load model capabilities on startup, using fallback", error=str(e))

    yield

    # Shutdown services
    await ServiceManager.shutdown_services()
    logger.info("Shutting down Podex Agent Service")


app = FastAPI(
    title="Podex Agent Service",
    description="AI Agent Orchestration Service",
    version=settings.VERSION,
    docs_url="/docs" if settings.ENVIRONMENT != "production" else None,
    lifespan=lifespan,
)

app.include_router(health.router, tags=["health"])
app.include_router(agents.router, prefix="/agents", tags=["agents"])


if __name__ == "__main__":
    import os

    # Use HOST env var for binding, default to localhost for development safety
    # Set HOST=0.0.0.0 for container deployments to accept external connections
    host = os.environ.get("HOST", "127.0.0.1")
    uvicorn.run(
        "src.main:app",
        host=host,
        port=settings.PORT,
        reload=settings.ENVIRONMENT == "development",
    )
