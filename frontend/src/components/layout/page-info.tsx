"use client"

// Per-page documentation shown in the topbar's info drawer. A page has the
// info icon only if its route is registered here — add an entry to give a
// page its "what is this, why does it exist, how do I configure it" text.

import type { ReactNode } from "react"

// Local typographic helpers so entries read consistently.
function H({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-semibold mt-5 mb-1.5 first:mt-0">{children}</h3>
}
function P({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-[var(--muted-foreground)] mb-2">{children}</p>
}
function Term({ children }: { children: ReactNode }) {
  return <span className="font-medium text-[var(--foreground)]">{children}</span>
}
function LI({ term, children }: { term: string; children: ReactNode }) {
  return (
    <li className="text-xs leading-relaxed text-[var(--muted-foreground)]">
      <Term>{term}</Term> — {children}
    </li>
  )
}
function UL({ children }: { children: ReactNode }) {
  return <ul className="list-disc pl-5 space-y-1.5 mb-2">{children}</ul>
}

export interface PageInfo {
  title: string
  description: string
  content: ReactNode
}

// ── Shared fragments for the scalping pages (same engine, same discipline) ──

function ScalpMechanics() {
  return (
    <>
      <H>Trade mechanics (shared engine)</H>
      <P>
        All scalping pages run on the same backtest engine as Trend Swings: entries are <Term>non-overlapping</Term> (one
        position at a time; signals during an open trade are ignored — the shaded chart bands show these windows), and every
        trade exits by the first of stop loss, take profit, or the <Term>Hold max</Term> bar cap.
      </P>
      <UL>
        <LI term="Stop loss">Fixed % · ATR× (k × 14-bar average true range — volatility-adaptive) · Swing structure (beyond the prior 12-bar extreme) · Trailing ATR× (ratchets behind the best close). Intra-bar touches fill at the level; if a stop and a target could both fill within one bar, the stop wins (conservative — the intra-bar path is unknowable from OHLC).</LI>
        <LI term="Take profit">Fixed % · Resistance (prior 12-bar extreme) · Mean touch (revert to the 20-bar average) · Opposite signal (hold until the strategy fires the other way).</LI>
        <LI term="Fees">charged per round trip. Scalping edges are measured in single bps — futures maker (~4 bps) is the only realistic venue; spot taker (~20 bps) is shown as the pessimistic bound.</LI>
        <LI term="Side">long, short, or both. The fee model is symmetric; funding/borrow costs of real shorts are not modeled, so short results are optimistic by that amount.</LI>
        <LI term="Vol regime gate">optionally restrict entries to calm or expanding volatility (14-bar ATR vs its trailing 200-bar median). This is the researched pairing: ranges hold in calm regimes, breakouts continue in expansions — often worth more than any strategy knob.</LI>
      </UL>
    </>
  )
}

function ScalpHonesty() {
  return (
    <>
      <H>Reading the results honestly</H>
      <UL>
        <LI term="Segment cards">Full range / First half / Second half. Any knob you tune is tuned on data you can see — only a setting that also holds on the untouched second half deserves belief; the banner calls the verdict.</LI>
        <LI term="t-statistic">significance of the per-trade edge; below ~2 is indistinguishable from luck. Scalps trade often, so a real edge should reach significance quickly — if hundreds of trades still show t below 1, the edge isn&apos;t there.</LI>
        <LI term="Charts">equity vs buy-and-hold on the same bars; the entry-signal chart shows the per-bar scores against your threshold line. Individual trade markers are skipped above ~300 trades to keep the browser responsive.</LI>
      </UL>
    </>
  )
}

export const PAGE_INFO: Record<string, PageInfo> = {
  "/trading/strategies/trend-swings": {
    title: "Trend Swings",
    description: "Explore whether local trend reversals (crests and troughs) can be detected and traded from raw market data.",
    content: (
      <div>
        <H>What this page is</H>
        <P>
          A research tool for one specific trading idea: <Term>local trend reversals — swing tops and bottoms — leave measurable
          fingerprints in market microstructure, and those fingerprints might be tradeable</Term>. Everything here is computed
          directly from stored klines (price, volume, trade counts, taker flow) for the coin, pair, timeframe and date range you
          select at the top. No AI model or simulation is involved, with one optional exception described under Model confirmation.
        </P>

        <H>The idea behind it</H>
        <P>
          Empirical analysis of this project&apos;s own kline history (BTC/ETH, 5m–1d, 2017–2026) found that swing points are not
          quiet turning points — they are <Term>climactic</Term>. The turn bar typically prints 1.4–1.6× normal volume and 1.3–1.5×
          normal range, trade counts swell 2–3 bars ahead, wicks accumulate on the far side of the move in the final bars, and
          aggressive (taker) flow tilts toward the crowd right before it flips. Bottoms signal more strongly than tops — capitulation
          is louder than euphoria. Separately, the one directional effect proven at bar level is streak reversion: after 4+
          same-direction closes, the odds the next bar reverses rise to ~55–60%.
        </P>
        <P>
          This page combines those signatures into a single per-bar <Term>composite score</Term> per direction (one for bottoms
          → long entries, one for tops → short entries) and backtests trading it, with realistic fees and honest statistics.
        </P>

        <H>The composite signal</H>
        <P>
          Eight continuous components are each converted to a z-score against their own trailing history (so they are comparable
          and regime-adaptive), made direction-aware, and averaged with equal weights. Three binary flags add a +0.25 bonus each
          when firing. A trade is entered when the composite reaches the <Term>Signal threshold (σ)</Term>.
        </P>
        <UL>
          <LI term="Streak state">consecutive same-direction closes — the proven mean-reversion signal.</LI>
          <LI term="Volume / Range spikes">bar volume and candle range vs their trailing medians — the climax detector.</LI>
          <LI term="Participation / Avg trade size">trade count swell and small-order panic vs large-order absorption.</LI>
          <LI term="Wick pressure">wicks accumulating against the move over the last 6 bars — one of the few leading signatures.</LI>
          <LI term="Taker tilt">aggressive buy vs sell flow.</LI>
          <LI term="Stretch (z20)">distance from the 20-bar mean — overstretched tends to snap back.</LI>
          <LI term="Flags">sweep (failed breakout / stop-hunt print), volume divergence (advance on dwindling volume — the strongest confirmed conditioner), deceleration (shrinking gains into the turn).</LI>
        </UL>
        <P>
          Each component can be <Term>toggled off</Term> (removed from the average) or <Term>re-weighted</Term> via its % box
          (100% = equal weight, 200% = double contribution, 0% = muted but still diluting). The &quot;Signal contribution at
          entry&quot; strip shows what each component was saying, on average, at the bars actually traded — the fastest way to see
          which signals drive your current setup. One built-in protection: a top signal occurring on &gt;2σ stretch with &gt;2×
          volume is <Term>vetoed</Term>, because high-volume breakouts continue rather than reverse (measured at +20–26 bps over
          6 bars) — fading them is the classic range-trader&apos;s mistake.
        </P>

        <H>Trade mechanics</H>
        <UL>
          <LI term="Entries">non-overlapping — one position at a time; new signals during an open trade are ignored (the shaded bands on the charts show these windows).</LI>
          <LI term="Hold max (bars)">the time-stop backstop; every trade exits here at the latest.</LI>
          <LI term="Stop loss">Fixed % · ATR× (volatility-adaptive, k × 14-bar average true range) · Swing structure (beyond the prior 12-bar extreme = thesis invalidated) · Trailing ATR× (ratchets behind the best close). Intra-bar touches fill at the level; if a stop and target could both fill in one bar, the stop wins (conservative).</LI>
          <LI term="Take profit">Fixed % · Resistance (prior 12-bar extreme) · Mean touch (revert to the 20-bar average — the natural target for entries that are by construction stretched away from it) · Opposite signal (hold until the composite detects the next reversal).</LI>
          <LI term="Fees">charged per round trip. The measured swing edges are a few bps per trade — they die at spot taker fees and only live at futures maker fees, which is why maker is the default preset.</LI>
          <LI term="Side">bottoms (long), tops (short), or both. Shorts use symmetric fees but funding/borrow costs are not modeled.</LI>
        </UL>

        <H>Model confirmation (optional)</H>
        <P>
          The one place an AI model can participate: select a completed simulation of the same coin/pair/timeframe in the picker,
          tick <Term>Require model confirmation</Term>, and entries additionally need the model&apos;s stored next-bar P(up) to
          agree with the trade direction. Comparing results with and without measures whether the forecast adds anything beyond
          the raw signals.
        </P>

        <H>Reading the results honestly</H>
        <UL>
          <LI term="Segment cards">Full range / First half / Second half. The half split is the built-in overfitting check: any knob setting you tune is tuned on the data you can see, so only a setting that also works on the untouched second half deserves belief. The banner calls the verdict.</LI>
          <LI term="t-statistic">significance of the per-trade edge. Below ~2 is indistinguishable from luck; a single spectacular trade shows t=— because one anecdote is not evidence.</LI>
          <LI term="Auto-optimize">sweeps ~650 curated knob combinations, tunes on the first half only, and ranks winners with their untouched second-half stats alongside — judge by the validation column, never the train column. Even validation is picked-over across 650 tries: confirm on other coins and periods before trusting a setting. Per-signal weights are deliberately not swept (an 11-dimensional continuous space returns noise dressed as genius).</LI>
          <LI term="Equity chart">strategy vs buy-and-hold on the same bars; entry lines and hold bands are colour-coded by outcome (green won / red lost — not direction; dashed = short). On ranges with more than ~300 trades the individual markers are skipped to keep the browser responsive.</LI>
          <LI term="Composite signal chart">the raw long/short composite per bar with your threshold line — hover for exact values, tick components to overlay their individual contributions.</LI>
        </UL>

        <H>Practical workflow</H>
        <P>
          1) Pick a scope — 15m–1h timeframes carry the strongest measured signatures; the default range is the last 12 months.
          2) Start from defaults and watch the segment cards, not the equity curve. 3) Use the contribution strip and component
          toggles to understand what drives entries. 4) Let Auto-optimize map the space, then stress the survivors: other halves,
          other coins, other periods. 5) Expect small numbers — the honest bar is a few bps per trade net of maker fees, held up
          out-of-sample. A setting that clears that consistently is the trigger for the next phase: feeding these signals to a
          forecasting model as covariates.
        </P>
      </div>
    ),
  },

  "/trading/strategies/scalping/range": {
    title: "Range Scalping",
    description: "Fade the edges of a tight price channel — buy support, sell resistance — only while the market is genuinely ranging.",
    content: (
      <div>
        <H>What this page is</H>
        <P>
          A backtest explorer for the oldest scalping playbook: when price is stuck in a sideways channel, buy near the bottom,
          sell near the top, and take the small oscillation in the middle. Everything is computed from stored klines for the
          scope you pick at the top — no AI model involved.
        </P>

        <H>The idea behind it</H>
        <P>
          Markets spend much of their time consolidating, and inside a consolidation the channel edges act as soft support and
          resistance: sellers thin out near the bottom, buyers thin out near the top, and price mean-reverts across the range.
          The entire craft is knowing <Term>when the market is actually ranging</Term> — the same edge-fade that pays in a calm
          channel is exactly the wrong trade in a trend, where the &quot;edge&quot; is just the trend passing through. That is why
          the regime gate below matters more than any other knob, and why the natural pairing (a future step) is this project&apos;s
          volatility forecast: ranges hold in calm regimes and break in violent ones.
        </P>

        <H>The signal and its knobs</H>
        <UL>
          <LI term="Channel window (bars)">the range = highest high / lowest low of the previous N bars (the current bar never defines its own support/resistance).</LI>
          <LI term="Edge band (%)">the entry zone at each channel edge, as a share of channel height — 15% means only the outer 15% slices trade.</LI>
          <LI term="Max channel width (%)">the regime gate: only channels narrower than this (height as % of price) count as ranges at all. Raise it on volatile coins/timeframes, lower it to be stricter — this single knob decides whether you are range-trading or trend-fading.</LI>
          <LI term="Edge depth (threshold)">how deep into the edge band price must push before entering; 1.0 = exactly at the band boundary, higher = closer to the absolute extreme (fewer, better-priced entries).</LI>
        </UL>
        <P>
          Natural exit pairings: <Term>Mean touch</Term> take-profit ≈ selling back at the range midpoint, and the
          <Term> Swing structure</Term> stop ≈ getting out when the channel actually breaks.
        </P>

        <ScalpMechanics />
        <ScalpHonesty />

        <H>What to expect</H>
        <P>
          Fair warning from this project&apos;s own measurements: on BTC 15m over a recent year, the raw edge-fade lost about
          −4.7 bps per trade at maker fees (t = −3.8 — significantly negative). That matches the market-structure reality that
          crypto intraday reversals are climactic rather than gentle. The interesting experiments are the gates: tighten max
          width, demand deeper edge pushes, restrict to calm periods — and treat anything that only works on one half of the
          data as curve-fit.
        </P>
      </div>
    ),
  },

  "/trading/strategies/scalping/momentum": {
    title: "Momentum / Breakout Scalping",
    description: "Trade WITH a channel breakout when a volume spike confirms it — ride the burst, exit fast.",
    content: (
      <div>
        <H>What this page is</H>
        <P>
          A backtest explorer for breakout scalping: when price closes beyond its recent extreme <Term>and volume confirms the
          move</Term>, join it — long above the channel, short below — and let tight exits do the risk work. Computed from
          stored klines for the selected scope; no AI model involved.
        </P>

        <H>The idea behind it</H>
        <P>
          This is the tradeable mirror of the strongest regime finding in this project&apos;s research: price stretched more than
          2σ above its mean <Term>on 2× volume keeps going</Term> — measured at +20–26 bps over the next 6 bars on BTC/ETH 1h —
          while the same stretch on quiet volume reverts. A genuine breakout is participation arriving; a fake one is price
          drifting into thin air. Volume is the tell, which is why the threshold here is a <Term>volume z-score</Term>, not a
          price level. (The swing explorer treats exactly this situation as its &quot;breakout veto&quot; — the setup it refuses
          to fade is the one this page trades.)
        </P>

        <H>The signal and its knobs</H>
        <UL>
          <LI term="Channel window (bars)">a breakout = the close exceeding the highest high (or lowest low) of the previous N bars. Shorter windows fire often on noise; longer ones catch only significant levels.</LI>
          <LI term="Volume spike (threshold, σ)">required volume z-score on the breakout bar, versus its own trailing distribution. 2σ matches the researched continuation effect; raising it trades quality for frequency.</LI>
        </UL>
        <P>
          Exits matter more than entries here: bursts exhaust quickly, so start with short holds (3–6 bars) and consider the
          <Term> Trailing ATR×</Term> stop — it converts a runner into locked-in profit and cuts the failed breakouts fast.
          A <Term>Fixed %</Term> stop just beyond the broken level is the classic alternative (the level should now be support).
        </P>

        <ScalpMechanics />
        <ScalpHonesty />

        <H>What to expect</H>
        <P>
          In this project&apos;s first measurements (BTC 15m, one year, maker fees) this was the <Term>only scalping strategy
          at breakeven-or-better out of the box</Term> (+0.7 bps/trade raw, before any tuning) — consistent with the research
          that volume-confirmed continuation is real. That makes it the one worth tuning seriously: window, spike threshold, and
          exit discipline — and later, gating by the volatility-expansion forecast, which is this strategy&apos;s natural partner.
        </P>
      </div>
    ),
  },

  "/trading/strategies/scalping/indicator": {
    title: "Indicator Scalping",
    description: "Classic technical-indicator triggers — EMA cross, RSI, Bollinger, VWAP — measured honestly, net of fees.",
    content: (
      <div>
        <H>What this page is</H>
        <P>
          A backtest explorer for the textbook indicator strategies every trading course teaches. Pick an indicator, set its
          parameters, and see what the rule actually earns on real klines net of fees — with the same honest statistics as every
          other page in this section. No AI model involved.
        </P>

        <H>The idea behind it — and the warning</H>
        <P>
          The published evidence, and this project&apos;s own prior, is blunt: <Term>raw indicator rules net of fees are
          approximately break-even minus costs</Term>. Indicators are deterministic transforms of price that everyone can see;
          whatever edge they once carried has been arbitraged to the fee boundary. This page exists to quantify that baseline
          honestly rather than assume it — and because indicators still have two legitimate uses: as <Term>features</Term> inside
          a learned model, and as <Term>triggers gated by a regime filter</Term> (e.g. only trade RSI reversion in calm-volatility
          periods). Measuring the raw rule is step one of both.
        </P>

        <H>The indicators and their knobs</H>
        <UL>
          <LI term="EMA cross">long when the fast exponential moving average crosses above the slow one, short on the cross down. Binary events — any threshold ≤ 1 takes every cross. Knobs: fast/slow spans.</LI>
          <LI term="RSI (30/70)">mean-reversion: long when Wilder&apos;s RSI drops below 30 (oversold), short above 70. The threshold adds required depth beyond the classic levels (+1 ≈ 10 RSI points deeper). Knob: period.</LI>
          <LI term="Bollinger touch">long when price touches the lower band (SMA − 2σ), short at the upper. Threshold = how many σ beyond the band. Knob: band period.</LI>
          <LI term="VWAP deviation">crypto trades 24/7, so there is no session VWAP — this uses a rolling volume-weighted average price. Long below it, short above; threshold = deviation in σ of price. Knob: window.</LI>
        </UL>
        <P>
          All four are normalised to σ-like scores so the threshold slider means the same thing across indicators, and every
          computation is trailing-only (no lookahead).
        </P>

        <ScalpMechanics />
        <ScalpHonesty />

        <H>What to expect</H>
        <P>
          First measurements on BTC 15m over a year at maker fees: EMA cross −6.4 bps/trade, RSI −5.0, VWAP −4.2, Bollinger
          −2.4 — every one negative, several significantly so. That is the textbook result, not a bug. If you find a
          configuration that survives both halves and other coins, be doubly suspicious before believing it — and if it
          holds anyway, its real destiny is as a covariate for the forecasting models, not as a standalone system.
        </P>
      </div>
    ),
  },
}

