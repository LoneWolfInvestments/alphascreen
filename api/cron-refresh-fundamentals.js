// api/cron-refresh-fundamentals.js
// Pulls company statistics, next earnings date, and analyst consensus for every
// ticker in fundamental_scores. This data changes slowly (quarterly financials,
// periodic analyst updates), so this runs weekly, sharded to respect rate limits.
//
// IMPORTANT: these three endpoints (statistics, earnings_calendar, recommendations)
// have not been confirmed available on Twelve Data's free tier — this is exactly
// what we're testing. If any come back with a plan-restriction error, that
// specific piece stays null and gets logged in `failed`, without blocking the
// other two from working.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BASE = "https://api.twelvedata.com";

async function fetchJson(path, params) {
  const url = new URL(`${BASE}/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("apikey", process.env.TWELVE_DATA_API_KEY);
  const res = await fetch(url.toString());
  const data = await res.json();
  if (data.status === "error" || data.code) {
    throw new Error(data.message || `${path} returned an error`);
  }
  return data;
}

async function fetchStatistics(ticker) {
  const data = await fetchJson("statistics", { symbol: ticker });
  // Field names per Twelve Data's documented statistics response shape —
  // nested under valuations_metrics / financials, may need adjusting once tested.
  const val = data.statistics?.valuations_metrics || {};
  const fin = data.statistics?.financials || {};
  return {
    pe_ratio: val.trailing_pe ?? null,
    market_cap: val.market_capitalization ?? null,
    eps: fin.income_statement?.diluted_eps_ttm ?? null,
    profit_margin: fin.income_statement?.net_income_margin_ttm ?? null,
  };
}

async function fetchNextEarnings(ticker) {
  const data = await fetchJson("earnings_calendar", { symbol: ticker });
  const upcoming = (data.earnings || []).find((e) => new Date(e.date) > new Date());
  return upcoming ? upcoming.date : null;
}

async function fetchAnalystView(ticker) {
  const data = await fetchJson("recommendations", { symbol: ticker });
  const latest = data.trends?.[0];
  if (!latest) return { analyst_rating: null, price_target: null };
  const total = (latest.strong_buy || 0) + (latest.buy || 0) + (latest.hold || 0) + (latest.sell || 0) + (latest.strong_sell || 0);
  const bullish = (latest.strong_buy || 0) + (latest.buy || 0);
  let rating = "Hold";
  if (total > 0) {
    if (bullish / total > 0.6) rating = "Buy";
    else if ((latest.sell || 0) + (latest.strong_sell || 0) > bullish) rating = "Sell";
  }
  return { analyst_rating: rating, price_target: null }; // price target needs a separate endpoint if this one lacks it
}

export default async function handler(req, res) {
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
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
      const update = { updated_at: new Date().toISOString() };
      let anySuccess = false;

      try {
        Object.assign(update, await fetchStatistics(ticker));
        anySuccess = true;
      } catch (err) {
        failed.push({ ticker, endpoint: "statistics", error: err.message });
      }

      try {
        update.next_earnings_date = await fetchNextEarnings(ticker);
        anySuccess = true;
      } catch (err) {
        failed.push({ ticker, endpoint: "earnings_calendar", error: err.message });
      }

      try {
        Object.assign(update, await fetchAnalystView(ticker));
        anySuccess = true;
      } catch (err) {
        failed.push({ ticker, endpoint: "recommendations", error: err.message });
      }

      if (anySuccess) {
        await supabase.from("fundamental_scores").update(update).eq("ticker", ticker);
        results.push(ticker);
      }

      await new Promise((r) => setTimeout(r, 800));
    }

    return res.status(200).json({ shard, totalShards, updated: results.length, failed, total: myShare.length });
  } catch (err) {
    return res.status(500).json({ error: "Fundamentals refresh failed", detail: err.message });
  }
}
