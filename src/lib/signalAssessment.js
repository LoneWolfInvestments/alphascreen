// Overall label for one stock. The pillars are not added into a score.
// Unknown company figures are never treated as positive.
// Sell / Exit review is only for a holding whose trailing exit stop is through.

import { SETUP } from "./swingSetups.js";

export const ASSESSMENT = Object.freeze({
  BUY: "Buy candidate",
  WAIT: "Hold / Wait",
  EXIT: "Sell / Exit review",
  AVOID: "Avoid / Not ready",
  DATA: "Data check",
});

export const PILLAR = Object.freeze({
  POSITIVE: "Positive",
  NEGATIVE: "Negative",
  MIXED: "Mixed",
  UNKNOWN: "Unknown",
});

export const FILTERS = Object.freeze([
  { id: "all", label: "All" },
  { id: "buy", label: "Buy" },
  { id: "wait", label: "Wait" },
  { id: "sell", label: "Exit" },
  { id: "avoid", label: "Avoid" },
  { id: "data", label: "Data" },
]);

const ENTRY = new Set([SETUP.BREAKOUT, SETUP.PULLBACK]);

export function matchesFilter(assessment, filter) {
  if (!filter || filter === "all") return true;
  if (filter === "buy") return assessment === ASSESSMENT.BUY;
  if (filter === "wait") return assessment === ASSESSMENT.WAIT;
  if (filter === "sell") return assessment === ASSESSMENT.EXIT;
  if (filter === "avoid") return assessment === ASSESSMENT.AVOID;
  return assessment === ASSESSMENT.DATA;
}

function fundamentalsPillar(coverage, signal) {
  if (coverage !== "ready" || !signal) return PILLAR.UNKNOWN;
  if (signal === "Buy") return PILLAR.POSITIVE;
  if (signal === "Caution") return PILLAR.NEGATIVE;
  if (signal === "Hold") return PILLAR.MIXED;
  return PILLAR.UNKNOWN;
}

function technicalsPillar(row) {
  if (row.freshness !== "fresh" || !row.label || row.label === SETUP.THIN || row.label === SETUP.BENCHMARK) {
    return PILLAR.UNKNOWN;
  }
  if (ENTRY.has(row.label)) return PILLAR.POSITIVE;
  if (row.label === SETUP.UPTREND) return PILLAR.MIXED;
  if (row.label === SETUP.AVOID) return PILLAR.NEGATIVE;
  return PILLAR.UNKNOWN;
}

function supportingPillar(row) {
  if (row.earningsSoon) return PILLAR.NEGATIVE;
  if (row.regimeState === "fresh" && row.regime === "red") return PILLAR.NEGATIVE;
  if (row.regimeState === "fresh" && row.regime === "amber") return PILLAR.MIXED;
  if (row.regimeState === "fresh" && row.regime === "green" && row.earningsDate) return PILLAR.POSITIVE;
  if (row.regimeState === "fresh" && row.regime === "green") return PILLAR.MIXED;
  return PILLAR.UNKNOWN;
}

function usd(value) {
  return Number.isFinite(value) ? `$${Number(value).toFixed(2)}` : null;
}

