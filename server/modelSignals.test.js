import assert from "node:assert/strict";
import test from "node:test";
import { factsFromFinnhubPayload } from "../src/lib/businessFundamentals.js";
import {
  journalMatches,
  observeSymbol,
  planCapture,
  resolveIntraday,
  reviewEpisode,
  summarizeOutcomes,
  universeReady,
} from "../src/lib/modelSignals.js";
import { captureNight } from "./recordModelSignals.js";

const SESSION = "2026-11-05";
const NOW = new Date("2026-11-06T06:00:00Z");

function buyBusiness() {
  return factsFromFinnhubPayload({
    metric: {
      peBasicExclExtraTTM: 22,
      marketCapitalization: 1000,
      epsInclExtraItemsTTM: 4,
      epsGrowthTTMYoy: 12,
      revenueGrowthTTMYoy: 9,
      netProfitMarginTTM: 20,
      netProfitMarginAnnual: 18,
      psTTM: 4,
    },
    series: {
      quarterly: {
        netMargin: [
          { period: "2025-06-30", v: 0.16 },
          { period: "2026-06-30", v: 0.2 },
        ],
      },
    },
  }, { fetchedAt: "2026-10-26T00:00:00Z" });
}

function quote(symbol, bar = SESSION) {
  return {
    symbol,
    price: 100,
    setup_label: "Breakout",
    suggested_stop: 90,
    bar_date: bar,
    updated_at: "2026-11-05T22:00:00Z",
  };
}

function memoryRepo(seed) {
  const inserts = [];
  const states = [...(seed.states || [])];
  const outcomes = [];
  return {
    inserts,
    states,
    outcomes,
    watchlist: async () => seed.watchlist,
    quotes: async () => seed.quotes,
    fundamentals: async () => seed.fundamentals || [],
    earnings: async () => seed.earnings || [],
    stress: async () => seed.stress || null,
    states: async () => states,
    openEpisodes: async () => seed.open || [],
    bars: async () => seed.bars || [],
    saveOutcomes: async (rows) => { outcomes.push(...rows); },
    insertSignals: async (rows) => { inserts.push(...rows); },
    saveStates: async (rows) => {
      states.splice(0, states.length, ...rows);
    },
  };
}

test("a night with a name behind records no new Buy, and a repeat night does not insert again", async () => {
  const behind = memoryRepo({
    watchlist: [{ symbol: "AAA" }, { symbol: "BBB" }],
    quotes: [quote("AAA"), quote("BBB", "2026-11-04")],
    fundamentals: [{ ticker: "AAA", ...buyBusiness() }],
  });
  const blocked = await captureNight(behind, NOW);
  assert.equal(blocked.body.action, "incomplete_universe");
  assert.equal(blocked.body.inserted, 0);
  assert.equal(behind.inserts.length, 0);

  const ready = memoryRepo({
    watchlist: [{ symbol: "AAA" }, { symbol: "SPY" }],
    quotes: [quote("AAA"), quote("SPY")],
    fundamentals: [{ ticker: "AAA", ...buyBusiness() }],
  });
  const first = await captureNight(ready, NOW);
  assert.equal(first.body.action, "capture");
  assert.equal(first.body.inserted, 1);
  assert.equal(ready.inserts[0].origin, "first_observation");
  assert.equal(ready.inserts[0].signal_session, SESSION);
  assert.equal(ready.inserts[0].target_price, null);
  assert.equal(ready.inserts[0].held, undefined);
  assert.equal(ready.inserts[0].shares, undefined);

  const second = await captureNight(ready, NOW);
  assert.equal(second.body.action, "already_recorded");
  assert.equal(ready.inserts.length, 1);
});

test("a continued Buy is one episode, a gap is not filled in, and a later off-then-on rearms", () => {
  const observation = {
    symbol: "AAA",
    qualified: true,
    unusableBuy: false,
    setupLabel: "Breakout",
    close: 100,
    stop: 90,
    fundamentals: "Positive",
    technicals: "Positive",
    supporting: "Unknown",
    freshness: "fresh",
    coverage: "ready",
    observedAt: NOW.toISOString(),
  };
  const first = planCapture({
    session: SESSION,
    observations: [observation],
    states: [],
    openSymbols: [],
  });
  assert.equal(first.inserts.length, 1);
  assert.equal(first.inserts[0].origin, "first_observation");

  const next = planCapture({
    session: "2026-11-06",
    observations: [observation],
    states: [{ symbol: "AAA", last_session: SESSION, last_qualified: true }],
    openSymbols: ["AAA"],
  });
  assert.equal(next.inserts.length, 0);
  assert.equal(next.skipped.open, 1);

  const gap = planCapture({
    session: "2026-11-10",
    observations: [observation],
    states: [{ symbol: "AAA", last_session: SESSION, last_qualified: false }],
    openSymbols: [],
  });
  assert.equal(gap.inserts.length, 0);
  assert.equal(gap.skipped.gap, 1);

  const rearm = planCapture({
    session: "2026-11-06",
    observations: [observation],
    states: [{ symbol: "AAA", last_session: SESSION, last_qualified: false }],
    openSymbols: [],
  });
  assert.equal(rearm.inserts.length, 1);
  assert.equal(rearm.inserts[0].origin, "rearm");
});

