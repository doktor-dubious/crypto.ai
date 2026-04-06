"""Optimization Celery tasks — grid-search over config combinations to find optimal settings."""

import asyncio
import itertools
import time
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException

from gorm_ai.tasks.celery_app import celery_app


@celery_app.task(
    bind=True,
    name="gorm_ai.tasks.optimization.run_optimization_task",
    time_limit=86400,       # 24 hours hard limit
    soft_time_limit=85800,  # 23 hours 50 minutes soft limit
)
def run_optimization_task(self, request_data: dict) -> dict:
    """Run an optimization grid-search task asynchronously."""
    return asyncio.run(
        _run_optimization_async(self.request.id, request_data, self.request.hostname)
    )


async def _run_optimization_async(
    task_id: str, request_data: dict, hostname: str | None = None,
) -> dict:
    import structlog

    from gorm_ai.database.connection import task_session
    from gorm_ai.schemas.optimization import OptimizeSettingsRequest
    from gorm_ai.services.task import TaskService

    logger = structlog.get_logger(__name__)

    # Extract friendly worker name from Celery hostname
    worker_name = (hostname or "").split("@", 1)[-1] or None

    # Extract optimization_run_id from request data
    optimization_run_id = request_data.pop("optimization_run_id", None)

    # --- Redelivery guard ---
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
            name="Optimize settings",
            worker_name=worker_name,
        )
        await session.commit()

    # --- Mark OptimizationRun as running ---
    if optimization_run_id:
        await _update_optimization_run(optimization_run_id, status="running")

    try:
        from gorm_ai.tasks.celery_app import clear_stop_flag, is_stop_requested

        request = OptimizeSettingsRequest(**request_data)

        def _should_stop() -> bool:
            return is_stop_requested(task_id)

        async def _on_progress(progress: int, message: str) -> None:
            from gorm_ai.tasks.celery_app import get_current_metrics, refresh_worker_registry
            refresh_worker_registry()
            async with task_session() as s:
                ts = TaskService(s)
                await ts.update_progress(task_id, progress, message)
                peak_mem, cpu_time = get_current_metrics(task_id)
                if peak_mem is not None:
                    await ts.update_resource_metrics(task_id, peak_mem, cpu_time)
                await s.commit()

        result = await _run_optimization(
            request, task_id, optimization_run_id, _on_progress, logger,
            should_stop=_should_stop,
        )

        was_stopped = is_stop_requested(task_id)
        clear_stop_flag(task_id)

        if was_stopped or result.get("stopped"):
            async with task_session() as session:
                await TaskService(session).update_status(
                    task_id, "stopped",
                    completed_at=datetime.now(UTC),
                    error="Gracefully stopped",
                )
                await session.commit()

            if optimization_run_id:
                await _update_optimization_run(
                    optimization_run_id,
                    status="stopped",
                    completed_at=datetime.now(UTC),
                )

            return result

        async with task_session() as session:
            await TaskService(session).update_status(
                task_id, "success", completed_at=datetime.now(UTC)
            )
            await session.commit()

        return result

    except Exception as e:
        async with task_session() as session:
            await TaskService(session).update_status(
                task_id, "failure", completed_at=datetime.now(UTC), error=str(e)
            )
            await session.commit()

        # Mark OptimizationRun as failed
        if optimization_run_id:
            await _update_optimization_run(
                optimization_run_id,
                status="failed",
                completed_at=datetime.now(UTC),
            )
        raise


async def _update_optimization_run(
    run_id: str,
    **kwargs,
) -> None:
    """Update fields on an OptimizationRun record."""
    from sqlalchemy import select

    from gorm_ai.database.connection import task_session
    from gorm_ai.database.models.optimization_run import OptimizationRun

    async with task_session() as session:
        result = await session.execute(
            select(OptimizationRun).where(OptimizationRun.id == run_id)
        )
        run = result.scalar_one_or_none()
        if run:
            for field, value in kwargs.items():
                setattr(run, field, value)
            await session.commit()


