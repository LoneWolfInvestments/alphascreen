import assert from "node:assert/strict";
import test from "node:test";
import { rateLimit, resetRateLimits } from "./rateLimit.js";

test("allows requests inside the window and then blocks", () => {
  resetRateLimits();
  assert.equal(rateLimit("session", 2, 1000, 0), true);
  assert.equal(rateLimit("session", 2, 1000, 10), true);
  assert.equal(rateLimit("session", 2, 1000, 20), false);
});

test("old hits fall out of the window", () => {
  resetRateLimits();
  assert.equal(rateLimit("quote", 1, 1000, 0), true);
  assert.equal(rateLimit("quote", 1, 1000, 1001), true);
});