export function assessSignal(row = {}) {
  const fundamentals = fundamentalsPillar(row.businessCoverage, row.businessSignal);
  const technicals = technicalsPillar(row);
  const supporting = supportingPillar(row);
  const fresh = row.freshness === "fresh";
  const trigger = ENTRY.has(row.label);
  const priceBlocked = !fresh || !row.label || row.label === SETUP.THIN || row.label === SETUP.BENCHMARK;
  const exitReview = !!row.held && row.exitStatus === "red" && fresh;

  let assessment = ASSESSMENT.WAIT;
  if (priceBlocked) assessment = ASSESSMENT.DATA;
  else if (exitReview) assessment = ASSESSMENT.EXIT;
  else if (!row.held && row.label === SETUP.AVOID) assessment = ASSESSMENT.AVOID;
  else if (trigger && fundamentals === PILLAR.POSITIVE && !row.earningsSoon) assessment = ASSESSMENT.BUY;

  const positives = [];
  const negatives = [];
  const neutrals = [];

  if (fundamentals === PILLAR.POSITIVE) {
    positives.push(row.businessSummary || "Company figures meet the saved checks for revenue, earnings, margins, and valuation.");
  } else if (fundamentals === PILLAR.NEGATIVE) {
    negatives.push(row.businessSummary || "Company figures are weak on the saved checks.");
  } else if (fundamentals === PILLAR.MIXED) {
    neutrals.push(row.businessSummary || "Company figures are mixed. That is not a confirmation.");
  } else {
    neutrals.push("Company figures are missing or stale. Unknown is not a positive, and it does not confirm a buy.");
  }

  if (technicals === PILLAR.POSITIVE) {
    positives.push(`Technical setup: ${row.label}. The trend gate is open and this is the entry trigger. Relative strength only ranks the list.`);
  } else if (technicals === PILLAR.NEGATIVE) {
    negatives.push("Technicals: the trend gate is closed, so there is no long entry.");
  } else if (technicals === PILLAR.MIXED) {
    neutrals.push("Technicals: the trend gate is open, but there is no breakout or pullback. Wait.");
  } else {
    negatives.push("Technicals cannot be graded. The price session is missing, stale, or too short.");
  }

  if (row.earningsSoon) {
    negatives.push("Earnings fall inside five trading sessions. That blocks a new entry. It is not an order to sell a holding.");
  } else if (row.earningsDate) {
    neutrals.push(`Next earnings ${row.earningsDate}. Not inside the five-session window.`);
  } else {
    neutrals.push("No earnings date is saved. A blank date is not treated as all-clear.");
  }

  if (row.regimeState === "fresh" && row.regime) {
    const line = `Market light is ${row.regime} for ${row.regimeAsOf || "the saved session"}. It is backdrop, not an extra vote.`;
    if (supporting === PILLAR.NEGATIVE && row.regime === "red") negatives.push(line);
    else if (supporting === PILLAR.POSITIVE) positives.push(line);
    else neutrals.push(line);
  } else {
    neutrals.push("Market light has no current reading. That is not treated as calm or as stressed.");
  }

  if (Number.isFinite(row.rsRank)) {
    neutrals.push(`Relative strength rank ${row.rsRank}${row.rsCount ? ` of ${row.rsCount}` : ""} versus SPY. Rank is order only, not a separate buy or sell.`);
  }
  if (row.barDate) neutrals.push(`Price session ${row.barDate}. This is the daily close, not a live quote.`);
  if (row.statementPeriod) neutrals.push(`Company statement date ${row.statementPeriod}. A later download is not a new filing.`);

  let triggerText = "No entry trigger.";
  if (row.label === SETUP.BREAKOUT) triggerText = "Entry trigger: Breakout on the latest completed close. The trend gate was already open.";
  else if (row.label === SETUP.PULLBACK) triggerText = "Entry trigger: Pullback that held a rising average. The trend gate was already open.";
  else if (row.label === SETUP.UPTREND) triggerText = "No entry trigger yet. The trend is open. Wait for a breakout or a pullback.";
  else if (row.label === SETUP.AVOID) triggerText = "No long trigger. The trend gate is closed.";
  else triggerText = "No trigger until a current price session is saved.";

  const entryStop = usd(row.stop);
  const exitStop = usd(row.exitStop);
  let invalidation = "No invalidation price is saved.";
  if (assessment === ASSESSMENT.EXIT) {
    invalidation = exitStop
      ? `Exit review: the trailing exit stop at ${exitStop} is through the latest close. That stop is the 22-day high minus 3×ATR(22), not the entry stop.`
      : "Exit review: the trailing exit stop is through the latest close.";
  } else if (entryStop) {
    invalidation = `Entry idea is invalid through ${entryStop}, the 2×ATR(14) stop under the signal close. A holding uses a different trailing exit stop${exitStop ? ` (${exitStop})` : ""}.`;
  }

  let reason = "Evidence is mixed, so this is Wait rather than a buy or a sell.";
  if (assessment === ASSESSMENT.DATA) {
    reason = "Essential price data is missing, stale, or too short. The label is Data check. It is not a buy.";
  } else if (assessment === ASSESSMENT.EXIT) {
    reason = "You hold this name and the trailing exit stop is through the latest close. That is an exit review, not an automatic order, and not a label for every weak stock.";
  } else if (assessment === ASSESSMENT.AVOID) {
    reason = fundamentals === PILLAR.POSITIVE
      ? "Company figures are positive and the trend gate is closed. Both are shown. The closed trend keeps this at Avoid. It is not a buy, and it is not a sell because you do not hold it."
      : "The trend gate is closed and you do not hold it. Avoid means do not start a long. It is not a short-sell signal.";
  } else if (assessment === ASSESSMENT.BUY) {
    reason = supporting === PILLAR.NEGATIVE
      ? "Company figures and the entry trigger are both positive. Supporting context is negative and is shown beside them. It does not cancel the candidate and it does not turn it into an order."
      : "Company figures and the entry trigger are both positive, and earnings are not inside five sessions. This is a research candidate, not an order.";
  } else if (row.earningsSoon && trigger) {
    reason = "The entry trigger is present, but earnings are inside five sessions. Wait. Do not start a new entry.";
  } else if (trigger && fundamentals === PILLAR.UNKNOWN) {
    reason = "The price trigger is present, but company figures are unknown. Unknown is not confirmation, so this stays Wait.";
  } else if (trigger && fundamentals === PILLAR.NEGATIVE) {
    reason = "The price trigger is positive and the company figures are negative. That conflict stays Wait. It is not a confident buy.";
  } else if (fundamentals === PILLAR.POSITIVE && technicals === PILLAR.NEGATIVE) {
    reason = "Company figures are positive and the price trend is negative. Both stay visible. This is not a buy.";
  }

  return {
    ticker: row.ticker,
    held: !!row.held,
    assessment,
    fundamentals,
    technicals,
    supporting,
    positives,
    negatives,
    neutrals,
    trigger: triggerText,
    invalidation,
    reason,
    avoidNewEntry: !!row.earningsSoon && assessment !== ASSESSMENT.DATA && assessment !== ASSESSMENT.EXIT,
    label: row.label || null,
    barDate: row.barDate || null,
  };
}

