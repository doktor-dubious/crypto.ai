#!/bin/bash
set -euo pipefail

# Self-healing autossh tunnel to the main gorm host (forwards 5432 + 6379)
source "$(dirname "$0")/_tunnel.sh"

export DATABASE_URL=postgresql+asyncpg://gorm:gorm@localhost:5432/gorm_ai
export CELERY_BROKER_URL=redis://localhost:6379/1
export CELERY_RESULT_BACKEND=redis://localhost:6379/2
export REDIS_URL=redis://localhost:6379/0
export WORKER_NAME="Vast Group TimesFM"
export WORKER_MODELS=timesfm,chronos2,chronos-bolt,tirex
export SYNC_TARGET=rune@gorm.predictioninstitute.com:/home/rune/workspace/projects/gorm.ai/models/finetune/chronos/
export SYNC_EVERY=10
export HF_HUB_CACHE=/workspace/models/huggingface
export FINETUNED_MODEL_PATH=/models/finetune/chronos

cd /workspace/gormai
git pull
export PATH="$HOME/.local/bin:$PATH"; command -v uv &>/dev/null || { echo "Installing uv..."; curl -LsSf https://astral.sh/uv/install.sh | sh; }
uv sync --extra ml --extra timesfm --extra chronos --extra tirex

# Set LD_LIBRARY_PATH for nvidia libs installed by uv sync
CUSPARSELT_LIB=$(find .venv -name "libcusparseLt.so*" -print -quit 2>/dev/null)
if [ -n "$CUSPARSELT_LIB" ]; then
    export LD_LIBRARY_PATH="$(dirname "$CUSPARSELT_LIB"):${LD_LIBRARY_PATH:-}"
    echo "cusparselt: $CUSPARSELT_LIB"
else
    echo "WARNING: libcusparseLt.so not found in .venv"
fi

# Upgrade torch to CUDA 12.8 wheel for Blackwell (sm_120) GPU support (only if needed)
if ! .venv/bin/python -c "import torch; assert 'sm_120' in str(torch.cuda.get_arch_list())" 2>/dev/null; then
    echo "Installing torch nightly with cu128 for Blackwell support..."
    uv pip install --python .venv/bin/python --reinstall-package torch torch nvidia-cusparselt-cu12 --index-url https://download.pytorch.org/whl/nightly/cu128
fi
.venv/bin/python -c "import torch; print(f'PyTorch {torch.__version__}, archs: {torch.cuda.get_arch_list()}')"


PYTHONPATH=src .venv/bin/python -m gorm_ai.tasks.worker_entrypoint