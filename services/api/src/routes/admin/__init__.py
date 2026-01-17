"""Admin routes module."""

from fastapi import APIRouter

from src.routes.admin import (
    analytics,
    audit,
    compliance,
    hardware,
    models,
    organizations,
    plans,
    settings,
    templates,
    users,
)

router = APIRouter(prefix="/admin", tags=["admin"])

# Include all admin sub-routers
router.include_router(users.router, prefix="/users", tags=["admin-users"])
router.include_router(plans.router, prefix="/plans", tags=["admin-plans"])
router.include_router(hardware.router, prefix="/hardware", tags=["admin-hardware"])
router.include_router(templates.router, prefix="/templates", tags=["admin-templates"])
router.include_router(analytics.router, prefix="/analytics", tags=["admin-analytics"])
router.include_router(settings.router, prefix="/settings", tags=["admin-settings"])
router.include_router(models.router, prefix="/models", tags=["admin-models"])
router.include_router(audit.router, prefix="/audit", tags=["admin-audit"])
router.include_router(compliance.router, prefix="/compliance", tags=["admin-compliance"])
router.include_router(organizations.router, prefix="/organizations", tags=["admin-organizations"])
