# Port: Validation-based early stopping + best-epoch restore for fine-tuning

This describes changes made in **crypto.ai** that should be duplicated into **gorm.ai**.
Both projects share the same fine-tuning code lineage (TimesFM + MOIRAI-2 runners,
`FinetuneService`, the `/finetune` request schema, and the AI-models fine-tune UI), so
these port across almost verbatim — only the symbol names (`crypto_ai` → `gorm_ai`,
"series" → "outlet") differ.

There are **two independent pieces**. Piece A is the new feature you asked about. Piece
B is a set of smaller fixes that are bundled in the same diff and are worth taking
regardless of whether you adopt Piece A.

---

## Piece A — Validation-set early stopping (the main feature)

### What it does
Fine-tuning previously only had "training-loss + patience" early stopping: it watched the
loss on the *same data it was training on* and stopped after N stale epochs. That metric
always improves on noisy series (it's measuring memorization), so it's a weak guard
against overfitting.

The new **"validation"** method holds out the **most-recent fraction** of the sliding
windows (configurable %, default 20%), never trains on them, runs the **full epoch
budget**, and keeps the epoch that scored best on that held-out slice.

The user chooses between the two methods in the UI:
- **"Training loss (patience)"** — the old behavior. Uses `early_stopping_patience`.
- **"Validation set (best epoch)"** — the new behavior. Uses `validation_split`.

### Backend — runner changes (TimesFM **and** MOIRAI-2 runners)

Files: `services/_finetune_timesfm.py`, `services/_finetune_moirai2.py`
(in gorm.ai these are the equivalent fine-tune runner modules).

1. **`_SlidingWindowDataset.from_windows(cls, windows)` classmethod** — builds a dataset
   from a pre-sliced window list so we can split into train/val without re-windowing:
   ```python
   @classmethod
   def from_windows(cls, windows):
       obj = cls.__new__(cls)
       obj.windows = windows
       return obj
   ```

2. **Extract a per-batch forward/loss helper and a no-grad eval helper.** The training
   loop's forward+loss body was lifted into a shared function so validation can reuse it:
   - TimesFM: `_forecast_batch(nn_module, ctx_batch, p, o, q, horizon)` and
     `_eval_avg_loss(nn_module, loader, p, o, q, horizon, device)`.
   - MOIRAI-2: `_batch_loss(nn_module, ctx_batch, tgt_batch, context_length, horizon, device)`
     and `_eval_avg_loss(nn_module, loader, context_length, horizon, device)`.
   `_eval_avg_loss` runs `nn_module.eval()` + `torch.no_grad()` and averages the loss over
   the loader.

3. **`_train_outlet(...)` gains two params:** `early_stopping_method: str = "training"`,
   `validation_split: float = 0.0`. Inside:
   ```python
   use_val = (early_stopping_method == "validation"
              and 0.0 < validation_split < 1.0
              and len(full) >= 2)
   if use_val:
       n_val = max(1, int(round(len(full) * validation_split)))
       n_val = min(n_val, len(full) - 1)          # always keep ≥1 training window
       train_ds = _SlidingWindowDataset.from_windows(full.windows[:-n_val])
       val_ds   = _SlidingWindowDataset.from_windows(full.windows[-n_val:])  # most recent
   else:
       train_ds, val_ds = full, None
   ```
   Build a `val_loader` (shuffle=False) when `val_ds` is not None.

4. **Monitor the right metric each epoch.** Each epoch computes `train_avg`; if a
   val_loader exists, also compute `val_avg = _eval_avg_loss(...)`. The **monitored**
   metric is `val_avg` when validating, else `train_avg`.

5. **Patience now applies to the training method only:**
   ```python
   if not use_val and patience > 0 and stale >= patience:
       break   # validation method runs the full epoch budget
   ```

### Backend — service plumbing

File: `services/finetune.py` (`FinetuneService`):
```python
early_stopping_method = request_data.get("early_stopping_method", "training")
validation_split      = request_data.get("validation_split", 0.0)
```
…and pass both into the runner call (`run_finetune(..., early_stopping_method=...,
validation_split=...)`). Both TimesFM and MOIRAI-2 `run_finetune` signatures gain the two
kwargs and forward them into `_train_outlet`. (MOIRAI-2's `run_finetune` also accepts
`sane_check_epochs`/`max_sane_loss` purely for call-signature parity — it doesn't apply
the TimesFM threshold.)

### Backend — request schema

File: route `FinetuneRequest` (and `schemas/fine_tune.py` if mirrored):
```python
early_stopping_method: str = "training"   # "training" | "validation"
validation_split: float = 0.0             # fraction held out when method == "validation"
```

### Frontend

- **`lib/api.ts`** — fine-tune request type gains `early_stopping_method?: string` and
  `validation_split?: number`.

- **AI-models fine-tune page** (`ai-models/page.tsx` in crypto.ai) — add an "Early Stopping
  Method" `<select>` with two options, and conditionally render the split-% field vs the
  patience field:
  ```tsx
  <select value={ftEarlyStoppingMethod} onChange={e => setFtEarlyStoppingMethod(e.target.value)}>
    <option value="training">{t("finetuneEarlyStoppingMethodTraining")}</option>
    <option value="validation">{t("finetuneEarlyStoppingMethodValidation")}</option>
  </select>
  {ftEarlyStoppingMethod === "validation"
    ? <FtNumberField label={t("finetuneValidationSplit")} ... value={ftValidationSplit} .../>
    : <FtNumberField label={t("finetuneEarlyStoppingPatience")} ... value={ftEarlyStoppingPatience} .../>}
  ```
  State persists to localStorage (`ftEarlyStoppingMethod`, `ftValidationSplit`). When the
  request is built, **force patience to 0 if method is "validation"**, and send
  `validation_split: ftValidationSplit / 100` (UI is a percent, API wants a fraction):
  ```ts
  early_stopping_method: method,
  early_stopping_patience: method === "validation" ? 0 : patience,
  validation_split: ftValidationSplit / 100,
  ```

- **`messages/en.json`** — six strings:
  - `finetuneEarlyStoppingMethod`: "Early Stopping Method"
  - `finetuneEarlyStoppingMethodInfo`: "How the best epoch is chosen. 'Training loss' watches the loss on the data being trained on and stops when it hasn't improved for the patience window. 'Validation set' holds out the most recent slice of the period, never trains on it, and keeps the epoch that scores best on that held-out data — a better guard against overfitting on noisy series."
  - `finetuneEarlyStoppingMethodTraining`: "Training loss (patience)"
  - `finetuneEarlyStoppingMethodValidation`: "Validation set (best epoch)"
  - `finetuneValidationSplit`: "Validation Split (%)"
  - `finetuneValidationSplitInfo`: "Percentage of the most recent bars in the fine-tune period held out as a validation set (never trained on). The run keeps the epoch with the best validation loss. Typical values: 10–20%."
  (Reword "bars"→"days"/"records" for gorm.ai's sales domain.)

---

## Piece B — Bundled fixes worth taking regardless ("the other changes")

These live in the same `_train_outlet` rewrite and fix real defects in the *existing*
training loop, independent of the validation feature:

1. **Best-epoch weight restore (bug fix).** The loop now tracks
   `best_state = copy.deepcopy(nn_module.state_dict())` whenever the monitored metric
   improves, and at the end does `nn_module.load_state_dict(best_state)`. Previously the
   saved checkpoint was **whatever epoch training happened to stop on** (often a worse,
   later epoch), not the best one. Applies to both training-loss and validation methods.

2. **Sane-check decoupled onto the training loss (TimesFM).** The pathological-series
   bail-out (`if epoch == sane_epochs and best_train > max_loss: restore snapshot; return`)
   now tracks `best_train` separately from the monitored metric, because the
   `max_sane_loss` threshold is tuned for the training-loss scale. Without this, turning on
   validation monitoring would silently break the sane-check. Keep this even if you only
   port the early-stopping skeleton.

3. **`nn_module.train()` moved inside the epoch loop.** Because validation now calls
   `.eval()` mid-run, training mode must be re-asserted at the top of each epoch.

---

## What to SKIP (crypto.ai-only — do NOT port to gorm.ai)

The same overall diff also contains crypto-specific work that has no place in gorm.ai:
- Training on **klines** (`coin_id` / `quote_asset` / `interval`) instead of customer
  sales; the kline-vs-sales branch in `FinetuneService`; per-(coin/pair/timeframe)
  checkpoint paths (`prediction/finetune_paths.py`, `configure_checkpoint`); the
  `fine_tunes` table's new `coin_id`/`quote_asset`/`interval` columns and migration.
- The "outlet" → "series" log/string renames.

gorm.ai keeps its customer/outlet sales targeting. Only Pieces A and B above cross over.
