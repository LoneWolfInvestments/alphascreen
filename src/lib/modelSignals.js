// Prospective record of Buy candidates. A row is written once, after the
// close, from the prices and company figures already saved. It is not a
// reconstruction of earlier days, and it is not the owner's trade.

import { assessSignal } from "./signalAssessment.js";
import { isTradingDay, sessionsBehind } from "./sessionClock.js";
import { isEarningsSoon } from "./sellSignals.js";
import { applyFriction, DEFAULT_SLIPPAGE } from "./strategySim.js";
import { BENCHMARK_SYMBOL } from "./swingSetups.js";

export const POLICY_VERSION = "buy-candidate-v1";
export const MAX_HOLD_SESSIONS = 20;
export const PATH_HORIZONS = Object.freeze([5, 10, 20]);
export const MAX_GAP_DAYS = 5;
export const MIN_CLOSED_TO_AVERAGE = 20;
export const SLIPPAGE = DEFAULT_SLIPPAGE;

export const POLICY_RULES = Object.freeze([
  "The universe is the active watchlist, excluding SPY. A name is recorded only when that night's saved quote is the latest completed session for every name on that list. If any name is missing or behind, the night records nothing new.",
  "A Buy candidate uses the same rule as the Signals screen, judged as if you do not hold it: a fresh Breakout or Pullback, company figures that already pass, and earnings not inside five sessions of the signal session. The market light is stored and does not veto.",
  "The first night a name qualifies starts one episode. Further Buy labels on later sessions do not start another while that episode is unfinished, and not at all until a captured session has recorded the name as not a Buy. A night that was skipped cannot be filled in later.",
  "The entry is the next session's open, and only that session. The open is not known when the signal is saved. A gap of more than five calendar days expires the entry. A missing next bar is pending, then data insufficient once that session should exist. The signal close is never used as the fill.",
  "The stop is the signal close minus 2×ATR(14), frozen. This record does not trail it and does not use a profit target, because the screen has no target. A daily bar that gaps through the stop exits at the open. Otherwise a low through the stop exits at the stop.",
  "If a later policy stores a target, a bar whose range touches both the stop and the target is ambiguous. The daily bar does not say which came first, so that bar is not a win.",
  "The trade ends at the stop, the gap, or the close of the 20th session after entry, whichever the bars can resolve first. Five, ten, and twenty session path returns are a separate measurement from that exit. They use the same dates as the setup study and ignore the stop.",
  "R is the exit minus the entry open, divided by the signal close minus the frozen stop. That denominator is the risk known before the open, so a gap through the stop still has a defined R. The net figure subtracts 0.05% at entry and 0.05% at exit. That cost is an assumption, not a broker fee. SPY uses the same dates and the same assumption. A missing SPY bar leaves the stock figure and blanks the comparison.",
  "Bars are used as stored. Splits and other corporate actions are not adjusted here. A hole longer than five calendar days stops the path instead of bridging it.",
  "Win rate is wins divided by wins plus losses. Untriggered, expired, open, ambiguous, and data insufficient stay out of that denominator and stay visible. Fewer than 20 wins and losses withholds the average. None of this is a promise about the next trade.",
  "This record does not know your holdings or your journal. A note with the same ticker is your note, not this result, and saving one does not create the other.",
]);

const SNAPSHOT_KEYS = Object.freeze([
  "symbol", "signal_session", "observed_at", "origin", "policy_version", "policy_text",
  "setup_label", "signal_close", "initial_stop", "target_price",
  "fundamentals_state", "technicals_state", "supporting_state",
  "freshness", "fundamentals_coverage", "fundamentals_as_of", "fundamentals_period",
  "earnings_date", "earnings_as_of", "regime", "regime_state", "regime_as_of",
  "quote_updated_at",
]);

