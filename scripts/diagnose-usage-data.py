#!/usr/bin/env python3
"""
Diagnostic script to check usage data in the database.
Run this to understand why the Daily Token Usage chart is empty.
"""

import asyncio
import sys
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

# Add parent directory to path for imports
sys.path.insert(0, "../services/api/src")

from src.database import get_db_session_maker
from src.database.models import UsageRecord


async def diagnose_usage_data():
    """Diagnose usage data in the database."""
    session_maker = get_db_session_maker()

    async with session_maker() as db:  # type: AsyncSession
        print("=" * 80)
        print("USAGE DATA DIAGNOSTIC")
        print("=" * 80)
        print()

        # 1. Check total number of usage records
        print("1. Total Usage Records")
        print("-" * 40)
        total_result = await db.execute(select(func.count()).select_from(UsageRecord))
        total_records = total_result.scalar() or 0
        print(f"   Total records: {total_records}")
        print()

        if total_records == 0:
            print("❌ No usage records found in the database!")
            print("   This is why your charts are empty.")
            print()
            print("   Possible reasons:")
            print("   - Usage tracking is not initialized in the agent service")
            print("   - No agents have been created/used yet")
            print("   - The usage tracker is not sending events to the API")
            print()
            return

        # 2. Check records by usage type
        print("2. Records by Usage Type")
        print("-" * 40)
        type_result = await db.execute(
            select(
                UsageRecord.usage_type,
                func.count().label("count"),
            )
            .select_from(UsageRecord)
            .group_by(UsageRecord.usage_type)
        )
        for row in type_result:
            print(f"   {row.usage_type}: {row.count} records")
        print()

        # 3. Check date range of existing records
        print("3. Date Range of Records")
        print("-" * 40)
        date_range_result = await db.execute(
            select(
                func.min(UsageRecord.created_at).label("oldest"),
                func.max(UsageRecord.created_at).label("newest"),
            ).select_from(UsageRecord)
        )
        date_range = date_range_result.one()
        print(f"   Oldest record: {date_range.oldest}")
        print(f"   Newest record: {date_range.newest}")
        print()

        # 4. Check records in the last 30 days
        print("4. Records in Last 30 Days")
        print("-" * 40)
        thirty_days_ago = datetime.now(UTC) - timedelta(days=30)
        recent_result = await db.execute(
            select(func.count())
            .select_from(UsageRecord)
            .where(UsageRecord.created_at >= thirty_days_ago)
        )
        recent_count = recent_result.scalar() or 0
        print(f"   Records in last 30 days: {recent_count}")

        if recent_count == 0:
            print()
            print("❌ No records in the last 30 days!")
            print("   This is why your Daily Token Usage chart is empty.")
            print("   Your usage records are older than the selected date range (30 days).")
            print()
            if date_range.newest:
                days_old = (datetime.now(UTC) - date_range.newest.replace(tzinfo=UTC)).days
                print(f"   The most recent record is {days_old} days old.")
                print(f"   Try selecting a longer time range (90 days or 1 year) in the UI.")
            print()
            return
        print()

        # 5. Check token records specifically
        print("5. Token Usage Records")
        print("-" * 40)
        token_result = await db.execute(
            select(func.count())
            .select_from(UsageRecord)
            .where(UsageRecord.usage_type.in_(["tokens_input", "tokens_output"]))
            .where(UsageRecord.created_at >= thirty_days_ago)
        )
        token_count = token_result.scalar() or 0
        print(f"   Token records in last 30 days: {token_count}")
        print()

        # 6. Check daily distribution
        print("6. Daily Token Distribution (Last 30 Days)")
        print("-" * 40)
        daily_result = await db.execute(
            select(
                func.date(UsageRecord.created_at).label("date"),
                func.sum(UsageRecord.quantity).label("tokens"),
            )
            .select_from(UsageRecord)
            .where(UsageRecord.usage_type.in_(["tokens_input", "tokens_output"]))
            .where(UsageRecord.created_at >= thirty_days_ago)
            .group_by(func.date(UsageRecord.created_at))
            .order_by(func.date(UsageRecord.created_at))
        )
        daily_data = list(daily_result)

        if not daily_data:
            print("   ❌ No daily data found!")
            print("   The query is working, but no token records match the criteria.")
        else:
            print(f"   ✓ Found {len(daily_data)} days with token usage:")
            for row in daily_data[:10]:  # Show first 10 days
                print(f"     {row.date}: {row.tokens:,} tokens")
            if len(daily_data) > 10:
                print(f"     ... and {len(daily_data) - 10} more days")
        print()

        # 7. Check compute records by tier
        print("7. Compute Usage by Tier (Last 30 Days)")
        print("-" * 40)
        compute_result = await db.execute(
            select(
                UsageRecord.tier,
                func.sum(UsageRecord.quantity).label("seconds"),
            )
            .select_from(UsageRecord)
            .where(UsageRecord.usage_type == "compute_seconds")
            .where(UsageRecord.created_at >= thirty_days_ago)
            .group_by(UsageRecord.tier)
        )
        compute_data = list(compute_result)

        if not compute_data:
            print("   ℹ️  No compute usage records found.")
            print("   This is normal if no workspaces/pods have been used.")
        else:
            print(f"   ✓ Found compute usage across {len(compute_data)} tier(s):")
            for row in compute_data:
                hours = (row.seconds or 0) / 3600
                print(f"     {row.tier or 'unknown'}: {hours:.2f} hours")
        print()

        print("=" * 80)
        print("DIAGNOSIS COMPLETE")
        print("=" * 80)


if __name__ == "__main__":
    asyncio.run(diagnose_usage_data())