PAGE_INFO["/trading/strategies/scalping/streak-reversion"] = {
  title: "Streak-Reversion Scalping",
  description: "Fade runs of consecutive same-direction closes — the one directional effect statistically proven in this project's data.",
  content: (
    <div>
      <H>What this page is</H>
      <P>
        A backtest explorer for the simplest strategy in this section: when price has closed the same direction several bars in
        a row, bet on the next bar reversing. Computed from stored klines for the selected scope; no AI model involved.
      </P>

      <H>The idea behind it</H>
      <P>
        This is the empirical anchor of the whole Trading section. Measured on this project&apos;s own history (BTC/ETH,
        5m–1h, 2017–2026): after k consecutive same-direction closes, the probability the next bar reverses rises
        <Term> monotonically</Term> — roughly 52% after 2 bars, 55–57% after 4, up to ~60% after 6 — in both directions
        (exhausted buyers get sold, exhausted sellers get bought), with overwhelming statistical significance (z ≈ 17 on 900k
        bars). The human story: each additional bar in a run makes more holders willing to take profits or capitulate. The
        catch, measured just as clearly: the <Term>gross edge is only 2–8 bps per bar</Term> — real, but at or below round-trip
        costs, which is precisely why it still exists. Fees, exits, and conditioning decide whether any of it is capturable.
      </P>

      <H>The signal and its knobs</H>
      <UL>
        <LI term="Streak length (threshold)">required run length before fading. Longer runs revert more reliably but occur exponentially less often — 3–4 is the researched sweet spot.</LI>
        <LI term="Volume divergence">optionally require the run to be advancing on falling volume (3rd bar lighter than the 1st). In the research this roughly DOUBLED the fade edge on every dataset tested — the single best conditioner found.</LI>
      </UL>
      <P>
        The measured effect is strongest on the <Term>very next bar</Term>, so short holds (start at Hold max 1–3) preserve it
        best; long holds dilute a one-bar edge with random drift.
      </P>

      <ScalpMechanics />
      <ScalpHonesty />

      <H>What to expect</H>
      <P>
        The brutal arithmetic: ~2–8 bps gross per trade versus ~4 bps round-trip maker fees. Expect results near zero, sign
        decided by your knobs — that is the honest state of this edge, and why its likely destiny is as a component inside a
        larger system (it is already the &quot;streak state&quot; signal in Trend Swings and a baseline model in simulations)
        rather than a standalone money-printer. If a configuration holds green in both halves at maker fees, that is genuinely
        noteworthy.
      </P>
    </div>
  ),
}

