import assert from "node:assert/strict";
import test from "node:test";
import { isMissingJobTableError, resolveJobHistory, summarizeHealth } from "../src/lib/dataHealth.js";

const NOW = new Date("2026-11-06T17:00:00Z");

function healthFor(jobHistory) {
  return summarizeHealth({
    quotes: [{ bar_date: "2026-11-05" }, { bar_date: "2026-11-04" }],
    fundamentals: [{ coverage: "ready" }, { coverage: "stale" }, { coverage: "missing" }],
    stress: null,
    jobHistory,
    now: NOW,
  });
}

test("signed-out, loading, a missing table, and a request error stay distinct", () => {
  assert.equal(resolveJobHistory({ ready: false, signedIn: true, rows: [{ status: "ok" }] }).state, "loading");
  assert.deepEqual(resolveJobHistory({ ready: true, signedIn: false, rows: [{ status: "ok" }] }).rows, []);
  assert.equal(resolveJobHistory({ ready: true, signedIn: false }).state, "signed-out");
  assert.equal(resolveJobHistory({ ready: true, signedIn: true, pending: true, rows: [{ status: "ok" }] }).state, "loading");
  assert.equal(resolveJobHistory({
    ready: true,
    signedIn: true,
    error: { message: "Could not find the table 'public.job_runs' in the schema cache", code: "PGRST205" },
  }).state, "missing-table");
  const denied = resolveJobHistory({
    ready: true,
    signedIn: true,
    error: { message: "permission denied for table job_runs" },
  });
  assert.equal(denied.state, "error");
  assert.equal(denied.rows.length, 0);
  assert.equal(isMissingJobTableError({ message: "connection reset" }), false);

  const signedOut = healthFor(resolveJobHistory({ ready: true, signedIn: false, rows: [{ status: "ok" }] }));
  assert.match(signedOut.lines.join(" "), /Sign in to read recorded job runs/);
  assert.doesNotMatch(signedOut.lines.join(" "), /not available yet/);
  assert.equal(signedOut.healthy, false);

  const loading = healthFor(resolveJobHistory({ ready: false }));
  assert.match(loading.lines.join(" "), /job history is loading/i);

  const missing = healthFor(resolveJobHistory({
    ready: true,
    signedIn: true,
    error: { message: "relation \"job_runs\" does not exist", code: "42P01" },
  }));
  assert.match(missing.lines.join(" "), /not installed yet/);
  assert.match(missing.lines.join(" "), /not the same as a failed job/);

  const errored = healthFor(denied);
  assert.match(errored.lines.join(" "), /could not be read/);
  assert.match(errored.lines.join(" "), /permission denied/);
  assert.doesNotMatch(errored.lines.join(" "), /not installed/);
});

test("an empty history is not a failure, and saved runs do not make the book current", () => {
  const empty = healthFor(resolveJobHistory({ ready: true, signedIn: true, rows: [] }));
  assert.equal(empty.jobHistoryState, "empty");
  assert.equal(empty.failedJobs, 0);
  assert.match(empty.lines.join(" "), /no recorded runs yet/);
  assert.match(empty.lines.join(" "), /not a failed job and not a successful one/);
  assert.match(empty.lines.join(" "), /no saved reading/);
  assert.equal(empty.healthy, false);

  const okOnly = healthFor(resolveJobHistory({
    ready: true,
    signedIn: true,
    rows: [
      { status: "ok" },
      { status: "ok" },
    ],
  }));
  assert.equal(okOnly.healthy, false);
  assert.equal(okOnly.jobGaps, false);
  assert.match(okOnly.lines.join(" "), /2 ok, 0 partial, 0 failed/);
  assert.match(okOnly.lines.join(" "), /does not make prices, company figures, or the market light current/);
  assert.doesNotMatch(okOnly.lines.join(" "), /not available yet/);
  assert.match(okOnly.lines.join(" "), /1 of 2 names are on the latest completed session/);
  assert.match(okOnly.lines.join(" "), /1 current, 1 stale, 1 missing or incomplete/);

  const mixed = healthFor(resolveJobHistory({
    ready: true,
    signedIn: true,
    rows: [
      { status: "ok" },
      { status: "partial" },
      { status: "failed" },
      { status: "queued" },
    ],
  }));
  assert.equal(mixed.failedJobs, 2);
  assert.equal(mixed.jobGaps, true);
  assert.equal(mixed.healthy, false);
  assert.match(mixed.lines.join(" "), /1 ok, 1 partial, 1 failed, 1 other/);
  assert.doesNotMatch(mixed.lines.join(" "), /everything is current/);
});

test("signing out drops rows from the previous account", () => {
  const previous = [{ id: "1", status: "ok", summary: "fundamentals finished" }];
  const stillSignedIn = resolveJobHistory({ ready: true, signedIn: true, pending: false, rows: previous });
  assert.equal(stillSignedIn.rows.length, 1);
  const signedOut = resolveJobHistory({ ready: true, signedIn: false, pending: false, rows: previous });
  assert.equal(signedOut.state, "signed-out");
  assert.deepEqual(signedOut.rows, []);
  const switching = resolveJobHistory({ ready: true, signedIn: true, pending: true, rows: previous });
  assert.equal(switching.state, "loading");
  assert.deepEqual(switching.rows, []);
});
