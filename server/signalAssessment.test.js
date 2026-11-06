import assert from "node:assert/strict";
import test from "node:test";
import { ASSESSMENT, PILLAR, assessSignal, matchesFilter } from "../src/lib/signalAssessment.js";
import { resolveRoute } from "../src/lib/appRoutes.js";

const fresh = {
  freshness: "fresh",
  barDate: "2026-10-29",
  earningsDate: "2026-12-01",
  earningsSoon: false,
  regimeState: "fresh",
  regime: "green",
  regimeAsOf: "2026-10-29",
  rsRank: 3,
  rsCount: 10,
};

test("buy candidate needs positive company figures and a fresh trigger", () => {
  const row = assessSignal({
    ...fresh,
    ticker: "AAA",
    held: false,
    label: "Breakout",
    stop: 90,
    businessCoverage: "ready",
    businessSignal: "Buy",
  });
  assert.equal(row.assessment, ASSESSMENT.BUY);
  assert.equal(row.fundamentals, PILLAR.POSITIVE);
  assert.equal(row.technicals, PILLAR.POSITIVE);
  assert.equal(row.supporting, PILLAR.POSITIVE);
  assert.match(row.reason, /not an order/);
  assert.match(row.invalidation, /2×ATR/);
});

test("unknown or stale company figures do not confirm a buy", () => {
  const missing = assessSignal({
    ...fresh,
    ticker: "BBB",
    label: "Pullback",
    businessCoverage: "missing",
    businessSignal: null,
  });
  assert.equal(missing.assessment, ASSESSMENT.WAIT);
  assert.equal(missing.fundamentals, PILLAR.UNKNOWN);
  assert.match(missing.reason, /unknown/i);
  assert.equal(missing.positives.some((line) => /company figures meet/i.test(line)), false);

  const stale = assessSignal({
    ...fresh,
    ticker: "CCC",
    label: "Breakout",
    businessCoverage: "stale",
    businessSignal: "Buy",
  });
  assert.equal(stale.fundamentals, PILLAR.UNKNOWN);
  assert.notEqual(stale.assessment, ASSESSMENT.BUY);
});

test("positive business and negative technicals stay visible and are not a buy", () => {
  const row = assessSignal({
    ...fresh,
    ticker: "DDD",
    held: false,
    label: "Avoid-downtrend",
    businessCoverage: "ready",
    businessSignal: "Buy",
    businessSummary: "Margins are healthy.",
  });
  assert.equal(row.assessment, ASSESSMENT.AVOID);
  assert.equal(row.fundamentals, PILLAR.POSITIVE);
  assert.equal(row.technicals, PILLAR.NEGATIVE);
  assert.match(row.reason, /not a buy/);
  assert.match(row.reason, /not a sell/);
  assert.ok(row.positives.length > 0);
  assert.ok(row.negatives.length > 0);
});

test("a fresh trigger with negative business is wait, and earnings block a new buy", () => {
  const conflict = assessSignal({
    ...fresh,
    ticker: "EEE",
    label: "Pullback",
    businessCoverage: "ready",
    businessSignal: "Caution",
  });
  assert.equal(conflict.assessment, ASSESSMENT.WAIT);
  assert.equal(conflict.technicals, PILLAR.POSITIVE);
  assert.equal(conflict.fundamentals, PILLAR.NEGATIVE);
  assert.match(conflict.reason, /not a confident buy/);

  const earnings = assessSignal({
    ...fresh,
    ticker: "FFF",
    label: "Breakout",
    businessCoverage: "ready",
    businessSignal: "Buy",
    earningsSoon: true,
    earningsDate: "2026-11-04",
  });
  assert.equal(earnings.assessment, ASSESSMENT.WAIT);
  assert.equal(earnings.avoidNewEntry, true);
  assert.equal(earnings.supporting, PILLAR.NEGATIVE);
  assert.match(earnings.reason, /five sessions/);
});