PAGE_INFO["/trading/strategies/scalping/sweep"] = {
  title: "Sweep / Failed-Breakout Scalping",
  description: "Fade the stop-hunt: price sweeps beyond a recent extreme, fails to hold, and closes back inside the range.",
  content: (
    <div>
      <H>What this page is</H>
      <P>
        A backtest explorer for the liquidity-sweep fade: when a bar trades beyond the prior N-bar extreme intra-bar but
        <Term> closes back inside</Term>, the breakout has failed — and the failure itself is the signal. Computed from stored
        klines for the selected scope; no AI model involved.
      </P>

      <H>The idea behind it</H>
      <P>
        Stops and breakout orders cluster just beyond obvious highs and lows. A push through the level fills them — the sweep —
        and if there is no real participation behind the move, price gets rejected straight back into the range, leaving the
        classic long-wicked reversal print. Crypto perpetuals, with their visible levels and leveraged crowds, are notoriously
        prone to this pattern. It also complements the Momentum page perfectly: a breakout that <Term>closes beyond</Term> the
        level on volume is momentum&apos;s trade, while one that <Term>closes back inside</Term> is this page&apos;s. The same
        pattern already contributes to Trend Swings as the &quot;sweep&quot; flag; here it stands alone with its own knobs.
      </P>

      <H>The signal and its knobs</H>
      <UL>
        <LI term="Extreme window (bars)">the swept level = highest high / lowest low of the previous N bars. 12 matches the researched swing flag; longer windows mean more significant levels, swept less often.</LI>
        <LI term="Sweep depth (threshold, ATR)">how far beyond the level the sweep must reach, in 14-bar ATRs. 0 counts any poke through; deeper sweeps mean more stops harvested and typically sharper rejections.</LI>
      </UL>
      <P>
        Natural exit pairing: a <Term>Fixed %</Term> or <Term>ATR×</Term> stop just beyond the sweep&apos;s own extreme — if
        price takes that out too, the &quot;failed&quot; breakout was real after all and the fade thesis is dead.
      </P>

      <ScalpMechanics />
      <ScalpHonesty />

      <H>What to expect</H>
      <P>
        First measurement (BTC 15m, one year, maker fees, default knobs): about −4.9 bps per trade — the raw pattern does not
        pay by itself at these settings. The interesting experiments are depth (demand ≥ 0.3–0.5 ATR beyond the level), longer
        extreme windows (more meaningful levels), the calm-vol regime gate (sweeps inside quiet ranges vs trend continuation),
        and short holds. As always: both halves green or it doesn&apos;t count.
      </P>
    </div>
  ),
}

