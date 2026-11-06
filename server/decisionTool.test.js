import assert from "node:assert/strict";
import test from "node:test";
import { buildResearchQueue } from "../src/lib/researchQueue.js";
import { assessBook } from "../src/lib/portfolioRisk.js";
import { monthlyReview, realisedResult, validateJournalEntry, SINGLE_FILL_LIMIT } from "../src/lib/tradeJournal.js";
import { summarizeHealth } from "../src/lib/dataHealth.js";
import { jobStatusFromBody, sanitizeJobText } from "./jobLog.js";
import { applyFriction, simulateBook, stepBar } from "../src/lib/strategySim.js";

const NOW = new Date("2026-10-30T17:00:00Z");

test("a fresh setup with missing company data stays a research candidate and is not a confirmed buy", () => {
  const queue = buildResearchQueue([
    { ticker: "AMD", held: false, label: "Breakout", freshness: "fresh", reason: "Broke out today.", stop: 90, rsRank: 2, businessCoverage: "missing", barDate: "2026-10-29" },
    { ticker: "ZZ", held: false, label: "Breakout", freshness: "fresh", reason: "Broke out today.", stop: 10, rsRank: 1, businessCoverage: "stale", earningsSoon: true },
    { ticker: "OWN", held: true, label: "Breakout", freshness: "fresh", rsRank: 1 },
    { ticker: "OLD", held: false, label: "Breakout", freshness: "stale", reason: "Old.", stop: 8 },
    { ticker: "WAIT", held: false, label: "Uptrend-no-trigger", freshness: "fresh", reason: "No trigger.", rsRank: 3, businessCoverage: "ready", businessSignal: "Buy" },
  ]);
  assert.deepEqual(queue.candidates.map((row) => row.ticker), ["ZZ", "AMD"]);
  assert.match(queue.candidates[1].company, /not a confirmed buy/);
  assert.match(queue.candidates[0].company, /not a confirmed buy/);
  assert.equal(queue.candidates[0].avoidNewEntry, true);
  assert.equal(queue.waiting[0].status, "Wait");
  assert.match(queue.waiting[0].trigger, /Wait/);
  assert.equal(queue.notCurrent[0].ticker, "OLD");
  assert.match(queue.rankBasis, /combined score/i);
  assert.equal(JSON.stringify(queue).includes("confirmed buy\": true"), false);
});

test("planned downside ignores gains, stale prices, missing stops, and stops already through", () => {
  const book = assessBook({
    holdings: [
      { ticker: "AAA", shares: 10, cost_basis: 50, theme: "Widgets", sector: "Industrials" },
      { ticker: "BBB", shares: 10, cost_basis: 20, theme: "", sector: "" },
      { ticker: "CCC", shares: 5, cost_basis: 10, theme: "Widgets", sector: "Unclassified" },
      { ticker: "DDD", shares: 4, cost_basis: 30, sector: "Energy" },
    ],
    quotesBySymbol: {
      AAA: { price: 100, chandelier_stop: 90, bar_date: "2026-10-29" },
      BBB: { price: 15, chandelier_stop: 18, bar_date: "2026-10-29" },
      CCC: { price: 12, chandelier_stop: null, bar_date: "2026-10-29" },
      DDD: { price: 40, chandelier_stop: 35, bar_date: "2026-10-01" },
    },
    now: NOW,
  });
  assert.equal(book.plannedLoss, 100);
  assert.equal(book.coveredCount, 1);
  assert.ok(book.pnlAtStop > 0);
  assert.ok(book.plannedLoss !== book.plannedLoss - book.pnlAtStop);
  assert.ok(book.missing.some((row) => row.ticker === "BBB" && row.stopState === "through"));
  assert.ok(book.missing.some((row) => row.ticker === "CCC" && row.stopState === "no-stop"));
  assert.ok(book.missing.some((row) => row.ticker === "DDD" && row.stopState === "stale"));
  assert.equal(book.freshMarketValue, 10 * 100 + 10 * 15 + 5 * 12);
  assert.ok(book.sectors.some((row) => row.label === "No sector saved"));
  assert.match(book.caveat, /not a guaranteed maximum loss/);
});

