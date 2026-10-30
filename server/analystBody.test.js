import assert from "node:assert/strict";
import test from "node:test";
import { MAX_QUESTION_CHARS, readAnalystBody } from "./analystBody.js";

test("accepts a normal question", () => {
  const result = readAnalystBody({ question: " Bear case for NVDA? ", context: "P/E 40" });
  assert.equal(result.question, "Bear case for NVDA?");
  assert.equal(result.context, "P/E 40");
});

test("rejects a missing question and an oversized one", () => {
  assert.equal(readAnalystBody({}).status, 400);
  assert.equal(readAnalystBody({ question: "x".repeat(MAX_QUESTION_CHARS + 1) }).status, 400);
});

test("rejects non-text context", () => {
  assert.equal(readAnalystBody({ question: "Hi", context: { leak: true } }).status, 400);
});
