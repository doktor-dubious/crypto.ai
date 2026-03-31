---
name: Price History Covariates
description: Historical price timeline feature — tracks cost/profit changes over time so Ridge regression uses actual prices on each date, not today's static values
type: project
---

Price history covariates feature implemented (2026-03-31).

**Why:** Without historical prices, the covariate system projected current cost/profit backward across all history. If cost changed from $0.50 to $0.65 in June 2024, Ridge saw $0.65 for the entire history — treating a step change as flat, diluting the demand-price signal.

**What was built:**
- `price_history` table: `customer_id`, `effective_date`, `cost_per_unit`, `profit_per_unit` (customer-level, unique on customer+date)
- CRUD API at `/api/v1/price-history?customer_id=...`
- Integrated into the 5-level covariate fallback chain: A (date override) → **PH (price history)** → B (weekday) → C (customer config) → D (global config)
- Uses bisect for efficient lookup of the price in effect on each historical date

**How to apply:** When a customer reports price changes, create entries in price_history with the effective date. The Ridge regression will automatically see the actual price signal for each historical period.
