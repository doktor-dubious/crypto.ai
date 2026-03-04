# Legacy MySQL to Gorm.ai Migration

This directory contains tools and documentation for migrating data from the legacy MySQL database to the new Gorm.ai PostgreSQL system.

## Files

- **`publication_schema.sql`** - Schema dump from legacy MySQL database
- **`MIGRATION_ANALYSIS.md`** - Detailed analysis of field mappings
- **`country_mapping.json`** - Country ID to country code mapping template
- **`../scripts/migrate_from_legacy.py`** - Main migration script

## Prerequisites

1. Install required Python packages:
```bash
pip install pymysql asyncpg
# or with uv:
uv add pymysql asyncpg
```

2. Ensure PostgreSQL database is set up and migrations are applied:
```bash
alembic upgrade head
```

3. Update `country_mapping.json` with correct country codes for your data

## Quick Start

### 1. Dry Run (Preview)

Preview what will be migrated without making changes:

```bash
python scripts/migrate_from_legacy.py \
  --publication-id 220 \
  --dry-run
```

### 2. Full Migration

Migrate publication_id 220 to the new database:

```bash
python scripts/migrate_from_legacy.py \
  --publication-id 220 \
  --country-mapping legacy/country_mapping.json \
  --save-mapping legacy/mapping_220.json
```

### 3. Using Environment Variables

Set up your `.env` file with:
```bash
DATABASE_URL=postgresql://user:password@localhost/gorm_ai
```

Then run:
```bash
source .env  # or use python-dotenv
python scripts/migrate_from_legacy.py --publication-id 220
```

## Command-Line Options

```
--publication-id    (required) Legacy publication_id to migrate
--mysql-host        MySQL hostname (default: localhost)
--mysql-port        MySQL port (default: 3306)
--mysql-user        MySQL username (default: trillian)
--mysql-password    MySQL password (default: zaphood_xjdhd73hGH)
--mysql-database    MySQL database name (default: publication)
--postgres-url      PostgreSQL URL (default: from DATABASE_URL env var)
--country-mapping   Path to country mapping JSON file
--dry-run           Preview without making changes
--save-mapping      Save ID mappings to JSON file
```

## What Gets Migrated

### 1. Publication → Customer
- Maps publication record to a new customer
- Generates new UUID for customer
- Preserves: name, description, active status, timestamps

### 2. Outlet → Outlet + Outlet Info + Outlet Deliveries

**Main outlet data:**
- Maps to outlets table with new UUID
- Preserves all core fields (name, address, dates, etc.)
- Links to migrated customer

**Extended data (outlet_info):**
All extra fields stored as key-value pairs:
- Contact info (phone_number)
- Location data (longitude, latitude)
- Business fields (carrier, branch, product, truck, etc.)
- Custom fields (custom_1 through custom_5)
- Configuration flags

**Delivery schedule (outlet_deliveries):**
- Converts draw_monday through draw_sunday to 7 records
- Maps to weekday numbers (0=Monday, 6=Sunday)

### 3. Sales Data → Sales
- Maps all sales records
- Links to migrated customer and outlet UUIDs
- Preserves: sold, delivered, scan_sold, net_sold
- Filters for active records only

## Migration Process

The script follows this order:

1. **Connect** to both MySQL and PostgreSQL databases
2. **Migrate Publication** - Create customer record, store UUID
3. **Migrate Outlets** - For each outlet:
   - Create outlet record
   - Create outlet_info records for extra fields
   - Create 7 outlet_delivery records for draw days
4. **Migrate Sales** - Batch insert sales records (1000 at a time)
5. **Save Mappings** - Optional JSON file with legacy_id → UUID mappings

All operations run in a PostgreSQL transaction - if anything fails, everything rolls back.

## Output

The script generates:

1. **Log file** - `migration_YYYYMMDD_HHMMSS.log` with detailed progress
2. **Console output** - Real-time progress updates
3. **Statistics** - Final count of migrated records
4. **Mapping file** - Optional JSON with ID mappings for reference

### Example Log Output:
```
2026-03-03 10:15:30 - INFO - Starting migration for publication_id=220
2026-03-03 10:15:30 - INFO - Dry run mode: False
2026-03-03 10:15:31 - INFO - ✓ Migrated publication: My Publication -> abc123...
2026-03-03 10:15:32 - INFO - Found 45 active outlets to migrate
2026-03-03 10:15:35 - INFO - ✓ Migrated 45 outlets
2026-03-03 10:15:35 - INFO -   Migrated 1000 sales records...
2026-03-03 10:15:40 - INFO - ✓ Migrated 12547 sales records

============================================================
Migration Statistics:
============================================================
  customers                    1 records
  outlets                     45 records
  outlet_info                892 records
  outlet_deliveries          315 records
  sales                    12547 records
============================================================
```

## Troubleshooting

### Country Code Mapping

If you see country IDs in the migrated data instead of codes:

1. Query your legacy database to see what country_id values exist:
```sql
SELECT DISTINCT country_id FROM outlet WHERE publication_id = 220;
```

2. Update `country_mapping.json` with the correct mappings:
```json
{
  "1": "US",
  "208": "DK",
  "46": "SE"
}
```

### Unmapped Outlets

If you see warnings about unmapped outlets in sales data, it means:
- The outlet was inactive and not migrated
- The outlet belongs to a different publication

Check the logs for: `"Skipping sales record for unmapped outlet_id=..."`

### Date Issues

Legacy dates of '1900-01-01' are converted to NULL in the new database.

## Validation

After migration, verify the data:

```sql
-- Check customer was created
SELECT * FROM customers WHERE name = 'Your Publication Name';

-- Check outlets were migrated
SELECT COUNT(*) FROM outlets WHERE customer_id = 'your-customer-uuid';

-- Check sales data
SELECT COUNT(*) FROM sales WHERE customer_id = 'your-customer-uuid';

-- Check outlet info was populated
SELECT COUNT(*) FROM outlet_info WHERE outlet_id IN (
  SELECT id FROM outlets WHERE customer_id = 'your-customer-uuid'
);
```

## Next Steps

After successful migration:

1. **Test the API** - Use the FastAPI docs at `http://localhost:8000/docs`
2. **Verify data** - Check samples of migrated data for accuracy
3. **Run predictions** - Test the prediction system with migrated data
4. **Archive mappings** - Keep the ID mapping files for reference

## Support

For issues or questions about the migration process, see:
- `MIGRATION_ANALYSIS.md` for detailed field mappings
- Migration logs for error details
- The migration script source code for implementation details
