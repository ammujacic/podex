"""Doctor command for environment diagnostics.

Provides comprehensive system health checks and configuration validation.
"""

import asyncio
import platform
import sys
from datetime import UTC, datetime
from typing import Annotated, Any

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.connection import get_db
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

logger = structlog.get_logger()

router = APIRouter(prefix="/doctor", tags=["doctor"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


# =============================================================================
# Response Models
# =============================================================================


class ServiceHealth(BaseModel):
    """Health status of a service or component."""

    name: str
    status: str = Field(description="healthy, degraded, unhealthy, or unknown")
    latency_ms: float | None = Field(default=None, description="Response time in milliseconds")
    message: str | None = Field(default=None, description="Additional status message")
    details: dict[str, Any] | None = Field(default=None, description="Additional details")


class LLMProviderStatus(BaseModel):
    """Status of an LLM provider."""

    provider: str
    configured: bool
    model: str | None = None
    details: dict[str, Any] | None = None


class SystemInfo(BaseModel):
    """System information."""

    platform: str
    python_version: str
    app_version: str
    environment: str
    server_time: str


class DoctorReport(BaseModel):
    """Complete diagnostic report."""

    status: str = Field(description="Overall status: healthy, degraded, or unhealthy")
    timestamp: str
    system: SystemInfo
    services: list[ServiceHealth]
    llm_providers: list[LLMProviderStatus]
    recommendations: list[str] = Field(default_factory=list)


# =============================================================================
# Diagnostic Functions
# =============================================================================


async def check_database(db: AsyncSession) -> ServiceHealth:
    """Check database connectivity and health."""
    start = datetime.now(UTC)
    try:
        result = await db.execute(text("SELECT 1"))
        result.scalar()
        latency = (datetime.now(UTC) - start).total_seconds() * 1000

        # Get some DB stats
        tables_result = await db.execute(
            text("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'")
        )
        table_count = tables_result.scalar()

        return ServiceHealth(
            name="PostgreSQL Database",
            status="healthy",
            latency_ms=round(latency, 2),
            message="Connected and responsive",
            details={"tables": table_count, "url_masked": settings.DATABASE_URL[:30] + "..."},
        )
    except Exception as e:
        latency = (datetime.now(UTC) - start).total_seconds() * 1000
        return ServiceHealth(
            name="PostgreSQL Database",
            status="unhealthy",
            latency_ms=round(latency, 2),
            message=f"Connection failed: {str(e)[:100]}",
        )


async def check_redis() -> ServiceHealth:
    """Check Redis connectivity."""
    start = datetime.now(UTC)
    try:
        import redis.asyncio as aioredis

        client = aioredis.from_url(settings.REDIS_URL)
        await client.ping()
        info = await client.info("memory")
        await client.aclose()  # type: ignore[attr-defined]

        latency = (datetime.now(UTC) - start).total_seconds() * 1000

        return ServiceHealth(
            name="Redis",
            status="healthy",
            latency_ms=round(latency, 2),
            message="Connected and responsive",
            details={
                "used_memory_human": info.get("used_memory_human", "unknown"),
                "url_masked": settings.REDIS_URL[:20] + "...",
            },
        )
    except Exception as e:
        latency = (datetime.now(UTC) - start).total_seconds() * 1000
        return ServiceHealth(
            name="Redis",
            status="unhealthy",
            latency_ms=round(latency, 2),
            message=f"Connection failed: {str(e)[:100]}",
        )


async def check_compute_service() -> ServiceHealth:
    """Check compute service connectivity."""
    start = datetime.now(UTC)
    try:
        headers = {}
        if settings.INTERNAL_SERVICE_TOKEN:
            headers["X-Internal-Service-Token"] = settings.INTERNAL_SERVICE_TOKEN
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                f"{settings.COMPUTE_SERVICE_URL}/health",
                headers=headers,
            )
            latency = (datetime.now(UTC) - start).total_seconds() * 1000

            if response.status_code == 200:
                data = response.json()
                return ServiceHealth(
                    name="Compute Service",
                    status="healthy",
                    latency_ms=round(latency, 2),
                    message="Connected and responsive",
                    details={"version": data.get("version", "unknown")},
                )
            return ServiceHealth(
                name="Compute Service",
                status="degraded",
                latency_ms=round(latency, 2),
                message=f"Returned status {response.status_code}",
            )
    except Exception as e:
        latency = (datetime.now(UTC) - start).total_seconds() * 1000
        return ServiceHealth(
            name="Compute Service",
            status="unhealthy",
            latency_ms=round(latency, 2),
            message=f"Connection failed: {str(e)[:100]}",
        )


async def check_agent_service() -> ServiceHealth:
    """Check agent service connectivity."""
    start = datetime.now(UTC)
    try:
        headers = {}
        if settings.INTERNAL_SERVICE_TOKEN:
            headers["Authorization"] = f"Bearer {settings.INTERNAL_SERVICE_TOKEN}"
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                f"{settings.AGENT_SERVICE_URL}/health",
                headers=headers,
            )
            latency = (datetime.now(UTC) - start).total_seconds() * 1000

            if response.status_code == 200:
                data = response.json()
                return ServiceHealth(
                    name="Agent Service",
                    status="healthy",
                    latency_ms=round(latency, 2),
                    message="Connected and responsive",
                    details={"version": data.get("version", "unknown")},
                )
            return ServiceHealth(
                name="Agent Service",
                status="degraded",
                latency_ms=round(latency, 2),
                message=f"Returned status {response.status_code}",
            )
    except Exception as e:
        latency = (datetime.now(UTC) - start).total_seconds() * 1000
        return ServiceHealth(
            name="Agent Service",
            status="unhealthy",
            latency_ms=round(latency, 2),
            message=f"Connection failed: {str(e)[:100]}",
        )


