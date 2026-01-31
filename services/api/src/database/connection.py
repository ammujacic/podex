"""Database connection and session management."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import structlog
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from src.config import settings
from src.database.models import (
    AgentRoleConfig,
    AgentTool,
    Base,
    CustomCommand,
    DefaultMCPServer,
    HardwareSpec,
    HealthCheck,
    LLMModel,
    LLMProvider,
    PlatformSetting,
    PodTemplate,
    SkillTemplate,
    SubscriptionPlan,
    SystemSkill,
    WorkspaceServer,
)

logger = structlog.get_logger()

# Create async engine with configurable pool settings
engine: AsyncEngine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_POOL_MAX_OVERFLOW,
    pool_timeout=settings.DB_POOL_TIMEOUT,
    pool_recycle=settings.DB_POOL_RECYCLE,
)


# MEDIUM FIX: Add connection pool event listeners for monitoring
def _setup_pool_listeners(async_engine: AsyncEngine) -> None:
    """Setup connection pool event listeners for metrics and debugging.

    This helps detect pool exhaustion before it causes request failures.
    """
    pool = async_engine.sync_engine.pool

    @event.listens_for(pool, "checkout")
    def _on_checkout(
        _dbapi_conn: object, _connection_record: object, _connection_proxy: object
    ) -> None:
        """Log when connection is checked out from pool."""
        checked_out = pool.checkedout()  # type: ignore[attr-defined]
        pool_size = pool.size()  # type: ignore[attr-defined]
        overflow = pool.overflow()  # type: ignore[attr-defined]
        if checked_out >= pool_size:
            logger.warning(
                "DB pool at capacity",
                checked_out=checked_out,
                pool_size=pool_size,
                overflow=overflow,
                max_overflow=settings.DB_POOL_MAX_OVERFLOW,
            )

    @event.listens_for(pool, "checkin")
    def _on_checkin(_dbapi_conn: object, _connection_record: object) -> None:
        """Log when connection returns to pool after high usage."""
        checked_out = pool.checkedout()  # type: ignore[attr-defined]
        pool_size = pool.size()  # type: ignore[attr-defined]
        # Only log when returning from near-capacity state
        if checked_out >= pool_size - 1:
            logger.debug(
                "DB connection returned to pool",
                checked_out=checked_out,
                pool_size=pool_size,
            )

    @event.listens_for(pool, "invalidate")
    def _on_invalidate(
        _dbapi_conn: object, _connection_record: object, exception: Exception | None
    ) -> None:
        """Log when connection is invalidated."""
        logger.warning(
            "DB connection invalidated",
            exception=str(exception) if exception else None,
        )


# Setup pool listeners
_setup_pool_listeners(engine)


def get_pool_status() -> dict[str, int]:
    """Get current connection pool status for health checks.

    MEDIUM FIX: Provides visibility into pool state for monitoring.
    """
    pool = engine.sync_engine.pool
    return {
        "pool_size": pool.size(),  # type: ignore[attr-defined]
        "checked_out": pool.checkedout(),  # type: ignore[attr-defined]
        "overflow": pool.overflow(),  # type: ignore[attr-defined]
        "checked_in": pool.checkedin(),  # type: ignore[attr-defined]
    }


# Create async session factory
async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def init_database() -> None:
    """Initialize database connection and create tables if needed.

    In development/test: Creates tables from models using create_all().
    In production: Relies on Alembic migrations for schema management.

    This separation is necessary because:
    - create_all() can race with multiple gunicorn workers in production
    - Alembic migrations should be the source of truth for production schema
    """
    # Only log the database host, not port or path to minimize information disclosure
    try:
        db_host = settings.DATABASE_URL.split("@")[-1].split(":")[0].split("/")[0]
    except (IndexError, AttributeError):
        db_host = "unknown"
    logger.info("Initializing database connection", host=db_host)

    # Only use create_all() in development/test environments
    # In production, Alembic migrations handle schema creation
    if settings.ENVIRONMENT in ("development", "test"):
        async with engine.begin() as conn:
            # Create all tables from models (idempotent - won't recreate existing tables)
            await conn.run_sync(Base.metadata.create_all)
            logger.info("Database tables created/verified (development mode)")
    else:
        logger.info("Skipping create_all in production - Alembic manages schema")


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
            # Use a try-except to handle cases where checking session state might trigger
            # synchronous database access (e.g., lazy loading relationships)
            try:
                has_changes = bool(session.new or session.dirty or session.deleted)
            except Exception:
                # If checking state fails (e.g., due to lazy loading), commit anyway
                # SQLAlchemy will only commit if there are actual changes
                has_changes = True

            if has_changes:
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
            # Use a try-except to handle cases where checking session state might trigger
            # synchronous database access (e.g., lazy loading relationships)
            try:
                has_changes = bool(session.new or session.dirty or session.deleted)
            except Exception:
                # If checking state fails (e.g., due to lazy loading), commit anyway
                # SQLAlchemy will only commit if there are actual changes
                has_changes = True

            if has_changes:
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
    terminal-integrated agent types, and LLM models.
    """
    # Import default data from centralized seeds location
    from src.database.seeds import (
        DEFAULT_AGENT_ROLES,
        DEFAULT_AGENT_TOOLS,
        DEFAULT_GLOBAL_COMMANDS,
        DEFAULT_HARDWARE_SPECS,
        DEFAULT_HEALTH_CHECKS,
        DEFAULT_MCP_SERVERS,
        DEFAULT_MODELS,
        DEFAULT_PLANS,
        DEFAULT_PROVIDERS,
        DEFAULT_SETTINGS,
        DEFAULT_SKILL_TEMPLATES,
        DEFAULT_SYSTEM_SKILLS,
        DEV_WORKSPACE_SERVERS,
        OFFICIAL_TEMPLATES,
    )

    async with async_session_factory() as db:
        try:
            totals = {
                "plans": 0,
                "hardware": 0,
                "templates": 0,
                "settings": 0,
                "llm_providers": 0,
                "llm_models": 0,
                "global_commands": 0,
                "agent_roles": 0,
                "agent_tools": 0,
                "system_skills": 0,
                "skill_templates": 0,
                "default_mcp_servers": 0,
                "health_checks": 0,
                "workspace_servers": 0,
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

            # Seed LLM providers (must come before models)
            for provider_data in DEFAULT_PROVIDERS:
                result = await db.execute(
                    select(LLMProvider).where(LLMProvider.slug == provider_data["slug"])
                )
                if not result.scalar_one_or_none():
                    db.add(LLMProvider(**provider_data))
                    totals["llm_providers"] += 1

            # Seed LLM models
            for model_data in DEFAULT_MODELS:
                result = await db.execute(
                    select(LLMModel).where(LLMModel.model_id == model_data["model_id"])
                )
                if not result.scalar_one_or_none():
                    db.add(LLMModel(**model_data))
                    totals["llm_models"] += 1

            # Seed global slash commands
            for cmd_data in DEFAULT_GLOBAL_COMMANDS:
                result = await db.execute(
                    select(CustomCommand).where(
                        CustomCommand.name == cmd_data["name"],
                        CustomCommand.is_global == True,
                    )
                )
                if not result.scalar_one_or_none():
                    db.add(
                        CustomCommand(
                            name=cmd_data["name"],
                            description=cmd_data.get("description"),
                            prompt_template=cmd_data["prompt_template"],
                            arguments=cmd_data.get("arguments", []),
                            category=cmd_data.get("category", "custom"),
                            sort_order=cmd_data.get("sort_order", 100),
                            is_global=True,
                            enabled=True,
                            user_id=None,
                            session_id=None,
                        )
                    )
                    totals["global_commands"] += 1

            # Seed agent tools (must come before agent roles since roles reference tools)
            for tool_data in DEFAULT_AGENT_TOOLS:
                result = await db.execute(
                    select(AgentTool).where(AgentTool.name == tool_data["name"])
                )
                if not result.scalar_one_or_none():
                    db.add(
                        AgentTool(
                            name=tool_data["name"],
                            description=tool_data["description"],
                            parameters=tool_data["parameters"],
                            category=tool_data.get("category", "general"),
                            sort_order=tool_data.get("sort_order", 0),
                            is_enabled=tool_data.get("is_enabled", True),
                            is_system=tool_data.get("is_system", True),
                        )
                    )
                    totals["agent_tools"] += 1

            # Seed agent role configurations
            for role_data in DEFAULT_AGENT_ROLES:
                result = await db.execute(
                    select(AgentRoleConfig).where(AgentRoleConfig.role == role_data["role"])
                )
                if not result.scalar_one_or_none():
                    db.add(
                        AgentRoleConfig(
                            role=role_data["role"],
                            name=role_data["name"],
                            color=role_data["color"],
                            icon=role_data.get("icon"),
                            description=role_data.get("description"),
                            system_prompt=role_data["system_prompt"],
                            tools=role_data["tools"],
                            category=role_data.get("category", "development"),
                            gradient_start=role_data.get("gradient_start"),
                            gradient_end=role_data.get("gradient_end"),
                            features=role_data.get("features"),
                            example_prompts=role_data.get("example_prompts"),
                            requires_subscription=role_data.get("requires_subscription"),
                            sort_order=role_data.get("sort_order", 0),
                            is_enabled=role_data.get("is_enabled", True),
                            is_system=role_data.get("is_system", True),
                            created_by_admin_id=None,
                        )
                    )
                    totals["agent_roles"] += 1

            # Seed system skills
            for skill_data in DEFAULT_SYSTEM_SKILLS:
                result = await db.execute(
                    select(SystemSkill).where(SystemSkill.slug == skill_data["slug"])
                )
                if not result.scalar_one_or_none():
                    db.add(SystemSkill(**skill_data))
                    totals["system_skills"] += 1

            # Seed skill templates
            for template_data in DEFAULT_SKILL_TEMPLATES:
                result = await db.execute(
                    select(SkillTemplate).where(SkillTemplate.slug == template_data["slug"])
                )
                if not result.scalar_one_or_none():
                    db.add(SkillTemplate(**template_data))
                    totals["skill_templates"] += 1

            # Seed default MCP servers catalog
            for mcp_data in DEFAULT_MCP_SERVERS:
                result = await db.execute(
                    select(DefaultMCPServer).where(DefaultMCPServer.slug == mcp_data["slug"])
                )
                if not result.scalar_one_or_none():
                    # Convert MCPCategory enum to string value if needed
                    category = mcp_data.get("category")
                    if category is not None and hasattr(category, "value"):
                        category = category.value

                    db.add(
                        DefaultMCPServer(
                            slug=mcp_data["slug"],
                            name=mcp_data["name"],
                            description=mcp_data.get("description"),
                            category=category,
                            transport=mcp_data["transport"],
                            command=mcp_data.get("command"),
                            args=mcp_data.get("args"),
                            url=mcp_data.get("url"),
                            env_vars=mcp_data.get("env_vars"),
                            required_env=mcp_data.get("required_env"),
                            optional_env=mcp_data.get("optional_env"),
                            icon=mcp_data.get("icon"),
                            is_builtin=mcp_data.get("is_builtin", False),
                            docs_url=mcp_data.get("docs_url"),
                            is_enabled=True,
                            is_system=True,
                        )
                    )
                    totals["default_mcp_servers"] += 1

            # Seed built-in health checks
            for check_data in DEFAULT_HEALTH_CHECKS:
                result = await db.execute(
                    select(HealthCheck).where(
                        HealthCheck.name == check_data["name"],
                        HealthCheck.category == check_data["category"],
                        HealthCheck.is_builtin == True,
                    )
                )
                if not result.scalar_one_or_none():
                    db.add(
                        HealthCheck(
                            category=check_data["category"],
                            name=check_data["name"],
                            description=check_data.get("description"),
                            command=check_data["command"],
                            working_directory=check_data.get("working_directory"),
                            timeout=check_data.get("timeout", 60),
                            parse_mode=check_data["parse_mode"],
                            parse_config=check_data["parse_config"],
                            weight=check_data.get("weight", 1.0),
                            enabled=check_data.get("enabled", True),
                            is_builtin=True,
                            project_types=check_data.get("project_types"),
                            fix_command=check_data.get("fix_command"),
                            user_id=None,
                            session_id=None,
                        )
                    )
                    totals["health_checks"] += 1

            # Seed local development workspace servers (development only)
            if settings.ENVIRONMENT == "development":
                for server_data in DEV_WORKSPACE_SERVERS:
                    result = await db.execute(
                        select(WorkspaceServer).where(
                            WorkspaceServer.hostname == server_data["hostname"]
                        )
                    )
                    if not result.scalar_one_or_none():
                        db.add(WorkspaceServer(**server_data))
                        totals["workspace_servers"] += 1

            await db.commit()

            if any(totals.values()):
                logger.info(
                    "Database seeded",
                    plans=totals["plans"],
                    hardware=totals["hardware"],
                    templates=totals["templates"],
                    settings=totals["settings"],
                    llm_providers=totals["llm_providers"],
                    llm_models=totals["llm_models"],
                    global_commands=totals["global_commands"],
                    agent_tools=totals["agent_tools"],
                    agent_roles=totals["agent_roles"],
                    system_skills=totals["system_skills"],
                    skill_templates=totals["skill_templates"],
                    default_mcp_servers=totals["default_mcp_servers"],
                    health_checks=totals["health_checks"],
                    workspace_servers=totals["workspace_servers"],
                )

        except Exception as e:
            await db.rollback()
            logger.exception("Failed to seed database", error=str(e))
            raise
