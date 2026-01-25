"""Platform settings service with Redis caching.

This module handles fetching and caching platform settings from the PlatformSetting table:
- Caches settings in Redis (no TTL - persists until invalidated)
- Automatically loads settings on startup
- Invalidates cache when admin updates settings
"""

from typing import Any, cast

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.cache import cache_delete, cache_get, cache_set
from src.config import settings as app_settings
from src.database.models import PlatformSetting

logger = structlog.get_logger()

# Redis cache key for all platform settings
PLATFORM_SETTINGS_CACHE_KEY = f"{app_settings.CACHE_PREFIX}platform_settings:all"

# Very long TTL (7 days) - effectively permanent until invalidated
# This acts as a safety net in case invalidation fails
SETTINGS_CACHE_TTL = 7 * 24 * 60 * 60  # 7 days in seconds


async def get_setting(
    db: AsyncSession,
    key: str,
    default: Any = None,
) -> Any:
    """Get a setting value with caching.

    Args:
        db: Database session
        key: The setting key to look up
        default: Default value if setting not found

    Returns:
        Setting value or default
    """
    all_settings = await _get_cached_settings(db)
    return all_settings.get(key, default)


async def get_settings_by_category(
    db: AsyncSession,
    category: str,
) -> dict[str, Any]:
    """Get all settings in a category.

    Args:
        db: Database session
        category: Category to filter by

    Returns:
        Dictionary mapping setting key to value
    """
    # Query DB for category-filtered settings (category info not in cache)
    query = select(PlatformSetting).where(PlatformSetting.category == category)
    result = await db.execute(query)
    settings_list = result.scalars().all()

    return {s.key: s.value for s in settings_list}


async def get_all_settings(db: AsyncSession) -> dict[str, Any]:
    """Get all settings.

    Args:
        db: Database session

    Returns:
        Dictionary mapping setting key to value
    """
    return await _get_cached_settings(db)


async def get_public_settings(db: AsyncSession) -> dict[str, Any]:
    """Get all public settings (is_public=True).

    Args:
        db: Database session

    Returns:
        Dictionary mapping setting key to value for public settings only
    """
    # Public settings need to check is_public flag, so query DB
    # but we can optimize by caching the public subset separately
    query = select(PlatformSetting).where(PlatformSetting.is_public == True)
    result = await db.execute(query)
    settings_list = result.scalars().all()

    return {s.key: s.value for s in settings_list}


async def get_setting_from_cache(key: str, default: Any = None) -> Any:
    """Get setting from Redis cache without database access.

    Useful for contexts where database access is not desired.

    Args:
        key: The setting key
        default: Default value if not found

    Returns:
        Setting value or default
    """
    cached_data = await cache_get(PLATFORM_SETTINGS_CACHE_KEY)
    if cached_data and isinstance(cached_data, dict):
        return cached_data.get(key, default)
    return default


async def get_all_settings_from_cache() -> dict[str, Any]:
    """Get all settings from Redis cache.

    Returns:
        Dictionary of key to value (empty if cache miss)
    """
    cached_data = await cache_get(PLATFORM_SETTINGS_CACHE_KEY)
    if cached_data and isinstance(cached_data, dict):
        return cast("dict[str, Any]", cached_data)
    return {}


async def refresh_settings_cache(db: AsyncSession) -> None:
    """Force refresh the settings cache from database.

    Call this on API startup and when settings are updated.

    Args:
        db: Database session
    """
    await _load_settings_to_cache(db)


async def invalidate_cache() -> None:
    """Invalidate the entire settings cache.

    Call this when any setting is updated via admin panel.
    The next request will trigger a cache refresh from DB.
    """
    try:
        await cache_delete(PLATFORM_SETTINGS_CACHE_KEY)
        logger.info("Invalidated platform settings cache")
    except Exception as e:
        logger.exception("Failed to invalidate settings cache", error=str(e))


async def _get_cached_settings(db: AsyncSession) -> dict[str, Any]:
    """Get settings from cache, loading from DB if not cached.

    Args:
        db: Database session

    Returns:
        Dictionary of all settings
    """
    # Try cache first
    cached_data = await cache_get(PLATFORM_SETTINGS_CACHE_KEY)
    if cached_data and isinstance(cached_data, dict):
        return cast("dict[str, Any]", cached_data)

    # Cache miss - load from DB and cache
    logger.debug("Platform settings cache miss, loading from database")
    return await _load_settings_to_cache(db)


async def _load_settings_to_cache(db: AsyncSession) -> dict[str, Any]:
    """Load all settings from database into Redis cache.

    Args:
        db: Database session

    Returns:
        Dictionary of all settings
    """
    try:
        result = await db.execute(select(PlatformSetting))
        settings_list = result.scalars().all()

        settings_dict: dict[str, Any] = {}
        for setting in settings_list:
            settings_dict[setting.key] = setting.value

        # Cache with long TTL (acts as safety net)
        await cache_set(PLATFORM_SETTINGS_CACHE_KEY, settings_dict, ttl=SETTINGS_CACHE_TTL)

        logger.info(
            "Loaded platform settings to cache",
            settings_count=len(settings_list),
        )

        return settings_dict  # noqa: TRY300

    except Exception as e:
        logger.exception("Failed to load settings from database", error=str(e))
        return {}


async def ensure_settings_cached(db: AsyncSession) -> None:
    """Ensure settings are cached (call on startup).

    This pre-warms the cache so subsequent requests are fast.

    Args:
        db: Database session
    """
    cached_data = await cache_get(PLATFORM_SETTINGS_CACHE_KEY)
    if not cached_data:
        logger.info("Pre-warming platform settings cache on startup")
        await _load_settings_to_cache(db)
    else:
        logger.info("Platform settings cache already populated")


# Export for convenience
__all__ = [
    "ensure_settings_cached",
    "get_all_settings",
    "get_all_settings_from_cache",
    "get_public_settings",
    "get_setting",
    "get_setting_from_cache",
    "get_settings_by_category",
    "invalidate_cache",
    "refresh_settings_cache",
]
