"""Quick iterative test for AutoGluonEngine._run_autogluon_batch."""
import sys
from datetime import date, timedelta

# Minimal historical data: 60 days ending 2026-03-08
start = date(2026, 1, 8)
hist_data = [
    {"date": start + timedelta(days=i), "value": float(10 + (i % 7) + (i % 3))}
    for i in range(60)
]

prediction_from = date(2026, 3, 9)
horizon = 7

# --- Test 1: no covariates ---
print("=== Test 1: no covariates ===")
try:
    from crypto_ai.prediction.engines.autogluon_engine import AutoGluonEngine
    engine = AutoGluonEngine()
    items = [{"historical_data": hist_data, "covariates": None, "pad_dates": None}]
    result = engine._run_autogluon_batch(items, horizon, prediction_from, 0.25, 7)
    print(f"  OK — {len(result[0])} results")
    for r in result[0]:
        print(f"    {r.date}  mean={r.predicted_value:.2f}  [{r.lower_bound:.2f}, {r.upper_bound:.2f}]")
except Exception as e:
    print(f"  FAIL: {e}")
    import traceback; traceback.print_exc()
    sys.exit(1)

# --- Test 2: with financial covariates ---
print("\n=== Test 2: with financial covariates ===")
try:
    covariates: dict = {
        "profit_per_unit": {prediction_from + timedelta(days=i): 5.0 for i in range(horizon)},
        "cost_per_unit": {prediction_from + timedelta(days=i): 2.0 for i in range(horizon)},
    }
    items2 = [{"historical_data": hist_data, "covariates": covariates, "pad_dates": None}]
    result2 = engine._run_autogluon_batch(items2, horizon, prediction_from, 0.25, 7)
    print(f"  OK — {len(result2[0])} results")
    for r in result2[0]:
        print(f"    {r.date}  mean={r.predicted_value:.2f}  eo={r.economic_optimal}")
except Exception as e:
    print(f"  FAIL: {e}")
    import traceback; traceback.print_exc()
    sys.exit(1)

# --- Test 3: two items batched ---
print("\n=== Test 3: two items batched ===")
try:
    items3 = [
        {"historical_data": hist_data, "covariates": None, "pad_dates": None},
        {"historical_data": hist_data, "covariates": None, "pad_dates": None},
    ]
    result3 = engine._run_autogluon_batch(items3, horizon, prediction_from, 0.25, 7)
    print(f"  OK — item0: {len(result3[0])} results, item1: {len(result3[1])} results")
except Exception as e:
    print(f"  FAIL: {e}")
    import traceback; traceback.print_exc()
    sys.exit(1)

print("\nAll tests passed!")
