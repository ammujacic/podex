"""Admin config sync management routes.

Provides endpoints to manually trigger config sync from database to Redis.
This is typically called automatically on startup, but can be triggered
manually when config is updated via the admin UI.
"""

from typing import Annotated

import structlog
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.middleware.admin import require_admin
from src.services.config_sync import (
    sync_config_to_redis,
    sync_roles_to_redis,
    sync_skills_to_redis,
    sync_tools_to_redis,
)

logger = structlog.get_logger()

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db)]


class ConfigSyncResponse(BaseModel):
    """Response for config sync operations."""

    success: bool
    synced: dict[str, int]


class PartialSyncResponse(BaseModel):
    """Response for partial sync operations."""

    success: bool
    count: int


@router.post("/sync", response_model=ConfigSyncResponse)
async def sync_all_config(
    db: DbSession,
    _: None = Depends(require_admin),
) -> ConfigSyncResponse:
    """Re-sync all configuration from database to Redis.

    This syncs:
    - Agent tools
    - Agent roles
    - Agent modes
    - System skills

    Should be called after updating config via admin endpoints.
    """
    try:
        counts = await sync_config_to_redis(db)
        logger.info("Admin triggered config sync", counts=counts)
        return ConfigSyncResponse(success=True, synced=counts)
    except Exception as e:
        logger.exception("Config sync failed", error=str(e))
        return ConfigSyncResponse(success=False, synced={})


@router.post("/sync/tools", response_model=PartialSyncResponse)
async def sync_tools(
    db: DbSession,
    _: None = Depends(require_admin),
) -> PartialSyncResponse:
    """Sync only tools to Redis."""
    try:
        count = await sync_tools_to_redis(db)
        logger.info("Admin triggered tools sync", count=count)
        return PartialSyncResponse(success=True, count=count)
    except Exception as e:
        logger.exception("Tools sync failed", error=str(e))
        return PartialSyncResponse(success=False, count=0)


@router.post("/sync/roles", response_model=PartialSyncResponse)
async def sync_roles(
    db: DbSession,
    _: None = Depends(require_admin),
) -> PartialSyncResponse:
    """Sync only roles to Redis."""
    try:
        count = await sync_roles_to_redis(db)
        logger.info("Admin triggered roles sync", count=count)
        return PartialSyncResponse(success=True, count=count)
    except Exception as e:
        logger.exception("Roles sync failed", error=str(e))
        return PartialSyncResponse(success=False, count=0)


@router.post("/sync/skills", response_model=PartialSyncResponse)
async def sync_skills(
    db: DbSession,
    _: None = Depends(require_admin),
) -> PartialSyncResponse:
    """Sync only skills to Redis."""
    try:
        count = await sync_skills_to_redis(db)
        logger.info("Admin triggered skills sync", count=count)
        return PartialSyncResponse(success=True, count=count)
    except Exception as e:
        logger.exception("Skills sync failed", error=str(e))
        return PartialSyncResponse(success=False, count=0)
