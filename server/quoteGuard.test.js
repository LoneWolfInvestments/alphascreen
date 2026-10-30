import assert from "node:assert/strict";
import test from "node:test";
import { allowedInterval, clampOutputSize, normalizeSymbol } from "./quoteGuard.js";

test("accepts tickers and VIX, rejects anything else", () => {
  assert.equal(normalizeSymbol(" vix "), "VIX");
  assert.equal(normalizeSymbol("brk.b"), "BRK.B");
  assert.equal(normalizeSymbol("EUR/USD"), null);
  assert.equal(normalizeSymbol("DROP TABLE"), null);
  assert.equal(normalizeSymbol(""), null);
});

test("caps history size and interval", () => {
  assert.equal(clampOutputSize("30"), 30);
  assert.equal(clampOutputSize("5000"), 60);
  assert.equal(clampOutputSize("nope"), 30);
  assert.equal(allowedInterval(undefined), "1day");
  assert.equal(allowedInterval("1min"), null);
});
