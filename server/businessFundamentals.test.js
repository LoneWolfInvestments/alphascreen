import assert from "node:assert/strict";
import test from "node:test";
import {
  factsFromFinnhubPayload,
  isMissingColumnError,
  readAnalyst,
  readBusinessFundamentals,
  readOwnership,
  withoutColumns,
} from "../src/lib/businessFundamentals.js";

const NOW = new Date("2026-11-06T15:00:00Z");

function payload(overrides = {}) {
  return {
    metric: {
      peBasicExclExtraTTM: 22,
      marketCapitalization: 1000,
      epsInclExtraItemsTTM: 4,
      epsGrowthTTMYoy: 12,
      revenueGrowthTTMYoy: 9,
      revenueGrowth3Y: 40,
      netProfitMarginTTM: 20,
      netProfitMarginAnnual: 18,
      psTTM: 4,
      ...overrides.metric,
    },
    series: overrides.series || {
      quarterly: {
        netMargin: [
          { period: "2025-06-30", v: 0.16 },
          { period: "2026-06-30", v: 0.2 },
        ],
      },
    },
  };
}

test("Finnhub percents become fractions, and sales per share is not revenue", () => {
  const facts = factsFromFinnhubPayload({
    metric: {
      revenueGrowthTTMYoy: null,
      revenueGrowthQuarterlyYoy: null,
      revenueGrowth3Y: 80,
      epsInclExtraItemsTTM: 2,
      epsGrowthTTMYoy: null,
      netProfitMarginTTM: 10,
    },
    series: {
      quarterly: {
        salesPerShare: [
          { period: "2025-06-30", v: 1 },
          { period: "2026-06-30", v: 5 },
        ],
      },
    },
  }, { fetchedAt: "2026-11-02T00:00:00Z" });
  assert.equal(facts.revenue_growth_yoy, null);
  assert.equal(facts.revenue_growth_basis, null);
  assert.equal(facts.earnings_state, "missing");
  assert.equal(facts.fundamentals_source, "finnhub_basic_financials");
});

test("quarterly margin decimals are aligned to the percent snapshot", () => {
  const facts = factsFromFinnhubPayload(payload(), { fetchedAt: "2026-11-02T00:00:00Z" });
  assert.equal(facts.revenue_growth_yoy, 0.09);
  assert.equal(facts.revenue_growth_basis, "ttm_yoy");
  assert.equal(facts.earnings_state, "available");
  assert.equal(facts.earnings_growth_yoy, 0.12);
  assert.equal(facts.margin_basis, "quarterly_yoy");
  assert.ok(Math.abs(facts.margin_current - 0.2) < 1e-9);
  assert.ok(Math.abs(facts.margin_prior - 0.16) < 1e-9);
  assert.equal(facts.fundamentals_period, "2026-06-30");
  assert.equal(facts.profit_margin, 0.2);
  assert.equal(facts.market_cap, 1e9);
});

test("negative earnings, extreme growth, and a missing payload do not invent a rate", () => {
  const loss = factsFromFinnhubPayload(payload({
    metric: { epsInclExtraItemsTTM: -0.4, epsGrowthTTMYoy: 500, peBasicExclExtraTTM: -8 },
  }), { fetchedAt: "2026-11-02T00:00:00Z" });
  assert.equal(loss.earnings_state, "non_positive");
  assert.equal(loss.earnings_growth_yoy, null);

  const extreme = factsFromFinnhubPayload(payload({
    metric: { epsInclExtraItemsTTM: 0.05, epsGrowthTTMYoy: 900 },
  }), { fetchedAt: "2026-11-02T00:00:00Z" });
  assert.equal(extreme.earnings_state, "unstable");
  assert.equal(extreme.earnings_growth_yoy, null);

  const blank = readBusinessFundamentals(null, { now: NOW });
  assert.equal(blank.coverage, "missing");
  assert.equal(blank.score, null);
  assert.equal(blank.signal, null);
});

test("a ready snapshot can score, a stale statement cannot, and ownership is not an input", () => {
  const facts = factsFromFinnhubPayload(payload(), { fetchedAt: "2026-10-26T00:00:00Z" });
  const row = { ...facts, inst_net_breadth: 40, analyst_rating: "Buy" };
  const read = readBusinessFundamentals(row, { now: NOW });
  assert.equal(read.coverage, "ready");
  assert.equal(read.signal, "Buy");
  assert.ok(read.score >= 62);
  const louder = readBusinessFundamentals({ ...row, inst_net_breadth: -40, analyst_rating: "Sell" }, { now: NOW });
  assert.equal(louder.score, read.score);
  assert.equal(louder.signal, read.signal);
  assert.match(readOwnership(row).text, /not part of the business score/);
  assert.match(readAnalyst(row).text, /not part of the score/);

  const stale = readBusinessFundamentals({ ...row, fundamentals_period: "2024-01-31" }, { now: NOW });
  assert.equal(stale.coverage, "stale");
  assert.equal(stale.score, null);
  assert.equal(stale.signal, null);
  assert.match(stale.summary, /too old to score/);

  const oldFetch = readBusinessFundamentals({ ...row, fundamentals_as_of: "2026-08-01T00:00:00Z" }, { now: NOW });
  assert.equal(oldFetch.coverage, "stale");
  assert.equal(oldFetch.signal, null);

  const legacy = readBusinessFundamentals({
    pe_ratio: 12,
    eps: 1,
    profit_margin: 0.1,
    updated_at: "2026-11-06T00:00:00Z",
  }, { now: NOW });
  assert.equal(legacy.coverage, "partial");
  assert.equal(legacy.score, null);
  assert.match(legacy.summary, /not been downloaded yet/);
});

test("negative earnings block a Buy even when revenue growth is strong", () => {
  const facts = factsFromFinnhubPayload(payload({
    metric: { epsInclExtraItemsTTM: -1, epsGrowthTTMYoy: 80, peBasicExclExtraTTM: -5, revenueGrowthTTMYoy: 30 },
  }), { fetchedAt: "2026-10-26T00:00:00Z" });
  const read = readBusinessFundamentals(facts, { now: NOW });
  assert.notEqual(read.signal, "Buy");
  assert.match(read.earnings.text, /not used/);
  assert.match(read.valuation.text, /not used/);
});

test("a missing business column can be stripped without dropping the old P/E", () => {
  assert.equal(isMissingColumnError({ message: "Could not find the 'fundamentals_period' column" }, ["fundamentals_period"]), true);
  assert.equal(isMissingColumnError({ message: "connection reset" }, ["fundamentals_period"]), false);
  const row = withoutColumns({ pe_ratio: 10, fundamentals_period: "2026-06-30", revenue_growth_yoy: 0.1 }, ["fundamentals_period", "revenue_growth_yoy"]);
  assert.deepEqual(row, { pe_ratio: 10 });
});