async def check_docker() -> ServiceHealth:
    """Check Docker availability."""
    start = datetime.now(UTC)
    try:
        import docker  # type: ignore[import-untyped]

        client = docker.from_env()
        info = client.info()
        latency = (datetime.now(UTC) - start).total_seconds() * 1000

        return ServiceHealth(
            name="Docker",
            status="healthy",
            latency_ms=round(latency, 2),
            message="Docker daemon is running",
            details={
                "containers_running": info.get("ContainersRunning", 0),
                "images": info.get("Images", 0),
                "server_version": info.get("ServerVersion", "unknown"),
            },
        )
    except Exception as e:
        latency = (datetime.now(UTC) - start).total_seconds() * 1000
        return ServiceHealth(
            name="Docker",
            status="unhealthy",
            latency_ms=round(latency, 2),
            message=f"Docker not available: {str(e)[:100]}",
        )


def check_llm_providers() -> list[LLMProviderStatus]:
    """Check LLM provider configurations.

    Note: Each model specifies its own provider in the database.
    This function shows which providers have their credentials configured.
    """
    providers = []

    # Anthropic
    anthropic_configured = bool(settings.ANTHROPIC_API_KEY)
    providers.append(
        LLMProviderStatus(
            provider="anthropic",
            configured=anthropic_configured,
            model="claude-sonnet-4-20250514" if anthropic_configured else None,
            details={"api_key_set": anthropic_configured},
        )
    )

    # OpenAI
    openai_configured = bool(settings.OPENAI_API_KEY)
    providers.append(
        LLMProviderStatus(
            provider="openai",
            configured=openai_configured,
            model="gpt-4o" if openai_configured else None,
            details={"api_key_set": openai_configured},
        )
    )

    # OpenRouter (platform default for routing to multiple providers)
    openrouter_configured = bool(settings.OPENROUTER_API_KEY)
    providers.append(
        LLMProviderStatus(
            provider="openrouter",
            configured=openrouter_configured,
            model=None,  # Multiple models available
            details={"api_key_set": openrouter_configured},
        )
    )

    # Ollama local model provider
    providers.append(
        LLMProviderStatus(
            provider="ollama",
            configured=True,  # Always available locally
            model=settings.OLLAMA_MODEL,
            details={"url": settings.OLLAMA_URL},
        )
    )

    return providers


