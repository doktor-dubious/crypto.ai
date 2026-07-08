# FlowState → r1.1 update (patch note)

FlowState is a **model update**, not a new engine — crypto.ai almost certainly
already has a FlowState engine. This is the minimal change to move it to r1.1.
No new dependency: r1.1 is a HuggingFace **revision** of the same repo.

## What r1.1 is
- Same repo: `ibm-granite/granite-timeseries-flowstate-r1`
- Revision `r1.1` = 18.5M params, 4096 context, output gating on the S5 encoder
  (better on noisier series). The `main` branch still holds the **original r1**
  (9M params, 2048 context).

## The change
In your FlowState engine, load the model at revision `r1.1` instead of `main`:

```python
# module constants
DEFAULT_MODEL_ID = "ibm-granite/granite-timeseries-flowstate-r1"
DEFAULT_REVISION = "r1.1"          # <-- the update (was "main")

# __init__
self._revision = DEFAULT_REVISION

# _load_model — pass the revision through:
self._model = FlowStateForPrediction.from_pretrained(
    self._model_id, revision=self._revision,
)
```

Make it configurable via `apply_parameters` (consistent with the other engines):

```python
def apply_parameters(self, params: dict[str, str]) -> None:
    model_value = params.get("model") or params.get("submodel")
    if model_value:
        self._model_id = self._resolve_model_id(model_value)
    if "revision" in params:
        self._revision = params["revision"]     # "r1.1" | "main" (original r1)
    if "batch_size" in params:
        self._batch_size = int(params["batch_size"])
    if "scale_factor" in params:
        self._scale_factor = float(params["scale_factor"])
```

## Don't forget `scale_factor`
FlowState's single most important parameter — `scale_factor = 24 / N`, where N is
the number of timesteps per repeating cycle. Set it to your data's cadence or
results degrade badly:
- 15-min: 0.25 · hourly: 1.0 · **daily w/ weekly seasonality: 24/7 ≈ 3.43** · monthly: 2.0
- For crypto: match it to your kline interval and the dominant cycle you expect
  (e.g. hourly klines with a daily cycle → 24/24 = 1.0).

## DB param rows (if engine list is DB-driven)
Seed rows for the `flowstate` engine: `revision` (`r1.1` selected, `main` as the
original-r1 option), `batch_size` options, and a `scale_factor` row matching your
data. Output is 9 quantiles directly — no `samples` parameter.

## Verify
Watch the load log confirms `revision: r1.1` and the param count (~18.5M), not the
9M original. Then backtest a few series vs the previous revision.
