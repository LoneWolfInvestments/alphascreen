// One fixed long rule on saved daily bars.
// Signal at the close. Enter the next open. The stop checked today was known
// at the prior close. Same-day highs do not raise the stop first.
// This is an average of single trades, not a portfolio return.

import { ATR } from "technicalindicators";
import { computeSellLevels } from "../../server/computeSellLevels.js";
import { BENCHMARK_SYMBOL, MIN_TREND_BARS, SETUP, analyzeSymbol, orderedBars } from "./swingSetups.js";
import { MAX_BARS, MAX_GAP_DAYS, MAX_SYMBOLS } from "./setupStudy.js";

export const STRATEGY_NAME = "Next-open setup with a chandelier trail";
export const DEFAULT_SLIPPAGE = 0.0005;
export const EVAL_FRACTION = 0.7;
export const MIN_CLOSED_TO_SHOW = 20;

export const STRATEGY_RULES = [
  "A Breakout or Pullback is read after that session's close, using only bars up to that close.",
  "The entry is the next session's open. If that open is already through the stop, the exit is the open.",
  "The first stop is the signal close minus 2×ATR(14). That is the entry stop, not the trailing exit.",
  "After entry, the stop can only move up. It becomes the chandelier (22-day high minus 3×ATR(22)) once that is higher, and only after the close. Today's high is not used before today's stop check.",
  "If the open is above the stop and the low touches it, the exit price is the stop. A daily bar does not say which happened first, so this does not assume a better fill.",
  "A missing open or low ends the trade as incomplete. The bar is not bridged.",
  "Costs are assumptions you can edit. They are not your broker's fees.",
  "One trade per name at a time. This does not share one pool of cash across names, so the averages are not a portfolio return.",
  "Company fundamentals are not a filter.",
];

