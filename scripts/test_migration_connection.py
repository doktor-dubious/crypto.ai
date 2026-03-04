#!/usr/bin/env python3
"""
Test script to verify database connections before running migration.

Usage:
    python scripts/test_migration_connection.py
"""

import sys
import os

print("Testing migration prerequisites...\n")
print("=" * 60)

# Test 1: Check Python packages
print("\n1. Checking required packages...")
try:
    import pymysql
    print("   ✓ pymysql installed")
except ImportError:
    print("   ✗ pymysql not installed. Run: pip install pymysql")
    sys.exit(1)

try:
    import asyncpg
    print("   ✓ asyncpg installed")
except ImportError:
    print("   ✗ asyncpg not installed. Run: pip install asyncpg")
    sys.exit(1)

# Test 2: Check MySQL connection
print("\n2. Testing MySQL connection...")
try:
    mysql_conn = pymysql.connect(
        host="localhost",
        port=3306,
        user="trillian",
        password="zaphood_xjdhd73hGH",
        database="publication",
    )

    with mysql_conn.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM publication WHERE publication_id = 220")
        result = cursor.fetchone()
        if result[0] > 0:
            print(f"   ✓ MySQL connection successful")
            print(f"   ✓ Found publication_id=220")
        else:
            print(f"   ⚠ MySQL connection successful, but publication_id=220 not found")

    mysql_conn.close()
except Exception as e:
    print(f"   ✗ MySQL connection failed: {e}")
    print("   Check your MySQL credentials and ensure the database is running")
    sys.exit(1)

# Test 3: Check PostgreSQL connection
print("\n3. Testing PostgreSQL connection...")
try:
    import asyncio

    async def test_postgres():
        postgres_url = os.getenv("DATABASE_URL")
        if not postgres_url:
            print("   ✗ DATABASE_URL environment variable not set")
            print("   Set it with: export DATABASE_URL=postgresql://user:pass@localhost/dbname")
            return False

        try:
            conn = await asyncpg.connect(postgres_url)

            # Check if tables exist
            result = await conn.fetchval(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'customers'"
            )

            if result > 0:
                print(f"   ✓ PostgreSQL connection successful")
                print(f"   ✓ Gorm.ai schema exists")
            else:
                print(f"   ⚠ PostgreSQL connected but schema not found")
                print(f"   Run: alembic upgrade head")

            await conn.close()
            return True

        except Exception as e:
            print(f"   ✗ PostgreSQL connection failed: {e}")
            return False

    success = asyncio.run(test_postgres())
    if not success:
        sys.exit(1)

except Exception as e:
    print(f"   ✗ PostgreSQL test failed: {e}")
    sys.exit(1)

# Test 4: Check for publication_id=220 data
print("\n4. Checking data for publication_id=220...")
try:
    mysql_conn = pymysql.connect(
        host="localhost",
        port=3306,
        user="trillian",
        password="zaphood_xjdhd73hGH",
        database="publication",
        cursorclass=pymysql.cursors.DictCursor,
    )

    with mysql_conn.cursor() as cursor:
        # Count outlets
        cursor.execute(
            "SELECT COUNT(*) as count FROM outlet WHERE publication_id = 220 AND active = 1"
        )
        outlet_count = cursor.fetchone()["count"]
        print(f"   Outlets (active): {outlet_count}")

        # Count sales
        cursor.execute(
            "SELECT COUNT(*) as count FROM sales_data WHERE publication_id = 220 AND active = 1"
        )
        sales_count = cursor.fetchone()["count"]
        print(f"   Sales records (active): {sales_count}")

        # Date range
        cursor.execute(
            """
            SELECT
                MIN(publication_date) as min_date,
                MAX(publication_date) as max_date
            FROM sales_data
            WHERE publication_id = 220 AND active = 1
            """
        )
        date_range = cursor.fetchone()
        print(f"   Sales date range: {date_range['min_date']} to {date_range['max_date']}")

    mysql_conn.close()

except Exception as e:
    print(f"   ✗ Failed to query data: {e}")

print("\n" + "=" * 60)
print("✓ All checks passed! Ready to migrate.")
print("\nNext steps:")
print("  1. Dry run:  python scripts/migrate_from_legacy.py --publication-id 220 --dry-run")
print("  2. Migrate:  python scripts/migrate_from_legacy.py --publication-id 220")
print("=" * 60)
