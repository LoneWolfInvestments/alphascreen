// api/cron-refresh-fundamentals.js
// Pulls P/E, market cap, EPS, margin, next earnings date, and analyst consensus
// from Finnhub's free tier (Twelve Data's equivalents are all paid-only —
// confirmed by testing). Runs weekly, sharded to respect rate limits.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fetchMetrics(ticker) {
  const url = `https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${process.env.FINNHUB_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  const m = data.metric || {};
  return {
    pe_ratio: m.peBasicExclExtraTTM ?? null,
    market_cap: m.marketCapitalization != null ? m.marketCapitalization * 1e6 : null, // Finnhub returns millions
    eps: m.epsInclExtraItemsTTM ?? m.epsBasicExclExtraItemsTTM ?? null,
    profit_margin: m.netProfitMarginTTM != null ? m.netProfitMarginTTM / 100 : null, // Finnhub returns as percent
  };
}

async function fetchNextEarnings(ticker) {
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${today}&to=${future}&symbol=${ticker}&token=${process.env.FINNHUB_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  const upcoming = (data.earningsCalendar || [])[0];
  return upcoming ? upcoming.date : null;
}

async function fetchAnalystRating(ticker) {
  const url = `https://finnhub.io/api/v1/stock/recommendation?symbol=${ticker}&token=${process.env.FINNHUB_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  const latest = Array.isArray(data) ? data[0] : null;
  if (!latest) return null;
  const bullish = (latest.strongBuy || 0) + (latest.buy || 0);
  const bearish = (latest.strongSell || 0) + (latest.sell || 0);
  const total = bullish + bearish + (latest.hold || 0);
  if (total === 0) return null;
  if (bullish / total > 0.6) return "Buy";
  if (bearish > bullish) return "Sell";
  return "Hold";
}

export default async function handler(req, res) {
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!process.env.FINNHUB_API_KEY) {
    return res.status(500).json({ error: "FINNHUB_API_KEY not configured" });
  }

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
        const [metrics, nextEarnings, rating] = await Promise.all([
          fetchMetrics(ticker),
          fetchNextEarnings(ticker),
          fetchAnalystRating(ticker),
        ]);
        await supabase.from("fundamental_scores").update({
          ...metrics,
          next_earnings_date: nextEarnings,
          analyst_rating: rating,
          updated_at: new Date().toISOString(),
        }).eq("ticker", ticker);
        results.push(ticker);
      } catch (err) {
        failed.push({ ticker, error: err.message });
      }
      await new Promise((r) => setTimeout(r, 1100)); // Finnhub free tier: 60 calls/min limit
    }

    return res.status(200).json({ shard, totalShards, updated: results.length, failed, total: myShare.length });
  } catch (err) {
    return res.status(500).json({ error: "Fundamentals refresh failed", detail: err.message });
  }
}
