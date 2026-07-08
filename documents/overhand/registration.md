# Engine registration — wiring the new engines in

One place for all the wiring the companion engine files need: **(1)** enum value,
**(2)** registry registration, **(3)** DB rows (only if your engine list is
DB-driven), plus a couple of easy-to-miss allow-lists.

Fix `crypto_ai` → your package name throughout. Values below mirror gorm.ai's
working setup.

---

## 1. Enum values — `schemas/prediction.py`

Add to the `PredictionEngine` (string) enum. **Slugs must match everywhere**
(enum value == registry key == DB `slug`).

```python
class PredictionEngine(str, Enum):
    # ... existing ...
    CHRONOS2  = "chronos2"      # SLUG standardized to "chronos2" everywhere
                                # (enum == registry key == DB slug). If a reverted
                                # v1 "chronos2" engine already exists, replace its
                                # engine class with the real Chronos2Engine rather
                                # than adding a second slug.
    TOTO2     = "toto2"
    TTM       = "ttm"
    TABPFN    = "tabpfn"
    # FLOWSTATE = "flowstate"   # already present — FlowState is an update, not new
```

> **Slug vs model-alias:** the engine **slug** is `chronos2`. The **model**
> parameter value `chronos-2` is a separate thing — a model-id alias the engine
> resolves to `amazon/chronos-2`. Don't conflate them.

---

## 2. Registry registration — `prediction/registry.py`

Inside `_register_default_engines()`. The `try/except ImportError` is essential:
each engine's ML package lives in a **different worker**, so on a worker without
that package the import fails and the engine is simply skipped (no crash).

```python
# Chronos-2 (real amazon/chronos-2 via chronos-forecasting>=2.2)
try:
    from crypto_ai.prediction.engines.chronos2_engine import Chronos2Engine
    self.register(PredictionEngineEnum.CHRONOS2, Chronos2Engine)
except ImportError:
    pass  # chronos-forecasting>=2.2 not available

# TinyTimeMixer (IBM, tsfm_public — same package as FlowState)
try:
    from crypto_ai.prediction.engines.ttm_engine import TTMEngine
    self.register(PredictionEngineEnum.TTM, TTMEngine)
except ImportError:
    pass  # tsfm_public not available

# TabPFN-TS (Prior Labs, local-only)
try:
    from crypto_ai.prediction.engines.tabpfn_engine import TabPFNTSEngine
    self.register(PredictionEngineEnum.TABPFN, TabPFNTSEngine)
except ImportError:
    pass  # tabpfn-time-series not available

# Toto 2.0 (Datadog toto2 package — Python 3.12 worker)
try:
    from crypto_ai.prediction.engines.toto2_engine import Toto2DirectEngine
    self.register(PredictionEngineEnum.TOTO2, Toto2DirectEngine)
except ImportError:
    pass  # toto-models not available
```

---

## 3. DB rows — ONLY if your engine list is DB-driven

Skip this whole section if your engine list comes from the registry/enum. gorm.ai
drives its UI from a `prediction_engine` table (+ `prediction_engine_parameter`
for the selectable params). The SQL below uses a **slug subquery** so you don't
hardcode UUIDs. Confirm your column names first — they may differ.

### 3a. Engine rows

```sql
INSERT INTO prediction_engine (slug, name, description, active) VALUES
  ('chronos2', 'Chronos 2.0',    'Amazon Chronos-2 foundation model',        true),
  ('ttm',      'TinyTimeMixer',  'IBM TinyTimeMixer compact forecaster',     true),
  ('tabpfn',   'TabPFN-TS',      'Prior Labs TabPFN-TS (local-only)',        true),
  ('toto2',    'Toto 2.0',       'Datadog Toto 2.0 foundation model',        true);
-- (id/created_at/updated_at assumed to have DB defaults; add them if not.)
```

### 3b. Parameter rows (the UI dropdowns)

Each row is ONE selectable option: `name` = param name, `value` = option value,
`selected = true` on exactly one option per (engine, name). The app builds the
dict passed to `apply_parameters` from the `selected=true` rows. `sort_order`
groups options of the same param.

