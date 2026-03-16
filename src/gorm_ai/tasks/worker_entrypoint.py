"""Entrypoint that reads simultaneous_tasks from the DB and starts Celery."""

import asyncio
import os
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


def main() -> None:
    concurrency = asyncio.run(_get_concurrency())
    pool = "prefork" if concurrency > 1 else "solo"

    print(f"[worker_entrypoint] Starting worker: pool={pool}, concurrency={concurrency}")

    os.execvp(
        "celery",
        [
            "celery",
            "-A", "gorm_ai.tasks.celery_app",
            "worker",
            "--loglevel=info",
            f"--concurrency={concurrency}",
            f"--pool={pool}",
            "--purge",  # discard stale messages from previous runs
        ],
    )


if __name__ == "__main__":
    main()
