# CLAUDE.md - Project Context for Claude Code

## Project Overview
Gorm AI is a time series prediction system with pluggable prediction engines, supporting custom models and AI foundation models (e.g., Google TimesFM).

## Tech Stack
- **Python 3.11+** with **uv** for package management
- **FastAPI** for REST API
- **PostgreSQL** with **TimescaleDB** extension for time series data
- **SQLAlchemy 2.x** (async) for ORM
- **Celery + Redis** for async task processing
- **Docker + Docker Compose** for containerization

## Project Structure
```
src/gorm_ai/
├── main.py              # FastAPI app entrypoint
├── config.py            # Settings via pydantic-settings
├── database/
│   ├── connection.py    # Async engine/session factory
│   ├── base.py          # Base model (id, active, created_at, updated_at)
│   └── models/          # SQLAlchemy models
├── api/
│   ├── deps.py          # Dependency injection (services, db session)
│   └── routes/          # FastAPI routers
├── schemas/             # Pydantic request/response models
├── services/            # Business logic layer
├── prediction/
│   ├── engine.py        # Abstract PredictionEngine base class
│   ├── registry.py      # Engine registration/selection
│   ├── preprocessor.py  # Data normalization/preparation
│   └── engines/         # Concrete engine implementations
└── tasks/
    ├── celery_app.py    # Celery configuration
    └── predictions.py   # Async prediction tasks
```

## Common Commands
```bash
# Install dependencies
uv sync --extra dev

# Run linter
ruff check src/

# Run tests
pytest tests/ -v

# Start development server
uvicorn gorm_ai.main:app --reload

# Start Celery worker
celery -A gorm_ai.tasks.celery_app worker --loglevel=info

# Run database migrations
alembic upgrade head

# Create new migration
alembic revision --autogenerate -m "description"

# Start all services with Docker
docker compose up -d
```

## Code Conventions

### Database Models
- All models inherit from `Base` (defined in `database/base.py`)
- Common columns: `id` (UUID), `active` (bool), `created_at`, `updated_at`
- Use soft deletes by default (set `active=False`)
- Foreign keys use `UUID(as_uuid=False)` for string representation

### API Layer
- Routes in `api/routes/` organized by resource
- Use dependency injection via `api/deps.py`
- Service classes handle business logic, not routes
- Return Pydantic schemas, not ORM models directly

### Prediction Engines
- All engines inherit from `PredictionEngine` abstract base class
- Must implement `predict()` and `get_capabilities()`
- Register new engines in `prediction/registry.py`
- Use `DataPreprocessor` for data normalization

### Testing
- Use pytest with pytest-asyncio
- Test database uses SQLite in-memory (`aiosqlite`)
- Fixtures defined in `tests/conftest.py`

## Environment Variables
See `.env.example` for all configuration options:
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection for caching
- `CELERY_BROKER_URL` - Celery broker (Redis)
- `CELERY_RESULT_BACKEND` - Celery results backend

## API Endpoints
- `GET /health` - Health check
- `GET /api/v1/customers` - List customers
- `POST /api/v1/customers` - Create customer
- `GET /api/v1/outlets` - List outlets (filter by `customer_id`)
- `GET /api/v1/outlets/{id}/deliveries` - Get outlet delivery config
- `GET /api/v1/sales` - Query sales by date range
- `POST /api/v1/sales/bulk` - Bulk import sales
- `POST /api/v1/predictions` - Create prediction (sync)
- `POST /api/v1/predictions/async` - Create prediction (async via Celery)
- `GET /api/v1/predictions/tasks/{task_id}` - Get task status

## Database Schema Notes
- `sales` table is a TimescaleDB hypertable partitioned by `date` (monthly chunks)
  - `sold` (required) - core prediction field
  - `delivered`, `scan_sold`, `net_sold` (nullable) - additional analytics
- `outlet_info` is a key-value store for extensible outlet metadata
- `outlet_deliveries` stores weekday-based delivery quantities (0-6, Monday=0)

## Adding a New Prediction Engine
1. Create class in `prediction/engines/` inheriting from `PredictionEngine`
2. Implement `predict()` and `get_capabilities()` methods
3. Register in `prediction/registry.py` `_register_default_engines()`
4. Add enum value to `schemas/prediction.py` `PredictionEngine`
