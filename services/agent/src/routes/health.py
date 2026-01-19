"""Health check routes."""

from fastapi import APIRouter, Depends

from src.config import settings
from src.deps import require_internal_service_token

router = APIRouter(dependencies=[Depends(require_internal_service_token)])


@router.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "healthy", "version": settings.VERSION}
