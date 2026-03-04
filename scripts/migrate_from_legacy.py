#!/usr/bin/env python3
"""
Migration script to import data from legacy MySQL database to Gorm.ai PostgreSQL database.

Usage:
    python scripts/migrate_from_legacy.py --publication-id 220
    python scripts/migrate_from_legacy.py --publication-id 220 --table sales
    python scripts/migrate_from_legacy.py --publication-id 220 --table all --dry-run

Tables: customers, outlets, sales, all (default: all)
"""

import argparse
import json
import logging
import sys
from datetime import datetime, date
from pathlib import Path
from typing import Any
from uuid import uuid4

import pymysql
import asyncpg
import asyncio


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler(f"migration_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger(__name__)


class LegacyMigrator:
    """Migrates data from legacy MySQL to Gorm.ai PostgreSQL database."""

    def __init__(
        self,
        mysql_config: dict,
        postgres_url: str,
        publication_id: int,
        table: str = "all",
        country_mapping: dict = None,
        dry_run: bool = False,
    ):
        self.mysql_config = mysql_config
        self.postgres_url = postgres_url
        self.publication_id = publication_id
        self.table = table.lower()
        self.country_mapping = country_mapping or {}
        self.dry_run = dry_run

        # Validate table parameter
        valid_tables = ["all", "customers", "outlets", "sales"]
        if self.table not in valid_tables:
            raise ValueError(f"Invalid table '{self.table}'. Must be one of: {', '.join(valid_tables)}")

        # ID mappings: legacy_id -> new_uuid
        self.customer_uuid: str | None = None
        self.outlet_mapping: dict[int, str] = {}  # outlet_id -> uuid

        # Statistics
        self.stats = {
            "customers": 0,
            "outlets": 0,
            "outlet_info": 0,
            "outlet_deliveries": 0,
            "sales": 0,
        }

    def generate_uuid(self) -> str:
        """Generate a new UUID as string."""
        return str(uuid4())

    def convert_country(self, country_id: int) -> str:
        """Convert country_id to country code."""
        if country_id in self.country_mapping:
            return self.country_mapping[country_id]
        # Default fallback
        return str(country_id) if country_id > 0 else ""

    async def migrate(self):
        """Main migration process."""
        logger.info(f"Starting migration for publication_id={self.publication_id}")
        logger.info(f"Table selection: {self.table}")
        logger.info(f"Dry run mode: {self.dry_run}")

        # Connect to databases
        mysql_conn = pymysql.connect(**self.mysql_config, cursorclass=pymysql.cursors.DictCursor)
        pg_conn = await asyncpg.connect(self.postgres_url)

        try:
            # Start transaction for PostgreSQL
            async with pg_conn.transaction():
                # Determine which tables to migrate
                if self.table == "all":
                    # Migrate everything in order
                    await self.migrate_publication(mysql_conn, pg_conn)
                    await self.migrate_outlets(mysql_conn, pg_conn)
                    await self.migrate_sales(mysql_conn, pg_conn)

                elif self.table == "customers":
                    # Only migrate publication -> customer
                    await self.migrate_publication(mysql_conn, pg_conn)

                elif self.table == "outlets":
                    # Migrate outlets (requires customer to exist)
                    await self.load_customer_uuid(pg_conn)
                    await self.migrate_outlets(mysql_conn, pg_conn)

                elif self.table == "sales":
                    # Migrate sales (requires customer and outlets to exist)
                    await self.load_customer_uuid(pg_conn)
                    await self.load_outlet_mappings(pg_conn)
                    await self.migrate_sales(mysql_conn, pg_conn)

                if self.dry_run:
                    logger.info("DRY RUN - Rolling back transaction")
                    raise Exception("Dry run - intentional rollback")

                logger.info("Migration completed successfully!")
                self.print_statistics()

        except Exception as e:
            if not self.dry_run:
                logger.error(f"Migration failed: {e}", exc_info=True)
                raise
            else:
                logger.info("Dry run completed - no changes made")
                self.print_statistics()

        finally:
            mysql_conn.close()
            await pg_conn.close()

    async def load_customer_uuid(self, pg_conn):
        """Load existing customer UUID from PostgreSQL for selective migration."""
        logger.info(f"Looking up customer for publication_id={self.publication_id}...")

        # Find customer by searching in notes field
        result = await pg_conn.fetchrow(
            """
            SELECT id FROM customers
            WHERE notes LIKE $1
            LIMIT 1
            """,
            f"%publication_id={self.publication_id}%",
        )

        if not result:
            raise ValueError(
                f"Customer for publication_id={self.publication_id} not found. "
                "Run with --table customers or --table all first."
            )

        self.customer_uuid = result["id"]
        logger.info(f"✓ Found customer: {self.customer_uuid}")

    async def load_outlet_mappings(self, pg_conn):
        """Load existing outlet mappings from PostgreSQL for selective migration."""
        logger.info("Loading outlet mappings from database...")

        # Reconstruct mapping from the legacy_outlet_id stored in outlet_info
        results = await pg_conn.fetch(
            """
            SELECT o.id, oi.value AS legacy_outlet_id
            FROM outlets o
            JOIN outlet_info oi ON oi.outlet_id = o.id AND oi.key = 'legacy_outlet_id'
            WHERE o.customer_id = $1 AND o.active = true
            """,
            self.customer_uuid,
        )

        # Build mapping from legacy outlet_id (MySQL PK) to new UUID
        for row in results:
            try:
                legacy_id = int(row["legacy_outlet_id"])
                self.outlet_mapping[legacy_id] = row["id"]
            except (ValueError, TypeError):
                logger.warning(f"Skipping outlet with invalid legacy_outlet_id: {row['legacy_outlet_id']}")

        logger.info(f"✓ Loaded {len(self.outlet_mapping)} outlet mappings")

        if not self.outlet_mapping:
            raise ValueError(
                f"No outlets found for customer {self.customer_uuid}. "
                "Run with --table outlets or --table all first."
            )

    async def migrate_publication(self, mysql_conn, pg_conn):
        """Migrate publication to customer."""
        logger.info("Migrating publication -> customer...")

        with mysql_conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT * FROM publication WHERE publication_id = %s
                """,
                (self.publication_id,),
            )
            pub = cursor.fetchone()

        if not pub:
            raise ValueError(f"Publication {self.publication_id} not found in legacy database")

        # Generate new customer UUID
        self.customer_uuid = self.generate_uuid()

        # Insert into customers table
        await pg_conn.execute(
            """
            INSERT INTO customers (
                id, type, name, description, notes, active, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            self.customer_uuid,
            0,  # type - default
            pub["publication_name"],
            pub["description"],
            f"Migrated from legacy publication_id={self.publication_id}. cps_name={pub.get('cps_name', '')}",
            bool(pub["active"]),
            pub.get("date_created", datetime.now()),
            pub.get("date_upd", datetime.now()),
        )

        self.stats["customers"] += 1
        logger.info(f"✓ Migrated publication: {pub['publication_name']} -> {self.customer_uuid}")

    async def migrate_outlets(self, mysql_conn, pg_conn):
        """Migrate outlets to outlets + outlet_info + outlet_deliveries."""
        logger.info("Migrating outlets...")

        count = 0
        with mysql_conn.cursor(pymysql.cursors.SSDictCursor) as cursor:
            cursor.execute(
                """
                SELECT * FROM outlet
                WHERE publication_id = %s AND active = 1
                ORDER BY outlet_id
                """,
                (self.publication_id,),
            )
            for outlet in cursor:
                await self.migrate_single_outlet(outlet, pg_conn)
                count += 1

        logger.info(f"✓ Migrated {count} outlets")

    async def migrate_single_outlet(self, outlet: dict, pg_conn):
        """Migrate a single outlet with all related data."""
        outlet_uuid = self.generate_uuid()
        legacy_outlet_id = outlet["outlet_id"]
        self.outlet_mapping[legacy_outlet_id] = outlet_uuid

        # Handle end_date (convert '1900-01-01' to NULL)
        end_date = outlet.get("end_date")
        if end_date and end_date.year == 1900:
            end_date = None

        # Handle start_date
        start_date = outlet.get("start_date")
        if start_date and start_date.year == 1900:
            start_date = None

        # Insert main outlet record
        await pg_conn.execute(
            """
            INSERT INTO outlets (
                id, customer_id, ext_id, ext_id_2, name, description, notes,
                address, zip, city, state, country,
                start_date, end_date, scan, season, sublets,
                active, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12,
                $13, $14, $15, $16, $17,
                $18, $19, $20
            )
            """,
            outlet_uuid,
            self.customer_uuid,
            outlet["ext_id_1"],
            outlet["id"] if outlet["id"] != 0 else None,
            outlet["outlet_name"],
            outlet["description"],
            outlet.get("notes", ""),
            outlet["street_and_number"] or None,
            outlet["zip_name"] or None,
            outlet["city_name"] or None,
            outlet["us_state_name"] or None,
            self.convert_country(outlet["country_id"]),
            start_date,
            end_date,
            bool(outlet.get("scan_account", 1)),
            False,  # season - default
            bool(outlet.get("sublets", 0)),  # Convert int to bool
            bool(outlet["active"]),
            outlet.get("date_created", datetime.now()),
            outlet.get("date_upd", datetime.now()),
        )
        self.stats["outlets"] += 1

        # Insert outlet_info records (key-value pairs for extra fields)
        await self.migrate_outlet_info(outlet, outlet_uuid, pg_conn)

        # Insert outlet_deliveries records (draw days)
        await self.migrate_outlet_deliveries(outlet, outlet_uuid, pg_conn)

    async def migrate_outlet_info(self, outlet: dict, outlet_uuid: str, pg_conn):
        """Migrate outlet extra fields to outlet_info table."""
        info_fields = {
            "legacy_outlet_id": outlet["outlet_id"],  # MySQL PK — needed to reconstruct sales mapping
            "peak_period": outlet.get("peak_period"),
            "phone_number": outlet.get("phone_number"),
            "longitude": outlet.get("longitude"),
            "latitude": outlet.get("latitude"),
            "publication": outlet.get("publication"),
            "carrier": outlet.get("carrier"),
            "branch": outlet.get("branch"),
            "product": outlet.get("product"),
            "truck": outlet.get("truck"),
            "sc_type": outlet.get("sc_type"),
            "tariff_model": outlet.get("tariff_model"),
            "outlet_type": outlet.get("outlet_type"),
            "outlet_type_2": outlet.get("outlet_type_2"),
            "zone_id": outlet.get("zone_id"),
            "zone_id_text": outlet.get("zone_id_text"),
            "rate_class_id": outlet.get("rate_class_id"),
            "pay_type": outlet.get("pay_type"),
            "chain_id": outlet.get("chain_id"),
            "area": outlet.get("area"),
            "dc": outlet.get("dc"),
            "auto_generated": outlet.get("auto_generated"),
            "delayed_return": outlet.get("delayed_return"),
            "allow_draw_changes": outlet.get("allow_draw_changes"),
            "drop_location": outlet.get("drop_location"),
            "sub_truck": outlet.get("sub_truck"),
            "custom_1": outlet.get("custom_1"),
            "custom_2": outlet.get("custom_2"),
            "custom_3": outlet.get("custom_3"),
            "custom_4": outlet.get("custom_4"),
            "custom_5": outlet.get("custom_5"),
            "instructions": outlet.get("instructions"),
            "use_scan_sales": outlet.get("use_scan_sales"),
            "scan_prediction": outlet.get("scan_prediction"),
        }

        # Filter out empty values (but always keep legacy_outlet_id)
        info_fields = {
            k: v for k, v in info_fields.items()
            if k == "legacy_outlet_id" or v not in (None, "", 0)
        }

        for key, value in info_fields.items():
            await pg_conn.execute(
                """
                INSERT INTO outlet_info (
                    id, outlet_id, key, value, active, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                """,
                self.generate_uuid(),
                outlet_uuid,
                key,
                str(value),
                True,
                datetime.now(),
                datetime.now(),
            )
            self.stats["outlet_info"] += 1

    async def migrate_outlet_deliveries(self, outlet: dict, outlet_uuid: str, pg_conn):
        """Migrate outlet draw days to outlet_deliveries table."""
        draw_days = [
            ("draw_monday", 0),
            ("draw_tuesday", 1),
            ("draw_wednesday", 2),
            ("draw_thursday", 3),
            ("draw_friday", 4),
            ("draw_saturday", 5),
            ("draw_sunday", 6),
        ]

        for field_name, weekday in draw_days:
            quantity = 1 if outlet.get(field_name, 1) else 0  # Default to 1 if not specified

            await pg_conn.execute(
                """
                INSERT INTO outlet_deliveries (
                    id, outlet_id, weekday, quantity, active, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                """,
                self.generate_uuid(),
                outlet_uuid,
                weekday,
                quantity,
                True,
                datetime.now(),
                datetime.now(),
            )
            self.stats["outlet_deliveries"] += 1

    async def migrate_sales(self, mysql_conn, pg_conn):
        """Migrate sales_data to sales table."""
        logger.info("Migrating sales data...")

        with mysql_conn.cursor(pymysql.cursors.SSDictCursor) as cursor:
            cursor.execute(
                """
                SELECT * FROM sales_data
                WHERE publication_id = %s AND active = 1
                ORDER BY publication_date, outlet_id
                """,
                (self.publication_id,),
            )

            # Process in batches for better performance
            batch_size = 1000
            batch = []
            total = 0

            while True:
                rows = cursor.fetchmany(batch_size)
                if not rows:
                    break

                for sale in rows:
                    # Get mapped outlet UUID
                    legacy_outlet_id = sale["outlet_id"]
                    if legacy_outlet_id not in self.outlet_mapping:
                        logger.warning(
                            f"Skipping sales record for unmapped outlet_id={legacy_outlet_id}"
                        )
                        continue

                    outlet_uuid = self.outlet_mapping[legacy_outlet_id]

                    batch.append(
                        (
                            self.generate_uuid(),
                            sale["publication_date"],
                            self.customer_uuid,
                            outlet_uuid,
                            sale["sold"],
                            sale.get("delivered"),
                            sale.get("scan_sold"),
                            sale.get("net_sold"),
                            bool(sale["active"]),
                            sale.get("date_created", datetime.now()),
                            sale.get("date_upd", datetime.now()),
                        )
                    )

                # Insert batch
                if batch:
                    await pg_conn.executemany(
                        """
                        INSERT INTO sales (
                            id, date, customer_id, outlet_id, sold, delivered,
                            scan_sold, net_sold, active, created_at, updated_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                        """,
                        batch,
                    )
                    total += len(batch)
                    self.stats["sales"] += len(batch)
                    logger.info(f"  Migrated {total} sales records...")
                    batch = []

        logger.info(f"✓ Migrated {total} sales records")

    def print_statistics(self):
        """Print migration statistics."""
        logger.info("\n" + "=" * 60)
        logger.info("Migration Statistics:")
        logger.info("=" * 60)
        for table, count in self.stats.items():
            logger.info(f"  {table:20} {count:>10} records")
        logger.info("=" * 60)
        logger.info(f"\nCustomer UUID: {self.customer_uuid}")
        logger.info(f"Outlet mappings: {len(self.outlet_mapping)}")

    def save_mapping(self, output_file: str):
        """Save ID mappings to JSON file for reference."""
        mapping = {
            "publication_id": self.publication_id,
            "customer_uuid": self.customer_uuid,
            "outlet_mapping": self.outlet_mapping,
            "timestamp": datetime.now().isoformat(),
        }
        with open(output_file, "w") as f:
            json.dump(mapping, f, indent=2)
        logger.info(f"ID mappings saved to: {output_file}")


async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Migrate data from legacy MySQL database to Gorm.ai PostgreSQL"
    )
    parser.add_argument(
        "--publication-id",
        type=int,
        required=True,
        help="Legacy publication_id to migrate",
    )
    parser.add_argument(
        "--table",
        type=str,
        default="all",
        choices=["all", "customers", "outlets", "sales"],
        help="Table to migrate: all, customers, outlets, or sales (default: all)",
    )
    parser.add_argument(
        "--mysql-host",
        default="localhost",
        help="MySQL host (default: localhost)",
    )
    parser.add_argument(
        "--mysql-port",
        type=int,
        default=3306,
        help="MySQL port (default: 3306)",
    )
    parser.add_argument(
        "--mysql-user",
        default="trillian",
        help="MySQL user (default: trillian)",
    )
    parser.add_argument(
        "--mysql-password",
        default="zaphood_xjdhd73hGH",
        help="MySQL password",
    )
    parser.add_argument(
        "--mysql-database",
        default="publication",
        help="MySQL database (default: publication)",
    )
    parser.add_argument(
        "--postgres-url",
        help="PostgreSQL connection URL (default: from DATABASE_URL env var)",
    )
    parser.add_argument(
        "--country-mapping",
        help="Path to JSON file with country_id -> country_code mapping",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview migration without making changes",
    )
    parser.add_argument(
        "--save-mapping",
        help="Save ID mappings to specified JSON file",
    )

    args = parser.parse_args()

    # MySQL config
    mysql_config = {
        "host": args.mysql_host,
        "port": args.mysql_port,
        "user": args.mysql_user,
        "password": args.mysql_password,
        "database": args.mysql_database,
    }

    # PostgreSQL URL
    postgres_url = args.postgres_url
    if not postgres_url:
        import os

        postgres_url = os.getenv("DATABASE_URL")
        if not postgres_url:
            logger.error(
                "PostgreSQL URL not provided. Use --postgres-url or set DATABASE_URL env var"
            )
            sys.exit(1)

    # Load country mapping if provided
    country_mapping = {}
    if args.country_mapping:
        with open(args.country_mapping) as f:
            country_mapping = json.load(f)
        logger.info(f"Loaded country mapping: {len(country_mapping)} entries")

    # Run migration
    migrator = LegacyMigrator(
        mysql_config=mysql_config,
        postgres_url=postgres_url,
        publication_id=args.publication_id,
        table=args.table,
        country_mapping=country_mapping,
        dry_run=args.dry_run,
    )

    await migrator.migrate()

    # Save mappings if requested
    if args.save_mapping:
        migrator.save_mapping(args.save_mapping)


if __name__ == "__main__":
    asyncio.run(main())