PAGE_INFO["/trading/strategies/scalping/taker-flow"] = {
  title: "Taker-Flow Scalping",
  description: "Trade sustained aggressive order-flow imbalance — the closest thing to order-book analysis available from stored klines.",
  content: (
    <div>
      <H>What this page is</H>
      <P>
        A backtest explorer built on a column most platforms ignore: every stored kline records how much of its volume came from
        <Term> takers buying</Term> (market orders lifting the ask) versus takers selling. That ratio says who was impatient —
        who crossed the spread — bar by bar. This page trades sustained imbalances in that flow. No AI model involved.
      </P>

      <H>The idea behind it</H>
      <P>
        Aggressive flow is informed flow, sometimes: a sustained run of taker buying can mark genuine accumulation
        (<Term>ride it</Term> — the momentum reading), or a crowd chasing a move that is about to run out of fuel
        (<Term>fade it</Term> — the exhaustion reading). This project&apos;s swing research saw the second pattern clearly at
        turning points: taker-buy dominance builds into tops and flips to net selling on the bar right after, mirrored at
        bottoms. Which reading wins likely depends on the window — short bursts lean momentum, long lopsided campaigns lean
        exhaustion — and that is exactly what the Direction knob lets you test. Both modes use the same signal: the rolling
        taker-buy imbalance, z-scored against its own trailing distribution.
      </P>

      <H>The signal and its knobs</H>
      <UL>
        <LI term="Flow window (bars)">how many bars the imbalance is averaged over. Short = reactive to single-bar bursts; long = only sustained campaigns register.</LI>
        <LI term="Direction">With the flow (momentum) or Fade the flow (exhaustion). The swing evidence argues for fade on longer windows; the momentum reading is the null hypothesis worth checking first.</LI>
        <LI term="Imbalance (threshold, σ)">required z-score of the imbalance — higher trades only the most lopsided episodes.</LI>
      </UL>

      <ScalpMechanics />
      <ScalpHonesty />

      <H>What to expect</H>
      <P>
        First measurements (BTC 15m, one year, maker fees, defaults): with-the-flow −5.2 bps/trade, fade −2.8 bps — both
        negative raw, with fade the better half, consistent with the exhaustion reading. This is the most unexplored signal in
        the project (prior research only established that taker imbalance does not predict the <Term>next single bar</Term> —
        sustained multi-bar campaigns were never tested), so treat this page as an open research question rather than a
        near-miss strategy. Window × direction × vol-gate is the grid worth mapping.
      </P>
    </div>
  ),
}

