"""Podex Agent Service - AI Orchestration."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from podex_shared import (
    SentryConfig,
    configure_logging,
    init_sentry,
    init_usage_tracker,
    shutdown_usage_tracker,
)
from podex_shared.redis_client import get_redis_client
from src.config import refresh_model_capabilities, settings
from src.queue.task_queue import TaskQueue
from src.queue.worker import TaskWorker, set_task_worker
from src.routes import agents, health, mcp_skills
from src.skills.loader import Skill
from src.skills.registry import SkillRegistry
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

# Configure unified logging (structlog + Python logging + Sentry integration)
logger = configure_logging("podex-agent")


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

        # Note: Context manager is created per-request with the model specified
        # for each agent run. A global context manager is not used because
        # different agent types have different default models (admin-controlled
        # via the database). The ContextWindowManager requires a specific model
        # for its tokenizer, so it must be instantiated when the model is known.
        cls._context_manager = None

        # Initialize skill registry and load skills from API (with retry)
        skill_registry = SkillRegistryHolder.get()
        skills = await cls._load_skills_with_retry(skill_registry)
        logger.info("Skill registry initialized", skill_count=len(skills))

    @classmethod
    async def _load_skills_with_retry(
        cls,
        skill_registry: SkillRegistry,
        max_retries: int = 30,
        initial_delay: float = 1.0,
    ) -> list[Skill]:
        """Load skills from API with exponential backoff retry."""
        import asyncio

        delay = initial_delay
        for attempt in range(max_retries):
            try:
                skills = await skill_registry.load_skills()
                if (
                    skills or attempt > 5
                ):  # Accept empty after a few tries (API might have no skills)
                    return skills
            except Exception as e:
                if attempt == max_retries - 1:
                    logger.error(
                        "Failed to load skills after max retries, starting without skills",
                        attempts=max_retries,
                        error=str(e),
                    )
                    return []
                logger.info(
                    "Waiting for API to load skills",
                    attempt=attempt + 1,
                    max_retries=max_retries,
                    retry_in=delay,
                )
            # MEDIUM FIX: Add jitter and increase max delay to prevent API spam
            import random

            jitter = random.uniform(0, delay * 0.5)  # noqa: S311
            await asyncio.sleep(delay + jitter)
            delay = min(delay * 1.5, 60.0)  # Cap at 60 seconds (was 10s)
        return []

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


async def _load_model_capabilities_with_retry(
    max_retries: int = 30,
    initial_delay: float = 1.0,
) -> None:
    """Load model capabilities from API with exponential backoff retry."""
    import asyncio

    delay = initial_delay
    for attempt in range(max_retries):
        try:
            await refresh_model_capabilities(force=True)
            logger.info("Model capabilities loaded from API")
            return
        except Exception as e:
            if attempt == max_retries - 1:
                logger.error(
                    "Failed to load model capabilities after max retries, using fallback",
                    attempts=max_retries,
                    error=str(e),
                )
                return
            logger.info(
                "Waiting for API to load model capabilities",
                attempt=attempt + 1,
                max_retries=max_retries,
                retry_in=delay,
            )
        # MEDIUM FIX: Add jitter and increase max delay to prevent API spam
        import random

        jitter = random.uniform(0, delay * 0.5)  # noqa: S311
        await asyncio.sleep(delay + jitter)
        delay = min(delay * 1.5, 60.0)  # Cap at 60 seconds (was 10s)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan manager."""
    logger.info("Starting Podex Agent Service", version=settings.VERSION)

    # Initialize services
    await ServiceManager.init_services()

    # Load model capabilities from API (with retry)
    await _load_model_capabilities_with_retry()

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

# Configure Prometheus metrics endpoint
from prometheus_fastapi_instrumentator import Instrumentator  # noqa: E402

Instrumentator().instrument(app).expose(app)

app.include_router(health.router, tags=["health"])
app.include_router(agents.router, prefix="/agents", tags=["agents"])
app.include_router(mcp_skills.router)


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
