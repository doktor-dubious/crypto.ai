# Legacy MySQL to Gorm.ai Migration Analysis

## Table Mappings

### 1. publication → customers

| Legacy Field | Gorm.ai Field | Notes |
|-------------|---------------|-------|
| publication_id (int) | id (UUID) | Generate new UUID, keep mapping |
| publication_name | name | Direct mapping |
| description | description | Direct mapping |
| active | active | Direct mapping |
| date_created | created_at | Direct mapping |
| date_upd | updated_at | Direct mapping |
| - | type | Default to 0 |
| - | notes | Default to NULL |
| cps_name | - | Store in customer_info (future) or ignore |
| sandbox | - | Ignore or store in customer_info |

### 2. outlet → outlets + outlet_info + outlet_deliveries

#### Main outlet fields:

| Legacy Field | Gorm.ai Field | Notes |
|-------------|---------------|-------|
| outlet_id (int) | id (UUID) | Generate new UUID, keep mapping |
| publication_id | customer_id | Map to new customer UUID |
| ext_id_1 | ext_id | Direct mapping (string) |
| id | ext_id_2 | Direct mapping (int) |
| outlet_name | name | Direct mapping |
| description | description | Direct mapping |
| street_and_number | address | Direct mapping |
| zip_name | zip | Direct mapping |
| city_name | city | Direct mapping |
| us_state_name | state | Direct mapping |
| country_id (int) | country | **NEEDS MAPPING** - convert int to country code |
| start_date | start_date | Direct mapping |
| end_date | end_date | Handle '1900-01-01' as NULL |
| active | active | Direct mapping |
| scan_account | scan | Direct mapping (boolean) |
| sublets | sublets | **MISSING** - Need to add to gorm.ai schema |
| peak_period | - | Store in outlet_info |
| date_created | created_at | Direct mapping |
| date_upd | updated_at | Direct mapping |
| - | season | Default to false |

#### outlet_info (key-value store):

Store these legacy fields as key-value pairs:
- phone_number
- longitude, latitude
- publication, carrier, branch, product, truck
- sc_type, tariff_model
- outlet_type, outlet_type_2
- zone_id, zone_id_text
- rate_class_id, pay_type, chain_id
- area, dc
- auto_generated, delayed_return, allow_draw_changes
- drop_location, sub_truck
- custom_1, custom_2, custom_3, custom_4, custom_5
- notes (separate from main description)
- instructions
- use_scan_sales, scan_prediction

#### outlet_deliveries:

Convert draw_* booleans to 7 records:
- draw_monday → weekday=0, quantity=1 (if true)
- draw_tuesday → weekday=1, quantity=1
- draw_wednesday → weekday=2, quantity=1
- draw_thursday → weekday=3, quantity=1
- draw_friday → weekday=4, quantity=1
- draw_saturday → weekday=5, quantity=1
- draw_sunday → weekday=6, quantity=1

### 3. sales_data → sales

| Legacy Field | Gorm.ai Field | Notes |
|-------------|---------------|-------|
| sales_data_id (int) | id (UUID) | Generate new UUID |
| publication_id | customer_id | Map to new customer UUID |
| outlet_id | outlet_id | Map to new outlet UUID |
| publication_date | date | Direct mapping |
| sold | sold | Direct mapping |
| delivered | delivered | Direct mapping |
| scan_sold | scan_sold | Direct mapping |
| net_sold | net_sold | Direct mapping |
| active | active | Direct mapping |
| date_created | created_at | Direct mapping |
| date_upd | updated_at | Direct mapping |
| returned | - | Ignore (can calculate: delivered - sold) |
| day_of_week | - | Ignore (can calculate from date) |
| day_of_year | - | Ignore (can calculate from date) |
| year | - | Ignore (can calculate from date) |
| rad | - | Ignore (analytics field) |
| sales_normalization | - | Ignore (analytics field) |
| washed | - | Ignore (data quality flag) |

## Missing Fields in Gorm.ai Schema

### CRITICAL:
1. **outlets.sublets** (mediumint) - Need to add this field

### Optional/Nice to have:
None - outlet_info can handle all extra fields

## Country Code Mapping

Need to map country_id (int) to country (string):
- Will need to check what values exist in the legacy DB
- Common mappings might be: 1=USA, 208=DK (Denmark), etc.

## Migration Script Requirements

1. **Parameters:**
   - `--publication-id` (required): The publication_id to migrate
   - `--mysql-*`: MySQL connection details (can use defaults from env)
   - `--postgres-*`: PostgreSQL connection details (from DATABASE_URL)
   - `--dry-run`: Preview what would be migrated
   - `--country-mapping`: JSON file for country_id → country_code mapping

2. **Process:**
   - Connect to both databases
   - Create ID mapping tables (legacy_id → new_uuid)
   - Migrate in order: publication → outlet → sales_data
   - Use transactions for safety
   - Generate detailed log

3. **Output:**
   - Statistics (rows migrated)
   - ID mapping file (for reference)
   - Error log (if any)
