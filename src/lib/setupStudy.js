// Forward-return study of saved daily bars.
// A signal is the setup after that session's close, using only bars up to
// that date. The entry is the next session's open. This is not a stop or
// target backtest, and it does not look at fundamentals.

import { BENCHMARK_SYMBOL, MIN_TREND_BARS, SETUP, analyzeSymbol, orderedBars } from "./swingSetups.js";

export const HORIZONS = Object.freeze([5, 10, 20]);
export const STUDY_SETUPS = Object.freeze([SETUP.BREAKOUT, SETUP.PULLBACK]);
export const MAX_BARS = 320;
export const MAX_SYMBOLS = 60;
export const MAX_GAP_DAYS = 5;
export const OVERLAP_BARS = 20;
export const SMALL_SAMPLE = 30;

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

export function barsBySymbolFromRows(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const symbol = String(row?.symbol || "").toUpperCase();
    if (!symbol) continue;
    if (!grouped.has(symbol)) grouped.set(symbol, []);
    grouped.get(symbol).push(row);
  }
  const series = {};
  let trimmed = false;
  for (const [symbol, list] of grouped) {
    const ordered = dedupe(list);
    if (ordered.length > MAX_BARS) trimmed = true;
    series[symbol] = ordered.length > MAX_BARS ? ordered.slice(-MAX_BARS) : ordered;
  }
  return { series, trimmed };
}

function spyMap(spyBars) {
  const map = new Map();
  for (const bar of dedupe(spyBars)) map.set(bar.date, bar);
  return map;
}

function gapInPath(bars, fromIndex, toIndex) {
  for (let index = fromIndex; index < toIndex; index += 1) {
    if (calendarDays(bars[index].date, bars[index + 1].date) > MAX_GAP_DAYS) return true;
  }
  return false;
}

