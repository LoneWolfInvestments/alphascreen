// What the saved dates say. A missing job table is "unknown", not "failed".
// Partial coverage is never described as healthy.

import { presentRegime } from "./marketStress.js";
import { sessionsBehind } from "./sessionClock.js";

function day(value) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function summarizeHealth({
  quotes = [],
  fundamentals = [],
  stress = null,
  jobRuns = null,
  jobHistory = null,
  now = new Date(),
} = {}) {
  const prices = { fresh: 0, delayed: 0, stale: 0, missing: 0, ahead: 0, total: 0 };
  let newest = null;
  for (const quote of quotes || []) {
    prices.total += 1;
    const info = sessionsBehind(quote?.bar_date, now);
    prices[info.state] = (prices[info.state] || 0) + 1;
    const bar = day(quote?.bar_date);
    if (bar && (!newest || bar > newest)) newest = bar;
  }

  let fundamentalsReady = 0;
  let fundamentalsStale = 0;
  let fundamentalsOther = 0;
  for (const row of fundamentals || []) {
    if (row?.coverage === "ready") fundamentalsReady += 1;
    else if (row?.coverage === "stale") fundamentalsStale += 1;
    else fundamentalsOther += 1;
  }

  const regime = presentRegime(stress, now);
  const jobs = describeJobHistory(jobHistory, jobRuns);

  const priceGaps = prices.total === 0 || prices.fresh < prices.total;
  const fundamentalGaps = (fundamentals || []).length === 0 || fundamentalsReady < (fundamentals || []).length;
  const stressGap = regime.state !== "fresh";
  const jobGaps = jobs.gaps;

  let tone = "gaps";
  if (prices.total === 0 && (fundamentals || []).length === 0 && regime.state === "missing" && !jobs.known) {
    tone = "unknown";
  }

  const lines = [];
  if (prices.total === 0) lines.push("No saved price sessions yet.");
  else lines.push(`Prices: ${prices.fresh} of ${prices.total} names are on the latest completed session${newest ? ` (newest saved session ${newest})` : ""}.`);
  if (prices.delayed || prices.stale || prices.missing || prices.ahead) {
    lines.push(`Other price sessions: ${prices.delayed} one day behind, ${prices.stale} older, ${prices.missing} with no date.`);
  }
  lines.push(`Company snapshots: ${fundamentalsReady} current, ${fundamentalsStale} stale, ${fundamentalsOther} missing or incomplete, out of ${(fundamentals || []).length}.`);
  if (regime.state === "missing") lines.push("Market light: no saved reading. That is not a calm market and not a stressed market.");
  else if (regime.state === "fresh") lines.push(`Market light: ${regime.regime} for session ${regime.asOf}.`);
  else lines.push(`Market light: not current (${regime.asOf || "no date"}).`);
  lines.push(jobs.line);

  return {
    tone,
    healthy: false,
    priceGaps,
    fundamentalGaps,
    stressGap,
    jobGaps,
    prices,
    newestPriceSession: newest,
    fundamentalsReady,
    fundamentalsStale,
    fundamentalsOther,
    regime,
    jobsKnown: jobs.known,
    jobHistoryState: jobs.state,
    failedJobs: jobs.problemCount,
    lines,
  };
}

function statusCounts(rows) {
  const counts = { ok: 0, partial: 0, failed: 0, other: 0 };
  for (const row of rows || []) {
    if (row?.status === "ok") counts.ok += 1;
    else if (row?.status === "partial") counts.partial += 1;
    else if (row?.status === "failed") counts.failed += 1;
    else counts.other += 1;
  }
  return counts;
}

export function isMissingJobTableError(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""} ${error?.code || ""}`;
  return /job_runs/i.test(message)
    && /schema cache|does not exist|relation|Could not find|PGRST205|42P01/i.test(message);
}

// One read drives the summary line and the table. Rows from another account
// or an older sign-in are dropped as soon as the session is gone or the next
// read has not finished.
export function resolveJobHistory({ ready = false, signedIn = false, pending = false, error = null, rows = [] } = {}) {
  if (!ready) return { state: "loading", rows: [], detail: null };
  if (!signedIn) return { state: "signed-out", rows: [], detail: null };
  if (pending) return { state: "loading", rows: [], detail: null };
  if (error) {
    if (isMissingJobTableError(error)) return { state: "missing-table", rows: [], detail: null };
    const detail = String(error.message || "The request failed.").slice(0, 200);
    return { state: "error", rows: [], detail };
  }
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return { state: "empty", rows: [], detail: null };
  return { state: "ready", rows: list, detail: null };
}

function describeJobHistory(jobHistory, jobRuns) {
  if (jobHistory && jobHistory.state) {
    const rows = Array.isArray(jobHistory.rows) ? jobHistory.rows : [];
    const counts = statusCounts(rows);
    const problemCount = counts.partial + counts.failed;
    const known = jobHistory.state === "empty" || jobHistory.state === "ready";
    return {
      state: jobHistory.state,
      known,
      gaps: !known || problemCount > 0,
      problemCount,
      line: jobHistoryLine(jobHistory.state, rows, counts, jobHistory.detail),
    };
  }

  const known = Array.isArray(jobRuns);
  const rows = known ? jobRuns : [];
  const counts = statusCounts(rows);
  const problemCount = counts.partial + counts.failed;
  return {
    state: known ? (rows.length === 0 ? "empty" : "ready") : "unknown",
    known,
    gaps: !known || problemCount > 0,
    problemCount,
    line: known
      ? jobHistoryLine(rows.length === 0 ? "empty" : "ready", rows, counts, null)
      : "Scheduled-job history is not available yet. Unknown is not the same as failed.",
  };
}

function jobHistoryLine(state, rows, counts, detail) {
  if (state === "loading") return "Recorded job history is loading.";
  if (state === "signed-out") return "Sign in to read recorded job runs. They are not public.";
  if (state === "missing-table") return "Job history is not installed yet. Unknown is not the same as a failed job.";
  if (state === "error") {
    return detail
      ? `Recorded job history could not be read. ${detail}`
      : "Recorded job history could not be read.";
  }
  if (state === "empty") return "The job table is installed and has no recorded runs yet. That is not a failed job and not a successful one.";
  const other = counts.other ? `, ${counts.other} other` : "";
  return `Recorded jobs in this list: ${rows.length} (${counts.ok} ok, ${counts.partial} partial, ${counts.failed} failed${other}). An ok row is one saved run. It does not make prices, company figures, or the market light current.`;
}
