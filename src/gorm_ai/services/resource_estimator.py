"""Resource estimation and capacity checking for prediction tasks."""

import logging
import os
from dataclasses import dataclass

from gorm_ai.prediction.engine import MemoryEstimate
from gorm_ai.prediction.registry import EngineRegistry
from gorm_ai.schemas.prediction import PredictionEngine as PredictionEngineEnum

logger = logging.getLogger(__name__)


@dataclass
class SystemCapacity:
    """Current system resource availability."""

    ram_total_mb: float
    ram_available_mb: float
    gpu_vram_total_mb: float | None = None
    gpu_vram_available_mb: float | None = None
    gpu_name: str | None = None
    gpu_index: int | None = None
    gpu_count: int = 0


@dataclass
class CapacityCheck:
    """Result of a capacity check."""

    can_run: bool
    estimate: MemoryEstimate
    capacity: SystemCapacity
    warnings: list[str]
    recommendation: str | None = None


def get_system_capacity() -> SystemCapacity:
    """Query current system RAM and GPU VRAM availability.

    When CUDA_VISIBLE_DEVICES is set (multi-GPU worker pinning), reports
    the VRAM of the assigned GPU.  Device index 0 in the process always
    maps to the physical GPU selected by CUDA_VISIBLE_DEVICES.
    """
    import psutil

    mem = psutil.virtual_memory()
    ram_total = mem.total / (1024 * 1024)
    ram_available = mem.available / (1024 * 1024)

    gpu_total = None
    gpu_available = None
    gpu_name = None
    gpu_index = None
    gpu_count = 0

    # Read the physical GPU index assigned to this worker (set by worker_entrypoint).
    gpu_index_env = os.environ.get("WORKER_GPU_INDEX")
    if gpu_index_env is not None:
        try:
            gpu_index = int(gpu_index_env)
        except ValueError:
            pass

    # pynvml sees *all* physical GPUs regardless of CUDA_VISIBLE_DEVICES,
    # so we query the assigned physical GPU directly when gpu_index is set.
    try:
        import pynvml
        pynvml.nvmlInit()
        gpu_count = pynvml.nvmlDeviceGetCount()
        query_idx = gpu_index if gpu_index is not None else 0
        if query_idx < gpu_count:
            handle = pynvml.nvmlDeviceGetHandleByIndex(query_idx)
            info = pynvml.nvmlDeviceGetMemoryInfo(handle)
            gpu_total = info.total / (1024 * 1024)
            gpu_available = info.free / (1024 * 1024)
            gpu_name = pynvml.nvmlDeviceGetName(handle)
            if isinstance(gpu_name, bytes):
                gpu_name = gpu_name.decode()
        pynvml.nvmlShutdown()
    except Exception as exc:
        logger.debug("pynvml GPU detection failed: %s", exc)

    if gpu_total is None:
        try:
            import torch
            if torch.cuda.is_available():
                # With CUDA_VISIBLE_DEVICES set, device 0 = the pinned GPU.
                gpu_total = torch.cuda.get_device_properties(0).total_mem / (1024 * 1024)
                gpu_available = (gpu_total - torch.cuda.memory_allocated(0) / (1024 * 1024))
                gpu_name = torch.cuda.get_device_name(0)
                gpu_count = max(gpu_count, torch.cuda.device_count())
            else:
                logger.debug("torch.cuda.is_available() returned False")
        except Exception as exc:
            logger.debug("torch GPU detection failed: %s", exc)

    # Last-resort fallback: parse nvidia-smi output.
    if gpu_total is None:
        try:
            import subprocess
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=name,memory.total,count",
                 "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0 and result.stdout.strip():
                lines = result.stdout.strip().splitlines()
                idx = gpu_index if gpu_index is not None else 0
                line = lines[min(idx, len(lines) - 1)]
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 2:
                    gpu_name = parts[0]
                    gpu_total = float(parts[1])
                    gpu_count = len(lines)
                    logger.info("GPU detected via nvidia-smi: %s", gpu_name)
        except Exception as exc:
            logger.debug("nvidia-smi GPU detection failed: %s", exc)

    return SystemCapacity(
        ram_total_mb=round(ram_total, 1),
        ram_available_mb=round(ram_available, 1),
        gpu_vram_total_mb=round(gpu_total, 1) if gpu_total else None,
        gpu_vram_available_mb=round(gpu_available, 1) if gpu_available else None,
        gpu_name=gpu_name,
        gpu_index=gpu_index,
        gpu_count=gpu_count,
    )