export function outcomesForSignal({ bars, spyByDate, signalIndex }) {
  const signal = bars[signalIndex];
  const entry = bars[signalIndex + 1];
  const base = {
    signalDate: signal?.date || null,
    entryDate: null,
    entryOpen: null,
  };
  if (!entry) {
    return HORIZONS.map((horizon) => ({ ...base, horizon, status: "pending", exitDate: null, exitClose: null, stockReturn: null, spyReturn: null, excess: null }));
  }
  base.entryDate = entry.date;
  base.entryOpen = Number.isFinite(entry.open) ? entry.open : null;
  const entryGap = calendarDays(signal.date, entry.date) > MAX_GAP_DAYS;
  const badOpen = !(base.entryOpen > 0);

  return HORIZONS.map((horizon) => {
    const row = { ...base, horizon, exitDate: null, exitClose: null, stockReturn: null, spyReturn: null, excess: null };
    if (entryGap) return { ...row, status: "ineligible_gap" };
    if (badOpen) return { ...row, status: "ineligible_open" };
    const exitIndex = signalIndex + horizon;
    const lastKnown = Math.min(exitIndex, bars.length - 1);
    if (gapInPath(bars, signalIndex + 1, lastKnown)) return { ...row, status: "ineligible_gap" };
    if (exitIndex >= bars.length) return { ...row, status: "pending" };
    const exit = bars[exitIndex];
    if (!Number.isFinite(exit.close) || exit.close <= 0) return { ...row, status: "ineligible_exit" };
    const stockReturn = exit.close / base.entryOpen - 1;
    const spyEntry = spyByDate.get(entry.date);
    const spyExit = spyByDate.get(exit.date);
    let spyReturn = null;
    if (spyEntry && spyExit && spyEntry.open > 0 && Number.isFinite(spyExit.close) && spyExit.close > 0) {
      spyReturn = spyExit.close / spyEntry.open - 1;
    }
    return {
      ...row,
      status: "completed",
      exitDate: exit.date,
      exitClose: exit.close,
      stockReturn,
      spyReturn,
      excess: spyReturn == null ? null : stockReturn - spyReturn,
    };
  });
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function emptyHorizon() {
  return {
    completed: 0,
    pending: 0,
    ineligible: 0,
    benchmarkMissing: 0,
    avgReturn: null,
    medianReturn: null,
    avgExcess: null,
    excessCount: 0,
  };
}

function summarize(signals) {
  const bySetup = {};
  for (const setup of STUDY_SETUPS) {
    const mine = signals.filter((signal) => signal.setup === setup);
    const independent = mine.filter((signal) => signal.independent);
    const horizons = {};
    for (const horizon of HORIZONS) {
      const bucket = emptyHorizon();
      const returns = [];
      const excesses = [];
      for (const signal of independent) {
        const outcome = signal.outcomes.find((item) => item.horizon === horizon);
        if (!outcome) continue;
        if (outcome.status === "completed") {
          bucket.completed += 1;
          if (Number.isFinite(outcome.stockReturn)) returns.push(outcome.stockReturn);
          if (Number.isFinite(outcome.excess)) excesses.push(outcome.excess);
          else bucket.benchmarkMissing += 1;
        } else if (outcome.status === "pending") bucket.pending += 1;
        else bucket.ineligible += 1;
      }
      bucket.avgReturn = mean(returns);
      bucket.medianReturn = median(returns);
      bucket.avgExcess = mean(excesses);
      bucket.excessCount = excesses.length;
      horizons[horizon] = bucket;
    }
    bySetup[setup] = { raw: mine.length, independent: independent.length, horizons };
  }
  return bySetup;
}

export function studySetups(seriesBySymbol) {
  const source = seriesBySymbol || {};
  const names = Object.keys(source).map((symbol) => String(symbol).toUpperCase()).sort();
  const spyKey = names.find((symbol) => symbol === BENCHMARK_SYMBOL) || null;
  let symbols = names.filter((symbol) => symbol !== BENCHMARK_SYMBOL);
  let symbolCap = false;
  if (symbols.length > MAX_SYMBOLS) {
    symbols = symbols.slice(0, MAX_SYMBOLS);
    symbolCap = true;
  }

  const prepared = {};
  for (const symbol of symbols) prepared[symbol] = dedupe(source[symbol] || source[symbol.toLowerCase()] || []).slice(-MAX_BARS);
  const spyBars = dedupe((spyKey ? source[spyKey] : null) || []).slice(-MAX_BARS);
  const spyByDate = spyMap(spyBars);

  const coverage = [];
  const signals = [];
  const labelDays = {
    [SETUP.BREAKOUT]: 0,
    [SETUP.PULLBACK]: 0,
    [SETUP.UPTREND]: 0,
    [SETUP.AVOID]: 0,
    [SETUP.THIN]: 0,
  };

  for (const symbol of symbols) {
    const bars = prepared[symbol];
    const first = bars[0]?.date || null;
    const last = bars[bars.length - 1]?.date || null;
    if (bars.length < MIN_TREND_BARS) {
      coverage.push({ symbol, bars: bars.length, status: "warmup", first, last });
      labelDays[SETUP.THIN] += 1;
      continue;
    }
    coverage.push({ symbol, bars: bars.length, status: "ready", first, last });
    const found = [];
    for (let index = MIN_TREND_BARS - 1; index < bars.length; index += 1) {
      const signalDate = bars[index].date;
      const prefix = bars.slice(0, index + 1);
      const spyPrefix = spyBars.filter((bar) => bar.date <= signalDate);
      const setup = analyzeSymbol(prefix, spyPrefix, { symbol });
      if (labelDays[setup.label] != null) labelDays[setup.label] += 1;
      if (!STUDY_SETUPS.includes(setup.label)) continue;
      const outcomes = outcomesForSignal({ bars, spyByDate, signalIndex: index });
      found.push({
        symbol,
        setup: setup.label,
        signalDate,
        signalIndex: index,
        entryIndex: bars[index + 1] ? index + 1 : null,
        independent: false,
        outcomes,
      });
    }
    let nextFree = -1;
    for (const signal of found) {
      signal.independent = signal.signalIndex >= nextFree;
      if (signal.independent) {
        const anchor = signal.entryIndex == null ? signal.signalIndex : signal.entryIndex;
        nextFree = anchor + OVERLAP_BARS;
      }
    }
    signals.push(...found);
  }

  const events = [];
  for (const signal of signals) {
    for (const outcome of signal.outcomes) {
      events.push({
        symbol: signal.symbol,
        setup: signal.setup,
        signalDate: signal.signalDate,
        independent: signal.independent,
        ...outcome,
      });
    }
  }

  const ready = coverage.filter((row) => row.status === "ready").length;
  const notes = [
    "This is a forward-return check of the saved bars. It is not a test of the stop, the target, or a finished trading strategy.",
    "The signal uses only bars up through that close. The entry is the next session's open. A result is the close 5, 10, or 20 sessions later.",
    "SPY is subtracted over those same two dates. A missing SPY bar leaves the stock return and blanks the excess. A gap longer than a long weekend drops the result instead of filling it.",
    "Averages use one signal at a time per name. Another signal inside 20 sessions is counted in the raw total and left out of the average, because the trades overlap.",
    "The universe is whoever is in the saved bars now. Names added later have no earlier history, and names you removed are absent. Today's fundamentals are not a filter.",
    `Fewer than ${SMALL_SAMPLE} finished results is a description of the saved history, not evidence that the setup works.`,
  ];
  if (!spyBars.length) notes.unshift("SPY is not in the saved bars, so excess return is blank.");
  if (symbolCap) notes.unshift(`Only the first ${MAX_SYMBOLS} symbols in alphabetical order were measured.`);
  if (ready === 0) notes.unshift(`None of the saved names has ${MIN_TREND_BARS} sessions, so there is no setup to measure yet.`);

  return {
    coverage,
    labelDays,
    signals,
    events,
    summaries: summarize(signals),
    spy: {
      bars: spyBars.length,
      first: spyBars[0]?.date || null,
      last: spyBars[spyBars.length - 1]?.date || null,
    },
    symbolCap,
    notes,
    smallSample: SMALL_SAMPLE,
  };
}

export function eventsToCsv(events) {
  const header = [
    "symbol", "setup", "signal_date", "independent", "horizon_sessions", "status",
    "entry_date", "entry_open", "exit_date", "exit_close", "stock_return", "spy_return", "excess_return",
  ];
  const lines = [header.join(",")];
  for (const event of events || []) {
    const cells = [
      event.symbol,
      event.setup,
      event.signalDate,
      event.independent ? "yes" : "no",
      event.horizon,
      event.status,
      event.entryDate || "",
      event.entryOpen ?? "",
      event.exitDate || "",
      event.exitClose ?? "",
      event.stockReturn ?? "",
      event.spyReturn ?? "",
      event.excess ?? "",
    ];
    lines.push(cells.map((cell) => String(cell)).join(","));
  }
  return lines.join("\n");
}
