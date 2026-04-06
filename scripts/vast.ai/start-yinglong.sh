#!/bin/bash
set -euo pipefail

# Kill any existing tunnel
pkill -f "ssh.*-L 5432.*gorm.predictioninstitute" 2>/dev/null || true
sleep 1

ssh rune@gorm.predictioninstitute.com \
      "cd ~/workspace/projects/gorm.ai && docker compose up -d redis"

ssh -f -N \
       -L 5432:localhost:5433 \
       -L 6379:localhost:6379 \
       -o StrictHostKeyChecking=accept-new \
       -o ServerAliveInterval=30 \
       -o ServerAliveCountMax=3 \
       -o ExitOnForwardFailure=yes \
       rune@gorm.predictioninstitute.com

# Wait for tunnel to be ready
echo "Waiting for tunnel..."
for i in $(seq 1 10); do
      if python3 -c "import socket; s=socket.socket(); s.settimeout(2); s.connect(('localhost',6379)); s.close()" 2>/dev/null; then
          echo "Tunnel ready"
          break
      fi
      [ "$i" -eq 10 ] && { echo "ERROR: Tunnel failed"; exit 1; }
      sleep 1
done

export DATABASE_URL=postgresql+asyncpg://gorm:gorm@localhost:5432/gorm_ai
export CELERY_BROKER_URL=redis://localhost:6379/1
export CELERY_RESULT_BACKEND=redis://localhost:6379/2
export REDIS_URL=redis://localhost:6379/0
export WORKER_NAME="Vast YingLong"
export WORKER_MODELS=yinglong
export SYNC_TARGET=rune@gorm.predictioninstitute.com:/home/rune/workspace/projects/gorm.ai/models/finetune/yinglong/
export SYNC_EVERY=10
export HF_HUB_CACHE=/workspace/models/huggingface
export FINETUNED_MODEL_PATH=/models/finetune/yinglong

cd /workspace/gormai
git pull
export PATH="$HOME/.local/bin:$PATH"; command -v uv &>/dev/null || { echo "Installing uv..."; curl -LsSf https://astral.sh/uv/install.sh | sh; }
uv sync --extra ml --extra timesfm --extra yinglong

# Upgrade torch to match system CUDA — detect version and pick the right wheel
SYSTEM_CUDA=$(nvcc --version 2>/dev/null | grep -oP 'release \K[0-9]+\.[0-9]+' | tr -d '.')
SYSTEM_CUDA=${SYSTEM_CUDA:-128}  # fallback to cu128
echo "Detected system CUDA: ${SYSTEM_CUDA}"
if ! .venv/bin/python -c "import torch; assert torch.version.cuda.replace('.','') == '${SYSTEM_CUDA}'" 2>/dev/null; then
    echo "Installing torch nightly with cu${SYSTEM_CUDA}..."
    uv pip install --python .venv/bin/python --reinstall-package torch torch --index-url "https://download.pytorch.org/whl/nightly/cu${SYSTEM_CUDA}"
fi
.venv/bin/python -c "import torch; print(f'PyTorch {torch.__version__}, archs: {torch.cuda.get_arch_list()}')"

# YingLong runtime dependencies (flash-attn compiles CUDA kernels from source, ~10-30 min)
uv pip install flash-attn --no-build-isolation
uv pip install xformers lightning-utilities

PYTHONPATH=src .venv/bin/python -m gorm_ai.tasks.worker_entrypoint