function num(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function day(value) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function calendarDays(earlier, later) {
  const start = Date.parse(`${earlier}T00:00:00Z`);
  const end = Date.parse(`${later}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Infinity;
  return Math.round((end - start) / 86400000);
}

export function previousTradingSession(session) {
  const start = day(session);
  if (!start) return null;
  let cursor = start;
  for (let guard = 0; guard < 14; guard += 1) {
    const date = new Date(`${cursor}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    cursor = date.toISOString().slice(0, 10);
    if (isTradingDay(cursor)) return cursor;
  }
  return null;
}

export function universeReady(symbols, quotesBySymbol, session) {
  const names = [...new Set((symbols || []).map((symbol) => String(symbol || "").toUpperCase()).filter(Boolean))]
    .filter((symbol) => symbol !== BENCHMARK_SYMBOL)
    .sort();
  const behind = [];
  for (const symbol of names) {
    const bar = day(quotesBySymbol?.[symbol]?.bar_date);
    if (bar !== session) behind.push({ symbol, barDate: bar });
  }
  return { symbols: names, complete: names.length > 0 && behind.length === 0, behind };
}

export function observeSymbol({
  symbol,
  quote,
  business,
  earningsDate = null,
  earningsAsOf = null,
  regime = null,
  session,
  observedAt,
}) {
  const ticker = String(symbol || "").toUpperCase();
  const info = sessionsBehind(quote?.bar_date, new Date(`${session}T21:00:00Z`));
  const assessment = assessSignal({
    ticker,
    held: false,
    label: quote?.setup_label || null,
    freshness: quote ? info.state : "missing",
    barDate: day(quote?.bar_date),
    stop: num(quote?.suggested_stop),
    businessCoverage: business?.coverage || "missing",
    businessSignal: business?.signal || null,
    businessSummary: business?.summary || null,
    statementPeriod: business?.period || null,
    earningsSoon: isEarningsSoon(earningsDate, session),
    earningsDate: day(earningsDate),
    regimeState: regime?.state || "missing",
    regime: regime?.regime || null,
    regimeAsOf: regime?.asOf || null,
  });
  const close = num(quote?.price);
  const stop = num(quote?.suggested_stop);
  const buy = assessment.assessment === "Buy candidate";
  const usable = buy && close != null && stop != null && stop < close;
  return {
    symbol: ticker,
    qualified: usable,
    unusableBuy: buy && !usable,
    assessment: assessment.assessment,
    setupLabel: quote?.setup_label || null,
    close,
    stop,
    fundamentals: assessment.fundamentals,
    technicals: assessment.technicals,
    supporting: assessment.supporting,
    freshness: quote ? info.state : "missing",
    coverage: business?.coverage || "missing",
    fundamentalsAsOf: business?.fetchedAt || null,
    fundamentalsPeriod: business?.period || null,
    earningsDate: day(earningsDate),
    earningsAsOf: earningsAsOf || null,
    regime: regime?.regime || null,
    regimeState: regime?.state || "missing",
    regimeAsOf: regime?.asOf || null,
    quoteUpdatedAt: quote?.updated_at || null,
    observedAt,
  };
}

function snapshotFrom(observation, origin) {
  return {
    symbol: observation.symbol,
    signal_session: observation.session,
    observed_at: observation.observedAt,
    origin,
    policy_version: POLICY_VERSION,
    policy_text: POLICY_RULES.join(" "),
    setup_label: observation.setupLabel,
    signal_close: observation.close,
    initial_stop: observation.stop,
    target_price: null,
    fundamentals_state: observation.fundamentals,
    technicals_state: observation.technicals,
    supporting_state: observation.supporting,
    freshness: observation.freshness,
    fundamentals_coverage: observation.coverage,
    fundamentals_as_of: observation.fundamentalsAsOf,
    fundamentals_period: observation.fundamentalsPeriod,
    earnings_date: observation.earningsDate,
    earnings_as_of: observation.earningsAsOf,
    regime: observation.regime,
    regime_state: observation.regimeState,
    regime_as_of: observation.regimeAsOf,
    quote_updated_at: observation.quoteUpdatedAt,
  };
}

export function assertSnapshotUntouched(before, after) {
  for (const key of SNAPSHOT_KEYS) {
    if (JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after?.[key] ?? null)) {
      throw new Error(`Snapshot field ${key} changed`);
    }
  }
}

export function planCapture({ session, observations, states, openSymbols, alreadyRecorded = false }) {
  const prior = previousTradingSession(session);
  if (alreadyRecorded) {
    return { action: "already_recorded", inserts: [], states: [], skipped: { continuation: 0, gap: 0, open: 0, unusable: 0 } };
  }
  const inserts = [];
  const nextStates = [];
  const skipped = { continuation: 0, gap: 0, open: 0, unusable: 0 };
  const stateBySymbol = new Map((states || []).map((row) => [String(row.symbol).toUpperCase(), row]));
  const open = new Set((openSymbols || []).map((symbol) => String(symbol).toUpperCase()));

  for (const observation of observations || []) {
    const symbol = observation.symbol;
    const previous = stateBySymbol.get(symbol) || null;
    const qualified = !!observation.qualified;
    if (observation.unusableBuy) skipped.unusable += 1;
    let inserted = false;
    if (qualified && !open.has(symbol)) {
      if (!previous) {
        inserts.push(snapshotFrom({ ...observation, session }, "first_observation"));
        inserted = true;
      } else if (previous.last_session === prior && previous.last_qualified === false) {
        inserts.push(snapshotFrom({ ...observation, session }, "rearm"));
        inserted = true;
      } else if (previous.last_session === prior && previous.last_qualified === true) {
        skipped.continuation += 1;
      } else if (previous.last_session && previous.last_session !== prior) {
        skipped.gap += 1;
      } else {
        skipped.gap += 1;
      }
    } else if (qualified && open.has(symbol)) {
      skipped.open += 1;
    }
    nextStates.push({
      symbol,
      last_session: session,
      last_qualified: qualified,
      open_symbol: open.has(symbol) || inserted,
    });
  }
  return { action: "capture", inserts, states: nextStates, skipped };
}