async def _run_optimization(
    request,
    task_id: str,
    optimization_run_id: str | None,
    on_progress,
    logger,
    should_stop=None,
) -> dict:
    from sqlalchemy import func, select

    from gorm_ai.database.connection import task_session
    from gorm_ai.database.models.outlet import Outlet
    from gorm_ai.database.models.sales import Sales
    from gorm_ai.schemas.simulation import SimulationRequest
    from gorm_ai.services.simulation import SimulationService

    # --- Determine simulation date range ---
    async with task_session() as session:
        if request.simulation_from and request.simulation_to:
            # Explicit date range provided by the user
            simulation_from = request.simulation_from
            simulation_to = request.simulation_to
        else:
            # Legacy fallback: derive range from latest sales date
            outlet_subq = select(Outlet.id).where(
                Outlet.customer_id == request.customer_id,
                Outlet.active.is_(True),
            ).scalar_subquery()

            result = await session.execute(
                select(func.max(Sales.date)).where(Sales.outlet_id.in_(outlet_subq))
            )
            latest_date = result.scalar_one_or_none()

            if latest_date is None:
                raise ValueError("No sales data found for this customer")

            simulation_to = latest_date
            simulation_from = latest_date - timedelta(days=request.simulation_days)

    # Resolve engine slug if a specific engine was requested
    engine_slug: str | None = None
    if request.prediction_engine_id:
        from gorm_ai.database.models.prediction_engine import (
            PredictionEngine as PredictionEngineModel,
        )

        async with task_session() as session:
            pe_result = await session.execute(
                select(PredictionEngineModel).where(
                    PredictionEngineModel.id == request.prediction_engine_id,
                )
            )
            pe = pe_result.scalar_one_or_none()
            if pe:
                engine_slug = pe.slug

    logger.info(
        "optimization.start",
        customer_id=request.customer_id,
        simulation_from=str(simulation_from),
        simulation_to=str(simulation_to),
        engine=engine_slug,
    )

    # --- Generate all parameter combinations ---
    def _linspace(from_val: float, to_val: float, n: int) -> list[float]:
        """Generate n evenly spaced values from from_val to to_val (inclusive)."""
        if n <= 1:
            return [from_val]
        step = (to_val - from_val) / (n - 1)
        return [round(from_val + i * step, 4) for i in range(n)]

    param_axes: dict[str, list] = {}

    if request.optimize_variation_adjustment:
        param_axes["variation_adjustment"] = [False, True]
    if request.optimize_eo_methodology:
        param_axes["eo_methodology"] = [1, 2]
    if request.optimize_eo_extrapolation:
        param_axes["eo_extrapolation"] = [1, 2, 3, 4]
    if request.optimize_covariate_handling:
        param_axes["covariate_handling"] = ["none", "native", "external"]
    if request.optimize_covariate_types:
        # All 2^3 = 8 combinations of active covariate types.
        # Stored as sorted lists (not sets) for JSON serialization.
        param_axes["active_covariate_types"] = [
            [],              # none
            [1],             # weekday only
            [2],             # selling price only
            [3],             # PAD only
            [1, 2],          # weekday + selling price
            [1, 3],          # weekday + PAD
            [2, 3],          # selling price + PAD
            [1, 2, 3],       # all
        ]
    if request.optimize_weekday_profile_correction:
        param_axes["weekday_profile_correction"] = [False, True]
    if request.optimize_history_window:
        param_axes["variation_history_days"] = [
            int(v) for v in _linspace(
                request.history_window_from,
                request.history_window_to,
                request.history_window_iterations,
            )
        ]
    if request.optimize_correction_strength:
        param_axes["weekday_profile_correction_strength"] = _linspace(
            request.correction_strength_from,
            request.correction_strength_to,
            request.correction_strength_iterations,
        )
    if request.optimize_correction_threshold:
        param_axes["weekday_profile_correction_threshold"] = _linspace(
            request.correction_threshold_from,
            request.correction_threshold_to,
            request.correction_threshold_iterations,
        )

    if not param_axes:
        raise ValueError(
            "No settings selected for optimization"
            " — enable at least one optimize_* flag"
        )

    keys = list(param_axes.keys())
    values = list(param_axes.values())
    combinations = [dict(zip(keys, combo)) for combo in itertools.product(*values)]

    total_simulations = len(combinations)
    logger.info("optimization.combinations", total=total_simulations, keys=keys)

    # --- Update OptimizationRun with simulation range and total ---
    if optimization_run_id:
        await _update_optimization_run(
            optimization_run_id,
            simulation_from=simulation_from,
            simulation_to=simulation_to,
            total_combinations=total_simulations,
        )

    # --- Run simulations for each combination ---
    all_results: list[dict] = []
    completed = 0
    sim_times: list[float] = []

    for i, combo in enumerate(combinations):
        # Check for graceful stop request between simulations
        if should_stop and should_stop():
            logger.info("optimization.graceful_stop", completed=completed, total=total_simulations)
            break

        sim_start = time.monotonic()

        # Wrapper progress callback: convert chunk-level progress to global optimization progress
        # Each simulation gets (100 / total_simulations) percentage points
        pct_per_simulation = 100.0 / total_simulations
        sim_pct_start = completed * pct_per_simulation

        async def _on_simulation_progress(chunk_pct: int, chunk_msg: str) -> None:
            # Blend chunk progress (0-100 within simulation) into global progress
            global_pct = sim_pct_start + (chunk_pct / 100.0) * pct_per_simulation
            global_pct = max(1, min(99, round(global_pct)))

            # Prepend simulation number to the chunk message
            full_msg = f"Simulation {completed + 1}/{total_simulations} — {chunk_msg}"
            await on_progress(global_pct, full_msg)

        # Build a simulation request with the combo overrides
        sim_request = SimulationRequest(
            customer_id=request.customer_id,
            simulation_from=simulation_from,
            simulation_to=simulation_to,
            delay=request.delay,
            name=f"Optimization combo {i + 1}/{total_simulations}",
            use_financials=True,
            engine=engine_slug,
            outlet_group_id=request.outlet_group_id,
            prediction_strategy_id=request.prediction_strategy_id,
        )

        try:
            async with task_session() as session:
                service = SimulationService(session)
                sim_result = await service.run_simulation(
                    sim_request,
                    config_overrides=combo,
                    on_progress=_on_simulation_progress,
                )
                await session.commit()

            # --- Score this combination ---
            # Look up the Simulation DB record to get EO aggregates
            async with task_session() as session:
                from gorm_ai.database.models.simulation import Simulation as SimulationModel

                sim_record_result = await session.execute(
                    select(SimulationModel).where(SimulationModel.id == sim_result.id)
                )
                sim_record = sim_record_result.scalar_one_or_none()

                if sim_record:
                    # Use the g-classification profit already computed by
                    # the simulation engine (respects the full financial
                    # fallback chain: outlet_financial_dates → price_history
                    # → outlet_financials → customer_configuration → global).
                    score = sum(
                        getattr(sim_record, f"eo_g{i}") or 0.0
                        for i in range(1, 5)
                    )
                else:
                    score = 0.0

            # Build metrics dict
            metrics: dict = {}
            if sim_record:
                metrics["d_total_delivered"] = sim_record.d_total_delivered
                metrics["d_total_sold"] = sim_record.d_total_sold
                metrics["d_total_returned"] = sim_record.d_total_returned
                metrics["eo_total_sold"] = sim_record.eo_total_sold
                metrics["eo_total_delivered"] = sim_record.eo_total_delivered
                metrics["eo_total_returned"] = sim_record.eo_total_returned
                # Calculate sold_out_pct if eo_lost_sale is available
                eo_lost_sale = sim_record.eo_lost_sale
                if eo_lost_sale is not None:
                    total_potential = (sim_record.eo_total_sold or 0) + eo_lost_sale
                    if total_potential > 0:
                        metrics["sold_out_pct"] = round(
                            (eo_lost_sale / total_potential) * 100, 2
                        )

            combo_result = {
                "combination": combo,
                "score": score,
                "simulation_id": sim_result.id,
                "metrics": metrics,
            }
            all_results.append(combo_result)

        except Exception as e:
            import traceback
            logger.warning(
                "optimization.simulation_failed",
                combo=combo,
                error=str(e),
                traceback=traceback.format_exc(),
            )
            all_results.append({
                "combination": combo,
                "score": None,
                "simulation_id": None,
                "metrics": {},
                "error": str(e),
            })

        sim_elapsed = time.monotonic() - sim_start
        sim_times.append(sim_elapsed)
        completed += 1

        # --- Update OptimizationRun progress after each simulation ---
        if optimization_run_id:
            await _update_optimization_run(
                optimization_run_id,
                completed_combinations=completed,
            )

    # --- Sort results best -> worst ---
    all_results.sort(key=lambda r: r["score"] if r["score"] is not None else float("-inf"), reverse=True)

    best = all_results[0] if all_results else {}
    best_combo = best.get("combination", {})
    best_score = best.get("score")

    await on_progress(100, f"Done — {completed}/{total_simulations} simulations completed")

    logger.info(
        "optimization.complete",
        best_combination=best_combo,
        best_score=best_score,
        total=total_simulations,
        completed=completed,
    )

    # --- Compute diagnostics for the best simulation ---
    diagnostics = None
    if optimization_run_id and best.get("simulation_id"):
        try:
            diagnostics = await _compute_diagnostics(
                best_simulation_id=best["simulation_id"],
                all_results=all_results,
                optimize_variation_adjustment=request.optimize_variation_adjustment,
                logger=logger,
            )
        except Exception as e:
            logger.warning("optimization.diagnostics_failed", error=str(e))

    # --- Persist final results to OptimizationRun ---
    if optimization_run_id:
        update_kwargs: dict = dict(
            status="completed",
            results=all_results,
            best_combination=best_combo,
            best_score=best_score,
            completed_combinations=completed,
            completed_at=datetime.now(UTC),
        )
        if diagnostics is not None:
            update_kwargs["diagnostics"] = diagnostics
        await _update_optimization_run(optimization_run_id, **update_kwargs)

    stopped = should_stop() if should_stop else False

    return {
        "best_combination": best_combo,
        "best_score": best_score,
        "all_results": all_results,
        "total_simulations": total_simulations,
        "completed_simulations": completed,
        "stopped": stopped,
    }