```sql
-- TTM: model (r2 default) + batch_size
INSERT INTO prediction_engine_parameter (prediction_engine_id, name, value, selected, sort_order)
SELECT pe.id, x.name, x.value, x.selected, x.sort_order
FROM prediction_engine pe,
(VALUES
  ('model','r1',false,0), ('model','r2',true,0),
  ('batch_size','4',false,1), ('batch_size','8',false,1),
  ('batch_size','16',true,1), ('batch_size','32',false,1)
) AS x(name, value, selected, sort_order)
WHERE pe.slug = 'ttm';

-- Toto 2.0: model size + precision
INSERT INTO prediction_engine_parameter (prediction_engine_id, name, value, selected, sort_order)
SELECT pe.id, x.name, x.value, x.selected, x.sort_order
FROM prediction_engine pe,
(VALUES
  ('model','toto-2.0-4m',false,0), ('model','toto-2.0-22m',false,0),
  ('model','toto-2.0-313m',true,0), ('model','toto-2.0-1b',false,0),
  ('model','toto-2.0-2.5b',false,0),
  ('precision','float32',true,1), ('precision','bfloat16',false,1), ('precision','float16',false,1)
) AS x(name, value, selected, sort_order)
WHERE pe.slug = 'toto2';

-- Chronos-2: model + precision
INSERT INTO prediction_engine_parameter (prediction_engine_id, name, value, selected, sort_order)
SELECT pe.id, x.name, x.value, x.selected, x.sort_order
FROM prediction_engine pe,
(VALUES
  ('model','chronos-2',true,0),
  ('precision','float32',true,1), ('precision','bfloat16',false,1), ('precision','float16',false,1)
) AS x(name, value, selected, sort_order)
WHERE pe.slug = 'chronos2';

-- TabPFN-TS: only batch_size is meaningful (model/precision are no-ops here)
INSERT INTO prediction_engine_parameter (prediction_engine_id, name, value, selected, sort_order)
SELECT pe.id, x.name, x.value, x.selected, x.sort_order
FROM prediction_engine pe,
(VALUES
  ('batch_size','4',false,0), ('batch_size','8',true,0),
  ('batch_size','16',false,0), ('batch_size','32',false,0)
) AS x(name, value, selected, sort_order)
WHERE pe.slug = 'tabpfn';
```

> The `model` values above are the short aliases each engine resolves
> (`ttm-r2`←`r2`, `Datadog/Toto-2.0-313m`←`toto-2.0-313m`, `amazon/chronos-2`←`chronos-2`).
> A gorm.ai lesson: TTM's DB row was `model=r2` but the alias map only had
> `ttm-r2`, so it resolved to the bogus `ibm-granite/r2` and 404'd. The shipped
> `ttm_engine.py` already includes the bare `r1`/`r2`/`r3` aliases, so `r2` works.

---

## 4. Easy-to-miss allow-lists / extras

- **Elasticity / pricing "ridge-capable engine" allow-list** (if you have one):
  add `toto2` (and any new slug) to it — gorm.ai got 422s on elasticity endpoints
  because `toto2` was missing from that `Literal`/enum.
- **`ChronosPipelineEngine._MODEL_PARAMS`**: the engine files add their own model→param-count
  entries for memory estimation; set the Chronos-2 count (`~120M` placeholder) to the real value.
- **Dependencies / conflicts** (`pyproject.toml` + `[tool.uv] conflicts`): TTM/FlowState
  need the `flowstate` extra (`transformers<4.51`); TabPFN needs `tabpfn`+`tabpfn-time-series`;
  Toto 2.0 needs `toto-models` on **Python 3.12**; Chronos-2 needs `chronos-forecasting>=2.2`.
  Run conflicting groups in **separate workers** (see handover §7).

---

## 5. Smoke test after wiring

```python
from crypto_ai.prediction.registry import EngineRegistry  # your registry
reg = EngineRegistry()
for slug in ("chronos2", "ttm", "tabpfn", "toto2"):
    eng = reg.get(slug)                     # however your registry looks engines up
    print(slug, "->", type(eng).__name__, eng.get_capabilities().name)
```
On a worker that has the package, this instantiates the real engine; on one that
doesn't, the engine is absent from the registry (import was skipped) — which is
the intended per-worker isolation.
