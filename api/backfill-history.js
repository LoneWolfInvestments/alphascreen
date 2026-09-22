// api/backfill-history.js
// Run this ONCE, manually, whenever you add a brand-new ticker — it backfills
// quotes_history with as much indicator history as Twelve Data's free tier
// allows (up to 210 days), so a new ticker isn't starting from a blank slate
// in your backtesting dataset compared to tickers tracked from day one.
//
// Usage: /api/backfill-history?symbol=TICKER

import { createClient } from "@supabase/supabase-js";
import { RSI, MACD, SMA } from "technicalindicators";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const TWELVE_DATA_BASE = "https://api.twelvedata.com";
const OUTPUT_SIZE = 210;

const RSI_PERIOD = 14;
const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;

export default async function handler(req, res) {
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const symbol = req.query.symbol;
  if (!symbol) {
    return res.status(400).json({ error: "Missing required query param: symbol" });
  }

  try {
    const url = new URL(`${TWELVE_DATA_BASE}/time_series`);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", "1day");
    url.searchParams.set("outputsize", String(OUTPUT_SIZE));
    url.searchParams.set("apikey", process.env.TWELVE_DATA_API_KEY);

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.status === "error" || !data.values) {
      throw new Error(data.message || `No time series data for ${symbol}`);
    }

    // Oldest-first chronological order, same as the regular indicators job
    const values = data.values.slice().reverse();
    const dates = values.map((v) => v.datetime);
    const closes = values.map((v) => parseFloat(v.close));

    // These three (unlike ATR/ADX/Bollinger) return one value per input day once
    // past their own warmup window, which is exactly what we need to backfill a
    // full row-per-day history rather than just the single latest value.
    const rsiValues = RSI.calculate({ period: RSI_PERIOD, values: closes });
    const macdValues = MACD.calculate({
      fastPeriod: MACD_FAST, slowPeriod: MACD_SLOW, signalPeriod: MACD_SIGNAL,
      values: closes, SimpleMAOscillator: false, SimpleMASignal: false,
    });

    // Each indicator array is shorter than `closes` by its own warmup period —
    // align everything to the END of the closes array so dates match up correctly.
    const rsiOffset = closes.length - rsiValues.length;
    const macdOffset = closes.length - macdValues.length;

    const historyRows = [];
    for (let i = 0; i < closes.length; i++) {
      const rsi = i >= rsiOffset ? rsiValues[i - rsiOffset] : null;
      const macd = i >= macdOffset ? macdValues[i - macdOffset]?.MACD ?? null : null;
      historyRows.push({
        symbol,
        price: closes[i],
        rsi,
        macd,
        recorded_at: new Date(dates[i]).toISOString(),
      });
    }

    // Insert in one batch. If this symbol already has some history rows (e.g.
    // partial data from before), duplicates by exact recorded_at are possible —
    // fine for an occasional one-time backfill, not meant to be re-run repeatedly.
    const { error: insertError } = await supabase.from("quotes_history").insert(historyRows);
    if (insertError) throw insertError;

    return res.status(200).json({
      symbol,
      rowsBackfilled: historyRows.length,
      dateRange: { from: dates[0], to: dates.at(-1) },
    });
  } catch (err) {
    return res.status(500).json({ error: "Backfill failed", detail: err.message });
  }
}
