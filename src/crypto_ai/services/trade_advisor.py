"""AI second opinion on paper-trade entries (the "External AI trade confirmation").

When a strategy template has ``ai_confirmation`` on, the paper-trade engine
calls :func:`get_trade_verdict` for every NEW entry before executing it. The
advisor sends the trade card (asset, strategy, side, entry, exits, recent
price action, the run's track record so far) to Claude with web search enabled,
so it can research breaking news, scheduled events and market-wide conditions
the kline data can't see. It must answer through the ``record_verdict`` tool:

  * ``GO``     — no concrete external reason not to take the trade;
  * ``NO_GO``  — veto for a stated cause (event risk, breaking news, abnormal
                 market conditions), which blocks execution.

The advisor is deliberately a veto-for-cause, not a second technical analyst:
the prompt forbids re-scoring the chart (the strategy's backtested signal is
better calibrated there) and asks for external, checkable reasons only.

Every verdict (and every failure) is logged to ``log/trade_ai.log`` — surfaced
as the "Trade AI" source on system/logs — and the verdict + explanation are
frozen onto the ``paper_trade`` row, so gated vs. ungated performance can be
compared later (the vetoed trade's hypothetical return is still recorded).
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import UTC, datetime
from typing import Any

import anthropic
import structlog

from crypto_ai.config import get_settings

# Explicit name: the trade-AI file handler (logging.py) attaches to this logger.
log = structlog.get_logger("crypto_ai.services.trade_advisor")

# Reasoning model with web search; verdict quality matters more than the
# per-call cost here (a few calls per day at paper-trade cadence).
TRADE_AI_MODEL = "claude-sonnet-5"
# Hard cap on one consultation (the engine tick has a 270 s soft limit and
# assesses at most a couple of trades per tick).
TRADE_AI_TIMEOUT_S = 120.0
_MAX_WEB_SEARCHES = 3

_VERDICT_TOOL = {
    "name": "record_verdict",
    "description": (
        "Record your final GO / NO_GO verdict for the proposed trade. "
        "You MUST finish by calling this tool exactly once."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "verdict": {
                "type": "string",
                "enum": ["GO", "NO_GO"],
                "description": "GO = confirm the trade; NO_GO = veto it.",
            },
            "explanation": {
                "type": "string",
                "description": (
                    "Your reasoning for the verdict in 2-6 sentences, citing the "
                    "concrete information it rests on (news, events, conditions "
                    "checked). Written for the trade log."
                ),
            },
        },
        "required": ["verdict", "explanation"],
    },
}

_SYSTEM_PROMPT = """\
You are the trade-confirmation advisor for an algorithmic crypto paper-trading \
system. A technical strategy with a measured historical edge has just signalled \
an entry; the details are in the user message.

Your ONLY job is a second opinion based on information OUTSIDE the price data:
- breaking news for this asset or the crypto market (hacks, exploits, \
delistings, regulatory actions, exchange incidents);
- scheduled events inside the trade's holding window (FOMC / CPI and other \
macro releases, ETF decisions, token unlocks, network upgrades);
- abnormal market-wide conditions (contagion, extreme funding, stablecoin \
depegs, liquidity holes around weekends/holidays).

Use web search to check for current, relevant information before deciding. \
Do NOT re-analyze the technicals — the strategy's backtested signal is better \
calibrated on the price data than you are, and "the chart looks weak" is never \
a valid veto. Veto (NO_GO) only for a concrete, stated external cause that \
makes THIS trade unusually dangerous right now; if you find nothing concrete, \
confirm (GO). Generic risk disclaimers are not a cause.

