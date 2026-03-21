#!/usr/bin/env bash
# -----------------------------------------------------------------------
# RunPod GPU Offload — Deployment Script
#
# Connects to your production server via SSH tunnel and starts the
# Celery worker for GPU-accelerated predictions/simulations.
#
# Prerequisites:
#   1. SSH key access to your production server
#   2. Docker + Docker Compose installed on RunPod (pre-installed on GPU pods)
#   3. NVIDIA Container Toolkit (pre-installed on RunPod GPU pods)
#   4. Persistent volume mounted at /workspace
#
# Usage:
#   # First time: clone the repo to persistent storage
#   cd /workspace && git clone <your-repo-url> gorm.ai && cd gorm.ai
#
#   # Set your production server details
#   export PROD_HOST=your-server.example.com
#   export PROD_USER=your-ssh-user
#
#   # Deploy
#   bash scripts/runpod-deploy.sh
#
# To fine-tune:
#   docker compose -f docker-compose.runpod.yml run --rm finetune \
#       --customer-ids <id> --start-date 2020-01-01
#
# To stop:
#   docker compose -f docker-compose.runpod.yml down
#   kill $(cat /tmp/ssh-tunnel.pid 2>/dev/null) 2>/dev/null
# -----------------------------------------------------------------------
set -euo pipefail

PROD_HOST="${PROD_HOST:?Set PROD_HOST to your production server address}"
PROD_USER="${PROD_USER:-root}"
PROD_SSH_PORT="${PROD_SSH_PORT:-22}"
PROD_DB_PORT="${PROD_DB_PORT:-5433}"
PROD_REDIS_PORT="${PROD_REDIS_PORT:-6380}"

echo "==> Setting up SSH tunnel to ${PROD_USER}@${PROD_HOST}"

# Kill any existing tunnel
if [ -f /tmp/ssh-tunnel.pid ]; then
    kill "$(cat /tmp/ssh-tunnel.pid)" 2>/dev/null || true
    rm -f /tmp/ssh-tunnel.pid
fi

# Start SSH tunnel in background:
#   localhost:5432 → production DB (prod port 5433)
#   localhost:6379 → production Redis (prod port 6380)
ssh -f -N \
    -L 5432:localhost:${PROD_DB_PORT} \
    -L 6379:localhost:${PROD_REDIS_PORT} \
    -p "${PROD_SSH_PORT}" \
    -o StrictHostKeyChecking=accept-new \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    "${PROD_USER}@${PROD_HOST}"

# Save PID for cleanup
pgrep -f "ssh.*-L 5432.*${PROD_HOST}" > /tmp/ssh-tunnel.pid
echo "    Tunnel PID: $(cat /tmp/ssh-tunnel.pid)"

# Wait for tunnel to be ready
echo "==> Waiting for tunnel..."
for i in $(seq 1 10); do
    if python3 -c "import socket; s=socket.socket(); s.settimeout(2); s.connect(('localhost',5432)); s.close()" 2>/dev/null; then
        echo "    DB tunnel ready"
        break
    fi
    [ "$i" -eq 10 ] && { echo "ERROR: DB tunnel failed"; exit 1; }
    sleep 1
done

# Ensure models directory exists on persistent storage
mkdir -p /workspace/models

# Build and start
echo "==> Building and starting Celery worker..."
docker compose -f docker-compose.runpod.yml build
docker compose -f docker-compose.runpod.yml up -d celery-worker

echo ""
echo "==> Done! Celery worker is running."
echo ""
echo "    View logs:     docker compose -f docker-compose.runpod.yml logs -f"
echo "    Fine-tune:     docker compose -f docker-compose.runpod.yml run --rm finetune --customer-ids <id>"
echo "    Stop:          docker compose -f docker-compose.runpod.yml down"
echo ""
