// api/cron-refresh-mag7.js
// Pulls ~13 months of daily price history for each Mag7 stock (TSLA excluded —
// not in the watchlist) and computes 3/6/12-month percentage performance.
// Only 6 symbols, so this runs unsharded — well within rate limits and the
// 10-second function timeout.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const TWELVE_DATA_BASE = "https://api.twelvedata.com";

const MAG7 = ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA"]; // TSLA excluded per instruction

// Approximate trading days per period (rough but standard convention:
// ~21 trading days/month)
const DAYS_3M = 63;
const DAYS_6M = 126;
const DAYS_12M = 252;
const OUTPUT_SIZE = 260; // buffer above 252 to guarantee full 12-month coverage

async function fetchCloses(symbol) {
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
  // Oldest-first chronological order
  return data.values.slice().reverse().map((v) => parseFloat(v.close));
}

function pctChange(closes, daysAgo) {
  if (closes.length <= daysAgo) return null; // not enough history yet
  const latest = closes.at(-1);
  const past = closes.at(-1 - daysAgo);
  if (past === 0 || past == null) return null;
  return ((latest - past) / past) * 100;
}

export default async function handler(req, res) {
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const results = [];
  const failed = [];

  for (const symbol of MAG7) {
    try {
      const closes = await fetchCloses(symbol);
      const row = {
        ticker: symbol,
        price: closes.at(-1),
        perf_3m: pctChange(closes, DAYS_3M),
        perf_6m: pctChange(closes, DAYS_6M),
        perf_12m: pctChange(closes, DAYS_12M),
        updated_at: new Date().toISOString(),
      };
      await supabase.from("mag7_performance").upsert(row);
      results.push(symbol);
    } catch (err) {
      failed.push({ symbol, error: err.message });
    }
  }

  return res.status(200).json({ updated: results.length, failed, total: MAG7.length });
}
