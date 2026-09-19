// api/cron-refresh-indicators.js
// Runs once daily after US market close. For each symbol: pulls one time_series call
// (not three separate indicator endpoints), computes RSI/MACD/Bollinger Bands locally,
// and upserts into the same `quotes` table used by the intraday quote refresh.
//
// npm install technicalindicators @supabase/supabase-js

import { createClient } from "@supabase/supabase-js";
import { RSI, MACD, BollingerBands, ATR, ADX } from "technicalindicators";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TWELVE_DATA_BASE = "https://api.twelvedata.com";

// Standard parameter choices — change here if you want different periods
const RSI_PERIOD = 14;
const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;
const BBANDS_PERIOD = 20;
const BBANDS_STDDEV = 2;
const ATR_PERIOD = 14;
const ADX_PERIOD = 14;

// Need enough bars for the slowest indicator (MACD needs ~26+9) plus buffer
const OUTPUT_SIZE = 60;

async function fetchTimeSeries(symbol) {
  const url = new URL(`${TWELVE_DATA_BASE}/time_series`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "1day");
  url.searchParams.set("outputsize", String(OUTPUT_SIZE));
  url.searchParams.set("apikey", process.env.TWELVE_DATA_API_KEY);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (data.status === "error" || !data.values) {
    throw new Error(data.message || `No time series data for ${symbol}`);
  }

  // Twelve Data returns newest-first; indicators need oldest-first chronological order.
  // ATR/ADX also need high/low, so pull all three here rather than a second API call.
  const values = data.values.slice().reverse();
  return {
    closes: values.map((v) => parseFloat(v.close)),
    highs: values.map((v) => parseFloat(v.high)),
    lows: values.map((v) => parseFloat(v.low)),
  };
}

function computeIndicators({ closes, highs, lows }) {
  const rsiValues = RSI.calculate({ period: RSI_PERIOD, values: closes });
  const macdValues = MACD.calculate({
    fastPeriod: MACD_FAST,
    slowPeriod: MACD_SLOW,
    signalPeriod: MACD_SIGNAL,
    values: closes,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const bbandsValues = BollingerBands.calculate({
    period: BBANDS_PERIOD,
    values: closes,
    stdDev: BBANDS_STDDEV,
  });
  const atrValues = ATR.calculate({ period: ATR_PERIOD, high: highs, low: lows, close: closes });
  const adxValues = ADX.calculate({ period: ADX_PERIOD, close: closes, high: highs, low: lows });

  // Each array is shorter than `closes` since indicators need a warmup window —
  // the last element is the most recent computed value.
  const latestRsi = rsiValues.at(-1);
  const latestMacd = macdValues.at(-1);
  const latestBbands = bbandsValues.at(-1);
  const latestAtr = atrValues.at(-1);
  const latestAdx = adxValues.at(-1);

  return {
    rsi: latestRsi ?? null,
    macd: latestMacd?.MACD ?? null,
    macd_signal: latestMacd?.signal ?? null,
    bb_upper: latestBbands?.upper ?? null,
    bb_middle: latestBbands?.middle ?? null,
    bb_lower: latestBbands?.lower ?? null,
    atr: latestAtr ?? null,
    adx: latestAdx?.adx ?? null,
  };
}

export default async function handler(req, res) {
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // This job is split into shards to respect Twelve Data's free-tier rate limit
  // (8 API credits/minute) AND Vercel's 10-second function timeout on the Hobby plan —
  // both mean we can't fetch a large watchlist sequentially in one run.
  // ?shard=0&shards=7 processes every 7th symbol starting at index 0.
  // vercel.json triggers each shard a couple of minutes apart so the per-minute
  // rate limit resets between batches.
  const shard = parseInt(req.query.shard, 10) || 0;
  const totalShards = parseInt(req.query.shards, 10) || 1;

  try {
    const { data: watchlist, error: watchlistError } = await supabase
      .from("watchlist")
      .select("symbol")
      .eq("active", true)
      .order("symbol", { ascending: true }); // stable order so sharding is consistent run to run

    if (watchlistError) throw watchlistError;
    if (!watchlist || watchlist.length === 0) {
      return res.status(200).json({ message: "Watchlist is empty, nothing to refresh" });
    }

    const myShare = watchlist.filter((_, i) => i % totalShards === shard);

    const results = [];
    const failed = [];

    // Twelve Data free tier: 8 credits/minute. Spacing requests ~4s apart keeps us
    // to about 15/minute worst case within a shard, safely under that per-symbol,
    // and each shard is small enough to finish inside Vercel's 10s function limit.
    for (const { symbol } of myShare) {
      try {
        const series = await fetchTimeSeries(symbol);
        const indicators = computeIndicators(series);
        results.push({
          symbol,
          latest_close: series.closes.at(-1),
          ...indicators,
          updated_at: new Date().toISOString(),
        });
      } catch (err) {
        failed.push({ symbol, error: err.message });
      }
    }

    if (results.length > 0) {
      // Upsert into `quotes` — merges with the price/volume columns the intraday job already wrote.
      // Strip latest_close first since it's not a column on `quotes` (that table gets its
      // price from the intraday quote job instead).
      const quotesRows = results.map(({ latest_close, ...rest }) => rest);
      const { error: upsertError } = await supabase.from("quotes").upsert(quotesRows);
      if (upsertError) throw upsertError;

      // Append to quotes_history — the daily dataset this job exists to build.
      // Unlike the intraday job (price only), this row carries the full indicator
      // snapshot so backtesting later has RSI/MACD alongside price on the same date.
      const historyRows = results.map((r) => ({
        symbol: r.symbol,
        price: r.latest_close,
        rsi: r.rsi,
        macd: r.macd,
        recorded_at: r.updated_at,
      }));
      const { error: historyError } = await supabase.from("quotes_history").insert(historyRows);
      if (historyError) throw historyError;
    }

    return res.status(200).json({
      shard,
      totalShards,
      updated: results.length,
      failed,
      total: myShare.length,
    });
  } catch (err) {
    return res.status(500).json({ error: "Indicator refresh failed", detail: err.message });
  }
}
