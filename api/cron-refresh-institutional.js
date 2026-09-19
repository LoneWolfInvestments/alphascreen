// api/cron-refresh-institutional.js
// Pulls institutional (13F) accumulation/distribution data from oanor.com's
// Institutional Stock Ownership API (sourced from Nasdaq's public 13F feed) for
// every ticker in fundamental_scores, and updates the `institutional` field.
//
// Free tier: 700 calls/month, 2 requests/second. Sign up at oanor.com/developer/keys
// and add OANOR_API_KEY to Vercel env vars.
//
// Note: 13F filings are quarterly, so this only needs to run monthly — running
// more often just re-fetches the same quarter's data.
//
// This job is sharded (like the quote/indicator jobs) to stay comfortably under
// the 2 req/s rate limit and Vercel's 10-second function timeout.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fetchInstitutionalSignal(ticker) {
  const url = `https://api.oanor.com/institutions-api/v1/activity?symbol=${ticker}`;
  const res = await fetch(url, {
    headers: { "x-oanor-key": process.env.OANOR_API_KEY },
  });
  const json = await res.json();

  if (!json.success || !json.data) {
    throw new Error(json.message || `oanor API returned an error for ${ticker}`);
  }

  const d = json.data;
  // Mirror their own "institution_sentiment" methodology: buyers = increased + new,
  // sellers = decreased + sold-out, using holder counts (breadth) not raw share
  // volume, so it's comparable across mega-caps and smaller names alike.
  const buyers = (d.increased_positions?.holders || 0) + (d.new_positions?.holders || 0);
  const sellers = (d.decreased_positions?.holders || 0) + (d.sold_out_positions?.holders || 0);
  const total = buyers + sellers;
  if (total === 0) return 0;

  const netBreadth = (buyers - sellers) / total; // -1..1

  // Recalibrated against real data: NVDA (clear accumulation) showed ~15.5% net
  // breadth, nowhere near the original ±50% thresholds — those were unreachable
  // in practice, which is why everything landed on the same "+1" bucket. Real
  // institutional breadth rarely swings past roughly ±25%, so thresholds are
  // set to actually differentiate within that realistic range.
  if (netBreadth > 0.25) return 2;
  if (netBreadth > 0.05) return 1;
  if (netBreadth >= -0.05) return 0;
  if (netBreadth >= -0.25) return -1;
  return -2;
}

export default async function handler(req, res) {
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!process.env.OANOR_API_KEY) {
    return res.status(500).json({ error: "OANOR_API_KEY not configured" });
  }

  // Sharding: ?shard=0&shards=5 processes every 5th ticker starting at index 0.
  const shard = parseInt(req.query.shard, 10) || 0;
  const totalShards = parseInt(req.query.shards, 10) || 1;

  try {
    const { data: names } = await supabase.from("fundamental_scores").select("ticker").order("ticker", { ascending: true });
    if (!names || names.length === 0) {
      return res.status(200).json({ message: "No tickers in fundamental_scores yet" });
    }

    const myShare = names.filter((_, i) => i % totalShards === shard);

    const results = [];
    const failed = [];

    for (const { ticker } of myShare) {
      try {
        const signal = await fetchInstitutionalSignal(ticker);
        await supabase.from("fundamental_scores").update({ institutional: signal, updated_at: new Date().toISOString() }).eq("ticker", ticker);
        results.push(ticker);
      } catch (err) {
        failed.push({ ticker, error: err.message });
      }
      await new Promise((r) => setTimeout(r, 600)); // stay under oanor's 2 req/s free-tier limit
    }

    return res.status(200).json({ shard, totalShards, updated: results.length, failed, total: myShare.length });
  } catch (err) {
    return res.status(500).json({ error: "Institutional flow refresh failed", detail: err.message });
  }
}
