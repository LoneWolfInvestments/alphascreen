// One Finnhub earnings-calendar pull for the watchlist, the screener, and
// the owner's holdings. Two windows, with a pause between them, stay inside
// the free tier (60 calls/minute) and a short serverless run. No new API key:
// this uses the FINNHUB_API_KEY the weekly fundamentals job already has.
// Dates are public market data. Shares and cost basis are never written here.

import { createClient } from "@supabase/supabase-js";
import { rejectIfCronUnauthorized } from "../server/cronAuth.js";
import {
  dateWindows,
  FINNHUB_PAUSE_MS,
  pickNextEarnings,
  sleep,
} from "../server/earningsCalendar.js";
import { nyToday } from "../src/lib/sellSignals.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fetchWindow(from, to) {
  const url = new URL("https://finnhub.io/api/v1/calendar/earnings");
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("token", process.env.FINNHUB_API_KEY);
  const res = await fetch(url.toString());
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || `Finnhub earnings calendar returned ${res.status}`);
  }
  return data.earningsCalendar || data || [];
}

async function loadUniverse() {
  const [watchlist, scores, portfolio] = await Promise.all([
    supabase.from("watchlist").select("symbol").eq("active", true),
    supabase.from("fundamental_scores").select("ticker"),
    supabase.from("portfolio").select("ticker"),
  ]);

  const symbols = new Set();
  for (const row of watchlist.data || []) symbols.add(String(row.symbol || "").toUpperCase());
  for (const row of scores.data || []) symbols.add(String(row.ticker || "").toUpperCase());
  for (const row of portfolio.data || []) symbols.add(String(row.ticker || "").toUpperCase());
  symbols.delete("");

  const errors = [watchlist.error, scores.error, portfolio.error].filter(Boolean).map((error) => error.message);
  return { symbols: [...symbols].sort(), errors };
}

export default async function handler(req, res) {
  if (rejectIfCronUnauthorized(req, res)) return;
  if (!process.env.FINNHUB_API_KEY) {
    return res.status(500).json({ error: "FINNHUB_API_KEY not configured" });
  }

  const today = nyToday();
  const windows = dateWindows(today);
  const started = Date.now();
  const events = [];
  const failedWindows = [];
  let calls = 0;

  try {
    for (let i = 0; i < windows.length; i += 1) {
      if (i > 0) {
        if (Date.now() - started > 6000) {
          failedWindows.push({ ...windows[i], error: "Stopped early to stay inside the function time limit" });
          break;
        }
        await sleep(FINNHUB_PAUSE_MS);
      }
      calls += 1;
      try {
        const rows = await fetchWindow(windows[i].from, windows[i].to);
        events.push(...rows);
      } catch (err) {
        failedWindows.push({ ...windows[i], error: err.message });
      }
    }

    if (events.length === 0) {
      return res.status(500).json({
        error: "Finnhub earnings calendar returned no rows. Existing dates were left unchanged.",
        calls,
        failedWindows,
      });
    }

    const { symbols, errors } = await loadUniverse();
    if (symbols.length === 0) {
      return res.status(200).json({ message: "No watchlist, screener, or portfolio symbols to update", calls, failedWindows, errors });
    }

    const next = pickNextEarnings(events, today);
    const complete = failedWindows.length === 0;
    const now = new Date().toISOString();
    const rows = symbols
      .filter((symbol) => complete || next.has(symbol))
      .map((symbol) => ({
        symbol,
        next_earnings_date: next.get(symbol) || null,
        updated_at: now,
      }));

    if (rows.length === 0) {
      return res.status(200).json({
        message: "Calendar loaded, but this shard of symbols had no dated rows and a window failed, so nothing was cleared.",
        calls,
        failedWindows,
        symbols: symbols.length,
      });
    }

    const { error } = await supabase.from("earnings_calendar").upsert(rows);
    if (error) throw error;

    return res.status(200).json({
      updated: rows.length,
      symbols: symbols.length,
      events: events.length,
      calls,
      failedWindows,
      errors,
      complete,
    });
  } catch (err) {
    return res.status(500).json({ error: "Earnings refresh failed", detail: err.message, calls });
  }
}