function calendarDays(earlier, later) {
  const start = Date.parse(`${earlier}T00:00:00Z`);
  const end = Date.parse(`${later}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Infinity;
  return Math.round((end - start) / 86400000);
}

function dedupe(bars) {
  const ordered = orderedBars(bars);
  const out = [];
  for (const bar of ordered) {
    if (out.length && out[out.length - 1].date === bar.date) out[out.length - 1] = bar;
    else out.push(bar);
  }
  return out;
}

function chandelierAfterClose(bars, index) {
  const slice = bars.slice(0, index + 1);
  const levels = computeSellLevels({
    closes: slice.map((bar) => bar.close),
    highs: slice.map((bar) => (Number.isFinite(bar.high) ? bar.high : bar.close)),
    lows: slice.map((bar) => (Number.isFinite(bar.low) ? bar.low : bar.close)),
  });
  return Number.isFinite(levels.chandelier_stop) ? levels.chandelier_stop : null;
}

export function applyFriction(entry, exit, slippage = DEFAULT_SLIPPAGE) {
  const slip = Number.isFinite(slippage) && slippage >= 0 && slippage < 0.25 ? slippage : DEFAULT_SLIPPAGE;
  const buy = entry * (1 + slip);
  const sell = exit * (1 - slip);
  if (!(buy > 0) || !Number.isFinite(sell)) return null;
  return sell / buy - 1;
}

// Stop is the one known before this bar. The chandelier argument is the level
// after this close, used only if the bar does not exit.
export function stepBar({ open, low, stop, trailAfterClose }) {
  if (!Number.isFinite(open) || !Number.isFinite(low) || !Number.isFinite(stop)) {
    return { status: "incomplete" };
  }
  if (open <= stop) return { status: "closed", exit: open, reason: "gap" };
  if (low <= stop) return { status: "closed", exit: stop, reason: "stop" };
  const nextStop = Number.isFinite(trailAfterClose) && trailAfterClose > stop ? trailAfterClose : stop;
  return { status: "hold", stop: nextStop };
}

function closeTrade(trade, exitPrice, exitDate, reason, slippage, spyByDate) {
  const raw = exitPrice / trade.entry - 1;
  const net = applyFriction(trade.entry, exitPrice, slippage);
  const spyEntry = spyByDate.get(trade.entryDate);
  const spyExit = spyByDate.get(exitDate);
  let spyNet = null;
  if (spyEntry && spyExit && spyEntry.open > 0 && spyExit.close > 0) {
    spyNet = applyFriction(spyEntry.open, spyExit.close, slippage);
  }
  return {
    ...trade,
    status: "closed",
    exit: exitPrice,
    exitDate,
    reason,
    rawReturn: raw,
    netReturn: net,
    spyReturn: spyNet,
    excess: net != null && spyNet != null ? net - spyNet : null,
  };
}

function signalAt(series, index, symbol, spyByDate) {
  const signalDate = series[index].date;
  const spyPrefix = [...spyByDate.values()].filter((bar) => bar.date <= signalDate);
  return analyzeSymbol(series.slice(0, index + 1), spyPrefix, { symbol });
}

export function simulateSymbol({ bars, symbol, spyByDate, slippage = DEFAULT_SLIPPAGE }) {
  const series = dedupe(bars).slice(-MAX_BARS);
  const trades = [];
  let skippedOverlap = 0;
  let incomplete = 0;
  let openTrade = null;

  function tryEnter(index) {
    if (index >= series.length - 1) return;
    const setup = signalAt(series, index, symbol, spyByDate);
    if (setup.label !== SETUP.BREAKOUT && setup.label !== SETUP.PULLBACK) return;
    if (!Number.isFinite(setup.stop)) return;
    const signalDate = series[index].date;
    const entryBar = series[index + 1];
    if (calendarDays(signalDate, entryBar.date) > MAX_GAP_DAYS) return;
    if (!Number.isFinite(entryBar.open) || entryBar.open <= 0 || !Number.isFinite(entryBar.low)) {
      incomplete += 1;
      return;
    }
    const trade = {
      symbol,
      signalDate,
      entryDate: entryBar.date,
      entry: entryBar.open,
      initialStop: setup.stop,
      stop: setup.stop,
      entryIndex: index + 1,
    };
    const trail = chandelierAfterClose(series, index + 1);
    const step = stepBar({ open: entryBar.open, low: entryBar.low, stop: setup.stop, trailAfterClose: trail });
    if (step.status === "incomplete") {
      incomplete += 1;
      return;
    }
    if (step.status === "closed") {
      const reason = step.reason === "gap" ? "gap_on_entry" : "stop";
      trades.push(closeTrade(trade, step.exit, entryBar.date, reason, slippage, spyByDate));
      return;
    }
    openTrade = { ...trade, stop: step.stop };
  }

  for (let index = MIN_TREND_BARS - 1; index < series.length; index += 1) {
    if (openTrade && index > openTrade.entryIndex) {
      const bar = series[index];
      const trail = chandelierAfterClose(series, index);
      const step = stepBar({ open: bar.open, low: bar.low, stop: openTrade.stop, trailAfterClose: trail });
      if (step.status === "incomplete") {
        incomplete += 1;
        trades.push({ ...openTrade, status: "incomplete", exit: null, reason: "missing_bar" });
        openTrade = null;
        continue;
      }
      if (step.status === "closed") {
        trades.push(closeTrade(openTrade, step.exit, bar.date, step.reason, slippage, spyByDate));
        openTrade = null;
        tryEnter(index);
        continue;
      }
      const setup = signalAt(series, index, symbol, spyByDate);
      if (setup.label === SETUP.BREAKOUT || setup.label === SETUP.PULLBACK) skippedOverlap += 1;
      openTrade = { ...openTrade, stop: step.stop };
      continue;
    }
    if (openTrade) continue;
    tryEnter(index);
  }

  if (openTrade) {
    trades.push({ ...openTrade, status: "open", exit: null, reason: "still_open" });
  }
  return { trades, skippedOverlap, incomplete };
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function splitTrades(trades) {
  const ordered = [...(trades || [])].filter((trade) => trade.signalDate).sort((a, b) => (
    a.signalDate < b.signalDate ? -1 : a.signalDate > b.signalDate ? 1 : 0
  ));
  if (ordered.length < 2) {
    return { development: ordered, evaluation: [], cut: null };
  }
  const cutIndex = Math.max(0, Math.floor((ordered.length - 1) * EVAL_FRACTION));
  const cut = ordered[cutIndex].signalDate;
  return {
    development: ordered.filter((trade) => trade.signalDate <= cut),
    evaluation: ordered.filter((trade) => trade.signalDate > cut),
    cut,
  };
}

function windowStats(trades) {
  const closed = (trades || []).filter((trade) => trade.status === "closed" && Number.isFinite(trade.netReturn));
  const open = (trades || []).filter((trade) => trade.status === "open").length;
  const incomplete = (trades || []).filter((trade) => trade.status === "incomplete").length;
  const show = closed.length >= MIN_CLOSED_TO_SHOW;
  const excesses = closed.map((trade) => trade.excess).filter((value) => Number.isFinite(value));
  return {
    closed: closed.length,
    open,
    incomplete,
    withheld: !show,
    avgNet: show ? mean(closed.map((trade) => trade.netReturn)) : null,
    avgExcess: show ? mean(excesses) : null,
    excessCount: excesses.length,
  };
}

export function simulateBook({ seriesBySymbol, slippage = DEFAULT_SLIPPAGE } = {}) {
  const source = seriesBySymbol || {};
  const names = Object.keys(source).map((symbol) => String(symbol).toUpperCase()).sort();
  const spyKey = names.includes(BENCHMARK_SYMBOL) ? BENCHMARK_SYMBOL : null;
  let symbols = names.filter((symbol) => symbol !== BENCHMARK_SYMBOL);
  const truncated = symbols.length > MAX_SYMBOLS;
  if (truncated) symbols = symbols.slice(0, MAX_SYMBOLS);
  const spyBars = dedupe(spyKey ? source[spyKey] : []).slice(-MAX_BARS);
  const spyByDate = new Map(spyBars.map((bar) => [bar.date, bar]));
  const trades = [];
  let skippedOverlap = 0;
  let incomplete = 0;
  let warmup = 0;
  for (const symbol of symbols) {
    const bars = dedupe(source[symbol]).slice(-MAX_BARS);
    if (bars.length < MIN_TREND_BARS) {
      warmup += 1;
      continue;
    }
    const result = simulateSymbol({ bars, symbol, spyByDate, slippage });
    trades.push(...result.trades);
    skippedOverlap += result.skippedOverlap;
    incomplete += result.incomplete;
  }
  const split = splitTrades(trades);
  return {
    name: STRATEGY_NAME,
    rules: STRATEGY_RULES,
    slippage,
    trades,
    skippedOverlap,
    incomplete,
    warmup,
    truncated,
    spyBars: spyBars.length,
    split,
    development: windowStats(split.development),
    evaluation: windowStats(split.evaluation),
    singleTrade: true,
  };
}

export function atrReady(closes, highs, lows) {
  if (!closes || closes.length < 15) return null;
  const values = ATR.calculate({ period: 14, high: highs, low: lows, close: closes });
  return values.length ? values[values.length - 1] : null;
}