def generate_recommendations(
    services: list[ServiceHealth],
    providers: list[LLMProviderStatus],
) -> list[str]:
    """Generate recommendations based on diagnostic results."""
    recommendations = []

    # Check for unhealthy services
    for service in services:
        if service.status == "unhealthy":
            if service.name == "PostgreSQL Database":
                recommendations.append(
                    "Database connection failed. Check DATABASE_URL and "
                    "ensure PostgreSQL is running."
                )
            elif service.name == "Redis":
                recommendations.append(
                    "Redis connection failed. Check REDIS_URL and ensure Redis is running."
                )
            elif service.name == "Compute Service":
                recommendations.append(
                    "Compute service is not reachable. Start it with "
                    "'cd services/compute && uv run python -m src.main'"
                )
            elif service.name == "Agent Service":
                recommendations.append(
                    "Agent service is not reachable. Start it with "
                    "'cd services/agent && uv run python -m src.main'"
                )
            elif service.name == "Docker":
                recommendations.append(
                    "Docker is not running. Start Docker Desktop or the Docker daemon."
                )

    # Check if at least one cloud provider is configured
    cloud_providers = [p for p in providers if p.provider not in ("ollama", "lmstudio")]
    if not any(p.configured for p in cloud_providers):
        recommendations.append(
            "No cloud LLM providers are configured. Set ANTHROPIC_API_KEY, "
            "OPENAI_API_KEY, or OPENROUTER_API_KEY to use cloud models."
        )

    return recommendations


# =============================================================================
# Routes
# =============================================================================


@router.get("", response_model=DoctorReport)
@limiter.limit(RATE_LIMIT_STANDARD)
async def run_doctor(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> DoctorReport:
    """Run comprehensive environment diagnostics.

    Checks:
    - Database connectivity
    - Redis connectivity
    - Compute service health
    - Agent service health
    - Docker availability
    - LLM provider configurations

    Returns a complete diagnostic report with recommendations.
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Run all checks in parallel
    db_check, redis_check, compute_check, agent_check, docker_check = await asyncio.gather(
        check_database(db),
        check_redis(),
        check_compute_service(),
        check_agent_service(),
        check_docker(),
        return_exceptions=True,
    )

    # Handle any exceptions
    services = []
    for name, check in [
        ("PostgreSQL Database", db_check),
        ("Redis", redis_check),
        ("Compute Service", compute_check),
        ("Agent Service", agent_check),
        ("Docker", docker_check),
    ]:
        if isinstance(check, BaseException):
            services.append(
                ServiceHealth(
                    name=name,
                    status="unknown",
                    message=f"Check failed: {str(check)[:100]}",
                )
            )
        else:
            services.append(check)

    # Check LLM providers
    providers = check_llm_providers()

    # Generate recommendations
    recommendations = generate_recommendations(services, providers)

    # Determine overall status
    unhealthy_count = sum(1 for s in services if s.status == "unhealthy")
    degraded_count = sum(1 for s in services if s.status == "degraded")

    if unhealthy_count > 0:
        overall_status = "unhealthy"
    elif degraded_count > 0:
        overall_status = "degraded"
    else:
        overall_status = "healthy"

    # System info
    system_info = SystemInfo(
        platform=platform.platform(),
        python_version=sys.version.split()[0],
        app_version=settings.VERSION,
        environment=settings.ENVIRONMENT,
        server_time=datetime.now(UTC).isoformat(),
    )

    logger.info(
        "Doctor check completed",
        user_id=user_id,
        overall_status=overall_status,
        unhealthy_services=unhealthy_count,
        recommendations_count=len(recommendations),
    )

    return DoctorReport(
        status=overall_status,
        timestamp=datetime.now(UTC).isoformat(),
        system=system_info,
        services=services,
        llm_providers=providers,
        recommendations=recommendations,
    )


@router.get("/quick", response_model=dict[str, str])
@limiter.limit(RATE_LIMIT_STANDARD)
async def quick_check(
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
) -> dict[str, str]:
    """Quick health check without authentication.

    Returns basic status without detailed diagnostics.
    Useful for monitoring and health probes.
    """
    return {
        "status": "ok",
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT,
    }
