import assert from "node:assert/strict";
import test from "node:test";

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("ask-analyst rejects anonymous callers and oversized bodies", async () => {
  const { default: handler } = await import("../api/ask-analyst.js");

  const missingAuth = mockRes();
  await handler({ method: "POST", headers: {}, body: { question: "Bear case for NVDA?" } }, missingAuth);
  assert.equal(missingAuth.statusCode, 401);

  const tooBig = mockRes();
  await handler({ method: "POST", headers: { "content-length": "99999" }, body: {} }, tooBig);
  assert.equal(tooBig.statusCode, 413);

  const wrongMethod = mockRes();
  await handler({ method: "GET", headers: {} }, wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);
});

test("quote rejects anonymous callers before using Twelve Data", async () => {
  const { default: handler } = await import("../api/quote.js");

  const missingAuth = mockRes();
  await handler({ method: "GET", headers: {}, query: { symbol: "AAPL" } }, missingAuth);
  assert.equal(missingAuth.statusCode, 401);

  const wrongMethod = mockRes();
  await handler({ method: "POST", headers: {}, query: { symbol: "AAPL" } }, wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);
});

test("cron fails closed when CRON_SECRET is unset, even for Bearer undefined", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-not-real";
  delete process.env.CRON_SECRET;

  const { default: handler } = await import("../api/cron-refresh-mag7.js");
  const res = mockRes();
  await handler({ headers: { authorization: "Bearer undefined" }, query: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "Unauthorized");
});
