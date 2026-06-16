#!/usr/bin/env bash
# -----------------------------------------------------------------------
# Deploy Crypt AI to https://gorm.predictioninstitute.com
#
# Builds the production frontend image, runs database migrations,
# and (re)starts all services.
#
# Usage:
#   bash scripts/deploy.sh          # full deploy
#   bash scripts/deploy.sh --skip-build   # restart without rebuilding
# -----------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

PROD_URL="https://gorm.predictioninstitute.com"
SKIP_BUILD=false

for arg in "$@"; do
    case "$arg" in
        --skip-build) SKIP_BUILD=true ;;
        *) echo "Unknown option: $arg"; exit 1 ;;
    esac
done

echo "==> Deploying Crypt AI to ${PROD_URL}"

# 1. Pull latest code
echo "==> Pulling latest changes..."
git pull --ff-only

# 2. Build backend image
if [ "$SKIP_BUILD" = false ]; then
    echo "==> Building backend image..."
    docker compose build app celery-worker

    echo "==> Building production frontend image..."
    docker build --network=host -f frontend/Dockerfile --target runner \
        --build-arg NEXT_PUBLIC_APP_URL="${PROD_URL}" \
        --build-arg BETTER_AUTH_URL="${PROD_URL}" \
        --build-arg BACKEND_INTERNAL_URL=http://app:8000 \
        -t cryptoai-frontend-prod frontend/
fi

# 3. Run database migrations
echo "==> Running database migrations..."
docker compose up -d db
docker compose exec -T db sh -c 'until pg_isready -U gorm -d crypto_ai; do sleep 1; done'
docker compose run --rm -T app alembic upgrade head

# 4. Start/restart all services
echo "==> Starting services..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d \
    db redis app celery-worker frontend-prod

# 5. Health check
echo "==> Waiting for services to be healthy..."
sleep 5
if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    echo "    Backend: OK"
else
    echo "    Backend: NOT RESPONDING (check logs with: docker compose logs app)"
fi

if curl -sf http://localhost:3010 > /dev/null 2>&1; then
    echo "    Frontend: OK"
else
    echo "    Frontend: NOT RESPONDING (check logs with: docker compose -f docker-compose.yml -f docker-compose.prod.yml logs frontend-prod)"
fi

echo ""
echo "==> Deploy complete!"
echo "    Site: ${PROD_URL}"
echo "    Logs: docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f"
echo ""
