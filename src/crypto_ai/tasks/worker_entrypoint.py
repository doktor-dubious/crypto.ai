"""Entrypoint that reads simultaneous_tasks from the DB and starts Celery.

When GPUs are available, spawns one worker process per concurrent slot,
each pinned to a specific GPU via CUDA_VISIBLE_DEVICES (round-robin).
This ensures multiple GPUs are utilised for parallel inference.
"""

import asyncio
import os
import signal
import subprocess
import sys


async def _get_concurrency() -> int:
    """Read simultaneous_tasks from the configuration table via asyncpg."""
    import asyncpg  # type: ignore

    db_url = os.environ.get("DATABASE_URL", "")
    # asyncpg needs plain postgresql:// not postgresql+asyncpg://
    db_url = db_url.replace("postgresql+asyncpg://", "postgresql://")

    try:
        conn = await asyncpg.connect(db_url)
        row = await conn.fetchrow("SELECT simultaneous_tasks FROM configuration LIMIT 1")
        await conn.close()
        if row:
            return max(1, row["simultaneous_tasks"])
    except Exception as e:
        print(f"[worker_entrypoint] Could not read config: {e}, defaulting to 1", file=sys.stderr)
    return 1


def _get_gpu_count() -> int:
    """Detect number of available NVIDIA GPUs."""
    try:
        import torch
        return torch.cuda.device_count()
    except Exception:
        return 0


def _spawn_gpu_workers(concurrency: int, gpu_count: int, worker_name: str, queues: str) -> None:
    """Spawn separate Celery workers, each pinned to a GPU via CUDA_VISIBLE_DEVICES.

    Each worker runs with solo pool and concurrency=1 so that exactly one
    inference task occupies one GPU at a time.
    """
    children: list[subprocess.Popen] = []

    def _shutdown(signum, frame):
        for child in children:
            child.send_signal(signal.SIGTERM)
        for child in children:
            child.wait()
        sys.exit(0)

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    for i in range(concurrency):
        gpu_id = i % gpu_count
        env = os.environ.copy()
        env["CUDA_VISIBLE_DEVICES"] = str(gpu_id)
        env["WORKER_GPU_INDEX"] = str(gpu_id)

        hostname = f"celery@{worker_name}-gpu{gpu_id}-{i}"

        cmd = [
            "celery",
            "-A", "crypto_ai.tasks.celery_app",
            "worker",
            "--loglevel=info",
            "--concurrency=1",
            "--pool=solo",
            f"--hostname={hostname}",
            f"--queues={queues}",
        ]

        print(f"[worker_entrypoint] Spawning worker {i}: GPU={gpu_id}, hostname={hostname}")
        children.append(subprocess.Popen(cmd, env=env))

    # Wait for all children; if any exits, shut down the rest.
    while children:
        for child in children[:]:
            ret = child.poll()
            if ret is not None:
                print(
                    f"[worker_entrypoint] Worker PID {child.pid} exited with code {ret}",
                    file=sys.stderr,
                )
                children.remove(child)
                # If a worker dies, terminate all others.
                for remaining in children:
                    remaining.send_signal(signal.SIGTERM)
                for remaining in children:
                    remaining.wait()
                sys.exit(ret or 1)
        try:
            os.waitpid(-1, 0)
        except ChildProcessError:
            break


def main() -> None:
    concurrency = asyncio.run(_get_concurrency())
    worker_name = os.environ.get("WORKER_NAME", "local")
    queues = f"celery,{worker_name}"
    gpu_count = _get_gpu_count()

    if gpu_count > 1 and concurrency > 1:
        # Multi-GPU mode: spawn one worker per slot, pinned to GPUs round-robin.
        print(
            f"[worker_entrypoint] Multi-GPU mode: {gpu_count} GPUs, "
            f"{concurrency} workers (round-robin)"
        )
        _spawn_gpu_workers(concurrency, gpu_count, worker_name, queues)
    else:
        # Single GPU or CPU: original behaviour — one Celery process.
        pool = "prefork" if concurrency > 1 else "solo"

        if gpu_count == 1:
            os.environ["CUDA_VISIBLE_DEVICES"] = "0"
            os.environ["WORKER_GPU_INDEX"] = "0"

        print(
            f"[worker_entrypoint] Starting worker: pool={pool}, "
            f"concurrency={concurrency}, name={worker_name}, "
            f"queues={queues}, gpus={gpu_count}"
        )

        celery_bin = os.path.join(os.path.dirname(sys.executable), "celery")
        celery_cmd = [
            celery_bin,
            "-A", "crypto_ai.tasks.celery_app",
            "worker",
            "--loglevel=info",
            f"--concurrency={concurrency}",
            f"--pool={pool}",
            f"--hostname=celery@{worker_name}",
            f"--queues={queues}",
        ]

        # Dev convenience: Celery workers load task modules at boot and do NOT
        # hot-reload edited source (unlike uvicorn --reload), so backend changes
        # silently run stale code until a manual restart. When WORKER_AUTORELOAD
        # is set, wrap the worker in watchmedo so it re-execs on any *.py change
        # under the mounted source tree. Off in production (plain exec, no deps).
        if os.environ.get("WORKER_AUTORELOAD", "").lower() in ("1", "true", "yes"):
            watchmedo = os.path.join(os.path.dirname(sys.executable), "watchmedo")
            print("[worker_entrypoint] Auto-reload enabled (watchmedo): "
                  "worker restarts on src changes")
            os.execvp(
                watchmedo,
                [
                    watchmedo, "auto-restart",
                    "--directory=/app/src", "--pattern=*.py", "--recursive",
                    "--signal", "SIGTERM",
                    "--",
                ] + celery_cmd,
            )
        else:
            os.execvp(celery_bin, celery_cmd)


if __name__ == "__main__":
    main()
