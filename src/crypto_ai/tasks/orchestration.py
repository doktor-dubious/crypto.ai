"""Orchestration calibration Celery tasks.

Calibration runs a rolling-origin backtest over many kline series × engines.
Because different foundation models live on different servers (a worker only
loads the models in its ``WORKER_MODELS``), calibration is split into one
sub-task per engine, each routed to a worker that advertises that model, then
aggregated by a finalize callback (a Celery chord). All sub-tasks default to the
local queue when no specific worker is assigned.
"""

import asyncio
import logging
from datetime import UTC, datetime

from fastapi import HTTPException

from crypto_ai.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="crypto_ai.tasks.orchestration.score_engine_task")
def score_engine_task(self, request_data: dict) -> dict:
    """Score ONE engine for a group at its grain.

    Returns ``{"engine_slug": slug, "scores": {key: {fold: score}} | None}``.
    Never raises (a raising header task would abort the chord) — a failed engine
    returns ``scores=None`` and is dropped during aggregation.
    """
    return asyncio.run(_score_engine_async(request_data))


async def _score_engine_async(request_data: dict) -> dict:
    from crypto_ai.database.connection import task_session
    from crypto_ai.services.orchestration import OrchestrationService

    group_id = request_data["group_id"]
    engine_slug = request_data["engine_slug"]
    try:
        from crypto_ai.tasks.celery_app import refresh_worker_registry
        refresh_worker_registry()
        async with task_session() as session:
            svc = OrchestrationService(session)
            group = await svc.get_group(group_id)
            if not group:
                return {"engine_slug": engine_slug, "scores": None}
            scores = await svc.calibration_service.score_engine_keys(
                list(group.coin_ids or []), group.quote_asset, group.interval,
                group.prediction_target, engine_slug, group.calibration_metric,
                params=(group.engine_params or {}).get(engine_slug),
            )
        return {"engine_slug": engine_slug, "scores": scores}
    except Exception as e:  # noqa: BLE001 — must not abort the chord
        logger.warning("score_engine_task failed for %s: %s", engine_slug, e)
        return {"engine_slug": engine_slug, "scores": None}


@celery_app.task(bind=True, name="crypto_ai.tasks.orchestration.finalize_calibration_task")
def finalize_calibration_task(
    self, results: list[dict], group_id: str, operation: str = "select"
) -> dict:
    """Chord callback: combine per-engine scores into weights and persist."""
    return asyncio.run(_finalize_async(self.request.id, results, group_id, operation))


async def _finalize_async(
    task_id: str, results: list[dict], group_id: str, operation: str = "select"
) -> dict:
    from crypto_ai.database.connection import task_session
    from crypto_ai.services.orchestration import OrchestrationService
    from crypto_ai.services.task import TaskService

    # Drop engines that failed to score.
    scores_by_engine = {
        r["engine_slug"]: r["scores"]
        for r in results
        if r and r.get("scores")
    }

    try:
        async with task_session() as session:
            svc = OrchestrationService(session)
            group = await svc.get_group(group_id)
            if not group:
                raise ValueError(f"OrchestrationGroup {group_id} not found")
            if not scores_by_engine:
                await svc.mark_failed(group_id)
                raise ValueError("No engine produced a usable forecast")
            composition, weights_by_key = svc.combine_engine_scores(
                group.prediction_target, scores_by_engine, group.top_n,
            )
            await svc.store_calibration_result(
                group_id, composition, weights_by_key,
                is_selection=(operation == "select"),
            )
    except Exception as e:
        # Failure *before* the calibration result is stored — the group has no
        # valid weights, so mark it failed.
        async with task_session() as session:
            svc = OrchestrationService(session)
            await svc.mark_failed(group_id)
            try:
                await TaskService(session).update_status(
                    task_id, "failure", completed_at=datetime.now(UTC), error=str(e),
                )
            except HTTPException:
                pass
            await session.commit()
        raise

    # Weights are durably stored and the group is 'ready'. Record task-record
    # success in a separate transaction whose failure must NOT flip the
    # (already-committed) group back to 'failed'.
    try:
        async with task_session() as session:
            await TaskService(session).update_status(
                task_id, "success", completed_at=datetime.now(UTC),
            )
            await session.commit()
    except Exception:
        logger.exception(
            "Calibration for group %s succeeded but task-status update failed", group_id,
        )
    return {"group_id": group_id, "status": "ready", "engines_scored": len(scores_by_engine)}


def dispatch_calibration_chord(
    group_id: str,
    engine_slugs: list[str],
    engine_workers: dict[str, str] | None,
    operation: str = "select",
) -> str:
    """Fan out one score task per engine (each to its assigned worker queue) and
    aggregate with finalize. ``operation`` is ``select`` (re-screen the pool,
    snapshot it) or ``reweight`` (refresh weights of the fixed set). Returns the
    finalize (callback) task id."""
    from celery import chord

    engine_workers = engine_workers or {}
    header = []
    for slug in engine_slugs:
        sig = score_engine_task.s({"group_id": group_id, "engine_slug": slug})
        queue = engine_workers.get(slug)
        if queue:
            sig = sig.set(queue=queue)
        header.append(sig)

    callback = finalize_calibration_task.s(group_id, operation)
    result = chord(header)(callback)
    return result.id
