#!/bin/bash
set -euo pipefail

# Self-healing autossh tunnel to the main gorm host (forwards 5432 + 6379)
source "$(dirname "$0")/_tunnel.sh"

export DATABASE_URL=postgresql+asyncpg://gorm:gorm@localhost:5432/crypto_ai
export CELERY_BROKER_URL=redis://localhost:6379/1
export CELERY_RESULT_BACKEND=redis://localhost:6379/2
export REDIS_URL=redis://localhost:6379/0
export WORKER_NAME="Vast YingLong"
export WORKER_MODELS=yinglong
export SYNC_TARGET=rune@gorm.predictioninstitute.com:/home/rune/workspace/projects/crypto.ai/models/finetune/yinglong/
export SYNC_EVERY=10
export HF_HUB_CACHE=/workspace/models/huggingface
export FINETUNED_MODEL_PATH=/models/finetune/yinglong

cd /workspace/crypto.ai
git pull
export PATH="$HOME/.local/bin:$PATH"; command -v uv &>/dev/null || { echo "Installing uv..."; curl -LsSf https://astral.sh/uv/install.sh | sh; }
uv sync --extra ml --extra timesfm --extra yinglong

# Upgrade torch to match system CUDA — detect version and pick the right wheel
SYSTEM_CUDA=$(nvcc --version 2>/dev/null | grep -oP 'release \K[0-9]+\.[0-9]+' | tr -d '.')
SYSTEM_CUDA=${SYSTEM_CUDA:-128}  # fallback to cu128
echo "Detected system CUDA: ${SYSTEM_CUDA}"
if ! .venv/bin/python -c "import torch; assert torch.version.cuda.replace('.','') == '${SYSTEM_CUDA}'" 2>/dev/null; then
    echo "Installing torch nightly with cu${SYSTEM_CUDA}..."
    uv pip install --python .venv/bin/python --reinstall-package torch torch nvidia-cusparselt-cu12 --index-url "https://download.pytorch.org/whl/nightly/cu${SYSTEM_CUDA}"
fi
.venv/bin/python -c "import torch; print(f'PyTorch {torch.__version__}, archs: {torch.cuda.get_arch_list()}')"

# YingLong runtime dependencies (flash-attn compiles CUDA kernels from source)
# flash-attn 2.8.x ignores TORCH_CUDA_ARCH_LIST and builds all 4 archs (sm_80,
# 90, 100, 120) per file, so each cc1plus/nvcc job needs ~3-4 GB RAM.  Cap
# MAX_JOBS by available RAM (≈4 GB per job) to prevent OOM-kill.
GPU_ARCH=$(.venv/bin/python -c "import torch; cc = torch.cuda.get_device_capability(); print(f'{cc[0]}.{cc[1]}')" 2>/dev/null || echo "8.0")
export TORCH_CUDA_ARCH_LIST="${GPU_ARCH}"
RAM_GB=$(awk '/MemTotal/ {print int($2/1024/1024)}' /proc/meminfo)
RAM_JOBS=$(( RAM_GB / 4 ))
CPU_JOBS=$(nproc)
MAX_JOBS=$(( RAM_JOBS < CPU_JOBS ? RAM_JOBS : CPU_JOBS ))
[ "$MAX_JOBS" -lt 1 ] && MAX_JOBS=1
export MAX_JOBS
echo "Building flash-attn: arch ${GPU_ARCH}, ${MAX_JOBS} jobs (RAM ${RAM_GB}GB, CPU ${CPU_JOBS})..."
uv pip install --python .venv/bin/python flash-attn --no-build-isolation
uv pip install --python .venv/bin/python xformers lightning-utilities

PYTHONPATH=src .venv/bin/python -m crypto_ai.tasks.worker_entrypoint