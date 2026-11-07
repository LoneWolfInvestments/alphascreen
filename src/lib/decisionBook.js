// One decision list for every ticker surface. The company gate inside
// readBusinessFundamentals still uses its own word for a passing snapshot.
// That word is not the decision shown on a ticker.

import { readBusinessFundamentals } from "./businessFundamentals.js";
import { priceSessionSummary } from "./dataHealth.js";
import { presentRegime } from "./marketStress.js";
import { buildSellBook, isEarningsSoon, nyToday } from "./sellSignals.js";
import { sessionsBehind } from "./sessionClock.js";
import { assessSignal, assessmentOrder } from "./signalAssessment.js";
import { BENCHMARK_SYMBOL, assignRelativeStrengthRanks, viewRowFromQuote } from "./swingSetups.js";

function earningsDateFor(bySymbol, ticker) {
  const entry = bySymbol?.[ticker];
  if (!entry) return null;
  return entry.date || null;
}

function day(value) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function compareRows(a, b) {
  const order = assessmentOrder(a.assessment) - assessmentOrder(b.assessment);
  if (order !== 0) return order;
  const ar = Number.isFinite(a.rsRank) ? a.rsRank : 9999;
  const br = Number.isFinite(b.rsRank) ? b.rsRank : 9999;
  if (ar !== br) return ar - br;
  return String(a.ticker).localeCompare(String(b.ticker));
}

export function regimeLineFor(regime) {
  if (regime?.state === "fresh") {
    return `Market light is ${regime.regime} for ${regime.asOf}. That is the light's date, not the price session, and it does not confirm a stock.`;
  }
  return "Market light is not a current reading. A missing light is not the price date.";
}

export function buildDecisionRows({
  quotes = [],
  views = null,
  fundamentals = [],
  holdings = [],
  holdingsKnown = false,
  stress = null,
  earningsBySymbol = {},
  now = new Date(),
  today,
} = {}) {
  const sessionToday = today || nyToday();
  const regime = presentRegime(stress, now);
  const businessByTicker = new Map((fundamentals || []).map((row) => [row.ticker, readBusinessFundamentals(row, { now })]));
  const quoteBySymbol = new Map((quotes || []).map((row) => [row.symbol, row]));
  const rankedSource = views || (quotes || []).map(viewRowFromQuote).filter(Boolean);
  const ranked = assignRelativeStrengthRanks(rankedSource);
  const book = holdingsKnown
    ? buildSellBook({
      holdings,
      quotesBySymbol: Object.fromEntries(quoteBySymbol),
      earningsBySymbol: {},
      today: sessionToday,
      now,
    })
    : { rows: [] };
  const exitByTicker = new Map(book.rows.map((row) => [row.ticker, row.status]));
  const heldNames = holdingsKnown ? new Set((holdings || []).map((row) => row.ticker)) : new Set();
  const symbols = new Set([
    ...ranked.map((row) => row.symbol),
    ...businessByTicker.keys(),
    ...(holdingsKnown ? heldNames : []),
  ]);
  symbols.delete(BENCHMARK_SYMBOL);
  const rows = [...symbols].map((ticker) => {
    const view = ranked.find((row) => row.symbol === ticker);
    const quote = quoteBySymbol.get(ticker);
    const business = businessByTicker.get(ticker);
    const barDate = day(view?.barDate || quote?.bar_date);
    const info = sessionsBehind(barDate, now);
    return assessSignal({
      ticker,
      held: heldNames.has(ticker),
      label: view?.label || null,
      freshness: (view || quote) ? info.state : "missing",
      barDate,
      stop: view?.stop,
      exitStop: quote?.chandelier_stop,
      exitStatus: heldNames.has(ticker) ? (exitByTicker.get(ticker) || null) : null,
      rsRank: view?.rsRank,
      rsCount: view?.rsCount,
      businessCoverage: business?.coverage || "missing",
      businessSignal: business?.signal || null,
      businessSummary: business?.summary || null,
      statementPeriod: business?.period || null,
      earningsSoon: isEarningsSoon(earningsDateFor(earningsBySymbol, ticker), sessionToday),
      earningsDate: earningsDateFor(earningsBySymbol, ticker),
      regimeState: regime.state,
      regime: regime.regime,
      regimeAsOf: regime.asOf,
    });
  }).sort(compareRows);

  const coverageQuotes = (quotes && quotes.length)
    ? quotes
    : ranked.map((row) => ({ symbol: row.symbol, bar_date: row.barDate }));
  return {
    rows,
    byTicker: new Map(rows.map((row) => [row.ticker, row])),
    regime,
    regimeLine: regimeLineFor(regime),
    priceSummary: priceSessionSummary(coverageQuotes, now),
    holdingsKnown,
  };
}
