// Realistic book used by tests and the local sample preview.
// These are not the owner's holdings. Live rows always come from the portfolio table.

import { buildSellBook } from "./sellSignals.js";

export const SAMPLE_TODAY = "2026-10-30";
export const SAMPLE_BAR_DATE = "2026-10-29";

const TARGETS = [
  { ticker: "NVDA", marketValue: 30000, price: 174, cost: 90 },
  { ticker: "MU", marketValue: 15000, price: 140, cost: 80 },
  { ticker: "AAPL", marketValue: 12000, price: 230, cost: 180 },
  { ticker: "MSFT", marketValue: 10000, price: 410, cost: 350 },
  { ticker: "LLY", marketValue: 10000, price: 900, cost: 700 },
  { ticker: "NOW", marketValue: 8000, price: 850, cost: 700 },
  { ticker: "CCJ", marketValue: 6000, price: 55, cost: 40 },
  { ticker: "DNN", marketValue: 3000, price: 2.1, cost: 1.2 },
  { ticker: "NXE", marketValue: 3000, price: 8, cost: 5 },
  { ticker: "ASTS", marketValue: 3000, price: 28, cost: 15 },
];

function quote(partial) {
  return {
    rsi: 55,
    sma_50: null,
    atr_22: null,
    high_22: null,
    chandelier_stop: null,
    below_sma50_streak: 0,
    bar_date: SAMPLE_BAR_DATE,
    ...partial,
  };
}

export function sampleHoldings() {
  return TARGETS.map((row) => ({
    ticker: row.ticker,
    shares: row.marketValue / row.price,
    cost_basis: row.cost,
    theme: null,
  }));
}

export function sampleQuotesBySymbol() {
  return {
    NVDA: quote({ price: 174, rsi: 68, sma_50: 160, atr_22: 8, high_22: 200, chandelier_stop: 176, below_sma50_streak: 0 }),
    MU: quote({ price: 140, rsi: 84, sma_50: 120, atr_22: 4, high_22: 145, chandelier_stop: 133, below_sma50_streak: 0 }),
    AAPL: quote({ price: 230, rsi: 55, sma_50: 220, atr_22: 4, high_22: 235, chandelier_stop: 223, below_sma50_streak: 0 }),
    MSFT: quote({ price: 410, rsi: 48, sma_50: 430, atr_22: 15, high_22: 450, chandelier_stop: 405, below_sma50_streak: 2 }),
    LLY: quote({ price: 900, rsi: 62, sma_50: 600, atr_22: 15, high_22: 910, chandelier_stop: 865, below_sma50_streak: 0 }),
    NOW: quote({ price: 850, rsi: 61, sma_50: 800, atr_22: 18, high_22: 870, chandelier_stop: 816, below_sma50_streak: 0 }),
    CCJ: quote({ price: 55, rsi: 58, sma_50: 50, atr_22: 2, high_22: 58, chandelier_stop: 52, below_sma50_streak: 0 }),
    DNN: quote({ price: 2.1, rsi: 60, sma_50: 1.9, atr_22: 0.08, high_22: 2.2, chandelier_stop: 1.96, below_sma50_streak: 0 }),
    NXE: quote({ price: 8, rsi: 52, sma_50: 7.4, atr_22: 0.3, high_22: 8.4, chandelier_stop: 7.5, below_sma50_streak: 0 }),
    ASTS: quote({ price: 28, rsi: 64, sma_50: 24, atr_22: 1.5, high_22: 30, chandelier_stop: 25.5, below_sma50_streak: 0 }),
  };
}

export function sampleEarningsBySymbol() {
  return {
    AAPL: "2026-11-04",
    MSFT: "2027-01-27",
    NOW: "2026-11-20",
    NVDA: "2026-11-18",
    MU: "2026-12-16",
    LLY: "2027-02-04",
    CCJ: "2027-02-18",
    DNN: null,
    NXE: "2026-11-12",
    ASTS: "2027-03-10",
  };
}

