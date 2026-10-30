// Weekday night, after the US close and after the indicator shards have had
// a chance to store SPY. Three Cboe daily history files (VIX, VIX3M, SKEW),
// then SPY and watchlist breadth from daily_bars. No API key.
//
// Cboe publishes each file as one CSV and redirects cdn.cboe.com to
// cdn-api.cboe.com. Their site terms allow one personal, non-commercial
// download and otherwise restrict storing, displaying, and building a
// product from the files (https://www.cboe.com/en/terms/). This job stores
// the day's closes and a plain-language regime, not the history file.
//
// Vercel Hobby allows 100 cron jobs per project, each at most once a day.
// This schedule is once per weekday night. It replaces the Saturday COT job,
// so the project stays at 20 cron entries.

import { createClient } from "@supabase/supabase-js";
import { rejectIfCronUnauthorized } from "../server/cronAuth.js";
import { fetchCboeSnapshot } from "../server/cboeHistory.js";
import { buildStressRow, closesBySymbol } from "../src/lib/marketStress.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const LOOKBACK_CALENDAR_DAYS = 460;
const PAGE = 1000;
const PAGE_CAP = 100;

function daysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function missingRelation(error, table) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""} ${error?.code || ""}`;
  return error?.code === "42P01"
    || error?.code === "PGRST205"
    || new RegExp(table, "i").test(message);
}

async function loadTrendInputs() {
  const since = daysAgo(LOOKBACK_CALENDAR_DAYS);
  const { data: watchlist, error: watchError } = await supabase
    .from("watchlist")
    .select("symbol")
    .eq("active", true);
  if (watchError) throw watchError;

  const active = new Set(
    (watchlist || []).map((row) => String(row.symbol || "").toUpperCase()).filter(Boolean)
  );

  const rows = [];
  let from = 0;
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const { data, error } = await supabase
      .from("daily_bars")
      .select("symbol, bar_date, close")
      .gte("bar_date", since)
      .order("symbol", { ascending: true })
      .order("bar_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }

  const bySymbol = closesBySymbol(rows);
  const nameSeries = [];
  for (const symbol of active) {
    if (symbol === "SPY") continue;
    const series = bySymbol.get(symbol);
    if (series) nameSeries.push(series);
  }
  return {
    spySeries: bySymbol.get("SPY") || [],
    nameSeries,
  };
}

export default async function handler(req, res) {
  if (rejectIfCronUnauthorized(req, res)) return;

  try {
    const cboe = await fetchCboeSnapshot();
    let spySeries = [];
    let nameSeries = [];
    try {
      const loaded = await loadTrendInputs();
      spySeries = loaded.spySeries;
      nameSeries = loaded.nameSeries;
    } catch (err) {
      if (!missingRelation(err, "daily_bars")) throw err;
    }

    const row = buildStressRow({
      asOf: cboe.asOf,
      vix: cboe.vix,
      vix3m: cboe.vix3m,
      skew: cboe.skew,
      spySeries,
      nameSeries,
    });

    const { error } = await supabase
      .from("market_stress")
      .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "as_of" });
    if (error) {
      if (missingRelation(error, "market_stress")) {
        return res.status(500).json({
          error: "market_stress table is missing. Paste the contents of schema-market-stress.sql into the Supabase SQL Editor and run them.",
        });
      }
      throw error;
    }

    return res.status(200).json({
      as_of: row.as_of,
      regime: row.regime,
      vix: row.vix,
      vix_ratio: row.vix_ratio,
      skew: row.skew,
      spy_above_sma200: row.spy_above_sma200,
      breadth_pct: row.breadth_pct,
      breadth_total: row.breadth_total,
    });
  } catch (err) {
    return res.status(500).json({ error: "Market stress refresh failed", detail: err.message });
  }
}