PAGE_INFO["/simulations/completed"] = {
  title: "Completed Simulations — and the Backtest tab",
  description: "Every walk-forward simulation run, ranked by parameter-free skill scores; the Backtest tab turns a run's stored forecasts into a simulated trading strategy.",
  content: (
    <div>
      <H>What this page is</H>
      <P>
        The master table lists every walk-forward simulation: for each bar of the chosen range, the model forecast one step
        ahead using only prior data, and each forecast was scored against what actually happened. The <Term>Score</Term> column
        is the directional return IC (rank correlation of predicted vs realized moves — parameter-free price skill),
        <Term> Sig</Term> is its t-statistic (sort by it when screening many runs; under pure chance across ~1000 runs the
        maximum reaches ~3.5, so ≥4 marks genuine candidates), and <Term>Vol</Term> is the volatility-forecast correlation for
        runs that had &quot;Forecast volatility&quot; on. Selecting a run opens the detail tabs; the rest of this text covers the
        <Term> Backtest</Term> tab, where forecasts become simulated trades.
      </P>

      <H>Backtest tab — the idea</H>
      <P>
        A forecast is only worth money if a trading rule built on it survives fees. This tab replays the run bar by bar: the
        model&apos;s quantile forecast is converted into <Term>P(up)</Term> — the modeled probability that the bar closes above
        the previous close (read off the quantile ladder, so it needs a model that produces quantiles) — and the strategy goes
        <Term> long for one bar</Term> whenever P(up) clears your confidence threshold. Fees are charged per side, and only when
        the position actually changes, so consecutive long bars aren&apos;t double-charged. Buy &amp; hold over the same bars
        (one round trip) is the baseline to beat.
      </P>

      <H>Entry filters</H>
      <UL>
        <LI term="Confidence threshold">go long only when P(up) ≥ this. Higher = fewer, higher-conviction trades.</LI>
        <LI term="Min predicted move (%)">the point forecast must also clear the previous close by this margin — filters bars whose predicted edge is too small to matter.</LI>
        <LI term="Only trade when forecast covers fees">adds the round-trip fee on top of the minimum move, so a trade is only taken when its expected gross edge can pay for entering and exiting. The effective requirement is shown inline.</LI>
        <LI term="Allow short positions">the symmetric down-signal: short when P(up) ≤ 1 − threshold. Commission is symmetric, but funding/borrow costs of real shorts are NOT modeled — short results are optimistic by that amount.</LI>
      </UL>

      <H>Volatility strategies and position sizing</H>
      <UL>
        <LI term="Vol-targeting">sizes each long inversely to predicted volatility — full size on calm bars, scaled down on violent ones.</LI>
        <LI term="Vol-breakout">only trades when predicted volatility exceeds its 20-bar trailing average (a volatility expansion).</LI>
        <LI term="Vol source badge">these use the run&apos;s genuine one-step volatility forecast when it was created with &quot;Forecast volatility&quot;; otherwise they fall back to the predicted band width (P90 − P10) as a proxy — the badge tells you which is in effect. Not applicable to Kline (up/down) runs, which produce no bands.</LI>
        <LI term="Conviction-weighted">position size scales with how far P(up) clears the threshold.</LI>
        <LI term="Pyramiding-on-streak">starts small and adds over consecutive signal bars, reaching full size after N bars. Every size change is a real fill that pays a fee — the Fills metric (vs Trades) shows exactly where that drag lands.</LI>
      </UL>

      <H>Reading the metrics</H>
      <UL>
        <LI term="Trades vs Fills">a trade is one in-market campaign (entry → exit); fills are the individual orders. Scaling strategies produce more fills per trade — that difference is their extra fee cost.</LI>
        <LI term="Sharpe (annualized)">mean per-bar return ÷ its volatility, scaled to a year. Above 1 is good; below 0 is losing.</LI>
        <LI term="Equity curve">strategy (green) vs buy &amp; hold (grey), compounded bar by bar after fees; vertical markers are trade entries coloured by outcome (toggle with the flag icon).</LI>
      </UL>

      <H>Reading it honestly</H>
      <P>
        The backtest is <Term>knob-dependent</Term>: the same forecasts can look great or poor depending on threshold and fee
        settings, so treat the Score/Sig columns as the primary instrument (parameter-free, upstream) and the backtest as the
        translation into money terms. Two fair uses: comparing runs <Term>at identical knobs</Term> (e.g. a covariate run vs its
        plain twin), and checking whether a promising IC survives realistic fees. One unfair use: sweeping knobs until the curve
        looks good — that is in-sample tuning, and this tab has no train/validation split to protect you (unlike the Trading
        strategy pages). If a configuration only profits at one exact threshold, it isn&apos;t edge.
      </P>
      <P>
        Related: the <Term>Trend Swings</Term> page (Trading → Strategies) analyses the same bars using raw market signals with
        no model at all — comparing it against this tab on the same scope answers whether the model adds anything beyond what
        the signals already know.
      </P>
    </div>
  ),
}

export function getPageInfo(pathname: string): PageInfo | undefined {
  if (PAGE_INFO[pathname]) return PAGE_INFO[pathname]
  // A strategy's analytics workbench (<base>/analytics) inherits the base
  // strategy's page info.
  const m = pathname.match(/^(.*)\/analytics$/)
  if (m && PAGE_INFO[m[1]]) return PAGE_INFO[m[1]]
  return undefined
}
