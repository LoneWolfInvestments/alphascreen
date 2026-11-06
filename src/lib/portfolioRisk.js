// Planned downside for holdings you already have.
// Uses the trailing exit stop only. A gain versus cost is not subtracted from risk.
// Names with a missing or stale price, or no stop, stay outside the total.

import { THEME_LIMIT, POSITION_LIMIT, themeForHolding } from "./sellSignals.js";
import { sessionsBehind } from "./sessionClock.js";

export const RISK_CAVEAT = "Planned loss assumes each covered holding is sold at its trailing exit stop. A gap through that stop, slippage, or fees can lose more. Names in the same theme can fall together. Theme groups are not a measured correlation. This is not a guaranteed maximum loss, and it is not buying power.";

function num(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sectorName(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.toLowerCase() === "unclassified") return null;
  return text;
}

export function assessBook({ holdings, quotesBySymbol, now = new Date() } = {}) {
  const quotes = quotesBySymbol || {};
  const rows = [];
  for (const holding of holdings || []) {
    const ticker = String(holding?.ticker || "").toUpperCase();
    if (!ticker) continue;
    const quote = quotes[ticker] || {};
    const shares = num(holding.shares);
    const cost = num(holding.cost_basis);
    const price = num(quote.price);
    const stop = num(quote.chandelier_stop);
    const barDate = quote.bar_date ? String(quote.bar_date).slice(0, 10) : null;
    const freshness = sessionsBehind(barDate, now);
    const theme = themeForHolding(ticker, holding.theme);
    const sector = sectorName(holding.sector);
    const priceFresh = freshness.state === "fresh" && price != null && price > 0 && shares != null && shares > 0;
    const marketValue = priceFresh ? price * shares : null;
    let stopState = "missing";
    let downside = null;
    let costPnl = null;
    if (!priceFresh) stopState = freshness.state === "fresh" ? "missing-price" : freshness.state === "missing" ? "missing-price" : "stale";
    else if (stop == null || stop <= 0) stopState = "no-stop";
    else if (price <= stop) stopState = "through";
    else {
      stopState = "covered";
      downside = (price - stop) * shares;
    }
    if (priceFresh && stop != null && stop > 0 && cost != null && cost > 0) {
      costPnl = (stop - cost) * shares;
    }
    rows.push({
      ticker,
      shares,
      price: priceFresh ? price : price,
      stop,
      barDate,
      freshness: freshness.state,
      sector,
      theme: theme.source === "none" ? null : theme.name,
      themeSource: theme.source,
      marketValue,
      stopState,
      downside,
      costPnl,
    });
  }

  const covered = rows.filter((row) => row.stopState === "covered");
  const freshValueRows = rows.filter((row) => row.marketValue != null);
  const coveredMarketValue = covered.reduce((sum, row) => sum + row.marketValue, 0);
  const freshMarketValue = freshValueRows.reduce((sum, row) => sum + row.marketValue, 0);
  const plannedLoss = covered.reduce((sum, row) => sum + row.downside, 0);
  const costPnlRows = rows.filter((row) => row.costPnl != null && row.stopState === "covered");
  const pnlAtStop = costPnlRows.reduce((sum, row) => sum + row.costPnl, 0);

  function weights(key) {
    const buckets = new Map();
    for (const row of freshValueRows) {
      const name = row[key] || (key === "sector" ? null : null);
      const label = name || (key === "sector" ? "No sector saved" : "No theme saved");
      const bucket = buckets.get(label) || { label, marketValue: 0, tickers: [] };
      bucket.marketValue += row.marketValue;
      bucket.tickers.push(row.ticker);
      buckets.set(label, bucket);
    }
    return [...buckets.values()]
      .map((bucket) => ({
        ...bucket,
        weight: freshMarketValue > 0 ? bucket.marketValue / freshMarketValue : null,
      }))
      .sort((a, b) => (b.marketValue - a.marketValue) || a.label.localeCompare(b.label));
  }

  const names = freshValueRows
    .map((row) => ({
      ticker: row.ticker,
      marketValue: row.marketValue,
      weight: freshMarketValue > 0 ? row.marketValue / freshMarketValue : null,
    }))
    .sort((a, b) => b.marketValue - a.marketValue);

  const missing = rows.filter((row) => row.stopState !== "covered").map((row) => ({
    ticker: row.ticker,
    stopState: row.stopState,
    barDate: row.barDate,
  }));

  return {
    rows,
    coveredCount: covered.length,
    holdingCount: rows.length,
    plannedLoss,
    plannedLossPct: coveredMarketValue > 0 ? plannedLoss / coveredMarketValue : null,
    coveredMarketValue,
    freshMarketValue,
    pnlAtStop,
    pnlAtStopCount: costPnlRows.length,
    names,
    sectors: weights("sector"),
    themes: weights("theme"),
    missing,
    nameCap: POSITION_LIMIT,
    themeCap: THEME_LIMIT,
    caveat: RISK_CAVEAT,
  };
}
