"""Health check routes."""

from fastapi import APIRouter

from src.config import settings

# Health endpoints must be unauthenticated for container orchestrator health checks
router = APIRouter()


@router.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint (unauthenticated for Docker/K8s probes)."""
    return {"status": "healthy", "version": settings.VERSION}
