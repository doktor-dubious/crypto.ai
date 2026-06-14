"""Finetune examination Celery task — runs base + finetuned simulations and compares results."""

import asyncio
from datetime import UTC, date, datetime

from fastapi import HTTPException

from crypto_ai.tasks.celery_app import celery_app


def generate_conclusion(
    base_stats: dict | None,
    ft_stats: dict | None,
    base_zs: dict | None,
    ft_zs: dict | None,
) -> str:
    """Generate a human-readable conclusion comparing base vs finetuned metrics."""
    parts: list[str] = []

    if base_stats and ft_stats:
        # MAE comparison
        if base_stats.get("mae") and ft_stats.get("mae"):
            mae_diff = ft_stats["mae"] - base_stats["mae"]
            if base_stats["mae"] > 0:
                pct = abs(mae_diff) / base_stats["mae"] * 100
                if mae_diff < 0:
                    parts.append(f"Fine-tuning reduced MAE by {abs(mae_diff):.2f} ({pct:.1f}%).")
                elif mae_diff > 0:
                    parts.append(f"Fine-tuning increased MAE by {mae_diff:.2f} ({pct:.1f}%).")
                else:
                    parts.append("MAE is unchanged.")

        # Bias comparison
        if base_stats.get("bias") is not None and ft_stats.get("bias") is not None:
            base_bias = abs(base_stats["bias"])
            ft_bias = abs(ft_stats["bias"])
            if base_bias > 0:
                bias_diff = ft_bias - base_bias
                pct = abs(bias_diff) / base_bias * 100
                if bias_diff < 0:
                    parts.append(f"Absolute bias improved by {abs(bias_diff):.2f} ({pct:.1f}%).")
                elif bias_diff > 0:
                    parts.append(f"Absolute bias worsened by {bias_diff:.2f} ({pct:.1f}%).")

        # RMSE comparison
        if base_stats.get("rmse") and ft_stats.get("rmse"):
            rmse_diff = ft_stats["rmse"] - base_stats["rmse"]
            if base_stats["rmse"] > 0:
                pct = abs(rmse_diff) / base_stats["rmse"] * 100
                if rmse_diff < 0:
                    parts.append(f"RMSE improved by {abs(rmse_diff):.2f} ({pct:.1f}%).")
                elif rmse_diff > 0:
                    parts.append(f"RMSE worsened by {rmse_diff:.2f} ({pct:.1f}%).")

        # MAPE comparison
        if base_stats.get("mape") is not None and ft_stats.get("mape") is not None:
            mape_diff = ft_stats["mape"] - base_stats["mape"]
            if base_stats["mape"] > 0:
                pct = abs(mape_diff) / base_stats["mape"] * 100
                if mape_diff < 0:
                    parts.append(f"MAPE improved by {abs(mape_diff):.2f}pp ({pct:.1f}%).")
                elif mape_diff > 0:
                    parts.append(f"MAPE worsened by {mape_diff:.2f}pp ({pct:.1f}%).")

        # R-squared comparison
        if base_stats.get("r_squared") is not None and ft_stats.get("r_squared") is not None:
            r2_diff = ft_stats["r_squared"] - base_stats["r_squared"]
            if r2_diff > 0:
                parts.append(f"R-squared improved by {r2_diff:.4f}.")
            elif r2_diff < 0:
                parts.append(f"R-squared decreased by {abs(r2_diff):.4f}.")

    if not parts:
        return "Insufficient data to generate a conclusion."

    # Overall verdict
    improvements = sum(1 for p in parts if "improved" in p or "reduced" in p)
    regressions = sum(1 for p in parts if "worsened" in p or "increased" in p)
    if improvements > 0 and regressions == 0:
        parts.append("Overall, fine-tuning improved model performance.")
    elif regressions > 0 and improvements == 0:
        parts.append("Overall, fine-tuning did not improve model performance.")
    elif improvements == 0 and regressions == 0:
        parts.append("Overall, results are identical between base and finetuned models.")
    elif improvements > regressions:
        parts.append("Overall, fine-tuning shows a net improvement.")
    elif regressions > improvements:
        parts.append("Overall, fine-tuning shows a net regression.")
    else:
        parts.append("Overall, results are mixed — some metrics improved, others worsened.")

    return " ".join(parts)