test("sell is only an exit review for a held name, and a red market does not veto a candidate", () => {
  const exit = assessSignal({
    ...fresh,
    ticker: "GGG",
    held: true,
    label: "Avoid-downtrend",
    exitStatus: "red",
    exitStop: 50,
    businessCoverage: "ready",
    businessSignal: "Hold",
  });
  assert.equal(exit.assessment, ASSESSMENT.EXIT);
  assert.match(exit.invalidation, /trailing exit/);
  assert.match(exit.reason, /not an automatic order/);

  const heldTrend = assessSignal({
    ...fresh,
    ticker: "HHH",
    held: true,
    label: "Avoid-downtrend",
    exitStatus: "green",
    businessCoverage: "ready",
    businessSignal: "Hold",
  });
  assert.equal(heldTrend.assessment, ASSESSMENT.WAIT);
  assert.notEqual(heldTrend.assessment, ASSESSMENT.EXIT);

  const cautiousTape = assessSignal({
    ...fresh,
    ticker: "III",
    label: "Breakout",
    businessCoverage: "ready",
    businessSignal: "Buy",
    regime: "red",
  });
  assert.equal(cautiousTape.assessment, ASSESSMENT.BUY);
  assert.equal(cautiousTape.supporting, PILLAR.NEGATIVE);
  assert.ok(cautiousTape.negatives.some((line) => /Market light/.test(line)));
});

test("stale prices are a data check and an uptrend without a trigger waits", () => {
  const stale = assessSignal({
    ...fresh,
    ticker: "JJJ",
    freshness: "stale",
    label: "Breakout",
    businessCoverage: "ready",
    businessSignal: "Buy",
  });
  assert.equal(stale.assessment, ASSESSMENT.DATA);
  assert.equal(stale.technicals, PILLAR.UNKNOWN);
  assert.match(stale.reason, /not a buy/);

  const wait = assessSignal({
    ...fresh,
    ticker: "KKK",
    label: "Uptrend-no-trigger",
    businessCoverage: "ready",
    businessSignal: "Buy",
  });
  assert.equal(wait.assessment, ASSESSMENT.WAIT);
  assert.equal(wait.technicals, PILLAR.MIXED);
  assert.match(wait.trigger, /Wait/);
});

test("filters and old tab names land on the right screen", () => {
  assert.equal(matchesFilter(ASSESSMENT.BUY, "buy"), true);
  assert.equal(matchesFilter(ASSESSMENT.EXIT, "sell"), true);
  assert.equal(matchesFilter(ASSESSMENT.AVOID, "sell"), false);
  assert.equal(matchesFilter(ASSESSMENT.DATA, "data"), true);
  assert.equal(matchesFilter(ASSESSMENT.WAIT, "all"), true);

  assert.equal(resolveRoute("").view, "signals");
  assert.equal(resolveRoute("?tab=today").view, "signals");
  assert.equal(resolveRoute("?tab=opportunities").view, "signals");
  assert.equal(resolveRoute("?tab=overview").view, "signals");
  assert.equal(resolveRoute("?tab=mag7").view, "mag7");
  assert.deepEqual(resolveRoute("?tab=sell"), { view: "book", section: "exits", symbol: null });
  assert.deepEqual(resolveRoute("?tab=size"), { view: "book", section: "size", symbol: null });
  assert.deepEqual(resolveRoute("?tab=portfolio"), { view: "book", section: "holdings", symbol: null });
  assert.deepEqual(resolveRoute("?tab=journal"), { view: "book", section: "journal", symbol: null });
  assert.deepEqual(resolveRoute("?tab=technical"), { view: "more", section: "setups", symbol: null });
  assert.deepEqual(resolveRoute("?tab=study"), { view: "more", section: "study", symbol: null });
  assert.deepEqual(resolveRoute("?tab=fundamental"), { view: "more", section: "fundamentals", symbol: null });
  assert.equal(resolveRoute("?tab=signals&symbol=msft").symbol, "MSFT");
});
