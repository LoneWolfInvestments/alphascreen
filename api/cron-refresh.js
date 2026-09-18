// api/cron-refresh.js
// Triggered on a schedule by Vercel Cron (see vercel.json).
// Reads the watchlist from Supabase, batch-fetches quotes from Twelve Data
// (comma-separated symbols = one API call for many names, not one call each),
// and upserts the results back into Supabase.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // service role key — server-side only, never exposed to the client
);

const TWELVE_DATA_BASE = "https://api.twelvedata.com";
// Twelve Data's free tier charges roughly 1 credit per symbol even in a batched
// /quote call, and the account-wide limit is 8 credits/minute — so batches need
// to be small, sharded across separate cron triggers spaced a couple of minutes
// apart, same fix as cron-refresh-indicators.js.
const BATCH_SIZE = 6;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchBatchQuotes(symbols) {
  const url = new URL(`${TWELVE_DATA_BASE}/quote`);
  url.searchParams.set("symbol", symbols.join(","));
  url.searchParams.set("apikey", process.env.TWELVE_DATA_API_KEY);

  const res = await fetch(url.toString());
  const data = await res.json();

  // Twelve Data returns a single object (not keyed by symbol) when only one symbol is requested,
  // and an object keyed by symbol when multiple are requested. Normalize both cases.
  if (symbols.length === 1) {
    return { [symbols[0]]: data };
  }
  return data;
}

export default async function handler(req, res) {
  // Protect the endpoint — Vercel Cron sends a secret header you configure below.
  // Without this, anyone who finds the URL could trigger your API quota to burn.
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Same sharding pattern as cron-refresh-indicators.js: process only every Nth
  // symbol per invocation, with vercel.json triggering each shard a couple of
  // minutes apart so Twelve Data's per-minute credit limit resets between them.
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

    const symbols = watchlist.map((w) => w.symbol).filter((_, i) => i % totalShards === shard);
    if (symbols.length === 0) {
      return res.status(200).json({ message: "No symbols in this shard", shard, totalShards });
    }
    const batches = chunk(symbols, BATCH_SIZE);

    let updated = 0;
    let failed = [];

    for (const batch of batches) {
      const quotes = await fetchBatchQuotes(batch);

      const rows = batch
        .map((symbol) => {
          const q = quotes[symbol];
          if (!q || q.status === "error") {
            failed.push(symbol);
            return null;
          }
          return {
            symbol,
            price: parseFloat(q.close),
            change: parseFloat(q.change),
            percent_change: parseFloat(q.percent_change),
            volume: parseInt(q.volume, 10) || null,
            updated_at: new Date().toISOString(),
          };
        })
        .filter(Boolean);

      if (rows.length > 0) {
        const { error: upsertError } = await supabase.from("quotes").upsert(rows);
        if (upsertError) throw upsertError;
        updated += rows.length;

        // Also append to quotes_history — this is the append-only log that dataset
        // generation/backtesting will read from later. `quotes` only ever holds the
        // latest snapshot, so this insert is what makes the data durable over time.
        const historyRows = rows.map((r) => ({
          symbol: r.symbol,
          price: r.price,
          recorded_at: r.updated_at,
        }));
        const { error: historyError } = await supabase.from("quotes_history").insert(historyRows);
        if (historyError) throw historyError;
      }
    }

    return res.status(200).json({ shard, totalShards, updated, failed, total: symbols.length });
  } catch (err) {
    return res.status(500).json({ error: "Cron refresh failed", detail: err.message });
  }
}
