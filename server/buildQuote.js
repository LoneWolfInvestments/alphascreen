import { computeIndicators } from "./computeIndicators.js";
import { computeSellLevels, isMissingSellColumnError, withoutSellColumns } from "./computeSellLevels.js";
import { BENCHMARK_SYMBOL } from "./twelveData.js";
import {
  analyzeSymbol,
  isMissingSetupColumnError,
  setupToQuoteFields,
  withoutSetupColumns,
} from "../src/lib/swingSetups.js";

// One quote row from the stored daily bars: price, classic indicators, the
// chandelier exit, and the swing setup. SPY is the benchmark and is not a setup.
export function buildQuotePayload({ symbol, bars, spyBars, updatedAt = new Date().toISOString() }) {
  const series = Array.isArray(bars) ? bars : [];
  const last = series[series.length - 1] || null;
  const prev = series.length > 1 ? series[series.length - 2] : null;
  const price = last ? last.close : null;
  const change = prev && price != null ? price - prev.close : null;
  const percentChange = prev && prev.close ? ((price - prev.close) / prev.close) * 100 : null;
  const indicators = computeIndicators(series);
  const sellLevels = computeSellLevels({
    closes: series.map((bar) => bar.close),
    highs: series.map((bar) => (Number.isFinite(bar.high) ? bar.high : bar.close)),
    lows: series.map((bar) => (Number.isFinite(bar.low) ? bar.low : bar.close)),
  });
  const setup = analyzeSymbol(series, spyBars, { symbol });

  return {
    symbol,
    price,
    change,
    percent_change: percentChange,
    volume: last && Number.isFinite(last.volume) ? Math.round(last.volume) : null,
    ...indicators,
    ...sellLevels,
    ...setupToQuoteFields(setup),
    bar_date: last ? last.date : null,
    updated_at: updatedAt,
  };
}

// New setup columns and the sell-signal columns were added in separate SQL
// files. If either file has not been run yet, save the rest of the row so
// prices keep updating.
export async function upsertQuotes(supabase, rows) {
  let payload = rows;
  let sellColumnsMissing = false;
  let setupColumnsMissing = false;
  let { error } = await supabase.from("quotes").upsert(payload);
  if (error && isMissingSetupColumnError(error)) {
    setupColumnsMissing = true;
    payload = payload.map(withoutSetupColumns);
    ({ error } = await supabase.from("quotes").upsert(payload));
  }
  if (error && isMissingSellColumnError(error)) {
    sellColumnsMissing = true;
    payload = payload.map(withoutSellColumns);
    ({ error } = await supabase.from("quotes").upsert(payload));
  }
  return { error, sellColumnsMissing, setupColumnsMissing };
}

export function historyRow(quote) {
  const recorded = quote.bar_date ? `${quote.bar_date}T21:00:00.000Z` : quote.updated_at;
  return {
    symbol: quote.symbol,
    price: quote.price,
    rsi: quote.rsi,
    macd: quote.macd,
    recorded_at: recorded,
  };
}

export function isBenchmark(symbol) {
  return String(symbol || "").toUpperCase() === BENCHMARK_SYMBOL;
}
