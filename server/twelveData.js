// Twelve Data daily bars. One time_series request is 1 credit no matter how
// many bars it returns (the docs weight this endpoint at 1 per symbol).

export const BENCHMARK_SYMBOL = "SPY";
export const OUTPUT_SIZE = 320;
export const TWELVE_DATA_PAUSE_MS = 8000;
export const SHARD_TIME_BUDGET_MS = 52000;
export const TWELVE_DATA_BASE = "https://api.twelvedata.com";

export function dedupeBars(bars) {
  const byDate = new Map();
  for (const bar of bars || []) {
    const date = String(bar?.date || "").slice(0, 10);
    const close = Number(bar?.close);
    if (!date || !Number.isFinite(close)) continue;
    // The feed is newest-first and the first row for a date is the one to keep.
    if (byDate.has(date)) continue;
    byDate.set(date, {
      date,
      open: Number(bar.open),
      high: Number(bar.high),
      low: Number(bar.low),
      close,
      volume: Number(bar.volume),
    });
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Twelve Data returns newest first. This sorts oldest first and drops bad rows.
export function barsFromTwelvePayload(data) {
  const values = Array.isArray(data?.values) ? data.values : [];
  return dedupeBars(values.map((value) => ({
    date: value?.datetime,
    open: value?.open,
    high: value?.high,
    low: value?.low,
    close: value?.close,
    volume: value?.volume,
  })));
}

export function barsToRows(symbol, bars) {
  return dedupeBars(bars).map((bar) => ({
    symbol,
    bar_date: bar.date,
    open: Number.isFinite(bar.open) ? bar.open : null,
    high: Number.isFinite(bar.high) ? bar.high : null,
    low: Number.isFinite(bar.low) ? bar.low : null,
    close: bar.close,
    volume: Number.isFinite(bar.volume) ? Math.round(bar.volume) : null,
  }));
}

export function rowsToBars(rows) {
  return dedupeBars((rows || []).map((row) => ({
    date: row.bar_date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
  })));
}

export function isMissingDailyBarsError(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  return /daily_bars/i.test(message);
}

// Symbols are already in a stable order (the cron sorts the watchlist).
// SPY is added once, on shard 0, and only when it is not already on the list.
export function queueForShard(symbols, shard, totalShards) {
  const share = [];
  (symbols || []).forEach((symbol, index) => {
    if (index % totalShards === shard) share.push(symbol);
  });
  const listed = new Set((symbols || []).map((symbol) => String(symbol).toUpperCase()));
  if (shard === 0 && !listed.has(BENCHMARK_SYMBOL)) return [BENCHMARK_SYMBOL, ...share];
  return share;
}

export function canFetchAnother({ startedAt, now, callsSoFar, budgetMs = SHARD_TIME_BUDGET_MS, pauseMs = TWELVE_DATA_PAUSE_MS }) {
  if (callsSoFar <= 0) return true;
  return now + pauseMs <= startedAt + budgetMs;
}

export async function fetchTwelveDailyBars(symbol, {
  outputSize = OUTPUT_SIZE,
  apiKey = process.env.TWELVE_DATA_API_KEY,
  fetchImpl = fetch,
} = {}) {
  const url = new URL(`${TWELVE_DATA_BASE}/time_series`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "1day");
  url.searchParams.set("outputsize", String(outputSize));
  url.searchParams.set("apikey", apiKey);

  const res = await fetchImpl(url.toString());
  const data = await res.json();
  if (data.status === "error" || !data.values) {
    throw new Error(data.message || `No time series data for ${symbol}`);
  }
  const bars = barsFromTwelvePayload(data);
  if (!bars.length) throw new Error(`No time series data for ${symbol}`);
  return bars;
}
