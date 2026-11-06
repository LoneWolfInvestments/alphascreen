import assert from "node:assert/strict";
import test from "node:test";
import {
  calculatePositionSize,
  formatUsdFromCents,
  readPositionForm,
  zeroShareMessage,
} from "../src/lib/positionSize.js";

test("1% risk on a $5 stop buys whole shares and spends the risk budget", () => {
  const result = calculatePositionSize({
    portfolioUsd: 10000,
    entryUsd: 100,
    stopUsd: 95,
    riskPercent: 1,
  });
  assert.equal(result.ok, true);
  assert.equal(result.shares, 20);
  assert.equal(result.riskBudgetCents, 10000);
  assert.equal(result.costCents, 200000);
  assert.equal(result.plannedLossCents, 10000);
  assert.equal(result.limitedBy, "risk");
  assert.equal(result.cashSupplied, false);
  assert.equal(result.profitCents, null);
  assert.equal(result.rewardRisk, null);
  assert.match(result.warnings.join(" "), /does not know what you can spend/);
  assert.equal(formatUsdFromCents(result.costCents), "$2,000.00");
});

test("share count rounds down and the planned loss stays inside the budget", () => {
  const result = calculatePositionSize({
    portfolioUsd: 10000,
    entryUsd: 100,
    stopUsd: 70,
    riskPercent: 1,
  });
  assert.equal(result.riskBudgetCents, 10000);
  assert.equal(result.shares, 3);
  assert.equal(result.plannedLossCents, 9000);
  assert.ok(result.plannedLossCents <= result.riskBudgetCents);
  assert.match(result.warnings.join(" "), /rounded down/i);
});

test("a tight stop cannot spend more than the portfolio when cash is blank", () => {
  const result = calculatePositionSize({
    portfolioUsd: 10000,
    entryUsd: 100,
    stopUsd: 99.99,
    riskPercent: 1,
  });
  assert.equal(result.shares, 100);
  assert.equal(result.costCents, 1_000_000);
  assert.equal(result.plannedLossCents, 100);
  assert.equal(result.limitedBy, "portfolio");
  assert.equal(result.cashSupplied, false);
  assert.match(result.warnings.join(" "), /not buying power/);
  assert.equal(result.overNameCap, true);
});

test("entered cash caps the shares, and blank cash is not treated as zero", () => {
  const capped = calculatePositionSize({
    portfolioUsd: 100000,
    entryUsd: 100,
    stopUsd: 90,
    riskPercent: 1,
    cashUsd: 500,
  });
  assert.equal(capped.shares, 5);
  assert.equal(capped.costCents, 50000);
  assert.equal(capped.plannedLossCents, 5000);
  assert.equal(capped.limitedBy, "cash");

  const blank = calculatePositionSize({
    portfolioUsd: 100000,
    entryUsd: 100,
    stopUsd: 90,
    riskPercent: 1,
  });
  assert.equal(blank.shares, 100);
  assert.equal(blank.cashSupplied, false);
  assert.notEqual(blank.shares, 0);
});

test("zero shares name the binding constraint", () => {
  const byRisk = calculatePositionSize({
    portfolioUsd: 1000,
    entryUsd: 500,
    stopUsd: 450,
    riskPercent: 1,
  });
  assert.equal(byRisk.shares, 0);
  assert.equal(byRisk.zeroReason, "risk");
  assert.match(zeroShareMessage(byRisk.zeroReason), /0 shares/);

  const byCash = calculatePositionSize({
    portfolioUsd: 100000,
    entryUsd: 100,
    stopUsd: 90,
    riskPercent: 1,
    cashUsd: 50,
  });
  assert.equal(byCash.shares, 0);
  assert.equal(byCash.zeroReason, "cash");

  const byPortfolio = calculatePositionSize({
    portfolioUsd: 40,
    entryUsd: 50,
    stopUsd: 40,
    riskPercent: 50,
  });
  assert.equal(byPortfolio.shares, 0);
  assert.equal(byPortfolio.zeroReason, "portfolio");
});

