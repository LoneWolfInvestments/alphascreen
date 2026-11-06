// Long-only share count for a stock or ETF. Dollars stay in integer cents.
// Nothing here reads a quote, a network, or the account.

import { POSITION_LIMIT } from "./sellSignals.js";

export const DEFAULT_RISK_PERCENT = 1;
export const MAX_RISK_PERCENT = 100;
export const MAX_DOLLARS = 1_000_000_000_000;

export const RISK_NOT_GUARANTEED = "The planned loss is only the gap between the entry and the stop you typed, times the share count. A gap through the stop, slippage, or fees can lose more. This does not send an order.";

const MONEY = /^(?:\d+|\d*\.\d{1,2})$/;
const PERCENT = /^(?:\d+|\d*\.\d{1,4})$/;

function fail(errors) {
  return {
    ok: false,
    errors,
    shares: null,
    riskBudgetCents: null,
    costCents: null,
    plannedLossCents: null,
    profitCents: null,
    rewardRisk: null,
    limitedBy: null,
    zeroReason: null,
    cashSupplied: false,
    warnings: [],
    positionWeight: null,
    overNameCap: false,
  };
}

function moneyToCents(amount, { allowZero = false } = {}) {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return null;
  if (amount === 0) return allowZero ? 0 : null;
  if (amount > MAX_DOLLARS) return null;
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  if (Math.abs(amount - cents / 100) > 0.001) return null;
  if (cents === 0 && !allowZero) return null;
  return cents;
}

function error(field, message) {
  return { field, message };
}