export function whatWouldChange(row = {}) {
  if (row.assessment === ASSESSMENT.DATA) return "A decision needs a current price session and a saved setup. A missing or stale price is not a buy or a sell.";
  if (row.assessment === ASSESSMENT.EXIT) return "This is an exit review because you hold it and the trailing exit stop is through. It is not the label for an unheld name.";
  if (row.assessment === ASSESSMENT.AVOID) return "A long would need the trend gate to open. Positive company figures do not override a closed trend, and this is not a short.";
  if (row.assessment === ASSESSMENT.BUY) return "It stops being a buy candidate if earnings move inside five sessions, the company figures no longer pass, or the price session goes stale. A red market light is a warning, not that change.";
  if (row.fundamentals === PILLAR.UNKNOWN) return "Company figures would need a current snapshot before this can be a buy candidate. Unknown is not a yes.";
  if (row.earningsSoon) return "The earnings window would need to pass before a new entry. That does not by itself sell a holding.";
  if (row.technicals === PILLAR.MIXED) return "The trend is open. A buy candidate still needs a breakout or a pullback, plus company figures that pass.";
  return "The decision stays wait until the blocking evidence changes. The columns are not added into a score.";
}

export function assessmentOrder(assessment) {
  if (assessment === ASSESSMENT.BUY) return 0;
  if (assessment === ASSESSMENT.EXIT) return 1;
  if (assessment === ASSESSMENT.WAIT) return 2;
  if (assessment === ASSESSMENT.AVOID) return 3;
  return 4;
}
