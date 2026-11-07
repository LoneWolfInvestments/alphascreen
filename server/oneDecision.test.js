import assert from "node:assert/strict";
import test from "node:test";
import { factsFromFinnhubPayload } from "../src/lib/businessFundamentals.js";
import { buildDecisionRows } from "../src/lib/decisionBook.js";
import { priceSessionSummary, summarizeHealth } from "../src/lib/dataHealth.js";
import { holdingsAccess } from "../src/lib/holdingsAccess.js";
import { whatWouldChange } from "../src/lib/signalAssessment.js";
import { observeSymbol } from "../src/lib/modelSignals.js";

const NOW = new Date("2026-11-06T21:00:00Z");
const TODAY = "2026-11-06";

function companyRow(ticker) {
  return {
    ticker,
    ...factsFromFinnhubPayload({
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
    }, { fetchedAt: "2026-10-26T00:00:00Z" }),
  };
}

function quote(symbol, label, price = 100, stop = 90) {
  return {
    symbol,
    price,
    setup_label: label,
    suggested_stop: stop,
    chandelier_stop: price + 10,
    bar_date: TODAY,
    rs_composite: 1,
  };
}

test("a positive company and a closed trend share one Avoid decision", () => {
  const book = buildDecisionRows({
    quotes: [quote("AMKR", "Avoid-downtrend", 40, 35)],
    fundamentals: [companyRow("AMKR")],
    holdingsKnown: false,
    now: NOW,
    today: TODAY,
  });
  const row = book.byTicker.get("AMKR");
  assert.equal(row.assessment, "Avoid / Not ready");
  assert.equal(row.fundamentals, "Positive");
  assert.equal(row.technicals, "Negative");
  assert.match(row.reason, /not a sell/i);
  assert.match(whatWouldChange(row), /do not override a closed trend/i);
  assert.doesNotMatch(row.positives.join(" "), /Business score/);
  assert.match(row.positives.join(" "), /Earnings growth/);

  const observed = observeSymbol({
    symbol: "AMKR",
    quote: quote("AMKR", "Avoid-downtrend", 40, 35),
    business: { coverage: "ready", signal: "Buy", summary: row.positives[0], period: "2026-06-30", fetchedAt: "2026-10-26T00:00:00Z" },
    regime: { state: "fresh", regime: "red", asOf: TODAY },
    session: TODAY,
    observedAt: NOW.toISOString(),
  });
  assert.equal(observed.qualified, false);
  assert.equal(observed.assessment, row.assessment);
});

test("a fresh trigger with a red market stays a buy candidate and names the warning", () => {
  const book = buildDecisionRows({
    quotes: [quote("AAPL", "Pullback")],
    fundamentals: [companyRow("AAPL")],
    holdingsKnown: true,
    holdings: [],
    stress: { as_of: TODAY, regime: "red", spy_bar_date: TODAY },
    now: NOW,
    today: TODAY,
  });
  const row = book.byTicker.get("AAPL");
  assert.equal(row.assessment, "Buy candidate");
  assert.equal(row.supporting, "Negative");
  assert.match(row.reason, /does not cancel/i);
  assert.match(book.regimeLine, /not the price session/);
});

test("exit review requires a known holding, and a signed-out book is not zero", () => {
  const held = buildDecisionRows({
    quotes: [quote("NVDA", "Breakout", 100, 90)],
    fundamentals: [companyRow("NVDA")],
    holdingsKnown: true,
    holdings: [{ ticker: "NVDA", shares: 10, cost_basis: 80 }],
    now: NOW,
    today: TODAY,
  });
  assert.equal(held.byTicker.get("NVDA").assessment, "Sell / Exit review");
  const unheld = buildDecisionRows({
    quotes: [quote("NVDA", "Breakout", 100, 90)],
    fundamentals: [companyRow("NVDA")],
    holdingsKnown: false,
    holdings: [{ ticker: "NVDA", shares: 10, cost_basis: 80 }],
    now: NOW,
    today: TODAY,
  });
  assert.notEqual(unheld.byTicker.get("NVDA").assessment, "Sell / Exit review");

  assert.equal(holdingsAccess({ ready: true, signedIn: false, count: 0 }).status, "private");
  assert.equal(holdingsAccess({ ready: false, signedIn: true }).status, "loading");
  assert.equal(holdingsAccess({ ready: true, signedIn: true, error: { message: "nope" } }).status, "error");
  assert.equal(holdingsAccess({ ready: true, signedIn: true, count: 0 }).status, "empty");
  assert.equal(holdingsAccess({ ready: true, signedIn: true, count: 2 }).status, "ready");
});

test("the price session line matches status and is separate from the market light", () => {
  const quotes = [{ bar_date: "2026-11-06" }, { bar_date: "2026-11-05" }];
  const prices = priceSessionSummary(quotes, NOW);
  const health = summarizeHealth({ quotes, now: NOW });
  assert.equal(health.lines[0], prices.lines[0]);
  assert.match(prices.lines[0], /2026-11-06/);
  assert.match(prices.lines[1], /1 one day behind/);
});