test("journal maths stay single fill and do not invent fees", () => {
  assert.match(SINGLE_FILL_LIMIT, /Partial sells are not calculated/);
  const bad = validateJournalEntry({ ticker: "aapl", status: "closed", shares: 1, entry_price: 10, planned_stop: 12 });
  assert.equal(bad.ok, false);
  const open = validateJournalEntry({ ticker: "msft", status: "open", shares: 2, entry_price: 100, planned_stop: 90, opened_on: "2026-10-01" });
  assert.equal(open.ok, true);
  const noCost = realisedResult({ status: "closed", shares: 2, entry_price: 100, exit_price: 110 });
  assert.equal(noCost.gross, 20);
  assert.equal(noCost.net, null);
  const withCost = realisedResult({ status: "closed", shares: 2, entry_price: 100, exit_price: 90, assumed_cost_usd: 3 });
  assert.equal(withCost.net, -23);
  const review = monthlyReview([
    { status: "closed", closed_on: "2026-09-15", shares: 1, entry_price: 10, exit_price: 12, process_followed: true },
    { status: "open", opened_on: "2026-10-01", shares: 1, entry_price: 10 },
  ]);
  assert.equal(review.openCount, 1);
  assert.equal(review.months[0].followed, 1);
  assert.match(review.note, /not inferred from profit/);
});

test("health never calls partial coverage healthy, and a missing job log is unknown", () => {
  const health = summarizeHealth({
    quotes: [{ bar_date: "2026-10-29" }, { bar_date: "2026-10-01" }],
    fundamentals: [{ coverage: "ready" }],
    stress: null,
    jobRuns: null,
    now: NOW,
  });
  assert.equal(health.healthy, false);
  assert.equal(health.prices.fresh, 1);
  assert.equal(health.prices.stale, 1);
  assert.equal(health.jobsKnown, false);
  assert.match(health.lines.join(" "), /not a calm market/);
  assert.match(health.lines.join(" "), /Unknown is not the same as failed/);
});

test("job text drops secrets and partial failures are not marked ok", () => {
  assert.match(sanitizeJobText("failed token=abc123 and apikey=zzz bearer secret"), /\[redacted\]/);
  assert.equal(sanitizeJobText("failed token=abc123 and apikey=zzz bearer secret").includes("abc123"), false);
  assert.equal(jobStatusFromBody(200, { failed: [{ ticker: "A" }] }), "partial");
  assert.equal(jobStatusFromBody(200, { failedWindows: [{ error: "nope" }] }), "partial");
  assert.equal(jobStatusFromBody(200, { updated: 1 }), "ok");
  assert.equal(jobStatusFromBody(500, { error: "nope" }), "failed");
});

test("a gap exits at the open, and the same-day high does not raise the stop first", () => {
  const gap = stepBar({ open: 90, low: 88, stop: 95, trailAfterClose: 110 });
  assert.equal(gap.reason, "gap");
  assert.equal(gap.exit, 90);
  const touched = stepBar({ open: 100, low: 94, stop: 95, trailAfterClose: 130 });
  assert.equal(touched.reason, "stop");
  assert.equal(touched.exit, 95);
  const held = stepBar({ open: 100, low: 96, stop: 95, trailAfterClose: 97 });
  assert.equal(held.status, "hold");
  assert.equal(held.stop, 97);
  const missing = stepBar({ open: 100, low: null, stop: 95, trailAfterClose: 97 });
  assert.equal(missing.status, "incomplete");
});

test("friction, a negative trade, and an empty book stay honest", () => {
  const plain = applyFriction(100, 110, 0);
  assert.ok(Math.abs(plain - 0.1) < 1e-12);
  const costly = applyFriction(100, 110, 0.01);
  assert.ok(costly < plain);
  const loss = applyFriction(100, 90, 0.01);
  assert.ok(loss < 0);
  const book = simulateBook({ seriesBySymbol: { ARM: [{ date: "2026-10-01", open: 1, high: 1, low: 1, close: 1 }] } });
  assert.equal(book.trades.length, 0);
  assert.equal(book.warmup, 1);
  assert.equal(book.evaluation.withheld, true);
  assert.equal(book.singleTrade, true);
  assert.match(book.rules.join(" "), /not a portfolio return/);
  assert.match(book.rules.join(" "), /fundamentals are not a filter/i);
});