test("the signal close is not the fill, a gap stops at the open, and the same bar is not a target win", () => {
  const snapshot = {
    symbol: "AAA",
    signal_session: SESSION,
    signal_close: 100,
    initial_stop: 90,
    target_price: null,
    observed_at: NOW.toISOString(),
  };
  const waiting = reviewEpisode({
    snapshot,
    bars: [{ date: SESSION, open: 99, high: 130, low: 80, close: 100 }],
    spyBars: [],
    lastSession: SESSION,
  });
  assert.equal(waiting.status, "untriggered");
  assert.equal(waiting.entry_open, null);
  assert.equal(snapshot.signal_close, 100);

  const ahead = reviewEpisode({
    snapshot,
    bars: [{ date: "2026-11-09", open: 140, high: 150, low: 130, close: 145 }],
    spyBars: [],
    lastSession: SESSION,
  });
  assert.equal(ahead.status, "untriggered");

  const gap = reviewEpisode({
    snapshot,
    bars: [{ date: "2026-11-06", open: 88, high: 89, low: 87, close: 88 }],
    spyBars: [],
    lastSession: "2026-11-06",
  });
  assert.equal(gap.status, "loss");
  assert.equal(gap.reason, "gap");
  assert.equal(gap.exit_price, 88);
  assert.equal(gap.r_multiple, 0);
  assert.ok(gap.r_net < 0);

  const both = resolveIntraday({ open: 100, high: 120, low: 80, stop: 90, target: 110 });
  assert.equal(both.status, "ambiguous");
  assert.equal(both.exit, null);

  const stopOnly = resolveIntraday({ open: 100, high: 120, low: 80, stop: 90, target: null });
  assert.equal(stopOnly.status, "loss");
  assert.equal(stopOnly.exit, 90);

  const expired = reviewEpisode({
    snapshot,
    bars: [{ date: "2026-11-16", open: 101, high: 102, low: 100, close: 101 }],
    spyBars: [],
    lastSession: "2026-11-16",
  });
  assert.equal(expired.status, "expired");
  assert.equal(expired.path_5, null);
});

test("path returns wait, a missing SPY stays blank, and a journal note is not the model result", () => {
  const snapshot = {
    symbol: "AAA",
    signal_session: SESSION,
    signal_close: 100,
    initial_stop: 90,
    target_price: null,
  };
  const bars = ["2026-11-06", "2026-11-09", "2026-11-10", "2026-11-12", "2026-11-13"].map((date) => ({
    date, open: 100, high: 101, low: 99, close: 100,
  }));
  const reviewed = reviewEpisode({
    snapshot,
    bars,
    spyBars: [{ date: "2026-11-06", open: 500, close: 500 }],
    lastSession: "2026-11-13",
  });
  assert.equal(reviewed.status, "open");
  assert.equal(reviewed.path_5_status, "completed");
  assert.equal(reviewed.spy_5, null);
  assert.equal(reviewed.excess_5, null);
  assert.equal(reviewed.path_10_status, "pending");
  assert.equal(snapshot.initial_stop, 90);

  const matches = journalMatches({
    symbol: "AAA",
    signal_session: SESSION,
    entry_date: "2026-11-06",
    exit_date: null,
  }, [
    { ticker: "AAA", opened_on: "2026-11-06", shares: 10 },
    { ticker: "BBB", opened_on: "2026-11-06", shares: 4 },
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].shares, 10);

  const summary = summarizeOutcomes([
    { status: "win", r_multiple: 1, r_net: 0.9 },
    { status: "loss", r_multiple: -1, r_net: -1.1 },
    { status: "untriggered" },
    { status: "open" },
    { status: "expired" },
    { status: "ambiguous" },
    { status: "data_insufficient" },
  ]);
  assert.equal(summary.denominator, 2);
  assert.equal(summary.winRate, 0.5);
  assert.equal(summary.pending, 2);
  assert.equal(summary.avgR, null);
  assert.equal(summary.withheld, true);
  assert.equal(summary.counts.expired, 1);
});

test("an unfinished Buy without a stop is not stored as a win, and the universe names the laggard", () => {
  const observed = observeSymbol({
    symbol: "aaa",
    quote: { ...quote("AAA"), suggested_stop: null },
    business: { coverage: "ready", signal: "Buy", period: "2026-06-30", fetchedAt: "2026-10-26T00:00:00Z" },
    earningsDate: null,
    regime: { state: "missing", regime: null, asOf: null },
    session: SESSION,
    observedAt: NOW.toISOString(),
  });
  assert.equal(observed.qualified, false);
  assert.equal(observed.unusableBuy, true);

  const universe = universeReady(["BBB", "AAA", "SPY"], {
    AAA: { bar_date: SESSION },
    BBB: { bar_date: "2026-11-04" },
    SPY: { bar_date: "2026-10-01" },
  }, SESSION);
  assert.equal(universe.complete, false);
  assert.deepEqual(universe.behind, [{ symbol: "BBB", barDate: "2026-11-04" }]);
  assert.equal(universe.symbols.includes("SPY"), false);
});
