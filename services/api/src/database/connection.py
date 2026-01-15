"""Database connection and session management."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from src.config import settings
from src.database.models import (
    Base,
    HardwareSpec,
    PlatformSetting,
    PodTemplate,
    SubscriptionPlan,
    TerminalIntegratedAgentType,
)

logger = structlog.get_logger()

# Create async engine
engine: AsyncEngine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

# Create async session factory
async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def init_database() -> None:
    """Initialize database connection and create tables if needed."""
    logger.info("Initializing database connection", url=settings.DATABASE_URL.split("@")[-1])

    async with engine.begin() as conn:
        # Create all tables from models (idempotent - won't recreate existing tables)
        await conn.run_sync(Base.metadata.create_all)
        logger.info("Database tables created/verified")


async def close_database() -> None:
    """Close database connection pool."""
    logger.info("Closing database connection pool")
    await engine.dispose()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for getting database session.

    Usage:
        @router.get("/items")
        async def get_items(db: AsyncSession = Depends(get_db)):
            ...
    """
    async with async_session_factory() as session:
        try:
            yield session
            # Only commit if there are pending changes (new, dirty, or deleted objects)
            if session.new or session.dirty or session.deleted:
                await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


@asynccontextmanager
async def get_db_context() -> AsyncGenerator[AsyncSession, None]:
    """Context manager for database session.

    Usage:
        async with get_db_context() as db:
            ...
    """
    async with async_session_factory() as session:
        try:
            yield session
            # Only commit if there are pending changes (new, dirty, or deleted objects)
            if session.new or session.dirty or session.deleted:
                await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def seed_database() -> None:
    """Seed the database with default data.

    This function is idempotent - it will only create records that don't already exist.
    It seeds: subscription plans, hardware specs, pod templates, platform settings,
    and terminal-integrated agent types.
    """
    # Import default data from admin routes and seed data
    from src.database.seed_data import DEFAULT_TERMINAL_AGENTS  # noqa: PLC0415
    from src.routes.admin.hardware import DEFAULT_HARDWARE_SPECS  # noqa: PLC0415
    from src.routes.admin.plans import DEFAULT_PLANS  # noqa: PLC0415
    from src.routes.admin.settings import DEFAULT_SETTINGS  # noqa: PLC0415
    from src.routes.templates import OFFICIAL_TEMPLATES  # noqa: PLC0415

    async with async_session_factory() as db:
        try:
            totals = {
                "plans": 0,
                "hardware": 0,
                "templates": 0,
                "settings": 0,
                "terminal_agents": 0,
            }

            # Seed subscription plans
            for plan_data in DEFAULT_PLANS:
                result = await db.execute(
                    select(SubscriptionPlan).where(SubscriptionPlan.slug == plan_data["slug"])
                )
                if not result.scalar_one_or_none():
                    db.add(SubscriptionPlan(**plan_data))
                    totals["plans"] += 1

            # Seed hardware specs
            for spec_data in DEFAULT_HARDWARE_SPECS:
                result = await db.execute(
                    select(HardwareSpec).where(HardwareSpec.tier == spec_data["tier"])
                )
                if not result.scalar_one_or_none():
                    db.add(HardwareSpec(**spec_data))
                    totals["hardware"] += 1

            # Seed pod templates
            for template_data in OFFICIAL_TEMPLATES:
                result = await db.execute(
                    select(PodTemplate).where(PodTemplate.slug == template_data["slug"])
                )
                if not result.scalar_one_or_none():
                    db.add(PodTemplate(**template_data))
                    totals["templates"] += 1

            # Seed platform settings
            for setting_data in DEFAULT_SETTINGS:
                result = await db.execute(
                    select(PlatformSetting).where(PlatformSetting.key == setting_data["key"])
                )
                if not result.scalar_one_or_none():
                    db.add(
                        PlatformSetting(
                            key=setting_data["key"],
                            value=setting_data["value"],
                            description=setting_data["description"],
                            category=setting_data["category"],
                            is_public=setting_data["is_public"],
                        )
                    )
                    totals["settings"] += 1

            # Seed terminal-integrated agent types
            for agent_data in DEFAULT_TERMINAL_AGENTS:
                result = await db.execute(
                    select(TerminalIntegratedAgentType).where(
                        TerminalIntegratedAgentType.slug == agent_data["slug"]
                    )
                )
                if not result.scalar_one_or_none():
                    db.add(
                        TerminalIntegratedAgentType(
                            name=agent_data["name"],
                            slug=agent_data["slug"],
                            logo_url=agent_data.get("logo_url"),
                            description=agent_data.get("description"),
                            check_installed_command=agent_data.get("check_installed_command"),
                            version_command=agent_data.get("version_command"),
                            install_command=agent_data.get("install_command"),
                            update_command=agent_data.get("update_command"),
                            run_command=agent_data["run_command"],
                            default_env_template=agent_data.get("default_env_template", {}),
                            is_enabled=agent_data.get("is_enabled", True),
                            created_by_admin_id=None,
                        )
                    )
                    totals["terminal_agents"] += 1

            await db.commit()

            if any(totals.values()):
                logger.info(
                    "Database seeded",
                    plans=totals["plans"],
                    hardware=totals["hardware"],
                    templates=totals["templates"],
                    settings=totals["settings"],
                    terminal_agents=totals["terminal_agents"],
                )

        except Exception as e:
            await db.rollback()
            logger.exception("Failed to seed database", error=str(e))
            raise
