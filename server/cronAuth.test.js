import assert from "node:assert/strict";
import test from "node:test";
import { cronAuthorized } from "./cronAuth.js";

test("a missing cron secret fails closed, including Bearer undefined", () => {
  assert.equal(cronAuthorized("Bearer undefined", undefined), false);
  assert.equal(cronAuthorized("Bearer undefined", null), false);
  assert.equal(cronAuthorized("Bearer undefined", ""), false);
  assert.equal(cronAuthorized("Bearer undefined", "undefined"), false);
  assert.equal(cronAuthorized(undefined, undefined), false);
});

test("the real secret still matches", () => {
  assert.equal(cronAuthorized("Bearer top-secret", "top-secret"), true);
});

test("a wrong or missing header is rejected when the secret is set", () => {
  assert.equal(cronAuthorized("Bearer no", "top-secret"), false);
  assert.equal(cronAuthorized(undefined, "top-secret"), false);
  assert.equal(cronAuthorized("top-secret", "top-secret"), false);
});
