"""Seed script for pre-seeded terminal-integrated agent types.

This standalone script can be run directly to seed the database.
The actual seed data is defined in src/database/seed_data.py.
"""

import asyncio
import os

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.database.models import TerminalIntegratedAgentType
from src.database.seed_data import DEFAULT_TERMINAL_AGENTS


async def seed_terminal_agents(database_url: str | None = None) -> None:
    """Seed the database with pre-defined terminal-integrated agent types.

    Args:
        database_url: Optional database URL. If not provided, uses DATABASE_URL env var
                      or falls back to default local development URL.
    """
    # Get database URL from parameter, environment, or default
    db_url = database_url or os.environ.get(
        "DATABASE_URL",
        "postgresql+asyncpg://podex:podex@localhost:5432/podex"
    )

    engine = create_async_engine(db_url, echo=False)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        # Get existing slugs
        result = await session.execute(select(TerminalIntegratedAgentType.slug))
        existing_slugs = {row[0] for row in result.fetchall()}

        added_count = 0
        skipped_count = 0

        for agent_data in DEFAULT_TERMINAL_AGENTS:
            slug = agent_data["slug"]

            if slug in existing_slugs:
                print(f"  Skipping {agent_data['name']} (already exists)")
                skipped_count += 1
                continue

            agent = TerminalIntegratedAgentType(
                name=agent_data["name"],
                slug=slug,
                logo_url=agent_data.get("logo_url"),
                description=agent_data.get("description"),
                check_installed_command=agent_data.get("check_installed_command"),
                version_command=agent_data.get("version_command"),
                install_command=agent_data.get("install_command"),
                update_command=agent_data.get("update_command"),
                run_command=agent_data["run_command"],
                default_env_template=agent_data.get("default_env_template", {}),
                is_enabled=agent_data.get("is_enabled", True),
                created_by_admin_id=None,  # System seeded
            )
            session.add(agent)
            added_count += 1
            print(f"  Adding {agent_data['name']}")

        await session.commit()

        print("\nTerminal agents seeding complete:")
        print(f"  Added: {added_count}")
        print(f"  Skipped (existing): {skipped_count}")
        print(f"  Total available: {len(DEFAULT_TERMINAL_AGENTS)}")


if __name__ == "__main__":
    asyncio.run(seed_terminal_agents())
