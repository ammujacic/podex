#!/usr/bin/env python3
"""Standalone database seeding script.

This script can be run manually or as an entrypoint to seed the database
with default data. It reuses the same seeding logic from connection.py.

Usage:
    # From the services/api directory:
    python -m scripts.seed_database

    # Or directly:
    python scripts/seed_database.py

    # From docker-compose:
    docker-compose exec api python -m scripts.seed_database
"""

import asyncio
import sys
from pathlib import Path

# Add the src directory to the path so we can import from it
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))


async def main() -> int:
    """Run the database seeding process."""
    from src.database.connection import init_database, seed_database  # noqa: PLC0415

    print("Initializing database connection...")
    await init_database()

    print("Seeding database with default data...")
    await seed_database()

    print("Database seeding complete.")
    return 0


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