test("target profit and reward to risk use the same cents as the stop", () => {
  const result = calculatePositionSize({
    portfolioUsd: 10000,
    entryUsd: 100,
    stopUsd: 95,
    riskPercent: 1,
    targetUsd: 110,
  });
  assert.equal(result.shares, 20);
  assert.equal(result.profitCents, 20000);
  assert.equal(result.rewardRisk, 2);
});

test("invalid prices, risk, and cash are rejected without a share count", () => {
  const cases = [
    [{ portfolioUsd: 0, entryUsd: 10, stopUsd: 9 }, "portfolio"],
    [{ portfolioUsd: -1, entryUsd: 10, stopUsd: 9 }, "portfolio"],
    [{ portfolioUsd: Number.NaN, entryUsd: 10, stopUsd: 9 }, "portfolio"],
    [{ portfolioUsd: Number.POSITIVE_INFINITY, entryUsd: 10, stopUsd: 9 }, "portfolio"],
    [{ portfolioUsd: 1000, entryUsd: 10.125, stopUsd: 9 }, "entry"],
    [{ portfolioUsd: 1000, entryUsd: 10, stopUsd: 10 }, "stop"],
    [{ portfolioUsd: 1000, entryUsd: 10, stopUsd: 11 }, "stop"],
    [{ portfolioUsd: 1000, entryUsd: 10, stopUsd: 9, riskPercent: 0 }, "risk"],
    [{ portfolioUsd: 1000, entryUsd: 10, stopUsd: 9, riskPercent: 101 }, "risk"],
    [{ portfolioUsd: 1000, entryUsd: 10, stopUsd: 9, riskPercent: Number.NaN }, "risk"],
    [{ portfolioUsd: 1000, entryUsd: 10, stopUsd: 9, cashUsd: -5 }, "cash"],
    [{ portfolioUsd: 1000, entryUsd: 10, stopUsd: 9, cashUsd: 1000.01 }, "cash"],
    [{ portfolioUsd: 1000, entryUsd: 10, stopUsd: 9, targetUsd: 10 }, "target"],
    [{ portfolioUsd: 1000, entryUsd: 10, stopUsd: 9, targetUsd: 9 }, "target"],
  ];
  for (const [input, field] of cases) {
    const result = calculatePositionSize(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.shares, null);
    assert.ok(result.errors.some((item) => item.field === field), JSON.stringify(result.errors));
  }
});

test("cent dust does not change the share count", () => {
  const clean = calculatePositionSize({ portfolioUsd: 10000, entryUsd: 19.99, stopUsd: 18.01, riskPercent: 1 });
  const dusty = calculatePositionSize({
    portfolioUsd: 10000,
    entryUsd: 19.99,
    stopUsd: 18.01 + 1e-12,
    riskPercent: 1,
  });
  assert.equal(clean.ok, true);
  assert.equal(dusty.ok, true);
  assert.equal(dusty.shares, clean.shares);
  assert.equal(clean.plannedLossCents, clean.shares * 198);
});

test("the form treats blank cash as unknown and rejects junk", () => {
  const ready = readPositionForm({ portfolio: "$10,000.00", entry: "100", stop: "95", risk: "1%" });
  assert.equal(ready.status, "ready");
  assert.equal(ready.result.shares, 20);
  assert.equal(ready.result.cashSupplied, false);

  const zeroCash = readPositionForm({ portfolio: "10000", entry: "100", stop: "95", risk: "1", cash: "0" });
  assert.equal(zeroCash.status, "ready");
  assert.equal(zeroCash.result.shares, 0);
  assert.equal(zeroCash.result.zeroReason, "cash");

  assert.equal(readPositionForm({}).status, "blank");
  assert.equal(readPositionForm({ portfolio: "10000" }).status, "incomplete");
  const junk = readPositionForm({ portfolio: "1e5", entry: "100", stop: "95", risk: "1" });
  assert.equal(junk.status, "invalid");
  assert.equal(junk.errors[0].field, "portfolio");
  const fraction = readPositionForm({ portfolio: "10000", entry: "10.125", stop: "9", risk: "1" });
  assert.equal(fraction.status, "invalid");
});
