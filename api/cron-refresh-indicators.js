// api/cron-refresh-indicators.js
// Once each weekday night, after the US close. For each symbol: ONE Twelve Data
// time_series call. Those bars are upserted into daily_bars (keyed by the bar's
// own date), then RSI, MACD, the chandelier exit, and the swing setup are
// computed from the stored bars. SPY is downloaded once per night when it is
// not already on the watchlist, and only on shard 0.
//
// Twelve Data free tier: 8 credits per minute, 1 credit per symbol. This waits
// 8 seconds between calls. A shard that would run past the time budget skips
// the rest; the next night those names go first because the stalest quotes
// are refreshed first.

import { createClient } from "@supabase/supabase-js";
import { rejectIfCronUnauthorized } from "../server/cronAuth.js";
import { buildQuotePayload, historyRow, upsertQuotes } from "../server/buildQuote.js";
import { loadDailyBars, upsertDailyBars } from "../server/dailyBarsStore.js";
import { sleep } from "../server/earningsCalendar.js";
import {
  BENCHMARK_SYMBOL,
  TWELVE_DATA_PAUSE_MS,
  SHARD_TIME_BUDGET_MS,
  canFetchAnother,
  fetchTwelveDailyBars,
  isMissingDailyBarsError,
  queueForShard,
} from "../server/twelveData.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function stalestFirst(symbols) {
  if (!symbols.length) return symbols;
  const { data, error } = await supabase.from("quotes").select("symbol, updated_at").in("symbol", symbols);
  if (error) return pinBenchmark(symbols);
  const updated = new Map((data || []).map((row) => [row.symbol, row.updated_at || ""]));
  const sorted = [...symbols].sort((a, b) => {
    const au = updated.get(a) || "";
    const bu = updated.get(b) || "";
    if (au !== bu) return au < bu ? -1 : 1;
    return a.localeCompare(b);
  });
  return pinBenchmark(sorted);
}

function pinBenchmark(symbols) {
  if (!symbols.includes(BENCHMARK_SYMBOL)) return symbols;
  return [BENCHMARK_SYMBOL, ...symbols.filter((symbol) => symbol !== BENCHMARK_SYMBOL)];
}

export default async function handler(req, res) {
  if (rejectIfCronUnauthorized(req, res)) return;

  const shard = parseInt(req.query.shard, 10) || 0;
  const totalShards = parseInt(req.query.shards, 10) || 1;

  try {
    const { data: watchlist, error: watchlistError } = await supabase
      .from("watchlist")
      .select("symbol")
      .eq("active", true)
      .order("symbol", { ascending: true });

    if (watchlistError) throw watchlistError;
    if (!watchlist || watchlist.length === 0) {
      return res.status(200).json({ message: "Watchlist is empty, nothing to refresh" });
    }

    const listed = new Set(watchlist.map((row) => row.symbol));
    const queue = await stalestFirst(queueForShard(watchlist.map((row) => row.symbol), shard, totalShards));

    const started = Date.now();
    const fetched = [];
    const failed = [];
    const deferred = [];
    let calls = 0;
    let dailyBarsMissing = false;

    for (let index = 0; index < queue.length; index += 1) {
      const symbol = queue[index];
      if (!canFetchAnother({ startedAt: started, now: Date.now(), callsSoFar: calls })) {
        deferred.push(...queue.slice(index));
        break;
      }
      if (calls > 0) await sleep(TWELVE_DATA_PAUSE_MS);
      calls += 1;
      try {
        const bars = await fetchTwelveDailyBars(symbol);
        if (!dailyBarsMissing) {
          const saved = await upsertDailyBars(supabase, symbol, bars);
          if (saved.error && isMissingDailyBarsError(saved.error)) dailyBarsMissing = true;
          else if (saved.error) throw saved.error;
        }
        fetched.push({ symbol, bars });
      } catch (err) {
        failed.push({ symbol, error: err.message });
      }
    }

    let spyBars = [];
    if (!dailyBarsMissing) {
      const storedSpy = await loadDailyBars(supabase, BENCHMARK_SYMBOL);
      if (storedSpy.error && isMissingDailyBarsError(storedSpy.error)) dailyBarsMissing = true;
      else if (storedSpy.error) throw storedSpy.error;
      else spyBars = storedSpy.bars;
    }
    if (!spyBars.length) {
      const memory = fetched.find((item) => item.symbol === BENCHMARK_SYMBOL);
      if (memory) spyBars = memory.bars;
    }

    const results = [];
    for (const item of fetched) {
      if (!listed.has(item.symbol)) continue;
      let bars = item.bars;
      if (!dailyBarsMissing) {
        const stored = await loadDailyBars(supabase, item.symbol);
        if (stored.error) throw stored.error;
        if (stored.bars.length) bars = stored.bars;
      }
      results.push(buildQuotePayload({
        symbol: item.symbol,
        bars,
        spyBars: item.symbol === BENCHMARK_SYMBOL ? bars : spyBars,
      }));
    }

    let sellColumnsMissing = false;
    let setupColumnsMissing = false;
    if (results.length > 0) {
      const saved = await upsertQuotes(supabase, results);
      if (saved.error) throw saved.error;
      sellColumnsMissing = saved.sellColumnsMissing;
      setupColumnsMissing = saved.setupColumnsMissing;

      const historyRows = results.map(historyRow);
      const { error: historyError } = await supabase.from("quotes_history").insert(historyRows);
      if (historyError) throw historyError;
    }

    return res.status(200).json({
      shard,
      totalShards,
      updated: results.length,
      failed,
      deferred,
      total: queue.length,
      calls,
      pauseMs: TWELVE_DATA_PAUSE_MS,
      budgetMs: SHARD_TIME_BUDGET_MS,
      dailyBarsMissing,
      sellColumnsMissing,
      setupColumnsMissing,
      benchmark: BENCHMARK_SYMBOL,
    });
  } catch (err) {
    return res.status(500).json({ error: "Indicator refresh failed", detail: err.message });
  }
}
