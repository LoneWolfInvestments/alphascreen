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
  const jobsKnown = Array.isArray(jobRuns);
  const jobs = jobsKnown ? jobRuns : [];
  const failedJobs = jobs.filter((row) => row?.status === "failed" || row?.status === "partial");

  const priceGaps = prices.total === 0 || prices.fresh < prices.total;
  const fundamentalGaps = (fundamentals || []).length === 0 || fundamentalsReady < (fundamentals || []).length;
  const stressGap = regime.state !== "fresh";
  const jobGaps = !jobsKnown || failedJobs.length > 0;

  let tone = "gaps";
  if (prices.total === 0 && (fundamentals || []).length === 0 && regime.state === "missing" && !jobsKnown) {
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
  if (!jobsKnown) lines.push("Scheduled-job history is not available yet. Unknown is not the same as failed.");
  else if (jobs.length === 0) lines.push("Job history table is installed and has no recorded runs yet.");
  else lines.push(`Recorded jobs: ${jobs.length}. Problems in that list: ${failedJobs.length}.`);

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
    jobsKnown,
    failedJobs: failedJobs.length,
    lines,
  };
}
