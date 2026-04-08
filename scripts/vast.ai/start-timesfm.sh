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
export WORKER_NAME="Vast TimesFM"
export WORKER_MODELS=timesfm
export SYNC_TARGET=rune@gorm.predictioninstitute.com:/home/rune/workspace/projects/gorm.ai/models/finetune/timesfm/
export SYNC_EVERY=10
export HF_HUB_CACHE=/workspace/models/huggingface
export FINETUNED_MODEL_PATH=/models/finetune/timesfm

cd /workspace/gormai
git pull
export PATH="$HOME/.local/bin:$PATH"; command -v uv &>/dev/null || { echo "Installing uv..."; curl -LsSf https://astral.sh/uv/install.sh | sh; }
uv sync --extra ml --extra timesfm --extra yinglong

# Probe for Blackwell support; if missing, install cu128 nightly torch + cusparselt.
# We can't `import torch` here without LD_LIBRARY_PATH, so check via pip metadata first.
NEED_BLACKWELL_TORCH=1
if .venv/bin/python -c "import torch" 2>/dev/null && \
   .venv/bin/python -c "import torch; import sys; sys.exit(0 if 'sm_120' in str(torch.cuda.get_arch_list()) else 1)" 2>/dev/null; then
    NEED_BLACKWELL_TORCH=0
fi
if [ "$NEED_BLACKWELL_TORCH" = "1" ]; then
    echo "Installing torch nightly with cu128 for Blackwell support..."
    # cusparselt comes from PyPI (not on the pytorch nightly index), so install it first
    uv pip install --python .venv/bin/python nvidia-cusparselt-cu12
    uv pip install --python .venv/bin/python --reinstall-package torch torch --index-url https://download.pytorch.org/whl/nightly/cu128
fi

# Set LD_LIBRARY_PATH for nvidia libs (must run AFTER torch/cusparselt install)
CUSPARSELT_LIB=$(find .venv -name "libcusparseLt.so*" -print -quit 2>/dev/null)
if [ -n "$CUSPARSELT_LIB" ]; then
    export LD_LIBRARY_PATH="$(dirname "$CUSPARSELT_LIB"):${LD_LIBRARY_PATH:-}"
    echo "cusparselt: $CUSPARSELT_LIB"
else
    echo "WARNING: libcusparseLt.so not found in .venv"
fi

.venv/bin/python -c "import torch; print(f'PyTorch {torch.__version__}, archs: {torch.cuda.get_arch_list()}')"

PYTHONPATH=src .venv/bin/python -m gorm_ai.tasks.worker_entrypoint