async def _compute_diagnostics(
    best_simulation_id: str,
    all_results: list[dict],
    optimize_variation_adjustment: bool,
    logger,
) -> dict:
    """Compute diagnostic analyses for the best simulation in an optimization run.

    Returns a dict with up to 4 diagnostic sections:
      - g_by_tau_range: G1-G4 counts split by interpolation vs extrapolation
      - quantile_calibration: how well Q90 calibrates against actuals
      - g3_by_weekday: G3 waste counts broken down by weekday
      - va_comparison: variation adjustment on vs off comparison (if applicable)
    """
    import math
    from collections import defaultdict

    from sqlalchemy import select

    from gorm_ai.database.connection import task_session
    from gorm_ai.database.models.prediction import Prediction
    from gorm_ai.database.models.prediction_outlet import PredictionOutlet
    from gorm_ai.database.models.simulation import Simulation as SimulationModel
    from gorm_ai.database.models.simulation_date import SimulationDate

    diagnostics: dict = {}

    # --- Fetch all outlet-day data for the best simulation ---
    async with task_session() as session:
        stmt = (
            select(
                Prediction.date,
                PredictionOutlet.eo,
                PredictionOutlet.delivered,
                PredictionOutlet.actual_sale,
                PredictionOutlet.upper_bound,
            )
            .join(SimulationDate, SimulationDate.prediction_id == Prediction.id)
            .join(PredictionOutlet, PredictionOutlet.prediction_id == Prediction.id)
            .where(SimulationDate.simulation_id == best_simulation_id)
            .where(PredictionOutlet.actual_sale.isnot(None))
            .where(PredictionOutlet.delivered.isnot(None))
        )
        result = await session.execute(stmt)
        rows = result.all()

    if not rows:
        logger.warning("optimization.diagnostics_no_data", simulation_id=best_simulation_id)
        return {}

    logger.info("optimization.diagnostics_rows", count=len(rows))

    # --- Helper: classify a single outlet-day into G1/G2/G3/G4 ---
    def classify_g(eo_val: float, actual_draw: float, actual_sale: float) -> str | None:
        """Classify using the same logic as SimulationService._classify.

        Returns 'g1', 'g2', 'g3', 'g4', or None (neutral).
        """
        eo_draw = max(1, round(eo_val))
        actual_return = max(0.0, actual_draw - actual_sale)
        sold_out = actual_return == 0.0

        if eo_draw < actual_draw:
            if eo_draw >= actual_sale:
                return "g1"  # good reduction
            else:
                return "g2"  # bad reduction (lost sale)
        elif eo_draw > actual_draw:
            if sold_out:
                return "g4"  # good increase (potential extra sold)
            else:
                return "g3"  # bad increase (extra waste)
        return None  # neutral

    # --- Diagnostic 1: G3/G4 by tau range (interpolation vs extrapolation) ---
    interp_counts = defaultdict(int)
    extrap_counts = defaultdict(int)

    # --- Diagnostic 2: Quantile calibration ---
    total_days = 0
    below_q90 = 0

    # --- Diagnostic 3: G3 by weekday ---
    g3_by_weekday: dict[int, int] = defaultdict(int)
    total_by_weekday: dict[int, int] = defaultdict(int)

    for pred_date, eo, delivered, actual_sale, upper_bound in rows:
        if eo is None or math.isnan(eo):
            continue

        actual_draw = delivered
        g = classify_g(eo, actual_draw, actual_sale)

        # Diagnostic 1: determine interpolation vs extrapolation
        is_extrapolation = (
            upper_bound is not None
            and not math.isnan(upper_bound)
            and eo > upper_bound
        )
        bucket = extrap_counts if is_extrapolation else interp_counts
        if g:
            bucket[g] += 1

        # Diagnostic 2: quantile calibration
        if upper_bound is not None and not math.isnan(upper_bound):
            total_days += 1
            if actual_sale <= upper_bound:
                below_q90 += 1

        # Diagnostic 3: G3 by weekday
        weekday = pred_date.weekday()  # 0=Mon, 6=Sun
        total_by_weekday[weekday] += 1
        if g == "g3":
            g3_by_weekday[weekday] += 1

    # --- Build diagnostic 1 output ---
    diagnostics["g3_g4_by_tau"] = {
        "interpolation": {
            "g1": interp_counts.get("g1", 0),
            "g2": interp_counts.get("g2", 0),
            "g3": interp_counts.get("g3", 0),
            "g4": interp_counts.get("g4", 0),
        },
        "extrapolation": {
            "g1": extrap_counts.get("g1", 0),
            "g2": extrap_counts.get("g2", 0),
            "g3": extrap_counts.get("g3", 0),
            "g4": extrap_counts.get("g4", 0),
        },
    }

    # --- Build diagnostic 2 output ---
    if total_days > 0:
        pct = round(below_q90 / total_days, 4)
        if pct < 0.85:
            assessment = "Quantiles are too narrow — model underestimates uncertainty"
        elif pct > 0.95:
            assessment = "Quantiles are too wide — model overestimates uncertainty"
        else:
            assessment = "Quantile calibration is reasonable"

        diagnostics["quantile_calibration"] = {
            "total_days": total_days,
            "below_q90": below_q90,
            "pct_below_q90": pct,
            "expected": 0.90,
            "assessment": assessment,
        }

    # --- Build diagnostic 3 output ---
    total_g3 = sum(g3_by_weekday.values())
    total_all = sum(total_by_weekday.values())
    avg_g3_rate = (total_g3 / total_all) if total_all > 0 else 0.0

    weekday_data: dict[str, dict] = {}
    flagged_weekdays: list[str] = []
    weekday_names = {0: "Mon", 1: "Tue", 2: "Wed", 3: "Thu", 4: "Fri", 5: "Sat", 6: "Sun"}
    for wd in range(7):
        g3_count = g3_by_weekday.get(wd, 0)
        total = total_by_weekday.get(wd, 0)
        rate = round(g3_count / total, 4) if total > 0 else 0.0
        weekday_data[str(wd)] = {
            "g3_count": g3_count,
            "total": total,
            "g3_rate": rate,
        }
        # Flag if rate is >50% above average and has meaningful sample
        if avg_g3_rate > 0 and rate > avg_g3_rate * 1.5 and total >= 5:
            flagged_weekdays.append(weekday_names[wd])

    diagnostics["g3_by_weekday"] = {
        "weekdays": weekday_data,
        "avg_g3_rate": round(avg_g3_rate, 4),
        "flagged": flagged_weekdays,
    }

    # --- Diagnostic 4: VA comparison (only if variation_adjustment was optimized) ---
    if optimize_variation_adjustment:
        try:
            va_on_results = [
                r for r in all_results
                if r.get("combination", {}).get("variation_adjustment") is True
                and r.get("simulation_id")
            ]
            va_off_results = [
                r for r in all_results
                if r.get("combination", {}).get("variation_adjustment") is False
                and r.get("simulation_id")
            ]

            if va_on_results and va_off_results:
                # Pick the best of each group
                best_va_on = max(va_on_results, key=lambda r: r.get("score") if r.get("score") is not None else float("-inf"))
                best_va_off = max(va_off_results, key=lambda r: r.get("score") if r.get("score") is not None else float("-inf"))

                async with task_session() as session:
                    sim_on = await session.get(SimulationModel, best_va_on["simulation_id"])
                    sim_off = await session.get(SimulationModel, best_va_off["simulation_id"])

                if sim_on and sim_off:
                    va_on_data = {
                        "g1": sim_on.eo_g1 or 0,
                        "g2": sim_on.eo_g2 or 0,
                        "g3": sim_on.eo_g3 or 0,
                        "g4": sim_on.eo_g4 or 0,
                        "score": best_va_on.get("score", 0),
                        "combination": best_va_on.get("combination", {}),
                    }
                    va_off_data = {
                        "g1": sim_off.eo_g1 or 0,
                        "g2": sim_off.eo_g2 or 0,
                        "g3": sim_off.eo_g3 or 0,
                        "g4": sim_off.eo_g4 or 0,
                        "score": best_va_off.get("score", 0),
                        "combination": best_va_off.get("combination", {}),
                    }

                    # Build assessment
                    parts: list[str] = []
                    if va_on_data["score"] > va_off_data["score"]:
                        parts.append("Variation adjustment ON has a higher score")
                    elif va_on_data["score"] < va_off_data["score"]:
                        parts.append("Variation adjustment OFF has a higher score")
                    else:
                        parts.append("Both variation adjustment settings scored equally")

                    g3_on = va_on_data["g3"]
                    g3_off = va_off_data["g3"]
                    if g3_on < g3_off:
                        parts.append("VA reduces G3 (waste)")
                    elif g3_on > g3_off:
                        parts.append("VA increases G3 (waste)")

                    g2_on = va_on_data["g2"]
                    g2_off = va_off_data["g2"]
                    if g2_on < g2_off:
                        parts.append("VA reduces G2 (lost sales)")
                    elif g2_on > g2_off:
                        parts.append("VA increases G2 (lost sales)")

                    diagnostics["va_comparison"] = {
                        "with_va": va_on_data,
                        "without_va": va_off_data,
                        "assessment": ". ".join(parts),
                    }
        except Exception as e:
            logger.warning("optimization.diagnostics_va_failed", error=str(e))

    return diagnostics