export function resolveIntraday({ open, high, low, stop, target }) {
  if (!Number.isFinite(open) || !Number.isFinite(low) || !Number.isFinite(stop)) {
    return { status: "data_insufficient", reason: "missing_bar", exit: null };
  }
  if (open <= stop) return { status: "loss", reason: "gap", exit: open };
  const stopHit = low <= stop;
  const targetHit = Number.isFinite(target) && Number.isFinite(high) && high >= target;
  if (stopHit && targetHit) return { status: "ambiguous", reason: "same_bar", exit: null };
  if (stopHit) return { status: "loss", reason: "stop", exit: stop };
  if (targetHit) return { status: "win", reason: "target", exit: target };
  return { status: "hold", reason: null, exit: null };
}

function rMultiples(entry, exit, stop, signalClose) {
  const basis = Number.isFinite(signalClose) ? signalClose : entry;
  const risk = basis - stop;
  if (!(risk > 0) || !Number.isFinite(entry) || !Number.isFinite(exit)) return { r: null, rNet: null };
  const r = (exit - entry) / risk;
  const netReturn = applyFriction(entry, exit, SLIPPAGE);
  const rNet = netReturn == null ? null : (netReturn * entry) / risk;
  return { r, rNet };
}

function pathReturns(future, spyByDate) {
  const paths = {};
  for (const horizon of PATH_HORIZONS) {
    const key = `h${horizon}`;
    if (future.length < horizon) {
      paths[key] = { status: "pending", stock: null, spy: null, excess: null };
      continue;
    }
    let gapped = false;
    for (let index = 0; index < horizon - 1; index += 1) {
      if (calendarDays(future[index].date, future[index + 1].date) > MAX_GAP_DAYS) gapped = true;
    }
    const exit = future[horizon - 1];
    const entry = future[0];
    if (gapped || !(entry.open > 0) || !(exit.close > 0)) {
      paths[key] = { status: "ineligible_gap", stock: null, spy: null, excess: null };
      continue;
    }
    const stock = exit.close / entry.open - 1;
    const spyEntry = spyByDate.get(entry.date);
    const spyExit = spyByDate.get(exit.date);
    const spy = spyEntry && spyExit && spyEntry.open > 0 && spyExit.close > 0
      ? spyExit.close / spyEntry.open - 1
      : null;
    paths[key] = { status: "completed", stock, spy, excess: spy == null ? null : stock - spy };
  }
  return paths;
}

