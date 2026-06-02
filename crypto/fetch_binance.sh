#!/usr/bin/env bash
# Fetch Binance public kline archives, verify checksums, unzip.
#
# Usage:
#   ./fetch_binance.sh SYMBOL INTERVAL START_YYYY-MM END_YYYY-MM [OUTDIR]
# Examples:
#   ./fetch_binance.sh BTCUSDT 1h 2025-06 2026-05            # a year of hourly
#   ./fetch_binance.sh ETHUSDT 5m 2026-01 2026-05 ./eth5m
#
# Pulls MONTHLY archives. Skips files already present. Verifies SHA256.
set -euo pipefail

SYMBOL="${1:?symbol e.g. BTCUSDT}"
INTERVAL="${2:?interval e.g. 1h}"
START="${3:?start YYYY-MM}"
END="${4:?end YYYY-MM}"
OUTDIR="${5:-./${SYMBOL}-${INTERVAL}}"
BASE="https://data.binance.vision/data/spot/monthly/klines/${SYMBOL}/${INTERVAL}"

mkdir -p "$OUTDIR"
cd "$OUTDIR"

# iterate months from START to END inclusive
y=${START%-*}; m=${START#*-}; m=$((10#$m))
ey=${END%-*};  em=${END#*-};  em=$((10#$em))
while [ $((y*12 + m)) -le $((ey*12 + em)) ]; do
  mm=$(printf '%02d' "$m")
  f="${SYMBOL}-${INTERVAL}-${y}-${mm}.zip"
  if [ ! -f "$f" ]; then
    echo "↓ $f"
    curl -sSfL -o "$f" "${BASE}/${f}" || { echo "  (missing on server, skipping)"; rm -f "$f"; }
    if [ -f "$f" ]; then
      curl -sSfL -o "$f.CHECKSUM" "${BASE}/${f}.CHECKSUM"
      sha256sum -c "$f.CHECKSUM" >/dev/null && echo "  ✓ checksum ok" || { echo "  ✗ CHECKSUM FAILED"; exit 1; }
      unzip -oq "$f"
    fi
  fi
  m=$((m+1)); if [ $m -gt 12 ]; then m=1; y=$((y+1)); fi
done
echo "Done. CSVs in $(pwd)"
