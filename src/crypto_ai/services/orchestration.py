"""Orchestration service for managing crypto model-orchestration groups.

A group is a GLOBAL (non-tenant) ensemble of forecasting engines whose blend
weights are calibrated over a universe of kline series. The grain is either
``pooled`` (one weight vector across all series) or ``pair`` (one vector per
``coin_id:quote_asset``). Scoring is delegated to :class:`CalibrationService`;
this service owns group CRUD, score combination, and result storage.
"""

import logging
import math
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.orchestration_group import OrchestrationGroup
from crypto_ai.database.models.prediction_engine import PredictionEngine as PredictionEngineModel
from crypto_ai.prediction.registry import EngineRegistry
from crypto_ai.schemas.prediction import PredictionEngine as PredictionEngineEnum
from crypto_ai.services.calibration import CalibrationService

logger = logging.getLogger(__name__)

MetricType = Literal["mase", "smase", "mae", "mape", "rmse", "crps"]


class OrchestrationService:
    """Service for managing orchestration groups (global; grain pooled/pair)."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.calibration_service = CalibrationService(session)
        self.engine_registry = EngineRegistry()

    async def create_group_draft(
        self,
        name: str,
        engine_slugs: list[str],
        metric: MetricType = "mase",
        top_n: int = 4,
        description: str | None = None,
        notes: str | None = None,
        prediction_target: str | None = None,
        quote_asset: str = "USDT",
        interval: str = "1h",
        coin_ids: list[str] | None = None,
        engine_params: dict[str, dict[str, str]] | None = None,
        created_by: str | None = None,
    ) -> OrchestrationGroup:
        """Create the group row as a ``draft`` — defines the group but runs no
        calibration. Validates inputs so a bad engine set fails fast.
        """
        engine_result = await self.session.execute(
            select(PredictionEngineModel).where(
                PredictionEngineModel.slug.in_(engine_slugs)
            )
        )
        available_engines = {em.slug: em for em in engine_result.scalars()}
        if not available_engines:
            raise ValueError(f"No matching engines found for slugs: {engine_slugs}")

        # Keep only slugs that exist both in the DB and as a known engine enum,
        # so a stale/typo slug can never crash calibration mid-run.
        valid_enum = {e.value for e in PredictionEngineEnum}
        engine_slugs = [s for s in engine_slugs if s in available_engines and s in valid_enum]
        if len(engine_slugs) < 2:
            raise ValueError("Need at least 2 valid engines to build an orchestration group")

        group = OrchestrationGroup(
            name=name,
            description=description,
            notes=notes,
            engine_slugs=engine_slugs,  # full candidate pool, for (re)calibration
            engine_workers={},  # chosen per-run at calibration time, not at create
            engine_params={
                s: p for s, p in (engine_params or {}).items() if s in engine_slugs and p
            },
            model_composition={},
            weights_by_key={},
            quote_asset=quote_asset,
            interval=interval,
            coin_ids=list(coin_ids or []),
            top_n=top_n,
            calibration_metric=metric,
            prediction_target=prediction_target,
            status="draft",
            created_by=created_by,
        )
        self.session.add(group)
        await self.session.commit()
        return group

    def combine_engine_scores(
        self,
        grain: str | None,
        scores_by_engine: dict[str, dict[str, dict[str, float] | float]],
        top_n: int,
    ) -> tuple[dict[str, float], dict[str, dict[str, float]]]:
        """Combine per-engine, per-key fold scores into ``(composition, weights_by_key)``.

        Each engine reports ``{key: {fold_id: score}}``. Per key, engines are
        averaged over **common folds** — the folds every scoring engine
        completed — so a fragile engine isn't flattered by being averaged over
        only its easy survivors. Membership is a single top-N choice per group:
        per-key inverse-error vectors over the full candidate pool are averaged,
        the top-N by average weight become the composition, and each per-key
        vector is restricted to that membership and renormalized. The pooled
        grain has a single ``__pooled__`` key → that vector is the composition
        with no per-key map.
        """
        grain = (grain or "pooled").lower()
        cal = self.calibration_service

        keys: set[str] = set()
        for per_key in scores_by_engine.values():
            keys |= set(per_key)
        if not keys:
            raise ValueError("Calibration produced no scores")

        def key_scores(key: str) -> dict[str, float]:
            """Common-fold average score per engine for one grain key."""
            per_engine: dict[str, dict[str, float]] = {}
            for slug, per_key in scores_by_engine.items():
                if key not in per_key:
                    continue
                folds = per_key[key]
                if isinstance(folds, dict):
                    per_engine[slug] = {
                        f: float(v) for f, v in folds.items()
                        if isinstance(v, (int, float)) and math.isfinite(float(v))
                    }
                elif isinstance(folds, (int, float)) and math.isfinite(float(folds)):
                    per_engine[slug] = {"__avg__": float(folds)}  # legacy scalar
                else:
                    per_engine[slug] = {}

            scored = [set(f) for f in per_engine.values() if f]
            common: set[str] = set.intersection(*scored) if scored else set()

            scores: dict[str, float] = {}
            for slug, folds in per_engine.items():
                if not folds:
                    scores[slug] = float("inf")
                elif common:
                    scores[slug] = float(np.mean([folds[f] for f in common]))
                else:
                    scores[slug] = float(np.mean(list(folds.values())))
            return scores

        def vector_for(key: str) -> dict[str, float]:
            weights = cal._inverse_error_weights(key_scores(key))
            ranked = sorted(weights.items(), key=lambda x: x[1], reverse=True)[:top_n]
            return self._normalize({s: w for s, w in ranked if w > 0})

        if grain == "pooled":
            composition = vector_for("__pooled__") if "__pooled__" in keys else {}
            if not composition:
                raise ValueError("Pooled-grain calibration produced no usable weights")
            return composition, {}

        # Full-pool per-key vectors (no cut) → global top-N membership.
        full_vectors: dict[str, dict[str, float]] = {}
        for key in keys:
            weights = cal._inverse_error_weights(key_scores(key))
            vec = {s: w for s, w in weights.items() if w > 0}
            if vec:
                full_vectors[key] = vec
        if not full_vectors:
            raise ValueError(f"Calibration produced no usable weights for grain '{grain}'")

        avg_full = self._average_vectors(list(full_vectors.values()))
        membership = {
            s for s, _ in sorted(avg_full.items(), key=lambda x: x[1], reverse=True)[:top_n]
        }

        # Restrict every per-key vector to membership and renormalize (inverse-
        # error weights ∝ 1/err, so renormalizing a subset == recomputing on it).
        weights_by_key: dict[str, dict[str, float]] = {}
        for key, vec in full_vectors.items():
            restricted = self._normalize({s: w for s, w in vec.items() if s in membership})
            if restricted:
                weights_by_key[key] = restricted
        if not weights_by_key:
            raise ValueError(f"Calibration produced no usable weights for grain '{grain}'")
        return self._average_vectors(list(weights_by_key.values())), weights_by_key

    async def store_calibration_result(
        self,
        group_id: str,
        composition: dict[str, float],
        weights_by_key: dict[str, dict[str, float]],
        is_selection: bool = False,
    ) -> OrchestrationGroup:
        """Persist a completed calibration and mark the group ``ready``.

        ``is_selection`` records the current candidate pool as the basis of this
        composition (so later edits to ``engine_slugs`` can be detected as
        stale). Reweight leaves that snapshot untouched but still refreshes the
        grain/metric/top_n basis, since it runs at the current config.
        """
        group = await self.get_group(group_id)
        if not group:
            raise ValueError(f"OrchestrationGroup {group_id} not found")
        group.model_composition = composition
        group.weights_by_key = weights_by_key
        if is_selection:
            group.calibrated_slugs = list(group.engine_slugs or [])
        prior_basis = dict(group.calibrated_basis or {})
        group.calibrated_basis = {
            "slugs": (
                list(group.engine_slugs or []) if is_selection
                else prior_basis.get("slugs", list(group.calibrated_slugs or []))
            ),
            "prediction_target": group.prediction_target,
            "metric": group.calibration_metric,
            "top_n": group.top_n,
        }
        group.status = "ready"
        group.last_calibrated_at = datetime.now(UTC)
        group.updated_at = datetime.now(UTC)
        await self.session.commit()
        return group

    async def mark_failed(self, group_id: str) -> None:
        """Mark a group's calibration as failed."""
        group = await self.get_group(group_id)
        if group:
            group.status = "failed"
            group.updated_at = datetime.now(UTC)
            await self.session.commit()

    @staticmethod
    def selected_slugs(group: OrchestrationGroup) -> list[str]:
        """The models a group actually settled on — the survivors of Selection.

        Reweight operates on exactly this set (membership stays fixed); Selection
        ignores it and re-screens the full candidate pool.
        """
        return list((group.model_composition or {}).keys())

    async def calibrate_group_inline(
        self, group_id: str, slugs: list[str] | None = None
    ) -> OrchestrationGroup:
        """Score engines sequentially and store the result (no Celery).

        ``slugs=None`` performs **Selection** (score the full pool, keep top-N);
        passing ``slugs`` performs a **Reweight** (refresh weights of that set
        without changing membership). Used as a local fallback and in tests.
        """
        group = await self.get_group(group_id)
        if not group:
            raise ValueError(f"OrchestrationGroup {group_id} not found")
        engine_slugs = (
            list(slugs) if slugs
            else (list(group.engine_slugs or []) or list(group.model_composition.keys()))
        )
        try:
            scores_by_engine = {}
            for slug in engine_slugs:
                scores_by_engine[slug] = await self.calibration_service.score_engine_keys(
                    list(group.coin_ids or []), group.quote_asset, group.interval,
                    group.prediction_target, slug, group.calibration_metric,
                    params=(group.engine_params or {}).get(slug),
                )
            composition, weights_by_key = self.combine_engine_scores(
                group.prediction_target, scores_by_engine, group.top_n,
            )
        except Exception:
            await self.mark_failed(group_id)
            raise
        return await self.store_calibration_result(
            group_id, composition, weights_by_key, is_selection=not slugs,
        )

    async def mark_running(
        self,
        group_id: str,
        status: Literal["selecting", "reweighting"],
        engine_workers: dict[str, str] | None = None,
    ) -> OrchestrationGroup:
        """Flag a group as running a calibration op (the route then dispatches).

        When ``engine_workers`` is given, re-assign which worker runs each model
        for this run (filtered to the group's candidate engines).
        """
        group = await self.get_group(group_id)
        if not group:
            raise ValueError(f"OrchestrationGroup {group_id} not found")
        if engine_workers is not None:
            valid = set(group.engine_slugs or [])
            group.engine_workers = {
                s: w for s, w in engine_workers.items() if s in valid and w
            }
        group.status = status
        group.updated_at = datetime.now(UTC)
        await self.session.commit()
        return group

    @staticmethod
    def _normalize(vec: dict[str, float]) -> dict[str, float]:
        total = sum(vec.values())
        return {s: w / total for s, w in vec.items()} if total > 0 else dict(vec)

    @classmethod
    def _average_vectors(cls, vectors: list[dict[str, float]]) -> dict[str, float]:
        """Normalized element-wise average of weight vectors (missing slug = 0)."""
        if not vectors:
            return {}
        slugs = {s for v in vectors for s in v}
        avg = {s: sum(v.get(s, 0.0) for v in vectors) / len(vectors) for s in slugs}
        return cls._normalize(avg)

    async def get_group(self, group_id: str) -> OrchestrationGroup | None:
        """Get an orchestration group by ID.

        Returns None for malformed (non-UUID) ids so the route can answer 404
        rather than letting Postgres raise on invalid UUID syntax (500).
        """
        try:
            UUID(group_id)
        except (ValueError, TypeError, AttributeError):
            return None

        result = await self.session.execute(
            select(OrchestrationGroup).where(
                OrchestrationGroup.id == group_id,
                OrchestrationGroup.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def list_groups(self) -> list[OrchestrationGroup]:
        """List all active orchestration groups (global — no tenant scoping)."""
        result = await self.session.execute(
            select(OrchestrationGroup)
            .where(OrchestrationGroup.active.is_(True))
            .order_by(OrchestrationGroup.created_at.desc())
        )
        return result.scalars().all()

    async def update_group(
        self,
        group_id: str,
        name: str | None = None,
        description: str | None = None,
        notes: str | None = None,
        metric: MetricType | None = None,
        top_n: int | None = None,
        prediction_target: str | None = None,
        quote_asset: str | None = None,
        interval: str | None = None,
        coin_ids: list[str] | None = None,
        engine_slugs: list[str] | None = None,
        engine_params: dict[str, dict[str, str]] | None = None,
    ) -> OrchestrationGroup:
        """Update a group's definition. Edits only — does not recalibrate.
        Changing the model set / grain / universe leaves the existing
        composition in place (now potentially stale) until a Selection runs.
        """
        group = await self.get_group(group_id)
        if not group:
            raise ValueError(f"OrchestrationGroup {group_id} not found")

        if name is not None:
            group.name = name
        if description is not None:
            group.description = description
        if notes is not None:
            group.notes = notes
        if metric is not None:
            group.calibration_metric = metric
        if top_n is not None:
            group.top_n = top_n
        if prediction_target is not None:
            group.prediction_target = prediction_target
        if quote_asset is not None:
            group.quote_asset = quote_asset
        if interval is not None:
            group.interval = interval
        if coin_ids is not None:
            group.coin_ids = list(coin_ids)
        if engine_slugs is not None:
            valid_enum = {e.value for e in PredictionEngineEnum}
            engine_result = await self.session.execute(
                select(PredictionEngineModel.slug).where(
                    PredictionEngineModel.slug.in_(engine_slugs)
                )
            )
            available = set(engine_result.scalars())
            cleaned = [s for s in engine_slugs if s in available and s in valid_enum]
            if len(cleaned) < 2:
                raise ValueError("Need at least 2 valid engines in an orchestration group")
            group.engine_slugs = cleaned
            group.engine_workers = {
                s: w for s, w in (group.engine_workers or {}).items() if s in cleaned
            }
            group.engine_params = {
                s: p for s, p in (group.engine_params or {}).items() if s in cleaned
            }
        if engine_params is not None:
            pool = set(group.engine_slugs or [])
            group.engine_params = {
                s: p for s, p in engine_params.items() if s in pool and p
            }

        group.updated_at = datetime.now(UTC)
        await self.session.commit()
        return group

    async def delete_group(self, group_id: str) -> None:
        """Soft delete an orchestration group."""
        group = await self.get_group(group_id)
        if not group:
            raise ValueError(f"OrchestrationGroup {group_id} not found")
        group.active = False
        group.updated_at = datetime.now(UTC)
        await self.session.commit()

    async def get_group_engines(self, group_id: str) -> list[dict]:
        """Get engines in a group with their weights and ranks (by composition)."""
        group = await self.get_group(group_id)
        if not group:
            raise ValueError(f"OrchestrationGroup {group_id} not found")

        engine_slugs = list(group.model_composition.keys())
        if not engine_slugs:
            return []

        engine_result = await self.session.execute(
            select(PredictionEngineModel).where(
                PredictionEngineModel.slug.in_(engine_slugs)
            )
        )
        engine_models = {em.slug: em for em in engine_result.scalars()}

        engines = []
        for rank, (slug, weight) in enumerate(
            sorted(group.model_composition.items(), key=lambda x: x[1], reverse=True),
            start=1,
        ):
            engine_model = engine_models.get(slug)
            engines.append({
                "engine_slug": slug,
                "engine_name": engine_model.name if engine_model else slug,
                "weight": weight,
                "rank": rank,
            })
        return engines
