import assert from "node:assert/strict";
import test from "node:test";
import { freshnessSentence, lastCompletedSession, sessionsBehind } from "../src/lib/sessionClock.js";

test("the completed session skips weekends, the close, and Thanksgiving", () => {
  assert.equal(lastCompletedSession(new Date("2026-11-06T07:00:00Z")), "2026-11-05");
  assert.equal(lastCompletedSession(new Date("2026-11-06T21:30:00Z")), "2026-11-06");
  assert.equal(lastCompletedSession(new Date("2026-11-07T17:00:00Z")), "2026-11-06");
  assert.equal(lastCompletedSession(new Date("2026-11-09T15:00:00Z")), "2026-11-06");
  assert.equal(lastCompletedSession(new Date("2026-11-26T17:00:00Z")), "2026-11-25");
});

test("a newer download does not move a price session forward", () => {
  const behind = sessionsBehind("2026-11-04", new Date("2026-11-06T07:00:00Z"));
  assert.equal(behind.state, "delayed");
  assert.equal(behind.sessionsBehind, 1);
  assert.equal(behind.latest, "2026-11-05");
  const sameBarsLaterFetch = sessionsBehind("2026-11-04", new Date("2026-11-06T07:00:00Z"));
  assert.deepEqual(sameBarsLaterFetch, behind);

  const current = sessionsBehind("2026-11-05", new Date("2026-11-06T07:00:00Z"));
  assert.equal(current.state, "fresh");
  assert.equal(current.sessionsBehind, 0);

  const old = sessionsBehind("2026-10-29", new Date("2026-11-06T07:00:00Z"));
  assert.equal(old.state, "stale");
  assert.ok(old.sessionsBehind >= 2);
  assert.match(freshnessSentence(old, "prices"), /not a buy or sell today/);

  assert.equal(sessionsBehind(null, new Date("2026-11-06T07:00:00Z")).state, "missing");
  assert.equal(sessionsBehind("2026-11-06", new Date("2026-11-06T07:00:00Z")).state, "ahead");
});
