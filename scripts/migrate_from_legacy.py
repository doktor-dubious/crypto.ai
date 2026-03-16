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
        customer_name: str = None,
    ):
        self.mysql_config = mysql_config
        self.postgres_url = postgres_url
        self.publication_id = publication_id
        self.table = table.lower()
        self.country_mapping = country_mapping or {}
        self.dry_run = dry_run
        self.customer_name = customer_name

        # Validate table parameter
        valid_tables = ["all", "customers", "outlets", "deliveries", "sales", "financials", "financial_dates", "pads", "groups", "sales_filters"]
        if self.table not in valid_tables:
            raise ValueError(f"Invalid table '{self.table}'. Must be one of: {', '.join(valid_tables)}")

        # ID mappings: legacy_id -> new_uuid
        self.customer_uuid: str | None = None
        self.outlet_mapping: dict[int, str] = {}  # outlet_id -> uuid
        self.outlet_group_mapping: dict[int, str] = {}  # outlet_group_id -> uuid
        self.financial_date_mapping: dict[int, str] = {}  # tarif_outlet_date_header_id -> uuid  # outlet_group_id -> uuid

        # Statistics
        self.stats = {
            "customers": 0,
            "outlets": 0,
            "outlet_info": 0,
            "outlet_deliveries": 0,
            "outlet_financials": 0,
            "outlet_groups": 0,
            "outlet_group_members": 0,
            "pads": 0,
            "pad_dates": 0,
            "sales": 0,
            "sales_filters": 0,
            "financial_dates": 0,
            "outlet_financial_dates": 0,
        }

    def generate_uuid(self) -> str:
        """Generate a new UUID as string."""
        return str(uuid4())

    @staticmethod
    def sanitize_str(value):
        """Strip null bytes from strings (MySQL allows 0x00, PostgreSQL does not)."""
        if isinstance(value, str):
            return value.replace("\x00", "")
        return value

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
                    await self.migrate_outlet_groups(mysql_conn, pg_conn)
                    await self.migrate_sales(mysql_conn, pg_conn)
                    await self.migrate_sales_filters(mysql_conn, pg_conn)
                    await self.migrate_financial_dates(mysql_conn, pg_conn)

                elif self.table == "customers":
                    # Only migrate publication -> customer
                    await self.migrate_publication(mysql_conn, pg_conn)

                elif self.table == "outlets":
                    # Migrate outlets (requires customer to exist)
                    await self.load_customer_uuid(pg_conn)
                    await self.migrate_outlets(mysql_conn, pg_conn)

                elif self.table == "deliveries":
                    # Re-migrate outlet_deliveries only (requires customer and outlets)
                    await self.load_customer_uuid(pg_conn)
                    await self.load_outlet_mappings(pg_conn)
                    await self.remigrate_deliveries(mysql_conn, pg_conn)

                elif self.table == "financials":
                    # Migrate outlet_financials only (requires outlets to exist)
                    await self.load_customer_uuid(pg_conn)
                    await self.load_outlet_mappings(pg_conn)
                    await self.migrate_financials(mysql_conn, pg_conn)

                elif self.table == "groups":
                    # Migrate outlet_group + outlet_group_members (requires customer and outlets)
                    await self.load_customer_uuid(pg_conn)
                    await self.load_outlet_mappings(pg_conn)
                    await self.migrate_outlet_groups(mysql_conn, pg_conn)

                elif self.table == "pads":
                    # Migrate peak_period -> pads + pad_dates (requires customer to exist)
                    await self.load_customer_uuid(pg_conn)
                    await self.migrate_pads(mysql_conn, pg_conn)

                elif self.table == "sales":
                    # Migrate sales (requires customer and outlets to exist)
                    await self.load_customer_uuid(pg_conn)
                    await self.load_outlet_mappings(pg_conn)
                    await self.migrate_sales(mysql_conn, pg_conn)

                elif self.table == "sales_filters":
                    # Migrate sales_filter date ranges (requires customer to exist)
                    await self.load_customer_uuid(pg_conn)
                    await self.migrate_sales_filters(mysql_conn, pg_conn)

                elif self.table == "financial_dates":
                    # Migrate tarif_outlet_date_header + tarif_outlet_date (requires customer and outlets)
                    await self.load_customer_uuid(pg_conn)
                    await self.load_outlet_mappings(pg_conn)
                    await self.migrate_financial_dates(mysql_conn, pg_conn)

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
            self.sanitize_str(self.customer_name or pub["publication_name"]),
            self.sanitize_str(pub["description"]),
            self.sanitize_str(f"Migrated from legacy publication_id={self.publication_id}. cps_name={pub.get('cps_name', '')}"),
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
        with mysql_conn.cursor(pymysql.cursors.DictCursor) as cursor:
            cursor.execute(
                """
                SELECT * FROM outlet
                WHERE publication_id = %s AND active = 1
                ORDER BY outlet_id
                """,
                (self.publication_id,),
            )
            outlets = cursor.fetchall()

        for outlet in outlets:
            await self.migrate_single_outlet(mysql_conn, outlet, pg_conn)
            count += 1

        logger.info(f"✓ Migrated {count} outlets")

    async def migrate_single_outlet(self, mysql_conn, outlet: dict, pg_conn):
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
            self.sanitize_str(outlet["ext_id_1"]),
            outlet["id"] if outlet["id"] != 0 else None,
            self.sanitize_str(outlet["outlet_name"]),
            self.sanitize_str(outlet["description"]),
            self.sanitize_str(outlet.get("notes", "")),
            self.sanitize_str(outlet["street_and_number"]) or None,
            self.sanitize_str(outlet["zip_name"]) or None,
            self.sanitize_str(outlet["city_name"]) or None,
            self.sanitize_str(outlet["us_state_name"]) or None,
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

        # Insert outlet_deliveries records (draw days + delivery values)
        await self.migrate_outlet_deliveries(mysql_conn, outlet, outlet_uuid, pg_conn)

        # Insert outlet_financials records (cost/profit per weekday)
        await self.migrate_outlet_financials(mysql_conn, outlet["outlet_id"], outlet_uuid, pg_conn)

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
                self.sanitize_str(str(value)),
                True,
                datetime.now(),
                datetime.now(),
            )
            self.stats["outlet_info"] += 1

    async def migrate_outlet_deliveries(self, mysql_conn, outlet: dict, outlet_uuid: str, pg_conn):
        """Migrate outlet draw days + outlet_delivery to outlet_deliveries table.

        - outlet.draw_monday..draw_sunday  -> open (bool: whether the day is a delivery day)
        - outlet_delivery per weekday      -> fixed, minimum, maximum, add, add_pct
        """
        # Map draw_* fields to open flag per weekday (1-7, Monday=1)
        draw_days = [
            ("draw_monday", 1),
            ("draw_tuesday", 2),
            ("draw_wednesday", 3),
            ("draw_thursday", 4),
            ("draw_friday", 5),
            ("draw_saturday", 6),
            ("draw_sunday", 7),
        ]

        open_by_weekday = {}
        for field_name, weekday in draw_days:
            open_by_weekday[weekday] = bool(outlet.get(field_name, 0))

        # Read delivery values from MySQL outlet_delivery table
        legacy_outlet_id = outlet["outlet_id"]
        delivery_by_weekday: dict[int, dict] = {}

        with mysql_conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT day_of_week, minimum_delivery, fixed_delivery,
                       maximum_delivery, added_delivery, added_delivery_pct
                FROM outlet_delivery
                WHERE outlet_id = %s AND active = 1
                """,
                (legacy_outlet_id,),
            )
            rows = cursor.fetchall()

        for row in rows:
            # MySQL day_of_week 0-6 -> PostgreSQL weekday 1-7
            weekday = row["day_of_week"] + 1
            delivery_by_weekday[weekday] = row

        # Insert one row per weekday (1-7)
        for weekday in range(1, 8):
            is_open = open_by_weekday.get(weekday, False)
            delivery = delivery_by_weekday.get(weekday, {})

            await pg_conn.execute(
                """
                INSERT INTO outlet_deliveries (
                    id, outlet_id, weekday, open, fixed, minimum, maximum, add, add_pct, active, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                """,
                self.generate_uuid(),
                outlet_uuid,
                weekday,
                is_open,
                delivery.get("fixed_delivery") or 0,
                delivery.get("minimum_delivery") or 0,
                delivery.get("maximum_delivery") or 0,
                delivery.get("added_delivery") or 0,
                float(delivery.get("added_delivery_pct") or 0),
                True,
                datetime.now(),
                datetime.now(),
            )
            self.stats["outlet_deliveries"] += 1

    async def remigrate_deliveries(self, mysql_conn, pg_conn):
        """Delete and re-migrate outlet_deliveries for all outlets of this customer."""
        logger.info("Re-migrating outlet_deliveries...")

        # Delete existing outlet_deliveries for this customer's outlets
        outlet_uuids = list(self.outlet_mapping.values())
        deleted = await pg_conn.execute(
            """
            DELETE FROM outlet_deliveries
            WHERE outlet_id = ANY($1::uuid[])
            """,
            outlet_uuids,
        )
        logger.info(f"✓ Deleted existing outlet_deliveries: {deleted}")

        # Re-fetch outlet rows from MySQL to get draw_* fields
        legacy_ids = list(self.outlet_mapping.keys())
        placeholders = ", ".join(["%s"] * len(legacy_ids))
        with mysql_conn.cursor(pymysql.cursors.DictCursor) as cursor:
            cursor.execute(
                f"SELECT * FROM outlet WHERE outlet_id IN ({placeholders})",
                legacy_ids,
            )
            outlets = cursor.fetchall()

        for outlet in outlets:
            legacy_id = outlet["outlet_id"]
            outlet_uuid = self.outlet_mapping[legacy_id]
            await self.migrate_outlet_deliveries(mysql_conn, outlet, outlet_uuid, pg_conn)

        logger.info(f"✓ Re-migrated {self.stats['outlet_deliveries']} outlet_deliveries")

    async def migrate_outlet_financials(
        self, mysql_conn, legacy_outlet_id: int, outlet_uuid: str, pg_conn
    ):
        """Migrate tarif_outlet to outlet_financials table.

        MySQL tarif_outlet.day_of_week uses 0=Monday, 6=Sunday.
        outlet_financials.weekday uses 1=Monday, 7=Sunday.

        NOTE: Verify MySQL column names match your tarif_outlet schema:
          - cost_per_unit  (may be named 'cost', 'unit_cost', etc.)
          - profit_per_unit (may be named 'price', 'unit_price', 'net_price', etc.)
        """
        with mysql_conn.cursor() as cursor:
            cursor.execute(
                "SELECT * FROM tarif_outlet WHERE outlet_id = %s",
                (legacy_outlet_id,),
            )
            rows = cursor.fetchall()

        for row in rows:
            # Convert day_of_week: MySQL 0-6 → PostgreSQL 1-7
            weekday = row["day_of_week"] + 1

            await pg_conn.execute(
                """
                INSERT INTO outlet_financials (
                    id, outlet_id, weekday, cost_per_unit, profit_per_unit,
                    active, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                self.generate_uuid(),
                outlet_uuid,
                weekday,
                row.get("cost_per_unit"),
                row.get("profit_per_unit"),
                True,
                datetime.now(),
                datetime.now(),
            )
            self.stats["outlet_financials"] += 1

    async def migrate_financials(self, mysql_conn, pg_conn):
        """Migrate outlet_financials for all outlets (standalone run)."""
        logger.info("Migrating outlet financials...")

        count = 0
        for legacy_outlet_id, outlet_uuid in self.outlet_mapping.items():
            await self.migrate_outlet_financials(
                mysql_conn, legacy_outlet_id, outlet_uuid, pg_conn
            )
            count += 1
            if count % 500 == 0:
                logger.info(f"  Processed {count} outlets for financials...")

        logger.info(f"✓ Migrated {self.stats['outlet_financials']} financial records for {count} outlets")

    async def migrate_outlet_groups(self, mysql_conn, pg_conn):
        """Migrate outlet_group and outlet_group_members tables.

        MySQL outlet_group has publication_id for filtering.
        MySQL outlet_group_member links outlet_group_id -> outlet_id.
        Only rows with active=1 are migrated.
        """
        logger.info("Migrating outlet_group + outlet_group_members...")

        with mysql_conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT outlet_class_id, name, description
                FROM outlet_class
                WHERE publication_id = %s AND active = 1
                ORDER BY outlet_class_id
                """,
                (self.publication_id,),
            )
            groups = cursor.fetchall()

        for group in groups:
            legacy_group_id = group["outlet_class_id"]
            group_uuid = self.generate_uuid()
            self.outlet_group_mapping[legacy_group_id] = group_uuid

            await pg_conn.execute(
                """
                INSERT INTO outlet_group (
                    id, customer_id, name, description, active, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                """,
                group_uuid,
                self.customer_uuid,
                group["name"],
                group["description"] or None,
                True,
                datetime.now(),
                datetime.now(),
            )
            self.stats["outlet_groups"] += 1

        logger.info(f"✓ Migrated {self.stats['outlet_groups']} outlet groups")

        # Migrate members for all migrated groups
        if not self.outlet_group_mapping:
            logger.info("No outlet groups to migrate members for")
            return

        with mysql_conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT outlet_class_id, outlet_id
                FROM outlet_class_member
                WHERE publication_id = %s AND active = 1
                ORDER BY outlet_class_id, outlet_id
                """,
                (self.publication_id,),
            )
            members = cursor.fetchall()

        skipped = 0
        for member in members:
            legacy_group_id = member["outlet_class_id"]
            legacy_outlet_id = member["outlet_id"]

            group_uuid = self.outlet_group_mapping.get(legacy_group_id)
            outlet_uuid = self.outlet_mapping.get(legacy_outlet_id)

            if not group_uuid:
                logger.warning(f"Skipping member: unmapped group_id={legacy_group_id}")
                skipped += 1
                continue
            if not outlet_uuid:
                logger.warning(f"Skipping member: unmapped outlet_id={legacy_outlet_id}")
                skipped += 1
                continue

            await pg_conn.execute(
                """
                INSERT INTO outlet_group_members (
                    id, group_id, outlet_id, active, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6)
                """,
                self.generate_uuid(),
                group_uuid,
                outlet_uuid,
                True,
                datetime.now(),
                datetime.now(),
            )
            self.stats["outlet_group_members"] += 1

        logger.info(
            f"✓ Migrated {self.stats['outlet_group_members']} outlet group members"
            + (f" ({skipped} skipped)" if skipped else "")
        )

    async def migrate_pads(self, mysql_conn, pg_conn):
        """Migrate peak_period -> pads + pad_dates.

        Each unique peak_period_group_id becomes one pad row.
        Each individual row (date_start) becomes one pad_date row.

        Fields used:
          - peak_period_group_id  → grouping key
          - comment               → pad.name (fallback: "Group <id>" if empty)
          - allow_negative        → pad.allow_negative (taken from first row of group)
          - date_start            → pad_date.date
        All other fields are ignored (boost/boost_pct default to 0).
        """
        logger.info("Migrating peak_period -> pads + pad_dates...")

        with mysql_conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT peak_period_group_id, date_start, comment, allow_negative
                FROM peak_period
                WHERE publication_id = %s AND active = 1
                ORDER BY peak_period_group_id, date_start
                """,
                (self.publication_id,),
            )
            rows = cursor.fetchall()

        # Group rows by peak_period_group_id
        groups: dict[int, list[dict]] = {}
        for row in rows:
            gid = row["peak_period_group_id"]
            groups.setdefault(gid, []).append(row)

        for gid, group_rows in groups.items():
            first = group_rows[0]
            name = first["comment"].strip() or f"Group {gid}"
            allow_negative = bool(first["allow_negative"])

            pad_uuid = self.generate_uuid()
            await pg_conn.execute(
                """
                INSERT INTO pads (
                    id, customer_id, name, historic_days, allow_negative,
                    boost, boost_pct, active, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                """,
                pad_uuid,
                self.customer_uuid,
                name,
                0,              # historic_days default
                allow_negative,
                0.0,            # boost default
                0.0,            # boost_pct default
                True,
                datetime.now(),
                datetime.now(),
            )
            self.stats["pads"] += 1

            for row in group_rows:
                await pg_conn.execute(
                    """
                    INSERT INTO pad_dates (
                        id, pad_id, date, active, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                    """,
                    self.generate_uuid(),
                    pad_uuid,
                    row["date_start"],
                    True,
                    datetime.now(),
                    datetime.now(),
                )
                self.stats["pad_dates"] += 1

        logger.info(
            f"✓ Migrated {self.stats['pads']} pads and "
            f"{self.stats['pad_dates']} pad_dates from {len(groups)} groups"
        )

    async def migrate_financial_dates(self, mysql_conn, pg_conn):
        """Migrate tarif_outlet_date_header + tarif_outlet_date -> financial_dates + outlet_financial_dates.

        tarif_outlet_date_header:
          tarif_date_start    -> start_date
          tarif_date_end      -> end_date
          day_of_week (0-6)   -> weekday (1-7, Monday=1)
          name                -> name
          description         -> description
          method              -> method (default 0 if absent)
          copy_from_weekday   -> copy_from_weekday (nullable, 0-6 -> 1-7 if present)

        tarif_outlet_date:
          tarif_outlet_date_header_id -> financial_date_id
          outlet_id                   -> outlet_id (via outlet_mapping)
          cost_per_unit               -> cost_per_unit
          profit_per_unit             -> profit_per_unit
          (ignored: publication_id, tarif_date_start, tarif_date_end, day_of_week,
                    additional, profit_per_outlet, cost_per_outlet)
        """
        logger.info("Migrating tarif_outlet_date_header -> financial_dates...")

        with mysql_conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT *
                FROM tarif_outlet_date_header
                WHERE publication_id = %s AND active = 1
                ORDER BY tarif_outlet_date_header_id
                """,
                (self.publication_id,),
            )
            headers = cursor.fetchall()

        for header in headers:
            legacy_header_id = header["tarif_outlet_date_header_id"]
            financial_date_uuid = self.generate_uuid()
            self.financial_date_mapping[legacy_header_id] = financial_date_uuid

            # day_of_week: MySQL 0-6 -> PostgreSQL 1-7
            weekday = header["day_of_week"] + 1

            # copy_from_weekday is optional; convert if present
            raw_copy = header.get("copy_from_weekday")
            copy_from_weekday = (raw_copy + 1) if raw_copy is not None else None

            await pg_conn.execute(
                """
                INSERT INTO financial_dates (
                    id, customer_id, name, description,
                    date, method, copy_from_weekday,
                    active, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                """,
                financial_date_uuid,
                self.customer_uuid,
                self.sanitize_str(header["name"]),
                self.sanitize_str(header.get("description")) or None,
                header["tarif_date_start"],
                header.get("method") or 0,
                copy_from_weekday,
                True,
                datetime.now(),
                datetime.now(),
            )
            self.stats["financial_dates"] += 1

        logger.info(f"✓ Migrated {self.stats['financial_dates']} financial_dates")
        logger.info("Migrating tarif_outlet_date -> outlet_financial_dates...")

        if not self.financial_date_mapping:
            logger.info("No financial_dates migrated; skipping outlet_financial_dates")
            return

        header_ids = list(self.financial_date_mapping.keys())
        placeholders = ", ".join(["%s"] * len(header_ids))

        with mysql_conn.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT tarif_outlet_date_header_id, outlet_id, cost_per_unit, profit_per_unit
                FROM tarif_outlet_date
                WHERE tarif_outlet_date_header_id IN ({placeholders}) AND active = 1
                ORDER BY tarif_outlet_date_header_id, outlet_id
                """,
                header_ids,
            )
            rows = cursor.fetchall()

        skipped = 0
        for row in rows:
            financial_date_uuid = self.financial_date_mapping.get(row["tarif_outlet_date_header_id"])
            outlet_uuid = self.outlet_mapping.get(row["outlet_id"])

            if not outlet_uuid:
                logger.warning(f"Skipping outlet_financial_date: unmapped outlet_id={row['outlet_id']}")
                skipped += 1
                continue

            await pg_conn.execute(
                """
                INSERT INTO outlet_financial_dates (
                    id, financial_date_id, outlet_id, cost_per_unit, profit_per_unit,
                    active, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                self.generate_uuid(),
                financial_date_uuid,
                outlet_uuid,
                row.get("cost_per_unit"),
                row.get("profit_per_unit"),
                True,
                datetime.now(),
                datetime.now(),
            )
            self.stats["outlet_financial_dates"] += 1

        logger.info(
            f"✓ Migrated {self.stats['outlet_financial_dates']} outlet_financial_dates"
            + (f" ({skipped} skipped)" if skipped else "")
        )

    async def migrate_sales_filters(self, mysql_conn, pg_conn):
        """Migrate sales_filter -> sales_filters table.

        Legacy sales_filter.filter_date (single DATE) is mapped to both
        from_date and to_date, treating each row as a single-day exclusion.
        """
        logger.info("Migrating sales_filter -> sales_filters...")

        with mysql_conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT name, description, filter_date
                FROM sales_filter
                WHERE publication_id = %s AND active = 1
                ORDER BY filter_date
                """,
                (self.publication_id,),
            )
            rows = cursor.fetchall()

        for row in rows:
            await pg_conn.execute(
                """
                INSERT INTO sales_filters (
                    id, customer_id, name, description, from_date, to_date,
                    active, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                """,
                self.generate_uuid(),
                self.customer_uuid,
                row["name"],
                row.get("description") or None,
                row["filter_date"],
                row["filter_date"],
                True,
                datetime.now(),
                datetime.now(),
            )
            self.stats["sales_filters"] += 1

        logger.info(f"✓ Migrated {self.stats['sales_filters']} sales filters")

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
        choices=["all", "customers", "outlets", "deliveries", "financials", "financial_dates", "groups", "pads", "sales", "sales_filters"],
        help="Table to migrate: all, customers, outlets, financials, financial_dates, groups, pads, sales, or sales_filters (default: all)",
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
        "--customer-name",
        help="Override the customer name (default: use publication_name from legacy DB)",
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
        customer_name=args.customer_name,
    )

    await migrator.migrate()

    # Save mappings if requested
    if args.save_mapping:
        migrator.save_mapping(args.save_mapping)


if __name__ == "__main__":
    asyncio.run(main())