def check_capacity(
    estimate: MemoryEstimate,
    capacity: SystemCapacity | None = None,
) -> CapacityCheck:
    """Check whether the current system can handle the estimated workload."""
    if capacity is None:
        capacity = get_system_capacity()

    warnings: list[str] = []
    can_run = True
    recommendation = None

    # Check GPU requirement
    if estimate.gpu_required and capacity.gpu_vram_total_mb is None:
        warnings.append("This engine requires a GPU but no GPU was detected")
        can_run = False
        recommendation = "Use a GPU-equipped worker or switch to a CPU-compatible engine"

    # Check GPU VRAM if GPU is available and model uses it
    if estimate.gpu_required and capacity.gpu_vram_available_mb is not None:
        if estimate.total_mb > capacity.gpu_vram_available_mb:
            warnings.append(
                f"Estimated {estimate.total_mb:.0f} MB exceeds available GPU VRAM "
                f"({capacity.gpu_vram_available_mb:.0f} MB)"
            )
            can_run = False
            recommendation = (
                "Reduce batch_size, use bfloat16 precision, "
                "or use a smaller model variant"
            )

    # Check system RAM (even GPU tasks need RAM for data preprocessing)
    ram_needed = estimate.total_mb if not estimate.gpu_required else estimate.inference_mb * 0.3
    if ram_needed > capacity.ram_available_mb * 0.8:  # leave 20% headroom
        warnings.append(
            f"Estimated RAM usage ({ram_needed:.0f} MB) is close to or exceeds "
            f"available RAM ({capacity.ram_available_mb:.0f} MB)"
        )
        if ram_needed > capacity.ram_available_mb:
            can_run = False
            recommendation = "Reduce batch_size or number of outlets"

    # Warn on large tasks
    if estimate.task_type == "finetune" and estimate.total_mb > 8000:
        warnings.append("Fine-tuning tasks are memory-intensive; monitor for OOM")

    if not warnings:
        headroom = capacity.ram_available_mb - estimate.total_mb
        if estimate.gpu_required and capacity.gpu_vram_available_mb:
            headroom = capacity.gpu_vram_available_mb - estimate.total_mb
        if headroom > 0:
            recommendation = f"Sufficient resources available ({headroom:.0f} MB headroom)"

    return CapacityCheck(
        can_run=can_run,
        estimate=estimate,
        capacity=capacity,
        warnings=warnings,
        recommendation=recommendation,
    )


def estimate_task(
    *,
    engine_slug: str,
    task_type: str = "prediction",
    num_outlets: int = 1,
    batch_size: int = 32,
    horizon: int = 30,
    context_length: int = 512,
    num_covariates: int = 0,
    precision: str = "bfloat16",
    epochs: int = 0,
) -> MemoryEstimate:
    """Get memory estimate for a task using the specified engine."""
    registry = EngineRegistry()
    try:
        engine_enum = PredictionEngineEnum(engine_slug)
    except ValueError:
        # Unknown engine — return base class estimate
        from gorm_ai.prediction.engine import PredictionEngine as BaseEngine

        class _Dummy(BaseEngine):
            async def predict(self, *a, **kw): ...
            def get_capabilities(self): ...

        return _Dummy().estimate_memory(
            task_type=task_type, num_outlets=num_outlets, batch_size=batch_size,
            horizon=horizon, context_length=context_length,
            num_covariates=num_covariates, precision=precision, epochs=epochs,
        )

    engine = registry.get_engine(engine_enum)
    return engine.estimate_memory(
        task_type=task_type, num_outlets=num_outlets, batch_size=batch_size,
        horizon=horizon, context_length=context_length,
        num_covariates=num_covariates, precision=precision, epochs=epochs,
    )
