// Research list for names you do not hold.
// Order is relative strength versus SPY, not a hidden score.
// A fresh Breakout or Pullback is a research candidate. It is not a confirmed buy.

import { SETUP } from "./swingSetups.js";

export const RANK_BASIS = "Ordered by relative strength versus SPY (rank 1 has beaten SPY by the most over the saved 3-, 6-, and 12-month windows). Names without that comparison come after the ranked names, A to Z. Nothing here is a combined score.";

const ENTRY = new Set([SETUP.BREAKOUT, SETUP.PULLBACK]);

function companyContext(row) {
  if (row.businessCoverage === "stale") {
    return "Company figures are stale. This is a research candidate, not a confirmed buy.";
  }
  if (row.businessCoverage !== "ready") {
    return "Company figures are missing or incomplete. This is a research candidate, not a confirmed buy.";
  }
  if (row.businessSignal === "Caution") return "Company figures disagree with the setup. That disagreement is left as-is.";
  if (row.businessSignal === "Buy") return "Company figures are supportive. That is context, not a confirmation.";
  if (row.businessSignal === "Hold") return "Company figures are mixed. That is context, not a confirmation.";
  return "Company figures do not support a confirmation.";
}

function triggerLine(label) {
  if (label === SETUP.BREAKOUT) return "Required trigger: Breakout. The close cleared the prior 20-day high on volume above both averages, with the trend gate open.";
  if (label === SETUP.PULLBACK) return "Required trigger: Pullback. Price tagged a rising 20- or 50-day average and held it, with the trend gate open.";
  if (label === SETUP.UPTREND) return "No entry trigger. The trend gate is open. Wait for a breakout or a pullback.";
  if (label === SETUP.AVOID) return "The trend gate is closed, so this is not a long candidate.";
  if (label === SETUP.THIN) return "Not enough saved sessions to judge the trend gate.";
  return "No setup is saved.";
}

function invalidation(stop) {
  if (!Number.isFinite(stop)) return "No entry stop is saved, so the invalidation price is unknown.";
  return `Invalidation for this entry idea: price through the entry stop at ${stop.toFixed(2)} USD, which is 2×ATR(14) under the signal close. A holding uses a different trailing exit stop.`;
}

function compareRank(a, b) {
  const ar = Number.isFinite(a.rsRank) ? a.rsRank : Number.POSITIVE_INFINITY;
  const br = Number.isFinite(b.rsRank) ? b.rsRank : Number.POSITIVE_INFINITY;
  if (ar !== br) return ar - br;
  return String(a.ticker).localeCompare(String(b.ticker));
}

export function buildResearchQueue(rows) {
  const candidates = [];
  const waiting = [];
  const notCurrent = [];
  const passed = [];

  for (const row of rows || []) {
    if (!row || row.held) continue;
    const label = row.label || null;
    const fresh = row.freshness === "fresh";
    const item = {
      ticker: row.ticker,
      label,
      barDate: row.barDate || null,
      rsRank: Number.isFinite(row.rsRank) ? row.rsRank : null,
      stop: Number.isFinite(row.stop) ? row.stop : null,
      trigger: triggerLine(label),
      why: row.reason || "No setup note is saved.",
      invalidation: invalidation(row.stop),
      company: companyContext(row),
      earningsSoon: !!row.earningsSoon,
      freshness: row.freshness || "missing",
    };

    if (!fresh) {
      notCurrent.push({ ...item, status: "Not current" });
      continue;
    }
    if (ENTRY.has(label)) {
      candidates.push({
        ...item,
        status: "Research candidate",
        avoidNewEntry: !!row.earningsSoon,
      });
      continue;
    }
    if (label === SETUP.UPTREND) {
      waiting.push({ ...item, status: "Wait" });
      continue;
    }
    passed.push({ ...item, status: label === SETUP.THIN ? "Not enough history" : "Not a long" });
  }

  candidates.sort(compareRank);
  waiting.sort(compareRank);
  notCurrent.sort(compareRank);
  passed.sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));

  return {
    candidates,
    waiting,
    notCurrent,
    passed,
    rankBasis: RANK_BASIS,
  };
}
