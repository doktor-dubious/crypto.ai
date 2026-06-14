"""Database-backed logging handler for fine-tuning logs.

Buffers log records and flushes them to the ``finetune_logs`` table in
batches.  Designed to be attached to the finetune-related loggers so
that remote workers write logs to the shared database instead of only
to a local file.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from datetime import UTC, datetime


def get_finetune_db_handler() -> FinetuneDbHandler | None:
    """Return the active FinetuneDbHandler, if one is installed."""
    for name in (
        "crypto_ai.services._finetune_timesfm",
        "crypto_ai.services._finetune_moirai2",
        "crypto_ai.services.finetune",
        "crypto_ai.tasks.finetuning",
        "crypto_ai.tasks.finetune_examination",
    ):
        for handler in logging.getLogger(name).handlers:
            if isinstance(handler, FinetuneDbHandler):
                return handler
    return None


class FinetuneDbHandler(logging.Handler):
    """Logging handler that inserts rows into ``finetune_logs``.

    Parameters
    ----------
    fine_tune_id:
        UUID of the current FineTune record.  Set via ``set_fine_tune_id``
        before any log lines are emitted.
    batch_size:
        Number of records to buffer before flushing.
    flush_interval:
        Seconds between automatic flushes (even if batch not full).
    """

    def __init__(
        self,
        batch_size: int = 20,
        flush_interval: float = 5.0,
    ) -> None:
        super().__init__()
        self._fine_tune_id: str | None = None
        self._worker_name: str = os.environ.get("WORKER_NAME", "local")
        self._batch_size = batch_size
        self._flush_interval = flush_interval
        self._buffer: list[dict] = []
        self._seq = 0
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None

    # ── public API ───────────────────────────────────────────────────

    def set_fine_tune_id(self, fine_tune_id: str | None) -> None:
        """Set (or clear) the current fine-tune run id."""
        self.flush()
        self._fine_tune_id = fine_tune_id
        self._seq = 0

    # ── logging.Handler interface ────────────────────────────────────

    def emit(self, record: logging.LogRecord) -> None:
        if not self._fine_tune_id:
            return
        try:
            entry = {
                "fine_tune_id": self._fine_tune_id,
                "level": record.levelname.lower(),
                "message": record.getMessage(),
                "worker_name": self._worker_name,
                "seq": self._seq,
                "logged_at": datetime.now(UTC),
            }
            with self._lock:
                self._buffer.append(entry)
                self._seq += 1
                if len(self._buffer) >= self._batch_size:
                    self._do_flush()
                elif self._timer is None:
                    self._start_timer()
        except Exception:
            self.handleError(record)

    def flush(self) -> None:
        with self._lock:
            self._do_flush()

    def close(self) -> None:
        self.flush()
        self._cancel_timer()
        super().close()

    # ── internals ────────────────────────────────────────────────────

    def _start_timer(self) -> None:
        self._cancel_timer()
        self._timer = threading.Timer(self._flush_interval, self._timer_flush)
        self._timer.daemon = True
        self._timer.start()

    def _cancel_timer(self) -> None:
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None

    def _timer_flush(self) -> None:
        with self._lock:
            self._do_flush()

    def _do_flush(self) -> None:
        """Write buffered entries to the database (called with lock held)."""
        self._cancel_timer()
        if not self._buffer:
            return
        batch = self._buffer[:]
        self._buffer.clear()

        try:
            asyncio.run(self._write_batch(batch))
        except RuntimeError:
            # Already inside a running event loop (e.g. called from the
            # async finetune task).  Offload to a short-lived thread that
            # can safely call asyncio.run().
            import concurrent.futures

            try:
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(asyncio.run, self._write_batch(batch))
                    future.result(timeout=10)
            except Exception:
                import sys
                print(
                    f"[FinetuneDbHandler] failed to flush {len(batch)} log entries (thread)",
                    file=sys.stderr,
                )
        except Exception:
            # If DB write fails, don't lose the records — log to stderr
            import sys
            print(
                f"[FinetuneDbHandler] failed to flush {len(batch)} log entries",
                file=sys.stderr,
            )

    @staticmethod
    async def _write_batch(batch: list[dict]) -> None:
        from crypto_ai.database.connection import task_session
        from crypto_ai.database.models.finetune_log import FinetuneLog

        async with task_session() as session:
            session.add_all([FinetuneLog(**entry) for entry in batch])
            await session.commit()
