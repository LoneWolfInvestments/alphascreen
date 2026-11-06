import assert from "node:assert/strict";
import test from "node:test";
import { decideAction } from "../src/lib/signalBoard.js";
import { readBusinessFundamentals } from "../src/lib/businessFundamentals.js";
import { technicalReadFromQuote } from "../src/lib/swingSetups.js";
import { presentRegime } from "../src/lib/marketStress.js";

const NOW = new Date("2026-11-06T15:00:00Z");

function business(signal) {
  return { signal, score: signal === "Buy" ? 70 : 40, coverage: "ready", summary: "Business.", hasFigures: true };
}

function technical(sig, extra = {}) {
  return {
    sig,
    label: sig === "Buy" ? "Breakout" : sig === "Sell" ? "Avoid-downtrend" : "Uptrend-no-trigger",
    displayLabel: sig === "Buy" ? "Breakout" : "Avoid-downtrend",
    reasons: ["Price session 2026-11-05."],
    freshness: { state: "fresh", barDate: "2026-11-05", latest: "2026-11-05", sessionsBehind: 0 },
    stop: 90,
    ...extra,
  };
}

test("business and price disagreements stay visible, and a stop is a different rule", () => {
  const disagree = decideAction({
    business: business("Buy"),
    technical: technical("Sell"),
    held: true,
    sell: { status: "green", stop: 80 },
  });
  assert.equal(disagree.category, "Business and price disagree");
  assert.match(disagree.headline, /not a broken calculation/);

  const exit = decideAction({
    business: business("Buy"),
    technical: technical("Buy"),
    held: true,
    sell: { status: "red", stop: 80 },
  });
  assert.equal(exit.category, "Exit rule hit");
  assert.match(exit.reasons.join(" "), /not averaged/);
  assert.notEqual(exit.category, "New buy candidate");

  const both = decideAction({
    business: business("Buy"),
    technical: technical("Buy"),
    held: false,
    regime: { state: "fresh", regime: "red", asOf: "2026-11-05" },
  });
  assert.equal(both.category, "New buy candidate");
  assert.match(both.reasons.join(" "), /does not cancel the setup/);
});

test("stale prices and stale fundamentals are not actionable, including null inputs", () => {
  const stalePrice = technicalReadFromQuote({
    setup_label: "Breakout",
    setup_reason: "Broke out today.",
    bar_date: "2026-10-29",
    updated_at: "2026-11-06T15:00:00Z",
    suggested_stop: 10,
  }, { now: NOW });
  assert.equal(stalePrice.sig, null);
  assert.match(stalePrice.displayLabel, /not current/);
  const decision = decideAction({ business: business("Buy"), technical: stalePrice, held: false });
  assert.equal(decision.category, "Not current");
  assert.notEqual(decision.category, "New buy candidate");

  const staleBusiness = readBusinessFundamentals({
    revenue_growth_yoy: 0.2,
    earnings_state: "available",
    earnings_growth_yoy: 0.2,
    eps: 2,
    pe_ratio: 15,
    margin_current: 0.2,
    margin_prior: 0.1,
    margin_basis: "quarterly_yoy",
    fundamentals_period: "2024-01-31",
    fundamentals_as_of: "2026-11-01T00:00:00Z",
  }, { now: NOW });
  assert.equal(staleBusiness.signal, null);
  const mixed = decideAction({
    business: staleBusiness,
    technical: technical("Buy"),
    held: false,
  });
  assert.equal(mixed.category, "Not current");

  const empty = decideAction({});
  assert.equal(empty.category, "Not enough saved data");
  assert.equal(empty.businessSignal, null);
  assert.equal(empty.technicalSignal, null);
});

test("a market light from an older session is not shown as current", () => {
  const old = presentRegime({
    as_of: "2026-10-29",
    regime: "green",
    reason: "Favorable for swing longs.",
    updated_at: "2026-11-06T15:00:00Z",
    spy_bar_date: "2026-10-29",
  }, NOW);
  assert.equal(old.state, "stale");
  assert.equal(old.regime, null);
  assert.match(old.headline, /not a buy or sell today/);

  const mixed = presentRegime({
    as_of: "2026-11-05",
    regime: "green",
    spy_bar_date: "2026-11-03",
    updated_at: "2026-11-06T15:00:00Z",
  }, NOW);
  assert.equal(mixed.state, "mixed");
  assert.equal(mixed.regime, null);
});
