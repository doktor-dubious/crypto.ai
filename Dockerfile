# syntax=docker/dockerfile:1

# Build stage
FROM python:3.11-slim as builder

WORKDIR /app

# Install git (required for timesfm installed from git)
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Copy dependency files
COPY pyproject.toml uv.lock* ./

# Install dependencies including ML extras.
# EXTRAS can be overridden at build time to swap conflicting engine groups
# (e.g. "ml kairos chronos" vs "ml flowstate chronos").
ARG EXTRAS="ml flowstate chronos"
RUN set -ex; args=""; for e in $EXTRAS; do args="$args --extra $e"; done; \
    uv sync --frozen --no-dev --no-install-project $args

# Production stage
FROM python:3.11-slim as production

WORKDIR /app

# Create non-root user
RUN useradd --create-home --shell /bin/bash appuser

# Copy virtual environment from builder
COPY --from=builder /app/.venv /app/.venv

# Copy application code
COPY src/ ./src/
COPY alembic.ini ./
COPY alembic/ ./alembic/

# Set environment variables
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app/src"
ENV PYTHONUNBUFFERED=1

# Change ownership to non-root user
RUN chown -R appuser:appuser /app

USER appuser

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Default command
CMD ["uvicorn", "gorm_ai.main:app", "--host", "0.0.0.0", "--port", "8000"]