@celery_app.task(
    bind=True,
    name="crypto_ai.tasks.finetune_examination.run_finetune_examination",
    time_limit=604800,
    soft_time_limit=604200,
)
def run_finetune_examination(self, request_data: dict) -> dict:
    """Run a finetune examination task asynchronously."""
    return asyncio.run(_run_async(self.request.id, request_data, self.request.hostname))


async def _run_async(task_id: str, request_data: dict, hostname: str | None = None) -> dict:
    """Run the finetune examination: base sim, finetuned sim, then compare."""
    from crypto_ai.database.connection import task_session
    from crypto_ai.database.models.finetune_examination import FinetuneExamination
    from crypto_ai.schemas.simulation import SimulationRequest
    from crypto_ai.services.simulation import SimulationService
    from crypto_ai.services.task import TaskService

    worker_name = (hostname or "").split("@", 1)[-1] or None
    examination_id = request_data["examination_id"]

    # Guard against redelivery
    async with task_session() as session:
        ts = TaskService(session)
        try:
            record = await ts.get(task_id)
            if record.status != "pending":
                return {"skipped": True, "reason": f"task status is {record.status}"}
        except HTTPException:
            return {"skipped": True, "reason": "redelivered task not in DB"}

        await ts.update_status(
            task_id, "started",
            started_at=datetime.now(UTC),
            name=request_data.get("name", "Finetune examination"),
            worker_name=worker_name,
        )
        await session.commit()

    async def _update_exam_status(status: str, **kwargs) -> None:
        async with task_session() as session:
            exam = await session.get(FinetuneExamination, examination_id)
            if exam:
                exam.status = status
                for k, v in kwargs.items():
                    setattr(exam, k, v)
                await session.commit()

    async def _on_progress(progress: int, message: str) -> None:
        from crypto_ai.tasks.celery_app import get_current_metrics, refresh_worker_registry
        refresh_worker_registry()
        async with task_session() as session:
            ts = TaskService(session)
            await ts.update_progress(task_id, progress, message)
            peak_mem, cpu_time = get_current_metrics(task_id)
            if peak_mem is not None:
                await ts.update_resource_metrics(task_id, peak_mem, cpu_time)
            await session.commit()

    try:
        from crypto_ai.tasks.celery_app import clear_stop_flag, is_stop_requested

        def _should_stop() -> bool:
            return is_stop_requested(task_id)

        # Parse dates
        sim_from = request_data["simulation_from"]
        sim_to = request_data["simulation_to"]
        if isinstance(sim_from, str):
            sim_from = date.fromisoformat(sim_from)
        if isinstance(sim_to, str):
            sim_to = date.fromisoformat(sim_to)

        # Common simulation params
        common_params = {
            "customer_id": request_data["customer_id"],
            "simulation_from": sim_from,
            "simulation_to": sim_to,
            "delay": request_data.get("delay", 1),
            "outlet_group_id": request_data.get("outlet_group_id"),
            "prediction_strategy_id": request_data.get("prediction_strategy_id"),
        }

        # ── Phase 1: Run base simulation ─────────────────────────────────
        await _update_exam_status("running_base", started_at=datetime.now(UTC))
        await _on_progress(5, "Running base model simulation...")

        base_request = SimulationRequest(
            **common_params,
            engine=request_data.get("base_engine", "timesfm"),
            name=f"[Exam] Base: {request_data.get('name', '')}",
        )

        async with task_session() as session:
            service = SimulationService(session)
            base_result = await service.run_simulation(
                base_request,
                on_progress=lambda p, m: _on_progress(5 + int(p * 0.35), f"Base: {m}"),
                should_stop=_should_stop,
            )
            await session.commit()

        # Check for stop after base simulation
        if is_stop_requested(task_id):
            clear_stop_flag(task_id)
            now = datetime.now(UTC)
            await _update_exam_status(
                "failed", error="Gracefully stopped", completed_at=now,
            )
            async with task_session() as session:
                await TaskService(session).update_status(
                    task_id, "stopped",
                    completed_at=now, error="Gracefully stopped",
                )
                await session.commit()
            return {"examination_id": examination_id, "status": "stopped"}

        base_simulation_id = base_result.id if hasattr(base_result, "id") else None

        # ── Phase 2: Run finetuned simulation ────────────────────────────
        await _update_exam_status("running_finetuned", base_simulation_id=base_simulation_id)
        await _on_progress(45, "Running finetuned model simulation...")

        ft_request = SimulationRequest(
            **common_params,
            engine=request_data.get("finetuned_engine", "timesfm_finetuned"),
            name=f"[Exam] Finetuned: {request_data.get('name', '')}",
        )

        async with task_session() as session:
            service = SimulationService(session)
            ft_result = await service.run_simulation(
                ft_request,
                on_progress=lambda p, m: _on_progress(45 + int(p * 0.35), f"Finetuned: {m}"),
                should_stop=_should_stop,
            )
            await session.commit()

        # Check for stop after finetuned simulation
        if is_stop_requested(task_id):
            clear_stop_flag(task_id)
            now = datetime.now(UTC)
            await _update_exam_status(
                "failed", error="Gracefully stopped", completed_at=now,
            )
            async with task_session() as session:
                await TaskService(session).update_status(
                    task_id, "stopped",
                    completed_at=now, error="Gracefully stopped",
                )
                await session.commit()
            return {"examination_id": examination_id, "status": "stopped"}

        finetuned_simulation_id = ft_result.id if hasattr(ft_result, "id") else None

        # ── Phase 3: Compute comparison stats ────────────────────────────
        await _update_exam_status(
            "computing",
            finetuned_simulation_id=finetuned_simulation_id,
        )
        await _on_progress(85, "Computing comparison statistics...")

        base_stats = None
        ft_stats = None
        base_zero_shot = None
        ft_zero_shot = None
        base_overview = None
        ft_overview = None

        async with task_session() as session:
            service = SimulationService(session)

            if base_simulation_id:
                base_stats = await service.get_accuracy_stats(base_simulation_id)
                base_zero_shot = await service.get_zero_shot(base_simulation_id)
                base_overview = await service.get_overview_filtered(base_simulation_id)

            if finetuned_simulation_id:
                ft_stats = await service.get_accuracy_stats(finetuned_simulation_id)
                ft_zero_shot = await service.get_zero_shot(finetuned_simulation_id)
                ft_overview = await service.get_overview_filtered(finetuned_simulation_id)

        await _on_progress(95, "Generating conclusion...")

        conclusion = generate_conclusion(base_stats, ft_stats, base_zero_shot, ft_zero_shot)

        # ── Phase 4: Save results ────────────────────────────────────────
        async with task_session() as session:
            exam = await session.get(FinetuneExamination, examination_id)
            if exam:
                exam.status = "completed"
                exam.base_simulation_id = base_simulation_id
                exam.finetuned_simulation_id = finetuned_simulation_id
                exam.base_stats = base_stats
                exam.finetuned_stats = ft_stats
                exam.base_zero_shot = base_zero_shot
                exam.finetuned_zero_shot = ft_zero_shot
                exam.base_overview = base_overview
                exam.finetuned_overview = ft_overview
                exam.conclusion = conclusion
                exam.completed_at = datetime.now(UTC)
                await session.commit()

        async with task_session() as session:
            await TaskService(session).update_status(
                task_id, "success", completed_at=datetime.now(UTC),
            )
            await session.commit()

        await _on_progress(100, "Examination completed")

        return {
            "examination_id": examination_id,
            "status": "completed",
            "base_simulation_id": base_simulation_id,
            "finetuned_simulation_id": finetuned_simulation_id,
        }

    except Exception as e:
        # Mark examination as failed
        async with task_session() as session:
            exam = await session.get(FinetuneExamination, examination_id)
            if exam:
                exam.status = "failed"
                exam.error = str(e)
                exam.completed_at = datetime.now(UTC)
                await session.commit()

        async with task_session() as session:
            await TaskService(session).update_status(
                task_id, "failure", completed_at=datetime.now(UTC), error=str(e),
            )
            await session.commit()
        raise