When you are done researching, call the record_verdict tool exactly once with \
your verdict and a 2-6 sentence explanation citing what you checked and found. \
Do not answer in plain text."""


class TradeAdvisorError(RuntimeError):
    """The advisor could not produce a verdict (API error, timeout, bad output)."""


def build_trade_context(
    *,
    symbol: str,
    quote_asset: str,
    interval: str,
    strategy: str,
    template_name: str | None,
    side: str,
    entry_time: datetime,
    entry_price: float,
    knobs: dict,
    recent_bars: list[dict],
    run_stats: dict,
) -> dict[str, Any]:
    """Assemble the trade card sent to the advisor (everything is entry-time data)."""
    exits: dict[str, Any] = {"hold_max_bars": knobs.get("hold_bars")}
    if knobs.get("sl_mode") and knobs["sl_mode"] != "none":
        exits["stop_loss"] = {"mode": knobs["sl_mode"], "value": knobs.get("sl_value")}
    if knobs.get("tp_mode") and knobs["tp_mode"] != "none":
        exits["take_profit"] = {"mode": knobs["tp_mode"], "value": knobs.get("tp_value")}
    return {
        "asset": f"{symbol}/{quote_asset}",
        "timeframe": interval,
        "strategy": strategy,
        "template": template_name,
        "proposed_trade": {
            "side": side,
            "entry_time_utc": entry_time.astimezone(UTC).isoformat(),
            "entry_price": entry_price,
        },
        "exits": exits,
        "fee_bps_round_trip": knobs.get("fee_bps"),
        "recent_bars": recent_bars,
        "run_track_record": run_stats,
        "now_utc": datetime.now(UTC).isoformat(),
    }


async def get_trade_verdict(context: dict[str, Any]) -> tuple[str, str]:
    """Consult the AI for one trade. Returns ``(verdict, explanation)`` with
    verdict "GO" | "NO_GO". Raises :class:`TradeAdvisorError` on any failure —
    the engine treats that as "pending" and retries next tick (fail-closed)."""
    settings = get_settings()
    if not settings.claude_api:
        raise TradeAdvisorError("CLAUDE_API key is not configured")

    trade = context.get("proposed_trade", {})
    started = time.monotonic()
    try:
        verdict, explanation, usage = await asyncio.wait_for(
            _consult(settings.claude_api, context), timeout=TRADE_AI_TIMEOUT_S
        )
    except TimeoutError as exc:
        log.warning(
            "trade_ai.verdict_timeout",
            asset=context.get("asset"),
            side=trade.get("side"),
            timeout_s=TRADE_AI_TIMEOUT_S,
        )
        raise TradeAdvisorError(f"Verdict timed out after {TRADE_AI_TIMEOUT_S:.0f}s") from exc
    except anthropic.APIError as exc:
        log.warning(
            "trade_ai.verdict_api_error",
            asset=context.get("asset"),
            side=trade.get("side"),
            error=str(exc)[:300],
        )
        raise TradeAdvisorError(f"Anthropic API error: {exc}") from exc

    log.info(
        "trade_ai.verdict",
        verdict=verdict,
        asset=context.get("asset"),
        timeframe=context.get("timeframe"),
        strategy=context.get("strategy"),
        template=context.get("template"),
        side=trade.get("side"),
        entry_price=trade.get("entry_price"),
        entry_time=trade.get("entry_time_utc"),
        latency_s=round(time.monotonic() - started, 1),
        input_tokens=usage.get("input"),
        output_tokens=usage.get("output"),
        explanation=explanation,
    )
    return verdict, explanation


async def _consult(api_key: str, context: dict[str, Any]) -> tuple[str, str, dict]:
    """One Anthropic round: web search happens server-side inside the request;
    the verdict arrives as a record_verdict tool call (with a text fallback)."""
    client = anthropic.AsyncAnthropic(api_key=api_key)
    tools = [
        {
            "type": "web_search_20250305",
            "name": "web_search",
            "max_uses": _MAX_WEB_SEARCHES,
        },
        _VERDICT_TOOL,
    ]
    messages: list[dict] = [
        {
            "role": "user",
            "content": (
                "Proposed trade awaiting your confirmation:\n\n"
                + json.dumps(context, indent=2, default=str)
            ),
        }
    ]
    usage = {"input": 0, "output": 0}

    # The model normally ends its (single) turn with the record_verdict call;
    # allow one nudge round in case it stops with plain text instead.
    for _ in range(2):
        response = await client.messages.create(
            model=TRADE_AI_MODEL,
            max_tokens=2000,
            system=_SYSTEM_PROMPT,
            tools=tools,
            messages=messages,
        )
        usage["input"] += getattr(response.usage, "input_tokens", 0) or 0
        usage["output"] += getattr(response.usage, "output_tokens", 0) or 0

        for block in response.content:
            if getattr(block, "type", None) == "tool_use" and block.name == "record_verdict":
                data = block.input or {}
                verdict = str(data.get("verdict", "")).upper()
                if verdict not in ("GO", "NO_GO"):
                    raise TradeAdvisorError(f"Invalid verdict value: {verdict!r}")
                return verdict, str(data.get("explanation", "")).strip(), usage

        # No verdict tool call — nudge once, replaying the assistant turn.
        messages.append(
            {"role": "assistant", "content": _replayable_content(response.content)}
        )
        messages.append(
            {
                "role": "user",
                "content": "Call the record_verdict tool now with your final verdict.",
            }
        )

    raise TradeAdvisorError("Model did not call record_verdict")


def _replayable_content(content: list) -> list[dict]:
    """Reduce a response's content to blocks safe to send back (text only —
    server-tool blocks need no client round-trip and can't be replayed raw)."""
    out = [
        {"type": "text", "text": block.text}
        for block in content
        if getattr(block, "type", None) == "text" and block.text.strip()
    ]
    return out or [{"type": "text", "text": "(no text)"}]
