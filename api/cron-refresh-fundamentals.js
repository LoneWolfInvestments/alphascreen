// api/cron-refresh-fundamentals.js
// Pulls company metrics, the next earnings date, and analyst consensus from
// Finnhub's free tier. Twelve Data's fundamental endpoints are paid.
// Same three calls per ticker as before. Extra growth and margin fields come
// out of the metrics response that was already downloaded. Weekly, sharded.

import { createClient } from "@supabase/supabase-js";
import { rejectIfCronUnauthorized } from "../server/cronAuth.js";
import { sendJob } from "../server/jobLog.js";
import { isMissingEarningsTableError } from "../server/earningsCalendar.js";
import {
  BUSINESS_COLUMNS,
  analystPeriodFromRecommendation,
  factsFromFinnhubPayload,
  isMissingColumnError,
  withoutColumns,
} from "../src/lib/businessFundamentals.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fetchBasicFinancials(ticker) {
  const url = `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${process.env.FINNHUB_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error || !data.metric) {
    const detail = typeof data.error === "string" ? data.error : "Finnhub metrics request failed";
    throw new Error(detail);
  }
  return data;
}

async function fetchNextEarnings(ticker) {
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${today}&to=${future}&symbol=${encodeURIComponent(ticker)}&token=${process.env.FINNHUB_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  const upcoming = (data.earningsCalendar || [])[0];
  return upcoming ? upcoming.date : null;
}

async function fetchAnalystRating(ticker) {
  const url = `https://finnhub.io/api/v1/stock/recommendation?symbol=${encodeURIComponent(ticker)}&token=${process.env.FINNHUB_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  const latest = Array.isArray(data) ? data[0] : null;
  if (!latest) return { analyst_rating: null, analyst_period: null };
  const bullish = (latest.strongBuy || 0) + (latest.buy || 0);
  const bearish = (latest.strongSell || 0) + (latest.sell || 0);
  const total = bullish + bearish + (latest.hold || 0);
  let analyst_rating = null;
  if (total > 0) {
    if (bullish / total > 0.6) analyst_rating = "Buy";
    else if (bearish > bullish) analyst_rating = "Sell";
    else analyst_rating = "Hold";
  }
  return { analyst_rating, analyst_period: analystPeriodFromRecommendation(data) };
}

export default async function handler(req, res) {
  if (rejectIfCronUnauthorized(req, res)) return;
  if (!process.env.FINNHUB_API_KEY) {
    return sendJob(res, 500, { error: "FINNHUB_API_KEY not configured" }, supabase, "fundamentals");
  }

  const shard = parseInt(req.query.shard, 10) || 0;
  const totalShards = parseInt(req.query.shards, 10) || 1;

  try {
    const { data: names } = await supabase.from("fundamental_scores").select("ticker").order("ticker", { ascending: true });
    if (!names || names.length === 0) {
      return sendJob(res, 200, { message: "No tickers in fundamental_scores yet" }, supabase, "fundamentals");
    }
    const myShare = names.filter((_, i) => i % totalShards === shard);

    const results = [];
    const failed = [];
    let businessColumnsMissing = false;

    for (const { ticker } of myShare) {
      try {
        const [financials, nextEarnings, analyst] = await Promise.all([
          fetchBasicFinancials(ticker),
          fetchNextEarnings(ticker),
          fetchAnalystRating(ticker),
        ]);
        let update = {
          ...factsFromFinnhubPayload(financials, { fetchedAt: new Date().toISOString() }),
          next_earnings_date: nextEarnings,
          ...analyst,
          updated_at: new Date().toISOString(),
        };
        let { error } = await supabase.from("fundamental_scores").update(update).eq("ticker", ticker);
        if (error && isMissingColumnError(error, BUSINESS_COLUMNS)) {
          businessColumnsMissing = true;
          update = withoutColumns(update, BUSINESS_COLUMNS);
          ({ error } = await supabase.from("fundamental_scores").update(update).eq("ticker", ticker));
        }
        if (error) throw error;
        const { error: calendarError } = await supabase.from("earnings_calendar").upsert({
          symbol: ticker,
          next_earnings_date: nextEarnings,
          updated_at: new Date().toISOString(),
        });
        if (calendarError && !isMissingEarningsTableError(calendarError)) throw calendarError;
        results.push(ticker);
      } catch (err) {
        failed.push({ ticker, error: err.message });
      }
      await new Promise((r) => setTimeout(r, 1100));
    }

    return sendJob(res, 200, {
      shard,
      totalShards,
      updated: results.length,
      failed,
      total: myShare.length,
      businessColumnsMissing,
    }, supabase, "fundamentals");
  } catch (err) {
    return sendJob(res, 500, { error: "Fundamentals refresh failed", detail: err.message }, supabase, "fundamentals");
  }
}