const WATCHLIST_EXTRAS = {
  NVDA: { sma_200: 128, wma_200: 134, adx: 31, macd: 2.4, atr: 6.1, donchian_upper: 186, donchian_lower: 152, volume: 41200000 },
  MU: { sma_200: 98, wma_200: 104, adx: 27, macd: 1.8, atr: 3.4, donchian_upper: 148, donchian_lower: 118, volume: 18600000 },
  AAPL: { sma_200: 198, wma_200: 205, adx: 18, macd: 0.6, atr: 3.2, donchian_upper: 238, donchian_lower: 214, volume: 52300000 },
  MSFT: { sma_200: 402, wma_200: 418, adx: 22, macd: -1.1, atr: 7.4, donchian_upper: 448, donchian_lower: 398, volume: 22100000 },
  LLY: { sma_200: 520, wma_200: 540, adx: 29, macd: 8.5, atr: 14.2, donchian_upper: 920, donchian_lower: 840, volume: 3400000 },
  NOW: { sma_200: 760, wma_200: 782, adx: 19, macd: 1.4, atr: 16.0, donchian_upper: 880, donchian_lower: 800, volume: 1800000 },
  CCJ: { sma_200: 46, wma_200: 48, adx: 21, macd: 0.4, atr: 1.6, donchian_upper: 59, donchian_lower: 50, volume: 4200000 },
  DNN: { sma_200: 1.55, wma_200: 1.62, adx: 16, macd: 0.02, atr: 0.07, donchian_upper: 2.25, donchian_lower: 1.82, volume: 8900000 },
  NXE: { sma_200: 6.4, wma_200: 6.7, adx: 17, macd: 0.05, atr: 0.28, donchian_upper: 8.6, donchian_lower: 7.1, volume: 3100000 },
  ASTS: { sma_200: 18, wma_200: 20, adx: 24, macd: 0.7, atr: 1.4, donchian_upper: 31, donchian_lower: 22, volume: 7600000 },
};

export function sampleWatchlistQuotes() {
  const quotes = sampleQuotesBySymbol();
  return Object.entries(quotes).map(([symbol, quoteRow]) => ({
    symbol,
    ...quoteRow,
    ...(WATCHLIST_EXTRAS[symbol] || {}),
  }));
}

export function sampleScreenerRows() {
  return [
    { ticker: "AAPL", inst_buyers: 18, inst_sellers: 6, inst_net_breadth: 22.4, pe_ratio: 32.1, market_cap: 3.4e12, eps: 7.2, profit_margin: 0.26, next_earnings_date: "2026-11-04", analyst_rating: "Buy" },
    { ticker: "MSFT", inst_buyers: 14, inst_sellers: 7, inst_net_breadth: 12.1, pe_ratio: 34.4, market_cap: 3.1e12, eps: 12.5, profit_margin: 0.35, next_earnings_date: "2027-01-27", analyst_rating: "Buy" },
    { ticker: "NVDA", inst_buyers: 20, inst_sellers: 5, inst_net_breadth: 28.0, pe_ratio: 48.2, market_cap: 4.2e12, eps: 3.6, profit_margin: 0.52, next_earnings_date: "2026-11-18", analyst_rating: "Buy" },
    { ticker: "CCJ", inst_buyers: 8, inst_sellers: 5, inst_net_breadth: 6.5, pe_ratio: 41.0, market_cap: 2.4e10, eps: 1.1, profit_margin: 0.18, next_earnings_date: "2027-02-18", analyst_rating: "Hold" },
  ];
}

export function sampleSellBook() {
  return buildSellBook({
    holdings: sampleHoldings(),
    quotesBySymbol: sampleQuotesBySymbol(),
    earningsBySymbol: sampleEarningsBySymbol(),
    today: SAMPLE_TODAY,
  });
}