export function reviewEpisode({ snapshot, bars, spyBars, lastSession }) {
  const frozen = { ...snapshot };
  const session = day(snapshot.signal_session);
  const last = day(lastSession);
  const future = (bars || [])
    .map((bar) => ({
      date: day(bar.date || bar.bar_date),
      open: num(bar.open),
      high: num(bar.high),
      low: num(bar.low),
      close: num(bar.close),
    }))
    .filter((bar) => bar.date && bar.date > session && (!last || bar.date <= last))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const spyByDate = new Map();
  for (const bar of spyBars || []) {
    const date = day(bar.date || bar.bar_date);
    if (date) spyByDate.set(date, { open: num(bar.open), close: num(bar.close) });
  }

  let outcome = {
    status: "untriggered",
    reason: "waiting_for_next_session",
    entry_date: null,
    entry_open: null,
    exit_date: null,
    exit_price: null,
    r_multiple: null,
    r_net: null,
  };

  const stopBelowSignal = Number.isFinite(snapshot.initial_stop) && Number.isFinite(snapshot.signal_close) && snapshot.initial_stop < snapshot.signal_close;
  if (future.length === 0) {
    outcome = last && last !== session
      ? { ...outcome, status: "data_insufficient", reason: "missing_entry_bar" }
      : outcome;
  } else if (!stopBelowSignal) {
    outcome = { ...outcome, status: "data_insufficient", reason: "bad_stop" };
  } else if (calendarDays(session, future[0].date) > MAX_GAP_DAYS) {
    outcome = { ...outcome, status: "expired", reason: "entry_gap" };
  } else if (!(future[0].open > 0)) {
    outcome = { ...outcome, status: "data_insufficient", reason: "bad_entry" };
  } else {
    const entry = future[0];
    let resolved = null;
    const limit = Math.min(future.length, MAX_HOLD_SESSIONS);
    for (let index = 0; index < limit; index += 1) {
      const bar = future[index];
      if (index > 0 && calendarDays(future[index - 1].date, bar.date) > MAX_GAP_DAYS) {
        resolved = { status: "data_insufficient", reason: "path_gap", exit: null, date: bar.date };
        break;
      }
      const step = resolveIntraday({
        open: bar.open,
        high: bar.high,
        low: bar.low,
        stop: snapshot.initial_stop,
        target: snapshot.target_price,
      });
      if (step.status === "data_insufficient") {
        resolved = { ...step, date: bar.date };
        break;
      }
      if (step.status !== "hold") {
        resolved = { ...step, date: bar.date };
        break;
      }
      if (index === MAX_HOLD_SESSIONS - 1 && Number.isFinite(bar.close)) {
        const multiples = rMultiples(entry.open, bar.close, snapshot.initial_stop, snapshot.signal_close);
        resolved = {
          status: multiples.r > 0 ? "win" : multiples.r < 0 ? "loss" : "ambiguous",
          reason: "horizon",
          exit: bar.close,
          date: bar.date,
        };
      }
    }
    if (!resolved) {
      outcome = {
        status: "open",
        reason: "in_trade",
        entry_date: entry.date,
        entry_open: entry.open,
        exit_date: null,
        exit_price: null,
        r_multiple: null,
        r_net: null,
      };
    } else {
      const multiples = rMultiples(entry.open, resolved.exit, snapshot.initial_stop, snapshot.signal_close);
      outcome = {
        status: resolved.status,
        reason: resolved.reason,
        entry_date: entry.date,
        entry_open: entry.open,
        exit_date: resolved.exit == null ? null : resolved.date,
        exit_price: resolved.exit,
        r_multiple: resolved.exit == null ? null : multiples.r,
        r_net: resolved.exit == null ? null : multiples.rNet,
      };
    }
  }

  let paths = pathReturns(future, spyByDate);
  if (outcome.status === "expired") {
    paths = {
      h5: { status: "ineligible_gap", stock: null, spy: null, excess: null },
      h10: { status: "ineligible_gap", stock: null, spy: null, excess: null },
      h20: { status: "ineligible_gap", stock: null, spy: null, excess: null },
    };
  }
  assertSnapshotUntouched(frozen, snapshot);
  return {
    ...outcome,
    path_5_status: paths.h5.status,
    path_5: paths.h5.stock,
    spy_5: paths.h5.spy,
    excess_5: paths.h5.excess,
    path_10_status: paths.h10.status,
    path_10: paths.h10.stock,
    spy_10: paths.h10.spy,
    excess_10: paths.h10.excess,
    path_20_status: paths.h20.status,
    path_20: paths.h20.stock,
    spy_20: paths.h20.spy,
    excess_20: paths.h20.excess,
    reviewed_session: last,
  };
}

const TERMINAL = new Set(["win", "loss", "expired", "ambiguous", "data_insufficient"]);

export function isTerminal(status) {
  return TERMINAL.has(status);
}

export function summarizeOutcomes(outcomes, { minClosed = MIN_CLOSED_TO_AVERAGE } = {}) {
  const counts = {
    untriggered: 0, expired: 0, open: 0, win: 0, loss: 0, ambiguous: 0, data_insufficient: 0,
  };
  const rs = [];
  const nets = [];
  for (const row of outcomes || []) {
    const status = counts[row?.status] == null ? "data_insufficient" : row.status;
    counts[status] += 1;
    if ((status === "win" || status === "loss") && Number.isFinite(row.r_multiple)) rs.push(row.r_multiple);
    if ((status === "win" || status === "loss") && Number.isFinite(row.r_net)) nets.push(row.r_net);
  }
  const denominator = counts.win + counts.loss;
  const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  return {
    counts,
    denominator,
    pending: counts.untriggered + counts.open,
    winRate: denominator ? counts.win / denominator : null,
    avgR: denominator >= minClosed ? mean(rs) : null,
    avgRNet: denominator >= minClosed ? mean(nets) : null,
    withheld: denominator < minClosed,
    minClosed,
  };
}

export function journalMatches(signal, notes) {
  const symbol = String(signal?.symbol || "").toUpperCase();
  const start = day(signal?.signal_session);
  const end = day(signal?.exit_date) || day(signal?.entry_date) || start;
  return (notes || []).filter((note) => {
    const ticker = String(note?.ticker || "").toUpperCase();
    const opened = day(note?.opened_on);
    if (!ticker || ticker !== symbol || !opened || !start) return false;
    return opened >= start && opened <= end;
  });
}

export function isMissingModelTable(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.code || ""}`;
  return /model_signals|model_signal_outcomes|model_signal_state/i.test(message)
    && /schema cache|does not exist|relation|Could not find|PGRST205|42P01/i.test(message);
}