export function formatUsdFromCents(cents) {
  if (!Number.isInteger(cents)) return "—";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const rem = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars}.${rem}`;
}

export function calculatePositionSize({
  portfolioUsd,
  entryUsd,
  stopUsd,
  riskPercent = DEFAULT_RISK_PERCENT,
  cashUsd,
  targetUsd,
} = {}) {
  const errors = [];
  const portfolioCents = moneyToCents(portfolioUsd);
  const entryCents = moneyToCents(entryUsd);
  const stopCents = moneyToCents(stopUsd);
  const cashSupplied = cashUsd != null && cashUsd !== "";
  const targetSupplied = targetUsd != null && targetUsd !== "";
  const cashCents = cashSupplied ? moneyToCents(cashUsd, { allowZero: true }) : null;
  const targetCents = targetSupplied ? moneyToCents(targetUsd) : null;

  if (portfolioCents == null) errors.push(error("portfolio", "Portfolio value must be a positive dollar amount, in cents, up to $1 trillion."));
  if (entryCents == null) errors.push(error("entry", "Entry must be a positive price in dollars and cents."));
  if (stopCents == null) errors.push(error("stop", "Stop must be a positive price in dollars and cents."));
  else if (entryCents != null && stopCents >= entryCents) {
    errors.push(error("stop", "For a long trade the stop has to be below the entry. This calculator does not size shorts."));
  }
  if (typeof riskPercent !== "number" || !Number.isFinite(riskPercent) || riskPercent <= 0 || riskPercent > MAX_RISK_PERCENT) {
    errors.push(error("risk", "Risk must be above 0% and at most 100% of the portfolio."));
  } else if (Math.abs(riskPercent - Math.round(riskPercent * 10000) / 10000) > 1e-9) {
    errors.push(error("risk", "Risk can have at most 4 decimal places."));
  }
  if (cashSupplied && cashCents == null) errors.push(error("cash", "Available cash must be zero or a positive dollar amount, in cents."));
  else if (cashSupplied && portfolioCents != null && cashCents > portfolioCents) {
    errors.push(error("cash", "Available cash cannot be larger than the portfolio value. Raise the portfolio figure if that cash is really part of the account."));
  }
  if (targetSupplied && targetCents == null) errors.push(error("target", "Target must be a positive price in dollars and cents."));
  else if (targetSupplied && entryCents != null && targetCents <= entryCents) {
    errors.push(error("target", "Target has to be above the entry on a long trade."));
  }
  if (errors.length) return fail(errors);

  const riskScaled = Math.round(riskPercent * 10000);
  const riskBudgetCents = Math.round(portfolioCents * riskScaled / 1_000_000);
  const riskPerShareCents = entryCents - stopCents;
  const riskShares = riskPerShareCents > 0 ? Math.floor(riskBudgetCents / riskPerShareCents) : 0;
  const portfolioShares = Math.floor(portfolioCents / entryCents);
  const cashShares = cashSupplied ? Math.floor(cashCents / entryCents) : null;
  const caps = [riskShares, portfolioShares];
  if (cashShares != null) caps.push(cashShares);
  const shares = Math.min(...caps);

  let limitedBy = "risk";
  if (cashShares != null && shares === cashShares && cashShares <= riskShares && cashShares <= portfolioShares) limitedBy = "cash";
  else if (shares === portfolioShares && portfolioShares < riskShares && (cashShares == null || portfolioShares <= cashShares)) limitedBy = "portfolio";

  let zeroReason = null;
  if (shares === 0) {
    if (riskBudgetCents === 0 || riskShares === 0) zeroReason = "risk";
    else if (cashShares === 0) zeroReason = "cash";
    else zeroReason = "portfolio";
  }

  const costCents = shares * entryCents;
  const plannedLossCents = shares * riskPerShareCents;
  const profitCents = targetSupplied ? shares * (targetCents - entryCents) : null;
  const rewardRisk = targetSupplied ? (targetCents - entryCents) / riskPerShareCents : null;
  const positionWeight = portfolioCents > 0 ? costCents / portfolioCents : null;
  const warnings = [];
  if (!cashSupplied) {
    warnings.push("Available cash was left blank. This does not know what you can spend at the broker. The share count is also kept from costing more than the whole portfolio. That ceiling is not buying power.");
  } else if (limitedBy === "cash") {
    warnings.push("The share count was cut to what the cash you entered can buy. Rounded down to a whole share.");
  }
  if (limitedBy === "portfolio") {
    warnings.push("The risk budget would have spent more than the portfolio. The cost is capped at the portfolio value. That is a ceiling, not cash sitting in the account.");
  }
  if (shares > 0 && plannedLossCents < riskBudgetCents) {
    warnings.push("The share count is rounded down, so the planned loss is at or under the risk budget.");
  }
  if (positionWeight != null && positionWeight > POSITION_LIMIT) {
    warnings.push("This costs more than 25% of the portfolio. The rest of the app uses 25% as the single-name cap. The share count was not cut to that cap.");
  }

  return {
    ok: true,
    errors: [],
    shares,
    riskBudgetCents,
    costCents,
    plannedLossCents,
    profitCents,
    rewardRisk,
    limitedBy,
    zeroReason,
    cashSupplied,
    warnings,
    positionWeight,
    overNameCap: positionWeight != null && positionWeight > POSITION_LIMIT,
  };
}

function parseDecimal(raw, pattern) {
  if (raw == null) return { kind: "empty" };
  const text = String(raw).trim().replace(/[$,\s]/g, "").replace(/%$/, "");
  if (text === "") return { kind: "empty" };
  if (!pattern.test(text)) return { kind: "invalid" };
  const value = Number(text);
  if (!Number.isFinite(value)) return { kind: "invalid" };
  return { kind: "number", value };
}

// Text from the form. Blank cash and blank target mean "not supplied".
// A typed 0 for cash is supplied. Garbage such as 1e2 is rejected.
export function readPositionForm({
  portfolio = "",
  entry = "",
  stop = "",
  risk = String(DEFAULT_RISK_PERCENT),
  cash = "",
  target = "",
} = {}) {
  const portfolioParsed = parseDecimal(portfolio, MONEY);
  const entryParsed = parseDecimal(entry, MONEY);
  const stopParsed = parseDecimal(stop, MONEY);
  const riskParsed = parseDecimal(risk, PERCENT);
  const cashParsed = parseDecimal(cash, MONEY);
  const targetParsed = parseDecimal(target, MONEY);
  const errors = [];
  if (portfolioParsed.kind === "invalid") errors.push(error("portfolio", "Portfolio value must be dollars and cents, such as 100000 or 100000.50."));
  if (entryParsed.kind === "invalid") errors.push(error("entry", "Entry must be dollars and cents, such as 50.25."));
  if (stopParsed.kind === "invalid") errors.push(error("stop", "Stop must be dollars and cents, such as 47.10."));
  if (riskParsed.kind === "invalid" || riskParsed.kind === "empty") errors.push(error("risk", "Risk must be a percent above 0 and at most 100, with at most 4 decimal places."));
  if (cashParsed.kind === "invalid") errors.push(error("cash", "Available cash must be dollars and cents, or left blank."));
  if (targetParsed.kind === "invalid") errors.push(error("target", "Target must be dollars and cents, or left blank."));

  const requiredMissing = portfolioParsed.kind === "empty" || entryParsed.kind === "empty" || stopParsed.kind === "empty";
  if (errors.length) return { status: "invalid", errors, result: null };
  if (requiredMissing) {
    const anyTyped = [portfolio, entry, stop, cash, target].some((value) => String(value || "").trim() !== "");
    return { status: anyTyped ? "incomplete" : "blank", errors: [], result: null };
  }

  const result = calculatePositionSize({
    portfolioUsd: portfolioParsed.value,
    entryUsd: entryParsed.value,
    stopUsd: stopParsed.value,
    riskPercent: riskParsed.value,
    cashUsd: cashParsed.kind === "number" ? cashParsed.value : null,
    targetUsd: targetParsed.kind === "number" ? targetParsed.value : null,
  });
  if (!result.ok) return { status: "invalid", errors: result.errors, result: null };
  return { status: "ready", errors: [], result };
}

export function zeroShareMessage(zeroReason) {
  if (zeroReason === "cash") return "The cash you entered cannot buy one share, so the suggestion is 0 shares.";
  if (zeroReason === "portfolio") return "One share costs more than the portfolio, so the suggestion is 0 shares.";
  if (zeroReason === "risk") return "The risk budget does not cover the loss on one share, so the suggestion is 0 shares.";
  return null;
}
